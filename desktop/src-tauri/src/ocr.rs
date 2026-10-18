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
pub(crate) fn dir_sidecar(app: &AppHandle) -> Option<PathBuf> {
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

// ── DPI (T5, SCRUM-121) ─────────────────────────────────────────────────────
//
// Local primero: el sidecar lee el DPI en este equipo (`op: "dpi"`, ver sidecar-ocr/src/dpi.js). El OCR remoto
// (Google Vision, a través del backend `/ocr/dpi`) queda como RESPALDO y solo se usa si el local falla o duda
// Y hay red Y el equipo lo permite (`Config::dpi_remoto_respaldo`).
//
// Privacidad: la imagen del DPI viaja en base64 por memoria (WebView → Rust → pipe del sidecar) y no se escribe a
// disco en ningún punto. El CUI y los nombres NO se escriben en los logs: `ResultadoDpi` oculta esos campos en su
// `Debug` y el único log del DPI (`linea_log_dpi`) lleva solo banderas y milisegundos.

/// Debajo de esta confianza del CUI el resultado local se considera dudoso y se intenta el respaldo (igual que el
/// umbral del extractor, sidecar-ocr/src/dpi.js).
pub const UMBRAL_CONFIANZA_CUI: f64 = 0.8;

#[derive(Clone, Serialize)]
pub struct ConfianzaDpi {
    pub cui: f64,
    pub nombres: f64,
    pub apellidos: f64,
}

#[derive(Clone, Serialize)]
pub struct ResultadoDpi {
    /// De dónde salió el dato: `"local"` o `"remoto"`. Viaja hasta el backend junto con el acceso.
    pub origen: String,
    pub cui: String,
    pub nombres: String,
    pub apellidos: String,
    /// `nombres` + `apellidos` (local) o el `nombre` que devuelve Vision (remoto: no separa los campos).
    pub nombre_completo: String,
    pub confianza: ConfianzaDpi,
    pub cui_valido: bool,
    /// Una persona debe confirmar el dato contra el documento antes de registrar (hubo correcciones, el CUI es
    /// inválido, la confianza es baja, o es lectura remota, que no informa confianza).
    pub revision_obligatoria: bool,
    pub motivos: Vec<String>,
    /// Cuántos caracteres corrigió el extractor por posición (O→0, etc.). Solo el conteo, no el contenido.
    pub correcciones: usize,
    pub ms_total: u64,
    /// Si se usó el respaldo remoto, por qué el local no bastó.
    pub aviso: Option<String>,
}

impl std::fmt::Debug for ResultadoDpi {
    /// El CUI y los nombres son datos personales: un `{:?}` accidental en un log no debe filtrarlos.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ResultadoDpi")
            .field("origen", &self.origen)
            .field("cui", &"<oculto>")
            .field("nombres", &"<oculto>")
            .field("apellidos", &"<oculto>")
            .field("cui_valido", &self.cui_valido)
            .field("revision_obligatoria", &self.revision_obligatoria)
            .field("motivos", &self.motivos)
            .field("ms_total", &self.ms_total)
            .finish()
    }
}

/// Única línea de log permitida para un DPI: banderas y tiempos, jamás el contenido.
pub fn linea_log_dpi(r: &ResultadoDpi) -> String {
    format!(
        "OCR DPI origen={} cui_valido={} revision={} motivos={} correcciones={} ms={}",
        r.origen, r.cui_valido, r.revision_obligatoria, r.motivos.len(), r.correcciones, r.ms_total
    )
}

fn texto(v: &Value, k: &str) -> String {
    v[k].as_str().unwrap_or_default().trim().to_string()
}

/// Respuesta `op: "dpi"` del sidecar → `ResultadoDpi`.
pub fn parsear_respuesta_dpi_local(v: &Value, ms_roundtrip: u64) -> AppResult<ResultadoDpi> {
    if v["ok"].as_bool() != Some(true) {
        return Err(AppError::new("ocr_error", v["error"].as_str().unwrap_or("error de OCR")));
    }
    let nombres = texto(v, "nombres");
    let apellidos = texto(v, "apellidos");
    Ok(ResultadoDpi {
        origen: "local".into(),
        cui: texto(v, "cui"),
        nombre_completo: format!("{nombres} {apellidos}").trim().to_string(),
        nombres,
        apellidos,
        confianza: ConfianzaDpi {
            cui: v["confianza"]["cui"].as_f64().unwrap_or(0.0),
            nombres: v["confianza"]["nombres"].as_f64().unwrap_or(0.0),
            apellidos: v["confianza"]["apellidos"].as_f64().unwrap_or(0.0),
        },
        cui_valido: v["cui_valido"].as_bool().unwrap_or(false),
        revision_obligatoria: v["revision_obligatoria"].as_bool().unwrap_or(true),
        motivos: v["motivos"].as_array().map(|a| a.iter().filter_map(|m| m.as_str().map(String::from)).collect()).unwrap_or_default(),
        correcciones: v["correcciones"].as_array().map_or(0, Vec::len),
        ms_total: ms_roundtrip,
        aviso: None,
    })
}

/// Respuesta del backend `/ocr/dpi` (Vision) → `ResultadoDpi`. Vision no separa nombres/apellidos ni informa confianza:
/// siempre queda para revisión. Se descarta `texto_completo` (todo el texto del documento): no hace falta y es dato personal.
pub fn parsear_respuesta_dpi_remota(v: &Value, ms: u64, aviso: Option<String>) -> ResultadoDpi {
    let cui: String = texto(v, "numero_dpi").chars().filter(char::is_ascii_digit).collect();
    ResultadoDpi {
        origen: "remoto".into(),
        cui_valido: cui.len() == 13,
        cui,
        nombres: String::new(),
        apellidos: String::new(),
        nombre_completo: texto(v, "nombre"),
        confianza: ConfianzaDpi { cui: 0.0, nombres: 0.0, apellidos: 0.0 },
        revision_obligatoria: true,
        motivos: vec!["lectura_remota_sin_confianza".into()],
        correcciones: 0,
        ms_total: ms,
        aviso,
    }
}

/// ¿El resultado local alcanza o hay que intentar el respaldo? Alcanza con un CUI válido, con confianza suficiente
/// y algún nombre. (Una corrección por posición baja la confianza, así que un CUI corregido suele ir al respaldo.)
pub fn local_es_suficiente(r: &ResultadoDpi) -> bool {
    r.cui_valido && r.confianza.cui >= UMBRAL_CONFIANZA_CUI && !(r.nombres.is_empty() && r.apellidos.is_empty())
}

/// Política del respaldo: remoto solo si el local falló o no alcanzó, el equipo lo permite y hay red.
pub fn debe_usar_respaldo_remoto(local: &AppResult<ResultadoDpi>, remoto_permitido: bool, en_linea: bool) -> bool {
    if !remoto_permitido || !en_linea {
        return false;
    }
    match local {
        Ok(r) => !local_es_suficiente(r),
        Err(_) => true,
    }
}

async fn dpi_local(app: &AppHandle, imagen_base64: &str) -> AppResult<ResultadoDpi> {
    asegurar_arrancado(app).await?;
    let state = app.state::<AppState>();
    let b64 = imagen_base64.split_once(',').map(|(_, b)| b).unwrap_or(imagen_base64);
    let t0 = Instant::now();
    let v = enviar(&state, json!({ "op": "dpi", "image": b64 })).await?;
    parsear_respuesta_dpi_local(&v, t0.elapsed().as_millis() as u64)
}

async fn dpi_remoto(state: &AppState, imagen_base64: &str, aviso: Option<String>) -> AppResult<ResultadoDpi> {
    if !state.config.read().unwrap().dpi_remoto_respaldo {
        return Err(AppError::new("dpi_remoto_desactivado", "El OCR remoto del DPI está desactivado en este equipo"));
    }
    let (jwt, lic) = crate::auth::credenciales(state).await?;
    let base = state.api_url();
    let b64 = imagen_base64.split_once(',').map(|(_, b)| b).unwrap_or(imagen_base64).to_string();
    let t0 = Instant::now();
    let v = state
        .api
        .post(&base, "/ocr/dpi", &json!({ "image": b64 }), &crate::api::Credenciales { jwt: Some(&jwt), licencia: Some(&lic) })
        .await?;
    Ok(parsear_respuesta_dpi_remota(&v, t0.elapsed().as_millis() as u64, aviso))
}

/// Lee el DPI SOLO con el OCR de este equipo. Funciona sin red.
#[tauri::command]
pub async fn ocr_dpi_local(app: AppHandle, imagen_base64: String) -> AppResult<ResultadoDpi> {
    let r = dpi_local(&app, &imagen_base64).await?;
    log::info!("{}", linea_log_dpi(&r));
    Ok(r)
}

/// OCR remoto del DPI (Google Vision, vía backend): RESPALDO. Solo funciona con red y si el equipo lo permite.
#[tauri::command]
pub async fn ocr_dpi_remoto(state: State<'_, AppState>, imagen_base64: String) -> AppResult<ResultadoDpi> {
    let r = dpi_remoto(&state, &imagen_base64, None).await?;
    log::info!("{}", linea_log_dpi(&r));
    Ok(r)
}

/// Lectura de DPI de la pantalla: local primero; remoto solo si el local falló o dudó Y hay red Y está permitido.
/// Si el respaldo también falla se devuelve el resultado local (aunque dudoso) para que la persona lo revise; si no
/// hubo ninguno, el error del local, y la pantalla ofrece la captura manual.
#[tauri::command]
pub async fn ocr_dpi(app: AppHandle, state: State<'_, AppState>, imagen_base64: String) -> AppResult<ResultadoDpi> {
    let local = dpi_local(&app, &imagen_base64).await;
    let permitido = state.config.read().unwrap().dpi_remoto_respaldo;
    let en_linea = state.en_linea.load(std::sync::atomic::Ordering::Relaxed);
    if !debe_usar_respaldo_remoto(&local, permitido, en_linea) {
        let r = local?;
        log::info!("{}", linea_log_dpi(&r));
        return Ok(r);
    }
    let motivo = match &local {
        Ok(_) => "local_dudoso".to_string(),
        Err(e) => format!("local_fallo:{}", e.codigo),
    };
    match dpi_remoto(&state, &imagen_base64, Some(motivo)).await {
        Ok(r) => {
            log::info!("{}", linea_log_dpi(&r));
            Ok(r)
        }
        Err(e) => {
            log::warn!("OCR DPI: el respaldo remoto falló ({})", e.codigo);
            let r = local?;
            log::info!("{}", linea_log_dpi(&r));
            Ok(r)
        }
    }
}

#[derive(Serialize)]
pub struct ConfigDpi {
    pub remoto_respaldo: bool,
}

#[tauri::command]
pub fn ocr_dpi_config(state: State<'_, AppState>) -> ConfigDpi {
    ConfigDpi { remoto_respaldo: state.config.read().unwrap().dpi_remoto_respaldo }
}

/// Permite o no el respaldo remoto en ESTE equipo (la imagen del DPI solo sale si está permitido).
#[tauri::command]
pub fn ocr_dpi_configurar(state: State<'_, AppState>, remoto_respaldo: bool) -> AppResult<ConfigDpi> {
    let mut cfg = state.config.read().unwrap().clone();
    cfg.dpi_remoto_respaldo = remoto_respaldo;
    cfg.guardar(&state.dir_datos)?;
    *state.config.write().unwrap() = cfg;
    Ok(ConfigDpi { remoto_respaldo })
}

#[cfg(test)]
mod tests_dpi {
    use super::*;

    fn local_ok() -> Value {
        json!({
            "ok": true, "cui": "1234567890101", "nombres": "ANA MARIA", "apellidos": "LOPEZ GARCIA",
            "confianza": { "cui": 0.97, "nombres": 0.95, "apellidos": 0.96 },
            "cui_valido": true, "revision_obligatoria": false, "motivos": [], "correcciones": [],
            "ms_inferencia": 400, "ms_total": 520
        })
    }

    #[test]
    fn parsea_la_respuesta_local_y_une_el_nombre() {
        let r = parsear_respuesta_dpi_local(&local_ok(), 530).unwrap();
        assert_eq!(r.origen, "local");
        assert_eq!(r.cui, "1234567890101");
        assert_eq!(r.nombre_completo, "ANA MARIA LOPEZ GARCIA");
        assert!(r.cui_valido && !r.revision_obligatoria);
        assert_eq!(r.correcciones, 0);
        assert!(local_es_suficiente(&r));
    }

    #[test]
    fn una_respuesta_con_error_o_sin_banderas_es_error_o_revision() {
        let e = parsear_respuesta_dpi_local(&json!({ "ok": false, "error": "boom" }), 1).unwrap_err();
        assert_eq!(e.codigo, "ocr_error");
        // Sin `revision_obligatoria` en la respuesta se asume que SÍ hace falta revisar.
        let r = parsear_respuesta_dpi_local(&json!({ "ok": true, "cui": "1" }), 1).unwrap();
        assert!(r.revision_obligatoria && !r.cui_valido && !local_es_suficiente(&r));
    }

    #[test]
    fn la_lectura_remota_siempre_queda_para_revision_y_no_trae_el_texto_del_documento() {
        let r = parsear_respuesta_dpi_remota(
            &json!({ "nombre": "ANA LOPEZ", "numero_dpi": "1234 56789 0101", "texto_completo": "TODO EL DOCUMENTO" }), 900, Some("local_dudoso".into()),
        );
        assert_eq!(r.origen, "remoto");
        assert_eq!(r.cui, "1234567890101");
        assert!(r.cui_valido && r.revision_obligatoria);
        assert_eq!(r.nombre_completo, "ANA LOPEZ");
        assert!(!serde_json::to_string(&r).unwrap().contains("TODO EL DOCUMENTO"));
    }

    fn con(f: impl FnOnce(&mut ResultadoDpi)) -> AppResult<ResultadoDpi> {
        let mut r = parsear_respuesta_dpi_local(&local_ok(), 500).unwrap();
        f(&mut r);
        Ok(r)
    }

    #[test]
    fn politica_local_primero_sin_respaldo_si_el_local_alcanza() {
        assert!(!debe_usar_respaldo_remoto(&con(|_| {}), true, true));
    }

    #[test]
    fn politica_respaldo_solo_si_el_local_falla_o_duda_y_hay_red_y_esta_permitido() {
        let dudoso = con(|r| r.confianza.cui = 0.6);
        let invalido = con(|r| r.cui_valido = false);
        let sin_nombre = con(|r| { r.nombres.clear(); r.apellidos.clear(); });
        let falla: AppResult<ResultadoDpi> = Err(AppError::new("ocr_no_disponible", "x"));
        for local in [&dudoso, &invalido, &sin_nombre, &falla] {
            assert!(debe_usar_respaldo_remoto(local, true, true), "con red y permiso, un local que no alcanza va al respaldo");
            assert!(!debe_usar_respaldo_remoto(local, true, false), "sin red nunca");
            assert!(!debe_usar_respaldo_remoto(local, false, true), "con el respaldo apagado en el equipo nunca");
        }
    }

    #[test]
    fn sin_red_el_flujo_completo_funciona_con_el_local() {
        // Offline: aunque el local dude, no se intenta nada remoto y el resultado local llega a la pantalla (para revisión).
        let dudoso = con(|r| { r.confianza.cui = 0.5; r.revision_obligatoria = true; });
        assert!(!debe_usar_respaldo_remoto(&dudoso, true, false));
    }

    // ── Privacidad ──
    #[test]
    fn el_debug_y_la_linea_de_log_no_filtran_el_cui_ni_los_nombres() {
        let r = parsear_respuesta_dpi_local(&local_ok(), 500).unwrap();
        for texto in [format!("{r:?}"), format!("{r:#?}"), linea_log_dpi(&r)] {
            assert!(!texto.contains("1234567890101"), "filtró el CUI: {texto}");
            assert!(!texto.contains("1234 56789"), "filtró el CUI: {texto}");
            assert!(!texto.contains("ANA") && !texto.contains("LOPEZ") && !texto.contains("GARCIA"), "filtró nombres: {texto}");
        }
        assert!(linea_log_dpi(&r).contains("origen=local"));
    }

    /// Guarda de regresión de código: el módulo de OCR no escribe a disco ni registra el contenido del DPI.
    #[test]
    fn el_codigo_del_ocr_no_escribe_imagenes_ni_registra_datos_del_dpi() {
        let fuente = include_str!("ocr.rs");
        let codigo = fuente.split("#[cfg(test)]").next().unwrap();
        for prohibido in ["fs::write", "File::create", "OpenOptions", "tempfile", "NamedTempFile", "create_dir", "std::fs::"] {
            assert!(!codigo.contains(prohibido), "ocr.rs no debe tocar el disco: encontró {prohibido}");
        }
        for linea in codigo.lines().filter(|l| l.contains("log::")) {
            let l = linea.to_lowercase();
            // Los logs del DPI usan solo `linea_log_dpi` / banderas; ningún log interpola campos del documento.
            assert!(!l.contains(".cui") && !l.contains(".nombres") && !l.contains(".apellidos") && !l.contains("nombre_completo")
                && !l.contains("imagen") && !l.contains("base64"), "log sospechoso: {linea}");
        }
    }
}
