// Batería LiFePO4 24 V (8 celdas) con BMS: SoC por integración de corriente (con rendimiento de carga), tensión por curva de celda
// (plana en el centro, con rodillas en los extremos) más caída por resistencia interna, límites y cortes del BMS, temperatura.
// Convenio: corriente y potencia POSITIVAS al cargar.
//
// TENSIÓN: la de reposo de una celda sigue la curva REPOSO (3,40 V al 100 %, 3,30 V hacia el 50 %, 3,20 V al 10 %, 2,50 V al 0 %); en carga cerca
//   del 100 % la celda «sube» sobre la de reposo (sobretensión de carga, hasta +0,15 V a 3,55 V = tensión de absorción 28,4 V del pack) y vuelve
//   a la de reposo en unos 15 minutos sin carga. Por eso la tensión de reposo a plena carga es 27,2 V y la de absorción llega a 28,4 V.
//   A esa tensión de carga se le suma la caída I·R de la resistencia del pack (15 mΩ, más en frío).
// POLÍTICA DE CORTES (de dentro a fuera):
//   1) BMS, por tensión de celda (la protección de verdad): la celda más baja bajo 2,50 V (layout BATERIA.vCeldaMin) → CORTE_BAJA (no descarga; sí
//      admite carga; HISTÉRESIS: se rearma al subir esa celda sobre 2,90 V); la celda más alta sobre 3,65 V → CORTE_ALTA (no carga; se rearma
//      bajo 3,50 V); corriente por encima de 1,15 × el máximo → CORTE_CORRIENTE 10 s y reintenta.
//      Con el pack sano el corte por celda baja solo llega a ~0 % de SoC: es «casi vacío», no se debe llegar nunca.
//   2) SoC mínimo útil (layout BATERIA.socMinUtilPct = 10 %): el inversor (EASun) deja de descargar al llegar a él, mucho antes que el BMS, y no
//      vuelve a descargar hasta el 25 % (ver inversor_easun.js). Entre 0 y 10 % queda la reserva que protege la vida de la batería.
//   3) TEMPERATURA: no se carga por debajo de 0 °C; entre 5 y 20 °C el BMS limita la corriente de carga (limiteCargaA). No hay estado BMS nuevo:
//      el inversor respeta el límite como haría con un BMS por comunicación.
// RENDIMIENTO: carga con rendimiento culómbico del 98,5 % y pérdidas I²R en carga y descarga: ida y vuelta ≈ 94-96 % entre 20 y 90 % de SoC a ±25 A.
//   BMS: 'OK' | 'CORTE_BAJA' | 'CORTE_ALTA' | 'CORTE_CORRIENTE'.
(function () {
  const { CONSTANTES: C, layout } = typeof require !== 'undefined' ? require('../configuracion/constantes.js') : window.PCT.fv.constantes;
  const SPEC = layout.BATERIA;
  const limitar = (v, a, b) => Math.max(a, Math.min(b, v));

  // [SoC %, tensión de reposo por celda]
  const CURVA = [[0, 2.50], [1, 2.80], [2, 2.95], [5, 3.10], [10, 3.20], [20, 3.25], [30, 3.27], [40, 3.285], [50, 3.295], [60, 3.305], [70, 3.315],
    [80, 3.325], [90, 3.335], [95, 3.35], [98, 3.38], [100, 3.40]];
  // [SoC %, sobretensión de carga por celda] (sobre la de reposo, con la polarización completa)
  const SOBRETENSION = [[0, 0], [88, 0], [90, 0.01], [95, 0.07], [98, 0.12], [100, 0.15]];

  const interp = (tabla, x) => {
    if (x <= tabla[0][0]) return tabla[0][1];
    for (let k = 1; k < tabla.length; k++) {
      if (x <= tabla[k][0]) { const [x0, y0] = tabla[k - 1], [x1, y1] = tabla[k]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
    }
    return tabla[tabla.length - 1][1];
  };

  /** Tensión de reposo de una celda (V) con el SoC en % (se extrapola por debajo de 0 y por encima de 100 con pendiente fuerte). */
  function ocvCelda(socPct) {
    if (socPct <= 0) return CURVA[0][1] + socPct * 0.1;
    if (socPct >= 100) return CURVA[CURVA.length - 1][1] + (socPct - 100) * 0.1;
    return interp(CURVA, socPct);
  }
  /** Sobretensión de carga de una celda (V) con la polarización completa; crece pasando del 90 %. */
  const sobretensionCelda = socPct => (socPct >= 100 ? SOBRETENSION[SOBRETENSION.length - 1][1] + (socPct - 100) * 0.1 : interp(SOBRETENSION, socPct));
  /** Corriente máxima de carga (A) que admite el BMS según la temperatura de la batería: 0 bajo 0 °C, 10 A hasta 5 °C, sube hasta el máximo a 20 °C. */
  function limiteCargaA(tC) {
    const max = SPEC.corrienteMaxCargaA;
    if (tC <= 0) return 0;
    if (tC < 5) return 10;
    if (tC < 20) return 10 + (max - 10) * (tC - 5) / 15;
    return max;
  }

  function crearBateria({ socInicial01 = 0.5 } = {}) {
    const b = { soc01: limitar(socInicial01, 0, 1), tC: 25, bms: 'OK', tCorteS: 0, i: 0, v: 0, vCeldaMin: 0, vCeldaMax: 0, desequilibrada: false, bmsForzado: false, pol: 0 };

    b.ocvReposo = () => SPEC.celdas * ocvCelda(b.soc01 * 100);
    /** Tensión «sin corriente» que ve el cargador: la de reposo más la sobretensión de carga que quede (polarización b.pol de 0 a 1). */
    b.ocv = () => SPEC.celdas * (ocvCelda(b.soc01 * 100) + b.pol * sobretensionCelda(b.soc01 * 100));
    b.r = () => C.BATERIA.rPackOhm * (1 + 0.02 * Math.max(0, 25 - b.tC));                // más resistencia en frío
    b.vTerm = i => b.ocv() + i * b.r();
    /** Corriente (A) para una potencia en terminales p (W, + carga): resuelve R·I² + OCV·I − P = 0. */
    b.iDePotencia = function (p) {
      const o = b.ocv(), r = b.r(), disc = o * o + 4 * r * p;
      if (disc < 0) return -o / (2 * r);
      return (-o + Math.sqrt(disc)) / (2 * r);
    };
    b.permiteCarga = () => b.bms !== 'CORTE_ALTA' && b.bms !== 'CORTE_CORRIENTE' && b.limiteCargaA() > 0;
    b.permiteDescarga = () => b.bms !== 'CORTE_BAJA' && b.bms !== 'CORTE_CORRIENTE';
    b.limiteCargaA = () => limiteCargaA(b.tC);
    b.energiaWh = () => b.soc01 * SPEC.energiaWh;
    /** Energía por encima del SoC mínimo útil (lo que de verdad se puede sacar sin pasar a la reserva). */
    b.energiaUtilWh = () => Math.max(0, b.soc01 - SPEC.socMinUtilPct / 100) * SPEC.energiaWh;

    /**
     * Tensión de la celda más baja y de la más alta (el BMS las vigila). Un pack sano y equilibrado tiene unas décimas de punto de SoC de
     * dispersión entre celdas (unos mV en la meseta); con la avería, una celda va 14 puntos de SoC por debajo y otra 6 por encima.
     */
    b.celdas = function (i) {
      const caida = i * b.r() / SPEC.celdas, s = b.soc01 * 100;
      const dMin = b.desequilibrada ? 14 : 0.5, dMax = b.desequilibrada ? 6 : 0.3;
      return { min: ocvCelda(s - dMin) + caida, max: ocvCelda(s + dMax) + b.pol * sobretensionCelda(s + dMax) + caida };
    };

    /** Integra la corriente i (A, + carga) durante dt s, actualiza BMS y temperatura. tCasetaC: temperatura del entorno. */
    b.paso = function (dt, i, tCasetaC = 25) {
      const eta = i > 0 ? C.BATERIA.etaCarga : 1;
      b.soc01 = limitar(b.soc01 + i * eta * dt / 3600 / SPEC.capacidadAh, 0, 1);
      // polarización: sube en minutos con la carga y se relaja en un cuarto de hora sin ella
      const objetivoPol = limitar(i / 5, 0, 1);
      b.pol += (objetivoPol - b.pol) * (1 - Math.exp(-dt / (objetivoPol > b.pol ? 120 : 900)));
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

  const api = { crearBateria, ocvCelda, sobretensionCelda, limiteCargaA, CURVA, SOBRETENSION };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { const P = (window.PCT = window.PCT || {}); (P.fv = P.fv || {}).bateria = api; }
})();
