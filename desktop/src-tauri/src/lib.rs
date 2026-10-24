//! SecureGate Garita — proceso Rust de la app de escritorio.
//!
//! Módulos por dominio (ver cada uno para las decisiones de diseño):
//! - `fingerprint`   huella de hardware
//! - `secure_store`  almacén seguro del SO (Credential Manager / Keychain)
//! - `license`       activación, heartbeat, gracia offline, kill switch
//! - `auth`          sesión del agente (JWT + refresh)
//! - `db`            SQLite cifrado (SQLCipher) con clave Argon2
//! - `garita`        espejo local, evaluación de visitantes, cola de accesos
//! - `sync`          pull del espejo, push de la cola con backoff, heartbeat
//! - `ocr`           sidecar de OCR de placas (local, sin red)
//! - `camera`        permisos de cámara del WebView (WebView2 / Info.plist)
//! - `hardware`      apertura física de la talanquera (relé USB/Ethernet), por trait
//! - `anpr`          reconocimiento continuo de placas por carril (Sprint 10)
//!
//! La captura de cámara no pasa por Rust: `getUserMedia` corre en el WebView
//! y la imagen capturada llega a `ocr` ya codificada.

mod actualizador;
mod anpr;
mod api;
mod auth;
mod camaras;
mod camera;
mod config;
mod db;
mod error;
mod fingerprint;
mod garita;
pub mod hardware;
mod hardware_cmd;
mod license;
mod ocr;
mod placa;
mod secure_store;
mod sync;
#[cfg(test)]
mod integracion_tests;

use chrono::{DateTime, Utc};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, RwLock};
use tauri::{AppHandle, Manager, State};

use error::AppResult;

pub struct AppState {
    pub dir_datos: PathBuf,
    pub config: RwLock<config::Config>,
    pub fingerprint: String,
    pub api: api::Api,
    pub licencia: RwLock<Option<license::LicenciaGuardada>>,
    pub sesion: RwLock<Option<auth::Sesion>>,
    pub db: Mutex<Option<rusqlite::Connection>>,
    pub ocr: Mutex<ocr::Sidecar>,
    pub push_lock: tokio::sync::Mutex<()>,
    pub en_linea: AtomicBool,
    pub ultimo_push_ok: RwLock<Option<DateTime<Utc>>>,
    pub ultimo_error: RwLock<Option<String>>,
    /// Driver de talanquera activo. Se reconstruye al abrir la BD (lee
    /// `config_hardware`) y al guardar una configuración nueva. Sin
    /// configuración es `SinDriver`: la apertura física es opcional.
    pub hardware: RwLock<std::sync::Arc<dyn hardware::TalanqueraDriver>>,
    /// Puente de video local y cámaras IP/celular encendidas (T7).
    pub camaras: camaras::Gestor,
    /// Proceso y carriles del ANPR continuo (Sprint 10).
    pub anpr: anpr::Anpr,
}

impl AppState {
    pub fn api_url(&self) -> String {
        self.config.read().unwrap().api_url.clone()
    }
    pub fn api_http(&self) -> reqwest::Client {
        // El Api guarda su Client; para las dos llamadas que necesitan leer
        // headers (login/refresh) se reutiliza el mismo cliente.
        self.api.http_client()
    }
    pub fn marcar_conexion(&self, ok: bool) {
        self.en_linea.store(ok, Ordering::Relaxed);
        if ok {
            *self.ultimo_error.write().unwrap() = None;
        }
    }
}

/// Foto de todo lo que la UI necesita para decidir qué pantalla mostrar.
#[derive(Serialize)]
pub struct EstadoApp {
    pub licencia: license::LicenciaDto,
    pub sesion: auth::SesionDto,
    pub sync: sync::EstadoSync,
    pub ocr: ocr::EstadoOcr,
    pub hardware: hardware::EstadoHardware,
    pub api_url: String,
    pub version: &'static str,
}

#[tauri::command]
fn app_estado(state: State<'_, AppState>) -> EstadoApp {
    EstadoApp {
        licencia: license::dto(&state),
        sesion: auth::dto(&state),
        sync: sync::estado(&state),
        ocr: ocr::ocr_estado(state.clone()),
        hardware: hardware_cmd::estado(&state),
        api_url: state.api_url(),
        version: env!("CARGO_PKG_VERSION"),
    }
}

#[tauri::command]
fn app_configurar_api_url(state: State<'_, AppState>, api_url: String) -> AppResult<String> {
    let url = config::Config::normalizar_url(&api_url)?;
    // Con una licencia guardada, Rust ya manda su token (y el JWT del agente) a
    // la URL vigente. Permitir cambiarla desde el WebView dejaría que cualquier
    // JS inyectado redirigiera esas credenciales a un servidor ajeno. Para
    // cambiar de servidor hay que desvincular el equipo primero (lo que borra la
    // licencia, la sesión y la BD local).
    if url != state.api_url() && state.licencia.read().unwrap().is_some() {
        return Err(error::AppError::new(
            "config",
            "Este equipo ya tiene una licencia activada: desvincúlalo antes de cambiar el servidor",
        ));
    }
    // Se conserva el resto de la configuración del equipo (p. ej. el canal de actualizaciones).
    let cfg = config::Config { api_url: url.clone(), ..state.config.read().unwrap().clone() };
    cfg.guardar(&state.dir_datos)?;
    *state.config.write().unwrap() = cfg;
    Ok(url)
}

fn construir_estado(app: &AppHandle) -> AppState {
    let dir_datos = app.path().app_data_dir().expect("app_data_dir");
    if let Err(e) = secure_store::inicializar() {
        log::error!("almacén seguro: {}", e.mensaje);
    }
    construir_estado_en(dir_datos)
}

/// Arma el estado a partir de un directorio de datos (el almacén seguro ya
/// debe estar inicializado). Separado de Tauri para poder testearlo.
pub fn construir_estado_en(dir_datos: PathBuf) -> AppState {
    std::fs::create_dir_all(&dir_datos).ok();
    let config = config::Config::cargar(&dir_datos);
    let fingerprint = fingerprint::obtener().unwrap_or_else(|e| {
        log::error!("fingerprint: {e}");
        String::new()
    });
    let licencia = secure_store::leer_json(secure_store::CLAVE_LICENCIA).unwrap_or_else(|e| {
        log::error!("no se pudo leer la licencia guardada: {}", e.mensaje);
        None
    });
    let sesion = secure_store::leer_json(secure_store::CLAVE_SESION).unwrap_or_else(|e| {
        log::error!("no se pudo leer la sesión guardada: {}", e.mensaje);
        None
    });

    AppState {
        dir_datos,
        config: RwLock::new(config),
        fingerprint,
        api: api::Api::new(),
        licencia: RwLock::new(licencia),
        sesion: RwLock::new(sesion),
        db: Mutex::new(None),
        ocr: Mutex::new(ocr::Sidecar::default()),
        push_lock: tokio::sync::Mutex::new(()),
        en_linea: AtomicBool::new(false),
        ultimo_push_ok: RwLock::new(None),
        ultimo_error: RwLock::new(None),
        hardware: RwLock::new(std::sync::Arc::new(hardware::SinDriver)),
        camaras: camaras::Gestor::default(),
        anpr: anpr::Anpr::default(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        // T13: actualizaciones firmadas. La llave pública y el manifiesto vienen de `plugins.updater` en tauri.conf.json (ver actualizador.rs).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(if cfg!(debug_assertions) { log::LevelFilter::Debug } else { log::LevelFilter::Info })
                .level_for("hyper_util", log::LevelFilter::Warn)
                .level_for("reqwest", log::LevelFilter::Warn)
                .build(),
        )
        .setup(|app| {
            let handle = app.handle().clone();
            let state = construir_estado(&handle);
            log::info!(
                "SecureGate Garita {} — datos en {} — API {}",
                env!("CARGO_PKG_VERSION"),
                state.dir_datos.display(),
                state.api_url()
            );

            // Con licencia guardada, abrir la BD cifrada de inmediato: la
            // garita debe poder trabajar offline desde el primer segundo.
            let token = state.licencia.read().unwrap().as_ref().map(|l| l.token.clone());
            app.manage(state);
            if let Some(token) = token {
                let st = app.state::<AppState>();
                if let Err(e) = garita::preparar_db(&st, None, &token) {
                    log::error!("no se pudo abrir la BD local: {}", e.mensaje);
                }
            }

            app.manage(actualizador::Pendiente::default());
            camera::configurar(&handle);
            sync::iniciar_tareas(handle.clone());
            // Precalentar el OCR en segundo plano para que la primera captura
            // no espere la carga de modelos. Si falla, la UI cae a manual.
            tauri::async_runtime::spawn(async move {
                if let Err(e) = ocr::asegurar_arrancado(&handle).await {
                    log::warn!("OCR no disponible: {}", e.mensaje);
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                window.state::<AppState>().anpr.detener();
                window.state::<AppState>().camaras.detener_todas();
                ocr::detener(&window.state::<AppState>());
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_estado,
            app_configurar_api_url,
            license::licencia_estado,
            license::licencia_activar,
            license::licencia_heartbeat,
            license::licencia_desvincular,
            auth::sesion_estado,
            auth::sesion_login,
            auth::sesion_logout,
            garita::garita_buscar_residentes,
            garita::garita_evaluar_visitante,
            garita::garita_registrar_acceso,
            garita::garita_verificar_qr,
            garita::garita_buscar_salida,
            garita::garita_registrar_salida,
            hardware_cmd::hardware_estado,
            hardware_cmd::hardware_puertos,
            hardware_cmd::hardware_config_set,
            hardware_cmd::hardware_probar,
            hardware_cmd::hardware_abrir,
            garita::garita_accesos_recientes,
            sync::sync_estado,
            sync::sync_ahora,
            ocr::ocr_placa,
            ocr::ocr_precalentar,
            ocr::ocr_estado,
            ocr::ocr_dpi,
            camaras::camaras_listar,
            camaras::camaras_guardar,
            camaras::camaras_eliminar,
            camaras::camaras_asignar,
            camaras::camaras_probar,
            camaras::camaras_descubrir,
            camaras::camaras_puente_info,
            camaras::camaras_encender,
            camaras::camaras_apagar,
            camaras::camaras_estado,
            camaras::camara_ip_fotograma,
            anpr::anpr_estado,
            anpr::anpr_iniciar,
            anpr::anpr_detener,
            anpr::anpr_pausar,
            anpr::anpr_carriles,
            anpr::anpr_carril_guardar,
            anpr::anpr_carril_eliminar,
            anpr::anpr_eventos,
            anpr::anpr_evidencia,
            anpr::anpr_resolver,
            anpr::anpr_probar_actuador,
            actualizador::actualizacion_estado,
            actualizador::actualizacion_buscar,
            actualizador::actualizacion_instalar,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
