// Ayudas comunes de las pruebas del modelo (no es una prueba: no acaba en .test.js).
'use strict';
const { crearSimulacion } = require('../js/modelo/simulacion.js');

/** Planta en producción estable (arrancada, caliente y con la FDV en avance). Reutiliza el cálculo con una copia por prueba. */
function plantaEnProduccion(semilla = 1) {
  const sim = crearSimulacion({ semilla });
  sim.ordenes.arrancar();
  for (let t = 0; t < 3000 && sim.estado().modo !== 'PRODUCCION'; t += 10) sim.paso(10);
  sim.paso(120);                                    // un par de minutos más para que estabilice
  return sim;
}

const codigos = sim => sim.alarmas().map(a => a.codigo);
const conCodigo = (sim, codigo, tag) => sim.alarmas().some(a => a.codigo === codigo && (tag == null || a.tag === tag));
const media = lista => lista.reduce((s, v) => s + v, 0) / lista.length;

module.exports = { crearSimulacion, plantaEnProduccion, codigos, conCodigo, media };
