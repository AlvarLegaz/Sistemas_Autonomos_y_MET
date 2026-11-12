// Panel fotovoltaico: modelo explícito de la curva I-V de un panel y de cada una de sus 3 subcadenas con diodo de paso.
//
// Forma elegida (explícita y estable, sin iterar): I(V) = Isc·[1 − C1·(exp(V/(C2·Voc)) − 1)], con
//   C2 = (Vmp/Voc − 1)/ln(1 − Imp/Isc)   y   C1 = (1 − Imp/Isc)·exp(−Vmp/(C2·Voc)),
// que pasa exactamente por (0, Isc), (Vmp, Imp) y (Voc, ≈0). Se usa su inversa V(I) = C2·Voc·ln((1 − I/Isc)/C1 + 1),
// que además es monótona y permite SUMAR tensiones de elementos en serie para una corriente dada (así se construye la cadena).
//
// Dependencia con las condiciones (ver CONSTANTES): Isc ∝ G con coeficiente de temperatura pequeño; Voc baja con la temperatura (coefVoc)
// y con el logaritmo de la irradiancia; Vmp baja con la temperatura de modo que la potencia lo haga con coefPotencia.
// Subcadena (1/3 de las células): misma curva con Voc/3 y Vmp/3. Su diodo de paso conduce cuando la corriente de la cadena supera su Isc
// (sombra o célula débil): entonces aporta −0,6 V en lugar de tensión positiva, y la subcadena «se salta».
// Estados del diodo de paso: 'ok', 'corto' (la subcadena está siempre puenteada, pierde 1/3 de la tensión) y 'abierto' (no puentea:
// con sombra, la corriente de la cadena se ve forzada por el panel sombreado y la tensión inversa de ese panel se hunde).
(function () {
  const { CONSTANTES: C } = typeof require !== 'undefined' ? require('../configuracion/constantes.js') : window.PCT.fv.constantes;
  const limitar = (v, a, b) => Math.max(a, Math.min(b, v));

  /** Temperatura de célula por NOCT (800 W/m², 20 °C ambiente, sin viento). */
  const temperaturaCelulaObjetivo = (esp, g, tAmbC) => tAmbC + (esp.noctC - 20) / 800 * Math.max(0, g);

  /** Parámetros eléctricos de un panel completo para una irradiancia (W/m²), temperatura de célula (°C) y un factor de desajuste de corriente. */
  function puntoOperacion(esp, g, tc, desajuste = 1) {
    if (!(g >= 0.5)) return { isc: 0, voc: 0, imp: 0, vmp: 0, c1: 1, c2: 0.07, g: 0, tc };
    const dT = tc - C.T_STC, serie = esp.voc / C.VOLTAJE_CELULA_V;
    const vt = 0.02569 * (tc + 273.15) / 298.15;
    const logV = serie * C.FACTOR_IDEALIDAD * vt * Math.log(g / C.G_STC);
    const kVmp = esp.coefPotencia - C.CORRIENTE_ISC_COEF;
    const isc = esp.isc * (g / C.G_STC) * (1 + C.CORRIENTE_ISC_COEF * dT) * desajuste;
    const voc = Math.max(0.35 * esp.voc, esp.voc * (1 + esp.coefVoc * dT) + logV);
    const imp = esp.imp * isc / esp.isc;
    const vmp = limitar(esp.vmp * (1 + kVmp * dT) + logV, 0.2 * voc, 0.93 * voc);
    const c2 = (vmp / voc - 1) / Math.log(1 - imp / isc);
    const c1 = (1 - imp / isc) * Math.exp(-vmp / (c2 * voc));
    return { isc, voc, imp, vmp, c1, c2, g, tc };
  }

  /** Tensión de UNA subcadena (1/3 del panel) cuando circula la corriente i. `diodo`: 'ok' | 'corto' | 'abierto'. */
  function vSubcadena(pt, i, diodo = 'ok') {
    if (diodo === 'corto') return -0.02;
    if (pt.isc <= 0 && i <= 1e-9) return 0;
    if (pt.isc > 0 && i < pt.isc) return pt.c2 * pt.voc * Math.log((1 - i / pt.isc) / pt.c1 + 1) / 3;
    if (diodo === 'abierto') return -(C.DIODO_PASO_V + 10 * (i - pt.isc));          // célula en inversa: cae en picado
    return -C.DIODO_PASO_V;                                                          // diodo de paso conduciendo
  }

  /** Curva de un panel entero sano y uniforme (tres subcadenas iguales): V(I), usada para comprobar datasheet. */
  function vPanel(pt, i) { return 3 * vSubcadena(pt, i); }

  /** Punto de máxima potencia de un panel uniforme (muestreo fino + refinado). */
  function mppPanel(esp, g, tc) {
    const pt = puntoOperacion(esp, g, tc);
    if (pt.isc <= 0) return { v: 0, i: 0, p: 0, voc: 0, isc: 0 };
    let mejor = { v: 0, i: 0, p: 0 };
    for (let k = 1; k < 400; k++) {
      const i = pt.isc * k / 400, v = vPanel(pt, i), p = v * i;
      if (p > mejor.p) mejor = { v, i, p };
    }
    return { ...mejor, voc: vPanel(pt, 0), isc: pt.isc };
  }

  const api = { temperaturaCelulaObjetivo, puntoOperacion, vSubcadena, vPanel, mppPanel, limitar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { const P = (window.PCT = window.PCT || {}); (P.fv = P.fv || {}).panel = api; }
})();
