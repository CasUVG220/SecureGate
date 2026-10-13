//! Validación de la dirección de una cámara (T7): protección contra SSRF.
//!
//! La garita guarda una URL que ELLA misma va a abrir (ffmpeg o `reqwest`). Si se acepta cualquier dirección, quien configure una
//! cámara podría hacer que el equipo consulte servicios internos o de internet (SSRF). Reglas:
//!
//! - **Esquemas**: `rtsp://` (ffmpeg) y `http://`/`https://` (MJPEG del celular). `rtsps://` no (el ffmpeg mínimo no lleva TLS).
//! - **Sin credenciales en la URL** (`usuario:clave@host`): van aparte, al llavero del sistema (`credenciales.rs`).
//! - **Solo redes privadas**: IPv4 RFC 1918 (10/8, 172.16/12, 192.168/16) y link-local (169.254/16, salvo 169.254.169.254, el
//!   servicio de metadatos de las nubes); IPv6 ULA (fc00::/7) y link-local (fe80::/10). Se rechazan localhost y loopback (salvo el
//!   puente propio), IP públicas, 0.0.0.0, multicast, broadcast y CGNAT (100.64/10).
//! - **Nombres**: se resuelven y se valida CADA dirección que devuelven; si una sola es pública se rechaza. Luego se conecta a la IP
//!   ya validada (`DestinoValidado.ip`) y no al nombre: así un DNS que cambie de respuesta entre la validación y la conexión
//!   (DNS rebinding) no sirve de nada. Se vuelve a validar en cada reconexión.
//! - **Redirecciones**: no se siguen hacia otro host (`redireccion_permitida`).
//!
//! Las funciones son puras (el resolvedor se inyecta) para probarlas sin red.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

use url::Url;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ErrorSsrf {
    /// La dirección no es una URL válida o no tiene host.
    Invalida,
    EsquemaNoPermitido(String),
    /// Trae `usuario:clave@`.
    CredencialesEnUrl,
    /// El host (o una de las IP a las que resuelve) no está en una red privada permitida.
    DestinoNoPermitido { host: String, motivo: &'static str },
    /// El nombre no se pudo resolver.
    NoResuelve(String),
    /// Una redirección apunta a otro host.
    RedireccionAOtroHost,
}

impl ErrorSsrf {
    /// Mensaje para el agente (español de Guatemala, qué pasó y qué hacer). Nunca incluye credenciales.
    pub fn mensaje(&self) -> String {
        match self {
            ErrorSsrf::Invalida => "La dirección de la cámara no es válida. Debe verse así: rtsp://192.168.1.50:554/ruta o http://192.168.1.60:8080/video".into(),
            ErrorSsrf::EsquemaNoPermitido(e) if e == "rtsps" => "Las cámaras con rtsps:// (cifrado) todavía no están soportadas. Usa rtsp://.".into(),
            ErrorSsrf::EsquemaNoPermitido(e) => format!("La dirección debe empezar con rtsp:// o http:// (no con {e}://)."),
            ErrorSsrf::CredencialesEnUrl => "No escribas el usuario y la contraseña dentro de la dirección: ponlos en sus propios campos.".into(),
            ErrorSsrf::DestinoNoPermitido { motivo, .. } => format!(
                "Esa dirección no se acepta ({motivo}). Solo se permiten cámaras de tu red local: 10.x.x.x, 172.16 a 172.31.x.x o 192.168.x.x."
            ),
            ErrorSsrf::NoResuelve(h) => format!("No se encontró el equipo «{h}» en tu red. Revisa el nombre o usa su dirección IP."),
            ErrorSsrf::RedireccionAOtroHost => "La cámara intentó mandarnos a otro equipo y se rechazó por seguridad.".into(),
        }
    }
}

/// Destino ya validado: es a esta IP a la que hay que conectarse.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DestinoValidado {
    pub esquema: String,
    /// Host tal como lo escribió la persona (para el encabezado `Host` y para mostrar).
    pub host: String,
    pub ip: IpAddr,
    pub puerto: u16,
    /// Ruta + consulta tal como vienen (sin credenciales).
    pub ruta: String,
}

impl DestinoValidado {
    pub fn socket(&self) -> SocketAddr {
        SocketAddr::new(self.ip, self.puerto)
    }

    /// URL con la IP validada en lugar del nombre y, si las hay, las credenciales. **Contiene secretos**: solo para pasarla al
    /// proceso/cliente que abre la cámara, nunca a un log ni al WebView.
    pub fn url_para_conectar(&self, credenciales: Option<(&str, &str)>) -> String {
        let host = match self.ip {
            IpAddr::V4(v) => v.to_string(),
            IpAddr::V6(v) => format!("[{v}]"),
        };
        let usuario = match credenciales {
            Some((u, c)) if !u.is_empty() => format!("{}:{}@", pct(u), pct(c)),
            _ => String::new(),
        };
        format!("{}://{}{}:{}{}", self.esquema, usuario, host, self.puerto, self.ruta)
    }
}

/// Codifica un componente de userinfo (`:`, `@`, `/`, `%`… van como %XX).
fn pct(s: &str) -> String {
    let mut o = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            o.push(b as char);
        } else {
            o.push_str(&format!("%{b:02X}"));
        }
    }
    o
}

/// Quién resuelve nombres (en pruebas, un diccionario).
pub trait Resolvedor: Send + Sync {
    fn resolver(&self, host: &str, puerto: u16) -> Result<Vec<IpAddr>, String>;
}

/// Resolvedor del sistema (bloqueante: llamarlo desde `spawn_blocking`).
pub struct ResolvedorSistema;

impl Resolvedor for ResolvedorSistema {
    fn resolver(&self, host: &str, puerto: u16) -> Result<Vec<IpAddr>, String> {
        use std::net::ToSocketAddrs;
        (host, puerto).to_socket_addrs().map(|it| it.map(|s| s.ip()).collect()).map_err(|e| e.to_string())
    }
}

/// ¿Es una dirección de red privada que se acepta para una cámara?
pub fn ip_permitida(ip: IpAddr) -> Result<(), &'static str> {
    match ip {
        IpAddr::V4(v4) => ipv4_permitida(v4),
        IpAddr::V6(v6) => {
            // `::ffff:10.0.0.5` es la 10.0.0.5: se valida como IPv4 (y `::ffff:127.0.0.1` como loopback).
            if let Some(v4) = v6.to_ipv4_mapped() {
                return ipv4_permitida(v4);
            }
            ipv6_permitida(v6)
        }
    }
}

fn ipv4_permitida(ip: Ipv4Addr) -> Result<(), &'static str> {
    let o = ip.octets();
    if ip.is_loopback() {
        return Err("es este mismo equipo");
    }
    if ip.is_unspecified() || o[0] == 0 {
        return Err("no es una dirección de un equipo");
    }
    if ip.is_multicast() || ip.is_broadcast() {
        return Err("es una dirección de difusión");
    }
    if o == [169, 254, 169, 254] {
        return Err("es el servicio de metadatos de la nube");
    }
    if o[0] == 100 && (64..=127).contains(&o[1]) {
        return Err("es una red compartida del proveedor (CGNAT)");
    }
    if o[0] == 10 || (o[0] == 172 && (16..=31).contains(&o[1])) || (o[0] == 192 && o[1] == 168) || (o[0] == 169 && o[1] == 254) {
        return Ok(());
    }
    Err("apunta a internet")
}

fn ipv6_permitida(ip: Ipv6Addr) -> Result<(), &'static str> {
    if ip.is_loopback() {
        return Err("es este mismo equipo");
    }
    if ip.is_unspecified() || ip.is_multicast() {
        return Err("no es una dirección de un equipo");
    }
    let s = ip.segments();
    if (s[0] & 0xfe00) == 0xfc00 || (s[0] & 0xffc0) == 0xfe80 {
        return Ok(());                        // ULA (fc00::/7) o link-local (fe80::/10)
    }
    Err("apunta a internet")
}

/// Puente propio (`127.0.0.1:<puerto>`): la única excepción a la regla del loopback, y solo con host y puerto exactos.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PuentePropio(pub SocketAddr);

fn puerto_por_defecto(esquema: &str) -> u16 {
    match esquema {
        "rtsp" => 554,
        "https" => 443,
        _ => 80,
    }
}

/// Valida la sintaxis y el esquema sin resolver nombres. Devuelve la URL ya analizada.
pub fn analizar(url: &str) -> Result<Url, ErrorSsrf> {
    let u = Url::parse(url.trim()).map_err(|_| ErrorSsrf::Invalida)?;
    match u.scheme() {
        "rtsp" | "http" | "https" => {}
        otro => return Err(ErrorSsrf::EsquemaNoPermitido(otro.to_string())),
    }
    if !u.username().is_empty() || u.password().is_some() {
        return Err(ErrorSsrf::CredencialesEnUrl);
    }
    if u.host_str().map_or(true, str::is_empty) {
        return Err(ErrorSsrf::Invalida);
    }
    Ok(u)
}

/// Valida una dirección de cámara completa: sintaxis, esquema, sin credenciales, resolución de nombres y que TODAS las IP sean privadas.
pub fn validar(url: &str, resolvedor: &dyn Resolvedor, puente: Option<PuentePropio>) -> Result<DestinoValidado, ErrorSsrf> {
    let u = analizar(url)?;
    let esquema = u.scheme().to_string();
    let puerto = u.port().unwrap_or_else(|| puerto_por_defecto(&esquema));
    // Con esquemas «no especiales» como rtsp:// la biblioteca NO normaliza las IP escritas en decimal, hexadecimal u octal
    // (`rtsp://2130706433/` queda como un «nombre»): se vuelve a analizar el host como http:// para que 2130706433, 0x7f.1 o 127.1
    // se vean como la IP que realmente son (127.0.0.1) y no dependan de cómo las interprete después el sistema.
    let host_crudo = u.host_str().unwrap_or_default().to_string();
    let analizado = Url::parse(&format!("http://{host_crudo}/")).map_err(|_| ErrorSsrf::Invalida)?;
    let host = match analizado.host() {
        Some(url::Host::Domain(d)) => d.to_string(),
        Some(url::Host::Ipv4(v)) => v.to_string(),
        Some(url::Host::Ipv6(v)) => v.to_string(),
        None => return Err(ErrorSsrf::Invalida),
    };
    let mut ruta = u.path().to_string();
    if let Some(q) = u.query() {
        ruta.push('?');
        ruta.push_str(q);
    }

    let ips: Vec<IpAddr> = match analizado.host() {
        Some(url::Host::Ipv4(v)) => vec![IpAddr::V4(v)],
        Some(url::Host::Ipv6(v)) => vec![IpAddr::V6(v)],
        _ => {
            let bajo = host.to_ascii_lowercase();
            if bajo == "localhost" || bajo.ends_with(".localhost") {
                if puente.map_or(false, |p| p.0.port() == puerto && p.0.ip().is_loopback()) {
                    vec![IpAddr::V4(Ipv4Addr::LOCALHOST)]
                } else {
                    return Err(ErrorSsrf::DestinoNoPermitido { host, motivo: "es este mismo equipo" });
                }
            } else {
                let r = resolvedor.resolver(&host, puerto).map_err(|_| ErrorSsrf::NoResuelve(host.clone()))?;
                if r.is_empty() {
                    return Err(ErrorSsrf::NoResuelve(host));
                }
                r
            }
        }
    };

    // Cada dirección a la que resuelve el nombre debe ser privada: con una sola pública se rechaza (no se «elige» la buena).
    let mut elegida: Option<IpAddr> = None;
    for ip in &ips {
        let es_puente = puente.map_or(false, |p| p.0.ip() == *ip && p.0.port() == puerto);
        if !es_puente {
            ip_permitida(*ip).map_err(|motivo| ErrorSsrf::DestinoNoPermitido { host: host.clone(), motivo })?;
        }
        // Se prefiere IPv4 (las cámaras y los celulares casi siempre la usan).
        if elegida.is_none() || (ip.is_ipv4() && elegida.map_or(false, |e| e.is_ipv6())) {
            elegida = Some(*ip);
        }
    }
    Ok(DestinoValidado { esquema, host, ip: elegida.expect("al menos una IP"), puerto, ruta })
}

/// ¿Se puede seguir esta redirección? Solo si apunta al MISMO host y puerto (y no cambia a un esquema no permitido).
pub fn redireccion_permitida(origen: &DestinoValidado, ubicacion: &str) -> Result<(), ErrorSsrf> {
    let base = Url::parse(&origen.url_para_conectar(None)).map_err(|_| ErrorSsrf::Invalida)?;
    let destino = base.join(ubicacion.trim()).map_err(|_| ErrorSsrf::Invalida)?;
    if !matches!(destino.scheme(), "rtsp" | "http" | "https") {
        return Err(ErrorSsrf::EsquemaNoPermitido(destino.scheme().to_string()));
    }
    let mismo_host = destino.host_str().map(str::to_ascii_lowercase) == base.host_str().map(str::to_ascii_lowercase)
        || destino.host_str().map(str::to_ascii_lowercase) == Some(origen.host.to_ascii_lowercase());
    let mismo_puerto = destino.port().unwrap_or_else(|| puerto_por_defecto(destino.scheme())) == origen.puerto;
    if mismo_host && mismo_puerto && destino.username().is_empty() {
        Ok(())
    } else {
        Err(ErrorSsrf::RedireccionAOtroHost)
    }
}

/// Texto seguro para logs y mensajes: sin `usuario:clave@` y con los parámetros típicos de contraseña enmascarados.
pub fn redactar_url(url: &str) -> String {
    let Ok(mut u) = Url::parse(url.trim()) else {
        return "<dirección inválida>".into();
    };
    if !u.username().is_empty() || u.password().is_some() {
        let _ = u.set_username("***");
        let _ = u.set_password(None);
    }
    if u.query().is_some() {
        let pares: Vec<(String, String)> = u
            .query_pairs()
            .map(|(k, v)| {
                let sensible = ["pass", "pwd", "password", "clave", "token", "key", "secret", "auth", "user", "usuario"]
                    .iter()
                    .any(|s| k.to_ascii_lowercase().contains(s));
                (k.into_owned(), if sensible { "***".to_string() } else { v.into_owned() })
            })
            .collect();
        u.query_pairs_mut().clear().extend_pairs(pares);
    }
    u.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    struct Dic(HashMap<&'static str, Vec<&'static str>>);
    impl Resolvedor for Dic {
        fn resolver(&self, host: &str, _: u16) -> Result<Vec<IpAddr>, String> {
            self.0.get(host).map(|v| v.iter().map(|s| s.parse().unwrap()).collect()).ok_or_else(|| "no existe".into())
        }
    }
    fn dic() -> Dic {
        Dic(HashMap::from([
            ("camara.local", vec!["192.168.1.50"]),
            ("publica.example", vec!["93.184.216.34"]),
            ("mixta.example", vec!["192.168.1.50", "93.184.216.34"]),     // una buena y una pública: se rechaza
            ("rebind.example", vec!["127.0.0.1"]),
            ("metadatos.example", vec!["169.254.169.254"]),
            ("v6.local", vec!["fd12:3456:789a::1"]),
        ]))
    }
    fn v(url: &str) -> Result<DestinoValidado, ErrorSsrf> { validar(url, &dic(), None) }

    #[test]
    fn acepta_rangos_privados_y_link_local() {
        for ok in [
            "rtsp://10.0.0.5/stream", "rtsp://10.255.255.254:554/a", "rtsp://172.16.0.1/a", "rtsp://172.31.255.255/a",
            "rtsp://192.168.0.10/a", "http://192.168.1.60:8080/video", "rtsp://169.254.10.20/a", "https://192.168.1.60/video",
            "rtsp://[fd12:3456:789a::1]/a", "rtsp://[fe80::1]/a", "rtsp://camara.local/a", "rtsp://v6.local/a",
        ] {
            assert!(v(ok).is_ok(), "debería aceptar {ok}: {:?}", v(ok));
        }
    }

    #[test]
    fn rechaza_localhost_loopback_y_este_equipo() {
        for mal in [
            "rtsp://localhost/a", "rtsp://LOCALHOST:554/a", "http://localhost:8080/video", "rtsp://foo.localhost/a",
            "rtsp://127.0.0.1/a", "rtsp://127.1.2.3/a", "rtsp://[::1]/a", "rtsp://0.0.0.0/a", "rtsp://[::]/a",
            "rtsp://[::ffff:127.0.0.1]/a",             // IPv4 mapeada a loopback
        ] {
            assert!(matches!(v(mal), Err(ErrorSsrf::DestinoNoPermitido { .. })), "debería rechazar {mal}: {:?}", v(mal));
        }
    }

    #[test]
    fn rechaza_ip_publicas_cgnat_y_difusion() {
        for mal in [
            "rtsp://8.8.8.8/a", "rtsp://93.184.216.34/a", "rtsp://172.15.0.1/a", "rtsp://172.32.0.1/a", "rtsp://192.169.0.1/a",
            "rtsp://11.0.0.1/a", "rtsp://100.64.0.1/a", "rtsp://100.127.255.255/a", "rtsp://224.0.0.251/a", "rtsp://255.255.255.255/a",
            "rtsp://169.254.169.254/latest/meta-data", "rtsp://[2001:db8::1]/a", "rtsp://[ff02::1]/a", "rtsp://[::ffff:8.8.8.8]/a",
        ] {
            assert!(matches!(v(mal), Err(ErrorSsrf::DestinoNoPermitido { .. })), "debería rechazar {mal}: {:?}", v(mal));
        }
        // IPv4 mapeada a una privada sí vale
        assert!(v("rtsp://[::ffff:10.0.0.5]/a").is_ok());
    }

    #[test]
    fn rechaza_nombres_que_resuelven_a_ip_publicas_o_a_loopback() {
        assert!(matches!(v("rtsp://publica.example/a"), Err(ErrorSsrf::DestinoNoPermitido { .. })));
        assert!(matches!(v("rtsp://rebind.example/a"), Err(ErrorSsrf::DestinoNoPermitido { .. })));
        assert!(matches!(v("rtsp://metadatos.example/a"), Err(ErrorSsrf::DestinoNoPermitido { .. })));
        assert!(matches!(v("rtsp://mixta.example/a"), Err(ErrorSsrf::DestinoNoPermitido { .. })), "con UNA IP pública entre varias se rechaza");
        assert!(matches!(v("rtsp://nadie.example/a"), Err(ErrorSsrf::NoResuelve(_))));
    }

    #[test]
    fn rechaza_esquemas_no_permitidos() {
        for mal in ["file:///etc/passwd", "ftp://192.168.1.5/a", "gopher://10.0.0.1/", "javascript:alert(1)", "data:text/plain,hola", "ws://10.0.0.1/", "rtsps://192.168.1.5/a"] {
            assert!(matches!(v(mal), Err(ErrorSsrf::EsquemaNoPermitido(_)) | Err(ErrorSsrf::Invalida)), "debería rechazar {mal}");
        }
        assert!(v("rtsps://192.168.1.5/a").unwrap_err().mensaje().contains("rtsps"));
    }

    #[test]
    fn rechaza_credenciales_en_la_url_y_direcciones_rotas() {
        assert_eq!(v("rtsp://admin:1234@192.168.1.5/a"), Err(ErrorSsrf::CredencialesEnUrl));
        assert_eq!(v("rtsp://admin@192.168.1.5/a"), Err(ErrorSsrf::CredencialesEnUrl));
        for mal in ["", "   ", "rtsp://", "no es una url", "rtsp:///ruta", "http://"] {
            assert!(v(mal).is_err(), "debería rechazar {mal:?}");
        }
    }

    #[test]
    fn trucos_de_url_para_esconder_el_host_no_funcionan() {
        // `@` oculta el host real tras un «usuario»; decimal/hex/octal de IP se normalizan; barra invertida; espacios.
        assert!(v("http://192.168.1.5@8.8.8.8/a").is_err());
        assert!(v("http://8.8.8.8#@192.168.1.5/a").is_err());
        assert!(matches!(v("http://2130706433/a"), Err(ErrorSsrf::DestinoNoPermitido { .. })), "127.0.0.1 en decimal");
        assert!(matches!(v("http://0x7f.0.0.1/a"), Err(ErrorSsrf::DestinoNoPermitido { .. })), "127.0.0.1 en hexadecimal");
        assert!(matches!(v("http://0177.0.0.1/a"), Err(ErrorSsrf::DestinoNoPermitido { .. })), "127.0.0.1 en octal");
        assert!(matches!(v("http://127.1/a"), Err(ErrorSsrf::DestinoNoPermitido { .. })));
        // La barra invertida es una barra (WHATWG): el host es 192.168.1.5 y lo demás es ruta; no se llega a 8.8.8.8.
        let d = v("http://192.168.1.5\\@8.8.8.8/a").unwrap();
        assert_eq!(d.ip, "192.168.1.5".parse::<IpAddr>().unwrap());
        assert!(!d.url_para_conectar(None).starts_with("http://8.8.8.8"));
        assert!(matches!(v("rtsp://2130706433/a"), Err(ErrorSsrf::DestinoNoPermitido { .. })), "también con rtsp://");
        assert!(matches!(v("rtsp://0x7f.0.0.1/a"), Err(ErrorSsrf::DestinoNoPermitido { .. })));
        assert!(matches!(v("rtsp://0300.0250.0.1/a"), Ok(_)), "192.168.0.1 en octal es privada");
    }

    #[test]
    fn el_puerto_por_defecto_y_la_ruta_se_conservan() {
        let d = v("rtsp://192.168.1.50/Streaming/Channels/101?transportmode=unicast").unwrap();
        assert_eq!((d.puerto, d.ruta.as_str()), (554, "/Streaming/Channels/101?transportmode=unicast"));
        assert_eq!(v("http://192.168.1.60/video").unwrap().puerto, 80);
        assert_eq!(v("https://192.168.1.60/video").unwrap().puerto, 443);
        assert_eq!(v("http://192.168.1.60:4747/video").unwrap().puerto, 4747);
    }

    #[test]
    fn se_conecta_a_la_ip_validada_no_al_nombre() {
        let d = v("rtsp://camara.local/a").unwrap();
        assert_eq!(d.ip, "192.168.1.50".parse::<IpAddr>().unwrap());
        assert_eq!(d.url_para_conectar(None), "rtsp://192.168.1.50:554/a");
        let con = d.url_para_conectar(Some(("admin", "p@ss:/1")));
        assert_eq!(con, "rtsp://admin:p%40ss%3A%2F1@192.168.1.50:554/a", "usuario y clave codificados");
        assert_eq!(v("rtsp://[fd12:3456:789a::1]/a").unwrap().url_para_conectar(None), "rtsp://[fd12:3456:789a::1]:554/a");
    }

    #[test]
    fn el_puente_propio_es_la_unica_excepcion_del_loopback_y_solo_con_puerto_exacto() {
        let puente = Some(PuentePropio("127.0.0.1:41999".parse().unwrap()));
        assert!(validar("http://127.0.0.1:41999/v/abc?t=x", &dic(), puente).is_ok());
        assert!(validar("http://localhost:41999/v/abc", &dic(), puente).is_ok());
        assert!(matches!(validar("http://127.0.0.1:8080/x", &dic(), puente), Err(ErrorSsrf::DestinoNoPermitido { .. })), "otro puerto del loopback no");
        assert!(matches!(validar("http://127.0.0.1:41999/x", &dic(), None), Err(ErrorSsrf::DestinoNoPermitido { .. })), "sin puente declarado no hay excepción");
        assert!(matches!(validar("http://8.8.8.8:41999/x", &dic(), puente), Err(ErrorSsrf::DestinoNoPermitido { .. })));
    }

    #[test]
    fn redirecciones_solo_al_mismo_host() {
        let d = v("http://192.168.1.60:8080/video").unwrap();
        assert!(redireccion_permitida(&d, "/video2").is_ok());
        assert!(redireccion_permitida(&d, "http://192.168.1.60:8080/otra").is_ok());
        assert_eq!(redireccion_permitida(&d, "http://192.168.1.61:8080/video"), Err(ErrorSsrf::RedireccionAOtroHost));
        assert_eq!(redireccion_permitida(&d, "http://192.168.1.60:9999/video"), Err(ErrorSsrf::RedireccionAOtroHost), "otro puerto");
        assert_eq!(redireccion_permitida(&d, "http://169.254.169.254/latest"), Err(ErrorSsrf::RedireccionAOtroHost));
        assert_eq!(redireccion_permitida(&d, "http://evil.example/x"), Err(ErrorSsrf::RedireccionAOtroHost));
        assert_eq!(redireccion_permitida(&d, "http://127.0.0.1/x"), Err(ErrorSsrf::RedireccionAOtroHost));
        assert!(matches!(redireccion_permitida(&d, "file:///etc/passwd"), Err(ErrorSsrf::EsquemaNoPermitido(_))));
        assert_eq!(redireccion_permitida(&d, "http://u:p@192.168.1.60:8080/x"), Err(ErrorSsrf::RedireccionAOtroHost));
    }

    #[test]
    fn redactar_url_esconde_credenciales_y_parametros_sensibles() {
        let r = redactar_url("rtsp://admin:SuperSecreta@192.168.1.5:554/live?password=SuperSecreta&canal=1&token=abc");
        assert!(!r.contains("SuperSecreta") && !r.contains("abc") && !r.contains("admin"), "{r}");
        assert!(r.contains("192.168.1.5") && r.contains("canal=1"));
        assert_eq!(redactar_url("esto no es url"), "<dirección inválida>");
        assert_eq!(redactar_url("rtsp://192.168.1.5/a"), "rtsp://192.168.1.5/a");
    }

    #[test]
    fn los_mensajes_no_filtran_credenciales_ni_dan_pistas_de_la_red_interna() {
        for e in [ErrorSsrf::Invalida, ErrorSsrf::CredencialesEnUrl, ErrorSsrf::RedireccionAOtroHost,
                  ErrorSsrf::DestinoNoPermitido { host: "x".into(), motivo: "apunta a internet" }, ErrorSsrf::NoResuelve("camara".into())] {
            let m = e.mensaje();
            assert!(!m.is_empty() && !m.contains("Err") && !m.contains("::"), "{m}");
        }
    }
}
