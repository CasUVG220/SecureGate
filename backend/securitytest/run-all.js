'use strict';
/**
 * Corre TODAS las suites de seguridad locales en el orden que evita interferencias:
 *   stack con límites de producción → siembra → 01…09 → resumen.
 * ZAP, sqlmap, npm/cargo audit y gitleaks se lanzan aparte (run-zap.sh, run-sqlmap.sh, run-deps.sh).
 *   npm run securitytest        (desde backend/)
 */
const { execSync, spawnSync } = require('child_process');
const path = require('path');
const dir = __dirname;
const sh = cmd => execSync(cmd, { stdio: 'inherit', cwd: dir });

sh('./stack.sh prod-limits');
sh('node seed.js');
sh('./snapshot.sh save seeded');
sh('./prodmode.sh up');
let fallas = 0;
for (const s of ['01-idor', '02-roles', '03-jwt', '04-invitaciones', '05-eliminar', '06-suspension', '07-sqli', '08-headers', '09-ratelimit']) {
  console.log(`\n████ ${s} ████`);
  const r = spawnSync('node', [path.join(dir, `${s}.js`)], { stdio: 'inherit', cwd: dir });
  if (r.status !== 0) { console.error(`${s} terminó con código ${r.status}`); fallas++; }
}
sh('./prodmode.sh down');
sh('node redactar.js');
sh('node resumen.js');
process.exit(fallas ? 1 : 0);
