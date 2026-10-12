# Sprint 9 — Continuación (rama `s9-continuacion`)

Trabajo autónomo en la nube sobre `origin/main` @ `3f3b57b` (11/10/2026). Todo vive en `s9-continuacion` y termina en un PR en borrador hacia `main`.
No se tocó producción, la VM, Cloud SQL ni secretos. Las pruebas de base de datos corrieron **solo** contra un Postgres 16 desechable local
(puerto 55432, base `securegate_test`; la guía pide 15, la diferencia no afecta: el esquema es el mismo). No hay Docker, webcam ni Windows en este entorno.

> Cada decisión ante una ambigüedad se anota aquí. El entorno de pruebas se verificó **antes** de empezar: la integración corre de verdad
> (322 pruebas, 23 suites, ninguna omitida) y `cargo test --lib` también (97 pruebas, tras instalar las bibliotecas de Tauri con apt).

## Resumen de estado

| Tarea | Tema | Estado |
|---|---|---|
| T0 | Estabilizar la línea base (2 pruebas dependían de la hora del día) | HECHO |
| T1 | Pagos: un pago resta su monto del saldo | HECHO |
| T2 | Interfaz `ProveedorPago` y preparación de Visanet | HECHO (la integración real queda PENDIENTE de documentación y credenciales) |
| T3 | Conjunto sintético y evaluador del DPI | HECHO |

## Línea base (antes de tocar nada, con las 2 correcciones de T0)

| Suite | Resultado |
|---|---|
| Backend `npm test` (unitarias) | 35 suites · **701** pruebas · verde |
| Backend integración + regresión (`npm run test:ci`, Postgres 55432) | 23 suites · **322** pruebas · verde |
| Backend `tsc --noEmit` | limpio |
| Frontend `npm test` · `npm run build` | 57 archivos · **443** pruebas · build verde |
| Desktop `npm test` · `npm run build` | 15 archivos · **109** pruebas · build verde |
| Rust `cargo test --lib --locked` | **97** pruebas (2 ignoradas) · verde |

---

## T0 — Línea base estable · **HECHO**
Con la hora de Guatemala entre las 18:00 y las 24:00 (el día de UTC ya cambió) fallaban dos pruebas de integración que ya estaban en `main`:
- `I-14` (filtros de la bitácora): el filtro `desde`/`hasta` del `GET /api/audit-logs` interpretaba el día en la zona de la **sesión de la base (UTC)**, no en la de
  Guatemala; quien elegía «hoy» a las 19:00 no veía lo de hoy. Corregido en `audit.controller.ts` (`AT TIME ZONE 'America/Guatemala'`).
- `I-17` (espejo de invitaciones QR): el margen de un día se contaba con `CURRENT_DATE` (UTC). Ahora se cuenta en Guatemala (`sync.controller.ts`).

## T1 — Pagos: un pago resta su monto del saldo · **HECHO**
Regla, casos, concurrencia y datos históricos: **`docs/pagos_saldo.md`**.
- Backend: `utils/saldo.ts` (centavos enteros, `bloquearSaldo`, `restarDelSaldo`, `ExcedeSaldoError`) y `pagos.controller.ts` (efectivo, aprobación de
  transferencias, tarjeta, aviso temprano al subir el comprobante). 422 con `codigo: EXCEDE_SALDO` y el saldo en el cuerpo.
- Interfaz: la advertencia de la tarjeta pasó de «el pago liquida tu saldo y el excedente no se acredita» a **bloquear** el monto mayor al saldo y explicar el
  pago parcial; el formulario del residente y el del administrador avisan antes de enviar; tras un pago parcial con tarjeta el portal muestra el saldo que
  queda, no cero. Textos ES/EN.
- Decisiones: (1) un monto con más de dos decimales es 400; (2) los cargos de reserva se saldan solo cuando el saldo llega a 0 (un pago parcial no elige a cuál
  cargo se aplica); (3) el comprobante se rechaza al subirlo **y** se vuelve a comprobar al aprobarlo; (4) el pago con tarjeta ahora abre transacción antes de
  autorizar (así se bloquea el saldo); una tarjeta rechazada hace `ROLLBACK`, sigue sin guardar nada.
- Pruebas nuevas: I-6 pasó de 11 a 29 casos (parcial/exacto/mayor × 3 métodos, centavos exactos, cargos de reserva, 3 pruebas de concurrencia, coherencia de
  reportes); unitarias del controlador (+4); pantalla (`PagoTarjeta`, `PagosPage`, nueva `ResidentePagosSaldo`).

## T2 — Interfaz de pasarela y preparación de Visanet · **HECHO**
- `backend/src/services/pagos/` (`proveedor.ts`, `simulado.ts`, `visanet.ts`, `index.ts`): interfaz `ProveedorPago`, la simulada de siempre y un adaptador de Visanet
  que lanza `ProveedorNoConfiguradoError`. El controlador (`pagarConTarjeta`) solo usa la interfaz; con la simulada todo se comporta igual (las pruebas que ya existían
  siguen verdes). Con `PAGOS_PROVEEDOR=visanet`: 503 controlado, nada se guarda, auditoría con `{proveedor, motivo}`.
- **Investigación (honesta):** la búsqueda abierta no encontró documentación pública de desarrollador. Lo único verificado: VisaNet Guatemala ahora es **NeoNet** (26/10/2023).
  No se inventó ningún endpoint, firma, 3-D Secure ni webhook. Todo lo demás está en `docs/visanet_integracion.md` (qué se sabe, qué falta, checklist del trámite del comercio con
  documentos, credenciales de sandbox, URLs de retorno y webhook, IPs).
- Decisión: la pasarela simulada ahora guarda su identificador (`SIM-<ult4>-A|R`) en `pagos.referencia`; es el único cambio visible respecto a antes.
- No se tocó `PAGOS_TARJETA_SIMULADA` ni `scripts/deploy.sh`.
- Pendiente para humanos: ver "Pendientes para humanos" (credenciales, contrato, documentación oficial de NeoNet).

> **Pruebas intermitentes ya existentes (no causadas por estas tareas):** `refresh.reuso.int` (I-19, ventana de gracia de 10 s) y `I-11 RESERVA_RECHAZADA`
> (la fecha de la reserva se elige al azar y a veces choca) fallaron una vez cada una bajo carga y pasan al repetir en solitario y en la suite completa (2 corridas verdes seguidas).
> Quedan como deuda: fijar la fecha de esas pruebas.

## T3 — Conjunto sintético y evaluador del DPI · **HECHO**
- `desktop/sidecar-ocr/fixtures-dpi/generar.mjs`: genera imágenes de DPI **ficticios** (tarjeta dibujada con `@napi-rs/canvas`, ya presente como dependencia de `ppu-paddle-ocr`) en
  escenas de webcam con 7 variantes (limpia, luz baja/alta, ángulo, ruido, desenfoque, mixta) + `verdad_terreno.csv`, con semilla. Sin imágenes versionadas (`salida/` está en `.gitignore`).
- `scripts/eval-dpi/index.mjs`: evaluador (motores `local`, `vision`, `ambos`). Métricas: exactitud del CUI y por campo (sin tildes y estricta), tasa de revisión manual, **errores silenciosos**,
  tiempo p50/p95 por captura y meta RNF-03. Vision se invoca por el backend real (`/api/ocr/dpi`, necesita `--backend` y `--token`; **no se ejecutó aquí**: no hay clave de Google ni backend desplegado).
- Corrida de extremo a extremo con el sidecar actual (que aún no extrae DPI): 60 imágenes, 0 % de exactitud esperado, 100 % a revisión, p50 421 ms / p95 536 ms. **Los modelos sí se pudieron descargar**
  (el espejo de GitHub funciona; Hugging Face no) y el sidecar corre aquí de verdad: la T4 se mide con OCR real.
- Pruebas: 7 del evaluador (`node --test scripts/eval-dpi/`) y 3 del generador (`npm --prefix desktop/sidecar-ocr test`). Se arregló el script de pruebas del sidecar: `node --test src/` no
  funciona en Node 22 (pasó a `node --test`, que descubre `*.test.js`).
- `onnxruntime-node` no pudo instalarse con scripts (`ECONNRESET` bajando binarios); con `npm ci --ignore-scripts` basta (trae el binario de CPU de Linux).
