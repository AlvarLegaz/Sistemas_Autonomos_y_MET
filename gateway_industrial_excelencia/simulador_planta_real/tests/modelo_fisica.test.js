'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const layout = require('../js/layout.js');
const { CONSTANTES: C } = require('../js/configuracion/constantes.js');
const termica = require('../js/modelo/fisica_termica.js');
const hidraulica = require('../js/modelo/fisica_hidraulica.js');
const calidad = require('../js/plc/calidad_senal.js');
const instrumentos = require('../js/modelo/instrumentos.js');
const { crearEstado } = require('../js/modelo/estado.js');

const cerca = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} no está cerca de ${b} (±${tol})`);

test('el tiempo de residencia del tubo es el del diseño: 10,5 L a 2500 L/h = 15,1 s', () => {
  cerca(hidraulica.tiempoResidenciaS(2500), 15.12, 0.01);
  assert.equal(hidraulica.tiempoResidenciaS(0), Infinity);
  assert.ok(hidraulica.tiempoResidenciaS(2000) > 15);          // con menos caudal se cumple de sobra
});

test('el caudal de P-101 sigue la velocidad y cae con el filtro obstruido o el tanque vacío', () => {
  assert.equal(hidraulica.caudalObjetivo({ marcha: false, velocidadPct: 80 }), 0);
  cerca(hidraulica.caudalObjetivo({ marcha: true, velocidadPct: 80 }), 2000);
  assert.ok(hidraulica.caudalObjetivo({ marcha: true, velocidadPct: 80, obstruccion01: 0.7 }) < 1100);
  assert.equal(hidraulica.caudalObjetivo({ marcha: true, velocidadPct: 80, nivelPct: 0 }), 0);
});

test('presiones de la regeneración: el pasteurizado por encima del crudo y una fuga lo invierte', () => {
  const sano = hidraulica.presiones({ caudalLh: 2000, hayAvance: true });
  assert.ok(sano.pasteurizadoBar - sano.crudoBar >= C.proceso.diferencialMinimoRegeneracionBar);
  const fuga = hidraulica.presiones({ caudalLh: 2000, hayAvance: true, fuga01: 0.9 });
  assert.ok(fuga.pasteurizadoBar - fuga.crudoBar < C.proceso.diferencialMinimoRegeneracionBar);
  const parada = hidraulica.presiones({ caudalLh: 0, hayAvance: false });
  assert.equal(parada.crudoBar, parada.pasteurizadoBar);
});

test('la FDV tarda su tiempo en moverse, el aire bajo la hace más lenta y atascada no sale de avance', () => {
  let a = 0;
  for (let t = 0; t < 1.0; t += 0.1) a = hidraulica.pasoFDV(a, { objetivo01: 1, dt: 0.1, aireOK: true });
  assert.ok(a > 0.5 && a < 1);
  let b = 0;
  for (let t = 0; t < 1.0; t += 0.1) b = hidraulica.pasoFDV(b, { objetivo01: 1, dt: 0.1, aireOK: false });
  assert.ok(b < a);
  assert.equal(hidraulica.pasoFDV(1, { objetivo01: 0, dt: 5, aireOK: true, atascadaEnAvance: true }), 1);
  assert.equal(hidraulica.posicionFDV(1), 'AVANCE'); assert.equal(hidraulica.posicionFDV(0), 'DESVIO'); assert.equal(hidraulica.posicionFDV(0.5), 'MOVIENDO');
});

test('el tanque se llena y vacía sin salirse de 0 y de su capacidad', () => {
  assert.equal(hidraulica.pasoTanque(0, { entradaLh: 0, salidaLh: 3000, dt: 10 }), 0);
  assert.equal(hidraulica.pasoTanque(199, { entradaLh: 36000, salidaLh: 0, dt: 10 }), C.tanque.capacidadL);
});

test('regeneración: la leche cruda sale mucho más caliente que a la entrada y el pasteurizado se enfría con ella', () => {
  const o = termica.objetivosProducto({ entradaC: 4, aguaC: 75, salidaTuboC: 73.5, caudalLh: 2000, hayAvance: true, aguaFria: true });
  assert.ok(o.t102 > 55 && o.t102 < 73.5);
  assert.ok(o.tCalentamiento > o.t102 && o.tCalentamiento < 75);
  assert.ok(o.tTrasRegeneracionPas < 20);                 // el producto caliente cede casi todo su calor al crudo
  assert.ok(o.t104 < 8);                                  // y con agua fría sale a unos 4-5 °C
  const sinAgua = termica.objetivosProducto({ entradaC: 4, aguaC: 75, salidaTuboC: 73.5, caudalLh: 2000, hayAvance: true, aguaFria: false });
  assert.ok(sinAgua.t104 > o.t104 + 3);
});

test('sin avance no llega producto caliente a la regeneración: se pierde la recuperación de calor', () => {
  const con = termica.objetivosProducto({ entradaC: 4, aguaC: 75, salidaTuboC: 73.5, caudalLh: 2000, hayAvance: true, aguaFria: true });
  const sin = termica.objetivosProducto({ entradaC: 4, aguaC: 75, salidaTuboC: 73.5, caudalLh: 2000, hayAvance: false, aguaFria: true });
  assert.ok(sin.t102 < con.t102 - 30);
  assert.equal(sin.t102, 4);
});

test('el agua caliente sube con los bancos, baja con la leche y no pasa de 99 °C ni baja del ambiente', () => {
  const sube = termica.pasoAguaCaliente(20, { potenciaKW: 60, perdidaLecheKW: 0, dt: 10 });
  assert.ok(sube > 20.5);
  const baja = termica.pasoAguaCaliente(60, { potenciaKW: 0, perdidaLecheKW: 20, dt: 10 });
  assert.ok(baja < 60);
  assert.equal(termica.pasoAguaCaliente(98.9, { potenciaKW: 60, perdidaLecheKW: 0, dt: 600 }), C.aguaCaliente.maximoFisicoC);
  assert.equal(termica.pasoAguaCaliente(20, { potenciaKW: 0, perdidaLecheKW: 50, dt: 600 }), C.aguaCaliente.ambienteC);
});

test('el termostato dispara a 90 °C y solo se rearma a mano por debajo de 80 °C', () => {
  assert.equal(termica.pasoTermostato(false, 89.9, false), false);
  assert.equal(termica.pasoTermostato(false, 90, false), true);
  assert.equal(termica.pasoTermostato(true, 70, false), true);      // sin rearme manual sigue abierto
  assert.equal(termica.pasoTermostato(true, 85, true), true);       // rearme pero todavía caliente
  assert.equal(termica.pasoTermostato(true, 79, true), false);
});

test('el disipador del variador se calienta hasta unos 95 °C con el ventilador parado y se mantiene fresco con él', () => {
  let t = 35, u = 35;
  for (let i = 0; i < 6000; i++) { t = termica.pasoDisipadorVariador(t, { corrienteA: 7, ventiladorOK: false, dt: 0.1 }); u = termica.pasoDisipadorVariador(u, { corrienteA: 7, ventiladorOK: true, dt: 0.1 }); }
  assert.ok(t > 80); assert.ok(u < 60);
});

test('lazos 4-20 mA: conversión, límites NAMUR y valor que lee el PLC', () => {
  cerca(layout.aMilisamperios(0, 0, 100), 4); cerca(layout.aMilisamperios(100, 0, 100), 20); cerca(layout.aMilisamperios(50, 0, 100), 12);
  assert.equal(calidad.clasificarLazo(3.5), 'ABIERTO'); assert.equal(calidad.clasificarLazo(3.6), 'OK'); assert.equal(calidad.clasificarLazo(21), 'OK');
  assert.equal(calidad.clasificarLazo(21.1), 'CORTO'); assert.equal(calidad.clasificarLazo(NaN), 'ABIERTO');
  cerca(calidad.valorPLC(12, 0, 100), 50);
  assert.equal(calidad.combinarCalidad('RUIDO', 12), 'RUIDO');
  assert.equal(calidad.combinarCalidad('RUIDO', 22), 'CORTO');                   // un pico fuera de límites manda
  assert.equal(calidad.combinarCalidad('CORTO', 3.55), 'CORTO');                 // la avería de sonda en corto fija su calidad
  assert.equal(calidad.lazoSano('DERIVA'), true); assert.equal(calidad.lazoSano('ABIERTO'), false); assert.equal(calidad.lazoSano('CONGELADO'), false);
});

test('el ruido determinista es repetible y está en [-1, 1]', () => {
  assert.equal(calidad.ruido(1, 5.5, 3), calidad.ruido(1, 5.5, 3));
  assert.notEqual(calidad.ruido(1, 5.5, 3), calidad.ruido(2, 5.5, 3));
  for (let i = 0; i < 200; i++) { const r = calidad.ruido(3, i * 0.1, i); assert.ok(r >= -1 && r <= 1); }
});

test('instrumentos: cada AI convierte su magnitud con su rango y los digitales de seguridad son NC', () => {
  const e = crearEstado();
  e.proceso.temperaturas.salidaTubo = 72; e.proceso.caudalLh = 1500; e.tanque.nivelPct = 50;
  const alim = { v24: 24, fusibleF201: true };
  const tt = instrumentos.leerAI('TT-103', e, 0, null, alim); cerca(tt.mA, 4 + 16 * 0.72, 1e-9); assert.equal(tt.calidad, 'OK'); cerca(tt.valorPLC, 72, 1e-9);
  const ft = instrumentos.leerAI('FT-101', e, 0, null, alim); cerca(ft.valorPLC, 1500, 1e-6);
  const dig = instrumentos.nivelesDigitales(e, false);
  assert.equal(dig['ES-001'], 1); assert.equal(dig['TSH-201'], 1); assert.equal(dig['LSL-101'], 1); assert.equal(dig['LSH-101'], 0);
  e.equipos['ES-001'].rearmado = false; e.equipos['TSH-201'].abierto = true;
  const roto = instrumentos.nivelesDigitales(e, false); assert.equal(roto['ES-001'], 0); assert.equal(roto['TSH-201'], 0);
});

test('sin el fusible F-001 los lazos leen 0 mA (ABIERTO) y todas las entradas digitales leen 0', () => {
  const e = crearEstado();
  const ent = instrumentos.leerEntradas(e, 0, null, { v24: 24, fusibleF201: false }, false);
  for (const tag of Object.keys(ent.AI)) { assert.equal(ent.AI[tag].mA, 0); assert.equal(ent.AI[tag].calidad, 'ABIERTO'); }
  for (const tag of Object.keys(ent.DI)) assert.equal(ent.DI[tag], 0);
  e.equipos['PS-001'].tensionV = 18;                                    // la simulación pone aquí la tensión de la fuente
  const baja = instrumentos.leerEntradas(e, 0, null, { v24: 18, fusibleF201: true }, false);
  assert.equal(baja.AI['TT-103'].calidad, 'CORTO'); assert.equal(baja.DI['PS-001'], 0);
});
