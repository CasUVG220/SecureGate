# SecureGate 🔐

> Sistema Automatizado de Control de Accesos para Residenciales y Condominios

[![Node.js](https://img.shields.io/badge/Node.js-20-green)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-18-blue)](https://reactjs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-blue)](https://postgresql.org)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED)](https://docker.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://typescriptlang.org)

---

## 📋 Descripción

SecureGate es un sistema de software diseñado para automatizar el control de accesos en residenciales, condominios y edificios administrados por empresas inmobiliarias en Guatemala.

El sistema digitaliza y automatiza el proceso de registro de visitantes en garitas de seguridad mediante reconocimiento óptico de documentos de identidad (DPI) y placas vehiculares, eliminando los errores humanos y los conflictos operativos derivados de pagos atrasados.

### Problema que resuelve

Los procesos manuales en garitas de seguridad generan:
- ❌ Errores en el registro de datos de visitantes
- ❌ Largas filas y tiempos de espera excesivos
- ❌ Conflictos cuando residentes tienen pagos atrasados
- ❌ Falta de trazabilidad de accesos

### Solución SecureGate

- ✅ OCR automático de DPI y placas vehiculares
- ✅ Verificación instantánea del estado de pago del residente
- ✅ Generación automática de cargos por mora (sin bloquear el acceso)
- ✅ Trazabilidad completa de todos los accesos
- ✅ App móvil para residentes con pagos y preautorizaciones

---

## 🏗️ Arquitectura del Sistema

SecureGate sigue el patrón **MVC (Modelo-Vista-Controlador)** con separación en 5 paquetes:

```
┌─────────────────────────────────────────────────────┐
│                      view                           │
│  GaritaView  AdminDashboardView  ResidenteAppView   │
└──────────────────────┬──────────────────────────────┘
                       │ DTOs
┌──────────────────────▼──────────────────────────────┐
│                   controller                        │
│  AccesoController  PagoController  CargoController  │
│  OCRService  NotificacionService  ReporteController │
└────────────┬──────────────────────┬─────────────────┘
             │                      │
┌────────────▼──────┐  ┌────────────▼─────────────────┐
│      model        │  │          external             │
│  Visitante        │  │  GoogleCloudVisionAPI         │
│  Residente        │  │  PlateRecognizerAPI           │
│  RegistroAcceso   │  │  StripeAPI                    │
│  Pago             │  └──────────────────────────────┘
│  CargoAutomatico  │
└───────────────────┘
```

---

## 🛠️ Stack Tecnológico

| Capa | Tecnología | Justificación |
|------|-----------|---------------|
| Backend | Node.js + TypeScript | I/O no bloqueante para OCR y pagos concurrentes |
| Frontend | React + Tailwind CSS | Componentes reutilizables, caching con React Query |
| Base de datos | PostgreSQL 15 | ACID + UUID nativo + FK estrictas |
| OCR DPI | Google Cloud Vision API | 98.7% precisión en documentos |
| OCR Placas | Plate Recognizer API | Especializada en ALPR latinoamericano |
| Pagos | Stripe | Confirmación automática de tarjetas |
| Contenedores | Docker + Docker Compose | Entorno reproducible en cualquier máquina |
| Despliegue | Railway | PostgreSQL gestionado con backups automáticos |

---

## 📁 Estructura del Proyecto

```
securegate/
├── docker-compose.yml          # Orquestación de los 3 servicios
├── .gitignore
├── .env.example                # Plantilla de variables de entorno
│
├── backend/                    # API REST Node.js + TypeScript
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts            # Punto de entrada del servidor
│       ├── controllers/        # Lógica de negocio
│       │   ├── AccesoController.ts
│       │   ├── PagoController.ts
│       │   ├── CargoController.ts
│       │   └── ReporteController.ts
│       ├── models/             # Entidades del dominio
│       │   ├── Visitante.ts
│       │   ├── Residente.ts
│       │   ├── RegistroAcceso.ts
│       │   └── Pago.ts
│       ├── services/           # Servicios externos
│       │   ├── OCRService.ts
│       │   └── NotificacionService.ts
│       └── dto/                # Data Transfer Objects
│           ├── VisitanteDTO.ts
│           └── AccesoDTO.ts
│
├── frontend/                   # Aplicación React + Vite
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       └── components/
│
└── database/
    └── init.sql                # Script DDL de inicialización
```

---

## 🗄️ Base de Datos

SecureGate utiliza **PostgreSQL 15** con 9 tablas normalizadas hasta **FNBC**:

```
usuarios ──────── residentes ──────── preautorizaciones
                      │
                      ├──────────── pagos
                      │
                      └──────────── registros_acceso ──── cargos_automaticos
                                         │
                              visitantes ┤
                                         │
                               vehiculos ┘

configuracion_cargos  (independiente)
```

### Tablas principales

| Tabla | Descripción |
|-------|-------------|
| `usuarios` | Agentes, residentes y administradores del sistema |
| `residentes` | Datos específicos de residentes con estado de pago |
| `visitantes` | Personas externas que ingresan al residencial |
| `vehiculos` | Vehículos asociados a visitantes |
| `registros_acceso` | Tabla central — cada evento de entrada/salida |
| `pagos` | Transacciones de cuotas de mantenimiento |
| `cargos_automaticos` | Cargos generados por visitas con mora |
| `configuracion_cargos` | Reglas de cargos configuradas por el admin |
| `preautorizaciones` | Visitas registradas anticipadamente |

---

## 🚀 Instalación y Ejecución

### Requisitos previos

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado y corriendo
- [Git](https://git-scm.com) instalado

### 1. Clonar el repositorio

```bash
git clone https://github.com/CasUVG220/SecureGate.git
cd SecureGate/securegate
```

### 2. Configurar variables de entorno

```bash
cp .env.example .env
```

Editar `.env` con las claves de APIs externas:

```env
GOOGLE_CLOUD_API_KEY=tu_api_key_aqui
PLATE_RECOGNIZER_TOKEN=tu_token_aqui
STRIPE_SECRET_KEY=sk_test_tu_clave_aqui
```

### 3. Levantar el entorno completo

```bash
docker compose up --build
```

La primera vez descarga las imágenes base y construye los contenedores. Toma entre 3 y 5 minutos.

### 4. Verificar que todo funciona

| Servicio | URL | Descripción |
|---------|-----|-------------|
| Frontend | http://localhost:5173 | Aplicación React |
| Backend health | http://localhost:3000/health | Estado del servidor |
| Backend + BD | http://localhost:3000/api/status | Conexión a PostgreSQL |

---

## 🐳 Comandos Docker

```bash
# Levantar todos los servicios (primera vez o tras cambios)
docker compose up --build

# Levantar en segundo plano
docker compose up -d

# Ver logs en tiempo real
docker compose logs -f

# Ver logs de un servicio específico
docker compose logs -f backend

# Ver estado de los contenedores
docker compose ps

# Detener los servicios (conserva los datos)
docker compose down

# Detener y eliminar todos los datos
docker compose down -v

# Acceder a la consola de PostgreSQL
docker compose exec db psql -U sguser -d securegate
```

---

## 📱 Funcionalidades del Sistema

### Flujo principal de garita

1. Visitante llega a la garita
2. Cámara escanea el DPI → Google Cloud Vision extrae los datos
3. Cámara captura la placa → Plate Recognizer la identifica
4. Visitante ingresa el número de casa en panel táctil
5. Sistema verifica estado de pago del residente
6. Si hay mora → genera cargo automático (sin bloquear la entrada)
7. Agente autoriza o deniega el acceso
8. Sistema registra hora de entrada

### Módulos del sistema

| Módulo | Usuarios | Funcionalidad |
|--------|---------|---------------|
| Terminal de Garita | Agente de seguridad | OCR, verificación, autorización |
| App Residente | Residente / Tenant | Pagos, historial, preautorizaciones |
| Dashboard Admin | Administrador | Reportes, configuración, validación de pagos |
| Verificación de Pagos | Administrador | Aprobar/rechazar comprobantes de transferencia |

### Métodos de pago soportados

- 💳 **Tarjeta** — procesado automáticamente por Stripe
- 🏦 **Transferencia bancaria** — residente sube comprobante, admin aprueba
- 💵 **Efectivo** — registrado manualmente por el administrador

---

## 🔌 APIs Externas

### Google Cloud Vision API
- **Uso:** Reconocimiento óptico del DPI guatemalteco
- **Precisión:** 98.7% en documentos impresos
- **Precio:** Primeras 1,000 llamadas/mes gratuitas, luego $1.50/1,000

### Plate Recognizer API
- **Uso:** Detección y lectura de placas vehiculares
- **Ventaja:** Especializada en formatos latinoamericanos
- **Funcionamiento:** Detecta la placa dentro de la foto del vehículo

### Stripe
- **Uso:** Procesamiento de pagos con tarjeta de crédito/débito
- **Confirmación:** Automática sin intervención del administrador

---

## 👥 Equipo de Desarrollo

| Nombre | Carné |
|--------|-------|
| Javier Castillo | 24014 |
| Jorge Morales | 24284 |
| Diego Gonzalez | 24170 |
| David Osorio | 24458 |
| Javier Alvizurez | 24333 |

**Universidad del Valle de Guatemala**
Facultad de Ingeniería — CC3090 Ingeniería de Software 1
Semestre I, 2026

---

## 📄 Licencia

Proyecto académico — Universidad del Valle de Guatemala © 2026
