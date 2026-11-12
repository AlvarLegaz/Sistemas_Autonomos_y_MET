// Ayudas comunes de las pruebas del modelo (no es una prueba: no acaba en .test.js).
'use strict';
const { crearSimulacion } = require('../js/modelo/simulacion.js');

/** Avanza `segundos` en pasos de 5 s y devuelve el estado. */
function avanzar(sim, segundos, paso = 5) {
  for (let t = 0; t < segundos - 1e-9; t += paso) sim.paso(Math.min(paso, segundos - t));
  return sim.estado;
}

/** Simulación lista a una hora dada y ya estabilizada (el ZCS conectado si hay sol). */
function crear({ semilla = 1, diaAnio = 172, horaSolar = 11, nubosidad = 0, socInicial = 40, estabilizar = 400 } = {}) {
  const sim = crearSimulacion({ semilla, diaAnio, horaSolar, nubosidad });
  sim.ordenes.bateria.socInicial(socInicial);
  avanzar(sim, estabilizar);
  return sim;
}

/** Recorre recursivamente un objeto y devuelve la primera ruta con un número no finito (o null). */
function buscarNoFinito(obj, ruta = 'estado') {
  if (typeof obj === 'number') return Number.isFinite(obj) ? null : ruta;
  if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) { const r = buscarNoFinito(v, `${ruta}.${k}`); if (r) return r; }
  return null;
}

const codigos = sim => sim.estado.alarmas.map(a => a.codigo);
const cierto = (x, y, tol) => Math.abs(x - y) <= tol;
const copia = o => JSON.parse(JSON.stringify(o));

module.exports = { crearSimulacion, avanzar, crear, buscarNoFinito, codigos, cierto, copia };
