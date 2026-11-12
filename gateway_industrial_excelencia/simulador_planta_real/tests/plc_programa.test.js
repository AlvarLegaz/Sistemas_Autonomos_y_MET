'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { crearMemoria, ejecutarPLC } = require('../js/plc/programa.js');
const { CONSTANTES: C } = require('../js/configuracion/constantes.js');
const layout = require('../js/layout.js');

/** Entradas de una planta en producción sana (valores del PLC y contactos auxiliares coherentes). */
function sanas(cambios = {}) {
  const v = { 'TT-101': 4, 'TT-102': 64.5, 'TT-103': 73.5, 'TT-104': 5, 'TT-201': 76, 'FT-101': 2000, 'PT-101': 1.3, 'PT-102': 1.8, 'LT-101': 60 };
  const AI = {};
  for (const s of layout.SENALES.filter(x => x.tipo === 'AI')) { const val = (cambios.valores || {})[s.tag] != null ? cambios.valores[s.tag] : v[s.tag]; AI[s.tag] = { valor: val, mA: layout.aMilisamperios(val, s.rango[0], s.rango[1]), calidad: (cambios.calidad || {})[s.tag] || 'OK' }; }
  const DI = { 'ES-001': 1, 'TSH-201': 1, 'LSH-101': 0, 'LSL-101': 1, 'ZS-101': 1, 'ZS-102': 0, 'PSL-501': 1, 'P-101': 1, 'KM-203': 1, 'KM-201': 1, 'KM-202': 0, 'VFD-101': 0, 'QF-201': 1, 'PS-001': 1, 'PB-001': 0 };
  Object.assign(DI, cambios.DI || {});
  return { AI, DI, fijas: Object.keys(cambios.DI || {}) };      // fijas: entradas que la prueba fuerza (no siguen a las órdenes)
}
const REALIMENTACION = { 'ZS-101': d => d['SV-101'], 'ZS-102': d => 1 - d['SV-101'], 'KM-203': d => d['P-201'], 'KM-201': d => d['KM-201'], 'KM-202': d => d['KM-202'], 'P-101': d => d['P-101'] };
/**
 * Ejecuta n ciclos y devuelve el último resultado. Cierra el lazo como la planta real: los finales de carrera de la FDV y los contactos auxiliares
 * siguen a las órdenes del ciclo anterior, salvo las entradas que la prueba fuerza (`fijas`). `siempre`: repite las órdenes en cada ciclo.
 */
function correr(mem, ent, ord, n, dt = 0.1, siempre = false) {
  let r;
  for (let i = 0; i < n; i++) {
    for (const [tag, f] of Object.entries(REALIMENTACION)) if (!ent.fijas.includes(tag) && i + (mem.tS > 0 ? 1 : 0) > 0) ent.DI[tag] = f(mem.ultimas.DO);
    r = ejecutarPLC(ent, mem, i === 0 || siempre ? ord : {}, dt);
  }
  return r;
}
/** Memoria ya en PRODUCCION con las entradas sanas y la FDV en avance (los auxiliares siguen a las órdenes). */
function enProduccion() { const mem = crearMemoria(); const r = correr(mem, sanas(), { modo: 'PRODUCCION' }, 5); return { mem, r }; }

test('en PARADA todas las salidas están a 0 salvo la reposición automática de niveles (XV-101 con el tanque por debajo del 85 %)', () => {
  const r = correr(crearMemoria(), sanas(), {}, 5);
  assert.equal(r.modo, 'PARADA');
  for (const [tag, v] of Object.entries(r.DO)) assert.equal(v, tag === 'XV-101' ? 1 : 0, tag);
  assert.equal(r.AO['VFD-101'], 0);
});

test('arrancar pone recirculación: P-101 y P-201 en marcha y la velocidad sale de la consigna de caudal', () => {
  const r = correr(crearMemoria(), sanas(), { arrancar: true, consignaCaudalLh: 2000 }, 3);
  assert.equal(r.modo, 'RECIRCULACION_AGUA');
  assert.equal(r.DO['P-101'], 1); assert.equal(r.DO['P-201'], 1);
  assert.ok(Math.abs(r.AO['VFD-101'] - 80) < 1e-9);
});

test('pasa solo de recirculación a producción tras 20 s con todas las condiciones', () => {
  const mem = crearMemoria();
  let r = correr(mem, sanas(), { arrancar: true }, 150);                  // 15 s
  assert.equal(r.modo, 'RECIRCULACION_AGUA');
  r = correr(mem, sanas(), {}, 80);                                       // 8 s más: 23 s
  assert.equal(r.modo, 'PRODUCCION');
  assert.equal(r.DO['SV-101'], 1);
});

test('FDV de seguridad positiva: cada condición que falla manda la válvula a desvío (SV-101 = 0)', () => {
  const casos = {
    'TT-103 a 71,9 °C': sanas({ valores: { 'TT-103': 71.9 } }),
    'tiempo de residencia corto (caudal alto)': sanas({ valores: { 'FT-101': 2900 } }),
    'diferencial de regeneración bajo': sanas({ valores: { 'PT-102': 1.34 } }),
    'aire bajo': sanas({ DI: { 'PSL-501': 0 } }),
    'TT-103 con el lazo abierto': sanas({ calidad: { 'TT-103': 'ABIERTO' } }),
    'FT-101 con el lazo en sobreescala': sanas({ calidad: { 'FT-101': 'CORTO' } }),
    'PT-101 con el lazo abierto': sanas({ calidad: { 'PT-101': 'ABIERTO' } }),
  };
  for (const [nombre, ent] of Object.entries(casos)) {
    const { mem } = enProduccion();
    const r = correr(mem, ent, {}, 1);
    assert.equal(r.DO['SV-101'], 0, nombre);
  }
  const ok = enProduccion();
  assert.equal(correr(ok.mem, sanas(), {}, 1).DO['SV-101'], 1);
});

test('histéresis: entrar en avance pide 72,5 °C y se mantiene mientras haya 72,2 °C (margen para que la FDV tarde en moverse)', () => {
  const mem = crearMemoria();
  correr(mem, sanas({ valores: { 'TT-103': 70 } }), { modo: 'PRODUCCION' }, 3);                   // empieza en desvío (70 °C)
  assert.equal(correr(mem, sanas({ valores: { 'TT-103': 72.4 } }), {}, 3).DO['SV-101'], 0);      // desde desvío no entra con 72,4
  assert.equal(correr(mem, sanas({ valores: { 'TT-103': 72.6 } }), {}, 3).DO['SV-101'], 1);      // sí con 72,6
  assert.equal(correr(mem, sanas({ valores: { 'TT-103': 72.3 } }), {}, 3).DO['SV-101'], 1);      // y ya en avance se mantiene con 72,3
  assert.equal(correr(mem, sanas({ valores: { 'TT-103': 72.1 } }), {}, 3).DO['SV-101'], 0);      // pero con 72,1 se desvía antes de bajar de 72,0
});

test('si en producción no se cumplen las condiciones durante 10 s vuelve a recirculación y avisa con A210', () => {
  const { mem } = enProduccion();
  let r = correr(mem, sanas({ valores: { 'TT-103': 60 } }), {}, 60);
  assert.equal(r.modo, 'PRODUCCION');
  r = correr(mem, sanas({ valores: { 'TT-103': 60 } }), {}, 60);
  assert.equal(r.modo, 'RECIRCULACION_AGUA');
  assert.ok(r.alarmas.some(a => a.codigo === 'A210'));
});

test('el paro de emergencia se enclava: apaga todo, enciende la baliza y solo se rearma con el pulsador y sin motivo', () => {
  const { mem } = enProduccion();
  let r = correr(mem, sanas({ DI: { 'ES-001': 0 } }), {}, 2);
  assert.equal(r.paro, true); assert.deepEqual(r.motivosParo, ['ES-001']);
  for (const [tag, v] of Object.entries(r.DO)) assert.equal(v, tag === 'HL-001' ? 1 : 0, tag);
  r = correr(mem, sanas(), {}, 5);                                       // ES rearmado pero sin pulsar: sigue en paro
  assert.equal(r.paro, true);
  r = correr(mem, sanas({ DI: { 'ES-001': 0 } }), { pulsadores: ['PB-001'] }, 2);   // pulsa, pero el motivo sigue
  assert.equal(r.paro, true);
  r = correr(mem, sanas(), { pulsadores: ['PB-001'] }, 2);
  assert.equal(r.paro, false); assert.equal(r.modo, 'PARADA');
});

test('termostato abierto, fuente caída, fallo de variador y magnetotérmico disparan el paro', () => {
  const motivos = { 'TSH-201': { 'TSH-201': 0 }, 'PS-001': { 'PS-001': 0 }, 'VFD-101': { 'VFD-101': 1 }, 'QF-201': { 'QF-201': 0 } };
  for (const [motivo, DI] of Object.entries(motivos)) {
    const { mem } = enProduccion();
    const r = correr(mem, sanas({ DI }), {}, 2);
    assert.equal(r.paro, true, motivo); assert.ok(r.motivosParo.includes(motivo), motivo);
    assert.equal(r.DO['KM-201'], 0); assert.equal(r.DO['P-101'], 0);
  }
});

test('calentamiento: bancos por todo/nada con histéresis y el banco 2 solo cuando falta mucho', () => {
  const frio = correr(crearMemoria(), sanas({ valores: { 'TT-201': 60 } }), { arrancar: true }, 3);
  assert.equal(frio.DO['KM-201'], 1); assert.equal(frio.DO['KM-202'], 1);
  const casiBien = correr(crearMemoria(), sanas({ valores: { 'TT-201': 73 } }), { arrancar: true }, 3);
  assert.equal(casiBien.DO['KM-201'], 1); assert.equal(casiBien.DO['KM-202'], 0);
  const caliente = correr(crearMemoria(), sanas({ valores: { 'TT-201': 80 } }), { arrancar: true }, 3);
  assert.equal(caliente.DO['KM-201'], 0);
});

test('el calentamiento exige P-201 confirmada (KM-203), termostato normal y lazo sano de TT-201', () => {
  const base = { valores: { 'TT-201': 60 } };
  assert.equal(correr(crearMemoria(), sanas(Object.assign({}, base, { DI: { 'KM-203': 0 } })), { arrancar: true }, 3).DO['KM-201'], 0);
  assert.equal(correr(crearMemoria(), sanas(Object.assign({}, base, { calidad: { 'TT-201': 'ABIERTO' } })), { arrancar: true }, 3).DO['KM-201'], 0);
  assert.equal(correr(crearMemoria(), sanas({ valores: { 'TT-201': 89 } }), { arrancar: true }, 3).DO['KM-201'], 0);   // límite por software
});

test('cascada: si TT-103 va por debajo de la consigna sube la consigna del agua; con TT-103 en fallo no se integra', () => {
  const mem = crearMemoria();
  const normal = correr(mem, sanas({ valores: { 'TT-103': 73.5, 'TT-201': 70 } }), { arrancar: true }, 3).consignaAguaC;
  const bajo = correr(mem, sanas({ valores: { 'TT-103': 70.5, 'TT-201': 70 } }), {}, 600).consignaAguaC;
  assert.ok(bajo > normal + 2, `${bajo} vs ${normal}`);
  assert.ok(bajo <= 86);
  const memFallo = crearMemoria();
  const fallo = correr(memFallo, sanas({ valores: { 'TT-201': 70 }, calidad: { 'TT-103': 'ABIERTO' } }), { arrancar: true }, 50).consignaAguaC;
  assert.equal(fallo, C.plc.consignaAguaBaseC);
});

test('el mando manual no salta los enclavamientos: con el termostato abierto nada calienta', () => {
  const mem = crearMemoria();
  correr(mem, sanas(), { arrancar: true }, 3);
  const r = correr(mem, sanas({ DI: { 'TSH-201': 0 } }), { manual: { 'KM-201': 1, 'KM-202': 1 } }, 5, 0.1, true);
  assert.equal(r.paro, true); assert.equal(r.DO['KM-201'], 0); assert.equal(r.DO['KM-202'], 0);
  const mem2 = crearMemoria();
  correr(mem2, sanas({ valores: { 'TT-201': 76 } }), { arrancar: true }, 3);
  const ok = correr(mem2, sanas({ valores: { 'TT-201': 76 } }), { manual: { 'KM-202': 1, 'XV-401': 1 } }, 5, 0.1, true);
  assert.equal(ok.DO['KM-202'], 1); assert.equal(ok.DO['XV-401'], 1);
  const mem3 = crearMemoria();
  correr(mem3, sanas({ DI: { 'PSL-501': 0 } }), { arrancar: true }, 3);
  const sinAire = correr(mem3, sanas({ DI: { 'PSL-501': 0 } }), { manual: { 'SV-101': 1 } }, 5, 0.1, true);
  assert.equal(sinAire.DO['SV-101'], 0);
});

test('CIP: recorre sus pasos por tiempos con XV-401 abierta, la FDV en avance y termina en PARADA', () => {
  const mem = crearMemoria();
  let r = correr(mem, sanas(), { modo: 'CIP' }, 1, 1);
  assert.equal(r.modo, 'CIP'); assert.equal(r.DO['XV-401'], 1); assert.equal(r.DO['SV-101'], 1); assert.equal(r.cip.nombre, 'ENJUAGUE_1');
  const total = C.cip.pasos.reduce((s, p) => s + p.duracionS, 0);
  const vistos = new Set();
  for (let t = 0; t < total + 5 && mem.modo === 'CIP'; t++) { r = ejecutarPLC(sanas(), mem, {}, 1); if (r.cip.nombre) vistos.add(r.cip.nombre); }
  assert.deepEqual([...vistos], C.cip.pasos.map(p => p.nombre));
  assert.equal(mem.modo, 'PARADA');
});

test('discrepancias: contactor que no sigue la orden → A130; FDV que no sigue → A120 y paro', () => {
  const mem = crearMemoria();
  correr(mem, sanas({ valores: { 'TT-201': 60 } }), { arrancar: true }, 2);               // ordena KM-201 = 1
  const r = correr(mem, sanas({ valores: { 'TT-201': 60 }, DI: { 'KM-201': 0 } }), {}, 40);   // el auxiliar nunca cierra
  assert.ok(r.alarmas.some(a => a.codigo === 'A130' && a.tag === 'KM-201'));
  const m2 = enProduccion().mem;
  const r2 = correr(m2, sanas({ DI: { 'ZS-101': 1, 'ZS-102': 0 } }), { parar: true }, 40);   // pide desvío y la válvula se queda atascada en avance
  assert.ok(r2.alarmas.some(a => a.codigo === 'A120')); assert.equal(r2.paro, true); assert.ok(r2.motivosParo.includes('FDV-101')); assert.equal(r2.DO['P-101'], 0);
  const m3 = enProduccion().mem;
  const r3 = correr(m3, sanas({ DI: { 'ZS-101': 0, 'ZS-102': 1 } }), {}, 40);               // pide avance y la válvula no sale de desvío (bobina abierta)
  assert.equal(r3.paro, true);                                                                // se enclava aunque luego la orden pase a desvío
});

test('alarmas: lazo abierto A101, sobreescala A102, diferencial A110, aire A160 y nivel bajo A200', () => {
  const r = correr(crearMemoria(), sanas({ calidad: { 'TT-201': 'ABIERTO', 'TT-104': 'CORTO' }, DI: { 'PSL-501': 0 } }), { arrancar: true }, 3);
  const tiene = (c, t) => r.alarmas.some(a => a.codigo === c && a.tag === t);
  assert.ok(tiene('A101', 'TT-201')); assert.ok(tiene('A102', 'TT-104')); assert.ok(tiene('A160', 'PSL-501'));
  const dp = correr(crearMemoria(), sanas({ valores: { 'PT-102': 1.31 } }), { arrancar: true }, 3);
  assert.ok(dp.alarmas.some(a => a.codigo === 'A110'));
  const nivel = correr(crearMemoria(), sanas({ DI: { 'LSL-101': 0 } }), { arrancar: true }, 3);
  assert.ok(nivel.alarmas.some(a => a.codigo === 'A200')); assert.equal(nivel.DO['P-101'], 0);
});

test('la planta no tiene booster: el PLC no genera ninguna salida para P-103', () => {
  const { r } = enProduccion();
  assert.equal(r.DO['P-103'], undefined);
  assert.equal(r.DO['P-101'], 1); assert.equal(r.DO['P-201'], 1);
});

test('las alarmas conservan el instante en que aparecieron', () => {
  const mem = crearMemoria();
  correr(mem, sanas({ calidad: { 'TT-201': 'ABIERTO' } }), { arrancar: true }, 10);
  const antes = mem.alarmas.find(a => a.codigo === 'A101').desdeS;
  correr(mem, sanas({ calidad: { 'TT-201': 'ABIERTO' } }), {}, 50);
  assert.equal(mem.alarmas.find(a => a.codigo === 'A101').desdeS, antes);
});
