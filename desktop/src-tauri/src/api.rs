//! Cliente HTTP hacia el backend de SecureGate.
//!
//! Todos los secretos (JWT del agente, token de licencia) se inyectan aquí,
//! en Rust. El WebView nunca los ve.

use reqwest::{Client, Method, RequestBuilder, StatusCode};
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::time::Duration;

use crate::error::{AppError, AppResult};

pub const HEADER_LICENCIA: &str = "x-licencia-token";

#[derive(Clone)]
pub struct Api {
    http: Client,
}

/// Credenciales que acompañan una petición. Ambas opcionales: activar una
/// licencia no lleva ninguna; sincronizar lleva las dos.
#[derive(Default, Clone)]
pub struct Credenciales<'a> {
    pub jwt: Option<&'a str>,
    pub licencia: Option<&'a str>,
}

impl Api {
    pub fn new() -> Self {
        let http = Client::builder()
            .timeout(Duration::from_secs(15))
            .connect_timeout(Duration::from_secs(5))
            .user_agent(concat!("SecureGate-Garita/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("reqwest client");
        Self { http }
    }

    pub fn http_client(&self) -> Client {
        self.http.clone()
    }

    fn req(&self, method: Method, base: &str, path: &str, cred: &Credenciales) -> RequestBuilder {
        let mut rb = self.http.request(method, format!("{base}/api{path}"));
        if let Some(jwt) = cred.jwt {
            rb = rb.bearer_auth(jwt);
        }
        if let Some(lic) = cred.licencia {
            rb = rb.header(HEADER_LICENCIA, lic);
        }
        rb
    }

    pub async fn get<T: DeserializeOwned>(&self, base: &str, path: &str, cred: &Credenciales<'_>) -> AppResult<T> {
        let res = self.req(Method::GET, base, path, cred).send().await?;
        Self::parsear(res).await
    }

    /// GET con parámetros de consulta; reqwest los codifica, así no hay que
    /// escapar a mano lo que escribe el agente (una placa, por ejemplo).
    pub async fn get_con<T: DeserializeOwned>(
        &self,
        base: &str,
        path: &str,
        query: &[(&str, &str)],
        cred: &Credenciales<'_>,
    ) -> AppResult<T> {
        let res = self.req(Method::GET, base, path, cred).query(query).send().await?;
        Self::parsear(res).await
    }

    pub async fn put<T: DeserializeOwned>(
        &self,
        base: &str,
        path: &str,
        body: &Value,
        cred: &Credenciales<'_>,
    ) -> AppResult<T> {
        let res = self.req(Method::PUT, base, path, cred).json(body).send().await?;
        Self::parsear(res).await
    }

    pub async fn post<T: DeserializeOwned>(
        &self,
        base: &str,
        path: &str,
        body: &Value,
        cred: &Credenciales<'_>,
    ) -> AppResult<T> {
        let res = self.req(Method::POST, base, path, cred).json(body).send().await?;
        Self::parsear(res).await
    }

    /// Traduce la respuesta a `AppError` con un `codigo` que el frontend pueda
    /// enrutar. El backend devuelve `{ error, estado? }`; `estado: 'revocada'`
    /// es el kill switch y se propaga como `licencia_revocada`.
    async fn parsear<T: DeserializeOwned>(res: reqwest::Response) -> AppResult<T> {
        let status = res.status();
        let texto = res.text().await.unwrap_or_default();
        if status.is_success() {
            return serde_json::from_str::<T>(&texto)
                .map_err(|e| AppError::new("respuesta_invalida", format!("{e}: {}", &texto.chars().take(200).collect::<String>())));
        }
        let cuerpo: Value = serde_json::from_str(&texto).unwrap_or(Value::Null);
        let mensaje = cuerpo
            .get("error")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| {
                // express-validator: { errors: [{ msg, path }] }
                cuerpo.get("errors").and_then(Value::as_array).and_then(|a| a.first()).map(|e| {
                    format!("{} ({})", e.get("msg").and_then(Value::as_str).unwrap_or("inválido"),
                            e.get("path").and_then(Value::as_str).unwrap_or("?"))
                })
            })
            .unwrap_or_else(|| format!("HTTP {}", status.as_u16()));
        let estado = cuerpo.get("estado").and_then(Value::as_str);
        let codigo = match (status, estado) {
            (_, Some("revocada")) => "licencia_revocada",
            (_, Some("invalida")) => "licencia_invalida",
            // 423: la empresa está suspendida o de baja; la licencia sigue
            // siendo válida y se recupera sola cuando el owner reactiva.
            (_, Some("suspendida")) => "empresa_suspendida",
            (StatusCode::UNAUTHORIZED, _) => "no_autorizado",
            (StatusCode::FORBIDDEN, _) => "prohibido",
            (StatusCode::NOT_FOUND, _) => "no_encontrado",
            (StatusCode::CONFLICT, _) => "conflicto",
            (StatusCode::TOO_MANY_REQUESTS, _) => "demasiadas_solicitudes",
            (s, _) if s.is_server_error() => "servidor",
            _ => "solicitud_invalida",
        };
        Err(AppError::http(status.as_u16(), codigo, mensaje))
    }
}

impl Default for Api {
    fn default() -> Self {
        Self::new()
    }
}
