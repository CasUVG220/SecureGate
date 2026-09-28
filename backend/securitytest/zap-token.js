'use strict';
// Imprime un JWT real (login) del rol pedido. Uso: node zap-token.js owner|adminEmpA|adminSucA1|agenteA1|resA1
const L = require('./lib');
(async () => {
  const r = await L.login(L.EMAIL[process.argv[2]]);
  if (!r.token) { console.error(`login falló: ${r.status} ${r.resp.text}`); process.exit(1); }
  process.stdout.write(r.token);
})();
