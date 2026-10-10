//! Sincronización con el backend.
//!
//! - **Pull** (`pull`): trae residentes / blacklist / preautorizaciones de la
//!   sucursal y reemplaza el espejo local. Periódico + al arrancar + a mano.
//! - **Push** (`push_pendientes`): sube la cola `accesos_pendientes` con
//!   backoff exponencial. Un 2xx marca la fila como sincronizada (se conserva
//!   unos días como respaldo y luego `purgar` la elimina); un 4xx de negocio
//!   (blacklist, residente inexistente…) la marca `rechazado` y no se
//!   reintenta: el agente lo ve en la lista con el motivo.
//! - **Heartbeat** de licencia, en su propio bucle.
//!
//! Regla de oro: ningún bucle retiene el mutex de la BD mientras espera la
//! red. Se lee, se suelta, se llama, se vuelve a tomar para escribir.

use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::api::Credenciales;
use crate::error::{AppError, AppResult};
use crate::garita::con_db;
use crate::{auth, db, license, AppState};

pub const EVENTO_ESTADO: &str = "sg://estado";
const PULL_CADA_SEG: u64 = 5 * 60;
const PUSH_CADA_SEG: u64 = 30;
const RETENCION_SINCRONIZADOS_DIAS: i64 = 7;
const BACKOFF_BASE_SEG: i64 = 5;
const BACKOFF_MAX_SEG: i64 = 10 * 60;

/// Espera antes del reintento número `intentos` (1 = primer reintento):
/// 5 s, 10 s, 20 s, … con tope de 10 min.
pub fn backoff(intentos: u32) -> Duration {
    let exp = intentos.saturating_sub(1).min(20);
    let seg = (BACKOFF_BASE_SEG.saturating_mul(1i64 << exp)).min(BACKOFF_MAX_SEG);
    Duration::seconds(seg)
}

#[derive(Debug, Clone, Serialize)]
pub struct EstadoSync {
    pub en_linea: bool,
    pub ultima_sync_ok: Option<DateTime<Utc>>,
    pub ultimo_push_ok: Option<DateTime<Utc>>,
    pub pendientes: i64,
    pub rechazados: i64,
    pub ultimo_error: Option<String>,
    pub sincronizando: bool,
}

// ── Pull ────────────────────────────────────────────────────────────────────

fn parsear_fecha(v: &Value) -> Option<String> {
    v.as_str().map(|s| s.to_string())
}

fn aplicar_snapshot(conn: &Connection, snap: &Value) -> AppResult<(usize, usize, usize)> {
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch("DELETE FROM residentes_local; DELETE FROM blacklist_local; DELETE FROM preautorizaciones_local;")?;

    let residentes = snap["residentes"].as_array().cloned().unwrap_or_default();
    for r in &residentes {
        tx.execute(
            "INSERT INTO residentes_local (id, numero_casa, nombre, estado_pago, telefono) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                r["id"].as_str().unwrap_or_default(),
                r["numero_casa"].as_str().unwrap_or_default(),
                r["nombre"].as_str().unwrap_or_default(),
                r["estado_pago"].as_str().unwrap_or("al_dia"),
                r["telefono"].as_str(),
            ],
        )?;
    }
    let blacklist = snap["blacklist"].as_array().cloned().unwrap_or_default();
    for b in &blacklist {
        // Un bloqueo solo de vehículo no trae DPI: se guarda '' y la evaluación local
        // nunca lo compara contra un DPI vacío (ver `garita::evaluar_visitante`).
        let placa = b["placa"].as_str().map(crate::placa::normalizar).filter(|p| !p.is_empty());
        tx.execute(
            "INSERT INTO blacklist_local (id, numero_dpi, visitante_nombre, razon, fecha_fin, residente_id, placa)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                b["id"].as_str().unwrap_or_default(),
                b["numero_dpi"].as_str().unwrap_or_default(),
                b["visitante_nombre"].as_str(),
                b["razon"].as_str().unwrap_or_default(),
                parsear_fecha(&b["fecha_fin"]),
                b["residente_id"].as_str(),
                placa,
            ],
        )?;
    }
    let pre = snap["preautorizaciones"].as_array().cloned().unwrap_or_default();
    for p in &pre {
        // fecha_inicio/fecha_fin vienen como ISO con hora ("2026-09-01T06:00:00.000Z")
        // o como DATE; se guarda sólo YYYY-MM-DD para comparar por día.
        let dia = |v: &Value| v.as_str().map(|s| s.chars().take(10).collect::<String>());
        tx.execute(
            "INSERT INTO preautorizaciones_local (id, residente_id, nombre_visitante, numero_dpi, placa, fecha_inicio, fecha_fin)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                p["id"].as_str().unwrap_or_default(),
                p["residente_id"].as_str().unwrap_or_default(),
                p["nombre_visitante"].as_str().unwrap_or_default(),
                p["numero_dpi"].as_str(),
                // Canónica (P123ABC) aunque el servidor tenga filas viejas con guion o en minúsculas.
                p["placa"].as_str().map(crate::placa::normalizar).filter(|x| !x.is_empty()),
                dia(&p["fecha_inicio"]).unwrap_or_default(),
                dia(&p["fecha_fin"]),
            ],
        )?;
    }
    db::meta_escribir(&tx, "ultima_sync_ok", &Utc::now().to_rfc3339())?;
    tx.commit()?;
    Ok((residentes.len(), blacklist.len(), pre.len()))
}

pub async fn pull(state: &AppState) -> AppResult<(usize, usize, usize)> {
    let (jwt, lic) = auth::credenciales(state).await?;
    let base = state.api_url();
    let cred = Credenciales { jwt: Some(&jwt), licencia: Some(&lic) };
    let snap: Value = match state.api.get(&base, "/sync/garita", &cred).await {
        Ok(v) => v,
        Err(e) => {
            registrar_error_red(state, &e);
            return Err(e);
        }
    };
    state.marcar_conexion(true);
    let n = con_db(state, |c| aplicar_snapshot(c, &snap))?;
    log::info!("pull OK: {} residentes, {} blacklist, {} preautorizaciones", n.0, n.1, n.2);
    Ok(n)
}

// ── Push ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct Pendiente {
    id_cliente: String,
    payload: String,
    intentos: i64,
}

fn pendientes_vencidos(conn: &Connection, ahora: &str, limite: usize) -> AppResult<Vec<Pendiente>> {
    let mut st = conn.prepare(
        "SELECT id_cliente, payload, intentos FROM accesos_pendientes
         WHERE estado = 'pendiente' AND (proximo_intento_en IS NULL OR proximo_intento_en <= ?1)
         ORDER BY registrado_en ASC LIMIT ?2",
    )?;
    let rows = st.query_map(params![ahora, limite as i64], |r| {
        Ok(Pendiente { id_cliente: r.get(0)?, payload: r.get(1)?, intentos: r.get(2)? })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn marcar_sincronizado(conn: &Connection, id_cliente: &str, registro_id: Option<&str>) -> AppResult<()> {
    conn.execute(
        "UPDATE accesos_pendientes SET estado = 'sincronizado', sincronizado_en = ?2, registro_id = ?3, ultimo_error = NULL
         WHERE id_cliente = ?1",
        params![id_cliente, Utc::now().to_rfc3339(), registro_id],
    )?;
    Ok(())
}

pub fn marcar_rechazado(conn: &Connection, id_cliente: &str, error: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE accesos_pendientes SET estado = 'rechazado', ultimo_error = ?2 WHERE id_cliente = ?1",
        params![id_cliente, error],
    )?;
    Ok(())
}

pub fn programar_reintento(conn: &Connection, id_cliente: &str, intentos_previos: i64, error: &str, ahora: DateTime<Utc>) -> AppResult<()> {
    let intentos = intentos_previos + 1;
    let proximo = ahora + backoff(intentos as u32);
    conn.execute(
        "UPDATE accesos_pendientes SET intentos = ?2, proximo_intento_en = ?3, ultimo_error = ?4 WHERE id_cliente = ?1",
        params![id_cliente, intentos, proximo.to_rfc3339(), error],
    )?;
    Ok(())
}

/// Sincronizados de hace más de N días se purgan; pendientes y rechazados se
/// conservan siempre (los rechazados son evidencia para el admin).
pub fn purgar(conn: &Connection, ahora: DateTime<Utc>) -> AppResult<usize> {
    let limite = (ahora - Duration::days(RETENCION_SINCRONIZADOS_DIAS)).to_rfc3339();
    Ok(conn.execute(
        "DELETE FROM accesos_pendientes WHERE estado = 'sincronizado' AND sincronizado_en < ?1",
        [limite],
    )?)
}

/// Clasifica el resultado de un POST para decidir qué hacer con la fila.
pub enum Desenlace {
    Sincronizado(Option<String>),
    Rechazado(String),
    Reintentar(String),
    /// La red o la sesión fallaron: no tiene sentido seguir con la cola ahora.
    Detener(AppError),
}

pub fn clasificar(resultado: Result<Value, AppError>) -> Desenlace {
    match resultado {
        Ok(v) => Desenlace::Sincronizado(v["registro"]["id"].as_str().map(str::to_string)),
        Err(e) if e.es_sin_conexion() => Desenlace::Detener(e),
        Err(e) if e.codigo == "licencia_revocada" || e.codigo == "licencia_invalida" || e.codigo == "licencia_bloqueada" => Desenlace::Detener(e),
        Err(e) if e.codigo == "no_autorizado" || e.codigo == "sesion_vencida" || e.codigo == "sin_sesion" => Desenlace::Detener(e),
        Err(e) if e.codigo == "demasiadas_solicitudes" => Desenlace::Reintentar(e.mensaje),
        Err(e) if matches!(e.status, Some(s) if (400..500).contains(&s)) => Desenlace::Rechazado(e.mensaje),
        Err(e) => Desenlace::Reintentar(e.mensaje),
    }
}

pub async fn push_pendientes(state: &AppState) -> AppResult<usize> {
    let _guard = match state.push_lock.try_lock() {
        Ok(g) => g,
        Err(_) => return Ok(0), // ya hay un push en curso
    };
    let ahora = Utc::now();
    let lote = con_db(state, |c| pendientes_vencidos(c, &ahora.to_rfc3339(), 50))?;
    if lote.is_empty() {
        con_db(state, |c| purgar(c, ahora))?;
        return Ok(0);
    }
    let (jwt, lic) = auth::credenciales(state).await?;
    let base = state.api_url();
    let cred = Credenciales { jwt: Some(&jwt), licencia: Some(&lic) };

    let mut subidos = 0;
    for p in lote {
        let body: Value = serde_json::from_str(&p.payload)?;
        let resultado = state.api.post::<Value>(&base, "/accesos", &body, &cred).await;
        match clasificar(resultado) {
            Desenlace::Sincronizado(id) => {
                con_db(state, |c| marcar_sincronizado(c, &p.id_cliente, id.as_deref()))?;
                subidos += 1;
                state.marcar_conexion(true);
                *state.ultimo_push_ok.write().unwrap() = Some(Utc::now());
            }
            Desenlace::Rechazado(msg) => {
                log::warn!("acceso {} rechazado por el backend: {msg}", p.id_cliente);
                con_db(state, |c| marcar_rechazado(c, &p.id_cliente, &msg))?;
                state.marcar_conexion(true);
            }
            Desenlace::Reintentar(msg) => {
                con_db(state, |c| programar_reintento(c, &p.id_cliente, p.intentos, &msg, Utc::now()))?;
            }
            Desenlace::Detener(e) => {
                registrar_error_red(state, &e);
                con_db(state, |c| programar_reintento(c, &p.id_cliente, p.intentos, &e.mensaje, Utc::now()))?;
                return Err(e);
            }
        }
    }
    con_db(state, |c| purgar(c, ahora))?;
    Ok(subidos)
}

fn registrar_error_red(state: &AppState, e: &AppError) {
    if e.es_sin_conexion() {
        state.marcar_conexion(false);
    }
    *state.ultimo_error.write().unwrap() = Some(e.mensaje.clone());
}

// ── Estado para la UI ───────────────────────────────────────────────────────

pub fn estado(state: &AppState) -> EstadoSync {
    let (ultima, pendientes, rechazados) = con_db(state, |c| {
        let ultima = db::meta_leer(c, "ultima_sync_ok")?
            .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
            .map(|d| d.with_timezone(&Utc));
        let pendientes: i64 =
            c.query_row("SELECT count(*) FROM accesos_pendientes WHERE estado = 'pendiente'", [], |r| r.get(0))?;
        let rechazados: i64 =
            c.query_row("SELECT count(*) FROM accesos_pendientes WHERE estado = 'rechazado'", [], |r| r.get(0))?;
        Ok((ultima, pendientes, rechazados))
    })
    .unwrap_or((None, 0, 0));
    EstadoSync {
        en_linea: state.en_linea.load(std::sync::atomic::Ordering::Relaxed),
        ultima_sync_ok: ultima,
        ultimo_push_ok: *state.ultimo_push_ok.read().unwrap(),
        pendientes,
        rechazados,
        ultimo_error: state.ultimo_error.read().unwrap().clone(),
        sincronizando: state.push_lock.try_lock().is_err(),
    }
}

pub fn emitir_estado(app: &AppHandle) {
    let state = app.state::<AppState>();
    let _ = app.emit(EVENTO_ESTADO, estado(&state));
}

// ── Tareas en segundo plano ─────────────────────────────────────────────────

/// Un push inmediato (tras registrar un acceso). No espera.
pub fn disparar_push(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        if let Err(e) = push_pendientes(&state).await {
            log::info!("push inmediato sin completar: {}", e.mensaje);
        }
        emitir_estado(&app);
    });
}

pub fn iniciar_tareas(app: AppHandle) {
    // Heartbeat de licencia. El intervalo lo dicta el servidor; entre tanto
    // usamos el guardado (o 15 min).
    {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let state = app.state::<AppState>();
                let minutos = state.licencia.read().unwrap().as_ref().map(|l| l.heartbeat_intervalo_min).unwrap_or(15);
                if state.licencia.read().unwrap().is_some() {
                    match license::heartbeat(&state).await {
                        Ok(e) => log::debug!("heartbeat → {e:?}"),
                        Err(e) => log::info!("heartbeat error: {}", e.mensaje),
                    }
                    emitir_estado(&app);
                }
                tokio::time::sleep(std::time::Duration::from_secs(u64::from(minutos.max(1)) * 60)).await;
            }
        });
    }
    // Pull del espejo local.
    {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let state = app.state::<AppState>();
                if state.db.lock().unwrap().is_some() {
                    if let Err(e) = pull(&state).await {
                        log::info!("pull sin completar: {}", e.mensaje);
                    }
                    emitir_estado(&app);
                }
                tokio::time::sleep(std::time::Duration::from_secs(PULL_CADA_SEG)).await;
            }
        });
    }
    // Push de la cola.
    tauri::async_runtime::spawn(async move {
        loop {
            let state = app.state::<AppState>();
            if state.db.lock().unwrap().is_some() {
                match push_pendientes(&state).await {
                    Ok(n) if n > 0 => {
                        log::info!("push: {n} accesos sincronizados");
                        emitir_estado(&app);
                    }
                    Ok(_) => {}
                    Err(e) => {
                        log::info!("push sin completar: {}", e.mensaje);
                        emitir_estado(&app);
                    }
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(PUSH_CADA_SEG)).await;
        }
    });
}

// ── Comandos Tauri ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn sync_estado(state: State<'_, AppState>) -> EstadoSync {
    estado(&state)
}

#[tauri::command]
pub async fn sync_ahora(app: AppHandle, state: State<'_, AppState>) -> AppResult<EstadoSync> {
    let r_pull = pull(&state).await;
    let r_push = push_pendientes(&state).await;
    emitir_estado(&app);
    r_pull?;
    r_push?;
    Ok(estado(&state))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn db_con_pendientes(n: usize) -> Connection {
        let c = Connection::open_in_memory().unwrap();
        db::aplicar_esquema(&c).unwrap();
        for i in 0..n {
            c.execute(
                "INSERT INTO accesos_pendientes (id_cliente, payload, registrado_en, nombre_visitante, numero_dpi)
                 VALUES (?1, '{}', ?2, 'V', '1')",
                params![format!("id-{i}"), format!("2026-09-19T10:0{i}:00Z")],
            )
            .unwrap();
        }
        c
    }

    #[test]
    fn backoff_exponencial_con_tope() {
        assert_eq!(backoff(1), Duration::seconds(5));
        assert_eq!(backoff(2), Duration::seconds(10));
        assert_eq!(backoff(3), Duration::seconds(20));
        assert_eq!(backoff(8), Duration::seconds(600), "5·2^7 = 640 → tope 600");
        assert_eq!(backoff(40), Duration::seconds(600), "no desborda");
        assert_eq!(backoff(0), Duration::seconds(5));
    }

    #[test]
    fn los_pendientes_salen_en_orden_y_respetan_proximo_intento() {
        let c = db_con_pendientes(3);
        let lote = pendientes_vencidos(&c, "2026-09-19T12:00:00Z", 10).unwrap();
        assert_eq!(lote.iter().map(|p| p.id_cliente.as_str()).collect::<Vec<_>>(), ["id-0", "id-1", "id-2"]);

        programar_reintento(&c, "id-1", 0, "timeout", "2026-09-19T12:00:00Z".parse().unwrap()).unwrap();
        // 5 s después aún no toca; 6 s después sí.
        let l1 = pendientes_vencidos(&c, "2026-09-19T12:00:04Z", 10).unwrap();
        assert!(!l1.iter().any(|p| p.id_cliente == "id-1"));
        let l2 = pendientes_vencidos(&c, "2026-09-19T12:00:06Z", 10).unwrap();
        assert!(l2.iter().any(|p| p.id_cliente == "id-1" && p.intentos == 1));
    }

    #[test]
    fn sincronizado_se_conserva_y_se_purga_a_los_7_dias() {
        let c = db_con_pendientes(2);
        marcar_sincronizado(&c, "id-0", Some("reg-1")).unwrap();
        let ahora = Utc::now();
        assert_eq!(purgar(&c, ahora).unwrap(), 0, "recién sincronizado: se conserva");
        let n: i64 = c.query_row("SELECT count(*) FROM accesos_pendientes", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 2);
        assert_eq!(purgar(&c, ahora + Duration::days(8)).unwrap(), 1);
        // El pendiente nunca se purga.
        let n: i64 = c.query_row("SELECT count(*) FROM accesos_pendientes WHERE estado='pendiente'", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn rechazado_no_vuelve_a_la_cola() {
        let c = db_con_pendientes(1);
        marcar_rechazado(&c, "id-0", "Visitante en blacklist").unwrap();
        assert!(pendientes_vencidos(&c, "2099-01-01T00:00:00Z", 10).unwrap().is_empty());
        assert_eq!(purgar(&c, Utc::now() + Duration::days(30)).unwrap(), 0, "los rechazados se conservan");
    }

    #[test]
    fn clasificacion_de_respuestas() {
        assert!(matches!(clasificar(Ok(json!({"registro": {"id": "r1"}}))), Desenlace::Sincronizado(Some(id)) if id == "r1"));
        assert!(matches!(clasificar(Ok(json!({"registro": {"id": "r1"}, "duplicado": true}))), Desenlace::Sincronizado(_)),
            "un duplicado idempotente cuenta como sincronizado");
        assert!(matches!(clasificar(Err(AppError::sin_conexion("x"))), Desenlace::Detener(_)));
        assert!(matches!(clasificar(Err(AppError::http(403, "licencia_revocada", "x"))), Desenlace::Detener(_)));
        assert!(matches!(clasificar(Err(AppError::http(401, "no_autorizado", "x"))), Desenlace::Detener(_)));
        assert!(matches!(clasificar(Err(AppError::http(403, "prohibido", "Visitante en blacklist"))), Desenlace::Rechazado(_)));
        assert!(matches!(clasificar(Err(AppError::http(404, "no_encontrado", "Residente no encontrado"))), Desenlace::Rechazado(_)));
        assert!(matches!(clasificar(Err(AppError::http(429, "demasiadas_solicitudes", "x"))), Desenlace::Reintentar(_)));
        assert!(matches!(clasificar(Err(AppError::http(500, "servidor", "x"))), Desenlace::Reintentar(_)));
    }

    #[test]
    fn el_snapshot_reemplaza_el_espejo_y_normaliza_fechas() {
        let c = Connection::open_in_memory().unwrap();
        db::aplicar_esquema(&c).unwrap();
        c.execute("INSERT INTO residentes_local VALUES ('viejo','Z-9','Viejo','al_dia',NULL)", []).unwrap();
        let snap = json!({
            "residentes": [{"id": "r1", "numero_casa": "A-1", "nombre": "Ana", "estado_pago": "mora", "telefono": null}],
            "blacklist": [
                {"id": "b1", "numero_dpi": "123", "visitante_nombre": "X", "razon": "R", "fecha_fin": null, "residente_id": null, "placa": null},
                {"id": "b2", "numero_dpi": null, "visitante_nombre": null, "razon": "Vehículo", "fecha_fin": null, "residente_id": null, "placa": "p-123 abc"}
            ],
            "preautorizaciones": [{"id": "p1", "residente_id": "r1", "nombre_visitante": "P", "numero_dpi": "9",
                                   "placa": "p-123 abc", "fecha_inicio": "2026-09-01T06:00:00.000Z", "fecha_fin": "2026-09-30T06:00:00.000Z"}]
        });
        assert_eq!(aplicar_snapshot(&c, &snap).unwrap(), (1, 2, 1));
        let ids: Vec<String> = c.prepare("SELECT id FROM residentes_local").unwrap()
            .query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
        assert_eq!(ids, ["r1"], "el residente viejo desapareció");
        let fin: String = c.query_row("SELECT fecha_fin FROM preautorizaciones_local", [], |r| r.get(0)).unwrap();
        assert_eq!(fin, "2026-09-30");
        // La placa de la preautorización se guarda canónica aunque el servidor la tenga con guion o en minúsculas.
        let pre_placa: String = c.query_row("SELECT placa FROM preautorizaciones_local WHERE id = 'p1'", [], |r| r.get(0)).unwrap();
        assert_eq!(pre_placa, "P123ABC");
        // El bloqueo solo de vehículo llega con DPI vacío y la placa normalizada.
        let (dpi, placa): (String, Option<String>) = c
            .query_row("SELECT numero_dpi, placa FROM blacklist_local WHERE id = 'b2'", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!((dpi.as_str(), placa.as_deref()), ("", Some("P123ABC")));
        assert!(db::meta_leer(&c, "ultima_sync_ok").unwrap().is_some());
    }
}
