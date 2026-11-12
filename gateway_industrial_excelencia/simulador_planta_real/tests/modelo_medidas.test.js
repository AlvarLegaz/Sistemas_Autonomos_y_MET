'use strict';
// Las medidas del multímetro y el osciloscopio deben dar lo que dice el diagnóstico de cada avería del catálogo.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { medir, PUNTOS } = require('../js/modelo/medidas.js');
const { crearSimulacion, plantaEnProduccion } = require('./modelo_ayuda.js');

const M = (sim, punto, modo) => sim.medidas.medir('multimetro', punto, null, modo);
const cerca = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} no está cerca de ${b} (±${tol})`);
const picoAPico = ondas => Math.max(...ondas) - Math.min(...ondas);

test('la lista de puntos de medida no tiene repetidos y todos tienen modo', () => {
  assert.equal(new Set(PUNTOS.map(p => p.id)).size, PUNTOS.length);
  assert.ok(PUNTOS.length > 60);
  for (const p of PUNTOS) assert.ok(['V', 'mA', 'ohm', 'continuidad', 'temperatura', 'presion'].includes(p.modo), p.id);
});

test('lazo sano: 4-20 mA en serie, unos 19 V en las bornas del transmisor y 24 V en el PLC; la Pt100 vale 100·(1+0,00385·T) Ω', () => {
  const sim = plantaEnProduccion(); const T = sim.estado().proceso.temperaturas.salidaTubo;
  cerca(M(sim, 'TT-103:LAZO', 'mA').valor, 4 + 16 * T / 100, 0.05);
  const v = M(sim, 'TT-103:+', 'V').valor; assert.ok(v > 17 && v < 21, `${v} V`);
  assert.equal(M(sim, 'QE-001:AI-TT-103', 'V').valor, 24);
  cerca(M(sim, 'TT-103:PT100', 'ohm').valor, 100 * (1 + 0.00385 * T), 0.5);
  cerca(M(sim, 'F-201:ENTRADA', 'V').valor, 24, 1e-9); cerca(M(sim, 'F-201:SALIDA', 'V').valor, 24, 1e-9); assert.equal(M(sim, 'F-201:FUSIBLE', 'continuidad').continuidad, true);
  assert.equal(M(sim, 'KM-201:CARGA', 'V').valor === 400 || M(sim, 'KM-201:CARGA', 'V').valor === 0, true);
});

test('el modo equivocado o un punto que no existe no dan valor (ok = false) y explican qué usar', () => {
  const sim = plantaEnProduccion();
  const r = M(sim, 'TT-103:LAZO', 'V'); assert.equal(r.ok, false); assert.match(r.texto, /mA/);
  assert.equal(M(sim, 'NO-EXISTE:X', 'V').ok, false);
  assert.equal(sim.medidas.medir('termometro', 'TT-103:LAZO', null, 'mA').ok, false);
  assert.equal(M(sim, 'TT-103:PT100', 'V').ok, false);
});

test('AV-LAZO-ABIERTO: 0 mA, 0 V en el transmisor pero 24 V en el PLC (el corte está en el cable)', () => {
  const sim = plantaEnProduccion(); sim.averias.inyectar('AV-LAZO-ABIERTO', { tag: 'TT-103' }); sim.paso(3);
  assert.equal(M(sim, 'TT-103:LAZO', 'mA').valor, 0); assert.equal(M(sim, 'TT-103:+', 'V').valor, 0); assert.equal(M(sim, 'QE-001:AI-TT-103', 'V').valor, 24);
  assert.ok(M(sim, 'TT-104:+', 'V').valor > 17);                       // los demás lazos siguen bien
});

test('AV-PT100-ABIERTA y AV-PT100-CORTO: la sonda mide infinito o 0 Ω y los mA lo reflejan', () => {
  const a = plantaEnProduccion(); a.averias.inyectar('AV-PT100-ABIERTA'); a.paso(3);
  assert.equal(M(a, 'TT-103:PT100', 'ohm').valor, Infinity); assert.ok(M(a, 'TT-103:LAZO', 'mA').valor > 21);
  const b = plantaEnProduccion(); b.averias.inyectar('AV-PT100-CORTO'); b.paso(3);
  assert.ok(M(b, 'TT-103:PT100', 'ohm').valor < 0.1); assert.ok(M(b, 'TT-103:LAZO', 'mA').valor < 3.6);
});

test('AV-DERIVA-TT103: en baño patrón a 72 °C el transmisor lee otra cosa', () => {
  const sim = plantaEnProduccion(); sim.averias.inyectar('AV-DERIVA-TT103', { offsetC: 3 });
  const r = M(sim, 'TT-103:BANO', 'temperatura'); assert.equal(r.valor, 72); assert.equal(r.lecturaTransmisor, 75);
  assert.match(r.texto, /Patrón: 72,0/);
  const sana = plantaEnProduccion(); assert.equal(M(sana, 'TT-103:BANO', 'temperatura').lecturaTransmisor, 72);
});

test('AV-RUIDO-4-20: el multímetro da una media normal pero el osciloscopio ve los picos y la malla está sin tierra', () => {
  const sim = plantaEnProduccion(); sim.averias.inyectar('AV-RUIDO-4-20', { tag: 'FT-101', amplitudMA: 8 }); sim.paso(5);
  const onda = sim.medidas.medir('osciloscopio', 'FT-101:LAZO', null, 'osciloscopio');
  assert.equal(onda.ok, true); assert.equal(onda.muestras.length, 200); assert.ok(picoAPico(onda.muestras) > 6); assert.match(onda.texto, /Picos grandes/);
  assert.equal(M(sim, 'FT-101:MALLA', 'continuidad').continuidad, false);
  const sana = plantaEnProduccion();
  assert.ok(picoAPico(sana.medidas.medir('osciloscopio', 'FT-101:LAZO', null, 'osciloscopio').muestras) < 0.2);
  assert.equal(M(sana, 'FT-101:MALLA', 'continuidad').continuidad, true);
});

test('AV-FUSIBLE-F201: 24 V antes del fusible, 0 V después, y el fusible sin continuidad', () => {
  const sim = plantaEnProduccion(); sim.averias.inyectar('AV-FUSIBLE-F201'); sim.paso(3);
  assert.equal(M(sim, 'F-201:ENTRADA', 'V').valor, 24); assert.equal(M(sim, 'F-201:SALIDA', 'V').valor, 0);
  assert.equal(M(sim, 'F-201:FUSIBLE', 'continuidad').continuidad, false); assert.equal(M(sim, 'QE-001:AI-TT-103', 'V').valor, 0);
});

test('AV-FUENTE-24V: unos 18 V y un rizado grande en el osciloscopio frente a uno pequeño en una fuente sana', () => {
  const sim = plantaEnProduccion(); sim.averias.inyectar('AV-FUENTE-24V'); sim.paso(3);
  assert.equal(M(sim, 'PS-001:SALIDA', 'V').valor, 18);
  const mala = sim.medidas.medir('osciloscopio', 'PS-001:SALIDA', null, 'osciloscopio'), buena = plantaEnProduccion().medidas.medir('osciloscopio', 'PS-001:SALIDA', null, 'osciloscopio');
  assert.ok(picoAPico(mala.muestras) > 2.5); assert.ok(picoAPico(buena.muestras) < 0.2);
});

test('AV-KM-PEGADO: orden 0 en la bobina pero 400 V en la carga y contactos cerrados', () => {
  const sim = plantaEnProduccion(); sim.averias.inyectar('AV-KM-PEGADO', { tag: 'KM-201' }); sim.ordenes.parar(); sim.paso(20);
  assert.equal(M(sim, 'KM-201:BOBINA', 'V').valor, 0); assert.equal(M(sim, 'KM-201:CARGA', 'V').valor, 400); assert.ok(M(sim, 'KM-201:CONTACTOS', 'ohm').valor < 0.1);
});

test('AV-KM-NO-CIERRA: 24 V en la bobina (orden dada) y 0 V en la carga', () => {
  const sim = crearSimulacion(); sim.averias.inyectar('AV-KM-NO-CIERRA', { tag: 'KM-102' }); sim.ordenes.arrancar(); sim.paso(20);
  assert.equal(M(sim, 'KM-102:BOBINA', 'V').valor, 24); assert.equal(M(sim, 'KM-102:CARGA', 'V').valor, 0); assert.equal(M(sim, 'KM-102:CONTACTOS', 'ohm').valor, Infinity);
  assert.equal(M(sim, 'KM-102:BOBINA-R', 'ohm').valor, 650);
});

test('AV-BOBINA-ABIERTA: llegan 24 V al piloto pero la bobina mide infinito', () => {
  const sim = plantaEnProduccion(); sim.averias.inyectar('AV-BOBINA-ABIERTA');      // la FDV solo se manda a avance en producción (en recirculación de agua queda en desvío)
  let visto = false; for (let t = 0; t < 20 && !visto; t++) { sim.paso(0.5); if (M(sim, 'SV-101:BORNAS', 'V').valor === 24) visto = true; }
  assert.ok(visto, 'el PLC debe dar la orden de avance'); assert.equal(M(sim, 'SV-101:BOBINA', 'ohm').valor, Infinity);
  assert.equal(M(crearSimulacion(), 'SV-101:BOBINA', 'ohm').valor, 220);
});

test('AV-FDV-ATASCADA y AV-AIRE-BAJO: finales de carrera y manómetro dicen dónde está el fallo', () => {
  const a = crearSimulacion(); a.averias.inyectar('AV-FDV-ATASCADA'); a.paso(5);
  assert.equal(M(a, 'FDV-101:ZS-102', 'continuidad').continuidad, false); assert.equal(M(a, 'FDV-101:ZS-101', 'continuidad').continuidad, true); cerca(M(a, 'FRL-101:MANOMETRO', 'presion').valor, 6, 1e-9);
  const b = crearSimulacion(); b.averias.inyectar('AV-AIRE-BAJO'); b.paso(5);
  cerca(M(b, 'FRL-101:MANOMETRO', 'presion').valor, 3.5, 1e-9); assert.equal(M(b, 'PSL-201:CONTACTO', 'continuidad').continuidad, false);
});

test('AV-VFD-SOBRETEMP, AV-FILTRO-OBSTRUIDO, AV-PLACA-FUGA y AV-TSH-DISPARADO se miden como dice el catálogo', () => {
  const v = crearSimulacion(); v.averias.inyectar('AV-VFD-SOBRETEMP'); v.ordenes.arrancar(); v.paso(400);
  assert.ok(M(v, 'VFD-101:DISIPADOR', 'temperatura').valor > 80); assert.equal(M(v, 'VFD-101:VENTILADOR', 'V').valor, 0);
  const f = crearSimulacion(); f.averias.inyectar('AV-FILTRO-OBSTRUIDO'); f.ordenes.arrancar(); f.paso(60);
  assert.ok(M(f, 'FLT-101:PRESION-ANTES', 'presion').valor - M(f, 'FLT-101:PRESION-DESPUES', 'presion').valor > 0.15);
  const p = crearSimulacion(); p.averias.inyectar('AV-PLACA-FUGA'); p.ordenes.arrancar(); p.paso(60);
  const dp = (M(p, 'PT-102:LAZO', 'mA').valor - M(p, 'PT-101:LAZO', 'mA').valor) / 16 * 6;
  assert.ok(dp < 0.07, `diferencial ${dp.toFixed(2)} bar`);
  const t = crearSimulacion(); t.averias.inyectar('AV-TSH-DISPARADO'); t.ordenes.arrancar(); t.paso(20);
  assert.equal(M(t, 'TSH-101:CONTACTO', 'continuidad').continuidad, false); assert.ok(M(t, 'TT-105:LAZO', 'mA').valor < 6.5);      // contacto abierto con el agua fría
  assert.equal(M(crearSimulacion(), 'TSH-101:CONTACTO', 'continuidad').continuidad, true);
});

test('medir es una función pura: no cambia el estado', () => {
  const sim = plantaEnProduccion(); const antes = JSON.stringify(sim.estado());
  for (const p of PUNTOS) medir('multimetro', p.id, null, p.modo, sim.estado());
  assert.equal(JSON.stringify(sim.estado()), antes);
});
