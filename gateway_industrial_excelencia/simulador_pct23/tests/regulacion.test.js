'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CONSTANTES_FISICAS: C } = require('../js/configuracion/constantes_fisicas.js');
const { CONFIG_BASE } = require('../js/configuracion/constantes_control.js');
const estadoPlanta = require('../js/modelo/estado_planta.js');
const regulacion = require('../js/control/regulacion.js');

function secuenciaDe(ajustes) {
  return { ajustes: Object.assign({}, CONFIG_BASE, ajustes), integralLazoT1: 0, integralCascada: 0, integralInterna: 0, integralF1: 0, resistenciaActiva: true, consignaT2Activa: null, eventos: [] };
}

test('Lazo T2: con agua por debajo de la consigna sube la potencia, y se limita a potenciaMaxPct', () => {
  const sec = secuenciaDe({ consignaT2C: 80 });
  const s = estadoPlanta.crearEstado(); s.aguaCalienteC = 40;
  const r = regulacion.lazoT2(sec, s, 1, 80);
  assert.ok(r > 0 && r <= sec.ajustes.potenciaMaxPct);
  s.aguaCalienteC = 0;
  assert.equal(regulacion.lazoT2(sec, s, 1, 88), sec.ajustes.potenciaMaxPct);
});

test('Lazo T1: con T1 por debajo de la consigna pide más potencia que con T1 en consigna', () => {
  const sec = secuenciaDe({ consignaT1C: 60 });
  const frio = estadoPlanta.crearEstado(); frio.t1C = 40; frio.consignas.velocidadN1Pct = 50;
  const enConsigna = estadoPlanta.crearEstado(); enConsigna.t1C = 60; enConsigna.consignas.velocidadN1Pct = 50;
  assert.ok(regulacion.lazoT1(sec, frio, 1) > regulacion.lazoT1(sec, enConsigna, 1));
});

test('Cascada: la consigna de T2 queda acotada entre ambiente + 5 y consignaT2MaxC', () => {
  const sec = secuenciaDe({ consignaT1C: 60, consignaT2MaxC: 88 });
  const s = estadoPlanta.crearEstado(); s.t1C = 60; s.consignas.velocidadN1Pct = 50;
  regulacion.lazoCascada(sec, s, 1);
  assert.ok(sec.consignaT2Activa >= C.temperaturaAmbienteC + 5 && sec.consignaT2Activa <= 88);
});

test('Lazo de caudal: F1 por debajo de la consigna sube la velocidad de N1, dentro de 10..100 %', () => {
  const sec = secuenciaDe({ consignaF1MlMin: 300 });
  const s = estadoPlanta.crearEstado(); s.caudalProductoMlMin = 100;
  const v = regulacion.lazoCaudal(sec, s, 1);
  assert.ok(v >= 10 && v <= 100);
  assert.ok(v > 300 / C.caudalMaxN1MlMin * 100);
});

test('Todo/nada: se conecta por debajo de la banda y se desconecta por encima', () => {
  const sec = secuenciaDe({ consignaT2C: 80, histeresisT2C: 2 });
  const s = estadoPlanta.crearEstado();
  s.aguaCalienteC = 70; regulacion.lazoTodoNada(sec, s);
  assert.equal(s.salidas.RES, true);
  s.aguaCalienteC = 85; regulacion.lazoTodoNada(sec, s);
  assert.equal(s.salidas.RES, false);
  assert.equal(s.consignas.potenciaPct, sec.ajustes.potenciaMaxPct);
});

test('Modo manual: regular fija la potencia elegida y N1 con el caudal configurado', () => {
  const sec = secuenciaDe({ modoRegulacion: 'manual', potenciaManualPct: 90, caudalPct: 50 });
  const s = estadoPlanta.crearEstado();
  regulacion.regular(sec, s, 1, 'produccion');
  assert.equal(s.consignas.potenciaPct, 90);
  assert.equal(s.consignas.velocidadN1Pct, 50);
  assert.equal(s.salidas.N1, true);
});
