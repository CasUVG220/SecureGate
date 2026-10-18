//! Decisión del ANPR (Sprint 10, tarea 5): qué hacer con lo que el sidecar leyó en un carril. Funciona SIN internet: los hechos
//! salen del espejo SQLCipher (`vehiculos_autorizados_local`, `residentes_local`, `blacklist_local`) y del estado de la licencia.
//!
//! Barandas (sección 0 del sprint, en este orden):
//! 1. Carril apagado → no se hace nada.
//! 2. Lectura ilegible → verificación del agente con la foto.
//! 3. Placa en lista negra (bloqueo por placa de la sucursal, el mismo de `garita::evaluar_visitante`, o marcada así en la copia
//!    de vehículos) → **alerta** visible y sonora, **nunca** abre. Va antes que todo lo demás: aunque la lectura se haya corregido
//!    por posición, ante la duda se avisa.
//! 4. La misma placa ya tuvo un evento en este carril hace < 60 s → se ignora (defensa además del enfriamiento del sidecar).
//! 5. Licencia que no permite operar (empresa suspendida, revocada, gracia vencida) → verificación; nunca abre.
//! 6. Lectura que necesitó corrección por posición o con prefijo desconocido → verificación.
//! 7. Placa que no es de un vehículo autorizado → verificación (el agente registra a mano o con la captura por clic).
//! 8. Vehículo dado de baja, fuera de vigencia hoy o cuyo residente ya no está en la copia → verificación.
//! 9. Todo en orden: modo `automatico` → **abre** (registra el acceso y manda al actuador); modo `verificacion` → el agente
//!    confirma con un toque.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::carriles::Modo;
use crate::error::AppResult;
use crate::garita;

/// Segundos en que la misma placa no vuelve a decidirse en el mismo carril.
pub const ENFRIAMIENTO_S: i64 = 60;

/// Vehículo autorizado de un residente, tal como está en la copia local.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VehiculoLocal {
    pub id: String,
    pub placa: String,
    pub residente_id: String,
    pub numero_casa: Option<String>,
    pub residente_nombre: Option<String>,
    pub vigente_desde: String,
    pub vigente_hasta: Option<String>,
    pub activo: bool,
    pub en_lista_negra: bool,
}

impl VehiculoLocal {
    /// ¿Vigente el día `hoy` (AAAA-MM-DD)? Los dos extremos cuentan.
    pub fn vigente(&self, hoy: &str) -> bool {
        self.vigente_desde.as_str() <= hoy && self.vigente_hasta.as_deref().map_or(true, |h| h >= hoy)
    }
}

/// Evidencia que manda el sidecar (JPEG en base64).
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct EvidenciaSidecar {
    #[serde(default)]
    pub placa_jpeg: Option<String>,
    #[serde(default)]
    pub vehiculo_jpeg: Option<String>,
    #[serde(default)]
    pub expira_ms: Option<i64>,
}

/// Evento `decision` del sidecar (ver `sidecar-ocr/src/anpr/carril.js`).
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LecturaAnpr {
    pub carril: String,
    pub track_id: String,
    /// `confirmada` | `ilegible`.
    pub resultado: String,
    #[serde(default)]
    pub placa: Option<String>,
    #[serde(default)]
    pub placa_probable: Option<String>,
    #[serde(default)]
    pub confianza: f64,
    #[serde(default)]
    pub votos: u32,
    #[serde(default)]
    pub lecturas: Vec<Value>,
    #[serde(default)]
    pub requiere_verificacion: bool,
    #[serde(default)]
    pub alguna_correccion: bool,
    #[serde(default)]
    pub motivo: Option<String>,
    #[serde(default)]
    pub clase: Option<String>,
    #[serde(default)]
    pub ms_desde_legible: Option<i64>,
    #[serde(default)]
    pub evidencia: EvidenciaSidecar,
}

impl LecturaAnpr {
    pub fn confirmada(&self) -> bool {
        self.resultado == "confirmada" && self.placa.as_deref().is_some_and(|p| !p.is_empty())
    }
}

/// Lo que hay que saber del mundo para decidir (lo arma [`hechos`] desde la base local).
#[derive(Debug, Clone, Default)]
pub struct Hechos {
    pub licencia_ok: bool,
    pub vehiculo: Option<VehiculoLocal>,
    pub residente_en_copia: bool,
    /// Razón del bloqueo si la placa está en la lista negra de la sucursal.
    pub bloqueo: Option<String>,
    pub hoy: String,
    pub enfriamiento: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MotivoVerificacion {
    Ilegible,
    LecturaCorregida,
    Desconocida,
    NoAutorizado,
    NoVigente,
    ResidenteInactivo,
    LicenciaBloqueada,
    /// Todo en orden pero el carril está en modo verificación: falta el toque del agente.
    ConfirmarResidente,
}

impl MotivoVerificacion {
    /// Texto para la pantalla del agente.
    pub fn texto(self) -> &'static str {
        match self {
            MotivoVerificacion::Ilegible => "No se pudo leer la placa.",
            MotivoVerificacion::LecturaCorregida => "La lectura necesitó corregir caracteres: confirma la placa.",
            MotivoVerificacion::Desconocida => "La placa no es de un vehículo autorizado.",
            MotivoVerificacion::NoAutorizado => "El vehículo está dado de baja.",
            MotivoVerificacion::NoVigente => "La autorización del vehículo no está vigente hoy.",
            MotivoVerificacion::ResidenteInactivo => "El residente ya no está activo.",
            MotivoVerificacion::LicenciaBloqueada => "La licencia del equipo no permite registrar ahora.",
            MotivoVerificacion::ConfirmarResidente => "Vehículo autorizado: confirma para abrir.",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Decision {
    /// Registrar el acceso (o la salida) y mandar abrir.
    Abrir { vehiculo: VehiculoLocal },
    /// El agente decide (con la foto). `vehiculo` = el autorizado que coincide, si hay.
    Verificar { motivo: MotivoVerificacion, vehiculo: Option<VehiculoLocal> },
    /// Placa bloqueada: alerta visible y sonora; nunca abre.
    AlertaListaNegra { razon: String },
    /// No se hace nada (carril apagado o enfriamiento).
    Ignorar { motivo: &'static str },
}

impl Decision {
    pub fn abre(&self) -> bool {
        matches!(self, Decision::Abrir { .. })
    }
}

/// La regla, sin base de datos ni red (ver el orden en la documentación del módulo).
pub fn decidir(modo: Modo, lectura: &LecturaAnpr, h: &Hechos) -> Decision {
    if modo == Modo::Apagado {
        return Decision::Ignorar { motivo: "carril_apagado" };
    }
    if !lectura.confirmada() {
        return Decision::Verificar { motivo: MotivoVerificacion::Ilegible, vehiculo: None };
    }
    if let Some(razon) = &h.bloqueo {
        return Decision::AlertaListaNegra { razon: razon.clone() };
    }
    if h.vehiculo.as_ref().is_some_and(|v| v.en_lista_negra) {
        return Decision::AlertaListaNegra { razon: "Vehículo en lista negra".into() };
    }
    if h.enfriamiento {
        return Decision::Ignorar { motivo: "enfriamiento" };
    }
    let verificar = |motivo| Decision::Verificar { motivo, vehiculo: h.vehiculo.clone() };
    if !h.licencia_ok {
        return verificar(MotivoVerificacion::LicenciaBloqueada);
    }
    if lectura.requiere_verificacion {
        return verificar(MotivoVerificacion::LecturaCorregida);
    }
    let Some(v) = &h.vehiculo else { return verificar(MotivoVerificacion::Desconocida) };
    if !v.activo {
        return verificar(MotivoVerificacion::NoAutorizado);
    }
    if !v.vigente(&h.hoy) {
        return verificar(MotivoVerificacion::NoVigente);
    }
    if !h.residente_en_copia {
        return verificar(MotivoVerificacion::ResidenteInactivo);
    }
    match modo {
        Modo::Automatico => Decision::Abrir { vehiculo: v.clone() },
        _ => verificar(MotivoVerificacion::ConfirmarResidente),
    }
}

/// Vehículo autorizado (el activo primero) de una placa ya normalizada.
pub fn vehiculo_por_placa(conn: &Connection, placa: &str) -> AppResult<Option<VehiculoLocal>> {
    Ok(conn
        .query_row(
            "SELECT id, placa, residente_id, numero_casa, residente_nombre, vigente_desde, vigente_hasta, activo, en_lista_negra
             FROM vehiculos_autorizados_local WHERE placa = ?1 ORDER BY activo DESC LIMIT 1",
            [placa],
            |r| {
                Ok(VehiculoLocal {
                    id: r.get(0)?,
                    placa: r.get(1)?,
                    residente_id: r.get(2)?,
                    numero_casa: r.get(3)?,
                    residente_nombre: r.get(4)?,
                    vigente_desde: r.get(5)?,
                    vigente_hasta: r.get(6)?,
                    activo: r.get::<_, i64>(7)? != 0,
                    en_lista_negra: r.get::<_, i64>(8)? != 0,
                })
            },
        )
        .optional()?)
}

/// Reúne los hechos de la base local para una placa (`None` = ilegible). `hoy` = AAAA-MM-DD local; `ahora` = RFC 3339.
pub fn hechos(conn: &Connection, placa: Option<&str>, carril_id: &str, hoy: &str, ahora: &str, licencia_ok: bool) -> AppResult<Hechos> {
    let mut h = Hechos { licencia_ok, hoy: hoy.to_string(), ..Default::default() };
    let Some(placa) = placa.map(crate::placa::normalizar).filter(|p| p.len() >= crate::placa::LARGO_MINIMO) else { return Ok(h) };
    // Misma regla de lista negra que el registro manual (bloqueo por placa de la sucursal, vigente).
    let ev = garita::evaluar_visitante(conn, "", Some(&placa), None, hoy, ahora)?;
    if ev.bloqueado {
        h.bloqueo = Some(ev.razon_bloqueo.unwrap_or_else(|| "Vehículo en lista negra".into()));
    }
    h.vehiculo = vehiculo_por_placa(conn, &placa)?;
    if let Some(v) = &h.vehiculo {
        h.residente_en_copia = conn
            .prepare("SELECT 1 FROM residentes_local WHERE id = ?1")?
            .exists([&v.residente_id])?;
    }
    h.enfriamiento = conn
        .prepare(
            "SELECT 1 FROM anpr_eventos_local
             WHERE carril_id = ?1 AND (placa = ?2 OR placa_probable = ?2) AND estado <> 'ignorado'
               AND creado_en > ?3",
        )?
        .exists(params![carril_id, placa, menos_segundos(ahora, ENFRIAMIENTO_S)])?;
    Ok(h)
}

/// `ahora` (RFC 3339) menos `s` segundos, en el formato de `creado_en` (UTC, segundos, `Z`): se compara como texto.
fn menos_segundos(ahora: &str, s: i64) -> String {
    chrono::DateTime::parse_from_rfc3339(ahora)
        .map(|d| super::instante(d.with_timezone(&chrono::Utc) - chrono::Duration::seconds(s)))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    pub fn lectura(placa: Option<&str>) -> LecturaAnpr {
        LecturaAnpr {
            carril: "c1".into(), track_id: "c1-x-1".into(), resultado: if placa.is_some() { "confirmada".into() } else { "ilegible".into() },
            placa: placa.map(String::from), placa_probable: placa.map(String::from), confianza: 0.97, votos: 3, lecturas: vec![],
            requiere_verificacion: placa.is_none(), alguna_correccion: false, motivo: None, clase: Some("carro".into()), ms_desde_legible: Some(400),
            evidencia: EvidenciaSidecar::default(),
        }
    }

    pub fn vehiculo() -> VehiculoLocal {
        VehiculoLocal {
            id: "v1".into(), placa: "P123ABC".into(), residente_id: "r1".into(), numero_casa: Some("A-12".into()),
            residente_nombre: Some("Ana López".into()), vigente_desde: "2026-01-01".into(), vigente_hasta: None, activo: true, en_lista_negra: false,
        }
    }

    fn todo_bien() -> Hechos {
        Hechos { licencia_ok: true, vehiculo: Some(vehiculo()), residente_en_copia: true, bloqueo: None, hoy: "2026-10-22".into(), enfriamiento: false }
    }

    #[test]
    fn autorizado_y_en_orden_abre_solo_en_modo_automatico() {
        let l = lectura(Some("P123ABC"));
        assert_eq!(decidir(Modo::Automatico, &l, &todo_bien()), Decision::Abrir { vehiculo: vehiculo() });
        assert_eq!(
            decidir(Modo::Verificacion, &l, &todo_bien()),
            Decision::Verificar { motivo: MotivoVerificacion::ConfirmarResidente, vehiculo: Some(vehiculo()) }
        );
        assert_eq!(decidir(Modo::Apagado, &l, &todo_bien()), Decision::Ignorar { motivo: "carril_apagado" });
    }

    #[test]
    fn lista_negra_nunca_abre_aunque_todo_lo_demas_este_bien_o_la_lectura_venga_corregida() {
        let h = Hechos { bloqueo: Some("Robo".into()), ..todo_bien() };
        assert_eq!(decidir(Modo::Automatico, &lectura(Some("P123ABC")), &h), Decision::AlertaListaNegra { razon: "Robo".into() });
        let corregida = LecturaAnpr { requiere_verificacion: true, ..lectura(Some("P123ABC")) };
        assert_eq!(decidir(Modo::Automatico, &corregida, &h), Decision::AlertaListaNegra { razon: "Robo".into() });
        // Marcado así en la copia de vehículos aunque el espejo de la lista negra no lo tenga todavía.
        let marcado = Hechos { vehiculo: Some(VehiculoLocal { en_lista_negra: true, ..vehiculo() }), ..todo_bien() };
        assert!(matches!(decidir(Modo::Automatico, &lectura(Some("P123ABC")), &marcado), Decision::AlertaListaNegra { .. }));
        // Ni siquiera el enfriamiento la calla.
        let reciente = Hechos { enfriamiento: true, ..h };
        assert!(matches!(decidir(Modo::Automatico, &lectura(Some("P123ABC")), &reciente), Decision::AlertaListaNegra { .. }));
    }

    #[test]
    fn empresa_suspendida_o_licencia_bloqueada_nunca_abre() {
        let h = Hechos { licencia_ok: false, ..todo_bien() };
        let d = decidir(Modo::Automatico, &lectura(Some("P123ABC")), &h);
        assert_eq!(d, Decision::Verificar { motivo: MotivoVerificacion::LicenciaBloqueada, vehiculo: Some(vehiculo()) });
        assert!(!d.abre());
    }

    #[test]
    fn lectura_corregida_nunca_abre() {
        let l = LecturaAnpr { requiere_verificacion: true, alguna_correccion: true, ..lectura(Some("P123ABC")) };
        let d = decidir(Modo::Automatico, &l, &todo_bien());
        assert_eq!(d, Decision::Verificar { motivo: MotivoVerificacion::LecturaCorregida, vehiculo: Some(vehiculo()) });
        assert!(!d.abre());
    }

    #[test]
    fn ilegible_desconocida_baja_vigencia_y_residente_van_a_verificacion() {
        let casos = [
            (lectura(None), todo_bien(), MotivoVerificacion::Ilegible),
            (LecturaAnpr { resultado: "confirmada".into(), placa: None, ..lectura(None) }, todo_bien(), MotivoVerificacion::Ilegible),
            (lectura(Some("C458DFG")), Hechos { vehiculo: None, ..todo_bien() }, MotivoVerificacion::Desconocida),
            (lectura(Some("P123ABC")), Hechos { vehiculo: Some(VehiculoLocal { activo: false, ..vehiculo() }), ..todo_bien() }, MotivoVerificacion::NoAutorizado),
            (lectura(Some("P123ABC")), Hechos { vehiculo: Some(VehiculoLocal { vigente_hasta: Some("2026-10-21".into()), ..vehiculo() }), ..todo_bien() }, MotivoVerificacion::NoVigente),
            (lectura(Some("P123ABC")), Hechos { vehiculo: Some(VehiculoLocal { vigente_desde: "2026-10-23".into(), ..vehiculo() }), ..todo_bien() }, MotivoVerificacion::NoVigente),
            (lectura(Some("P123ABC")), Hechos { residente_en_copia: false, ..todo_bien() }, MotivoVerificacion::ResidenteInactivo),
        ];
        for (l, h, motivo) in casos {
            match decidir(Modo::Automatico, &l, &h) {
                Decision::Verificar { motivo: m, .. } => assert_eq!(m, motivo),
                otra => panic!("{motivo:?}: {otra:?}"),
            }
        }
    }

    #[test]
    fn la_vigencia_cuenta_el_primer_y_el_ultimo_dia() {
        let v = VehiculoLocal { vigente_desde: "2026-10-01".into(), vigente_hasta: Some("2026-10-31".into()), ..vehiculo() };
        assert!(v.vigente("2026-10-01") && v.vigente("2026-10-31"));
        assert!(!v.vigente("2026-09-30") && !v.vigente("2026-11-01"));
    }

    #[test]
    fn enfriamiento_ignora_la_misma_placa() {
        let h = Hechos { enfriamiento: true, ..todo_bien() };
        assert_eq!(decidir(Modo::Automatico, &lectura(Some("P123ABC")), &h), Decision::Ignorar { motivo: "enfriamiento" });
    }

    #[test]
    fn ninguna_combinacion_abre_con_lista_negra_suspension_o_correccion() {
        // Barrido de todas las combinaciones de hechos y modos: si hay bloqueo, licencia mala o lectura corregida, jamás «Abrir».
        for modo in [Modo::Apagado, Modo::Verificacion, Modo::Automatico] {
            for bloqueo in [None, Some("x".to_string())] {
                for licencia_ok in [true, false] {
                    for corregida in [true, false] {
                        for marcado in [true, false] {
                            for enfriamiento in [true, false] {
                                for residente in [true, false] {
                                    let h = Hechos {
                                        licencia_ok, bloqueo: bloqueo.clone(), enfriamiento, residente_en_copia: residente,
                                        vehiculo: Some(VehiculoLocal { en_lista_negra: marcado, ..vehiculo() }), hoy: "2026-10-22".into(),
                                    };
                                    let l = LecturaAnpr { requiere_verificacion: corregida, ..lectura(Some("P123ABC")) };
                                    let d = decidir(modo, &l, &h);
                                    if bloqueo.is_some() || !licencia_ok || corregida || marcado || modo != Modo::Automatico {
                                        assert!(!d.abre(), "{modo:?} {bloqueo:?} lic={licencia_ok} corr={corregida} marcado={marcado}: {d:?}");
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn los_hechos_salen_del_espejo_local() {
        let c = Connection::open_in_memory().unwrap();
        crate::db::aplicar_esquema(&c).unwrap();
        c.execute_batch(
            "INSERT INTO residentes_local VALUES ('r1','A-12','Ana López','al_dia',NULL);
             INSERT INTO vehiculos_autorizados_local VALUES ('v1','P123ABC','r1','A-12','Ana López','2026-01-01',NULL,1,0,10);
             INSERT INTO vehiculos_autorizados_local VALUES ('v2','C458DFG','r9','B-1','Beto','2026-01-01',NULL,1,0,11);
             INSERT INTO blacklist_local (id, numero_dpi, visitante_nombre, razon, fecha_fin, residente_id, placa)
               VALUES ('b1','',NULL,'Vehículo robado',NULL,NULL,'P999XYZ');",
        ).unwrap();
        let ahora = "2026-10-22T15:00:00Z";
        let h = hechos(&c, Some("p-123 abc"), "c1", "2026-10-22", ahora, true).unwrap();
        assert_eq!(h.vehiculo.as_ref().map(|v| v.id.as_str()), Some("v1"));
        assert!(h.residente_en_copia && h.bloqueo.is_none() && !h.enfriamiento);
        let h2 = hechos(&c, Some("C458DFG"), "c1", "2026-10-22", ahora, true).unwrap();
        assert!(!h2.residente_en_copia, "el residente r9 no está en la copia");
        let h3 = hechos(&c, Some("P999XYZ"), "c1", "2026-10-22", ahora, true).unwrap();
        assert_eq!(h3.bloqueo.as_deref(), Some("Vehículo robado"));
        let h4 = hechos(&c, None, "c1", "2026-10-22", ahora, false).unwrap();
        assert!(h4.vehiculo.is_none() && !h4.licencia_ok);

        // Enfriamiento: un evento de esa placa en ese carril hace 30 s.
        c.execute(
            "INSERT INTO anpr_eventos_local (id, carril_id, track_id, sentido, placa, resultado, estado, requiere_verificacion, creado_en)
             VALUES ('e1','c1','t','entrada','P123ABC','confirmada','automatico',0,'2026-10-22T14:59:30Z')",
            [],
        ).unwrap();
        assert!(hechos(&c, Some("P123ABC"), "c1", "2026-10-22", ahora, true).unwrap().enfriamiento);
        assert!(!hechos(&c, Some("P123ABC"), "otro", "2026-10-22", ahora, true).unwrap().enfriamiento, "otro carril no cuenta");
        assert!(!hechos(&c, Some("P123ABC"), "c1", "2026-10-22", "2026-10-22T15:01:00Z", true).unwrap().enfriamiento, "pasados 60 s");
    }
}
