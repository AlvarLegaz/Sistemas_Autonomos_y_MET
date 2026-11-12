// Constantes físicas y de modelado del simulador fotovoltaico (lo que NO está en layout.js: parámetros del modelo, no de la instalación).
// ORDEN DE CARGA en el navegador (cada módulo usa PCT.fv.<anterior> al cargarse; en Node se resuelve con require):
//   layout.js, configuracion/constantes.js, modelo/sol.js, modelo/panel.js, modelo/cadena.js, modelo/seguidor.js, modelo/bateria.js,
//   modelo/protecciones.js, modelo/red_cargas.js, modelo/inversor_easun.js, modelo/inversor_zcs.js, modelo/medidas.js,
//   averias/catalogo.js, averias/motor.js, modelo/simulacion.js
(function () {
  const layout = typeof require !== 'undefined' ? require('../layout.js') : window.PCT.fvLayout;

  const CONSTANTES = {
    G_STC: 1000, T_STC: 25,
    TARIFA_EUR_KWH: 0.15,                      // tarifa supuesta del ahorro
    ALBEDO: 0.2,                               // reflectividad del suelo (césped artificial y grava)
    CORRIENTE_ISC_COEF: 0.0005,                // 1/K, coeficiente de temperatura de la corriente de cortocircuito (supuesto típico)
    FACTOR_IDEALIDAD: 1.25,                    // n del diodo, para la caída logarítmica de Voc con la irradiancia
    VOLTAJE_CELULA_V: 0.63,                    // Voc por célula en serie (para contar células en serie)
    DIODO_PASO_V: 0.6,                         // caída del diodo de paso conduciendo
    TAU_TERMICA_PANEL_S: 120,                  // constante de tiempo de la temperatura de célula
    CABLE_CADENA_OHM: 0.12,                    // resistencia de cables y conectores sanos de una cadena (ida y vuelta)
    DESAJUSTE_SIGMA: 0.012,                    // dispersión típica de Isc entre paneles de una cadena (1,2 %)
    SEGUIDOR: { periodoS: 1, pasoRel: 0.006, eficiencia: 0.995, barridoEasunS: 900, barridoZcsS: 600 },
    EASUN: { etaDcdc: 0.97, etaBypass: 0.995, cargaRedMaxA: 20, absorcionFinA: 5, rRedOhm: 0, tempReduceC: 75, tempFalloC: 95, tempRearmeC: 75,
      rThCw: 0.12, tauTermicaS: 400, umbralSobrecarga: 1.0 },
    ZCS: { aislamientoMinMohm: 0.5, aislamientoSanoMohm: 12, aislamientoFalloMohm: 0.08, tiempoAislamientoS: 30, reintentoAislamientoS: 60,
      redTripMaxV: 253, redReduceDesdeV: 245, redReconectaV: 250, redTripMinV: 195.5, fMin: 47.5, fMax: 51.5, zRedOhm: 0.3, rThCw: 0.10, tempReduceC: 70, tempFalloC: 90, tauTermicaS: 400, pMinAcW: 8 },
    CASETA: { uaNormalWK: 60, uaTapadaWK: 8, tauS: 900, subidaBasePorSolC: 0 },
    RED: { zOhm: 0.3 },
    BATERIA: { rPackOhm: 0.015, etaCarga: 0.985, bmsCeldaAltaRearmeV: 3.5, bmsCeldaBajaRearmeV: 2.9, tauTermicaS: 3600 },
    PROTECCIONES: {
      QF301: { inA: 32 }, QF302: { inA: 16 }, QF303: { inA: 16 }, QB101: { inA: 125 }, tiempoDisparoS: 10, factorDisparo: 1.45,
    },
    PRETIL: { alturaCriticaGrados: 62, alturaPlenaGrados: 47, sombraMax: 0.55, paneles: ['PV-205', 'PV-206'] }, // sombra del pretil sobre la fila delantera del campo B
    SUCIEDAD_AVERIA_A: 0.3,
  };

  /** Generador pseudoaleatorio determinista (mulberry32): misma semilla, misma secuencia. */
  function crearRng(semilla = 1) {
    let a = (Math.floor(semilla) >>> 0) || 1;
    const uniforme = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const normal = () => { const u = Math.max(uniforme(), 1e-12), v = uniforme(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    return { uniforme, normal };
  }

  const api = { CONSTANTES, layout, crearRng };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { const P = (window.PCT = window.PCT || {}); (P.fv = P.fv || {}).constantes = api; }
})();
