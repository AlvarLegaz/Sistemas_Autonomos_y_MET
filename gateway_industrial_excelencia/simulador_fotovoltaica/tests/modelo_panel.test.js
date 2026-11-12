'use strict';
// Panel y cadena: Voc/Isc/Pmpp contra datasheet en STC, temperatura e irradiancia, sombra parcial con diodos de paso, cadena abierta, curva I-V.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const L = require('../js/layout.js');
const Panel = require('../js/modelo/panel.js');
const Cadena = require('../js/modelo/cadena.js');

const cerca = (x, ref, relativa, msg) => assert.ok(Math.abs(x - ref) <= Math.abs(ref) * relativa, `${msg}: ${x} vs ${ref} (±${relativa * 100} %)`);

for (const [nombre, esp] of [['A', L.PANEL_A], ['B', L.PANEL_B]]) {
  test(`panel ${nombre}: Voc, Isc y Pmpp en STC coinciden con la hoja de datos`, () => {
    const m = Panel.mppPanel(esp, 1000, 25);
    cerca(m.voc, esp.voc, 0.01, 'Voc'); cerca(m.isc, esp.isc, 0.005, 'Isc'); cerca(m.p, esp.wp, 0.015, 'Pmpp');
    cerca(m.v, esp.vmp, 0.04, 'Vmp'); cerca(m.i, esp.imp, 0.04, 'Imp');
  });
  test(`panel ${nombre}: la potencia baja con la temperatura según coefPotencia y Isc sube con la irradiancia`, () => {
    const frio = Panel.mppPanel(esp, 1000, 25), calido = Panel.mppPanel(esp, 1000, 65);
    const coef = (calido.p / frio.p - 1) / 40;
    assert.ok(Math.abs(coef - esp.coefPotencia) < 0.0012, `coeficiente ${coef} vs ${esp.coefPotencia}`);
    cerca(Panel.mppPanel(esp, 500, 25).isc, esp.isc / 2, 0.01, 'Isc a 500 W/m²');
    assert.ok(Panel.mppPanel(esp, 200, 25).voc < frio.voc && Panel.mppPanel(esp, 200, 25).voc > 0.85 * frio.voc, 'Voc baja poco con la irradiancia');
    const oscuro = Panel.mppPanel(esp, 0, 25); assert.equal(oscuro.p, 0); assert.ok(Number.isFinite(oscuro.voc));
  });
}

/** Cadena de 3 paneles A a 1000 W/m² y 25 °C de célula (el ambiente se ajusta a la NOCT). */
function cadenaA({ sombras = {}, diodos = {}, g = 1000, gDif = 100, abierta = false, resistenciaExtraOhm = 0 } = {}) {
  const c = Cadena.crearCadena({ id: 'T', esp: L.PANEL_A, tags: ['P1', 'P2', 'P3'] });
  c.actualizar({ g, gDif, tAmbC: 25 - (L.PANEL_A.noctC - 20) / 800 * g, sombras, diodos, abierta, resistenciaExtraOhm });
  return c;
}
const picos = curva => { let n = 0; for (let k = 1; k < curva.length - 1; k++) if (curva[k].p > curva[k - 1].p + 1e-6 && curva[k].p >= curva[k + 1].p && curva[k].p > 0.05 * Math.max(...curva.map(q => q.p))) n++; return n; };

test('cadena: tres paneles en serie suman tensión (menos la caída de los cables)', () => {
  const c = cadenaA(), m = c.mpp();
  cerca(c.voc(), 3 * L.PANEL_A.voc, 0.01, 'Voc de la cadena');
  cerca(m.p, 3 * L.PANEL_A.wp - m.i * m.i * 0.12, 0.02, 'Pmpp de la cadena');
  cerca(c.iDeV(m.v), m.i, 0.01, 'I(V) en el MPP');
  assert.equal(c.iDeV(c.voc() + 1), 0);
});

test('cadena: sombra completa sobre una subcadena — el diodo de paso la salta y se pierde ≈ 1/9 de la potencia (no toda)', () => {
  const sana = cadenaA().mpp().p, c = cadenaA({ sombras: { P2: 0.34 } }), m = c.mpp();
  assert.ok(m.p > 0.8 * sana && m.p < 0.93 * sana, `con diodo ${m.p / sana}`);
  const det = c.detalle(m.i).find(q => q.tag === 'P2');
  assert.deepEqual(det.bypass, [true, false, false], 'el diodo de la primera subcadena conduce');
  assert.ok(c.voc() < cadenaA().voc() * 1.0 && c.voc() > 0.85 * cadenaA().voc(), 'Voc casi igual con sombra');
});

test('cadena: sombra sobre un panel entero y dos subcadenas — la curva P-V tiene dos máximos', () => {
  const c = cadenaA({ sombras: { P2: 0.7 } }), curva = c.curva(200);
  assert.ok(picos(curva) >= 2, `picos ${picos(curva)}`);
  const m = c.mpp(), maxCurva = Math.max(...curva.map(q => q.p));
  assert.ok(m.p >= maxCurva * 0.99, 'mpp() encuentra el máximo global de la curva');
});

test('cadena: con el diodo de paso abierto una sombra pequeña hunde toda la cadena', () => {
  const sana = cadenaA().mpp().p;
  const conDiodo = cadenaA({ sombras: { P2: 0.3 } }).mpp().p;
  const sinDiodo = cadenaA({ sombras: { P2: 0.3 }, diodos: { P2: ['abierto', 'ok', 'ok'] } }).mpp().p;
  assert.ok(conDiodo > 0.8 * sana, 'con diodo sano casi no se nota');
  assert.ok(sinDiodo < 0.45 * sana, `con diodo abierto cae a ${sinDiodo / sana}`);
  assert.ok(cadenaA({ diodos: { P2: ['abierto', 'ok', 'ok'] } }).mpp().p > 0.97 * sana, 'sin sombra el diodo abierto no se nota');
});

test('cadena: diodo de paso en cortocircuito anula una subcadena (pierde 1/9 de la tensión)', () => {
  const sana = cadenaA(), c = cadenaA({ diodos: { P1: ['corto', 'ok', 'ok'] } });
  cerca(c.voc(), sana.voc() * 8 / 9, 0.02, 'Voc');
  cerca(c.mpp().p, sana.mpp().p * 8 / 9, 0.03, 'potencia');
  assert.deepEqual(c.detalle(5).find(q => q.tag === 'P1').bypass, [true, false, false]);
});

test('cadena: abierta no da corriente, mantiene su Voc y su curva es plana', () => {
  const c = cadenaA({ abierta: true });
  assert.equal(c.iDeV(0), 0); assert.equal(c.iDeV(50), 0);
  assert.ok(c.voc() > 100);
  const curva = c.curva(30);
  assert.equal(curva.length, 30);
  assert.ok(curva.every(q => q.i === 0 && q.p === 0));
  cerca(curva[curva.length - 1].v, c.voc(), 1e-6, 'último punto en Voc');
});

test('cadena: la curva I-V es decreciente, va de Isc a Voc y su máximo coincide con el MPP', () => {
  const c = cadenaA(), curva = c.curva(80);
  assert.ok(curva[0].v <= 0.5 && Math.abs(curva[0].i - c.isc()) < 0.2, 'empieza en (0, Isc)');
  assert.ok(curva[curva.length - 1].v > 0.98 * c.voc() && curva[curva.length - 1].i < 0.2, 'acaba en (Voc, 0)');
  for (let k = 1; k < curva.length; k++) { assert.ok(curva[k].v >= curva[k - 1].v - 1e-9, 'v creciente'); assert.ok(curva[k].i <= curva[k - 1].i + 1e-6, 'i decreciente'); }
  cerca(Math.max(...curva.map(q => q.p)), c.mpp().p, 0.01, 'máximo de la curva P-V');
});

test('cadena: un conector con resistencia alta resta potencia (efecto de la avería)', () => {
  const sana = cadenaA().mpp().p, mala = cadenaA({ resistenciaExtraOhm: 1 }).mpp().p;
  assert.ok(mala < 0.96 * sana && mala > 0.85 * sana, `${mala / sana}`);
});

test('cadena: sin luz no hay NaN y la potencia es 0', () => {
  const c = cadenaA({ g: 0, gDif: 0 });
  assert.equal(c.mpp().p, 0); assert.equal(c.iDeV(10), 0);
  assert.ok(c.curva(10).every(q => Number.isFinite(q.v) && Number.isFinite(q.i) && q.p === 0));
});

test('mismatch: dos paneles con distinta corriente limitan la cadena al peor', () => {
  const c = Cadena.crearCadena({ id: 'T', esp: L.PANEL_A, tags: ['P1', 'P2', 'P3'], desajustes: [1, 0.9, 1] });
  c.actualizar({ g: 1000, gDif: 100, tAmbC: -7.5 });
  const m = c.mpp(), sana = cadenaA().mpp().p;
  assert.ok(m.p < 0.97 * sana && m.p > 0.8 * sana, `${m.p / sana}`);
});
