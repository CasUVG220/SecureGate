//! Base de datos local cifrada en reposo.
//!
//! Motor: SQLite + **SQLCipher** (rusqlite con
//! `bundled-sqlcipher-vendored-openssl`): AES-256-CBC por página, HMAC-SHA512,
//! compilado dentro del binario. Es el estándar de facto para SQLite cifrado
//! y no depende de nada instalado en la PC.
//!
//! Clave: 32 bytes derivados con **Argon2id** (64 MiB, 3 iteraciones) a
//! partir de `fingerprint || token_de_licencia`, con una sal aleatoria por
//! instalación guardada en el almacén seguro. Se pasa a SQLCipher como clave
//! cruda (`PRAGMA key = "x'…'"`), así SQLCipher no vuelve a derivarla con su
//! PBKDF2. Consecuencias:
//! - Sin la licencia (revocada, borrada) o en otra máquina (fingerprint
//!   distinto), el archivo no se abre. Es lo que se quiere.
//! - Al reactivar (token nuevo) se hace `PRAGMA rekey` con la clave nueva
//!   mientras la vieja aún está disponible; nada se pierde.
//!
//! Nunca se hardcodea nada de la clave.

use argon2::{Algorithm, Argon2, Params, Version};
use rusqlite::{Connection, OpenFlags};
use sha2::{Digest, Sha256};
use std::path::Path;

use crate::error::{AppError, AppResult};

pub const NOMBRE_ARCHIVO: &str = "garita.db";

/// Clave de 32 bytes para SQLCipher. Determinista para (fingerprint, token, sal).
pub fn derivar_clave(fingerprint: &str, token_licencia: &str, sal: &[u8]) -> AppResult<[u8; 32]> {
    // El token es un JWT largo; se compacta con SHA-256 para que el "password"
    // de Argon2 tenga tamaño fijo. No aporta seguridad extra, sólo uniformidad.
    let mut secreto = Vec::with_capacity(fingerprint.len() + 33);
    secreto.extend_from_slice(fingerprint.as_bytes());
    secreto.push(b'|');
    secreto.extend_from_slice(&Sha256::digest(token_licencia.as_bytes()));

    let params = Params::new(64 * 1024, 3, 1, Some(32))
        .map_err(|e| AppError::interno(format!("argon2 params: {e}")))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut clave = [0u8; 32];
    argon
        .hash_password_into(&secreto, sal, &mut clave)
        .map_err(|e| AppError::interno(format!("argon2: {e}")))?;
    Ok(clave)
}

fn pragma_key(clave: &[u8; 32]) -> String {
    format!("x'{}'", hex::encode(clave))
}

/// Abre (o crea) la BD con la clave dada y aplica el esquema. Falla con
/// `db_clave` si el archivo existe pero la clave no lo descifra.
pub fn abrir(ruta: &Path, clave: &[u8; 32]) -> AppResult<Connection> {
    if let Some(dir) = ruta.parent() {
        std::fs::create_dir_all(dir).map_err(|e| AppError::interno(e.to_string()))?;
    }
    let conn = Connection::open_with_flags(
        ruta,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    conn.pragma_update(None, "key", pragma_key(clave))?;
    // Primera lectura: con la clave equivocada SQLCipher devuelve
    // "file is not a database" aquí y no antes.
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |_| Ok(()))
        .map_err(|_| AppError::new("db_clave", "La base local no se puede descifrar con la licencia actual"))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    aplicar_esquema(&conn)?;
    Ok(conn)
}

/// Recifra el archivo con una clave nueva (reactivación de licencia).
pub fn recifrar(conn: &Connection, nueva: &[u8; 32]) -> AppResult<()> {
    conn.pragma_update(None, "rekey", pragma_key(nueva))?;
    Ok(())
}

/// `true` si las primeras páginas del archivo parecen SQLite en claro.
/// Nunca debe pasar; lo verifica el test de cifrado.
#[cfg(test)]
pub fn archivo_parece_plano(ruta: &Path) -> bool {
    std::fs::read(ruta)
        .map(|b| b.starts_with(b"SQLite format 3\0"))
        .unwrap_or(false)
}

/// Espejo simplificado del backend: sólo lo necesario para decidir un acceso
/// sin internet, más la cola de accesos por sincronizar. Idempotente.
pub fn aplicar_esquema(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS meta (
          clave TEXT PRIMARY KEY,
          valor TEXT
        );

        CREATE TABLE IF NOT EXISTS residentes_local (
          id          TEXT PRIMARY KEY,
          numero_casa TEXT NOT NULL,
          nombre      TEXT NOT NULL,
          estado_pago TEXT NOT NULL,
          telefono    TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_residentes_local_casa ON residentes_local(numero_casa);

        CREATE TABLE IF NOT EXISTS blacklist_local (
          id               TEXT PRIMARY KEY,
          numero_dpi       TEXT NOT NULL,
          visitante_nombre TEXT,
          razon            TEXT NOT NULL,
          fecha_fin        TEXT,
          residente_id     TEXT,
          placa            TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_blacklist_local_dpi ON blacklist_local(numero_dpi);

        CREATE TABLE IF NOT EXISTS preautorizaciones_local (
          id               TEXT PRIMARY KEY,
          residente_id     TEXT NOT NULL,
          nombre_visitante TEXT NOT NULL,
          numero_dpi       TEXT,
          placa            TEXT,
          fecha_inicio     TEXT NOT NULL,
          fecha_fin        TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_preaut_local_dpi   ON preautorizaciones_local(numero_dpi);
        CREATE INDEX IF NOT EXISTS idx_preaut_local_placa ON preautorizaciones_local(placa);

        -- Invitaciones QR de la sucursal (SCRUM-126): copia para validarlas SIN red. Se reemplaza completa en cada
        -- sincronización. `usos_actuales` es el que tenía el servidor al bajar la copia; los usos de ESTE equipo que el
        -- servidor aún no cuenta se suman al validar (ver `garita::usos_locales`). Las fechas son AAAA-MM-DD.
        CREATE TABLE IF NOT EXISTS invitaciones_qr_local (
          id               TEXT PRIMARY KEY,
          tipo             TEXT NOT NULL,
          etiqueta         TEXT,
          nombre_visitante TEXT,
          numero_dpi       TEXT,
          placa            TEXT,
          residente_id     TEXT NOT NULL,
          numero_casa      TEXT NOT NULL,
          residente_nombre TEXT NOT NULL,
          fecha_inicio     TEXT NOT NULL,
          fecha_fin        TEXT,
          usos_maximos     INTEGER,
          usos_actuales    INTEGER NOT NULL DEFAULT 0,
          activo           INTEGER NOT NULL DEFAULT 1,
          bloqueado_hasta  TEXT
        );

        -- Cola de sincronización. `payload` es el body exacto que se manda a
        -- POST /api/accesos (incluye registrado_en e id_cliente). Las columnas
        -- sueltas son sólo para listar en la UI sin parsear JSON.
        CREATE TABLE IF NOT EXISTS accesos_pendientes (
          id_cliente            TEXT PRIMARY KEY,
          payload               TEXT NOT NULL,
          registrado_en         TEXT NOT NULL,
          estado                TEXT NOT NULL DEFAULT 'pendiente'
                                  CHECK (estado IN ('pendiente', 'sincronizado', 'rechazado')),
          intentos              INTEGER NOT NULL DEFAULT 0,
          proximo_intento_en    TEXT,
          ultimo_error          TEXT,
          sincronizado_en       TEXT,
          registro_id           TEXT,
          nombre_visitante      TEXT NOT NULL,
          numero_dpi            TEXT NOT NULL,
          placa                 TEXT,
          residente_casa        TEXT,
          capturado_manualmente INTEGER NOT NULL DEFAULT 0,
          invitacion_qr_id      TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_pendientes_estado ON accesos_pendientes(estado, proximo_intento_en);

        -- Driver de talanquera de ESTE equipo (ver hardware/mod.rs). Una sola
        -- fila; `config` es el JSON etiquetado de ConfigHardware.
        CREATE TABLE IF NOT EXISTS config_hardware (
          id             INTEGER PRIMARY KEY CHECK (id = 1),
          config         TEXT NOT NULL,
          actualizado_en TEXT NOT NULL
        );
        "#,
    )?;
    migrar_blacklist_placa(conn)?;
    migrar_pendientes_invitacion_qr(conn)?;
    Ok(())
}

/// SCRUM-126: la cola guarda aparte la invitación QR de cada acceso (antes solo viajaba dentro de `payload`) para poder
/// contar cuántos usos de una invitación hizo ESTE equipo y el servidor aún no cuenta. En equipos con una base anterior la
/// columna no existe: se agrega y se rellena desde el `payload` de las filas que ya estaban, sin tocar nada más. Idempotente.
fn migrar_pendientes_invitacion_qr(conn: &Connection) -> AppResult<()> {
    let existe = conn
        .prepare("SELECT 1 FROM pragma_table_info('accesos_pendientes') WHERE name = 'invitacion_qr_id'")?
        .exists([])?;
    if !existe {
        conn.execute("ALTER TABLE accesos_pendientes ADD COLUMN invitacion_qr_id TEXT", [])?;
        // El JSON se lee en Rust (no con json_extract) para no depender de las extensiones con que se compiló SQLite.
        let filas: Vec<(String, String)> = {
            let mut st = conn.prepare("SELECT id_cliente, payload FROM accesos_pendientes")?;
            let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
            rows.collect::<Result<_, _>>()?
        };
        for (id_cliente, payload) in filas {
            let qr = serde_json::from_str::<serde_json::Value>(&payload)
                .ok()
                .and_then(|v| v["invitacion_qr_id"].as_str().map(|s| s.trim().to_lowercase()))
                .filter(|s| !s.is_empty());
            if let Some(qr) = qr {
                conn.execute("UPDATE accesos_pendientes SET invitacion_qr_id = ?2 WHERE id_cliente = ?1", [id_cliente, qr])?;
            }
        }
    }
    conn.execute("CREATE INDEX IF NOT EXISTS idx_pendientes_qr ON accesos_pendientes(invitacion_qr_id)", [])?;
    Ok(())
}

/// SCRUM-110: el espejo de la lista negra incluye ahora bloqueos por PLACA (sin
/// visitante). En equipos con una base anterior la columna no existe: se agrega sin
/// tocar nada más (el espejo se reemplaza completo en cada sincronización, así que
/// las filas viejas se rehacen solas en el siguiente pull). Idempotente.
fn migrar_blacklist_placa(conn: &Connection) -> AppResult<()> {
    let existe = conn
        .prepare("SELECT 1 FROM pragma_table_info('blacklist_local') WHERE name = 'placa'")?
        .exists([])?;
    if !existe {
        conn.execute("ALTER TABLE blacklist_local ADD COLUMN placa TEXT", [])?;
    }
    conn.execute("CREATE INDEX IF NOT EXISTS idx_blacklist_local_placa ON blacklist_local(placa)", [])?;
    Ok(())
}

pub fn meta_leer(conn: &Connection, clave: &str) -> AppResult<Option<String>> {
    let mut st = conn.prepare("SELECT valor FROM meta WHERE clave = ?1")?;
    let mut rows = st.query([clave])?;
    Ok(rows.next()?.map(|r| r.get(0)).transpose()?)
}

pub fn meta_escribir(conn: &Connection, clave: &str, valor: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO meta (clave, valor) VALUES (?1, ?2) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor",
        [clave, valor],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const FP: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const SAL: &[u8] = b"sal-de-prueba-16b";

    #[test]
    fn la_clave_es_determinista_y_sensible_a_cada_entrada() {
        let a = derivar_clave(FP, "token-A", SAL).unwrap();
        assert_eq!(a, derivar_clave(FP, "token-A", SAL).unwrap());
        assert_ne!(a, derivar_clave(FP, "token-B", SAL).unwrap(), "otro token → otra clave");
        assert_ne!(a, derivar_clave(&FP.replace('0', "1"), "token-A", SAL).unwrap(), "otra máquina → otra clave");
        assert_ne!(a, derivar_clave(FP, "token-A", b"otra-sal-distinta").unwrap());
    }

    #[test]
    fn el_archivo_en_disco_no_es_sqlite_en_claro() {
        let dir = tempfile::tempdir().unwrap();
        let ruta = dir.path().join(NOMBRE_ARCHIVO);
        let clave = derivar_clave(FP, "tok", SAL).unwrap();
        {
            let conn = abrir(&ruta, &clave).unwrap();
            conn.execute(
                "INSERT INTO residentes_local (id, numero_casa, nombre, estado_pago) VALUES ('r1','A-12','Ana','al_dia')",
                [],
            ).unwrap();
            // Forzar checkpoint del WAL para que el archivo principal tenga datos.
            conn.pragma_update(None, "wal_checkpoint", "TRUNCATE").unwrap();
        }
        assert!(!archivo_parece_plano(&ruta), "la cabecera 'SQLite format 3' no debe aparecer");
        let bytes = std::fs::read(&ruta).unwrap();
        assert!(!bytes.windows(3).any(|w| w == b"Ana"), "el contenido no debe ser legible en claro");
    }

    #[test]
    fn con_clave_equivocada_no_abre_y_con_la_correcta_conserva_datos() {
        let dir = tempfile::tempdir().unwrap();
        let ruta = dir.path().join(NOMBRE_ARCHIVO);
        let buena = derivar_clave(FP, "tok", SAL).unwrap();
        let mala = derivar_clave(FP, "otro", SAL).unwrap();
        {
            let conn = abrir(&ruta, &buena).unwrap();
            meta_escribir(&conn, "prueba", "42").unwrap();
        }
        let err = abrir(&ruta, &mala).unwrap_err();
        assert_eq!(err.codigo, "db_clave");
        let conn = abrir(&ruta, &buena).unwrap();
        assert_eq!(meta_leer(&conn, "prueba").unwrap().as_deref(), Some("42"));
    }

    #[test]
    fn recifrar_permite_abrir_solo_con_la_clave_nueva() {
        let dir = tempfile::tempdir().unwrap();
        let ruta = dir.path().join(NOMBRE_ARCHIVO);
        let vieja = derivar_clave(FP, "token-viejo", SAL).unwrap();
        let nueva = derivar_clave(FP, "token-nuevo", SAL).unwrap();
        {
            let conn = abrir(&ruta, &vieja).unwrap();
            meta_escribir(&conn, "k", "v").unwrap();
            recifrar(&conn, &nueva).unwrap();
        }
        assert_eq!(abrir(&ruta, &vieja).unwrap_err().codigo, "db_clave");
        let conn = abrir(&ruta, &nueva).unwrap();
        assert_eq!(meta_leer(&conn, "k").unwrap().as_deref(), Some("v"));
    }

    #[test]
    fn una_base_anterior_sin_columna_placa_se_migra_sin_perder_filas() {
        let conn = Connection::open_in_memory().unwrap();
        // Esquema de la versión anterior (sin `placa`).
        conn.execute_batch(
            "CREATE TABLE blacklist_local (
               id TEXT PRIMARY KEY, numero_dpi TEXT NOT NULL, visitante_nombre TEXT,
               razon TEXT NOT NULL, fecha_fin TEXT, residente_id TEXT);
             INSERT INTO blacklist_local VALUES ('b1','111','Malo','Robo',NULL,NULL);",
        ).unwrap();
        aplicar_esquema(&conn).unwrap();
        aplicar_esquema(&conn).unwrap(); // idempotente
        let (dpi, placa): (String, Option<String>) = conn
            .query_row("SELECT numero_dpi, placa FROM blacklist_local WHERE id = 'b1'", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(dpi, "111");
        assert_eq!(placa, None, "la fila anterior conserva su DPI y queda sin placa");
    }

    #[test]
    fn una_cola_anterior_sin_columna_de_invitacion_qr_se_migra_y_rellena_desde_el_payload() {
        let c = Connection::open_in_memory().unwrap();
        // Cola como la dejaba la versión anterior: sin `invitacion_qr_id`.
        c.execute_batch(
            "CREATE TABLE accesos_pendientes (
               id_cliente TEXT PRIMARY KEY, payload TEXT NOT NULL, registrado_en TEXT NOT NULL,
               estado TEXT NOT NULL DEFAULT 'pendiente', intentos INTEGER NOT NULL DEFAULT 0, proximo_intento_en TEXT,
               ultimo_error TEXT, sincronizado_en TEXT, registro_id TEXT, nombre_visitante TEXT NOT NULL,
               numero_dpi TEXT NOT NULL, placa TEXT, residente_casa TEXT, capturado_manualmente INTEGER NOT NULL DEFAULT 0);
             INSERT INTO accesos_pendientes (id_cliente, payload, registrado_en, nombre_visitante, numero_dpi)
               VALUES ('a', '{\"invitacion_qr_id\":\"  3F2A9C10-AAAA-4BBB-8CCC-0123456789AB \"}', '2026-10-10T10:00:00Z', 'V', '1'),
                      ('b', '{\"invitacion_qr_id\":null}', '2026-10-10T10:01:00Z', 'V', '2'),
                      ('c', 'esto no es json', '2026-10-10T10:02:00Z', 'V', '3');",
        )
        .unwrap();
        aplicar_esquema(&c).unwrap();
        let qr = |id: &str| -> Option<String> {
            c.query_row("SELECT invitacion_qr_id FROM accesos_pendientes WHERE id_cliente = ?1", [id], |r| r.get(0)).unwrap()
        };
        assert_eq!(qr("a").as_deref(), Some("3f2a9c10-aaaa-4bbb-8ccc-0123456789ab"), "se recorta y se pasa a minúsculas");
        assert_eq!(qr("b"), None);
        assert_eq!(qr("c"), None, "un payload ilegible no impide migrar");
        let filas: i64 = c.query_row("SELECT count(*) FROM accesos_pendientes", [], |r| r.get(0)).unwrap();
        assert_eq!(filas, 3, "no se pierde ninguna fila");
        aplicar_esquema(&c).unwrap();                      // idempotente
        assert_eq!(qr("a").as_deref(), Some("3f2a9c10-aaaa-4bbb-8ccc-0123456789ab"));
    }

    #[test]
    fn el_esquema_es_idempotente() {
        let conn = Connection::open_in_memory().unwrap();
        aplicar_esquema(&conn).unwrap();
        aplicar_esquema(&conn).unwrap();
        let n: i64 = conn
            .query_row("SELECT count(*) FROM sqlite_master WHERE type='table'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 7, "meta, residentes, blacklist, preautorizaciones, invitaciones_qr, accesos_pendientes, config_hardware");
    }
}
