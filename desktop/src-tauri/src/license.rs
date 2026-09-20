//! Licencia del dispositivo: activación, heartbeat y período de gracia.
//!
//! La licencia autoriza a la MÁQUINA (la sesión del agente, en `auth.rs`,
//! autoriza a la PERSONA). Se guarda en el almacén seguro del SO junto con el
//! resultado del último heartbeat exitoso; con eso la app decide offline si
//! sigue dentro del período de gracia sin preguntar al servidor.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
#[cfg(test)]
use serde_json::Value;
use tauri::State;

use crate::api::Credenciales;
use crate::error::{AppError, AppResult};
use crate::{fingerprint, secure_store, AppState};

/// Lo que se persiste en el almacén seguro bajo `secure_store::CLAVE_LICENCIA`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenciaGuardada {
    pub token: String,
    pub id: String,
    pub sucursal_id: String,
    pub sucursal_nombre: String,
    pub empresa_id: Option<String>,
    /// Último heartbeat (o activación) que el servidor aceptó. Reloj local.
    pub ultimo_heartbeat_ok: DateTime<Utc>,
    pub heartbeat_intervalo_min: u32,
    pub gracia_horas: u32,
    /// El servidor respondió "revocada"/"inválida": se bloquea aunque el
    /// período de gracia no haya vencido.
    #[serde(default)]
    pub bloqueada_por_servidor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "estado", rename_all = "snake_case")]
pub enum EstadoLicencia {
    SinLicencia,
    /// Heartbeat reciente: todo normal.
    Activa,
    /// Sin heartbeat exitoso hace rato pero dentro de la gracia: se puede
    /// trabajar; la UI avisa cuánto queda.
    EnGracia { horas_restantes: f64 },
    /// Hay que reactivar (gracia agotada o revocación confirmada).
    Bloqueada { motivo: String },
}

/// Cuánto puede estar el reloj local por DETRÁS del último heartbeat aceptado
/// antes de considerarlo manipulado. Cubre el desfase normal de un reloj mal
/// sincronizado; por encima de esto, atrasar el reloj para alargar la gracia de
/// 72 h deja el equipo bloqueado hasta que un heartbeat lo confirme.
pub const TOLERANCIA_RELOJ_ATRASADO_HORAS: i64 = 6;

/// Regla pura del período de gracia. `ahora` se inyecta para poder testear.
pub fn evaluar(lic: Option<&LicenciaGuardada>, ahora: DateTime<Utc>) -> EstadoLicencia {
    let Some(lic) = lic else { return EstadoLicencia::SinLicencia };
    if let Some(motivo) = &lic.bloqueada_por_servidor {
        return EstadoLicencia::Bloqueada { motivo: motivo.clone() };
    }
    let transcurrido = ahora - lic.ultimo_heartbeat_ok;
    if transcurrido < Duration::zero() {
        // Un desfase pequeño de reloj no es motivo de bloqueo…
        if -transcurrido <= Duration::hours(TOLERANCIA_RELOJ_ATRASADO_HORAS) {
            return EstadoLicencia::Activa;
        }
        // …pero un reloj muy por detrás del último contacto con el servidor es
        // la forma de estirar la gracia offline indefinidamente: si a las 60 h
        // sin conexión alguien atrasa el reloj 3 días, `transcurrido` volvía a
        // ser ~0 y la app seguía "activa". Se bloquea hasta que un heartbeat
        // exitoso (o corregir el reloj) reinicie la referencia.
        return EstadoLicencia::Bloqueada { motivo: "reloj_alterado".into() };
    }
    // "Activa" = el último heartbeat cabe dentro de dos intervalos (uno pudo
    // fallar por un parpadeo de red sin que eso sea "offline").
    let ventana_activa = Duration::minutes(i64::from(lic.heartbeat_intervalo_min) * 2);
    if transcurrido <= ventana_activa {
        return EstadoLicencia::Activa;
    }
    let gracia = Duration::hours(i64::from(lic.gracia_horas));
    if transcurrido < gracia {
        let restante = gracia - transcurrido;
        return EstadoLicencia::EnGracia { horas_restantes: restante.num_minutes() as f64 / 60.0 };
    }
    EstadoLicencia::Bloqueada { motivo: "gracia_agotada".into() }
}

impl EstadoLicencia {
    /// ¿Se puede usar la app (registrar accesos, sincronizar)?
    pub fn permite_uso(&self) -> bool {
        matches!(self, EstadoLicencia::Activa | EstadoLicencia::EnGracia { .. })
    }
}

// ── Respuestas del backend ──────────────────────────────────────────────────

#[derive(Deserialize)]
struct RespActivar {
    token_licencia: String,
    licencia: LicenciaInfo,
    heartbeat_intervalo_min: u32,
    gracia_offline_horas: u32,
}

#[derive(Deserialize)]
struct LicenciaInfo {
    id: String,
    sucursal_id: String,
    sucursal_nombre: String,
    empresa_id: Option<String>,
}

#[derive(Deserialize)]
struct RespHeartbeat {
    heartbeat_intervalo_min: u32,
    gracia_offline_horas: u32,
}

// ── DTO hacia el frontend ───────────────────────────────────────────────────

#[derive(Serialize)]
pub struct LicenciaDto {
    #[serde(flatten)]
    pub estado: EstadoLicencia,
    pub sucursal_nombre: Option<String>,
    pub sucursal_id: Option<String>,
    pub ultimo_heartbeat_ok: Option<DateTime<Utc>>,
    pub heartbeat_intervalo_min: Option<u32>,
    pub gracia_horas: Option<u32>,
    pub fingerprint: String,
}

pub fn dto(state: &AppState) -> LicenciaDto {
    let lic = state.licencia.read().unwrap().clone();
    LicenciaDto {
        estado: evaluar(lic.as_ref(), Utc::now()),
        sucursal_nombre: lic.as_ref().map(|l| l.sucursal_nombre.clone()),
        sucursal_id: lic.as_ref().map(|l| l.sucursal_id.clone()),
        ultimo_heartbeat_ok: lic.as_ref().map(|l| l.ultimo_heartbeat_ok),
        heartbeat_intervalo_min: lic.as_ref().map(|l| l.heartbeat_intervalo_min),
        gracia_horas: lic.as_ref().map(|l| l.gracia_horas),
        fingerprint: state.fingerprint.clone(),
    }
}

/// Persiste y publica en memoria.
fn guardar(state: &AppState, lic: Option<LicenciaGuardada>) -> AppResult<()> {
    match &lic {
        Some(l) => secure_store::guardar_json(secure_store::CLAVE_LICENCIA, l)?,
        None => secure_store::borrar(secure_store::CLAVE_LICENCIA)?,
    }
    *state.licencia.write().unwrap() = lic;
    Ok(())
}

// ── Lógica ──────────────────────────────────────────────────────────────────

pub async fn activar(state: &AppState, codigo: &str, nombre_dispositivo: Option<&str>) -> AppResult<LicenciaDto> {
    if !fingerprint::es_valido(&state.fingerprint) {
        return Err(AppError::new("fingerprint", "No se pudo calcular la huella de este equipo"));
    }
    let base = state.api_url();
    let body = json!({
        "codigo": codigo.trim(),
        "fingerprint": state.fingerprint,
        "nombre_dispositivo": nombre_dispositivo.map(str::trim).filter(|s| !s.is_empty()),
    });
    let r: RespActivar = state.api.post(&base, "/licencias/activar", &body, &Credenciales::default()).await?;

    let anterior = state.licencia.read().unwrap().clone();
    let nueva = LicenciaGuardada {
        token: r.token_licencia,
        id: r.licencia.id,
        sucursal_id: r.licencia.sucursal_id,
        sucursal_nombre: r.licencia.sucursal_nombre,
        empresa_id: r.licencia.empresa_id,
        ultimo_heartbeat_ok: Utc::now(),
        heartbeat_intervalo_min: r.heartbeat_intervalo_min,
        gracia_horas: r.gracia_offline_horas,
        bloqueada_por_servidor: None,
    };

    // La clave de la BD local depende del token: abrir/recifrar ANTES de
    // persistir el token nuevo, para que si algo falla no quede una BD que
    // ninguna licencia guardada pueda abrir.
    crate::garita::preparar_db(state, anterior.as_ref().map(|l| l.token.as_str()), &nueva.token)?;
    guardar(state, Some(nueva))?;
    Ok(dto(state))
}

/// Un heartbeat contra el servidor. Devuelve el estado resultante.
/// - OK → refresca `ultimo_heartbeat_ok`.
/// - `licencia_revocada`/`licencia_invalida` → marca bloqueo definitivo.
/// - `empresa_suspendida` → bloqueo mientras dure; el siguiente heartbeat OK
///   (owner reactivó) lo levanta solo.
/// - Sin conexión u otro error → no cambia nada (la gracia sigue corriendo).
pub async fn heartbeat(state: &AppState) -> AppResult<EstadoLicencia> {
    let Some(mut lic) = state.licencia.read().unwrap().clone() else {
        return Ok(EstadoLicencia::SinLicencia);
    };
    let base = state.api_url();
    let body = json!({ "fingerprint": state.fingerprint });
    let cred = Credenciales { jwt: None, licencia: Some(&lic.token) };
    match state.api.post::<RespHeartbeat>(&base, "/licencias/heartbeat", &body, &cred).await {
        Ok(r) => {
            lic.ultimo_heartbeat_ok = Utc::now();
            lic.heartbeat_intervalo_min = r.heartbeat_intervalo_min;
            lic.gracia_horas = r.gracia_offline_horas;
            lic.bloqueada_por_servidor = None;
            guardar(state, Some(lic))?;
            state.marcar_conexion(true);
            Ok(EstadoLicencia::Activa)
        }
        Err(e) if e.codigo == "licencia_revocada" || e.codigo == "licencia_invalida" || e.codigo == "empresa_suspendida" => {
            log::warn!("licencia bloqueada por el servidor: {}", e.mensaje);
            lic.bloqueada_por_servidor = Some(e.codigo.clone());
            guardar(state, Some(lic))?;
            state.marcar_conexion(true);
            Ok(EstadoLicencia::Bloqueada { motivo: e.codigo })
        }
        Err(e) => {
            if e.es_sin_conexion() {
                state.marcar_conexion(false);
            }
            log::info!("heartbeat sin efecto: {}", e.mensaje);
            Ok(evaluar(Some(&lic), Utc::now()))
        }
    }
}

/// Olvida la licencia en este equipo (soporte: mover el equipo a otra
/// sucursal). Borra también la sesión y la BD local, porque su clave
/// dependía del token.
pub fn desvincular(state: &AppState) -> AppResult<()> {
    crate::auth::cerrar_sesion_local(state)?;
    crate::garita::cerrar_db(state);
    guardar(state, None)?;
    Ok(())
}

/// Bloquea la app si el estado no permite uso. Lo usan sync y garita.
pub fn exigir_uso(state: &AppState) -> AppResult<LicenciaGuardada> {
    let lic = state.licencia.read().unwrap().clone();
    match evaluar(lic.as_ref(), Utc::now()) {
        e if e.permite_uso() => Ok(lic.unwrap()),
        EstadoLicencia::SinLicencia => Err(AppError::new("sin_licencia", "Este equipo no tiene licencia activada")),
        EstadoLicencia::Bloqueada { motivo } => Err(AppError::new(
            "licencia_bloqueada",
            match motivo.as_str() {
                "gracia_agotada" => "Han pasado más de 72 h sin contacto con el servidor. Reactiva la licencia.".to_string(),
                "licencia_revocada" => "La licencia de este equipo fue revocada.".to_string(),
                "empresa_suspendida" => "Las operaciones de esta empresa están suspendidas. Contacta al administrador de SecureGate.".to_string(),
                "reloj_alterado" => "El reloj de este equipo está muy atrasado respecto al último contacto con el servidor. Corrige la fecha y hora de Windows.".to_string(),
                otro => format!("Licencia bloqueada: {otro}"),
            },
        )),
        _ => unreachable!(),
    }
}

// ── Comandos Tauri ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn licencia_estado(state: State<'_, AppState>) -> LicenciaDto {
    dto(&state)
}

#[tauri::command]
pub async fn licencia_activar(
    state: State<'_, AppState>,
    codigo: String,
    nombre_dispositivo: Option<String>,
) -> AppResult<LicenciaDto> {
    activar(&state, &codigo, nombre_dispositivo.as_deref()).await
}

#[tauri::command]
pub async fn licencia_heartbeat(state: State<'_, AppState>) -> AppResult<LicenciaDto> {
    heartbeat(&state).await?;
    Ok(dto(&state))
}

#[tauri::command]
pub fn licencia_desvincular(state: State<'_, AppState>) -> AppResult<()> {
    desvincular(&state)
}

#[cfg(test)]
pub fn a_json(e: &EstadoLicencia) -> Value {
    serde_json::to_value(e).unwrap_or(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lic(hace_min: i64) -> LicenciaGuardada {
        LicenciaGuardada {
            token: "t".into(),
            id: "l".into(),
            sucursal_id: "s".into(),
            sucursal_nombre: "Garita".into(),
            empresa_id: None,
            ultimo_heartbeat_ok: Utc::now() - Duration::minutes(hace_min),
            heartbeat_intervalo_min: 15,
            gracia_horas: 72,
            bloqueada_por_servidor: None,
        }
    }

    #[test]
    fn sin_licencia() {
        assert_eq!(evaluar(None, Utc::now()), EstadoLicencia::SinLicencia);
        assert!(!EstadoLicencia::SinLicencia.permite_uso());
    }

    #[test]
    fn heartbeat_reciente_es_activa() {
        assert_eq!(evaluar(Some(&lic(5)), Utc::now()), EstadoLicencia::Activa);
        assert_eq!(evaluar(Some(&lic(29)), Utc::now()), EstadoLicencia::Activa, "hasta 2 intervalos sigue activa");
    }

    #[test]
    fn offline_dentro_de_72h_es_gracia_y_permite_uso() {
        let e = evaluar(Some(&lic(60 * 24)), Utc::now()); // 24 h sin heartbeat
        match e {
            EstadoLicencia::EnGracia { horas_restantes } => {
                assert!((47.9..=48.1).contains(&horas_restantes), "{horas_restantes}");
            }
            otro => panic!("esperaba EnGracia, fue {otro:?}"),
        }
        assert!(e.permite_uso());
    }

    #[test]
    fn pasadas_72h_se_bloquea() {
        let e = evaluar(Some(&lic(60 * 72 + 1)), Utc::now());
        assert_eq!(e, EstadoLicencia::Bloqueada { motivo: "gracia_agotada".into() });
        assert!(!e.permite_uso());
    }

    #[test]
    fn la_revocacion_confirmada_bloquea_aunque_haya_gracia() {
        let mut l = lic(1);
        l.bloqueada_por_servidor = Some("licencia_revocada".into());
        assert_eq!(evaluar(Some(&l), Utc::now()), EstadoLicencia::Bloqueada { motivo: "licencia_revocada".into() });
    }

    #[test]
    fn reloj_local_algo_atrasado_no_bloquea() {
        // ultimo_heartbeat_ok "en el futuro" por poco (desfase normal de reloj)
        assert_eq!(evaluar(Some(&lic(-120)), Utc::now()), EstadoLicencia::Activa);
        assert_eq!(evaluar(Some(&lic(-(TOLERANCIA_RELOJ_ATRASADO_HORAS * 60 - 5))), Utc::now()), EstadoLicencia::Activa);
    }

    #[test]
    fn reloj_muy_atrasado_bloquea_en_vez_de_estirar_la_gracia() {
        // Atrasar el reloj varios días hacía que `transcurrido` fuera negativo
        // y la licencia siguiera "activa" sin límite.
        let e = evaluar(Some(&lic(-(60 * 24 * 3))), Utc::now());
        assert_eq!(e, EstadoLicencia::Bloqueada { motivo: "reloj_alterado".into() });
        assert!(!e.permite_uso());
        let justo_fuera = evaluar(Some(&lic(-(TOLERANCIA_RELOJ_ATRASADO_HORAS * 60 + 5))), Utc::now());
        assert_eq!(justo_fuera, EstadoLicencia::Bloqueada { motivo: "reloj_alterado".into() });
    }

    #[test]
    fn serializa_con_tag_estado() {
        let v = a_json(&EstadoLicencia::EnGracia { horas_restantes: 3.5 });
        assert_eq!(v["estado"], "en_gracia");
        assert_eq!(v["horas_restantes"], 3.5);
    }
}
