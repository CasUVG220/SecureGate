//! Adaptador 2 — relé Ethernet genérico: socket TCP crudo o HTTP.
//!
//! # Qué protocolo se asume y por qué
//!
//! Aquí es donde más varían los fabricantes, así que **no se asume ninguno**:
//! el comando es texto libre que el agente escribe en la configuración. Se
//! soportan las dos formas en que estos módulos exponen el relé:
//!
//! - [`ModoTcp::Tcp`]: se abre un socket a `host:puerto` y se escribe el
//!   comando tal cual. Cubre los módulos "TCP relay" baratos (p. ej. los que
//!   aceptan `AT+O1\r\n`, `on1`, o un byte). El texto admite escapes `\r`,
//!   `\n`, `\t` y `\xHH` para los que piden bytes que no se pueden teclear.
//! - [`ModoTcp::Http`]: se hace `GET` o `POST` a `http://host:puerto<ruta>`,
//!   con el comando como cuerpo en el POST. Cubre los relés con "web API"
//!   (`/relay?ch=1&state=on`, `/30000/01`, `/cgi-bin/relay.cgi`, …).
//!
//! Los que trabajan por pulso desde el propio relé no necesitan más. Para los
//! que exigen que el cliente mande también el OFF, `comando_off`/`ruta_off`
//! son opcionales y se envían tras `pulso_ms`.
//!
//! # Timeouts
//!
//! `timeout_ms` (2 s por defecto) aplica a conectar y a escribir, y se hace
//! **un** reintento antes de rendirse. Así un relé apagado cuesta como mucho
//! ~4 s y nunca cuelga la garita; quien llama lo hace en `spawn_blocking`.

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::Arc;
use std::time::Duration;

use super::{EstadoConexion, TalanqueraDriver, TalanqueraError};

pub const TIMEOUT_MS_DEFECTO: u64 = 2000;
pub const PULSO_MS_DEFECTO: u64 = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ModoTcp {
    #[default]
    Tcp,
    Http,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum MetodoHttp {
    #[default]
    Get,
    Post,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConfigTcp {
    pub host: String,
    pub puerto: u16,
    #[serde(default)]
    pub modo: ModoTcp,
    /// TCP: bytes a escribir (con escapes). HTTP POST: cuerpo. HTTP GET: se ignora.
    #[serde(default)]
    pub comando: String,
    /// Sólo si el relé exige que el cliente lo suelte; se manda tras `pulso_ms`.
    #[serde(default)]
    pub comando_off: Option<String>,
    #[serde(default = "pulso_defecto")]
    pub pulso_ms: u64,
    #[serde(default = "timeout_defecto")]
    pub timeout_ms: u64,
    /// Sólo HTTP: método y ruta (con query si hace falta), p. ej. `/relay?ch=1&on=1`.
    #[serde(default)]
    pub metodo: MetodoHttp,
    #[serde(default = "ruta_defecto")]
    pub ruta: String,
    #[serde(default)]
    pub ruta_off: Option<String>,
}

fn pulso_defecto() -> u64 { PULSO_MS_DEFECTO }
fn timeout_defecto() -> u64 { TIMEOUT_MS_DEFECTO }
fn ruta_defecto() -> String { "/".into() }

impl Default for ConfigTcp {
    fn default() -> Self {
        Self {
            host: String::new(),
            puerto: 0,
            modo: ModoTcp::Tcp,
            comando: String::new(),
            comando_off: None,
            pulso_ms: PULSO_MS_DEFECTO,
            timeout_ms: TIMEOUT_MS_DEFECTO,
            metodo: MetodoHttp::Get,
            ruta: "/".into(),
            ruta_off: None,
        }
    }
}

/// Convierte el texto del agente a bytes: `\r`, `\n`, `\t`, `\\` y `\xHH`.
pub fn desescapar(s: &str) -> Result<Vec<u8>, TalanqueraError> {
    let mut out = Vec::with_capacity(s.len());
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        if c != '\\' {
            let mut buf = [0u8; 4];
            out.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
            continue;
        }
        match it.next() {
            Some('r') => out.push(b'\r'),
            Some('n') => out.push(b'\n'),
            Some('t') => out.push(b'\t'),
            Some('\\') => out.push(b'\\'),
            Some('x') => {
                let h: String = [it.next(), it.next()].iter().flatten().collect();
                let b = u8::from_str_radix(&h, 16)
                    .map_err(|_| TalanqueraError::Config(format!("escape \\x{h} inválido en el comando")))?;
                out.push(b);
            }
            otro => return Err(TalanqueraError::Config(format!("escape desconocido: \\{}", otro.unwrap_or(' ')))),
        }
    }
    Ok(out)
}

/// URL completa para el modo HTTP.
pub fn url_http(cfg: &ConfigTcp, ruta: &str) -> String {
    let ruta = if ruta.starts_with('/') { ruta.to_string() } else { format!("/{ruta}") };
    format!("http://{}:{}{}", cfg.host.trim(), cfg.puerto, ruta)
}

fn validar(cfg: &ConfigTcp) -> Result<(), TalanqueraError> {
    if cfg.host.trim().is_empty() {
        return Err(TalanqueraError::Config("falta la IP o el host del relé".into()));
    }
    if cfg.puerto == 0 {
        return Err(TalanqueraError::Config("el puerto debe ser 1-65535".into()));
    }
    if cfg.modo == ModoTcp::Tcp && cfg.comando.is_empty() {
        return Err(TalanqueraError::Config("el comando de apertura no puede estar vacío".into()));
    }
    desescapar(&cfg.comando)?;
    if let Some(off) = &cfg.comando_off {
        desescapar(off)?;
    }
    Ok(())
}

// ── Transporte, abstraído para poder mockearlo ──────────────────────────────

pub trait Transporte: Send + Sync {
    /// Conecta a `host:puerto`, escribe `bytes` y cierra.
    fn tcp(&self, host: &str, puerto: u16, bytes: &[u8], timeout: Duration) -> Result<(), TalanqueraError>;
    /// Petición HTTP; cualquier 2xx es éxito.
    fn http(&self, metodo: MetodoHttp, url: &str, cuerpo: &[u8], timeout: Duration) -> Result<(), TalanqueraError>;
    /// Comprobación ligera de que hay algo escuchando (para `estado()`).
    fn alcanzable(&self, host: &str, puerto: u16, timeout: Duration) -> bool;
}

pub struct TransporteReal;

fn resolver(host: &str, puerto: u16) -> Result<std::net::SocketAddr, TalanqueraError> {
    (host.trim(), puerto)
        .to_socket_addrs()
        .map_err(|e| TalanqueraError::NoDisponible(format!("{host}: {e}")))?
        .next()
        .ok_or_else(|| TalanqueraError::NoDisponible(format!("{host}: sin dirección")))
}

fn mapear_io(e: std::io::Error, que: &str) -> TalanqueraError {
    match e.kind() {
        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock => TalanqueraError::Timeout(que.to_string()),
        std::io::ErrorKind::ConnectionRefused => TalanqueraError::NoDisponible(format!("{que}: conexión rechazada")),
        _ => TalanqueraError::Envio(format!("{que}: {e}")),
    }
}

impl Transporte for TransporteReal {
    fn tcp(&self, host: &str, puerto: u16, bytes: &[u8], timeout: Duration) -> Result<(), TalanqueraError> {
        let addr = resolver(host, puerto)?;
        let mut s = TcpStream::connect_timeout(&addr, timeout).map_err(|e| mapear_io(e, "conectar"))?;
        s.set_write_timeout(Some(timeout)).ok();
        s.set_nodelay(true).ok();
        s.write_all(bytes).and_then(|_| s.flush()).map_err(|e| mapear_io(e, "escribir"))?;
        Ok(())
    }

    fn http(&self, metodo: MetodoHttp, url: &str, cuerpo: &[u8], timeout: Duration) -> Result<(), TalanqueraError> {
        let agente: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(timeout))
            .http_status_as_error(false)
            .build()
            .into();
        let res = match metodo {
            MetodoHttp::Get => agente.get(url).call(),
            MetodoHttp::Post => agente.post(url).send(cuerpo),
        };
        match res {
            Ok(r) if r.status().is_success() => Ok(()),
            Ok(r) => Err(TalanqueraError::Envio(format!("el relé respondió HTTP {}", r.status()))),
            Err(ureq::Error::Timeout(_)) => Err(TalanqueraError::Timeout(url.to_string())),
            Err(ureq::Error::Io(e)) => Err(mapear_io(e, url)),
            Err(e) => Err(TalanqueraError::Envio(format!("{url}: {e}"))),
        }
    }

    fn alcanzable(&self, host: &str, puerto: u16, timeout: Duration) -> bool {
        resolver(host, puerto)
            .ok()
            .and_then(|a| TcpStream::connect_timeout(&a, timeout).ok())
            .is_some()
    }
}

pub struct ReleTcp {
    cfg: ConfigTcp,
    transporte: Arc<dyn Transporte>,
    dormir: Arc<dyn Fn(Duration) + Send + Sync>,
    nombre: String,
}

impl ReleTcp {
    pub fn nuevo(cfg: ConfigTcp) -> Result<Self, TalanqueraError> {
        Self::con_transporte(cfg, Arc::new(TransporteReal), Arc::new(std::thread::sleep))
    }

    pub fn con_transporte(
        cfg: ConfigTcp,
        transporte: Arc<dyn Transporte>,
        dormir: Arc<dyn Fn(Duration) + Send + Sync>,
    ) -> Result<Self, TalanqueraError> {
        validar(&cfg)?;
        let nombre = match cfg.modo {
            ModoTcp::Tcp => format!("Relé TCP {}:{}", cfg.host.trim(), cfg.puerto),
            ModoTcp::Http => format!("Relé HTTP {}:{}", cfg.host.trim(), cfg.puerto),
        };
        Ok(Self { cfg, transporte, dormir, nombre })
    }

    fn timeout(&self) -> Duration {
        Duration::from_millis(self.cfg.timeout_ms.max(100))
    }

    /// Un intento, y uno más sólo si el primero fue de red (no de config).
    fn con_reintento(&self, f: impl Fn() -> Result<(), TalanqueraError>) -> Result<(), TalanqueraError> {
        match f() {
            Ok(()) => Ok(()),
            Err(TalanqueraError::Config(e)) => Err(TalanqueraError::Config(e)),
            Err(primero) => {
                log::warn!("talanquera: primer intento falló ({primero}); reintentando");
                f().map_err(|segundo| {
                    log::warn!("talanquera: segundo intento falló ({segundo})");
                    segundo
                })
            }
        }
    }

    fn enviar(&self, comando: &str, ruta: &str) -> Result<(), TalanqueraError> {
        let bytes = desescapar(comando)?;
        match self.cfg.modo {
            ModoTcp::Tcp => self.con_reintento(|| self.transporte.tcp(&self.cfg.host, self.cfg.puerto, &bytes, self.timeout())),
            ModoTcp::Http => {
                let url = url_http(&self.cfg, ruta);
                self.con_reintento(|| self.transporte.http(self.cfg.metodo, &url, &bytes, self.timeout()))
            }
        }
    }
}

impl TalanqueraDriver for ReleTcp {
    fn abrir(&self) -> Result<(), TalanqueraError> {
        self.enviar(&self.cfg.comando, &self.cfg.ruta)?;
        // OFF opcional: sólo para relés que no pulsan solos.
        let off = match self.cfg.modo {
            ModoTcp::Tcp => self.cfg.comando_off.as_deref().filter(|c| !c.is_empty()).map(|c| (c, self.cfg.ruta.as_str())),
            ModoTcp::Http => self.cfg.ruta_off.as_deref().filter(|r| !r.is_empty()).map(|r| (self.cfg.comando_off.as_deref().unwrap_or(""), r)),
        };
        if let Some((comando, ruta)) = off {
            (self.dormir)(Duration::from_millis(self.cfg.pulso_ms));
            self.enviar(comando, ruta)
                .map_err(|e| TalanqueraError::Envio(format!("el relé abrió pero no se pudo soltar: {e}")))?;
        }
        Ok(())
    }

    fn estado(&self) -> EstadoConexion {
        // Sondeo corto: es para el indicador de la UI, no para abrir.
        let t = Duration::from_millis(self.cfg.timeout_ms.min(1000).max(100));
        if self.transporte.alcanzable(&self.cfg.host, self.cfg.puerto, t) {
            EstadoConexion::Conectado
        } else {
            EstadoConexion::Desconectado
        }
    }

    fn nombre(&self) -> &str {
        &self.nombre
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::TcpListener;
    use std::sync::Mutex;

    #[derive(Default)]
    struct Mock {
        llamadas: Mutex<Vec<String>>,
        /// Resultados a devolver en orden; agotados → Ok.
        respuestas: Mutex<Vec<Result<(), TalanqueraError>>>,
        alcanzable: bool,
    }

    impl Mock {
        fn siguiente(&self) -> Result<(), TalanqueraError> {
            let mut r = self.respuestas.lock().unwrap();
            if r.is_empty() { Ok(()) } else { r.remove(0) }
        }
    }

    impl Transporte for Mock {
        fn tcp(&self, host: &str, puerto: u16, bytes: &[u8], timeout: Duration) -> Result<(), TalanqueraError> {
            self.llamadas.lock().unwrap().push(format!("tcp {host}:{puerto} {:?} t={}", bytes, timeout.as_millis()));
            self.siguiente()
        }
        fn http(&self, metodo: MetodoHttp, url: &str, cuerpo: &[u8], timeout: Duration) -> Result<(), TalanqueraError> {
            self.llamadas.lock().unwrap().push(format!("http {metodo:?} {url} {:?} t={}", cuerpo, timeout.as_millis()));
            self.siguiente()
        }
        fn alcanzable(&self, _: &str, _: u16, _: Duration) -> bool {
            self.alcanzable
        }
    }

    fn cfg_tcp() -> ConfigTcp {
        ConfigTcp { host: "192.168.1.50".into(), puerto: 6722, comando: "AT+O1\\r\\n".into(), ..Default::default() }
    }

    fn driver(cfg: ConfigTcp, mock: Arc<Mock>) -> (ReleTcp, Arc<Mutex<Vec<Duration>>>) {
        let esperas = Arc::new(Mutex::new(Vec::new()));
        let e = esperas.clone();
        (ReleTcp::con_transporte(cfg, mock, Arc::new(move |d| e.lock().unwrap().push(d))).unwrap(), esperas)
    }

    #[test]
    fn desescapa_crlf_tab_barra_y_hex() {
        assert_eq!(desescapar("AT+O1\\r\\n").unwrap(), b"AT+O1\r\n");
        assert_eq!(desescapar("\\x01\\xFF\\\\t\\t").unwrap(), vec![0x01, 0xFF, b'\\', b't', b'\t']);
        assert_eq!(desescapar("ñ").unwrap(), "ñ".as_bytes());
        assert!(matches!(desescapar("\\q"), Err(TalanqueraError::Config(_))));
        assert!(matches!(desescapar("\\xZZ"), Err(TalanqueraError::Config(_))));
    }

    #[test]
    fn tcp_escribe_el_comando_desescapado_al_host_y_puerto_configurados() {
        let mock = Arc::new(Mock::default());
        let (d, esperas) = driver(cfg_tcp(), mock.clone());
        d.abrir().unwrap();
        assert_eq!(*mock.llamadas.lock().unwrap(), vec![format!("tcp 192.168.1.50:6722 {:?} t=2000", b"AT+O1\r\n")]);
        assert!(esperas.lock().unwrap().is_empty(), "sin comando_off no hay pulso ni espera");
    }

    #[test]
    fn tcp_con_comando_off_pulsa_y_lo_manda_despues() {
        let mock = Arc::new(Mock::default());
        let cfg = ConfigTcp { comando_off: Some("AT+C1\\r\\n".into()), pulso_ms: 300, ..cfg_tcp() };
        let (d, esperas) = driver(cfg, mock.clone());
        d.abrir().unwrap();
        let ll = mock.llamadas.lock().unwrap();
        assert_eq!(ll.len(), 2);
        assert!(ll[1].contains(&format!("{:?}", b"AT+C1\r\n")));
        assert_eq!(*esperas.lock().unwrap(), vec![Duration::from_millis(300)]);
    }

    #[test]
    fn http_get_no_manda_cuerpo_y_post_si() {
        let mock = Arc::new(Mock::default());
        let cfg = ConfigTcp { modo: ModoTcp::Http, ruta: "relay?ch=1&on=1".into(), comando: "".into(), ..cfg_tcp() };
        let (d, _) = driver(cfg, mock.clone());
        d.abrir().unwrap();
        assert_eq!(mock.llamadas.lock().unwrap()[0], "http Get http://192.168.1.50:6722/relay?ch=1&on=1 [] t=2000");

        let mock2 = Arc::new(Mock::default());
        let cfg2 = ConfigTcp { modo: ModoTcp::Http, metodo: MetodoHttp::Post, ruta: "/cgi-bin/relay".into(), comando: "ch=1".into(), ..cfg_tcp() };
        let (d2, _) = driver(cfg2, mock2.clone());
        d2.abrir().unwrap();
        assert_eq!(mock2.llamadas.lock().unwrap()[0], format!("http Post http://192.168.1.50:6722/cgi-bin/relay {:?} t=2000", b"ch=1"));
    }

    #[test]
    fn un_fallo_de_red_se_reintenta_una_sola_vez() {
        let mock = Arc::new(Mock { respuestas: Mutex::new(vec![Err(TalanqueraError::Timeout("conectar".into()))]), ..Default::default() });
        let (d, _) = driver(cfg_tcp(), mock.clone());
        d.abrir().unwrap();
        assert_eq!(mock.llamadas.lock().unwrap().len(), 2, "primero falló, segundo salió");

        let mock2 = Arc::new(Mock {
            respuestas: Mutex::new(vec![Err(TalanqueraError::Timeout("a".into())), Err(TalanqueraError::Timeout("b".into()))]),
            ..Default::default()
        });
        let (d2, _) = driver(cfg_tcp(), mock2.clone());
        assert_eq!(d2.abrir(), Err(TalanqueraError::Timeout("b".into())));
        assert_eq!(mock2.llamadas.lock().unwrap().len(), 2, "no hay tercer intento: no debe colgar la garita");
    }

    #[test]
    fn la_config_invalida_se_rechaza_al_construir_no_al_abrir() {
        assert!(matches!(ReleTcp::nuevo(ConfigTcp { host: "".into(), ..cfg_tcp() }), Err(TalanqueraError::Config(_))));
        assert!(matches!(ReleTcp::nuevo(ConfigTcp { puerto: 0, ..cfg_tcp() }), Err(TalanqueraError::Config(_))));
        assert!(matches!(ReleTcp::nuevo(ConfigTcp { comando: "".into(), ..cfg_tcp() }), Err(TalanqueraError::Config(_))));
        assert!(matches!(ReleTcp::nuevo(ConfigTcp { comando: "\\q".into(), ..cfg_tcp() }), Err(TalanqueraError::Config(_))));
        // En HTTP GET el comando vacío es válido: la ruta ya lleva la orden.
        assert!(ReleTcp::nuevo(ConfigTcp { modo: ModoTcp::Http, comando: "".into(), ..cfg_tcp() }).is_ok());
    }

    #[test]
    fn el_estado_sale_del_sondeo_del_transporte() {
        let (d, _) = driver(cfg_tcp(), Arc::new(Mock { alcanzable: true, ..Default::default() }));
        assert_eq!(d.estado(), EstadoConexion::Conectado);
        let (d2, _) = driver(cfg_tcp(), Arc::new(Mock::default()));
        assert_eq!(d2.estado(), EstadoConexion::Desconectado);
    }

    /// Con socket de verdad: un servidor local recibe exactamente los bytes.
    #[test]
    fn transporte_real_tcp_entrega_los_bytes_a_un_relay_local() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let puerto = listener.local_addr().unwrap().port();
        let servidor = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut buf = Vec::new();
            s.read_to_end(&mut buf).unwrap();
            buf
        });
        let d = ReleTcp::nuevo(ConfigTcp { host: "127.0.0.1".into(), puerto, comando: "on1\\r\\n".into(), timeout_ms: 1000, ..Default::default() }).unwrap();
        d.abrir().unwrap();
        assert_eq!(servidor.join().unwrap(), b"on1\r\n");
    }

    /// Puerto cerrado: conexión rechazada, un reintento, y error claro sin colgarse.
    #[test]
    fn transporte_real_tcp_falla_rapido_si_nadie_escucha() {
        let puerto = { let l = TcpListener::bind("127.0.0.1:0").unwrap(); l.local_addr().unwrap().port() };
        let d = ReleTcp::nuevo(ConfigTcp { host: "127.0.0.1".into(), puerto, comando: "x".into(), timeout_ms: 500, ..Default::default() }).unwrap();
        let t0 = std::time::Instant::now();
        let err = d.abrir().unwrap_err();
        assert!(matches!(err, TalanqueraError::NoDisponible(_) | TalanqueraError::Envio(_) | TalanqueraError::Timeout(_)), "{err:?}");
        assert!(t0.elapsed() < Duration::from_secs(3), "dos intentos de 500 ms como mucho");
        assert_eq!(d.estado(), EstadoConexion::Desconectado);
    }

    /// HTTP de verdad contra un mini servidor local: GET a la ruta, 200 → ok.
    #[test]
    fn transporte_real_http_get_llega_a_la_ruta_y_acepta_200() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let puerto = listener.local_addr().unwrap().port();
        let servidor = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut buf = [0u8; 1024];
            let n = s.read(&mut buf).unwrap();
            let req = String::from_utf8_lossy(&buf[..n]).to_string();
            s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK").unwrap();
            req
        });
        let d = ReleTcp::nuevo(ConfigTcp { host: "127.0.0.1".into(), puerto, modo: ModoTcp::Http, ruta: "/relay?ch=1&on=1".into(), timeout_ms: 1000, ..Default::default() }).unwrap();
        d.abrir().unwrap();
        let req = servidor.join().unwrap();
        assert!(req.starts_with("GET /relay?ch=1&on=1 HTTP/1.1"), "{req}");
    }

    #[test]
    fn transporte_real_http_trata_un_500_como_fallo_de_envio() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let puerto = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for _ in 0..2 {
                let (mut s, _) = listener.accept().unwrap();
                let mut buf = [0u8; 1024];
                let _ = s.read(&mut buf);
                let _ = s.write_all(b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            }
        });
        let d = ReleTcp::nuevo(ConfigTcp { host: "127.0.0.1".into(), puerto, modo: ModoTcp::Http, timeout_ms: 1000, ..Default::default() }).unwrap();
        assert!(matches!(d.abrir(), Err(TalanqueraError::Envio(ref m)) if m.contains("500")));
    }
}
