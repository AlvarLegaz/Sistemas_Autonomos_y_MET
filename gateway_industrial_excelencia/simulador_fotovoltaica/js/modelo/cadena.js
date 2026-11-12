// Cadena de paneles en serie: la corriente es común y las tensiones se suman. Cada panel tiene 3 subcadenas con diodo de paso;
// la sombra de un panel (0–1) cubre sus subcadenas de abajo arriba (a 1/3 cubre una entera) y a las células sombreadas solo les llega
// la luz difusa. Mismatch (desajuste de corriente) por panel, temperatura de célula con retardo térmico, cables con resistencia
// (y una resistencia extra si hay un conector MC4 malo). La cadena se describe por su V(I) (monótona), de donde salen I(V), el MPP y la curva.
(function () {
  const { CONSTANTES: C } = typeof require !== 'undefined' ? require('../configuracion/constantes.js') : window.PCT.fv.constantes;
  const Panel = typeof require !== 'undefined' ? require('./panel.js') : window.PCT.fv.panel;
  const { limitar } = Panel;

  function crearCadena({ id, esp, tags, desajustes = [] }) {
    const paneles = tags.map((tag, k) => ({ tag, tc: C.T_STC, desajuste: desajustes[k] || 1, sombra01: 0, diodos: ['ok', 'ok', 'ok'], subs: [], extraTc: 0 }));
    const c = { id, esp, paneles, abierta: false, resistenciaExtraOhm: 0, iscMax: 0, iniciada: false, gPlano: 0, _voc: 0, _vIsc: 0 };
    const rSerie = () => C.CABLE_CADENA_OHM + c.resistenciaExtraOhm;

    /** Actualiza las condiciones: g (W/m² en el plano), gDif (difusa + reflejada), ambiente, suciedad, sombras por tag, diodos por tag y avería de conector. */
    c.actualizar = function ({ g = 0, gDif = 0, tAmbC = 25, suciedad = 0, sombras = {}, diodos = {}, abierta = false, resistenciaExtraOhm = 0, dt = 0 } = {}) {
      c.abierta = !!abierta; c.resistenciaExtraOhm = resistenciaExtraOhm; c.gPlano = g;
      const gEf = g * (1 - suciedad), gDifEf = gDif * (1 - suciedad);
      const a = c.iniciada ? 1 - Math.exp(-dt / C.TAU_TERMICA_PANEL_S) : 1;
      c.iscMax = 0;
      for (const p of paneles) {
        p.sombra01 = limitar(sombras[p.tag] || 0, 0, 1);
        p.diodos = diodos[p.tag] || ['ok', 'ok', 'ok'];
        const hayInversa = p.diodos.includes('abierto') && p.sombra01 > 0.02;                 // célula en inversa: punto caliente
        const objetivo = Panel.temperaturaCelulaObjetivo(esp, gEf, tAmbC) + (hayInversa ? 18 : 0);
        p.tc += (objetivo - p.tc) * a;
        p.subs = [0, 1, 2].map(k => {
          const sk = limitar(p.sombra01 * 3 - k, 0, 1);
          const gk = gEf * (1 - sk) + Math.min(gDifEf, gEf) * sk;
          return Panel.puntoOperacion(esp, gk, p.tc, p.desajuste);
        });
        for (let k = 0; k < 3; k++) if (p.diodos[k] !== 'corto') c.iscMax = Math.max(c.iscMax, p.subs[k].isc);
      }
      c._voc = Math.max(0, c.vDeI(0)); c._vIsc = c.vDeI(c.iscMax);
      c.iniciada = true;
    };

    /** Tensión de la cadena (V) con corriente i (A). Incluye la caída en cables y conectores. */
    c.vDeI = function (i) {
      let v = 0;
      for (const p of paneles) for (let k = 0; k < 3; k++) v += Panel.vSubcadena(p.subs[k], i, p.diodos[k]);
      return v - i * rSerie();
    };
    c.voc = () => c._voc || 0;
    c.isc = () => c.iscMax;

    /** Corriente (A) a la tensión v. Una cadena abierta (cable, MC4 o fusible) no da corriente. */
    c.iDeV = function (v) {
      if (c.abierta || c.iscMax <= 0) return 0;
      if (v >= c.voc()) return 0;
      if (v <= c._vIsc) return c.iscMax;
      let lo = 0, hi = c.iscMax;
      for (let it = 0; it < 28; it++) { const m = (lo + hi) / 2; if (c.vDeI(m) > v) lo = m; else hi = m; }
      return (lo + hi) / 2;
    };

    /** Máximo global de potencia de la cadena aislada (no depende de que esté abierta: es lo que daría conectada). */
    c.mpp = function () {
      if (c.iscMax <= 0) return { v: 0, i: 0, p: 0 };
      const N = 120;
      let mejor = { v: 0, i: 0, p: 0 }, kMejor = 0;
      const punto = i => { const v = c.vDeI(i); return { v, i, p: v > 0 ? v * i : 0 }; };
      for (let k = 1; k < N; k++) { const q = punto(c.iscMax * k / N); if (q.p > mejor.p) { mejor = q; kMejor = k; } }
      let a = c.iscMax * Math.max(0, kMejor - 1) / N, b = c.iscMax * Math.min(N, kMejor + 1) / N;       // refinado por sección áurea
      const r = 0.6180339887;
      for (let it = 0; it < 16 && kMejor > 0; it++) {
        const x1 = b - r * (b - a), x2 = a + r * (b - a), q1 = punto(x1), q2 = punto(x2);
        if (q1.p > q2.p) { b = x2; if (q1.p > mejor.p) mejor = q1; } else { a = x1; if (q2.p > mejor.p) mejor = q2; }
      }
      return mejor;
    };

    /** Detalle por panel a la corriente i: tensión (suma de subcadenas), potencia (≥ 0), temperatura y diodos de paso conduciendo. */
    c.detalle = function (i) {
      return paneles.map(p => {
        let v = 0; const bypass = [false, false, false];
        for (let k = 0; k < 3; k++) {
          v += Panel.vSubcadena(p.subs[k], i, p.diodos[k]);
          bypass[k] = p.diodos[k] === 'corto' || (p.diodos[k] === 'ok' && (p.subs[k].isc <= 0 || i >= p.subs[k].isc));
        }
        return { tag: p.tag, v, p: Math.max(0, v * i), tempCelulaC: p.tc, sombra01: p.sombra01, bypass };
      });
    };

    /** Curva I-V y P-V (puntos ordenados por tensión creciente, de 0 a Voc). Espaciado denso en los extremos. */
    c.curva = function (n = 60) {
      const voc = c.voc(), pts = [];
      if (c.abierta || c.iscMax <= 0) {
        for (let k = 0; k < n; k++) pts.push({ v: voc * k / (n - 1), i: 0, p: 0 });
        return pts;
      }
      for (let k = 0; k < n; k++) {
        const i = c.iscMax * (0.5 - 0.5 * Math.cos(Math.PI * k / (n - 1)));
        let v = c.vDeI(i), ii = i;
        if (v < 0) { v = 0; ii = c.iDeV(0); }
        pts.push({ v, i: ii, p: v * ii });
      }
      pts.sort((x, y) => x.v - y.v || x.i - y.i);
      return pts;
    };
    return c;
  }

  /** Grupo de cadenas en paralelo sobre una misma entrada de MPPT: tensión común, corrientes que se suman. */
  function crearGrupo(cadenas) {
    return {
      cadenas,
      voc: () => cadenas.reduce((m, c) => (c.abierta ? m : Math.max(m, c.voc())), 0),
      iDeV: v => cadenas.reduce((s, c) => s + c.iDeV(v), 0),
    };
  }

  const api = { crearCadena, crearGrupo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { const P = (window.PCT = window.PCT || {}); (P.fv = P.fv || {}).cadena = api; }
})();
