'use strict';
// Inversores EASun y ZCS: modos de fuente, etapas de carga, corte y rearme, temperatura; aislamiento, espera de red, anti-isla, sobretensión, MPPT independientes.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { crear, avanzar, crearSimulacion } = require('./modelo_ayuda.js');
const { crearZcs } = require('../js/modelo/inversor_zcs.js');
const { crearRng } = require('../js/configuracion/constantes.js');

const E = sim => sim.estado.inversores['INV-101'], Z = sim => sim.estado.inversores['INV-201'];

test('EASun, SOLAR_PRIMERO con sol: el sol alimenta las cargas y carga la batería en corriente constante', () => {
  const sim = crear({ socInicial: 40 });
  sim.ordenes.cargas.poner('LOAD-302', 400); avanzar(sim, 120);
  const e = E(sim);
  assert.equal(e.estado, 'OPERANDO'); assert.equal(e.fuente, 'INVERSOR');
  assert.ok(e.pvP > 800, `pv ${e.pvP}`); assert.ok(e.bateriaP > 300, `carga batería ${e.bateriaP}`);
  assert.ok(Math.abs(e.redP) < 1, 'sin red mientras el sol alcanza');
  assert.ok(Math.abs(e.cargaP - 400) < 5);
  assert.equal(e.etapaCarga, 'CC');
  assert.ok(e.eficiencia > 0.85 && e.eficiencia < 0.99, `eficiencia ${e.eficiencia}`);
  assert.ok(sim.estado.bateria.i > 10);
});

test('EASun, SOLAR_PRIMERO: si el sol no alcanza, todas las cargas pasan a red y el sol carga la batería', () => {
  const sim = crear({ socInicial: 40 });
  sim.ordenes.cargas.poner('LOAD-302', 3000); avanzar(sim, 120);
  const e = E(sim);
  assert.equal(e.fuente, 'RED'); assert.ok(e.redP > 2900, `red ${e.redP}`); assert.ok(e.bateriaP > 300);
});

test('EASun, RED_PRIMERO: las cargas van con la red y el sol solo carga la batería', () => {
  const sim = crear({ socInicial: 40 });
  sim.ordenes.inversor.modoEasun('RED_PRIMERO'); sim.ordenes.cargas.poner('LOAD-302', 400); avanzar(sim, 120);
  const e = E(sim);
  assert.equal(e.fuente, 'RED'); assert.ok(Math.abs(e.redP - 400) < 10, `red ${e.redP}`); assert.ok(e.bateriaP > 500);
});

test('EASun, BATERIA_PRIMERO de noche: la batería alimenta las cargas y no se toca la red', () => {
  const sim = crear({ horaSolar: 23, socInicial: 70 });
  sim.ordenes.inversor.modoEasun('BATERIA_PRIMERO'); sim.ordenes.cargas.poner('LOAD-302', 500); avanzar(sim, 120);
  const e = E(sim);
  assert.equal(e.fuente, 'INVERSOR'); assert.ok(e.bateriaP < -500, `batería ${e.bateriaP}`); assert.ok(e.redP < 1);
  assert.ok(sim.estado.cargas['LOAD-302'].alimentada && Math.abs(e.cargaP - 500) < 5);
});

test('EASun: corte por tensión baja (pasa a red y carga la batería) y rearme a 25 V', () => {
  const sim = crear({ horaSolar: 23, socInicial: 4 });
  sim.ordenes.inversor.modoEasun('BATERIA_PRIMERO'); sim.ordenes.cargas.poner('LOAD-302', 1500);
  let agotada = false, fuentes = new Set(), vAntes = 0;
  for (let t = 0; t < 7200; t += 5) { sim.paso(5); const e = E(sim); if (e.bateriaAgotada) { agotada = true; vAntes = sim.estado.bateria.v; } fuentes.add(e.fuente); if (agotada && !e.bateriaAgotada) break; }
  assert.ok(agotada, 'se agotó la batería (tensión < 21 V bajo carga)');
  assert.ok(fuentes.has('RED'), 'pasó a red');
  assert.equal(E(sim).bateriaAgotada, false, 'rearmó');
  assert.ok(vAntes >= 24.9, `rearme a ${vAntes} V`);
  avanzar(sim, 120);
  assert.ok(E(sim).bateriaP < 0 || E(sim).fuente === 'INVERSOR', 'vuelve a descargar tras el rearme');
});

test('EASun: sin red alimenta las cargas con sol y batería', () => {
  const sim = crear({ socInicial: 60 });
  sim.ordenes.red.disponible(false); sim.ordenes.cargas.poner('LOAD-302', 1500); avanzar(sim, 120);
  const e = E(sim);
  assert.equal(e.fuente, 'INVERSOR'); assert.ok(e.redP === 0 || Math.abs(e.redP) < 1);
  assert.ok(sim.estado.cargas['LOAD-302'].alimentada && Math.abs(e.cargaP - 1500) < 10);
});

test('EASun: etapas de carga CC → ABSORCION → FLOTACION al llenar la batería', () => {
  const sim = crear({ horaSolar: 9, socInicial: 75, estabilizar: 60 });
  sim.ordenes.cargas.poner('LOAD-302', 150);
  const vistas = [];
  for (let t = 0; t < 4 * 3600; t += 5) { sim.paso(5); const et = E(sim).etapaCarga; if (et !== vistas[vistas.length - 1]) vistas.push(et); }
  const orden = vistas.filter(x => x !== 'NINGUNA');
  assert.deepEqual(orden.slice(0, 3), ['CC', 'ABSORCION', 'FLOTACION'], vistas.join(' > '));
  assert.ok(sim.estado.bateria.soc01 > 0.99);
  assert.ok(sim.estado.bateria.v < 28.6 && sim.estado.bateria.v > 27, `V final ${sim.estado.bateria.v}`);
});

test('EASun: apagado no da nada y QF-302 abierto deja sin tensión a LOAD-302', () => {
  const sim = crear();
  sim.ordenes.protecciones.abrir('QF-302'); avanzar(sim, 10);
  assert.equal(sim.estado.cargas['LOAD-302'].alimentada, false); assert.equal(E(sim).cargaP, 0);
  sim.ordenes.protecciones.cerrar('QF-302'); avanzar(sim, 30);
  assert.equal(sim.estado.cargas['LOAD-302'].alimentada, true);
  sim.ordenes.inversor.encender('INV-101', false); avanzar(sim, 10);
  assert.equal(E(sim).estado, 'APAGADO'); assert.equal(E(sim).pvP, 0); assert.equal(sim.estado.cargas['LOAD-302'].alimentada, false);
  sim.ordenes.inversor.encender('INV-101', true); avanzar(sim, 30);
  assert.notEqual(E(sim).estado, 'APAGADO');
});

test('EASun: carga cercana a 3 kW con la caseta ventilada normal no reduce; con las rejillas tapadas se calienta y reduce', () => {
  const sim = crear({ horaSolar: 10, socInicial: 90, estabilizar: 60 });
  sim.ordenes.inversor.modoEasun('BATERIA_PRIMERO'); sim.ordenes.cargas.poner('LOAD-302', 2600);
  avanzar(sim, 3 * 3600);
  assert.ok(E(sim).temperaturaC < 75 && E(sim).estado !== 'REDUCIDO', `normal ${E(sim).temperaturaC}`);
  const mala = crear({ horaSolar: 10, socInicial: 90, estabilizar: 60 });
  mala.ordenes.inversor.modoEasun('BATERIA_PRIMERO'); mala.ordenes.cargas.poner('LOAD-302', 2600); mala.ordenes.averias.activar('VENTILACION_TAPADA');
  avanzar(mala, 3 * 3600);
  assert.ok(E(mala).temperaturaC > 75, `tapada ${E(mala).temperaturaC}`);
  assert.ok(E(mala).estado === 'REDUCIDO' || E(mala).estado === 'FALLO');
  assert.ok(E(mala).cargaP < 2600 * 0.99 || E(mala).fuente === 'RED' || E(mala).estado === 'FALLO', 'reduce la potencia entregada');
});

test('ZCS: secuencia de arranque aislamiento → espera de red (60 s) → operando, con la cuenta atrás', () => {
  const sim = crearSimulacion({ semilla: 1, diaAnio: 172, horaSolar: 6.9, nubosidad: 0 });
  const vistos = []; let primeraCuenta = null, t0 = null, tOperando = null;
  for (let t = 0; t < 1200; t += 5) {
    sim.paso(5);
    const z = Z(sim);
    if (z.estado !== vistos[vistos.length - 1]) { vistos.push(z.estado); if (z.estado === 'OPERANDO') tOperando = t; }
    if (z.estado === 'ESPERA_AISLAMIENTO' && t0 === null) { t0 = t; primeraCuenta = z.segundosParaConexion; }
  }
  const util = vistos.filter(x => x !== 'APAGADO');
  assert.deepEqual(util.slice(0, 3), ['ESPERA_AISLAMIENTO', 'ESPERA_RED', 'OPERANDO'], vistos.join(' > '));
  assert.ok(primeraCuenta > 60 && primeraCuenta <= 90, `cuenta ${primeraCuenta}`);
  assert.ok(tOperando - t0 >= 75 && tOperando - t0 <= 100, `tarda ${tOperando - t0} s en conectar`);
  assert.ok(Z(sim).leds.onGrid && !Z(sim).leds.alarma);
  assert.ok(Z(sim).aislamientoMohm > 1);
});

test('ZCS anti-isla: sin red se desconecta en el acto (Off-Grid y alarma) y reconecta tras 60 s', () => {
  const sim = crear({ horaSolar: 11 }); avanzar(sim, 200);
  assert.equal(Z(sim).estado, 'OPERANDO'); assert.ok(Z(sim).acP > 1500);
  sim.ordenes.red.disponible(false); sim.paso(1);
  let z = Z(sim);
  assert.equal(z.estado, 'ESPERA_RED'); assert.equal(z.acP, 0); assert.ok(z.leds.offGrid && z.leds.alarma && !z.leds.onGrid);
  assert.ok(sim.estado.alarmas.some(a => a.codigo === 'ZCS_SIN_RED'));
  avanzar(sim, 120); assert.equal(Z(sim).estado, 'ESPERA_RED', 'sigue sin red');
  sim.ordenes.red.disponible(true); avanzar(sim, 30);
  assert.equal(Z(sim).estado, 'ESPERA_RED'); assert.ok(Z(sim).segundosParaConexion > 20 && Z(sim).segundosParaConexion <= 60);
  avanzar(sim, 45); assert.equal(Z(sim).estado, 'OPERANDO'); assert.ok(Z(sim).acP > 1500);
});

test('ZCS: tensión de red alta reduce potencia (245–253 V) y a 253 V desconecta hasta bajar de 250 V', () => {
  const sim = crear({ horaSolar: 11 }); avanzar(sim, 200);
  const normal = Z(sim).acP;
  sim.ordenes.red.tension(248); avanzar(sim, 60);
  let z = Z(sim);
  assert.equal(z.estado, 'REDUCIDO'); assert.ok(z.acP < 0.75 * normal && z.acP > 0, `reducido ${z.acP} de ${normal}`);
  assert.ok(sim.estado.alarmas.some(a => a.codigo === 'ZCS_REDUCCION_TENSION'));
  sim.ordenes.red.tension(254); avanzar(sim, 5);
  z = Z(sim); assert.equal(z.estado, 'ESPERA_RED'); assert.equal(z.acP, 0);
  assert.ok(sim.estado.alarmas.some(a => a.codigo === 'ZCS_SOBRETENSION_RED'));
  sim.ordenes.red.tension(251); avanzar(sim, 120); assert.equal(Z(sim).estado, 'ESPERA_RED', 'no reconecta hasta bajar de 250 V');
  sim.ordenes.red.tension(230); avanzar(sim, 90); assert.equal(Z(sim).estado, 'OPERANDO');
});

test('ZCS: dos MPPT independientes (una sombra en STR-201 solo baja el MPPT1)', () => {
  const sim = crear({ horaSolar: 11 }); avanzar(sim, 200);
  const antes = Z(sim).mppt.map(m => m.p);
  assert.ok(Math.abs(antes[0] / antes[1] - 1) < 0.05);
  sim.ordenes.ambiente.sombra('PV-201', 1); sim.ordenes.ambiente.sombra('PV-202', 1); avanzar(sim, 30);
  const despues = Z(sim).mppt.map(m => m.p);
  assert.ok(despues[0] < 0.6 * antes[0], `MPPT1 ${despues[0]}`);
  assert.ok(Math.abs(despues[1] / antes[1] - 1) < 0.03, 'MPPT2 no cambia');
  assert.ok(Z(sim).mppt.every(m => m.v >= 90 || !m.activo));
});

test('ZCS: vertido medido por MED-201 (positivo exporta) y autoconsumo cuando el centro consume', () => {
  const sim = crear({ horaSolar: 11 }); avanzar(sim, 200);
  sim.ordenes.cargas.poner('LOAD-301', 500); avanzar(sim, 60);
  assert.ok(Z(sim).vertidoP > 1500 && Math.abs(Z(sim).vertidoP + sim.estado.red.p) < 1e-6, `vertido ${Z(sim).vertidoP}`);
  const exp0 = sim.estado.red.energiaExportadaWh; avanzar(sim, 600);
  assert.ok(sim.estado.red.energiaExportadaWh > exp0 + 100);
  sim.ordenes.cargas.poner('LOAD-301', 6000); avanzar(sim, 60);
  assert.ok(Z(sim).vertidoP < 0 && sim.estado.red.p > 3000, 'con mucho consumo importa de la red');
  assert.ok(sim.estado.cargas['LOAD-301'].w === 6000);
});

test('ZCS: potencia limitada a 3 kW y curva de rendimiento realista (máximo hacia el 40 % de carga, peor con poca carga)', () => {
  const sim = crear({ horaSolar: 11, diaAnio: 172 }); avanzar(sim, 200);
  const z = Z(sim);
  assert.ok(z.acP <= 3000 && z.eficiencia > 0.94 && z.eficiencia <= 0.98, `η=${z.eficiencia}`);
  const { ef } = crearZcs(crearRng(1));
  assert.ok(ef.eta(1200) > 0.965 && ef.eta(1200) <= 0.975, `40 %: ${ef.eta(1200)}`);
  assert.ok(ef.eta(150) < 0.93 && ef.eta(150) > 0.8, `5 %: ${ef.eta(150)}`);
  assert.ok(ef.eta(3000) < ef.eta(1200) && ef.eta(3000) > 0.94, `100 %: ${ef.eta(3000)}`);
  assert.ok(Math.abs(ef.salida(ef.entrada(1700)) - 1700) < 1e-6, 'entrada y salida son inversas');
});

test('ZCS: arranca solo cuando hay tensión de entrada (≥ 100 V) y se duerme de noche', () => {
  const sim = crear({ horaSolar: 20.5, estabilizar: 5 });
  avanzar(sim, 5400);
  assert.equal(Z(sim).estado, 'APAGADO'); assert.equal(Z(sim).acP, 0); assert.ok(!Z(sim).leds.onGrid && !Z(sim).leds.alarma && !Z(sim).leds.offGrid);
  sim.ordenes.inversor.encender('INV-201', false); sim.ordenes.reloj.poner({ horaSolar: 11 }); avanzar(sim, 300);
  assert.equal(Z(sim).estado, 'APAGADO'); assert.equal(Z(sim).acP, 0);
});
