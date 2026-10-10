# Renovación de sesión y detección de robo (refresh tokens) — SCRUM-124 / S-06

Cada inicio de sesión entrega un *refresh token* (cookie `httpOnly`, 7 días) que sirve para pedir un access token nuevo cada hora. Desde el Sprint 9 el servidor **detecta cuando un refresh token ya usado se presenta otra vez** (señal de que alguien tiene una copia) y cierra la sesión.

## Cómo funciona

| Concepto | Detalle |
|---|---|
| **Familia** | Un inicio de sesión = una familia (`refresh_tokens.familia_id`). Renovar **rota**: el token viejo queda revocado (`rotado_en`, `revoked_at`, `reemplazado_por`) y el nuevo hereda la familia, todo en una sola sentencia SQL atómica. Otra sesión de la misma persona (otro dispositivo) es otra familia y no se ve afectada |
| **Ventana de gracia: 10 s** | Si un token rotado hace menos de 10 s se presenta otra vez, **no es robo**: son dos pestañas que renovaron a la vez (leyeron la misma cookie antes de que llegara la respuesta de la primera). Cada petición recibe su propio sucesor en la misma familia y la sesión sigue |
| **Reutilización** | Un token rotado hace **más** de 10 s que se presenta otra vez cierra la **familia entera**: se revocan todos sus tokens vivos (`cierre_motivo = 'reutilizacion'`), se cortan los access tokens vigentes de la persona, se responde `401 { codigo: 'sesion_comprometida' }` y se audita `REFRESH_REUTILIZADO` (persona, IP, cuántos tokens se cerraron). Tanto el dueño como quien tenga la copia tienen que iniciar sesión de nuevo |
| **Familia ya cerrada** | Un token de una familia cerrada nunca emite uno nuevo, ni siquiera dentro de la gracia de un token hermano rotado hace un instante (la guarda está en el propio `INSERT`). El dueño legítimo recibe `sesion_comprometida` —para que sepa por qué pierde la sesión— y queda como `REFRESH_RECHAZADO` (`sesion_cerrada_por_reuso`), no como otro evento de robo |
| **Lo que NO es robo** | Cierre de sesión, cambio de contraseña, baja del usuario o suspensión de la empresa revocan sin `rotado_en`: dan el 401 de siempre (`REFRESH_RECHAZADO`, `token_revocado`) y no cierran nada más |

La web guarda el aviso (`sg_aviso_sesion`) y la pantalla de acceso lo muestra una vez; la app de escritorio muestra el texto del servidor y la garita sigue registrando entradas sin conexión.

## Ajustes

`REFRESH_GRACIA_SEGUNDOS` (por omisión 10; un valor no numérico vuelve a 10). Subirlo hace más tolerante al sistema ante respuestas que tardan; bajarlo (0 = sin gracia) lo vuelve estricto. Solo para pruebas de carga o ajuste fino: no hace falta en `docker-compose`.

## Riesgo asumido: la respuesta de renovación que se pierde

El servidor rota el token **antes** de que el cliente reciba la respuesta. Si la respuesta se pierde (conexión inestable) y el cliente reintenta con el token viejo **después de 10 s**, el servidor lo ve como reutilización y cierra la sesión: la persona tiene que iniciar sesión de nuevo y verá el aviso «Por seguridad cerramos tu sesión…».

- En la **web** es raro (una renovación por hora, con la página abierta, que reintenta de inmediato).
- En la **garita de escritorio**, con internet inestable, puede pasar de vez en cuando: el equipo sigue registrando entradas sin conexión (no se pierde nada), pero **no sincroniza** hasta que el agente inicie sesión otra vez. Si en la práctica se ve seguido, subir `REFRESH_GRACIA_SEGUNDOS` a 30–60 s: el costo es que un robo se detecta solo si la copia se presenta pasado ese tiempo (con una gracia de 60 s, quien presente el token robado dentro del minuto siguiente a la rotación legítima no dispara la alarma).
- Es la compensación habitual de la rotación con detección de reutilización (Auth0 la llama *leeway*); no hay forma de distinguir «respuesta perdida» de «copia robada» desde el servidor.

## Pruebas

- `backend/src/__tests__/integration/refresh.reuso.int.test.ts` (**I-18**, 10 casos) — familia heredada, reutilización fuera de la gracia, otra sesión intacta, gracia, carrera simultánea, familia ya cerrada que no emite nada, cierre de sesión y cambio de contraseña que no son robo.
- `backend/src/__tests__/refresh.reuso.test.ts` (9 casos) — las ramas del controlador con la base simulada.
- `backend/securitytest/03-jwt.js` — la suite de seguridad en vivo (actualizada; se corre con `npm run securitytest` contra el stack local).
