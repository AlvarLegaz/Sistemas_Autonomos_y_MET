'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { crearPulsacionLarga } = require('../js/interfaz/pulsacion_larga.js');

function crearReloj() {
  let pendiente = null;
  return {
    programar: (f) => { pendiente = f; return 1; },
    anular: () => { pendiente = null; },
    disparar: () => { const f = pendiente; pendiente = null; if (f) f(); },
    hayPendiente: () => pendiente !== null,
  };
}

test('al cumplirse el tiempo avisa con el dato y terminar informa de la pulsación larga', () => {
  const reloj = crearReloj(), avisos = [];
  const larga = crearPulsacionLarga({ alCumplir: d => avisos.push(d), programar: reloj.programar, anular: reloj.anular });
  larga.empezar(10, 10, 'bomba');
  assert.deepEqual(avisos, []);
  reloj.disparar();
  assert.deepEqual(avisos, ['bomba']);
  assert.equal(larga.terminar(), true);
});

test('soltar antes de tiempo cancela y no es pulsación larga', () => {
  const reloj = crearReloj(), avisos = [];
  const larga = crearPulsacionLarga({ alCumplir: d => avisos.push(d), programar: reloj.programar, anular: reloj.anular });
  larga.empezar(0, 0, 'x');
  assert.equal(larga.terminar(), false);
  reloj.disparar();
  assert.deepEqual(avisos, []);
});

test('moverse más del umbral cancela; un temblor pequeño no', () => {
  const reloj = crearReloj();
  const larga = crearPulsacionLarga({ alCumplir: () => {}, programar: reloj.programar, anular: reloj.anular });
  larga.empezar(0, 0, 'x');
  larga.mover(4, 4);
  assert.equal(reloj.hayPendiente(), true);
  larga.mover(20, 0);
  assert.equal(reloj.hayPendiente(), false);
});
