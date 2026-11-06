'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CONFIG_BASE } = require('../js/configuracion/constantes_control.js');
const estadoPlanta = require('../js/modelo/estado_planta.js');
const fases = require('../js/control/fases.js');

function secuenciaDe(fase, ajustes) {
  return { fase, segundosFase: 0, ajustes: Object.assign({}, CONFIG_BASE, ajustes), integralLazoT1: 0, integralCascada: 0, integralF1: 0,
    segundosEnBanda: 0, segundosEstable: 0, desviando: true, tiempoDesvioS: 0, finalInicialMl: 0, alarma: null, motivo: '', eventos: [] };
}

test('Arranque: N2 y calefactor encendidos; al cumplir segundosArranque pasa a precalentamiento', () => {
  const s = estadoPlanta.crearEstado(); const sec = secuenciaDe('arranque', {});
  fases.controlarArranque(sec, s);
  assert.equal(s.salidas.N2, true); assert.equal(s.salidas.RES, true);
  assert.equal(sec.fase, 'arranque');
  sec.segundosFase = CONFIG_BASE.segundosArranque;
  fases.controlarArranque(sec, s);
  assert.equal(sec.fase, 'precalentamiento');
});

test('Producción: con SOL1 cerrada y T1 en consigna, el producto sale normal y el tanque se descuenta', () => {
  const s = estadoPlanta.crearEstado(); const sec = secuenciaDe('produccion', { consignaT1C: 60 });
  s.t1C = 60; s.salidas.SOL1 = true; sec.desviando = true; sec.segundosEnBanda = 0;
  fases.controlarProduccion(sec, s, 1);
  assert.equal(s.salidas.SOL1, true, 'con T1 en banda aún debe desviar');
  assert.equal(sec.segundosEnBanda, 1);
});

test('Producción: si T1 cae por debajo de la tolerancia, SOL1 desvía de inmediato', () => {
  const s = estadoPlanta.crearEstado(); const sec = secuenciaDe('produccion', { consignaT1C: 60 });
  s.t1C = 50; s.salidas.SOL1 = false; sec.desviando = false;
  fases.controlarProduccion(sec, s, 1);
  assert.equal(s.salidas.SOL1, true);
  assert.equal(sec.desviando, true);
});

test('Lavado: recircula con SOL1 y pasa a parada al cumplir segundosLavado', () => {
  const s = estadoPlanta.crearEstado(); const sec = secuenciaDe('lavado', {});
  fases.controlarLavado(sec, s);
  assert.equal(s.salidas.SOL1, true); assert.equal(s.consignas.velocidadN1Pct, 100);
  sec.segundosFase = CONFIG_BASE.segundosLavado;
  fases.controlarLavado(sec, s);
  assert.equal(sec.fase, 'parada');
});

test('Parada: la fase termina en finalizada cuando T2 baja de enfriarHastaC', () => {
  const s = estadoPlanta.crearEstado(); const sec = secuenciaDe('parada', { enfriarHastaC: 45 });
  s.aguaCalienteC = 60;
  fases.controlarParada(sec, s);
  assert.equal(s.salidas.N2, true); assert.equal(sec.fase, 'parada');
  s.aguaCalienteC = 40;
  fases.controlarParada(sec, s);
  assert.equal(s.salidas.N2, false); assert.equal(sec.fase, 'finalizada');
});

test('Protección: un corte térmico en producción lleva a alarma y corta la resistencia', () => {
  const s = estadoPlanta.crearEstado(); const sec = secuenciaDe('produccion', {});
  s.temperaturaCorte = true; s.salidas.RES = true;
  fases.controlar(sec, s, 1);
  assert.equal(sec.fase, 'alarma'); assert.equal(s.salidas.RES, false); assert.equal(s.consignas.potenciaPct, 0);
});

test('Fases de reposo y finalizada no cambian actuadores', () => {
  const s = estadoPlanta.crearEstado(); const sec = secuenciaDe('reposo', {});
  fases.controlar(sec, s, 1);
  assert.equal(s.salidas.N1, false); assert.equal(s.salidas.SOL1, false);
});

test('volumenOrigen devuelve el depósito elegido en la configuración', () => {
  const s = estadoPlanta.crearEstado();
  assert.equal(fases.volumenOrigen(s, secuenciaDe('reposo', { origen: 'A' })), s.depositoAMl);
  assert.equal(fases.volumenOrigen(s, secuenciaDe('reposo', { origen: 'B' })), s.depositoBMl);
});
