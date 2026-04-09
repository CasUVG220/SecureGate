-- SecureGate — Script de inicialización
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS usuarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  rol VARCHAR(20) NOT NULL CHECK (rol IN ('agente', 'residente', 'admin')),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS residentes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE RESTRICT,
  numero_casa VARCHAR(20) NOT NULL UNIQUE,
  estado_pago VARCHAR(20) NOT NULL DEFAULT 'al_dia' CHECK (estado_pago IN ('al_dia', 'mora', 'pendiente')),
  telefono VARCHAR(20),
  saldo_pendiente DECIMAL(10,2) NOT NULL DEFAULT 0.00 CHECK (saldo_pendiente >= 0)
);

CREATE TABLE IF NOT EXISTS visitantes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(150) NOT NULL,
  numero_dpi VARCHAR(20) NOT NULL UNIQUE,
  foto VARCHAR(500),
  primera_visita TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vehiculos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitante_id UUID NOT NULL REFERENCES visitantes(id) ON DELETE CASCADE,
  placa VARCHAR(20) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS registros_acceso (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitante_id UUID NOT NULL REFERENCES visitantes(id) ON DELETE RESTRICT,
  residente_id UUID NOT NULL REFERENCES residentes(id) ON DELETE RESTRICT,
  vehiculo_id UUID REFERENCES vehiculos(id) ON DELETE SET NULL,
  agente_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('entrada', 'salida')),
  timestamp_entrada TIMESTAMP NOT NULL DEFAULT NOW(),
  timestamp_salida TIMESTAMP,
  autorizado BOOLEAN NOT NULL DEFAULT TRUE,
  notas TEXT
);

CREATE TABLE IF NOT EXISTS pagos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  residente_id UUID NOT NULL REFERENCES residentes(id) ON DELETE RESTRICT,
  monto DECIMAL(10,2) NOT NULL CHECK (monto > 0),
  fecha_pago TIMESTAMP NOT NULL DEFAULT NOW(),
  metodo VARCHAR(20) NOT NULL CHECK (metodo IN ('efectivo', 'transferencia')),
  estado VARCHAR(20) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobado', 'rechazado')),
  comprobante VARCHAR(500),
  registrado_por UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS cargos_automaticos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registro_acceso_id UUID NOT NULL REFERENCES registros_acceso(id) ON DELETE RESTRICT,
  residente_id UUID NOT NULL REFERENCES residentes(id) ON DELETE RESTRICT,
  monto DECIMAL(10,2) NOT NULL CHECK (monto > 0),
  descripcion VARCHAR(255),
  aplicado BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS configuracion_cargos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(100) NOT NULL,
  monto DECIMAL(10,2) NOT NULL CHECK (monto > 0),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS preautorizaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  residente_id UUID NOT NULL REFERENCES residentes(id) ON DELETE CASCADE,
  nombre_visitante VARCHAR(150) NOT NULL,
  numero_dpi VARCHAR(20),
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES
  ('Admin SecureGate', 'admin@securegate.com',  crypt('admin123',  gen_salt('bf', 10)), 'admin'),
  ('Agente Garita 1',  'agente1@securegate.com', crypt('agente123', gen_salt('bf', 10)), 'agente'),
  ('Residente Demo',   'r1@securegate.com',      crypt('res123',    gen_salt('bf', 10)), 'residente')
ON CONFLICT (email) DO NOTHING;

INSERT INTO residentes (usuario_id, numero_casa, estado_pago)
  SELECT id, 'A-01', 'al_dia' FROM usuarios WHERE email = 'r1@securegate.com'
ON CONFLICT (numero_casa) DO NOTHING;

SELECT 'SecureGate DB inicializada correctamente' as mensaje;