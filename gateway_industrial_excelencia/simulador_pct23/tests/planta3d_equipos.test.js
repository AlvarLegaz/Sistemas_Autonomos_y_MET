'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const eq = require('../js/interfaz/visor3d/planta3d/equipos.js');
const layout = require('../js/interfaz/visor3d/planta3d/layout.js');
const { ELEMENTOS } = require('../js/interfaz/ayuda_textos.js');
const estadoPlanta = require('../js/modelo/estado_planta.js');
const planta = require('../js/modelo/planta.js');

test('todos los ids de equipos tienen texto de ayuda y posición (salvo los captadores de depósito)', () => {
  for (const id of eq.IDS_ELEMENTOS) assert.ok(ELEMENTOS[id], `${id}: sin ayuda`);
  for (const id of ['TANKA', 'TANKB', 'HEAT', 'N1', 'N2', 'HOLDING', 'FILTER', 'REGEN', 'CALENT', 'ENFRIA']) {
    const p = eq.posiciones()[id];
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z), id);
  }
});

test('los depósitos no se solapan en la mesa (Ø 15,5 cm)', () => {
  const p = eq.posiciones(), ids = ['TANKA', 'TANKB', 'HEAT'];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++)
    assert.ok(Math.hypot(p[ids[i]].x - p[ids[j]].x, p[ids[i]].z - p[ids[j]].z) > 15.5, `${ids[i]} y ${ids[j]}`);
});

test('las tres cajas del intercambiador miden lo que el esquema y quedan en línea', () => {
  assert.ok(Math.abs(eq.CAJA_SECCION_CM.ancho - 102 * layout.ESCALA) < 1e-9);
  const p = eq.posiciones();
  assert.ok(p.REGEN.x < p.CALENT.x && p.CALENT.x < p.ENFRIA.x);
  assert.ok(p.CALENT.x - p.REGEN.x > eq.CAJA_SECCION_CM.ancho);          // no se pisan
});

test('el nivel del líquido sale de la fracción de llenado', () => {
  const e = estadoPlanta.crearEstado(); e.depositoAMl = 2500; e.depositoBMl = -3;
  assert.ok(Math.abs(eq.alturaLiquidoCm('TANKA', e) - 12.5) < 1e-9);
  assert.equal(eq.alturaLiquidoCm('TANKB', e), 0);
  assert.ok(Math.abs(eq.fraccionLlenado('HEAT', e) - 0.7) < 1e-9);
});

test('mezcla de color por temperatura: limitada entre 0 y 1', () => {
  assert.equal(eq.mezclaCalor(10), 0);
  assert.equal(eq.mezclaCalor(200), 1);
  assert.ok(Math.abs(eq.mezclaCalor(47.5) - 0.5) < 1e-9);
});

test('rotor: parado, sentido normal (horario) y sentido invertido', () => {
  assert.equal(eq.velocidadAngularRotor(false, 100, false), 0);
  assert.ok(eq.velocidadAngularRotor(true, 50, false) < 0);
  assert.ok(eq.velocidadAngularRotor(true, 50, true) > 0);
  assert.ok(Math.abs(eq.velocidadAngularRotor(true, 100, false) + 2 * Math.PI) < 1e-9);   // 1 vuelta por segundo
  assert.equal(eq.velocidadAngularRotor(true, 150, false), eq.velocidadAngularRotor(true, 100, false));
});

test('secciones del intercambiador: temperatura y actividad desde el estado', () => {
  const e = estadoPlanta.crearEstado(); estadoPlanta.activarEjemplo(e); e.caudalProductoMlMin = 100; e.aguaCalienteC = 60; e.t3C = 25; e.t4C = 40;
  const t = eq.temperaturasSecciones(planta.observaciones(e)), a = eq.actividadSecciones(e);
  assert.deepEqual(t, { REGEN: 40, CALENT: 60, ENFRIA: 25 });
  assert.deepEqual(a, { REGEN: true, CALENT: true, ENFRIA: true });
  assert.equal(eq.actividadSecciones(estadoPlanta.crearEstado()).CALENT, false);
});

test('estado de bomba: marcha, velocidad y giro inverso', () => {
  const e = estadoPlanta.crearEstado(); e.salidas.N1 = true; e.consignas.velocidadN1Pct = 35; e.giro.N1 = true;
  assert.deepEqual(eq.estadoBomba('N1', e), { activa: true, velocidadPct: 35, inversa: true });
  assert.equal(eq.estadoBomba('N2', e).activa, false);
});
