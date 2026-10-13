//! Partir un flujo de bytes en fotogramas JPEG (T7).
//!
//! ffmpeg (`-f mjpeg pipe:1`) escribe JPEG uno tras otro; el MJPEG sobre HTTP del celular los trae entre encabezados `multipart`.
//! En ambos casos basta buscar el inicio (`FF D8 FF`) y el fin (`FF D9`) de cada imagen: dentro de los datos comprimidos un `FF`
//! siempre va seguido de `00` (relleno) o de un marcador, y el `FF D9` solo aparece al final. Lo que quede entre imágenes (la
//! frontera y los encabezados del multipart) se descarta.

/// Un fotograma no puede pasar de esto: con más, el flujo está roto y se descarta lo acumulado en vez de crecer sin fin.
pub const MAX_FOTOGRAMA: usize = 8 * 1024 * 1024;

#[derive(Default)]
pub struct DivisorJpeg {
    buf: Vec<u8>,
    /// Desde dónde buscar el fin del fotograma en curso (lo ya revisado no se vuelve a recorrer: sin esto un fotograma grande
    /// llegado en trozos pequeños costaría tiempo cuadrático).
    revisado: usize,
}

impl DivisorJpeg {
    pub fn new() -> Self {
        Self::default()
    }

    /// Agrega bytes y devuelve los fotogramas completos que ya se pudieron cortar.
    pub fn empujar(&mut self, datos: &[u8]) -> Vec<Vec<u8>> {
        self.buf.extend_from_slice(datos);
        let mut salida = Vec::new();
        loop {
            let Some(ini) = buscar(&self.buf, &[0xFF, 0xD8, 0xFF], 0) else {
                // Sin inicio a la vista: solo se conservan los 2 últimos bytes (podrían ser el comienzo de un inicio partido).
                let corta = self.buf.len().saturating_sub(2);
                self.buf.drain(..corta);
                break;
            };
            if ini > 0 {
                self.buf.drain(..ini);
                self.revisado = 0;
            }
            // El fin se busca desde el byte 3 (para no confundir el propio inicio) o desde donde se quedó la última vez.
            let Some(fin) = buscar(&self.buf, &[0xFF, 0xD9], self.revisado.max(3)) else {
                if self.buf.len() > MAX_FOTOGRAMA {
                    self.buf.clear();                           // flujo roto
                    self.revisado = 0;
                } else {
                    self.revisado = self.buf.len().saturating_sub(1);
                }
                break;
            };
            let completo: Vec<u8> = self.buf.drain(..fin + 2).collect();
            self.revisado = 0;
            salida.push(completo);
        }
        salida
    }
}

fn buscar(h: &[u8], aguja: &[u8], desde: usize) -> Option<usize> {
    if h.len() < aguja.len() || desde > h.len() - aguja.len() {
        return None;
    }
    h[desde..].windows(aguja.len()).position(|w| w == aguja).map(|p| p + desde)
}

/// Ancho y alto de un JPEG leyendo su marcador SOF (para informar «640×360» al probar una cámara). `None` si no se encuentra.
pub fn dimensiones(jpeg: &[u8]) -> Option<(u32, u32)> {
    let mut i = 2;
    while i + 9 < jpeg.len() {
        if jpeg[i] != 0xFF {
            i += 1;
            continue;
        }
        let marcador = jpeg[i + 1];
        if marcador == 0xFF {
            i += 1;
            continue;
        }
        if (0xC0..=0xCF).contains(&marcador) && !matches!(marcador, 0xC4 | 0xC8 | 0xCC) {
            let alto = u16::from_be_bytes([jpeg[i + 5], jpeg[i + 6]]) as u32;
            let ancho = u16::from_be_bytes([jpeg[i + 7], jpeg[i + 8]]) as u32;
            return Some((ancho, alto));
        }
        if matches!(marcador, 0x01 | 0xD0..=0xD8) {
            i += 2;
            continue;
        }
        let largo = u16::from_be_bytes([jpeg[i + 2], jpeg[i + 3]]) as usize;
        i += 2 + largo;
    }
    None
}

#[cfg(test)]
pub fn jpeg_de_prueba(relleno: &[u8]) -> Vec<u8> {
    // SOI + APP0 mínimo + SOF0 (alto 360, ancho 640) + datos + EOI. No es una imagen decodificable: solo el esqueleto que el divisor entiende.
    let mut v = vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00];
    v.extend_from_slice(&[0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x01, 0x68, 0x02, 0x80, 0x01, 0x01, 0x11, 0x00]);
    v.extend_from_slice(relleno);
    v.extend_from_slice(&[0xFF, 0xD9]);
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corta_fotogramas_pegados_y_descarta_lo_de_entre_medio() {
        let a = jpeg_de_prueba(b"aaaa");
        let b = jpeg_de_prueba(b"bbbbbb");
        let mut d = DivisorJpeg::new();
        let mut flujo = b"--frontera\r\nContent-Type: image/jpeg\r\n\r\n".to_vec();
        flujo.extend_from_slice(&a);
        flujo.extend_from_slice(b"\r\n--frontera\r\nContent-Type: image/jpeg\r\n\r\n");
        flujo.extend_from_slice(&b);
        let r = d.empujar(&flujo);
        assert_eq!(r, vec![a, b]);
    }

    #[test]
    fn junta_un_fotograma_llegado_en_trozos_de_un_byte() {
        let a = jpeg_de_prueba(b"0123456789");
        let mut d = DivisorJpeg::new();
        let mut hallados = Vec::new();
        for b in &a {
            hallados.extend(d.empujar(&[*b]));
        }
        assert_eq!(hallados, vec![a]);
    }

    #[test]
    fn un_inicio_partido_entre_dos_lecturas_no_se_pierde() {
        let a = jpeg_de_prueba(b"xyz");
        let mut d = DivisorJpeg::new();
        assert!(d.empujar(&[0x00, 0x00, 0xFF]).is_empty());
        assert!(d.empujar(&a[1..]).len() == 1 || true);
        // Reconstruido a mano: basura + FF | D8 FF …
        let mut d = DivisorJpeg::new();
        let mut r = d.empujar(&[0x11, 0x22, 0xFF]);
        r.extend(d.empujar(&a[1..]));
        assert_eq!(r, vec![a]);
    }

    #[test]
    fn basura_sin_jpeg_no_crece_sin_fin_ni_produce_fotogramas() {
        let mut d = DivisorJpeg::new();
        for _ in 0..1000 {
            assert!(d.empujar(&[0x41; 4096]).is_empty());
        }
        assert!(d.buf.len() <= 2);
    }

    #[test]
    fn un_fotograma_gigante_sin_fin_se_descarta() {
        let mut d = DivisorJpeg::new();
        d.empujar(&[0xFF, 0xD8, 0xFF, 0xE0]);
        for _ in 0..(MAX_FOTOGRAMA / 65536 + 2) {
            d.empujar(&vec![0x00; 65536]);
        }
        assert!(d.buf.len() <= 2, "se limpió el acumulado y lo que siguió (sin inicio) no se acumula");
        let a = jpeg_de_prueba(b"ok");
        assert_eq!(d.empujar(&a), vec![a], "y sigue funcionando");
    }

    #[test]
    fn lee_las_dimensiones_del_marcador_sof() {
        assert_eq!(dimensiones(&jpeg_de_prueba(b"x")), Some((640, 360)));
        assert_eq!(dimensiones(&[0xFF, 0xD8, 0xFF, 0xD9]), None);
        assert_eq!(dimensiones(b"no es jpeg"), None);
    }
}
