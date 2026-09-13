-- SecureGate — Script de inicialización
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Nuevas tablas multi-tenant ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS empresas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     VARCHAR(150) NOT NULL,
  nit        VARCHAR(20),
  logo_url   VARCHAR(500),
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

-- ── Seeds ─────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_empresa_id    UUID;
  v_sucursal_id   UUID;
  v_residente_uid UUID;
BEGIN
  -- Empresa demo
  SELECT id INTO v_empresa_id FROM empresas WHERE nombre = 'Residencial Demo S.A.' LIMIT 1;
  IF v_empresa_id IS NULL THEN
    INSERT INTO empresas (nombre) VALUES ('Residencial Demo S.A.') RETURNING id INTO v_empresa_id;
  END IF;

  -- Sucursal principal
  SELECT id INTO v_sucursal_id FROM sucursales WHERE empresa_id = v_empresa_id AND nombre = 'Sucursal Principal' LIMIT 1;
  IF v_sucursal_id IS NULL THEN
    INSERT INTO sucursales (empresa_id, nombre) VALUES (v_empresa_id, 'Sucursal Principal') RETURNING id INTO v_sucursal_id;
  END IF;

  -- Owner global (sin sucursal)
  INSERT INTO usuarios (nombre, email, password_hash, rol)
    VALUES ('Admin SecureGate', 'admin@securegate.com', crypt('admin123', gen_salt('bf', 10)), 'owner')
    ON CONFLICT (email) DO NOTHING;

  -- Admin empresa (vinculado a empresa, sin sucursal)
  INSERT INTO usuarios (nombre, email, password_hash, rol, empresa_id)
    VALUES ('Admin Empresa', 'empresa@securegate.com', crypt('empresa123', gen_salt('bf', 10)), 'admin_empresa', v_empresa_id)
    ON CONFLICT (email) DO NOTHING;

  -- Admin sucursal (con sucursal)
  INSERT INTO usuarios (nombre, email, password_hash, rol, sucursal_id)
    VALUES ('Admin Sucursal', 'sucursal@securegate.com', crypt('sucursal123', gen_salt('bf', 10)), 'admin_sucursal', v_sucursal_id)
    ON CONFLICT (email) DO NOTHING;

  -- Agente (con sucursal)
  INSERT INTO usuarios (nombre, email, password_hash, rol, sucursal_id)
    VALUES ('Agente Garita 1', 'agente1@securegate.com', crypt('agente123', gen_salt('bf', 10)), 'agente', v_sucursal_id)
    ON CONFLICT (email) DO NOTHING;

  -- Residente (con sucursal)
  INSERT INTO usuarios (nombre, email, password_hash, rol, sucursal_id)
    VALUES ('Residente Demo', 'r1@securegate.com', crypt('res123', gen_salt('bf', 10)), 'residente', v_sucursal_id)
    ON CONFLICT (email) DO NOTHING;

  -- Perfil residente
  SELECT id INTO v_residente_uid FROM usuarios WHERE email = 'r1@securegate.com';
  INSERT INTO residentes (usuario_id, sucursal_id, numero_casa, estado_pago)
    VALUES (v_residente_uid, v_sucursal_id, 'A-01', 'al_dia')
    ON CONFLICT (usuario_id) DO NOTHING;

END;
$$;

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

SELECT 'SecureGate DB inicializada correctamente' AS mensaje;
