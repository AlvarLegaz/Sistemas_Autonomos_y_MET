'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const v = require('../js/interfaz/visor3d/planta3d/valvulas_instrumentos.js');
const layout = require('../js/interfaz/visor3d/planta3d/layout.js');
const { ELEMENTOS } = require('../js/interfaz/ayuda_textos.js');
const estadoPlanta = require('../js/modelo/estado_planta.js');
const planta = require('../js/modelo/planta.js');

const estadoCon = ajustar => { const e = estadoPlanta.crearEstado(); ajustar(e); return e; };

test('bobinas: cada electroválvula sigue su salida y V3 sigue valvulaV3', () => {
  const e = estadoCon(s => { s.salidas.SOL1 = true; s.salidas.SOL4 = true; s.valvulaV3 = true; });
  assert.equal(v.bobinaActiva('SOL1', e), true);
  assert.equal(v.bobinaActiva('SOL2', e), false);
  assert.equal(v.bobinaActiva('SOL4', e), true);
  assert.equal(v.bobinaActiva('V3', e), true);
  assert.equal(v.bobinaActiva('V3', estadoCon(() => {})), false);
});

test('las válvulas manuales fijas no tienen estado', () => {
  for (const id of ['V1', 'PRV1', 'V2']) assert.equal(v.bobinaActiva(id, estadoCon(() => {})), null);
});

test('lecturas de sensores y carteles', () => {
  const e = estadoCon(s => { s.t1C = 72.34; s.t5C = 41; s.caudalProductoMlMin = 149.6; s.finalMl = 812.4; s.desviadoMl = 33; s.desagueMl = 0.4; });
  const o = planta.observaciones(e);
  assert.equal(v.textoLectura('T1', e, o), '72,3 °C');
  assert.equal(v.textoLectura('T5', e, o), '41,0 °C');
  assert.equal(v.textoLectura('F1', e, o), '150 ml/min');
  assert.equal(v.textoLectura('FINAL', e, o), '812 ml');
  assert.equal(v.textoLectura('DESVIO', e, o), '33 ml');
  assert.equal(v.textoLectura('DRAIN', e, o), '0 ml');
  assert.equal(v.textoLectura('COLD', e, o), 'cerrada');
  e.caudalFrioMlMin = 300;
  assert.equal(v.textoLectura('COLD', e, o), '300 ml/min');
});

test('texto de las electroválvulas de tres vías y de las de dos', () => {
  assert.equal(v.textoValvula('SOL1', true), 'desvío');
  assert.equal(v.textoValvula('SOL2', false), 'tanque A');
  assert.equal(v.textoValvula('SOL3', true), 'abierta');
});

test('la temperatura de la punta se limita entre 20 y 80 °C', () => {
  assert.equal(v.fraccionTemperatura(10), 0);
  assert.equal(v.fraccionTemperatura(50), 0.5);
  assert.equal(v.fraccionTemperatura(200), 1);
});

test('todo lo que pinta el módulo tiene ayuda y posición en el esquema', () => {
  const ids = [...v.VALVULAS_ELECTRICAS, ...v.VALVULAS_MANUALES, ...v.SENSORES, ...Object.keys(v.CARTELES)];
  assert.equal(new Set(ids).size, ids.length, 'ids repetidos');
  for (const id of ids) assert.ok(ELEMENTOS[id], `${id}: sin texto de ayuda`);
  for (const id of [...v.VALVULAS_ELECTRICAS, ...v.VALVULAS_MANUALES, ...v.SENSORES]) assert.ok(layout.POSICIONES_PX[id], `${id}: sin posición en layout`);
});
