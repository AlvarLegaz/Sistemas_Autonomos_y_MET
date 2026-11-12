'use strict';
// Coherencia del catálogo de averías con layout.js y comportamiento del motor.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const L = require('../js/layout.js');
const { CATALOGO, porId } = require('../js/averias/catalogo.js');
const { crearMotorAverias } = require('../js/averias/motor.js');
const { crearSimulacion } = require('./modelo_ayuda.js');

const tags = new Set(L.EQUIPOS.map(e => e.tag));

test('catálogo: tiene exactamente las averías de AVERIAS (ids, títulos y tags de layout.js)', () => {
  assert.equal(CATALOGO.length, L.AVERIAS.length);
  assert.equal(new Set(CATALOGO.map(a => a.id)).size, CATALOGO.length, 'ids únicos');
  for (const a of L.AVERIAS) {
    const c = porId(a.id); assert.ok(c, a.id);
    assert.equal(c.titulo, a.titulo); assert.equal(c.tag, a.tag); assert.ok(tags.has(c.tag), `tag ${c.tag}`);
  }
});

test('catálogo: cada avería describe síntomas, diagnóstico y solución, con equipos y alarmas existentes', () => {
  const { TEXTOS_ALARMA } = require('../js/modelo/simulacion.js');
  for (const a of CATALOGO) {
    assert.ok(a.descripcion.length > 20, `${a.id} descripción`); assert.ok(a.sintomas.length > 0, `${a.id} síntomas`); assert.ok(a.diagnostico.length > 0, `${a.id} diagnóstico`);
    assert.ok([1, 2, 3].includes(a.dificultad)); assert.ok(a.solucion.texto.length > 10 && a.solucion.accion, `${a.id} solución`); assert.ok(tags.has(a.solucion.tag), `${a.id} tag de solución`);
    for (const c of a.alarmas) assert.ok(TEXTOS_ALARMA[c], `${a.id}: alarma ${c} sin texto`);
  }
});

test('motor: activar, desactivar, parámetros y limpiar', () => {
  const m = crearMotorAverias(); const eventos = [];
  m.oyente((ev, id) => eventos.push(`${ev}:${id}`));
  assert.equal(m.activar('NO_EXISTE'), false);
  assert.equal(m.activar('FUSIBLE_F101'), true); m.activar('FUSIBLE_F101');
  assert.deepEqual(m.activas(), ['FUSIBLE_F101']); assert.equal(eventos.length, 1, 'sin avisos repetidos');
  m.activar('CONECTOR_RESISTIVO_B2', { resistenciaOhm: 99 });
  assert.equal(m.parametro('CONECTOR_RESISTIVO_B2', 'resistenciaOhm'), 5, 'parámetro acotado al máximo');
  m.activar('CONECTOR_RESISTIVO_B2', { resistenciaOhm: 'x' }); assert.equal(m.parametro('CONECTOR_RESISTIVO_B2', 'resistenciaOhm'), 1);
  assert.equal(m.hay('FUSIBLE_F101'), true); assert.equal(m.desactivar('FUSIBLE_F101'), true); assert.equal(m.desactivar('FUSIBLE_F101'), false);
  m.limpiar(); assert.deepEqual(m.activas(), []);
});

test('sim.ordenes.averias: activar/desactivar/activas/limpiar y reiniciar las retira', () => {
  const sim = crearSimulacion({ semilla: 1, horaSolar: 11 });
  assert.equal(sim.ordenes.averias.activar('RED_CAIDA'), true); assert.equal(sim.ordenes.averias.activar('COMUNICACION_PERDIDA_EASUN'), true);
  assert.deepEqual(sim.ordenes.averias.activas().sort(), ['COMUNICACION_PERDIDA_EASUN', 'RED_CAIDA']);
  assert.deepEqual(sim.estado.averiasActivas.slice().sort(), ['COMUNICACION_PERDIDA_EASUN', 'RED_CAIDA']);
  sim.ordenes.averias.desactivar('RED_CAIDA'); assert.deepEqual(sim.estado.averiasActivas, ['COMUNICACION_PERDIDA_EASUN']);
  sim.ordenes.averias.limpiar(); assert.deepEqual(sim.estado.averiasActivas, []);
  sim.ordenes.averias.activar('FUSIBLE_F101'); sim.reiniciar();
  assert.deepEqual(sim.estado.averiasActivas, []); assert.equal(sim.estado.protecciones['F-101'].estado, 'CERRADO');
});

test('rearmar el elemento averiado (fusible, descargador, magnetotérmico, diferencial) retira la avería', () => {
  for (const [id, tag, estado] of [['FUSIBLE_F101', 'F-101', 'FUNDIDO'], ['SPD_DISPARADO_A', 'SPD-101', 'AGOTADO'], ['QB_DISPARADO', 'QB-101', 'DISPARADO'], ['DIFERENCIAL_DISPARADO', 'ID-301', 'DISPARADO']]) {
    const sim = crearSimulacion({ semilla: 1, horaSolar: 11 });
    sim.ordenes.averias.activar(id); assert.equal(sim.estado.protecciones[tag].estado, estado, id);
    assert.equal(sim.ordenes.protecciones.rearmar(tag), true);
    assert.equal(sim.estado.protecciones[tag].estado, 'CERRADO', id); assert.deepEqual(sim.estado.averiasActivas, [], id);
  }
  const sim = crearSimulacion({ semilla: 1, horaSolar: 11 });
  sim.ordenes.averias.activar('QB_DISPARADO'); sim.ordenes.protecciones.cerrar('QB-101');
  assert.equal(sim.estado.protecciones['QB-101'].estado, 'CERRADO', 'cerrar un disparado lo rearma'); assert.deepEqual(sim.estado.averiasActivas, []);
  const f = crearSimulacion({ semilla: 1, horaSolar: 11 }); f.ordenes.averias.activar('FUSIBLE_F101');
  assert.equal(f.ordenes.protecciones.cerrar('F-101'), false); assert.equal(f.estado.protecciones['F-101'].estado, 'FUNDIDO', 'un fusible fundido no se cierra, se sustituye');
});
