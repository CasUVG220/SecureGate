//! Configuración de los carriles del ANPR (Sprint 10). Vive en el SQLCipher del equipo, como la talanquera y las cámaras: es
//! del puesto, no del agente que tiene el turno.
//!
//! Un carril = una cámara IP fija + su ROI + su modo (`apagado | verificacion | automatico`) + su actuador. Un carril nuevo se
//! crea APAGADO; al habilitarlo el modo por defecto es `automatico` (decisión del equipo, ver docs/anpr_continuo.md). La bandera
//! global «Pausar ANPR» (`meta.anpr_pausado`) apaga todos los carriles de inmediato sin tocar su configuración.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::actuador::ConfigActuador;
use crate::db;
use crate::error::{AppError, AppResult};

pub const ESQUEMA: &str = r#"
CREATE TABLE IF NOT EXISTS carriles_anpr (
  id             TEXT PRIMARY KEY,
  nombre         TEXT NOT NULL,
  camara_id      TEXT,
  sentido        TEXT NOT NULL CHECK (sentido IN ('entrada', 'salida')),
  modo           TEXT NOT NULL DEFAULT 'apagado' CHECK (modo IN ('apagado', 'verificacion', 'automatico')),
  config         TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);
"#;

const META_PAUSADO: &str = "anpr_pausado";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Modo {
    #[default]
    Apagado,
    Verificacion,
    Automatico,
}

impl Modo {
    pub fn como_str(self) -> &'static str {
        match self {
            Modo::Apagado => "apagado",
            Modo::Verificacion => "verificacion",
            Modo::Automatico => "automatico",
        }
    }
    fn desde(s: &str) -> Modo {
        match s {
            "verificacion" => Modo::Verificacion,
            "automatico" => Modo::Automatico,
            _ => Modo::Apagado,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Sentido {
    #[default]
    Entrada,
    Salida,
}

impl Sentido {
    pub fn como_str(self) -> &'static str {
        match self {
            Sentido::Entrada => "entrada",
            Sentido::Salida => "salida",
        }
    }
}

/// Umbrales que viajan tal cual al sidecar (los valida él también). Todos opcionales: `None` = el valor por defecto del sidecar.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct Umbrales {
    /// Fracción de píxeles del ROI que deben cambiar (movimiento).
    #[serde(default)]
    pub umbral_cambio: Option<f64>,
    /// Lecturas iguales para confirmar (consenso).
    #[serde(default)]
    pub min_coincidencias: Option<u32>,
    /// Confianza agregada mínima (0,5–1).
    #[serde(default)]
    pub confianza_min: Option<f64>,
    /// Tiempo máximo de lectura por vehículo (ms).
    #[serde(default)]
    pub tiempo_max_lectura_ms: Option<u64>,
    /// fps con movimiento (mitigación de CPU: bajarlo).
    #[serde(default)]
    pub fps_activo: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Carril {
    pub id: String,
    pub nombre: String,
    /// Cámara IP/celular de `camaras` (las USB no sirven: las abre el WebView, no el puente).
    pub camara_id: Option<String>,
    #[serde(default)]
    pub sentido: Sentido,
    #[serde(default)]
    pub modo: Modo,
    /// Polígono normalizado (0–1). Vacío = todo el cuadro.
    #[serde(default)]
    pub roi: Vec<[f64; 2]>,
    #[serde(default)]
    pub umbrales: Umbrales,
    #[serde(default)]
    pub actuador: ConfigActuador,
    #[serde(default)]
    pub actualizado_en: Option<String>,
}

/// Lo que se guarda en la columna `config` (lo que no tiene columna propia).
#[derive(Serialize, Deserialize, Default)]
struct ConfigGuardada {
    #[serde(default)]
    roi: Vec<[f64; 2]>,
    #[serde(default)]
    umbrales: Umbrales,
    #[serde(default)]
    actuador: ConfigActuador,
}

/// Validación de lo que llega del WebView. Mensajes en español: los ve el agente en la pantalla de configuración.
pub fn validar(c: &Carril) -> AppResult<()> {
    let err = |m: &str| Err(AppError::new("anpr_config", m));
    if !c.id.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_') || c.id.is_empty() || c.id.len() > 64 {
        return err("El identificador del carril solo admite letras, números, guion y guion bajo (máximo 64).");
    }
    let nombre = c.nombre.trim();
    if nombre.is_empty() || nombre.chars().count() > 60 || nombre.chars().any(char::is_control) {
        return err("El nombre del carril debe tener entre 1 y 60 caracteres.");
    }
    if !c.roi.is_empty() {
        if c.roi.len() < 3 || c.roi.len() > 32 {
            return err("El área del carril necesita entre 3 y 32 puntos.");
        }
        if c.roi.iter().flatten().any(|v| !v.is_finite() || *v < 0.0 || *v > 1.0) {
            return err("Los puntos del área deben estar dentro de la imagen.");
        }
    }
    let u = &c.umbrales;
    if u.umbral_cambio.is_some_and(|v| !(0.0001..=1.0).contains(&v)) {
        return err("La sensibilidad al movimiento debe estar entre 0,0001 y 1.");
    }
    if u.min_coincidencias.is_some_and(|v| !(1..=5).contains(&v)) {
        return err("Las lecturas iguales para confirmar deben ser entre 1 y 5.");
    }
    if u.confianza_min.is_some_and(|v| !(0.5..=1.0).contains(&v)) {
        return err("La confianza mínima debe estar entre 0,50 y 1.");
    }
    if u.tiempo_max_lectura_ms.is_some_and(|v| !(500..=60_000).contains(&v)) {
        return err("El tiempo máximo de lectura debe estar entre 0,5 y 60 segundos.");
    }
    if u.fps_activo.is_some_and(|v| !(0.5..=10.0).contains(&v)) {
        return err("Los cuadros por segundo con movimiento deben estar entre 0,5 y 10.");
    }
    if c.modo != Modo::Apagado && c.camara_id.as_deref().map_or(true, |s| s.trim().is_empty()) {
        return err("Elige la cámara del carril antes de activarlo.");
    }
    c.actuador.validar().map_err(|m| AppError::new("anpr_config", m))?;
    Ok(())
}

fn desde_fila(r: &rusqlite::Row<'_>) -> rusqlite::Result<Carril> {
    let config: String = r.get(5)?;
    let cfg: ConfigGuardada = serde_json::from_str(&config).unwrap_or_default();
    Ok(Carril {
        id: r.get(0)?,
        nombre: r.get(1)?,
        camara_id: r.get(2)?,
        sentido: if r.get::<_, String>(3)? == "salida" { Sentido::Salida } else { Sentido::Entrada },
        modo: Modo::desde(&r.get::<_, String>(4)?),
        roi: cfg.roi,
        umbrales: cfg.umbrales,
        actuador: cfg.actuador,
        actualizado_en: r.get(6)?,
    })
}

const COLUMNAS: &str = "id, nombre, camara_id, sentido, modo, config, actualizado_en";

pub fn listar(conn: &Connection) -> AppResult<Vec<Carril>> {
    let mut st = conn.prepare(&format!("SELECT {COLUMNAS} FROM carriles_anpr ORDER BY nombre, id"))?;
    let filas = st.query_map([], desde_fila)?;
    Ok(filas.collect::<Result<_, _>>()?)
}

pub fn obtener(conn: &Connection, id: &str) -> AppResult<Option<Carril>> {
    Ok(conn.query_row(&format!("SELECT {COLUMNAS} FROM carriles_anpr WHERE id = ?1"), [id], desde_fila).optional()?)
}

/// Alta o edición. Un carril NUEVO entra apagado salvo que ya traiga un modo explícito distinto (la pantalla lo crea apagado y
/// al habilitarlo propone `automatico`).
pub fn guardar(conn: &Connection, c: &Carril) -> AppResult<Carril> {
    validar(c)?;
    let config = serde_json::to_string(&ConfigGuardada { roi: c.roi.clone(), umbrales: c.umbrales.clone(), actuador: c.actuador.clone() })?;
    let ahora = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO carriles_anpr (id, nombre, camara_id, sentido, modo, config, actualizado_en)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, camara_id = excluded.camara_id, sentido = excluded.sentido,
           modo = excluded.modo, config = excluded.config, actualizado_en = excluded.actualizado_en",
        params![c.id, c.nombre.trim(), c.camara_id.as_deref().map(str::trim).filter(|s| !s.is_empty()), c.sentido.como_str(), c.modo.como_str(), config, ahora],
    )?;
    Ok(obtener(conn, &c.id)?.expect("recién guardado"))
}

pub fn eliminar(conn: &Connection, id: &str) -> AppResult<bool> {
    Ok(conn.execute("DELETE FROM carriles_anpr WHERE id = ?1", [id])? > 0)
}

pub fn pausado(conn: &Connection) -> AppResult<bool> {
    Ok(db::meta_leer(conn, META_PAUSADO)?.as_deref() == Some("1"))
}

pub fn pausar(conn: &Connection, pausado: bool) -> AppResult<()> {
    db::meta_escribir(conn, META_PAUSADO, if pausado { "1" } else { "0" })
}

/// Configuración que se manda al sidecar (`{"op":"configurar","carril":{…}}`): solo lo que él entiende.
pub fn para_sidecar(c: &Carril) -> Value {
    let u = &c.umbrales;
    let mut movimiento = json!({});
    if let Some(v) = u.umbral_cambio { movimiento["umbralCambio"] = json!(v); }
    if let Some(v) = u.fps_activo { movimiento["fpsActivo"] = json!(v); }
    let mut tracker = json!({});
    if let Some(v) = u.tiempo_max_lectura_ms { tracker["tiempoMaxLectura_ms"] = json!(v); }
    let mut consenso = json!({});
    if let Some(v) = u.min_coincidencias { consenso["minCoincidencias"] = json!(v); }
    if let Some(v) = u.confianza_min { consenso["confianzaMin"] = json!(v); }
    json!({
        "id": c.id,
        "roi": if c.roi.is_empty() { Value::Null } else { json!(c.roi) },
        "movimiento": movimiento,
        "tracker": tracker,
        "consenso": consenso,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::anpr::actuador::ConfigActuador;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        crate::db::aplicar_esquema(&c).unwrap();
        c
    }

    pub fn carril(id: &str) -> Carril {
        Carril {
            id: id.into(), nombre: "Entrada principal".into(), camara_id: Some("cam-1".into()), sentido: Sentido::Entrada,
            modo: Modo::Apagado, roi: vec![], umbrales: Umbrales::default(), actuador: ConfigActuador::Simulado, actualizado_en: None,
        }
    }

    #[test]
    fn alta_edicion_listado_y_baja() {
        let c = conn();
        let g = guardar(&c, &Carril { roi: vec![[0.1, 0.2], [0.9, 0.2], [0.9, 1.0]], ..carril("c1") }).unwrap();
        assert_eq!(g.modo, Modo::Apagado, "un carril nuevo entra apagado");
        assert_eq!(g.roi.len(), 3);
        assert!(g.actualizado_en.is_some());
        guardar(&c, &Carril { modo: Modo::Automatico, nombre: "  Entrada  ".into(), ..g.clone() }).unwrap();
        let e = obtener(&c, "c1").unwrap().unwrap();
        assert_eq!((e.modo, e.nombre.as_str()), (Modo::Automatico, "Entrada"));
        assert_eq!(listar(&c).unwrap().len(), 1, "editar no duplica");
        assert!(eliminar(&c, "c1").unwrap());
        assert!(!eliminar(&c, "c1").unwrap());
    }

    #[test]
    fn validaciones_con_mensajes_claros() {
        let mal = |c: Carril| validar(&c).unwrap_err().mensaje;
        assert!(mal(Carril { id: "con espacio".into(), ..carril("x") }).contains("identificador"));
        assert!(mal(Carril { nombre: " ".into(), ..carril("c") }).contains("nombre"));
        assert!(mal(Carril { roi: vec![[0.0, 0.0], [1.0, 1.0]], ..carril("c") }).contains("3 y 32"));
        assert!(mal(Carril { roi: vec![[0.0, 0.0], [1.5, 0.0], [1.0, 1.0]], ..carril("c") }).contains("dentro"));
        assert!(mal(Carril { umbrales: Umbrales { confianza_min: Some(0.3), ..Default::default() }, ..carril("c") }).contains("confianza"));
        assert!(mal(Carril { umbrales: Umbrales { min_coincidencias: Some(9), ..Default::default() }, ..carril("c") }).contains("lecturas"));
        assert!(mal(Carril { umbrales: Umbrales { tiempo_max_lectura_ms: Some(100), ..Default::default() }, ..carril("c") }).contains("tiempo"));
        assert!(mal(Carril { umbrales: Umbrales { fps_activo: Some(30.0), ..Default::default() }, ..carril("c") }).contains("cuadros"));
        assert!(mal(Carril { umbrales: Umbrales { umbral_cambio: Some(2.0), ..Default::default() }, ..carril("c") }).contains("movimiento"));
        assert!(mal(Carril { modo: Modo::Automatico, camara_id: None, ..carril("c") }).contains("cámara"));
        assert!(validar(&carril("ok_1")).is_ok());
    }

    #[test]
    fn la_pausa_global_se_guarda_en_meta() {
        let c = conn();
        assert!(!pausado(&c).unwrap(), "por defecto no está en pausa");
        pausar(&c, true).unwrap();
        assert!(pausado(&c).unwrap());
        pausar(&c, false).unwrap();
        assert!(!pausado(&c).unwrap());
    }

    #[test]
    fn el_sidecar_recibe_solo_lo_que_entiende_y_con_sus_nombres() {
        let mut c = carril("c1");
        assert_eq!(para_sidecar(&c), json!({"id": "c1", "roi": null, "movimiento": {}, "tracker": {}, "consenso": {}}));
        c.roi = vec![[0.0, 0.0], [1.0, 0.0], [0.5, 1.0]];
        c.umbrales = Umbrales { umbral_cambio: Some(0.02), min_coincidencias: Some(4), confianza_min: Some(0.95), tiempo_max_lectura_ms: Some(5000), fps_activo: Some(3.0) };
        let v = para_sidecar(&c);
        assert_eq!(v["roi"], json!([[0.0, 0.0], [1.0, 0.0], [0.5, 1.0]]));
        assert_eq!(v["movimiento"], json!({"umbralCambio": 0.02, "fpsActivo": 3.0}));
        assert_eq!(v["tracker"], json!({"tiempoMaxLectura_ms": 5000}));
        assert_eq!(v["consenso"], json!({"minCoincidencias": 4, "confianzaMin": 0.95}));
    }

    #[test]
    fn una_config_guardada_ilegible_no_tumba_el_listado() {
        let c = conn();
        c.execute("INSERT INTO carriles_anpr VALUES ('x', 'X', NULL, 'entrada', 'automatico', '{roto', 'ahora')", []).unwrap();
        let l = listar(&c).unwrap();
        assert_eq!(l[0].modo, Modo::Automatico);
        assert!(l[0].roi.is_empty());
        assert_eq!(l[0].actuador, ConfigActuador::Simulado);
    }
}
