-- ─────────────────────────────────────────────────────────────────────────
-- SecureGate — datos de DEMOSTRACIÓN. SOLO DESARROLLO.
--
-- Crea una empresa, una sucursal y una cuenta de cada rol con contraseñas
-- CONOCIDAS Y PÚBLICAS (están en el repositorio). Jamás debe correr en
-- producción: cualquiera podría entrar como owner con admin@securegate.com.
--
-- Antes vivía al final de init.sql, que el backend aplica en CADA arranque
-- (db/migrate.ts), también contra Cloud SQL. Ahora sólo se aplica si
-- SEED_DEMO=true y NODE_ENV != production (ver migrate.ts).
--
-- Idempotente: se puede ejecutar varias veces.
-- ─────────────────────────────────────────────────────────────────────────

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
