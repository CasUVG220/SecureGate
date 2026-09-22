//! Adaptador 1 — relé USB genérico por puerto serial (CH340/FTDI/CP210x).
//!
//! # Qué protocolo se asume y por qué
//!
//! No existe "el" estándar: cada fabricante de módulos baratos habla lo
//! suyo. Se soportan los dos que cubren casi todo lo que se vende como
//! "módulo relé USB" en Guatemala/Latinoamérica (MercadoLibre, AliExpress),
//! y un tercero libre para el resto:
//!
//! - [`Protocolo::Lcus`] (**por defecto**): la familia LCUS-1/2/4/8 y sus
//!   clones con chip CH340. Trama binaria de 4 bytes a 9600 8N1:
//!   `A0 <canal> <estado> <checksum>` con `checksum = (A0 + canal + estado)
//!   & FF`. Canal 1 ON = `A0 01 01 A2`, OFF = `A0 01 00 A1`. Es el módulo
//!   más vendido con diferencia, y el CH340 se identifica por USB
//!   (VID 1A86), lo que permite auto-detectarlo.
//! - [`Protocolo::Ascii`]: módulos con firmware tipo Arduino/"USB relay
//!   controller" que aceptan texto: `ON1\r\n` / `OFF1\r\n`.
//! - [`Protocolo::Personalizado`]: dos secuencias hex escritas a mano, para
//!   la marca rara que no encaje en las anteriores sin tener que tocar código.
//!
//! # Pulso
//!
//! Un motor de talanquera se dispara con un cierre de contacto breve; muy
//! corto y algunos no lo ven, muy largo y otros lo interpretan como "mantener
//! abierto". Por eso la duración es configurable ([`PULSO_MS_DEFECTO`] =
//! 500 ms). Pase lo que pase tras el ON, SIEMPRE se intenta el OFF: un relé
//! que se queda cerrado es peor que uno que no abrió.
//!
//! El puerto se abre en cada apertura y se cierra al terminar: son
//! milisegundos, y así desconectar/reconectar el USB entre aperturas no deja
//! un handle muerto.

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::sync::Arc;
use std::time::Duration;

use super::{EstadoConexion, TalanqueraDriver, TalanqueraError};

pub const PULSO_MS_DEFECTO: u64 = 500;
pub const BAUDIOS_DEFECTO: u32 = 9600;
/// Escribir 4 bytes a 9600 baudios tarda ~4 ms; el timeout es holgura por si
/// el adaptador USB se atasca, no una espera real.
const TIMEOUT_ESCRITURA: Duration = Duration::from_millis(500);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Protocolo {
    #[default]
    Lcus,
    Ascii,
    Personalizado,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConfigSerial {
    /// `None` = auto-detectar al abrir. En Windows `COM3`, en Linux `/dev/ttyUSB0`.
    #[serde(default)]
    pub puerto: Option<String>,
    #[serde(default = "baudios_defecto")]
    pub baudios: u32,
    #[serde(default)]
    pub protocolo: Protocolo,
    /// Canal del relé (1..=8). Los módulos de un canal usan el 1.
    #[serde(default = "canal_defecto")]
    pub canal: u8,
    #[serde(default = "pulso_defecto")]
    pub pulso_ms: u64,
    /// Sólo `Personalizado`: bytes en hex, p. ej. `"A0 01 01 A2"`.
    #[serde(default)]
    pub comando_on_hex: Option<String>,
    #[serde(default)]
    pub comando_off_hex: Option<String>,
}

fn baudios_defecto() -> u32 { BAUDIOS_DEFECTO }
fn canal_defecto() -> u8 { 1 }
fn pulso_defecto() -> u64 { PULSO_MS_DEFECTO }

impl Default for ConfigSerial {
    fn default() -> Self {
        Self {
            puerto: None,
            baudios: BAUDIOS_DEFECTO,
            protocolo: Protocolo::Lcus,
            canal: 1,
            pulso_ms: PULSO_MS_DEFECTO,
            comando_on_hex: None,
            comando_off_hex: None,
        }
    }
}

/// Tramas ON/OFF para la configuración dada. Pura: es lo que se prueba.
pub fn tramas(cfg: &ConfigSerial) -> Result<(Vec<u8>, Vec<u8>), TalanqueraError> {
    if !(1..=8).contains(&cfg.canal) {
        return Err(TalanqueraError::Config(format!("canal {} fuera de rango (1-8)", cfg.canal)));
    }
    match cfg.protocolo {
        Protocolo::Lcus => {
            let trama = |estado: u8| {
                let suma = (0xA0u16 + u16::from(cfg.canal) + u16::from(estado)) & 0xFF;
                vec![0xA0, cfg.canal, estado, suma as u8]
            };
            Ok((trama(1), trama(0)))
        }
        Protocolo::Ascii => Ok((
            format!("ON{}\r\n", cfg.canal).into_bytes(),
            format!("OFF{}\r\n", cfg.canal).into_bytes(),
        )),
        Protocolo::Personalizado => {
            let on = parsear_hex(cfg.comando_on_hex.as_deref().unwrap_or(""))
                .map_err(|e| TalanqueraError::Config(format!("comando ON: {e}")))?;
            let off = parsear_hex(cfg.comando_off_hex.as_deref().unwrap_or(""))
                .map_err(|e| TalanqueraError::Config(format!("comando OFF: {e}")))?;
            if on.is_empty() {
                return Err(TalanqueraError::Config("el comando ON no puede estar vacío".into()));
            }
            Ok((on, off))
        }
    }
}

/// `"A0 01 01 A2"`, `"a0,01,01,a2"` o `"A00101A2"` → bytes.
pub fn parsear_hex(s: &str) -> Result<Vec<u8>, String> {
    let limpio: String = s.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if limpio.len() % 2 != 0 {
        return Err("número impar de dígitos hex".into());
    }
    (0..limpio.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&limpio[i..i + 2], 16).map_err(|e| e.to_string()))
        .collect()
}

// ── Canal físico, abstraído para poder mockearlo ────────────────────────────

/// Lo único que el driver necesita de un puerto: escribir bytes.
pub trait Canal: Send {
    fn escribir(&mut self, bytes: &[u8]) -> Result<(), TalanqueraError>;
}

impl Canal for Box<dyn serialport::SerialPort> {
    fn escribir(&mut self, bytes: &[u8]) -> Result<(), TalanqueraError> {
        self.write_all(bytes)
            .and_then(|_| self.flush())
            .map_err(|e| match e.kind() {
                std::io::ErrorKind::TimedOut => TalanqueraError::Timeout(e.to_string()),
                _ => TalanqueraError::Envio(e.to_string()),
            })
    }
}

/// Abre un puerto por nombre. Inyectable para tests.
pub type Abridor = Arc<dyn Fn(&str, u32) -> Result<Box<dyn Canal>, TalanqueraError> + Send + Sync>;
/// Espera entre ON y OFF. Inyectable para no dormir en tests.
pub type Dormir = Arc<dyn Fn(Duration) + Send + Sync>;
/// Lista de puertos presentes. Inyectable para tests.
pub type Listar = Arc<dyn Fn() -> Vec<PuertoSerial> + Send + Sync>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PuertoSerial {
    pub nombre: String,
    /// VID/PID USB si el puerto es USB; sirve para reconocer el CH340.
    pub vid: Option<u16>,
    pub pid: Option<u16>,
    pub fabricante: Option<String>,
    pub producto: Option<String>,
}

/// Puertos seriales presentes en el equipo, USB primero.
pub fn listar_puertos() -> Vec<PuertoSerial> {
    let mut v: Vec<PuertoSerial> = serialport::available_ports()
        .unwrap_or_default()
        .into_iter()
        .map(|p| match p.port_type {
            serialport::SerialPortType::UsbPort(u) => PuertoSerial {
                nombre: p.port_name,
                vid: Some(u.vid),
                pid: Some(u.pid),
                fabricante: u.manufacturer,
                producto: u.product,
            },
            _ => PuertoSerial { nombre: p.port_name, vid: None, pid: None, fabricante: None, producto: None },
        })
        .collect();
    v.sort_by_key(|p| p.vid.is_none());
    v
}

/// VIDs de los puentes USB-serial que traen los módulos de relé, del más al
/// menos común: CH340 (LCUS), FTDI, Silicon Labs CP210x, Prolific PL2303.
const VIDS_CONOCIDOS: [u16; 4] = [0x1A86, 0x0403, 0x10C4, 0x067B];

/// Elige el puerto más probable cuando el agente no fijó uno.
pub fn autodetectar(puertos: &[PuertoSerial]) -> Option<String> {
    for vid in VIDS_CONOCIDOS {
        if let Some(p) = puertos.iter().find(|p| p.vid == Some(vid)) {
            return Some(p.nombre.clone());
        }
    }
    if let Some(p) = puertos.iter().find(|p| p.vid.is_some()) {
        return Some(p.nombre.clone());
    }
    // Un único puerto de cualquier tipo: no hay con qué confundirse.
    if puertos.len() == 1 {
        return Some(puertos[0].nombre.clone());
    }
    None
}

pub struct ReleSerial {
    cfg: ConfigSerial,
    on: Vec<u8>,
    off: Vec<u8>,
    abridor: Abridor,
    dormir: Dormir,
    listar: Listar,
    nombre: String,
}

impl ReleSerial {
    pub fn nuevo(cfg: ConfigSerial) -> Result<Self, TalanqueraError> {
        let abridor: Abridor = Arc::new(|puerto, baudios| {
            serialport::new(puerto, baudios)
                .timeout(TIMEOUT_ESCRITURA)
                .open()
                .map(|p| Box::new(p) as Box<dyn Canal>)
                .map_err(|e| TalanqueraError::NoDisponible(format!("{puerto}: {}", e.description)))
        });
        Self::con_dependencias(cfg, abridor, Arc::new(std::thread::sleep), Arc::new(listar_puertos))
    }

    /// Constructor para tests: puerto, reloj y lista de puertos simulados.
    pub fn con_dependencias(cfg: ConfigSerial, abridor: Abridor, dormir: Dormir, listar: Listar) -> Result<Self, TalanqueraError> {
        let (on, off) = tramas(&cfg)?;
        let nombre = match cfg.protocolo {
            Protocolo::Lcus => "Relé USB (LCUS/CH340)",
            Protocolo::Ascii => "Relé USB (ASCII)",
            Protocolo::Personalizado => "Relé USB (personalizado)",
        }
        .to_string();
        Ok(Self { cfg, on, off, abridor, dormir, listar, nombre })
    }

    fn puerto(&self) -> Result<String, TalanqueraError> {
        if let Some(p) = self.cfg.puerto.as_deref().filter(|p| !p.trim().is_empty()) {
            return Ok(p.trim().to_string());
        }
        autodetectar(&(self.listar)()).ok_or_else(|| {
            TalanqueraError::NoDisponible("no se detectó ningún relé USB; elige el puerto en Configuración de hardware".into())
        })
    }
}

impl TalanqueraDriver for ReleSerial {
    fn abrir(&self) -> Result<(), TalanqueraError> {
        let puerto = self.puerto()?;
        let mut canal = (self.abridor)(&puerto, self.cfg.baudios)?;
        canal.escribir(&self.on)?;
        (self.dormir)(Duration::from_millis(self.cfg.pulso_ms));
        // El OFF va aunque el ON hubiera fallado a medias: nunca dejar el
        // contacto cerrado. Si tampoco sale, se reporta como fallo de envío.
        if self.off.is_empty() {
            return Ok(());
        }
        canal.escribir(&self.off).map_err(|e| {
            TalanqueraError::Envio(format!("el relé abrió pero no se pudo soltar el contacto: {e}"))
        })
    }

    fn estado(&self) -> EstadoConexion {
        let puertos = (self.listar)();
        let presente = match self.cfg.puerto.as_deref().filter(|p| !p.trim().is_empty()) {
            Some(p) => puertos.iter().any(|x| x.nombre == p.trim()),
            None => autodetectar(&puertos).is_some(),
        };
        if presente { EstadoConexion::Conectado } else { EstadoConexion::Desconectado }
    }

    fn nombre(&self) -> &str {
        &self.nombre
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Puerto simulado: guarda lo escrito y cuándo. Un `Result` por escritura
    /// permite simular que el ON sale y el OFF falla.
    #[derive(Default)]
    struct Grabadora {
        escritos: Arc<Mutex<Vec<Vec<u8>>>>,
        fallos: Arc<Mutex<Vec<Option<TalanqueraError>>>>,
    }

    struct CanalMock {
        escritos: Arc<Mutex<Vec<Vec<u8>>>>,
        fallos: Arc<Mutex<Vec<Option<TalanqueraError>>>>,
    }

    impl Canal for CanalMock {
        fn escribir(&mut self, bytes: &[u8]) -> Result<(), TalanqueraError> {
            let fallo = {
                let mut f = self.fallos.lock().unwrap();
                if f.is_empty() { None } else { f.remove(0) }
            };
            if let Some(e) = fallo {
                return Err(e);
            }
            self.escritos.lock().unwrap().push(bytes.to_vec());
            Ok(())
        }
    }

    fn puerto(nombre: &str, vid: Option<u16>) -> PuertoSerial {
        PuertoSerial { nombre: nombre.into(), vid, pid: vid.map(|_| 0x7523), fabricante: None, producto: None }
    }

    fn driver(cfg: ConfigSerial, g: &Grabadora, puertos: Vec<PuertoSerial>) -> (ReleSerial, Arc<Mutex<Vec<(String, u32)>>>, Arc<Mutex<Vec<Duration>>>) {
        let aperturas = Arc::new(Mutex::new(Vec::new()));
        let esperas = Arc::new(Mutex::new(Vec::new()));
        let escritos = g.escritos.clone();
        let fallos = g.fallos.clone();
        let ap = aperturas.clone();
        let abridor: Abridor = Arc::new(move |p, b| {
            ap.lock().unwrap().push((p.to_string(), b));
            Ok(Box::new(CanalMock { escritos: escritos.clone(), fallos: fallos.clone() }) as Box<dyn Canal>)
        });
        let es = esperas.clone();
        let dormir: Dormir = Arc::new(move |d| es.lock().unwrap().push(d));
        let listar: Listar = Arc::new(move || puertos.clone());
        (ReleSerial::con_dependencias(cfg, abridor, dormir, listar).unwrap(), aperturas, esperas)
    }

    #[test]
    fn lcus_manda_a0_canal_estado_checksum() {
        let (on, off) = tramas(&ConfigSerial::default()).unwrap();
        assert_eq!(on, vec![0xA0, 0x01, 0x01, 0xA2]);
        assert_eq!(off, vec![0xA0, 0x01, 0x00, 0xA1]);
        let (on4, _) = tramas(&ConfigSerial { canal: 4, ..Default::default() }).unwrap();
        assert_eq!(on4, vec![0xA0, 0x04, 0x01, 0xA5]);
        assert!(matches!(tramas(&ConfigSerial { canal: 0, ..Default::default() }), Err(TalanqueraError::Config(_))));
    }

    #[test]
    fn ascii_manda_on_off_con_crlf() {
        let (on, off) = tramas(&ConfigSerial { protocolo: Protocolo::Ascii, canal: 2, ..Default::default() }).unwrap();
        assert_eq!(on, b"ON2\r\n");
        assert_eq!(off, b"OFF2\r\n");
    }

    #[test]
    fn personalizado_acepta_hex_con_espacios_comas_o_pegado_y_rechaza_basura() {
        assert_eq!(parsear_hex("A0 01 01 A2").unwrap(), vec![0xA0, 1, 1, 0xA2]);
        assert_eq!(parsear_hex("a0,01,01,a2").unwrap(), vec![0xA0, 1, 1, 0xA2]);
        assert_eq!(parsear_hex("A00101A2").unwrap(), vec![0xA0, 1, 1, 0xA2]);
        assert!(parsear_hex("A0 1").is_err());
        let cfg = ConfigSerial { protocolo: Protocolo::Personalizado, comando_on_hex: Some("FF".into()), comando_off_hex: Some("".into()), ..Default::default() };
        assert_eq!(tramas(&cfg).unwrap(), (vec![0xFF], vec![]));
        let vacio = ConfigSerial { protocolo: Protocolo::Personalizado, ..Default::default() };
        assert!(matches!(tramas(&vacio), Err(TalanqueraError::Config(_))));
    }

    #[test]
    fn abrir_es_un_pulso_on_espera_off_por_el_puerto_y_baudios_configurados() {
        let g = Grabadora::default();
        let cfg = ConfigSerial { puerto: Some("COM7".into()), baudios: 19200, pulso_ms: 750, ..Default::default() };
        let (d, aperturas, esperas) = driver(cfg, &g, vec![]);
        d.abrir().unwrap();
        assert_eq!(*aperturas.lock().unwrap(), vec![("COM7".to_string(), 19200)]);
        assert_eq!(*g.escritos.lock().unwrap(), vec![vec![0xA0, 1, 1, 0xA2], vec![0xA0, 1, 0, 0xA1]]);
        assert_eq!(*esperas.lock().unwrap(), vec![Duration::from_millis(750)]);
    }

    #[test]
    fn si_el_off_falla_se_reporta_como_error_de_envio_con_el_on_ya_enviado() {
        let g = Grabadora::default();
        g.fallos.lock().unwrap().extend([None, Some(TalanqueraError::Timeout("usb".into()))]);
        let (d, _, _) = driver(ConfigSerial { puerto: Some("COM1".into()), ..Default::default() }, &g, vec![]);
        let err = d.abrir().unwrap_err();
        assert!(matches!(err, TalanqueraError::Envio(ref m) if m.contains("no se pudo soltar")), "{err:?}");
        assert_eq!(g.escritos.lock().unwrap().len(), 1, "sólo salió el ON");
    }

    #[test]
    fn autodeteccion_prefiere_ch340_luego_otros_usb_y_un_puerto_unico() {
        assert_eq!(autodetectar(&[puerto("COM1", None), puerto("COM5", Some(0x0403)), puerto("COM3", Some(0x1A86))]), Some("COM3".into()));
        assert_eq!(autodetectar(&[puerto("COM1", None), puerto("COM5", Some(0x0403))]), Some("COM5".into()));
        assert_eq!(autodetectar(&[puerto("COM1", None)]), Some("COM1".into()));
        assert_eq!(autodetectar(&[puerto("COM1", None), puerto("COM2", None)]), None, "dos puertos no USB: no se adivina");
        assert_eq!(autodetectar(&[]), None);
    }

    #[test]
    fn sin_puerto_fijado_usa_el_autodetectado_y_sin_ninguno_falla_claro() {
        let g = Grabadora::default();
        let (d, aperturas, _) = driver(ConfigSerial::default(), &g, vec![puerto("/dev/ttyUSB0", Some(0x1A86))]);
        d.abrir().unwrap();
        assert_eq!(aperturas.lock().unwrap()[0].0, "/dev/ttyUSB0");
        assert_eq!(d.estado(), EstadoConexion::Conectado);

        let g2 = Grabadora::default();
        let (d2, _, _) = driver(ConfigSerial::default(), &g2, vec![]);
        assert!(matches!(d2.abrir(), Err(TalanqueraError::NoDisponible(_))));
        assert_eq!(d2.estado(), EstadoConexion::Desconectado);
        assert!(g2.escritos.lock().unwrap().is_empty());
    }

    #[test]
    fn el_estado_refleja_si_el_puerto_fijado_sigue_presente() {
        let g = Grabadora::default();
        let (d, _, _) = driver(ConfigSerial { puerto: Some("COM3".into()), ..Default::default() }, &g, vec![puerto("COM3", Some(0x1A86))]);
        assert_eq!(d.estado(), EstadoConexion::Conectado);
        let (d2, _, _) = driver(ConfigSerial { puerto: Some("COM3".into()), ..Default::default() }, &g, vec![puerto("COM9", Some(0x1A86))]);
        assert_eq!(d2.estado(), EstadoConexion::Desconectado);
    }

    #[test]
    fn no_poder_abrir_el_puerto_no_escribe_nada() {
        let abridor: Abridor = Arc::new(|p, _| Err(TalanqueraError::NoDisponible(format!("{p}: en uso"))));
        let d = ReleSerial::con_dependencias(
            ConfigSerial { puerto: Some("COM3".into()), ..Default::default() },
            abridor,
            Arc::new(|_| {}),
            Arc::new(Vec::new),
        )
        .unwrap();
        assert!(matches!(d.abrir(), Err(TalanqueraError::NoDisponible(ref m)) if m.contains("COM3")));
    }
}
