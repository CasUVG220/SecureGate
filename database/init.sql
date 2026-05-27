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
  tipo         VARCHAR(20) NOT NULL DEFAULT 'temporal'
                 CHECK (tipo IN ('temporal', 'permanente')),
  razon        TEXT NOT NULL,
  fecha_inicio DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_fin    DATE,
  activo       BOOLEAN NOT NULL DEFAULT TRUE,
  creado_por   UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(visitante_id, sucursal_id)
);

CREATE INDEX IF NOT EXISTS idx_bl_visitante ON visitante_blacklist(visitante_id);
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

SELECT 'SecureGate DB inicializada correctamente' AS mensaje;
