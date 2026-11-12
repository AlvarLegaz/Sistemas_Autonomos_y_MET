// Batería LiFePO4 24 V (8 celdas) con BMS: SoC por integración de corriente (con rendimiento de carga), tensión por curva de celda
// (plana en el centro, con subidas y bajadas en los extremos) más caída por resistencia interna, límites y cortes del BMS, temperatura.
// Convenio: corriente y potencia POSITIVAS al cargar.
//   BMS: 'OK' | 'CORTE_BAJA' (no descarga, sí admite carga; se rearma a 2,9 V/celda) | 'CORTE_ALTA' (no carga, sí descarga; se rearma bajo 3,5 V/celda)
//        | 'CORTE_CORRIENTE' (corta 10 s si |I| supera el límite y reintenta).
(function () {
  const { CONSTANTES: C, layout } = typeof require !== 'undefined' ? require('../configuracion/constantes.js') : window.PCT.fv.constantes;
  const SPEC = layout.BATERIA;
  const limitar = (v, a, b) => Math.max(a, Math.min(b, v));

  // [SoC %, tensión de reposo por celda]
  const CURVA = [[0, 2.60], [1, 2.78], [2, 2.90], [5, 3.08], [10, 3.20], [20, 3.25], [30, 3.28], [40, 3.30], [50, 3.31], [60, 3.32], [70, 3.33],
    [80, 3.345], [90, 3.36], [95, 3.40], [98, 3.47], [100, 3.55]];

  /** Tensión de reposo de una celda (V) con el SoC en % (se extrapola por debajo de 0 y por encima de 100 con pendiente fuerte). */
  function ocvCelda(socPct) {
    if (socPct <= 0) return CURVA[0][1] + socPct * 0.1;
    if (socPct >= 100) return CURVA[CURVA.length - 1][1] + (socPct - 100) * 0.05;
    for (let k = 1; k < CURVA.length; k++) {
      if (socPct <= CURVA[k][0]) { const [x0, y0] = CURVA[k - 1], [x1, y1] = CURVA[k]; return y0 + (y1 - y0) * (socPct - x0) / (x1 - x0); }
    }
    return CURVA[CURVA.length - 1][1];
  }

  function crearBateria({ socInicial01 = 0.5 } = {}) {
    const b = { soc01: limitar(socInicial01, 0, 1), tC: 25, bms: 'OK', tCorteS: 0, i: 0, v: 0, vCeldaMin: 0, vCeldaMax: 0, desequilibrada: false, bmsForzado: false };

    b.ocv = () => SPEC.celdas * ocvCelda(b.soc01 * 100);
    b.r = () => C.BATERIA.rPackOhm * (1 + 0.02 * Math.max(0, 25 - b.tC));                // más resistencia en frío
    b.vTerm = i => b.ocv() + i * b.r();
    /** Corriente (A) para una potencia en terminales p (W, + carga): resuelve R·I² + OCV·I − P = 0. */
    b.iDePotencia = function (p) {
      const o = b.ocv(), r = b.r(), disc = o * o + 4 * r * p;
      if (disc < 0) return -o / (2 * r);
      return (-o + Math.sqrt(disc)) / (2 * r);
    };
    b.permiteCarga = () => b.bms !== 'CORTE_ALTA' && b.bms !== 'CORTE_CORRIENTE';
    b.permiteDescarga = () => b.bms !== 'CORTE_BAJA' && b.bms !== 'CORTE_CORRIENTE';
    b.energiaWh = () => b.soc01 * SPEC.energiaWh;

    /** Tensión de la celda más baja y de la más alta (el BMS las vigila). Con la avería, una celda va 14 puntos de SoC por debajo y otra 6 por encima. */
    b.celdas = function (i) {
      const caida = i * b.r() / SPEC.celdas, s = b.soc01 * 100;
      const dMin = b.desequilibrada ? 14 : 1, dMax = b.desequilibrada ? 6 : 1;
      return { min: ocvCelda(s - dMin) + caida, max: ocvCelda(s + dMax) + caida };
    };

    /** Integra la corriente i (A, + carga) durante dt s, actualiza BMS y temperatura. tCasetaC: temperatura del entorno. */
    b.paso = function (dt, i, tCasetaC = 25) {
      const eta = i > 0 ? C.BATERIA.etaCarga : 1;
      b.soc01 = limitar(b.soc01 + i * eta * dt / 3600 / SPEC.capacidadAh, 0, 1);
      b.i = i; b.v = b.vTerm(i);
      const calor = i * i * b.r();
      b.tC += ((tCasetaC + calor / 10 - b.tC) / C.BATERIA.tauTermicaS) * Math.min(dt, C.BATERIA.tauTermicaS);
      const cel = b.celdas(i); b.vCeldaMin = cel.min; b.vCeldaMax = cel.max;
      // BMS
      if (b.bms === 'CORTE_CORRIENTE') { b.tCorteS -= dt; if (b.tCorteS <= 0) b.bms = 'OK'; }
      else if (Math.abs(i) > 1.15 * (i > 0 ? SPEC.corrienteMaxCargaA : SPEC.corrienteMaxDescargaA)) { b.bms = 'CORTE_CORRIENTE'; b.tCorteS = 10; }
      else if (b.bmsForzado || cel.min < SPEC.vCeldaMin) b.bms = 'CORTE_BAJA';
      else if (cel.max > SPEC.vCeldaMax) b.bms = 'CORTE_ALTA';
      else if (b.bms === 'CORTE_BAJA' && cel.min > C.BATERIA.bmsCeldaBajaRearmeV) b.bms = 'OK';
      else if (b.bms === 'CORTE_ALTA' && cel.max < C.BATERIA.bmsCeldaAltaRearmeV) b.bms = 'OK';
      return b;
    };
    b.paso(0, 0);
    return b;
  }

  const api = { crearBateria, ocvCelda, CURVA };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { const P = (window.PCT = window.PCT || {}); (P.fv = P.fv || {}).bateria = api; }
})();
