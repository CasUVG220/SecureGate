//! ANPR continuo (Sprint 10): reconocimiento de placas en carriles con cámara IP fija. Diseño y barandas en
//! `docs/anpr_continuo.md`.
//!
//! Piezas: `carriles` (configuración por carril y pausa global, en el SQLCipher del equipo), `decision` (la regla, sin red),
//! `registro` (eventos locales, evidencia cifrada, cola offline, resolución del agente, purga a 7 días), `actuador` (barrera
//! simulada, relé HTTP o la talanquera del equipo), `motor` (el proceso del sidecar y un bucle por carril) y este módulo, que une
//! todo con Tauri: arranca y para los carriles, recibe las decisiones y avisa a la pantalla por el evento `sg://anpr`.
//!
//! El modo por clic no se toca: si el ANPR está pausado, apagado o caído, la garita sigue igual que antes.

pub mod actuador;
pub mod carriles;
pub mod decision;
pub mod motor;
pub mod registro;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Local, SecondsFormat, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::watch;

use crate::error::{AppError, AppResult};
use crate::garita::con_db;
use crate::AppState;
use carriles::{Carril, Modo};
use decision::{Decision, LecturaAnpr};
use motor::{ClienteAnpr, EstadoCarril, ProcesoLineas, Sumidero};
use registro::{EventoAnpr, Resolucion};

/// Evento Tauri hacia la pantalla.
pub const EVENTO: &str = "sg://anpr";

/// Instante en el formato de las tablas del ANPR (UTC, segundos, `Z`): se compara como texto.
pub fn instante(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(SecondsFormat::Secs, true)
}

/// Esquema local del ANPR (lo aplica `db::aplicar_esquema`).
pub fn esquema() -> String {
    format!("{}\n{}", carriles::ESQUEMA, registro::ESQUEMA)
}

/// Estado del ANPR dentro de `AppState`.
#[derive(Default)]
pub struct Anpr {
    cliente: tokio::sync::Mutex<Option<Arc<ClienteAnpr>>>,
    paradas: Mutex<HashMap<String, watch::Sender<bool>>>,
    estados: Mutex<HashMap<String, EstadoCarril>>,
    error: Mutex<Option<String>>,
}

impl Anpr {
    /// Para todos los carriles y termina el proceso (pausa, logout, cierre de la app).
    pub fn detener(&self) {
        for (_, tx) in self.paradas.lock().unwrap().drain() {
            let _ = tx.send(true);
        }
        if let Ok(mut c) = self.cliente.try_lock() {
            if let Some(c) = c.take() {
                c.terminar();
            }
        }
        self.estados.lock().unwrap().clear();
    }
}

#[derive(Serialize)]
pub struct EstadoAnpr {
    pub pausado: bool,
    pub proceso_activo: bool,
    pub error: Option<String>,
    pub carriles: Vec<CarrilConEstado>,
    /// Eventos que esperan al agente (verificaciones, alertas, ilegibles).
    pub pendientes: usize,
}

#[derive(Serialize)]
pub struct CarrilConEstado {
    #[serde(flatten)]
    pub carril: Carril,
    pub estado: EstadoCarril,
}

// ── Sumidero real: base local + actuador + pantalla ─────────────────────────────────────────────────────────

struct SumideroApp {
    app: AppHandle,
}

impl SumideroApp {
    fn emitir(&self, v: Value) {
        let _ = self.app.emit(EVENTO, v);
    }
}

/// Manda abrir en un hilo aparte (el relé puede tardar ~4 s) y deja el resultado en el evento.
fn abrir_en_segundo_plano(app: AppHandle, carril: Carril, evento_id: String) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        let talanquera = crate::hardware_cmd::driver(&state);
        let resultado: Result<bool, String> = match actuador::crear(&carril.actuador, talanquera) {
            Ok(a) => {
                let simulado = a.simulado();
                let a2 = a.clone();
                match tauri::async_runtime::spawn_blocking(move || a2.abrir()).await {
                    Ok(Ok(())) => Ok(simulado),
                    Ok(Err(e)) => Err(e),
                    Err(e) => Err(format!("hilo del actuador: {e}")),
                }
            }
            Err(e) => Err(e),
        };
        if let Err(e) = &resultado {
            log::warn!("anpr: el actuador del carril {} falló: {e}", carril.id);
        }
        let _ = con_db(&state, |c| registro::marcar_apertura(c, &evento_id, &resultado, Utc::now()));
        crate::sync::disparar_push(app.clone());
        let _ = app.emit(EVENTO, json!({
            "tipo": "apertura", "carril": carril.id, "evento_id": evento_id,
            "ok": resultado.is_ok(), "simulada": resultado.as_ref().ok().copied().unwrap_or(false), "error": resultado.err(),
        }));
    });
}

impl Sumidero for SumideroApp {
    fn fotograma(&self, carril: &Carril, r: &Value) {
        self.emitir(json!({
            "tipo": "fotograma", "carril": carril.id, "pistas": r["pistas"], "tamano": r["tamano"],
            "movimiento": r["movimiento"], "ms": r["ms"], "fps": r["fps_deseado"],
        }));
    }

    fn decision(&self, carril: &Carril, lectura: LecturaAnpr) {
        let state = self.app.state::<AppState>();
        let licencia_ok = crate::license::exigir_uso(&state).is_ok();
        let hoy = Local::now().format("%Y-%m-%d").to_string();
        let ahora = Utc::now();
        let r = con_db(&state, |c| {
            let h = decision::hechos(c, lectura.placa.as_deref(), &carril.id, &hoy, &instante(ahora), licencia_ok)?;
            let d = decision::decidir(carril.modo, &lectura, &h);
            let e = registro::registrar(c, carril, &lectura, &d, ahora)?;
            Ok((d, e))
        });
        match r {
            Ok((d, Some(evento))) => {
                let alerta = matches!(d, Decision::AlertaListaNegra { .. });
                self.emitir(json!({ "tipo": "evento", "carril": carril.id, "evento": evento, "alerta": alerta }));
                crate::sync::disparar_push(self.app.clone());
                if d.abre() {
                    abrir_en_segundo_plano(self.app.clone(), carril.clone(), evento.id.clone());
                }
            }
            Ok((_, None)) => {}
            Err(e) => log::error!("anpr: no se pudo registrar la decisión del carril {}: {}", carril.id, e.mensaje),
        }
    }

    fn estado(&self, carril: &Carril, estado: EstadoCarril) {
        let state = self.app.state::<AppState>();
        state.anpr.estados.lock().unwrap().insert(carril.id.clone(), estado.clone());
        self.emitir(json!({ "tipo": "estado", "carril": carril.id, "estado": estado }));
    }
}

// ── Arranque y parada ───────────────────────────────────────────────────────────────────────────────────────

/// Lanza `servidor.js` con el `node` empaquetado (el mismo runtime del OCR por clic, en otro proceso).
fn lanzar_tauri(app: &AppHandle) -> AppResult<ProcesoLineas> {
    use tauri_plugin_shell::process::CommandEvent;
    use tauri_plugin_shell::ShellExt;
    let dir = crate::ocr::dir_sidecar(app)
        .ok_or_else(|| AppError::new("anpr", "No se encontraron los recursos del reconocimiento (sidecar-ocr)."))?;
    let servidor = dir.join("src").join("anpr").join("servidor.js");
    if !servidor.exists() || !dir.join("models").join("yolox_nano.onnx").exists() {
        return Err(AppError::new("anpr", "Falta el detector de vehículos en esta instalación (yolox_nano.onnx)."));
    }
    let (mut rx, hijo) = app
        .shell()
        .sidecar("node")
        .map_err(|e| AppError::new("anpr", format!("sidecar node: {e}")))?
        .args([servidor.to_string_lossy().as_ref(), "--models", dir.join("models").to_string_lossy().as_ref()])
        .spawn()
        .map_err(|e| AppError::new("anpr", format!("no se pudo lanzar el ANPR: {e}")))?;
    let (tx_in, mut rx_in) = tokio::sync::mpsc::unbounded_channel::<String>();
    let (tx_out, rx_out) = tokio::sync::mpsc::unbounded_channel::<String>();
    let hijo = Arc::new(Mutex::new(Some(hijo)));
    let h2 = hijo.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(mut l) = rx_in.recv().await {
            l.push('\n');
            let escrito = h2.lock().unwrap().as_mut().map(|h| h.write(l.as_bytes()).is_ok()).unwrap_or(false);
            if !escrito {
                break;
            }
        }
    });
    tauri::async_runtime::spawn(async move {
        while let Some(ev) = rx.recv().await {
            match ev {
                CommandEvent::Stdout(l) => {
                    if tx_out.send(String::from_utf8_lossy(&l).trim_end().to_string()).is_err() {
                        break;
                    }
                }
                CommandEvent::Stderr(l) => log::debug!("[anpr] {}", String::from_utf8_lossy(&l).trim_end()),
                CommandEvent::Terminated(t) => {
                    log::warn!("[anpr] el proceso terminó: {t:?}");
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(ProcesoLineas {
        entrada: tx_in,
        salida: rx_out,
        matar: Box::new(move || {
            if let Some(h) = hijo.lock().unwrap().take() {
                let _ = h.kill();
            }
        }),
    })
}

/// Arranca los carriles habilitados (si no hay pausa global). Idempotente: reinicia los que ya corrían.
pub async fn iniciar(app: &AppHandle) -> AppResult<()> {
    let state = app.state::<AppState>();
    crate::auth::exigir_sesion(&state)?;
    let (pausado, lista) = con_db(&state, |c| Ok((carriles::pausado(c)?, carriles::listar(c)?)))?;
    for (_, tx) in state.anpr.paradas.lock().unwrap().drain() {
        let _ = tx.send(true);
    }
    let activos: Vec<Carril> = lista.into_iter().filter(|c| c.modo != Modo::Apagado && c.camara_id.is_some()).collect();
    if pausado || activos.is_empty() {
        state.anpr.detener();
        return Ok(());
    }
    let cliente = {
        let mut guard = state.anpr.cliente.lock().await;
        match guard.as_ref().filter(|c| c.vivo()) {
            Some(c) => c.clone(),
            None => {
                let p = lanzar_tauri(app)?;
                let c = ClienteAnpr::iniciar(p, motor::ESPERA_CARGA).await.map_err(|e| {
                    *state.anpr.error.lock().unwrap() = Some(e.clone());
                    AppError::new("anpr", e)
                })?;
                *state.anpr.error.lock().unwrap() = None;
                *guard = Some(c.clone());
                c
            }
        }
    };
    let sumidero = Arc::new(SumideroApp { app: app.clone() });
    for carril in activos {
        let camara = carril.camara_id.clone().unwrap_or_default();
        let fuente = match crate::camaras::encender(app, &state, &camara).await {
            Ok(f) => f,
            Err(e) => {
                sumidero.estado(&carril, EstadoCarril::SinCamara { motivo: e.mensaje });
                continue;
            }
        };
        let (tx, rx) = watch::channel(false);
        state.anpr.paradas.lock().unwrap().insert(carril.id.clone(), tx);
        tauri::async_runtime::spawn(motor::correr_carril(cliente.clone(), fuente, carril, sumidero.clone(), rx));
    }
    Ok(())
}

fn estado(state: &AppState) -> AppResult<EstadoAnpr> {
    let (pausado, lista, pendientes) = con_db(state, |c| {
        let pendientes = registro::listar(c, 200)?.iter().filter(|e| e.pendiente()).count();
        Ok((carriles::pausado(c)?, carriles::listar(c)?, pendientes))
    })?;
    let estados = state.anpr.estados.lock().unwrap();
    let proceso_activo = state.anpr.cliente.try_lock().map(|c| c.as_ref().is_some_and(|c| c.vivo())).unwrap_or(true);
    Ok(EstadoAnpr {
        pausado,
        proceso_activo,
        error: state.anpr.error.lock().unwrap().clone(),
        carriles: lista
            .into_iter()
            .map(|c| {
                let e = estados.get(&c.id).cloned().unwrap_or(EstadoCarril::Detenido);
                CarrilConEstado { carril: c, estado: e }
            })
            .collect(),
        pendientes,
    })
}

// ── Comandos ────────────────────────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn anpr_estado(state: State<'_, AppState>) -> AppResult<EstadoAnpr> {
    estado(&state)
}

/// Lo llama la pantalla de la garita al abrirse (con sesión): arranca los carriles habilitados.
#[tauri::command]
pub async fn anpr_iniciar(app: AppHandle, state: State<'_, AppState>) -> AppResult<EstadoAnpr> {
    if let Err(e) = iniciar(&app).await {
        *state.anpr.error.lock().unwrap() = Some(e.mensaje.clone());
        return Err(e);
    }
    estado(&state)
}

#[tauri::command]
pub fn anpr_detener(state: State<'_, AppState>) {
    state.anpr.detener();
}

/// Interruptor de emergencia «Pausar ANPR»: todo vuelve al modo por clic de inmediato. Se guarda en el equipo.
#[tauri::command]
pub async fn anpr_pausar(app: AppHandle, state: State<'_, AppState>, pausado: bool) -> AppResult<EstadoAnpr> {
    let agente = crate::auth::exigir_sesion(&state)?;
    con_db(&state, |c| carriles::pausar(c, pausado))?;
    log::info!("anpr: {} {} el ANPR", agente.email, if pausado { "PAUSÓ" } else { "reanudó" });
    if pausado {
        state.anpr.detener();
    } else {
        iniciar(&app).await?;
    }
    estado(&state)
}

#[tauri::command]
pub fn anpr_carriles(state: State<'_, AppState>) -> AppResult<Vec<Carril>> {
    con_db(&state, carriles::listar)
}

#[tauri::command]
pub async fn anpr_carril_guardar(app: AppHandle, state: State<'_, AppState>, carril: Carril) -> AppResult<Carril> {
    let agente = crate::auth::exigir_sesion(&state)?;
    let guardado = con_db(&state, |c| carriles::guardar(c, &carril))?;
    log::info!("anpr: {} guardó el carril {} (modo {})", agente.email, guardado.id, guardado.modo.como_str());
    // Los carriles se reinician con la configuración nueva; si falla (sin modelos, sin cámara) queda el error en el estado.
    if let Err(e) = iniciar(&app).await {
        *state.anpr.error.lock().unwrap() = Some(e.mensaje);
    }
    Ok(guardado)
}

#[tauri::command]
pub async fn anpr_carril_eliminar(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<bool> {
    crate::auth::exigir_sesion(&state)?;
    let ok = con_db(&state, |c| carriles::eliminar(c, &id))?;
    if let Err(e) = iniciar(&app).await {
        *state.anpr.error.lock().unwrap() = Some(e.mensaje);
    }
    Ok(ok)
}

#[tauri::command]
pub fn anpr_eventos(state: State<'_, AppState>, limite: Option<usize>) -> AppResult<Vec<EventoAnpr>> {
    con_db(&state, |c| registro::listar(c, limite.unwrap_or(50).min(200)))
}

/// JPEG (base64) de la evidencia de un evento, para la pantalla. Solo con sesión de agente.
#[tauri::command]
pub fn anpr_evidencia(state: State<'_, AppState>, evento_id: String, tipo: String) -> AppResult<Option<String>> {
    crate::auth::exigir_sesion(&state)?;
    if tipo != "placa" && tipo != "vehiculo" {
        return Err(AppError::new("anpr", "Tipo de evidencia desconocido."));
    }
    con_db(&state, |c| registro::evidencia(c, &evento_id, &tipo))
}

/// El agente resuelve un evento (confirmar con un toque, corregir la placa, registrar a mano, descartar o «enterado»).
#[tauri::command]
pub async fn anpr_resolver(
    app: AppHandle,
    state: State<'_, AppState>,
    evento_id: String,
    resolucion: Resolucion,
    placa: Option<String>,
) -> AppResult<EventoAnpr> {
    let agente = crate::auth::exigir_sesion(&state)?;
    let licencia_ok = crate::license::exigir_uso(&state).is_ok();
    let r = con_db(&state, |c| {
        let ev = registro::obtener(c, &evento_id)?.ok_or_else(|| AppError::new("anpr", "No se encontró ese evento."))?;
        let carril = carriles::obtener(c, &ev.carril_id)?
            .ok_or_else(|| AppError::new("anpr", "El carril de este evento ya no existe."))?;
        let r = registro::resolver(c, &agente.id, &carril, &evento_id, resolucion, placa.as_deref(), licencia_ok, Utc::now())?;
        Ok((r, carril))
    })?;
    let (r, carril) = r;
    log::info!("anpr: {} resolvió un evento del carril {} ({:?})", agente.email, carril.id, resolucion);
    crate::sync::disparar_push(app.clone());
    if r.abrir {
        abrir_en_segundo_plano(app.clone(), carril, r.evento.id.clone());
    }
    Ok(r.evento)
}

/// Pulso de prueba del actuador desde la configuración del carril (sin registrar nada).
#[tauri::command]
pub async fn anpr_probar_actuador(state: State<'_, AppState>, config: actuador::ConfigActuador) -> AppResult<String> {
    let agente = crate::auth::exigir_sesion(&state)?;
    let a = actuador::crear(&config, crate::hardware_cmd::driver(&state)).map_err(|e| AppError::new("anpr_config", e))?;
    log::info!("anpr: {} probó el actuador {}", agente.email, a.nombre());
    let a2 = a.clone();
    tauri::async_runtime::spawn_blocking(move || a2.abrir())
        .await
        .map_err(|e| AppError::interno(e.to_string()))?
        .map_err(|e| AppError::new("anpr_actuador", e))?;
    Ok(if a.simulado() { "Apertura simulada: no hay hardware conectado.".into() } else { format!("{}: abrió.", a.nombre()) })
}
