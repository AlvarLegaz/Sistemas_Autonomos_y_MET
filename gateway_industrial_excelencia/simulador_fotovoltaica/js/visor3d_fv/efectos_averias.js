// Efectos visuales de las averías en el 3D (DISEÑADOR). Función pura: de `estado.averiasActivas` (lista de ids, o de objetos { id, ... }) a lo que se ve.
// El catálogo de averías es el de layout.js (AVERIAS); aquí cada id se traduce a efectos por tag: resaltar_rojo / resaltar_ambar (halo), cable_cortado,
// conector_suelto, led_apagado, ventilacion_tapada, testigo_rojo, panel_aviso.
(function () {
  const EFECTO_POR_ID = {
    CADENA_ABIERTA_A1: { 'STR-101': ['conector_suelto', 'resaltar_rojo'], 'PV-101': ['panel_aviso'], 'PV-102': ['panel_aviso'], 'PV-103': ['panel_aviso'] },
    CADENA_ABIERTA_B1: { 'STR-201': ['cable_cortado', 'resaltar_rojo'], 'PV-201': ['panel_aviso'], 'PV-202': ['panel_aviso'], 'PV-203': ['panel_aviso'], 'PV-204': ['panel_aviso'] },
    FUSIBLE_F101: { 'F-101': ['resaltar_rojo'] },
    DIODO_BYPASS_PV104: { 'PV-104': ['resaltar_ambar', 'panel_aviso'] },
    DIODO_BYPASS_ABIERTO_PV203: { 'PV-203': ['resaltar_ambar'] },
    CONECTOR_RESISTIVO_B2: { 'STR-202': ['resaltar_ambar'] },
    FALLO_AISLAMIENTO_B: { 'STR-201': ['resaltar_ambar'] },
    SPD_DISPARADO_A: { 'SPD-101': ['testigo_rojo', 'resaltar_rojo'] },
    QB_DISPARADO: { 'QB-101': ['resaltar_rojo'] },
    BMS_CORTE_BATERIA: { 'BAT-101': ['resaltar_rojo'] },
    CELDA_DESEQUILIBRADA: { 'BAT-101': ['resaltar_ambar'] },
    VENTILACION_TAPADA: { 'CAS-001': ['ventilacion_tapada', 'resaltar_ambar'] },
    DIFERENCIAL_DISPARADO: { 'ID-301': ['resaltar_rojo'] },
    RED_CAIDA: { 'RED-301': ['resaltar_rojo'] },
    SOBRETENSION_RED: { 'RED-301': ['resaltar_ambar'] },
    COMUNICACION_PERDIDA_EASUN: { 'COM-101': ['led_apagado', 'resaltar_ambar'] },
    SUCIEDAD_ALTA_A: {},
    SOMBRA_PARAPETO: { 'PV-205': ['resaltar_ambar'] },
  };
  const EFECTOS_CONOCIDOS = new Set(['resaltar_rojo', 'resaltar_ambar', 'cable_cortado', 'conector_suelto', 'led_apagado', 'ventilacion_tapada', 'testigo_rojo', 'panel_aviso']);
  const idDe = a => (typeof a === 'string' ? a : a && a.id);
  /** Mapa tag → Set de efectos para todas las averías activas. */
  function efectosPorTag(averiasActivas) {
    const mapa = new Map();
    for (const a of (averiasActivas || [])) {
      const tabla = EFECTO_POR_ID[idDe(a)] || {};
      for (const [tag, lista] of Object.entries(tabla)) { if (!mapa.has(tag)) mapa.set(tag, new Set()); for (const e of lista) mapa.get(tag).add(e); }
    }
    return mapa;
  }
  /** Clave barata para saber si las averías cambiaron entre dos fotogramas. */
  const firmaAverias = averiasActivas => (averiasActivas || []).map(a => `${(a && a.instancia) || ''}:${idDe(a)}`).join('|');

  const api = { EFECTO_POR_ID, EFECTOS_CONOCIDOS, efectosPorTag, firmaAverias };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else { window.PCT = window.PCT || {}; PCT.fvEfectosAverias = api; }
})();
