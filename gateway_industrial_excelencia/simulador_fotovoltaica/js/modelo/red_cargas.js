// Red de 230 V / 50 Hz y cargas con perfil diario automático (aula de mañana y tarde, noche baja) o valor manual.
(function () {
  const { CONSTANTES: C, layout } = typeof require !== 'undefined' ? require('../configuracion/constantes.js') : window.PCT.fv.constantes;
  const suave = x => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
  /** Escalón suave entre a y b horas (sube en a, baja en b), con flancos de 45 min. */
  const tramo = (h, a, b) => suave((h - a) / 0.75 + 0.5) * (1 - suave((h - b) / 0.75 + 0.5));
  const base = h => ((h % 24) + 24) % 24;

  /** Perfil por defecto (W) de cada carga según la hora solar. */
  function perfilW(tag, hora) {
    const h = base(hora);
    if (tag === 'LOAD-301') return 350 + 1450 * tramo(h, 7.75, 15) + 420 * tramo(h, 15, 21.5);       // el centro: talleres y aulas
    if (tag === 'LOAD-302') return 120 + 480 * tramo(h, 8, 14.5) + 220 * tramo(h, 14.5, 21);         // cargas protegidas de la caseta
    return 0;
  }

  function crearCargas(rng) {
    const manual = { 'LOAD-301': null, 'LOAD-302': null };
    let ruido = 0, ruidoObjetivo = 0, tRuido = 0;
    const c = { manual };
    c.poner = (tag, watios) => { if (tag in manual) manual[tag] = watios == null ? null : Math.max(0, Number(watios) || 0); };
    c.esManual = tag => manual[tag] != null;
    /** Demanda (W) de la carga en este instante. */
    c.demanda = function (tag, hora) { return manual[tag] != null ? manual[tag] : perfilW(tag, hora) * (1 + 0.05 * ruido); };
    c.paso = function (dt) {
      tRuido -= dt;
      if (tRuido <= 0) { ruidoObjetivo = rng.normal() * 0.7; tRuido = 120; }
      ruido += (Math.max(-1.5, Math.min(1.5, ruidoObjetivo)) - ruido) * Math.min(1, dt / 90);
    };
    c.reiniciar = () => { manual['LOAD-301'] = null; manual['LOAD-302'] = null; ruido = 0; ruidoObjetivo = 0; tRuido = 0; };
    return c;
  }

  function crearRed() {
    const r = { disponible: true, tensionV: layout.RED.tensionV, frecuenciaHz: layout.RED.frecuenciaHz, energiaImportadaWh: 0, energiaExportadaWh: 0 };
    r.reiniciar = () => { r.disponible = true; r.tensionV = layout.RED.tensionV; r.energiaImportadaWh = 0; r.energiaExportadaWh = 0; };
    return r;
  }

  const api = { perfilW, crearCargas, crearRed };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { const P = (window.PCT = window.PCT || {}); (P.fv = P.fv || {}).redCargas = api; }
})();
