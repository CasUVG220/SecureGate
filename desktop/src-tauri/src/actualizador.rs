//! Actualizaciones firmadas de la app (T13).
//!
//! Quién hace qué:
//! - **Buscar** una versión nueva es automático (la UI lo pide al arrancar y cada pocas horas): solo lee el manifiesto `latest.json`.
//! - **Instalar** NUNCA es automático: lo pide una persona con el botón «Actualizar ahora», y Rust lo rechaza si hay accesos sin
//!   enviar en la cola offline o una captura en curso. Actualizar reinicia la app; un acceso que solo existe en la cola local y una
//!   foto a medio procesar no deben quedar en el aire. (La cola vive en la BD cifrada y sobrevive al reinicio, pero el agente en pleno
//!   registro no.)
//! - Las firmas las verifica `tauri-plugin-updater` con la **llave pública que va dentro del instalador** (`plugins.updater.pubkey`).
//!   Esa llave NO se lee del archivo de configuración del equipo. La llave PRIVADA no existe en este repositorio ni en ninguna
//!   máquina de desarrollo: está en el secreto `TAURI_SIGNING_PRIVATE_KEY` del repositorio (ver `docs/actualizaciones_firmadas.md`).
//! - Sin llave pública (el valor de fábrica del repositorio) la función queda **apagada**: no hace ninguna petición de red.
//!
//! La política «¿se puede actualizar ahora?» y la validación del endpoint son funciones puras con pruebas; lo que toca el plugin y la
//! red (buscar, descargar, instalar) **no se pudo ejecutar** aquí y está marcado «sin ejecutar» en la documentación.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::error::{AppError, AppResult};
use crate::{garita, AppState};

/// La actualización encontrada en la última búsqueda, a la espera de que alguien la instale.
#[derive(Default)]
pub struct Pendiente(pub Mutex<Option<Update>>);

/// Por qué no se puede actualizar ahora.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Bloqueo {
    CapturaEnCurso,
    AccesosPendientes(u32),
}

impl Bloqueo {
    pub fn a_error(&self) -> AppError {
        match self {
            Bloqueo::CapturaEnCurso => AppError::new(
                "captura_en_curso",
                "Hay una captura en curso. Termina de registrar al visitante y vuelve a intentarlo.",
            ),
            Bloqueo::AccesosPendientes(n) => AppError::new(
                "accesos_pendientes",
                format!(
                    "Hay {n} acceso{} sin enviar al servidor. Espera a que se sincronicen (o recupera la conexión) y vuelve a intentarlo.",
                    if *n == 1 { "" } else { "s" }
                ),
            ),
        }
    }
}

/// ¿Se puede instalar ahora? Solo con la cola offline vacía y sin captura en curso. La captura se evalúa primero: es lo que la persona
/// puede resolver en segundos.
pub fn puede_actualizar(pendientes: u32, captura_en_curso: bool) -> Result<(), Bloqueo> {
    if captura_en_curso {
        return Err(Bloqueo::CapturaEnCurso);
    }
    if pendientes > 0 {
        return Err(Bloqueo::AccesosPendientes(pendientes));
    }
    Ok(())
}

/// Un endpoint de actualizaciones solo puede ser `https://` y sin credenciales incrustadas (el manifiesto viaja por internet; el
/// plugin además lo exige, esto da el error en español y antes de salir a la red).
pub fn validar_endpoint(url: &str) -> Result<url::Url, String> {
    let u = url::Url::parse(url.trim()).map_err(|_| "La dirección de actualizaciones no es válida".to_string())?;
    if u.scheme() != "https" {
        return Err("La dirección de actualizaciones debe empezar con https://".into());
    }
    if !u.username().is_empty() || u.password().is_some() || u.host_str().is_none() {
        return Err("La dirección de actualizaciones no puede llevar usuario ni contraseña".into());
    }
    Ok(u)
}

/// Una llave pública de minisign (la que genera `tauri signer generate`) es base64 de un texto de varias líneas que empieza con
/// «untrusted comment». Aquí solo se descartan los valores obviamente vacíos o de relleno; la verificación real la hace el plugin.
pub fn pubkey_configurada(pubkey: &str) -> bool {
    let p = pubkey.trim();
    !p.is_empty() && !p.to_uppercase().contains("PENDIENTE") && p.len() > 40
}

#[derive(Debug, Clone, Serialize)]
pub struct EstadoActualizador {
    /// ¿Hay llave pública en el instalador? Sin ella no se busca nada.
    pub configurada: bool,
    pub version_actual: &'static str,
    pub endpoint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResultadoBusqueda {
    pub disponible: bool,
    pub version: Option<String>,
    pub notas: Option<String>,
    pub fecha: Option<String>,
}

fn pubkey_del_instalador(app: &AppHandle) -> String {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|v| v.get("pubkey"))
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string()
}

fn endpoints_del_instalador(app: &AppHandle) -> Vec<String> {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|v| v.get("endpoints"))
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|e| e.as_str().map(str::to_string)).collect())
        .unwrap_or_default()
}

/// Endpoint efectivo: el del equipo (config.json) si lo hay, si no el del instalador.
fn endpoint_efectivo(app: &AppHandle, state: &AppState) -> Option<String> {
    state
        .config
        .read()
        .unwrap()
        .actualizador_endpoint
        .clone()
        .filter(|e| !e.trim().is_empty())
        .or_else(|| endpoints_del_instalador(app).into_iter().next())
}

/// Accesos que solo existen en la cola de ESTE equipo (todavía no subidos): los `pendiente`. Los `rechazado` ya los vio el servidor y los
/// `sincronizado` ya están allá.
pub fn contar_pendientes(conn: &rusqlite::Connection) -> AppResult<u32> {
    let n: i64 = conn.query_row("SELECT count(*) FROM accesos_pendientes WHERE estado = 'pendiente'", [], |r| r.get(0))?;
    Ok(n.max(0) as u32)
}

/// Sin BD abierta (equipo sin licencia) no hay cola y no hay nada que perder.
fn accesos_pendientes(state: &AppState) -> u32 {
    garita::con_db(state, contar_pendientes).unwrap_or(0)
}

#[tauri::command]
pub fn actualizacion_estado(app: AppHandle, state: State<'_, AppState>) -> EstadoActualizador {
    EstadoActualizador {
        configurada: pubkey_configurada(&pubkey_del_instalador(&app)),
        version_actual: env!("CARGO_PKG_VERSION"),
        endpoint: endpoint_efectivo(&app, &state),
    }
}

/// Consulta el manifiesto. No descarga ni instala nada.
#[tauri::command]
pub async fn actualizacion_buscar(
    app: AppHandle,
    state: State<'_, AppState>,
    pendiente: State<'_, Pendiente>,
) -> AppResult<ResultadoBusqueda> {
    let pubkey = pubkey_del_instalador(&app);
    if !pubkey_configurada(&pubkey) {
        return Err(AppError::new("actualizador_no_configurado", "Las actualizaciones no están configuradas en esta instalación"));
    }
    let endpoint = endpoint_efectivo(&app, &state)
        .ok_or_else(|| AppError::new("actualizador_no_configurado", "No hay dirección de actualizaciones"))?;
    let url = validar_endpoint(&endpoint).map_err(|m| AppError::new("actualizador_endpoint", m))?;

    let updater = app
        .updater_builder()
        .pubkey(pubkey)
        .endpoints(vec![url])
        .map_err(|e| AppError::new("actualizador_endpoint", e.to_string()))?
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| AppError::new("actualizador", e.to_string()))?;

    match updater.check().await {
        Ok(Some(u)) => {
            let r = ResultadoBusqueda {
                disponible: true,
                version: Some(u.version.clone()),
                notas: u.body.clone(),
                fecha: u.date.map(|d| d.to_string()),
            };
            *pendiente.0.lock().unwrap() = Some(u);
            Ok(r)
        }
        Ok(None) => {
            *pendiente.0.lock().unwrap() = None;
            Ok(ResultadoBusqueda { disponible: false, version: None, notas: None, fecha: None })
        }
        // Sin red no es un error de la app: la búsqueda se reintenta sola más tarde.
        Err(e) => Err(AppError::new("actualizador", e.to_string())),
    }
}

/// Descarga, verifica la firma e instala la actualización encontrada, y reinicia. Solo si `puede_actualizar`.
#[tauri::command]
pub async fn actualizacion_instalar(
    app: AppHandle,
    state: State<'_, AppState>,
    pendiente: State<'_, Pendiente>,
    captura_en_curso: bool,
) -> AppResult<()> {
    puede_actualizar(accesos_pendientes(&state), captura_en_curso).map_err(|b| b.a_error())?;
    let update = pendiente
        .0
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| AppError::new("sin_actualizacion", "No hay una actualización encontrada: busca de nuevo"))?;

    log::info!("Instalando la actualización {} (desde {})", update.version, update.current_version);
    // La firma se verifica DENTRO de download_and_install con la llave pública del instalador; si no coincide, falla antes de instalar.
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| AppError::new("actualizador", e.to_string()))?;

    // En Windows el instalador cierra y relanza la app; en los demás sistemas se reinicia aquí.
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn con_la_cola_vacia_y_sin_captura_se_puede_actualizar() {
        assert_eq!(puede_actualizar(0, false), Ok(()));
    }

    #[test]
    fn no_se_actualiza_con_accesos_pendientes_en_la_cola_offline() {
        assert_eq!(puede_actualizar(1, false), Err(Bloqueo::AccesosPendientes(1)));
        assert_eq!(puede_actualizar(37, false), Err(Bloqueo::AccesosPendientes(37)));
    }

    #[test]
    fn no_se_actualiza_con_una_captura_en_curso_y_esa_razon_manda() {
        assert_eq!(puede_actualizar(0, true), Err(Bloqueo::CapturaEnCurso));
        assert_eq!(puede_actualizar(5, true), Err(Bloqueo::CapturaEnCurso));
    }

    #[test]
    fn los_mensajes_dicen_que_hacer_y_concuerdan_en_numero() {
        let uno = Bloqueo::AccesosPendientes(1).a_error();
        assert_eq!(uno.codigo, "accesos_pendientes");
        assert!(uno.mensaje.contains("1 acceso sin enviar"), "{}", uno.mensaje);
        let varios = Bloqueo::AccesosPendientes(3).a_error();
        assert!(varios.mensaje.contains("3 accesos sin enviar"), "{}", varios.mensaje);
        assert_eq!(Bloqueo::CapturaEnCurso.a_error().codigo, "captura_en_curso");
    }

    #[test]
    fn el_endpoint_solo_acepta_https_sin_credenciales() {
        assert!(validar_endpoint("https://github.com/chatio/SecureGate/releases/latest/download/latest.json").is_ok());
        assert!(validar_endpoint("  https://actualizaciones.securegate.gt/latest.json  ").is_ok());
        for malo in [
            "http://github.com/x/latest.json",
            "ftp://x.com/latest.json",
            "file:///etc/passwd",
            "https://usuario:clave@x.com/latest.json",
            "https://usuario@x.com/latest.json",
            "javascript:alert(1)",
            "no es una url",
            "",
        ] {
            assert!(validar_endpoint(malo).is_err(), "debía rechazar {malo:?}");
        }
    }

    #[test]
    fn el_valor_de_fabrica_de_la_llave_publica_deja_la_funcion_apagada() {
        assert!(!pubkey_configurada(""));
        assert!(!pubkey_configurada("   "));
        assert!(!pubkey_configurada("PENDIENTE: pega aquí la llave pública"));
        assert!(!pubkey_configurada("corta"));
        // Forma de una llave real de minisign en base64 (generada para este ejemplo; no firma nada).
        let ejemplo = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDAwMDAwMDAwMDAwMDAwMDAKUldRQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE9";
        assert!(pubkey_configurada(ejemplo));
    }

    /// El plugin EXIGE su bloque en tauri.conf.json: sin él la app ni arranca. Esta prueba arma una app simulada con el bloque real del
    /// repositorio (llave pública vacía = función apagada) y comprueba que el plugin se inicializa; y sin el bloque, que falla.
    #[test]
    fn el_plugin_arranca_con_el_bloque_de_tauri_conf_json_y_la_llave_de_fabrica_vacia() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let updater = conf["plugins"]["updater"].clone();
        assert_eq!(updater["pubkey"], "", "la llave pública de fábrica debe ir vacía (la inyecta el flujo de publicación)");
        assert!(!pubkey_configurada(updater["pubkey"].as_str().unwrap()));
        for e in updater["endpoints"].as_array().unwrap() {
            assert!(validar_endpoint(e.as_str().unwrap()).is_ok(), "endpoint de fábrica inválido: {e}");
        }

        let mut ctx = tauri::test::mock_context(tauri::test::noop_assets());
        ctx.config_mut().plugins.0.insert("updater".into(), updater);
        let app = tauri::test::mock_builder().plugin(tauri_plugin_updater::Builder::new().build()).build(ctx);
        assert!(app.is_ok(), "el plugin no arranca con la configuración del repositorio: {:?}", app.err());

        let sin_bloque = tauri::test::mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(tauri::test::mock_context(tauri::test::noop_assets()));
        assert!(sin_bloque.is_err(), "sin `plugins.updater` el plugin debería fallar al arrancar (por eso el bloque es obligatorio)");
    }

    #[test]
    fn solo_cuentan_los_accesos_que_siguen_sin_subir() {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::aplicar_esquema(&c).unwrap();
        assert_eq!(contar_pendientes(&c).unwrap(), 0);
        for (id, estado) in [("a", "pendiente"), ("b", "pendiente"), ("c", "sincronizado"), ("d", "rechazado")] {
            c.execute(
                "INSERT INTO accesos_pendientes (id_cliente, payload, registrado_en, estado, nombre_visitante, numero_dpi) VALUES (?1, '{}', '2026-10-11T12:00:00Z', ?2, 'V', '1')",
                rusqlite::params![id, estado],
            )
            .unwrap();
        }
        assert_eq!(contar_pendientes(&c).unwrap(), 2);
        assert_eq!(puede_actualizar(contar_pendientes(&c).unwrap(), false), Err(Bloqueo::AccesosPendientes(2)));
        c.execute("UPDATE accesos_pendientes SET estado = 'sincronizado' WHERE estado = 'pendiente'", []).unwrap();
        assert_eq!(puede_actualizar(contar_pendientes(&c).unwrap(), false), Ok(()));
    }

    #[test]
    fn el_estado_serializa_para_la_interfaz() {
        let e = EstadoActualizador { configurada: false, version_actual: "0.1.0", endpoint: None };
        let j = serde_json::to_value(&e).unwrap();
        assert_eq!(j["configurada"], false);
        assert_eq!(j["version_actual"], "0.1.0");
    }
}
