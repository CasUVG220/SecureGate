//! Flujo completo de la app contra un backend REAL (sin Tauri ni Keychain):
//! activación → login → pull → cola offline → push → kill switch.
//!
//! Se salta si no hay `SG_TEST_API_URL`. Para correrlo:
//!
//!   SG_TEST_API_URL=http://localhost:3000 SG_TEST_ADMIN=admin@s8.test \
//!   SG_TEST_AGENTE=agente@s8.test SG_TEST_PASSWORD=secret123 \
//!   cargo test integracion -- --ignored --nocapture
//!
//! Necesita un admin_sucursal y un agente de la misma sucursal, con al menos
//! un residente. Emite una licencia nueva cada vez (queda revocada al final).

use serde_json::{json, Value};

use crate::{auth, garita, license, secure_store, sync};

struct Env {
    api: String,
    admin: String,
    agente: String,
    password: String,
}

fn env() -> Option<Env> {
    Some(Env {
        api: std::env::var("SG_TEST_API_URL").ok()?,
        admin: std::env::var("SG_TEST_ADMIN").unwrap_or_else(|_| "admin@s8.test".into()),
        agente: std::env::var("SG_TEST_AGENTE").unwrap_or_else(|_| "agente@s8.test".into()),
        password: std::env::var("SG_TEST_PASSWORD").unwrap_or_else(|_| "secret123".into()),
    })
}

async fn admin_token(e: &Env) -> String {
    let v: Value = reqwest::Client::new()
        .post(format!("{}/api/auth/login", e.api))
        .json(&json!({ "email": e.admin, "password": e.password }))
        .send().await.unwrap().json().await.unwrap();
    v["token"].as_str().expect("login admin").to_string()
}

async fn emitir_codigo(e: &Env, admin: &str) -> (String, String) {
    let v: Value = reqwest::Client::new()
        .post(format!("{}/api/licencias", e.api))
        .bearer_auth(admin)
        .json(&json!({ "etiqueta": "test integracion" }))
        .send().await.unwrap().json().await.unwrap();
    (v["id"].as_str().unwrap().to_string(), v["codigo_activacion"].as_str().unwrap().to_string())
}

#[tokio::test]
#[ignore = "necesita backend real (SG_TEST_API_URL)"]
async fn flujo_completo_de_garita() {
    let Some(e) = env() else { eprintln!("SG_TEST_API_URL no definido; se omite"); return };
    secure_store::inicializar_mock();
    let dir = tempfile::tempdir().unwrap();
    let state = crate::construir_estado_en(dir.path().to_path_buf());
    *state.config.write().unwrap() = crate::config::Config { api_url: e.api.clone() };

    // Sin licencia: nada funciona.
    assert_eq!(license::evaluar(None, chrono::Utc::now()), license::EstadoLicencia::SinLicencia);
    assert!(garita::con_db(&state, |_| Ok(())).is_err(), "la BD no debe abrirse sin licencia");

    // 1. Activación → abre la BD cifrada.
    let admin = admin_token(&e).await;
    let (lic_id, codigo) = emitir_codigo(&e, &admin).await;
    let dto = license::activar(&state, &codigo, Some("Garita test")).await.expect("activar");
    assert!(matches!(dto.estado, license::EstadoLicencia::Activa));
    assert!(dir.path().join("garita.db").exists());
    assert!(secure_store::leer(secure_store::CLAVE_LICENCIA).unwrap().is_some(), "la licencia se persiste en el almacén seguro");

    // Reactivar desde la misma máquina: token nuevo, BD recifrada, datos intactos.
    garita::con_db(&state, |c| crate::db::meta_escribir(c, "marca", "antes-de-reactivar")).unwrap();
    license::activar(&state, &codigo, None).await.expect("reactivar misma máquina");
    let marca = garita::con_db(&state, |c| crate::db::meta_leer(c, "marca")).unwrap();
    assert_eq!(marca.as_deref(), Some("antes-de-reactivar"));

    // 2. Login del agente.
    let s = auth::login(&state, &e.agente, &e.password).await.expect("login");
    assert_eq!(s.usuario.as_ref().unwrap().email, e.agente);
    assert!(secure_store::leer(secure_store::CLAVE_SESION).unwrap().is_some());

    // 3. Pull del espejo.
    let (res, _bl, _pre) = sync::pull(&state).await.expect("pull");
    assert!(res > 0, "la sucursal de prueba debe tener residentes");
    let residentes = garita::con_db(&state, |c| garita::buscar_residentes(c, "", 5)).unwrap();
    let residente = residentes.first().expect("residente local").clone();
    assert!(sync::estado(&state).ultima_sync_ok.is_some());

    // 4. Encolar offline (siempre local primero) y 5. push.
    let agente_id = state.sesion.read().unwrap().as_ref().unwrap().usuario.id.clone();
    let dpi = format!("9{:012}", chrono::Utc::now().timestamp_millis() % 1_000_000_000_000);
    let id = garita::con_db(&state, |c| garita::encolar_acceso(c, &agente_id, &garita::NuevoAcceso {
        nombre_visitante: "Visitante Integración".into(),
        numero_dpi: dpi.clone(),
        residente_id: residente.id.clone(),
        placa: Some("p 123 abc".into()),
        notas: Some("test".into()),
        capturado_manualmente: true,
        invitacion_qr_id: None,
    })).expect("encolar");
    assert_eq!(sync::estado(&state).pendientes, 1);

    let subidos = sync::push_pendientes(&state).await.expect("push");
    assert_eq!(subidos, 1);
    let fila = garita::con_db(&state, |c| garita::listar_recientes(c, 10)).unwrap()
        .into_iter().find(|a| a.id_cliente == id).unwrap();
    assert_eq!(fila.estado, "sincronizado");
    assert_eq!(sync::estado(&state).pendientes, 0);

    // Un segundo push no duplica nada (la fila ya no está pendiente).
    assert_eq!(sync::push_pendientes(&state).await.unwrap(), 0);

    // Verificación en el backend: registrado_en (cliente) y recibido_en (servidor) separados, origen desktop.
    let jwt = auth::jwt_vigente(&state).await.unwrap();
    let activos: Value = reqwest::Client::new()
        .get(format!("{}/api/accesos/activos", e.api)).bearer_auth(&jwt)
        .send().await.unwrap().json().await.unwrap();
    assert!(activos.as_array().unwrap().iter().any(|a| a["visitante"]["numero_dpi"] == dpi));

    // Blacklist local: un DPI vetado no se encola.
    garita::con_db(&state, |c| {
        c.execute("INSERT INTO blacklist_local (id, numero_dpi, visitante_nombre, razon, fecha_fin, residente_id) VALUES ('bl-test', '1234500000000', 'X', 'vetado', NULL, NULL)", [])?;
        Ok(())
    }).unwrap();
    let err = garita::con_db(&state, |c| garita::encolar_acceso(c, &agente_id, &garita::NuevoAcceso {
        nombre_visitante: "Vetado".into(), numero_dpi: "1234500000000".into(), residente_id: residente.id.clone(),
        placa: None, notas: None, capturado_manualmente: false, invitacion_qr_id: None,
    })).unwrap_err();
    assert_eq!(err.codigo, "blacklist");

    // 5b. Simular caída de red: apuntar a un puerto muerto. Registrar sigue
    // funcionando (local), el push falla con backoff y no pierde nada; al
    // volver la red, la cola se vacía sola.
    let url_real = state.api_url();
    *state.config.write().unwrap() = crate::config::Config { api_url: "http://127.0.0.1:1".into() };
    let dpi2 = format!("8{:012}", chrono::Utc::now().timestamp_millis() % 1_000_000_000_000);
    let id2 = garita::con_db(&state, |c| garita::encolar_acceso(c, &agente_id, &garita::NuevoAcceso {
        nombre_visitante: "Offline Pérez".into(), numero_dpi: dpi2, residente_id: residente.id.clone(),
        placa: None, notas: None, capturado_manualmente: true, invitacion_qr_id: None,
    })).expect("encolar offline");
    let err = sync::push_pendientes(&state).await.unwrap_err();
    assert!(err.es_sin_conexion(), "{err:?}");
    let est = sync::estado(&state);
    assert!(!est.en_linea);
    assert_eq!(est.pendientes, 1);
    let fila2 = garita::con_db(&state, |c| garita::listar_recientes(c, 10)).unwrap()
        .into_iter().find(|a| a.id_cliente == id2).unwrap();
    assert_eq!((fila2.estado.as_str(), fila2.intentos), ("pendiente", 1));
    assert!(matches!(license::heartbeat(&state).await.unwrap(), license::EstadoLicencia::Activa),
        "sin red, el heartbeat fallido no cambia el estado (gracia)");

    // Vuelve la red: el backoff aún no venció (5 s), así que primero no sube nada…
    *state.config.write().unwrap() = crate::config::Config { api_url: url_real };
    assert_eq!(sync::push_pendientes(&state).await.unwrap(), 0);
    // …y cuando toca el reintento, se sincroniza.
    garita::con_db(&state, |c| { c.execute("UPDATE accesos_pendientes SET proximo_intento_en = '2000-01-01T00:00:00Z' WHERE id_cliente = ?1", [&id2])?; Ok(()) }).unwrap();
    assert_eq!(sync::push_pendientes(&state).await.unwrap(), 1);
    assert_eq!(sync::estado(&state).pendientes, 0);
    assert!(sync::estado(&state).en_linea);

    // 6. Heartbeat OK, luego kill switch.
    assert!(matches!(license::heartbeat(&state).await.unwrap(), license::EstadoLicencia::Activa));
    reqwest::Client::new()
        .patch(format!("{}/api/licencias/{lic_id}/revocar", e.api)).bearer_auth(&admin)
        .send().await.unwrap().error_for_status().expect("revocar");
    let est = license::heartbeat(&state).await.unwrap();
    assert_eq!(est, license::EstadoLicencia::Bloqueada { motivo: "licencia_revocada".into() });
    assert!(license::exigir_uso(&state).is_err(), "con licencia revocada no se puede registrar");
    assert!(sync::pull(&state).await.is_err(), "ni sincronizar");

    // Logout limpia el almacén seguro, no sólo la memoria.
    auth::logout(&state).await.unwrap();
    assert!(secure_store::leer(secure_store::CLAVE_SESION).unwrap().is_none());
    assert!(auth::dto(&state).usuario.is_none());
}
