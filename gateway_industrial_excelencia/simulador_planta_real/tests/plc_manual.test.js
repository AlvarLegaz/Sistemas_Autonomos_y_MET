'use strict';
// Modo MANUAL del PLC y reposición automática de niveles (llenados y vaciados). Mismo estilo que plc_programa.test.js.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { crearMemoria, ejecutarPLC, DO_MANUALES } = require('../js/plc/programa.js');
const { CONSTANTES: C } = require('../js/configuracion/constantes.js');
const layout = require('../js/layout.js');

function sanas(cambios = {}) {
  const v = { 'TT-101': 4, 'TT-102': 64.5, 'TT-103': 73.5, 'TT-104': 5, 'TT-201': 60, 'FT-101': 2000, 'PT-101': 1.3, 'PT-102': 1.8, 'LT-101': 60 };
  const AI = {};
  for (const s of layout.SENALES.filter(x => x.tipo === 'AI')) {
    const val = (cambios.valores || {})[s.tag] != null ? cambios.valores[s.tag] : v[s.tag];
    AI[s.tag] = { valor: val, mA: layout.aMilisamperios(val, s.rango[0], s.rango[1]), calidad: 'OK' };
  }
  const DI = { 'ES-001': 1, 'TSH-201': 1, 'LSH-101': 0, 'LSL-101': 1, 'LSL-201': 1, 'ZS-101': 0, 'ZS-102': 1, 'PSL-501': 1, 'P-101': 0, 'KM-203': 0, 'KM-201': 0, 'KM-202': 0, 'VFD-101': 0, 'QF-201': 1, 'PS-001': 1, 'PB-001': 0 };
  Object.assign(DI, cambios.DI || {});
  return { AI, DI, fijas: cambios.DI || {} };
}
// Los contactos auxiliares siguen a las órdenes del ciclo anterior (como la planta real), salvo los que la prueba fuerza.
function correr(mem, ent, ord, n, dt = 0.1, siempre = true) {
  let r;
  for (let i = 0; i < n; i++) {
    const d = mem.ultimas.DO;
    Object.assign(ent.DI, { 'KM-203': d['P-201'], 'KM-201': d['KM-201'], 'KM-202': d['KM-202'], 'P-101': d['P-101'], 'ZS-101': d['SV-101'], 'ZS-102': 1 - d['SV-101'] }, ent.fijas);
    r = ejecutarPLC(ent, mem, i === 0 || siempre ? ord : {}, dt);
  }
  return r;
}
const manual = (mem, ent, ordenes, n = 5) => correr(mem, ent, { manual: ordenes }, n);
function enManual(ent = sanas(), ordenes = {}) {
  const mem = crearMemoria(); correr(mem, ent, { modo: 'MANUAL' }, 3, 0.1, false);
  return { mem, ent, r: manual(mem, ent, ordenes) };
}

test('MODOS incluye MANUAL y cada modo tiene su descripción y lo que automatiza', () => {
  assert.deepEqual(layout.MODOS, ['PARADA', 'MANUAL', 'RECIRCULACION_AGUA', 'PRODUCCION', 'CIP']);
  for (const m of layout.MODOS) { assert.ok(layout.MODOS_INFO[m].nombre); assert.ok(layout.MODOS_INFO[m].descripcion); assert.ok(layout.MODOS_INFO[m].automatiza); }
});

test('en MANUAL el PLC no automatiza nada: sin órdenes todo queda apagado y el operador manda cada salida', () => {
  const { r } = enManual();
  assert.equal(r.modo, 'MANUAL');
  for (const tag of DO_MANUALES) assert.equal(r.DO[tag], 0, tag);
  assert.equal(r.AO['VFD-101'], 0);
  for (const tag of DO_MANUALES) {
    if (['KM-201', 'KM-202', 'SV-101', 'P-101'].includes(tag)) continue;        // estas tienen protecciones propias (se prueban aparte)
    const ent = sanas(); const mem = crearMemoria(); correr(mem, ent, { modo: 'MANUAL' }, 3, 0.1, false);
    assert.equal(manual(mem, ent, { [tag]: 1 }).DO[tag], 1, `${tag} manual`);
  }
});

test('MANUAL: la velocidad del variador manda directamente (0-100 %) y la consigna de caudal automática no cuenta', () => {
  const ent = sanas(); const { mem } = enManual(ent);
  let r = manual(mem, ent, { 'P-101': 1, 'VFD-101': 35 });
  assert.equal(r.DO['P-101'], 1); assert.equal(r.AO['VFD-101'], 35);
  r = manual(mem, ent, { 'VFD-101': 250 }); assert.equal(r.AO['VFD-101'], 100);
  r = manual(mem, ent, { 'VFD-101': -4 }); assert.equal(r.AO['VFD-101'], 0);
  r = correr(mem, ent, { consignaCaudalLh: 1500, manual: {} }, 3);
  assert.equal(r.AO['VFD-101'], 0, 'la consigna de caudal es del modo automático');
});

test('MANUAL: el operador manda la FDV, el calentador y las válvulas de llenado y vaciado', () => {
  const ent = sanas(); const { mem } = enManual(ent, { 'P-201': 1 });
  const r = manual(mem, ent, { 'P-201': 1, 'KM-201': 1, 'KM-202': 1, 'SV-101': 1, 'XV-301': 1, 'XV-401': 1, 'XV-101': 1, 'XV-102': 1, 'XV-201': 1, 'XV-202': 1 }, 10);
  for (const tag of ['KM-201', 'KM-202', 'SV-101', 'XV-301', 'XV-401', 'XV-101', 'XV-102', 'XV-201', 'XV-202']) assert.equal(r.DO[tag], 1, tag);
});

test('MANUAL no repone niveles ni gobierna la FDV: con el tanque casi vacío XV-101 sigue cerrada y la FDV en desvío', () => {
  const ent = sanas({ valores: { 'LT-101': 30, 'TT-103': 74 } }); const { r } = enManual(ent);
  assert.equal(r.DO['XV-101'], 0); assert.equal(r.DO['SV-101'], 0);
  const auto = crearMemoria(); const a = correr(auto, sanas({ valores: { 'LT-101': 30 } }), {}, 3);
  assert.equal(a.DO['XV-101'], 1, 'en automático sí repone');
});

test('transferencia sin saltos: al pasar a MANUAL cada actuador conserva lo que hacía, y al volver a automático se sueltan las órdenes', () => {
  const ent = sanas(); const mem = crearMemoria();
  let r = correr(mem, ent, { arrancar: true, consignaCaudalLh: 2000 }, 5, 0.1, false);
  assert.equal(r.DO['P-101'], 1); assert.equal(r.DO['P-201'], 1);
  const vfd = r.AO['VFD-101']; assert.ok(vfd > 50);
  r = correr(mem, ent, { modo: 'MANUAL' }, 5, 0.1, false);
  assert.equal(r.modo, 'MANUAL');
  assert.equal(r.DO['P-101'], 1); assert.equal(r.DO['P-201'], 1); assert.equal(r.AO['VFD-101'], vfd);
  r = manual(mem, ent, { 'P-101': 0, 'VFD-101': 10 });
  assert.equal(r.DO['P-101'], 0); assert.equal(r.AO['VFD-101'], 10);
  r = correr(mem, ent, { modo: 'RECIRCULACION_AGUA' }, 5, 0.1, false);
  assert.equal(r.modo, 'RECIRCULACION_AGUA'); assert.equal(r.DO['P-101'], 1); assert.equal(r.DO['P-201'], 1);
});

// ------------------------------ protecciones cableadas que se mantienen en MANUAL
test('MANUAL: el termostato abierto corta el calentador pero no para el resto de la planta', () => {
  const ent = sanas({ DI: { 'TSH-201': 0 } }); const mem = crearMemoria();
  correr(mem, ent, { modo: 'MANUAL' }, 3, 0.1, false);
  const r = manual(mem, ent, { 'P-201': 1, 'KM-201': 1, 'KM-202': 1, 'P-101': 1, 'VFD-101': 50 });
  assert.equal(r.DO['KM-201'], 0); assert.equal(r.DO['KM-202'], 0);
  assert.equal(r.DO['P-101'], 1, 'el resto de la planta sigue a mano'); assert.equal(r.paro, false);
  assert.ok(r.alarmas.some(a => a.codigo === 'A170'));
});

test('MANUAL: el calentador se corta sin nivel (LSL-201), sin P-201 en marcha o con el agua pasada de 88 °C', () => {
  const caso = (ent, ordenes) => { const mem = crearMemoria(); correr(mem, ent, { modo: 'MANUAL' }, 3, 0.1, false); return manual(mem, ent, ordenes, 10); };
  assert.equal(caso(sanas(), { 'P-201': 1, 'KM-201': 1 }).DO['KM-201'], 1, 'con todo en regla conecta');
  assert.equal(caso(sanas({ DI: { 'LSL-201': 0 } }), { 'P-201': 1, 'KM-201': 1 }).DO['KM-201'], 0, 'sin nivel');
  assert.equal(caso(sanas(), { 'KM-201': 1 }).DO['KM-201'], 0, 'sin P-201');
  assert.equal(caso(sanas({ valores: { 'TT-201': 89 } }), { 'P-201': 1, 'KM-201': 1 }).DO['KM-201'], 0, 'agua demasiado caliente');
  assert.ok(caso(sanas({ DI: { 'LSL-201': 0 } }), {}).alarmas.some(a => a.codigo === 'A230'));
});

test('MANUAL: marcha en seco de P-101 (tanque vacío) o fallo del variador paran P-101', () => {
  const caso = ent => { const mem = crearMemoria(); correr(mem, ent, { modo: 'MANUAL' }, 3, 0.1, false); return manual(mem, ent, { 'P-101': 1, 'VFD-101': 60 }, 10); };
  assert.equal(caso(sanas()).DO['P-101'], 1);
  assert.equal(caso(sanas({ DI: { 'LSL-101': 0 } })).DO['P-101'], 0);
  assert.equal(caso(sanas({ DI: { 'VFD-101': 1 } })).DO['P-101'], 0);
});

test('MANUAL: sin aire la FDV va a desvío aunque el operador la pida en avance', () => {
  const ent = sanas({ DI: { 'PSL-501': 0 } }); const mem = crearMemoria(); correr(mem, ent, { modo: 'MANUAL' }, 3, 0.1, false);
  assert.equal(manual(mem, ent, { 'SV-101': 1 }).DO['SV-101'], 0);
});

test('MANUAL: el paro de emergencia apaga todo, y tras rearmar vuelve a PARADA', () => {
  const ent = sanas(); const { mem } = enManual(ent, { 'P-101': 1, 'XV-101': 1 });
  ent.DI['ES-001'] = 0; ent.fijas = { 'ES-001': 0 };
  const r = manual(mem, ent, { 'P-101': 1, 'XV-101': 1, 'XV-201': 1 });
  assert.equal(r.paro, true);
  for (const [tag, v] of Object.entries(r.DO)) assert.equal(v, tag === 'HL-001' ? 1 : 0, tag);
  ent.fijas = {}; ent.DI['ES-001'] = 1; ent.DI['PB-001'] = 1;
  const rearmado = correr(mem, ent, {}, 3, 0.1, false);
  assert.equal(rearmado.paro, false); assert.equal(rearmado.modo, 'PARADA');
});

test('MANUAL: forzar la FDV en avance sin condiciones genera la alarma A220; con condiciones no', () => {
  const sin = sanas({ valores: { 'TT-103': 60 } }); const m1 = crearMemoria(); correr(m1, sin, { modo: 'MANUAL' }, 3, 0.1, false);
  let r = manual(m1, sin, { 'SV-101': 1 }, 10);
  assert.equal(r.DO['SV-101'], 1); assert.ok(r.alarmas.some(a => a.codigo === 'A220'), 'FDV en avance a 60 °C');
  const con = sanas({ valores: { 'TT-103': 74 } }); const m2 = crearMemoria(); correr(m2, con, { modo: 'MANUAL' }, 3, 0.1, false);
  r = manual(m2, con, { 'SV-101': 1 }, 10);
  assert.equal(r.DO['SV-101'], 1); assert.ok(!r.alarmas.some(a => a.codigo === 'A220'));
});

test('MANUAL: la alarma de estado M100 informa pero no enciende la baliza; una alarma real sí', () => {
  const { r } = enManual();
  assert.ok(r.alarmas.some(a => a.codigo === 'M100' && a.nivel === 'estado'));
  assert.equal(r.DO['HL-001'], 0);
  const ent = sanas({ DI: { 'PSL-501': 0 } }); const mem = crearMemoria(); correr(mem, ent, { modo: 'MANUAL' }, 3, 0.1, false);
  assert.equal(manual(mem, ent, {}).DO['HL-001'], 1);
});

// ------------------------------ reposición automática de niveles
test('automático: XV-101 repone el tanque con histéresis (abre por debajo del 85 %, cierra al 95 %)', () => {
  const mem = crearMemoria(); const ent = sanas({ valores: { 'LT-101': 70 } });
  assert.equal(correr(mem, ent, {}, 3).DO['XV-101'], 1);
  ent.AI['LT-101'].valor = 90; assert.equal(correr(mem, ent, {}, 3).DO['XV-101'], 1, 'dentro de la banda sigue llenando');
  ent.AI['LT-101'].valor = 96; assert.equal(correr(mem, ent, {}, 3).DO['XV-101'], 0);
  ent.AI['LT-101'].valor = 90; assert.equal(correr(mem, ent, {}, 3).DO['XV-101'], 0, 'dentro de la banda sigue cerrada');
});

test('automático: con el nivel bajo del agua caliente el PLC llena con XV-201 y sigue un rato después de recuperarlo', () => {
  const mem = crearMemoria(); const ent = sanas({ DI: { 'LSL-201': 0 } });
  assert.equal(correr(mem, ent, {}, 3).DO['XV-201'], 1);
  ent.fijas = {}; ent.DI['LSL-201'] = 1;
  assert.equal(correr(mem, ent, {}, 50).DO['XV-201'], 1, 'sigue llenando 5 s después');
  assert.equal(correr(mem, ent, {}, Math.ceil(C.plc.llenadoAguaExtraS / 0.1) + 20).DO['XV-201'], 0, 'y acaba cerrando');
});

test('los calentadores en automático tampoco conectan sin nivel en el depósito de agua caliente', () => {
  const ent = sanas({ DI: { 'LSL-201': 0 }, valores: { 'TT-201': 40 } }); const mem = crearMemoria();
  const r = correr(mem, ent, { arrancar: true }, 10);
  assert.equal(r.DO['KM-201'], 0); assert.equal(r.DO['KM-202'], 0);
});
