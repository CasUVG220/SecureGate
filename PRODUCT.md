# SecureGate — qué hace el producto

Control de accesos para residenciales y condominios de Guatemala. Este documento resume **qué hace** cada parte para quien
vende, implanta o soporta el producto; el detalle técnico está en `README.md` y en `docs/`.

| Parte | Para quién | Qué hace |
|---|---|---|
| **Panel web** (`frontend/`, `backend/`) | Owner, administradores de empresa y de sucursal | Residentes y sus pagos, cargos y mora, lista negra, visitas avisadas, invitaciones con QR, garitas y códigos de activación, reportes, bitácora, planes y facturación de SecureGate. |
| **Portal del residente** (web) | Residentes | Avisar de una visita, invitaciones con QR, solicitudes a la administración, pagos y reservas. |
| **App de la garita** (`desktop/`, Tauri) | Agentes de garita | Registro de entradas y salidas **sin internet** (base local cifrada y cola que se sincroniza sola), lectura del DPI y de la placa en el equipo, QR, cámaras USB/IP/celular, apertura de la talanquera por relé y, desde el Sprint 10, **reconocimiento de placas continuo (ANPR)**. |

## Reconocimiento de placas continuo (ANPR) — Sprint 10

Una cámara IP fija por **carril** mira la entrada (o la salida). El equipo de la garita detecta cada vehículo, lo sigue
mientras avanza, lee su placa varias veces y decide **solo**, sin internet:

- **Residente autorizado** (su vehículo está dado de alta por la administración, vigente, el residente activo, la empresa al
  día, fuera de la lista negra y la lectura sin dudas): **entra automático**. Se registra el acceso con su evidencia y se manda
  abrir la talanquera del carril.
- **Lista negra**: alerta roja con sonido en la pantalla del agente. **Nunca abre.**
- **Desconocido, ilegible o lectura dudosa**: el agente decide con la foto de la placa y del vehículo (autorizar, corregir la
  placa, registrar a mano o descartar).
- Un evento por vehículo (no se repite aunque se quede parado) y 60 s sin repetir la misma placa.

Qué necesita la administración: dar de alta los **vehículos de sus residentes** (placa y vigencia). Qué necesita la garita: una
cámara IP fija por carril y, para abrir sola, el relé del integrador (sin relé funciona en modo simulado: registra y avisa).
Cada carril se configura en el equipo: **apagado** (como sale de fábrica), **verificación** (el agente confirma con un toque) o
**automático**; «**Pausar ANPR**» lo detiene todo al instante y la garita sigue con la captura por clic de siempre.

Privacidad: la evidencia es un recorte de la placa y de la **parte baja** del vehículo (sin la cabina), cifrada en el equipo y
borrada a los **7 días** en el equipo y en el servidor.

Estado: funciona de punta a punta con clips sintéticos (medición y pruebas en `docs/anpr_continuo.md`). **Pendiente de validar
con cámaras, relé y equipos reales** (lista en `docs/anpr_continuo.md`, «Validar con hardware real»), y una decisión de negocio:
si las entradas de residentes por ANPR cuentan como «visitas» del plan (hoy sí; ver la misma guía).
