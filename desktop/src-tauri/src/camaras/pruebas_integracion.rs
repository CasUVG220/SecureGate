//! Pruebas de integración de las cámaras (T7) con servidores simulados:
//! - un servidor MJPEG/HTTP propio (el «celular»), con auth, redirecciones y cortes;
//! - el ffmpeg mínimo REAL contra un servidor RTSP de prueba (mediamtx) con una cámara simulada (`testsrc2`). Se omiten solas si
//!   no están: `SG_FFMPEG` (ffmpeg mínimo; por defecto `binaries/ffmpeg-<triple>`), `SG_MEDIAMTX` y un `ffmpeg` del sistema con libx264
//!   que publique la imagen. Marcadas «sin probar con hardware real»: ninguna cámara física participa.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::credenciales::Credenciales;
use super::fuente::pruebas::cfg;
use super::fuente::*;
use super::jpeg::{dimensiones, jpeg_de_prueba};
use super::ssrf::DestinoValidado;

// ── servidor MJPEG simulado ──────────────────────────────────────────────────────────────────────────────

struct Mjpeg {
    addr: SocketAddr,
    conexiones: Arc<AtomicUsize>,
}

/// Rutas: `/video` (flujo), `/auth` (exige usuario `pedro` y clave `s3cr3t`), `/redir` (→ `/video`), `/redir-otro` (→ otro host),
/// `/redir-bucle` (→ sí misma), `/404`, `/corta` (manda 2 fotogramas y cierra).
async fn servidor_mjpeg() -> Mjpeg {
    let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = l.local_addr().unwrap();
    let conexiones = Arc::new(AtomicUsize::new(0));
    let c = conexiones.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut s, _)) = l.accept().await else { break };
            c.fetch_add(1, Ordering::SeqCst);
            tokio::spawn(async move {
                let mut buf = vec![0u8; 4096];
                let n = s.read(&mut buf).await.unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let ruta = req.split(' ').nth(1).unwrap_or("/").to_string();
                // pedro:s3cr3t en base64; el nombre del encabezado puede llegar en minúsculas (reqwest), el valor no se toca.
                let auth_ok = req.lines().any(|l| l.split_once(':').map_or(false, |(k, v)| k.eq_ignore_ascii_case("authorization") && v.trim() == "Basic cGVkcm86czNjcjN0"));
                // Variantes de apps reales: partes SIN Content-Length y con otra frontera (como emiten varias apps de celular), y la
                // respuesta entera en `Transfer-Encoding: chunked`. El divisor busca el inicio y el fin de cada JPEG, no el encuadre multipart.
                if ruta == "/sin-largo" || ruta == "/chunked" {
                    let trozo = ruta == "/chunked";
                    let cab = format!("HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace;boundary=myboundary\r\n{}Connection: close\r\n\r\n", if trozo { "Transfer-Encoding: chunked\r\n" } else { "" });
                    let _ = s.write_all(cab.as_bytes()).await;
                    for i in 0..usize::MAX {
                        let f = jpeg_de_prueba(&[(i % 250) as u8; 16]);
                        let mut parte = b"\r\n--myboundary\r\nContent-type: image/jpeg\r\n\r\n".to_vec();
                        parte.extend_from_slice(&f);
                        let datos = if trozo { let mut c = format!("{:x}\r\n", parte.len()).into_bytes(); c.extend_from_slice(&parte); c.extend_from_slice(b"\r\n"); c } else { parte };
                        if s.write_all(&datos).await.is_err() {
                            return;
                        }
                        tokio::time::sleep(Duration::from_millis(30)).await;
                    }
                }
                let (estado, extra) = match ruta.as_str() {
                    "/auth" if !auth_ok => ("401 Unauthorized", "WWW-Authenticate: Basic realm=\"cam\"\r\n"),
                    "/redir" => ("302 Found", "Location: /video\r\n"),
                    "/redir-otro" => ("302 Found", "Location: http://192.168.1.99/video\r\n"),
                    "/redir-bucle" => ("302 Found", "Location: /redir-bucle\r\n"),
                    "/404" => ("404 Not Found", ""),
                    _ => ("200 OK", "Content-Type: multipart/x-mixed-replace; boundary=frame\r\n"),
                };
                let _ = s.write_all(format!("HTTP/1.1 {estado}\r\n{extra}Connection: close\r\n\r\n").as_bytes()).await;
                if !estado.starts_with("200") {
                    return;
                }
                let n_fotos = if ruta == "/corta" { 2 } else { usize::MAX };
                for i in 0..n_fotos {
                    let f = jpeg_de_prueba(&[(i % 250) as u8; 16]);
                    let parte = format!("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: {}\r\n\r\n", f.len());
                    if s.write_all(parte.as_bytes()).await.is_err() || s.write_all(&f).await.is_err() || s.write_all(b"\r\n").await.is_err() {
                        return;
                    }
                    tokio::time::sleep(Duration::from_millis(30)).await;
                }
            });
        }
    });
    Mjpeg { addr, conexiones }
}

/// Un validador que apunta al servidor simulado (en el loopback, que el validador real rechazaría a propósito).
fn al_simulado(addr: SocketAddr, ruta: &str) -> Validador {
    let ruta = ruta.to_string();
    Arc::new(move || Ok(DestinoValidado { esquema: "http".into(), host: "camara.local".into(), ip: addr.ip(), puerto: addr.port(), ruta: ruta.clone() }))
}

fn conector(addr: SocketAddr, ruta: &str, cred: Option<Credenciales>) -> ConectorMjpeg {
    ConectorMjpeg { validar: al_simulado(addr, ruta), credenciales: cred }
}

#[tokio::test]
async fn mjpeg_entrega_los_fotogramas_del_celular() {
    let srv = servidor_mjpeg().await;
    let mut flujo = conector(srv.addr, "/video", None).conectar().await.unwrap();
    for i in 0..3u8 {
        assert_eq!(flujo.siguiente().await.unwrap().unwrap(), jpeg_de_prueba(&[i; 16]));
    }
}

#[tokio::test]
async fn mjpeg_acepta_partes_sin_content_length_otra_frontera_y_transferencia_por_trozos() {
    let srv = servidor_mjpeg().await;
    for ruta in ["/sin-largo", "/chunked"] {
        let mut flujo = conector(srv.addr, ruta, None).conectar().await.unwrap_or_else(|e| panic!("{ruta}: {e:?}"));
        for i in 0..3u8 {
            assert_eq!(flujo.siguiente().await.unwrap().unwrap(), jpeg_de_prueba(&[i; 16]), "{ruta} fotograma {i}");
        }
    }
}

#[tokio::test]
async fn mjpeg_con_credenciales_correctas_y_con_malas() {
    let srv = servidor_mjpeg().await;
    let buenas = Credenciales { usuario: "pedro".into(), clave: "s3cr3t".into() };
    assert!(conector(srv.addr, "/auth", Some(buenas)).conectar().await.is_ok());
    let malas = Credenciales { usuario: "pedro".into(), clave: "mala".into() };
    let e = conector(srv.addr, "/auth", Some(malas)).conectar().await.err().unwrap();
    assert!(matches!(&e, ErrorFuente::Permanente(m) if m.contains("contraseña")), "{e:?}");
    let e = conector(srv.addr, "/auth", None).conectar().await.err().unwrap();
    assert!(matches!(e, ErrorFuente::Permanente(_)));
}

#[tokio::test]
async fn mjpeg_sigue_una_redireccion_al_mismo_host_pero_no_a_otro_ni_en_bucle() {
    let srv = servidor_mjpeg().await;
    let mut f = conector(srv.addr, "/redir", None).conectar().await.expect("misma máquina: se sigue");
    assert!(f.siguiente().await.unwrap().is_some());

    let antes = srv.conexiones.load(Ordering::SeqCst);
    let e = conector(srv.addr, "/redir-otro", None).conectar().await.err().unwrap();
    assert!(matches!(&e, ErrorFuente::Permanente(m) if m.contains("otro equipo")), "{e:?}");
    assert_eq!(srv.conexiones.load(Ordering::SeqCst) - antes, 1, "NO se conectó al otro host: solo se pidió la primera página");

    let e = conector(srv.addr, "/redir-bucle", None).conectar().await.err().unwrap();
    assert!(matches!(&e, ErrorFuente::Permanente(m) if m.contains("demasiadas")), "{e:?}");
}

#[tokio::test]
async fn mjpeg_404_es_error_permanente_y_un_puerto_cerrado_es_temporal() {
    let srv = servidor_mjpeg().await;
    let e = conector(srv.addr, "/404", None).conectar().await.err().unwrap();
    assert!(matches!(e, ErrorFuente::Permanente(m) if m.contains("404")));
    let cerrado = TcpListener::bind("127.0.0.1:0").await.unwrap().local_addr().unwrap();      // se libera al soltar
    let e = conector(cerrado, "/video", None).conectar().await.err().unwrap();
    assert!(matches!(e, ErrorFuente::Temporal(_)), "{e:?}");
}

#[tokio::test]
async fn mjpeg_no_acepta_un_destino_rtsp() {
    let srv = servidor_mjpeg().await;
    let validar: Validador = Arc::new(move || Ok(DestinoValidado { esquema: "rtsp".into(), host: "x".into(), ip: srv.addr.ip(), puerto: srv.addr.port(), ruta: "/".into() }));
    assert!(matches!(ConectorMjpeg { validar, credenciales: None }.conectar().await.err().unwrap(), ErrorFuente::Permanente(_)));
}

#[tokio::test]
async fn un_celular_que_corta_se_reconecta_solo_con_el_supervisor_y_vuelve_a_dar_imagen() {
    let srv = servidor_mjpeg().await;
    // `/corta` manda 2 fotogramas y cierra la conexión: el supervisor debe reconectar una y otra vez.
    let mut c = cfg();
    c.backoff = super::backoff::Backoff::con(Duration::from_millis(40), Duration::from_millis(200), 0.0);
    let s = Supervisor::iniciar(conector(srv.addr, "/corta", None), c);
    tokio::time::sleep(Duration::from_millis(900)).await;
    assert!(srv.conexiones.load(Ordering::SeqCst) >= 3, "reconectó varias veces: {}", srv.conexiones.load(Ordering::SeqCst));
    assert!(s.ultimo().is_some());
    assert!(s.ultimo().unwrap().seq >= 4, "siguió recibiendo fotogramas tras reconectar");
    s.detener();
}

#[tokio::test]
async fn una_camara_caida_pasa_a_reconectando_y_luego_a_caida_pero_el_resto_de_la_garita_sigue() {
    // Puerto cerrado: nunca conecta. Con el backoff corto se llega a «caída» (con reintentos) sin bloquear a nadie.
    let cerrado = TcpListener::bind("127.0.0.1:0").await.unwrap().local_addr().unwrap();
    let mut c = cfg();
    c.caida_tras = 3;
    c.backoff = super::backoff::Backoff::con(Duration::from_millis(20), Duration::from_millis(40), 0.0);
    let s = Supervisor::iniciar(conector(cerrado, "/video", None), c);
    tokio::time::sleep(Duration::from_millis(60)).await;
    assert!(matches!(s.estado(), EstadoFuente::Reconectando { .. } | EstadoFuente::Conectando), "{:?}", s.estado());
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(matches!(s.estado(), EstadoFuente::Caida { reintentando: true, .. }), "{:?}", s.estado());
    assert!(s.ultimo().is_none());
}

// ── ffmpeg real + mediamtx (se omiten solas) ─────────────────────────────────────────────────────────────

struct Hijo(std::process::Child);
impl Drop for Hijo {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn puerto_libre() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

/// mediamtx exige que el puerto RTCP sea el del RTP + 1: se busca un par UDP consecutivo libre.
fn par_udp_libre() -> u16 {
    loop {
        let a = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        let p = a.local_addr().unwrap().port();
        if p % 2 == 0 && std::net::UdpSocket::bind(("127.0.0.1", p + 1)).is_ok() {
            return p;
        }
    }
}

fn ffmpeg_minimo() -> Option<std::path::PathBuf> {
    if let Ok(p) = std::env::var("SG_FFMPEG") {
        return Some(p.into()).filter(|p: &std::path::PathBuf| p.exists());
    }
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries").join("ffmpeg-x86_64-unknown-linux-gnu");
    p.exists().then_some(p).filter(|p| std::fs::metadata(p).map_or(false, |m| m.len() > 1_000_000))
}

fn en_path(nombre: &str) -> bool {
    std::process::Command::new(nombre).arg("-version").stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().is_ok()
}

struct EntornoRtsp {
    _mtx: Hijo,
    puerto: u16,
    ffmpeg_min: std::path::PathBuf,
}

fn entorno_rtsp() -> Option<EntornoRtsp> {
    let ffmpeg_min = ffmpeg_minimo()?;
    let mtx = std::env::var("SG_MEDIAMTX").ok().filter(|p| std::path::Path::new(p).exists())?;
    if !en_path("ffmpeg") {
        return None;
    }
    let (rtsp, rtp) = (puerto_libre(), par_udp_libre());
    let rtcp = rtp + 1;
    let dir = tempfile::tempdir().unwrap().keep();
    let yml = dir.join("mtx.yml");
    std::fs::write(&yml, format!(
        "logLevel: error\nrtspAddress: 127.0.0.1:{rtsp}\nrtpAddress: 127.0.0.1:{rtp}\nrtcpAddress: 127.0.0.1:{rtcp}\nrtmp: no\nhls: no\nwebrtc: no\nsrt: no\napi: no\nmetrics: no\npaths:\n  all_others:\n"
    )).unwrap();
    let hijo = std::process::Command::new(mtx).arg(&yml).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn().ok()?;
    std::thread::sleep(Duration::from_millis(800));
    Some(EntornoRtsp { _mtx: Hijo(hijo), puerto: rtsp, ffmpeg_min })
}

fn publicar(puerto: u16, ruta: &str) -> Hijo {
    Hijo(
        std::process::Command::new("ffmpeg")
            .args(["-loglevel", "error", "-re", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=15", "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
                   "-g", "15", "-pix_fmt", "yuv420p", "-f", "rtsp", "-rtsp_transport", "tcp", &format!("rtsp://127.0.0.1:{puerto}/{ruta}")])
            .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
            .spawn().unwrap(),
    )
}

fn conector_rtsp_a(e: &EntornoRtsp, ruta: &str) -> ConectorRtsp {
    let destino = DestinoValidado { esquema: "rtsp".into(), host: "camara.local".into(), ip: IpAddr::V4(Ipv4Addr::LOCALHOST), puerto: e.puerto, ruta: format!("/{ruta}") };
    ConectorRtsp {
        lanzador: Arc::new(LanzadorTokio { ruta: e.ffmpeg_min.clone() }),
        validar: Arc::new(move || Ok(destino.clone())),
        credenciales: None,
        opciones: OpcionesVideo { fps: 10, ancho: 640, calidad: 6 },
    }
}

async fn esperar<F: Fn() -> bool>(max: Duration, f: F) -> bool {
    let t0 = std::time::Instant::now();
    while t0.elapsed() < max {
        if f() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    false
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ffmpeg_real_entrega_jpeg_validos_desde_una_camara_rtsp_simulada() {
    let Some(e) = entorno_rtsp() else {
        eprintln!("OMITIDA: faltan SG_FFMPEG/binaries/ffmpeg-*, SG_MEDIAMTX o ffmpeg en el PATH");
        return;
    };
    let _pub = publicar(e.puerto, "cam");
    tokio::time::sleep(Duration::from_millis(1500)).await;
    let mut flujo = conector_rtsp_a(&e, "cam").conectar().await.unwrap();
    let f = tokio::time::timeout(Duration::from_secs(15), flujo.siguiente()).await.expect("llegó un fotograma a tiempo").unwrap().unwrap();
    assert_eq!(&f[..3], &[0xFF, 0xD8, 0xFF], "empieza con SOI");
    assert_eq!(&f[f.len() - 2..], &[0xFF, 0xD9], "termina con EOI");
    assert_eq!(dimensiones(&f), Some((640, 360)), "720p reducido a 640 px de ancho");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ffmpeg_real_se_reconecta_cuando_la_camara_cae_y_vuelve() {
    let Some(e) = entorno_rtsp() else {
        eprintln!("OMITIDA: faltan SG_FFMPEG/binaries/ffmpeg-*, SG_MEDIAMTX o ffmpeg en el PATH");
        return;
    };
    let publicador = publicar(e.puerto, "cam2");
    tokio::time::sleep(Duration::from_millis(1500)).await;
    let mut c = cfg();
    c.backoff = super::backoff::Backoff::con(Duration::from_millis(300), Duration::from_secs(1), 0.0);
    c.inactividad = Duration::from_secs(4);
    let s = Arc::new(Supervisor::iniciar(conector_rtsp_a(&e, "cam2"), c));
    let s2 = s.clone();
    assert!(esperar(Duration::from_secs(20), move || s2.estado() == EstadoFuente::Conectada).await, "conectó: {:?}", s.estado());
    let seq_antes = s.ultimo().unwrap().seq;

    drop(publicador);                                           // la cámara se cae
    let s2 = s.clone();
    assert!(esperar(Duration::from_secs(20), move || matches!(s2.estado(), EstadoFuente::Reconectando { .. } | EstadoFuente::Caida { .. })).await, "se notó la caída: {:?}", s.estado());

    let _vuelve = publicar(e.puerto, "cam2");                   // la cámara vuelve
    let s2 = s.clone();
    assert!(esperar(Duration::from_secs(30), move || s2.estado() == EstadoFuente::Conectada && s2.ultimo().map_or(false, |f| f.seq > seq_antes + 1)).await,
        "se recuperó y recibe imágenes nuevas: {:?}", s.estado());
    s.detener();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ffmpeg_real_con_una_ruta_inexistente_da_un_error_permanente_entendible() {
    let Some(e) = entorno_rtsp() else {
        eprintln!("OMITIDA: faltan SG_FFMPEG/binaries/ffmpeg-*, SG_MEDIAMTX o ffmpeg en el PATH");
        return;
    };
    let mut flujo = conector_rtsp_a(&e, "no-existe").conectar().await.unwrap();
    let r = tokio::time::timeout(Duration::from_secs(15), flujo.siguiente()).await.expect("respondió").unwrap_err();
    assert!(matches!(&r, ErrorFuente::Permanente(m) if m.contains("404")), "{r:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ffmpeg_real_con_el_puerto_cerrado_es_un_error_temporal() {
    let Some(e) = entorno_rtsp() else {
        eprintln!("OMITIDA: faltan SG_FFMPEG/binaries/ffmpeg-*, SG_MEDIAMTX o ffmpeg en el PATH");
        return;
    };
    let mut c = conector_rtsp_a(&e, "cam");
    let cerrado = puerto_libre();
    c.validar = Arc::new(move || Ok(DestinoValidado { esquema: "rtsp".into(), host: "x".into(), ip: IpAddr::V4(Ipv4Addr::LOCALHOST), puerto: cerrado, ruta: "/cam".into() }));
    let mut flujo = c.conectar().await.unwrap();
    let r = tokio::time::timeout(Duration::from_secs(15), flujo.siguiente()).await.expect("respondió").unwrap_err();
    assert!(matches!(&r, ErrorFuente::Temporal(m) if m.contains("rechazó")), "{r:?}");
}
