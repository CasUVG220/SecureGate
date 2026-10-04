# Verificación en dos pasos para administradores (SCRUM-123)

Los administradores (**owner, administrador de empresa y administrador de sucursal**) pueden pedir, además de la contraseña, un código de seis dígitos que
genera una app de autenticación (Google Authenticator, Microsoft Authenticator, Authy, 1Password…). Con ella activa, una contraseña robada o adivinada
no basta para entrar. El personal de garita y los residentes no la usan: su acceso es operativo y no administra datos de terceros.

## Cómo se usa

**Activarla** (menú *Mi cuenta* → *Verificación en dos pasos*):

1. *Activar* muestra un código QR (y el secreto en texto por si no se puede escanear).
2. Se escanea con la app de autenticación y se escribe el código de seis dígitos que muestra **y la contraseña** (se pide como para desactivarla: quien solo tenga una sesión robada no puede activarla con su propio teléfono y dejar fuera al titular).
3. Con la contraseña y un código correctos queda activa y se muestran **una sola vez** 10 códigos de recuperación. Hay que guardarlos (impresos o en un gestor de contraseñas).

**Entrar**: correo y contraseña → la pantalla pide el código de seis dígitos (o *Usar un código de recuperación*). El código de la app vale 30 segundos
(se tolera un intervalo de desfase del reloj) y **no se puede usar dos veces**; cada código de recuperación también vale una sola vez.

**Desactivarla** pide la contraseña **y** un código (de la app o de recuperación). **Generar códigos nuevos** pide un código de la app e invalida los anteriores.

**Si a alguien lo degradan a agente de garita** (administrador → agente, desde *Personal*), pierde la verificación en dos pasos en ese mismo momento: la app de escritorio no tiene segundo paso y la web no admite agentes, así que con el segundo factor activo quedaría sin poder entrar a ningún lado. Queda en la bitácora (`USUARIO_EDITADO` con `dos_pasos_quitada`). Bajar de rol por otra vía (SQL directo) **no** lo quita: el ingreso sigue exigiéndolo, para que bajar el rol no sea una forma de saltárselo.

**Si alguien pierde el teléfono y los códigos**: su superior se la restablece desde *Usuarios* (administrador de empresa → administradores de sus sucursales;
owner → administradores de empresa). Eso borra el segundo factor, **cierra las sesiones** de la persona y queda en la bitácora (`TWOFA_RESTABLECIDO`). El
**owner** no tiene a nadie por encima en la aplicación; se restablece desde la consola del servidor:

```bash
CUENTA_EMAIL=ana@empresa.com npm run cuenta:restablecer-2fa      # en backend/, con DATABASE_URL del servidor
```

También deja una fila en `audit_logs` (`TWOFA_RESTABLECIDO`, detalle `via: consola`). Exige acceso al servidor y a su base, que es justo lo que protege este paso.

## Decisión: opcional, no obligatoria (por ahora)

El criterio de aceptación dejaba al equipo decidir si es obligatoria. Se dejó **opcional** (cada administrador la activa) por tres razones: (1) hacerla
obligatoria exige una sesión restringida «solo para configurar el segundo factor» —el administrador entra con la contraseña pero no puede usar nada más hasta
escanear el QR—, y eso cambia cómo se emiten y se validan las sesiones en toda la API; (2) activarla a quien ya trabaja en producción sin avisar los dejaría
fuera el primer día; (3) la protección más importante, el bloqueo de intentos, ya existe para quien la activa. **Siguiente paso recomendado**: una variable
`TWOFA_OBLIGATORIO=owner,admin_empresa` y la sesión restringida; ver «Límites conocidos».

## Cómo está hecha

| Pieza | Decisión |
|---|---|
| Código | TOTP del RFC 6238 (HMAC-SHA1, 6 dígitos, 30 s): lo que entienden todas las apps. Implementación mínima propia sobre el `crypto` de Node (`backend/src/utils/twofa.ts`), **sin dependencias nuevas**. Se probó contra los vectores del RFC 4226/6238 y contra una librería de referencia (900 comparaciones sin diferencias). Se descartó `otplib` porque depende de paquetes solo-ESM que no cargan en Jest |
| Secreto | 20 bytes aleatorios (160 bits). En la base va **cifrado** (AES-256-GCM, con el usuario como dato autenticado: copiado a otra fila no descifra). Una copia de la base sola no permite generar códigos |
| Llave | `TWOFA_KEY` si está definida (≥ 32 caracteres); si no, se deriva (HKDF) de `JWT_SECRET`. No hace falta ninguna variable nueva |
| Reutilización | `usuario_2fa.ultimo_paso` guarda el último intervalo aceptado; un código de ese intervalo o anterior se rechaza. Se reclama con un `UPDATE` atómico: dos peticiones simultáneas con el mismo código no entran las dos |
| Códigos de recuperación | 10 de 10 caracteres (`XXXXX-XXXXX`, sin 0/O/1/I). Se guardan como **HMAC-SHA256 con llave del servidor**: con la base sola no se leen ni se adivinan (son de 50 bits). Se consumen con un `UPDATE … WHERE usado_en IS NULL` |
| Ingreso | La contraseña correcta responde `200 { requiere_2fa: true, desafio }` **sin sesión**. El desafío es un JWT de 5 min con `typ: '2fa'`: `verifyToken` rechaza todo token con `typ`, así que no sirve como sesión. `POST /api/auth/2fa/verificar` lo canjea por la sesión con un código. Se sigue exigiendo aunque la persona cambie de rol |
| Cuenta suspendida o dada de baja entre los dos pasos | Se vuelve a comprobar al verificar: 423 / 401 |

### Intentos limitados (criterio de aceptación)

- **Por persona, en la base**: 5 fallos del segundo factor en 15 minutos → la persona queda **bloqueada 15 minutos** (429 con `Retry-After`), no importa desde cuántas IPs ni con
  cuántos desafíos distintos intente. Un acierto reinicia la cuenta. Es **la misma cuenta** para el ingreso, confirmar, desactivar y regenerar códigos, y mientras dura
  el bloqueo ni el código correcto entra. Solo alcanza a quien ya sabe la contraseña (sin ella no hay desafío), por lo que no sirve para bloquear cuentas ajenas
  a ciegas (S-10, ver `docs/acciones_sensibles.md`).
- **Límites de tasa** (`crearLimitador`, los bloqueos se auditan): 30 fallos / 15 min por IP en el ingreso; por usuario, 5 en desactivar y 10 en confirmar / regenerar.
  Ajustables con `RATE_LIMIT_2FA_MAX`, `RATE_LIMIT_2FA_DESACTIVAR_MAX`, `RATE_LIMIT_2FA_CONFIRMAR_MAX` y `RATE_LIMIT_2FA_CODIGOS_MAX` (solo para pruebas de carga).
- Una contraseña errada al **activar** o al **desactivar** no gasta intentos del segundo factor (se comprueba primero, y cuenta en el límite por usuario de esa ruta).
- Las rutas con sesión responden **400** (no 401) cuando el código o la contraseña están mal: el cliente trata todo 401 como «sesión vencida» y sacaría a la persona de la pantalla.

### Auditoría (RNF-10)

Cada evento deja usuario, fecha, IP y código HTTP en `audit_logs`; **nunca** el secreto, el código ni la contraseña (hay una prueba que lo comprueba).

| Acción | Cuándo |
|---|---|
| `TWOFA_INICIADO` | Empieza la configuración (entrega el secreto) |
| `TWOFA_ACTIVADO` | Confirma la contraseña y el primer código (también el intento fallido, sin contraseña o bloqueado) |
| `TWOFA_DESACTIVADO` | Desactivarla (también el intento fallido o bloqueado) |
| `TWOFA_CODIGOS_REGENERADOS` | Códigos de recuperación nuevos |
| `TWOFA_VERIFICACION` | Segundo paso del ingreso: correcto (`via`: `totp` / `recuperacion`), incorrecto (401), bloqueado (429, `motivo` o `limite`) |
| `TWOFA_RESTABLECIDO` | Un superior (o la consola) la restablece |

Además, el `LOGIN` con contraseña correcta y segundo factor pendiente queda con `200` y `segundo_paso: pendiente` en el detalle: aún no hay sesión.

## Operación

- **Reloj del servidor**: el código depende de la hora. El servidor debe sincronizarse por NTP (la VM de Google lo hace por defecto). Un desfase de más de 30 s hace fallar todos los códigos.
- **Rotar `JWT_SECRET`** cambia la llave derivada y los secretos guardados dejarían de descifrar. **Antes de rotarlo**, define `TWOFA_KEY` con el valor *actual* de `JWT_SECRET`
  (la llave derivada es la misma) y recién entonces rota `JWT_SECRET`. Si ya se rotó sin hacerlo, los administradores con la verificación activa no podrán entrar (el log del servidor dice
  `[2fa] no se pudo descifrar el secreto…`): se restablece su segundo factor (arriba) o se vuelve al secreto anterior.
- `TWOFA_KEY` llega al contenedor por `docker-compose.yml` / `docker-compose.prod.yml` (vacía por omisión). Si se define, el arranque la valida (≥ 32 caracteres, no un valor público).
- Esquema: `usuario_2fa` y `usuario_2fa_recuperacion` en `database/init.sql` (idempotente, con `ON DELETE CASCADE` desde `usuarios`). Usan `TIMESTAMPTZ`, a diferencia del resto del esquema (S-17).

## Pruebas

- `backend/src/__tests__/twofa.test.ts` — vectores del RFC, tolerancia de reloj, anti-reutilización, cifrado del secreto, códigos de recuperación, desafío.
- `backend/src/__tests__/integration/twofa.int.test.ts` (I-15) — activar, ingresar, códigos de recuperación, bloqueo por intentos, desactivar, roles, restablecer, y que no quede ningún secreto en la bitácora.
- `backend/src/__tests__/integration/twofa.limites.int.test.ts` (I-16) — límites de tasa y su rastro.
- `backend/src/__tests__/integration/auditoria.int.test.ts` (I-11) — una fila por cada acción `TWOFA_*`, con persona e IP.

## Límites conocidos y siguientes pasos

1. **No es obligatoria.** Para exigirla hace falta la sesión restringida descrita arriba y un plazo de gracia para quienes ya trabajan.
2. **Sin aviso por correo** al activar, desactivar o restablecer (la bitácora sí lo registra). Conviene sumarlo cuando haya correo transaccional en producción.
3. **Solo TOTP.** Llaves físicas / passkeys (WebAuthn) serían un segundo método, no un reemplazo.
4. **La app de escritorio de la garita** no la usa (los agentes no la tienen). Si un administrador con la verificación activa inicia sesión allí, recibe un mensaje claro de que debe usar la versión web.
