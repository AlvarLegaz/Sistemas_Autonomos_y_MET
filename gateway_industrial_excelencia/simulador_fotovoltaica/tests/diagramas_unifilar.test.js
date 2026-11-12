// Esquema unifilar (continua y alterna): tags reales, todos los equipos eléctricos dibujados, sin solapes, estado en vivo de cada protección y objetos sobre un lienzo falso.
const test = require('node:test');
const assert = require('node:assert/strict');
const layout = require('../js/layout.js');
const U = require('../js/scada2d/diagrama_unifilar.js');
const H = require('./diagramas_comun.js');

const NO_ELECTRICOS = new Set(['CAS-001', 'BAN-001']);          // la caseta y la bandeja no son aparatos eléctricos del unifilar
const PROTECCIONES = layout.EQUIPOS.filter(e => ['seccionador_cc', 'magnetotermico_cc', 'magnetotermico', 'diferencial', 'fusible', 'descargador'].includes(e.tipo)).map(e => e.tag);
// qué id del modelo refleja el estado de cada protección
const ID_PROT = { 'F-101': 'c-f101', 'F-102': 'c-f102', 'QS-101': 'c-qs101-a', 'SPD-101': 'c-spd101', 'QB-101': 'c-qb101-a', 'FB-101': 'c-fb101', 'QS-201': 'c-qs201-1', 'SPD-201': 'c-spd201',
  'QF-301': 'a-qf301', 'ID-301': 'a-id301', 'QF-302': 'a-qf302', 'QF-303': 'a-qf303', 'SPD-301': 'a-spd301' };

test('hay dos hojas, continua y alterna, con viewBox y raíz svg', () => {
  assert.equal(U.HOJAS.length, 2);
  for (const h of U.HOJAS) { assert.equal(h.esquema[0], 'svg'); assert.match(h.viewBox, /^0 0 \d+ \d+$/); assert.equal(h.esquema[1].viewBox, h.viewBox); }
});
test('cada tag dibujado existe en layout.js', () => {
  const tags = [...U.tagsDelEsquema()];
  assert.ok(tags.length >= 40);
  for (const t of tags) assert.ok(layout.EQUIPOS.some(e => e.tag === t), `${t} no está en layout.js`);
});
test('todos los equipos eléctricos de layout.js aparecen en el unifilar', () => {
  const tags = U.tagsDelEsquema();
  for (const e of layout.EQUIPOS) if (!NO_ELECTRICOS.has(e.tag)) assert.ok(tags.has(e.tag), `${e.tag} (${e.nombre}) no está dibujado`);
});
test('los paneles están en la hoja de continua y los equipos de alterna en la de alterna', () => {
  const cc = U.comun.tagsDe(U.ESQUEMA_CC), ca = U.comun.tagsDe(U.ESQUEMA_CA);
  for (const t of ['PV-101', 'PV-208', 'STR-101', 'STR-202', 'CB-101', 'F-101', 'F-102', 'QS-101', 'QS-201', 'SPD-101', 'SPD-201', 'QB-101', 'FB-101', 'BAT-101', 'COM-101']) assert.ok(cc.has(t), t);
  for (const t of ['RED-301', 'QF-301', 'ID-301', 'QF-302', 'QF-303', 'SPD-301', 'MED-201', 'TC-301', 'LOAD-301', 'LOAD-302', 'QA-301']) assert.ok(ca.has(t), t);
});
test('ids únicos por hoja y cada equipo es un grupo accesible', () => {
  for (const h of U.HOJAS) {
    const vistos = new Set();
    (function r(n) {
      if (!Array.isArray(n)) return;
      const a = n[1] && typeof n[1] === 'object' && !Array.isArray(n[1]) ? n[1] : null;
      n.slice(a ? 2 : 1).forEach(x => assert.ok(typeof x === 'string' || Array.isArray(x), `hijo inválido en <${n[0]}>`));
      if (a && a.id) { assert.ok(!vistos.has(a.id), `id repetido ${a.id} en ${h.id}`); vistos.add(a.id); }
      if (a && a['data-tag']) { assert.equal(n[0], 'g'); assert.equal(a.tabindex, 0); assert.equal(a.role, 'button'); assert.ok(a['aria-label']); }
      n.forEach(r);
    })(h.esquema);
  }
});
test('cada elemento del modelo tiene su id en el dibujo y cada elemento con estado del dibujo lo calcula el modelo', () => {
  const ids = new Set(); for (const h of U.HOJAS) U.comun.idsDe(h.esquema).forEach(i => ids.add(i));
  const claves = new Set(); for (const e of H.escenarios().concat([null])) Object.keys(U.calcularUnifilar(e)).forEach(k => claves.add(k));
  for (const k of claves) assert.ok(ids.has(k), `el modelo da «${k}» y el dibujo no lo tiene`);
  const vivos = new Set();
  for (const h of U.HOJAS) U.comun.recorrer(h.esquema, a => { if (a['data-e'] && a.id) vivos.add(a.id); });
  for (const id of vivos) assert.ok(claves.has(id), `el dibujo tiene «${id}» con estado y el modelo no lo calcula`);
});

for (const h of U.HOJAS) {
  test(`${h.id}: ningún texto se solapa con otro ni con un símbolo (con los textos más largos posibles)`, () => {
    const { choques, todo } = H.solapes(h.esquema, U.calcularUnifilar, H.escenarios());
    assert.ok(todo.filter(c => c.tipo === 'texto').length > 30 && todo.filter(c => c.tipo === 'simbolo').length > 10);
    assert.deepEqual(choques, []);
  });
  test(`${h.id}: todo cabe en el viewBox`, () => {
    const [, , W, Hh] = h.viewBox.split(' ').map(Number), fuera = [];
    for (const c of H.cajas(h.esquema, U.calcularUnifilar, H.escenarios())) if (c.x0 < 0 || c.y0 < 0 || c.x1 > W || c.y1 > Hh) fuera.push(`${c.tipo} ${c.texto}`);
    assert.deepEqual(fuera, []);
  });
}

/* ---------- estado en vivo ---------- */
test('cada protección cambia su dibujo con su estado (cerrado, abierto, disparado, fundido, agotado)', () => {
  for (const tag of PROTECCIONES) {
    const id = ID_PROT[tag], sano = ['fusible', 'descargador'].includes(layout.EQUIPOS.find(e => e.tag === tag).tipo);
    assert.ok(id, `falta el id de ${tag} en la prueba`);
    const visto = new Set();
    for (const s of ['CERRADO', 'ABIERTO', 'DISPARADO', 'FUNDIDO', 'AGOTADO']) {
      const m = U.calcularUnifilar(H.conProt(tag, s));
      assert.equal(m[id].e, s === 'CERRADO' && sano ? 'ok' : s.toLowerCase(), `${tag} ${s}`);
      visto.add(m[id].e);
    }
    assert.equal(visto.size, 5, `${tag} no distingue los cinco estados`);
  }
});
test('el texto de cada protección repite el estado (no solo el color)', () => {
  const m = U.calcularUnifilar(H.conProt('QS-101', 'ABIERTO')); assert.equal(m['c-qs101-t'].t, 'ABIERTO');
  assert.equal(U.calcularUnifilar(H.conProt('F-101', 'FUNDIDO'))['c-f101-t'].t, 'FUNDIDO');
  assert.equal(U.calcularUnifilar(H.conProt('SPD-101', 'AGOTADO'))['c-spd101-t'].t, 'AGOTADO');
  assert.equal(U.calcularUnifilar(H.conProt('ID-301', 'DISPARADO'))['a-id301-t'].t, 'DISPARADO');
  assert.equal(U.calcularUnifilar(H.base())['a-qf301-t'].t, 'CERRADO');
});
test('con sol y todo cerrado los conductores de continua y de alterna tienen tensión y la batería está conectada', () => {
  const m = U.calcularUnifilar(H.base());
  for (const id of ['c-s101-w', 'c-a-p1a', 'c-a-p1b', 'c-a-pq', 'c-a-nq', 'c-a-spd-p', 'c-b-p1b', 'c-b-n2b', 'c-a-bp1', 'c-a-bn1', 'c-a-bp3', 'a-w1', 'a-w3', 'a-bus', 'a-i1in', 'a-i1o2', 'a-i2in']) assert.equal(m[id].e, 'vivo', id);
  assert.equal(m['c-pv-PV-101'].e, 'on'); assert.equal(m['c-inv1'].e, 'on'); assert.match(m['a-bus-t'].t, /CON TENSIÓN/); assert.match(m['c-s101-t'].t, /^STR-101 · \d+,\d V · \d+,\d A · \d+ W$/);
});
test('de noche los paneles y los conductores de las cadenas no tienen tensión', () => {
  const m = U.calcularUnifilar(H.noche());
  for (const id of ['c-s101-w', 'c-a-pq', 'c-b-p1b', 'c-b-n1a']) assert.equal(m[id].e, 'muerto', id);
  assert.equal(m['c-pv-PV-101'].e, 'off'); assert.equal(m['a-bus'].e, 'vivo');   // la red sigue
  assert.equal(m['c-a-bp3'].e, 'vivo');                                            // la batería sigue con tensión
});
test('un fusible fundido deja sin tensión lo que cuelga de él y la otra cadena sigue', () => {
  const m = U.calcularUnifilar(H.conProt('F-101', 'FUNDIDO'));
  assert.equal(m['c-a-p1a'].e, 'vivo'); assert.equal(m['c-a-p1b'].e, 'muerto'); assert.equal(m['c-a-p2b'].e, 'vivo'); assert.equal(m['c-a-pq'].e, 'vivo'); assert.equal(m['c-f101'].e, 'fundido');
});
test('un seccionador abierto corta el campo: lado de paneles con tensión y lado del inversor sin ella', () => {
  const m = U.calcularUnifilar(H.conProt('QS-101', 'ABIERTO'));
  assert.equal(m['c-a-pbus'].e, 'vivo'); assert.equal(m['c-a-pq'].e, 'muerto'); assert.equal(m['c-a-nq'].e, 'muerto');
  const n = U.calcularUnifilar(H.conProt('QS-201', 'ABIERTO')); assert.equal(n['c-b-p1a'].e, 'vivo'); assert.equal(n['c-b-p1b'].e, 'muerto'); assert.equal(n['c-b-n2b'].e, 'muerto');
});
test('QB-101 disparado y portafusible fundido dejan el inversor sin batería y la batería con tensión', () => {
  const m = U.calcularUnifilar(H.conProt('QB-101', 'DISPARADO')); assert.equal(m['c-a-bp1'].e, 'muerto'); assert.equal(m['c-a-bp3'].e, 'vivo'); assert.equal(m['c-a-bn1'].e, 'muerto');
  const n = U.calcularUnifilar(H.conProt('FB-101', 'FUNDIDO')); assert.equal(n['c-a-bp2'].e, 'muerto'); assert.equal(n['c-a-bp1'].e, 'muerto'); assert.equal(n['c-a-bp3'].e, 'vivo');
});
test('el diferencial o el general disparados dejan la barra de alterna sin tensión; QF-303 abierto aísla solo al ZCS', () => {
  for (const t of ['ID-301', 'QF-301']) { const m = U.calcularUnifilar(H.conProt(t, 'DISPARADO')); assert.equal(m['a-bus'].e, 'muerto'); assert.match(m['a-bus-t'].t, /SIN TENSIÓN/); assert.equal(m['a-w1'].e, 'vivo'); }
  const m = U.calcularUnifilar(H.conProt('QF-303', 'ABIERTO')); assert.equal(m['a-bus'].e, 'vivo'); assert.equal(m['a-i2in'].e, 'muerto'); assert.equal(m['a-i1in'].e, 'vivo');
});
test('sin red: la barra, los conductores de red y el medidor pasan a sin tensión y la red se ve en fallo', () => {
  const m = U.calcularUnifilar(H.redCaida()); assert.equal(m['a-bus'].e, 'muerto'); assert.equal(m['a-red'].e, 'fallo'); assert.equal(m['a-red-e'].t, 'SIN TENSIÓN'); assert.equal(m['a-med'].e, 'off');
});
test('una cadena abierta deja sin tensión los conductores hacia la caja pero los paneles conservan la tensión', () => {
  const m = U.calcularUnifilar(H.cadenaAbierta('STR-101'));
  assert.equal(m['c-s101-w'].e, 'vivo'); assert.equal(m['c-a-p1a'].e, 'muerto'); assert.equal(m['c-s101-t'].e, 'disparado'); assert.match(m['c-s101-t'].t, /ABIERTA/); assert.equal(m['c-a-pq'].e, 'vivo');
});
test('un panel con sombra o diodo de paso activo sale degradado', () => {
  const e = H.base(); e.campos.A.cadenas[1].paneles[0].bypass = [true, false, false]; e.campos.B.cadenas[0].paneles[2].sombra01 = 0.8;
  const m = U.calcularUnifilar(e); assert.equal(m['c-pv-PV-104'].e, 'degradada'); assert.equal(m['c-pv-PV-203'].e, 'degradada'); assert.equal(m['c-pv-PV-101'].e, 'on');
});
test('el inversor refleja su estado y el BMS en corte pone la batería en fallo', () => {
  const e = H.base(); e.inversores['INV-101'].estado = 'FALLO'; e.inversores['INV-201'].estado = 'REDUCIDO'; e.bateria.bms = 'CORTE_BAJA';
  const m = U.calcularUnifilar(e); assert.equal(m['c-inv1'].e, 'fallo'); assert.match(m['c-i1-t'].t, /FALLO/); assert.equal(m['c-inv2'].e, 'degradada'); assert.equal(m['c-bat'].e, 'fallo'); assert.match(m['c-bat-bms'].t, /CORTE BAJA/);
});
test('la pérdida de comunicación se ve en COM-101', () => {
  const e = H.base(); e.averiasActivas = ['COMUNICACION_PERDIDA_EASUN']; assert.equal(U.calcularUnifilar(e)['c-com'].e, 'fallo'); assert.equal(U.calcularUnifilar(H.base())['c-com'].e, 'ok');
});
test('sin estado (null o incompleto) no se rompe y todo queda «sin datos»', () => {
  for (const e of [null, undefined, {}, { protecciones: {} }, { campos: {} }]) assert.doesNotThrow(() => { U.calcularUnifilar(e); U.ariaUnifilar(e); });
  const m = U.calcularUnifilar(null); assert.equal(m['c-qs101-a'].e, 'sd'); assert.equal(m['a-bus'].e, 'sd'); assert.equal(m['c-i1-t'].t, '—'); assert.equal(m['c-s101-t'].t, '—');
});
test('ariaUnifilar da una etiqueta a cada equipo dibujado', () => {
  const aria = U.ariaUnifilar(H.base());
  for (const t of U.tagsDelEsquema()) assert.ok(aria[t], `sin etiqueta para ${t}`);
  assert.match(aria['QS-101'], /cerrado/); assert.match(U.ariaUnifilar(H.conProt('QS-101', 'ABIERTO'))['QS-101'], /abierto/);
});

/* ---------- objetos sobre un lienzo falso ---------- */
for (const h of U.HOJAS) {
  test(`${h.id}: crearObjetos escribe data-e y texto en los nodos, solo si cambian, y pone aria-label a los equipos`, () => {
    const lienzo = H.lienzoFalso(h.esquema), objetos = U.crearObjetos(lienzo);
    assert.equal(objetos.length, 1);
    objetos[0].actualizar(H.base());
    const m = U.calcularUnifilar(H.base());
    let escritos = 0;
    for (const [id, v] of Object.entries(m)) { const n = lienzo.buscar(id); if (!n) continue; assert.equal(n.getAttribute('data-e'), v.e, id); if (v.t !== undefined) assert.equal(n.textContent, v.t, id); escritos++; }
    assert.ok(escritos > 20);
    assert.ok(lienzo.grupos.every(g => g.getAttribute('aria-label') && g.getAttribute('aria-label') !== 'sd'));
    objetos[0].actualizar(H.conProt('F-101', 'FUNDIDO'));
    if (h.id === 'continua') assert.equal(lienzo.buscar('c-f101').getAttribute('data-e'), 'fundido');
    objetos[0].actualizar(null);
    assert.equal(lienzo.grupos.length > 0, true);
  });
}

/* ---------- con el modelo real (si está) ---------- */
test('con el simulador real y cada avería activada, los tres módulos calculan sin romperse y las averías de protecciones se ven', () => {
  const reales = H.reales([12]);
  if (!reales.length) return;                       // el modelo aún no está: no se prueba
  const C = require('../js/scada2d/diagrama_cableado.js'), T = require('../js/interfaz/textos_ayuda.js');
  for (const { id, estado } of reales) {
    assert.doesNotThrow(() => { U.calcularUnifilar(estado); U.ariaUnifilar(estado); C.calcularCableado(estado); C.filasTabla(estado); for (const t of T.TAGS) T.estadoVivo(t, estado); }, String(id));
    const m = U.calcularUnifilar(estado);
    for (const [k, v] of Object.entries(m)) assert.ok(typeof v.e === 'string' && (v.t === undefined || (typeof v.t === 'string' && !/NaN|undefined|Infinity/.test(v.t))), `${id}: ${k} = ${JSON.stringify(v)}`);
    if (id === 'FUSIBLE_F101') assert.equal(m['c-f101'].e, 'fundido');
    if (id === 'QB_DISPARADO') assert.equal(m['c-qb101-a'].e, 'disparado');
    if (id === 'DIFERENCIAL_DISPARADO') assert.equal(m['a-id301'].e, 'disparado');
    if (id === 'SPD_DISPARADO_A') assert.equal(m['c-spd101'].e, 'agotado');
    if (id === 'RED_CAIDA') assert.equal(m['a-bus'].e, 'muerto');
    if (id === 'CADENA_ABIERTA_A1') assert.match(m['c-s101-t'].t, /ABIERTA/);
    if (id === 'COMUNICACION_PERDIDA_EASUN') assert.equal(m['c-com'].e, 'fallo');
  }
});
