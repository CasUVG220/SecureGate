//! Espera entre reintentos de conexión (T7): exponencial con tope y un poco de aleatoriedad.

use std::time::Duration;

pub const BASE: Duration = Duration::from_secs(1);
pub const TOPE: Duration = Duration::from_secs(30);

#[derive(Debug, Clone)]
pub struct Backoff {
    intentos: u32,
    base: Duration,
    tope: Duration,
    /// Fracción de variación (0,2 = ±20 %): evita que varias cámaras caídas a la vez reintenten en el mismo instante.
    jitter: f64,
}

impl Default for Backoff {
    fn default() -> Self {
        Self { intentos: 0, base: BASE, tope: TOPE, jitter: 0.2 }
    }
}

impl Backoff {
    #[allow(dead_code)]
    pub fn con(base: Duration, tope: Duration, jitter: f64) -> Self {
        Self { intentos: 0, base, tope, jitter }
    }

    /// Cuántos reintentos seguidos van sin éxito.
    #[allow(dead_code)]
    pub fn intentos(&self) -> u32 {
        self.intentos
    }

    pub fn reiniciar(&mut self) {
        self.intentos = 0;
    }

    /// Espera para el próximo reintento: base × 2^intentos, con tope. `aleatorio` en [0,1) (inyectable para probar).
    pub fn siguiente(&mut self, aleatorio: f64) -> Duration {
        let exp = self.base.as_secs_f64() * 2f64.powi(self.intentos.min(16) as i32);
        let sin_jitter = exp.min(self.tope.as_secs_f64());
        self.intentos = self.intentos.saturating_add(1);
        let variacion = 1.0 + self.jitter * (aleatorio.clamp(0.0, 1.0) * 2.0 - 1.0);
        Duration::from_secs_f64((sin_jitter * variacion).min(self.tope.as_secs_f64() * (1.0 + self.jitter)).max(0.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crece_al_doble_y_se_detiene_en_el_tope() {
        let mut b = Backoff::con(Duration::from_secs(1), Duration::from_secs(30), 0.0);
        let esperas: Vec<u64> = (0..8).map(|_| b.siguiente(0.5).as_secs()).collect();
        assert_eq!(esperas, vec![1, 2, 4, 8, 16, 30, 30, 30]);
        assert_eq!(b.intentos(), 8);
    }

    #[test]
    fn reiniciar_vuelve_a_la_base() {
        let mut b = Backoff::con(Duration::from_secs(1), Duration::from_secs(30), 0.0);
        for _ in 0..5 { b.siguiente(0.5); }
        b.reiniciar();
        assert_eq!(b.intentos(), 0);
        assert_eq!(b.siguiente(0.5), Duration::from_secs(1));
    }

    #[test]
    fn el_jitter_varia_dentro_de_su_margen_y_nunca_es_negativo() {
        let mut b = Backoff::con(Duration::from_secs(10), Duration::from_secs(30), 0.2);
        assert_eq!(b.siguiente(0.0), Duration::from_secs(8));          // -20 %
        let mut b = Backoff::con(Duration::from_secs(10), Duration::from_secs(30), 0.2);
        assert_eq!(b.siguiente(1.0), Duration::from_secs(12));         // +20 %
        let mut b = Backoff::default();
        for _ in 0..40 { assert!(b.siguiente(0.37) <= Duration::from_secs(36)); }   // tope + jitter
    }
}
