# Glosario de SecureGate

Una sola palabra para cada cosa, en toda la interfaz (web, escritorio y correos). Lo hizo cumplir SCRUM-113 (H06/H08
del QA) y lo vigila la prueba `frontend/src/i18n/__tests__/glosario.test.ts`: si un texto vuelve a usar un término
descartado, la prueba falla. **El código, la API y la base de datos conservan sus nombres técnicos** (`blacklist`,
`tickets`, `preautorizaciones`, `licencias_dispositivo`…); este glosario habla solo de lo que la persona lee.

Idioma de la interfaz: español de Guatemala, tuteo («tu sucursal», «escribe el código»). Los botones van en infinitivo
(«Guardar», «Dar de baja», «Quitar bloqueo») y los errores dicen qué pasó y qué hacer.

## Términos

| Concepto | Se dice (ES) | Se dice (EN) | No se dice | Dónde |
|---|---|---|---|---|
| Impedir el ingreso de una persona o un vehículo | **Bloquear**, **bloqueo**, **bloqueado**, **Quitar bloqueo**. La sección se llama **Lista negra** («Lista negra de visitantes y vehículos») | Block, remove block. Section: Blacklist | ban, banear, «Agregar ban», «Remover ban», vetar | Lista negra, aviso de la garita, duración |
| Petición de un residente a la administración (con chat) | **Solicitud** / **Solicitudes**, «Nueva solicitud», «Cerrar solicitud» | Request / Requests | ticket(s), «Solicitudes / Tickets», «Nuevo ticket» | Menú, portal del residente, chat |
| Equipos de la garita y su alta | Menú **Garitas**; pantalla **Garitas y códigos de activación**; «Nuevo código de activación», «Revocar código»; un código está **activo / sin activar / revocado** | Gates, activation code | «licencia» en la web de administración, «terminal garita», «dispositivo» | Menú, administración de equipos |
| Estado del equipo dentro de la app de escritorio | **Licencia** (solo en la app de escritorio, donde es el *estado* del equipo y no el código que se genera) | License | — | Barra de estado de la garita, pantalla de activación |
| Cifras de la comunidad | **Reportes** (menú y pantalla «Reportes de la comunidad»); se descargan «reporte de entradas» y «reporte de pagos» | Reports | **Estadísticas**, «Análisis» como nombre de pantalla | Menú, reportes, exportaciones |
| Visitas que pasaron por la garita | **Entradas** (también las de los residentes que entraron por sus placas; pantalla **Entradas** de la administración) | Entries | «ingresos» (se confunde con dinero) | Reportes, tablas, Entradas |
| Entrada que registró el reconocimiento de placas solo (Sprint 10) | **Automático (placas)**, como método junto a *Manual*, *Clic* y *QR* | Automatic (plates) | «ANPR» a secas en la web de administración, «auto» | Entradas, panel, reporte de entradas (columna `metodo`) |
| Entrada por placas que un agente confirmó o corrigió con un toque | **Verificado por agente** (al pasar el cursor: «Confirmó: nombre») | Verified by agent | «validado», «aprobado manualmente» | Entradas, panel |
| Placas con las que un residente entra solo | **Placas autorizadas** de la casa («Placas autorizadas — Casa 12»): **Agregar placa**, **Quitar**. Una placa en una sola casa de la empresa; formato guatemalteco (`P-123ABC`) | Authorized plates · Add plate · Remove | «vehículos del residente», «placas permitidas» | Residentes (administración de sucursal) |
| Dinero que se recibió | **Cobrado** / **recaudado**, «pagos» | Collected, payments | «ingresos» para visitas | Reportes, pagos |
| Reglas de validación de los códigos QR | Entrada propia del menú **Reglas de QR** | QR rules | «Config QR», una pestaña dentro de cargos | Menú de administración |
| Cargos automáticos por atraso | Menú **Cargos y mora** (antes «Configuración») | Charges & late fees | «Configuración» a secas (ambigua) | Menú de administración |
| Código para entrar sin escribir datos | **Invitación con QR**; el texto bajo el QR es **«código de la invitación»** | QR invitation, invitation code | «pase», «ticket de acceso» | Portal del residente, garita |
| Avisarle a la garita que alguien va a llegar | **Aviso de visita**: botón **Avisar de una visita**; la lista es **Visitas avisadas**; cada una está *Hoy*, *Próxima* o *Vencida*. En la garita: «Visita avisada por el residente hasta el 12 oct 2026» | Announce a visitor · Announced visits | «preautorizar», «preautorización», «Preautorizar hoy» (en la base y la API sigue siendo `preautorizaciones`) | Menú, portal del residente, garita |
| Datos de alguien que visita seguido | **Visitante guardado** (libreta del residente). **Guardar no deja entrar a nadie**: hay que **avisar de su visita** con fechas | Saved visitor | tratarlo como un aviso | Portal del residente |
| Persona que administra una empresa o sucursal | **Administrador** («administrador de empresa», «administrador de sucursal») | Administrator | «Admin», «Admin Sucursal» abreviados | Menús, botones, avisos |
| Empresa o sucursal recién creada | Se marca **Sin administrador** o **Invitación pendiente** y se ofrece **Invitar administrador** | No administrator · Invitation pending | — | Listas de empresas y sucursales |
| Rótulo del menú del administrador de empresa | **Mi empresa** (el rótulo **Administración global** es solo del owner) | My company | «Administración global» para el administrador de empresa | Menú |
| Segundo factor del acceso de los administradores | **Verificación en dos pasos**: el **código de verificación** (seis dígitos de la app de autenticación) y los **códigos de recuperación** (10, de un solo uso). Se activa en **Mi cuenta**; si alguien lo pierde todo, su superior le **restablece la verificación en dos pasos** | Two-step verification · verification code · recovery codes | «2FA», «MFA», «autenticación en dos factores», «token», «OTP» | Mi cuenta, pantalla de acceso, Personal |
| Pantalla de datos y seguridad de la propia persona | **Mi cuenta** (menú de los tres roles de administración) | My account | «Perfil», «Mi perfil» | Menú |
| Lo que contrata una empresa de SecureGate | **Plan** (Básico, Estándar, Profesional…): cuota mensual, visitas incluidas, **visita adicional** (el precio de cada visita que pasa de lo incluido), límite de sucursales y de garitas. Estados: **En prueba / Activa / Vencida / Cancelada**. Menú del administrador de empresa: **Mi plan**; del owner: **Planes y cobros** | Plan · included visits · additional visit · Trial / Active / Overdue / Canceled | «paquete», «licencia» (eso es el equipo de la garita), «tarifa» | Mi plan, Planes y cobros, correos |
| Lo que SecureGate le cobra a una empresa | **Factura** de SecureGate (una por mes, número `SG-000123`), con **cuota del plan** y **visitas adicionales**; estados **Pendiente / Pagada / Vencida / Anulada**; el owner la **marca pagada** con la forma de pago y su **referencia o número de boleta** | Invoice · fee · additional visits · Pending / Paid / Overdue / Voided | mezclarla con los **pagos** y **cargos** de los residentes (son otra cosa y otras tablas) | Mi plan, Planes y cobros |
| Alta de una empresa nueva sin ayuda de SecureGate | **Registrar mi empresa** (pantalla pública `/registro`) y el **asistente de alta** (empresa, sucursal, plan, revisar); al final llega una **invitación** para crear la cuenta de administrador | Register my company · setup wizard | «registro» a secas para los residentes | Acceso, correos |
| Descarga de los datos de la empresa | **Descargar mis datos (.zip)**: archivos CSV con los datos de **esa** empresa; contiene datos personales | Download my data | «backup», «respaldo» (no lo es: no sirve para restaurar) | Mi plan |
| Lugar que visita la persona | **Casa** | House | «unidad» en pantallas de residentes | Todas |
| Documento de identidad | **DPI** | National ID | «documento», «cédula» | Formularios |
| Leer el DPI con la cámara (Sprint 10: 100 % en el equipo) | **Leer DPI**; la lectura dudosa deja los campos con la marca **Revisar** y la foto capturada; el agente **confirma**, **corrige** o lo escribe a mano. Pista del botón: «Se lee en este equipo, sin internet» | Read ID · Review | «OCR remoto», «servicio en la nube», «requiere internet» para el DPI; «escanear» en el botón | App de escritorio (garita) |
| Cámara de seguridad conectada por la red | **Cámara IP** (en el escritorio, junto a **Celular como cámara**); se agrega en «Cámaras de esta garita → Cámaras IP y celulares»; **Probar conexión** antes de guardar; estados **En vivo / Reconectando / Sin señal** | IP camera, phone as a camera | «stream», «feed», «RTSP» a secas en pantallas del agente | App de escritorio |
| Lectura automática de placas en un carril con cámara fija (Sprint 10) | **Reconocimiento de placas**; la sigla **ANPR** solo en rótulos cortos («Pausar ANPR», «Eventos del ANPR», «Carriles del ANPR») | License plate recognition (ANPR) | «LPR», «lector de placas», «OCR continuo» en pantallas del agente | App de escritorio, documentación |
| Una cámara fija mirando una entrada o una salida | **Carril** («Nuevo carril», «Área del carril», «Reconocer placas en este carril»); modos **Apagado / Verificación / Automático** | Lane; Off / Verification / Automatic | «pista» o «canal» para el carril | Configuración de carriles, panel del ANPR |
| El seguimiento de UN vehículo dentro del carril | **Pista** (`track_id`). En pantalla, solo con su número para distinguir vehículos a la vez: **Pista 3** en la lista «Vehículos en *carril*» y en cada evento, **#3** en la caja de la vista en vivo; lo demás se dice del **vehículo** | Track | «track», «tracking» en pantallas del agente | Vista en vivo y eventos del ANPR, documentación |
| Vehículo que el sistema sigue en este momento en un carril | **Pista activa** (en la documentación); en pantalla, cada fila de «Vehículos en *carril*»: **Pista N**, la placa o **«leyendo…»** (o «sin lectura») y su estado (*Detectado, Siguiendo, Leyendo, Confirmado, Ilegible*) | Active track · reading… | «objeto», «detección» | Vista en vivo del ANPR |
| Varias lecturas iguales antes de dar una placa por buena | **Consenso** en la documentación; en pantalla se muestran la **confianza** («confianza 95 %») y las lecturas | Consensus | «votación» | Documentación, eventos del ANPR |
| Lo que abre la talanquera cuando un residente entra solo | En pantalla: **talanquera** («Probar talanquera», «La talanquera no respondió», «Talanquera abierta (simulada)»). **Actuador** solo en la documentación técnica y el código (`ActuadorBarrera`) | Barrier / boom gate (actuator) | «barrera» en pantallas de la garita (ya se dice **talanquera**), «relé» como nombre de la sección | Configuración de carriles, eventos y avisos del ANPR |
| Quién trabaja en la garita | **Agente de garita** (rol) · **Personal** (la lista) | Gate agent · Staff | «guardia» en rótulos, «terminal» | Menú, personal |
| Baja de una persona del personal | **Dar de baja**: deja de poder entrar y se le cierran las sesiones; su historial se conserva | Deactivate | «Eliminar» para una baja suave | Personal |

## Formatos

| Dato | Formato | Ejemplo | Dónde se define |
|---|---|---|---|
| Fecha | día, mes abreviado y año | `1 nov 2026` (EN: `Nov 1, 2026`) | `frontend/src/utils/fecha.ts` |
| Hora | 24 horas | `14:35` | idem |
| Fecha y hora | fecha, coma, hora | `1 nov 2026, 14:35` (sin año en chats: `1 nov, 14:35`) | idem |
| Zona horaria | **America/Guatemala** para toda hora; los campos DATE (reservas, preautorizaciones) se leen como día de calendario sin corrimiento | — | idem (`formatearDia` vs `formatearFecha`) |
| Sin dato | raya | `—` (nunca «Invalid Date») | idem |
| «Hoy» | el día de Guatemala, no el de UTC | `hoyEnZona()` | idem |
| Placa | se **escribe y se muestra** como `P-123ABC` y se **guarda y compara** como `P123ABC` (mayúsculas, sin separadores) | `P-123ABC` / `P123ABC` | `frontend/src/utils/placa.ts`, `backend/src/utils/placa.ts`, `desktop/src/lib/placa.ts` |
| Dinero | quetzal pegado a la cifra, dos decimales | `Q850.00` | `fmtQuetzales` |

## Aviso de visita: reglas (SCRUM-114)

Una fila de `preautorizaciones` es de **uno de dos tipos**, según tenga o no `fecha_fin`:

- **Con `fecha_fin`** → un **aviso de visita**: vale para entrar entre `fecha_inicio` y `fecha_fin` (ambas obligatorias en el
  formulario; para una sola visita van las dos con el mismo día y empiezan en hoy).
- **Sin `fecha_fin`** → un **visitante guardado** de la libreta del residente (`POST /api/preautorizaciones/mis`). **No
  autoriza nada**: ni la verificación en línea, ni el padrón que baja la garita, ni la evaluación local del escritorio.

El alta del administrador (`POST /api/preautorizaciones`) exige `fecha_fin` (antes el formulario la mostraba «opcional» y el
servidor ignoraba la fila). Ambas altas validan `AAAA-MM-DD` y `fecha_fin ≥ fecha_inicio`, y rechazan con **409** un aviso idéntico
(misma persona o vehículo —DPI y placa normalizada— y mismas fechas); dos visitantes distintos en el mismo carro no se pisan.

## Cómo se mantiene

1. **Un término nuevo** se agrega a la tabla de arriba antes de usarlo en pantalla.
2. **Un término descartado** se agrega a `glosario.test.ts`; así no vuelve a colarse desde otra pantalla.
3. Las claves de `translations.ts` se cambian en español **y** en inglés a la vez.
4. Las fechas se formatean solo con `utils/fecha.ts` (la prueba `sinToLocale.test.ts` lo exige).
