'use strict';
// Criterios de presentación C38–C47 y C45b (comun/CONTRATO.md §10 y §12; nombres de variables de comun/UX_IDENTIDAD.md §1 y comun/tipos.js).
// Estáticos, sobre los archivos (C47 se aproxima sin navegador).
// «Hojas» = simulador_fotovoltaica/css/*.css, simulador_planta_real/css/*.css, comun/css/*.css, aula_pct23/static/**/*.css y los
// bloques <style> de los .html de los simuladores, de comun/, de aula_pct23/static/ y de aula_pct23/templates/.
// «Interfaz» = simulador_*/*.html, simulador_*/js/interfaz/*.js, simulador_*/js/scada2d/*.js, comun/js/diagnostico/*.js, aula_pct23/templates/*.html.
// Hasta que la interfaz gráfica aplique la identidad (fase 2) casi todos fallan: es lo esperado.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const T = require('../tipos.js');

const RAIZ = path.resolve(__dirname, '..', '..');
const SIMULADORES = [
  { dir: 'simulador_fotovoltaica', nombre: /fotovoltaica/i },
  { dir: 'simulador_planta_real', nombre: /HTST|planta real|pasteuriz/i },
];
const HOJA_COMUN = 'comun/css/identidad.css';
const BARRA_AULA = 'aula_pct23/templates/barra_simulador.html';
const rel = a => path.relative(RAIZ, a).replace(/\\/g, '/');

// ------------------------------------------------------------------ archivos ----

function listar(dir, filtro, recursivo) {
  const abs = path.join(RAIZ, dir);
  if (!fs.existsSync(abs)) return [];
  const r = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const p = path.join(abs, e.name);
    if (e.isDirectory()) { if (recursivo && e.name !== 'node_modules' && e.name !== 'vendor') r.push(...listar(rel(p), filtro, true)); }
    else if (filtro(e.name)) r.push(p);
  }
  return r;
}
const esCss = n => n.endsWith('.css');
const esHtml = n => n.endsWith('.html');
const esJs = n => n.endsWith('.js');

const ARCHIVOS_CSS = [
  ...SIMULADORES.flatMap(s => listar(`${s.dir}/css`, esCss, false)),
  ...listar('comun/css', esCss, false),
  ...listar('aula_pct23/static', esCss, true),
];
const HTML_CON_ESTILO = [
  ...SIMULADORES.flatMap(s => listar(s.dir, esHtml, false)),
  ...listar('comun', esHtml, true),
  ...listar('aula_pct23/static', esHtml, true),
  ...listar('aula_pct23/templates', esHtml, false),
];
const INTERFAZ_HTML = [...SIMULADORES.flatMap(s => listar(s.dir, esHtml, false)), ...listar('aula_pct23/templates', esHtml, false)];
const INTERFAZ_JS = [
  ...SIMULADORES.flatMap(s => [...listar(`${s.dir}/js/interfaz`, esJs, false), ...listar(`${s.dir}/js/scada2d`, esJs, false)]),
  ...listar('comun/js/diagnostico', esJs, false),
];
const leer = a => fs.readFileSync(a, 'utf8');
const lineaDe = (texto, i) => texto.slice(0, i).split('\n').length;

/** Sustituye por espacios (conservando saltos de línea) lo que casa con `re`. */
const borrar = (texto, re) => texto.replace(re, m => m.replace(/[^\n]/g, ' '));
const sinComentariosCss = t => borrar(t, /\/\*[\s\S]*?\*\//g);
const sinPlantillas = t => borrar(t, /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\}/g);

function sinComentariosJs(src) {
  let r = '', i = 0, cadena = null;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (cadena) { r += c; if (c === '\\') { r += d || ''; i += 2; continue; } if (c === cadena) cadena = null; i++; }
    else if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; }
    else if (c === '/' && d === '*') { const f = src.indexOf('*/', i + 2); const t = src.slice(i, f < 0 ? src.length : f + 2); r += t.replace(/[^\n]/g, ' '); i += t.length; }
    else { if (c === '\'' || c === '"' || c === '`') cadena = c; r += c; i++; }
  }
  return r;
}

// --------------------------------------------------------------- analizador CSS ----

function finCadena(s, i) { const q = s[i]; i++; while (i < s.length && s[i] !== q) { if (s[i] === '\\') i++; i++; } return i + 1; }
function cierre(s, i) {                                     // s[i] === '{' → índice de su '}'
  let n = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === '\'') { i = finCadena(s, i); continue; }
    if (c === '{') n++;
    else if (c === '}') { n--; if (n === 0) return i; }
    i++;
  }
  return s.length;
}
function trocear(s, sep) {                                   // separa por `sep` fuera de paréntesis y cadenas
  const r = []; let n = 0, ini = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === '\'') { i = finCadena(s, i) - 1; continue; }
    if (c === '(') n++; else if (c === ')') n--;
    else if (c === sep && n === 0) { r.push(s.slice(ini, i)); ini = i + 1; }
  }
  r.push(s.slice(ini));
  return r;
}

/** Reglas de una hoja: { archivo, selector, contexto: [@media…], decls: [{ prop, valor, linea }] }. */
function analizarCss(texto, archivo, desplazamiento = 0, original = texto) {
  const reglas = [];
  const decl = (trozo, pos) => {
    const k = trozo.indexOf(':');
    if (k < 0) return null;
    const prop = trozo.slice(0, k).trim().toLowerCase();
    if (!prop || /[\s{}]/.test(prop)) return null;
    return { prop, valor: trozo.slice(k + 1).replace(/!important/i, '').trim(), linea: lineaDe(original, pos + trozo.search(/\S/)) };
  };
  (function bloque(s, base, contexto, selectorPadre) {
    let i = 0, ini = 0;
    const sueltas = [];
    while (i < s.length) {
      const c = s[i];
      if (c === '"' || c === '\'') { i = finCadena(s, i); continue; }
      if (c === ';') { if (selectorPadre !== null) { const d = decl(s.slice(ini, i), base + ini); if (d) sueltas.push(d); } ini = i + 1; i++; continue; }
      if (c === '{') {
        const prelude = s.slice(ini, i).trim().replace(/\s+/g, ' ');
        const fin = cierre(s, i);
        const cuerpo = s.slice(i + 1, fin);
        const at = prelude.startsWith('@');
        if (at && !/^@(font-face|page)\b/.test(prelude)) bloque(cuerpo, base + i + 1, [...contexto, prelude], null);
        else bloque(cuerpo, base + i + 1, contexto, prelude);
        i = fin + 1; ini = i; continue;
      }
      i++;
    }
    if (selectorPadre !== null) {
      const d = decl(s.slice(ini), base + ini);
      if (d) sueltas.push(d);
      reglas.push({ archivo, selector: selectorPadre, contexto, decls: sueltas });
    }
  })(texto, desplazamiento, [], null);
  return reglas;
}

// Copias de la hoja común que se sirven por otra ruta (p. ej. aula_pct23/static/identidad.css): si son idénticas byte a byte, son la
// misma hoja y no se cuentan dos veces; si difieren, se analizan como una hoja más (y C39 las marcará por redefinir la marca).
const COMUN_ABS = path.join(RAIZ, HOJA_COMUN);
const esCopiaDeLaComun = a => a !== COMUN_ABS && path.basename(a) === 'identidad.css' && fs.existsSync(COMUN_ABS) && leer(a) === leer(COMUN_ABS);

function hojas() {
  const r = [];
  for (const a of ARCHIVOS_CSS) if (!esCopiaDeLaComun(a)) r.push(...analizarCss(sinComentariosCss(leer(a)), rel(a)));
  for (const a of HTML_CON_ESTILO) {
    const t = sinPlantillas(borrar(leer(a), /<!--[\s\S]*?-->/g));
    for (const m of t.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
      const ini = m.index + m[0].indexOf('>') + 1;
      r.push(...analizarCss(sinComentariosCss(m[1]), rel(a), ini, t));
    }
  }
  return r;
}
const REGLAS = hojas();
const DECLS = REGLAS.flatMap(r => r.decls.map(d => ({ ...d, regla: r })));
const donde = d => `${d.regla.archivo}:${d.linea} ${d.regla.selector} { ${d.prop}: ${d.valor} }`;

const esRoot = sel => trocear(sel, ',').every(x => /^:root(\[[^\]]*\])*$/.test(x.trim()));
const contextoDeVariables = ctx => ctx.every(c => /^@media\b.*prefers-color-scheme/.test(c));

// Variables definidas en las hojas (primero la hoja común) para resolver var(--x).
const VARIABLES = {};
for (const d of [...DECLS.filter(x => x.regla.archivo === HOJA_COMUN), ...DECLS]) if (d.prop.startsWith('--') && !(d.prop in VARIABLES)) VARIABLES[d.prop] = d.valor;
function resolver(v, n = 0) {
  if (n > 8) return v;
  const r = v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (m, nombre, fb) => (nombre in VARIABLES ? VARIABLES[nombre] : (fb !== undefined ? fb : m)));
  return r === v ? r : resolver(r, n + 1);
}

const RE_HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z_-])/i;
const RE_FUNCION_COLOR = /\b(?:rgba?|hsla?)\s*\(/i;
const sinUrl = v => v.replace(/url\([^)]*\)/gi, 'url()');
const tieneColorLiteral = v => RE_HEX.test(sinUrl(v)) || RE_FUNCION_COLOR.test(v);
const RE_NARANJA = /#f68b11(?![0-9a-z])|rgba?\(\s*246\s*,\s*139\s*,\s*17\s*[,)]/i;

const fallos = (lista, titulo) => assert.deepStrictEqual(lista, [], `${titulo} (${lista.length})`);
const hojaComun = () => {
  assert.ok(fs.existsSync(path.join(RAIZ, HOJA_COMUN)), `falta la hoja común ${HOJA_COMUN} (la escribe la interfaz gráfica con los valores de comun/UX_IDENTIDAD.md)`);
  return DECLS.filter(d => d.regla.archivo === HOJA_COMUN && esRoot(d.regla.selector) && d.regla.contexto.length === 0);
};
const valorEnComun = nombre => { const d = hojaComun().find(x => x.prop === nombre); return d ? d.valor : undefined; };
const normal = v => (v || '').toLowerCase().replace(/\s+/g, '').replace(/'/g, '"');

// ------------------------------------------------------------------ pruebas ----

test('C38–C47 hay hojas e interfaz que revisar (el analizador encuentra reglas)', () => {
  assert.ok(ARCHIVOS_CSS.length >= 5, `pocas hojas: ${ARCHIVOS_CSS.map(rel)}`);
  assert.ok(INTERFAZ_HTML.length > 0 && INTERFAZ_JS.length > 0);
  assert.ok(REGLAS.length > 50, `el analizador CSS solo ha encontrado ${REGLAS.length} reglas`);
  const r = analizarCss('@media (max-width: 600px) { .a, .b { color: red; border-radius: 3px } }\n:root { --x: #fff; }\n.c{font-family:var(--pol-fuente)}', 'x.css');
  assert.deepStrictEqual(r.map(x => [x.selector, x.contexto, x.decls.map(d => d.prop)]),
    [['.a, .b', ['@media (max-width: 600px)'], ['color', 'border-radius']], [':root', [], ['--x']], ['.c', [], ['font-family']]]);
  assert.equal(r[1].decls[0].linea, 2);
});

test('C40 las copias de la hoja común que se sirven en otras rutas son idénticas a comun/css/identidad.css', () => {
  assert.ok(fs.existsSync(COMUN_ABS), `falta la hoja común ${HOJA_COMUN}`);
  const copias = [...listar('aula_pct23/static', n => n === 'identidad.css', true), ...listar('simulador_pct23/css', n => n === 'identidad.css', false)];
  fallos(copias.filter(a => !esCopiaDeLaComun(a)).map(rel), 'copias de identidad.css distintas de la común');
});

test('C38 sin colores literales en las hojas fuera de :root (y sin var(--x, #fallback))', () => {
  const malos = [];
  for (const d of DECLS) {
    const fallback = /var\(\s*--[\w-]+\s*,[^)]*(?:#|rgb|hsl)/i.test(d.valor);
    const permitido = d.prop.startsWith('--') && esRoot(d.regla.selector) && contextoDeVariables(d.regla.contexto);
    if (fallback || (!permitido && tieneColorLiteral(d.valor))) malos.push(donde(d));
  }
  fallos(malos, 'colores literales fuera de :root');
});

test('C39 el naranja #F68B11 solo aparece en la definición de --pol-naranja; la interfaz no escribe colores de marca', () => {
  const malos = [];
  for (const d of DECLS) {
    if (!RE_NARANJA.test(d.valor)) continue;
    if (d.prop === '--pol-naranja' && d.regla.archivo === HOJA_COMUN) continue;
    malos.push(donde(d));
  }
  const marca = [RE_NARANJA];
  if (fs.existsSync(path.join(RAIZ, HOJA_COMUN))) {                    // demás colores de identidad (hex) de la hoja común
    for (const v of T.VARIABLES_IDENTIDAD) {
      const val = valorEnComun(v);
      const m = val && val.match(/^#[0-9a-f]{3,8}$/i);
      if (m && v !== '--pol-naranja') marca.push(new RegExp(m[0] + '(?![0-9a-z])', 'i'));
    }
  }
  for (const a of [...INTERFAZ_JS, ...INTERFAZ_HTML]) {
    const t = esJs(a) ? sinComentariosJs(leer(a)) : borrar(leer(a), /<!--[\s\S]*?-->/g);
    t.split('\n').forEach((l, i) => { for (const re of marca) if (re.test(l)) malos.push(`${rel(a)}:${i + 1} ${l.trim().slice(0, 100)}`); });
  }
  const definiciones = DECLS.filter(d => d.prop === '--pol-naranja');
  if (!definiciones.some(d => d.regla.archivo === HOJA_COMUN && normal(d.valor) === normal(T.NARANJA_POLITECNICO))) malos.push(`${HOJA_COMUN}: falta --pol-naranja: ${T.NARANJA_POLITECNICO}`);
  for (const d of definiciones) if (d.regla.archivo !== HOJA_COMUN) malos.push(`--pol-naranja redefinida fuera de la hoja común: ${donde(d)}`);
  fallos(malos, 'naranja o colores de marca escritos a mano');
});

test('C40 la hoja común define en :root las variables de identidad y de estado con los valores fijos de la guía', () => {
  const naranja = valorEnComun('--pol-naranja');
  const malos = [];
  for (const v of [...T.VARIABLES_IDENTIDAD, ...T.VARIABLES_ESTADO]) if (valorEnComun(v) === undefined) malos.push(`${HOJA_COMUN}: falta ${v}`);
  const fijo = (v, esperado) => { const val = valorEnComun(v); if (val !== undefined && normal(val) !== normal(esperado)) malos.push(`${v} debe ser ${esperado} y es ${val}`); };
  fijo('--pol-naranja', T.NARANJA_POLITECNICO);
  fijo('--pol-sobre-naranja', T.TEXTO_SOBRE_NARANJA);
  fijo('--pol-radio-boton', `${T.RADIO_MAX_BOTON_PX}px`);
  const panel = valorEnComun('--pol-radio-panel');
  if (panel !== undefined && !(px(panel.trim()) !== null && px(panel.trim()) <= T.RADIO_MAX_PANEL_PX)) malos.push(`--pol-radio-panel debe ser ≤ ${T.RADIO_MAX_PANEL_PX}px y es ${panel}`);
  for (const v of T.VARIABLES_ESTADO) {
    const val = valorEnComun(v);
    if (val === undefined) continue;
    if (/var\(\s*--pol-/.test(val)) malos.push(`${v}: ${val} apunta a una variable de marca`);
    if (normal(resolver(val)) === normal(resolver(naranja || T.NARANJA_POLITECNICO))) malos.push(`${v}: ${val} es el naranja de marca`);
  }
  fallos(malos, 'variables de identidad y de estado');
});

test('C41 sin degradados (linear-, radial-, conic-gradient) en hojas ni en la interfaz', () => {
  const re = /\b(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(/i;
  const malos = DECLS.filter(d => re.test(d.valor)).map(donde);
  for (const a of [...INTERFAZ_JS, ...INTERFAZ_HTML]) {
    const t = esJs(a) ? sinComentariosJs(leer(a)) : borrar(leer(a), /<!--[\s\S]*?-->/g);
    t.split('\n').forEach((l, i) => { if (re.test(l)) malos.push(`${rel(a)}:${i + 1}`); });
  }
  fallos([...new Set(malos)], 'degradados');
});

function px(t) {
  const m = /^(-?[\d.]+)(px|rem|em)?$/i.exec(t);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2] && /r?em/i.test(m[2]) ? n * 16 : n;
}
function alfa(color) {
  let m = /^rgba?\(([^)]*)\)$|^hsla?\(([^)]*)\)$/i.exec(color);
  if (m) {
    const partes = (m[1] || m[2]).split(/[\s,/]+/).filter(Boolean);
    if (partes.length < 4) return 1;
    const a = partes[3];
    return a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a);
  }
  m = /^#([0-9a-f]{4}|[0-9a-f]{8})$/i.exec(color);
  if (m) { const h = m[1].length === 4 ? m[1][3].repeat(2) : m[1].slice(6); return parseInt(h, 16) / 255; }
  if (/^transparent$/i.test(color)) return 0;
  return 1;                                                     // #rgb, #rrggbb, nombre de color: opaco
}
const SOMBRA_MAX_DESENFOQUE_PX = 3, SOMBRA_MAX_OPACIDAD = 0.12;     // C42: el máximo de la guía (0 1px 3px rgba(0,0,0,.12))
/** Problemas de un valor de box-shadow (ya resuelto), o null si cumple: desenfoque ≤ 3px y opacidad ≤ 0,12. */
function problemaSombra(valor) {
  if (/^none$/i.test(valor.trim())) return null;
  for (const capa of trocear(valor, ',')) {
    const tokens = capa.trim().match(/(?:rgba?|hsla?)\([^)]*\)|var\([^)]*\)|\S+/gi) || [];
    const longitudes = [], otros = [];
    for (const t of tokens) { if (/^inset$/i.test(t)) continue; const n = px(t); if (n === null) otros.push(t); else longitudes.push(n); }
    if (otros.some(t => /^var\(/i.test(t))) return `no se puede resolver ${otros.join(' ')}`;
    if (longitudes.length < 2) return `capa no reconocida «${capa.trim()}»`;
    const desenfoque = longitudes[2] || 0;
    if (desenfoque > SOMBRA_MAX_DESENFOQUE_PX) return `desenfoque ${desenfoque}px > ${SOMBRA_MAX_DESENFOQUE_PX}px`;
    const color = otros[0] || 'currentColor';
    const a = /^currentcolor$/i.test(color) ? 1 : alfa(color);
    if (a > SOMBRA_MAX_OPACIDAD) return `opacidad ${a} > ${SOMBRA_MAX_OPACIDAD} (${color})`;
  }
  return null;
}

const sinEspacios = v => v.replace(/\s+/g, '');
/** La marca de alarma de la barra (SOMBRAS_PERMITIDAS de tipos.js), comparada sin espacios. */
const esSombraPermitida = v => T.SOMBRAS_PERMITIDAS.some(s => sinEspacios(s) === sinEspacios(v));

test('C42 sombras: none, var(--pol-sombra), desenfoque ≤ 3px y opacidad ≤ 0,12, o la marca de alarma; sin text-shadow', () => {
  const malos = [];
  for (const d of DECLS) {
    if (d.prop === 'text-shadow' && !/^none$/i.test(d.valor)) malos.push(`${donde(d)} → text-shadow`);
    if (d.prop !== 'box-shadow' || /^var\(\s*--pol-sombra\s*\)$/.test(d.valor.trim()) || esSombraPermitida(d.valor)) continue;
    const p = problemaSombra(resolver(d.valor));
    if (p) malos.push(`${donde(d)} → ${p}`);
  }
  assert.ok(esSombraPermitida('inset 0 -4px 0 var(--estado-alarma)') && esSombraPermitida('inset  0 -4px 0 var( --error )'));
  assert.ok(!esSombraPermitida('inset 0 -4px 0 var(--estado-aviso)'));
  assert.equal(problemaSombra('0 1px 3px rgba(0,0,0,.12)'), null);
  assert.ok(problemaSombra('0 1px 3px rgba(0,0,0,.15)'));
  assert.ok(problemaSombra('0 2px 12px rgba(0,0,0,.1)'));
  assert.ok(problemaSombra('0 1px 2px #000'));
  fallos(malos, 'sombras');
});

const RE_BOTON = /(^|[\s,>+~(])button\b|\.boton\b|\[role=["']?button["']?\]|input\[type=["']?(?:button|submit)["']?\]/i;
const RE_CIRCULAR = /led|indicador/i;

const escaparRe = s => s.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&');
/**
 * Excepciones de C43 (EXCEPCIONES_RADIO de tipos.js): la regla queda exenta si CADA parte de su selector (separada por comas) contiene uno
 * de `selectores` como componente; los de la barra del aula (#aula-barra…) solo cuentan en los `archivos` donde vive la barra.
 */
function exentaDeRadio(regla) {
  const { selectores, archivos } = T.EXCEPCIONES_RADIO;
  return trocear(regla.selector, ',').every(parte => selectores.some(sel => {
    if (sel.startsWith('#aula-barra') && !archivos.includes(regla.archivo)) return false;
    return new RegExp('(^|[\\s>+~(,])' + escaparRe(sel).replace(/\\ /g, '\\s+') + '(?![\\w-])').test(parte.trim());
  }));
}

test('C43 radios: botones var(--pol-radio-boton) o ≤ 2px; lo demás ≤ 4px (salvo EXCEPCIONES_RADIO: circulares, .etiqueta, barra del aula)', () => {
  const malos = [];
  for (const d of DECLS) {
    if (!/^border(-(top|bottom|start|end)-(left|right|start|end))?-radius$/.test(d.prop)) continue;
    const boton = RE_BOTON.test(d.regla.selector);
    const limite = boton ? T.RADIO_MAX_BOTON_PX : T.RADIO_MAX_PANEL_PX;
    if (exentaDeRadio(d.regla)) continue;
    if (boton && /^var\(\s*--pol-radio-boton\s*\)$/.test(d.valor.trim())) continue;
    for (const t of resolver(d.valor).split(/[\s/]+/).filter(Boolean)) {
      if (/^(0|inherit|initial|unset)$/i.test(t)) continue;
      if (T.EXCEPCIONES_RADIO.circulares.includes(t) && !boton && RE_CIRCULAR.test(d.regla.selector)) continue;
      const n = px(t);
      if (n === null || n > limite) { malos.push(`${donde(d)} → ${t} > ${limite}px${boton ? ' (botón)' : ''}`); break; }
    }
  }
  const barra = T.EXCEPCIONES_RADIO.archivos[0];
  assert.ok(exentaDeRadio({ selector: '.etiqueta.ok', archivo: 'x.css' }) && exentaDeRadio({ selector: '#aula-barra button:hover', archivo: barra }));
  assert.ok(!exentaDeRadio({ selector: '#aula-barra button', archivo: 'aula_pct23/static/aula.css' }), 'la barra solo es excepción en su archivo');
  assert.ok(!exentaDeRadio({ selector: '.etiquetas-panel', archivo: 'x.css' }) && !exentaDeRadio({ selector: '.etiqueta, .tarjeta', archivo: 'x.css' }));
  fallos(malos, 'radios de borde');
});

/** var(--pol-fuente), var(--pol-mono) o un alias (var(--fuente)…) cuya definición es una de ellas. */
const RE_FUENTE_POL = /^var\(--pol-(fuente|mono)\)$/;
function esFuenteComun(valor) {
  const v = valor.replace(/\s+/g, '');
  if (RE_FUENTE_POL.test(v)) return true;
  const m = /^var\((--[\w-]+)\)$/.exec(v);
  return !!(m && m[1] in VARIABLES && RE_FUENTE_POL.test(VARIABLES[m[1]].replace(/\s+/g, '')));
}

test('C44 tipografía: font-family solo var(--pol-fuente), var(--pol-mono) o un alias suyo; la hoja común las define', () => {
  const malos = [];
  for (const d of DECLS) {
    // Única excepción: la hoja común declara Raleway con @font-face (el nombre debe ser exactamente Raleway)
    const esFontFace = d.regla.selector.trim() === '@font-face' && d.regla.archivo === HOJA_COMUN && d.valor.trim() === 'Raleway';
    if (d.prop === 'font-family' && !esFontFace && !esFuenteComun(d.valor)) malos.push(donde(d));
    if (d.prop === 'font') {
      const resto = d.valor.replace(/var\(\s*--[\w-]+\s*\)/g, m => (esFuenteComun(m) ? '' : m));
      if (!/^(inherit|initial|unset)$/i.test(d.valor.trim()) && (/["',]/.test(resto) || /\b(serif|sans-serif|monospace|system-ui|cursive|fantasy)\s*$/i.test(resto)))
        malos.push(`${donde(d)} (font con familia propia)`);
    }
  }
  const fuente = valorEnComun('--pol-fuente');
  if (normal(fuente) !== normal(T.FUENTE)) malos.push(`${HOJA_COMUN}: --pol-fuente debe ser ${T.FUENTE} y es ${fuente}`);
  const mono = valorEnComun('--pol-mono');
  if (!mono || !/monospace\s*$/i.test(mono)) malos.push(`${HOJA_COMUN}: --pol-mono debe ser monoespaciada (terminar en monospace) y es ${mono}`);
  fallos(malos, 'tipografía');
});

const PERMITIDOS = new Set(T.SIMBOLOS_PERMITIDOS.map(s => s.codePointAt(0)));
function esEmoji(cp) {
  if (PERMITIDOS.has(cp)) return false;
  return (cp >= 0x1F300 && cp <= 0x1FAFF) || (cp >= 0x1F000 && cp <= 0x1F2FF) || cp === 0xFE0F || (cp >= 0x2600 && cp <= 0x27BF);
}

test('C45b botón naranja con texto var(--pol-sobre-naranja); nunca color: var(--pol-naranja)', () => {
  const malos = [];
  for (const r of REGLAS) {
    const de = p => r.decls.filter(d => d.prop === p).map(d => d.valor.replace(/\s+/g, ''));
    for (const d of r.decls) if (d.prop === 'color' && /var\(--pol-naranja\)/.test(d.valor.replace(/\s+/g, ''))) malos.push(`${donde({ ...d, regla: r })} → texto en naranja (usa --pol-naranja-texto)`);
    if (!RE_BOTON.test(r.selector)) continue;
    const fondoNaranja = [...de('background'), ...de('background-color')].some(v => v.includes('var(--pol-naranja)'));
    if (fondoNaranja && !de('color').includes('var(--pol-sobre-naranja)'))
      malos.push(`${r.archivo} ${r.selector}: fondo var(--pol-naranja) sin color: var(--pol-sobre-naranja)`);
  }
  fallos(malos, 'botones naranja');
});

test('C45 la interfaz no contiene emojis (SIMBOLOS_PERMITIDOS: ⚠ ✔ ✕ ✖ ✘)', () => {
  const malos = [];
  for (const a of [...INTERFAZ_JS, ...INTERFAZ_HTML]) {
    leer(a).split('\n').forEach((l, i) => {
      for (const ch of l) { const cp = ch.codePointAt(0); if (esEmoji(cp)) { malos.push(`${rel(a)}:${i + 1} U+${cp.toString(16).toUpperCase()} «${ch}»`); break; } }
    });
  }
  assert.ok(esEmoji(0x1F600) && esEmoji(0x2600) && esEmoji(0xFE0F) && esEmoji(0x2605) && esEmoji(0x266A), 'emojis, ★ y ♪ prohibidos');
  assert.ok([0x26A0, 0x2714, 0x2715, 0x2716, 0x2718, 0x2393].every(cp => !esEmoji(cp)), '⚠ ✔ ✕ ✖ ✘ y ⎓ admitidos');
  fallos(malos, 'emojis en la interfaz');
});

for (const s of SIMULADORES) {
  test(`C46 ${s.dir}/index.html: cabecera con el logo del centro y el nombre; pie con el copyright`, () => {
    const t = borrar(leer(path.join(RAIZ, s.dir, 'index.html')), /<!--[\s\S]*?-->/g);
    const cab = /<header\b[^>]*>([\s\S]*?)<\/header>/i.exec(t);
    assert.ok(cab, 'no hay <header>');
    const imgs = [...cab[1].matchAll(/<img\b[^>]*>/gi)].map(m => m[0]);
    const logo = imgs.find(i => /\bsrc\s*=\s*["'][^"']*logo-politecnico[^"']*["']/i.test(i));
    assert.ok(logo, 'la cabecera no tiene <img> con src que contenga «logo-politecnico»');
    assert.ok(/\balt\s*=\s*["'][^"']*\S[^"']*["']/i.test(logo), `el logo no tiene alt: ${logo}`);
    const encabezados = [...cab[1].matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map(m => m[2].replace(/<[^>]*>/g, '').trim());
    assert.ok(encabezados.some(h => s.nombre.test(h)), `la cabecera no tiene un encabezado con el nombre del simulador: ${JSON.stringify(encabezados)}`);
    const pie = /<footer\b[^>]*>([\s\S]*?)<\/footer>/i.exec(t);
    assert.ok(pie, 'no hay <footer>');
    assert.ok(pie[1].includes(T.COPYRIGHT), `el pie no contiene literalmente «${T.COPYRIGHT}»`);
  });

  test(`C47 (aproximación estática; la de navegador es de la fase 3) ${s.dir}/index.html: body en var(--pol-fuente) y medidas en var(--pol-mono)`, () => {
    const t = leer(path.join(RAIZ, s.dir, 'index.html'));
    const enlazadas = [...t.matchAll(/<link\b[^>]*href\s*=\s*["']([^"'?#]+\.css)[^"']*["'][^>]*>/gi)].map(m => m[1]);
    const idx = enlazadas.findIndex(h => /identidad\.css$/.test(h));
    assert.ok(idx >= 0, `${s.dir}/index.html no carga comun/css/identidad.css`);
    assert.equal(idx, 0, 'identidad.css debe cargarse antes que las hojas propias (§12.1)');
    // Rutas del navegador → disco: /simulador/… = simulador_pct23/… (hojas compartidas con la maqueta), /static/… = aula_pct23/static/…,
    // relativas = carpeta del simulador. Se analizan las hojas que de verdad carga la página, más sus <style>.
    const aDisco = h => (h.startsWith('/simulador/') ? path.join(RAIZ, 'simulador_pct23', h.slice('/simulador/'.length))
      : h.startsWith('/static/') ? path.join(RAIZ, 'aula_pct23/static', h.slice('/static/'.length))
        : h.startsWith('/') ? path.join(RAIZ, h.slice(1)) : path.resolve(RAIZ, s.dir, h));
    const reglas = [];
    for (const h of enlazadas) {
      const a = aDisco(h);
      assert.ok(fs.existsSync(a), `${s.dir}/index.html enlaza ${h} y no existe en ${rel(a)}`);
      reglas.push(...analizarCss(sinComentariosCss(leer(a)), rel(a)));
    }
    for (const m of t.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) reglas.push(...analizarCss(sinComentariosCss(m[1]), `${s.dir}/index.html`));
    // Variables: manda la definición de la hoja común (sus alias llevan más especificidad: :root[data-tema]); si no, la última cargada.
    const defs = {};
    for (const r of reglas) for (const d of r.decls) if (d.prop.startsWith('--')) defs[d.prop] = d.valor;
    for (const r of reglas.filter(x => /identidad\.css$/.test(x.archivo))) for (const d of r.decls) if (d.prop.startsWith('--')) defs[d.prop] = d.valor;
    /** ¿El valor llega a var(objetivo) siguiendo los alias var(--x)? */
    const llegaA = (v, objetivo, n = 0) => {
      if (new RegExp(`var\\(\\s*${objetivo}\\s*\\)`).test(v)) return true;
      if (n > 6) return false;
      return [...v.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)].some(m => m[1] in defs && llegaA(defs[m[1]], objetivo, n + 1));
    };
    const fuentes = re => reglas.filter(r => trocear(r.selector, ',').some(x => re.test(x.trim())))
      .flatMap(r => r.decls.filter(d => /^font(-family)?$/.test(d.prop)).map(d => d.valor));
    assert.ok(fuentes(/^(html|body)$/).some(v => llegaA(v, '--pol-fuente')), 'ninguna hoja cargada pone body/html en var(--pol-fuente) (ni por alias)');
    for (const [re, nombre] of [[/\.medida\b/, '.medida'], [/\[data-medida\]/, '[data-medida]']])
      assert.ok(fuentes(re).some(v => llegaA(v, '--pol-mono')), `ninguna regla da a ${nombre} la fuente var(--pol-mono)`);
  });
}
