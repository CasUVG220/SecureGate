/**
 * Guardas de despliegue (SCRUM-118):
 *   - el arranque del backend aborta si en producción está activa la pasarela de tarjeta simulada;
 *   - scripts/deploy.sh usa producción por defecto y falla con mensaje claro si
 *     PAGOS_TARJETA_SIMULADA está activa (entorno, archivo de entorno o compose);
 *   - nginx/nginx.conf se genera desde una plantilla: sin dominio válido, o con el marcador
 *     sin sustituir, el despliegue falla antes de levantar nada.
 * Los scripts se ejecutan sobre una COPIA temporal del repo (no tocan .env ni nginx.conf reales).
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { validarEntorno, pagoSimuladoActivo } from '../config/env';

const RAIZ = path.resolve(__dirname, '../../..');
const hayBash = process.platform !== 'win32';
const describeSh = hayBash ? describe : describe.skip;

describe('pagoSimuladoActivo / validarEntorno', () => {
  const claves = ['NODE_ENV', 'JWT_SECRET', 'ALLOWED_ORIGINS', 'DATABASE_URL', 'PAGOS_TARJETA_SIMULADA'] as const;
  const previo: Record<string, string | undefined> = {};
  beforeEach(() => { claves.forEach(k => { previo[k] = process.env[k]; }); });
  afterEach(() => {
    claves.forEach(k => { if (previo[k] === undefined) delete process.env[k]; else process.env[k] = previo[k]; });
  });

  it.each([
    ['true', true], ['TRUE', true], [' true ', true], ['1', true], ['yes', true], ['on', true],
    ['false', false], ['0', false], ['', false], ['no', false],
  ])('pagoSimuladoActivo(%p) → %p', (valor, esperado) => {
    expect(pagoSimuladoActivo({ PAGOS_TARJETA_SIMULADA: valor } as any)).toBe(esperado);
  });

  it('sin la variable no está activa', () => {
    expect(pagoSimuladoActivo({} as any)).toBe(false);
  });

  const prod = () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a'.repeat(48);
    process.env.ALLOWED_ORIGINS = 'https://app.ejemplo.com.gt';
    process.env.DATABASE_URL = 'postgresql://u:p@cloud-sql-proxy:5432/securegate';
  };

  it('en PRODUCCIÓN aborta el arranque si PAGOS_TARJETA_SIMULADA=true', () => {
    prod();
    process.env.PAGOS_TARJETA_SIMULADA = 'true';
    expect(() => validarEntorno()).toThrow(/PAGOS_TARJETA_SIMULADA.*producción/);
  });

  it('en PRODUCCIÓN arranca si la variable falta o es false', () => {
    prod();
    delete process.env.PAGOS_TARJETA_SIMULADA;
    expect(() => validarEntorno()).not.toThrow();
    process.env.PAGOS_TARJETA_SIMULADA = 'false';
    expect(() => validarEntorno()).not.toThrow();
  });

  it('en desarrollo la pasarela simulada sigue permitida (docker-compose.yml la enciende)', () => {
    prod();
    process.env.NODE_ENV = 'development';
    process.env.PAGOS_TARJETA_SIMULADA = 'true';
    expect(() => validarEntorno()).not.toThrow();
  });
});

describeSh('scripts/deploy.sh --check y scripts/render-nginx.sh', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-deploy-'));
    fs.cpSync(path.join(RAIZ, 'scripts'), path.join(tmp, 'scripts'), { recursive: true });
    fs.cpSync(path.join(RAIZ, 'nginx'), path.join(tmp, 'nginx'), { recursive: true });
    fs.copyFileSync(path.join(RAIZ, 'docker-compose.prod.yml'), path.join(tmp, 'docker-compose.prod.yml'));
    fs.copyFileSync(path.join(RAIZ, 'docker-compose.yml'), path.join(tmp, 'docker-compose.yml'));
    fs.rmSync(path.join(tmp, 'nginx', 'nginx.conf'), { force: true });
  });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  // Entorno mínimo y limpio: nada de DOMINIO/PUBLIC_URL/PAGOS_* heredado de la máquina.
  const correr = (script: string, args: string[], env: Record<string, string> = {}) => {
    const r = spawnSync('bash', [path.join(tmp, script), ...args], {
      cwd: tmp,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp, ...env },
      encoding: 'utf8',
    });
    return { code: r.status, salida: `${r.stdout}${r.stderr}` };
  };
  const nginxConf = () => path.join(tmp, 'nginx', 'nginx.conf');

  it('producción es el compose por defecto: genera nginx y valida', () => {
    const r = correr('scripts/deploy.sh', ['--check'], { DOMINIO: 'app.ejemplo.com.gt' });
    expect(r.code).toBe(0);
    expect(r.salida).toMatch(/docker-compose\.prod\.yml/);
    expect(r.salida).not.toMatch(/DESARROLLO/);
  });

  it('PAGOS_TARJETA_SIMULADA=true en el entorno → falla con mensaje claro y no genera nginx', () => {
    const r = correr('scripts/deploy.sh', ['--check'], { DOMINIO: 'app.ejemplo.com.gt', PAGOS_TARJETA_SIMULADA: 'true' });
    expect(r.code).not.toBe(0);
    expect(r.salida).toMatch(/PAGOS_TARJETA_SIMULADA está activada en la variable de entorno/);
    expect(r.salida).toMatch(/PRODUCCIÓN/);
    expect(fs.existsSync(nginxConf())).toBe(false);
  });

  it('PAGOS_TARJETA_SIMULADA=true en el archivo .env → falla (también con comillas y mayúsculas)', () => {
    fs.writeFileSync(path.join(tmp, '.env'), 'DOMINIO=app.ejemplo.com.gt\nPAGOS_TARJETA_SIMULADA="TRUE"  # prueba\n');
    const r = correr('scripts/deploy.sh', ['--check']);
    expect(r.code).not.toBe(0);
    expect(r.salida).toMatch(/en el archivo \.env/);
  });

  it('PAGOS_TARJETA_SIMULADA=false en .env no estorba', () => {
    fs.writeFileSync(path.join(tmp, '.env'), 'DOMINIO=app.ejemplo.com.gt\nPAGOS_TARJETA_SIMULADA=false\n');
    expect(correr('scripts/deploy.sh', ['--check']).code).toBe(0);
  });

  it('PAGOS_TARJETA_SIMULADA: "true" dentro del compose de producción → falla; en comentarios no', () => {
    const p = path.join(tmp, 'docker-compose.prod.yml');
    const original = fs.readFileSync(p, 'utf8');
    // El compose real solo la menciona en comentarios: debe pasar.
    expect(original).toMatch(/#.*PAGOS_TARJETA_SIMULADA/);
    expect(correr('scripts/deploy.sh', ['--check'], { DOMINIO: 'app.ejemplo.com.gt' }).code).toBe(0);
    fs.writeFileSync(p, original.replace('TZ: America/Guatemala', 'TZ: America/Guatemala\n      PAGOS_TARJETA_SIMULADA: "true"'));
    const r = correr('scripts/deploy.sh', ['--check'], { DOMINIO: 'app.ejemplo.com.gt' });
    expect(r.code).not.toBe(0);
    expect(r.salida).toMatch(/en el archivo docker-compose\.prod\.yml/);
  });

  it('sin dominio (ni DOMINIO ni PUBLIC_URL) → falla pidiendo el dominio', () => {
    const r = correr('scripts/deploy.sh', ['--check']);
    expect(r.code).not.toBe(0);
    expect(r.salida).toMatch(/no hay dominio/);
    expect(fs.existsSync(nginxConf())).toBe(false);
  });

  it.each([
    ['DOMINIO', /sigue siendo el literal/],
    ['localhost', /no es un nombre de dominio válido/],
    ['https://app.ejemplo.com.gt', /no es un nombre de dominio válido/],
    ['app.ejemplo.com.gt;}\nserver{', /no es un nombre de dominio válido/],
    ['a b.com', /no es un nombre de dominio válido/],
  ])('dominio inválido %p → falla y no escribe nginx.conf', (dominio, mensaje) => {
    const r = correr('scripts/render-nginx.sh', [], { DOMINIO: dominio });
    expect(r.code).not.toBe(0);
    expect(r.salida).toMatch(mensaje);
    expect(fs.existsSync(nginxConf())).toBe(false);
  });

  it('con dominio válido genera nginx.conf sin marcadores y conserva las variables propias de nginx', () => {
    const r = correr('scripts/render-nginx.sh', [], { DOMINIO: 'App.Ejemplo.com.gt' });
    expect(r.code).toBe(0);
    const conf = fs.readFileSync(nginxConf(), 'utf8');
    expect(conf).toContain('server_name app.ejemplo.com.gt;');
    expect(conf).toContain('/etc/letsencrypt/live/app.ejemplo.com.gt/fullchain.pem');
    expect(conf).not.toMatch(/DOMINIO/);
    expect(conf).toContain('return 301 https://$host$request_uri;');
    expect(conf).toContain('$binary_remote_addr');
  });

  it('el dominio se toma de PUBLIC_URL (host, sin esquema, puerto ni ruta)', () => {
    fs.writeFileSync(path.join(tmp, '.env'), 'PUBLIC_URL=https://portal.ejemplo.com.gt:8443/inicio\n');
    const r = correr('scripts/render-nginx.sh', []);
    expect(r.code).toBe(0);
    expect(fs.readFileSync(nginxConf(), 'utf8')).toContain('server_name portal.ejemplo.com.gt;');
  });

  it('si la plantilla trae un marcador distinto del esperado, el resultado se rechaza', () => {
    const plantilla = path.join(tmp, 'nginx', 'nginx.conf.template');
    fs.appendFileSync(plantilla, '\n# TODO: poner DOMINIO aquí\n');
    const r = correr('scripts/render-nginx.sh', [], { DOMINIO: 'app.ejemplo.com.gt' });
    expect(r.code).not.toBe(0);
    expect(r.salida).toMatch(/quedó el literal DOMINIO sin sustituir/);
    expect(fs.existsSync(nginxConf())).toBe(false);
  });

  it('plantilla sin marcador → falla', () => {
    fs.writeFileSync(path.join(tmp, 'nginx', 'nginx.conf.template'), 'events {}\nhttp {}\n');
    const r = correr('scripts/render-nginx.sh', [], { DOMINIO: 'app.ejemplo.com.gt' });
    expect(r.code).not.toBe(0);
    expect(r.salida).toMatch(/no contiene el marcador/);
  });

  it('el compose de desarrollo se acepta con aviso y no exige dominio', () => {
    const r = correr('scripts/deploy.sh', ['--check'], { COMPOSE_FILE: 'docker-compose.yml', PAGOS_TARJETA_SIMULADA: 'true' });
    expect(r.code).toBe(0);
    expect(r.salida).toMatch(/DESARROLLO/);
    expect(fs.existsSync(nginxConf())).toBe(false);
  });

  it('--check no crea ni modifica el archivo de entorno', () => {
    correr('scripts/deploy.sh', ['--check'], { DOMINIO: 'app.ejemplo.com.gt' });
    expect(fs.existsSync(path.join(tmp, '.env'))).toBe(false);
  });
});

describe('plantilla de nginx y compose de producción (estático)', () => {
  const plantilla = fs.readFileSync(path.join(RAIZ, 'nginx/nginx.conf.template'), 'utf8');
  const compose = fs.readFileSync(path.join(RAIZ, 'docker-compose.prod.yml'), 'utf8');

  it('la plantilla usa el marcador y ya no trae el literal DOMINIO suelto', () => {
    expect(plantilla.match(/\$\{DOMINIO\}/g)?.length).toBe(4);
    expect(plantilla.replace(/\$\{DOMINIO\}/g, '')).not.toMatch(/DOMINIO/);
  });

  it('nginx/nginx.conf (generado) no se versiona', () => {
    expect(fs.existsSync(path.join(RAIZ, 'nginx/nginx.conf.template'))).toBe(true);
    expect(fs.readFileSync(path.join(RAIZ, '.gitignore'), 'utf8')).toMatch(/^nginx\/nginx\.conf$/m);
  });

  it('el compose de producción monta el archivo generado y no crea el directorio si falta', () => {
    expect(compose).toMatch(/source: \.\/nginx\/nginx\.conf/);
    expect(compose).toMatch(/create_host_path: false/);
    expect(compose).not.toMatch(/^\s*PAGOS_TARJETA_SIMULADA:/m);
  });
});
