//! Almacén seguro de secretos (token de licencia, sesión del agente).
//!
//! Decisión: `keyring-core` + almacén nativo por plataforma.
//! - Windows → `windows-native-keyring-store` = **Windows Credential Manager**
//!   (lo que pide PRODUCT.md). El blob lo cifra DPAPI con la cuenta del
//!   usuario de Windows; otro usuario de la misma PC no lo lee.
//! - macOS (sólo desarrollo) → `apple-native-keyring-store` = Keychain.
//!
//! Por qué no `tauri-plugin-stronghold`: Stronghold es una bóveda cifrada en
//! un archivo cuya clave hay que guardar en algún lado — que es exactamente el
//! problema que queremos resolver. El almacén del SO ya resuelve dónde vive la
//! clave. Por qué no `tauri-plugin-store`: es JSON en texto plano.
//!
//! Los secretos nunca pasan al WebView: Rust los lee del almacén y los pone
//! en los headers HTTP; el frontend sólo recibe `usuario` y estados.
//!
//! Límite práctico: Credential Manager acepta blobs de hasta 2560 bytes por
//! credencial. Los JSON que guardamos aquí rondan los 600-900 bytes.

use keyring_core::{Entry, Error as KeyringError};
use std::sync::Once;

use crate::error::{AppError, AppResult};

const SERVICE: &str = "SecureGate Garita";

pub const CLAVE_LICENCIA: &str = "licencia";
pub const CLAVE_SESION: &str = "sesion";
pub const CLAVE_DB_SAL: &str = "db_sal";

static INIT: Once = Once::new();

/// Registra el almacén nativo de la plataforma como almacén por defecto de
/// keyring-core. Idempotente; se llama al arrancar.
pub fn inicializar() -> AppResult<()> {
    let mut resultado: AppResult<()> = Ok(());
    INIT.call_once(|| {
        #[cfg(windows)]
        let store = windows_native_keyring_store::Store::new();
        #[cfg(target_os = "macos")]
        let store = apple_native_keyring_store::keychain::Store::new();
        #[cfg(not(any(windows, target_os = "macos")))]
        let store: Result<std::sync::Arc<keyring_core::CredentialStore>, KeyringError> =
            Err(KeyringError::NotSupportedByStore("plataforma sin almacén nativo".into()));

        match store {
            Ok(s) => keyring_core::set_default_store(s),
            Err(e) => resultado = Err(AppError::new("almacen_seguro", format!("no se pudo abrir el almacén del SO: {e}"))),
        }
    });
    resultado
}

/// Almacén en memoria para tests de integración: nada toca el Keychain /
/// Credential Manager real.
#[cfg(test)]
pub fn inicializar_mock() {
    INIT.call_once(|| keyring_core::set_default_store(keyring_core::mock::Store::new().unwrap()));
}

fn entry(clave: &str) -> AppResult<Entry> {
    Ok(Entry::new(SERVICE, clave)?)
}

pub fn guardar(clave: &str, valor: &str) -> AppResult<()> {
    entry(clave)?.set_password(valor)?;
    Ok(())
}

/// `Ok(None)` si no hay nada guardado bajo esa clave.
pub fn leer(clave: &str) -> AppResult<Option<String>> {
    match entry(clave)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Borra la credencial del almacén del SO (no sólo de memoria). No falla si
/// no existía.
pub fn borrar(clave: &str) -> AppResult<()> {
    match entry(clave)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

pub fn guardar_json<T: serde::Serialize>(clave: &str, valor: &T) -> AppResult<()> {
    guardar(clave, &serde_json::to_string(valor)?)
}

pub fn leer_json<T: serde::de::DeserializeOwned>(clave: &str) -> AppResult<Option<T>> {
    match leer(clave)? {
        Some(s) => Ok(Some(serde_json::from_str(&s)?)),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    //! Contra el almacén real del SO. En macOS puede pedir permiso de
    //! Keychain la primera vez; se usa una clave de prueba propia para no
    //! tocar la licencia/sesión reales.
    use super::*;

    #[test]
    #[ignore = "toca el almacén de credenciales del SO; correr con --ignored"]
    fn ciclo_guardar_leer_borrar() {
        inicializar().unwrap();
        let clave = "test-ciclo";
        guardar(clave, "secreto").unwrap();
        assert_eq!(leer(clave).unwrap().as_deref(), Some("secreto"));
        borrar(clave).unwrap();
        assert_eq!(leer(clave).unwrap(), None);
        borrar(clave).unwrap(); // idempotente
    }
}
