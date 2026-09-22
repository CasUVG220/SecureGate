//! Apertura física de la talanquera/portón: capa de abstracción con
//! adaptadores intercambiables.
//!
//! SecureGate no fabrica hardware: se integra con lo que cada condominio ya
//! tiene, y eso cambia de marca en marca. Por eso el resto de la app —UI,
//! flujo de acceso— habla sólo con el trait [`TalanqueraDriver`], y cada
//! dispositivo concreto es un adaptador aparte:
//!
//! | Adaptador | Módulo | Estado |
//! |---|---|---|
//! | Relé USB por puerto serial | [`serial`] | Implementado (prioridad máxima) |
//! | Relé Ethernet (TCP crudo o HTTP) | [`tcp`] | Implementado |
//! | GPIO directo (Raspberry Pi) | [`gpio`] | Stub documentado |
//! | Placa Wiegand/RS485 con SDK propio | — | Pendiente de un cliente real; ver "Cómo agregar un adaptador" abajo |
//!
//! Reglas que cumplen todos:
//! - `abrir()` es **síncrono y acotado en tiempo** (pulso de relé o timeout
//!   de red de pocos segundos). Quien lo llama desde un comando de Tauri lo
//!   envuelve en `spawn_blocking` para no congelar la garita.
//! - Un fallo de hardware **nunca** revierte un acceso ya registrado: la
//!   apertura es lo último que ocurre y su resultado se reporta aparte.
//! - Sin driver configurado ([`ConfigHardware::Ninguno`]) todo sigue
//!   funcionando; sólo no se abre nada automáticamente.
//!
//! # Cómo agregar un adaptador nuevo
//!
//! 1. Crea `hardware/<marca>.rs` con una struct que implemente
//!    [`TalanqueraDriver`]. Si habla con el mundo (puerto, socket, SDK),
//!    sepáralo detrás de un trait pequeño (ver `serial::Canal` o
//!    `tcp::Conector`) para poder mockearlo en `cargo test`.
//! 2. Añade una variante a [`ConfigHardware`] con SUS parámetros (serde la
//!    serializa a JSON en `config_hardware`; usa `#[serde(default)]` en los
//!    campos nuevos para no romper configs guardadas).
//! 3. Enséñale a [`crear_driver`] a construirlo desde esa variante.
//! 4. En el frontend, añade la opción al selector de
//!    `HardwareConfigDialog.tsx` y sus campos. Nada más de la app cambia.
//! 5. Tests: el comando exacto que se envía, qué pasa si el dispositivo no
//!    responde, y que `abrir()` fallando no toca `accesos_pendientes`.

pub mod gpio;
pub mod serial;
pub mod tcp;

use serde::{Deserialize, Serialize};
use std::fmt;

/// Contrato único. Todo lo demás de la app habla contra esto.
pub trait TalanqueraDriver: Send + Sync {
    /// Dispara la apertura (un pulso o un comando). Debe volver en pocos
    /// segundos como máximo, pase lo que pase.
    fn abrir(&self) -> Result<(), TalanqueraError>;
    /// Estado de la conexión con el dispositivo, sin abrir nada.
    fn estado(&self) -> EstadoConexion;
    /// Nombre para mostrar en la UI qué driver está activo.
    fn nombre(&self) -> &str;
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EstadoConexion {
    Conectado,
    Desconectado,
    Error,
    /// No hay driver configurado: la apertura física está apagada.
    SinDriver,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error, Serialize)]
#[serde(tag = "tipo", content = "detalle", rename_all = "snake_case")]
pub enum TalanqueraError {
    #[error("No hay ningún driver de talanquera configurado")]
    SinDriver,
    #[error("Dispositivo no disponible: {0}")]
    NoDisponible(String),
    #[error("El dispositivo no respondió a tiempo ({0})")]
    Timeout(String),
    #[error("Fallo al enviar el comando: {0}")]
    Envio(String),
    #[error("Configuración inválida: {0}")]
    Config(String),
    #[error("No soportado en esta versión: {0}")]
    NoSoportado(String),
}

/// Configuración persistida (JSON en `config_hardware`). Cada variante lleva
/// exactamente lo que necesita su adaptador.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "tipo", rename_all = "snake_case")]
pub enum ConfigHardware {
    Ninguno,
    SerialUsb(serial::ConfigSerial),
    Ethernet(tcp::ConfigTcp),
    Gpio(gpio::ConfigGpio),
}

impl Default for ConfigHardware {
    fn default() -> Self {
        ConfigHardware::Ninguno
    }
}

impl fmt::Display for ConfigHardware {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ConfigHardware::Ninguno => write!(f, "Sin hardware"),
            ConfigHardware::SerialUsb(c) => write!(f, "Relé USB en {}", c.puerto.as_deref().unwrap_or("auto")),
            ConfigHardware::Ethernet(c) => write!(f, "Relé Ethernet {}:{}", c.host, c.puerto),
            ConfigHardware::Gpio(c) => write!(f, "GPIO pin {}", c.pin),
        }
    }
}

/// Driver "apagado": responde como si no hubiera nada, sin fallar el flujo.
pub struct SinDriver;

impl TalanqueraDriver for SinDriver {
    fn abrir(&self) -> Result<(), TalanqueraError> {
        Err(TalanqueraError::SinDriver)
    }
    fn estado(&self) -> EstadoConexion {
        EstadoConexion::SinDriver
    }
    fn nombre(&self) -> &str {
        "Sin hardware"
    }
}

/// Fábrica: la única función que conoce los adaptadores concretos.
pub fn crear_driver(config: &ConfigHardware) -> Result<Box<dyn TalanqueraDriver>, TalanqueraError> {
    Ok(match config {
        ConfigHardware::Ninguno => Box::new(SinDriver),
        ConfigHardware::SerialUsb(c) => Box::new(serial::ReleSerial::nuevo(c.clone())?),
        ConfigHardware::Ethernet(c) => Box::new(tcp::ReleTcp::nuevo(c.clone())?),
        ConfigHardware::Gpio(c) => Box::new(gpio::GpioDriver::nuevo(c.clone())?),
    })
}

/// Lo que ve la UI: nombre del driver activo y su estado.
#[derive(Debug, Clone, Serialize)]
pub struct EstadoHardware {
    pub nombre: String,
    pub estado: EstadoConexion,
    pub config: ConfigHardware,
}

/// Resultado de una apertura reportado junto al acceso registrado.
#[derive(Debug, Clone, Serialize)]
pub struct ResultadoApertura {
    /// `true` si se envió el comando sin error. `false` también cuando no
    /// hay driver: la UI distingue por `error`.
    pub abierta: bool,
    pub driver: String,
    pub error: Option<TalanqueraError>,
}

impl ResultadoApertura {
    pub fn desde(driver: &dyn TalanqueraDriver, r: Result<(), TalanqueraError>) -> Self {
        Self { abierta: r.is_ok(), driver: driver.nombre().to_string(), error: r.err() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_config_por_defecto_es_ninguno_y_produce_el_driver_apagado() {
        let cfg = ConfigHardware::default();
        assert_eq!(cfg, ConfigHardware::Ninguno);
        let d = crear_driver(&cfg).unwrap();
        assert_eq!(d.estado(), EstadoConexion::SinDriver);
        assert_eq!(d.abrir(), Err(TalanqueraError::SinDriver));
    }

    #[test]
    fn la_config_viaja_como_json_etiquetado_y_vuelve_igual() {
        let cfg = ConfigHardware::Ethernet(tcp::ConfigTcp {
            host: "192.168.1.50".into(),
            puerto: 6722,
            modo: tcp::ModoTcp::Tcp,
            comando: "AT+O1\\r\\n".into(),
            timeout_ms: 2000,
            ..Default::default()
        });
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains("\"tipo\":\"ethernet\""));
        let vuelta: ConfigHardware = serde_json::from_str(&json).unwrap();
        assert_eq!(vuelta, cfg);
    }

    #[test]
    fn una_config_vieja_sin_campos_nuevos_sigue_cargando() {
        // Un equipo actualizado no debe perder su configuración por un campo
        // que no existía cuando la guardó.
        let json = r#"{"tipo":"serial_usb","puerto":"COM3"}"#;
        let cfg: ConfigHardware = serde_json::from_str(json).unwrap();
        match cfg {
            ConfigHardware::SerialUsb(c) => {
                assert_eq!(c.puerto.as_deref(), Some("COM3"));
                assert_eq!(c.pulso_ms, serial::PULSO_MS_DEFECTO);
                assert_eq!(c.protocolo, serial::Protocolo::Lcus);
            }
            otro => panic!("{otro:?}"),
        }
    }
}
