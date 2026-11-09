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

test('las bombas valen 0 % apagadas y su velocidad cuando están encendidas', () => {
  const s = crearEstado();
  s.consignas.velocidadN1Pct = 60; s.consignas.velocidadN2Pct = 35;
  assert.deepEqual([activaciones.tomarMuestra(s).N1, activaciones.tomarMuestra(s).N2], [0, 0]);
  s.salidas.N1 = true;
  assert.deepEqual([activaciones.tomarMuestra(s).N1, activaciones.tomarMuestra(s).N2], [60, 0]);
  s.salidas.N2 = true;
  assert.deepEqual([activaciones.tomarMuestra(s).N1, activaciones.tomarMuestra(s).N2], [60, 35]);
});

test('la muestra incluye el tiempo y las electroválvulas como booleanos', () => {
  const s = crearEstado();
  s.tiempo = 12; s.salidas.SOL3 = true;
  const m = activaciones.tomarMuestra(s);
  assert.equal(m.tiempo, 12);
  assert.deepEqual([m.SOL1, m.SOL3, m.SOL5], [false, true, false]);
});

test('registrar acumula y reiniciar vacía el historial', () => {
  activaciones.registrar(crearEstado());
  assert.equal(activaciones.ventana().length, 1);
  activaciones.reiniciar();
  assert.equal(activaciones.ventana().length, 0);
});
