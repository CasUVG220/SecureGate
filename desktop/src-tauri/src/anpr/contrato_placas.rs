//! Contrato de las placas de los residentes (Sprint 10, seguimiento del ANPR, tarea 3): lo que la administración da de alta o de
//! baja desde la lista de casas llega a la garita en el siguiente `GET /sync/garita` y cambia lo que el ANPR decide. Sin hardware:
//! la garita de verdad (licencia, sesión del agente, pull, copia SQLCipher, `decision::hechos` + `decision::decidir` igual que
//! `SumideroApp::decision`) contra el backend de verdad, que la lanza `backend/src/__tests__/integration/anpr.contrato.int.test.ts`.
//!
//! Si algo se desconecta (la pantalla escribe en otra tabla, el snapshot no trae la versión nueva, la baja no llega, el residente
//! borrado deja su placa en la copia, la placa reasignada hereda la decisión del anterior), alguna aserción de aquí falla.

use std::sync::Arc;

use chrono::{Local, Utc};
use serde_json::{json, Value};

use super::carriles::Modo;
use super::decision::{self, Decision, LecturaAnpr};
use crate::AppState;

/// Placa sintética con la forma guatemalteca (la única que lee el ANPR).
const PLACA: &str = "P777RES";

struct Web {
    api: String,
    token: String,
    http: reqwest::Client,
}

impl Web {
    /// Lo mismo que hace la pantalla de la web: `fetch` con la sesión del administrador.
    async fn pedir(&self, metodo: reqwest::Method, ruta: &str, cuerpo: Option<Value>) -> (u16, Value) {
        let mut req = self.http.request(metodo, format!("{}/api{ruta}", self.api)).bearer_auth(&self.token);
        if let Some(c) = cuerpo {
            req = req.json(&c);
        }
        let r = req.send().await.expect("backend");
        let status = r.status().as_u16();
        (status, r.json().await.unwrap_or(Value::Null))
    }

    async fn alta_placa(&self, residente: &str, placa: &str) -> String {
        let (s, v) = self.pedir(reqwest::Method::POST, "/anpr/vehiculos", Some(json!({ "residente_id": residente, "placa": placa }))).await;
        assert_eq!(s, 201, "alta de la placa: {v}");
        assert_eq!(v["placa"], PLACA, "se guarda normalizada");
        v["id"].as_str().unwrap().to_string()
    }
}

/// Lo que la garita sabe y decide de la placa después de un pull.
#[derive(Debug)]
struct Garita {
    version: u64,
    decision: String,
    vehiculo_id: Option<String>,
    residente_id: Option<String>,
    filas_en_copia: i64,
}

fn texto(d: &Decision) -> String {
    match d {
        Decision::Abrir { .. } => "abrir".into(),
        Decision::Verificar { motivo, .. } => format!("verificar:{}", serde_json::to_value(motivo).unwrap().as_str().unwrap()),
        Decision::AlertaListaNegra { .. } => "alerta_lista_negra".into(),
        Decision::Ignorar { motivo } => format!("ignorar:{motivo}"),
    }
}

/// Pull (incremental después del primero) y la decisión del ANPR para una lectura limpia de la placa en un carril automático.
async fn garita(state: &Arc<AppState>, paso: &str) -> Garita {
    crate::sync::pull(state).await.unwrap_or_else(|e| panic!("pull ({paso}): {e:?}"));
    let licencia_ok = crate::license::exigir_uso(state).is_ok();
    let hoy = Local::now().format("%Y-%m-%d").to_string();
    let lectura = LecturaAnpr {
        carril: "contrato".into(), track_id: format!("contrato-{paso}"), resultado: "confirmada".into(), placa: Some(PLACA.into()),
        placa_probable: None, confianza: 0.97, votos: 4, lecturas: vec![], requiere_verificacion: false, alguna_correccion: false,
        motivo: None, clase: Some("car".into()), ms_desde_legible: None, evidencia: Default::default(),
    };
    crate::garita::con_db(state, |c| {
        let h = decision::hechos(c, Some(PLACA), "contrato", &hoy, &super::instante(Utc::now()), licencia_ok)?;
        let d = decision::decidir(Modo::Automatico, &lectura, &h);
        let version = crate::db::meta_leer(c, "vehiculos_version")?.and_then(|v| v.parse().ok()).unwrap_or(0);
        let filas = c.query_row("SELECT count(*) FROM vehiculos_autorizados_local WHERE placa = ?1", [PLACA], |r| r.get(0))?;
        Ok(Garita {
            version,
            decision: texto(&d),
            vehiculo_id: h.vehiculo.as_ref().map(|v| v.id.clone()),
            residente_id: h.vehiculo.as_ref().map(|v| v.residente_id.clone()),
            filas_en_copia: filas,
        })
    })
    .unwrap()
}

#[tokio::test]
#[ignore = "la lanza anpr.contrato.int.test.ts contra un backend real"]
async fn contrato_placas_de_residentes() {
    let var = |k: &str| std::env::var(k).unwrap_or_else(|_| panic!("falta {k} (la prueba la lanza anpr.contrato.int.test.ts)"));
    let api = var("SG_TEST_API_URL");
    let clave = var("SG_TEST_PASSWORD");
    let (residente, residente_nuevo, usuario_residente) = (var("SG_CONTRATO_RESIDENTE"), var("SG_CONTRATO_RESIDENTE_NUEVO"), var("SG_CONTRATO_USUARIO_RESIDENTE"));

    crate::secure_store::inicializar_mock();
    let dir = tempfile::tempdir().unwrap();
    let state = Arc::new(crate::construir_estado_en(dir.path().to_path_buf()));
    *state.config.write().unwrap() = crate::config::Config { api_url: api.clone(), ..Default::default() };
    crate::license::activar(&state, &var("SG_CONTRATO_CODIGO"), Some("Garita contrato placas")).await.expect("activar la licencia");
    crate::auth::login(&state, &var("SG_CONTRATO_AGENTE"), &clave).await.expect("login del agente");

    let http = reqwest::Client::new();
    let sesion: Value = http.post(format!("{api}/api/auth/login")).json(&json!({ "email": var("SG_CONTRATO_ADMIN"), "password": clave }))
        .send().await.unwrap().json().await.unwrap();
    let web = Web { api: api.clone(), token: sesion["token"].as_str().expect("login del administrador").to_string(), http };

    // 0. La placa no existe: el ANPR no la conoce.
    let g0 = garita(&state, "inicio").await;
    assert_eq!((g0.decision.as_str(), g0.filas_en_copia), ("verificar:desconocida", 0), "{g0:?}");

    // 1. Alta desde la lista de casas (como la teclea alguien: con guion y en minúsculas) → versión nueva → abre sola.
    let v1 = web.alta_placa(&residente, "p-777res").await;
    let g1 = garita(&state, "alta").await;
    assert!(g1.version > g0.version, "el snapshot trae una versión nueva: {g0:?} → {g1:?}");
    assert_eq!((g1.decision.as_str(), g1.vehiculo_id.as_deref()), ("abrir", Some(v1.as_str())), "{g1:?}");

    // 2. Baja de la placa → versión nueva → ya no abre y sale de la copia.
    let (s, b) = web.pedir(reqwest::Method::DELETE, &format!("/anpr/vehiculos/{v1}"), None).await;
    assert_eq!(s, 200, "baja: {b}");
    let g2 = garita(&state, "baja").await;
    assert!(g2.version > g1.version, "{g1:?} → {g2:?}");
    assert_eq!((g2.decision.as_str(), g2.filas_en_copia), ("verificar:desconocida", 0), "{g2:?}");

    // 3. La misma placa para un residente nuevo, y después se elimina al residente → ya no abre y la placa no queda en la copia.
    let v2 = web.alta_placa(&residente_nuevo, PLACA).await;
    let g3 = garita(&state, "alta-residente-nuevo").await;
    assert_eq!((g3.decision.as_str(), g3.vehiculo_id.as_deref()), ("abrir", Some(v2.as_str())), "{g3:?}");
    let (s, b) = web.pedir(reqwest::Method::DELETE, &format!("/residentes/{residente_nuevo}"), None).await;
    assert_eq!(s, 200, "eliminar residente: {b}");
    let g4 = garita(&state, "residente-eliminado").await;
    assert_ne!(g4.decision, "abrir", "{g4:?}");
    assert_eq!(g4.filas_en_copia, 0, "la placa del residente eliminado no queda en la copia de la garita: {g4:?}");

    // 4. La placa vuelve a darse de alta para el primer residente: abre para ÉL, sin heredar nada del eliminado.
    let v3 = web.alta_placa(&residente, PLACA).await;
    let g5 = garita(&state, "reasignada").await;
    assert_eq!(
        (g5.decision.as_str(), g5.vehiculo_id.as_deref(), g5.residente_id.as_deref(), g5.filas_en_copia),
        ("abrir", Some(v3.as_str()), Some(residente.as_str()), 1),
        "{g5:?}"
    );

    // 5. Se desactiva al usuario del residente (Usuarios → desactivar) → versión nueva → deja de abrir.
    let (s, b) = web.pedir(reqwest::Method::DELETE, &format!("/usuarios/{usuario_residente}"), None).await;
    assert_eq!(s, 200, "desactivar usuario: {b}");
    let g6 = garita(&state, "usuario-desactivado").await;
    assert!(g6.version > g5.version, "{g5:?} → {g6:?}");
    assert_ne!(g6.decision, "abrir", "{g6:?}");

    println!("CONTRATO_PLACAS {}", json!({ "v1": v1, "v2": v2, "v3": v3, "versiones": [g0.version, g1.version, g2.version, g5.version, g6.version] }));
}
