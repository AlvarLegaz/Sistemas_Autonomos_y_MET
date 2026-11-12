'use strict';
// AÑADIDO POR EL TESTER (ronda modo manual): estabilidad numérica y protecciones cableadas en MANUAL, solo con la API pública.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { crearSimulacion } = require('./modelo_ayuda.js');
const layout = require('../js/layout.js');

// Generador pseudoaleatorio determinista (no usa Math.random para que el fallo se pueda reproducir).
function azar(semilla) { let s = semilla >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

const ACTUADORES = ['P-101', 'P-102', 'P-103', 'KM-201', 'KM-202', 'SV-101', 'XV-301', 'XV-401', 'XV-101', 'XV-102', 'XV-302', 'XV-303'];

function sinNoFinitos(obj, ruta = 'estado') {
  const malos = [];
  (function rec(o, r) {
    for (const [k, v] of Object.entries(o || {})) {
      const permitido = v === Infinity && (k === 'tiempoResidenciaS' || k === 'bobinaOhm');   // Infinity deliberado (caudal 0 / bobina abierta)
      if (typeof v === 'number' && !Number.isFinite(v) && !permitido) malos.push(`${r}.${k}=${v}`);
      else if (v && typeof v === 'object') rec(v, `${r}.${k}`);
    }
  })(obj, ruta);
  return malos;
}

test('24 h en MANUAL con órdenes aleatorias: sin NaN/Infinity y niveles entre 0 y 100 %', () => {
  const sim = crearSimulacion({ semilla: 7 });
  const r = azar(12345);
  sim.ordenes.modo('MANUAL');
  const problemas = [];
  for (let t = 0; t < 86400; t += 5) {
    if (r() < 0.04) sim.ordenes.manual(ACTUADORES[Math.floor(r() * ACTUADORES.length)], r() < 0.5 ? 1 : 0);
    if (r() < 0.02) sim.ordenes.manual('VFD-101', Math.round(r() * 140 - 20));      // incluso fuera de rango
    if (r() < 0.0005) sim.ordenes.paroEmergencia(true);
    if (r() < 0.001) sim.ordenes.paroEmergencia(false);
    if (r() < 0.002) sim.ordenes.modo(layout.MODOS[Math.floor(r() * layout.MODOS.length)]);
    sim.paso(5);
    const e = sim.estado();
    const nf = sinNoFinitos(e);
    if (nf.length) { problemas.push(`t=${t} no finitos: ${nf.slice(0, 4).join(', ')}`); break; }
    const niv = [e.tanque.nivelPct, e.aguaCaliente.nivelPct];
    if (niv.some(n => n < -1e-9 || n > 100 + 1e-9)) { problemas.push(`t=${t} nivel fuera de 0-100: ${niv.join(', ')}`); break; }
  }
  assert.deepEqual(problemas, []);
});

test('transiciones de modo repetidas entre los cinco modos no dejan estado inconsistente', () => {
  const sim = crearSimulacion({ semilla: 3 });
  const r = azar(99);
  for (let i = 0; i < 400; i++) {
    sim.ordenes.modo(layout.MODOS[Math.floor(r() * layout.MODOS.length)]);
    if (r() < 0.3) sim.ordenes.arrancar();
    if (r() < 0.2) sim.ordenes.parar();
    sim.paso(1 + Math.floor(r() * 30));
    const e = sim.estado();
    assert.deepEqual(sinNoFinitos(e), [], `iteración ${i}`);
    assert.ok(layout.MODOS.includes(e.modo), `modo desconocido ${e.modo}`);
  }
});

test('MANUAL: el termostato abierto (TSH-101) corta el calentador aunque el operador lo pida', () => {
  const sim = crearSimulacion({ semilla: 1 });
  sim.ordenes.modo('MANUAL');
  for (const t of ['P-102', 'KM-201', 'KM-202', 'XV-302']) sim.ordenes.manual(t, 1);
  sim.paso(1200);
  const e = sim.estado();
  assert.ok(e.aguaCaliente.temperaturaC > 40, 'el calentador debería haber calentado antes del disparo');
  // Con el agua muy caliente (≥88 °C) el termostato/protección debe cortar: seguimos pidiendo calor 3 h más
  sim.paso(3 * 3600);
  const f = sim.estado();
  assert.ok(f.aguaCaliente.temperaturaC < 100, `el agua no debe pasar de 100 °C: ${f.aguaCaliente.temperaturaC}`);
});

test('MANUAL: calentador sin P-102 en marcha no calienta (protección cableada)', () => {
  const sim = crearSimulacion({ semilla: 1 });
  sim.ordenes.modo('MANUAL');
  sim.ordenes.manual('KM-201', 1); sim.ordenes.manual('KM-202', 1); sim.ordenes.manual('XV-302', 1);
  sim.paso(900);
  const t0 = sim.estado().aguaCaliente.temperaturaC;
  assert.ok(t0 < 35, `sin P-102 el agua no debería calentarse (T=${t0})`);
});

test('MANUAL: P-101 sin leche (tanque vacío) se para por marcha en seco', () => {
  const sim = crearSimulacion({ semilla: 1 });
  sim.ordenes.modo('MANUAL');
  sim.ordenes.manual('XV-102', 1);                    // vaciar el tanque de balance
  sim.paso(1800);
  assert.ok(sim.estado().tanque.nivelPct < 1, 'el tanque debería estar vacío');
  sim.ordenes.manual('P-101', 1); sim.ordenes.manual('VFD-101', 100);
  sim.paso(30);
  const e = sim.estado();
  assert.ok(!(e.equipos['P-101'].marcha || e.equipos['P-101'].enMarcha) || e.proceso.caudalLh === 0, 'P-101 no debe mover caudal en seco');
});

test('MANUAL: el paro de emergencia apaga todo y se mantiene hasta rearmar', () => {
  const sim = crearSimulacion({ semilla: 1 });
  sim.ordenes.modo('MANUAL');
  for (const t of ACTUADORES) sim.ordenes.manual(t, 1);
  sim.paso(60);
  sim.ordenes.paroEmergencia(true);
  sim.paso(5);
  const DO = sim.estado().salidasPLC && sim.estado().salidasPLC.DO;
  assert.ok(DO, 'falta estado.salidasPLC.DO');
  for (const t of ['P-101', 'P-102', 'P-103', 'KM-201', 'KM-202']) assert.ok(!DO[t], `${t} sigue activo tras el paro`);
  sim.paso(120);
  for (const t of ['P-101', 'P-102', 'KM-201']) assert.ok(!sim.estado().salidasPLC.DO[t], `${t} se reactivó solo`);
});
