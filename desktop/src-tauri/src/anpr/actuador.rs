//! Actuador de barrera del ANPR (Sprint 10): lo que «abre» cuando un vehículo autorizado entra solo.
//!
//! El hardware de barrera todavía no existe (lo suministra el integrador), así que **no se inventa ningún protocolo**: el resto
//! del ANPR habla solo con el trait [`ActuadorBarrera`] y hay tres implementaciones, elegidas por carril:
//!
//! | Actuador | Qué hace |
//! |---|---|
//! | [`Simulado`] (por defecto) | No toca nada: deja la apertura en el log y la pantalla la muestra («Barrera abierta (simulada)») |
//! | [`ReleHttp`] | Un `GET`/`POST` a la URL del relé (IP privada, `http://`), con timeout y **un** reintento |
//! | [`Talanquera`] | Usa la talanquera ya configurada del equipo (relé USB/Ethernet de `hardware/`) |
//!
//! Reglas (las mismas que la talanquera): `abrir()` es síncrono y acotado en tiempo (quien lo llama usa `spawn_blocking`), y un
//! fallo **nunca** deshace el acceso ya registrado: se reporta como alerta al agente.
//!
//! # Cómo agregar un actuador nuevo
//! 1. Una struct que implemente [`ActuadorBarrera`] (si habla con el mundo, detrás de un trait chico para probarla, como
//!    [`Transporte`]).
//! 2. Una variante en [`ConfigActuador`] con SUS parámetros (`#[serde(default)]` en los campos nuevos) y su validación en
//!    `ConfigActuador::validar`.
//! 3. Construirla en [`crear`]. 4. La opción en la pantalla de configuración del carril (`AnprConfigDialog.tsx`).
//! 5. Pruebas: qué se envía, qué pasa si no responde, y que un fallo no toca el acceso encolado.

use std::net::IpAddr;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::camaras::ssrf;
use crate::hardware::tcp::{MetodoHttp, Transporte, TransporteReal};
use crate::hardware::TalanqueraDriver;

pub const TIMEOUT_MS_DEFECTO: u64 = 2000;

/// Contrato único del actuador.
pub trait ActuadorBarrera: Send + Sync {
    /// Manda abrir. Vuelve en pocos segundos como máximo, pase lo que pase.
    fn abrir(&self) -> Result<(), String>;
    /// Para mostrar en la pantalla y en el log.
    fn nombre(&self) -> String;
    /// `true` si no mueve nada físico (la pantalla lo dice).
    fn simulado(&self) -> bool {
        false
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(tag = "tipo", rename_all = "snake_case")]
pub enum ConfigActuador {
    #[default]
    Simulado,
    ReleHttp {
        url: String,
        #[serde(default)]
        metodo: MetodoHttp,
        #[serde(default = "timeout_defecto")]
        timeout_ms: u64,
        /// Solo POST: cuerpo tal cual (algunos relés piden `{"relay":1}`).
        #[serde(default)]
        cuerpo: Option<String>,
    },
    /// La talanquera configurada del equipo.
    Talanquera,
}

fn timeout_defecto() -> u64 {
    TIMEOUT_MS_DEFECTO
}

impl ConfigActuador {
    /// Validación sin red (se guarda solo si pasa). Mensajes para el agente.
    pub fn validar(&self) -> Result<(), String> {
        match self {
            ConfigActuador::Simulado | ConfigActuador::Talanquera => Ok(()),
            ConfigActuador::ReleHttp { url, timeout_ms, cuerpo, .. } => {
                validar_url_rele(url)?;
                if !(200..=10_000).contains(timeout_ms) {
                    return Err("El tiempo de espera del relé debe estar entre 0,2 y 10 segundos.".into());
                }
                if cuerpo.as_ref().is_some_and(|c| c.len() > 1024) {
                    return Err("El cuerpo de la petición al relé admite hasta 1 024 caracteres.".into());
                }
                Ok(())
            }
        }
    }
}

/// La URL del relé: `http://` y una IP de la red local escrita tal cual (los relés se configuran por IP; un nombre podría
/// resolver a cualquier lado). Mismo criterio de direcciones permitidas que las cámaras (`camaras::ssrf`).
pub fn validar_url_rele(url: &str) -> Result<(), String> {
    let u = url::Url::parse(url.trim()).map_err(|_| "La dirección del relé no es válida.".to_string())?;
    if u.scheme() != "http" {
        return Err("El relé se configura con http:// (sin cifrado: debe estar en la red local de la garita).".into());
    }
    if !u.username().is_empty() || u.password().is_some() {
        return Err("La dirección del relé no puede llevar usuario ni contraseña.".into());
    }
    let ip: IpAddr = match u.host() {
        Some(url::Host::Ipv4(v)) => IpAddr::V4(v),
        Some(url::Host::Ipv6(v)) => IpAddr::V6(v),
        _ => return Err("Escribe la IP del relé (por ejemplo http://192.168.1.50/abrir), no un nombre.".into()),
    };
    ssrf::ip_permitida(ip).map_err(|m| format!("Esa dirección no se acepta para el relé: {m}."))
}

/// No mueve nada: la apertura queda en el log y la pantalla la muestra como simulada.
pub struct Simulado;

impl ActuadorBarrera for Simulado {
    fn abrir(&self) -> Result<(), String> {
        log::info!("anpr: apertura SIMULADA de la barrera");
        Ok(())
    }
    fn nombre(&self) -> String {
        "Barrera simulada".into()
    }
    fn simulado(&self) -> bool {
        true
    }
}

pub struct ReleHttp {
    url: String,
    metodo: MetodoHttp,
    timeout: Duration,
    cuerpo: Vec<u8>,
    transporte: Arc<dyn Transporte>,
}

impl ReleHttp {
    pub fn con_transporte(url: &str, metodo: MetodoHttp, timeout_ms: u64, cuerpo: Option<&str>, transporte: Arc<dyn Transporte>) -> Self {
        Self {
            url: url.trim().to_string(),
            metodo,
            timeout: Duration::from_millis(timeout_ms),
            cuerpo: cuerpo.unwrap_or_default().as_bytes().to_vec(),
            transporte,
        }
    }
}

impl ActuadorBarrera for ReleHttp {
    /// Un intento y, si falla, **un** reintento: con el relé apagado cuesta como mucho 2 × timeout.
    fn abrir(&self) -> Result<(), String> {
        let intento = || self.transporte.http(self.metodo, &self.url, &self.cuerpo, self.timeout).map_err(|e| e.to_string());
        match intento() {
            Ok(()) => Ok(()),
            Err(primero) => {
                log::warn!("anpr: el relé no respondió ({primero}); se reintenta una vez");
                intento().map_err(|e| format!("El relé no respondió: {e}"))
            }
        }
    }
    fn nombre(&self) -> String {
        format!("Relé HTTP {}", ssrf::redactar_url(&self.url))
    }
}

/// Adaptador a la talanquera ya configurada del equipo.
pub struct Talanquera(pub Arc<dyn TalanqueraDriver>);

impl ActuadorBarrera for Talanquera {
    fn abrir(&self) -> Result<(), String> {
        self.0.abrir().map_err(|e| e.to_string())
    }
    fn nombre(&self) -> String {
        format!("Talanquera del equipo ({})", self.0.nombre())
    }
}

/// Fábrica: la única función que conoce los actuadores concretos. `talanquera` = el driver activo del equipo.
pub fn crear(cfg: &ConfigActuador, talanquera: Arc<dyn TalanqueraDriver>) -> Result<Arc<dyn ActuadorBarrera>, String> {
    cfg.validar()?;
    Ok(match cfg {
        ConfigActuador::Simulado => Arc::new(Simulado),
        ConfigActuador::ReleHttp { url, metodo, timeout_ms, cuerpo } => {
            Arc::new(ReleHttp::con_transporte(url, *metodo, *timeout_ms, cuerpo.as_deref(), Arc::new(TransporteReal)))
        }
        ConfigActuador::Talanquera => Arc::new(Talanquera(talanquera)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hardware::{EstadoConexion, TalanqueraError};
    use std::sync::Mutex;

    /// Transporte que registra lo que se envía y falla las primeras `fallas` veces.
    struct TransporteFalso {
        enviados: Mutex<Vec<(MetodoHttp, String, Vec<u8>, Duration)>>,
        fallas: Mutex<u32>,
    }

    impl TransporteFalso {
        fn nuevo(fallas: u32) -> Arc<Self> {
            Arc::new(Self { enviados: Mutex::new(vec![]), fallas: Mutex::new(fallas) })
        }
    }

    impl Transporte for TransporteFalso {
        fn tcp(&self, _: &str, _: u16, _: &[u8], _: Duration) -> Result<(), TalanqueraError> {
            unreachable!()
        }
        fn http(&self, metodo: MetodoHttp, url: &str, cuerpo: &[u8], timeout: Duration) -> Result<(), TalanqueraError> {
            self.enviados.lock().unwrap().push((metodo, url.to_string(), cuerpo.to_vec(), timeout));
            let mut f = self.fallas.lock().unwrap();
            if *f > 0 {
                *f -= 1;
                return Err(TalanqueraError::Timeout(url.into()));
            }
            Ok(())
        }
        fn alcanzable(&self, _: &str, _: u16, _: Duration) -> bool {
            true
        }
    }

    #[test]
    fn rele_http_envia_metodo_url_cuerpo_y_timeout_configurados() {
        let t = TransporteFalso::nuevo(0);
        let r = ReleHttp::con_transporte(" http://192.168.1.50/relay?ch=1 ", MetodoHttp::Post, 1500, Some("{\"on\":1}"), t.clone());
        assert_eq!(r.abrir(), Ok(()));
        let e = t.enviados.lock().unwrap();
        assert_eq!(e.len(), 1);
        assert_eq!(e[0], (MetodoHttp::Post, "http://192.168.1.50/relay?ch=1".to_string(), b"{\"on\":1}".to_vec(), Duration::from_millis(1500)));
    }

    #[test]
    fn rele_http_reintenta_una_sola_vez() {
        let una_falla = TransporteFalso::nuevo(1);
        assert_eq!(ReleHttp::con_transporte("http://10.0.0.9/on", MetodoHttp::Get, 500, None, una_falla.clone()).abrir(), Ok(()));
        assert_eq!(una_falla.enviados.lock().unwrap().len(), 2, "falló una vez y el reintento abrió");

        let caido = TransporteFalso::nuevo(5);
        let err = ReleHttp::con_transporte("http://10.0.0.9/on", MetodoHttp::Get, 500, None, caido.clone()).abrir().unwrap_err();
        assert!(err.contains("no respondió"), "{err}");
        assert_eq!(caido.enviados.lock().unwrap().len(), 2, "nunca más de un reintento");
    }

    #[test]
    fn la_url_del_rele_solo_acepta_http_con_ip_privada() {
        assert!(validar_url_rele("http://192.168.1.50/abrir").is_ok());
        assert!(validar_url_rele("http://10.1.2.3:8080/relay?x=1").is_ok());
        assert!(validar_url_rele("http://[fd00::5]/on").is_ok());
        for (url, parte) in [
            ("https://192.168.1.50/abrir", "http://"),
            ("http://rele.local/abrir", "IP"),
            ("http://8.8.8.8/abrir", "internet"),
            ("http://127.0.0.1:9000/abrir", "este mismo equipo"),
            ("http://169.254.169.254/latest", "metadatos"),
            ("http://admin:clave@192.168.1.50/abrir", "usuario"),
            ("no es url", "válida"),
        ] {
            let e = validar_url_rele(url).unwrap_err();
            assert!(e.contains(parte), "{url}: {e}");
        }
    }

    #[test]
    fn validacion_de_la_config_y_fabrica() {
        assert!(ConfigActuador::Simulado.validar().is_ok());
        let mal = ConfigActuador::ReleHttp { url: "http://192.168.1.5/x".into(), metodo: MetodoHttp::Get, timeout_ms: 50, cuerpo: None };
        assert!(mal.validar().unwrap_err().contains("tiempo"));
        let grande = ConfigActuador::ReleHttp { url: "http://192.168.1.5/x".into(), metodo: MetodoHttp::Post, timeout_ms: 2000, cuerpo: Some("x".repeat(2000)) };
        assert!(grande.validar().is_err());
        let sin = Arc::new(crate::hardware::SinDriver) as Arc<dyn TalanqueraDriver>;
        let s = crear(&ConfigActuador::Simulado, sin.clone()).unwrap();
        assert!(s.simulado() && s.abrir().is_ok());
        assert!(crear(&ConfigActuador::ReleHttp { url: "http://8.8.8.8/".into(), metodo: MetodoHttp::Get, timeout_ms: 2000, cuerpo: None }, sin.clone()).is_err());
        let rele = crear(&ConfigActuador::ReleHttp { url: "http://192.168.1.5/x".into(), metodo: MetodoHttp::Get, timeout_ms: 2000, cuerpo: None }, sin.clone()).unwrap();
        assert!(!rele.simulado());
        assert_eq!(rele.nombre(), "Relé HTTP http://192.168.1.5/x");
        // La talanquera del equipo sin driver configurado falla con un mensaje claro (y el acceso igual queda registrado).
        let t = crear(&ConfigActuador::Talanquera, sin).unwrap();
        assert!(t.abrir().unwrap_err().contains("driver"));
    }

    #[test]
    fn la_config_viaja_como_json_etiquetado_y_una_vieja_sin_campos_carga() {
        let c = ConfigActuador::ReleHttp { url: "http://192.168.1.5/x".into(), metodo: MetodoHttp::Post, timeout_ms: 1000, cuerpo: Some("1".into()) };
        let j = serde_json::to_string(&c).unwrap();
        assert!(j.contains("\"tipo\":\"rele_http\""));
        assert_eq!(serde_json::from_str::<ConfigActuador>(&j).unwrap(), c);
        let viejo: ConfigActuador = serde_json::from_str(r#"{"tipo":"rele_http","url":"http://10.0.0.2/"}"#).unwrap();
        assert_eq!(viejo, ConfigActuador::ReleHttp { url: "http://10.0.0.2/".into(), metodo: MetodoHttp::Get, timeout_ms: 2000, cuerpo: None });
        assert_eq!(serde_json::from_str::<ConfigActuador>(r#"{"tipo":"simulado"}"#).unwrap(), ConfigActuador::Simulado);
        let _ = EstadoConexion::SinDriver;
    }
}
