// Alarmas del PLC: códigos, textos y evaluación a partir de lo que el PLC ve (entradas, calidad de los lazos y discrepancias). Funciones puras.
(function () {
  const calidad = typeof require !== 'undefined' ? require('./calidad_senal.js') : PCT.htstCalidadSenal;

  const TEXTOS = {
    A101: 'Lazo 4-20 mA abierto (menos de 3,6 mA): hilo roto o sin alimentación',
    A102: 'Lazo 4-20 mA en sobreescala (más de 21 mA): cortocircuito, sonda abierta o ruido',
    A110: 'Diferencial de la regeneración bajo (el lado pasteurizado debe estar al menos 0,07 bar sobre el crudo)',
    A120: 'La FDV no sigue la orden del piloto (las posiciones ZS-101/ZS-102 no coinciden)',
    A130: 'Un contactor no sigue la orden del PLC (la orden y el contacto auxiliar no coinciden)',
    A140: 'Fuente de 24 V o fusible: falta tensión de instrumentos',
    A150: 'Fallo del variador de P-101',
    A160: 'Presión de aire comprimido baja',
    A170: 'Termostato de seguridad del agua caliente abierto',
    A180: 'Paro de emergencia pulsado o circuito abierto',
    A190: 'Fallo de comunicación SCADA - PLC',
    A200: 'Nivel bajo en el tanque de balance',
    A210: 'Sin condiciones de pasteurización: producción devuelta a recirculación',
    A220: 'MANUAL: FDV en avance sin condiciones de pasteurización (el producto se cuenta como no conforme)',
    A230: 'Nivel bajo en el depósito de agua caliente: el calentador queda sin energía',
    M100: 'MODO MANUAL activo: el PLC no automatiza nada, solo mantiene las protecciones cableadas',
  };
  const NIVELES = { A101: 'alarma', A102: 'alarma', A110: 'critica', A120: 'critica', A130: 'alarma', A140: 'critica', A150: 'critica', A160: 'alarma',
    A170: 'critica', A180: 'critica', A190: 'aviso', A200: 'aviso', A210: 'aviso', A220: 'aviso', A230: 'alarma', M100: 'estado' };   // 'estado': informa, no enciende la baliza

  const alarma = (codigo, tag) => ({ codigo, tag, nivel: NIVELES[codigo], texto: TEXTOS[codigo] });

  /**
   * ctx: { AI: { tag: { calidad } }, DI: { tag: 0|1 }, discrepancia: { fdv: bool, contactores: { tag: bool } }, p101Marcha, dpBajo }
   * Devuelve la lista de alarmas activas ahora (sin tiempos: eso lo hace fusionarAlarmas).
   */
  function evaluarAlarmas(ctx) {
    const lista = [];
    for (const [tag, ai] of Object.entries(ctx.AI)) {
      if (ai.calidad === 'ABIERTO') lista.push(alarma('A101', tag));
      else if (ai.calidad === 'CORTO') lista.push(alarma('A102', tag));
    }
    if (ctx.dpBajo) lista.push(alarma('A110', 'HX-101'));
    if (ctx.discrepancia.fdv) lista.push(alarma('A120', 'FDV-101'));
    for (const [tag, mal] of Object.entries(ctx.discrepancia.contactores)) if (mal) lista.push(alarma('A130', tag));
    if (ctx.DI['PS-001'] === 0) lista.push(alarma('A140', 'PS-001'));
    if (ctx.DI['VFD-101'] === 1) lista.push(alarma('A150', 'VFD-101'));
    if (ctx.DI['PSL-501'] === 0) lista.push(alarma('A160', 'PSL-501'));
    if (ctx.DI['TSH-201'] === 0) lista.push(alarma('A170', 'TSH-201'));
    if (ctx.DI['ES-001'] === 0) lista.push(alarma('A180', 'ES-001'));
    if (ctx.DI['LSL-101'] === 0) lista.push(alarma('A200', 'LSL-101'));
    if (ctx.vueltaARecirculacion) lista.push(alarma('A210', 'FDV-101'));
    if (ctx.DI['LSL-201'] === 0) lista.push(alarma('A230', 'LSL-201'));
    if (ctx.modoManual) lista.push(alarma('M100', 'PLC-001'));
    if (ctx.manualFdvSinCondiciones) lista.push(alarma('A220', 'FDV-101'));
    return lista;
  }

  /** Conserva el instante en que apareció cada alarma (código + tag) entre un ciclo y el siguiente. */
  function fusionarAlarmas(previas, nuevas, tS) {
    return nuevas.map(a => {
      const antes = previas.find(p => p.codigo === a.codigo && p.tag === a.tag);
      return Object.assign({}, a, { desdeS: antes ? antes.desdeS : tS });
    });
  }

  const api = { TEXTOS, NIVELES, evaluarAlarmas, fusionarAlarmas, lazoSano: calidad.lazoSano };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstAlarmas = api; }
})();
