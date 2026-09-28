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
- OCR automatico de placa vehicular via Google Cloud Vision API
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
| OCR DPI + Placa | Google Cloud Vision API | Alta precision en documentos y placas guatemaltecas |
| Contenedores | Docker + Docker Compose | Entorno reproducible en cualquier maquina |
| Despliegue | Railway | PostgreSQL gestionado con backups automaticos |

---

## Estructura del Proyecto

```
securegate/
├── docker-compose.yml          # Orquestacion de los 3 servicios (uso diario)
├── docker-compose.prod.yml     # Solo produccion: nginx + SSL (ver nota abajo)
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

Editar `.env` (no se sube a git):

```env
# Mínimo 32 caracteres. Genera uno con:  openssl rand -hex 48
JWT_SECRET=
# Opcional (OCR de respaldo con Google Vision)
GOOGLE_CLOUD_API_KEY=
```

> **`JWT_SECRET` ya no tiene un valor por defecto.** El que estaba escrito en el
> compose era público (vivía en el repositorio) y con él cualquiera fabricaba un
> token de `owner`. Si no lo defines, el backend genera uno aleatorio en cada
> arranque (las sesiones y las licencias de garita se invalidan al reiniciar), y
> `scripts/deploy.sh` crea uno persistente en `.env` la primera vez. En
> producción el backend **se niega a arrancar** si falta, es corto o es uno de
> los valores públicos.

### 3. Levantar el entorno completo

```bash
docker compose up --build -d
```

El mismo comando sirve en local y en cualquier VM nueva: no hay que editar el
compose ni definir variables extra por servidor. La primera vez descarga las
imagenes base y construye los contenedores; toma entre 3 y 5 minutos.

### 3.1 Cuentas de demostración (sólo desarrollo)

El compose de desarrollo define `SEED_DEMO=true`, así que al arrancar el backend
crea una empresa demo y una cuenta por rol (`admin@securegate.com`,
`empresa@…`, `sucursal@…`, `agente1@…`, `r1@…`; las contraseñas están en
`database/seed-dev.sql`). **Son públicas: sólo existen en desarrollo.** En
producción (`NODE_ENV=production`) el backend no las siembra y **desactiva
automáticamente** las que sigan con la contraseña original.

### 4. Verificar que todo funciona

Reemplaza `<IP-del-servidor>` por `localhost` en tu maquina, o por la IP
publica de la VM si levantaste el entorno alli.

| Servicio | URL | Descripcion |
|---------|-----|-------------|
| Frontend | http://\<IP-del-servidor\>:5173 | Aplicacion React |
| Backend health | http://\<IP-del-servidor\>:3000/health | Estado del servidor |
| Backend + BD | http://\<IP-del-servidor\>:3000/api/status | Conexion a PostgreSQL |

```bash
docker compose ps                      # los 3 contenedores en Up
curl http://localhost:3000/health      # {"status":"ok",...}
curl http://localhost:5173             # HTML del frontend
```

En una VM hay que abrir los puertos `5173` y `3000` en el firewall. Para GCP:

```bash
gcloud compute firewall-rules create securegate-dev \
  --allow tcp:5173,tcp:3000 --source-ranges 0.0.0.0/0
```

**No hace falta configurar `VITE_API_URL` por servidor.** El frontend detecta
en runtime el hostname desde el que se abrio la pagina
(`window.location.hostname`, en `frontend/src/services/api.ts`) y arma la URL
del backend contra ese mismo host. Abrir `http://34.16.22.9:5173` hace que las
peticiones vayan a `http://34.16.22.9:3000` automaticamente.

> Si en lugar de la IP usas un nombre DNS (`http://mi-vm.ejemplo.com:5173`),
> Vite bloquea la peticion por su control de `Host`. Agrega ese nombre a
> `server.allowedHosts` en `frontend/vite.config.ts`.

---

## Despliegue con dominio y SSL (produccion)

`docker-compose.yml` — el que usa el equipo todos los dias — **no incluye
nginx ni certificados**: expone backend y frontend directamente por sus
puertos, de modo que funciona en local y en cualquier VM sin dominio.

Cuando el proyecto tenga un dominio real con Let's Encrypt configurado, se usa
el compose separado `docker-compose.prod.yml`, que si levanta nginx como
reverse proxy con HTTPS. Requisitos previos:

1. Apuntar el registro A del dominio a la IP publica del servidor.
2. Emitir el certificado en el host:
   `sudo certbot certonly --standalone -d midominio.com`
3. Sustituir `DOMINIO` por el dominio real en `nginx/nginx.conf`.
4. Exportar las variables obligatorias (o ponerlas en un `.env`):

```bash
export POSTGRES_PASSWORD=...          # password de la BD
export JWT_SECRET=$(openssl rand -hex 48)   # >= 32 caracteres, no público
export PUBLIC_URL=https://midominio.com
export ALLOWED_ORIGINS=https://midominio.com

docker compose -f docker-compose.prod.yml up --build -d
```

5. **Crear el primer owner** (en producción no hay cuentas demo):

```bash
OWNER_EMAIL=ana@empresa.com OWNER_PASSWORD='una-clave-larga-1' OWNER_NOMBRE='Ana Pérez' \
  docker compose -f docker-compose.prod.yml run --rm \
  -e OWNER_EMAIL -e OWNER_PASSWORD -e OWNER_NOMBRE backend node dist/scripts/crear-owner.js
```

Lo que cambia respecto a desarrollo: el backend corre compilado y como usuario
sin privilegios, el frontend son archivos estáticos (no el servidor de Vite),
`TRUST_PROXY=1` hace que el rate limit y la auditoría vean la IP real del
cliente, y el **pago con tarjeta simulado responde 501** (sólo se habilita con
`PAGOS_TARJETA_SIMULADA=true`, que únicamente define el compose de desarrollo:
esa pasarela es un mock que liquida deudas). Para desplegar con este compose:
`COMPOSE_FILE=docker-compose.prod.yml ./scripts/deploy.sh`.

**Backups:** en producción la base vive en Cloud SQL; `scripts/backup-postgres.sh`
sólo aplica al Postgres en contenedor (perfil `local-db`). Activa los backups
automáticos y la recuperación a un punto en el tiempo de la instancia
(`gcloud sql instances patch securegate-pg --backup-start-time=03:00
--enable-point-in-time-recovery`) y **prueba una restauración** antes de
necesitarla.

> No levantes `docker-compose.prod.yml` en local ni en una VM sin dominio: si
> los certificados no existen en `/etc/letsencrypt`, nginx entra en
> crash-loop. Para esos entornos usa siempre `docker-compose.yml`.

---

## Comandos Docker

```bash
# Levantar todos los servicios en segundo plano (local o VM)
docker compose up --build -d

# Levantar en primer plano, viendo los logs
docker compose up --build

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
2. Agente activa el escaner de DPI — Google Cloud Vision extrae nombre y numero de DPI automaticamente
3. Agente activa el reconocimiento de placa — Google Cloud Vision lee la placa del vehiculo automaticamente
4. Agente selecciona o confirma el numero de casa destino
5. Sistema verifica estado de pago del residente
6. Si hay mora — genera cargo automatico (sin bloquear la entrada)
7. Agente presiona **AUTORIZAR ENTRADA** o **DENEGAR ENTRADA**
8. Sistema registra hora de entrada; la tabla de ultimos ingresos se actualiza en tiempo real

### Modulos del sistema

| Modulo | Usuarios | Funcionalidad |
|--------|---------|---------------|
| Terminal de Garita | Agente de seguridad | Escaner de DPI por camara, reconocimiento automatico de placa, campos de visitante autocompletados, botones AUTORIZAR / DENEGAR, tabla de ultimos ingresos |
| Dashboard Admin | Administrador | Estadisticas de accesos, residentes en mora, pagos pendientes, tabla de accesos recientes |
| Gestion de Residentes | Administrador | Alta, edicion y baja de residentes, control de estado de pago |
| Gestion de Pagos | Administrador | Registro de pagos en efectivo, aprobacion de transferencias, historial |
| Preautorizaciones | Administrador | Registro de visitas anticipadas por rango de fechas |

### Metodos de pago soportados

- Transferencia bancaria — residente sube comprobante, admin aprueba
- Efectivo — registrado manualmente por el administrador

---

## Requisitos Funcionales — Identificacion Automatica (OCR)

### RF-OCR-01: Escaneo automatico de DPI

| Atributo | Detalle |
|----------|---------|
| Actor | Agente de garita |
| Disparador | Agente presiona "Escanear DPI" en la Terminal de Garita |
| Proceso | La camara captura el frente del DPI guatemalteco y lo envia a Google Cloud Vision API |
| Extraccion | El sistema extrae y autocompleta: **Nombre completo** y **Numero de DPI** |
| Salida esperada | Campos "Nombre del Visitante" y "Numero de DPI" se rellenan automaticamente en el formulario |
| Fallback | Si Vision API no puede leer el documento, los campos quedan editables para ingreso manual |

### RF-OCR-02: Reconocimiento automatico de placa vehicular

| Atributo | Detalle |
|----------|---------|
| Actor | Agente de garita |
| Disparador | Agente activa el modulo de "Reconocimiento de Placa" en la Terminal de Garita |
| Proceso | La camara apunta a la placa del vehiculo y envia la imagen a Google Cloud Vision API |
| Extraccion | El sistema extrae el numero de placa guatemalteca (formato P-XXXXXX o letras+numeros) |
| Salida esperada | Campo "Numero de Placa" se rellena automaticamente |
| Fallback | Si la lectura falla (mala iluminacion, angulo), el agente puede ingresar la placa manualmente |

### RF-OCR-03: Pantalla de garita orientada al agente

La Terminal de Garita presenta:
- **Panel izquierdo:** vista de camara en tiempo real para escaneo de DPI + boton "Escanear DPI", y seccion separada para reconocimiento de placa
- **Panel derecho:** formulario con datos del visitante autocompletados (Nombre, DPI, Placa, Casa/Unidad)
- **Acciones:** boton **AUTORIZAR ENTRADA** (verde) y boton **DENEGAR ENTRADA** (rojo)
- **Historial:** tabla "Ultimos Ingresos" con columnas Hora, Visitante, Placa, Unidad, Estado

---

## API Externa

### Google Cloud Vision API

| Caso de uso | Endpoint Vision | Descripcion |
|-------------|----------------|-------------|
| Escaneo de DPI | `DOCUMENT_TEXT_DETECTION` | Extrae texto estructurado del documento de identidad guatemalteco |
| Reconocimiento de placa | `TEXT_DETECTION` | Lee la cadena alfanumerica de la placa vehicular |

- **Precio:** Primeras 1,000 llamadas/mes gratuitas, luego $1.50/1,000
- **Latencia tipica:** 300–800 ms por imagen
- **Requisito:** Variable de entorno `GOOGLE_CLOUD_API_KEY` configurada en `.env`

---

## Migraciones automaticas de esquema

El script `database/init.sql` es **idempotente** (usa `CREATE TABLE IF NOT EXISTS`,
`ALTER TABLE ... IF EXISTS` y bloques `DO $$ ... EXCEPTION WHEN duplicate_column`).

`docker-entrypoint-initdb.d` solo ejecuta ese script en la **primera**
inicializacion del volumen de Postgres, por lo que las tablas/columnas agregadas
despues de crear el volumen **no** se aplicaban solas tras un deploy.

Para evitarlo, el backend corre una **guarda de migraciones** al arrancar
(`backend/src/db/migrate.ts`, invocada desde `index.ts` antes de `app.listen`):
lee `init.sql` y lo aplica contra la base ya existente. Como es idempotente, es
seguro ejecutarlo en cada arranque; si falla, se registra el error y el servidor
arranca igual (evita crash-loops).

- El archivo se monta en el contenedor via `docker-compose.yml`
  (`./database/init.sql:/app/database/init.sql:ro`).
- Se puede forzar otra ruta con la variable `INIT_SQL_PATH`.
- Deploy tipico tras cambiar el esquema:
  ```bash
  git pull
  docker compose build --no-cache backend   # si cambiaron dependencias
  docker compose up -d backend              # al arrancar aplica init.sql
  docker compose logs --tail=30 backend     # busca "[migrate] Esquema al dia."
  ```

Tambien se puede aplicar manualmente en cualquier momento:
```bash
docker exec -i securegate-db psql -U sguser -d securegate < database/init.sql
```

---

## Backups y Recuperacion de la Base de Datos

El proyecto corre en una VM GCP `e2-micro` (Ubuntu 22.04, IP `34.9.219.139`) con
PostgreSQL 15 dentro de Docker Compose. El script `scripts/backup-postgres.sh`
automatiza los respaldos diarios hacia un bucket de Google Cloud Storage (GCS).

### Que hace el script

1. `pg_dump` del contenedor `securegate-db`, comprimido con timestamp:
   `backup_YYYYMMDD_HHMMSS.sql.gz`.
2. Sube el archivo al bucket de GCS con `gsutil cp`.
3. Borra los backups locales con mas de 1 dia de antiguedad.
4. Mantiene una retencion de los **30 backups** mas recientes en el bucket
   (elimina los mas antiguos con `gsutil rm`).

### Variables de entorno

| Variable | Requerida | Default | Descripcion |
|----------|-----------|---------|-------------|
| `GCS_BUCKET` | **Si** | — | Nombre del bucket GCS, sin `gs://` (ej. `securegate-backups`) |
| `DB_CONTAINER` | No | `securegate-db` | Nombre del contenedor de Postgres |
| `DB_USER` | No | `sguser` | Usuario de Postgres |
| `DB_NAME` | No | `securegate` | Base de datos a respaldar |
| `BACKUP_DIR` | No | `/var/backups/securegate` | Carpeta local temporal |
| `RETENTION` | No | `30` | Cantidad de backups a conservar en GCS |
| `LOCAL_MAX_AGE` | No | `1` | Dias de retencion de los backups locales |
| `GOOGLE_APPLICATION_CREDENTIALS` | No* | — | Ruta al JSON de la service account |

\* En la VM de GCP no es necesario: `gsutil` usa la **service account adjunta a la
instancia** (via metadata). Solo hace falta que esa SA tenga el rol
`roles/storage.objectAdmin` sobre el bucket. Fuera de GCP, exporta
`GOOGLE_APPLICATION_CREDENTIALS` apuntando al JSON de una SA con ese permiso.

### Preparacion (una sola vez)

```bash
# Crear el bucket (region cercana, con versionado opcional)
gsutil mb -l us-central1 gs://securegate-backups
gsutil versioning set on gs://securegate-backups   # opcional

# Otorgar permisos a la service account de la VM sobre el bucket
gsutil iam ch \
  serviceAccount:SA_EMAIL@PROJECT.iam.gserviceaccount.com:roles/storage.objectAdmin \
  gs://securegate-backups

# Probar el script manualmente
export GCS_BUCKET=securegate-backups
sudo -E ./scripts/backup-postgres.sh
```

### Cronjob diario (2:00 AM)

Edita el crontab del usuario que puede ejecutar `docker` y `gsutil`:

```bash
crontab -e
```

Agrega la siguiente linea (corre todos los dias a las 02:00, con log):

```cron
0 2 * * *  GCS_BUCKET=securegate-backups /home/ubuntu/SecureGate/scripts/backup-postgres.sh >> /var/log/securegate-backup.log 2>&1
```

> Ajusta la ruta absoluta del script segun donde este clonado el repo.
> Verifica la zona horaria de la VM con `timedatectl`; el cron usa la hora local
> del sistema. Para forzar Guatemala: `sudo timedatectl set-timezone America/Guatemala`.

Revisa la ejecucion mas reciente con:

```bash
tail -n 50 /var/log/securegate-backup.log
gsutil ls -l gs://securegate-backups/
```

### Restaurar desde un backup

```bash
# 1. Listar los backups disponibles y elegir uno
gsutil ls gs://securegate-backups/

# 2. Descargar el backup deseado
gsutil cp gs://securegate-backups/backup_20260712_020000.sql.gz .

# 3. Descomprimir
gunzip backup_20260712_020000.sql.gz    # -> backup_20260712_020000.sql

# 4a. Restaurar sobre la base existente (streaming, sin descomprimir a disco):
gunzip -c backup_20260712_020000.sql.gz | \
  docker exec -i securegate-db psql -U sguser -d securegate

# 4b. (Recomendado) Restaurar en una base limpia para evitar conflictos:
docker exec -u postgres securegate-db dropdb --if-exists securegate
docker exec -u postgres securegate-db createdb -O sguser securegate
gunzip -c backup_20260712_020000.sql.gz | \
  docker exec -i securegate-db psql -U sguser -d securegate
```

> El dump se genera con `pg_dump` en formato SQL plano, por eso se restaura con
> `psql` (no con `pg_restore`). Detén el backend antes de una restauracion
> destructiva: `docker compose stop backend`, y reinícialo al terminar.

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
