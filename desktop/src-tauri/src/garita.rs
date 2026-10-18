//! Operaciones de garita sobre la BD local: abrir/cerrar la base cifrada,
//! buscar residentes, evaluar a un visitante (blacklist / preautorización) y
//! encolar accesos. Todo esto funciona sin internet.

use chrono::{DateTime, Local, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::{db, secure_store, AppState};

// ── Apertura de la BD ───────────────────────────────────────────────────────

fn sal_instalacion() -> AppResult<Vec<u8>> {
    if let Some(hex_sal) = secure_store::leer(secure_store::CLAVE_DB_SAL)? {
        return hex::decode(hex_sal).map_err(|e| AppError::interno(format!("sal corrupta: {e}")));
    }
    let sal: [u8; 16] = uuid::Uuid::new_v4().into_bytes();
    secure_store::guardar(secure_store::CLAVE_DB_SAL, &hex::encode(sal))?;
    Ok(sal.to_vec())
}

/// Abre la BD con la clave derivada de `token_nuevo`. Si ya estaba abierta
/// con `token_anterior` (reactivación), la recifra en vez de perderla.
pub fn preparar_db(state: &AppState, token_anterior: Option<&str>, token_nuevo: &str) -> AppResult<()> {
    preparar_db_sin_hardware(state, token_anterior, token_nuevo)?;
    // La config de la talanquera vive en esta BD: se activa en cuanto abre.
    crate::hardware_cmd::cargar_desde_db(state);
    Ok(())
}

fn preparar_db_sin_hardware(state: &AppState, token_anterior: Option<&str>, token_nuevo: &str) -> AppResult<()> {
    let sal = sal_instalacion()?;
    let nueva = db::derivar_clave(&state.fingerprint, token_nuevo, &sal)?;
    let ruta = state.dir_datos.join(db::NOMBRE_ARCHIVO);

    let mut guard = state.db.lock().unwrap();
    if let Some(conn) = guard.as_ref() {
        db::recifrar(conn, &nueva)?;
        return Ok(());
    }

    match db::abrir(&ruta, &nueva) {
        Ok(conn) => {
            *guard = Some(conn);
            Ok(())
        }
        Err(e) if e.codigo == "db_clave" => {
            if let Some(viejo) = token_anterior {
                let vieja = db::derivar_clave(&state.fingerprint, viejo, &sal)?;
                let conn = db::abrir(&ruta, &vieja)?;
                db::recifrar(&conn, &nueva)?;
                *guard = Some(conn);
                return Ok(());
            }
            // Sin forma de abrirla: se aparta (no se borra) y se empieza de
            // cero. Sólo pasa si se desvinculó la licencia con datos locales.
            let bak = state.dir_datos.join(format!("{}.ilegible-{}", db::NOMBRE_ARCHIVO, Utc::now().timestamp()));
            log::warn!("BD local ilegible con la licencia actual; apartada en {}", bak.display());
            std::fs::rename(&ruta, &bak).map_err(|e| AppError::interno(e.to_string()))?;
            for suf in ["-wal", "-shm"] {
                let _ = std::fs::remove_file(state.dir_datos.join(format!("{}{suf}", db::NOMBRE_ARCHIVO)));
            }
            *guard = Some(db::abrir(&ruta, &nueva)?);
            Ok(())
        }
        Err(e) => Err(e),
    }
}

pub fn cerrar_db(state: &AppState) {
    *state.db.lock().unwrap() = None;
}

/// Ejecuta `f` con la conexión abierta. Error `db_cerrada` si no hay licencia.
pub fn con_db<T>(state: &AppState, f: impl FnOnce(&Connection) -> AppResult<T>) -> AppResult<T> {
    let guard = state.db.lock().unwrap();
    let conn = guard
        .as_ref()
        .ok_or_else(|| AppError::new("db_cerrada", "La base local no está abierta (¿licencia activada?)"))?;
    f(conn)
}

// ── Modelos ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Residente {
    pub id: String,
    pub numero_casa: String,
    pub nombre: String,
    pub estado_pago: String,
    pub telefono: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Evaluacion {
    pub bloqueado: bool,
    pub razon_bloqueo: Option<String>,
    /// Qué coincidió con la lista negra: `"dpi"` o `"placa"` (None si no está bloqueado).
    pub motivo_bloqueo: Option<String>,
    pub preautorizado: bool,
    pub preautorizacion: Option<Preautorizacion>,
    pub visitante_conocido: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Preautorizacion {
    pub id: String,
    pub residente_id: String,
    pub nombre_visitante: String,
    pub numero_dpi: Option<String>,
    pub placa: Option<String>,
    pub fecha_inicio: String,
    pub fecha_fin: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct NuevoAcceso {
    pub nombre_visitante: String,
    pub numero_dpi: String,
    pub residente_id: String,
    pub placa: Option<String>,
    pub notas: Option<String>,
    pub capturado_manualmente: bool,
    /// Invitación QR que presentó el visitante, si entró por ese camino. El
    /// backend la usa para contar el uso y para bloquearla tras varios
    /// intentos fallidos.
    #[serde(default)]
    pub invitacion_qr_id: Option<String>,
    /// De dónde salió el DPI: `local` (OCR del equipo), `remoto` (Vision) o `manual`. Si no viene, se deduce de
    /// `capturado_manualmente`.
    #[serde(default)]
    pub origen_dpi: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AccesoPendiente {
    pub id_cliente: String,
    pub registrado_en: String,
    pub estado: String,
    pub intentos: i64,
    pub ultimo_error: Option<String>,
    pub sincronizado_en: Option<String>,
    pub nombre_visitante: String,
    pub numero_dpi: String,
    pub placa: Option<String>,
    pub residente_casa: Option<String>,
    pub capturado_manualmente: bool,
    /// `local`, `remoto` o `manual` (None en accesos anteriores a T5).
    pub origen_dpi: Option<String>,
    /// Id del registro en el servidor, una vez sincronizado: con él se puede dar la
    /// salida desde la lista sin buscar por placa. `None` mientras siga pendiente.
    pub registro_id: Option<String>,
    /// `anpr` si lo registró el reconocimiento de placas (Sprint 10); `None` en los de siempre.
    pub origen: Option<String>,
}

// ── Consultas ───────────────────────────────────────────────────────────────

pub fn buscar_residentes(conn: &Connection, q: &str, limite: usize) -> AppResult<Vec<Residente>> {
    let patron = format!("%{}%", q.trim());
    let mut st = conn.prepare(
        "SELECT id, numero_casa, nombre, estado_pago, telefono FROM residentes_local
         WHERE numero_casa LIKE ?1 COLLATE NOCASE OR nombre LIKE ?1 COLLATE NOCASE
         ORDER BY CASE WHEN numero_casa LIKE ?1 THEN 0 ELSE 1 END, numero_casa
         LIMIT ?2",
    )?;
    let rows = st.query_map(params![patron, limite as i64], |r| {
        Ok(Residente {
            id: r.get(0)?,
            numero_casa: r.get(1)?,
            nombre: r.get(2)?,
            estado_pago: r.get(3)?,
            telefono: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Misma regla que `checkBlacklist` + `checkPreautorizacion` del backend,
/// evaluada contra el espejo local. `hoy` en fecha local (las
/// preautorizaciones son por día calendario).
pub fn evaluar_visitante(
    conn: &Connection,
    numero_dpi: &str,
    placa: Option<&str>,
    residente_id: Option<&str>,
    hoy: &str,
    ahora_iso: &str,
) -> AppResult<Evaluacion> {
    let dpi = numero_dpi.trim();
    // Placa normalizada (P123ABC) para la lista negra: se compara sin guiones ni espacios.
    let placa_bl = placa.map(crate::placa::normalizar).filter(|p| p.len() >= crate::placa::LARGO_MINIMO);
    // Blacklist de sucursal (residente_id NULL) o del residente destino, por DPI o por
    // PLACA del vehículo. Un DPI vacío jamás coincide (los bloqueos solo de vehículo se
    // guardan con numero_dpi = ''), y la placa solo aplica a los bloqueos de sucursal.
    let ban: Option<(String, Option<String>, String)> = conn
        .query_row(
            "SELECT razon, visitante_nombre,
                    CASE WHEN ?1 <> '' AND numero_dpi = ?1 THEN 'dpi' ELSE 'placa' END AS motivo
             FROM blacklist_local
             WHERE ((?1 <> '' AND numero_dpi = ?1)
                    OR (?4 IS NOT NULL AND placa IS NOT NULL AND placa = ?4 AND residente_id IS NULL))
               AND (fecha_fin IS NULL OR fecha_fin > ?2)
               AND (residente_id IS NULL OR residente_id = ?3)
             ORDER BY CASE WHEN ?1 <> '' AND numero_dpi = ?1 THEN 0 ELSE 1 END
             LIMIT 1",
            params![dpi, ahora_iso, residente_id.unwrap_or(""), placa_bl],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;

    let placa_norm = placa.map(crate::placa::normalizar).filter(|p| !p.is_empty());
    let pre: Option<Preautorizacion> = conn
        .query_row(
            "SELECT id, residente_id, nombre_visitante, numero_dpi, placa, fecha_inicio, fecha_fin
             FROM preautorizaciones_local
             WHERE fecha_inicio <= ?1 AND fecha_fin IS NOT NULL AND fecha_fin >= ?1
               AND (?2 = '' OR residente_id = ?2)
               AND (numero_dpi = ?3 OR (?4 IS NOT NULL AND placa = ?4))
             LIMIT 1",
            params![hoy, residente_id.unwrap_or(""), dpi, placa_norm],
            |r| {
                Ok(Preautorizacion {
                    id: r.get(0)?,
                    residente_id: r.get(1)?,
                    nombre_visitante: r.get(2)?,
                    numero_dpi: r.get(3)?,
                    placa: r.get(4)?,
                    fecha_inicio: r.get(5)?,
                    fecha_fin: r.get(6)?,
                })
            },
        )
        .optional()?;

    let conocido: Option<String> = conn
        .query_row(
            // Las filas del ANPR (vehículos de residentes) no llevan DPI: un DPI vacío nunca «conoce» a nadie.
            "SELECT nombre_visitante FROM accesos_pendientes WHERE numero_dpi = ?1 AND numero_dpi <> '' ORDER BY registrado_en DESC LIMIT 1",
            [dpi],
            |r| r.get(0),
        )
        .optional()?;

    Ok(Evaluacion {
        bloqueado: ban.is_some(),
        razon_bloqueo: ban.as_ref().map(|b| b.0.clone()),
        motivo_bloqueo: ban.as_ref().map(|b| b.2.clone()),
        preautorizado: pre.is_some(),
        visitante_conocido: conocido.or(ban.and_then(|b| b.1)).or(pre.as_ref().map(|p| p.nombre_visitante.clone())),
        preautorizacion: pre,
    })
}

/// Encola un acceso. Se escribe SIEMPRE local primero; sincronizar es
/// asunto de `sync`. Devuelve el id_cliente (UUID) generado.
pub fn encolar_acceso(conn: &Connection, agente_id: &str, a: &NuevoAcceso) -> AppResult<String> {
    if a.nombre_visitante.trim().is_empty() || a.numero_dpi.trim().is_empty() || a.residente_id.trim().is_empty() {
        return Err(AppError::new("validacion", "Nombre, DPI y residente son obligatorios"));
    }
    let hoy = Local::now().format("%Y-%m-%d").to_string();
    let ahora = Utc::now().to_rfc3339();
    let ev = evaluar_visitante(conn, &a.numero_dpi, a.placa.as_deref(), Some(&a.residente_id), &hoy, &ahora)?;
    if ev.bloqueado {
        let quien = if ev.motivo_bloqueo.as_deref() == Some("placa") { "Vehículo" } else { "Visitante" };
        return Err(AppError::new(
            "blacklist",
            format!("{quien} en lista negra: {}", ev.razon_bloqueo.unwrap_or_default()),
        ));
    }

    // Invitación QR: se normaliza como se guarda en el espejo (minúsculas) y, si la copia local ya sabe que no queda ningún
    // uso (contando los de este equipo que el servidor aún no cuenta), no se encola: dos paneles que escanearon la misma
    // invitación de un solo uso al mismo tiempo no pueden registrarla los dos. Una invitación que la copia no conoce
    // (nueva, o validada en línea) no se frena aquí: el servidor decide al sincronizar.
    // Origen del DPI: solo los tres valores conocidos; si no viene, «manual» cuando el agente lo tecleó.
    let origen_dpi: Option<&str> = match a.origen_dpi.as_deref().map(str::trim) {
        Some(o @ ("local" | "remoto" | "manual")) => Some(o),
        _ if a.capturado_manualmente => Some("manual"),
        _ => None,
    };
    let invitacion_qr = a.invitacion_qr_id.as_deref().map(|v| v.trim().to_lowercase()).filter(|v| !v.is_empty());
    if let Some(qr) = invitacion_qr.as_deref() {
        if qr_agotado_localmente(conn, qr)? {
            return Err(error_qr(MotivoQr::Agotada, true));
        }
    }

    let id_cliente = uuid::Uuid::new_v4().to_string();
    let registrado_en = Utc::now().to_rfc3339();
    // El servidor guarda y compara la placa en su forma canónica; se manda así desde el origen.
    let placa = a.placa.as_deref().map(crate::placa::normalizar).filter(|p| !p.is_empty());
    let payload = json!({
        "id_cliente": id_cliente,
        "registrado_en": registrado_en,
        "nombre_visitante": a.nombre_visitante.trim(),
        "numero_dpi": a.numero_dpi.trim(),
        "residente_id": a.residente_id,
        "agente_id": agente_id,
        "placa": placa,
        "notas": a.notas.as_deref().map(str::trim).filter(|n| !n.is_empty()),
        "capturado_manualmente": a.capturado_manualmente,
        "origen_dpi": origen_dpi,
        "invitacion_qr_id": invitacion_qr,
    });
    let casa: Option<String> = conn
        .query_row("SELECT numero_casa FROM residentes_local WHERE id = ?1", [&a.residente_id], |r| r.get(0))
        .optional()?;

    conn.execute(
        "INSERT INTO accesos_pendientes
           (id_cliente, payload, registrado_en, estado, intentos, proximo_intento_en,
            nombre_visitante, numero_dpi, placa, residente_casa, capturado_manualmente, invitacion_qr_id, origen_dpi)
         VALUES (?1, ?2, ?3, 'pendiente', 0, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            id_cliente,
            payload.to_string(),
            registrado_en,
            a.nombre_visitante.trim(),
            a.numero_dpi.trim(),
            placa,
            casa,
            a.capturado_manualmente as i64,
            payload["invitacion_qr_id"].as_str(),
            origen_dpi,
        ],
    )?;
    Ok(id_cliente)
}

pub fn listar_recientes(conn: &Connection, limite: usize) -> AppResult<Vec<AccesoPendiente>> {
    let mut st = conn.prepare(
        "SELECT id_cliente, registrado_en, estado, intentos, ultimo_error, sincronizado_en,
                nombre_visitante, numero_dpi, placa, residente_casa, capturado_manualmente, registro_id, origen_dpi, origen
         FROM accesos_pendientes WHERE visible = 1 ORDER BY registrado_en DESC LIMIT ?1",
    )?;
    let rows = st.query_map([limite as i64], |r| {
        Ok(AccesoPendiente {
            id_cliente: r.get(0)?,
            registrado_en: r.get(1)?,
            estado: r.get(2)?,
            intentos: r.get(3)?,
            ultimo_error: r.get(4)?,
            sincronizado_en: r.get(5)?,
            nombre_visitante: r.get(6)?,
            numero_dpi: r.get(7)?,
            placa: r.get(8)?,
            residente_casa: r.get(9)?,
            capturado_manualmente: r.get::<_, i64>(10)? != 0,
            registro_id: r.get(11)?,
            origen_dpi: r.get(12)?,
            origen: r.get(13)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

// ── Comandos Tauri ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn garita_buscar_residentes(state: State<'_, AppState>, q: String) -> AppResult<Vec<Residente>> {
    con_db(&state, |c| buscar_residentes(c, &q, 20))
}

#[tauri::command]
pub fn garita_evaluar_visitante(
    state: State<'_, AppState>,
    numero_dpi: String,
    placa: Option<String>,
    residente_id: Option<String>,
) -> AppResult<Evaluacion> {
    let hoy = Local::now().format("%Y-%m-%d").to_string();
    let ahora = Utc::now().to_rfc3339();
    con_db(&state, |c| evaluar_visitante(c, &numero_dpi, placa.as_deref(), residente_id.as_deref(), &hoy, &ahora))
}

// ── Invitaciones QR (SCRUM-126) ─────────────────────────────────────────────

/// Por qué una invitación QR no pasa la validación hecha SIN red contra la copia local. Los textos son los del backend
/// (`verificarInvitacion`) para que el agente lea lo mismo con o sin conexión.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MotivoQr {
    NoEstaEnLaCopia,
    Revocada,
    Bloqueada,
    AunNoVigente,
    Vencida,
    Agotada,
}

impl MotivoQr {
    pub fn codigo(self) -> &'static str {
        match self {
            MotivoQr::NoEstaEnLaCopia => "qr_desconocida",
            MotivoQr::Revocada => "qr_revocada",
            MotivoQr::Bloqueada => "qr_bloqueada",
            MotivoQr::AunNoVigente => "qr_futura",
            MotivoQr::Vencida => "qr_vencida",
            MotivoQr::Agotada => "qr_agotada",
        }
    }

    pub fn mensaje(self) -> &'static str {
        match self {
            MotivoQr::NoEstaEnLaCopia => {
                "Esta invitación no está en la copia local del equipo (puede ser nueva, estar vencida o ser de otra sucursal). \
                 Verifícala con conexión o registra la entrada con el DPI."
            }
            MotivoQr::Revocada => "Invitación QR revocada",
            MotivoQr::Bloqueada => "Invitación QR bloqueada temporalmente por intentos fallidos",
            MotivoQr::AunNoVigente => "Invitación QR aún no vigente",
            MotivoQr::Vencida => "Invitación QR vencida",
            MotivoQr::Agotada => "Invitación QR ya alcanzó el máximo de usos",
        }
    }
}

fn error_qr(motivo: MotivoQr, sin_conexion: bool) -> AppError {
    let sufijo = if sin_conexion && motivo != MotivoQr::NoEstaEnLaCopia {
        " (revisada sin conexión, con la copia local de este equipo)"
    } else {
        ""
    };
    AppError::new(motivo.codigo(), format!("{}{sufijo}", motivo.mensaje()))
}

struct QrLocal {
    id: String,
    tipo: String,
    etiqueta: Option<String>,
    nombre_visitante: Option<String>,
    numero_dpi: Option<String>,
    placa: Option<String>,
    residente_id: String,
    numero_casa: String,
    residente_nombre: String,
    fecha_inicio: String,
    fecha_fin: Option<String>,
    usos_maximos: Option<i64>,
    usos_actuales: i64,
    activo: bool,
    bloqueado_hasta: Option<String>,
}

fn leer_qr_local(conn: &Connection, id: &str) -> AppResult<Option<QrLocal>> {
    Ok(conn
        .query_row(
            "SELECT id, tipo, etiqueta, nombre_visitante, numero_dpi, placa, residente_id, numero_casa, residente_nombre,
                    fecha_inicio, fecha_fin, usos_maximos, usos_actuales, activo, bloqueado_hasta
             FROM invitaciones_qr_local WHERE id = ?1",
            [id.trim().to_lowercase()],
            |r| {
                Ok(QrLocal {
                    id: r.get(0)?,
                    tipo: r.get(1)?,
                    etiqueta: r.get(2)?,
                    nombre_visitante: r.get(3)?,
                    numero_dpi: r.get(4)?,
                    placa: r.get(5)?,
                    residente_id: r.get(6)?,
                    numero_casa: r.get(7)?,
                    residente_nombre: r.get(8)?,
                    fecha_inicio: r.get(9)?,
                    fecha_fin: r.get(10)?,
                    usos_maximos: r.get(11)?,
                    usos_actuales: r.get(12)?,
                    activo: r.get::<_, i64>(13)? != 0,
                    bloqueado_hasta: r.get(14)?,
                })
            },
        )
        .optional()?)
}

/// Usos de una invitación hechos en ESTE equipo que el servidor todavía no tiene en la copia que bajó: los que siguen en
/// la cola sin subir (o a la espera de reintento) y los que se subieron DESPUÉS de pedir la copia. Los rechazados no
/// cuentan (el servidor no los descontó) ni los subidos antes de la copia (ya vienen en `usos_actuales`).
pub fn usos_locales(conn: &Connection, id: &str) -> AppResult<i64> {
    let desde = db::meta_leer(conn, "qr_snapshot_desde")?.unwrap_or_default();
    Ok(conn.query_row(
        "SELECT count(*) FROM accesos_pendientes
         WHERE invitacion_qr_id = ?1
           AND (estado = 'pendiente' OR (estado = 'sincronizado' AND sincronizado_en > ?2))",
        params![id.trim().to_lowercase(), desde],
        |r| r.get(0),
    )?)
}

/// ¿La copia local sabe que a esta invitación ya no le queda ningún uso? Falso si no la conoce o no tiene tope.
fn qr_agotado_localmente(conn: &Connection, id: &str) -> AppResult<bool> {
    let Some(inv) = leer_qr_local(conn, id)? else { return Ok(false) };
    Ok(match inv.usos_maximos {
        Some(max) => inv.usos_actuales + usos_locales(conn, &inv.id)? >= max,
        None => false,
    })
}

/// Valida una invitación QR SIN red contra la copia local: las mismas reglas que `verificarInvitacion` del backend, en el
/// mismo orden (revocada → bloqueada → aún no vigente → vencida → agotada). `hoy` es la fecha local (AAAA-MM-DD), `ahora`
/// el instante actual en RFC 3339. El uso que ya hizo este equipo y el servidor aún no cuenta se suma a `usos_actuales`.
///
/// Límite asumido y documentado (docs/qr_sin_conexion.md): una invitación revocada, agotada en OTRA garita o bloqueada
/// DESPUÉS de la última sincronización se acepta aquí; el servidor la rechaza al subir el uso y el agente lo ve en la lista.
pub fn validar_qr_local(conn: &Connection, id: &str, hoy: &str, ahora: &str) -> AppResult<serde_json::Value> {
    let Some(inv) = leer_qr_local(conn, id)? else { return Err(error_qr(MotivoQr::NoEstaEnLaCopia, true)) };
    if !inv.activo {
        return Err(error_qr(MotivoQr::Revocada, true));
    }
    let bloqueada = match (inv.bloqueado_hasta.as_deref().map(DateTime::parse_from_rfc3339), DateTime::parse_from_rfc3339(ahora)) {
        (Some(Ok(hasta)), Ok(ahora)) => hasta > ahora,
        _ => false,
    };
    if bloqueada {
        return Err(error_qr(MotivoQr::Bloqueada, true));
    }
    if inv.fecha_inicio.as_str() > hoy {
        return Err(error_qr(MotivoQr::AunNoVigente, true));
    }
    if inv.fecha_fin.as_deref().is_some_and(|fin| fin < hoy) {
        return Err(error_qr(MotivoQr::Vencida, true));
    }
    let usos = inv.usos_actuales + usos_locales(conn, &inv.id)?;
    if inv.usos_maximos.is_some_and(|max| usos >= max) {
        return Err(error_qr(MotivoQr::Agotada, true));
    }
    Ok(json!({
        "id": inv.id,
        "tipo": inv.tipo,
        "etiqueta": inv.etiqueta,
        "nombre_visitante": inv.nombre_visitante,
        "numero_dpi": inv.numero_dpi,
        "placa": inv.placa,
        "residente_id": inv.residente_id,
        "numero_casa": inv.numero_casa,
        "residente_nombre": inv.residente_nombre,
        "usos_maximos": inv.usos_maximos,
        "usos_actuales": usos,
        // La pantalla lo avisa: el servidor confirma (o rechaza) el uso cuando el equipo vuelva a tener red.
        "validada_sin_conexion": true,
    }))
}

/// ¿El servidor no pudo contestar (sin red, o caído con un 5xx)? Es el ÚNICO caso en que vale la copia local: un 404/409
/// del servidor es una decisión suya y no se discute con una copia que puede estar vieja.
fn sin_servidor(e: &AppError) -> bool {
    e.es_sin_conexion() || e.status.is_some_and(|s| s >= 500)
}

async fn verificar_qr_en_linea(state: &AppState, id: &str) -> AppResult<serde_json::Value> {
    let (jwt, lic) = crate::auth::credenciales(state).await?;
    let base = state.api_url();
    state
        .api
        .get(
            &base,
            &format!("/invitaciones-qr/verificar/{}", id.trim()),
            &crate::api::Credenciales { jwt: Some(&jwt), licencia: Some(&lic) },
        )
        .await
}

/// Comprueba una invitación QR.
///
/// Con red, el servidor decide: la vigencia, los usos restantes y la revocación viven allí y su respuesta es la verdad.
/// Sin red (o con el servidor caído) se valida contra la copia local de las invitaciones de la sucursal, que se baja en
/// cada sincronización (SCRUM-126): un QR vigente se acepta y uno vencido, revocado o agotado se rechaza. El uso viaja en la
/// cola con su `invitacion_qr_id` y el servidor lo descuenta una sola vez al sincronizar.
#[tauri::command]
pub async fn garita_verificar_qr(state: State<'_, AppState>, id: String) -> AppResult<serde_json::Value> {
    crate::license::exigir_uso(&state)?;
    match verificar_qr_en_linea(&state, &id).await {
        Err(e) if sin_servidor(&e) => {
            let hoy = Local::now().format("%Y-%m-%d").to_string();
            let ahora = Utc::now().to_rfc3339();
            con_db(&state, |c| validar_qr_local(c, &id, &hoy, &ahora))
        }
        otro => otro,
    }
}

/// Busca el acceso ABIERTO de un vehículo por su placa, para darle salida.
///
/// Online, como el QR y por el mismo motivo: la entrada pudo registrarla otra
/// garita o la web, y el espejo local sólo guarda lo que ha salido de ESTE
/// equipo. Cerrar una salida con datos viejos dejaría vehículos dentro para
/// siempre. Devuelve `null` si no hay ninguno abierto con esa placa.
#[tauri::command]
pub async fn garita_buscar_salida(state: State<'_, AppState>, placa: String) -> AppResult<Option<serde_json::Value>> {
    crate::license::exigir_uso(&state)?;
    let (jwt, lic) = crate::auth::credenciales(&state).await?;
    let base = state.api_url();
    let cred = crate::api::Credenciales { jwt: Some(&jwt), licencia: Some(&lic) };
    match state.api.get_con::<serde_json::Value>(&base, "/accesos/activo", &[("placa", placa.trim())], &cred).await {
        Ok(v) => Ok(Some(v)),
        // El backend responde 404 cuando no hay nada abierto: no es un error
        // que deba ver el agente como fallo, es "este carro no está dentro".
        Err(e) if e.codigo == "no_encontrado" => Ok(None),
        Err(e) => Err(e),
    }
}

/// Cierra la salida de un acceso abierto y, ya cerrada, abre la talanquera.
#[derive(Debug, Clone, Serialize)]
pub struct SalidaConApertura {
    pub registro: serde_json::Value,
    pub apertura: crate::hardware::ResultadoApertura,
}

#[tauri::command]
pub async fn garita_registrar_salida(state: State<'_, AppState>, registro_id: String) -> AppResult<SalidaConApertura> {
    crate::license::exigir_uso(&state)?;
    let (jwt, lic) = crate::auth::credenciales(&state).await?;
    let base = state.api_url();
    let registro = state
        .api
        .put(
            &base,
            &format!("/accesos/{}/salida", registro_id.trim()),
            &json!({}),
            &crate::api::Credenciales { jwt: Some(&jwt), licencia: Some(&lic) },
        )
        .await?;
    let apertura = crate::hardware_cmd::abrir_en_segundo_plano(&state).await;
    Ok(SalidaConApertura { registro, apertura })
}

/// Acceso recién encolado + qué pasó con la talanquera. Van juntos pero son
/// independientes: el acceso ya está guardado aunque `apertura` haya fallado.
#[derive(Debug, Clone, Serialize)]
pub struct RegistroConApertura {
    pub acceso: AccesoPendiente,
    pub apertura: crate::hardware::ResultadoApertura,
}

/// Registra el acceso en la cola local, dispara un intento de sincronización
/// inmediato en segundo plano (no se espera: la garita no debe bloquearse
/// por la red) y, con el acceso YA guardado, manda abrir la talanquera.
///
/// El orden importa: si el relé falla, el registro no se revierte; se
/// devuelve el fallo en `apertura` para que el agente abra a mano.
#[tauri::command]
pub async fn garita_registrar_acceso(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    acceso: NuevoAcceso,
) -> AppResult<RegistroConApertura> {
    crate::license::exigir_uso(&state)?;
    let agente_id = state
        .sesion
        .read()
        .unwrap()
        .as_ref()
        .map(|s| s.usuario.id.clone())
        .ok_or_else(|| AppError::new("sin_sesion", "Inicia sesión para registrar accesos"))?;
    let id = con_db(&state, |c| encolar_acceso(c, &agente_id, &acceso))?;
    let fila = con_db(&state, |c| {
        listar_recientes(c, 50)?
            .into_iter()
            .find(|a| a.id_cliente == id)
            .ok_or_else(|| AppError::interno("no se encontró el acceso recién encolado"))
    })?;
    crate::sync::disparar_push(app);
    let apertura = crate::hardware_cmd::abrir_en_segundo_plano(&state).await;
    Ok(RegistroConApertura { acceso: fila, apertura })
}

#[tauri::command]
pub fn garita_accesos_recientes(state: State<'_, AppState>, limite: Option<usize>) -> AppResult<Vec<AccesoPendiente>> {
    con_db(&state, |c| listar_recientes(c, limite.unwrap_or(30)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        db::aplicar_esquema(&c).unwrap();
        c.execute_batch(
            "INSERT INTO residentes_local VALUES ('r1','A-12','Ana López','al_dia',NULL);
             INSERT INTO residentes_local VALUES ('r2','B-3','Beto Ruiz','mora','5555');
             INSERT INTO blacklist_local (id, numero_dpi, visitante_nombre, razon, fecha_fin, residente_id) VALUES ('b1','1111111111111','Malo','Robo','2099-01-01T00:00:00Z',NULL);
             INSERT INTO blacklist_local (id, numero_dpi, visitante_nombre, razon, fecha_fin, residente_id) VALUES ('b2','2222222222222','Vencido','Viejo','2020-01-01T00:00:00Z',NULL);
             INSERT INTO blacklist_local (id, numero_dpi, visitante_nombre, razon, fecha_fin, residente_id) VALUES ('b3','3333333333333','SoloAna','No lo quiere',NULL,'r1');
             INSERT INTO blacklist_local (id, numero_dpi, visitante_nombre, razon, fecha_fin, residente_id, placa) VALUES ('b4','',NULL,'Vehículo robado',NULL,NULL,'P999XYZ');
             INSERT INTO blacklist_local (id, numero_dpi, visitante_nombre, razon, fecha_fin, residente_id, placa) VALUES ('b5','',NULL,'Placa vencida','2020-01-01T00:00:00Z',NULL,'P111AAA');
             INSERT INTO preautorizaciones_local VALUES ('p1','r1','Primo Pérez','4444444444444',NULL,'2026-09-01','2026-09-30');
             INSERT INTO preautorizaciones_local VALUES ('p2','r2','Taxi','','P123ABC','2026-09-01','2026-09-30');",
        )
        .unwrap();
        c
    }
    const HOY: &str = "2026-09-19";
    const AHORA: &str = "2026-09-19T12:00:00Z";

    #[test]
    fn busca_residentes_por_casa_o_nombre() {
        let c = db();
        assert_eq!(buscar_residentes(&c, "a-12", 10).unwrap()[0].id, "r1");
        assert_eq!(buscar_residentes(&c, "beto", 10).unwrap()[0].id, "r2");
        assert!(buscar_residentes(&c, "zzz", 10).unwrap().is_empty());
    }

    #[test]
    fn blacklist_de_sucursal_bloquea_y_la_vencida_no() {
        let c = db();
        let e = evaluar_visitante(&c, "1111111111111", None, Some("r2"), HOY, AHORA).unwrap();
        assert!(e.bloqueado);
        assert_eq!(e.razon_bloqueo.as_deref(), Some("Robo"));
        assert!(!evaluar_visitante(&c, "2222222222222", None, None, HOY, AHORA).unwrap().bloqueado);
    }

    #[test]
    fn la_preautorizacion_por_placa_coincide_con_cualquier_formato_tecleado() {
        let c = db();
        for p in ["P123ABC", "p-123abc", " p 123 abc "] {
            assert!(evaluar_visitante(&c, "9", Some(p), Some("r2"), HOY, AHORA).unwrap().preautorizado, "{p:?}");
        }
        assert!(!evaluar_visitante(&c, "9", Some("P124ABC"), Some("r2"), HOY, AHORA).unwrap().preautorizado);
    }

    #[test]
    fn el_acceso_encolado_lleva_la_placa_canonica() {
        let c = db();
        let id = encolar_acceso(&c, "agente-1", &NuevoAcceso {
            nombre_visitante: "Conductor".into(), numero_dpi: "8800000000001".into(), residente_id: "r1".into(),
            placa: Some(" p-321 qwe ".into()), notas: None, capturado_manualmente: false, invitacion_qr_id: None, origen_dpi: None
        }).unwrap();
        let (payload, columna): (String, String) = c
            .query_row("SELECT payload, placa FROM accesos_pendientes WHERE id_cliente = ?1", [&id], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        let json: serde_json::Value = serde_json::from_str(&payload).unwrap();
        assert_eq!(json["placa"], "P321QWE");
        assert_eq!(columna, "P321QWE");
    }

    #[test]
    fn blacklist_por_placa_bloquea_con_cualquier_formato_y_sin_visitante() {
        let c = db();
        for p in ["P999XYZ", "p-999 xyz", "P-999XYZ"] {
            let e = evaluar_visitante(&c, "7777777777777", Some(p), Some("r1"), HOY, AHORA).unwrap();
            assert!(e.bloqueado, "{p:?} debe bloquear");
            assert_eq!(e.razon_bloqueo.as_deref(), Some("Vehículo robado"));
            assert_eq!(e.motivo_bloqueo.as_deref(), Some("placa"));
        }
        // Otra placa, placa vencida y sin placa no bloquean.
        assert!(!evaluar_visitante(&c, "7777777777777", Some("P000AAA"), Some("r1"), HOY, AHORA).unwrap().bloqueado);
        assert!(!evaluar_visitante(&c, "7777777777777", Some("P111AAA"), Some("r1"), HOY, AHORA).unwrap().bloqueado);
        assert!(!evaluar_visitante(&c, "7777777777777", None, Some("r1"), HOY, AHORA).unwrap().bloqueado);
        assert!(!evaluar_visitante(&c, "7777777777777", Some("  "), Some("r1"), HOY, AHORA).unwrap().bloqueado);
    }

    #[test]
    fn un_dpi_vacio_nunca_coincide_con_un_bloqueo_solo_de_vehiculo() {
        // Los bloqueos por placa se guardan con numero_dpi = '': mientras el agente aún no
        // escribe el DPI, la evaluación no puede dar un falso positivo contra esas filas.
        let c = db();
        let e = evaluar_visitante(&c, "", None, Some("r1"), HOY, AHORA).unwrap();
        assert!(!e.bloqueado);
        assert!(!evaluar_visitante(&c, "   ", Some("P000AAA"), None, HOY, AHORA).unwrap().bloqueado);
    }

    #[test]
    fn el_dpi_tiene_prioridad_y_el_motivo_dice_cual_coincidio() {
        let c = db();
        let por_dpi = evaluar_visitante(&c, "1111111111111", Some("P999XYZ"), Some("r2"), HOY, AHORA).unwrap();
        assert_eq!(por_dpi.motivo_bloqueo.as_deref(), Some("dpi"));
        assert_eq!(por_dpi.razon_bloqueo.as_deref(), Some("Robo"));
    }

    #[test]
    fn no_se_encola_un_acceso_con_placa_bloqueada() {
        let c = db();
        let err = encolar_acceso(&c, "agente-1", &NuevoAcceso {
            nombre_visitante: "Conductor".into(), numero_dpi: "8888888888888".into(), residente_id: "r1".into(),
            placa: Some("p-999xyz".into()), notas: None, capturado_manualmente: false, invitacion_qr_id: None, origen_dpi: None
        }).unwrap_err();
        assert_eq!(err.codigo, "blacklist");
        assert!(err.mensaje.starts_with("Vehículo en lista negra"), "{}", err.mensaje);
        let n: i64 = c.query_row("SELECT count(*) FROM accesos_pendientes", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0, "nada se encola");
    }

    /// «Dar salida» desde la lista de recientes necesita el id del registro en el servidor,
    /// que solo existe una vez sincronizado el acceso.
    #[test]
    fn los_recientes_exponen_el_registro_id_solo_cuando_ya_se_sincronizo() {
        let c = db();
        let nuevo = |dpi: &str| NuevoAcceso {
            nombre_visitante: "Visita".into(), numero_dpi: dpi.into(), residente_id: "r1".into(),
            placa: None, notas: None, capturado_manualmente: false, invitacion_qr_id: None, origen_dpi: None
        };
        let a = encolar_acceso(&c, "agente-1", &nuevo("5000000000001")).unwrap();
        let _b = encolar_acceso(&c, "agente-1", &nuevo("5000000000002")).unwrap();
        c.execute(
            "UPDATE accesos_pendientes SET estado = 'sincronizado', registro_id = 'reg-srv-1' WHERE id_cliente = ?1",
            [&a],
        ).unwrap();

        let lista = listar_recientes(&c, 10).unwrap();
        let sincronizado = lista.iter().find(|x| x.id_cliente == a).unwrap();
        assert_eq!(sincronizado.registro_id.as_deref(), Some("reg-srv-1"));
        assert_eq!(lista.iter().filter(|x| x.registro_id.is_none()).count(), 1, "el pendiente no tiene registro_id");
        let json = serde_json::to_value(sincronizado).unwrap();
        assert_eq!(json["registro_id"], "reg-srv-1", "viaja al frontend con ese nombre");
    }

    #[test]
    fn blacklist_de_residente_solo_aplica_a_ese_residente() {
        let c = db();
        assert!(evaluar_visitante(&c, "3333333333333", None, Some("r1"), HOY, AHORA).unwrap().bloqueado);
        assert!(!evaluar_visitante(&c, "3333333333333", None, Some("r2"), HOY, AHORA).unwrap().bloqueado);
    }

    #[test]
    fn preautorizacion_por_dpi_o_placa_vigente_hoy() {
        let c = db();
        let e = evaluar_visitante(&c, "4444444444444", None, Some("r1"), HOY, AHORA).unwrap();
        assert!(e.preautorizado);
        assert_eq!(e.visitante_conocido.as_deref(), Some("Primo Pérez"));
        assert!(evaluar_visitante(&c, "9", Some("p123abc"), Some("r2"), HOY, AHORA).unwrap().preautorizado);
        assert!(!evaluar_visitante(&c, "4444444444444", None, Some("r1"), "2026-10-01", AHORA).unwrap().preautorizado);
    }

    /// Un acceso que entró con QR debe llevar el id hasta el backend: es lo
    /// que descuenta el uso de la invitación y la bloquea tras fallos.
    #[test]
    fn encolar_conserva_la_invitacion_qr_en_el_payload() {
        let c = db();
        let id = encolar_acceso(
            &c,
            "agente-1",
            &NuevoAcceso {
                nombre_visitante: "Ana".into(),
                numero_dpi: "5555555555555".into(),
                residente_id: "r1".into(),
                placa: None,
                notas: None,
                capturado_manualmente: false,
                invitacion_qr_id: Some("  inv-9  ".into()), origen_dpi: None
            },
        )
        .unwrap();
        let payload: serde_json::Value =
            c.query_row("SELECT payload FROM accesos_pendientes WHERE id_cliente = ?1", [&id], |r| r.get::<_, String>(0))
                .map(|s| serde_json::from_str(&s).unwrap())
                .unwrap();
        assert_eq!(payload["invitacion_qr_id"], "inv-9");

        // Una cadena vacía no es una invitación: viaja como nulo.
        let id2 = encolar_acceso(
            &c,
            "agente-1",
            &NuevoAcceso {
                nombre_visitante: "Beto".into(),
                numero_dpi: "5555555555556".into(),
                residente_id: "r1".into(),
                placa: None,
                notas: None,
                capturado_manualmente: true,
                invitacion_qr_id: Some("   ".into()), origen_dpi: None
            },
        )
        .unwrap();
        let p2: serde_json::Value =
            c.query_row("SELECT payload FROM accesos_pendientes WHERE id_cliente = ?1", [&id2], |r| r.get::<_, String>(0))
                .map(|s| serde_json::from_str(&s).unwrap())
                .unwrap();
        assert!(p2["invitacion_qr_id"].is_null());
    }

    #[test]
    fn encolar_escribe_pendiente_con_payload_completo_y_rechaza_blacklist() {
        let c = db();
        let id = encolar_acceso(
            &c,
            "agente-1",
            &NuevoAcceso {
                nombre_visitante: " Juan ".into(),
                numero_dpi: "5555555555555".into(),
                residente_id: "r1".into(),
                placa: Some("p 123abc".into()),
                notas: None,
                capturado_manualmente: true,
                invitacion_qr_id: None, origen_dpi: None
            },
        )
        .unwrap();
        let fila = &listar_recientes(&c, 10).unwrap()[0];
        assert_eq!(fila.id_cliente, id);
        assert_eq!(fila.estado, "pendiente");
        assert_eq!(fila.residente_casa.as_deref(), Some("A-12"));
        assert!(fila.capturado_manualmente);
        let payload: serde_json::Value =
            c.query_row("SELECT payload FROM accesos_pendientes WHERE id_cliente = ?1", [&id], |r| r.get::<_, String>(0))
                .map(|s| serde_json::from_str(&s).unwrap())
                .unwrap();
        assert_eq!(payload["id_cliente"], id);
        assert_eq!(payload["agente_id"], "agente-1");
        assert_eq!(payload["nombre_visitante"], "Juan");
        assert_eq!(payload["placa"], "P123ABC", "la placa viaja en su forma canónica (sin espacios ni guiones)");
        assert_eq!(payload["capturado_manualmente"], true);
        assert!(payload["registrado_en"].as_str().unwrap().contains('T'));
        // Sin QR el campo viaja nulo, no ausente: el backend distingue.
        assert!(payload["invitacion_qr_id"].is_null());

        let err = encolar_acceso(
            &c,
            "agente-1",
            &NuevoAcceso {
                nombre_visitante: "X".into(),
                numero_dpi: "1111111111111".into(),
                residente_id: "r1".into(),
                placa: None,
                notas: None,
                capturado_manualmente: false,
                invitacion_qr_id: None, origen_dpi: None
            },
        )
        .unwrap_err();
        assert_eq!(err.codigo, "blacklist");
    }

    // ── Invitaciones QR sin red (SCRUM-126) ─────────────────────────────────────────────────────

    const QR: &str = "3f2a9c10-aaaa-4bbb-8ccc-0123456789ab";
    /// Instante de la última copia: lo que se sincronizó antes ya viene contado por el servidor.
    const COPIA: &str = "2026-09-19T10:00:00+00:00";

    /// Base con una invitación en el espejo. `extra` ajusta columnas: ("activo", "0"), ("usos_maximos", "1")…
    fn db_con_qr(extra: &[(&str, &str)]) -> Connection {
        let c = db();
        c.execute(
            "INSERT INTO invitaciones_qr_local
               (id, tipo, etiqueta, nombre_visitante, numero_dpi, placa, residente_id, numero_casa, residente_nombre,
                fecha_inicio, fecha_fin, usos_maximos, usos_actuales, activo, bloqueado_hasta)
             VALUES (?1, 'individual', 'Cumpleaños', 'Marta', '2999111220101', 'P123ABC', 'r1', 'A-12', 'Ana López',
                     '2026-09-18', '2026-09-20', 3, 1, 1, NULL)",
            [QR],
        )
        .unwrap();
        for (col, valor) in extra {
            c.execute(&format!("UPDATE invitaciones_qr_local SET {col} = {valor} WHERE id = ?1"), [QR]).unwrap();
        }
        db::meta_escribir(&c, "qr_snapshot_desde", COPIA).unwrap();
        c
    }

    fn rechazo(c: &Connection) -> String {
        validar_qr_local(c, QR, HOY, AHORA).unwrap_err().codigo
    }

    /// Una fila de la cola con la invitación, en el estado dado.
    fn cola(c: &Connection, id: &str, qr: Option<&str>, estado: &str, sincronizado_en: Option<&str>) {
        c.execute(
            "INSERT INTO accesos_pendientes (id_cliente, payload, registrado_en, estado, sincronizado_en, nombre_visitante, numero_dpi, invitacion_qr_id)
             VALUES (?1, '{}', '2026-09-19T11:00:00Z', ?2, ?3, 'V', '1', ?4)",
            params![id, estado, sincronizado_en, qr],
        )
        .unwrap();
    }

    #[test]
    fn un_qr_vigente_se_acepta_sin_red_con_los_mismos_datos_que_el_servidor() {
        let c = db_con_qr(&[]);
        let v = validar_qr_local(&c, QR, HOY, AHORA).unwrap();
        assert_eq!(v["id"], QR);
        assert_eq!(v["tipo"], "individual");
        assert_eq!(v["numero_casa"], "A-12");
        assert_eq!(v["residente_nombre"], "Ana López");
        assert_eq!(v["residente_id"], "r1");
        assert_eq!(v["numero_dpi"], "2999111220101");
        assert_eq!(v["placa"], "P123ABC");
        assert_eq!(v["usos_maximos"], 3);
        assert_eq!(v["usos_actuales"], 1);
        assert_eq!(v["validada_sin_conexion"], true);
    }

    #[test]
    fn el_id_del_qr_se_encuentra_aunque_llegue_en_mayusculas_o_con_espacios() {
        let c = db_con_qr(&[]);
        for id in ["3F2A9C10-AAAA-4BBB-8CCC-0123456789AB", "  3f2a9c10-aaaa-4bbb-8ccc-0123456789ab  "] {
            assert!(validar_qr_local(&c, id, HOY, AHORA).is_ok(), "{id:?}");
        }
    }

    #[test]
    fn un_qr_que_la_copia_no_conoce_se_rechaza_con_una_salida_clara() {
        let c = db_con_qr(&[]);
        let e = validar_qr_local(&c, "00000000-0000-4000-8000-000000000000", HOY, AHORA).unwrap_err();
        assert_eq!(e.codigo, "qr_desconocida");
        assert!(e.mensaje.contains("DPI"), "{}", e.mensaje);
    }

    #[test]
    fn un_qr_revocado_se_rechaza() {
        assert_eq!(rechazo(&db_con_qr(&[("activo", "0")])), "qr_revocada");
    }

    #[test]
    fn un_qr_vencido_o_que_aun_no_empieza_se_rechaza_y_el_primer_y_ultimo_dia_cuentan() {
        assert_eq!(rechazo(&db_con_qr(&[("fecha_fin", "'2026-09-18'")])), "qr_vencida");          // venció ayer
        assert_eq!(rechazo(&db_con_qr(&[("fecha_inicio", "'2026-09-20'")])), "qr_futura");        // empieza mañana
        assert!(validar_qr_local(&db_con_qr(&[("fecha_fin", "'2026-09-19'")]), QR, HOY, AHORA).is_ok(), "el último día aún vale");
        assert!(validar_qr_local(&db_con_qr(&[("fecha_inicio", "'2026-09-19'")]), QR, HOY, AHORA).is_ok(), "el primer día ya vale");
        assert!(validar_qr_local(&db_con_qr(&[("fecha_fin", "NULL")]), QR, HOY, AHORA).is_ok(), "sin fecha de fin no vence");
    }

    #[test]
    fn un_qr_agotado_se_rechaza_y_uno_sin_tope_nunca_se_agota() {
        assert_eq!(rechazo(&db_con_qr(&[("usos_maximos", "1")])), "qr_agotada");                  // 1 de 1 (ya tenía 1 uso)
        assert_eq!(rechazo(&db_con_qr(&[("usos_maximos", "3"), ("usos_actuales", "3")])), "qr_agotada");
        assert!(validar_qr_local(&db_con_qr(&[("usos_maximos", "3"), ("usos_actuales", "2")]), QR, HOY, AHORA).is_ok());
        assert!(validar_qr_local(&db_con_qr(&[("usos_maximos", "NULL"), ("usos_actuales", "500")]), QR, HOY, AHORA).is_ok());
    }

    #[test]
    fn el_bloqueo_temporal_por_intentos_fallidos_se_respeta_hasta_que_vence() {
        assert_eq!(rechazo(&db_con_qr(&[("bloqueado_hasta", "'2026-09-19T12:30:00.000Z'")])), "qr_bloqueada");
        assert!(validar_qr_local(&db_con_qr(&[("bloqueado_hasta", "'2026-09-19T11:30:00.000Z'")]), QR, HOY, AHORA).is_ok(), "ya venció");
        assert!(validar_qr_local(&db_con_qr(&[("bloqueado_hasta", "'no es una fecha'")]), QR, HOY, AHORA).is_ok(), "un valor ilegible no bloquea");
    }

    #[test]
    fn el_orden_de_los_motivos_es_el_del_servidor() {
        // Revocada + vencida + agotada a la vez: el servidor dice «revocada» primero.
        let c = db_con_qr(&[("activo", "0"), ("fecha_fin", "'2026-09-01'"), ("usos_maximos", "1")]);
        assert_eq!(rechazo(&c), "qr_revocada");
        let c = db_con_qr(&[("fecha_fin", "'2026-09-01'"), ("usos_maximos", "1")]);
        assert_eq!(rechazo(&c), "qr_vencida");
    }

    #[test]
    fn el_mensaje_de_un_rechazo_sin_red_lo_dice_y_conserva_el_texto_del_servidor() {
        let e = validar_qr_local(&db_con_qr(&[("activo", "0")]), QR, HOY, AHORA).unwrap_err();
        assert!(e.mensaje.starts_with("Invitación QR revocada"), "{}", e.mensaje);
        assert!(e.mensaje.contains("sin conexión"), "{}", e.mensaje);
    }

    #[test]
    fn los_usos_de_este_equipo_que_el_servidor_aun_no_cuenta_se_suman() {
        // 1 de 2 en la copia; dos usos de este equipo siguen en la cola → 3 > 2: agotada.
        let c = db_con_qr(&[("usos_maximos", "2")]);
        assert!(validar_qr_local(&c, QR, HOY, AHORA).is_ok());
        cola(&c, "a", Some(QR), "pendiente", None);
        assert_eq!(rechazo(&c), "qr_agotada", "1 de la copia + 1 en cola = 2 de 2");
        assert_eq!(usos_locales(&c, QR).unwrap(), 1);

        // La pantalla ve el total: copia + cola.
        let c = db_con_qr(&[("usos_maximos", "5")]);
        cola(&c, "a", Some(QR), "pendiente", None);
        cola(&c, "b", Some(QR), "pendiente", None);
        assert_eq!(validar_qr_local(&c, QR, HOY, AHORA).unwrap()["usos_actuales"], 3);
    }

    #[test]
    fn solo_cuentan_los_pendientes_y_los_subidos_despues_de_la_copia() {
        let c = db_con_qr(&[("usos_maximos", "10")]);
        cola(&c, "pendiente", Some(QR), "pendiente", None);
        cola(&c, "rechazado", Some(QR), "rechazado", None);                                      // el servidor no lo descontó
        cola(&c, "antes", Some(QR), "sincronizado", Some("2026-09-19T09:00:00+00:00"));          // ya viene en la copia
        cola(&c, "despues", Some(QR), "sincronizado", Some("2026-09-19T10:30:00+00:00"));        // subió tras pedir la copia
        cola(&c, "otro-qr", Some("11111111-2222-4333-8444-555555555555"), "pendiente", None);
        cola(&c, "sin-qr", None, "pendiente", None);
        assert_eq!(usos_locales(&c, QR).unwrap(), 2, "el pendiente y el subido después de la copia");
    }

    #[test]
    fn encolar_guarda_el_origen_del_dpi_y_deduce_manual_si_no_viene() {
        let c = db_con_qr(&[]);
        let encolar = |origen: Option<&str>, manual: bool| {
            let id = encolar_acceso(&c, "agente-1", &NuevoAcceso {
                nombre_visitante: "Marta".into(), numero_dpi: "2999111220101".into(), residente_id: "r1".into(), placa: None, notas: None,
                capturado_manualmente: manual, invitacion_qr_id: None, origen_dpi: origen.map(String::from),
            }).unwrap();
            let (col, payload): (Option<String>, String) = c
                .query_row("SELECT origen_dpi, payload FROM accesos_pendientes WHERE id_cliente = ?1", [&id], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap();
            let p: serde_json::Value = serde_json::from_str(&payload).unwrap();
            assert_eq!(p["origen_dpi"].as_str(), col.as_deref(), "la columna y el payload dicen lo mismo");
            col
        };
        assert_eq!(encolar(Some("local"), false).as_deref(), Some("local"));
        assert_eq!(encolar(Some("remoto"), false).as_deref(), Some("remoto"));
        assert_eq!(encolar(Some("manual"), true).as_deref(), Some("manual"));
        assert_eq!(encolar(None, true).as_deref(), Some("manual"), "tecleado sin origen informado = manual");
        assert_eq!(encolar(None, false), None);
        assert_eq!(encolar(Some("otra cosa"), false), None, "un valor desconocido se descarta");
    }

    #[test]
    fn encolar_guarda_la_invitacion_en_su_columna_y_en_el_payload_en_minusculas() {
        let c = db_con_qr(&[("usos_maximos", "5")]);
        let id = encolar_acceso(&c, "agente-1", &NuevoAcceso {
            nombre_visitante: "Marta".into(), numero_dpi: "2999111220101".into(), residente_id: "r1".into(), placa: None, notas: None,
            capturado_manualmente: false, invitacion_qr_id: Some(format!("  {}  ", QR.to_uppercase())), origen_dpi: None,
        }).unwrap();
        let (payload, columna): (String, Option<String>) = c
            .query_row("SELECT payload, invitacion_qr_id FROM accesos_pendientes WHERE id_cliente = ?1", [&id], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(columna.as_deref(), Some(QR));
        assert_eq!(serde_json::from_str::<serde_json::Value>(&payload).unwrap()["invitacion_qr_id"], QR);
        assert_eq!(usos_locales(&c, QR).unwrap(), 1, "el uso queda contado de inmediato");
    }

    #[test]
    fn una_invitacion_de_un_solo_uso_no_se_encola_dos_veces_en_el_mismo_equipo() {
        let c = db_con_qr(&[("usos_maximos", "2")]);                                              // 1 de 2 en la copia
        let acceso = |dpi: &str| NuevoAcceso {
            nombre_visitante: "Marta".into(), numero_dpi: dpi.into(), residente_id: "r1".into(), placa: None, notas: None,
            capturado_manualmente: false, invitacion_qr_id: Some(QR.into()), origen_dpi: None
        };
        encolar_acceso(&c, "agente-1", &acceso("2999111220101")).expect("el último uso disponible se encola");
        let e = encolar_acceso(&c, "agente-1", &acceso("2999111220102")).unwrap_err();
        assert_eq!(e.codigo, "qr_agotada");
        let en_cola: i64 = c.query_row("SELECT count(*) FROM accesos_pendientes", [], |r| r.get(0)).unwrap();
        assert_eq!(en_cola, 1, "el segundo no quedó en la cola");
    }

    #[test]
    fn una_invitacion_que_la_copia_no_conoce_no_frena_el_registro_porque_decide_el_servidor() {
        let c = db();
        encolar_acceso(&c, "agente-1", &NuevoAcceso {
            nombre_visitante: "Marta".into(), numero_dpi: "2999111220101".into(), residente_id: "r1".into(), placa: None, notas: None,
            capturado_manualmente: false, invitacion_qr_id: Some("99999999-0000-4000-8000-000000000000".into()), origen_dpi: None
        }).expect("se encola y el servidor decide al sincronizar");
    }

    #[test]
    fn sin_servidor_es_sin_red_o_un_5xx_y_nunca_una_decision_del_servidor() {
        assert!(sin_servidor(&AppError::sin_conexion("sin red")));
        assert!(sin_servidor(&AppError::http(502, "servidor", "Bad Gateway")));
        assert!(sin_servidor(&AppError::http(503, "servidor", "x")));
        assert!(!sin_servidor(&AppError::http(404, "no_encontrado", "Invitación QR no encontrada")));
        assert!(!sin_servidor(&AppError::http(409, "conflicto", "Invitación QR vencida")));
        assert!(!sin_servidor(&AppError::http(403, "prohibido", "Esta invitación pertenece a otra sucursal")));
        assert!(!sin_servidor(&AppError::new("sesion_vencida", "x")));
    }
}
