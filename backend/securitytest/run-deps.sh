#!/usr/bin/env bash
# Paso 4: dependencias y secretos → results/npm-audit-*.json, cargo-audit.json, gitleaks-historial.json
# (gitleaks con --redact: ningún secreto llega a los reportes).
set -uo pipefail
cd "$(dirname "$0")/../.."
R=backend/securitytest/results; mkdir -p $R
for p in backend frontend desktop; do (cd $p && npm audit --json > ../$R/npm-audit-$p.json 2>/dev/null); done
(cd desktop/src-tauri && cargo audit --json > ../../$R/cargo-audit.json 2>/dev/null)
docker run --rm -v "$PWD":/repo -v "$PWD/$R":/out zricethezav/gitleaks:latest git /repo --redact --report-format json --report-path /out/gitleaks-historial.json --no-banner
for p in backend frontend desktop; do node -e "const m=require('./$R/npm-audit-$p.json').metadata.vulnerabilities;console.log('$p',JSON.stringify(m))"; done
node -e "const r=require('./$R/cargo-audit.json');console.log('cargo: vulnerabilidades',r.vulnerabilities.count,'avisos',JSON.stringify(Object.fromEntries(Object.entries(r.warnings||{}).map(([k,v])=>[k,v.length]))))"
