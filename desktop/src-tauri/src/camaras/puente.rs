//! Puente local de video (T7): sirve el último fotograma de cada cámara a la vista previa del WebView.
//!
//! - Escucha SOLO en `127.0.0.1` (puerto aleatorio): otros equipos de la red no lo alcanzan.
//! - **Token efímero** por ejecución (256 bits al azar, comparación en tiempo constante) en `?t=`: otro proceso del equipo, o una
//!   página web abierta en el navegador del equipo, no puede leer las cámaras sin conocerlo (y el token solo viaja Rust → WebView).
//! - Valida `Host` (`127.0.0.1:<puerto>` o `localhost:<puerto>`: frena el DNS rebinding) y `Origin` (si viene, debe ser uno de la app).
//! - Solo `GET`, encabezados de máximo 8 KB y 5 s para recibirlos, 16 conexiones a la vez.
//!
//! Rutas: `/v/<id>?t=<token>` → `multipart/x-mixed-replace` (para un `<img>`) y `/f/<id>?t=<token>` → un JPEG (el último).
//! Los fotogramas salen de la memoria del proceso: nada se escribe a disco ni a logs.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Semaphore;

use super::fuente::FuenteFotogramas;

const MAX_ENCABEZADOS: usize = 8 * 1024;
const ESPERA_ENCABEZADOS: Duration = Duration::from_secs(5);
const MAX_CONEXIONES: usize = 16;
/// Sin fotogramas nuevos durante tanto tiempo se cierra el flujo (el `<img>` falla y la pantalla muestra el estado de la cámara).
const ESPERA_SIN_IMAGEN: Duration = Duration::from_secs(60);
const FRONTERA: &str = "sgframe";

type Registro = Arc<RwLock<HashMap<String, Arc<dyn FuenteFotogramas>>>>;

pub struct Puente {
    addr: SocketAddr,
    token: String,
    registro: Registro,
}

/// 256 bits al azar (dos UUID v4 sin guiones).
fn token_nuevo() -> String {
    format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
}

/// Comparación en tiempo constante (no se corta en la primera diferencia).
fn iguales(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

impl Puente {
    /// Abre el puerto y empieza a atender. `origenes`: los de la app (`http://tauri.localhost`, etc.).
    pub async fn iniciar(origenes: Vec<String>) -> std::io::Result<Arc<Puente>> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let addr = listener.local_addr()?;
        let puente = Arc::new(Puente { addr, token: token_nuevo(), registro: Arc::default() });
        let p = puente.clone();
        let origenes = Arc::new(origenes);
        let limite = Arc::new(Semaphore::new(MAX_CONEXIONES));
        tokio::spawn(async move {
            loop {
                let Ok((socket, _)) = listener.accept().await else { break };
                let Ok(permiso) = limite.clone().try_acquire_owned() else {
                    // Demasiadas conexiones: se cierra sin responder.
                    drop(socket);
                    continue;
                };
                let p = p.clone();
                let origenes = origenes.clone();
                tokio::spawn(async move {
                    let _ = atender(socket, &p, &origenes).await;
                    drop(permiso);
                });
            }
        });
        Ok(puente)
    }

    pub fn puerto(&self) -> u16 {
        self.addr.port()
    }
    pub fn direccion(&self) -> SocketAddr {
        self.addr
    }
    pub fn token(&self) -> &str {
        &self.token
    }
    pub fn registrar(&self, id: &str, fuente: Arc<dyn FuenteFotogramas>) {
        self.registro.write().unwrap().insert(id.to_string(), fuente);
    }
    pub fn quitar(&self, id: &str) {
        self.registro.write().unwrap().remove(id);
    }
    fn buscar(&self, id: &str) -> Option<Arc<dyn FuenteFotogramas>> {
        self.registro.read().unwrap().get(id).cloned()
    }
}

struct Peticion {
    metodo: String,
    ruta: String,
    consulta: HashMap<String, String>,
    encabezados: HashMap<String, String>,
}

fn analizar(texto: &str) -> Option<Peticion> {
    let mut lineas = texto.split("\r\n");
    let primera = lineas.next()?;
    let mut partes = primera.split(' ');
    let metodo = partes.next()?.to_string();
    let destino = partes.next()?;
    if !partes.next()?.starts_with("HTTP/1.") {
        return None;
    }
    let (ruta, q) = destino.split_once('?').unwrap_or((destino, ""));
    let consulta = q.split('&').filter_map(|kv| kv.split_once('=')).map(|(k, v)| (k.to_string(), v.to_string())).collect();
    let encabezados = lineas
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string()))
        .collect();
    Some(Peticion { metodo, ruta: ruta.to_string(), consulta, encabezados })
}

async fn responder(s: &mut TcpStream, codigo: u16, razon: &str, cuerpo: &str) -> std::io::Result<()> {
    let r = format!(
        "HTTP/1.1 {codigo} {razon}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n{cuerpo}",
        cuerpo.len()
    );
    s.write_all(r.as_bytes()).await?;
    s.shutdown().await
}

async fn atender(mut s: TcpStream, p: &Puente, origenes: &[String]) -> std::io::Result<()> {
    // 1) Encabezados, con tope de tamaño y de tiempo.
    let mut buf = Vec::with_capacity(1024);
    let leido = tokio::time::timeout(ESPERA_ENCABEZADOS, async {
        let mut b = [0u8; 1024];
        loop {
            let n = s.read(&mut b).await?;
            if n == 0 {
                return Ok::<bool, std::io::Error>(false);
            }
            buf.extend_from_slice(&b[..n]);
            if buf.windows(4).any(|w| w == b"\r\n\r\n") {
                return Ok(true);
            }
            if buf.len() > MAX_ENCABEZADOS {
                return Ok(false);
            }
        }
    })
    .await;
    match leido {
        Ok(Ok(true)) => {}
        Ok(Ok(false)) if buf.len() > MAX_ENCABEZADOS => return responder(&mut s, 431, "Request Header Fields Too Large", "Encabezados demasiado largos").await,
        _ => return Ok(()),
    }
    let texto = String::from_utf8_lossy(&buf).to_string();
    let Some(req) = analizar(&texto) else {
        return responder(&mut s, 400, "Bad Request", "Petición inválida").await;
    };
    if req.metodo != "GET" {
        return responder(&mut s, 405, "Method Not Allowed", "Solo GET").await;
    }
    // 2) Host: frena el DNS rebinding (una página que apunte su nombre a 127.0.0.1 enviaría otro Host).
    let host = req.encabezados.get("host").map(|h| h.to_ascii_lowercase()).unwrap_or_default();
    let puerto = p.puerto();
    if host != format!("127.0.0.1:{puerto}") && host != format!("localhost:{puerto}") {
        return responder(&mut s, 403, "Forbidden", "Host no permitido").await;
    }
    // 3) Origin (si el navegador lo manda) debe ser de la app.
    if let Some(o) = req.encabezados.get("origin") {
        if !origenes.iter().any(|x| x.eq_ignore_ascii_case(o)) {
            return responder(&mut s, 403, "Forbidden", "Origen no permitido").await;
        }
    }
    // 4) Token.
    let token = req.consulta.get("t").map(String::as_str).unwrap_or_default();
    if !iguales(token.as_bytes(), p.token.as_bytes()) {
        return responder(&mut s, 403, "Forbidden", "Token inválido").await;
    }
    // 5) Ruta.
    let (modo, id) = match req.ruta.strip_prefix("/v/").map(|i| ("v", i)).or_else(|| req.ruta.strip_prefix("/f/").map(|i| ("f", i))) {
        Some(x) => x,
        None => return responder(&mut s, 404, "Not Found", "No existe").await,
    };
    let Some(fuente) = p.buscar(id) else {
        return responder(&mut s, 404, "Not Found", "Cámara no encontrada").await;
    };

    if modo == "f" {
        let Some(f) = fuente.ultimo() else {
            return responder(&mut s, 503, "Service Unavailable", "Todavía no hay imagen").await;
        };
        let cab = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: image/jpeg\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
            f.jpeg.len()
        );
        s.write_all(cab.as_bytes()).await?;
        s.write_all(&f.jpeg).await?;
        return s.shutdown().await;
    }

    // 6) Flujo multipart hasta que el cliente se vaya o la cámara no mande nada durante un minuto.
    let cab = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary={FRONTERA}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n"
    );
    s.write_all(cab.as_bytes()).await?;
    let mut rx = fuente.suscribir();
    let mut ultimo_enviado = 0u64;
    loop {
        if let Some(f) = fuente.ultimo() {
            if f.seq != ultimo_enviado {
                ultimo_enviado = f.seq;
                let parte = format!("--{FRONTERA}\r\nContent-Type: image/jpeg\r\nContent-Length: {}\r\n\r\n", f.jpeg.len());
                s.write_all(parte.as_bytes()).await?;
                s.write_all(&f.jpeg).await?;
                s.write_all(b"\r\n").await?;
            }
        }
        match tokio::time::timeout(ESPERA_SIN_IMAGEN, rx.changed()).await {
            Ok(Ok(())) => {}
            _ => return s.shutdown().await,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::camaras::fuente::pruebas::*;
    use crate::camaras::fuente::{EstadoFuente, Fotograma};
    use crate::camaras::jpeg::jpeg_de_prueba;
    use std::sync::Mutex;
    use tokio::sync::watch;

    /// Fuente de pruebas con fotogramas puestos a mano.
    struct Manual {
        ultimo: Mutex<Option<Fotograma>>,
        tx: watch::Sender<u64>,
    }
    impl Manual {
        fn nueva() -> Arc<Self> {
            Arc::new(Self { ultimo: Mutex::new(None), tx: watch::channel(0).0 })
        }
        fn poner(&self, seq: u64, relleno: u8) {
            *self.ultimo.lock().unwrap() = Some(Fotograma { jpeg: Arc::new(jpeg_de_prueba(&[relleno; 8])), seq, recibido_ms: 0 });
            let _ = self.tx.send(seq);
        }
    }
    impl FuenteFotogramas for Manual {
        fn ultimo(&self) -> Option<Fotograma> { self.ultimo.lock().unwrap().clone() }
        fn estado(&self) -> EstadoFuente { EstadoFuente::Conectada }
        fn suscribir(&self) -> watch::Receiver<u64> { self.tx.subscribe() }
    }

    const ORIGEN: &str = "http://tauri.localhost";

    async fn puente() -> (Arc<Puente>, Arc<Manual>) {
        let p = Puente::iniciar(vec![ORIGEN.into()]).await.unwrap();
        let f = Manual::nueva();
        p.registrar("cam1", f.clone());
        (p, f)
    }

    async fn pedir(p: &Puente, metodo: &str, ruta: &str, host: Option<&str>, extra: &str) -> Vec<u8> {
        let mut s = TcpStream::connect(p.direccion()).await.unwrap();
        let host = host.map(String::from).unwrap_or_else(|| format!("127.0.0.1:{}", p.puerto()));
        s.write_all(format!("{metodo} {ruta} HTTP/1.1\r\nHost: {host}\r\n{extra}\r\n").as_bytes()).await.unwrap();
        let mut out = Vec::new();
        let _ = tokio::time::timeout(Duration::from_secs(2), s.read_to_end(&mut out)).await;
        out
    }
    fn estado_http(r: &[u8]) -> u16 {
        String::from_utf8_lossy(r).split(' ').nth(1).and_then(|c| c.parse().ok()).unwrap_or(0)
    }

    #[tokio::test]
    async fn solo_escucha_en_loopback_y_el_token_es_largo_y_distinto_cada_vez() {
        let (p, _) = puente().await;
        assert!(p.direccion().ip().is_loopback(), "{:?}", p.direccion());
        assert_eq!(p.direccion().ip().to_string(), "127.0.0.1");
        assert_eq!(p.token().len(), 64);
        assert!(p.token().chars().all(|c| c.is_ascii_hexdigit()));
        let otro = Puente::iniciar(vec![]).await.unwrap();
        assert_ne!(p.token(), otro.token());
        assert_ne!(p.puerto(), otro.puerto());
    }

    #[tokio::test]
    async fn con_el_token_correcto_entrega_el_ultimo_fotograma_como_jpeg() {
        let (p, f) = puente().await;
        f.poner(1, 7);
        let r = pedir(&p, "GET", &format!("/f/cam1?t={}", p.token()), None, "").await;
        assert_eq!(estado_http(&r), 200);
        let texto = String::from_utf8_lossy(&r);
        assert!(texto.contains("Content-Type: image/jpeg") && texto.contains("Cache-Control: no-store"));
        assert!(r.ends_with(&jpeg_de_prueba(&[7; 8])));
    }

    #[tokio::test]
    async fn sin_imagen_todavia_responde_503_no_un_flujo_vacio() {
        let (p, _) = puente().await;
        assert_eq!(estado_http(&pedir(&p, "GET", &format!("/f/cam1?t={}", p.token()), None, "").await), 503);
    }

    #[tokio::test]
    async fn token_ausente_o_equivocado_es_403_y_la_respuesta_no_lo_revela() {
        let (p, f) = puente().await;
        f.poner(1, 1);
        for ruta in ["/v/cam1".to_string(), "/v/cam1?t=".to_string(), "/v/cam1?t=equivocado".to_string(), format!("/v/cam1?t={}x", p.token()), format!("/v/cam1?t={}", &p.token()[..63])] {
            let r = pedir(&p, "GET", &ruta, None, "").await;
            assert_eq!(estado_http(&r), 403, "{ruta}");
            assert!(!String::from_utf8_lossy(&r).contains(p.token()));
        }
    }

    #[tokio::test]
    async fn host_de_otro_nombre_es_403_contra_dns_rebinding() {
        let (p, f) = puente().await;
        f.poner(1, 1);
        let ruta = format!("/f/cam1?t={}", p.token());
        for host in ["evil.example", "evil.example:80", &format!("evil.example:{}", p.puerto()), "127.0.0.1", "127.0.0.1:1", "192.168.1.5:9000"] {
            assert_eq!(estado_http(&pedir(&p, "GET", &ruta, Some(host), "").await), 403, "{host}");
        }
        assert_eq!(estado_http(&pedir(&p, "GET", &ruta, Some(&format!("localhost:{}", p.puerto())), "").await), 200);
    }

    #[tokio::test]
    async fn un_origin_ajeno_es_403_y_el_de_la_app_pasa() {
        let (p, f) = puente().await;
        f.poner(1, 1);
        let ruta = format!("/f/cam1?t={}", p.token());
        assert_eq!(estado_http(&pedir(&p, "GET", &ruta, None, "Origin: https://evil.example\r\n").await), 403);
        assert_eq!(estado_http(&pedir(&p, "GET", &ruta, None, &format!("Origin: {ORIGEN}\r\n")).await), 200);
        assert_eq!(estado_http(&pedir(&p, "GET", &ruta, None, "").await), 200, "un <img> no manda Origin");
    }

    #[tokio::test]
    async fn solo_get_rutas_conocidas_y_camaras_existentes() {
        let (p, _) = puente().await;
        let t = p.token().to_string();
        assert_eq!(estado_http(&pedir(&p, "POST", &format!("/v/cam1?t={t}"), None, "").await), 405);
        assert_eq!(estado_http(&pedir(&p, "DELETE", &format!("/v/cam1?t={t}"), None, "").await), 405);
        assert_eq!(estado_http(&pedir(&p, "GET", &format!("/otra?t={t}"), None, "").await), 404);
        assert_eq!(estado_http(&pedir(&p, "GET", &format!("/v/../etc/passwd?t={t}"), None, "").await), 404);
        assert_eq!(estado_http(&pedir(&p, "GET", &format!("/v/no-existe?t={t}"), None, "").await), 404);
    }

    #[tokio::test]
    async fn una_camara_quitada_deja_de_servirse() {
        let (p, f) = puente().await;
        f.poner(1, 1);
        let ruta = format!("/f/cam1?t={}", p.token());
        assert_eq!(estado_http(&pedir(&p, "GET", &ruta, None, "").await), 200);
        p.quitar("cam1");
        assert_eq!(estado_http(&pedir(&p, "GET", &ruta, None, "").await), 404);
    }

    #[tokio::test]
    async fn encabezados_enormes_son_431_y_basura_es_400() {
        let (p, _) = puente().await;
        let r = pedir(&p, "GET", "/v/cam1", None, &format!("X-Relleno: {}\r\n", "a".repeat(10_000))).await;
        assert_eq!(estado_http(&r), 431);
        let mut s = TcpStream::connect(p.direccion()).await.unwrap();
        s.write_all(b"esto no es http\r\n\r\n").await.unwrap();
        let mut out = Vec::new();
        let _ = tokio::time::timeout(Duration::from_secs(2), s.read_to_end(&mut out)).await;
        assert_eq!(estado_http(&out), 400);
    }

    #[tokio::test]
    async fn el_flujo_multipart_manda_cada_fotograma_nuevo() {
        let (p, f) = puente().await;
        f.poner(1, 1);
        let mut s = TcpStream::connect(p.direccion()).await.unwrap();
        s.write_all(format!("GET /v/cam1?t={} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n\r\n", p.token(), p.puerto()).as_bytes()).await.unwrap();
        let f2 = f.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            f2.poner(2, 2);
        });
        let mut recibido = Vec::new();
        let mut b = [0u8; 4096];
        let limite = jpeg_de_prueba(&[2; 8]);
        let t0 = std::time::Instant::now();
        while t0.elapsed() < Duration::from_secs(3) && !recibido.windows(limite.len()).any(|w| w == limite.as_slice()) {
            if let Ok(Ok(n)) = tokio::time::timeout(Duration::from_millis(500), s.read(&mut b)).await {
                if n == 0 { break; }
                recibido.extend_from_slice(&b[..n]);
            }
        }
        let t = String::from_utf8_lossy(&recibido);
        assert!(t.contains("multipart/x-mixed-replace; boundary=sgframe"));
        assert_eq!(t.matches("--sgframe").count(), 2, "un fotograma inicial y uno nuevo");
        assert!(recibido.windows(jpeg_de_prueba(&[1; 8]).len()).any(|w| w == jpeg_de_prueba(&[1; 8]).as_slice()));
    }

    #[test]
    fn comparacion_en_tiempo_constante() {
        assert!(iguales(b"abc", b"abc"));
        assert!(!iguales(b"abc", b"abd"));
        assert!(!iguales(b"abc", b"abcd"));
        assert!(!iguales(b"", b"a"));
    }

    // Uso del supervisor real con el puente: lo que la vista previa verá.
    #[tokio::test(start_paused = false)]
    async fn un_supervisor_registrado_se_sirve_por_el_puente() {
        let (c, _) = ConectorFalso::nuevo(vec![Guion::Fotogramas(vec![jpeg_de_prueba(&[5; 8])], Duration::from_millis(5))], Guion::Muda);
        let sup = Arc::new(crate::camaras::fuente::Supervisor::iniciar(c, cfg()));
        let p = Puente::iniciar(vec![]).await.unwrap();
        p.registrar("x", sup.clone());
        tokio::time::sleep(Duration::from_millis(100)).await;
        let r = pedir(&p, "GET", &format!("/f/x?t={}", p.token()), None, "").await;
        assert_eq!(estado_http(&r), 200);
        assert!(r.ends_with(&jpeg_de_prueba(&[5; 8])));
    }
}
