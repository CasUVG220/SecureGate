-- SecureGate — Script de inicialización
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Nuevas tablas multi-tenant ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS empresas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     VARCHAR(150) NOT NULL,
  nit        VARCHAR(20),
  logo_url   TEXT,
  activo     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sucursales (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  nombre     VARCHAR(150) NOT NULL,
  direccion  VARCHAR(300),
  tipo       VARCHAR(50),
  activo     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── Tablas existentes (modificadas para multi-tenant) ─────────────────────

CREATE TABLE IF NOT EXISTS usuarios (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        VARCHAR(100) NOT NULL,
  email         VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  rol           VARCHAR(20) NOT NULL CHECK (rol IN ('owner', 'admin_empresa', 'admin_sucursal', 'agente', 'residente')),
  sucursal_id   UUID REFERENCES sucursales(id) ON DELETE RESTRICT,
  empresa_id    UUID REFERENCES empresas(id) ON DELETE RESTRICT,
  idioma        VARCHAR(10) NOT NULL DEFAULT 'es',
  tema          VARCHAR(20) NOT NULL DEFAULT 'dark',
  activo        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS residentes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id      UUID NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE RESTRICT,
  sucursal_id     UUID NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  numero_casa     VARCHAR(20) NOT NULL,
  estado_pago     VARCHAR(20) NOT NULL DEFAULT 'al_dia' CHECK (estado_pago IN ('al_dia', 'mora', 'pendiente')),
  telefono        VARCHAR(20),
  saldo_pendiente DECIMAL(10,2) NOT NULL DEFAULT 0.00 CHECK (saldo_pendiente >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_residentes_casa_sucursal ON residentes(sucursal_id, numero_casa);

CREATE TABLE IF NOT EXISTS visitantes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         VARCHAR(150) NOT NULL,
  numero_dpi     VARCHAR(20) NOT NULL UNIQUE,
  foto           VARCHAR(500),
  primera_visita TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vehiculos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitante_id UUID NOT NULL REFERENCES visitantes(id) ON DELETE CASCADE,
  placa        VARCHAR(20) NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS registros_acceso (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id       UUID NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  visitante_id      UUID NOT NULL REFERENCES visitantes(id) ON DELETE RESTRICT,
  residente_id      UUID NOT NULL REFERENCES residentes(id) ON DELETE RESTRICT,
  vehiculo_id       UUID REFERENCES vehiculos(id) ON DELETE SET NULL,
  agente_id         UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  tipo              VARCHAR(10) NOT NULL CHECK (tipo IN ('entrada', 'salida')),
  timestamp_entrada TIMESTAMP NOT NULL DEFAULT NOW(),
  timestamp_salida  TIMESTAMP,
  autorizado        BOOLEAN NOT NULL DEFAULT TRUE,
  notas             TEXT
);

CREATE TABLE IF NOT EXISTS pagos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id         UUID NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  residente_id        UUID NOT NULL REFERENCES residentes(id) ON DELETE RESTRICT,
  monto               DECIMAL(10,2) NOT NULL CHECK (monto > 0),
  fecha_pago          TIMESTAMP NOT NULL DEFAULT NOW(),
  metodo              VARCHAR(20) NOT NULL CHECK (metodo IN ('efectivo', 'transferencia')),
  estado              VARCHAR(20) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobado', 'rechazado')),
  comprobante         TEXT,
  referencia          VARCHAR(100),
  banco               VARCHAR(100),
  fecha_transferencia DATE,
  comentario_rechazo  TEXT,
  registrado_por      UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS cargos_automaticos (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registro_acceso_id UUID NOT NULL REFERENCES registros_acceso(id) ON DELETE RESTRICT,
  residente_id       UUID NOT NULL REFERENCES residentes(id) ON DELETE RESTRICT,
  monto              DECIMAL(10,2) NOT NULL CHECK (monto > 0),
  descripcion        VARCHAR(255),
  aplicado           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS configuracion_cargos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id UUID NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  nombre      VARCHAR(100) NOT NULL,
  monto       DECIMAL(10,2) NOT NULL CHECK (monto > 0),
  frecuencia  VARCHAR(20) NOT NULL DEFAULT 'mensual'
                CHECK (frecuencia IN ('unica_vez', 'quincenal', 'mensual')),
  restringir_visitas_mora BOOLEAN NOT NULL DEFAULT FALSE,
  costo_extra_visita_mora NUMERIC(10,2) NOT NULL DEFAULT 0,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS preautorizaciones (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id      UUID NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  residente_id     UUID NOT NULL REFERENCES residentes(id) ON DELETE CASCADE,
  nombre_visitante VARCHAR(150) NOT NULL,
  numero_dpi       VARCHAR(20),
  placa            VARCHAR(20),
  fecha_inicio     DATE NOT NULL,
  fecha_fin        DATE,
  activo           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invitaciones_qr (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id      UUID NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  residente_id     UUID NOT NULL REFERENCES residentes(id) ON DELETE CASCADE,
  tipo             VARCHAR(20) NOT NULL CHECK (tipo IN ('grupal', 'individual')),
  etiqueta         VARCHAR(150),
  nombre_visitante VARCHAR(150),
  numero_dpi       VARCHAR(20),
  fecha_inicio     DATE NOT NULL,
  fecha_fin        DATE,
  usos_maximos     INT,
  usos_actuales    INT NOT NULL DEFAULT 0,
  activo           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invitaciones_qr_residente ON invitaciones_qr(residente_id);
CREATE INDEX IF NOT EXISTS idx_invitaciones_qr_sucursal  ON invitaciones_qr(sucursal_id);

ALTER TABLE registros_acceso
  ADD COLUMN IF NOT EXISTS invitacion_qr_id UUID REFERENCES invitaciones_qr(id) ON DELETE SET NULL;

ALTER TABLE invitaciones_qr ADD COLUMN IF NOT EXISTS placa VARCHAR(20);
ALTER TABLE invitaciones_qr ADD COLUMN IF NOT EXISTS intentos_fallidos_dpi INT NOT NULL DEFAULT 0;
ALTER TABLE invitaciones_qr ADD COLUMN IF NOT EXISTS bloqueado_hasta TIMESTAMP;

CREATE TABLE IF NOT EXISTS configuracion_qr (
  sucursal_id                 UUID PRIMARY KEY REFERENCES sucursales(id) ON DELETE CASCADE,
  dpi_obligatorio_individual  BOOLEAN NOT NULL DEFAULT TRUE,
  requiere_placa              BOOLEAN NOT NULL DEFAULT FALSE,
  autorizacion_automatica     BOOLEAN NOT NULL DEFAULT FALSE,
  max_intentos_fallidos       INT NOT NULL DEFAULT 5 CHECK (max_intentos_fallidos > 0),
  bloqueo_minutos             INT NOT NULL DEFAULT 15 CHECK (bloqueo_minutos > 0),
  updated_at                  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── Audit logs ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id       UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  accion           VARCHAR(100) NOT NULL,
  tabla_afectada   VARCHAR(50),
  registro_id      UUID,
  datos_anteriores JSONB,
  datos_nuevos     JSONB,
  ip_address       VARCHAR(45),
  user_agent       VARCHAR(255),
  sucursal_id      UUID REFERENCES sucursales(id) ON DELETE SET NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_usuario ON audit_logs(usuario_id);
CREATE INDEX IF NOT EXISTS idx_audit_accion  ON audit_logs(accion);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- ── Refresh tokens ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) NOT NULL UNIQUE,
  expires_at  TIMESTAMP NOT NULL,
  revoked     BOOLEAN NOT NULL DEFAULT FALSE,
  ip_address  VARCHAR(45),
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rt_usuario ON refresh_tokens(usuario_id);
CREATE INDEX IF NOT EXISTS idx_rt_hash    ON refresh_tokens(token_hash);

-- ── Blacklist ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS visitante_blacklist (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitante_id UUID NOT NULL REFERENCES visitantes(id) ON DELETE CASCADE,
  sucursal_id  UUID NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  razon        TEXT NOT NULL,
  fecha_inicio TIMESTAMP NOT NULL DEFAULT NOW(),
  fecha_fin    TIMESTAMP,
  activo       BOOLEAN NOT NULL DEFAULT TRUE,
  creado_por   UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bl_visitante_activo ON visitante_blacklist(visitante_id, activo);
CREATE INDEX IF NOT EXISTS idx_bl_sucursal  ON visitante_blacklist(sucursal_id);

CREATE TABLE IF NOT EXISTS residente_visitante_blacklist (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  residente_id UUID NOT NULL REFERENCES residentes(id) ON DELETE CASCADE,
  visitante_id UUID NOT NULL REFERENCES visitantes(id) ON DELETE CASCADE,
  razon        TEXT NOT NULL,
  activo       BOOLEAN NOT NULL DEFAULT TRUE,
  creado_por   UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(residente_id, visitante_id)
);

CREATE INDEX IF NOT EXISTS idx_rvbl_visitante ON residente_visitante_blacklist(visitante_id);
CREATE INDEX IF NOT EXISTS idx_rvbl_residente ON residente_visitante_blacklist(residente_id);

-- ── Anuncios ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS anuncios (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id   UUID NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  titulo        VARCHAR(200) NOT NULL,
  contenido     TEXT NOT NULL,
  prioridad     VARCHAR(20) NOT NULL DEFAULT 'normal'
                  CHECK (prioridad IN ('normal', 'importante', 'urgente')),
  vigente_desde TIMESTAMP NOT NULL DEFAULT NOW(),
  vigente_hasta TIMESTAMP,
  creado_por    UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anuncios_sucursal ON anuncios(sucursal_id);

CREATE TABLE IF NOT EXISTS anuncio_lecturas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anuncio_id   UUID NOT NULL REFERENCES anuncios(id) ON DELETE CASCADE,
  residente_id UUID NOT NULL REFERENCES residentes(id) ON DELETE CASCADE,
  leido_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(anuncio_id, residente_id)
);

CREATE INDEX IF NOT EXISTS idx_anuncio_lecturas_residente ON anuncio_lecturas(residente_id);

-- ── Tickets (chat interno) ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tickets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id  UUID NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  residente_id UUID NOT NULL REFERENCES residentes(id) ON DELETE CASCADE,
  tipo         VARCHAR(20) NOT NULL DEFAULT 'otro'
                 CHECK (tipo IN ('mantenimiento', 'queja', 'seguridad', 'otro')),
  titulo       VARCHAR(200) NOT NULL,
  estado       VARCHAR(20) NOT NULL DEFAULT 'abierto'
                 CHECK (estado IN ('abierto', 'en_proceso', 'cerrado')),
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_sucursal  ON tickets(sucursal_id);
CREATE INDEX IF NOT EXISTS idx_tickets_residente ON tickets(residente_id);

CREATE TABLE IF NOT EXISTS ticket_mensajes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  autor_id        UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  mensaje         TEXT NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  leido_admin     BOOLEAN NOT NULL DEFAULT FALSE,
  leido_residente BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_ticket_mensajes_ticket ON ticket_mensajes(ticket_id);


-- ── Cargos programados ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cargos_programados (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id     UUID NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  nombre          VARCHAR(150) NOT NULL,
  descripcion     TEXT,
  monto           DECIMAL(10,2) NOT NULL CHECK (monto > 0),
  frecuencia      VARCHAR(20) NOT NULL DEFAULT 'mensual'
                    CHECK (frecuencia IN ('unica_vez', 'quincenal', 'mensual')),
  aplica_a        VARCHAR(20) NOT NULL DEFAULT 'todos'
                    CHECK (aplica_a IN ('todos', 'individual')),
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  ultimo_aplicado TIMESTAMP,
  creado_por      UUID NOT NULL REFERENCES usuarios(id),
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cargos_programados_historial (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cargo_programado_id UUID NOT NULL REFERENCES cargos_programados(id),
  residente_id        UUID NOT NULL REFERENCES residentes(id),
  monto               DECIMAL(10,2) NOT NULL,
  aplicado_por        UUID NOT NULL REFERENCES usuarios(id),
  applied_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cp_sucursal   ON cargos_programados(sucursal_id);
CREATE INDEX IF NOT EXISTS idx_cph_cargo     ON cargos_programados_historial(cargo_programado_id);
CREATE INDEX IF NOT EXISTS idx_cph_residente ON cargos_programados_historial(residente_id);

-- ── Migrations (idempotent) ────────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE configuracion_cargos
    ADD COLUMN frecuencia VARCHAR(20) NOT NULL DEFAULT 'mensual'
      CHECK (frecuencia IN ('unica_vez', 'quincenal', 'mensual'));
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- T-S5-01: ciclo de mora — fecha del último pago del residente
DO $$ BEGIN
  ALTER TABLE residentes ADD COLUMN fecha_ultimo_pago TIMESTAMP;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- T-S5-02: restricción de visitas en mora + cargo extra por visita
DO $$ BEGIN
  ALTER TABLE configuracion_cargos
    ADD COLUMN restringir_visitas_mora BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE configuracion_cargos
    ADD COLUMN costo_extra_visita_mora NUMERIC(10,2) NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- T-S5-04: migrate visitante_blacklist to duracion-based model (drop tipo,
-- widen date columns to TIMESTAMP, drop the single-ban unique constraint).
ALTER TABLE visitante_blacklist DROP CONSTRAINT IF EXISTS visitante_blacklist_visitante_id_sucursal_id_key;
ALTER TABLE visitante_blacklist DROP COLUMN IF EXISTS tipo;
ALTER TABLE visitante_blacklist ALTER COLUMN fecha_inicio TYPE TIMESTAMP USING fecha_inicio::timestamp;
ALTER TABLE visitante_blacklist ALTER COLUMN fecha_inicio SET DEFAULT NOW();
ALTER TABLE visitante_blacklist ALTER COLUMN fecha_fin    TYPE TIMESTAMP USING fecha_fin::timestamp;
CREATE INDEX IF NOT EXISTS idx_bl_visitante_activo ON visitante_blacklist(visitante_id, activo);

-- ── S6: Reservas de áreas comunes ─────────────────────────────────────────

-- btree_gist habilita el EXCLUDE de solapes (uuid WITH = + tsrange WITH &&).
-- Va dentro de DO/EXCEPTION porque migrate.ts ejecuta TODO init.sql como una
-- sola query (= una sola transacción implícita): si CREATE EXTENSION fallara
-- por falta de privilegios, se perderían todas las migraciones del arranque.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS btree_gist;
EXCEPTION WHEN insufficient_privilege OR undefined_file OR undefined_object THEN
  RAISE NOTICE '[init] btree_gist no disponible; se omite el EXCLUDE de solapes.';
END $$;

CREATE TABLE IF NOT EXISTS areas_comunes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id         UUID NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  nombre              VARCHAR(150) NOT NULL,
  descripcion         TEXT,
  imagen_url          TEXT,           -- URL externa o data URI base64; NULL = sin imagen
  tarifa_tipo         VARCHAR(20)   NOT NULL DEFAULT 'gratis'
                        CHECK (tarifa_tipo IN ('gratis', 'por_hora', 'unica')),
  tarifa_monto        NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (tarifa_monto >= 0),
  requiere_aprobacion BOOLEAN,        -- NULL = hereda configuracion_reservas
  activa              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_areas_sucursal ON areas_comunes(sucursal_id);

CREATE TABLE IF NOT EXISTS configuracion_reservas (
  sucursal_id                        UUID PRIMARY KEY REFERENCES sucursales(id) ON DELETE CASCADE,
  permite_cancelacion                BOOLEAN NOT NULL DEFAULT TRUE,
  horas_limite_cancelacion_completa  INT NOT NULL DEFAULT 48 CHECK (horas_limite_cancelacion_completa >= 0),
  horas_limite_cancelacion_parcial   INT NOT NULL DEFAULT 24 CHECK (horas_limite_cancelacion_parcial  >= 0),
  porcentaje_reembolso_parcial       NUMERIC(5,2) NOT NULL DEFAULT 50
                                       CHECK (porcentaje_reembolso_parcial BETWEEN 0 AND 100),
  max_reservas_activas_por_residente INT
                                       CHECK (max_reservas_activas_por_residente IS NULL
                                              OR max_reservas_activas_por_residente > 0),
  requiere_aprobacion_admin          BOOLEAN NOT NULL DEFAULT FALSE,
  buffer_minutos_entre_reservas      INT NOT NULL DEFAULT 0
                                       CHECK (buffer_minutos_entre_reservas BETWEEN 0 AND 1440),
  buffer_motivo                      TEXT,
  updated_at                         TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT configuracion_reservas_horas_coherentes
    CHECK (horas_limite_cancelacion_completa >= horas_limite_cancelacion_parcial)
);

CREATE TABLE IF NOT EXISTS reservas_areas (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id              UUID NOT NULL REFERENCES areas_comunes(id) ON DELETE RESTRICT,
  residente_id         UUID NOT NULL REFERENCES residentes(id)    ON DELETE RESTRICT,
  fecha                DATE NOT NULL,
  hora_inicio          TIME NOT NULL,
  hora_fin             TIME NOT NULL,
  estado               VARCHAR(25) NOT NULL DEFAULT 'confirmada'
                         CHECK (estado IN ('pendiente_aprobacion','confirmada','cancelada','rechazada','completada')),
  cargo_id             UUID REFERENCES pagos(id) ON DELETE SET NULL,
  monto_cargo          NUMERIC(10,2) NOT NULL DEFAULT 0,  -- monto original; sobrevive a la anulación del cargo
  motivo_cancelacion   TEXT,
  reembolso_aplicado   NUMERIC(5,2),                      -- porcentaje aplicado al cancelar
  recordatorio_enviado BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT reservas_areas_horas_validas CHECK (hora_fin > hora_inicio)
);

CREATE INDEX IF NOT EXISTS idx_reservas_area_fecha ON reservas_areas(area_id, fecha);
CREATE INDEX IF NOT EXISTS idx_reservas_residente  ON reservas_areas(residente_id);
CREATE INDEX IF NOT EXISTS idx_reservas_recordatorio
  ON reservas_areas(fecha) WHERE estado = 'confirmada' AND recordatorio_enviado = FALSE;

-- Red de seguridad contra doble reserva a nivel de BD. No puede expresar el
-- buffer (es configuración por sucursal en runtime), así que garantiza la
-- regla literal de solape; el buffer se valida en la app bajo el lock del área.
DO $$ BEGIN
  ALTER TABLE reservas_areas
    ADD CONSTRAINT reservas_areas_sin_solape
    EXCLUDE USING gist (
      area_id WITH =,
      tsrange((fecha + hora_inicio), (fecha + hora_fin), '[)') WITH &&
    ) WHERE (estado IN ('pendiente_aprobacion', 'confirmada'));
EXCEPTION
  WHEN duplicate_object OR duplicate_table THEN NULL;
  WHEN undefined_object OR undefined_function OR feature_not_supported THEN
    RAISE NOTICE '[init] EXCLUDE de solapes omitido (btree_gist ausente).';
  WHEN exclusion_violation THEN
    RAISE NOTICE '[init] Hay reservas solapadas preexistentes; EXCLUDE no aplicado.';
END $$;

-- Descripción del cargo, p. ej. "Reserva: Salón Social - 2026-08-20".
DO $$ BEGIN
  ALTER TABLE pagos ADD COLUMN concepto VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- metodo += 'reserva' (cargo generado por una reserva, no un pago recibido).
-- La guarda pg_constraint evita revalidar toda la tabla pagos bajo
-- ACCESS EXCLUSIVE en cada arranque del backend.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'pagos'::regclass
       AND conname  = 'pagos_metodo_check'
       AND pg_get_constraintdef(oid) LIKE '%reserva%'
  ) THEN
    ALTER TABLE pagos DROP CONSTRAINT IF EXISTS pagos_metodo_check;
    ALTER TABLE pagos ADD  CONSTRAINT pagos_metodo_check
      CHECK (metodo IN ('efectivo', 'transferencia', 'reserva'));
  END IF;
END $$;

-- estado += 'anulado' (cargo dejado sin efecto por cancelación o rechazo).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'pagos'::regclass
       AND conname  = 'pagos_estado_check'
       AND pg_get_constraintdef(oid) LIKE '%anulado%'
  ) THEN
    ALTER TABLE pagos DROP CONSTRAINT IF EXISTS pagos_estado_check;
    ALTER TABLE pagos ADD  CONSTRAINT pagos_estado_check
      CHECK (estado IN ('pendiente', 'aprobado', 'rechazado', 'anulado'));
  END IF;
END $$;

-- Pasarela de tarjeta simulada (sprint 7). El intento se guarda en `pagos`
-- junto a los demás métodos; `es_simulado` distingue lo que salió de la
-- pasarela de prueba de un cobro real, para que al integrar Visanet se pueda
-- separar (o purgar) el histórico de demostración sin tocar el resto.
DO $$ BEGIN
  ALTER TABLE pagos ADD COLUMN es_simulado BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Últimos 4 dígitos de la tarjeta: es lo único que se guarda del instrumento.
DO $$ BEGIN
  ALTER TABLE pagos ADD COLUMN tarjeta_ultimos4 VARCHAR(4);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- metodo += 'tarjeta'.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'pagos'::regclass
       AND conname  = 'pagos_metodo_check'
       AND pg_get_constraintdef(oid) LIKE '%tarjeta%'
  ) THEN
    ALTER TABLE pagos DROP CONSTRAINT IF EXISTS pagos_metodo_check;
    ALTER TABLE pagos ADD  CONSTRAINT pagos_metodo_check
      CHECK (metodo IN ('efectivo', 'transferencia', 'reserva', 'tarjeta'));
  END IF;
END $$;

-- Notificaciones personales: NULL = anuncio general (comportamiento actual).
DO $$ BEGIN
  ALTER TABLE anuncios ADD COLUMN residente_id UUID REFERENCES residentes(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- El cron de recordatorios inserta sin usuario actuante.
ALTER TABLE anuncios ALTER COLUMN creado_por DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_anuncios_residente
  ON anuncios(residente_id) WHERE residente_id IS NOT NULL;

-- ── Sprint 8: app de escritorio (garita) ───────────────────────────────────

-- Licencia por dispositivo. El código nace sin fingerprint (emitido, aún no
-- activado); la activación lo vincula a una máquina y ya no puede reusarse en
-- otra. `estado` sólo distingue activa/revocada: un código sin activar es una
-- licencia activa que todavía no tiene dispositivo.
CREATE TABLE IF NOT EXISTS licencias_dispositivo (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id        UUID NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  codigo_activacion  VARCHAR(40) NOT NULL UNIQUE,
  fingerprint        VARCHAR(128),
  etiqueta           VARCHAR(100),
  estado             VARCHAR(20) NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'revocada')),
  activado_en        TIMESTAMP,
  ultimo_heartbeat   TIMESTAMP,
  revocado_en        TIMESTAMP,
  creado_por         UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_licencias_sucursal ON licencias_dispositivo(sucursal_id);

-- Registros que llegan desde la garita offline. `registrado_en` es el reloj
-- del dispositivo (lo manda el cliente, no es fuente de verdad);
-- `recibido_en` lo sella el servidor al recibirlo. Nunca se fusionan.
-- `id_cliente` es el UUID que genera la app antes de encolar: la cola
-- reintenta con backoff y este campo hace idempotente cada reintento.
DO $$ BEGIN
  ALTER TABLE registros_acceso ADD COLUMN registrado_en TIMESTAMP;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE registros_acceso ADD COLUMN recibido_en TIMESTAMP NOT NULL DEFAULT NOW();
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE registros_acceso ADD COLUMN capturado_manualmente BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE registros_acceso ADD COLUMN origen VARCHAR(20) NOT NULL DEFAULT 'web'
    CHECK (origen IN ('web', 'desktop'));
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE registros_acceso ADD COLUMN id_cliente UUID;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE registros_acceso ADD COLUMN licencia_id UUID REFERENCES licencias_dispositivo(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_registros_acceso_id_cliente
  ON registros_acceso(id_cliente) WHERE id_cliente IS NOT NULL;

-- ── Sprint 9: aprovisionamiento en cascada por invitación ─────────────────
--
-- Invitación por email con enlace de un solo uso para los roles
-- administrativos: owner → admin_empresa → admin_sucursal. Cada nivel sólo
-- invita al inmediato inferior dentro de su alcance. No tiene NINGUNA
-- relación con `licencias_dispositivo` (app de garita, ligada a hardware):
-- son dos sistemas de aprovisionamiento separados a propósito.
--
-- `token_hash`: se guarda el SHA-256 del token (como en refresh_tokens), nunca
-- el token en claro; el enlace sólo existe en el email. `empresa_nombre`: una
-- invitación de admin_empresa puede CREAR la empresa al aceptarse (empresa_id
-- NULL + empresa_nombre) o sumar un admin a una existente (empresa_id).
CREATE TABLE IF NOT EXISTS invitaciones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           VARCHAR(150) NOT NULL,
  rol_invitado    VARCHAR(20) NOT NULL CHECK (rol_invitado IN ('admin_empresa', 'admin_sucursal')),
  empresa_id      UUID REFERENCES empresas(id) ON DELETE CASCADE,
  empresa_nombre  VARCHAR(150),
  sucursal_id     UUID REFERENCES sucursales(id) ON DELETE CASCADE,
  token_hash      VARCHAR(64) NOT NULL UNIQUE,
  invitado_por    UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  estado          VARCHAR(20) NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente', 'aceptada', 'expirada', 'revocada')),
  expira_en       TIMESTAMP NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  aceptada_en     TIMESTAMP,
  revocada_en     TIMESTAMP,
  usuario_id      UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  CONSTRAINT invitaciones_alcance_chk CHECK (
    (rol_invitado = 'admin_sucursal' AND empresa_id IS NOT NULL AND sucursal_id IS NOT NULL)
    OR
    (rol_invitado = 'admin_empresa' AND sucursal_id IS NULL AND (empresa_id IS NOT NULL OR empresa_nombre IS NOT NULL))
  )
);

CREATE INDEX IF NOT EXISTS idx_invitaciones_estado_expira ON invitaciones(estado, expira_en);
CREATE INDEX IF NOT EXISTS idx_invitaciones_empresa       ON invitaciones(empresa_id);
CREATE INDEX IF NOT EXISTS idx_invitaciones_invitado_por  ON invitaciones(invitado_por);

-- ── Suspensión de operaciones por empresa (owner) ──────────────────────────
-- `activo = FALSE` es baja (eliminar/desactivar); `suspendida = TRUE` es una
-- pausa reversible (impago, incumplimiento). En ambos casos login, refresh y
-- licencias de garita de esa empresa responden 423 con el motivo.
DO $$ BEGIN
  ALTER TABLE empresas ADD COLUMN suspendida BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE empresas ADD COLUMN suspension_motivo VARCHAR(300);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE empresas ADD COLUMN suspendida_en TIMESTAMP;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ── Auditoría: resultado de cada acción ────────────────────────────────────
-- El middleware auditLog registra ahora al TERMINAR la petición, con el código
-- HTTP de la respuesta (un 403 o un login fallido también dejan rastro). El
-- detalle contextual (p. ej. el correo intentado en un login) va en
-- datos_nuevos, que ya existía.
DO $$ BEGIN
  ALTER TABLE audit_logs ADD COLUMN status_code INTEGER;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_audit_sucursal ON audit_logs(sucursal_id);

-- ── Lista negra por placa (SCRUM-110 / H03) ────────────────────────────────
-- Decisión de modelo (la más simple y segura): NO hay una tabla aparte. Una entrada
-- de `visitante_blacklist` identifica al visitante (visitante_id, que ya viene del
-- DPI) o, sin conocerlo, solo a un vehículo (placa). Así reutiliza vigencia, motivo,
-- aislamiento por sucursal, auditoría y "quitar bloqueo" que ya tiene el DPI.
-- La placa se guarda NORMALIZADA (mayúsculas, sin separadores: P123ABC) y se compara
-- siempre normalizada, de modo que "p-123 abc" y "P123ABC" son el mismo vehículo.
ALTER TABLE visitante_blacklist ALTER COLUMN visitante_id DROP NOT NULL;

DO $$ BEGIN
  ALTER TABLE visitante_blacklist ADD COLUMN placa VARCHAR(20);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE visitante_blacklist ADD CONSTRAINT visitante_blacklist_objetivo_chk
    CHECK (visitante_id IS NOT NULL OR placa IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE visitante_blacklist ADD CONSTRAINT visitante_blacklist_placa_chk
    CHECK (placa IS NULL OR placa ~ '^[A-Z0-9]{3,20}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_bl_placa ON visitante_blacklist(sucursal_id, placa) WHERE placa IS NOT NULL;

-- ── Logo de la empresa como archivo (SCRUM-115 / H12) ──────────────────────
-- Antes el logo era una URL (VARCHAR(500)) que alguien tenía que alojar aparte. Ahora puede subirse como imagen
-- (PNG/JPG/WebP reescalada en el navegador) y se guarda como data URI en la misma columna, como ya se hace con la
-- foto de las áreas comunes. La columna pasa a TEXT (solo la primera vez: en cada arranque no se vuelve a tocar) y un
-- CHECK acota el tamaño por si algo se salta la validación de la API.
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'empresas' AND column_name = 'logo_url') <> 'text' THEN
    ALTER TABLE empresas ALTER COLUMN logo_url TYPE TEXT;
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE empresas ADD CONSTRAINT empresas_logo_url_largo_chk
    CHECK (logo_url IS NULL OR char_length(logo_url) <= 300000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Refresh tokens: familias y detección de reutilización (SCRUM-124 / S-06) ───────────────────────
-- Cada inicio de sesión abre una FAMILIA (`familia_id`); cada renovación rota el token dentro de ella. Un token que ya
-- fue rotado y se presenta otra vez pasada la ventana de gracia significa que alguien más tiene una copia (robo): se
-- revoca la familia entera y queda auditado (REFRESH_REUTILIZADO). `rotado_en` marca los revocados POR ROTACIÓN (a
-- diferencia de los revocados por cierre de sesión, cambio de contraseña o suspensión, que no son señal de robo);
-- `revoked_at` dice cuándo se revocó cualquiera; `reemplazado_por` es el sucesor. Las filas anteriores quedan, cada una,
-- como su propia familia (no hay manera de reconstruir el linaje). Las columnas nuevas usan TIMESTAMPTZ (ver S-17).
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS familia_id UUID;
UPDATE refresh_tokens SET familia_id = gen_random_uuid() WHERE familia_id IS NULL;
ALTER TABLE refresh_tokens ALTER COLUMN familia_id SET DEFAULT gen_random_uuid();
ALTER TABLE refresh_tokens ALTER COLUMN familia_id SET NOT NULL;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS rotado_en TIMESTAMPTZ;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS reemplazado_por UUID;
-- Por qué se cerró un token que NO se rotó: 'reutilizacion' = lo cerró la detección de robo (el dueño legítimo debe enterarse).
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS cierre_motivo VARCHAR(30);
CREATE INDEX IF NOT EXISTS idx_rt_familia ON refresh_tokens(familia_id);

-- ── Verificación en dos pasos para administradores (SCRUM-123) ─────────────
-- Una fila por persona que empezó a configurarla; `activado` sigue en FALSE hasta que confirma su primer código.
-- El secreto TOTP NUNCA va en claro: se guarda cifrado (AES-256-GCM, ver backend/src/utils/twofa.ts). `ultimo_paso` es el
-- último intervalo de 30 s aceptado, para que un código usado no valga dos veces. `intentos_fallidos`, `ultimo_fallo_en` y
-- `bloqueado_hasta` limitan los intentos POR PERSONA (5 fallos en 15 min → 15 min bloqueada), vengan de cuántas IPs vengan.
-- Estas tablas nuevas usan TIMESTAMPTZ (el resto del esquema usa TIMESTAMP, ver S-17 en backend/DEUDA_TECNICA.md).
CREATE TABLE IF NOT EXISTS usuario_2fa (
  usuario_id        UUID PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  secreto_cifrado   TEXT NOT NULL,
  activado          BOOLEAN NOT NULL DEFAULT FALSE,
  activado_en       TIMESTAMPTZ,
  ultimo_paso       BIGINT,
  intentos_fallidos INT NOT NULL DEFAULT 0 CHECK (intentos_fallidos >= 0),
  ultimo_fallo_en   TIMESTAMPTZ,
  bloqueado_hasta   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Códigos de recuperación: 10 por persona, de un solo uso, guardados como HMAC (con la base sola no se leen ni se adivinan).
CREATE TABLE IF NOT EXISTS usuario_2fa_recuperacion (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  codigo_hash CHAR(64) NOT NULL,
  usado_en    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (usuario_id, codigo_hash)
);

CREATE INDEX IF NOT EXISTS idx_2fa_recuperacion_usuario ON usuario_2fa_recuperacion(usuario_id);

SELECT 'SecureGate DB inicializada correctamente' AS mensaje;
