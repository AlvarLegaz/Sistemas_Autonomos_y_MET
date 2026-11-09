'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { crearEstado } = require('../js/modelo/estado_planta.js');
const activaciones = require('../js/interfaz/grafica_activaciones.js');

test('la potencia muestreada es la consigna solo con la resistencia encendida', () => {
  const s = crearEstado();
  s.consignas.potenciaPct = 60;
  assert.equal(activaciones.tomarMuestra(s).RES, 0);
  s.salidas.RES = true;
  assert.equal(activaciones.tomarMuestra(s).RES, 60);
});

test('la muestra incluye bombas y electroválvulas como booleanos', () => {
  const s = crearEstado();
  s.tiempo = 12; s.salidas.N1 = true; s.salidas.SOL3 = true;
  const m = activaciones.tomarMuestra(s);
  assert.equal(m.tiempo, 12);
  assert.deepEqual([m.N1, m.N2, m.SOL3, m.SOL5], [true, false, true, false]);
});

test('registrar acumula y reiniciar vacía el historial', () => {
  activaciones.registrar(crearEstado());
  assert.equal(activaciones.ventana().length, 1);
  activaciones.reiniciar();
  assert.equal(activaciones.ventana().length, 0);
});
