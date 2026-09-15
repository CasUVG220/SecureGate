//! Configuración NO secreta de la app (URL del backend). Vive en un JSON en
//! el directorio de datos de la app; lo secreto va a `secure_store`.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

pub const API_URL_DEFAULT: &str = "http://localhost:3000";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub api_url: String,
}

impl Default for Config {
    fn default() -> Self {
        Self { api_url: std::env::var("SECUREGATE_API_URL").unwrap_or_else(|_| API_URL_DEFAULT.to_string()) }
    }
}

impl Config {
    pub fn ruta(dir_datos: &Path) -> PathBuf {
        dir_datos.join("config.json")
    }

    pub fn cargar(dir_datos: &Path) -> Config {
        std::fs::read_to_string(Self::ruta(dir_datos))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn guardar(&self, dir_datos: &Path) -> AppResult<()> {
        std::fs::create_dir_all(dir_datos).map_err(|e| AppError::interno(e.to_string()))?;
        std::fs::write(Self::ruta(dir_datos), serde_json::to_string_pretty(self)?)
            .map_err(|e| AppError::interno(e.to_string()))
    }

    /// URL sin barra final, con esquema. Rechaza basura antes de guardarla.
    ///
    /// Esta URL es a donde Rust manda el JWT del agente y el token de licencia,
    /// así que se valida el transporte: `https://` siempre; `http://` sólo hacia
    /// el propio equipo o una red privada (desarrollo, o una garita con el
    /// servidor en la LAN del condominio). Un `http://` hacia internet pondría
    /// las credenciales en claro, y un `usuario@host` engaña a quien lee la URL.
    pub fn normalizar_url(url: &str) -> AppResult<String> {
        let u = url.trim().trim_end_matches('/').to_string();
        let https = u.starts_with("https://");
        if !(u.starts_with("http://") || https) || u.len() < 10 {
            return Err(AppError::new("config", "La URL del servidor debe empezar con http:// o https://"));
        }
        let host = host_de(&u).ok_or_else(|| AppError::new("config", "La URL del servidor no es válida"))?;
        if !https && !es_host_local(&host) {
            return Err(AppError::new(
                "config",
                "Un servidor fuera de tu red debe usar https:// (http:// sólo se admite en localhost o en una red privada)",
            ));
        }
        Ok(u)
    }
}

/// Host de una URL http(s) ya con esquema. `None` si trae credenciales
/// (`usuario@`), espacios o no hay host.
fn host_de(url: &str) -> Option<String> {
    let resto = url.split_once("://")?.1;
    let autoridad = resto.split(['/', '?', '#']).next()?;
    if autoridad.is_empty() || autoridad.contains('@') || autoridad.chars().any(char::is_whitespace) {
        return None;
    }
    let host = if let Some(v6) = autoridad.strip_prefix('[') {
        v6.split(']').next()?.to_string() // [::1]:3000 → ::1
    } else {
        autoridad.rsplit_once(':').map_or(autoridad, |(h, _)| h).to_string()
    };
    if host.is_empty() { None } else { Some(host.to_lowercase()) }
}

/// `localhost`, loopback o rango privado (10/8, 172.16/12, 192.168/16, 169.254/16).
fn es_host_local(host: &str) -> bool {
    if host == "localhost" || host == "::1" || host.ends_with(".localhost") || host.ends_with(".local") {
        return true;
    }
    let partes: Vec<u8> = host.split('.').filter_map(|p| p.parse().ok()).collect();
    if partes.len() != 4 || host.split('.').count() != 4 {
        return false;
    }
    matches!(
        (partes[0], partes[1]),
        (127, _) | (10, _) | (192, 168) | (169, 254) | (172, 16..=31)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizar_url_quita_barra_final_y_valida_esquema() {
        assert_eq!(Config::normalizar_url(" https://api.securegate.gt/ ").unwrap(), "https://api.securegate.gt");
        assert!(Config::normalizar_url("api.securegate.gt").is_err());
        assert!(Config::normalizar_url("").is_err());
    }

    #[test]
    fn http_solo_hacia_localhost_o_red_privada() {
        for ok in [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://10.0.0.5:3000",
            "http://192.168.1.20:3000",
            "http://172.16.4.9",
            "http://172.31.255.1:3000",
            "http://[::1]:3000",
            "http://garita.local:3000",
            "https://api.securegate.gt",
            "https://34.1.2.3:3000",
        ] {
            assert!(Config::normalizar_url(ok).is_ok(), "debería aceptar {ok}");
        }
        for mal in [
            "http://api.securegate.gt",
            "http://34.1.2.3:3000",
            "http://172.32.0.1:3000",      // fuera del rango 172.16/12
            "http://192.169.1.1",
            "http://10.0.0.5.evil.com",    // parece privada pero es un dominio
            "http://localhost.evil.com",
        ] {
            assert!(Config::normalizar_url(mal).is_err(), "debería rechazar {mal}");
        }
    }

    #[test]
    fn rechaza_credenciales_en_la_url_y_hosts_vacios() {
        for mal in ["https://legitimo.com@evil.com", "https://user:pw@evil.com", "https://", "https:///ruta", "https://a b.com"] {
            assert!(Config::normalizar_url(mal).is_err(), "debería rechazar {mal}");
        }
    }

    #[test]
    fn cargar_devuelve_default_si_no_hay_archivo() {
        let dir = tempfile::tempdir().unwrap();
        let c = Config::cargar(dir.path());
        assert!(c.api_url.starts_with("http"));
        let nueva = Config { api_url: "http://10.0.0.5:3000".into() };
        nueva.guardar(dir.path()).unwrap();
        assert_eq!(Config::cargar(dir.path()).api_url, "http://10.0.0.5:3000");
    }
}
