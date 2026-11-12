// Esquema de cableado: tags reales, bornas y rutas coherentes, secciones y caídas de tensión razonables, colores por tipo de conductor, sin solapes y estado en vivo.
const test = require('node:test');
const assert = require('node:assert/strict');
const layout = require('../js/layout.js');
const C = require('../js/scada2d/diagrama_cableado.js');
const U = require('../js/scada2d/diagrama_unifilar.js');
const H = require('./diagramas_comun.js');

const TODOS = C.CABLES.concat([C.CABLE_TIERRA]);

test('cada tag dibujado en el cableado existe en layout.js y están los equipos de las cajas, los inversores, la batería y el cuadro', () => {
  const tags = C.tagsDelEsquema();
  for (const t of tags) assert.ok(layout.EQUIPOS.some(e => e.tag === t), `${t} no está en layout.js`);
  for (const t of ['CB-101', 'INV-101', 'INV-201', 'BAT-101', 'QB-101', 'FB-101', 'QS-201', 'SPD-201', 'QA-301', 'QF-301', 'ID-301', 'SPD-301', 'TC-301', 'RED-301', 'COM-101', 'STR-101', 'STR-102', 'STR-201', 'STR-202']) assert.ok(tags.has(t), t);
});
test('ids únicos y grupos accesibles', () => {
  const vistos = new Set();
  (function r(n) {
    if (!Array.isArray(n)) return;
    const a = n[1] && typeof n[1] === 'object' && !Array.isArray(n[1]) ? n[1] : null;
    n.slice(a ? 2 : 1).forEach(x => assert.ok(typeof x === 'string' || Array.isArray(x)));
    if (a && a.id) { assert.ok(!vistos.has(a.id), `id repetido ${a.id}`); vistos.add(a.id); }
    if (a && a['data-tag']) { assert.equal(n[0], 'g'); assert.equal(a.tabindex, 0); assert.equal(a.role, 'button'); }
    n.forEach(r);
  })(C.ESQUEMA);
});
test('cada elemento del modelo tiene su id en el dibujo y cada elemento con estado del dibujo lo calcula el modelo', () => {
  const ids = U.comun.idsDe(C.ESQUEMA), claves = new Set();
  for (const e of H.escenarios().concat([null])) Object.keys(C.calcularCableado(e)).forEach(k => claves.add(k));
  for (const k of claves) assert.ok(ids.has(k), `el modelo da «${k}» y el dibujo no lo tiene`);
  const vivos = new Set(); U.comun.recorrer(C.ESQUEMA, a => { if (a['data-e'] && a.id) vivos.add(a.id); });
  for (const id of vivos) assert.ok(claves.has(id), `el dibujo tiene «${id}» con estado y el modelo no lo calcula`);
});
test('ningún texto se solapa y todo cabe en el viewBox', () => {
  const { choques, todo } = H.solapes(C.ESQUEMA, C.calcularCableado, H.escenarios());
  assert.deepEqual(choques, []);
  const [, , W, Hh] = C.VIEWBOX.split(' ').map(Number);
  assert.deepEqual(todo.filter(c => c.x0 < 0 || c.y0 < 0 || c.x1 > W || c.y1 > Hh).map(c => c.texto), []);
});

/* ---------- bornas y rutas ---------- */
test('cada hilo de cada cable sale y llega a una borna dibujada y va en línea recta (ortogonal)', () => {
  for (const c of TODOS) {
    assert.ok(C.RUTAS[c.id], c.id);
    assert.equal(C.RUTAS[c.id].length, C.hilosDe(c).length, `${c.id}: un hilo por conductor`);
    for (const ruta of C.RUTAS[c.id]) {
      const pts = ruta.map(p => { assert.ok(C.BORNAS[p], `${c.id}: no existe la borna ${p}`); return C.BORNAS[p]; });
      for (let i = 1; i < pts.length; i++) assert.ok(pts[i][0] === pts[i - 1][0] || pts[i][1] === pts[i - 1][1], `${c.id}: tramo ${ruta[i - 1]} → ${ruta[i]} no es ortogonal`);
    }
  }
});
test('los hilos de un mismo cable no se tocan (separación mayor que el grosor)', () => {
  for (const c of TODOS) {
    const pts = C.RUTAS[c.id].map(r => C.BORNAS[r[0]]), w = C.grosor(c.seccionMm2);
    for (let i = 1; i < pts.length; i++) assert.ok(Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]) > w, `${c.id}: hilos demasiado juntos`);
  }
});

/* ---------- secciones y caídas de tensión ---------- */
test('las secciones son normalizadas y estás en los rangos típicos (4 a 6 mm² en cadenas, 25 a 35 mm² a la batería, 2,5 a 6 mm² en alterna)', () => {
  for (const c of TODOS) assert.ok(C.I_ADMISIBLE[c.seccionMm2], `${c.id}: sección ${c.seccionMm2} no normalizada`);
  for (const id of ['C-A1', 'C-A2', 'C-B1', 'C-B2', 'C-B3', 'C-B4']) { const c = TODOS.find(x => x.id === id); assert.ok(c.seccionMm2 >= 4 && c.seccionMm2 <= 6, id); }
  for (const id of ['C-A4', 'C-A5']) { const c = TODOS.find(x => x.id === id); assert.ok(c.seccionMm2 >= 25 && c.seccionMm2 <= 35, id); }
  for (const c of TODOS.filter(x => x.tipo === 'ca')) assert.ok(c.seccionMm2 >= 2.5 && c.seccionMm2 <= 6, c.id);
});
test('cada cable aguanta su corriente de diseño y su caída de tensión nominal está dentro del límite', () => {
  for (const c of C.CABLES) {
    assert.ok(c.iDisenoA <= C.I_ADMISIBLE[c.seccionMm2], `${c.id}: ${c.iDisenoA} A > admisible ${C.I_ADMISIBLE[c.seccionMm2]} A de ${c.seccionMm2} mm²`);
    const k = C.caida(c, c.iNominalA || c.iDisenoA);
    assert.ok(k.pct <= c.limitePct, `${c.id}: caída ${k.pct.toFixed(2)} % > ${c.limitePct} %`);
    assert.ok(c.longitudM > 0 && c.longitudM < 60, c.id);
  }
});
test('la caída de tensión sigue ΔV = 2·ρ·L·I / S y la tensión de referencia es la de cada circuito', () => {
  const c = C.CABLES.find(x => x.id === 'C-A1'), k = C.caida(c, 8);
  assert.ok(Math.abs(k.dv - 2 * C.RHO_CU * c.longitudM * 8 / c.seccionMm2) < 1e-9);
  assert.ok(Math.abs(k.pct - k.dv / c.vRefV * 100) < 1e-9);
  assert.ok(Math.abs(C.CABLES.find(x => x.id === 'C-A1').vRefV - 3 * layout.PANEL_A.vmp) < 1e-9);
  assert.ok(Math.abs(C.CABLES.find(x => x.id === 'C-B1').vRefV - 4 * layout.PANEL_B.vmp) < 1e-9);
  assert.ok(Math.abs(C.CABLES.find(x => x.id === 'C-C1').vRefV - 230) < 1e-9);
  assert.equal(C.caida(C.CABLE_TIERRA, 10).dv, 0);
  // doble de corriente, doble de caída; doble de sección, mitad
  assert.ok(Math.abs(C.caida(c, 16).dv - 2 * C.caida(c, 8).dv) < 1e-9);
  assert.ok(Math.abs(C.caida({ ...c, seccionMm2: 8 }, 8).dv - C.caida(c, 8).dv / 2) < 1e-9);
});
test('los conductores llevan sus colores reales: rojo/negro en continua; marrón, azul y amarillo-verde en alterna', () => {
  for (const c of TODOS) {
    const colores = C.hilosDe(c).map(h => C.COLOR_HILO[h]);
    if (c.tipo === 'cc') assert.deepEqual(colores, ['rojo', 'negro'], c.id);
    else if (c.tipo === 'ca') assert.deepEqual(colores, ['marrón', 'azul', 'amarillo-verde'], c.id);
    else assert.deepEqual(colores, ['amarillo-verde'], c.id);
  }
  // el dibujo usa esas clases de color
  const clases = []; U.comun.recorrer(C.ESQUEMA, a => { if (a.class && /dg-col-/.test(a.class)) clases.push(a.class); });
  for (const k of ['rojo', 'negro', 'marron', 'azul', 'amarillo', 'verde']) assert.ok(clases.some(x => x.includes(`dg-col-${k}`)), k);
});
test('el grosor del conductor crece con la sección', () => {
  assert.ok(C.grosor(35) > C.grosor(6) && C.grosor(6) > C.grosor(2.5));
});
test('filasTabla da una fila por cable con la corriente y la caída en vivo', () => {
  const filas = C.filasTabla(H.base());
  assert.equal(filas.length, C.CABLES.length + 1);
  const a1 = filas.find(f => f.id === 'C-A1'); assert.ok(a1.corrienteA > 5 && a1.dvV > 0.3 && a1.pct > 0.3 && a1.pct < 3);
  assert.ok(filas.every(f => !f.alto), 'ningún cable pasa su límite con la corriente nominal');
  assert.equal(C.filasTabla(null).find(f => f.id === 'C-A1').corrienteA, 0);
});

/* ---------- estado en vivo ---------- */
test('con sol los hilos tienen tensión y el rótulo da la caída de tensión; de noche los hilos de las cadenas pasan a sin tensión', () => {
  const m = C.calcularCableado(H.base());
  assert.equal(m['k-C-A1-1'].e, 'vivo'); assert.equal(m['k-C-A3-2'].e, 'vivo'); assert.equal(m['k-C-A6-3'].e, 'vivo');
  assert.match(m['k-C-A1-t'].t, /^ΔV \d+,\d\d V · \d+,\d %$/);
  const n = C.calcularCableado(H.noche()); assert.equal(n['k-C-A1-1'].e, 'muerto'); assert.equal(n['k-C-B1-2'].e, 'muerto'); assert.equal(n['k-C-C1-1'].e, 'vivo');
});
test('un fusible fundido o una cadena abierta se ve en los hilos del cable afectado; el seccionador abierto corta el cable de la caja al inversor', () => {
  assert.equal(C.calcularCableado(H.cadenaAbierta('STR-101'))['k-C-A1-1'].e, 'vivo');
  const m = C.calcularCableado(H.conProt('QS-101', 'ABIERTO')); assert.equal(m['k-C-A3-1'].e, 'muerto'); assert.equal(m['k-QS-101'], undefined);
  assert.equal(C.calcularCableado(H.conProt('QB-101', 'DISPARADO'))['k-QB-101'].e, 'disparado');
  assert.equal(C.calcularCableado(H.conProt('ID-301', 'DISPARADO'))['k-C-A6-1'].e, 'muerto');
});
test('la caída de tensión sube con la corriente y se pone ámbar si pasa el límite', () => {
  const e = H.base(); e.campos.A.cadenas[0].i = 8; const bajo = C.calcularCableado(e)['k-C-A1-t'];
  e.campos.A.cadenas[0].i = 30; const alto = C.calcularCableado(e)['k-C-A1-t'];
  assert.notEqual(bajo.t, alto.t); assert.equal(bajo.e, 'ok'); assert.equal(alto.e, 'degradada');
});
test('sin estado no se rompe y queda «sin datos»', () => {
  for (const e of [null, undefined, {}]) assert.doesNotThrow(() => { C.calcularCableado(e); C.ariaCableado(e); C.filasTabla(e); });
  assert.equal(C.calcularCableado(null)['k-C-A1-t'].t, '—'); assert.equal(C.calcularCableado(null)['k-C-A1-1'].e, 'sd');
});
test('crearObjetos sobre un lienzo falso escribe el estado de los hilos y los rótulos', () => {
  const lienzo = H.lienzoFalso(C.ESQUEMA), objetos = C.crearObjetos(lienzo);
  objetos[0].actualizar(H.base());
  assert.equal(lienzo.buscar('k-C-A1-1').getAttribute('data-e'), 'vivo'); assert.match(lienzo.buscar('k-C-A1-t').textContent, /ΔV/);
  assert.ok(lienzo.grupos.every(g => g.getAttribute('aria-label')));
});
