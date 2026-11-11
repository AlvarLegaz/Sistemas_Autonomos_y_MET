// Instrumentos: del valor real del proceso a lo que ve el PLC (mA de los lazos 4-20 mA y niveles de las entradas digitales de 24 V).
// Las averías de sensor y de lazo actúan aquí (a través del motor) y la alimentación de 24 V condiciona todo: sin fusible no hay lazos ni entradas.
(function () {
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.htstLayout;
  const { CONSTANTES: C } = typeof require !== 'undefined' ? require('../configuracion/constantes.js') : PCT.htstConstantes;
  const calidad = typeof require !== 'undefined' ? require('../plc/calidad_senal.js') : PCT.htstCalidadSenal;

  const SENALES_AI = layout.SENALES.filter(s => s.tipo === 'AI');
  const TAGS_DI = layout.SENALES.filter(s => s.tipo === 'DI').map(s => s.tag);

  /** Valor real (en unidades de ingeniería) que mide cada instrumento analógico, a partir del estado de la planta. */
  function valorProcesoAI(tag, estado) {
    const T = estado.proceso.temperaturas, P = estado.proceso.presiones;
    switch (tag) {
      case 'TT-101': return T.entrada;
      case 'TT-102': return T.trasRegeneracion;
      case 'TT-103': return T.salidaTubo;
      case 'TT-104': return T.salidaFinal;
      case 'TT-105': return T.aguaCaliente;
      case 'FT-101': return estado.proceso.caudalLh;
      case 'PT-101': return P.crudoBar;
      case 'PT-102': return P.pasteurizadoBar;
      case 'LT-101': return estado.tanque.nivelPct;
      default: return 0;
    }
  }

  /**
   * Lectura de una entrada analógica. alim = { v24, fusibleF201 }; motor = el motor de averías (o null).
   * Devuelve { valorProceso, mA, valorPLC, calidad }.
   */
  function leerAI(tag, estado, tS, motor, alim) {
    const senal = SENALES_AI.find(s => s.tag === tag);
    const [min, max] = senal.rango;
    const valorProceso = valorProcesoAI(tag, estado);
    const mABase = layout.aMilisamperios(valorProceso, min, max);
    let mA = mABase, cal = 'OK';
    if (!alim.fusibleF201) { mA = 0; cal = 'ABIERTO'; }                              // sin 24 V no hay corriente en ningún lazo
    else if (alim.v24 < 20) { mA = 22; cal = 'CORTO'; }                              // fuente degradada: los transmisores saturan
    else if (motor) { const r = motor.alLeerInstrumento(tag, valorProceso, tS, mABase); mA = r.mA; cal = r.calidad; }
    cal = calidad.combinarCalidad(cal, mA);
    return { valorProceso, mA, valorPLC: calidad.valorPLC(mA, min, max), calidad: cal };
  }

  /** Niveles lógicos físicos (antes de la alimentación) de las entradas digitales, a partir del estado. Los de seguridad son NC: 1 = sano. */
  function nivelesDigitales(estado, pulsadoPB) {
    const eq = estado.equipos, T = C.tanque;
    const nivel = estado.tanque.nivelPct;
    return {
      'ES-001': eq['ES-001'].rearmado ? 1 : 0,
      'TSH-101': eq['TSH-101'].abierto ? 0 : 1,
      'LSH-101': nivel >= T.nivelAltoPct ? 1 : 0,
      'LSL-101': nivel > T.nivelBajoPct ? 1 : 0,
      'ZS-101': eq['FDV-101'].posicion === 'AVANCE' ? 1 : 0,
      'ZS-102': eq['FDV-101'].posicion === 'DESVIO' ? 1 : 0,
      'PSL-201': eq['PSL-201'].contactoCerrado ? 1 : 0,
      'P-101': eq['P-101'].marcha ? 1 : 0,
      'KM-102': eq['KM-102'].cerrado ? 1 : 0, 'KM-103': eq['KM-103'].cerrado ? 1 : 0,
      'KM-201': eq['KM-201'].cerrado ? 1 : 0, 'KM-202': eq['KM-202'].cerrado ? 1 : 0,
      'VFD-101': eq['P-101'].fallo ? 1 : 0,
      'QF-102': eq['QF-102'].armado ? 1 : 0,
      'PS-001': eq['PS-001'].tensionV >= 22 ? 1 : 0,
      'PB-001': pulsadoPB ? 1 : 0,
    };
  }

  /**
   * Todas las entradas del PLC: { AI: { tag: {valor, mA, calidad} }, DI: { tag: 0|1 } }. Con el fusible F-201 fundido las entradas digitales
   * alimentadas a 24 V leen todas 0 (se pierde también el contacto NC del paro de emergencia, que es lo seguro).
   */
  function leerEntradas(estado, tS, motor, alim, pulsadoPB) {
    const AI = {}, regAI = {};
    for (const s of SENALES_AI) {
      const r = leerAI(s.tag, estado, tS, motor, alim);
      AI[s.tag] = { valor: r.valorPLC, mA: r.mA, calidad: r.calidad };
      regAI[s.tag] = r;
    }
    const fisicos = nivelesDigitales(estado, pulsadoPB), DI = {};
    for (const tag of TAGS_DI) DI[tag] = alim.fusibleF201 ? fisicos[tag] : 0;
    return { AI, DI, registroAI: regAI };
  }

  const api = { SENALES_AI, TAGS_DI, valorProcesoAI, leerAI, nivelesDigitales, leerEntradas };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstInstrumentos = api; }
})();
