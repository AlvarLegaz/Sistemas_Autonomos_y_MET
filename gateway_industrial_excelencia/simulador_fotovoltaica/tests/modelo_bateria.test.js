'use strict';
// Batería LiFePO4: curva de tensión, balance de energía, BMS y resolución por potencia.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const L = require('../js/layout.js');
const { crearBateria, ocvCelda } = require('../js/modelo/bateria.js');

test('batería: la tensión de reposo crece con el SoC y es plana en el centro', () => {
  let ant = -1;
  for (let s = 0; s <= 100; s += 1) { const v = ocvCelda(s); assert.ok(v >= ant - 1e-12, `monótona en ${s}`); ant = v; }
  assert.ok(ocvCelda(80) - ocvCelda(20) < 0.15, 'meseta plana entre 20 y 80 %');
  assert.ok(ocvCelda(5) < 3.15 && ocvCelda(100) > 3.5, 'extremos con pendiente');
  const b = crearBateria({ socInicial01: 0.5 });
  assert.ok(b.ocv() > 25 && b.ocv() < 27, `reposo al 50 % ${b.ocv()}`);
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
