import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { themePalettes, type ScaleName } from '../tokens';

/**
 * H01 (SCRUM-108) — contraste de los botones y rellenos de color.
 *
 * Causa raíz: la marca es carbón y su relleno se INVIERTE en oscuro (los tonos
 * 300-800 de `brand` son grises claros), y `tailwind.config.ts` mapea los alias
 * heredados `blue`, `teal`, `cyan`, `indigo` y `purple` a esa misma escala. Un
 * `bg-blue-600 text-white` era carbón + blanco en claro (bien) pero blanco sobre
 * gris casi blanco en oscuro (~1.1:1). Este archivo evita que vuelva:
 *
 *  1. calcula la razón de contraste WCAG de los pares del sistema en ambos temas;
 *  2. comprueba que existe la red de seguridad global de `index.css`;
 *  3. recorre el código fuente (con el parser de TypeScript, no con regex sobre
 *     texto) y falla si una pantalla vuelve a escribir un relleno sólido de marca
 *     junto a `text-white`, o un relleno de estado (verde/rojo) con blanco que no
 *     llegue a AA.
 */

const SRC = path.resolve(__dirname, '../..');
const css = readFileSync(path.join(SRC, 'index.css'), 'utf8');

// ── WCAG ────────────────────────────────────────────────────────────────────
const canal = (v: number): number => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminancia = (rgb: string): number => {
  const [r, g, b] = rgb.split(/\s+/).map(Number);
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
};
const contraste = (a: string, b: string): number => {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const BLANCO = '255 255 255';
const AA = 4.5;
const AA_UI = 3;

type Tema = 'light' | 'dark';
const TEMAS: Tema[] = ['light', 'dark'];

// ── Tinta de marca por tema (vive en index.css, no en tokens.ts) ────────────
const tintaDeMarca = (tema: Tema): string => {
  const inicio = tema === 'dark' ? css.indexOf('html.dark {') : css.indexOf(':root {\n  --c-brand-50');
  const fin = css.indexOf('\n}', inicio);
  const m = css.slice(inicio, fin).match(/--c-brand-ink:\s*([^;]+);/);
  if (!m) throw new Error(`No se encontró --c-brand-ink para el tema ${tema}`);
  return m[1].trim();
};

const tono = (tema: Tema, escala: ScaleName, t: number): string =>
  (themePalettes[tema][escala] as Record<string, string>)[String(t)];

// ── Familia de color → escala real, leída del config de Tailwind ────────────
// Import dinámico por ruta calculada: el config de Tailwind se compila con tsconfig.node.json,
// y uno estático lo arrastraría al tsconfig de la app (donde sus tipos no cuadran).
const config = (await import(/* @vite-ignore */ path.resolve(SRC, '../tailwind.config.ts'))).default;
const colores = (config.theme.extend.colors ?? {}) as Record<string, Record<string, string> | undefined>;
const escalaDe = (familia: string): ScaleName | null => {
  const m = colores[familia]?.['500']?.match(/--c-([a-z]+)-500/);
  return (m?.[1] as ScaleName | undefined) ?? null;
};
const FAMILIAS_DE_MARCA = Object.keys(colores).filter(f => escalaDe(f) === 'brand');

describe('contraste: pares del sistema', () => {
  it('los alias heredados de azul/turquesa/índigo/morado siguen apuntando a la escala de marca', () => {
    // Si alguien re-apunta un alias, la red de seguridad de index.css y esta
    // prueba deben revisarse juntas.
    for (const alias of ['blue', 'teal', 'cyan', 'indigo', 'purple', 'brand']) {
      expect(FAMILIAS_DE_MARCA).toContain(alias);
    }
  });

  it.each(TEMAS)('<Button> primario (tema %s): relleno 500/600/700 con la tinta de marca ≥ 4.5:1', tema => {
    const tinta = tintaDeMarca(tema);
    for (const t of [500, 600, 700]) {
      expect(contraste(tono(tema, 'brand', t), tinta), `brand-${t} / tinta (${tema})`).toBeGreaterThanOrEqual(AA);
    }
  });

  it.each(TEMAS)('<Button> de peligro (tema %s): danger-600 y 700 con blanco ≥ 4.5:1', tema => {
    for (const t of [600, 700]) {
      expect(contraste(tono(tema, 'danger', t), BLANCO), `danger-${t} / blanco (${tema})`).toBeGreaterThanOrEqual(AA);
    }
  });

  it('el Button y .sg-btn-danger usan esos mismos tonos', () => {
    const boton = readFileSync(path.join(SRC, 'components/ui/Button.tsx'), 'utf8');
    expect(boton).toMatch(/primary:\s+'bg-brand-500 text-brand-ink hover:bg-brand-600 active:bg-brand-700/);
    expect(boton).toMatch(/danger:\s+'bg-danger-600 text-white hover:bg-danger-700 active:bg-danger-700/);
    expect(css).toMatch(/\.sg-btn-danger \{ background: rgb\(var\(--c-danger-600\)\)/);
    expect(css).toMatch(/\.sg-btn-primary \{ background: rgb\(var\(--c-brand-500\)\); color: rgb\(var\(--c-brand-ink\)\)/);
  });
});

describe('contraste: red de seguridad global de index.css (tema oscuro)', () => {
  const TONOS_CON_RED = [300, 400, 500, 600, 700, 800];
  const bloque = (() => {
    const i = css.indexOf('html.dark :is(');
    const f = css.indexOf('.text-white {', i);
    return css.slice(i, f);
  })();

  it('cubre bg-* y from-* de toda la familia de marca en los tonos 300-800', () => {
    expect(bloque.length).toBeGreaterThan(0);
    for (const familia of FAMILIAS_DE_MARCA) {
      for (const prefijo of ['bg', 'from']) {
        for (const t of TONOS_CON_RED) {
          expect(bloque, `.${prefijo}-${familia}-${t}`).toContain(`.${prefijo}-${familia}-${t}`);
        }
      }
    }
  });

  it('con la tinta de marca esos tonos quedan ≥ 4.5:1 en oscuro (con blanco no llegaban a 2.6:1)', () => {
    const tinta = tintaDeMarca('dark');
    for (const t of TONOS_CON_RED) {
      const fondo = tono('dark', 'brand', t);
      expect(contraste(fondo, tinta), `brand-${t} + tinta`).toBeGreaterThanOrEqual(AA);
      expect(contraste(fondo, BLANCO), `brand-${t} + blanco`).toBeLessThan(AA);
    }
  });

  it('en claro, los tonos 300-700 sí aguantan el blanco', () => {
    for (const t of [300, 400, 500, 600, 700]) {
      expect(contraste(tono('light', 'brand', t), BLANCO), `brand-${t} claro`).toBeGreaterThanOrEqual(AA);
    }
  });
});

// ── Recorrido del código fuente ─────────────────────────────────────────────
interface Cadena { archivo: string; linea: number; texto: string }

const archivos = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' || e.name === 'node_modules' ? [] : archivos(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });

const cadenasDe = (archivo: string): Cadena[] => {
  const texto = readFileSync(archivo, 'utf8');
  const sf = ts.createSourceFile(archivo, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Cadena[] = [];
  const visitar = (n: ts.Node) => {
    if (
      ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ||
      ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)
    ) {
      out.push({
        archivo: path.relative(SRC, archivo),
        linea: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
        texto: n.text,
      });
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return out;
};

interface Relleno { familia: string; tono: number; estado: boolean; token: string }

/** Rellenos SÓLIDOS (sin /alfa) de una cadena de clases: bg-*, y el inicio de un degradado (from-*). */
const rellenosSolidos = (texto: string): Relleno[] => {
  const out: Relleno[] = [];
  for (const token of texto.split(/\s+/)) {
    const m = token.match(/^((?:[a-z0-9-]+:)*)(bg|from)-([a-z]+)-(\d{2,3})$/);
    if (!m) continue;
    const prefijos = m[1].split(':').filter(Boolean);
    if (prefijos.includes('dark')) continue;
    out.push({
      familia: m[3],
      tono: Number(m[4]),
      estado: prefijos.some(p => ['hover', 'focus', 'active', 'disabled', 'group-hover'].includes(p)),
      token,
    });
  }
  return out;
};

const todas = archivos(SRC).flatMap(cadenasDe);
const conBlanco = todas.filter(c => /(^|\s)text-white(\s|$)/.test(c.texto));

describe('contraste: nadie escribe `relleno sólido de marca + text-white`', () => {
  it('el recorrido encontró código que revisar', () => {
    expect(todas.length).toBeGreaterThan(1000);
    expect(conBlanco.length).toBeGreaterThan(20);
  });

  it('ningún relleno sólido de la familia de marca lleva text-white (usa <Button> o text-brand-ink)', () => {
    const infracciones = conBlanco.flatMap(c =>
      rellenosSolidos(c.texto)
        .filter(r => FAMILIAS_DE_MARCA.includes(r.familia))
        .map(r => `${c.archivo}:${c.linea}  ${r.token} + text-white`));
    expect(
      infracciones,
      'Blanco sobre un relleno de marca queda a ~1.1:1 en el tema oscuro (H01). Usa <Button> o `text-brand-ink`.',
    ).toEqual([]);
  });

  it('los rellenos de estado (verde/rojo/ámbar) con text-white llegan a AA en reposo y a 3:1 en hover, en ambos temas', () => {
    const infracciones: string[] = [];
    for (const c of conBlanco) {
      for (const r of rellenosSolidos(c.texto)) {
        const escala = escalaDe(r.familia);
        if (!escala || !['success', 'danger', 'warning'].includes(escala)) continue;
        for (const tema of TEMAS) {
          const razon = contraste(tono(tema, escala, r.tono), BLANCO);
          const minimo = r.estado ? AA_UI : AA;
          if (razon < minimo) infracciones.push(`${c.archivo}:${c.linea}  ${r.token} + text-white = ${razon.toFixed(2)}:1 en ${tema} (mín. ${minimo})`);
        }
      }
    }
    expect(infracciones).toEqual([]);
  });
});
