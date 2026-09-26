'use strict';
// Funciones auxiliares de los escenarios del Sprint 8.
const crypto = require('crypto');

/** id_cliente único (UUID v4) por iteración: es lo que genera la app de garita antes de encolar. */
function nuevoIdCliente(context, _events, done) {
  context.vars.idCliente = crypto.randomUUID();
  return done();
}

/** DPI sintético de 13 dígitos. */
function nuevoDpi(context, _events, done) {
  context.vars.dpiSintetico = String(1000000000000 + Math.floor(Math.random() * 8999999999999));
  return done();
}

module.exports = { nuevoIdCliente, nuevoDpi };
