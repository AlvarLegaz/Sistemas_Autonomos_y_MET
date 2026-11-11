// Puntos de prueba donde el alumno puede poner las puntas del multímetro o la sonda del osciloscopio.
// Aquí solo se listan y se describen; lo que se MIDE en cada uno (y cómo lo cambian las averías) lo calcula el modelo (js/modelo/medidas.js).
(function () {
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.htstLayout;

  const MODO_POR_TIPO = { tension: 'V', lazo: 'mA', resistencia: 'ohm', temperatura: 'temperatura', presion: 'presion' };
  const CONTACTORES = ['KM-102', 'KM-103', 'KM-201', 'KM-202'];

  /** Lista de puntos de prueba derivada del contrato (layout.js). Cada punto: { id, equipo, nombre, tipo } con id «TAG:BORNA». */
  function puntosDeMedida(lay = layout) {
    const puntos = new Map();
    const poner = (equipo, borna, nombre, tipo) => { const id = `${equipo}:${borna}`; if (!puntos.has(id)) puntos.set(id, { id, equipo, borna, nombre, tipo, modo: MODO_POR_TIPO[tipo] || 'V' }); };
    for (const s of lay.SENALES) {
      if (s.tipo === 'AI') {
        poner(s.tag, '+', `${s.tag} · borna + del lazo (24 V)`, 'tension');
        poner(s.tag, '-', `${s.tag} · borna − (retorno del 4-20 mA)`, 'lazo');
        if (/^TT-/.test(s.tag)) poner(s.tag, 'PT100', `${s.tag} · sonda Pt100 (desconectada, en ohmios)`, 'resistencia');
      } else if (s.tipo === 'DI') {
        poner(s.tag, 'ENTRADA', `${s.canal} · entrada del PLC de ${s.tag} (24 V)`, 'tension');
      } else if (s.tipo === 'DO') {
        poner(s.tag, 'SALIDA', `${s.canal} · salida del PLC hacia ${s.tag}`, 'tension');
      } else if (s.tipo === 'AO') {
        poner(s.tag, 'AO', `${s.canal} · referencia 0-10 V de ${s.tag}`, 'tension');
      }
    }
    for (const tag of CONTACTORES) {
      poner(tag, 'A1', `${tag} · bobina A1 (+24 V)`, 'tension');
      poner(tag, 'A2', `${tag} · bobina A2 (0 V)`, 'tension');
      poner(tag, 'BOBINA', `${tag} · bobina (en ohmios, sin tensión)`, 'resistencia');
      poner(tag, 'L1', `${tag} · entrada de potencia L1`, 'tension');
      poner(tag, 'T1', `${tag} · salida de potencia T1 (hacia la carga)`, 'tension');
      poner(tag, 'CONTACTOS', `${tag} · contactos de potencia (continuidad, sin tensión)`, 'resistencia');
    }
    poner('PS-001', '+24V', 'PS-001 · salida +24 V', 'tension');
    poner('PS-001', '0V', 'PS-001 · salida 0 V', 'tension');
    poner('PS-001', 'RED', 'PS-001 · entrada de red (230 V CA)', 'tension');
    poner('F-201', 'ENTRADA', 'F-201 · antes del fusible', 'tension');
    poner('F-201', 'SALIDA', 'F-201 · después del fusible', 'tension');
    poner('F-201', 'FUSIBLE', 'F-201 · fusible (continuidad, sin tensión)', 'resistencia');
    poner('QE-001', 'X1.3', 'QE-001 · borna X1.3 (24 V de instrumentos)', 'tension');
    poner('QE-001', 'X1.1', 'QE-001 · borna X1.1 (230 V de entrada)', 'tension');
    poner('SV-101', 'A', 'SV-101 · bobina del piloto, borna A', 'tension');
    poner('SV-101', 'B', 'SV-101 · bobina del piloto, borna B', 'tension');
    poner('SV-101', 'BOBINA', 'SV-101 · bobina (en ohmios, sin tensión)', 'resistencia');
    poner('VFD-101', 'L1', 'VFD-101 · entrada de red (400 V)', 'tension');
    poner('VFD-101', 'U', 'VFD-101 · salida U hacia el motor', 'tension');
    poner('VFD-101', 'DISIPADOR', 'VFD-101 · temperatura del disipador', 'temperatura');
    poner('HW-101', 'BANCO1', 'HW-101 · resistencias del banco 1 (en ohmios)', 'resistencia');
    poner('HW-101', 'BANCO2', 'HW-101 · resistencias del banco 2 (en ohmios)', 'resistencia');
    poner('ES-001', 'NC', 'ES-001 · contacto NC de la seta (continuidad)', 'resistencia');
    poner('TSH-101', 'NC', 'TSH-101 · contacto NC del termostato (continuidad)', 'resistencia');
    poner('FRL-101', 'AIRE', 'FRL-101 · manómetro de aire (bar)', 'presion');
    return [...puntos.values()];
  }

  const puntosDeEquipo = (tag, lista = puntosDeMedida()) => lista.filter(p => p.equipo === tag);
  const buscarPunto = (id, lista = puntosDeMedida()) => lista.find(p => p.id === id) || null;

  /**
   * Puntos que ofrece el modelo (sim.medidas.puntos: lista [{ id, descripcion, modo }] o función que la devuelve) o, si no, los derivados del contrato.
   * Cada punto: { id, equipo, borna, nombre, tipo, modo } (modo = función natural del multímetro en ese punto).
   */
  function puntosDisponibles(sim, lay = layout) {
    try {
      const m = sim && sim.medidas, bruto = m && (typeof m.puntos === 'function' ? m.puntos() : m.puntos);
      if (Array.isArray(bruto) && bruto.length) {
        return bruto.map(p => {
          const id = typeof p === 'string' ? p : p.id, [equipo, borna = ''] = id.split(':');
          return { id, equipo, borna, nombre: (p.descripcion || p.nombre || id), tipo: p.tipo || 'tension', modo: p.modo || 'V' };
        });
      }
    } catch (error) { /* si el modelo no los da, se usan los del contrato */ }
    return puntosDeMedida(lay);
  }

  const api = { puntosDeMedida, puntosDeEquipo, buscarPunto, puntosDisponibles, CONTACTORES };
  if (typeof module !== 'undefined') module.exports = api; else PCT.htstPuntosMedida = api;
})();
