// Puertos de tubería de los equipos de la planta (DISEÑADOR): puntos (x, y, z en cm, coordenadas del patín) donde empalma cada tubo.
// Es la única fuente de estas coordenadas: la usan los equipos (para que su geometría encaje) y las tuberías (para que lleguen a ellos).
// Eje de las tuberías ≈ ALTURA_TUBO_CM del layout en el tramo general; los equipos tienen sus bocas a la altura que les corresponde.
(function () {
  const PUERTOS = {
    // El tanque se desplaza 8 cm a la derecha de su sitio del layout (centro en x = -127): con R = 33 sus patas y su virola se salían de la bancada por la izquierda.
    // TK-101.sal sale 6 cm de la pared: el montante del tubo no puede rozar la virola ni la boca; FLT-101 se alinea con él en x.
    // TK-101.vac sigue en x = -140: la boca queda 1,7 cm delante de la pared (z = -4,7 en ese x) y el equipo la alarga con un tramo corto.
    'TK-101': { sal: [-89, 28, -35], ret: [-113, 86, -35], llen: [-97.5, 62, -49], vac: [-140, 26, -3] },
    // Las bocas del filtro están en los extremos de su tubo pasante (z = -17 y z = 7), a 7 cm de la carcasa de la cesta, para que los montantes no la rocen
    'FLT-101': { ent: [-89, 12, -17], sal: [-89, 12, 7] },
    'P-101': { ent: [-110, 13, 23], sal: [-110, 26, 35] },
    'FT-101': { ent: [-77, 25, 35], sal: [-59, 25, 35] },
    'HX-101': {
      raw_in: [-40, 80, -18], past_in: [-24, 80, -52], cal_out: [8, 80, -52], fin_out: [40, 80, -52],
      hot_in: [6, 80, -18], hot_out: [-6, 80, -18], cold_in: [36, 80, -18], cold_out: [26, 80, -18],
      // bocas de las placas intermedias: la leche pasteurizada sale de la regeneración y pasa al enfriamiento por un puente exterior (con TT-106)
      reg_out: [-10.7, 80, -35], enf_in: [16.3, 80, -35],
    },
    // El tubo de residencia empieza a la derecha del bastidor de HX-101 (que llega a x ≈ 45): bocas a x = 49 y x = 125 (el equipo se desplaza 18 cm en x del layout)
    'HT-101': { ent: [49, 20, -40], sal: [125, 48, -40] },
    'FDV-101': { com: [118, 14, -15], avance: [128, 14, -5], desvio: [108, 14, -5], aire: [123, 42, 2.3] },
    // Los dos racores de aire de SV-101 son verticales y están en lados opuestos de la bobina (x = ±4): entrada a la derecha, salida a la izquierda
    'SV-101': { ent: [122, 15, 12], sal: [114, 15, 12] },
    'FRL-501': { sal: [130.5, 19, 25] },                     // sobre el racor del filtro (el tubo de aire sube desde aquí sin atravesar la tapa)
    'HW-201': { sal: [1, 20, 45], ent: [1, 62, 45], llen: [37, 30, 45], vac: [14, 14, 60.9] },
    'P-201': { ent: [-15, 13, 43], sal: [-15, 26, 55] },
    'XV-301': { ent: [75, 10, 48], sal: [75, 10, 32] },
    'XV-401': { ent: [100, 10, 48], sal: [100, 10, 32] },
    // Válvulas de llenado y vaciado (todo/nada). XV-101 y XV-201 se acercan al depósito; XV-102 y XV-202 salen de él hacia el desagüe.
    // XV-202 va girada 90° (cuerpo a lo largo de x) para no sobresalir del borde del patín (z = 72 ± 8 pasaría de 75).
    'XV-101': { ent: [-90, 10, -70], sal: [-90, 10, -54] },
    'XV-102': { ent: [-140, 10, 4], sal: [-140, 10, 20] },
    'XV-201': { ent: [52, 10, 70], sal: [52, 10, 54] },
    'XV-202': { ent: [12, 10, 72], sal: [28, 10, 72] },
    SALIDA_PRODUCTO: { ent: [160, 40, 30] },
    SUMINISTRO_FRIO: { sal: [75, 10, 75] },
    DESAGUE: { ent: [26, 2, -75] },
    SUMINISTRO_LECHE: { sal: [-90, 10, -75] },          // entrada de producto a la planta (recepción), hacia XV-101
    DESAGUE_LECHE: { ent: [-140, 4, 40] },              // bandeja de vaciado del tanque de balance
    DESAGUE_AGUA: { ent: [40, 4, 72] },                 // bandeja de vaciado del depósito de agua caliente
  };
  const puerto = (tag, nombre) => { const p = PUERTOS[tag] && PUERTOS[tag][nombre]; if (!p) throw new Error(`Puerto desconocido: ${tag}.${nombre}`); return p.slice(); };

  const api = { PUERTOS, puerto };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstPuertos = api; }
})();
