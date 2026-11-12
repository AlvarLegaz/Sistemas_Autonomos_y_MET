// Sinóptico: se genera sin errores con el estado del modelo, no falta ningún equipo, los textos que se actualizan existen, el reparto de flujos tiene el sentido correcto
// y los estados visuales (verde / ámbar / rojo / gris) salen del estado.
const test = require('node:test');
const assert = require('node:assert/strict');
const layout = require('../js/layout.js');
const E = require('../js/scada2d/esquema_fv.js');
const { crearSimulacion } = require('../js/interfaz/estado_demo.js');

const sim = (o = {}) => { const s = crearSimulacion(Object.assign({ semilla: 1, diaAnio: 172, horaSolar: 12, nubosidad: 0 }, o)); s.paso(5); return s; };
const marcha = (s, seg = 400) => { for (let t = 0; t < seg; t += 5) s.paso(5); return s.estado; };

test('el esquema se construye y es una especificación SVG válida', () => {
  const e = E.construirEsquema();
  assert.equal(e[0], 'svg'); assert.match(e[1].viewBox, /^0 0 \d+ \d+$/);
  const ids = E.idsDelEsquema(e); const orden = [...ids];
  assert.equal(ids.size, orden.length, 'ids únicos');
});

test('todos los equipos de layout.EQUIPOS aparecen en el esquema', () => {
  const tags = E.tagsDelEsquema();
  const faltan = layout.EQUIPOS.filter(q => !tags.has(q.tag)).map(q => q.tag);
  assert.deepEqual(faltan, []);
  for (const t of tags) assert.ok(layout.EQUIPOS.some(q => q.tag === t), `${t} no está en el contrato`);
});

test('los textos y burbujas que se actualizan existen en el dibujo', () => {
  const s = sim(), e = marcha(s), ids = E.idsDelEsquema();
  for (const id of Object.keys(E.textosEquipos(e))) assert.ok(ids.has(id), `falta el texto ${id}`);
  for (const [id, lineas] of Object.entries(E.lecturasBurbujas(e))) lineas.forEach((_, k) => assert.ok(ids.has(`bt-${id}-${k}`), `falta la burbuja bt-${id}-${k}`));
  for (const id of Object.keys(E.ledsInversores(e))) assert.ok(ids.has(id), `falta el LED ${id}`);
  for (const q of layout.EQUIPOS.filter(x => x.tipo === 'panel')) for (const id of [`pw-${q.tag}`, `sh-${q.tag}`, `by-${q.tag}-0`, `by-${q.tag}-2`]) assert.ok(ids.has(id), `falta ${id}`);
});

test('los textos y las burbujas no tienen NaN ni undefined con el estado de la simulación (de día y de noche)', () => {
  for (const hora of [12, 2]) {
    const e = marcha(sim({ horaSolar: hora }), 120);
    const todo = [...Object.values(E.textosEquipos(e)), ...Object.values(E.lecturasBurbujas(e)).flat()].join(' | ');
    assert.doesNotMatch(todo, /NaN|undefined|Infinity/);
  }
});

test('flujos: de día el campo produce y todas las cadenas con sol llevan potencia en el sentido de la caja al inversor', () => {
  const e = marcha(sim(), 400), r = E.repartoFlujos(e);
  for (const id of ['STR-101', 'STR-102', 'CCA', 'STR-201', 'STR-202']) { assert.ok(r[id].activo, id); assert.equal(r[id].sentido, 1); assert.ok(r[id].p > 100); }
  assert.ok(Math.abs(r['STR-101'].p + r['STR-102'].p - r.CCA.p) < 1);
});

test('flujos: de noche no hay producción solar y la batería puede ir al revés (descarga)', () => {
  const s = sim({ horaSolar: 2 }); const e = marcha(s, 60), r = E.repartoFlujos(e);
  for (const id of ['STR-101', 'STR-102', 'CCA', 'STR-201', 'STR-202']) assert.equal(r[id].activo, false, id);
  s.ordenes.bateria.socInicial(80); const e2 = marcha(s, 60);
  assert.equal(E.repartoFlujos(e2).BAT.sentido, e2.inversores['INV-101'].bateriaP < 0 ? -1 : 1);
});

test('flujos: sentido de la red según importe o exporte, y de la batería según carga o descarga', () => {
  const base = { campos: { A: { p: 0, cadenas: [] }, B: { p: 0, cadenas: [] } }, inversores: { 'INV-101': {}, 'INV-201': {} }, bateria: {}, red: {}, cargas: {} };
  const a = Object.assign({}, base, { red: { p: 1500 } }), b = Object.assign({}, base, { red: { p: -800 } });
  assert.equal(E.repartoFlujos(a).RED.sentido, 1); assert.equal(E.repartoFlujos(a).RED.p, 1500);
  assert.equal(E.repartoFlujos(b).RED.sentido, -1); assert.equal(E.repartoFlujos(b).RED.p, 800);
  const carga = Object.assign({}, base, { inversores: { 'INV-101': { bateriaP: 600 }, 'INV-201': {} } }), desc = Object.assign({}, base, { inversores: { 'INV-101': { bateriaP: -900 }, 'INV-201': {} } });
  assert.equal(E.repartoFlujos(carga).BAT.sentido, 1); assert.equal(E.repartoFlujos(desc).BAT.sentido, -1); assert.equal(E.repartoFlujos(desc).BAT.p, 900);
  assert.equal(E.repartoFlujos(null).RED.activo, false);        // sin estado: sin flujos, sin errores
});

test('grosor y velocidad del flujo crecen con la potencia', () => {
  assert.ok(E.grosorFlujo(3000) > E.grosorFlujo(300)); assert.ok(E.cicloFlujo(3000) < E.cicloFlujo(300));
  assert.ok(E.grosorFlujo(1e9) <= 8.01); assert.ok(E.cicloFlujo(0) > 0);
});

test('estado visual: verde en servicio, gris parado, ámbar aviso y rojo alarma', () => {
  const s = sim(), e = marcha(s, 300);
  assert.equal(E.estadoVisual(e, 'PV-101'), 'ok'); assert.equal(E.estadoVisual(e, 'QS-101'), 'ok'); assert.equal(E.estadoVisual(e, 'INV-101'), 'ok');
  s.ordenes.protecciones.abrir('QS-101'); let e2 = marcha(s, 10);
  assert.equal(E.estadoVisual(e2, 'QS-101'), 'parado');
  s.ordenes.protecciones.cerrar('QS-101'); s.ordenes.averias.activar('FUSIBLE_F101'); e2 = marcha(s, 10);
  assert.equal(E.estadoVisual(e2, 'F-101'), 'alarma');
  s.ordenes.averias.limpiar(); s.ordenes.averias.activar('CADENA_ABIERTA_B1'); e2 = marcha(s, 10);
  assert.equal(E.estadoVisual(e2, 'STR-201'), 'alarma'); assert.equal(E.estadoVisual(e2, 'PV-201'), 'alarma');
  s.ordenes.averias.limpiar(); s.ordenes.ambiente.sombra('PV-105', 0.6); e2 = marcha(s, 10);
  assert.equal(E.estadoVisual(e2, 'PV-105'), 'aviso');
});

test('estado visual de red, cargas, batería y noche', () => {
  const s = sim(); marcha(s, 200);
  s.ordenes.red.disponible(false); let e = marcha(s, 10);
  assert.equal(E.estadoVisual(e, 'RED-301'), 'alarma');
  s.ordenes.red.disponible(true); s.ordenes.averias.activar('BMS_CORTE_BATERIA'); e = marcha(s, 10);
  assert.equal(E.estadoVisual(e, 'BAT-101'), 'alarma');
  const noche = marcha(sim({ horaSolar: 2 }), 30);
  assert.equal(E.estadoVisual(noche, 'PV-101'), 'parado'); assert.equal(E.estadoVisual(noche, 'STR-201'), 'parado');
  assert.equal(E.estadoVisual(null, 'PV-101'), 'parado');
});

test('las alarmas del modelo con su tag elevan el estado visual (la más grave manda)', () => {
  const e = marcha(sim(), 60);
  const con = Object.assign({}, e, { alarmas: [{ codigo: 'X', texto: 'x', tag: 'CB-101', severidad: 'aviso' }, { codigo: 'Y', texto: 'y', tag: 'CB-101', severidad: 'alarma' }] });
  assert.equal(E.estadoVisual(con, 'CB-101'), 'alarma');
  assert.equal(E.alarmaDeTag(con, 'QA-301'), null);
});

test('etiquetas accesibles: tag, nombre, estado visual en palabras y lectura', () => {
  const e = marcha(sim(), 300);
  assert.match(E.etiquetaAria(e, 'PV-101'), /^PV-101 .*en servicio/); assert.match(E.etiquetaAria(e, 'INV-101'), /INV-101/);
  assert.match(E.estadoEquipo(e, 'BAT-101'), /%/);
});
