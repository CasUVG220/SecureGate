//! Comandos Tauri de la capa de hardware y su persistencia en la BD local.
//!
//! Separado de `hardware/` a propósito: los adaptadores no saben nada de
//! Tauri ni de SQLite (así se prueban solos); aquí vive el pegamento.

use std::sync::Arc;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::hardware::{self, ConfigHardware, EstadoHardware, ResultadoApertura, TalanqueraDriver};
use crate::{garita, AppState};

/// Lee la configuración guardada en `config_hardware` (o `Ninguno`).
pub fn leer_config(conn: &rusqlite::Connection) -> AppResult<ConfigHardware> {
    let json: Option<String> = conn
        .query_row("SELECT config FROM config_hardware WHERE id = 1", [], |r| r.get(0))
        .ok();
    Ok(match json {
        Some(j) => serde_json::from_str(&j).unwrap_or_else(|e| {
            log::warn!("config_hardware ilegible ({e}); se ignora");
            ConfigHardware::Ninguno
        }),
        None => ConfigHardware::Ninguno,
    })
}

pub fn guardar_config(conn: &rusqlite::Connection, cfg: &ConfigHardware) -> AppResult<()> {
    conn.execute(
        "INSERT INTO config_hardware (id, config, actualizado_en) VALUES (1, ?1, ?2)
         ON CONFLICT(id) DO UPDATE SET config = excluded.config, actualizado_en = excluded.actualizado_en",
        rusqlite::params![serde_json::to_string(cfg)?, chrono::Utc::now().to_rfc3339()],
    )?;
    Ok(())
}

/// Construye el driver de la config y lo deja activo en el estado.
pub fn activar(state: &AppState, cfg: &ConfigHardware) -> AppResult<()> {
    let driver = hardware::crear_driver(cfg).map_err(AppError::from)?;
    *state.hardware.write().unwrap() = Arc::from(driver);
    log::info!("talanquera: driver activo → {cfg}");
    Ok(())
}

/// Al abrir la BD: carga lo que el equipo tenía configurado.
pub fn cargar_desde_db(state: &AppState) {
    let cfg = match garita::con_db(state, leer_config) {
        Ok(c) => c,
        Err(e) => {
            log::warn!("talanquera: no se pudo leer config_hardware: {}", e.mensaje);
            return;
        }
    };
    if let Err(e) = activar(state, &cfg) {
        log::warn!("talanquera: config guardada inválida ({}); sin driver", e.mensaje);
    }
}

pub fn driver(state: &AppState) -> Arc<dyn TalanqueraDriver> {
    state.hardware.read().unwrap().clone()
}

pub fn estado(state: &AppState) -> EstadoHardware {
    let d = driver(state);
    let config = garita::con_db(state, leer_config).unwrap_or(ConfigHardware::Ninguno);
    EstadoHardware { nombre: d.nombre().to_string(), estado: d.estado(), config }
}

/// Apertura en un hilo aparte: `abrir()` puede tardar hasta ~4 s si un relé
/// de red no responde y la garita no debe congelarse mientras tanto.
pub async fn abrir_en_segundo_plano(state: &AppState) -> ResultadoApertura {
    let d = driver(state);
    let d2 = d.clone();
    let r = tauri::async_runtime::spawn_blocking(move || d2.abrir())
        .await
        .unwrap_or_else(|e| Err(hardware::TalanqueraError::Envio(format!("hilo de apertura: {e}"))));
    if let Err(e) = &r {
        log::warn!("talanquera: apertura fallida ({}): {e}", d.nombre());
    }
    ResultadoApertura::desde(d.as_ref(), r)
}

// ── Comandos ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn hardware_estado(state: State<'_, AppState>) -> EstadoHardware {
    estado(&state)
}

#[tauri::command]
pub fn hardware_puertos() -> Vec<hardware::serial::PuertoSerial> {
    hardware::serial::listar_puertos()
}

/// Guarda y activa. Si la config no construye un driver válido no se guarda:
/// el agente ve el error en el diálogo y el driver anterior sigue activo.
#[tauri::command]
pub fn hardware_config_set(state: State<'_, AppState>, config: ConfigHardware) -> AppResult<EstadoHardware> {
    let agente = crate::auth::exigir_sesion(&state)?;
    hardware::crear_driver(&config).map_err(AppError::from)?;
    log::info!("talanquera: {} cambió la configuración → {config}", agente.email);
    garita::con_db(&state, |c| guardar_config(c, &config))?;
    activar(&state, &config)?;
    Ok(estado(&state))
}

/// Pulso de prueba desde la configuración, sin acceso de por medio.
#[tauri::command]
pub async fn hardware_probar(state: State<'_, AppState>, config: Option<ConfigHardware>) -> AppResult<ResultadoApertura> {
    let agente = crate::auth::exigir_sesion(&state)?;
    log::info!("talanquera: {} lanzó un pulso de prueba", agente.email);
    match config {
        // Probar una config que aún no se guardó: driver temporal.
        Some(cfg) => {
            let d: Arc<dyn TalanqueraDriver> = Arc::from(hardware::crear_driver(&cfg).map_err(AppError::from)?);
            let d2 = d.clone();
            let r = tauri::async_runtime::spawn_blocking(move || d2.abrir())
                .await
                .unwrap_or_else(|e| Err(hardware::TalanqueraError::Envio(format!("hilo de apertura: {e}"))));
            Ok(ResultadoApertura::desde(d.as_ref(), r))
        }
        None => Ok(abrir_en_segundo_plano(&state).await),
    }
}

/// Botón manual "Abrir talanquera": no registra nada, sólo abre.
#[tauri::command]
pub async fn hardware_abrir(state: State<'_, AppState>) -> AppResult<ResultadoApertura> {
    crate::license::exigir_uso(&state)?;
    // Sin sesión de agente no se abre a mano, y cada apertura queda en el log
    // con quién la pidió (antes cualquier JS en el WebView podía abrir la
    // talanquera sin dejar rastro de quién).
    let agente = crate::auth::exigir_sesion(&state)?;
    log::info!("talanquera: apertura MANUAL pedida por {} ({})", agente.email, agente.id);
    Ok(abrir_en_segundo_plano(&state).await)
}

impl From<hardware::TalanqueraError> for AppError {
    fn from(e: hardware::TalanqueraError) -> Self {
        let codigo = match e {
            hardware::TalanqueraError::SinDriver => "hardware_sin_driver",
            hardware::TalanqueraError::NoDisponible(_) => "hardware_no_disponible",
            hardware::TalanqueraError::Timeout(_) => "hardware_timeout",
            hardware::TalanqueraError::Envio(_) => "hardware_envio",
            hardware::TalanqueraError::Config(_) => "hardware_config",
            hardware::TalanqueraError::NoSoportado(_) => "hardware_no_soportado",
        };
        AppError::new(codigo, e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hardware::tcp::{ConfigTcp, ModoTcp};

    fn db() -> rusqlite::Connection {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::aplicar_esquema(&c).unwrap();
        c
    }

    #[test]
    fn sin_fila_la_config_es_ninguno() {
        assert_eq!(leer_config(&db()).unwrap(), ConfigHardware::Ninguno);
    }

    #[test]
    fn guardar_sobreescribe_la_unica_fila_y_se_relee_igual() {
        let c = db();
        let a = ConfigHardware::Ethernet(ConfigTcp { host: "10.0.0.5".into(), puerto: 80, modo: ModoTcp::Http, ruta: "/on".into(), ..Default::default() });
        guardar_config(&c, &a).unwrap();
        assert_eq!(leer_config(&c).unwrap(), a);
        let b = ConfigHardware::Ninguno;
        guardar_config(&c, &b).unwrap();
        assert_eq!(leer_config(&c).unwrap(), b);
        let filas: i64 = c.query_row("SELECT count(*) FROM config_hardware", [], |r| r.get(0)).unwrap();
        assert_eq!(filas, 1);
    }

    /// Lo que pide el flujo de acceso: si el relé falla, el acceso ya
    /// registrado no se toca. El driver no tiene acceso a la BD por
    /// construcción; aquí se verifica el efecto observable.
    #[test]
    fn un_fallo_de_apertura_no_corrompe_el_acceso_ya_encolado() {
        let c = db();
        c.execute("INSERT INTO residentes_local VALUES ('r1', 'A-12', 'Ana', 'al_dia', NULL)", []).unwrap();
        let id = garita::encolar_acceso(&c, "agente-1", &garita::NuevoAcceso {
            nombre_visitante: "Juan".into(), numero_dpi: "5555555555555".into(), residente_id: "r1".into(),
            placa: None, notas: None, capturado_manualmente: true, invitacion_qr_id: None, origen_dpi: None,
        }).unwrap();

        // Relé Ethernet apuntando a un puerto donde nadie escucha: falla.
        let puerto = { let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap(); l.local_addr().unwrap().port() };
        let driver = hardware::crear_driver(&ConfigHardware::Ethernet(ConfigTcp {
            host: "127.0.0.1".into(), puerto, comando: "on".into(), timeout_ms: 200, ..Default::default()
        })).unwrap();
        let r = ResultadoApertura::desde(driver.as_ref(), driver.abrir());
        assert!(!r.abierta);
        assert!(r.error.is_some());

        let (estado, intentos): (String, i64) = c
            .query_row("SELECT estado, intentos FROM accesos_pendientes WHERE id_cliente = ?1", [&id], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(estado, "pendiente");
        assert_eq!(intentos, 0);
    }

    #[test]
    fn el_driver_apagado_reporta_sin_driver_y_no_es_un_error_de_flujo() {
        let d = hardware::crear_driver(&ConfigHardware::Ninguno).unwrap();
        let r = ResultadoApertura::desde(d.as_ref(), d.abrir());
        assert!(!r.abierta);
        assert_eq!(r.error, Some(hardware::TalanqueraError::SinDriver));
        assert_eq!(r.driver, "Sin hardware");
    }

    #[test]
    fn una_fila_corrupta_no_tumba_la_app() {
        let c = db();
        c.execute("INSERT INTO config_hardware (id, config, actualizado_en) VALUES (1, '{no json', 'x')", []).unwrap();
        assert_eq!(leer_config(&c).unwrap(), ConfigHardware::Ninguno);
    }
}
