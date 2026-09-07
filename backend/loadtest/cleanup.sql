-- Limpia los datos sintéticos generados por las pruebas de carga/estrés.
-- Solo pensado para el ambiente de desarrollo local (docker-compose.yml).
-- Ejecutar manualmente y con criterio, no automáticamente.
--
-- Uso:
--   docker exec -i securegate-db psql -U sguser -d securegate < backend/loadtest/cleanup.sql

-- Registros de acceso creados por estres-accesos.yml (todos usan agente1 como agente_id)
DELETE FROM registros_acceso
WHERE agente_id = (SELECT id FROM usuarios WHERE email = 'agente1@securegate.com');

-- Visitantes sintéticos (numero_dpi de 12 dígitos generado por $randomNumber) que
-- quedaron sin ningún registro de acceso tras el DELETE de arriba
DELETE FROM visitantes
WHERE numero_dpi ~ '^[0-9]{12}$'
  AND id NOT IN (SELECT visitante_id FROM registros_acceso);

-- Refresh tokens generados por los logins repetidos de carga-login.yml
DELETE FROM refresh_tokens
WHERE usuario_id IN (
  SELECT id FROM usuarios WHERE email IN ('admin@securegate.com', 'r1@securegate.com')
);
