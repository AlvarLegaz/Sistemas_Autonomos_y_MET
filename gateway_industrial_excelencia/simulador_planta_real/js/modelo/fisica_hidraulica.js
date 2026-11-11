// Hidráulica de la planta HTST: caudal de la bomba P-101, tiempo de residencia, presiones de la regeneración, FDV y tanque de balance. Funciones puras.
(function () {
  const { CONSTANTES: C } = typeof require !== 'undefined' ? require('../configuracion/constantes.js') : PCT.htstConstantes;
  const limitar = (v, min, max) => Math.max(min, Math.min(max, v));

  /** Caudal objetivo (L/h) de P-101: velocidad del variador, filtro obstruido (0..1) y tanque vacío. */
  function caudalObjetivo({ marcha, velocidadPct, obstruccion01 = 0, nivelPct = 100 }) {
    if (!marcha || nivelPct <= 0.5) return 0;
    const v = limitar(velocidadPct, 0, 100) / 100;
    return C.p101.caudalMaximoLh * v * (1 - 0.7 * limitar(obstruccion01, 0, 1));
  }

  /** Tiempo (s) que tarda el producto en recorrer el tubo de residencia. Sin caudal es infinito. */
  const tiempoResidenciaS = (caudalLh, volumenL = C.proceso.volumenTuboResidenciaL) => (caudalLh > 0.5 ? volumenL / (caudalLh / 3600) : Infinity);

  /**
   * Presiones de los dos lados de la regeneración (bar). El lado pasteurizado debe quedar por encima del crudo (diferencial mínimo 0,07 bar).
   * Una fuga en una placa (fuga01: 0..1) reduce ese diferencial hasta invertirlo (producto crudo pasaría al pasteurizado).
   */
  function presiones({ caudalLh, hayAvance, fuga01 = 0, obstruccion01 = 0 }) {
    const P = C.presiones;
    if (caudalLh < 1) return { crudoBar: 0.3, pasteurizadoBar: 0.3 };
    const q = caudalLh / 2000;
    const crudo = (P.crudoBaseBar + P.crudoPorCaudalBar * q * q) * (1 - 0.5 * limitar(obstruccion01, 0, 1));
    const dif = (hayAvance ? P.diferencialAvanceBar : P.diferencialDesvioBar) * (1 - 1.2 * limitar(fuga01, 0, 1));
    return { crudoBar: crudo, pasteurizadoBar: crudo + dif };
  }

  /** Apertura (0 = desvío, 1 = avance) de la FDV: se mueve a velocidad constante. Con el vástago atascado en avance no sale de 1. */
  function pasoFDV(apertura01, { objetivo01, dt, aireOK, atascadaEnAvance = false }) {
    if (atascadaEnAvance) return 1;
    const t = C.fdv.tiempoMovimientoS * (aireOK ? 1 : C.fdv.factorLentaConAireBajo);
    const paso = dt / t;
    if (apertura01 < objetivo01) return Math.min(objetivo01, apertura01 + paso);
    return Math.max(objetivo01, apertura01 - paso);
  }

  /** Posición lógica de la FDV a partir de su apertura. */
  const posicionFDV = apertura01 => (apertura01 >= 0.98 ? 'AVANCE' : apertura01 <= 0.02 ? 'DESVIO' : 'MOVIENDO');

  /** Volumen del tanque de balance tras un paso: entra la reposición y el retorno del desvío, sale lo que bombea P-101. */
  function pasoTanque(volumenL, { entradaLh, salidaLh, dt }) {
    return limitar(volumenL + (entradaLh - salidaLh) * dt / 3600, 0, C.tanque.capacidadL);
  }

  const api = { caudalObjetivo, tiempoResidenciaS, presiones, pasoFDV, posicionFDV, pasoTanque, limitar };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstFisicaHidraulica = api; }
})();
