//! El ANPR de verdad, de punta a punta en este equipo (Sprint 10, tareas 7 y 8): el sidecar real (`node servidor.js`, YOLOX-Nano +
//! PP-OCRv5), los clips sintéticos de `test-fixtures/anpr/` decodificados con `ffmpeg` y entregados EN TIEMPO REAL como los
//! entregaría el puente de cámaras, el bucle de Rust (`motor::correr_carril`), la decisión contra un SQLCipher de verdad, la cola
//! offline y el actuador simulado.
//!
//! Están marcadas `#[ignore]` porque necesitan `node`, `ffmpeg` y los modelos (`node desktop/sidecar-ocr/scripts/fetch-models.mjs`):
//!
//! ```text
//! cargo test --lib anpr::pruebas_reales -- --ignored --nocapture
//! ```
//!
//! `desktop/scripts/medir-anpr.mjs` corre las de medición y muestrea CPU y RAM del proceso de Rust y del sidecar por separado.
//! `e2e_clip_hasta_el_backend` además sube todo a un backend REAL: la lanza `backend/src/__tests__/integration/anpr.e2e.int.test.ts`.
//! Las placas, residentes y la lista negra de aquí son sintéticos.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::{Local, Utc};
use rusqlite::Connection;
use serde_json::{json, Value};
use tokio::sync::watch;

use super::actuador::{ActuadorBarrera, ConfigActuador, Simulado};
use super::carriles::{Carril, Modo, Sentido, Umbrales};
use super::decision::{self, Decision, LecturaAnpr};
use super::motor::{self, ClienteAnpr, EstadoCarril, Sumidero};
use super::{instante, registro};
use crate::camaras::fuente::{EstadoFuente, Fotograma, FuenteFotogramas};

// ── Entorno ──────────────────────────────────────────────────────────────────────────────────────────────────

pub struct Entorno {
    pub sidecar: PathBuf,
    pub fixtures: PathBuf,
    pub verdad: Value,
}

impl Entorno {
    /// Rutas del repo; `Err` con lo que falta (para que el mensaje del CI diga qué instalar).
    pub fn detectar() -> Result<Entorno, String> {
        let raiz = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..");
        let sidecar = raiz.join("desktop").join("sidecar-ocr");
        let fixtures = raiz.join("test-fixtures").join("anpr");
        for (f, como) in [
            (sidecar.join("models").join("yolox_nano.onnx"), "node desktop/sidecar-ocr/scripts/fetch-models.mjs"),
            (sidecar.join("node_modules"), "npm --prefix desktop/sidecar-ocr ci"),
            (fixtures.join("verdad_terreno.json"), "test-fixtures/anpr del repo"),
        ] {
            if !f.exists() {
                return Err(format!("falta {} ({como})", f.display()));
            }
        }
        for prog in ["node", "ffmpeg"] {
            if std::process::Command::new(prog).arg("-version").output().is_err() {
                return Err(format!("falta `{prog}` en el PATH"));
            }
        }
        let verdad = serde_json::from_slice(&std::fs::read(fixtures.join("verdad_terreno.json")).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        Ok(Entorno { sidecar, fixtures, verdad })
    }

    pub fn roi(&self) -> Vec<[f64; 2]> {
        serde_json::from_value(self.verdad["roi"].clone()).unwrap_or_default()
    }

    /// `(fps, placas esperadas)` del clip según la verdad de terreno.
    pub fn clip(&self, nombre: &str) -> (f64, Vec<String>) {
        let c = self.verdad["clips"].as_array().into_iter().flatten()
            .find(|c| c["archivo"].as_str().is_some_and(|a| a.ends_with(&format!("{nombre}.mp4"))))
            .unwrap_or_else(|| panic!("clip {nombre} no está en verdad_terreno.json"));
        let placas = c["vehiculos"].as_array().into_iter().flatten()
            .map(|v| v["placa"].as_str().unwrap_or("").to_string()).collect();
        (c["fps"].as_f64().unwrap_or(10.0), placas)
    }

    pub async fn lanzar_sidecar(&self) -> Arc<ClienteAnpr> {
        let servidor = self.sidecar.join("src").join("anpr").join("servidor.js");
        let modelos = self.sidecar.join("models");
        let p = motor::lanzar_tokio("node", &[servidor.to_string_lossy().into(), "--models".into(), modelos.to_string_lossy().into()])
            .expect("lanzar el sidecar");
        ClienteAnpr::iniciar(p, motor::ESPERA_CARGA).await.expect("el sidecar cargó los modelos")
    }
}

/// Los cuadros del clip como JPEG (lo mismo que entrega el puente de cámaras: MJPEG).
pub fn cuadros(clip: &Path) -> Vec<Arc<Vec<u8>>> {
    let out = std::process::Command::new("ffmpeg")
        .args(["-v", "error", "-i"])
        .arg(clip)
        .args(["-f", "image2pipe", "-c:v", "mjpeg", "-q:v", "3", "-"])
        .output()
        .expect("ffmpeg");
    assert!(out.status.success(), "ffmpeg no pudo decodificar {}", clip.display());
    let b = out.stdout;
    // Cada JPEG empieza con FF D8 FF (en los datos comprimidos un FF siempre va seguido de 00: no se confunde).
    let inicios: Vec<usize> = (0..b.len().saturating_sub(2)).filter(|&i| b[i] == 0xff && b[i + 1] == 0xd8 && b[i + 2] == 0xff).collect();
    inicios.iter().enumerate()
        .map(|(k, &i)| Arc::new(b[i..*inicios.get(k + 1).unwrap_or(&b.len())].to_vec()))
        .collect()
}

// ── Fuente: un «puente» que publica los cuadros del clip a su fps ───────────────────────────────────────────────

pub struct FuenteClip {
    ultimo: Mutex<Option<Fotograma>>,
    tx: watch::Sender<u64>,
    seq: AtomicU64,
    pub publicados: AtomicU64,
}

impl FuenteClip {
    pub fn nueva() -> Arc<Self> {
        Arc::new(Self { ultimo: Mutex::new(None), tx: watch::channel(0).0, seq: AtomicU64::new(0), publicados: AtomicU64::new(0) })
    }

    fn publicar(&self, jpeg: Arc<Vec<u8>>) {
        let seq = self.seq.fetch_add(1, Ordering::SeqCst) + 1;
        let ahora = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64;
        *self.ultimo.lock().unwrap() = Some(Fotograma { jpeg, seq, recibido_ms: ahora });
        self.publicados.fetch_add(1, Ordering::SeqCst);
        let _ = self.tx.send(seq);
    }

    /// Reproduce los cuadros a `fps` con horario absoluto (sin deriva aunque el equipo esté cargado).
    pub async fn reproducir(&self, cuadros: &[Arc<Vec<u8>>], fps: f64) {
        let paso = Duration::from_secs_f64(1.0 / fps);
        let t0 = tokio::time::Instant::now();
        for (i, c) in cuadros.iter().enumerate() {
            tokio::time::sleep_until(t0 + paso * i as u32).await;
            self.publicar(c.clone());
        }
    }
}

impl FuenteFotogramas for FuenteClip {
    fn ultimo(&self) -> Option<Fotograma> {
        self.ultimo.lock().unwrap().clone()
    }
    fn estado(&self) -> EstadoFuente {
        EstadoFuente::Conectada
    }
    fn suscribir(&self) -> watch::Receiver<u64> {
        self.tx.subscribe()
    }
}

// ── Sumidero: lo mismo que la app (decisión + SQLCipher + actuador) y anota los tiempos ─────────────────────────

/// La base de la garita: una propia (medición) o la de la app ya activada y sincronizada (de punta a punta).
pub enum Base {
    Propia(Mutex<Connection>),
    App(Arc<crate::AppState>),
}

impl Base {
    pub fn con<T>(&self, f: impl FnOnce(&Connection) -> T) -> T {
        match self {
            Base::Propia(c) => f(&c.lock().unwrap()),
            Base::App(s) => crate::garita::con_db(s, |c| Ok(f(c))).expect("base de la garita abierta"),
        }
    }

    /// Como la app: la licencia de verdad decide si el equipo puede abrir solo.
    fn licencia_ok(&self) -> bool {
        match self {
            Base::Propia(_) => true,
            Base::App(s) => crate::license::exigir_uso(s).is_ok(),
        }
    }
}

pub struct SumideroMedicion {
    pub db: Base,
    inicio: Instant,
    pub decisiones: Mutex<Vec<Value>>,
    pub etapas: Mutex<BTreeMap<String, Vec<f64>>>,
    pub procesados: Mutex<HashMap<String, u64>>,
    pub errores: Mutex<Vec<String>>,
    /// Fin de cada pista e «ignorada» del sidecar (para explicar un vehículo sin decisión con `SG_ANPR_DETALLE`).
    pub pistas: Mutex<Vec<Value>>,
}

impl SumideroMedicion {
    pub fn nuevo(db: Base) -> Arc<Self> {
        Arc::new(Self {
            db,
            inicio: Instant::now(),
            decisiones: Mutex::new(vec![]),
            etapas: Mutex::new(BTreeMap::new()),
            procesados: Mutex::new(HashMap::new()),
            errores: Mutex::new(vec![]),
            pistas: Mutex::new(vec![]),
        })
    }

    pub fn segundos(&self) -> f64 {
        self.inicio.elapsed().as_secs_f64()
    }
}

fn tipo(d: &Decision) -> String {
    match d {
        Decision::Abrir { .. } => "abrir".into(),
        Decision::Verificar { motivo, .. } => format!("verificar:{}", serde_json::to_value(motivo).unwrap().as_str().unwrap_or("")),
        Decision::AlertaListaNegra { .. } => "lista_negra".into(),
        Decision::Ignorar { motivo } => format!("ignorar:{motivo}"),
    }
}

impl Sumidero for SumideroMedicion {
    fn fotograma(&self, carril: &Carril, r: &Value) {
        *self.procesados.lock().unwrap().entry(carril.id.clone()).or_default() += 1;
        for e in r["eventos"].as_array().into_iter().flatten() {
            if e["tipo"] == "ignorada" || (e["tipo"] == "pista" && e["evento"] != "estado") {
                self.pistas.lock().unwrap().push(json!({ "t_s": self.segundos(), "carril": carril.id, "e": e }));
            }
        }
        if let Some(ms) = r["ms"].as_object() {
            let mut e = self.etapas.lock().unwrap();
            for (k, v) in ms {
                if let Some(v) = v.as_f64() {
                    e.entry(k.clone()).or_default().push(v);
                }
            }
        }
    }

    fn decision(&self, carril: &Carril, l: LecturaAnpr) {
        let t0 = Instant::now();
        let licencia_ok = self.db.licencia_ok();
        let (d, ev, ms_registro) = self.db.con(|c| {
            let ahora = Utc::now();
            let hoy = Local::now().format("%Y-%m-%d").to_string();
            let h = decision::hechos(c, l.placa.as_deref(), &carril.id, &hoy, &instante(ahora), licencia_ok).expect("hechos");
            let d = decision::decidir(carril.modo, &l, &h);
            let ev = registro::registrar(c, carril, &l, &d, ahora).expect("registrar");
            let ms_registro = t0.elapsed().as_secs_f64() * 1000.0;
            if d.abre() {
                // Igual que `abrir_en_segundo_plano`: el acceso ya está en la cola; el actuador va después.
                let r = Simulado.abrir().map(|_| true);
                if let Some(e) = &ev {
                    registro::marcar_apertura(c, &e.id, &r, Utc::now()).expect("marcar apertura");
                }
            }
            (d, ev, ms_registro)
        });
        self.decisiones.lock().unwrap().push(json!({
            "carril": carril.id, "t_s": self.segundos(), "track_id": l.track_id, "resultado": l.resultado,
            "placa": l.placa, "placa_probable": l.placa_probable, "requiere_verificacion": l.requiere_verificacion,
            "confianza": l.confianza, "lecturas": l.lecturas.len(), "decision": tipo(&d),
            "ms_desde_legible": l.ms_desde_legible, "ms_rust_registro": ms_registro, "ms_rust_total": t0.elapsed().as_secs_f64() * 1000.0,
            "id_cliente": ev.as_ref().and_then(|e| e.id_cliente.clone()), "evento_id": ev.as_ref().map(|e| e.id.clone()),
        }));
    }

    fn estado(&self, carril: &Carril, estado: EstadoCarril) {
        if let EstadoCarril::Error { motivo } | EstadoCarril::SinCamara { motivo } = &estado {
            self.errores.lock().unwrap().push(format!("{}: {motivo}", carril.id));
        }
    }
}

// ── Base de la garita con datos sintéticos ──────────────────────────────────────────────────────────────────────

pub const AUTORIZADAS: [&str; 4] = ["P123ABC", "M771KLM", "P555TRK", "C458DFG"];
/// En la copia de la lista negra: nunca abre aunque también sea un vehículo autorizado.
pub const EN_LISTA_NEGRA: &str = "C458DFG";
/// Se lee bien pero no es de ningún residente: va a verificación.
pub const DESCONOCIDA: &str = "U318BCD";

/// SQLCipher de verdad (archivo cifrado en un directorio temporal) con la copia local de la sucursal.
pub fn base_garita(dir: &Path) -> Connection {
    let c = crate::db::abrir(&dir.join("garita.db"), &[7u8; 32]).expect("abrir SQLCipher");
    for (i, placa) in AUTORIZADAS.iter().enumerate() {
        c.execute("INSERT INTO residentes_local VALUES (?1, ?2, ?3, 'al_dia', NULL)", rusqlite::params![format!("r{i}"), format!("Casa {}", i + 1), format!("Residente {}", i + 1)]).unwrap();
        c.execute(
            "INSERT INTO vehiculos_autorizados_local VALUES (?1, ?2, ?3, ?4, ?5, '2026-01-01', NULL, 1, 0, ?6)",
            rusqlite::params![format!("v{i}"), placa, format!("r{i}"), format!("Casa {}", i + 1), format!("Residente {}", i + 1), i as i64 + 1],
        ).unwrap();
    }
    c.execute(
        "INSERT INTO blacklist_local (id, numero_dpi, visitante_nombre, razon, fecha_fin, residente_id, placa) VALUES ('b1', '', NULL, 'Vehículo de prueba en lista negra', NULL, NULL, ?1)",
        [EN_LISTA_NEGRA],
    ).unwrap();
    c
}

pub fn carril(id: &str, roi: Vec<[f64; 2]>) -> Carril {
    Carril {
        id: id.into(), nombre: format!("Carril {id}"), camara_id: Some(format!("cam-{id}")), sentido: Sentido::Entrada,
        modo: Modo::Automatico, roi, umbrales: Umbrales::default(), actuador: ConfigActuador::Simulado, actualizado_en: None,
    }
}

// ── Corrida ─────────────────────────────────────────────────────────────────────────────────────────────────────

/// Lo que se reprodujo en un carril y cuándo (para atribuir cada decisión a su clip).
#[derive(Debug, Clone)]
pub struct Ventana {
    pub carril: String,
    pub clip: String,
    pub esperadas: Vec<String>,
    pub desde_s: f64,
    pub hasta_s: f64,
}

pub struct Corrida {
    pub sumidero: Arc<SumideroMedicion>,
    pub ventanas: Vec<Ventana>,
    pub publicados: HashMap<String, u64>,
    pub duracion_s: f64,
}

/// Segundos de «calle vacía» (el primer cuadro del clip) después de cada clip: para que las pistas terminen.
const COLA_S: f64 = 3.0;

/// Reproduce, en paralelo por carril y en orden dentro de cada uno, los clips dados por el mismo proceso ANPR (como la app).
pub async fn correr(entorno: &Entorno, cliente: Arc<ClienteAnpr>, db: Base, plan: &[(&str, Vec<&str>)]) -> Corrida {
    let sumidero = SumideroMedicion::nuevo(db);
    let roi = entorno.roi();
    let (tx_parar, rx_parar) = watch::channel(false);
    let (tx_fin, rx_fin) = watch::channel(false);
    let (tx_listo, mut rx_listo) = tokio::sync::mpsc::unbounded_channel::<()>();
    let mut bucles = vec![];
    let mut reproducciones = vec![];
    let ventanas = Arc::new(Mutex::new(vec![]));
    let mut fuentes = vec![];
    // Primero se decodifica todo: con el carril ya andando, una espera larga se vería como «la cámara no envía imagen».
    let decodificados: Vec<Vec<(String, f64, Vec<String>, Vec<Arc<Vec<u8>>>)>> = plan.iter().map(|(_, clips)| clips.iter().map(|n| {
        let (fps, esperadas) = entorno.clip(n);
        (n.to_string(), fps, esperadas, cuadros(&entorno.fixtures.join("clips").join(format!("{n}.mp4"))))
    }).collect()).collect();
    for ((id, _), clips) in plan.iter().zip(decodificados) {
        let fuente = FuenteClip::nueva();
        fuentes.push((id.to_string(), fuente.clone()));
        let c = carril(id, roi.clone());
        bucles.push(tokio::spawn(motor::correr_carril(cliente.clone(), fuente.clone(), c, sumidero.clone(), rx_parar.clone())));
        let (s, v, id) = (sumidero.clone(), ventanas.clone(), id.to_string());
        let mut fin = rx_fin.clone();
        let tx_listo = tx_listo.clone();
        reproducciones.push(tokio::spawn(async move {
            // Un segundo de calle vacía para que el carril arranque y calibre el fondo.
            let vacio = clips.first().map(|(_, fps, _, cs)| (*fps, cs[0].clone()));
            if let Some((fps, c)) = &vacio {
                fuente.reproducir(&vec![c.clone(); *fps as usize], *fps).await;
            }
            for (nombre, fps, esperadas, cs) in clips {
                let desde = s.segundos();
                fuente.reproducir(&cs, fps).await;
                fuente.reproducir(&vec![cs[0].clone(); (COLA_S * fps) as usize], fps).await;
                v.lock().unwrap().push(Ventana { carril: id.clone(), clip: nombre, esperadas, desde_s: desde, hasta_s: s.segundos() });
            }
            let _ = tx_listo.send(());
            // Como una cámara de verdad, sigue mandando la calle vacía hasta que terminen los demás carriles.
            if let Some((fps, c)) = vacio {
                while !*fin.borrow() {
                    fuente.reproducir(&[c.clone()], fps).await;
                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_secs_f64(1.0 / fps)) => {}
                        _ = fin.changed() => {}
                    }
                }
            }
        }));
    }
    // Cuando todos terminaron sus clips (más lo que el sidecar tenga en vuelo), se para todo.
    for _ in 0..plan.len() {
        rx_listo.recv().await;
    }
    tokio::time::sleep(Duration::from_millis(1500)).await;
    let _ = tx_parar.send(true);
    let _ = tx_fin.send(true);
    for r in reproducciones {
        r.await.unwrap();
    }
    for b in bucles {
        let _ = tokio::time::timeout(Duration::from_secs(20), b).await;
    }
    let ventanas = ventanas.lock().unwrap().clone();
    Corrida {
        duracion_s: sumidero.segundos(),
        publicados: fuentes.iter().map(|(id, f)| (id.clone(), f.publicados.load(Ordering::SeqCst))).collect(),
        sumidero,
        ventanas,
    }
}

fn percentiles(v: &[f64]) -> Value {
    if v.is_empty() {
        return json!({ "n": 0 });
    }
    let mut s = v.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let p = |q: f64| s[((s.len() as f64 - 1.0) * q).round() as usize];
    json!({ "n": s.len(), "p50": p(0.5), "p95": p(0.95), "max": s[s.len() - 1] })
}

impl Corrida {
    pub fn decisiones(&self) -> Vec<Value> {
        self.sumidero.decisiones.lock().unwrap().clone()
    }

    /// Decisiones de cada clip (por carril y ventana de tiempo).
    pub fn por_clip(&self) -> Vec<(Ventana, Vec<Value>)> {
        let ds = self.decisiones();
        self.ventanas.iter().map(|v| {
            let mias = ds.iter()
                .filter(|d| d["carril"] == v.carril.as_str() && d["t_s"].as_f64().unwrap() >= v.desde_s && d["t_s"].as_f64().unwrap() < v.hasta_s + 1.5)
                .cloned().collect();
            (v.clone(), mias)
        }).collect()
    }

    /// Resumen en JSON (lo lee `desktop/scripts/medir-anpr.mjs`).
    pub fn resumen(&self) -> Value {
        let ds = self.decisiones();
        let num = |k: &str| ds.iter().filter_map(|d| d[k].as_f64()).collect::<Vec<_>>();
        let etapas: BTreeMap<String, Value> = self.sumidero.etapas.lock().unwrap().iter().map(|(k, v)| (k.clone(), percentiles(v))).collect();
        let mut exactitud = json!({ "vehiculos": 0, "abrio_correcta": 0, "verificacion_correcta": 0, "ilegible": 0, "placa_equivocada": 0, "falsas": 0, "perdidos": 0 });
        let clips: Vec<Value> = self.por_clip().into_iter().map(|(v, mias)| {
            exactitud["vehiculos"] = json!(exactitud["vehiculos"].as_u64().unwrap() + v.esperadas.len() as u64);
            for d in &mias {
                let placa = d["placa"].as_str();
                let k = match placa {
                    Some(p) if !v.esperadas.iter().any(|e| e == p) => if v.esperadas.is_empty() { "falsas" } else { "placa_equivocada" },
                    Some(_) if d["decision"] == "abrir" => "abrio_correcta",
                    Some(_) => "verificacion_correcta",
                    None if v.esperadas.is_empty() => "falsas",
                    None => "ilegible",
                };
                exactitud[k] = json!(exactitud[k].as_u64().unwrap() + 1);
            }
            let faltan = v.esperadas.len().saturating_sub(mias.len());
            exactitud["perdidos"] = json!(exactitud["perdidos"].as_u64().unwrap() + faltan as u64);
            json!({ "carril": v.carril, "clip": v.clip, "esperadas": v.esperadas, "decisiones": mias.iter().map(|d| json!({
                "decision": d["decision"], "placa": d["placa"], "placa_probable": d["placa_probable"], "ms_desde_legible": d["ms_desde_legible"],
            })).collect::<Vec<_>>() })
        }).collect();
        json!({
            "carriles": self.publicados.len(),
            "duracion_s": self.duracion_s,
            "cuadros_publicados": self.publicados,
            "cuadros_procesados": *self.sumidero.procesados.lock().unwrap(),
            "etapas_ms": etapas,
            "ms_desde_legible": percentiles(&num("ms_desde_legible")),
            "ms_rust_registro": percentiles(&num("ms_rust_registro")),
            "ms_rust_total": percentiles(&num("ms_rust_total")),
            "exactitud": exactitud,
            "clips": clips,
            "errores": *self.sumidero.errores.lock().unwrap(),
        })
    }

    /// Barandas que tienen que cumplirse SIEMPRE, cargado o no el equipo: ninguna placa inventada, nada en un clip sin vehículo,
    /// una decisión como mucho por vehículo, y nunca se abre para la lista negra ni para una placa desconocida.
    pub fn verificar_barandas(&self) {
        assert!(self.sumidero.errores.lock().unwrap().is_empty(), "errores de los carriles: {:?}", self.sumidero.errores.lock().unwrap());
        for (v, mias) in self.por_clip() {
            if v.esperadas.is_empty() {
                assert!(mias.is_empty(), "{}: decisión sin vehículo: {mias:?}", v.clip);
            }
            assert!(mias.len() <= v.esperadas.len().max(1), "{}: más decisiones que vehículos: {mias:?}", v.clip);
            for d in &mias {
                if let Some(p) = d["placa"].as_str() {
                    assert!(v.esperadas.iter().any(|e| e == p), "{}: placa inventada {p}", v.clip);
                }
            }
        }
        for d in self.decisiones() {
            if d["decision"] == "abrir" {
                let p = d["placa"].as_str().unwrap_or("");
                assert!(AUTORIZADAS.contains(&p) && p != EN_LISTA_NEGRA, "abrió para {p}");
                assert_eq!(d["requiere_verificacion"], false, "abrió con una lectura que pedía verificación: {d}");
            }
            if d["placa"] == EN_LISTA_NEGRA {
                assert_eq!(d["decision"], "lista_negra", "la lista negra siempre alerta: {d}");
            }
            if d["placa"] == DESCONOCIDA {
                assert_eq!(d["decision"], "verificar:desconocida", "{d}");
            }
        }
    }
}

/// Plan de dos carriles: uno con las entradas de una y dos placas y el ilegible; otro con la lista negra, el detenido y los dos
/// clips sin vehículo en el carril.
pub fn plan_dos_carriles() -> Vec<(&'static str, Vec<&'static str>)> {
    vec![
        ("a", vec!["entrada_p123abc", "dos_seguidos", "ilegible"]),
        ("b", vec!["entrada_c458dfg", "detenido_m771klm", "vacio", "carril_vecino"]),
    ]
}

async fn medir(plan: Vec<(&'static str, Vec<&'static str>)>) {
    let entorno = Entorno::detectar().unwrap_or_else(|e| panic!("entorno del ANPR incompleto: {e}"));
    let dir = tempfile::tempdir().unwrap();
    let cliente = entorno.lanzar_sidecar().await;
    // `medir-anpr.mjs` empieza a muestrear CPU y RAM aquí (la carga de los modelos no cuenta como trabajo por fotograma).
    println!("ANPR_LISTO");
    let corrida = correr(&entorno, cliente.clone(), Base::Propia(Mutex::new(base_garita(dir.path()))), &plan).await;
    cliente.terminar();
    let r = corrida.resumen();
    println!("MEDICION_ANPR {r}");
    if std::env::var("SG_ANPR_DETALLE").is_ok() {
        for v in &corrida.ventanas {
            println!("VENTANA {} {} {:.1}-{:.1}", v.carril, v.clip, v.desde_s, v.hasta_s);
        }
        for d in corrida.decisiones() {
            println!("DECISION {d}");
        }
        for p in corrida.sumidero.pistas.lock().unwrap().iter() {
            println!("PISTA {p}");
        }
    }
    corrida.verificar_barandas();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "necesita node, ffmpeg y los modelos del ANPR (ver el encabezado del módulo)"]
async fn medicion_un_carril() {
    medir(vec![("a", vec!["entrada_p123abc", "dos_seguidos", "ilegible", "entrada_c458dfg", "detenido_m771klm", "vacio", "carril_vecino"])]).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "necesita node, ffmpeg y los modelos del ANPR (ver el encabezado del módulo)"]
async fn medicion_dos_carriles() {
    medir(plan_dos_carriles()).await;
}

/// Reposo: dos carriles mirando la calle vacía (el sidecar a 1 fps, sin detector ni OCR).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "necesita node, ffmpeg y los modelos del ANPR (ver el encabezado del módulo)"]
async fn medicion_reposo() {
    medir(vec![("a", vec!["vacio", "vacio", "vacio"]), ("b", vec!["vacio", "vacio", "vacio"])]).await;
}

// ── De punta a punta contra un backend real (tarea 8) ─────────────────────────────────────────────────────────────

/// Clip → ffmpeg → sidecar real → bucle de Rust → decisión contra la base de la app (bajada con el `pull` de verdad) → cola
/// offline (con una caída de red en medio) → backend real → evidencia. La lanza el Jest `anpr.e2e.int.test.ts`, que siembra el
/// backend, da de alta el vehículo `P123ABC` y después verifica en Postgres lo que esta prueba imprime en `E2E_ANPR {...}`.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "necesita un backend real y el entorno del ANPR: la lanza backend/src/__tests__/integration/anpr.e2e.int.test.ts"]
async fn e2e_clip_hasta_el_backend() {
    let var = |k: &str| std::env::var(k).unwrap_or_else(|_| panic!("falta {k} (la prueba la lanza anpr.e2e.int.test.ts)"));
    let (api, codigo, agente, clave) = (var("SG_TEST_API_URL"), var("SG_E2E_CODIGO"), var("SG_E2E_AGENTE"), var("SG_TEST_PASSWORD"));
    let entorno = Entorno::detectar().unwrap_or_else(|e| panic!("entorno del ANPR incompleto: {e}"));
    crate::secure_store::inicializar_mock();
    let dir = tempfile::tempdir().unwrap();
    let state = Arc::new(crate::construir_estado_en(dir.path().to_path_buf()));
    let config = |url: &str| crate::config::Config { api_url: url.to_string(), ..Default::default() };
    *state.config.write().unwrap() = config(&api);

    // La garita como en la vida real: activación, agente de turno y el snapshot con los vehículos autorizados.
    crate::license::activar(&state, &codigo, Some("Garita E2E ANPR")).await.expect("activar la licencia");
    crate::auth::login(&state, &agente, &clave).await.expect("login del agente");
    crate::sync::pull(&state).await.expect("pull");
    let base = Base::App(state.clone());
    let v = base.con(|c| decision::vehiculo_por_placa(c, "P123ABC").unwrap()).expect("el vehículo autorizado bajó con el snapshot");
    assert!(v.activo && !v.en_lista_negra);

    // El clip del residente y uno ilegible, en tiempo real, por el ANPR de verdad.
    let cliente = entorno.lanzar_sidecar().await;
    let corrida = correr(&entorno, cliente.clone(), base, &[("e2e", vec!["entrada_p123abc", "ilegible"])]).await;
    cliente.terminar();
    corrida.verificar_barandas();
    let ds = corrida.decisiones();
    let id = |d: Option<&Value>, que: &str| -> String {
        d.and_then(|d| d["id_cliente"].as_str()).unwrap_or_else(|| panic!("falta la decisión «{que}»: {ds:?}")).to_string()
    };
    let acceso = id(ds.iter().find(|d| d["decision"] == "abrir" && d["placa"] == "P123ABC"), "abrir P123ABC");
    let ilegible = id(ds.iter().find(|d| d["decision"] == "verificar:ilegible"), "ilegible");
    assert_eq!(ds.len(), 2, "un evento por vehículo: {ds:?}");
    assert_eq!(crate::sync::estado(&state).pendientes, 2, "el acceso y el evento esperan en la cola");

    // Se cae la red: nada se pierde ni se duplica.
    *state.config.write().unwrap() = config("http://127.0.0.1:1");
    assert!(crate::sync::push_pendientes(&state).await.unwrap_err().es_sin_conexion());
    assert_eq!(crate::sync::estado(&state).pendientes, 2);

    // Vuelve la red y toca el reintento: sube todo una vez y, en la misma vuelta, la evidencia de lo que ya está allá.
    *state.config.write().unwrap() = config(&api);
    let base = Base::App(state.clone());
    base.con(|c| c.execute("UPDATE accesos_pendientes SET proximo_intento_en = '2000-01-01T00:00:00Z'", []).unwrap());
    assert_eq!(crate::sync::push_pendientes(&state).await.expect("push"), 2);
    let est = crate::sync::estado(&state);
    assert_eq!((est.pendientes, est.rechazados), (0, 0));
    let (subidas, sin_subir): (i64, i64) = base.con(|c| c.query_row(
        "SELECT count(*) FILTER (WHERE subida = 1), count(*) FILTER (WHERE subida <> 1) FROM anpr_evidencias", [], |r| Ok((r.get(0)?, r.get(1)?)),
    ).unwrap());
    assert!(subidas >= 3 && sin_subir == 0, "placa y vehículo del acceso, vehículo del ilegible: {subidas} subidas, {sin_subir} sin subir");
    assert_eq!(crate::sync::push_evidencias(&state).await.expect("evidencias"), 0, "nada se sube dos veces");
    println!("E2E_ANPR {}", json!({ "acceso": acceso, "ilegible": ilegible }));
}
