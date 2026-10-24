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

// ── DPI (T5, SCRUM-121; 100 % local desde el Sprint 10) ─────────────────────
//
// El sidecar lee el DPI en este equipo (`op: "dpi"`, ver sidecar-ocr/src/dpi.js), también sin internet. No hay ningún
// OCR remoto: la imagen del DPI nunca sale del equipo (ver docs/ocr_local_decision.md).
//
// Una lectura dudosa nunca pasa en silencio: si el sidecar la marca, o si aquí se ve que el CUI no es válido, la
// confianza del CUI es baja o no salió ningún nombre, va con `revision_obligatoria` y la pantalla pide confirmarla.
//
// Privacidad: la imagen del DPI viaja en base64 por memoria (WebView → Rust → pipe del sidecar) y no se escribe a
// disco en ningún punto. El CUI y los nombres NO se escriben en los logs: `ResultadoDpi` oculta esos campos en su
// `Debug` y el único log del DPI (`linea_log_dpi`) lleva solo banderas y milisegundos.

/// Debajo de esta confianza del CUI la lectura va a revisión (el mismo umbral del extractor, sidecar-ocr/src/dpi.js).
pub const UMBRAL_CONFIANZA_CUI: f64 = 0.8;

#[derive(Clone, Serialize)]
pub struct ConfianzaDpi {
    pub cui: f64,
    pub nombres: f64,
    pub apellidos: f64,
}

#[derive(Clone, Serialize)]
pub struct ResultadoDpi {
    /// De dónde salió el dato: siempre `"local"` (OCR de este equipo). Viaja hasta el backend junto con el acceso.
    pub origen: String,
    pub cui: String,
    pub nombres: String,
    pub apellidos: String,
    /// `nombres` + `apellidos`.
    pub nombre_completo: String,
    pub confianza: ConfianzaDpi,
    pub cui_valido: bool,
    /// Una persona debe confirmar el dato contra el documento antes de registrar (hubo correcciones, el CUI es
    /// inválido o falta, la confianza es baja, o no salió ningún nombre).
    pub revision_obligatoria: bool,
    pub motivos: Vec<String>,
    /// Cuántos caracteres corrigió el extractor por posición (O→0, etc.). Solo el conteo, no el contenido.
    pub correcciones: usize,
    pub ms_total: u64,
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

/// ¿La lectura se puede proponer sin revisión? CUI válido, con confianza suficiente, y algún nombre.
pub fn lectura_confiable(r: &ResultadoDpi) -> bool {
    r.cui_valido && !r.cui.is_empty() && r.confianza.cui >= UMBRAL_CONFIANZA_CUI && !(r.nombres.is_empty() && r.apellidos.is_empty())
}

/// Respuesta `op: "dpi"` del sidecar → `ResultadoDpi`. Si el sidecar no la marcó para revisión pero aquí no es confiable,
/// se marca igual (y se dice por qué): ninguna lectura dudosa llega a la pantalla como buena.
pub fn parsear_respuesta_dpi_local(v: &Value, ms_roundtrip: u64) -> AppResult<ResultadoDpi> {
    if v["ok"].as_bool() != Some(true) {
        return Err(AppError::new("ocr_error", v["error"].as_str().unwrap_or("error de OCR")));
    }
    let nombres = texto(v, "nombres");
    let apellidos = texto(v, "apellidos");
    let mut r = ResultadoDpi {
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
    };
    if !lectura_confiable(&r) {
        r.revision_obligatoria = true;
        let mut agregar = |m: &str| if !r.motivos.iter().any(|x| x == m) { r.motivos.push(m.into()) };
        if r.cui.is_empty() {
            agregar("cui_no_encontrado");
        } else if !r.cui_valido {
            agregar("cui_invalido");
        } else if r.confianza.cui < UMBRAL_CONFIANZA_CUI {
            agregar("cui_confianza_baja");
        }
        if r.nombres.is_empty() && r.apellidos.is_empty() {
            agregar("nombres_no_encontrado");
        }
    }
    Ok(r)
}

/// Lee el DPI con el OCR de este equipo. Funciona sin red. Si el OCR falla, la pantalla ofrece la captura manual.
#[tauri::command]
pub async fn ocr_dpi(app: AppHandle, imagen_base64: String) -> AppResult<ResultadoDpi> {
    asegurar_arrancado(&app).await?;
    let state = app.state::<AppState>();
    let b64 = imagen_base64.split_once(',').map(|(_, b)| b).unwrap_or(&imagen_base64);
    let t0 = Instant::now();
    let v = enviar(&state, json!({ "op": "dpi", "image": b64 })).await?;
    let r = parsear_respuesta_dpi_local(&v, t0.elapsed().as_millis() as u64)?;
    log::info!("{}", linea_log_dpi(&r));
    Ok(r)
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
        assert!(lectura_confiable(&r));
    }

    #[test]
    fn una_respuesta_con_error_o_sin_banderas_es_error_o_revision() {
        let e = parsear_respuesta_dpi_local(&json!({ "ok": false, "error": "boom" }), 1).unwrap_err();
        assert_eq!(e.codigo, "ocr_error");
        // Sin `revision_obligatoria` en la respuesta se asume que SÍ hace falta revisar.
        let r = parsear_respuesta_dpi_local(&json!({ "ok": true, "cui": "1" }), 1).unwrap();
        assert!(r.revision_obligatoria && !r.cui_valido && !lectura_confiable(&r));
    }

    fn con(f: impl FnOnce(&mut Value)) -> ResultadoDpi {
        let mut v = local_ok();
        f(&mut v);
        parsear_respuesta_dpi_local(&v, 500).unwrap()
    }

    #[test]
    fn una_lectura_dudosa_nunca_llega_como_buena_aunque_el_sidecar_no_la_marque() {
        // El sidecar dice «sin revisión», pero el CUI no es válido, falta, tiene poca confianza o no salió ningún nombre.
        for (caso, cambio, motivo) in [
            ("cui inválido", &(|v: &mut Value| v["cui_valido"] = json!(false)) as &dyn Fn(&mut Value), "cui_invalido"),
            ("sin cui", &|v: &mut Value| { v["cui"] = json!(""); v["cui_valido"] = json!(false); }, "cui_no_encontrado"),
            ("confianza baja", &|v: &mut Value| v["confianza"]["cui"] = json!(0.6), "cui_confianza_baja"),
            ("sin nombres", &|v: &mut Value| { v["nombres"] = json!(""); v["apellidos"] = json!(""); }, "nombres_no_encontrado"),
        ] {
            let r = con(|v| cambio(v));
            assert!(r.revision_obligatoria, "{caso}: debe ir a revisión");
            assert!(r.motivos.iter().any(|m| m == motivo), "{caso}: motivo {motivo} en {:?}", r.motivos);
            assert!(!lectura_confiable(&r));
        }
        // Lo que el sidecar ya marcó se respeta (y sus motivos no se duplican).
        let r = con(|v| { v["revision_obligatoria"] = json!(true); v["motivos"] = json!(["cui_corregido"]); v["correcciones"] = json!([{}]); });
        assert!(r.revision_obligatoria);
        assert_eq!(r.motivos, vec!["cui_corregido".to_string()]);
        assert_eq!(r.correcciones, 1);
    }

    #[test]
    fn una_lectura_confiable_no_pide_revision_y_siempre_es_local() {
        let r = con(|_| {});
        assert!(lectura_confiable(&r) && !r.revision_obligatoria && r.motivos.is_empty());
        assert_eq!(r.origen, "local");
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

    /// Guarda de regresión de código: el módulo de OCR no manda la imagen a ningún servidor (el OCR es 100 % local).
    #[test]
    fn el_ocr_no_usa_la_red() {
        let fuente = include_str!("ocr.rs");
        let codigo = fuente.split("#[cfg(test)]").next().unwrap();
        for prohibido in ["state.api", ".post(", "reqwest", "credenciales", "/ocr/", "api_url", "en_linea"] {
            assert!(!codigo.contains(prohibido), "ocr.rs no debe usar la red: encontró {prohibido}");
        }
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
