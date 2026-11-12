// Parámetros físicos y de control de la planta HTST. Todo son valores típicos de la literatura, ILUSTRATIVOS (no de una instalación concreta).
// Unidades: °C, L, L/h, kW, bar, s. Lo lee todo el modelo; no depende de nada más que del contrato layout.js.
(function () {
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.htstLayout;

  const CONSTANTES = {
    PASO_S: 0.1,                                   // paso fijo de la simulación (la API acepta cualquier dt y lo trocea)
    proceso: layout.PROCESO,

    // Tanque de balance (se repone solo para que la producción no se agote en una clase)
    tanque: { capacidadL: 200, nivelInicialPct: 60, temperaturaC: 4, reposicionLh: 2600, reponerDesdePct: 85, reponerHastaPct: 95, nivelAltoPct: 90, nivelBajoPct: 10,
      llenadoXV101Lh: 2600, vaciadoXV102Lh: 2400 },                                      // caudales de las válvulas de llenado (XV-101) y de vaciado (XV-102)

    leche: { calorEspecificoKJkgK: 3.85, densidadKgL: 1.03 },

    // Intercambiador de placas: efectividad de cada sección (fracción de la diferencia máxima de temperatura que se recupera)
    intercambiador: {
      efRegeneracion: 0.9, efCalentamiento: 0.8, efEnfriamiento: 0.8, efEnfriamientoSinAgua: 0.05,
      temperaturaAguaFriaC: 2, tauSeccionS: 6,                       // constante de tiempo de cada sección
    },

    // Agua caliente: depósito de 150 L con dos bancos de resistencias; el TSH-101 es el termostato de seguridad (contacto NC)
    aguaCaliente: {
      volumenL: 150, ambienteC: 20, perdidasWK: 60, bancoKW: 30, calorEspecificoKJkgK: 4.186,
      tshDisparoC: 90, tshRearmeC: 80, maximoFisicoC: 99,
      // Nivel del depósito: el llenado (XV-302) entra agua de red fría y el vaciado (XV-303) la saca; el depósito tiene rebosadero (no pasa del 100 %).
      capacidadL: 150, nivelInicialPct: 100, nivelBajoPct: 15, nivelAltoPct: 90, llenadoXV302Lh: 1500, vaciadoXV303Lh: 1800, temperaturaRedC: 15, volumenMinimoInerciaL: 5,
    },

    // Bombas
    p101: { caudalMaximoLh: 2500, velocidadMinimaPct: 20, corrienteNominalA: 9, tauCaudalS: 2 },
    p102: { corrienteNominalA: 6 },

    // Válvula de desvío neumática (FDV-101): el muelle la lleva a DESVIO sin tensión o sin aire
    fdv: { tiempoMovimientoS: 1.5, factorLentaConAireBajo: 3 },
    aire: { presionNominalBar: 6, presionBajaBar: 3 },

    // Presiones de la regeneración (el lado pasteurizado debe quedar por encima del crudo)
    presiones: { crudoBaseBar: 0.8, crudoPorCaudalBar: 0.6, diferencialAvanceBar: 0.5, diferencialDesvioBar: 0.3 },

    // Variador de P-101
    variador: { ambienteC: 35, disparoC: 80, ventiladorParadoC: 95, tauS: 120, subidaPorCorrienteC: 1.5 },

    // Programa del PLC
    plc: {
      consignaAguaBaseC: 75, kpTrim: 1.5, kiTrim: 0.04, trimMinC: -6, trimMaxC: 8,       // consigna del agua en cascada con TT-103
      banco1: { encenderPorDebajoC: 0.5, apagarPorEncimaC: 0.3 },                         // respecto a la consigna del agua
      banco2: { encenderPorDebajoC: 4, apagarPorEncimaC: -1.5 },
      limiteAguaC: 88,                                                                    // límite alto por software (el TSH está en 90)
      margenAvanceC: 0.5, margenMantenerC: 0.2,                                           // sobre 72 °C: para entrar en avance hay que superar 72,5 y para seguir en él 72,2 (la FDV tarda en moverse)
      xv301: { abrirPorEncimaC: 5.5, cerrarPorDebajoC: 4.5 },
      toleranciaDiscrepanciaS: 3, retornoRecirculacionS: 10, estabilidadProduccionS: 20,
      llenadoAguaExtraS: 330,                                                              // tras recuperar el nivel bajo, el PLC sigue llenando el depósito de agua este tiempo (con rebosadero)
    },

    // CIP básico por tiempos: cada paso tiene su duración y la temperatura del agua que se pide
    cip: { pasos: [
      { nombre: 'ENJUAGUE_1', duracionS: 60, aguaC: 45 }, { nombre: 'SOSA_CALIENTE', duracionS: 120, aguaC: 75 },
      { nombre: 'ENJUAGUE_2', duracionS: 60, aguaC: 45 }, { nombre: 'ACIDO', duracionS: 120, aguaC: 65 }, { nombre: 'ENJUAGUE_3', duracionS: 60, aguaC: 40 },
    ] },

    // Armario eléctrico
    electrico: { tension24V: 24, tensionFuenteDegradadaV: 18, tensionPotenciaV: 400, resistenciaBobinaSV101Ohm: 220, resistenciaBobinaContactorOhm: 650, resistenciaBobinaXVOhm: 240 },
  };

  const api = { CONSTANTES };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstConstantes = api; }
})();
