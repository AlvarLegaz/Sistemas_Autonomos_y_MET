'use strict';
// Reglas estáticas del contrato (comun/CONTRATO.md §10): S1 (sin fuentes de azar ni de reloj en el modelo) y S2 (las fábricas se cargan en Node).
// S3 (las pruebas existentes siguen pasando) no se automatiza aquí: se ejecutan sus propias suites.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const RAIZ = path.resolve(__dirname, '..', '..');

/** Quita comentarios // y /* *\/ respetando cadenas '…', "…" y `…` (suficiente para buscar llamadas; no entiende expresiones regulares). */
function sinComentarios(src) {
  let r = '', i = 0, cadena = null;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (cadena) {
      r += c;
      if (c === '\\') { r += d || ''; i += 2; continue; }
      if (c === cadena) cadena = null;
      i++;
    } else if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && d === '*') {
      const fin = src.indexOf('*/', i + 2);
      const trozo = src.slice(i, fin < 0 ? src.length : fin + 2);
      r += trozo.replace(/[^\n]/g, ' ');                       // conserva los saltos de línea para dar el número de línea
      i += trozo.length;
    } else {
      if (c === '\'' || c === '"' || c === '`') cadena = c;
      r += c; i++;
    }
  }
  return r;
}

function archivosJs(dir) {
  if (!fs.existsSync(dir)) return [];
  const r = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) r.push(...archivosJs(p));
    else if (e.name.endsWith('.js')) r.push(p);
  }
  return r;
}

const CARPETAS_S1 = ['simulador_fotovoltaica/js/modelo', 'simulador_fotovoltaica/js/averias', 'simulador_planta_real/js/modelo',
  'simulador_planta_real/js/averias', 'simulador_planta_real/js/plc', 'comun/js/nucleo'];
const PROHIBIDOS = [[/\bMath\s*\.\s*random\b/, 'Math.random'], [/\bDate\s*\.\s*now\b/, 'Date.now'], [/\bperformance\s*\.\s*now\b/, 'performance.now'],
  [/\bnew\s+Date\s*\(/, 'new Date('], [/\bcrypto\s*\./, 'crypto.']];

test('S1 sin Math.random, Date.now, performance.now, new Date( ni crypto. en modelo, averías, PLC y núcleo', () => {
  const faltan = CARPETAS_S1.filter(c => c !== 'comun/js/nucleo' && !fs.existsSync(path.join(RAIZ, c)));   // el núcleo aún puede no existir
  assert.deepStrictEqual(faltan, [], 'carpetas del modelo que no existen (¿se han movido?)');
  const archivos = CARPETAS_S1.flatMap(c => archivosJs(path.join(RAIZ, c)));
  assert.ok(archivos.length > 0, 'no se ha encontrado ningún archivo que revisar');
  const hallazgos = [];
  for (const a of archivos) {
    const lineas = sinComentarios(fs.readFileSync(a, 'utf8')).split('\n');
    lineas.forEach((l, i) => {
      for (const [re, nombre] of PROHIBIDOS) if (re.test(l)) hallazgos.push(`${path.relative(RAIZ, a).replace(/\\/g, '/')}:${i + 1} ${nombre}`);
    });
  }
  assert.deepStrictEqual(hallazgos, [], 'fuentes de azar o de reloj en el modelo (CONTRATO.md §3.1)');
});

test('S1 el filtro de comentarios no esconde código ni lo inventa', () => {
  const src = "const a = 1; // Math.random()\n/* Date.now() */ const b = '// no es comentario'; const c = Math.random();\nconst d = `${x}`;";
  const limpio = sinComentarios(src);
  assert.ok(!/Date\.now/.test(limpio));
  assert.equal(limpio.match(/Math\.random/g).length, 1, 'el Math.random del código debe quedar');
  assert.ok(limpio.includes("'// no es comentario'"));
  assert.equal(limpio.split('\n').length, src.split('\n').length);
});

for (const [id, ruta] of [['fotovoltaica', 'simulador_fotovoltaica/js/modelo/contrato_fv.js'], ['planta_real', 'simulador_planta_real/js/modelo/contrato_htst.js']]) {
  test(`S2 ${ruta} se carga con require en Node sin window y exporta { id: '${id}', crearSimulacion }`, () => {
    const abs = path.join(RAIZ, ruta);
    assert.ok(fs.existsSync(abs), `falta la fábrica ${ruta} (la escribe el programador)`);
    assert.equal(typeof globalThis.window, 'undefined', 'la prueba debe correr sin window');
    const mod = require(abs);
    assert.equal(typeof globalThis.window, 'undefined', `${ruta} ha creado window`);
    assert.equal(mod.id, id);
    assert.equal(typeof mod.crearSimulacion, 'function');
  });
}
