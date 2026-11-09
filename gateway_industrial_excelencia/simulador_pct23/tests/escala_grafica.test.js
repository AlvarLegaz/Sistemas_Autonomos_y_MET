'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { rangoLimpio } = require('../js/interfaz/escala_grafica.js');

test('el rango abarca los valores con margen y se redondea a divisiones limpias', () => {
  const r = rangoLimpio([61.3, 63.8, 62.5]);
  assert.ok(r.minimo <= 59.3 && r.maximo >= 65.8);
  assert.deepEqual(r.marcas.slice(0, 2).map(v => v % 1), [0, 0]);
  assert.equal(r.marcas[0], r.minimo);
  assert.equal(r.marcas[r.marcas.length - 1], r.maximo);
});

test('con un solo valor el rango no queda vacío', () => {
  const r = rangoLimpio([50], 0);
  assert.ok(r.maximo > r.minimo);
});

test('el tope limita el rango (potencia 0-100 %)', () => {
  const r = rangoLimpio([0, 100], 5, { minimo: 0, maximo: 100 });
  assert.equal(r.minimo, 0);
  assert.equal(r.maximo, 100);
});

test('sin valores no hay rango', () => {
  assert.equal(rangoLimpio([]), null);
});
