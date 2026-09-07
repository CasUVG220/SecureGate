# Pruebas de carga y estrés (Sprint 7)

Escenarios de [Artillery](https://www.artillery.io/) contra el backend de SecureGate.

## 0. Relajar los rate limiters (solo para la prueba)

El backend tiene dos rate limiters por IP: `/api/auth` permite 10 req/15min,
y el límite general permite 1000 req/15min para el resto de rutas. Como
Artillery pega desde una sola IP, con esos límites de producción las pruebas
de carga solo medirían el 429 del rate limiter, no la capacidad real del
backend/BD.

Antes de correr `carga-login.yml`, `carga-dashboard.yml` o
`estres-accesos.yml`, levanta el backend con los límites relajados:

```bash
RATE_LIMIT_LOGIN_MAX=100000 RATE_LIMIT_GENERAL_MAX=100000 docker compose up -d backend
```

Al terminar las pruebas, restaura los límites de producción:

```bash
docker compose up -d backend
```

(sin las env vars exportadas, `docker-compose.yml` vuelve a los defaults 10 / 1000).

`smoke.yml` no necesita esto — un solo usuario virtual no roza ningún límite.

## 1. Ejecutar

```bash
cd backend
npm run loadtest:smoke
npm run loadtest:login
npm run loadtest:dashboard

source loadtest/setup-env.sh   # obtiene token de agente + residente_id
npm run loadtest:estres
```

Para correr contra la VM de GCP en vez de localhost, agrega `-- --environment vm`
a cualquiera de los scripts anteriores (o pasa la URL a `setup-env.sh`:
`source loadtest/setup-env.sh http://34.2.1.181:3000`).

## 2. Reportes HTML

`artillery report` fue deprecado en Artillery 2.x (ahora empuja a subir los
datos a Artillery Cloud). En su lugar, `generate-reports.js` genera reportes
HTML estáticos y autocontenidos a partir de los JSON, sin depender de ningún
servicio externo:

```bash
npm run loadtest:report
```

Esto crea `loadtest/results/<nombre>.html` para cada `.json` en esa carpeta
(abrir directamente en el navegador).

## 3. Limpieza de datos de prueba

`carga-login.yml` inserta filas en `refresh_tokens`; `estres-accesos.yml`
inserta filas en `registros_acceso` y `visitantes`. Ninguna rompe
constraints, pero para dejar la BD de desarrollo limpia:

```bash
docker exec -i securegate-db psql -U sguser -d securegate < loadtest/cleanup.sql
```

Ver `cleanup.sql` para el detalle de qué borra.

## Resultados

Ver `RESULTADOS.md` para el análisis completo (métricas, punto de quiebre,
correlación con D3 del análisis de deuda técnica, y recomendaciones).
