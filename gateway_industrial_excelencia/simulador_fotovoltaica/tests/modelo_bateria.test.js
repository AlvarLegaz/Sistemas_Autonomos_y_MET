'use strict';
// Batería LiFePO4: curva de tensión, balance de energía, BMS y resolución por potencia.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const L = require('../js/layout.js');
const { crearBateria, ocvCelda, limiteCargaA } = require('../js/modelo/bateria.js');

test('batería: la tensión de reposo crece con el SoC y es plana en el centro', () => {
  let ant = -1;
  for (let s = 0; s <= 100; s += 1) { const v = ocvCelda(s); assert.ok(v >= ant - 1e-12, `monótona en ${s}`); ant = v; }
  assert.ok(ocvCelda(80) - ocvCelda(20) < 0.15, 'meseta plana entre 20 y 80 %');
  assert.ok(ocvCelda(5) < 3.15 && ocvCelda(0) < 2.6 && ocvCelda(100) >= 3.39, 'extremos con pendiente');
  const b = crearBateria({ socInicial01: 0.5 });
  assert.ok(b.ocv() > 25 && b.ocv() < 27, `reposo al 50 % ${b.ocv()}`);
});

test('batería: tensiones de reposo reales de LiFePO4 (27,2 V a plena carga, ~26,4 V al 50 %, ~25,6 V al 10 %) y absorción a 28,4 V', () => {
  const v = s => crearBateria({ socInicial01: s / 100 }).ocvReposo();
  assert.ok(Math.abs(v(100) - 27.2) < 0.15, `100 %: ${v(100)}`);
  assert.ok(v(50) > 26.2 && v(50) < 26.7, `50 %: ${v(50)}`);
  assert.ok(v(10) > 25.4 && v(10) < 25.8, `10 %: ${v(10)}`);
  assert.ok(v(0) < 20.5 && v(2) < 23.9, 'rodilla inferior');
  const cargando = crearBateria({ socInicial01: 0.99 });
  for (let t = 0; t < 600; t += 5) cargando.paso(5, 20, 25);
  assert.ok(cargando.ocv() > 27.8, `con carga sostenida la tensión sin corriente sube sobre la de reposo: ${cargando.ocv()}`);
  const antes = cargando.ocv();
  for (let t = 0; t < 1800; t += 5) cargando.paso(5, 0, 25);
  assert.ok(cargando.ocv() < antes - 0.4 && cargando.ocv() < 27.5, `en reposo vuelve a ~27,2 V: ${cargando.ocv()}`);
});

test('batería: rendimiento de ida y vuelta de 94-96 % (20 → 90 % → 20 % a ±25 A)', () => {
  const b = crearBateria({ socInicial01: 0.2 }); let entra = 0, sale = 0;
  while (b.soc01 < 0.9) { entra += b.vTerm(25) * 25 * 5 / 3600; b.paso(5, 25, 25); }
  for (let t = 0; t < 1200; t += 5) b.paso(5, 0, 25);
  while (b.soc01 > 0.2) { sale += -b.vTerm(-25) * -25 * 5 / 3600; b.paso(5, -25, 25); }
  const eta = sale / entra;                                                          // energía en terminales: la que sale entre la que entró
  assert.ok(eta > 0.93 && eta < 0.97, `ida y vuelta ${(eta * 100).toFixed(1)} %`);
});

test('batería: el BMS limita la corriente de carga con frío y no carga bajo 0 °C', () => {
  const b = crearBateria({ socInicial01: 0.5 });
  assert.equal(limiteCargaA(-2), 0); assert.equal(limiteCargaA(3), 10);
  assert.ok(limiteCargaA(12) > 30 && limiteCargaA(12) < 70);
  assert.equal(limiteCargaA(25), L.BATERIA.corrienteMaxCargaA);
  b.tC = -3; assert.equal(b.permiteCarga(), false); assert.equal(b.permiteDescarga(), true);
  b.tC = 25; assert.equal(b.permiteCarga(), true);
  assert.ok(b.energiaUtilWh() > 0 && Math.abs(b.energiaUtilWh() - 0.4 * L.BATERIA.energiaWh) < 1e-6, 'energía útil sobre el 10 %');
});

test('batería: cargando la tensión sube sobre el reposo y descargando baja (resistencia interna)', () => {
  const b = crearBateria({ socInicial01: 0.5 });
  assert.ok(b.vTerm(50) > b.ocv() + 0.4 && b.vTerm(-50) < b.ocv() - 0.4);
  assert.ok(Math.abs(b.vTerm(0) - b.ocv()) < 1e-9);
});

test('batería: iDePotencia da la corriente cuya potencia en terminales es la pedida', () => {
  const b = crearBateria({ socInicial01: 0.6 });
  for (const p of [-2000, -300, 0, 400, 1500]) { const i = b.iDePotencia(p); assert.ok(Math.abs(b.vTerm(i) * i - p) < 1e-6, `p=${p}`); }
});

test('batería: balance de energía al cargar y descargar (lo almacenado ≈ lo entregado menos pérdidas)', () => {
  const b = crearBateria({ socInicial01: 0.2 });
  const e0 = b.energiaWh(); let entrada = 0;
  for (let t = 0; t < 3600; t += 5) { const i = 40; entrada += b.vTerm(i) * i * 5 / 3600; b.paso(5, i, 25); }
  const almacenado = b.energiaWh() - e0;
  assert.ok(almacenado > 0.88 * entrada && almacenado < entrada, `cargada ${almacenado} de ${entrada} Wh`);
  const e1 = b.energiaWh(); let salida = 0;
  for (let t = 0; t < 3600; t += 5) { const i = -40; salida += -b.vTerm(i) * i * 5 / 3600; b.paso(5, i, 25); }
  const perdido = e1 - b.energiaWh();
  assert.ok(salida < perdido * 1.02 && salida > 0.9 * perdido, `entregada ${salida} de ${perdido} Wh`);
  assert.ok(b.soc01 > 0.15 && b.soc01 < 0.3, 'vuelve cerca del SoC inicial');
});

test('batería: el SoC nunca sale de 0–1 y hay carga con rendimiento < 100 %', () => {
  const b = crearBateria({ socInicial01: 0.99 });
  for (let t = 0; t < 7200; t += 5) b.paso(5, 50, 25);
  assert.ok(b.soc01 <= 1);
  const c = crearBateria({ socInicial01: 0.01 });
  for (let t = 0; t < 7200; t += 5) c.paso(5, -50, 25);
  assert.ok(c.soc01 >= 0);
  const d = crearBateria({ socInicial01: 0.5 }); d.paso(3600, 20, 25);
  assert.ok(Math.abs(d.soc01 - (0.5 + 20 * 0.985 / 100)) < 0.01, 'ΔSoC = I·t·η / C');
});

test('BMS: corta la descarga por baja tensión de celda y vuelve al cargar; el rendimiento no cambia con la corriente de carga permitida', () => {
  const b = crearBateria({ socInicial01: 0.0 });
  b.paso(5, -100, 25);
  assert.equal(b.bms, 'CORTE_BAJA'); assert.equal(b.permiteDescarga(), false); assert.equal(b.permiteCarga(), true);
  b.soc01 = 0.05; b.paso(5, 5, 25);
  assert.equal(b.bms, 'OK');
});

test('BMS: celda desequilibrada corta antes en descarga y en carga', () => {
  const bueno = crearBateria({ socInicial01: 0.10 }), malo = crearBateria({ socInicial01: 0.10 }); malo.desequilibrada = true;
  bueno.paso(5, -60, 25); malo.paso(5, -60, 25);
  assert.equal(bueno.bms, 'OK'); assert.equal(malo.bms, 'CORTE_BAJA');
  assert.ok(malo.vCeldaMax - malo.vCeldaMin > 0.4 * (bueno.vCeldaMax - bueno.vCeldaMin) && malo.vCeldaMax - malo.vCeldaMin > 0.1);
  const alto = crearBateria({ socInicial01: 0.97 }), alto2 = crearBateria({ socInicial01: 0.97 }); alto2.desequilibrada = true;
  alto.paso(5, 30, 25); alto2.paso(5, 30, 25);
  assert.equal(alto.bms, 'OK'); assert.equal(alto2.bms, 'CORTE_ALTA'); assert.equal(alto2.permiteCarga(), false);
});

test('BMS: sobrecorriente corta 10 s y reintenta; el corte forzado de la avería', () => {
  const b = crearBateria({ socInicial01: 0.5 });
  b.paso(1, -(L.BATERIA.corrienteMaxDescargaA * 1.3), 25);
  assert.equal(b.bms, 'CORTE_CORRIENTE');
  b.paso(5, 0, 25); assert.equal(b.bms, 'CORTE_CORRIENTE');
  b.paso(6, 0, 25); assert.equal(b.bms, 'OK');
  b.bmsForzado = true; b.paso(1, 0, 25); assert.equal(b.bms, 'CORTE_BAJA');
  b.bmsForzado = false; b.soc01 = 0.5; b.paso(1, 0, 25); assert.equal(b.bms, 'OK');
});
