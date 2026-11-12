'use strict';
// Sol, cielo y ambiente: simetría, valores por hora y estación, nubosidad, plano inclinado.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const Sol = require('../js/modelo/sol.js');
const { CAMPOS } = require('../js/layout.js');

const gh = (dia, hora, nub = 0) => { const p = Sol.posicionSolar(dia, hora); return Sol.conNubosidad(Sol.cieloDespejado(dia, p.sinAltura), nub).gh; };

test('sol: la altura es simétrica respecto al mediodía solar y el azimut es antisimétrico', () => {
  for (const dia of [21, 172, 355]) for (const x of [1, 2, 3.5, 5]) {
    const a = Sol.posicionSolar(dia, 12 - x), b = Sol.posicionSolar(dia, 12 + x);
    assert.ok(Math.abs(a.alturaGrados - b.alturaGrados) < 1e-6, `altura día ${dia} ±${x} h`);
    assert.ok(Math.abs(a.azimutGrados + b.azimutGrados) < 1e-6, `azimut día ${dia} ±${x} h`);
    assert.ok(Math.abs(gh(dia, 12 - x) - gh(dia, 12 + x)) < 1e-6, 'irradiancia simétrica');
  }
});

test('sol: mediodía solar de Cartagena en el solsticio de junio y de diciembre', () => {
  const j = Sol.posicionSolar(172, 12), d = Sol.posicionSolar(355, 12);
  assert.ok(Math.abs(j.alturaGrados - 75.9) < 0.6, `junio ${j.alturaGrados}`);
  assert.ok(Math.abs(d.alturaGrados - 28.9) < 0.6, `diciembre ${d.alturaGrados}`);
  assert.ok(Math.abs(j.azimutGrados) < 1e-3 && Math.abs(d.azimutGrados) < 1e-3, 'azimut 0 (sur) a mediodía');
});

test('sol: valores por hora en junio (amanecer hacia el este, tarde hacia el oeste, noche bajo el horizonte)', () => {
  const h6 = Sol.posicionSolar(172, 6), h9 = Sol.posicionSolar(172, 9), h15 = Sol.posicionSolar(172, 15), h0 = Sol.posicionSolar(172, 0);
  assert.ok(Math.abs(h6.alturaGrados - 14) < 1.5, `6 h: ${h6.alturaGrados}`);
  assert.ok(h9.alturaGrados > 45 && h9.alturaGrados < 55, `9 h: ${h9.alturaGrados}`);
  assert.ok(h9.azimutGrados < -40 && h15.azimutGrados > 40, 'mañana al este (negativo), tarde al oeste (positivo)');
  assert.ok(h0.alturaGrados < -20 && !h0.esDia);
  assert.equal(gh(172, 0), 0); assert.equal(gh(172, 23.5), 0);
});

test('cielo: irradiancia global a mediodía despejado según la estación', () => {
  const junio = gh(172, 12), dic = gh(355, 12);
  assert.ok(junio > 900 && junio < 1050, `junio ${junio}`);
  assert.ok(dic > 350 && dic < 600, `diciembre ${dic}`);
  assert.ok(gh(172, 12) > gh(172, 9) && gh(172, 9) > gh(172, 7), 'crece hacia el mediodía');
});

test('cielo: la nubosidad quita mucha directa y poca difusa', () => {
  const p = Sol.posicionSolar(172, 12), d = Sol.cieloDespejado(172, p.sinAltura);
  const medio = Sol.conNubosidad(d, 0.5), cubierto = Sol.conNubosidad(d, 1);
  assert.ok(medio.gbn < 0.45 * d.gbn && medio.gdh > d.gdh);
  assert.equal(cubierto.gbn, 0);
  assert.ok(cubierto.gh > 0.2 * d.gh && cubierto.gh < 0.35 * d.gh, `cielo cubierto ${cubierto.gh / d.gh}`);
  for (let n = 0; n < 1; n += 0.1) assert.ok(Sol.conNubosidad(d, n + 0.1).gh <= Sol.conNubosidad(d, n).gh + 1e-9, 'monótono con la nubosidad');
});

test('plano inclinado: campo A (15°) en junio ≈ horizontal; en diciembre el campo B (28°) recibe más que el horizontal', () => {
  const pj = Sol.posicionSolar(172, 12), cj = Sol.conNubosidad(Sol.cieloDespejado(172, pj.sinAltura), 0);
  const a = Sol.planoInclinado(pj, cj, CAMPOS.A.inclinacionGrados, CAMPOS.A.azimutGrados);
  assert.ok(Math.abs(a.g / cj.gh - 1) < 0.1, `A junio ${a.g / cj.gh}`);
  const pd = Sol.posicionSolar(355, 12), cd = Sol.conNubosidad(Sol.cieloDespejado(355, pd.sinAltura), 0);
  const b = Sol.planoInclinado(pd, cd, CAMPOS.B.inclinacionGrados, CAMPOS.B.azimutGrados), a2 = Sol.planoInclinado(pd, cd, CAMPOS.A.inclinacionGrados, CAMPOS.A.azimutGrados);
  assert.ok(b.g > cd.gh && b.g > a2.g, 'más inclinación, más en invierno');
  // Un plano orientado al norte no recibe directa con el sol al sur
  assert.equal(Sol.planoInclinado(pd, cd, 60, 180).directa, 0);
  // De noche todo es 0
  assert.equal(Sol.planoInclinado(Sol.posicionSolar(172, 1), Sol.cieloDespejado(172, -0.3), 15, 0).g, 0);
});

test('ambiente: la temperatura sube de 5 a 15 h y es mayor en julio que en enero', () => {
  assert.ok(Sol.temperaturaAmbiente(172, 15) > Sol.temperaturaAmbiente(172, 5) + 6);
  assert.ok(Sol.temperaturaAmbiente(200, 15) > Sol.temperaturaAmbiente(15, 15) + 10);
  const j = Sol.temperaturaAmbiente(172, 12);
  assert.ok(j > 22 && j < 34, `junio mediodía ${j}`);
});

test('reloj: texto con fecha y hora', () => {
  assert.equal(Sol.textoReloj(172, 9.5), '21 jun · 09:30');
  assert.equal(Sol.textoReloj(1, 0), '1 ene · 00:00');
  assert.equal(Sol.textoReloj(365, 23.99), '31 dic · 23:59');
  assert.equal(Sol.textoReloj(366, 8), '1 ene · 08:00');
});
