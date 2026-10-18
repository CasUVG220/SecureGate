//! Motor del ANPR (Sprint 10): el proceso del sidecar (`sidecar-ocr/src/anpr/servidor.js`) y un bucle por carril que le pasa
//! los fotogramas del puente de cámaras.
//!
//! - **Un solo proceso** para todos los carriles (un OCR y un detector en memoria), aparte del OCR por clic: «Pausar ANPR» lo
//!   termina sin tocar la captura por clic.
//! - **Por carril**: `esperar_fotograma` da el fotograma más nuevo (sin colas: si el sidecar tardó, los intermedios se saltan),
//!   se manda en base64, y antes del siguiente se espera lo que pidió el sidecar (`fps_deseado`: 1 en reposo, ~5 con movimiento).
//! - Lo que vuelve va a un [`Sumidero`]: la app (base local + actuador + pantalla) o, en las pruebas, uno que solo anota.
//!
//! El proceso habla JSON por líneas y se abstrae en [`ProcesoLineas`] para poder lanzarlo con el plugin de Tauri (producción) o
//! con `tokio::process` (pruebas de punta a punta con el `node` del sistema).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine;
use serde::Serialize;
use serde_json::{json, Value};
use tokio::sync::{mpsc, oneshot, watch};

use super::carriles::{self, Carril};
use super::decision::LecturaAnpr;
use crate::camaras::fuente::{esperar_fotograma, FaltaFotograma, FuenteFotogramas};

/// Cuánto se espera a que el proceso cargue los modelos (OCR + detector).
pub const ESPERA_CARGA: Duration = Duration::from_secs(90);
/// Tope de una petición de fotograma (incluye una lectura de OCR en un equipo lento).
pub const ESPERA_FOTOGRAMA: Duration = Duration::from_secs(15);

/// Un proceso que recibe y entrega líneas de texto.
pub struct ProcesoLineas {
    pub entrada: mpsc::UnboundedSender<String>,
    pub salida: mpsc::UnboundedReceiver<String>,
    pub matar: Box<dyn FnMut() + Send>,
}

type Pendientes = Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>;

/// Cliente del proceso ANPR: correlaciona respuestas por `id`.
pub struct ClienteAnpr {
    entrada: mpsc::UnboundedSender<String>,
    pendientes: Pendientes,
    contador: AtomicU64,
    matar: Mutex<Option<Box<dyn FnMut() + Send>>>,
    vivo: watch::Receiver<bool>,
}

impl ClienteAnpr {
    /// Toma el proceso, lee su salida en segundo plano y espera `{"evento":"listo"}`.
    pub async fn iniciar(p: ProcesoLineas, espera: Duration) -> Result<Arc<ClienteAnpr>, String> {
        let ProcesoLineas { entrada, mut salida, matar } = p;
        let pendientes: Pendientes = Arc::default();
        let (tx_vivo, rx_vivo) = watch::channel(true);
        let (tx_listo, rx_listo) = oneshot::channel::<Result<u64, String>>();
        let pend = pendientes.clone();
        tokio::spawn(async move {
            let mut tx_listo = Some(tx_listo);
            while let Some(linea) = salida.recv().await {
                let Ok(v) = serde_json::from_str::<Value>(&linea) else { continue };
                if let Some(evento) = v.get("evento").and_then(Value::as_str) {
                    if let Some(tx) = tx_listo.take() {
                        let _ = tx.send(if evento == "listo" {
                            Ok(v["ms_carga"].as_u64().unwrap_or(0))
                        } else {
                            Err(v["error"].as_str().unwrap_or("el ANPR no pudo cargar los modelos").to_string())
                        });
                    }
                    continue;
                }
                if let Some(id) = v.get("id").and_then(Value::as_str) {
                    if let Some(tx) = pend.lock().unwrap().remove(id) {
                        let _ = tx.send(v);
                    }
                }
            }
            // El proceso terminó: las peticiones en curso fallan al soltarse sus emisores.
            pend.lock().unwrap().clear();
            let _ = tx_vivo.send(false);
            if let Some(tx) = tx_listo.take() {
                let _ = tx.send(Err("el proceso del ANPR terminó antes de cargar".into()));
            }
        });
        let cliente = Arc::new(ClienteAnpr { entrada, pendientes, contador: AtomicU64::new(0), matar: Mutex::new(Some(matar)), vivo: rx_vivo });
        match tokio::time::timeout(espera, rx_listo).await {
            Ok(Ok(Ok(ms))) => {
                log::info!("anpr: proceso listo en {ms} ms");
                Ok(cliente)
            }
            Ok(Ok(Err(e))) => {
                cliente.terminar();
                Err(e)
            }
            Ok(Err(_)) => {
                cliente.terminar();
                Err("el proceso del ANPR no respondió".into())
            }
            Err(_) => {
                cliente.terminar();
                Err("El ANPR tardó demasiado en cargar los modelos".into())
            }
        }
    }

    /// ¿Sigue corriendo el proceso?
    pub fn vivo(&self) -> bool {
        *self.vivo.borrow()
    }

    /// Manda una petición y espera su respuesta (con tope).
    pub async fn pedir(&self, mut req: Value, espera: Duration) -> Result<Value, String> {
        let id = self.contador.fetch_add(1, Ordering::Relaxed).to_string();
        req["id"] = json!(id);
        let (tx, rx) = oneshot::channel();
        self.pendientes.lock().unwrap().insert(id.clone(), tx);
        if self.entrada.send(req.to_string()).is_err() {
            self.pendientes.lock().unwrap().remove(&id);
            return Err("el proceso del ANPR no está corriendo".into());
        }
        match tokio::time::timeout(espera, rx).await {
            Ok(Ok(v)) => Ok(v),
            Ok(Err(_)) => Err("el proceso del ANPR se cerró".into()),
            Err(_) => {
                self.pendientes.lock().unwrap().remove(&id);
                Err("el ANPR tardó demasiado con este fotograma".into())
            }
        }
    }

    /// Pide cerrar y, por las dudas, mata el proceso.
    pub fn terminar(&self) {
        let _ = self.entrada.send(json!({ "op": "shutdown" }).to_string());
        if let Some(mut m) = self.matar.lock().unwrap().take() {
            m();
        }
    }
}

impl Drop for ClienteAnpr {
    fn drop(&mut self) {
        self.terminar();
    }
}

/// Lanza el proceso con `tokio::process` (pruebas de punta a punta y medición; en la app se usa el plugin de Tauri).
#[allow(dead_code)] // la usan la prueba de punta a punta y el script de medición
pub fn lanzar_tokio(programa: &str, args: &[String]) -> Result<ProcesoLineas, String> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let mut hijo = tokio::process::Command::new(programa)
        .args(args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("no se pudo lanzar {programa}: {e}"))?;
    let mut stdin = hijo.stdin.take().expect("stdin");
    let stdout = hijo.stdout.take().expect("stdout");
    let (tx_in, mut rx_in) = mpsc::unbounded_channel::<String>();
    let (tx_out, rx_out) = mpsc::unbounded_channel::<String>();
    tokio::spawn(async move {
        while let Some(mut l) = rx_in.recv().await {
            l.push('\n');
            if stdin.write_all(l.as_bytes()).await.is_err() {
                break;
            }
        }
    });
    tokio::spawn(async move {
        let mut lineas = BufReader::new(stdout).lines();
        while let Ok(Some(l)) = lineas.next_line().await {
            if tx_out.send(l).is_err() {
                break;
            }
        }
    });
    let hijo = Arc::new(Mutex::new(Some(hijo)));
    Ok(ProcesoLineas {
        entrada: tx_in,
        salida: rx_out,
        matar: Box::new(move || {
            if let Some(mut h) = hijo.lock().unwrap().take() {
                let _ = h.start_kill();
            }
        }),
    })
}

/// Estado de un carril para la pantalla.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "estado", rename_all = "snake_case")]
pub enum EstadoCarril {
    Iniciando,
    Activo { fps: f64 },
    SinCamara { motivo: String },
    Error { motivo: String },
    Detenido,
}

/// A dónde va lo que produce un carril.
pub trait Sumidero: Send + Sync + 'static {
    /// Respuesta de un fotograma procesado (pistas para la superposición, eventos, ms por etapa).
    fn fotograma(&self, carril: &Carril, respuesta: &Value);
    /// Una decisión del sidecar (placa confirmada o ilegible). La registra, decide y, si corresponde, manda abrir.
    fn decision(&self, carril: &Carril, lectura: LecturaAnpr);
    fn estado(&self, carril: &Carril, estado: EstadoCarril);
}

/// Bucle de un carril hasta que `parar` pase a `true`.
pub async fn correr_carril<S: Sumidero>(
    cliente: Arc<ClienteAnpr>,
    fuente: Arc<dyn FuenteFotogramas>,
    carril: Carril,
    sumidero: Arc<S>,
    mut parar: watch::Receiver<bool>,
) {
    sumidero.estado(&carril, EstadoCarril::Iniciando);
    match cliente.pedir(json!({ "op": "configurar", "carril": carriles::para_sidecar(&carril) }), Duration::from_secs(10)).await {
        Ok(v) if v["ok"].as_bool() == Some(true) => {}
        Ok(v) => {
            sumidero.estado(&carril, EstadoCarril::Error { motivo: v["error"].as_str().unwrap_or("configuración rechazada").to_string() });
            return;
        }
        Err(e) => {
            sumidero.estado(&carril, EstadoCarril::Error { motivo: e });
            return;
        }
    }
    let mut visto = 0u64;
    let mut ultimo_estado: Option<EstadoCarril> = None;
    let informar = |s: EstadoCarril, ultimo: &mut Option<EstadoCarril>| {
        if ultimo.as_ref() != Some(&s) {
            sumidero.estado(&carril, s.clone());
            *ultimo = Some(s);
        }
    };
    loop {
        if *parar.borrow() || !cliente.vivo() {
            break;
        }
        let f = tokio::select! {
            r = esperar_fotograma(&*fuente, visto, Duration::from_secs(5), 3_000) => r,
            _ = parar.changed() => break,
        };
        let f = match f {
            Ok(f) => f,
            Err(FaltaFotograma::Caida(m)) | Err(FaltaFotograma::SinImagen(m)) => {
                informar(EstadoCarril::SinCamara { motivo: m }, &mut ultimo_estado);
                if esperar_o_parar(&mut parar, Duration::from_secs(2)).await {
                    break;
                }
                continue;
            }
        };
        visto = f.seq;
        let t0 = Instant::now();
        let req = json!({ "op": "fotograma", "carril": carril.id, "jpeg": base64::engine::general_purpose::STANDARD.encode(&*f.jpeg) });
        let v = match cliente.pedir(req, ESPERA_FOTOGRAMA).await {
            Ok(v) if v["ok"].as_bool() == Some(true) => v,
            Ok(v) => {
                informar(EstadoCarril::Error { motivo: v["error"].as_str().unwrap_or("error del ANPR").to_string() }, &mut ultimo_estado);
                if esperar_o_parar(&mut parar, Duration::from_secs(1)).await {
                    break;
                }
                continue;
            }
            Err(e) => {
                informar(EstadoCarril::Error { motivo: e }, &mut ultimo_estado);
                if esperar_o_parar(&mut parar, Duration::from_secs(1)).await {
                    break;
                }
                continue;
            }
        };
        let fps = v["fps_deseado"].as_f64().unwrap_or(1.0).clamp(0.2, 10.0);
        informar(EstadoCarril::Activo { fps }, &mut ultimo_estado);
        if v["procesado"].as_bool() == Some(true) {
            sumidero.fotograma(&carril, &v);
        }
        for e in v["eventos"].as_array().into_iter().flatten() {
            if e["tipo"].as_str() == Some("decision") {
                match serde_json::from_value::<LecturaAnpr>(e.clone()) {
                    Ok(l) => sumidero.decision(&carril, l),
                    Err(err) => log::warn!("anpr: decisión ilegible del sidecar: {err}"),
                }
            }
        }
        let espera = Duration::from_secs_f64(1.0 / fps).saturating_sub(t0.elapsed());
        if esperar_o_parar(&mut parar, espera).await {
            break;
        }
    }
    let _ = cliente.pedir(json!({ "op": "quitar", "carril": carril.id }), Duration::from_secs(2)).await;
    sumidero.estado(&carril, EstadoCarril::Detenido);
}

/// Duerme `d` salvo que llegue la orden de parar. Devuelve `true` si hay que parar.
async fn esperar_o_parar(parar: &mut watch::Receiver<bool>, d: Duration) -> bool {
    if *parar.borrow() {
        return true;
    }
    tokio::select! {
        _ = tokio::time::sleep(d) => *parar.borrow(),
        r = parar.changed() => r.is_err() || *parar.borrow(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::anpr::actuador::ConfigActuador;
    use crate::anpr::carriles::{Modo, Sentido, Umbrales};
    use crate::camaras::fuente::{EstadoFuente, Fotograma};

    /// Proceso falso: responde con una función a cada línea; puede anunciar `listo` o un error de carga.
    fn proceso_falso(listo: Option<&'static str>, responder: impl Fn(&Value) -> Option<Value> + Send + 'static) -> (ProcesoLineas, Arc<Mutex<Vec<Value>>>) {
        let (tx_in, mut rx_in) = mpsc::unbounded_channel::<String>();
        let (tx_out, rx_out) = mpsc::unbounded_channel::<String>();
        let recibido = Arc::new(Mutex::new(Vec::new()));
        let r2 = recibido.clone();
        match listo {
            Some("listo") => tx_out.send(json!({"evento": "listo", "ms_carga": 5}).to_string()).unwrap(),
            Some(err) => tx_out.send(json!({"evento": "error_carga", "error": err}).to_string()).unwrap(),
            None => {}
        }
        tokio::spawn(async move {
            while let Some(l) = rx_in.recv().await {
                let v: Value = serde_json::from_str(&l).unwrap();
                r2.lock().unwrap().push(v.clone());
                if v["op"] == "shutdown" {
                    break;
                }
                if let Some(mut resp) = responder(&v) {
                    resp["id"] = v["id"].clone();
                    if tx_out.send(resp.to_string()).is_err() {
                        break;
                    }
                }
            }
        });
        (ProcesoLineas { entrada: tx_in, salida: rx_out, matar: Box::new(|| {}) }, recibido)
    }

    /// Fuente de fotogramas falsa: publica un JPEG nuevo cada vez que se le pide con `publicar`.
    struct FuenteFalsa {
        ultimo: Mutex<Option<Fotograma>>,
        tx: watch::Sender<u64>,
        estado: Mutex<EstadoFuente>,
    }

    impl FuenteFalsa {
        fn nueva() -> Arc<Self> {
            Arc::new(Self { ultimo: Mutex::new(None), tx: watch::channel(0).0, estado: Mutex::new(EstadoFuente::Conectada) })
        }
        fn publicar(&self, seq: u64) {
            let ahora = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64;
            *self.ultimo.lock().unwrap() = Some(Fotograma { jpeg: Arc::new(vec![0xff, 0xd8, seq as u8]), seq, recibido_ms: ahora });
            let _ = self.tx.send(seq);
        }
    }

    impl FuenteFotogramas for FuenteFalsa {
        fn ultimo(&self) -> Option<Fotograma> {
            self.ultimo.lock().unwrap().clone()
        }
        fn estado(&self) -> EstadoFuente {
            self.estado.lock().unwrap().clone()
        }
        fn suscribir(&self) -> watch::Receiver<u64> {
            self.tx.subscribe()
        }
    }

    #[derive(Default)]
    struct SumideroFalso {
        fotogramas: Mutex<u32>,
        decisiones: Mutex<Vec<LecturaAnpr>>,
        estados: Mutex<Vec<EstadoCarril>>,
    }

    impl Sumidero for SumideroFalso {
        fn fotograma(&self, _c: &Carril, _r: &Value) {
            *self.fotogramas.lock().unwrap() += 1;
        }
        fn decision(&self, _c: &Carril, l: LecturaAnpr) {
            self.decisiones.lock().unwrap().push(l);
        }
        fn estado(&self, _c: &Carril, e: EstadoCarril) {
            self.estados.lock().unwrap().push(e);
        }
    }

    fn carril() -> Carril {
        Carril {
            id: "c1".into(), nombre: "Entrada".into(), camara_id: Some("cam".into()), sentido: Sentido::Entrada, modo: Modo::Automatico,
            roi: vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]], umbrales: Umbrales::default(), actuador: ConfigActuador::Simulado, actualizado_en: None,
        }
    }

    #[tokio::test]
    async fn el_cliente_espera_listo_y_correlaciona_respuestas_por_id() {
        let (p, recibido) = proceso_falso(Some("listo"), |v| Some(json!({"ok": true, "eco": v["op"]})));
        let c = ClienteAnpr::iniciar(p, Duration::from_secs(2)).await.unwrap();
        let (a, b) = tokio::join!(c.pedir(json!({"op": "ping"}), Duration::from_secs(2)), c.pedir(json!({"op": "otra"}), Duration::from_secs(2)));
        assert_eq!(a.unwrap()["eco"], "ping");
        assert_eq!(b.unwrap()["eco"], "otra");
        assert!(c.vivo());
        c.terminar();
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(recibido.lock().unwrap().iter().any(|v| v["op"] == "shutdown"));
    }

    #[tokio::test]
    async fn error_de_carga_o_silencio_no_dejan_un_cliente_a_medias() {
        let (p, _) = proceso_falso(Some("faltan los modelos"), |_| None);
        assert_eq!(ClienteAnpr::iniciar(p, Duration::from_secs(2)).await.err().as_deref(), Some("faltan los modelos"));
        let (p2, _) = proceso_falso(None, |_| None);
        assert!(ClienteAnpr::iniciar(p2, Duration::from_millis(200)).await.err().unwrap().contains("tardó"));
    }

    #[tokio::test]
    async fn una_peticion_sin_respuesta_vence_y_no_queda_pendiente() {
        let (p, _) = proceso_falso(Some("listo"), |_| None);
        let c = ClienteAnpr::iniciar(p, Duration::from_secs(2)).await.unwrap();
        assert!(c.pedir(json!({"op": "fotograma"}), Duration::from_millis(100)).await.unwrap_err().contains("tardó"));
        assert!(c.pendientes.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn el_bucle_configura_el_carril_pasa_fotogramas_entrega_decisiones_y_respeta_el_fps() {
        let (p, recibido) = proceso_falso(Some("listo"), |v| match v["op"].as_str() {
            Some("configurar") => Some(json!({"ok": true})),
            Some("quitar") => Some(json!({"ok": true})),
            Some("fotograma") => {
                // El segundo fotograma trae una decisión.
                let n = v["jpeg"].as_str().map(|j| base64::engine::general_purpose::STANDARD.decode(j).unwrap()[2]).unwrap_or(0);
                let eventos = if n == 2 {
                    json!([{"tipo": "decision", "carril": "c1", "track_id": "c1-1", "resultado": "confirmada", "placa": "P123ABC", "confianza": 0.97}])
                } else {
                    json!([])
                };
                Some(json!({"ok": true, "procesado": true, "fps_deseado": 5, "eventos": eventos, "pistas": []}))
            }
            _ => Some(json!({"ok": false, "error": "?"})),
        });
        let cliente = ClienteAnpr::iniciar(p, Duration::from_secs(2)).await.unwrap();
        let fuente = FuenteFalsa::nueva();
        let sumidero = Arc::new(SumideroFalso::default());
        let (tx_parar, rx_parar) = watch::channel(false);
        let tarea = tokio::spawn(correr_carril(cliente.clone(), fuente.clone() as Arc<dyn FuenteFotogramas>, carril(), sumidero.clone(), rx_parar));
        for seq in 1..=3u64 {
            fuente.publicar(seq);
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        tx_parar.send(true).unwrap();
        tarea.await.unwrap();
        let rec = recibido.lock().unwrap().clone();
        assert_eq!(rec[0]["op"], "configurar");
        assert_eq!(rec[0]["carril"]["roi"], json!([[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]]));
        let fotos: Vec<&Value> = rec.iter().filter(|v| v["op"] == "fotograma").collect();
        assert_eq!(fotos.len(), 3, "un envío por fotograma nuevo, sin repetir el mismo");
        assert!(fotos.iter().all(|f| f["carril"] == "c1"));
        assert_eq!(rec.last().unwrap()["op"], "quitar", "al parar se quita el carril del proceso");
        let d = sumidero.decisiones.lock().unwrap();
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].placa.as_deref(), Some("P123ABC"));
        assert_eq!(*sumidero.fotogramas.lock().unwrap(), 3);
        let estados = sumidero.estados.lock().unwrap();
        assert_eq!(estados.first(), Some(&EstadoCarril::Iniciando));
        assert!(estados.contains(&EstadoCarril::Activo { fps: 5.0 }));
        assert_eq!(estados.last(), Some(&EstadoCarril::Detenido));
    }

    #[tokio::test]
    async fn sin_camara_lo_informa_y_sigue_esperando_hasta_que_vuelve() {
        let (p, _) = proceso_falso(Some("listo"), |v| Some(match v["op"].as_str() {
            Some("fotograma") => json!({"ok": true, "procesado": true, "fps_deseado": 10, "eventos": []}),
            _ => json!({"ok": true}),
        }));
        let cliente = ClienteAnpr::iniciar(p, Duration::from_secs(2)).await.unwrap();
        let fuente = FuenteFalsa::nueva();
        *fuente.estado.lock().unwrap() = EstadoFuente::Caida { motivo: "Sin señal".into(), intentos: 5, reintentando: true };
        let sumidero = Arc::new(SumideroFalso::default());
        let (tx_parar, rx_parar) = watch::channel(false);
        let tarea = tokio::spawn(correr_carril(cliente, fuente.clone() as Arc<dyn FuenteFotogramas>, carril(), sumidero.clone(), rx_parar));
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(sumidero.estados.lock().unwrap().contains(&EstadoCarril::SinCamara { motivo: "Sin señal".into() }));
        *fuente.estado.lock().unwrap() = EstadoFuente::Conectada;
        fuente.publicar(1);
        tokio::time::sleep(Duration::from_millis(2_300)).await;
        tx_parar.send(true).unwrap();
        tarea.await.unwrap();
        assert!(*sumidero.fotogramas.lock().unwrap() >= 1, "al volver la cámara sigue procesando");
    }

    #[tokio::test]
    async fn una_configuracion_rechazada_detiene_el_carril_con_el_motivo() {
        let (p, _) = proceso_falso(Some("listo"), |_| Some(json!({"ok": false, "error": "El ROI necesita al menos 3 puntos"})));
        let cliente = ClienteAnpr::iniciar(p, Duration::from_secs(2)).await.unwrap();
        let sumidero = Arc::new(SumideroFalso::default());
        let (_tx, rx) = watch::channel(false);
        correr_carril(cliente, FuenteFalsa::nueva() as Arc<dyn FuenteFotogramas>, carril(), sumidero.clone(), rx).await;
        assert_eq!(sumidero.estados.lock().unwrap().last(), Some(&EstadoCarril::Error { motivo: "El ROI necesita al menos 3 puntos".into() }));
    }
}
