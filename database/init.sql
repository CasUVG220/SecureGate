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

INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES
  ('Admin SecureGate', 'admin@securegate.com', 'hash_demo', 'admin'),
  ('Agente Garita 1', 'agente1@securegate.com', 'hash_demo', 'agente')
ON CONFLICT (email) DO NOTHING;

SELECT 'SecureGate DB inicializada correctamente' as mensaje;
