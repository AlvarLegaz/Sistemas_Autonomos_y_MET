'use strict';
// Cada avería produce su síntoma esperado (que sale de la física, no de números cableados) y desaparece al desactivarla.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const L = require('../js/layout.js');
const { crear, avanzar, codigos } = require('./modelo_ayuda.js');

const cad = (s, k, n) => s.estado.campos[k].cadenas[n];
const cerca = (x, ref, rel) => Math.abs(x - ref) <= Math.abs(ref) * rel + 1e-9;
const Z = s => s.estado.inversores['INV-201'], E = s => s.estado.inversores['INV-101'];

/** Escenarios: preparar(sim) (opcional) deja la planta como se quiera medir; medir(sim) → números; sintoma(antes, durante, sim); recupera(antes, despues, sim). */
const ESC = {
  CADENA_ABIERTA_A1: { medir: s => ({ A: s.estado.campos.A.p, i: cad(s, 'A', 0).i, ab: cad(s, 'A', 0).abierta, voc: cad(s, 'A', 0).voc }),
    sintoma: (a, d) => d.ab && d.i === 0 && d.A < 0.6 * a.A && d.voc > 80, recupera: (a, d) => !d.ab && cerca(d.A, a.A, 0.06) },
  CADENA_ABIERTA_B1: { medir: s => ({ B: s.estado.campos.B.p, v1: Z(s).mppt[0].v, ab: cad(s, 'B', 0).abierta, alarma: codigos(s).includes('ZCS_CADENA_ABIERTA') }),
    sintoma: (a, d) => d.ab && d.v1 === 0 && d.B < 0.6 * a.B && d.alarma, recupera: (a, d) => !d.ab && !d.alarma && cerca(d.B, a.B, 0.06) },
  FUSIBLE_F101: { medir: s => ({ A: s.estado.campos.A.p, f: s.estado.protecciones['F-101'].estado, cont: s.continuidad('F-101.1', 'F-101.2'), alarma: codigos(s).includes('FUSIBLE_FUNDIDO') }),
    sintoma: (a, d) => d.f === 'FUNDIDO' && !d.cont && d.A < 0.6 * a.A && d.alarma, recupera: (a, d) => d.f === 'CERRADO' && d.cont && cerca(d.A, a.A, 0.06) },
  DIODO_BYPASS_PV104: { medir: s => ({ voc: cad(s, 'A', 1).voc, p: cad(s, 'A', 1).p, byp: cad(s, 'A', 1).paneles[0].bypass[0] }),
    sintoma: (a, d) => d.voc < 0.93 * a.voc && d.voc > 0.8 * a.voc && d.p < 0.95 * a.p && d.byp === true, recupera: (a, d) => cerca(d.voc, a.voc, 0.02) && d.byp === false },
  DIODO_BYPASS_ABIERTO_PV203: { espera: 700, preparar: s => { s.ordenes.ambiente.sombra('PV-203', 0.3); avanzar(s, 700); },
    medir: s => ({ p: cad(s, 'B', 0).p, hot: cad(s, 'B', 0).paneles[2].tempCelulaC }),
    sintoma: (a, d) => d.p < 0.6 * a.p && d.hot > a.hot + 5, recupera: (a, d) => cerca(d.p, a.p, 0.06) },
  CONECTOR_RESISTIVO_B2: { medir: s => ({ r: Z(s).mppt[1].p / Z(s).mppt[0].p, t: s.medidas['STR-202.conectorC'] }),
    sintoma: (a, d) => Math.abs(a.r - 1) < 0.05 && d.r < a.r - 0.06 && d.t > a.t + 5, recupera: (a, d) => Math.abs(d.r - a.r) < 0.02 },
  FALLO_AISLAMIENTO_B: { espera: 20, esperaFin: 420, medir: s => ({ est: Z(s).estado, acP: Z(s).acP, iso: Z(s).aislamientoMohm, alarma: codigos(s).includes('ZCS_AISLAMIENTO'), led: Z(s).leds.alarma }),
    sintoma: (a, d) => a.est === 'OPERANDO' && d.est === 'FALLO' && d.acP === 0 && d.iso < 0.5 && d.alarma && d.led, recupera: (a, d) => d.est === 'OPERANDO' && d.acP > 0.9 * a.acP && d.iso > 1 && !d.alarma },
  SPD_DISPARADO_A: { medir: s => ({ e: s.estado.protecciones['SPD-101'].estado, A: s.estado.campos.A.p, sev: (s.estado.alarmas.find(x => x.codigo === 'SPD_AGOTADO') || {}).severidad }),
    sintoma: (a, d) => d.e === 'AGOTADO' && cerca(d.A, a.A, 0.03) && d.sev === 'aviso', recupera: (a, d) => d.e === 'CERRADO' && !d.sev },
  QB_DISPARADO: { espera: 20, medir: s => ({ qb: s.estado.protecciones['QB-101'].estado, eas: E(s).estado, i: s.estado.bateria.i, A: s.estado.campos.A.p, alim: s.estado.cargas['LOAD-302'].alimentada, cod: codigos(s) }),
    sintoma: (a, d) => d.qb === 'DISPARADO' && d.eas === 'FALLO' && d.i === 0 && d.A === 0 && d.alim && d.cod.includes('PROTECCION_DISPARADA') && d.cod.includes('EASUN_SIN_BATERIA'),
    recupera: (a, d) => d.qb === 'CERRADO' && d.eas !== 'FALLO' && d.A > 0.9 * a.A },
  BMS_CORTE_BATERIA: { opciones: { horaSolar: 23, socInicial: 70 }, preparar: s => { s.ordenes.inversor.modoEasun('BATERIA_PRIMERO'); s.ordenes.cargas.poner('LOAD-302', 500); avanzar(s, 120); },
    medir: s => ({ bms: s.estado.bateria.bms, i: s.estado.bateria.i, red: E(s).redP, cod: codigos(s) }),
    sintoma: (a, d) => a.i < -10 && a.red < 1 && d.bms === 'CORTE_BAJA' && d.i >= 0 && d.red > 400 && d.cod.includes('BMS_CORTE_BAJA'), recupera: (a, d) => d.bms === 'OK' && d.i < -10 && d.red < 1 },
  VENTILACION_TAPADA: null,    // escenarios largos: se prueban aparte
  CELDA_DESEQUILIBRADA: null,
  DIFERENCIAL_DISPARADO: { espera: 10, esperaFin: 200, medir: s => ({ id: s.estado.protecciones['ID-301'].estado, al301: s.estado.cargas['LOAD-301'].alimentada, z: Z(s).estado, acP: Z(s).acP, red: s.estado.red.p, al302: s.estado.cargas['LOAD-302'].alimentada }),
    sintoma: (a, d) => d.id === 'DISPARADO' && !d.al301 && d.z === 'ESPERA_RED' && d.acP === 0 && d.red === 0 && d.al302, recupera: (a, d) => d.id === 'CERRADO' && d.al301 && d.z === 'OPERANDO' && d.acP > 0.9 * a.acP },
  RED_CAIDA: { espera: 10, esperaFin: 200, medir: s => ({ disp: s.estado.red.disponible, v: s.estado.red.v, off: Z(s).leds.offGrid, al302: s.estado.cargas['LOAD-302'].alimentada, z: Z(s).estado, cod: codigos(s) }),
    sintoma: (a, d) => !d.disp && d.v === 0 && d.off && d.al302 && d.z === 'ESPERA_RED' && d.cod.includes('RED_CAIDA'), recupera: (a, d) => d.disp && d.v > 200 && d.z === 'OPERANDO' && !d.off },
  SOBRETENSION_RED: { espera: 10, esperaFin: 200, medir: s => ({ v: s.estado.red.v, z: Z(s).estado, acP: Z(s).acP, cod: codigos(s) }),
    sintoma: (a, d) => d.v === 253 && d.z === 'ESPERA_RED' && d.acP === 0 && d.cod.includes('ZCS_SOBRETENSION_RED'), recupera: (a, d) => d.v < 240 && d.z === 'OPERANDO' },
  COMUNICACION_PERDIDA_EASUN: { medir: s => ({ com: E(s).comunicacion, A: s.estado.campos.A.p, cod: codigos(s) }),
    sintoma: (a, d) => a.com === true && d.com === false && cerca(d.A, a.A, 0.03) && d.cod.includes('EASUN_COM_PERDIDA'), recupera: (a, d) => d.com === true && !d.cod.includes('EASUN_COM_PERDIDA') },
  SUCIEDAD_ALTA_A: { medir: s => ({ A: s.estado.campos.A.p, B: s.estado.campos.B.p, suc: s.estado.ambiente.suciedad.A }),
    sintoma: (a, d) => d.A < 0.8 * a.A && d.A > 0.6 * a.A && cerca(d.B, a.B, 0.03) && d.suc >= 0.29, recupera: (a, d) => cerca(d.A, a.A, 0.04) && d.suc === 0 },
  SOMBRA_PARAPETO: { espera: 700, opciones: { horaSolar: 8 }, medir: s => ({ r: cad(s, 'B', 1).p / cad(s, 'B', 0).p, s205: cad(s, 'B', 1).paneles[0].sombra01 }),
    sintoma: (a, d) => Math.abs(a.r - 1) < 0.05 && d.r < 0.85 && d.s205 > 0.3, recupera: (a, d) => Math.abs(d.r - 1) < 0.06 && d.s205 === 0 },
};

for (const av of L.AVERIAS) {
  const esc = ESC[av.id];
  if (!esc) continue;
  test(`avería ${av.id}: produce su síntoma y desaparece al desactivarla`, () => {
    const sim = crear(Object.assign({ horaSolar: 11, socInicial: 30 }, esc.opciones || {}));
    if (esc.preparar) esc.preparar(sim);
    const antes = esc.medir(sim);
    assert.deepEqual(sim.estado.averiasActivas, []);
    sim.ordenes.averias.activar(av.id);
    avanzar(sim, esc.espera || 120);
    const durante = esc.medir(sim);
    assert.ok(sim.estado.averiasActivas.includes(av.id), 'figura en averiasActivas');
    assert.ok(esc.sintoma(antes, durante, sim), `síntoma de ${av.id}: antes=${JSON.stringify(antes)} durante=${JSON.stringify(durante)}`);
    sim.ordenes.averias.desactivar(av.id);
    avanzar(sim, esc.esperaFin || esc.espera || 120);
    const despues = esc.medir(sim);
    assert.deepEqual(sim.estado.averiasActivas, []);
    assert.ok(esc.recupera(antes, despues, sim), `recuperación de ${av.id}: antes=${JSON.stringify(antes)} despues=${JSON.stringify(despues)}`);
  });
}

test('avería VENTILACION_TAPADA: los inversores se calientan por encima de 75 °C y reducen potencia; sin la avería no', () => {
  const montar = tapada => {
    const s = crear({ horaSolar: 10, socInicial: 90, estabilizar: 60 });
    s.ordenes.inversor.modoEasun('BATERIA_PRIMERO'); s.ordenes.cargas.poner('LOAD-302', 2600);
    if (tapada) s.ordenes.averias.activar('VENTILACION_TAPADA');
    avanzar(s, 3 * 3600); return s;
  };
  const sana = montar(false), mala = montar(true);
  assert.ok(E(sana).temperaturaC < 70 && E(sana).estado !== 'REDUCIDO', `sana ${E(sana).temperaturaC}`);
  assert.ok(E(mala).temperaturaC > 75 && (E(mala).estado === 'REDUCIDO' || E(mala).estado === 'FALLO'), `tapada ${E(mala).temperaturaC} ${E(mala).estado}`);
  assert.ok(mala.estado.ambiente.temperaturaCasetaC > sana.estado.ambiente.temperaturaCasetaC + 15);
  assert.ok(codigos(mala).includes('EASUN_REDUCIDO_TEMP') || codigos(mala).includes('EASUN_SOBRETEMP'));
  assert.ok(Z(mala).temperaturaC > Z(sana).temperaturaC + 10, 'el ZCS también se calienta más');
  mala.ordenes.averias.desactivar('VENTILACION_TAPADA'); avanzar(mala, 3 * 3600);
  assert.ok(E(mala).temperaturaC < 70 && E(mala).estado !== 'REDUCIDO' && E(mala).estado !== 'FALLO', `recuperada ${E(mala).temperaturaC}`);
});

test('avería CELDA_DESEQUILIBRADA: el BMS corta antes en descarga y en carga; sin la avería no', () => {
  const descarga = conAveria => {
    const s = crear({ horaSolar: 23, socInicial: 22, estabilizar: 5 });
    s.ordenes.inversor.modoEasun('BATERIA_PRIMERO'); s.ordenes.cargas.poner('LOAD-302', 1500);
    if (conAveria) s.ordenes.averias.activar('CELDA_DESEQUILIBRADA');
    for (let t = 0; t < 1800; t += 5) { s.paso(5); if (s.estado.bateria.bms === 'CORTE_BAJA') return s.estado.bateria.soc01; }
    return null;
  };
  const sana = descarga(false), mala = descarga(true);
  assert.ok(mala !== null && mala > 0.08, `con avería corta con SoC ${mala}`);
  assert.ok(sana === null || sana < 0.04, `sana corta con SoC ${sana}`);
  const carga = conAveria => {
    const s = crear({ horaSolar: 10, socInicial: 90, estabilizar: 5 });
    if (conAveria) s.ordenes.averias.activar('CELDA_DESEQUILIBRADA');
    for (let t = 0; t < 3600; t += 5) { s.paso(5); if (s.estado.bateria.bms === 'CORTE_ALTA') return true; }
    return false;
  };
  assert.equal(carga(false), false); assert.equal(carga(true), true);
  const s = crear({ horaSolar: 23, socInicial: 12, estabilizar: 5 });
  s.ordenes.averias.activar('CELDA_DESEQUILIBRADA'); avanzar(s, 30);
  s.ordenes.averias.desactivar('CELDA_DESEQUILIBRADA'); avanzar(s, 30);
  assert.equal(s.estado.bateria.bms, 'OK');
});

test('avería SOMBRA_PARAPETO: a mediodía de verano no se nota y con el sol bajo sí', () => {
  const s = crear({ horaSolar: 12, socInicial: 30 }); s.ordenes.averias.activar('SOMBRA_PARAPETO'); avanzar(s, 60);
  assert.equal(cad(s, 'B', 1).paneles[0].sombra01, 0); assert.equal(cad(s, 'B', 1).paneles[1].sombra01, 0);
  const t = crear({ horaSolar: 17.5, socInicial: 30 }); t.ordenes.averias.activar('SOMBRA_PARAPETO'); avanzar(t, 60);
  assert.ok(cad(t, 'B', 1).paneles[0].sombra01 > 0.3 && cad(t, 'B', 1).paneles[2].sombra01 === 0, 'solo las dos primeras de STR-202');
});

test('avería DIODO_BYPASS_ABIERTO_PV203: sin sombra no se nota (es una avería latente)', () => {
  const s = crear({ horaSolar: 11 }); const antes = cad(s, 'B', 0).p;
  s.ordenes.averias.activar('DIODO_BYPASS_ABIERTO_PV203'); avanzar(s, 120);
  assert.ok(cerca(cad(s, 'B', 0).p, antes, 0.03));
});

test('todas las averías de layout.js tienen escenario probado', () => {
  for (const a of L.AVERIAS) assert.ok(a.id in ESC, `falta escenario de ${a.id}`);
});

test('varias averías a la vez no producen NaN y siguen siendo reversibles', () => {
  const s = crear({ horaSolar: 11 });
  for (const a of L.AVERIAS) s.ordenes.averias.activar(a.id);
  avanzar(s, 1800);
  const { buscarNoFinito } = require('./modelo_ayuda.js');
  assert.equal(buscarNoFinito(s.estado), null);
  assert.equal(s.estado.averiasActivas.length, L.AVERIAS.length);
  s.ordenes.averias.limpiar(); for (const t of ['F-101', 'QB-101', 'ID-301', 'SPD-101']) s.ordenes.protecciones.rearmar(t);
  avanzar(s, 3 * 3600);
  assert.deepEqual(s.estado.averiasActivas, []); assert.equal(Z(s).estado === 'OPERANDO' || Z(s).estado === 'APAGADO' || Z(s).estado === 'REDUCIDO', true);
  assert.ok(Object.values(s.estado.protecciones).every(p => p.estado === 'CERRADO'));
});
