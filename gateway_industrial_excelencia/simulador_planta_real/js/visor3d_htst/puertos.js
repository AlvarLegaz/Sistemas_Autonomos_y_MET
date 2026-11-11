// Puertos de tubería de los equipos de la planta (DISEÑADOR): puntos (x, y, z en cm, coordenadas del patín) donde empalma cada tubo.
// Es la única fuente de estas coordenadas: la usan los equipos (para que su geometría encaje) y las tuberías (para que lleguen a ellos).
// Eje de las tuberías ≈ ALTURA_TUBO_CM del layout en el tramo general; los equipos tienen sus bocas a la altura que les corresponde.
(function () {
  const PUERTOS = {
    'TK-101': { sal: [-102, 28, -35], ret: [-121, 86, -35] },
    'FLT-101': { ent: [-105, 12, -11], sal: [-105, 12, 1] },
    'P-101': { ent: [-110, 13, 23], sal: [-110, 26, 35] },
    'FT-101': { ent: [-77, 25, 35], sal: [-59, 25, 35] },
    'P-103': { ent: [-55, 13, 23], sal: [-55, 26, 35] },
    'HX-101': {
      raw_in: [-40, 80, -18], past_in: [-24, 80, -52], cal_out: [8, 80, -52], fin_out: [40, 80, -52],
      hot_in: [6, 80, -18], hot_out: [-6, 80, -18], cold_in: [36, 80, -18], cold_out: [26, 80, -18],
    },
    'HT-101': { ent: [24, 20, -40], sal: [120, 48, -40] },
    'FDV-101': { com: [118, 14, -15], avance: [128, 14, -5], desvio: [108, 14, -5], aire: [123, 36, -5] },
    'SV-101': { ent: [122, 8, 12], sal: [122, 14, 12] },
    'FRL-101': { sal: [131, 12, 25] },
    'HW-101': { sal: [1, 20, 45], ent: [1, 62, 45] },
    'P-102': { ent: [-15, 13, 43], sal: [-15, 26, 55] },
    'XV-301': { ent: [75, 10, 48], sal: [75, 10, 32] },
    'XV-401': { ent: [100, 10, 48], sal: [100, 10, 32] },
    SALIDA_PRODUCTO: { ent: [160, 40, 30] },
    SUMINISTRO_FRIO: { sal: [75, 10, 75] },
    DESAGUE: { ent: [26, 2, -75] },
  };
  const puerto = (tag, nombre) => { const p = PUERTOS[tag] && PUERTOS[tag][nombre]; if (!p) throw new Error(`Puerto desconocido: ${tag}.${nombre}`); return p.slice(); };

  const api = { PUERTOS, puerto };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstPuertos = api; }
})();
