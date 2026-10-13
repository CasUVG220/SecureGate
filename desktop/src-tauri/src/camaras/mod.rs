//! Cámaras IP y celular (T7). Diseño y decisiones: docs/camaras_ip_diseno.md.
//!
//! Piezas: `ssrf` (qué direcciones se aceptan), `credenciales` (llavero del sistema), `modelo` (tabla `camaras`), `jpeg` (partir el
//! flujo en fotogramas), `backoff`, `fuente` (supervisor con reconexión + conectores RTSP/ffmpeg y MJPEG/HTTP), `puente` (servidor
//! en 127.0.0.1 con token efímero para la vista previa) y este módulo, que une todo en comandos Tauri.
//!
//! Lo que el WebView recibe de una cámara: nombre, tipo, dirección SIN credenciales, tareas y un booleano `con_credenciales`.
//! Usuario y contraseña viajan WebView → Rust al guardar y se quedan en el llavero; no hay comando que los devuelva.

pub mod backoff;
pub mod credenciales;
pub mod fuente;
pub mod jpeg;
pub mod modelo;
pub mod puente;
pub mod ssrf;
#[cfg(test)]
mod pruebas_integracion;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use tokio::sync::{mpsc, OnceCell};

use crate::error::{AppError, AppResult};
use crate::AppState;
use credenciales::Credenciales;
use fuente::{
    ConectorMjpeg, ConectorRtsp, ConfigSupervisor, ErrorFuente, EstadoFuente, EventoProceso, FlujoFotogramas, FuenteFotogramas, Lanzador,
    OpcionesVideo, ProcesoHijo, Supervisor, Conector,
};
use modelo::{Camara, TipoCamara};
use puente::Puente;
use ssrf::{PuentePropio, ResolvedorSistema};

/// Orígenes del WebView de la app (Windows/WebView2, macOS/Linux y `tauri dev`): los únicos que el puente acepta en `Origin`.
const ORIGENES_APP: [&str; 4] = ["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost", "http://localhost:1420"];

/// Cuánto se espera el primer fotograma al capturar para el OCR.
const ESPERA_CAPTURA: Duration = Duration::from_secs(8);
/// Cuánto se espera al probar una cámara antes de guardarla.
const ESPERA_PRUEBA: Duration = Duration::from_secs(12);

/// Estado del módulo dentro de `AppState`.
#[derive(Default)]
pub struct Gestor {
    puente: OnceCell<Arc<Puente>>,
    activas: Mutex<HashMap<String, Arc<Supervisor>>>,
}

impl Gestor {
    async fn puente(&self) -> AppResult<Arc<Puente>> {
        self.puente
            .get_or_try_init(|| async { Puente::iniciar(ORIGENES_APP.iter().map(|s| s.to_string()).collect()).await })
            .await
            .cloned()
            .map_err(|e| AppError::new("camaras", format!("No se pudo abrir el puente de video local: {e}")))
    }

    fn detener(&self, id: &str) {
        if let Some(s) = self.activas.lock().unwrap().remove(id) {
            s.detener();
        }
        if let Some(p) = self.puente.get() {
            p.quitar(id);
        }
    }

    pub fn detener_todas(&self) {
        let ids: Vec<String> = self.activas.lock().unwrap().keys().cloned().collect();
        for id in ids {
            self.detener(&id);
        }
    }
}

// ── Lanzador de ffmpeg (sidecar de Tauri) ────────────────────────────────────────────────────────────────

/// Lanza el `ffmpeg` empaquetado como sidecar (`binaries/ffmpeg`, ver tauri.conf.json y desktop/scripts/build-ffmpeg-min.sh).
pub struct LanzadorTauri {
    pub app: AppHandle,
}

impl Lanzador for LanzadorTauri {
    fn lanzar(&self, args: Vec<String>) -> Result<ProcesoHijo, String> {
        let (mut rx, hijo) = self
            .app
            .shell()
            .sidecar("ffmpeg")
            .map_err(|_| "El componente de video (ffmpeg) no está instalado en este equipo.".to_string())?
            .args(args)
            // Sin esto el plugin parte la salida por líneas y rompería los JPEG binarios.
            .set_raw_out(true)
            .spawn()
            .map_err(|_| "No se pudo iniciar el componente de video.".to_string())?;
        let (tx, rx2) = mpsc::channel(64);
        tauri::async_runtime::spawn(async move {
            while let Some(ev) = rx.recv().await {
                let e = match ev {
                    CommandEvent::Stdout(b) => EventoProceso::Salida(b),
                    CommandEvent::Stderr(b) => EventoProceso::Error(b),
                    CommandEvent::Terminated(p) => EventoProceso::Terminado(p.code),
                    _ => continue,
                };
                let fin = matches!(e, EventoProceso::Terminado(_));
                if tx.send(e).await.is_err() || fin {
                    break;
                }
            }
        });
        let mut hijo = Some(hijo);
        Ok(ProcesoHijo { rx: rx2, matar: Box::new(move || { if let Some(h) = hijo.take() { let _ = h.kill(); } }) })
    }
}

// ── Lo que entra y sale del WebView ──────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct EntradaCamara {
    /// Vacío = alta nueva.
    pub id: Option<String>,
    pub tipo: TipoCamara,
    pub nombre: String,
    pub url: Option<String>,
    pub device_id: Option<String>,
    /// Solo de ida: se guardan en el llavero y no vuelven.
    pub usuario: Option<String>,
    pub clave: Option<String>,
    /// Borra las credenciales guardadas (cámara que ya no las pide).
    #[serde(default)]
    pub quitar_credenciales: bool,
}

impl std::fmt::Debug for EntradaCamara {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EntradaCamara")
            .field("id", &self.id).field("tipo", &self.tipo).field("nombre", &self.nombre)
            .field("url", &self.url.as_deref().map(ssrf::redactar_url))
            .field("usuario", &"<oculto>").field("clave", &"<oculta>")
            .finish()
    }
}

#[derive(Serialize, Debug)]
pub struct ResultadoPrueba {
    pub ok: bool,
    pub mensaje: String,
    pub ms: u64,
    pub ancho: Option<u32>,
    pub alto: Option<u32>,
}

#[derive(Serialize)]
pub struct InfoPuente {
    pub puerto: u16,
    /// Token efímero de ESTA ejecución: sirve solo para la vista previa y cambia cada vez que abre la app.
    pub token: String,
}

#[derive(Serialize)]
pub struct FotogramaCapturado {
    pub jpeg_base64: String,
    pub seq: u64,
    /// Qué tan viejo es el fotograma (ms).
    pub edad_ms: u64,
}

// ── Lógica (separada de los comandos para poder probarla) ────────────────────────────────────────────────

/// Esquemas aceptados por tipo de cámara.
fn esquema_permitido(tipo: TipoCamara, esquema: &str) -> bool {
    match tipo {
        TipoCamara::Ip => matches!(esquema, "rtsp" | "http" | "https"),
        TipoCamara::Celular => matches!(esquema, "http" | "https" | "rtsp"),
        TipoCamara::Usb => false,
    }
}

/// Valida la dirección de una cámara (esquema, credenciales, SSRF). `None` para las USB. Puede bloquear (DNS): llamarla fuera de la base.
pub fn validar_entrada(entrada: &EntradaCamara, resolvedor: &dyn ssrf::Resolvedor, puente: Option<PuentePropio>) -> AppResult<Option<ssrf::DestinoValidado>> {
    if entrada.tipo == TipoCamara::Usb {
        return Ok(None);
    }
    let u = entrada.url.clone().unwrap_or_default();
    let destino = ssrf::validar(&u, resolvedor, puente).map_err(|e| AppError::new("camaras", e.mensaje()))?;
    if !esquema_permitido(entrada.tipo, &destino.esquema) {
        return Err(AppError::new("camaras", "Esa dirección no sirve para este tipo de cámara."));
    }
    Ok(Some(destino))
}

/// Valida y guarda una cámara (atajo para pruebas y para quien ya puede resolver nombres).
#[cfg(test)]
pub fn guardar_camara(
    conn: &rusqlite::Connection,
    entrada: &EntradaCamara,
    resolvedor: &dyn ssrf::Resolvedor,
    puente: Option<PuentePropio>,
) -> AppResult<Camara> {
    validar_entrada(entrada, resolvedor, puente)?;
    guardar_validada(conn, entrada)
}

/// Guarda una cámara cuya dirección YA se validó con `validar_entrada`. Devuelve la fila (sin credenciales); las credenciales, si
/// vienen, van al llavero.
pub fn guardar_validada(conn: &rusqlite::Connection, entrada: &EntradaCamara) -> AppResult<Camara> {
    let nombre = modelo::nombre_valido(&entrada.nombre)?;
    let id = entrada.id.clone().filter(|i| !i.trim().is_empty()).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let previa = modelo::obtener(conn, &id)?;

    let (url, device_id) = match entrada.tipo {
        TipoCamara::Usb => {
            let d = entrada.device_id.clone().filter(|d| !d.trim().is_empty());
            if d.is_none() {
                return Err(AppError::new("camaras", "Falta el identificador de la cámara USB."));
            }
            (None, d)
        }
        // Se guarda lo que la persona escribió (host y ruta), ya sin credenciales (la validación las rechaza).
        _ => (Some(entrada.url.clone().unwrap_or_default().trim().to_string()), None),
    };

    // Credenciales: nuevas, conservadas o quitadas. Nunca pasan por la tabla.
    let usuario = entrada.usuario.as_deref().map(str::trim).filter(|u| !u.is_empty());
    let mut con_credenciales = previa.as_ref().map_or(false, |p| p.con_credenciales);
    if entrada.quitar_credenciales {
        credenciales::borrar(&id)?;
        con_credenciales = false;
    } else if let Some(u) = usuario {
        credenciales::guardar(&id, &Credenciales { usuario: u.to_string(), clave: entrada.clave.clone().unwrap_or_default() })?;
        con_credenciales = true;
    }
    if entrada.tipo == TipoCamara::Usb {
        con_credenciales = false;
    }

    let camara = Camara {
        id,
        tipo: entrada.tipo,
        nombre,
        url,
        device_id,
        tareas: previa.as_ref().map(|p| p.tareas.clone()).unwrap_or_default(),
        con_credenciales,
        creada_en: previa.map(|p| p.creada_en).unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
    };
    modelo::guardar(conn, &camara)?;
    Ok(camara)
}

/// Arma el supervisor de una cámara guardada (IP o celular).
fn crear_supervisor(lanzador: Arc<dyn Lanzador>, cam: &Camara, cred: Option<Credenciales>, puente: Option<PuentePropio>, opciones: OpcionesVideo) -> AppResult<Arc<Supervisor>> {
    let url = cam.url.clone().ok_or_else(|| AppError::new("camaras", "Esta cámara no tiene dirección de red."))?;
    let analizada = ssrf::analizar(&url).map_err(|e| AppError::new("camaras", e.mensaje()))?;
    let validar = fuente::validador_sistema(url, puente);
    let cfg = ConfigSupervisor::default();
    Ok(Arc::new(if matches!(analizada.scheme(), "http" | "https") {
        Supervisor::iniciar(ConectorMjpeg { validar, credenciales: cred }, cfg)
    } else {
        Supervisor::iniciar(ConectorRtsp { lanzador, validar, credenciales: cred, opciones }, cfg)
    }))
}

/// Conecta una vez y espera el primer fotograma (para «Probar conexión» antes de guardar).
pub async fn probar_conexion<C: Conector>(conector: C, espera: Duration) -> ResultadoPrueba {
    let t0 = Instant::now();
    let r = tokio::time::timeout(espera, async {
        let mut flujo = conector.conectar().await?;
        match flujo.siguiente().await? {
            Some(f) => Ok(f),
            None => Err(ErrorFuente::Temporal("La cámara cerró la conexión sin enviar imagen.".into())),
        }
    })
    .await;
    let ms = t0.elapsed().as_millis() as u64;
    match r {
        Ok(Ok(jpeg)) => {
            let dim = jpeg::dimensiones(&jpeg);
            ResultadoPrueba {
                ok: true,
                mensaje: match dim {
                    Some((a, h)) => format!("Conexión correcta: se recibe imagen de {a}×{h}."),
                    None => "Conexión correcta: se recibe imagen.".into(),
                },
                ms, ancho: dim.map(|d| d.0), alto: dim.map(|d| d.1),
            }
        }
        Ok(Err(e)) => ResultadoPrueba { ok: false, mensaje: e.mensaje().to_string(), ms, ancho: None, alto: None },
        Err(_) => ResultadoPrueba { ok: false, mensaje: "La cámara no respondió a tiempo.".into(), ms, ancho: None, alto: None },
    }
}

// ── Comandos Tauri ───────────────────────────────────────────────────────────────────────────────────────

fn con_db<T>(state: &AppState, f: impl FnOnce(&rusqlite::Connection) -> AppResult<T>) -> AppResult<T> {
    crate::garita::con_db(state, f)
}

#[tauri::command]
pub fn camaras_listar(state: State<'_, AppState>) -> AppResult<Vec<Camara>> {
    con_db(&state, modelo::listar)
}

#[tauri::command]
pub async fn camaras_guardar(state: State<'_, AppState>, entrada: EntradaCamara) -> AppResult<Camara> {
    let puente = state.camaras.puente().await.ok().map(|p| PuentePropio(p.direccion()));
    // La resolución de nombres puede bloquear: va en un hilo aparte y SIN tener tomada la base.
    let entrada = Arc::new(entrada);
    let e2 = entrada.clone();
    tokio::task::spawn_blocking(move || validar_entrada(&e2, &ResolvedorSistema, puente).map(|_| ()))
        .await
        .map_err(|_| AppError::interno("error al validar la cámara"))??;
    let cam = con_db(&state, |c| guardar_validada(c, &entrada))?;
    // Una cámara editada se reinicia con los datos nuevos al volver a encenderla.
    state.camaras.detener(&cam.id);
    Ok(cam)
}

#[tauri::command]
pub fn camaras_eliminar(state: State<'_, AppState>, id: String) -> AppResult<bool> {
    state.camaras.detener(&id);
    credenciales::borrar(&id)?;
    con_db(&state, |c| modelo::eliminar(c, &id))
}

#[tauri::command]
pub fn camaras_asignar(state: State<'_, AppState>, id: String, tareas: Vec<String>) -> AppResult<Camara> {
    con_db(&state, |c| modelo::asignar_tareas(c, &id, &tareas))
}

#[tauri::command]
pub async fn camaras_probar(app: AppHandle, state: State<'_, AppState>, entrada: EntradaCamara) -> AppResult<ResultadoPrueba> {
    let url = entrada.url.clone().unwrap_or_default();
    let tipo = entrada.tipo;
    if matches!(tipo, TipoCamara::Usb) {
        return Err(AppError::new("camaras", "Las cámaras USB se prueban con su vista previa."));
    }
    let puente = state.camaras.puente().await.ok().map(|p| PuentePropio(p.direccion()));
    // Credenciales: las que se acaban de escribir o, al editar, las guardadas.
    let cred = match entrada.usuario.as_deref().map(str::trim).filter(|u| !u.is_empty()) {
        Some(u) => Some(Credenciales { usuario: u.to_string(), clave: entrada.clave.clone().unwrap_or_default() }),
        None if !entrada.quitar_credenciales => match entrada.id.as_deref() {
            Some(id) => credenciales::leer(id).ok().flatten(),
            None => None,
        },
        None => None,
    };
    let analizada = match ssrf::analizar(&url) {
        Ok(a) => a,
        Err(e) => return Ok(ResultadoPrueba { ok: false, mensaje: e.mensaje(), ms: 0, ancho: None, alto: None }),
    };
    if !esquema_permitido(tipo, analizada.scheme()) {
        return Ok(ResultadoPrueba { ok: false, mensaje: "Esa dirección no sirve para este tipo de cámara.".into(), ms: 0, ancho: None, alto: None });
    }
    let validar = fuente::validador_sistema(url, puente);
    Ok(if matches!(analizada.scheme(), "http" | "https") {
        probar_conexion(ConectorMjpeg { validar, credenciales: cred }, ESPERA_PRUEBA).await
    } else {
        probar_conexion(ConectorRtsp { lanzador: Arc::new(LanzadorTauri { app }), validar, credenciales: cred, opciones: OpcionesVideo::default() }, ESPERA_PRUEBA).await
    })
}

#[tauri::command]
pub async fn camaras_puente_info(state: State<'_, AppState>) -> AppResult<InfoPuente> {
    let p = state.camaras.puente().await?;
    Ok(InfoPuente { puerto: p.puerto(), token: p.token().to_string() })
}

/// Enciende una cámara (si no lo estaba) y la registra en el puente. Idempotente.
async fn encender(app: &AppHandle, state: &AppState, id: &str) -> AppResult<Arc<Supervisor>> {
    if let Some(s) = state.camaras.activas.lock().unwrap().get(id) {
        if !matches!(s.estado(), EstadoFuente::Detenida) {
            return Ok(s.clone());
        }
    }
    let cam = con_db(state, |c| modelo::obtener(c, id))?.ok_or_else(|| AppError::new("camaras", "No se encontró esa cámara."))?;
    if cam.tipo == TipoCamara::Usb {
        return Err(AppError::new("camaras", "Las cámaras USB las abre la vista previa, no el puente."));
    }
    let puente = state.camaras.puente().await?;
    let cred = if cam.con_credenciales { credenciales::leer(id)? } else { None };
    let sup = crear_supervisor(Arc::new(LanzadorTauri { app: app.clone() }), &cam, cred, Some(PuentePropio(puente.direccion())), OpcionesVideo::default())?;
    puente.registrar(id, sup.clone());
    state.camaras.activas.lock().unwrap().insert(id.to_string(), sup.clone());
    Ok(sup)
}

#[tauri::command]
pub async fn camaras_encender(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<EstadoFuente> {
    Ok(encender(&app, &state, &id).await?.estado())
}

#[tauri::command]
pub fn camaras_apagar(state: State<'_, AppState>, id: String) {
    state.camaras.detener(&id);
}

#[tauri::command]
pub fn camaras_estado(state: State<'_, AppState>) -> HashMap<String, EstadoFuente> {
    state.camaras.activas.lock().unwrap().iter().map(|(k, v)| (k.clone(), v.estado())).collect()
}

/// Un fotograma de la cámara para el OCR (placa, DPI, salida): el mismo JPEG que luego va a `ocr_placa` / `ocr_dpi`, igual que con la webcam.
#[tauri::command]
pub async fn camara_ip_fotograma(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<FotogramaCapturado> {
    let sup = encender(&app, &state, &id).await?;
    let t0 = Instant::now();
    let mut rx = sup.suscribir();
    loop {
        if let Some(f) = sup.ultimo() {
            let edad = crate::camaras::fuente_ahora_ms().saturating_sub(f.recibido_ms);
            // Un fotograma de hace más de 5 s es de antes de que se cayera: no sirve para leer una placa de ahora.
            if edad <= 5_000 {
                return Ok(FotogramaCapturado { jpeg_base64: base64::engine::general_purpose::STANDARD.encode(f.jpeg.as_ref()), seq: f.seq, edad_ms: edad });
            }
        }
        if let EstadoFuente::Caida { motivo, .. } = sup.estado() {
            return Err(AppError::new("camara_caida", motivo));
        }
        let resto = ESPERA_CAPTURA.saturating_sub(t0.elapsed());
        if resto.is_zero() || tokio::time::timeout(resto, rx.changed()).await.is_err() {
            let motivo = match sup.estado() {
                EstadoFuente::Reconectando { motivo, .. } => motivo,
                _ => "La cámara no envió imagen a tiempo.".into(),
            };
            return Err(AppError::new("camara_sin_imagen", motivo));
        }
    }
}

/// Milisegundos desde 1970 (misma referencia que `Fotograma::recibido_ms`).
pub(crate) fn fuente_ahora_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secure_store;
    use ssrf::Resolvedor;
    use std::net::IpAddr;

    struct SinDns;
    impl Resolvedor for SinDns {
        fn resolver(&self, _: &str, _: u16) -> Result<Vec<IpAddr>, String> {
            Err("sin dns".into())
        }
    }

    fn conn() -> rusqlite::Connection {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::aplicar_esquema(&c).unwrap();
        c
    }

    fn entrada(url: &str) -> EntradaCamara {
        EntradaCamara { id: None, tipo: TipoCamara::Ip, nombre: "Carril".into(), url: Some(url.into()), device_id: None, usuario: None, clave: None, quitar_credenciales: false }
    }

    #[test]
    fn las_credenciales_van_al_llavero_y_nunca_a_la_tabla_ni_al_json_del_frontend() {
        secure_store::inicializar_mock();
        let c = conn();
        let mut e = entrada("rtsp://192.168.1.50:554/live");
        e.usuario = Some("admin".into());
        e.clave = Some("SuperSecreta-9".into());
        let cam = guardar_camara(&c, &e, &SinDns, None).unwrap();
        assert!(cam.con_credenciales);

        // 1) llavero
        let cred = credenciales::leer(&cam.id).unwrap().unwrap();
        assert_eq!((cred.usuario.as_str(), cred.clave.as_str()), ("admin", "SuperSecreta-9"));
        // 2) SQLite: ni una sola celda de la fila contiene el usuario ni la clave
        let fila: Vec<String> = c
            .query_row("SELECT id || '|' || tipo || '|' || nombre || '|' || coalesce(url,'') || '|' || tareas || '|' || creada_en FROM camaras", [], |r| r.get::<_, String>(0))
            .into_iter()
            .collect();
        assert!(fila.iter().all(|t| !t.contains("SuperSecreta") && !t.contains("admin")), "{fila:?}");
        let volcado: String = c.prepare("SELECT * FROM camaras").unwrap().query_map([], |r| {
            Ok((0..8).map(|i| format!("{:?}", r.get_ref(i).unwrap())).collect::<Vec<_>>().join("|"))
        }).unwrap().map(|x| x.unwrap()).collect();
        assert!(!volcado.contains("SuperSecreta") && !volcado.contains("admin"), "{volcado}");
        // 3) lo que se serializa hacia el WebView
        let json = serde_json::to_string(&modelo::listar(&c).unwrap()).unwrap();
        assert!(!json.contains("SuperSecreta") && !json.contains("admin"), "{json}");
        assert!(json.contains("\"con_credenciales\":true"));
        // 4) el Debug de la entrada
        let dbg = format!("{e:?}");
        assert!(!dbg.contains("SuperSecreta") && !dbg.contains("admin"), "{dbg}");
    }

    #[test]
    fn editar_sin_credenciales_nuevas_conserva_las_guardadas_y_quitarlas_las_borra() {
        secure_store::inicializar_mock();
        let c = conn();
        let mut e = entrada("rtsp://192.168.1.50/live");
        e.usuario = Some("u".into());
        e.clave = Some("c".into());
        let cam = guardar_camara(&c, &e, &SinDns, None).unwrap();

        let mut edit = entrada("rtsp://192.168.1.51/live");
        edit.id = Some(cam.id.clone());
        edit.nombre = "Carril 2".into();
        let r = guardar_camara(&c, &edit, &SinDns, None).unwrap();
        assert!(r.con_credenciales, "no se pierden al editar el nombre o la dirección");
        assert!(credenciales::leer(&cam.id).unwrap().is_some());
        assert_eq!(r.creada_en, cam.creada_en);

        let mut quitar = entrada("rtsp://192.168.1.51/live");
        quitar.id = Some(cam.id.clone());
        quitar.quitar_credenciales = true;
        assert!(!guardar_camara(&c, &quitar, &SinDns, None).unwrap().con_credenciales);
        assert_eq!(credenciales::leer(&cam.id).unwrap(), None);
    }

    #[test]
    fn el_alta_rechaza_direcciones_peligrosas_y_no_deja_nada_guardado() {
        secure_store::inicializar_mock();
        let c = conn();
        for (url, trozo) in [
            ("rtsp://8.8.8.8/live", "red local"),
            ("rtsp://127.0.0.1/live", "red local"),
            ("rtsp://localhost/live", "red local"),
            ("rtsp://admin:1234@192.168.1.5/live", "dentro de la dirección"),
            ("file:///etc/passwd", "rtsp://"),
            ("rtsps://192.168.1.5/live", "rtsps"),
            ("", "no es válida"),
        ] {
            let mut e = entrada(url);
            e.usuario = Some("admin".into());
            e.clave = Some("x".into());
            let err = guardar_camara(&c, &e, &SinDns, None).unwrap_err();
            assert!(err.mensaje.contains(trozo), "{url} → {}", err.mensaje);
        }
        assert!(modelo::listar(&c).unwrap().is_empty());
    }

    #[test]
    fn el_tipo_limita_los_esquemas_y_las_usb_no_llevan_url_ni_credenciales() {
        secure_store::inicializar_mock();
        let c = conn();
        let usb = EntradaCamara { id: None, tipo: TipoCamara::Usb, nombre: "Webcam".into(), url: Some("http://192.168.1.5/x".into()), device_id: Some("dev-1".into()), usuario: Some("a".into()), clave: Some("b".into()), quitar_credenciales: false };
        let cam = guardar_camara(&c, &usb, &SinDns, None).unwrap();
        assert_eq!((cam.url, cam.device_id.as_deref(), cam.con_credenciales), (None, Some("dev-1"), false));
        let sin_dev = EntradaCamara { device_id: None, ..usb };
        assert!(guardar_camara(&c, &sin_dev, &SinDns, None).is_err());
        let mut celular = entrada("http://192.168.1.60:8080/video");
        celular.tipo = TipoCamara::Celular;
        assert!(guardar_camara(&c, &celular, &SinDns, None).is_ok());
    }

    #[test]
    fn el_nombre_se_valida() {
        secure_store::inicializar_mock();
        let c = conn();
        let mut e = entrada("rtsp://192.168.1.50/live");
        e.nombre = "   ".into();
        assert!(guardar_camara(&c, &e, &SinDns, None).is_err());
    }

    // ── probar conexión con un conector simulado ──
    use crate::camaras::fuente::pruebas::*;

    #[tokio::test]
    async fn probar_conexion_informa_las_dimensiones_si_llega_imagen() {
        let (c, _) = ConectorFalso::nuevo(vec![Guion::Fotogramas(vec![crate::camaras::jpeg::jpeg_de_prueba(b"x")], Duration::from_millis(1))], Guion::Muda);
        let r = probar_conexion(c, Duration::from_secs(2)).await;
        assert!(r.ok, "{r:?}");
        assert_eq!((r.ancho, r.alto), (Some(640), Some(360)));
        assert!(r.mensaje.contains("640×360"));
    }

    #[tokio::test]
    async fn probar_conexion_traduce_los_errores_y_el_tiempo_agotado() {
        let (c, _) = ConectorFalso::nuevo(vec![Guion::FallaPermanente("El usuario o la contraseña de la cámara no son correctos.")], Guion::Muda);
        let r = probar_conexion(c, Duration::from_secs(2)).await;
        assert!(!r.ok && r.mensaje.contains("contraseña"));
        let (c, _) = ConectorFalso::nuevo(vec![Guion::Muda], Guion::Muda);
        let r = probar_conexion(c, Duration::from_millis(100)).await;
        assert!(!r.ok && r.mensaje.contains("a tiempo"), "{r:?}");
    }
}
