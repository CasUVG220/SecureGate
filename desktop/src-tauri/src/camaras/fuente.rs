//! Fuentes de fotogramas (T7, y base del OCR continuo del Sprint 10).
//!
//! `FuenteFotogramas` es la interfaz limpia que consumen la vista previa, la captura para el OCR y —más adelante— el OCR continuo:
//! da **el último fotograma JPEG** y **el estado de la conexión**; no sabe si detrás hay ffmpeg, un celular o un simulador.
//!
//! Un `Supervisor` mantiene viva una fuente: conecta, publica cada fotograma, vigila que no se quede callada (10 s sin imagen →
//! reconecta) y reintenta con espera exponencial. Estados: `Conectando` → `Conectada` ⇄ `Reconectando` → `Caida` (tras varios
//! fallos seguidos sigue intentando, pero se avisa como caída). Un error PERMANENTE (credenciales malas, dirección rechazada por
//! seguridad, redirección a otro host) NO se reintenta: reintentar con la contraseña mala bloquearía la cuenta de la cámara.
//!
//! Los fotogramas viven solo en memoria: no se escriben a disco ni se registran en logs.

use std::collections::VecDeque;
use std::future::Future;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tokio::sync::{mpsc, watch};

use super::backoff::Backoff;
use super::credenciales::Credenciales;
use super::jpeg::DivisorJpeg;
#[cfg(test)]
use super::ssrf::Resolvedor;
use super::ssrf::{self, DestinoValidado, ErrorSsrf, PuentePropio};

// ── Interfaz pública ─────────────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct Fotograma {
    pub jpeg: Arc<Vec<u8>>,
    /// Contador que sube con cada fotograma publicado (sirve para saber si hay uno nuevo).
    pub seq: u64,
    /// Milisegundos desde 1970 en que llegó.
    pub recibido_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "estado", rename_all = "snake_case")]
pub enum EstadoFuente {
    Detenida,
    Conectando,
    Conectada,
    Reconectando { intento: u32, proximo_en_s: u64, motivo: String },
    /// Sin imagen tras varios intentos seguidos (o por un error permanente). Con un error temporal sigue reintentando.
    Caida { motivo: String, intentos: u32, reintentando: bool },
}

pub trait FuenteFotogramas: Send + Sync {
    /// El último fotograma recibido, si hay.
    fn ultimo(&self) -> Option<Fotograma>;
    fn estado(&self) -> EstadoFuente;
    /// Se despierta con cada fotograma nuevo (el valor es su `seq`).
    fn suscribir(&self) -> watch::Receiver<u64>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ErrorFuente {
    /// Puede arreglarse solo (red, cámara reiniciando): se reintenta.
    Temporal(String),
    /// No se arregla reintentando (credenciales, seguridad): se detiene hasta que alguien lo corrija.
    Permanente(String),
}

impl ErrorFuente {
    pub fn mensaje(&self) -> &str {
        match self {
            ErrorFuente::Temporal(m) | ErrorFuente::Permanente(m) => m,
        }
    }
}

impl From<ErrorSsrf> for ErrorFuente {
    fn from(e: ErrorSsrf) -> Self {
        // Un nombre que no resuelve puede ser un fallo pasajero del DNS; lo demás es una decisión de seguridad.
        match e {
            ErrorSsrf::NoResuelve(_) => ErrorFuente::Temporal(e.mensaje()),
            _ => ErrorFuente::Permanente(e.mensaje()),
        }
    }
}

/// Un flujo ya conectado que entrega fotogramas.
pub trait FlujoFotogramas: Send + 'static {
    /// `Ok(None)` = la cámara cerró el flujo.
    fn siguiente(&mut self) -> impl Future<Output = Result<Option<Vec<u8>>, ErrorFuente>> + Send;
}

/// Sabe abrir una conexión nueva (se llama de nuevo en cada reintento: la validación de seguridad se repite).
pub trait Conector: Send + Sync + 'static {
    type Flujo: FlujoFotogramas;
    fn conectar(&self) -> impl Future<Output = Result<Self::Flujo, ErrorFuente>> + Send;
}

// ── Supervisor ───────────────────────────────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct ConfigSupervisor {
    /// Tiempo máximo para conectar y recibir el primer fotograma.
    pub espera_conexion: Duration,
    /// Sin fotogramas durante este tiempo se considera colgada y se reconecta.
    pub inactividad: Duration,
    /// Cuántos fallos seguidos antes de marcarla `Caida` (sigue reintentando).
    pub caida_tras: u32,
    pub backoff: Backoff,
    /// Aleatoriedad del jitter (en [0,1)); inyectable para probar.
    pub aleatorio: fn() -> f64,
}

impl Default for ConfigSupervisor {
    fn default() -> Self {
        Self {
            espera_conexion: Duration::from_secs(15),
            inactividad: Duration::from_secs(10),
            caida_tras: 5,
            backoff: Backoff::default(),
            aleatorio: || (SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.subsec_nanos()) % 1000) as f64 / 1000.0,
        }
    }
}

struct Compartido {
    estado: Mutex<EstadoFuente>,
    ultimo: Mutex<Option<Fotograma>>,
    tx_seq: watch::Sender<u64>,
}

/// Mantiene viva una fuente. Al soltarlo (o con `detener`) la tarea termina y el proceso/conexión se cierra.
pub struct Supervisor {
    compartido: Arc<Compartido>,
    tx_parar: watch::Sender<bool>,
}

impl Supervisor {
    pub fn iniciar<C: Conector>(conector: C, config: ConfigSupervisor) -> Self {
        let (tx_seq, _) = watch::channel(0u64);
        let (tx_parar, rx_parar) = watch::channel(false);
        let compartido = Arc::new(Compartido { estado: Mutex::new(EstadoFuente::Conectando), ultimo: Mutex::new(None), tx_seq });
        tokio::spawn(correr(conector, config, compartido.clone(), rx_parar));
        Supervisor { compartido, tx_parar }
    }

    pub fn detener(&self) {
        let _ = self.tx_parar.send(true);
    }
}

impl Drop for Supervisor {
    fn drop(&mut self) {
        self.detener();
    }
}

impl FuenteFotogramas for Supervisor {
    fn ultimo(&self) -> Option<Fotograma> {
        self.compartido.ultimo.lock().unwrap().clone()
    }
    fn estado(&self) -> EstadoFuente {
        self.compartido.estado.lock().unwrap().clone()
    }
    fn suscribir(&self) -> watch::Receiver<u64> {
        self.compartido.tx_seq.subscribe()
    }
}

fn ahora_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

async fn correr<C: Conector>(conector: C, mut cfg: ConfigSupervisor, comp: Arc<Compartido>, mut parar: watch::Receiver<bool>) {
    let poner = |e: EstadoFuente| *comp.estado.lock().unwrap() = e;
    let mut intentos_seguidos: u32 = 0;
    let mut seq: u64 = 0;

    loop {
        if *parar.borrow() {
            break;
        }
        let fallo: ErrorFuente = 'intento: {
            let flujo = tokio::select! {
                _ = parar.changed() => break 'intento ErrorFuente::Temporal("detenida".into()),
                r = tokio::time::timeout(cfg.espera_conexion, conector.conectar()) => match r {
                    Err(_) => break 'intento ErrorFuente::Temporal("La cámara tardó demasiado en responder.".into()),
                    Ok(Err(e)) => break 'intento e,
                    Ok(Ok(f)) => f,
                },
            };
            let mut flujo = flujo;
            let mut con_imagen = false;
            loop {
                let espera = if con_imagen { cfg.inactividad } else { cfg.espera_conexion };
                tokio::select! {
                    _ = parar.changed() => break 'intento ErrorFuente::Temporal("detenida".into()),
                    r = tokio::time::timeout(espera, flujo.siguiente()) => match r {
                        Err(_) => break 'intento ErrorFuente::Temporal(if con_imagen {
                            format!("La cámara dejó de enviar imagen durante {} s.", cfg.inactividad.as_secs())
                        } else {
                            "La cámara no envió imagen.".into()
                        }),
                        Ok(Err(e)) => break 'intento e,
                        Ok(Ok(None)) => break 'intento ErrorFuente::Temporal("La cámara cerró la conexión.".into()),
                        Ok(Ok(Some(jpeg))) => {
                            seq += 1;
                            *comp.ultimo.lock().unwrap() = Some(Fotograma { jpeg: Arc::new(jpeg), seq, recibido_ms: ahora_ms() });
                            let _ = comp.tx_seq.send(seq);
                            if !con_imagen {
                                con_imagen = true;
                                cfg.backoff.reiniciar();
                                intentos_seguidos = 0;
                                poner(EstadoFuente::Conectada);
                            }
                        }
                    },
                }
            }
        };

        if *parar.borrow() {
            break;
        }
        match fallo {
            ErrorFuente::Permanente(motivo) => {
                // Sin reintentos automáticos: alguien tiene que corregir la cámara y volver a encenderla.
                poner(EstadoFuente::Caida { motivo, intentos: intentos_seguidos + 1, reintentando: false });
                return;
            }
            ErrorFuente::Temporal(motivo) => {
                intentos_seguidos += 1;
                let espera = cfg.backoff.siguiente((cfg.aleatorio)());
                poner(if intentos_seguidos >= cfg.caida_tras {
                    EstadoFuente::Caida { motivo, intentos: intentos_seguidos, reintentando: true }
                } else {
                    EstadoFuente::Reconectando { intento: intentos_seguidos, proximo_en_s: espera.as_secs().max(1), motivo }
                });
                tokio::select! {
                    _ = parar.changed() => break,
                    _ = tokio::time::sleep(espera) => {}
                }
            }
        }
    }
    poner(EstadoFuente::Detenida);
}

// ── Procesos hijos (ffmpeg) ──────────────────────────────────────────────────────────────────────────────

#[derive(Debug)]
#[allow(dead_code)]       // el código de salida no se usa aún (solo importa que terminó), pero queda en el evento para diagnóstico
pub enum EventoProceso {
    Salida(Vec<u8>),
    Error(Vec<u8>),
    Terminado(Option<i32>),
}

/// Un proceso en marcha: eventos y forma de matarlo. `matar` también se llama al soltar el flujo.
pub struct ProcesoHijo {
    pub rx: mpsc::Receiver<EventoProceso>,
    pub matar: Box<dyn FnMut() + Send>,
}

pub trait Lanzador: Send + Sync {
    fn lanzar(&self, args: Vec<String>) -> Result<ProcesoHijo, String>;
}

/// Lanzador con `tokio::process` sobre un ejecutable concreto (pruebas y desarrollo). La app empaquetada usa el sidecar de Tauri.
#[allow(dead_code)]       // se usa en las pruebas de integración y sirve en desarrollo sin la app empaquetada
pub struct LanzadorTokio {
    pub ruta: std::path::PathBuf,
}

impl Lanzador for LanzadorTokio {
    fn lanzar(&self, args: Vec<String>) -> Result<ProcesoHijo, String> {
        use tokio::io::AsyncReadExt;
        use tokio::process::Command;
        let mut hijo = Command::new(&self.ruta)
            .args(&args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("no se pudo iniciar ffmpeg: {e}"))?;
        let mut out = hijo.stdout.take().ok_or("sin stdout")?;
        let mut err = hijo.stderr.take().ok_or("sin stderr")?;
        let (tx, rx) = mpsc::channel(64);
        let (tx_matar, mut rx_matar) = tokio::sync::oneshot::channel::<()>();
        let tx2 = tx.clone();
        tokio::spawn(async move {
            let mut b = vec![0u8; 64 * 1024];
            while let Ok(n) = out.read(&mut b).await {
                if n == 0 || tx2.send(EventoProceso::Salida(b[..n].to_vec())).await.is_err() {
                    break;
                }
            }
        });
        let tx3 = tx.clone();
        tokio::spawn(async move {
            let mut b = vec![0u8; 8 * 1024];
            while let Ok(n) = err.read(&mut b).await {
                if n == 0 || tx3.send(EventoProceso::Error(b[..n].to_vec())).await.is_err() {
                    break;
                }
            }
        });
        tokio::spawn(async move {
            tokio::select! {
                s = hijo.wait() => { let _ = tx.send(EventoProceso::Terminado(s.ok().and_then(|s| s.code()))).await; }
                _ = &mut rx_matar => { let _ = hijo.kill().await; let _ = tx.send(EventoProceso::Terminado(None)).await; }
            }
        });
        let mut tx_matar = Some(tx_matar);
        Ok(ProcesoHijo { rx, matar: Box::new(move || { if let Some(t) = tx_matar.take() { let _ = t.send(()); } }) })
    }
}

// ── RTSP por ffmpeg ──────────────────────────────────────────────────────────────────────────────────────

/// Qué dice una línea de stderr de ffmpeg que importe al puente. `None` = ruido.
pub fn interpretar_stderr(linea: &str) -> Option<ErrorFuente> {
    let l = linea.trim();
    if l.contains("Redirecting to") {
        // ffmpeg sigue por su cuenta las redirecciones RTSP: se corta antes de que cambie de host.
        return Some(ErrorFuente::Permanente(ErrorSsrf::RedireccionAOtroHost.mensaje()));
    }
    if l.contains("401 Unauthorized") || l.contains("Server returned 401") {
        return Some(ErrorFuente::Permanente("El usuario o la contraseña de la cámara no son correctos.".into()));
    }
    if l.contains("403 Forbidden") || l.contains("Server returned 403") {
        return Some(ErrorFuente::Permanente("La cámara no permite este usuario. Revisa sus permisos.".into()));
    }
    if l.contains("404 Not Found") || l.contains("Server returned 404") {
        return Some(ErrorFuente::Permanente("La cámara no tiene video en esa ruta (404). Revisa la dirección.".into()));
    }
    if l.contains("Connection refused") {
        return Some(ErrorFuente::Temporal("La cámara rechazó la conexión. Revisa la dirección y el puerto.".into()));
    }
    if l.contains("No route to host") || l.contains("Network is unreachable") {
        return Some(ErrorFuente::Temporal("No se llega a la cámara desde esta red.".into()));
    }
    if l.contains("timed out") || l.contains("Connection timed out") {
        return Some(ErrorFuente::Temporal("La cámara no respondió a tiempo.".into()));
    }
    None
}

/// Argumentos de ffmpeg: RTSP por TCP, sin audio, `fps` fotogramas por segundo, `ancho` px de ancho, JPEG uno tras otro por stdout.
pub fn args_ffmpeg(url: &str, fps: u32, ancho: u32, calidad: u32) -> Vec<String> {
    let v = |s: &str| s.to_string();
    vec![
        v("-hide_banner"), v("-nostdin"), v("-loglevel"), v("info"),
        v("-rtsp_transport"), v("tcp"),
        v("-i"), url.to_string(),
        v("-an"),
        v("-vf"), format!("fps={fps},scale={ancho}:-2"),
        v("-c:v"), v("mjpeg"), v("-q:v"), calidad.to_string(),
        v("-f"), v("mjpeg"), v("pipe:1"),
    ]
}

#[derive(Clone)]
pub struct OpcionesVideo {
    pub fps: u32,
    pub ancho: u32,
    pub calidad: u32,
}

impl Default for OpcionesVideo {
    fn default() -> Self {
        Self { fps: 10, ancho: 960, calidad: 5 }
    }
}

/// Una función que valida (y resuelve) la dirección CADA vez que se conecta: un DNS que cambió o una IP que dejó de ser privada se detectan.
pub type Validador = Arc<dyn Fn() -> Result<DestinoValidado, ErrorSsrf> + Send + Sync>;

/// Validador estándar: analiza la URL guardada y la valida contra el resolvedor del sistema (en un hilo aparte: puede bloquear).
pub fn validador_sistema(url: String, puente: Option<PuentePropio>) -> Validador {
    Arc::new(move || ssrf::validar(&url, &super::ssrf::ResolvedorSistema, puente))
}

pub struct ConectorRtsp {
    pub lanzador: Arc<dyn Lanzador>,
    pub validar: Validador,
    pub credenciales: Option<Credenciales>,
    pub opciones: OpcionesVideo,
}

pub struct FlujoRtsp {
    rx: mpsc::Receiver<EventoProceso>,
    matar: Box<dyn FnMut() + Send>,
    divisor: DivisorJpeg,
    listos: VecDeque<Vec<u8>>,
    ultimo_error: Option<ErrorFuente>,
    pendiente_err: Vec<u8>,
}

impl Drop for FlujoRtsp {
    fn drop(&mut self) {
        (self.matar)();
    }
}

impl FlujoRtsp {
    fn lineas_de_error(&mut self, bytes: &[u8]) -> Option<ErrorFuente> {
        self.pendiente_err.extend_from_slice(bytes);
        let mut hallado: Option<ErrorFuente> = None;
        while let Some(pos) = self.pendiente_err.iter().position(|b| *b == b'\n' || *b == b'\r') {
            let linea: Vec<u8> = self.pendiente_err.drain(..=pos).collect();
            if let Some(e) = interpretar_stderr(&String::from_utf8_lossy(&linea)) {
                // Un error permanente gana sobre uno temporal.
                if hallado.is_none() || matches!(e, ErrorFuente::Permanente(_)) {
                    hallado = Some(e);
                }
            }
        }
        if self.pendiente_err.len() > 16 * 1024 {
            self.pendiente_err.clear();
        }
        hallado
    }
}

impl FlujoFotogramas for FlujoRtsp {
    async fn siguiente(&mut self) -> Result<Option<Vec<u8>>, ErrorFuente> {
        loop {
            if let Some(f) = self.listos.pop_front() {
                return Ok(Some(f));
            }
            match self.rx.recv().await {
                Some(EventoProceso::Salida(b)) => self.listos.extend(self.divisor.empujar(&b)),
                Some(EventoProceso::Error(b)) => {
                    if let Some(e) = self.lineas_de_error(&b) {
                        match e {
                            ErrorFuente::Permanente(_) => return Err(e),       // se corta de inmediato (redirección, 401…)
                            _ => self.ultimo_error = Some(e),
                        }
                    }
                }
                Some(EventoProceso::Terminado(_)) | None => {
                    return Err(self.ultimo_error.take().unwrap_or_else(|| ErrorFuente::Temporal("La cámara cerró la conexión.".into())));
                }
            }
        }
    }
}

impl Conector for ConectorRtsp {
    type Flujo = FlujoRtsp;

    async fn conectar(&self) -> Result<FlujoRtsp, ErrorFuente> {
        // La resolución de nombres puede bloquear: va en un hilo aparte.
        let validar = self.validar.clone();
        let destino = tokio::task::spawn_blocking(move || validar())
            .await
            .map_err(|_| ErrorFuente::Temporal("error interno al validar la cámara".into()))??;
        let url = destino.url_para_conectar(self.credenciales.as_ref().map(|c| (c.usuario.as_str(), c.clave.as_str())));
        let args = args_ffmpeg(&url, self.opciones.fps, self.opciones.ancho, self.opciones.calidad);
        let proceso = self.lanzador.lanzar(args).map_err(ErrorFuente::Temporal)?;
        Ok(FlujoRtsp {
            rx: proceso.rx, matar: proceso.matar, divisor: DivisorJpeg::new(), listos: VecDeque::new(), ultimo_error: None, pendiente_err: Vec::new(),
        })
    }
}

// ── MJPEG por HTTP (celular) ─────────────────────────────────────────────────────────────────────────────

pub struct ConectorMjpeg {
    pub validar: Validador,
    pub credenciales: Option<Credenciales>,
}

pub struct FlujoMjpeg {
    resp: reqwest::Response,
    divisor: DivisorJpeg,
    listos: VecDeque<Vec<u8>>,
}

impl FlujoFotogramas for FlujoMjpeg {
    async fn siguiente(&mut self) -> Result<Option<Vec<u8>>, ErrorFuente> {
        loop {
            if let Some(f) = self.listos.pop_front() {
                return Ok(Some(f));
            }
            match self.resp.chunk().await {
                Ok(Some(b)) => self.listos.extend(self.divisor.empujar(&b)),
                Ok(None) => return Ok(None),
                Err(_) => return Err(ErrorFuente::Temporal("Se perdió la conexión con la cámara.".into())),
            }
        }
    }
}

/// Máximo de redirecciones (todas al mismo host) que se siguen.
const MAX_REDIRECCIONES: u8 = 3;

impl Conector for ConectorMjpeg {
    type Flujo = FlujoMjpeg;

    async fn conectar(&self) -> Result<FlujoMjpeg, ErrorFuente> {
        let validar = self.validar.clone();
        let mut destino = tokio::task::spawn_blocking(move || validar())
            .await
            .map_err(|_| ErrorFuente::Temporal("error interno al validar la cámara".into()))??;
        if !matches!(destino.esquema.as_str(), "http" | "https") {
            return Err(ErrorFuente::Permanente("Las cámaras de este tipo usan una dirección http:// (por ejemplo http://192.168.1.60:8080/video).".into()));
        }
        for _ in 0..=MAX_REDIRECCIONES {
            // Se conecta a la IP YA validada (no se vuelve a resolver el nombre) y las redirecciones las decidimos nosotros.
            let cliente = reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .resolve(&destino.host, destino.socket())
                .connect_timeout(Duration::from_secs(8))
                .user_agent("SecureGate-Garita")
                .build()
                .map_err(|_| ErrorFuente::Temporal("no se pudo preparar la conexión".into()))?;
            let url = format!("{}://{}:{}{}", destino.esquema, host_para_url(&destino), destino.puerto, destino.ruta);
            let mut req = cliente.get(&url);
            if let Some(c) = &self.credenciales {
                req = req.basic_auth(&c.usuario, Some(&c.clave));
            }
            let resp = req.send().await.map_err(|e| {
                if e.is_connect() || e.is_timeout() {
                    ErrorFuente::Temporal("No se pudo conectar con la cámara. Revisa que el celular y esta computadora estén en la misma red.".into())
                } else {
                    ErrorFuente::Temporal("Falló la conexión con la cámara.".into())
                }
            })?;
            let estado = resp.status();
            if estado.is_redirection() {
                let ubicacion = resp.headers().get(reqwest::header::LOCATION).and_then(|v| v.to_str().ok()).unwrap_or_default().to_string();
                ssrf::redireccion_permitida(&destino, &ubicacion).map_err(ErrorFuente::from)?;
                // Misma máquina: se actualiza solo la ruta.
                let nueva = url::Url::parse(&format!("{}://{}:{}{}", destino.esquema, host_para_url(&destino), destino.puerto, destino.ruta))
                    .and_then(|b| b.join(&ubicacion))
                    .map_err(|_| ErrorFuente::Permanente(ErrorSsrf::Invalida.mensaje()))?;
                destino.ruta = match nueva.query() {
                    Some(q) => format!("{}?{q}", nueva.path()),
                    None => nueva.path().to_string(),
                };
                continue;
            }
            return match estado.as_u16() {
                200..=299 => Ok(FlujoMjpeg { resp, divisor: DivisorJpeg::new(), listos: VecDeque::new() }),
                401 => Err(ErrorFuente::Permanente("El usuario o la contraseña de la cámara no son correctos.".into())),
                403 => Err(ErrorFuente::Permanente("La cámara no permite este usuario. Revisa sus permisos.".into())),
                404 => Err(ErrorFuente::Permanente("La cámara no tiene video en esa ruta (404). Revisa la dirección.".into())),
                c => Err(ErrorFuente::Temporal(format!("La cámara respondió con un error ({c})."))),
            };
        }
        Err(ErrorFuente::Permanente("La cámara redirigió demasiadas veces.".into()))
    }
}

fn host_para_url(d: &DestinoValidado) -> String {
    match d.ip {
        std::net::IpAddr::V4(v) => v.to_string(),
        std::net::IpAddr::V6(v) => format!("[{v}]"),
    }
}

// ── Pruebas ──────────────────────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
pub mod pruebas {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Resolvedor de pruebas (nada de red).
    pub struct Fijo(pub Vec<std::net::IpAddr>);
    impl Resolvedor for Fijo {
        fn resolver(&self, _: &str, _: u16) -> Result<Vec<std::net::IpAddr>, String> {
            Ok(self.0.clone())
        }
    }

    /// Qué hace un intento de conexión simulado.
    #[derive(Clone)]
    pub enum Guion {
        FallaTemporal(&'static str),
        FallaPermanente(&'static str),
        /// Entrega estos fotogramas (con una pausa entre cada uno) y luego se queda callada para siempre.
        Fotogramas(Vec<Vec<u8>>, Duration),
        /// Entrega estos fotogramas y cierra la conexión.
        FotogramasYCierra(Vec<Vec<u8>>),
        /// Conecta y no manda nada nunca.
        Muda,
    }

    pub struct ConectorFalso {
        pub guion: Mutex<VecDeque<Guion>>,
        pub intentos: Arc<AtomicUsize>,
        pub ultimo: Guion,
    }

    impl ConectorFalso {
        pub fn nuevo(pasos: Vec<Guion>, ultimo: Guion) -> (Self, Arc<AtomicUsize>) {
            let intentos = Arc::new(AtomicUsize::new(0));
            (Self { guion: Mutex::new(pasos.into()), intentos: intentos.clone(), ultimo }, intentos)
        }
    }

    pub struct FlujoFalso {
        cola: VecDeque<Vec<u8>>,
        pausa: Duration,
        al_final_cierra: bool,
    }

    impl FlujoFotogramas for FlujoFalso {
        async fn siguiente(&mut self) -> Result<Option<Vec<u8>>, ErrorFuente> {
            if let Some(f) = self.cola.pop_front() {
                tokio::time::sleep(self.pausa).await;
                return Ok(Some(f));
            }
            if self.al_final_cierra {
                return Ok(None);
            }
            std::future::pending::<()>().await;
            unreachable!()
        }
    }

    impl Conector for ConectorFalso {
        type Flujo = FlujoFalso;
        async fn conectar(&self) -> Result<FlujoFalso, ErrorFuente> {
            self.intentos.fetch_add(1, Ordering::SeqCst);
            let paso = self.guion.lock().unwrap().pop_front().unwrap_or_else(|| self.ultimo.clone());
            match paso {
                Guion::FallaTemporal(m) => Err(ErrorFuente::Temporal(m.into())),
                Guion::FallaPermanente(m) => Err(ErrorFuente::Permanente(m.into())),
                Guion::Fotogramas(f, pausa) => Ok(FlujoFalso { cola: f.into(), pausa, al_final_cierra: false }),
                Guion::FotogramasYCierra(f) => Ok(FlujoFalso { cola: f.into(), pausa: Duration::ZERO, al_final_cierra: true }),
                Guion::Muda => Ok(FlujoFalso { cola: VecDeque::new(), pausa: Duration::ZERO, al_final_cierra: false }),
            }
        }
    }

    pub fn cfg() -> ConfigSupervisor {
        ConfigSupervisor { aleatorio: || 0.5, backoff: Backoff::con(Duration::from_secs(1), Duration::from_secs(30), 0.0), ..Default::default() }
    }

    pub async fn avanzar(ms: u64) {
        tokio::time::sleep(Duration::from_millis(ms)).await;
        // Cede el turno varias veces para que las tareas simuladas procesen lo pendiente.
        for _ in 0..10 {
            tokio::task::yield_now().await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::pruebas::*;
    use super::*;
    use crate::camaras::jpeg::jpeg_de_prueba;
    use std::sync::atomic::Ordering;

    fn foto(n: u8) -> Vec<u8> {
        jpeg_de_prueba(&[n; 4])
    }

    #[tokio::test(start_paused = true)]
    async fn conecta_publica_el_ultimo_fotograma_y_avisa_cada_uno() {
        let (c, _) = ConectorFalso::nuevo(vec![Guion::Fotogramas(vec![foto(1), foto(2), foto(3)], Duration::from_millis(100))], Guion::Muda);
        let s = Supervisor::iniciar(c, cfg());
        let mut rx = s.suscribir();
        assert_eq!(s.estado(), EstadoFuente::Conectando);
        rx.changed().await.unwrap();
        assert_eq!(s.estado(), EstadoFuente::Conectada);
        avanzar(500).await;
        let f = s.ultimo().unwrap();
        assert_eq!((f.seq, f.jpeg.as_ref()), (3, &foto(3)));
    }

    #[tokio::test(start_paused = true)]
    async fn reconecta_con_espera_exponencial_y_pasa_por_reconectando() {
        let pasos = vec![Guion::FallaTemporal("sin red"), Guion::FallaTemporal("sin red"), Guion::FallaTemporal("sin red")];
        let (c, intentos) = ConectorFalso::nuevo(pasos, Guion::Fotogramas(vec![foto(9)], Duration::from_millis(10)));
        let s = Supervisor::iniciar(c, cfg());
        avanzar(10).await;
        assert_eq!(intentos.load(Ordering::SeqCst), 1);
        assert_eq!(s.estado(), EstadoFuente::Reconectando { intento: 1, proximo_en_s: 1, motivo: "sin red".into() });
        avanzar(1000).await;                                       // espera de 1 s → segundo intento
        assert_eq!(intentos.load(Ordering::SeqCst), 2);
        assert_eq!(s.estado(), EstadoFuente::Reconectando { intento: 2, proximo_en_s: 2, motivo: "sin red".into() });
        avanzar(2000).await;                                       // espera de 2 s → tercer intento
        assert_eq!(intentos.load(Ordering::SeqCst), 3);
        assert!(matches!(s.estado(), EstadoFuente::Reconectando { intento: 3, proximo_en_s: 4, .. }));
        avanzar(4000).await;                                       // espera de 4 s → cuarto intento: ya conecta
        assert_eq!(intentos.load(Ordering::SeqCst), 4);
        assert_eq!(s.estado(), EstadoFuente::Conectada);
        assert!(s.ultimo().is_some());
    }

    #[tokio::test(start_paused = true)]
    async fn tras_varios_fallos_seguidos_queda_caida_pero_sigue_intentando_y_se_recupera() {
        let pasos = (0..5).map(|_| Guion::FallaTemporal("rechazada")).collect();
        let (c, intentos) = ConectorFalso::nuevo(pasos, Guion::Fotogramas(vec![foto(1)], Duration::from_millis(10)));
        let s = Supervisor::iniciar(c, cfg());
        // 1 + 2 + 4 + 8 s de espera entre los 5 primeros intentos
        avanzar(15_100).await;
        assert!(matches!(s.estado(), EstadoFuente::Caida { intentos: 5, reintentando: true, .. }), "{:?}", s.estado());
        assert_eq!(intentos.load(Ordering::SeqCst), 5);
        avanzar(16_000).await;                                      // la espera de 16 s → sexto intento: conecta
        assert_eq!(s.estado(), EstadoFuente::Conectada);
    }

    #[tokio::test(start_paused = true)]
    async fn tras_conectar_con_imagen_el_backoff_vuelve_a_empezar() {
        // Conecta, manda un fotograma, se cae; el siguiente reintento espera 1 s (no 8).
        let pasos = vec![Guion::FallaTemporal("x"), Guion::FallaTemporal("x"), Guion::FotogramasYCierra(vec![foto(1)])];
        let (c, intentos) = ConectorFalso::nuevo(pasos, Guion::Muda);
        let s = Supervisor::iniciar(c, cfg());
        avanzar(3100).await;                                        // 1 s + 2 s
        assert_eq!(intentos.load(Ordering::SeqCst), 3);
        assert!(s.ultimo().is_some());
        assert!(matches!(s.estado(), EstadoFuente::Reconectando { intento: 1, proximo_en_s: 1, .. }), "{:?}", s.estado());
    }

    #[tokio::test(start_paused = true)]
    async fn si_la_camara_se_queda_muda_el_vigilante_la_reconecta() {
        let pasos = vec![Guion::Fotogramas(vec![foto(1)], Duration::from_millis(10)), Guion::Fotogramas(vec![foto(2)], Duration::from_millis(10))];
        let (c, intentos) = ConectorFalso::nuevo(pasos, Guion::Muda);
        let s = Supervisor::iniciar(c, cfg());
        avanzar(100).await;
        assert_eq!(s.estado(), EstadoFuente::Conectada);
        avanzar(10_000).await;                                      // 10 s sin imagen
        assert!(matches!(s.estado(), EstadoFuente::Reconectando { ref motivo, .. } if motivo.contains("dejó de enviar")), "{:?}", s.estado());
        avanzar(1100).await;                                        // reintenta tras 1 s
        assert_eq!(intentos.load(Ordering::SeqCst), 2);
        assert_eq!(s.ultimo().unwrap().seq, 2);
    }

    #[tokio::test(start_paused = true)]
    async fn un_error_permanente_no_se_reintenta() {
        let (c, intentos) = ConectorFalso::nuevo(vec![Guion::FallaPermanente("credenciales")], Guion::Muda);
        let s = Supervisor::iniciar(c, cfg());
        avanzar(60_000).await;
        assert_eq!(intentos.load(Ordering::SeqCst), 1, "no hay reintentos: bloquearía la cuenta de la cámara");
        assert_eq!(s.estado(), EstadoFuente::Caida { motivo: "credenciales".into(), intentos: 1, reintentando: false });
    }

    #[tokio::test(start_paused = true)]
    async fn detener_para_la_tarea_y_deja_el_estado_detenida() {
        let (c, intentos) = ConectorFalso::nuevo(vec![], Guion::FallaTemporal("x"));
        let s = Supervisor::iniciar(c, cfg());
        avanzar(100).await;
        s.detener();
        avanzar(100_000).await;
        assert_eq!(s.estado(), EstadoFuente::Detenida);
        let n = intentos.load(Ordering::SeqCst);
        avanzar(100_000).await;
        assert_eq!(intentos.load(Ordering::SeqCst), n, "ya no reintenta");
    }

    #[tokio::test(start_paused = true)]
    async fn si_nunca_llega_el_primer_fotograma_se_reconecta() {
        let (c, intentos) = ConectorFalso::nuevo(vec![Guion::Muda], Guion::Fotogramas(vec![foto(1)], Duration::from_millis(10)));
        let s = Supervisor::iniciar(c, cfg());
        avanzar(15_100).await;                                      // espera_conexion = 15 s
        assert!(matches!(s.estado(), EstadoFuente::Reconectando { .. }), "{:?}", s.estado());
        avanzar(1100).await;
        assert_eq!(intentos.load(Ordering::SeqCst), 2);
        assert_eq!(s.estado(), EstadoFuente::Conectada);
    }

    // ── interpretación de ffmpeg ──
    #[test]
    fn stderr_de_ffmpeg_a_errores_entendibles() {
        let casos = [
            ("[rtsp @ 0x55] method DESCRIBE failed: 401 Unauthorized", true, "contraseña"),
            ("Error opening input: Server returned 404 Not Found", true, "404"),
            ("[tcp @ 0x55] Connection to tcp://192.168.1.5:554?timeout=0 failed: Connection refused", false, "rechazó"),
            ("Connection to tcp://192.168.1.5:554 failed: No route to host", false, "No se llega"),
            ("[rtsp @ 0x5] Status 302: Redirecting to rtsp://8.8.8.8/x", true, "otro equipo"),
        ];
        for (linea, permanente, trozo) in casos {
            let e = interpretar_stderr(linea).unwrap_or_else(|| panic!("sin interpretar: {linea}"));
            assert_eq!(matches!(e, ErrorFuente::Permanente(_)), permanente, "{linea}");
            assert!(e.mensaje().contains(trozo), "{linea} → {}", e.mensaje());
        }
        assert_eq!(interpretar_stderr("Input #0, rtsp, from 'rtsp://x'"), None);
        assert_eq!(interpretar_stderr("frame=  10 fps=10"), None);
    }

    #[test]
    fn los_mensajes_de_error_no_incluyen_la_url_ni_las_credenciales() {
        let e = interpretar_stderr("[rtsp @ 0x5] method DESCRIBE failed: 401 Unauthorized rtsp://admin:SuperSecreta@192.168.1.5/live").unwrap();
        assert!(!e.mensaje().contains("SuperSecreta") && !e.mensaje().contains("192.168"), "{}", e.mensaje());
    }

    #[test]
    fn argumentos_de_ffmpeg() {
        let a = args_ffmpeg("rtsp://192.168.1.5:554/live", 10, 960, 5);
        let s = a.join(" ");
        assert!(s.contains("-rtsp_transport tcp") && s.contains("-an") && s.contains("fps=10,scale=960:-2") && s.contains("-f mjpeg pipe:1"));
        assert!(s.contains("-nostdin"));
        assert_eq!(a[a.iter().position(|x| x == "-i").unwrap() + 1], "rtsp://192.168.1.5:554/live");
    }

    // ── conector RTSP con un lanzador falso (sin ffmpeg) ──
    struct LanzadorFalso {
        eventos: Mutex<Vec<EventoProceso>>,
        args: Arc<Mutex<Vec<Vec<String>>>>,
        matado: Arc<std::sync::atomic::AtomicBool>,
    }
    impl Lanzador for LanzadorFalso {
        fn lanzar(&self, args: Vec<String>) -> Result<ProcesoHijo, String> {
            self.args.lock().unwrap().push(args);
            let (tx, rx) = mpsc::channel(64);
            for e in self.eventos.lock().unwrap().drain(..) {
                tx.try_send(e).unwrap();
            }
            let matado = self.matado.clone();
            // Se conserva `tx` vivo para que el canal no se cierre solo.
            let guardar = Mutex::new(Some(tx));
            Ok(ProcesoHijo { rx, matar: Box::new(move || { matado.store(true, Ordering::SeqCst); guardar.lock().unwrap().take(); }) })
        }
    }

    fn conector_rtsp(eventos: Vec<EventoProceso>, cred: Option<Credenciales>) -> (ConectorRtsp, Arc<Mutex<Vec<Vec<String>>>>, Arc<std::sync::atomic::AtomicBool>) {
        let args = Arc::new(Mutex::new(Vec::new()));
        let matado = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let l = LanzadorFalso { eventos: Mutex::new(eventos), args: args.clone(), matado: matado.clone() };
        let validar: Validador = Arc::new(|| ssrf::validar("rtsp://192.168.1.50:554/live", &Fijo(vec![]), None));
        (ConectorRtsp { lanzador: Arc::new(l), validar, credenciales: cred, opciones: OpcionesVideo::default() }, args, matado)
    }

    #[tokio::test]
    async fn el_conector_rtsp_entrega_los_jpeg_que_salen_del_proceso_y_lo_mata_al_soltar() {
        let a = foto(1);
        let b = foto(2);
        let mut flujo_bytes = a.clone();
        flujo_bytes.extend_from_slice(&b);
        let (corte1, corte2) = flujo_bytes.split_at(7);
        let (c, args, matado) = conector_rtsp(
            vec![EventoProceso::Salida(corte1.to_vec()), EventoProceso::Salida(corte2.to_vec())],
            Some(Credenciales { usuario: "admin".into(), clave: "s3cr3t".into() }),
        );
        let mut flujo = c.conectar().await.unwrap();
        assert_eq!(flujo.siguiente().await.unwrap(), Some(a));
        assert_eq!(flujo.siguiente().await.unwrap(), Some(b));
        let usado = args.lock().unwrap()[0].join(" ");
        assert!(usado.contains("rtsp://admin:s3cr3t@192.168.1.50:554/live"), "ffmpeg sí recibe las credenciales");
        drop(flujo);
        assert!(matado.load(Ordering::SeqCst), "al soltar el flujo se mata el proceso");
    }

    #[tokio::test]
    async fn una_redireccion_o_un_401_en_stderr_cortan_el_flujo_como_error_permanente() {
        for (linea, trozo) in [
            ("[rtsp @ 0x5] Status 301: Redirecting to rtsp://10.0.0.9/otra\n", "otro equipo"),
            ("[rtsp @ 0x5] method DESCRIBE failed: 401 Unauthorized\n", "contraseña"),
        ] {
            let (c, _, matado) = conector_rtsp(vec![EventoProceso::Error(linea.as_bytes().to_vec())], None);
            let mut flujo = c.conectar().await.unwrap();
            let e = flujo.siguiente().await.unwrap_err();
            assert!(matches!(&e, ErrorFuente::Permanente(m) if m.contains(trozo)), "{e:?}");
            drop(flujo);
            assert!(matado.load(Ordering::SeqCst));
        }
    }

    #[tokio::test]
    async fn si_ffmpeg_termina_se_informa_el_ultimo_error_temporal_visto() {
        let (c, _, _) = conector_rtsp(
            vec![EventoProceso::Error(b"Connection to tcp://192.168.1.50:554 failed: Connection refused\n".to_vec()), EventoProceso::Terminado(Some(1))],
            None,
        );
        let mut flujo = c.conectar().await.unwrap();
        let e = flujo.siguiente().await.unwrap_err();
        assert!(matches!(e, ErrorFuente::Temporal(m) if m.contains("rechazó")));
    }

    #[tokio::test]
    async fn el_conector_rechaza_antes_de_lanzar_nada_una_direccion_publica() {
        let args = Arc::new(Mutex::new(Vec::new()));
        let l = LanzadorFalso { eventos: Mutex::new(vec![]), args: args.clone(), matado: Arc::new(Default::default()) };
        let validar: Validador = Arc::new(|| ssrf::validar("rtsp://8.8.8.8/live", &Fijo(vec![]), None));
        let c = ConectorRtsp { lanzador: Arc::new(l), validar, credenciales: None, opciones: OpcionesVideo::default() };
        let e = c.conectar().await.err().expect("debe rechazar");
        assert!(matches!(e, ErrorFuente::Permanente(_)));
        assert!(args.lock().unwrap().is_empty(), "no se lanzó ffmpeg");
    }
}
