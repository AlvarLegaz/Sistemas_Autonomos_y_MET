// Núcleo común · generador de azar con semilla (contrato §3.1). Todo el azar del código NUEVO del modelo sale de aquí: PCT.nucleo.azar(semilla).
// Los generadores que ya existían (crearRng de la fotovoltaica y calidad.ruido de la planta real) se conservan: cambiarlos alteraría resultados probados.
// Algoritmo mulberry32 (32 bits, periodo 2³²): rápido, reproducible en cualquier motor JS (solo usa enteros de 32 bits, sin Math.random ni la hora).
(function () {
  'use strict';

  const semillaValida = s => Number.isInteger(s) && s >= 1 && s <= 4294967295;

  /**
   * azar(semilla, estado?) → { uniforme() [0,1), normal() N(0,1), entero(n) [0,n), estado() }.
   * `estado` permite continuar un generador guardado (lo que devuelve .estado()), para instantáneas.
   */
  function azar(semilla, estado) {
    if (!semillaValida(semilla)) throw Object.assign(new Error('semilla_invalida'), { codigo: 'opciones_invalidas' });
    let a = Number.isInteger(estado) ? estado >>> 0 : semilla >>> 0;
    function uniforme() {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    function normal() {                                  // Box-Muller (sin guardar la segunda muestra: así todo el estado es `a`)
      const u = Math.max(uniforme(), 1e-12), v = uniforme();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }
    const entero = n => Math.floor(uniforme() * Math.max(0, Math.floor(n)));
    return { uniforme, normal, entero, estado: () => a };
  }

  const api = { azar, semillaValida };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { const P = (window.PCT = window.PCT || {}); P.nucleo = Object.assign(P.nucleo || {}, api); }
})();
