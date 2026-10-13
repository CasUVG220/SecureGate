//! Usuario y contraseña de las cámaras (T7): SOLO en el llavero del sistema.
//!
//! Regla de oro: **las credenciales nunca llegan al WebView, ni a SQLite, ni a un log**. Rust las lee del llavero (Credential
//! Manager en Windows, ver `secure_store.rs`) justo antes de abrir la cámara y las pasa al proceso o cliente que la abre. El
//! frontend solo sabe si una cámara «tiene credenciales» (un booleano) y puede reemplazarlas, pero nunca leerlas.

use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::secure_store;

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Credenciales {
    pub usuario: String,
    pub clave: String,
}

impl std::fmt::Debug for Credenciales {
    /// Un `{:?}` accidental no debe imprimir la contraseña.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Credenciales").field("usuario", &"<oculto>").field("clave", &"<oculta>").finish()
    }
}

fn clave_llavero(id: &str) -> String {
    format!("camara:{id}")
}

pub fn guardar(id: &str, c: &Credenciales) -> AppResult<()> {
    secure_store::guardar_json(&clave_llavero(id), c)
}

pub fn leer(id: &str) -> AppResult<Option<Credenciales>> {
    secure_store::leer_json::<Credenciales>(&clave_llavero(id))
}

pub fn borrar(id: &str) -> AppResult<()> {
    secure_store::borrar(&clave_llavero(id))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id() -> String {
        uuid::Uuid::new_v4().to_string()
    }

    #[test]
    fn ciclo_guardar_leer_borrar_en_el_llavero() {
        secure_store::inicializar_mock();
        let id = id();
        assert_eq!(leer(&id).unwrap(), None);
        guardar(&id, &Credenciales { usuario: "admin".into(), clave: "s3cr3t".into() }).unwrap();
        assert_eq!(leer(&id).unwrap().unwrap().clave, "s3cr3t");
        borrar(&id).unwrap();
        assert_eq!(leer(&id).unwrap(), None);
        borrar(&id).unwrap();                                    // no falla si no existía
    }

    #[test]
    fn el_debug_oculta_usuario_y_clave() {
        let c = Credenciales { usuario: "admin".into(), clave: "SuperSecreta".into() };
        let t = format!("{c:?} {c:#?}");
        assert!(!t.contains("SuperSecreta") && !t.contains("admin"), "{t}");
    }
}
