//! OCR de placas, 100 % local.
//!
//! Decisión: **sidecar Node** (`desktop/sidecar-ocr/`) en vez de embeber el
//! modelo en Rust.
//! - `ppu-paddle-ocr` (el motor elegido en PRODUCT.md) es un SDK de
//!   TypeScript: correrlo "dentro de Rust" significaría reimplementar el
//!   pre/post-procesado de PP-OCR (DB → polígonos → recortes → CTC decode)
//!   sobre el crate `ort`. Es trabajo de semanas y un segundo motor que
//!   mantener, cuando el backend (Node) va a usar exactamente este SDK en las
//!   fases 2 y 3. Un solo código de OCR para todo el producto.
//! - El sidecar corre ONNX Runtime **nativo** (onnxruntime-node), no WASM:
//!   ~70 ms por placa en un M3 (ver `sidecar-ocr/src/bench.js`).
//! - Coste: el instalador lleva un runtime Node (~60 MB comprimido). En una PC
//!   de garita es irrelevante.
//!
//! Protocolo: JSON por líneas en stdin/stdout (ver sidecar-ocr/src/server.js).
//! La imagen viaja en base64 por el pipe y se descarta al responder: nunca
//! toca el disco, en ninguno de los dos procesos.

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::oneshot;

use crate::error::{AppError, AppResult};
use crate::AppState;

const TIMEOUT_CARGA: Duration = Duration::from_secs(60);
const TIMEOUT_INFERENCIA: Duration = Duration::from_secs(20);

type Pendientes = Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>;

pub struct Sidecar {
    child: Option<CommandChild>,
    pendientes: Pendientes,
    contador: u64,
    /// Ms que tardó en cargar los modelos (para reportar).
    pub ms_carga: Option<u64>,
    pub error: Option<String>,
}

impl Default for Sidecar {
    fn default() -> Self {
        Self { child: None, pendientes: Arc::default(), contador: 0, ms_carga: None, error: None }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ItemOcr {
    pub texto: String,
    pub confianza: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResultadoOcr {
    pub texto: String,
    pub items: Vec<ItemOcr>,
    pub confianza: f64,
    pub ms_inferencia: u64,
    pub ms_total: u64,
    /// Ida y vuelta completa vista desde Rust (incluye el pipe).
    pub ms_roundtrip: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct EstadoOcr {
    pub disponible: bool,
    pub ms_carga: Option<u64>,
    pub error: Option<String>,
}

/// Dónde están server.js y los modelos. En desarrollo se usan directamente
/// los de `src-tauri/resources/`; empaquetada, los que Tauri copió a
/// `resource_dir()`.
fn dir_sidecar(app: &AppHandle) -> Option<PathBuf> {
    let mut candidatos = Vec::new();
    if let Ok(res) = app.path().resource_dir() {
        candidatos.push(res.join("sidecar-ocr"));
    }
    if cfg!(debug_assertions) {
        candidatos.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("sidecar-ocr"));
    }
    candidatos.into_iter().find(|d| d.join("src").join("server.js").exists() && d.join("models").exists())
}

/// Arranca el sidecar y espera el evento `listo`. Idempotente: si ya está
/// corriendo no hace nada.
pub async fn asegurar_arrancado(app: &AppHandle) -> AppResult<()> {
    let state = app.state::<AppState>();
    if state.ocr.lock().unwrap().child.is_some() {
        return Ok(());
    }
    let dir = dir_sidecar(app)
        .ok_or_else(|| AppError::new("ocr_no_disponible", "No se encontraron los recursos del OCR (sidecar-ocr). Ejecuta scripts/prepare-sidecar.mjs"))?;
    let server = dir.join("src").join("server.js");
    let models = dir.join("models");

    let (mut rx, child) = app
        .shell()
        .sidecar("node")
        .map_err(|e| AppError::new("ocr_no_disponible", format!("sidecar node: {e}")))?
        .args([server.to_string_lossy().as_ref(), "--models", models.to_string_lossy().as_ref()])
        .spawn()
        .map_err(|e| AppError::new("ocr_no_disponible", format!("no se pudo lanzar el OCR: {e}")))?;

    let pendientes: Pendientes = Arc::default();
    let (tx_listo, rx_listo) = oneshot::channel::<Result<u64, String>>();
    let mut tx_listo = Some(tx_listo);
    let pend = pendientes.clone();
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(ev) = rx.recv().await {
            match ev {
                CommandEvent::Stdout(linea) => {
                    let Ok(v) = serde_json::from_slice::<Value>(&linea) else { continue };
                    if let Some(evento) = v.get("evento").and_then(Value::as_str) {
                        if let Some(tx) = tx_listo.take() {
                            let _ = match evento {
                                "listo" => tx.send(Ok(v["ms_carga"].as_u64().unwrap_or(0))),
                                _ => tx.send(Err(v["error"].as_str().unwrap_or("error al cargar modelos").to_string())),
                            };
                        }
                        continue;
                    }
                    if let Some(id) = v.get("id").and_then(Value::as_str) {
                        if let Some(tx) = pend.lock().unwrap().remove(id) {
                            let _ = tx.send(v);
                        }
                    }
                }
                CommandEvent::Stderr(l) => log::debug!("[ocr-sidecar] {}", String::from_utf8_lossy(&l).trim_end()),
                CommandEvent::Error(e) => log::error!("[ocr-sidecar] {e}"),
                CommandEvent::Terminated(t) => {
                    log::warn!("[ocr-sidecar] terminó: {t:?}");
                    let st = app2.state::<AppState>();
                    let mut s = st.ocr.lock().unwrap();
                    s.child = None;
                    s.error = Some("el proceso de OCR se cerró".into());
                    s.pendientes.lock().unwrap().clear();
                    if let Some(tx) = tx_listo.take() {
                        let _ = tx.send(Err("el proceso de OCR terminó antes de cargar".into()));
                    }
                    break;
                }
                _ => {}
            }
        }
    });

    {
        let mut s = state.ocr.lock().unwrap();
        s.child = Some(child);
        s.pendientes = pendientes;
        s.error = None;
    }

    let fallo = |msg: String| {
        detener(&state);
        state.ocr.lock().unwrap().error = Some(msg.clone());
        Err(AppError::new("ocr_no_disponible", msg))
    };
    match tokio::time::timeout(TIMEOUT_CARGA, rx_listo).await {
        Ok(Ok(Ok(ms))) => {
            log::info!("OCR listo en {ms} ms ({})", dir.display());
            state.ocr.lock().unwrap().ms_carga = Some(ms);
            Ok(())
        }
        Ok(Ok(Err(msg))) => fallo(msg),
        Ok(Err(_)) => fallo("el proceso de OCR no respondió".into()),
        Err(_) => fallo("El OCR tardó demasiado en cargar los modelos".into()),
    }
}

pub fn detener(state: &AppState) {
    let mut s = state.ocr.lock().unwrap();
    if let Some(mut child) = s.child.take() {
        let _ = child.write(b"{\"op\":\"shutdown\"}\n");
        let _ = child.kill();
    }
}

async fn enviar(state: &AppState, mut req: Value) -> AppResult<Value> {
    let (id, rx) = {
        let mut s = state.ocr.lock().unwrap();
        s.contador += 1;
        let id = s.contador.to_string();
        let (tx, rx) = oneshot::channel();
        s.pendientes.lock().unwrap().insert(id.clone(), tx);
        req["id"] = Value::String(id.clone());
        let mut linea = req.to_string();
        linea.push('\n');
        let child = s.child.as_mut().ok_or_else(|| AppError::new("ocr_no_disponible", "El OCR no está corriendo"))?;
        child.write(linea.as_bytes()).map_err(|e| AppError::new("ocr_no_disponible", e.to_string()))?;
        (id, rx)
    };
    match tokio::time::timeout(TIMEOUT_INFERENCIA, rx).await {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(_)) => Err(AppError::new("ocr_no_disponible", "El OCR se cerró durante la inferencia")),
        Err(_) => {
            state.ocr.lock().unwrap().pendientes.lock().unwrap().remove(&id);
            Err(AppError::new("ocr_timeout", "El OCR tardó demasiado con esta imagen"))
        }
    }
}

/// Reconoce texto en una imagen (JPEG/PNG en base64, con o sin prefijo data:).
pub async fn reconocer(app: &AppHandle, imagen_base64: &str) -> AppResult<ResultadoOcr> {
    asegurar_arrancado(app).await?;
    let state = app.state::<AppState>();
    let b64 = imagen_base64.split_once(',').map(|(_, b)| b).unwrap_or(imagen_base64);
    let t0 = Instant::now();
    let v = enviar(&state, json!({ "op": "recognize", "image": b64 })).await?;
    let ms_roundtrip = t0.elapsed().as_millis() as u64;
    if v["ok"].as_bool() != Some(true) {
        return Err(AppError::new("ocr_error", v["error"].as_str().unwrap_or("error de OCR")));
    }
    let items = v["items"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|i| ItemOcr {
                    texto: i["texto"].as_str().unwrap_or_default().to_string(),
                    confianza: i["confianza"].as_f64().unwrap_or(0.0),
                })
                .collect()
        })
        .unwrap_or_default();
    let r = ResultadoOcr {
        texto: v["texto"].as_str().unwrap_or_default().to_string(),
        items,
        confianza: v["confianza"].as_f64().unwrap_or(0.0),
        ms_inferencia: v["ms_inferencia"].as_u64().unwrap_or(0),
        ms_total: v["ms_total"].as_u64().unwrap_or(0),
        ms_roundtrip,
    };
    log::info!("OCR placa: \"{}\" conf={:.2} inferencia={}ms roundtrip={}ms", r.texto, r.confianza, r.ms_inferencia, ms_roundtrip);
    Ok(r)
}

// ── Comandos Tauri ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ocr_placa(app: AppHandle, imagen_base64: String) -> AppResult<ResultadoOcr> {
    reconocer(&app, &imagen_base64).await
}

#[tauri::command]
pub async fn ocr_precalentar(app: AppHandle) -> AppResult<EstadoOcr> {
    let r = asegurar_arrancado(&app).await;
    let state = app.state::<AppState>();
    let s = state.ocr.lock().unwrap();
    Ok(EstadoOcr { disponible: r.is_ok() && s.child.is_some(), ms_carga: s.ms_carga, error: s.error.clone() })
}

#[tauri::command]
pub fn ocr_estado(state: State<'_, AppState>) -> EstadoOcr {
    let s = state.ocr.lock().unwrap();
    EstadoOcr { disponible: s.child.is_some(), ms_carga: s.ms_carga, error: s.error.clone() }
}

/// OCR de DPI: en Sprint 8 sigue siendo Vision API a través del backend
/// (fase 2 lo trae local). Sólo funciona con conexión; si falla, la UI cae a
/// captura manual. NO se usa para placas.
#[tauri::command]
pub async fn ocr_dpi_remoto(state: State<'_, AppState>, imagen_base64: String) -> AppResult<Value> {
    let (jwt, lic) = crate::auth::credenciales(&state).await?;
    let base = state.api_url();
    let b64 = imagen_base64.split_once(',').map(|(_, b)| b).unwrap_or(&imagen_base64).to_string();
    state
        .api
        .post(&base, "/ocr/dpi", &json!({ "image": b64 }), &crate::api::Credenciales { jwt: Some(&jwt), licencia: Some(&lic) })
        .await
}
