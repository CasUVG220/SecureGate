//! Descubrimiento de cámaras ONVIF por WS-Discovery (T8).
//!
//! Se manda un `Probe` por UDP multicast (239.255.255.250:3702) pidiendo `NetworkVideoTransmitter` y se escuchan unos segundos las
//! `ProbeMatches`. De cada respuesta solo se toma lo que aporta al alta: el **nombre** y el **modelo** (los «scopes» `onvif://…/name/…`
//! y `/hardware/…`) y la **dirección IP**, que sale del **origen del paquete** y NO de lo que diga el XML: una respuesta falsificada no
//! puede mandarnos a otra dirección (SSRF). Además se descartan respuestas de IP que no sean de una red privada, se limita su tamaño
//! y se deduplica por IP.
//!
//! No obtiene la dirección RTSP (eso exige llamadas SOAP autenticadas al servicio de medios de cada cámara): sugiere
//! `rtsp://<ip>:554/` y la persona completa la ruta del video y la contraseña. **Sin probar con cámaras reales**: se prueba con un
//! respondedor simulado.

use std::collections::HashSet;
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;

use serde::Serialize;
use tokio::net::UdpSocket;

/// Grupo y puerto de WS-Discovery.
pub const MULTICAST: &str = "239.255.255.250:3702";
const MAX_RESPUESTA: usize = 64 * 1024;
const MAX_DISPOSITIVOS: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DispositivoOnvif {
    pub ip: String,
    pub nombre: Option<String>,
    pub modelo: Option<String>,
    /// Dirección para empezar el alta (la persona completa la ruta y las credenciales).
    pub url_sugerida: String,
}

pub fn construir_probe(id_mensaje: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl"><e:Header><w:MessageID>uuid:{id_mensaje}</w:MessageID><w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To><w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header><e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body></e:Envelope>"#
    )
}

/// Texto de la primera etiqueta `<[prefijo:]nombre>…</[prefijo:]nombre>` (sin interpretar nada más del XML).
fn etiqueta<'a>(xml: &'a str, nombre: &str) -> Option<&'a str> {
    let mut desde = 0;
    while let Some(i) = xml[desde..].find('<') {
        let ini = desde + i + 1;
        let fin_tag = xml[ini..].find('>')? + ini;
        let tag = &xml[ini..fin_tag];
        let sin_prefijo = tag.split_whitespace().next().unwrap_or("").rsplit(':').next().unwrap_or("");
        if sin_prefijo == nombre && !tag.starts_with('/') && !tag.ends_with('/') {
            let cuerpo = &xml[fin_tag + 1..];
            let cierre = cuerpo.find("</")?;
            return Some(cuerpo[..cierre].trim());
        }
        desde = fin_tag;
    }
    None
}

fn hex(b: u8) -> Option<u8> {
    (b as char).to_digit(16).map(|d| d as u8)
}

fn decodificar_pct(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Valor de un scope `onvif://www.onvif.org/<clave>/<valor>` (con el valor decodificado). Se descartan caracteres de control y se
/// limita el largo: es texto que llega de la red y se muestra en pantalla.
fn scope(scopes: &str, clave: &str) -> Option<String> {
    let marca = format!("/{clave}/");
    scopes.split_whitespace().find_map(|s| {
        let v = s.split_once(&marca)?.1;
        let v: String = decodificar_pct(v).chars().filter(|c| !c.is_control()).take(60).collect();
        let v = v.trim().to_string();
        (!v.is_empty()).then_some(v)
    })
}

/// Interpreta una respuesta. `origen` es la IP desde la que llegó el paquete (la única que se usa como dirección de la cámara).
pub fn parsear_respuesta(xml: &str, origen: IpAddr) -> Option<DispositivoOnvif> {
    if !xml.contains("ProbeMatch") {
        return None;
    }
    // Si declara tipos, debe ser un transmisor de video (las impresoras u otros equipos ONVIF no interesan).
    if let Some(tipos) = etiqueta(xml, "Types") {
        if !tipos.contains("NetworkVideoTransmitter") && !tipos.contains("Device") {
            return None;
        }
    }
    let scopes = etiqueta(xml, "Scopes").unwrap_or_default();
    let nombre = scope(scopes, "name");
    let modelo = scope(scopes, "hardware");
    Some(DispositivoOnvif { ip: origen.to_string(), nombre, modelo, url_sugerida: format!("rtsp://{origen}:554/") })
}

/// Manda el `Probe` a `destino` y junta durante `duracion` las respuestas de IP aceptadas por `permitir`.
/// En producción `destino` es `MULTICAST` y `permitir` exige redes privadas; en las pruebas es un respondedor local.
pub async fn descubrir(destino: SocketAddr, duracion: Duration, permitir: &(dyn Fn(IpAddr) -> bool + Sync)) -> std::io::Result<Vec<DispositivoOnvif>> {
    let socket = UdpSocket::bind("0.0.0.0:0").await?;
    let _ = socket.set_multicast_ttl_v4(2);
    let probe = construir_probe(&uuid::Uuid::new_v4().to_string());
    socket.send_to(probe.as_bytes(), destino).await?;

    let mut vistos: HashSet<IpAddr> = HashSet::new();
    let mut hallados = Vec::new();
    let limite = tokio::time::Instant::now() + duracion;
    let mut buf = vec![0u8; MAX_RESPUESTA];
    loop {
        let resto = limite.saturating_duration_since(tokio::time::Instant::now());
        if resto.is_zero() || hallados.len() >= MAX_DISPOSITIVOS {
            break;
        }
        let Ok(Ok((n, desde))) = tokio::time::timeout(resto, socket.recv_from(&mut buf)).await else { break };
        let ip = match desde.ip() {
            IpAddr::V6(v6) => v6.to_ipv4_mapped().map(IpAddr::V4).unwrap_or(IpAddr::V6(v6)),
            ip => ip,
        };
        if !permitir(ip) || !vistos.insert(ip) {
            continue;
        }
        let Ok(texto) = std::str::from_utf8(&buf[..n]) else { continue };
        if let Some(d) = parsear_respuesta(texto, ip) {
            hallados.push(d);
        }
    }
    Ok(hallados)
}

/// Producción: solo respuestas que vengan de una IP privada.
pub fn solo_redes_privadas(ip: IpAddr) -> bool {
    super::ssrf::ip_permitida(ip).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn respuesta(scopes: &str, xaddrs: &str, tipos: &str) -> String {
        format!(
            r#"<?xml version="1.0"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope" xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"><SOAP-ENV:Header><wsa:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/ProbeMatches</wsa:Action></SOAP-ENV:Header><SOAP-ENV:Body><d:ProbeMatches><d:ProbeMatch><wsa:EndpointReference><wsa:Address>urn:uuid:11111111-2222-3333-4444-555555555555</wsa:Address></wsa:EndpointReference><d:Types>{tipos}</d:Types><d:Scopes>{scopes}</d:Scopes><d:XAddrs>{xaddrs}</d:XAddrs><d:MetadataVersion>1</d:MetadataVersion></d:ProbeMatch></d:ProbeMatches></SOAP-ENV:Body></SOAP-ENV:Envelope>"#
        )
    }

    const IP: &str = "192.168.1.64";

    #[test]
    fn el_probe_pide_transmisores_de_video_y_lleva_un_id_unico() {
        let p = construir_probe("abc");
        assert!(p.contains("dn:NetworkVideoTransmitter") && p.contains("uuid:abc") && p.contains("discovery/Probe"));
    }

    #[test]
    fn lee_nombre_y_modelo_de_los_scopes_y_usa_la_ip_del_origen() {
        let x = respuesta(
            "onvif://www.onvif.org/type/video_encoder onvif://www.onvif.org/name/Camara%20Carril onvif://www.onvif.org/hardware/DS%2D2CD2043 onvif://www.onvif.org/location/country/gt",
            "http://192.168.1.64/onvif/device_service", "dn:NetworkVideoTransmitter tds:Device",
        );
        let d = parsear_respuesta(&x, IP.parse().unwrap()).unwrap();
        assert_eq!(d.nombre.as_deref(), Some("Camara Carril"));
        assert_eq!(d.modelo.as_deref(), Some("DS-2CD2043"));
        assert_eq!(d.ip, IP);
        assert_eq!(d.url_sugerida, "rtsp://192.168.1.64:554/");
    }

    #[test]
    fn la_ip_no_sale_del_xml_una_respuesta_falsa_no_redirige_a_otro_equipo() {
        let x = respuesta("onvif://www.onvif.org/name/Trampa", "http://169.254.169.254/latest/meta-data http://8.8.8.8/onvif/device_service", "dn:NetworkVideoTransmitter");
        let d = parsear_respuesta(&x, IP.parse().unwrap()).unwrap();
        assert_eq!(d.ip, IP, "solo cuenta de dónde llegó el paquete");
        assert!(!d.url_sugerida.contains("8.8.8.8") && !d.url_sugerida.contains("169.254"));
    }

    #[test]
    fn ignora_lo_que_no_es_una_probematch_o_no_es_camara() {
        assert!(parsear_respuesta("<html>hola</html>", IP.parse().unwrap()).is_none());
        assert!(parsear_respuesta(&respuesta("onvif://x/name/Impresora", "http://x", "wsdp:Printer"), IP.parse().unwrap()).is_none());
    }

    #[test]
    fn sin_scopes_igual_se_lista_la_camara_por_su_ip() {
        let d = parsear_respuesta(&respuesta("", "http://192.168.1.64/x", "dn:NetworkVideoTransmitter"), IP.parse().unwrap()).unwrap();
        assert_eq!((d.nombre, d.modelo), (None, None));
    }

    #[test]
    fn el_texto_que_llega_de_la_red_se_limpia_y_se_acota() {
        let largo = "A".repeat(500);
        let x = respuesta(&format!("onvif://www.onvif.org/name/{largo} onvif://www.onvif.org/hardware/mod%0Aelo%00"), "http://x", "dn:NetworkVideoTransmitter");
        let d = parsear_respuesta(&x, IP.parse().unwrap()).unwrap();
        assert_eq!(d.nombre.unwrap().len(), 60);
        assert_eq!(d.modelo.as_deref(), Some("modelo"), "sin saltos de línea ni NUL");
    }

    #[test]
    fn decodificar_porcentajes_no_se_rompe_con_entradas_raras() {
        for s in ["%", "%4", "%zz", "%%%", "abc%", "100%25", "a%2", "%é9", "é%2é"] {
            let _ = decodificar_pct(s);
        }
        assert_eq!(decodificar_pct("a%20b%2Dc"), "a b-c");
        assert_eq!(decodificar_pct("100%25"), "100%");
    }

    // ── descubrimiento de punta a punta con un respondedor UDP simulado ──
    async fn respondedor(respuestas: Vec<(String, u16)>) -> SocketAddr {
        let s = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let addr = s.local_addr().unwrap();
        tokio::spawn(async move {
            let mut b = vec![0u8; 8192];
            if let Ok((n, quien)) = s.recv_from(&mut b).await {
                assert!(String::from_utf8_lossy(&b[..n]).contains("NetworkVideoTransmitter"), "recibió un Probe");
                for (xml, _) in respuestas {
                    let _ = s.send_to(xml.as_bytes(), quien).await;
                }
            }
        });
        addr
    }

    #[tokio::test]
    async fn descubre_las_camaras_simuladas_y_deduplica() {
        let uno = respuesta("onvif://www.onvif.org/name/Carril", "http://127.0.0.1/x", "dn:NetworkVideoTransmitter");
        let addr = respondedor(vec![(uno.clone(), 0), (uno, 0), ("basura".into(), 0)]).await;
        let r = descubrir(addr, Duration::from_millis(400), &|_| true).await.unwrap();
        assert_eq!(r.len(), 1, "misma IP repetida = una sola; la basura se ignora: {r:?}");
        assert_eq!(r[0].nombre.as_deref(), Some("Carril"));
    }

    #[tokio::test]
    async fn descarta_respuestas_de_ip_no_permitidas() {
        let uno = respuesta("onvif://www.onvif.org/name/Falsa", "http://8.8.8.8/x", "dn:NetworkVideoTransmitter");
        let addr = respondedor(vec![(uno, 0)]).await;
        // En producción el loopback no es una red privada permitida:
        let r = descubrir(addr, Duration::from_millis(300), &solo_redes_privadas).await.unwrap();
        assert!(r.is_empty());
    }

    #[tokio::test]
    async fn sin_respuestas_devuelve_lista_vacia_al_cumplirse_el_tiempo() {
        let s = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let t0 = std::time::Instant::now();
        let r = descubrir(s.local_addr().unwrap(), Duration::from_millis(250), &|_| true).await.unwrap();
        assert!(r.is_empty());
        assert!(t0.elapsed() >= Duration::from_millis(240) && t0.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn el_filtro_de_produccion_solo_deja_redes_privadas() {
        assert!(solo_redes_privadas("192.168.1.64".parse().unwrap()));
        assert!(solo_redes_privadas("10.1.2.3".parse().unwrap()));
        assert!(!solo_redes_privadas("8.8.8.8".parse().unwrap()));
        assert!(!solo_redes_privadas("127.0.0.1".parse().unwrap()));
    }
}
