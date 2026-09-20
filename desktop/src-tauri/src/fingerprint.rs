//! Huella de hardware del dispositivo.
//!
//! Qué entra y qué no:
//! - **Sí**: el id de máquina del SO (`machine-uid`: en Windows es
//!   `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid`, en macOS el
//!   IOPlatformUUID) y la marca de la CPU + número de núcleos.
//! - **No**: direcciones MAC. Un adaptador USB Wi-Fi o un dock cambian la MAC
//!   "principal" y la licencia dejaría de coincidir sin que nadie tocara la PC.
//!
//! Consecuencia operativa: reinstalar Windows regenera el MachineGuid → la
//! garita tendrá que reactivarse con un código nuevo (el admin revoca el
//! anterior). Es el comportamiento deseado: una reinstalación es un
//! "dispositivo nuevo" a efectos de licencia.
//!
//! El valor que sale de aquí es un SHA-256 en hex (64 chars). Nunca se manda
//! el MachineGuid crudo al backend.

use sha2::{Digest, Sha256};

const VERSION: &str = "securegate-fp-v1";

/// Junta los componentes en un string canónico. Separado del hash para
/// poder testear la forma sin depender del hardware de la máquina de CI.
pub fn componer(machine_id: &str, cpu_marca: &str, nucleos: usize) -> String {
    format!(
        "{VERSION}|{}|{}|{nucleos}",
        machine_id.trim().to_lowercase(),
        cpu_marca.trim().to_lowercase()
    )
}

pub fn hash(canonico: &str) -> String {
    hex::encode(Sha256::digest(canonico.as_bytes()))
}

/// `true` si tiene la forma que el backend acepta (hex de 64).
pub fn es_valido(fp: &str) -> bool {
    fp.len() == 64 && fp.chars().all(|c| c.is_ascii_hexdigit()) && fp == fp.to_lowercase()
}

fn cpu_info() -> (String, usize) {
    use sysinfo::{CpuRefreshKind, RefreshKind, System};
    let sys = System::new_with_specifics(
        RefreshKind::nothing().with_cpu(CpuRefreshKind::nothing()),
    );
    let marca = sys
        .cpus()
        .first()
        .map(|c| c.brand().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| std::env::consts::ARCH.to_string());
    let nucleos = System::physical_core_count().unwrap_or_else(|| sys.cpus().len().max(1));
    (marca, nucleos)
}

/// Fingerprint de esta máquina. Estable entre reinicios y arranques de la app.
pub fn obtener() -> Result<String, String> {
    let machine_id = machine_uid::get().map_err(|e| format!("machine-uid: {e}"))?;
    if machine_id.trim().is_empty() {
        return Err("machine-uid vacío".into());
    }
    let (marca, nucleos) = cpu_info();
    Ok(hash(&componer(&machine_id, &marca, nucleos)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_hash_es_hex_de_64_y_determinista() {
        let a = hash(&componer("ABC-123", "Intel Core i5", 4));
        let b = hash(&componer("abc-123", "intel core i5", 4));
        assert_eq!(a, b, "mayúsculas/minúsculas y espacios no deben cambiar la huella");
        assert!(es_valido(&a));
    }

    #[test]
    fn distintos_componentes_dan_huellas_distintas() {
        let base = hash(&componer("abc", "cpu", 4));
        assert_ne!(base, hash(&componer("abd", "cpu", 4)));
        assert_ne!(base, hash(&componer("abc", "cpu2", 4)));
        assert_ne!(base, hash(&componer("abc", "cpu", 8)));
    }

    #[test]
    fn la_forma_canonica_lleva_version_para_poder_rotarla() {
        assert!(componer("id", "cpu", 2).starts_with("securegate-fp-v1|"));
    }

    #[test]
    fn es_valido_rechaza_formas_incorrectas() {
        assert!(!es_valido(""));
        assert!(!es_valido(&"a".repeat(63)));
        assert!(!es_valido(&"A".repeat(64)), "el backend compara en minúsculas");
        assert!(!es_valido(&"g".repeat(64)));
        assert!(es_valido(&"0".repeat(64)));
    }

    #[test]
    fn obtener_funciona_en_esta_maquina() {
        // Smoke test real: valida integración con machine-uid + sysinfo.
        let fp = obtener().expect("fingerprint");
        assert!(es_valido(&fp));
        assert_eq!(fp, obtener().unwrap(), "debe ser estable entre llamadas");
    }
}
