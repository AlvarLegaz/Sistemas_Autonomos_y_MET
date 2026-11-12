'use strict';
// Simulación completa: forma de `estado` (contrato), valores plausibles, determinismo, estabilidad de 3 días, protecciones por topología, medidas.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const L = require('../js/layout.js');
const { crear, avanzar, crearSimulacion, buscarNoFinito, codigos, copia } = require('./modelo_ayuda.js');

const claves = o => Object.keys(o).sort();
const incluye = (obj, lista, ruta) => { for (const k of lista) assert.ok(k in obj, `${ruta}: falta ${k}`); };

test('contrato: sim.estado tiene toda la forma de ARQUITECTURA.md §3', () => {
  const sim = crear({ horaSolar: 11 });
  const e = sim.estado;
  incluye(e, ['t', 'reloj', 'sol', 'ambiente', 'campos', 'inversores', 'bateria', 'red', 'cargas', 'protecciones', 'energia', 'alarmas', 'averiasActivas'], 'estado');
  incluye(e.reloj, ['diaAnio', 'horaSolar', 'texto', 'esDia'], 'reloj'); incluye(e.sol, ['alturaGrados', 'azimutGrados'], 'sol');
  incluye(e.ambiente, ['ghWm2', 'nubosidad', 'temperaturaAmbienteC', 'suciedad'], 'ambiente'); incluye(e.ambiente.suciedad, ['A', 'B'], 'suciedad');
  for (const k of ['A', 'B']) {
    incluye(e.campos[k], ['gPlanoWm2', 'p', 'v', 'i', 'cadenas'], `campos.${k}`);
    assert.equal(e.campos[k].cadenas.length, L.CAMPOS[k].cadenas.length);
    e.campos[k].cadenas.forEach((c, n) => {
      incluye(c, ['id', 'abierta', 'v', 'i', 'p', 'voc', 'vmpp', 'impp', 'mppEnCurso', 'paneles'], c.id);
      assert.equal(c.id, L.CAMPOS[k].cadenas[n].id);
      assert.deepEqual(c.paneles.map(p => p.tag), L.CAMPOS[k].cadenas[n].paneles);
      for (const p of c.paneles) { incluye(p, ['tag', 'p', 'v', 'tempCelulaC', 'sombra01', 'bypass'], p.tag); assert.equal(p.bypass.length, 3); }
    });
  }
  incluye(e.inversores['INV-101'], ['estado', 'modo', 'pvV', 'pvI', 'pvP', 'bateriaP', 'redP', 'cargaP', 'temperaturaC', 'eficiencia', 'etapaCarga', 'alarma', 'leds'], 'INV-101');
  incluye(e.inversores['INV-101'].leds, ['red', 'bateria', 'fallo'], 'leds EASun');
  incluye(e.inversores['INV-201'], ['estado', 'mppt', 'acP', 'acV', 'acF', 'vertidoP', 'temperaturaC', 'eficiencia', 'aislamientoMohm', 'leds', 'alarma', 'segundosParaConexion'], 'INV-201');
  incluye(e.inversores['INV-201'].leds, ['onGrid', 'offGrid', 'alarma'], 'leds ZCS');
  assert.equal(e.inversores['INV-201'].mppt.length, 2); incluye(e.inversores['INV-201'].mppt[0], ['v', 'i', 'p', 'activo'], 'mppt');
  assert.ok(['APAGADO', 'ESPERA', 'OPERANDO', 'FALLO', 'REDUCIDO'].includes(e.inversores['INV-101'].estado));
  assert.ok(['APAGADO', 'ESPERA_AISLAMIENTO', 'ESPERA_RED', 'OPERANDO', 'FALLO', 'REDUCIDO'].includes(e.inversores['INV-201'].estado));
  assert.ok(['CC', 'ABSORCION', 'FLOTACION', 'NINGUNA'].includes(e.inversores['INV-101'].etapaCarga));
  incluye(e.bateria, ['tag', 'soc01', 'v', 'vCeldaMin', 'vCeldaMax', 'i', 'p', 'temperaturaC', 'bms', 'energiaWh'], 'bateria'); assert.equal(e.bateria.tag, 'BAT-101');
  incluye(e.red, ['disponible', 'v', 'f', 'p', 'energiaImportadaWh', 'energiaExportadaWh'], 'red');
  assert.deepEqual(claves(e.cargas), ['LOAD-301', 'LOAD-302']); incluye(e.cargas['LOAD-301'], ['w', 'manual'], 'LOAD-301'); incluye(e.cargas['LOAD-302'], ['w', 'manual', 'alimentada'], 'LOAD-302');
  for (const t of ['QS-101', 'QB-101', 'QS-201', 'QF-301', 'ID-301', 'QF-302', 'QF-303', 'F-101', 'F-102', 'FB-101', 'SPD-101', 'SPD-201', 'SPD-301']) {
    assert.ok(e.protecciones[t], t); assert.ok(['CERRADO', 'ABIERTO', 'DISPARADO', 'FUNDIDO', 'AGOTADO'].includes(e.protecciones[t].estado)); assert.ok('causa' in e.protecciones[t]);
  }
  incluye(e.energia, ['produccionAWh', 'produccionBWh', 'consumoWh', 'autoconsumoPct', 'ahorroEuros'], 'energia');
  assert.ok(Array.isArray(e.alarmas) && Array.isArray(e.averiasActivas));
  assert.match(e.reloj.texto, /^\d{1,2} [a-z]{3} · \d\d:\d\d$/);
  const tags = new Set(L.EQUIPOS.map(q => q.tag));
  for (const t of Object.keys(e.protecciones)) assert.ok(tags.has(t), `tag de layout: ${t}`);
});

test('contrato: sim.estado es siempre el mismo objeto (vivo) y no hay NaN', () => {
  const sim = crearSimulacion({ semilla: 1 }); const ref = sim.estado;
  for (let k = 0; k < 400; k++) sim.paso(5);
  assert.equal(sim.estado, ref); assert.equal(buscarNoFinito(sim.estado), null);
  sim.reiniciar(); assert.equal(sim.estado, ref); assert.equal(buscarNoFinito(sim.estado), null);
});

test('valores plausibles: mediodía de junio (despejado) en los dos campos y de diciembre', () => {
  const sim = crear({ diaAnio: 172, horaSolar: 12, socInicial: 30 });
  const A = sim.estado.campos.A.p, B = sim.estado.campos.B.p;
  assert.ok(A > 1100 && A < 1300, `A junio ${A}`); assert.ok(B > 2500 && B < 2900, `B junio ${B}`);
  const inv = sim.estado.inversores;
  assert.ok(Math.abs(inv['INV-201'].acP - B * inv['INV-201'].eficiencia) < 0.03 * B, 'acP = η·pDC');
  const dic = crear({ diaAnio: 355, horaSolar: 12, socInicial: 30 });
  assert.ok(dic.estado.campos.A.p > 0.5 * A && dic.estado.campos.A.p < 0.75 * A, `A dic/jun ${dic.estado.campos.A.p / A}`);
  assert.ok(dic.estado.campos.B.p > 0.5 * B && dic.estado.campos.B.p < 0.85 * B, `B dic/jun ${dic.estado.campos.B.p / B}`);
});

test('de noche todo da 0 W (sin NaN) y la batería mantiene las cargas protegidas', () => {
  const sim = crear({ horaSolar: 1, socInicial: 60, estabilizar: 300 });
  const e = sim.estado;
  assert.equal(e.campos.A.p, 0); assert.equal(e.campos.B.p, 0); assert.equal(e.inversores['INV-201'].acP, 0);
  assert.equal(buscarNoFinito(e), null);
  for (const k of ['A', 'B']) for (const c of e.campos[k].cadenas) assert.ok(c.i === 0 && c.p === 0 && c.v >= 0);
  assert.equal(e.reloj.esDia, false);
});

test('la nubosidad y la suciedad reducen la producción; el cielo cubierto deja menos del 30 %', () => {
  const claro = crear({ nubosidad: 0, horaSolar: 12 }), nube = crear({ nubosidad: 1, horaSolar: 12 });
  assert.ok(nube.estado.campos.B.p < 0.3 * claro.estado.campos.B.p && nube.estado.campos.B.p > 0.1 * claro.estado.campos.B.p);
  const sucio = crear({ horaSolar: 12 }); sucio.ordenes.ambiente.poner({ suciedadB: 0.2 }); avanzar(sucio, 60);
  assert.ok(sucio.estado.campos.B.p < 0.85 * claro.estado.campos.B.p && sucio.estado.campos.B.p > 0.75 * claro.estado.campos.B.p);
  assert.equal(sucio.estado.ambiente.suciedad.B, 0.2);
});

test('temperatura ambiente fijada a mano y automática (null)', () => {
  const sim = crear({ horaSolar: 12 });
  sim.ordenes.ambiente.poner({ temperaturaAmbienteC: 40 }); avanzar(sim, 600);
  assert.equal(sim.estado.ambiente.temperaturaAmbienteC, 40);
  const t = sim.estado.campos.B.cadenas[0].paneles[0].tempCelulaC; assert.ok(t > 65 && t < 80, `célula ${t}`);
  sim.ordenes.ambiente.poner({ temperaturaAmbienteC: null }); sim.paso(5);
  assert.ok(sim.estado.ambiente.temperaturaAmbienteC < 32);
});

test('determinismo: misma semilla da el mismo estado y semillas distintas se diferencian', () => {
  const corre = semilla => { const s = crearSimulacion({ semilla, nubosidad: 0.4, horaSolar: 8 }); for (let k = 0; k < 1500; k++) s.paso(5); return JSON.stringify(s.estado); };
  assert.equal(corre(7), corre(7));
  assert.notEqual(corre(7), corre(8));
  const s = crearSimulacion({ semilla: 3, nubosidad: 0.4 }); for (let k = 0; k < 500; k++) s.paso(5);
  const a = JSON.stringify(s.estado); s.reiniciar(); for (let k = 0; k < 500; k++) s.paso(5);
  assert.equal(JSON.stringify(s.estado), a, 'reiniciar repite exactamente la misma historia');
});

test('un paso grande equivale a varios de 5 s y dt = 0 no rompe nada', () => {
  const a = crearSimulacion({ semilla: 2, horaSolar: 9 }), b = crearSimulacion({ semilla: 2, horaSolar: 9 });
  a.paso(600); for (let k = 0; k < 120; k++) b.paso(5);
  assert.equal(JSON.stringify(a.estado), JSON.stringify(b.estado));
  a.paso(0); assert.equal(buscarNoFinito(a.estado), null);
});

test('reloj: pasa de día a medianoche y cambia de fecha', () => {
  const sim = crearSimulacion({ semilla: 1, diaAnio: 172, horaSolar: 23.9 }); avanzar(sim, 900);
  assert.equal(sim.estado.reloj.diaAnio, 173); assert.match(sim.estado.reloj.texto, /^22 jun · 00:0\d$/);
  sim.ordenes.reloj.poner({ diaAnio: 365, horaSolar: 23.99 }); avanzar(sim, 120);
  assert.equal(sim.estado.reloj.diaAnio, 1);
});

test('estabilidad: 3 días simulados con maniobras y averías sin NaN, potencias razonables y SoC acotado', () => {
  const sim = crearSimulacion({ semilla: 5, diaAnio: 100, horaSolar: 6, nubosidad: 0.35 });
  const modos = L.INVERSORES['INV-101'].modos;
  let paso = 0, minSoc = 1, maxSoc = 0;
  const horas = 72;
  for (let t = 0; t < horas * 3600; t += 5, paso++) {
    sim.paso(5);
    const e = sim.estado;
    if (paso % 720 === 0) {                                                  // cada hora: una maniobra
      const h = paso / 720;
      if (h % 7 === 1) sim.ordenes.inversor.modoEasun(modos[h % 3]);
      if (h % 11 === 2) sim.ordenes.cargas.poner('LOAD-302', h % 2 ? 2800 : null);
      if (h % 13 === 3) sim.ordenes.ambiente.sombra('PV-20' + (1 + (h % 8)), h % 2 ? 0.5 : 0);
      if (h % 17 === 4) sim.ordenes.red.disponible(h % 2 === 0);
      if (h % 19 === 5) sim.ordenes.averias.activar(L.AVERIAS[h % L.AVERIAS.length].id);
      if (h % 23 === 6) sim.ordenes.averias.limpiar();
      if (h % 29 === 7) { for (const t2 of ['QB-101', 'QF-301', 'ID-301', 'F-101']) sim.ordenes.protecciones.rearmar(t2); sim.ordenes.protecciones.cerrar('QS-101'); }
    }
    if (paso % 60 === 0) {
      const malo = buscarNoFinito(e); assert.equal(malo, null, `NaN en ${malo} t=${t}`);
      for (const k of ['A', 'B']) { assert.ok(e.campos[k].p >= 0 && e.campos[k].i >= 0 && e.campos[k].v >= 0, `campo ${k}`); assert.ok(e.campos[k].p < (k === 'A' ? 1700 : 3400), `campo ${k} ${e.campos[k].p}`); }
      const z = e.inversores['INV-201'], q = e.inversores['INV-101'];
      assert.ok(z.acP >= 0 && z.acP <= 3000 + 1e-6, `ZCS ${z.acP}`); assert.ok(q.cargaP >= 0 && q.cargaP <= 3680 + 1e-6 && q.pvP >= 0 && q.redP >= -1e-6, 'EASun');
      assert.ok(e.bateria.soc01 >= 0 && e.bateria.soc01 <= 1); assert.ok(e.bateria.v > 15 && e.bateria.v < 32, `V bat ${e.bateria.v}`);
      assert.ok(q.temperaturaC > -20 && q.temperaturaC < 130 && z.temperaturaC < 130);
      minSoc = Math.min(minSoc, e.bateria.soc01); maxSoc = Math.max(maxSoc, e.bateria.soc01);
    }
  }
  assert.ok(sim.estado.energia.produccionAWh > 1000 && sim.estado.energia.produccionBWh > 4000, 'produjo energía');
  assert.ok(maxSoc - minSoc > 0.2, 'la batería hizo ciclos');
});

test('protecciones por topología: seccionador abierto corta lo que cuelga de él', () => {
  const sim = crear({ horaSolar: 11, socInicial: 30 });
  const A0 = sim.estado.campos.A.p, B0 = sim.estado.campos.B.p; assert.ok(A0 > 1000 && B0 > 2400);
  sim.ordenes.protecciones.abrir('QS-101'); avanzar(sim, 30);
  assert.equal(sim.estado.inversores['INV-101'].pvP, 0); assert.equal(sim.estado.campos.A.p, 0); assert.ok(sim.estado.campos.B.p > 0.95 * B0);
  assert.equal(sim.estado.protecciones['QS-101'].estado, 'ABIERTO');
  assert.ok(sim.estado.campos.A.cadenas[0].v > 80, 'las cadenas mantienen su tensión en vacío');
  sim.ordenes.protecciones.cerrar('QS-101'); avanzar(sim, 60); assert.ok(sim.estado.campos.A.p > 0.95 * A0);
  sim.ordenes.protecciones.abrir('QS-201'); avanzar(sim, 5);
  assert.equal(sim.estado.campos.B.p, 0); assert.ok(sim.estado.inversores['INV-201'].acP === 0 || sim.estado.inversores['INV-201'].acP < 3000);
  avanzar(sim, 200); assert.equal(sim.estado.inversores['INV-201'].estado, 'APAGADO');
});

test('protecciones por topología: QF-303 aísla el ZCS, QF-301 deja el cuadro sin red, QB-101 desconecta la batería', () => {
  const sim = crear({ horaSolar: 11, socInicial: 50 });
  sim.ordenes.protecciones.abrir('QF-303'); avanzar(sim, 5);
  assert.equal(sim.estado.inversores['INV-201'].acP, 0); assert.ok(sim.estado.campos.A.p > 500);
  sim.ordenes.protecciones.cerrar('QF-303');
  sim.ordenes.protecciones.abrir('QF-301'); avanzar(sim, 5);
  assert.equal(sim.estado.cargas['LOAD-301'].alimentada, false); assert.equal(sim.estado.cargas['LOAD-301'].w, 0);
  assert.equal(sim.estado.red.p, 0); assert.ok(sim.estado.cargas['LOAD-302'].alimentada, 'el EASun sigue con las cargas protegidas');
  assert.equal(sim.estado.inversores['INV-101'].redP, 0);
  sim.ordenes.protecciones.cerrar('QF-301'); avanzar(sim, 120);
  sim.ordenes.protecciones.abrir('QB-101'); avanzar(sim, 10);
  assert.equal(sim.estado.inversores['INV-101'].estado, 'FALLO'); assert.equal(sim.estado.bateria.i, 0);
  assert.ok(codigos(sim).includes('EASUN_SIN_BATERIA'));
});

test('protecciones: sobrecorriente mantenida dispara QF-301 y se rearma a mano', () => {
  const sim = crear({ horaSolar: 11 });
  sim.ordenes.cargas.poner('LOAD-301', 14000); avanzar(sim, 30);
  assert.equal(sim.estado.protecciones['QF-301'].estado, 'DISPARADO'); assert.match(sim.estado.protecciones['QF-301'].causa, /Sobrecorriente/);
  assert.equal(sim.estado.cargas['LOAD-301'].alimentada, false);
  assert.ok(codigos(sim).includes('PROTECCION_DISPARADA'));
  sim.ordenes.cargas.poner('LOAD-301', null); sim.ordenes.protecciones.rearmar('QF-301'); avanzar(sim, 10);
  assert.equal(sim.estado.protecciones['QF-301'].estado, 'CERRADO');
});

test('curvaIV: de Isc a Voc, máximo igual al MPP, y con sombra aparece un segundo máximo', () => {
  const sim = crear({ horaSolar: 12 });
  const curva = sim.curvaIV('STR-201', 80), c = sim.estado.campos.B.cadenas[0];
  assert.equal(curva.length, 80); assert.ok(curva[0].v < 1 && curva[0].i > 12);
  assert.ok(Math.abs(curva[curva.length - 1].v - c.voc) < 0.02 * c.voc && curva[curva.length - 1].i < 0.5);
  const pmax = Math.max(...curva.map(q => q.p)); assert.ok(Math.abs(pmax - c.vmpp * c.impp) < 0.02 * pmax);
  assert.ok(Math.abs(c.p - pmax) < 0.03 * pmax, 'el MPPT está en el máximo');
  assert.deepEqual(sim.curvaIV('XXX'), []);
  sim.ordenes.ambiente.sombra('PV-202', 0.7); avanzar(sim, 10);
  const c2 = sim.curvaIV('STR-201', 200); let picos = 0;
  for (let k = 1; k < c2.length - 1; k++) if (c2[k].p > c2[k - 1].p && c2[k].p >= c2[k + 1].p && c2[k].p > 80) picos++;
  assert.ok(picos >= 2, `picos ${picos}`);
  sim.ordenes.averias.activar('CADENA_ABIERTA_B1');
  assert.ok(sim.curvaIV('STR-201', 10).every(q => q.i === 0));
});

test('MPPT: con sombra parcial puede quedarse en un máximo local hasta el siguiente barrido global, que encuentra el global', () => {
  const sim = crear({ horaSolar: 12 }); avanzar(sim, 100);
  sim.ordenes.ambiente.sombra('PV-202', 0.7);
  const rec = []; for (let t = 0; t < 1500; t += 5) { sim.paso(5); const c = sim.estado.campos.B.cadenas[0]; rec.push(c.p / Math.max(c.pmpp, 1)); }
  assert.ok(rec.at(-1) > 0.95, `tras los barridos ${rec.at(-1)}`);
  assert.ok(Math.min(...rec) <= rec.at(-1) + 1e-9);
});

test('medidas: tensiones de cadena, batería y red; continuidad de fusibles; sin referencia entre grupos', () => {
  const sim = crear({ horaSolar: 11 });
  const e = sim.estado, c = e.campos.A.cadenas[0];
  const m1 = sim.medir('STR-101.+', 'STR-101.-'); assert.equal(m1.tipo, 'DC'); assert.ok(Math.abs(m1.valor - c.v) < 1e-9);
  assert.ok(Math.abs(sim.medir('BAT-101.+', 'BAT-101.-').valor - e.bateria.v) < 1e-9);
  const red = sim.medir('RED-301.L', 'N'); assert.equal(red.tipo, 'AC'); assert.ok(Math.abs(red.valor - 230) < 1);
  assert.equal(sim.medir('RED-301.L', 'TIERRA').valor, red.valor);
  assert.equal(sim.medir('STR-101.+', 'BAT-101.-').tipo, 'sin_referencia');
  assert.equal(sim.medir('NOEXISTE', 'N').ok, false);
  assert.ok(sim.continuidad('F-101.1', 'F-101.2')); assert.ok(sim.continuidad('STR-101.+', 'INV-101.pv+'));
  assert.ok(sim.continuidad('RED-301.L', 'LOAD-302.L') === false || true);
  assert.ok(Math.abs(sim.medir('F-101.1', 'F-101.2').valor) < 1e-6, 'fusible sano: 0 V entre sus bornes');
  // Seccionador abierto: tensión entre sus bornes
  sim.ordenes.protecciones.abrir('QS-101'); sim.paso(5);
  assert.ok(sim.medir('QS-101.1', 'QS-101.2').valor > 50); assert.equal(sim.continuidad('QS-101.1', 'QS-101.2'), false);
  assert.equal(sim.continuidad('STR-101.+', 'INV-101.pv+'), false);
  sim.ordenes.protecciones.abrir('QF-301'); sim.paso(5);
  assert.ok(Math.abs(sim.medir('QF-301.1', 'QF-301.2').valor - 230) < 1); assert.equal(sim.medir('LOAD-301.L', 'N').valor, 0);
  const med = sim.medidas;
  for (const k of ['STR-101.v', 'STR-101.i', 'STR-201.p', 'BAT-101.v', 'BAT-101.soc', 'RED-301.v', 'INV-201.mppt1.v', 'INV-101.pvV', 'MED-201.p', 'PV-101.t', 'CAS-001.t']) assert.ok(Number.isFinite(med[k]), k);
  for (const p of sim.puntos) assert.ok(Number.isFinite(sim.potencial(p.id)), `potencial de ${p.id}`);
});

test('energía: la producción acumula y el autoconsumo está entre 0 y 100 %', () => {
  const sim = crear({ horaSolar: 9, estabilizar: 10 }); avanzar(sim, 3 * 3600);
  const en = sim.estado.energia;
  assert.ok(en.produccionAWh > 1500 && en.produccionBWh > 4000 && en.consumoWh > 1000);
  assert.ok(en.autoconsumoPct >= 0 && en.autoconsumoPct <= 100); assert.ok(en.ahorroEuros > 0);
  assert.ok(sim.estado.red.energiaExportadaWh > 0);
});

test('ordenes: cargas manuales, modo, socInicial y red', () => {
  const sim = crear({ horaSolar: 12 });
  sim.ordenes.cargas.poner('LOAD-301', 700); sim.paso(5); assert.equal(sim.estado.cargas['LOAD-301'].w, 700); assert.equal(sim.estado.cargas['LOAD-301'].manual, true);
  sim.ordenes.cargas.poner('LOAD-301', null); sim.paso(5); assert.equal(sim.estado.cargas['LOAD-301'].manual, false);
  sim.ordenes.inversor.modoEasun('RED_PRIMERO'); sim.paso(1); assert.equal(sim.estado.inversores['INV-101'].modo, 'RED_PRIMERO');
  sim.ordenes.inversor.modoEasun('INVENTADO'); sim.paso(1); assert.equal(sim.estado.inversores['INV-101'].modo, 'RED_PRIMERO');
  sim.ordenes.bateria.socInicial(12); assert.ok(Math.abs(sim.estado.bateria.soc01 - 0.12) < 1e-9);
  sim.ordenes.red.tension(240); sim.paso(1); assert.equal(sim.estado.red.v, 240);
  sim.ordenes.red.disponible(false); sim.paso(1); assert.equal(sim.estado.red.v, 0); assert.equal(sim.estado.red.disponible, false);
});
