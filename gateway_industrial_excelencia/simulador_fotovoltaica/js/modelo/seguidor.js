// Seguidor del punto de máxima potencia (MPPT) de una entrada de inversor.
// DECISIÓN DE DISEÑO (estabilidad): perturba-y-observa (P&O) real, una perturbación por segundo simulado (hasta 6 por paso), con paso de
// 0,6 % de Voc, MÁS un barrido global periódico (cada 15 min en el EASun, cada 10 min en el ZCS; el primero al arrancar).
//  · Con sol uniforme P&O oscila alrededor del MPP (pérdida < 0,1 %) y es estable con pasos de hasta 5 s.
//  · Con sombra parcial puede quedarse en un máximo LOCAL (el pico equivocado de la curva P-V) hasta el siguiente barrido global,
//    que busca el máximo global. Es justo el comportamiento que se quiere enseñar.
// La curva de entrada es un objeto { voc, iDeV(v) } (una cadena o un grupo de cadenas en paralelo).
(function () {
  const { CONSTANTES: C } = typeof require !== 'undefined' ? require('../configuracion/constantes.js') : window.PCT.fv.constantes;

  function crearSeguidor({ vMin, vMax, iMax = Infinity, barridoS = 900 }) {
    const s = { v: 0, pPrev: 0, dir: 1, tBarrido: Infinity, acum: 0, activo: false, vMin, vMax, iMax, barridoS };
    const potencia = (curva, v) => v * Math.min(curva.iDeV(v), s.iMax);
    const techo = curva => Math.min(vMax, curva.voc());

    /** Barrido global: mejor tensión entre vMin y min(vMax, Voc). */
    s.barrido = function (curva) {
      const top = techo(curva);
      if (top <= vMin) return null;
      const N = 80;
      let kBest = 0, pBest = -1;
      for (let k = 0; k <= N; k++) { const p = potencia(curva, vMin + (top - vMin) * k / N); if (p > pBest) { pBest = p; kBest = k; } }
      let a = vMin + (top - vMin) * Math.max(0, kBest - 1) / N, b = vMin + (top - vMin) * Math.min(N, kBest + 1) / N, vBest = vMin + (top - vMin) * kBest / N;
      const r = 0.6180339887;
      for (let it = 0; it < 14; it++) {
        const x1 = b - r * (b - a), x2 = a + r * (b - a), p1 = potencia(curva, x1), p2 = potencia(curva, x2);
        if (p1 > p2) { b = x2; if (p1 > pBest) { pBest = p1; vBest = x1; } } else { a = x1; if (p2 > pBest) { pBest = p2; vBest = x2; } }
      }
      return { v: vBest, p: pBest };
    };

    s.reiniciar = function () { s.v = 0; s.pPrev = 0; s.dir = 1; s.tBarrido = Infinity; s.acum = 0; s.activo = false; };

    /** Avanza dt segundos con la curva dada. Devuelve el punto de trabajo { v, i, p, activo }. */
    s.paso = function (dt, curva) {
      const top = curva ? techo(curva) : 0;
      if (!curva || top <= s.vMin) { s.activo = false; s.tBarrido = Infinity; return { v: curva ? curva.voc() : 0, i: 0, p: 0, activo: false }; }
      s.activo = true;
      s.tBarrido += dt;
      if (s.tBarrido >= s.barridoS) {
        const b = s.barrido(curva);
        if (b) { s.v = b.v; s.pPrev = b.p; }
        s.tBarrido = 0;
      }
      s.acum += dt;
      const n = Math.min(6, Math.floor(s.acum / C.SEGUIDOR.periodoS));
      s.acum = Math.min(s.acum - n * C.SEGUIDOR.periodoS, C.SEGUIDOR.periodoS);
      const dv = Math.max(0.3, C.SEGUIDOR.pasoRel * curva.voc());
      for (let k = 0; k < n; k++) {
        const p = potencia(curva, s.v);
        if (p < s.pPrev) s.dir = -s.dir;
        s.pPrev = p;
        s.v = Math.min(top, Math.max(s.vMin, s.v + s.dir * dv));
      }
      s.v = Math.min(top, Math.max(s.vMin, s.v));
      const i = Math.min(curva.iDeV(s.v), s.iMax);
      return { v: s.v, i, p: s.v * i, activo: true };
    };

    /** Desplaza el punto de trabajo hacia tensiones mayores hasta que la potencia baje a pObjetivo (recorte por límite, batería llena o temperatura). */
    s.recortar = function (curva, pObjetivo) {
      const top = techo(curva);
      if (pObjetivo <= 0) return { v: top, i: 0, p: 0 };
      const pAct = potencia(curva, s.v);
      if (pAct <= pObjetivo) { const i = Math.min(curva.iDeV(s.v), s.iMax); return { v: s.v, i, p: s.v * i }; }
      let lo = s.v, hi = top;                                                  // a la derecha del punto de trabajo la potencia baja hasta 0 en Voc
      for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; if (potencia(curva, m) > pObjetivo) lo = m; else hi = m; }
      const v = (lo + hi) / 2, i = Math.min(curva.iDeV(v), s.iMax);
      return { v, i, p: v * i };
    };
    return s;
  }

  /**
   * Curva de eficiencia de un convertidor: pérdidas = pn·(a + b·x + c·x²) con x = Pentrada/pn (fijas + proporcionales + cuadráticas).
   * El máximo rendimiento es 1 − b − 2·√(a·c) y ocurre en x = √(a/c).
   */
  function crearEficiencia({ pn, a, b, c }) {
    const salida = pin => { const x = pin / pn; return Math.max(0, pn * (x - a - b * x - c * x * x)); };
    const entrada = pout => {
      if (!(pout > 0)) return 0;
      const y = pout / pn, d = (1 - b) * (1 - b) - 4 * c * (a + y);
      return d < 0 ? pn * (1 - b) / (2 * c) : pn * ((1 - b) - Math.sqrt(d)) / (2 * c);
    };
    const eta = pin => (pin > 0 ? salida(pin) / pin : 0);
    return { salida, entrada, eta, pn };
  }

  const api = { crearSeguidor, crearEficiencia };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { const P = (window.PCT = window.PCT || {}); (P.fv = P.fv || {}).seguidor = api; }
})();
