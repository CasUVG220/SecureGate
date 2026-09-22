//! Adaptador 3 — GPIO directo (Raspberry Pi y mini-PCs Linux ARM).
//!
//! # Estado: stub documentado, no soportado en esta versión
//!
//! Se evaluó el esfuerzo real antes de invertir:
//!
//! - La plataforma objetivo del producto es **Windows** (PRODUCT.md), y en
//!   Windows no hay GPIO. Este adaptador sólo tendría sentido en una garita
//!   con Raspberry Pi corriendo Linux, y hoy no hay ningún cliente así.
//! - En Rust el camino sería el crate `rppal` (Raspberry Pi) o `gpio-cdev`
//!   (cualquier Linux con `/dev/gpiochipN`). Ambos son Linux-only, así que
//!   hay que compilarlos bajo `#[cfg(target_os = "linux")]`, cruzar el
//!   binario a `aarch64-unknown-linux-gnu`, empaquetar Tauri para esa
//!   arquitectura (AppImage/deb) y validar contra hardware. Es un target de
//!   build completo que hoy no existe en el proyecto, no sólo un archivo.
//! - Sin una Pi a mano tampoco se puede probar más allá del mock.
//!
//! Conclusión: es significativamente más trabajo que los adaptadores USB y
//! Ethernet **y** no tiene demanda, así que queda como stub que responde
//! `NoSoportado` con un mensaje claro. La configuración sí se acepta y se
//! guarda, para que cuando se implemente el equipo no cambie de esquema.
//!
//! # Cómo se implementaría
//!
//! ```ignore
//! #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
//! mod real {
//!     use rppal::gpio::Gpio;
//!     pub fn pulso(pin: u8, ms: u64, activo_alto: bool) -> Result<(), String> {
//!         let mut p = Gpio::new()?.get(pin)?.into_output();
//!         if activo_alto { p.set_high() } else { p.set_low() }
//!         std::thread::sleep(std::time::Duration::from_millis(ms));
//!         if activo_alto { p.set_low() } else { p.set_high() }
//!         Ok(())
//!     }
//! }
//! ```
//! y en `GpioDriver::abrir` llamar a `real::pulso` bajo el mismo `cfg`,
//! dejando el `NoSoportado` para el resto de plataformas. Mientras tanto, una
//! Pi puede usar el adaptador USB (un relé CH340 funciona igual en Linux).

use serde::{Deserialize, Serialize};

use super::{EstadoConexion, TalanqueraDriver, TalanqueraError};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConfigGpio {
    /// Número BCM del pin (Raspberry Pi).
    pub pin: u8,
    #[serde(default = "pulso_defecto")]
    pub pulso_ms: u64,
    /// `true`: el relé se activa poniendo el pin en alto (lo habitual en
    /// módulos de relé de 3.3 V); `false`: activo en bajo.
    #[serde(default = "activo_alto_defecto")]
    pub activo_alto: bool,
}

fn pulso_defecto() -> u64 { 500 }
fn activo_alto_defecto() -> bool { true }

impl Default for ConfigGpio {
    fn default() -> Self {
        Self { pin: 17, pulso_ms: 500, activo_alto: true }
    }
}

pub struct GpioDriver {
    cfg: ConfigGpio,
}

impl GpioDriver {
    pub fn nuevo(cfg: ConfigGpio) -> Result<Self, TalanqueraError> {
        if cfg.pin > 40 {
            return Err(TalanqueraError::Config(format!("pin {} fuera de rango", cfg.pin)));
        }
        Ok(Self { cfg })
    }
}

impl TalanqueraDriver for GpioDriver {
    fn abrir(&self) -> Result<(), TalanqueraError> {
        Err(TalanqueraError::NoSoportado(format!(
            "GPIO (pin {}) no está implementado en esta versión; usa un relé USB o Ethernet",
            self.cfg.pin
        )))
    }

    fn estado(&self) -> EstadoConexion {
        EstadoConexion::Error
    }

    fn nombre(&self) -> &str {
        "GPIO (no soportado)"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_stub_acepta_config_pero_abrir_dice_no_soportado_sin_romper_nada() {
        let d = GpioDriver::nuevo(ConfigGpio::default()).unwrap();
        assert!(matches!(d.abrir(), Err(TalanqueraError::NoSoportado(ref m)) if m.contains("pin 17")));
        assert_eq!(d.estado(), EstadoConexion::Error);
        assert!(GpioDriver::nuevo(ConfigGpio { pin: 99, ..Default::default() }).is_err());
    }
}
