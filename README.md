# SecureGate

> Sistema Automatizado de Control de Accesos para Residenciales y Condominios

[![Node.js](https://img.shields.io/badge/Node.js-20-green)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-18-blue)](https://reactjs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-blue)](https://postgresql.org)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED)](https://docker.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://typescriptlang.org)

---

## Descripcion

SecureGate es un sistema de software disenado para automatizar el control de accesos en residenciales, condominios y edificios administrados por empresas inmobiliarias en Guatemala.

El sistema digitaliza y automatiza el proceso de registro de visitantes en garitas de seguridad mediante reconocimiento optico de documentos de identidad (DPI) a traves de Google Cloud Vision API, eliminando los errores humanos y los conflictos operativos derivados de pagos atrasados.

### Problema que resuelve

Los procesos manuales en garitas de seguridad generan:
- Errores en el registro de datos de visitantes
- Largas filas y tiempos de espera excesivos
- Conflictos cuando residentes tienen pagos atrasados
- Falta de trazabilidad de accesos

### Solucion SecureGate

- OCR automatico de DPI via Google Cloud Vision API
- Ingreso manual de placa vehicular por el agente de garita
- Verificacion instantanea del estado de pago del residente
- Generacion automatica de cargos por mora (sin bloquear el acceso)
- Trazabilidad completa de todos los accesos
- Panel de administracion para gestion de residentes y pagos

---

## Arquitectura del Sistema

SecureGate sigue el patron **MVC (Modelo-Vista-Controlador)** con separacion en 5 paquetes:

```
+-----------------------------------------------------+
|                        view                         |
|   GaritaView    AdminDashboardView    ResidenteApp  |
+----------------------+------------------------------+
                       | DTOs
+----------------------v------------------------------+
|                   controller                        |
|   AccesoController  PagoController  CargoController |
|   OCRService        ReporteController               |
+------------+----------------------+-----------------+
             |                      |
+------------v----------+  +--------v----------------+
|         model         |  |        external         |
|   Visitante           |  |   GoogleCloudVisionAPI  |
|   Residente           |  +-------------------------+
|   RegistroAcceso      |
|   Pago                |
|   CargoAutomatico     |
+-----------------------+
```

---

## Stack Tecnologico

| Capa | Tecnologia | Justificacion |
|------|-----------|---------------|
| Backend | Node.js + TypeScript | I/O no bloqueante para operaciones concurrentes |
| Frontend | React + Tailwind CSS | Componentes reutilizables, UI reactiva |
| Base de datos | PostgreSQL 15 | ACID + UUID nativo + FK estrictas |
| OCR DPI | Google Cloud Vision API | Alta precision en documentos guatemaltecos |
| Contenedores | Docker + Docker Compose | Entorno reproducible en cualquier maquina |
| Despliegue | Railway | PostgreSQL gestionado con backups automaticos |

---

## Estructura del Proyecto

```
securegate/
├── docker-compose.yml          # Orquestacion de los 3 servicios
├── .gitignore
├── .env.example                # Plantilla de variables de entorno
│
├── backend/                    # API REST Node.js + TypeScript
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts            # Punto de entrada del servidor
│       ├── routes/             # Definicion de rutas
│       ├── controllers/        # Logica de negocio
│       ├── middleware/         # Autenticacion JWT
│       ├── models/             # Entidades del dominio
│       └── db/                 # Conexion a PostgreSQL
│
├── frontend/                   # Aplicacion React + Vite
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── pages/              # Vistas principales
│       ├── components/         # Componentes reutilizables
│       └── services/           # Llamadas a la API
│
└── database/
    └── init.sql                # Script DDL de inicializacion
```

---

## Base de Datos

SecureGate utiliza **PostgreSQL 15** con 9 tablas normalizadas hasta **FNBC**:

```
usuarios --------- residentes --------- preautorizaciones
                       |
                       +------------- pagos
                       |
                       +------------- registros_acceso --- cargos_automaticos
                                            |
                               visitantes --+
                                            |
                                vehiculos --+

configuracion_cargos  (independiente)
```

| Tabla | Descripcion |
|-------|-------------|
| `usuarios` | Agentes, residentes y administradores del sistema |
| `residentes` | Datos especificos de residentes con estado de pago |
| `visitantes` | Personas externas que ingresan al residencial |
| `vehiculos` | Vehiculos asociados a visitantes |
| `registros_acceso` | Tabla central — cada evento de entrada/salida |
| `pagos` | Transacciones de cuotas de mantenimiento |
| `cargos_automaticos` | Cargos generados por visitas con mora |
| `configuracion_cargos` | Reglas de cargos configuradas por el admin |
| `preautorizaciones` | Visitas registradas anticipadamente |

---

## Instalacion y Ejecucion

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
JWT_SECRET=tu_jwt_secret_aqui
```

### 3. Levantar el entorno completo

```bash
docker compose up --build
```

La primera vez descarga las imagenes base y construye los contenedores. Toma entre 3 y 5 minutos.

### 4. Verificar que todo funciona

| Servicio | URL | Descripcion |
|---------|-----|-------------|
| Frontend | http://localhost:5173 | Aplicacion React |
| Backend health | http://localhost:3000/health | Estado del servidor |
| Backend + BD | http://localhost:3000/api/status | Conexion a PostgreSQL |

---

## Comandos Docker

```bash
# Levantar todos los servicios
docker compose up --build

# Levantar en segundo plano
docker compose up -d

# Ver logs en tiempo real
docker compose logs -f

# Ver logs de un servicio especifico
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

## Funcionalidades del Sistema

### Flujo principal de garita

1. Visitante llega a la garita
2. Agente escanea el DPI con la camara — Google Cloud Vision extrae los datos
3. Agente ingresa la placa del vehiculo manualmente
4. Agente ingresa el numero de casa del visitante
5. Sistema verifica estado de pago del residente
6. Si hay mora — genera cargo automatico (sin bloquear la entrada)
7. Agente autoriza o deniega el acceso
8. Sistema registra hora de entrada y salida

### Modulos del sistema

| Modulo | Usuarios | Funcionalidad |
|--------|---------|---------------|
| Terminal de Garita | Agente de seguridad | OCR de DPI y de placa, verificacion, autorizacion |
| Dashboard Admin | Administrador | Gestion de residentes, reportes, configuracion de cargos |
| Gestion de Pagos | Administrador | Registro de pagos en efectivo, aprobacion de transferencias |

### Metodos de pago soportados

- Transferencia bancaria — residente sube comprobante, admin aprueba
- Efectivo — registrado manualmente por el administrador

---

## API Externa

### Google Cloud Vision API
- **Uso:** Reconocimiento optico del DPI y del plate guatemalteco
- **Precision:** Alta en documentos impresos
- **Precio:** Primeras 1,000 llamadas/mes gratuitas, luego $1.50/1,000

---

## Equipo de Desarrollo

| Nombre | Carne |
|--------|-------|
| Javier Castillo | 24014 |
| Jorge Morales | 24284 |
| Diego Gonzalez | 24170 |
| David Osorio | 24458 |
| Javier Alvizurez | 24333 |

**Universidad del Valle de Guatemala**
Facultad de Ingenieria — CC3090 Ingenieria de Software 1
Semestre I, 2026

---

## Licencia

Proyecto academico — Universidad del Valle de Guatemala 2026
