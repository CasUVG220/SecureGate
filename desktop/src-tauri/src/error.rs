//! Error único que cruza la frontera Rust → WebView.
//!
//! Los comandos Tauri devuelven `Result<T, AppError>`; el frontend recibe
//! `{ codigo, mensaje }` y decide por `codigo` (p. ej. `licencia_revocada`
//! bloquea la app, `sin_conexion` sólo cambia el indicador).

use serde::Serialize;

#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[error("{codigo}: {mensaje}")]
pub struct AppError {
    pub codigo: String,
    pub mensaje: String,
    /// HTTP status cuando el error viene del backend.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
}

impl AppError {
    pub fn new(codigo: &str, mensaje: impl Into<String>) -> Self {
        Self { codigo: codigo.to_string(), mensaje: mensaje.into(), status: None }
    }
    pub fn http(status: u16, codigo: &str, mensaje: impl Into<String>) -> Self {
        Self { codigo: codigo.to_string(), mensaje: mensaje.into(), status: Some(status) }
    }
    pub fn interno(mensaje: impl Into<String>) -> Self {
        Self::new("interno", mensaje)
    }
    pub fn sin_conexion(detalle: impl Into<String>) -> Self {
        Self::new("sin_conexion", detalle)
    }
    pub fn es_sin_conexion(&self) -> bool {
        self.codigo == "sin_conexion"
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::new("db", e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::new("json", e.to_string())
    }
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_connect() || e.is_timeout() || e.is_request() {
            AppError::sin_conexion(e.to_string())
        } else {
            AppError::new("http", e.to_string())
        }
    }
}

impl From<keyring_core::Error> for AppError {
    fn from(e: keyring_core::Error) -> Self {
        AppError::new("almacen_seguro", e.to_string())
    }
}

impl From<tauri::Error> for AppError {
    fn from(e: tauri::Error) -> Self {
        AppError::interno(e.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
