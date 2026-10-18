//! Lo que queda en ESTE equipo de cada decisión del ANPR (Sprint 10, tarea 5), todo en el SQLCipher:
//!
//! - `anpr_eventos_local`: cada vehículo decidido (automático, verificación pendiente, alerta de lista negra, ilegible) y cómo se
//!   resolvió. Es la lista de eventos de la pantalla.
//! - `anpr_evidencias`: los recortes JPEG (placa y parte baja del vehículo) **cifrados en reposo** como el resto de la base, que
//!   se suben al backend cuando el acceso o el evento ya está allá, y se borran a los 7 días.
//! - La cola de siempre (`accesos_pendientes`) con su `ruta`: el acceso o la salida automáticos van a `/anpr/accesos` o
//!   `/anpr/salidas`; las alertas y las verificaciones resueltas, a `/anpr/eventos` (filas ocultas en «Registrados en este
//!   equipo»). El `id_cliente` de cada fila hace idempotente cada reintento, con o sin red.

use base64::Engine;
use chrono::{DateTime, Duration, Local, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::carriles::{Carril, Sentido};
use super::decision::{self, Decision, LecturaAnpr, MotivoVerificacion, VehiculoLocal};
use super::instante;
use crate::error::{AppError, AppResult};

pub const RETENCION_DIAS: i64 = 7;
/// Mismo tope que el backend (`MAX_EVIDENCIA_BYTES`): lo que pase de aquí no se sube.
pub const MAX_EVIDENCIA_BYTES: usize = 256 * 1024;

pub const RUTA_ACCESO: &str = "/anpr/accesos";
pub const RUTA_SALIDA: &str = "/anpr/salidas";
pub const RUTA_EVENTO: &str = "/anpr/eventos";

pub const ESQUEMA: &str = r#"
CREATE TABLE IF NOT EXISTS vehiculos_autorizados_local (
  id               TEXT PRIMARY KEY,
  placa            TEXT NOT NULL,
  residente_id     TEXT NOT NULL,
  numero_casa      TEXT,
  residente_nombre TEXT,
  vigente_desde    TEXT NOT NULL,
  vigente_hasta    TEXT,
  activo           INTEGER NOT NULL DEFAULT 1,
  en_lista_negra   INTEGER NOT NULL DEFAULT 0,
  version          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_vehiculos_local_placa ON vehiculos_autorizados_local(placa);

CREATE TABLE IF NOT EXISTS anpr_eventos_local (
  id                    TEXT PRIMARY KEY,
  carril_id             TEXT NOT NULL,
  track_id              TEXT NOT NULL,
  sentido               TEXT NOT NULL,
  placa                 TEXT,
  placa_probable        TEXT,
  resultado             TEXT NOT NULL,
  estado                TEXT NOT NULL CHECK (estado IN
                          ('automatico', 'verificacion_pendiente', 'alerta_lista_negra', 'ilegible', 'resuelto', 'descartado')),
  motivo                TEXT,
  confianza             REAL,
  lecturas              TEXT,
  requiere_verificacion INTEGER NOT NULL DEFAULT 0,
  vehiculo_id           TEXT,
  residente_id          TEXT,
  residente_casa        TEXT,
  residente_nombre      TEXT,
  id_cliente            TEXT,
  apertura              TEXT,
  ms_desde_legible      INTEGER,
  creado_en             TEXT NOT NULL,
  resuelto_por          TEXT,
  resuelto_en           TEXT,
  resolucion            TEXT
);
CREATE INDEX IF NOT EXISTS idx_anpr_eventos_creado ON anpr_eventos_local(creado_en);
CREATE INDEX IF NOT EXISTS idx_anpr_eventos_placa ON anpr_eventos_local(carril_id, placa, creado_en);

-- `subida`: 0 = pendiente, 1 = ya está en el servidor, 2 = el servidor no la aceptó (no se reintenta).
CREATE TABLE IF NOT EXISTS anpr_evidencias (
  evento_id  TEXT NOT NULL,
  tipo       TEXT NOT NULL CHECK (tipo IN ('placa', 'vehiculo')),
  jpeg       BLOB NOT NULL,
  expira_en  TEXT NOT NULL,
  id_cliente TEXT,
  subida     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (evento_id, tipo)
);
"#;

/// Un evento del ANPR, como lo ve la pantalla (sin las imágenes: esas se piden aparte).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct EventoAnpr {
    pub id: String,
    pub carril_id: String,
    pub track_id: String,
    pub sentido: String,
    pub placa: Option<String>,
    pub placa_probable: Option<String>,
    pub resultado: String,
    /// `automatico` | `verificacion_pendiente` | `alerta_lista_negra` | `ilegible` | `resuelto` | `descartado`.
    pub estado: String,
    pub motivo: Option<String>,
    pub confianza: Option<f64>,
    pub lecturas: Value,
    pub requiere_verificacion: bool,
    pub vehiculo_id: Option<String>,
    pub residente_id: Option<String>,
    pub residente_casa: Option<String>,
    pub residente_nombre: Option<String>,
    pub id_cliente: Option<String>,
    /// `abierta` | `simulada` | `fallo: …` | null (no se mandó abrir).
    pub apertura: Option<String>,
    pub ms_desde_legible: Option<i64>,
    pub creado_en: String,
    pub resuelto_por: Option<String>,
    pub resuelto_en: Option<String>,
    pub resolucion: Option<String>,
    pub evidencia_placa: bool,
    pub evidencia_vehiculo: bool,
}

impl EventoAnpr {
    /// ¿Espera algo del agente?
    pub fn pendiente(&self) -> bool {
        matches!(self.estado.as_str(), "verificacion_pendiente" | "ilegible" | "alerta_lista_negra")
    }
}

/// Lo que el agente decide sobre un evento pendiente.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Resolucion {
    /// Es un vehículo autorizado (con la placa leída o corregida): registra y abre.
    Autorizar,
    /// El agente registra a mano (visitante, o con la captura por clic): aquí solo se cierra el evento.
    RegistroManual,
    /// No era nada (falso positivo, se fue): se cierra sin registro.
    Descartar,
    /// Alerta de lista negra vista: se cierra (la alerta ya quedó en la bitácora).
    Enterado,
}

impl Resolucion {
    fn como_str(self) -> &'static str {
        match self {
            Resolucion::Autorizar => "autorizado",
            Resolucion::RegistroManual => "registro_manual",
            Resolucion::Descartar => "descartado",
            Resolucion::Enterado => "enterado",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ResultadoResolucion {
    pub evento: EventoAnpr,
    /// Hay que mandar abrir (solo al autorizar).
    pub abrir: bool,
}

// ── Cola ────────────────────────────────────────────────────────────────────────────────────────────────────

struct Fila<'a> {
    ruta: &'a str,
    visible: bool,
    nombre: &'a str,
    placa: Option<&'a str>,
    casa: Option<&'a str>,
    manual: bool,
}

/// Encola un envío al backend (misma cola y mismo push que los accesos de visitantes). Devuelve el `id_cliente`.
fn encolar(conn: &Connection, mut payload: Value, f: Fila<'_>, ahora: DateTime<Utc>) -> AppResult<String> {
    let id_cliente = uuid::Uuid::new_v4().to_string();
    let registrado_en = ahora.to_rfc3339();
    payload["id_cliente"] = json!(id_cliente);
    payload["registrado_en"] = json!(registrado_en);
    conn.execute(
        "INSERT INTO accesos_pendientes
           (id_cliente, payload, registrado_en, estado, intentos, proximo_intento_en, nombre_visitante, numero_dpi, placa,
            residente_casa, capturado_manualmente, ruta, visible, origen)
         VALUES (?1, ?2, ?3, 'pendiente', 0, ?3, ?4, '', ?5, ?6, ?7, ?8, ?9, 'anpr')",
        params![id_cliente, payload.to_string(), registrado_en, f.nombre, f.placa, f.casa, f.manual as i64, f.ruta, f.visible as i64],
    )?;
    Ok(id_cliente)
}

fn encolar_movimiento(conn: &Connection, carril: &Carril, v: &VehiculoLocal, lectura_confianza: f64, track_id: &str, modo: &str, ahora: DateTime<Utc>) -> AppResult<String> {
    let nombre = v.residente_nombre.clone().unwrap_or_else(|| "Residente".into());
    let fila = Fila { ruta: RUTA_ACCESO, visible: true, nombre: &nombre, placa: Some(&v.placa), casa: v.numero_casa.as_deref(), manual: modo == "verificacion" };
    match carril.sentido {
        Sentido::Entrada => encolar(
            conn,
            json!({ "vehiculo_id": v.id, "placa": v.placa, "confianza": lectura_confianza, "track_id": track_id, "carril": carril.id, "modo": modo }),
            fila,
            ahora,
        ),
        Sentido::Salida => encolar(
            conn,
            json!({ "placa": v.placa, "confianza": lectura_confianza, "track_id": track_id, "carril": carril.id }),
            Fila { ruta: RUTA_SALIDA, ..fila },
            ahora,
        ),
    }
}

/// Evento para la bitácora del backend (alerta, ilegible, verificación resuelta, falla del actuador). Oculto en la lista.
pub fn encolar_evento(conn: &Connection, tipo: &str, placa: Option<&str>, carril: &str, track_id: &str, detalle: Value, ahora: DateTime<Utc>) -> AppResult<String> {
    encolar(
        conn,
        json!({ "tipo": tipo, "placa": placa, "carril": carril, "track_id": track_id, "detalle": detalle }),
        Fila { ruta: RUTA_EVENTO, visible: false, nombre: "", placa, casa: None, manual: false },
        ahora,
    )
}

// ── Registro de una decisión ────────────────────────────────────────────────────────────────────────────────

fn guardar_evidencia(conn: &Connection, evento_id: &str, tipo: &str, b64: Option<&str>, expira: &str, id_cliente: Option<&str>) -> AppResult<()> {
    let Some(b64) = b64 else { return Ok(()) };
    let Ok(jpeg) = base64::engine::general_purpose::STANDARD.decode(b64) else {
        log::warn!("anpr: evidencia {tipo} ilegible; se descarta");
        return Ok(());
    };
    if jpeg.len() < 4 || jpeg[..3] != [0xff, 0xd8, 0xff] || jpeg.len() > MAX_EVIDENCIA_BYTES {
        log::warn!("anpr: evidencia {tipo} no es un JPEG aceptable ({} bytes); se descarta", jpeg.len());
        return Ok(());
    }
    conn.execute(
        "INSERT OR REPLACE INTO anpr_evidencias (evento_id, tipo, jpeg, expira_en, id_cliente, subida) VALUES (?1, ?2, ?3, ?4, ?5, 0)",
        params![evento_id, tipo, jpeg, expira, id_cliente],
    )?;
    Ok(())
}

/// Deja constancia local de la decisión y encola lo que corresponda. `Ignorar` no deja nada. Devuelve el evento creado.
pub fn registrar(conn: &Connection, carril: &Carril, lectura: &LecturaAnpr, decision: &Decision, ahora: DateTime<Utc>) -> AppResult<Option<EventoAnpr>> {
    let (estado, motivo, vehiculo, id_cliente): (&str, Option<String>, Option<&VehiculoLocal>, Option<String>) = match decision {
        Decision::Ignorar { .. } => return Ok(None),
        Decision::Abrir { vehiculo } => {
            let id = encolar_movimiento(conn, carril, vehiculo, lectura.confianza, &lectura.track_id, "automatico", ahora)?;
            ("automatico", None, Some(vehiculo), Some(id))
        }
        Decision::AlertaListaNegra { razon } => {
            let id = encolar_evento(conn, "alerta_lista_negra", lectura.placa.as_deref(), &carril.id, &lectura.track_id,
                json!({ "razon": razon, "confianza": lectura.confianza, "sentido": carril.sentido.como_str() }), ahora)?;
            ("alerta_lista_negra", Some(razon.clone()), None, Some(id))
        }
        Decision::Verificar { motivo, vehiculo } => {
            let id = if *motivo == MotivoVerificacion::Ilegible {
                Some(encolar_evento(conn, "ilegible", None, &carril.id, &lectura.track_id,
                    json!({ "motivo": lectura.motivo, "lecturas": lectura.lecturas.len(), "placa_probable": lectura.placa_probable }), ahora)?)
            } else {
                None
            };
            let estado = if *motivo == MotivoVerificacion::Ilegible { "ilegible" } else { "verificacion_pendiente" };
            (estado, Some(serde_json::to_value(motivo)?.as_str().unwrap_or_default().to_string()), vehiculo.as_ref(), id)
        }
    };
    let id = uuid::Uuid::new_v4().to_string();
    let creado_en = instante(ahora);
    conn.execute(
        "INSERT INTO anpr_eventos_local
           (id, carril_id, track_id, sentido, placa, placa_probable, resultado, estado, motivo, confianza, lecturas, requiere_verificacion,
            vehiculo_id, residente_id, residente_casa, residente_nombre, id_cliente, ms_desde_legible, creado_en)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
        params![
            id, carril.id, lectura.track_id, carril.sentido.como_str(),
            lectura.placa.as_deref().map(crate::placa::normalizar), lectura.placa_probable.as_deref().map(crate::placa::normalizar),
            lectura.resultado, estado, motivo, lectura.confianza, Value::Array(lectura.lecturas.clone()).to_string(),
            lectura.requiere_verificacion as i64, vehiculo.map(|v| v.id.clone()), vehiculo.map(|v| v.residente_id.clone()),
            vehiculo.and_then(|v| v.numero_casa.clone()), vehiculo.and_then(|v| v.residente_nombre.clone()), id_cliente,
            lectura.ms_desde_legible, creado_en,
        ],
    )?;
    // La evidencia caduca a los 7 días (o antes si el sidecar lo pidió).
    let tope = ahora + Duration::days(RETENCION_DIAS);
    let expira = lectura.evidencia.expira_ms.and_then(DateTime::<Utc>::from_timestamp_millis).filter(|e| *e < tope).unwrap_or(tope);
    let expira = instante(expira);
    guardar_evidencia(conn, &id, "placa", lectura.evidencia.placa_jpeg.as_deref(), &expira, id_cliente.as_deref())?;
    guardar_evidencia(conn, &id, "vehiculo", lectura.evidencia.vehiculo_jpeg.as_deref(), &expira, id_cliente.as_deref())?;
    obtener(conn, &id)
}

/// Resultado de mandar abrir: queda en el evento y, si falló, va a la bitácora del backend.
pub fn marcar_apertura(conn: &Connection, evento_id: &str, resultado: &Result<bool, String>, ahora: DateTime<Utc>) -> AppResult<()> {
    let texto = match resultado {
        Ok(true) => "simulada".to_string(),
        Ok(false) => "abierta".to_string(),
        Err(e) => format!("fallo: {e}"),
    };
    conn.execute("UPDATE anpr_eventos_local SET apertura = ?2 WHERE id = ?1", params![evento_id, texto])?;
    if let Err(e) = resultado {
        if let Some(ev) = obtener(conn, evento_id)? {
            encolar_evento(conn, "actuador_fallo", ev.placa.as_deref(), &ev.carril_id, &ev.track_id, json!({ "error": e }), ahora)?;
        }
    }
    Ok(())
}

// ── Resolución por el agente ────────────────────────────────────────────────────────────────────────────────

/// El agente resuelve un evento pendiente. `Autorizar` vuelve a revisar TODAS las barandas con la placa (leída o corregida):
/// nunca abre con lista negra, con la licencia bloqueada, ni para un vehículo que no está autorizado y vigente.
pub fn resolver(
    conn: &Connection,
    agente_id: &str,
    carril: &Carril,
    evento_id: &str,
    resolucion: Resolucion,
    placa_corregida: Option<&str>,
    licencia_ok: bool,
    ahora: DateTime<Utc>,
) -> AppResult<ResultadoResolucion> {
    let ev = obtener(conn, evento_id)?.ok_or_else(|| AppError::new("anpr", "No se encontró ese evento."))?;
    if !ev.pendiente() {
        return Err(AppError::new("anpr", "Este evento ya se resolvió."));
    }
    if ev.estado == "alerta_lista_negra" && resolucion == Resolucion::Autorizar {
        return Err(AppError::new("anpr_lista_negra", "Un vehículo en lista negra nunca se abre desde aquí."));
    }
    let placa = placa_corregida.map(crate::placa::normalizar).filter(|p| !p.is_empty())
        .or_else(|| ev.placa.clone())
        .or_else(|| ev.placa_probable.clone());
    let mut id_cliente = None;
    let mut abrir = false;
    match resolucion {
        Resolucion::Autorizar => {
            let placa = placa.clone().ok_or_else(|| AppError::new("anpr", "Escribe la placa para autorizar."))?;
            let hoy = Local::now().format("%Y-%m-%d").to_string();
            let h = decision::hechos(conn, Some(&placa), &carril.id, &hoy, &instante(ahora), licencia_ok)?;
            if let Some(razon) = h.bloqueo {
                return Err(AppError::new("anpr_lista_negra", format!("Vehículo en lista negra: {razon}. No se abre.")));
            }
            if !licencia_ok {
                return Err(AppError::new("anpr", MotivoVerificacion::LicenciaBloqueada.texto()));
            }
            let v = h.vehiculo.filter(|v| v.activo && !v.en_lista_negra && v.vigente(&hoy)).ok_or_else(|| {
                AppError::new("anpr_no_autorizado", "Esa placa no es de un vehículo autorizado y vigente. Registra la entrada a mano.")
            })?;
            if !h.residente_en_copia {
                return Err(AppError::new("anpr_no_autorizado", MotivoVerificacion::ResidenteInactivo.texto()));
            }
            id_cliente = Some(encolar_movimiento(conn, carril, &v, ev.confianza.unwrap_or(0.0), &ev.track_id, "verificacion", ahora)?);
            conn.execute(
                "UPDATE anpr_eventos_local SET vehiculo_id = ?2, residente_id = ?3, residente_casa = ?4, residente_nombre = ?5 WHERE id = ?1",
                params![evento_id, v.id, v.residente_id, v.numero_casa, v.residente_nombre],
            )?;
            abrir = true;
        }
        Resolucion::RegistroManual | Resolucion::Descartar => {
            id_cliente = Some(encolar_evento(conn, "verificacion_resuelta", placa.as_deref(), &ev.carril_id, &ev.track_id,
                json!({ "resolucion": resolucion.como_str(), "estado_previo": ev.estado, "motivo": ev.motivo }), ahora)?);
        }
        Resolucion::Enterado => {}
    }
    let estado = if resolucion == Resolucion::Descartar { "descartado" } else { "resuelto" };
    conn.execute(
        "UPDATE anpr_eventos_local
            SET estado = ?2, resolucion = ?3, resuelto_por = ?4, resuelto_en = ?5, placa = COALESCE(?6, placa),
                id_cliente = COALESCE(id_cliente, ?7)
          WHERE id = ?1",
        params![evento_id, estado, resolucion.como_str(), agente_id, instante(ahora), placa, id_cliente],
    )?;
    // La evidencia de una verificación se sube con el acceso o el evento que la resolvió.
    if let Some(id) = &id_cliente {
        conn.execute("UPDATE anpr_evidencias SET id_cliente = COALESCE(id_cliente, ?2) WHERE evento_id = ?1", params![evento_id, id])?;
    }
    let evento = obtener(conn, evento_id)?.expect("recién actualizado");
    Ok(ResultadoResolucion { evento, abrir })
}

// ── Consultas ───────────────────────────────────────────────────────────────────────────────────────────────

const COLUMNAS: &str = "e.id, e.carril_id, e.track_id, e.sentido, e.placa, e.placa_probable, e.resultado, e.estado, e.motivo, e.confianza,
  e.lecturas, e.requiere_verificacion, e.vehiculo_id, e.residente_id, e.residente_casa, e.residente_nombre, e.id_cliente, e.apertura,
  e.ms_desde_legible, e.creado_en, e.resuelto_por, e.resuelto_en, e.resolucion,
  EXISTS (SELECT 1 FROM anpr_evidencias x WHERE x.evento_id = e.id AND x.tipo = 'placa'),
  EXISTS (SELECT 1 FROM anpr_evidencias x WHERE x.evento_id = e.id AND x.tipo = 'vehiculo')";

fn desde_fila(r: &rusqlite::Row<'_>) -> rusqlite::Result<EventoAnpr> {
    let lecturas: Option<String> = r.get(10)?;
    Ok(EventoAnpr {
        id: r.get(0)?,
        carril_id: r.get(1)?,
        track_id: r.get(2)?,
        sentido: r.get(3)?,
        placa: r.get(4)?,
        placa_probable: r.get(5)?,
        resultado: r.get(6)?,
        estado: r.get(7)?,
        motivo: r.get(8)?,
        confianza: r.get(9)?,
        lecturas: lecturas.and_then(|l| serde_json::from_str(&l).ok()).unwrap_or(Value::Array(vec![])),
        requiere_verificacion: r.get::<_, i64>(11)? != 0,
        vehiculo_id: r.get(12)?,
        residente_id: r.get(13)?,
        residente_casa: r.get(14)?,
        residente_nombre: r.get(15)?,
        id_cliente: r.get(16)?,
        apertura: r.get(17)?,
        ms_desde_legible: r.get(18)?,
        creado_en: r.get(19)?,
        resuelto_por: r.get(20)?,
        resuelto_en: r.get(21)?,
        resolucion: r.get(22)?,
        evidencia_placa: r.get::<_, i64>(23)? != 0,
        evidencia_vehiculo: r.get::<_, i64>(24)? != 0,
    })
}

pub fn obtener(conn: &Connection, id: &str) -> AppResult<Option<EventoAnpr>> {
    Ok(conn.query_row(&format!("SELECT {COLUMNAS} FROM anpr_eventos_local e WHERE e.id = ?1"), [id], desde_fila).optional()?)
}

/// Los más recientes primero; los pendientes siempre entran aunque sean más viejos que el límite.
pub fn listar(conn: &Connection, limite: usize) -> AppResult<Vec<EventoAnpr>> {
    let mut st = conn.prepare(&format!(
        "SELECT {COLUMNAS} FROM anpr_eventos_local e
         ORDER BY CASE WHEN e.estado IN ('verificacion_pendiente', 'ilegible', 'alerta_lista_negra') THEN 0 ELSE 1 END, e.creado_en DESC
         LIMIT ?1"
    ))?;
    let filas = st.query_map([limite as i64], desde_fila)?;
    Ok(filas.collect::<Result<_, _>>()?)
}

/// JPEG en base64 de una evidencia (para mostrarla en la pantalla). `None` si no hay o ya se purgó.
pub fn evidencia(conn: &Connection, evento_id: &str, tipo: &str) -> AppResult<Option<String>> {
    let jpeg: Option<Vec<u8>> = conn
        .query_row("SELECT jpeg FROM anpr_evidencias WHERE evento_id = ?1 AND tipo = ?2", params![evento_id, tipo], |r| r.get(0))
        .optional()?;
    Ok(jpeg.map(|j| base64::engine::general_purpose::STANDARD.encode(j)))
}

/// Evidencias listas para subir: su acceso o evento ya llegó al servidor.
pub struct EvidenciaPorSubir {
    pub evento_id: String,
    pub tipo: String,
    pub id_cliente: String,
    pub jpeg: Vec<u8>,
}

pub fn evidencias_por_subir(conn: &Connection, ahora: DateTime<Utc>, limite: usize) -> AppResult<Vec<EvidenciaPorSubir>> {
    let mut st = conn.prepare(
        "SELECT x.evento_id, x.tipo, x.id_cliente, x.jpeg FROM anpr_evidencias x
          JOIN accesos_pendientes p ON p.id_cliente = x.id_cliente
         WHERE x.subida = 0 AND x.expira_en > ?1 AND p.estado = 'sincronizado'
         LIMIT ?2",
    )?;
    let filas = st.query_map(params![instante(ahora), limite as i64], |r| {
        Ok(EvidenciaPorSubir { evento_id: r.get(0)?, tipo: r.get(1)?, id_cliente: r.get(2)?, jpeg: r.get(3)? })
    })?;
    Ok(filas.collect::<Result<_, _>>()?)
}

/// 1 = subida; 2 = el servidor no la aceptó (no se reintenta).
pub fn marcar_evidencia(conn: &Connection, evento_id: &str, tipo: &str, subida: i64) -> AppResult<()> {
    conn.execute("UPDATE anpr_evidencias SET subida = ?3 WHERE evento_id = ?1 AND tipo = ?2", params![evento_id, tipo, subida])?;
    Ok(())
}

/// Borra la evidencia vencida (7 días) y los eventos ya resueltos de más de 7 días. Los pendientes se conservan: el agente aún
/// tiene que verlos. Devuelve (evidencias, eventos) borrados.
pub fn purgar(conn: &Connection, ahora: DateTime<Utc>) -> AppResult<(usize, usize)> {
    let evidencias = conn.execute("DELETE FROM anpr_evidencias WHERE expira_en <= ?1", [instante(ahora)])?;
    let limite = instante(ahora - Duration::days(RETENCION_DIAS));
    let eventos = conn.execute(
        "DELETE FROM anpr_eventos_local
          WHERE creado_en < ?1 AND estado NOT IN ('verificacion_pendiente', 'ilegible', 'alerta_lista_negra')",
        [limite],
    )?;
    conn.execute("DELETE FROM anpr_evidencias WHERE evento_id NOT IN (SELECT id FROM anpr_eventos_local)", [])?;
    Ok((evidencias, eventos))
}

// ── Copia local de los vehículos autorizados ────────────────────────────────────────────────────────────────

/// Aplica `vehiculos` del snapshot (`{modo: 'completo'|'cambios', version, filas}`). En modo completo reemplaza la copia; en
/// cambios, inserta o actualiza las activas y BORRA las que llegan con `activo: false`. Devuelve la versión guardada.
pub fn aplicar_vehiculos(conn: &Connection, v: &Value) -> AppResult<Option<String>> {
    let Some(filas) = v["filas"].as_array() else { return Ok(None) };
    let version = v["version"].as_str().map(String::from).or_else(|| v["version"].as_i64().map(|n| n.to_string())).unwrap_or_else(|| "0".into());
    if v["modo"].as_str() == Some("completo") {
        conn.execute("DELETE FROM vehiculos_autorizados_local", [])?;
    }
    for f in filas {
        let id = f["id"].as_str().unwrap_or_default();
        if id.is_empty() {
            continue;
        }
        if !f["activo"].as_bool().unwrap_or(false) {
            conn.execute("DELETE FROM vehiculos_autorizados_local WHERE id = ?1", [id])?;
            continue;
        }
        let dia = |x: &Value| x.as_str().map(|s| s.chars().take(10).collect::<String>());
        conn.execute(
            "INSERT OR REPLACE INTO vehiculos_autorizados_local
               (id, placa, residente_id, numero_casa, residente_nombre, vigente_desde, vigente_hasta, activo, en_lista_negra, version)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?9)",
            params![
                id,
                crate::placa::normalizar(f["placa"].as_str().unwrap_or_default()),
                f["residente_id"].as_str().unwrap_or_default(),
                f["numero_casa"].as_str(),
                f["residente_nombre"].as_str(),
                dia(&f["vigente_desde"]).unwrap_or_else(|| "1970-01-01".into()),
                dia(&f["vigente_hasta"]),
                f["en_lista_negra"].as_bool().unwrap_or(false) as i64,
                f["version"].as_str().and_then(|s| s.parse::<i64>().ok()).or_else(|| f["version"].as_i64()).unwrap_or(0),
            ],
        )?;
    }
    crate::db::meta_escribir(conn, "vehiculos_version", &version)?;
    Ok(Some(version))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::anpr::carriles::{Carril, Modo, Sentido, Umbrales};
    use crate::anpr::decision::{EvidenciaSidecar, Hechos};
    use crate::anpr::actuador::ConfigActuador;

    const JPEG: &[u8] = &[0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9];

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        crate::db::aplicar_esquema(&c).unwrap();
        c.execute_batch(
            "INSERT INTO residentes_local VALUES ('r1','A-12','Ana López','al_dia',NULL);
             INSERT INTO vehiculos_autorizados_local VALUES ('v1','P123ABC','r1','A-12','Ana López','2026-01-01',NULL,1,0,10);
             INSERT INTO blacklist_local (id, numero_dpi, visitante_nombre, razon, fecha_fin, residente_id, placa)
               VALUES ('b1','',NULL,'Vehículo robado',NULL,NULL,'P999XYZ');",
        ).unwrap();
        c
    }

    fn carril(sentido: Sentido) -> Carril {
        Carril {
            id: "entrada".into(), nombre: "Entrada".into(), camara_id: Some("cam".into()), sentido, modo: Modo::Automatico,
            roi: vec![], umbrales: Umbrales::default(), actuador: ConfigActuador::Simulado, actualizado_en: None,
        }
    }

    fn lectura(placa: Option<&str>) -> LecturaAnpr {
        let b64 = base64::engine::general_purpose::STANDARD.encode(JPEG);
        LecturaAnpr {
            carril: "entrada".into(), track_id: "entrada-x-1".into(),
            resultado: if placa.is_some() { "confirmada".into() } else { "ilegible".into() },
            placa: placa.map(String::from), placa_probable: placa.map(String::from), confianza: 0.97, votos: 3,
            lecturas: vec![json!({"texto": "P123ABC", "valida": true, "correcciones": 0, "confianza": 0.97})],
            requiere_verificacion: placa.is_none(), alguna_correccion: false, motivo: None, clase: Some("carro".into()), ms_desde_legible: Some(380),
            evidencia: EvidenciaSidecar { placa_jpeg: Some(b64.clone()), vehiculo_jpeg: Some(b64), expira_ms: None },
        }
    }

    fn ahora() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-10-22T15:00:00Z").unwrap().with_timezone(&Utc)
    }

    /// Decide con los hechos de la base, como lo hace el motor.
    fn decidir_y_registrar(c: &Connection, cr: &Carril, l: &LecturaAnpr, licencia_ok: bool) -> (Decision, Option<EventoAnpr>) {
        let h = decision::hechos(c, l.placa.as_deref(), &cr.id, "2026-10-22", &instante(ahora()), licencia_ok).unwrap();
        let d = decision::decidir(cr.modo, l, &h);
        let e = registrar(c, cr, l, &d, ahora()).unwrap();
        (d, e)
    }

    fn cola(c: &Connection) -> Vec<(String, String, Value, i64)> {
        let mut st = c.prepare("SELECT id_cliente, ruta, payload, visible FROM accesos_pendientes ORDER BY registrado_en, ruta").unwrap();
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, serde_json::from_str(&r.get::<_, String>(2)?).unwrap(), r.get(3)?)))
            .unwrap().collect::<Result<_, _>>().unwrap()
    }

    #[test]
    fn autorizado_registra_el_acceso_anpr_en_la_cola_sin_red_con_evidencia_cifrada_en_la_base() {
        let c = db();
        let (d, e) = decidir_y_registrar(&c, &carril(Sentido::Entrada), &lectura(Some("P123ABC")), true);
        assert!(d.abre());
        let e = e.unwrap();
        assert_eq!((e.estado.as_str(), e.residente_casa.as_deref(), e.vehiculo_id.as_deref()), ("automatico", Some("A-12"), Some("v1")));
        assert!(e.evidencia_placa && e.evidencia_vehiculo);
        let q = cola(&c);
        assert_eq!(q.len(), 1);
        let (id, ruta, payload, visible) = &q[0];
        assert_eq!((ruta.as_str(), *visible), (RUTA_ACCESO, 1));
        assert_eq!(e.id_cliente.as_deref(), Some(id.as_str()));
        assert_eq!(payload["id_cliente"], json!(id));
        assert_eq!(payload["vehiculo_id"], "v1");
        assert_eq!(payload["placa"], "P123ABC");
        assert_eq!(payload["modo"], "automatico");
        assert_eq!(payload["track_id"], "entrada-x-1");
        assert!(payload["registrado_en"].as_str().is_some());
        // La fila de la cola se muestra como del residente y con origen ANPR.
        let (nombre, dpi, origen): (String, String, String) =
            c.query_row("SELECT nombre_visitante, numero_dpi, origen FROM accesos_pendientes", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        assert_eq!((nombre.as_str(), dpi.as_str(), origen.as_str()), ("Ana López", "", "anpr"));
        assert_eq!(evidencia(&c, &e.id, "placa").unwrap().map(|b| base64::engine::general_purpose::STANDARD.decode(b).unwrap()), Some(JPEG.to_vec()));
    }

    #[test]
    fn carril_de_salida_encola_la_salida_por_placa() {
        let c = db();
        let (d, _) = decidir_y_registrar(&c, &carril(Sentido::Salida), &lectura(Some("P123ABC")), true);
        assert!(d.abre());
        let q = cola(&c);
        assert_eq!(q[0].1, RUTA_SALIDA);
        assert_eq!(q[0].2["placa"], "P123ABC");
        assert!(q[0].2.get("vehiculo_id").is_none());
    }

    #[test]
    fn lista_negra_alerta_sin_acceso_y_con_su_evento_oculto_para_la_bitacora() {
        let c = db();
        let (d, e) = decidir_y_registrar(&c, &carril(Sentido::Entrada), &lectura(Some("P999XYZ")), true);
        assert!(matches!(d, Decision::AlertaListaNegra { .. }));
        let e = e.unwrap();
        assert_eq!((e.estado.as_str(), e.motivo.as_deref()), ("alerta_lista_negra", Some("Vehículo robado")));
        let q = cola(&c);
        assert_eq!(q.len(), 1);
        assert_eq!((q[0].1.as_str(), q[0].3), (RUTA_EVENTO, 0), "no es un acceso y no se muestra en «Registrados»");
        assert_eq!(q[0].2["tipo"], "alerta_lista_negra");
        assert_eq!(q[0].2["detalle"]["razon"], "Vehículo robado");
        // Autorizar una alerta: jamás.
        let r = resolver(&c, "agente", &carril(Sentido::Entrada), &e.id, Resolucion::Autorizar, None, true, ahora());
        assert_eq!(r.unwrap_err().codigo, "anpr_lista_negra");
        assert_eq!(cola(&c).len(), 1);
        let ok = resolver(&c, "agente", &carril(Sentido::Entrada), &e.id, Resolucion::Enterado, None, true, ahora()).unwrap();
        assert_eq!((ok.evento.estado.as_str(), ok.abrir), ("resuelto", false));
    }

    #[test]
    fn verificacion_pendiente_sin_cola_hasta_que_el_agente_resuelve() {
        let c = db();
        let mut l = lectura(Some("P123ABC"));
        l.requiere_verificacion = true;
        let (d, e) = decidir_y_registrar(&c, &carril(Sentido::Entrada), &l, true);
        assert!(!d.abre(), "lectura corregida: nunca abre sola");
        let e = e.unwrap();
        assert_eq!((e.estado.as_str(), e.motivo.as_deref()), ("verificacion_pendiente", Some("lectura_corregida")));
        assert!(cola(&c).is_empty(), "nada se registra todavía");
        // El agente confirma con un toque: se registra en modo verificación y se manda abrir.
        let r = resolver(&c, "agente-1", &carril(Sentido::Entrada), &e.id, Resolucion::Autorizar, None, true, ahora()).unwrap();
        assert!(r.abrir);
        assert_eq!((r.evento.estado.as_str(), r.evento.resolucion.as_deref(), r.evento.resuelto_por.as_deref()), ("resuelto", Some("autorizado"), Some("agente-1")));
        let q = cola(&c);
        assert_eq!(q[0].2["modo"], "verificacion");
        assert_eq!(r.evento.id_cliente.as_deref(), Some(q[0].0.as_str()));
        // La evidencia queda ligada a ese acceso para subirla.
        let ids: Vec<Option<String>> = c.prepare("SELECT id_cliente FROM anpr_evidencias").unwrap()
            .query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
        assert!(ids.iter().all(|i| i.as_deref() == Some(q[0].0.as_str())));
        assert_eq!(resolver(&c, "a", &carril(Sentido::Entrada), &e.id, Resolucion::Descartar, None, true, ahora()).unwrap_err().mensaje, "Este evento ya se resolvió.");
    }

    #[test]
    fn autorizar_con_placa_corregida_revisa_de_nuevo_las_barandas() {
        let c = db();
        let (_, e) = decidir_y_registrar(&c, &carril(Sentido::Entrada), &lectura(None), true);
        let e = e.unwrap();
        assert_eq!(e.estado, "ilegible");
        let cr = carril(Sentido::Entrada);
        // Placa corregida que está en lista negra → no abre.
        assert_eq!(resolver(&c, "a", &cr, &e.id, Resolucion::Autorizar, Some("p-999 xyz"), true, ahora()).unwrap_err().codigo, "anpr_lista_negra");
        // Placa que no es de un vehículo autorizado → registrar a mano.
        assert_eq!(resolver(&c, "a", &cr, &e.id, Resolucion::Autorizar, Some("C458DFG"), true, ahora()).unwrap_err().codigo, "anpr_no_autorizado");
        // Licencia bloqueada (empresa suspendida) → no.
        assert!(resolver(&c, "a", &cr, &e.id, Resolucion::Autorizar, Some("P123ABC"), false, ahora()).is_err());
        // Sin placa → pide escribirla.
        assert!(resolver(&c, "a", &cr, &e.id, Resolucion::Autorizar, None, true, ahora()).unwrap_err().mensaje.contains("Escribe la placa"));
        let solo_evento_ilegible = cola(&c).iter().filter(|f| f.1 == RUTA_ACCESO).count();
        assert_eq!(solo_evento_ilegible, 0, "ningún intento fallido encoló un acceso");
        // Con la placa corregida de un vehículo autorizado, sí.
        let r = resolver(&c, "a", &cr, &e.id, Resolucion::Autorizar, Some("p-123abc"), true, ahora()).unwrap();
        assert!(r.abrir);
        assert_eq!(r.evento.placa.as_deref(), Some("P123ABC"));
    }

    #[test]
    fn registro_manual_y_descartar_cierran_el_evento_y_van_a_la_bitacora() {
        let c = db();
        let cr = carril(Sentido::Entrada);
        let (_, e1) = decidir_y_registrar(&c, &cr, &lectura(Some("C458DFG")), true);
        let e1 = e1.unwrap();
        assert_eq!(e1.motivo.as_deref(), Some("desconocida"));
        let r = resolver(&c, "a", &cr, &e1.id, Resolucion::RegistroManual, None, true, ahora()).unwrap();
        assert_eq!((r.evento.estado.as_str(), r.abrir), ("resuelto", false));
        let q = cola(&c);
        assert_eq!((q.last().unwrap().1.as_str(), q.last().unwrap().2["tipo"].as_str()), (RUTA_EVENTO, Some("verificacion_resuelta")));
        assert_eq!(q.last().unwrap().2["detalle"]["resolucion"], "registro_manual");
        let (_, e2) = decidir_y_registrar(&c, &Carril { id: "otro".into(), ..cr.clone() }, &lectura(Some("C458DFG")), true);
        let r2 = resolver(&c, "a", &cr, &e2.unwrap().id, Resolucion::Descartar, None, true, ahora()).unwrap();
        assert_eq!(r2.evento.estado, "descartado");
    }

    #[test]
    fn enfriamiento_no_registra_nada_y_un_carril_apagado_tampoco() {
        let c = db();
        let cr = carril(Sentido::Entrada);
        decidir_y_registrar(&c, &cr, &lectura(Some("P123ABC")), true);
        let (d, e) = decidir_y_registrar(&c, &cr, &lectura(Some("P123ABC")), true);
        assert_eq!(d, Decision::Ignorar { motivo: "enfriamiento" });
        assert!(e.is_none());
        assert_eq!(cola(&c).len(), 1, "un solo acceso por la misma placa en 60 s");
        let (d2, e2) = decidir_y_registrar(&c, &Carril { id: "otro".into(), modo: Modo::Apagado, ..cr }, &lectura(Some("P123ABC")), true);
        assert!(matches!(d2, Decision::Ignorar { .. }) && e2.is_none());
    }

    #[test]
    fn empresa_suspendida_queda_en_verificacion_y_nada_se_encola() {
        let c = db();
        let (d, e) = decidir_y_registrar(&c, &carril(Sentido::Entrada), &lectura(Some("P123ABC")), false);
        assert!(!d.abre());
        assert_eq!(e.unwrap().motivo.as_deref(), Some("licencia_bloqueada"));
        assert!(cola(&c).is_empty());
    }

    #[test]
    fn reintentos_sin_red_conservan_el_mismo_id_cliente_hasta_sincronizar() {
        let c = db();
        let (_, e) = decidir_y_registrar(&c, &carril(Sentido::Entrada), &lectura(Some("P123ABC")), true);
        let id = e.unwrap().id_cliente.unwrap();
        // Dos fallas de red seguidas (la cola reprograma) y luego el envío entra: siempre el mismo id_cliente y el mismo payload.
        let payload0: String = c.query_row("SELECT payload FROM accesos_pendientes WHERE id_cliente = ?1", [&id], |r| r.get(0)).unwrap();
        crate::sync::programar_reintento(&c, &id, 0, "sin conexión", ahora()).unwrap();
        crate::sync::programar_reintento(&c, &id, 1, "sin conexión", ahora()).unwrap();
        let (intentos, payload1): (i64, String) = c.query_row("SELECT intentos, payload FROM accesos_pendientes WHERE id_cliente = ?1", [&id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((intentos, &payload1), (2, &payload0));
        assert!(evidencias_por_subir(&c, ahora(), 10).unwrap().is_empty(), "la evidencia espera a que el acceso esté en el servidor");
        crate::sync::marcar_sincronizado(&c, &id, Some("reg-1")).unwrap();
        let por_subir = evidencias_por_subir(&c, ahora(), 10).unwrap();
        assert_eq!(por_subir.len(), 2);
        assert!(por_subir.iter().all(|x| x.id_cliente == id && x.jpeg == JPEG));
        marcar_evidencia(&c, &por_subir[0].evento_id, &por_subir[0].tipo, 1).unwrap();
        assert_eq!(evidencias_por_subir(&c, ahora(), 10).unwrap().len(), 1);
    }

    #[test]
    fn la_evidencia_se_purga_a_los_7_dias_y_los_eventos_resueltos_tambien() {
        let c = db();
        let (_, e) = decidir_y_registrar(&c, &carril(Sentido::Entrada), &lectura(Some("P123ABC")), true);
        let (_, pendiente) = decidir_y_registrar(&c, &carril(Sentido::Entrada), &lectura(None), true);
        let e = e.unwrap();
        assert_eq!(purgar(&c, ahora() + Duration::days(6)).unwrap(), (0, 0));
        let (evid, evs) = purgar(&c, ahora() + Duration::days(8)).unwrap();
        assert_eq!((evid, evs), (4, 1), "las 4 imágenes vencieron; el evento automático se borra, el pendiente no");
        assert!(obtener(&c, &e.id).unwrap().is_none());
        assert!(obtener(&c, &pendiente.unwrap().id).unwrap().is_some());
        assert_eq!(evidencia(&c, &e.id, "placa").unwrap(), None);
    }

    #[test]
    fn una_evidencia_que_no_es_jpeg_o_es_enorme_se_descarta_sin_romper_el_registro() {
        let c = db();
        let mut l = lectura(Some("P123ABC"));
        l.evidencia.placa_jpeg = Some(base64::engine::general_purpose::STANDARD.encode(b"no soy un jpeg"));
        l.evidencia.vehiculo_jpeg = Some(base64::engine::general_purpose::STANDARD.encode(vec![0xffu8; MAX_EVIDENCIA_BYTES + 1]));
        let (_, e) = decidir_y_registrar(&c, &carril(Sentido::Entrada), &l, true);
        let e = e.unwrap();
        assert!(!e.evidencia_placa && !e.evidencia_vehiculo);
        assert_eq!(e.estado, "automatico");
    }

    #[test]
    fn la_falla_del_actuador_queda_en_el_evento_y_en_la_bitacora_sin_tocar_el_acceso() {
        let c = db();
        let (_, e) = decidir_y_registrar(&c, &carril(Sentido::Entrada), &lectura(Some("P123ABC")), true);
        let e = e.unwrap();
        marcar_apertura(&c, &e.id, &Err("El relé no respondió".into()), ahora()).unwrap();
        let ev = obtener(&c, &e.id).unwrap().unwrap();
        assert_eq!(ev.apertura.as_deref(), Some("fallo: El relé no respondió"));
        let q = cola(&c);
        assert_eq!(q.len(), 2);
        assert_eq!(q.iter().filter(|f| f.1 == RUTA_ACCESO).count(), 1, "el acceso sigue ahí, pendiente de subir");
        assert_eq!(q.iter().find(|f| f.1 == RUTA_EVENTO).unwrap().2["tipo"], "actuador_fallo");
        marcar_apertura(&c, &e.id, &Ok(true), ahora()).unwrap();
        assert_eq!(obtener(&c, &e.id).unwrap().unwrap().apertura.as_deref(), Some("simulada"));
    }

    #[test]
    fn la_lista_pone_primero_lo_pendiente() {
        let c = db();
        let cr = carril(Sentido::Entrada);
        decidir_y_registrar(&c, &cr, &lectura(None), true);
        decidir_y_registrar(&c, &Carril { id: "b".into(), ..cr.clone() }, &lectura(Some("P123ABC")), true);
        let l = listar(&c, 10).unwrap();
        assert_eq!(l.len(), 2);
        assert!(l[0].pendiente() && !l[1].pendiente());
        let _ = Hechos::default();
    }

    #[test]
    fn la_copia_de_vehiculos_se_reemplaza_completa_o_por_cambios() {
        let c = db();
        let v = aplicar_vehiculos(&c, &json!({"modo": "completo", "version": "20", "filas": [
            {"id": "a", "placa": "p-111 aaa", "residente_id": "r1", "numero_casa": "A-1", "residente_nombre": "Ana", "vigente_desde": "2026-01-01", "vigente_hasta": null, "activo": true, "en_lista_negra": false, "version": "19"},
            {"id": "b", "placa": "P222BBB", "residente_id": "r1", "vigente_desde": "2026-01-01T06:00:00.000Z", "vigente_hasta": "2026-12-31", "activo": true, "en_lista_negra": true, "version": "20"}
        ]})).unwrap();
        assert_eq!(v.as_deref(), Some("20"));
        let n: i64 = c.query_row("SELECT count(*) FROM vehiculos_autorizados_local", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 2, "el modo completo borró el v1 sembrado");
        let a = decision::vehiculo_por_placa(&c, "P111AAA").unwrap().unwrap();
        assert_eq!((a.placa.as_str(), a.vigente_desde.as_str()), ("P111AAA", "2026-01-01"));
        assert!(decision::vehiculo_por_placa(&c, "P222BBB").unwrap().unwrap().en_lista_negra);
        // Cambios: «a» se da de baja (se borra) y llega «c».
        aplicar_vehiculos(&c, &json!({"modo": "cambios", "version": "22", "filas": [
            {"id": "a", "placa": "P111AAA", "residente_id": "r1", "vigente_desde": "2026-01-01", "activo": false, "version": "21"},
            {"id": "c", "placa": "P333CCC", "residente_id": "r1", "vigente_desde": "2026-01-01", "activo": true, "en_lista_negra": false, "version": "22"}
        ]})).unwrap();
        assert!(decision::vehiculo_por_placa(&c, "P111AAA").unwrap().is_none());
        assert!(decision::vehiculo_por_placa(&c, "P333CCC").unwrap().is_some());
        assert_eq!(crate::db::meta_leer(&c, "vehiculos_version").unwrap().as_deref(), Some("22"));
        // Un servidor sin vehículos no toca la copia.
        assert_eq!(aplicar_vehiculos(&c, &Value::Null).unwrap(), None);
        assert!(decision::vehiculo_por_placa(&c, "P333CCC").unwrap().is_some());
    }
}
