# Integración de pagos con tarjeta (Visanet Guatemala → NeoNet) — estado y requisitos

> **Estado: SIN INTEGRACIÓN.** Este documento separa lo que se pudo **verificar** de lo que **no**. Nada de lo no verificado se programó:
> no hay endpoints, esquemas de firma, flujo de 3-D Secure ni webhooks inventados en el código.

## 1. Lo que se sabe (verificado en fuentes públicas, 11/10/2026)

- **VisaNet Guatemala cambió su nombre a NeoNet** el 26 de octubre de 2023 (más de 24 años como VisaNet). Tiene el respaldo de Visa y Mastercard y de bancos
  socios (BAM, CHN, Banrural, Banco Industrial según la prensa). La documentación actual hay que buscarla bajo **NeoNet**, no VisaNet.
  Fuentes: [Emisoras Unidas](https://emisorasunidas.com/2023/11/03/visanet-evoluciona-y-ahora-pasara-a-ser-neonet-octubre-2023/),
  [Prensa Libre](https://www.prensalibre.com/c-studio/neonet-la-evolucion-de-visanet-guatemala/), [Revista Summa](https://revistasumma.com/visanet-guatemala-evoluciona-y-ahora-en-neonet).
- Ofrece soluciones de comercio electrónico («Visa en Línea»), links de pago y cobro por QR (producto *Cuik* y QR dinámico desde el POS).
- **No hay documentación pública de desarrollador** (API, SDK, sandbox) localizable por búsqueda abierta. Los resultados que aparecen son de otras empresas
  (manuales internos de un tercero, VisaNet Perú), que **no** son fuente oficial de Guatemala y no se usaron.

## 2. Lo que NO se pudo verificar (queda como pendiente, no se asume)

| Tema | Por qué importa | Qué hay que obtener de NeoNet / el banco adquirente |
|---|---|---|
| URL base y rutas de **producción y sandbox** | El adaptador necesita autorizar, consultar y reembolsar | Documentación técnica oficial y credenciales de sandbox |
| **Esquema de autenticación y firma** de las peticiones | Sin él no se puede firmar una llamada | Algoritmo, cabeceras, manejo de reloj/nonce |
| **3-D Secure** (versión, flujo de desafío, URL de retorno) | Obligatorio para cobrar con tarjeta en línea de forma segura | Si lo maneja su página alojada o hay que implementarlo |
| **Webhooks / notificaciones** de resultado | Conciliación de pagos que terminan fuera del navegador | Formato, firma y reintentos |
| Reembolsos y anulaciones | `ProveedorPago.reembolsar` es opcional a propósito | Si el contrato los permite por API |
| Alcance **PCI DSS** | Hoy el número de tarjeta **nunca** llega al backend (solo los últimos 4). Con un procesador real hay que decidir formulario alojado/SDK o token | Qué modalidad ofrece NeoNet y qué cuestionario PCI (SAQ) corresponde |
| Moneda, montos mínimos y comisiones | Para el cálculo de la factura SaaS (T11) | Tarifario del contrato |

## 3. Lo que ya está listo en el código (T2)

- `backend/src/services/pagos/proveedor.ts`: interfaz **`ProveedorPago`** (`autorizar`, `consultarEstado`, `reembolsar?`), dinero en **centavos**, sin número de
  tarjeta ni CVV en la solicitud. Un rechazo del emisor es un resultado, no una excepción.
- `simulado.ts`: la pasarela simulada de siempre (último dígito 1 = rechazada), sin estado.
- `visanet.ts`: adaptador que **lanza `ProveedorNoConfiguradoError`** en toda operación. Con `PAGOS_PROVEEDOR=visanet` el cobro responde **503** «no disponible
  todavía» (el residente no ve nombres de implementación), no se guarda ningún pago ni se toca el saldo, y la auditoría (`PAGO_TARJETA_SIMULADO`, 503) deja
  `datos_nuevos = { proveedor: "visanet", motivo: "proveedor_no_configurado" }`.
- Selección: `PAGOS_PROVEEDOR=visanet` > `PAGOS_TARJETA_SIMULADA=true` > nada (501). **No se tocó** `PAGOS_TARJETA_SIMULADA` ni las guardas de `scripts/deploy.sh`
  (producción sigue sin poder arrancar con la simulada activa).
- La regla de saldo (`docs/pagos_saldo.md`) ya se comprueba **antes** de autorizar, con la fila del residente bloqueada.
- **Al integrar el procesador real habrá que revisar:** (a) el bloqueo del saldo se mantiene durante la llamada de red (aceptable para un residente a la vez, pero
  hay que poner un tiempo máximo corto); (b) idempotencia con `referenciaInterna`; (c) conciliación por webhook para los pagos que quedaron «pendientes»;
  (d) la acción de auditoría se llama `PAGO_TARJETA_SIMULADO` (renombrarla toca la prueba de cobertura y `docs/acciones_sensibles.md`).

## 4. Requisitos del trámite del comercio (checklist para el equipo)

Lo siguiente es la lista **habitual** de un trámite de afiliación de comercio electrónico con un adquirente; **confirmar cada punto con NeoNet / el banco**,
que es quien fija los requisitos reales.

**Documentos de la empresa** (a confirmar): patente de comercio y de sociedad, escritura de constitución y sus modificaciones, nombramiento y DPI del
representante legal, RTU/NIT actualizado, recibo de servicios (domicilio), constancia de cuenta bancaria a nombre de la empresa donde se depositarán los cobros,
estados de cuenta recientes y descripción del giro del negocio (qué se cobra: cuotas de mantenimiento de residenciales).

**Del sitio y de la operación** (a confirmar): URL pública del sitio con certificado TLS válido, términos y condiciones, política de privacidad y de
reembolsos, datos de contacto/soporte, descripción de cómo se cobra y se entrega el servicio.

**Técnicos que pedir y registrar:**
1. **Credenciales de sandbox** (comercio, llave pública/secreta o equivalentes) y, aparte, las de producción — guardarlas solo como secretos del entorno, nunca en el repositorio.
2. **URL de retorno** (a dónde vuelve el residente tras el pago/3-D Secure): p. ej. `https://<dominio-de-produccion>/pagos/retorno` — definir y registrar la exacta.
3. **URL de webhook** (notificación de resultado): p. ej. `https://<dominio-de-produccion>/api/pagos/webhook/neonet` — a crear cuando se conozca el formato; debe ser pública, con TLS, y verificar la firma.
4. **IPs a registrar** (lista blanca): la IP pública de salida del servidor de producción (la de la VM, hoy fija en la infraestructura) y la de cualquier entorno de pruebas
   que vaya a llamar al sandbox. Preguntar también las IPs **desde las que NeoNet llama** al webhook, para permitirlas en nginx.
5. Cuestionario de seguridad / PCI DSS que corresponda a la modalidad elegida (formulario alojado reduce el alcance).
6. Tarifa, plazo de depósito, moneda (GTQ) y política de contracargos.

## 5. Siguiente paso concreto
Con las credenciales de sandbox y la documentación oficial en mano: implementar `ProveedorVisanet.autorizar/consultarEstado/reembolsar` contra el sandbox, agregar un
servidor de pruebas que imite sus respuestas (para el CI, sin red), agregar el endpoint de webhook con verificación de firma y su acción en
`docs/acciones_sensibles.md` + I-11, y recién entonces cambiar `PAGOS_PROVEEDOR`. Mientras tanto, los pagos de los residentes siguen por **transferencia con
comprobante** y **efectivo**.
