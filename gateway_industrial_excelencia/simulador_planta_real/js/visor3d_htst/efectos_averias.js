// Efectos visuales de las averías en el 3D (DISEÑADOR). Función pura: de `estado.averiasActivas` [{ instancia, id, tags }] a un mapa tag → lista de efectos.
// Los efectos son los de `sintomas3d` del catálogo (ARQUITECTURA.md §6.1): resaltar_rojo, cable_cortado, goteo, led_apagado, contactos_cerrados.
// Aquí hay una tabla por id de avería porque el catálogo del PROGRAMADOR-MODELO puede no estar cargado en el visor; si una avería trae `sintomas3d`, manda esa.
(function () {
  const EFECTO_POR_ID = {
    'AV-LAZO-ABIERTO': ['cable_cortado', 'resaltar_rojo'],
    'AV-PT100-ABIERTA': ['resaltar_rojo'],
    'AV-PT100-CORTO': ['resaltar_rojo'],
    'AV-DERIVA-TT103': [],                                   // sin cambio visible: es lo que lo hace difícil
    'AV-RUIDO-4-20': ['resaltar_ambar'],
    'AV-FUSIBLE-F201': ['led_apagado', 'resaltar_rojo'],
    'AV-FUENTE-24V': ['led_apagado', 'resaltar_rojo'],
    'AV-KM-PEGADO': ['contactos_cerrados', 'resaltar_rojo'],
    'AV-KM-NO-CIERRA': ['contactos_abiertos', 'resaltar_rojo'],
    'AV-BOBINA-ABIERTA': ['led_apagado', 'resaltar_rojo'],
    'AV-FDV-ATASCADA': ['resaltar_rojo'],
    'AV-AIRE-BAJO': ['manometro_rojo', 'resaltar_rojo'],
    'AV-VFD-SOBRETEMP': ['resaltar_rojo'],
    'AV-PLACA-FUGA': ['goteo', 'resaltar_rojo'],
    'AV-FILTRO-OBSTRUIDO': ['colador_oscuro', 'resaltar_ambar'],
    'AV-TSH-DISPARADO': ['resaltar_rojo'],
  };
  const EFECTOS_CONOCIDOS = new Set(['resaltar_rojo', 'resaltar_ambar', 'cable_cortado', 'goteo', 'led_apagado', 'contactos_cerrados', 'contactos_abiertos',
    'manometro_rojo', 'colador_oscuro']);

  /** Efectos de una avería: su `sintomas3d` si lo trae (cada uno con tag) y, si no, la tabla por id aplicada a todos sus tags. */
  function efectosDeAveria(averia) {
    const salida = [];
    if (!averia) return salida;
    if (Array.isArray(averia.sintomas3d) && averia.sintomas3d.length) {
      for (const s of averia.sintomas3d) if (s && s.tag && EFECTOS_CONOCIDOS.has(s.efecto)) salida.push({ tag: s.tag, efecto: s.efecto });
      return salida;
    }
    const lista = EFECTO_POR_ID[averia.id] || [];
    for (const tag of (averia.tags || [])) for (const efecto of lista) salida.push({ tag, efecto });
    return salida;
  }

  /** Mapa tag → Set de efectos para todas las averías activas. Se llama solo cuando cambian las averías, no en cada fotograma. */
  function efectosPorTag(averiasActivas) {
    const mapa = new Map();
    for (const a of (averiasActivas || [])) {
      for (const { tag, efecto } of efectosDeAveria(a)) {
        if (!mapa.has(tag)) mapa.set(tag, new Set());
        mapa.get(tag).add(efecto);
      }
    }
    return mapa;
  }

  /** Clave barata para saber si las averías cambiaron entre dos fotogramas (ids de instancia ordenados). */
  const firmaAverias = averiasActivas => (averiasActivas || []).map(a => `${a.instancia || ''}:${a.id}`).join('|');

  const api = { EFECTO_POR_ID, EFECTOS_CONOCIDOS, efectosDeAveria, efectosPorTag, firmaAverias };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstEfectosAverias = api; }
})();
