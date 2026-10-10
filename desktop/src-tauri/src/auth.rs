//! Sesión del agente (la persona), independiente de la licencia (la máquina).
//!
//! Se usa el `POST /api/auth/login` existente. El JWT de acceso dura 1 h y el
//! backend entrega un refresh token en cookie httpOnly; aquí lo leemos del
//! `Set-Cookie` y lo guardamos junto al JWT en el almacén seguro del SO, así
//! la sesión sobrevive a reiniciar la app y a turnos largos sin volver a
//! pedir contraseña. Nada de esto llega al WebView.
//!
//! Offline: registrar accesos sólo necesita saber QUIÉN es el agente
//! (`usuario.id`); un JWT vencido no bloquea la garita. Sólo la sincronización
//! necesita un JWT vigente, y lo renueva sola.

use base64::Engine;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;

use crate::api::Credenciales;
use crate::error::{AppError, AppResult};
use crate::{secure_store, AppState};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Usuario {
    pub id: String,
    pub nombre: String,
    pub email: String,
    pub rol: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sesion {
    pub jwt: String,
    pub refresh_token: Option<String>,
    pub usuario: Usuario,
    pub iniciada_en: DateTime<Utc>,
    /// El refresh falló de forma definitiva (401 o 423): hay que volver a hacer
    /// login para sincronizar, pero la garita puede seguir registrando localmente.
    #[serde(default)]
    pub requiere_login: bool,
    /// Texto del servidor cuando el refresh se rechazó porque la empresa está
    /// suspendida o dada de baja (423): se muestra en la pantalla de acceso en
    /// lugar del genérico «tu sesión venció».
    #[serde(default)]
    pub bloqueo: Option<String>,
}

#[derive(Serialize)]
pub struct SesionDto {
    pub usuario: Option<Usuario>,
    pub requiere_login: bool,
    pub iniciada_en: Option<DateTime<Utc>>,
    pub motivo_bloqueo: Option<String>,
}

pub fn dto(state: &AppState) -> SesionDto {
    let s = state.sesion.read().unwrap().clone();
    SesionDto {
        usuario: s.as_ref().map(|s| s.usuario.clone()),
        requiere_login: s.as_ref().map(|s| s.requiere_login).unwrap_or(false),
        iniciada_en: s.as_ref().map(|s| s.iniciada_en),
        motivo_bloqueo: s.as_ref().and_then(|s| s.bloqueo.clone()),
    }
}

fn guardar(state: &AppState, s: Option<Sesion>) -> AppResult<()> {
    match &s {
        Some(v) => secure_store::guardar_json(secure_store::CLAVE_SESION, v)?,
        None => secure_store::borrar(secure_store::CLAVE_SESION)?,
    }
    *state.sesion.write().unwrap() = s;
    Ok(())
}

/// Exige que haya un agente con sesión iniciada (aunque su JWT haya vencido: la
/// garita sigue operando offline). Devuelve quién es. Lo usan los comandos que
/// actúan sobre el mundo físico (talanquera) y que antes se podían invocar sin
/// ninguna sesión desde el WebView.
pub fn exigir_sesion(state: &AppState) -> AppResult<Usuario> {
    state
        .sesion
        .read()
        .unwrap()
        .as_ref()
        .map(|s| s.usuario.clone())
        .ok_or_else(|| AppError::new("sin_sesion", "Inicia sesión para operar la talanquera"))
}

/// Segundos hasta que venza el JWT, leyendo el claim `exp` sin verificar la
/// firma (la verifica el backend; aquí sólo decidimos si renovar).
pub fn segundos_para_vencer(jwt: &str) -> Option<i64> {
    let payload = jwt.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload).ok()?;
    let v: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let exp = v.get("exp")?.as_i64()?;
    Some(exp - Utc::now().timestamp())
}

#[derive(Deserialize)]
struct RespLogin {
    token: String,
    usuario: Usuario,
}

#[derive(Deserialize)]
struct RespRefresh {
    token: String,
}

/// Extrae `refresh_token=…` de los headers Set-Cookie de una respuesta.
fn extraer_refresh(headers: &reqwest::header::HeaderMap) -> Option<String> {
    headers
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|h| h.to_str().ok())
        .find_map(|c| c.split(';').next()?.trim().strip_prefix("refresh_token=").map(str::to_string))
        .filter(|s| !s.is_empty())
}

/// Lo que se le dice a quien llega con una cuenta que tiene la verificación en dos pasos (SCRUM-123).
const MSG_DOS_PASOS: &str =
    "Tu cuenta tiene la verificación en dos pasos, que esta app no admite. Inicia sesión desde la versión web de SecureGate.";

/// ¿La respuesta del login es el desafío de la verificación en dos pasos y no una sesión? Con ella activa el servidor
/// contesta 200 con `{ requiere_2fa: true, desafio }` en vez de `{ token, usuario }`. La app de escritorio es del
/// personal de garita, que no la usa; si un administrador con la verificación activa entra aquí, se le dice por dónde
/// hacerlo en vez de mostrar un error de formato («missing field `token`»).
fn pide_dos_pasos(cuerpo: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(cuerpo)
        .ok()
        .and_then(|v| v.get("requiere_2fa").and_then(|b| b.as_bool()))
        .unwrap_or(false)
}

pub async fn login(state: &AppState, email: &str, password: &str) -> AppResult<SesionDto> {
    let base = state.api_url();
    // Se usa el cliente crudo para poder leer Set-Cookie (Api::post sólo
    // devuelve el JSON).
    let res = state
        .api_http()
        .post(format!("{base}/api/auth/login"))
        .json(&json!({ "email": email.trim(), "password": password, "portal": "personal" }))
        .send()
        .await?;
    let refresh = extraer_refresh(res.headers());
    let status = res.status();
    let texto = res.text().await.unwrap_or_default();
    if !status.is_success() {
        let v: serde_json::Value = serde_json::from_str(&texto).unwrap_or_default();
        let msg = v.get("error").and_then(|e| e.as_str()).unwrap_or("No se pudo iniciar sesión").to_string();
        let codigo = match status.as_u16() {
            401 => "credenciales",
            423 => "empresa_suspendida",
            429 => "demasiadas_solicitudes",
            _ => "login",
        };
        return Err(AppError::http(status.as_u16(), codigo, msg));
    }
    if pide_dos_pasos(&texto) {
        return Err(AppError::new("dos_pasos", MSG_DOS_PASOS));
    }
    let r: RespLogin = serde_json::from_str(&texto)?;
    if r.usuario.rol == "residente" {
        return Err(AppError::new("rol", "Esta app es para personal de garita, no para residentes"));
    }
    state.marcar_conexion(true);
    guardar(
        state,
        Some(Sesion {
            jwt: r.token,
            refresh_token: refresh,
            usuario: r.usuario,
            iniciada_en: Utc::now(),
            requiere_login: false,
            bloqueo: None,
        }),
    )?;
    Ok(dto(state))
}

/// Qué significa la respuesta de `POST /api/auth/refresh`.
#[derive(Debug, PartialEq)]
pub enum ResultadoRefresh {
    Renovada,
    /// 401: el refresh token ya no sirve (vencido, revocado, usuario dado de baja).
    SesionVencida,
    /// 423: la empresa está suspendida o dada de baja; lleva el texto del servidor.
    EmpresaBloqueada(String),
    Otro(u16),
}

pub fn clasificar_refresh(status: u16, cuerpo: &str) -> ResultadoRefresh {
    match status {
        200..=299 => ResultadoRefresh::Renovada,
        401 => ResultadoRefresh::SesionVencida,
        423 => {
            let v: serde_json::Value = serde_json::from_str(cuerpo).unwrap_or_default();
            let mensaje = v
                .get("error")
                .and_then(|e| e.as_str())
                .filter(|m| !m.trim().is_empty())
                .unwrap_or("Las operaciones de tu empresa están suspendidas. Contacta al administrador de SecureGate.")
                .to_string();
            ResultadoRefresh::EmpresaBloqueada(mensaje)
        }
        otro => ResultadoRefresh::Otro(otro),
    }
}

/// Devuelve un JWT vigente, renovándolo con el refresh token si está por
/// vencer. `Err(sesion_vencida)` si no hay forma de obtener uno.
pub async fn jwt_vigente(state: &AppState) -> AppResult<String> {
    let Some(mut s) = state.sesion.read().unwrap().clone() else {
        return Err(AppError::new("sin_sesion", "Ningún agente ha iniciado sesión"));
    };
    if segundos_para_vencer(&s.jwt).unwrap_or(0) > 120 {
        return Ok(s.jwt);
    }
    let Some(refresh) = s.refresh_token.clone() else {
        return Err(AppError::new("sesion_vencida", "La sesión venció; inicia sesión de nuevo"));
    };
    let base = state.api_url();
    let res = state
        .api_http()
        .post(format!("{base}/api/auth/refresh"))
        .header(reqwest::header::COOKIE, format!("refresh_token={refresh}"))
        .send()
        .await?;
    let nuevo_refresh = extraer_refresh(res.headers());
    let status = res.status();
    let texto = res.text().await.unwrap_or_default();
    match clasificar_refresh(status.as_u16(), &texto) {
        ResultadoRefresh::Renovada => {}
        ResultadoRefresh::SesionVencida => {
            s.requiere_login = true;
            s.bloqueo = None;
            guardar(state, Some(s))?;
            return Err(AppError::new("sesion_vencida", "La sesión venció; inicia sesión de nuevo"));
        }
        ResultadoRefresh::EmpresaBloqueada(mensaje) => {
            // La empresa se suspendió con la sesión abierta (S-11): hay que volver a iniciar sesión,
            // y la pantalla de acceso explica por qué (con el motivo que mandó el servidor).
            s.requiere_login = true;
            s.bloqueo = Some(mensaje.clone());
            guardar(state, Some(s))?;
            return Err(AppError::http(423, "empresa_suspendida", mensaje));
        }
        ResultadoRefresh::Otro(codigo) => {
            return Err(AppError::http(codigo, "servidor", "No se pudo renovar la sesión"));
        }
    }
    let r: RespRefresh = serde_json::from_str(&texto)?;
    s.jwt = r.token;
    if nuevo_refresh.is_some() {
        s.refresh_token = nuevo_refresh;
    }
    s.requiere_login = false;
    s.bloqueo = None;
    let jwt = s.jwt.clone();
    guardar(state, Some(s))?;
    Ok(jwt)
}

/// Limpia la sesión del almacén seguro (no sólo de memoria).
pub fn cerrar_sesion_local(state: &AppState) -> AppResult<()> {
    guardar(state, None)
}

pub async fn logout(state: &AppState) -> AppResult<()> {
    let s = state.sesion.read().unwrap().clone();
    // Revocar el refresh token en el servidor es cortesía: si no hay red, la
    // sesión local se borra igual.
    if let Some(Sesion { refresh_token: Some(r), .. }) = s {
        let base = state.api_url();
        let _ = state
            .api_http()
            .post(format!("{base}/api/auth/logout"))
            .header(reqwest::header::COOKIE, format!("refresh_token={r}"))
            .send()
            .await;
    }
    cerrar_sesion_local(state)
}

/// Credenciales completas (agente + licencia) para llamadas sincronizadas.
pub async fn credenciales(state: &AppState) -> AppResult<(String, String)> {
    let lic = crate::license::exigir_uso(state)?;
    let jwt = jwt_vigente(state).await?;
    Ok((jwt, lic.token))
}

#[allow(dead_code)]
pub fn cred<'a>(jwt: &'a str, lic: &'a str) -> Credenciales<'a> {
    Credenciales { jwt: Some(jwt), licencia: Some(lic) }
}

// ── Comandos Tauri ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn sesion_estado(state: State<'_, AppState>) -> SesionDto {
    dto(&state)
}

#[tauri::command]
pub async fn sesion_login(state: State<'_, AppState>, email: String, password: String) -> AppResult<SesionDto> {
    login(&state, &email, &password).await
}

#[tauri::command]
pub async fn sesion_logout(state: State<'_, AppState>) -> AppResult<()> {
    logout(&state).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jwt_con_exp(exp: i64) -> String {
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(format!("{{\"exp\":{exp}}}"));
        format!("eyJhbGciOiJIUzI1NiJ9.{payload}.firma")
    }

    #[test]
    fn lee_exp_del_jwt_sin_verificar_firma() {
        let dentro_de_1h = Utc::now().timestamp() + 3600;
        let s = segundos_para_vencer(&jwt_con_exp(dentro_de_1h)).unwrap();
        assert!((3590..=3600).contains(&s));
        assert!(segundos_para_vencer(&jwt_con_exp(Utc::now().timestamp() - 10)).unwrap() < 0);
        assert_eq!(segundos_para_vencer("basura"), None);
    }

    #[test]
    fn clasifica_la_respuesta_del_refresh() {
        assert_eq!(clasificar_refresh(200, "{\"token\":\"x\"}"), ResultadoRefresh::Renovada);
        assert_eq!(clasificar_refresh(401, ""), ResultadoRefresh::SesionVencida);
        assert_eq!(clasificar_refresh(500, "boom"), ResultadoRefresh::Otro(500));
        assert_eq!(clasificar_refresh(429, ""), ResultadoRefresh::Otro(429));
    }

    #[test]
    fn el_423_lleva_el_motivo_que_manda_el_servidor() {
        let cuerpo = r#"{"error":"Las operaciones de Condominio X están suspendidas: Falta de pago. Contacta al administrador de SecureGate.","estado":"suspendida","codigo":"empresa_suspendida"}"#;
        match clasificar_refresh(423, cuerpo) {
            ResultadoRefresh::EmpresaBloqueada(m) => assert!(m.contains("Falta de pago"), "{m}"),
            otro => panic!("esperaba EmpresaBloqueada, salió {otro:?}"),
        }
        // Sin cuerpo legible igual se bloquea, con un texto de respaldo.
        match clasificar_refresh(423, "no es json") {
            ResultadoRefresh::EmpresaBloqueada(m) => assert!(m.contains("suspendidas")),
            otro => panic!("esperaba EmpresaBloqueada, salió {otro:?}"),
        }
    }

    #[test]
    fn la_sesion_guardada_antes_del_cambio_se_sigue_leyendo() {
        // Sesiones persistidas por versiones anteriores no tienen `bloqueo`: no deben fallar al leerse.
        let json = r#"{"jwt":"a.b.c","refresh_token":"r","usuario":{"id":"1","nombre":"Ana","email":"a@x.com","rol":"agente"},"iniciada_en":"2026-10-10T00:00:00Z"}"#;
        let s: Sesion = serde_json::from_str(json).unwrap();
        assert!(!s.requiere_login);
        assert_eq!(s.bloqueo, None);
    }

    #[test]
    fn reconoce_el_desafio_de_dos_pasos_y_no_confunde_una_sesion_normal() {
        assert!(pide_dos_pasos(r#"{"requiere_2fa":true,"desafio":"abc.def.ghi"}"#));
        assert!(!pide_dos_pasos(r#"{"requiere_2fa":false}"#));
        assert!(!pide_dos_pasos(r#"{"token":"a.b.c","usuario":{"id":"1","nombre":"Ana","email":"a@x.com","rol":"agente"}}"#));
        assert!(!pide_dos_pasos("no es json"));
        assert!(!pide_dos_pasos(""));
        // El mensaje dice qué hacer, sin jerga.
        assert!(MSG_DOS_PASOS.contains("versión web"));
    }

    #[test]
    fn extrae_refresh_token_de_set_cookie() {
        let mut h = reqwest::header::HeaderMap::new();
        h.append(reqwest::header::SET_COOKIE, "otra=1; Path=/".parse().unwrap());
        h.append(reqwest::header::SET_COOKIE, "refresh_token=abc123; Path=/; HttpOnly; SameSite=Strict".parse().unwrap());
        assert_eq!(extraer_refresh(&h).as_deref(), Some("abc123"));
        assert_eq!(extraer_refresh(&reqwest::header::HeaderMap::new()), None);
    }
}
