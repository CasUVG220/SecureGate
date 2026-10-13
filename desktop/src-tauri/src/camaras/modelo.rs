//! Tabla `camaras` del SQLite cifrado (T7) y lo que de ella ve el frontend.
//!
//! Aquí van tipo, nombre, **URL sin credenciales** y tareas asignadas. El usuario y la contraseña NO están en esta tabla (ver
//! `credenciales.rs`); una restricción `CHECK` impide además guardar una URL con `usuario@` aunque algún día un error del código lo intente.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

pub const TAREAS: [&str; 4] = ["qr", "placa", "dpi", "salida"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TipoCamara {
    Usb,
    Ip,
    Celular,
}

impl TipoCamara {
    pub fn como_str(self) -> &'static str {
        match self {
            TipoCamara::Usb => "usb",
            TipoCamara::Ip => "ip",
            TipoCamara::Celular => "celular",
        }
    }
    fn desde(s: &str) -> Option<Self> {
        match s {
            "usb" => Some(TipoCamara::Usb),
            "ip" => Some(TipoCamara::Ip),
            "celular" => Some(TipoCamara::Celular),
            _ => None,
        }
    }
}

/// Fila de la tabla = lo que ve el frontend. **No tiene campos de credenciales**: solo `con_credenciales`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Camara {
    pub id: String,
    pub tipo: TipoCamara,
    pub nombre: String,
    /// Sin usuario ni contraseña. `None` en las USB.
    pub url: Option<String>,
    /// `deviceId` del WebView (solo USB).
    pub device_id: Option<String>,
    /// Tareas de la garita que usan esta cámara (de `TAREAS`).
    pub tareas: Vec<String>,
    pub con_credenciales: bool,
    pub creada_en: String,
}

/// El esquema vive en `db.rs::aplicar_esquema` (que llama a esto): idempotente.
pub const ESQUEMA: &str = r#"
CREATE TABLE IF NOT EXISTS camaras (
  id               TEXT PRIMARY KEY,
  tipo             TEXT NOT NULL CHECK (tipo IN ('usb', 'ip', 'celular')),
  nombre           TEXT NOT NULL,
  url              TEXT CHECK (url IS NULL OR (url NOT LIKE '%@%' AND length(url) <= 2048)),
  device_id        TEXT,
  tareas           TEXT NOT NULL DEFAULT '',
  con_credenciales INTEGER NOT NULL DEFAULT 0,
  creada_en        TEXT NOT NULL
);
"#;

pub fn nombre_valido(n: &str) -> AppResult<String> {
    let n = n.trim();
    if n.is_empty() || n.chars().count() > 60 || n.chars().any(char::is_control) {
        return Err(AppError::new("camaras", "El nombre de la cámara debe tener entre 1 y 60 caracteres."));
    }
    Ok(n.to_string())
}

pub fn tareas_validas(tareas: &[String]) -> AppResult<Vec<String>> {
    let mut v: Vec<String> = Vec::new();
    for t in tareas {
        if !TAREAS.contains(&t.as_str()) {
            return Err(AppError::new("camaras", format!("La tarea «{t}» no existe.")));
        }
        if !v.contains(t) {
            v.push(t.clone());
        }
    }
    v.sort_by_key(|t| TAREAS.iter().position(|x| x == t));
    Ok(v)
}

fn desde_fila(r: &rusqlite::Row<'_>) -> rusqlite::Result<Camara> {
    let tipo: String = r.get(1)?;
    let tareas: String = r.get(5)?;
    Ok(Camara {
        id: r.get(0)?,
        tipo: TipoCamara::desde(&tipo).unwrap_or(TipoCamara::Ip),
        nombre: r.get(2)?,
        url: r.get(3)?,
        device_id: r.get(4)?,
        tareas: tareas.split(',').filter(|t| !t.is_empty()).map(String::from).collect(),
        con_credenciales: r.get::<_, i64>(6)? != 0,
        creada_en: r.get(7)?,
    })
}

const COLUMNAS: &str = "id, tipo, nombre, url, device_id, tareas, con_credenciales, creada_en";

pub fn listar(conn: &Connection) -> AppResult<Vec<Camara>> {
    let mut st = conn.prepare(&format!("SELECT {COLUMNAS} FROM camaras ORDER BY creada_en, nombre"))?;
    let filas = st.query_map([], desde_fila)?;
    Ok(filas.collect::<Result<_, _>>()?)
}

pub fn obtener(conn: &Connection, id: &str) -> AppResult<Option<Camara>> {
    Ok(conn.query_row(&format!("SELECT {COLUMNAS} FROM camaras WHERE id = ?1"), [id], desde_fila).optional()?)
}

/// Alta o edición. La URL debe venir ya SIN credenciales (la valida `ssrf::analizar` antes).
pub fn guardar(conn: &Connection, c: &Camara) -> AppResult<()> {
    conn.execute(
        "INSERT INTO camaras (id, tipo, nombre, url, device_id, tareas, con_credenciales, creada_en)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET tipo = excluded.tipo, nombre = excluded.nombre, url = excluded.url,
           device_id = excluded.device_id, con_credenciales = excluded.con_credenciales",
        params![c.id, c.tipo.como_str(), c.nombre, c.url, c.device_id, c.tareas.join(","), c.con_credenciales as i64, c.creada_en],
    )?;
    Ok(())
}

pub fn eliminar(conn: &Connection, id: &str) -> AppResult<bool> {
    Ok(conn.execute("DELETE FROM camaras WHERE id = ?1", [id])? > 0)
}

/// Deja las `tareas` indicadas en esta cámara y se las quita a cualquier otra: una tarea usa UNA sola cámara.
pub fn asignar_tareas(conn: &Connection, id: &str, tareas: &[String]) -> AppResult<Camara> {
    let tareas = tareas_validas(tareas)?;
    if obtener(conn, id)?.is_none() {
        return Err(AppError::new("camaras", "No se encontró esa cámara."));
    }
    for otra in listar(conn)?.into_iter().filter(|o| o.id != id) {
        let quedan: Vec<&String> = otra.tareas.iter().filter(|t| !tareas.contains(t)).collect();
        if quedan.len() != otra.tareas.len() {
            let csv = quedan.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(",");
            conn.execute("UPDATE camaras SET tareas = ?2 WHERE id = ?1", params![otra.id, csv])?;
        }
    }
    conn.execute("UPDATE camaras SET tareas = ?2 WHERE id = ?1", params![id, tareas.join(",")])?;
    Ok(obtener(conn, id)?.expect("recién actualizada"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(ESQUEMA).unwrap();
        c
    }

    pub fn cam(id: &str, tipo: TipoCamara, nombre: &str, url: Option<&str>) -> Camara {
        Camara {
            id: id.into(), tipo, nombre: nombre.into(), url: url.map(String::from), device_id: None,
            tareas: vec![], con_credenciales: false, creada_en: "2026-10-11T10:00:00Z".into(),
        }
    }

    #[test]
    fn alta_listado_edicion_y_baja() {
        let c = conn();
        guardar(&c, &cam("a", TipoCamara::Ip, "Carril", Some("rtsp://192.168.1.50:554/live"))).unwrap();
        guardar(&c, &cam("b", TipoCamara::Celular, "Celular de Pedro", Some("http://192.168.1.60:8080/video"))).unwrap();
        guardar(&c, &Camara { device_id: Some("usb-1".into()), ..cam("c", TipoCamara::Usb, "Webcam", None) }).unwrap();
        let l = listar(&c).unwrap();
        assert_eq!(l.iter().map(|x| x.tipo).collect::<Vec<_>>(), vec![TipoCamara::Ip, TipoCamara::Celular, TipoCamara::Usb]);
        assert_eq!(obtener(&c, "c").unwrap().unwrap().device_id.as_deref(), Some("usb-1"));

        guardar(&c, &Camara { nombre: "Carril entrada".into(), con_credenciales: true, ..cam("a", TipoCamara::Ip, "x", Some("rtsp://192.168.1.51/live")) }).unwrap();
        let a = obtener(&c, "a").unwrap().unwrap();
        assert_eq!((a.nombre.as_str(), a.url.as_deref(), a.con_credenciales), ("Carril entrada", Some("rtsp://192.168.1.51/live"), true));
        assert_eq!(listar(&c).unwrap().len(), 3, "editar no duplica");

        assert!(eliminar(&c, "b").unwrap());
        assert!(!eliminar(&c, "b").unwrap());
        assert_eq!(listar(&c).unwrap().len(), 2);
    }

    #[test]
    fn la_base_rechaza_una_url_con_credenciales_aunque_el_codigo_fallara() {
        let c = conn();
        let r = guardar(&c, &cam("a", TipoCamara::Ip, "Mala", Some("rtsp://admin:1234@192.168.1.50/live")));
        assert!(r.is_err(), "el CHECK de la tabla impide guardar usuario@host");
        assert!(listar(&c).unwrap().is_empty());
    }

    #[test]
    fn la_tabla_no_tiene_columnas_para_credenciales() {
        let c = conn();
        let cols: Vec<String> = c.prepare("SELECT name FROM pragma_table_info('camaras')").unwrap()
            .query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
        for prohibida in ["usuario", "clave", "password", "pass", "secret", "token"] {
            assert!(!cols.iter().any(|x| x.contains(prohibida)), "columna sospechosa {prohibida}: {cols:?}");
        }
    }

    #[test]
    fn una_tarea_usa_una_sola_camara() {
        let c = conn();
        guardar(&c, &cam("a", TipoCamara::Ip, "A", Some("rtsp://192.168.1.50/a"))).unwrap();
        guardar(&c, &cam("b", TipoCamara::Ip, "B", Some("rtsp://192.168.1.51/b"))).unwrap();
        asignar_tareas(&c, "a", &["salida".into(), "placa".into(), "placa".into()]).unwrap();
        assert_eq!(obtener(&c, "a").unwrap().unwrap().tareas, vec!["placa", "salida"], "ordenadas y sin repetir");
        // b toma «placa»: se la quita a a
        let b = asignar_tareas(&c, "b", &["placa".into(), "dpi".into()]).unwrap();
        assert_eq!(b.tareas, vec!["placa", "dpi"]);
        assert_eq!(obtener(&c, "a").unwrap().unwrap().tareas, vec!["salida"]);
        // quitar todo
        assert!(asignar_tareas(&c, "b", &[]).unwrap().tareas.is_empty());
    }

    #[test]
    fn validaciones_de_nombre_y_tarea() {
        assert!(nombre_valido("  ").is_err());
        assert!(nombre_valido(&"x".repeat(61)).is_err());
        assert!(nombre_valido("a\nb").is_err());
        assert_eq!(nombre_valido("  Carril 1 ").unwrap(), "Carril 1");
        assert!(tareas_validas(&["foto".into()]).is_err());
        let c = conn();
        assert!(asignar_tareas(&c, "no-existe", &["qr".into()]).is_err());
    }
}
