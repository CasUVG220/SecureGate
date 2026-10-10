//! Placas de vehículo: una sola forma para guardar y comparar.
//!
//! Canónica: mayúsculas y solo A-Z / 0-9 (`P123ABC`). Es la misma regla que
//! `desktop/src/lib/placa.ts`, `frontend/src/utils/placa.ts` y
//! `backend/src/utils/placa.ts`: la lista negra por placa compara siempre
//! normalizado, así que `p-123 abc` y `P123ABC` son el mismo vehículo.

/// Mayúsculas y solo A-Z / 0-9 (ASCII). Lo demás —guiones, espacios, tildes— se descarta.
pub fn normalizar(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect()
}

/// Largo mínimo para considerar que hay una placa que comparar.
pub const LARGO_MINIMO: usize = 3;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normaliza_formatos_distintos_a_la_misma_placa() {
        for p in ["P123ABC", "p123abc", "P-123ABC", " p 123 abc ", "P.123-ABC"] {
            assert_eq!(normalizar(p), "P123ABC", "{p:?}");
        }
        assert_eq!(normalizar(""), "");
        assert_eq!(normalizar("---"), "");
        assert_eq!(normalizar("Ñ-12"), "12", "los caracteres no ASCII se descartan");
    }
}
