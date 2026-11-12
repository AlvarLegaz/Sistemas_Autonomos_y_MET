// Estado de demostración con la forma EXACTA del contrato de ARQUITECTURA.md §3 (sim.estado), para ver y probar el 3D sin esperar al modelo.
// Función pura: sin THREE ni DOM. Cuando existe el modelo real (js/modelo/simulacion.js) el visor usa ese.
(function () {
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.fvLayout;
  const rad = g => g * Math.PI / 180, grados = r => r * 180 / Math.PI;

  /** Posición del sol para la latitud de Cartagena (azimut 0 = sur, + hacia el oeste), con la fórmula astronómica simple. */
  function posicionSol(diaAnio, horaSolar, latitud = layout.INSTALACION.latitudGrados) {
    const decl = rad(23.45) * Math.sin(2 * Math.PI * (284 + diaAnio) / 365), H = rad(15 * (horaSolar - 12)), phi = rad(latitud);
    const sinAlt = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
    const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
    const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi));
    return { alturaGrados: grados(alt), azimutGrados: grados(az) };
  }

  /**
   * opciones: horaSolar (9), diaAnio (172), nubosidad (0,1), averias: [ids de AVERIAS], sombras: { 'PV-205': 0.8 }, soc01 (0,78), suciedadA/B,
   * modoEasun, redCaida (bool), protecciones: { tag: 'ABIERTO' | 'DISPARADO' | 'FUNDIDO' | 'AGOTADO' }.
   */
  function estadoDemo(opciones = {}) {
    const hora = opciones.horaSolar !== undefined ? opciones.horaSolar : 9, dia = opciones.diaAnio !== undefined ? opciones.diaAnio : 172;
    const nub = opciones.nubosidad !== undefined ? opciones.nubosidad : 0.1, sol = posicionSol(dia, hora);
    const esDia = sol.alturaGrados > 0, averias = opciones.averias || [], sombras = opciones.sombras || {};
    const f = esDia ? Math.max(0, Math.sin(rad(sol.alturaGrados))) * (1 - 0.8 * nub) : 0;
    const ha = averias.includes.bind(averias);
    const campos = {};
    for (const campo of Object.values(layout.CAMPOS)) {
      const c = { gPlanoWm2: 1000 * f, p: 0, v: 0, i: 0, cadenas: [] };
      for (const cad of campo.cadenas) {
        const abierta = (cad.id === 'STR-101' && ha('CADENA_ABIERTA_A1')) || (cad.id === 'STR-201' && ha('CADENA_ABIERTA_B1'));
        const nP = cad.paneles.length, vmpp = campo.panel.vmp * nP * (0.97 + 0.03 * f), impp = campo.panel.imp * f, p = abierta ? 0 : vmpp * impp;
        c.cadenas.push({ id: cad.id, abierta, v: abierta ? campo.panel.voc * nP : vmpp, i: abierta ? 0 : impp, p, voc: campo.panel.voc * nP, vmpp, impp, mppEnCurso: !abierta && f > 0.02,
          paneles: cad.paneles.map(tag => ({ tag, p: p / nP, v: campo.panel.vmp * (0.97 + 0.03 * f), tempCelulaC: 25 + 30 * f, sombra01: sombras[tag] || 0, bypass: [tag === 'PV-104' && ha('DIODO_BYPASS_PV104'), (sombras[tag] || 0) > 0.5, false] })) });
        c.p += p; c.i += impp;
      }
      c.v = c.cadenas[0].v; campos[campo.id] = c;
    }
    const prot = {};
    for (const tag of ['QS-101', 'QB-101', 'QS-201', 'QF-301', 'ID-301', 'QF-302', 'QF-303', 'F-101', 'F-102', 'FB-101', 'SPD-101', 'SPD-201', 'SPD-301']) prot[tag] = { estado: tag.startsWith('SPD') ? 'SANO' : tag.startsWith('F') ? 'SANO' : 'CERRADO', causa: '' };
    if (ha('FUSIBLE_F101')) prot['F-101'] = { estado: 'FUNDIDO', causa: 'sobrecorriente' };
    if (ha('SPD_DISPARADO_A')) prot['SPD-101'] = { estado: 'AGOTADO', causa: 'sobretensión' };
    if (ha('QB_DISPARADO')) prot['QB-101'] = { estado: 'DISPARADO', causa: 'sobrecorriente' };
    if (ha('DIFERENCIAL_DISPARADO')) prot['ID-301'] = { estado: 'DISPARADO', causa: 'fuga' };
    for (const [tag, estado] of Object.entries(opciones.protecciones || {})) prot[tag] = { estado, causa: '' };
    const soc = opciones.soc01 !== undefined ? opciones.soc01 : 0.78, pvA = campos.A.p, pvB = campos.B.p, red = !(opciones.redCaida || ha('RED_CAIDA'));
    const estadoB = !red || ha('FALLO_AISLAMIENTO_B') ? (ha('FALLO_AISLAMIENTO_B') ? 'FALLO' : 'ESPERA_RED') : (pvB > 20 ? 'OPERANDO' : 'ESPERA_AISLAMIENTO');
    const operandoA = pvA > 20;
    return {
      t: hora * 3600, reloj: { diaAnio: dia, horaSolar: hora, texto: `${dia} · ${String(Math.floor(hora)).padStart(2, '0')}:${String(Math.round((hora % 1) * 60)).padStart(2, '0')}`, esDia }, sol,
      ambiente: { ghWm2: 1000 * f, nubosidad: nub, temperaturaAmbienteC: 24, suciedad: { A: opciones.suciedadA !== undefined ? opciones.suciedadA : (ha('SUCIEDAD_ALTA_A') ? 0.8 : 0.1), B: opciones.suciedadB !== undefined ? opciones.suciedadB : 0.05 } },
      campos,
      inversores: {
        'INV-101': { estado: operandoA ? 'OPERANDO' : 'ESPERA', modo: opciones.modoEasun || 'SOLAR_PRIMERO', pvV: campos.A.cadenas[0].v, pvI: campos.A.i, pvP: pvA, bateriaP: Math.max(0, pvA - 600), redP: 0, cargaP: Math.min(pvA, 600),
          temperaturaC: ha('VENTILACION_TAPADA') ? 78 : 41, eficiencia: 0.93, etapaCarga: operandoA ? 'CC' : 'NINGUNA', alarma: '', leds: { red: red, bateria: operandoA, fallo: false } },
        'INV-201': { estado: estadoB, mppt: [{ v: campos.B.cadenas[0].v, i: campos.B.cadenas[0].i, p: campos.B.cadenas[0].p, activo: pvB > 20 }, { v: campos.B.cadenas[1].v, i: campos.B.cadenas[1].i, p: campos.B.cadenas[1].p, activo: pvB > 20 }],
          acP: estadoB === 'OPERANDO' ? pvB * 0.97 : 0, acV: red ? 231.4 : 0, acF: red ? 50.01 : 0, vertidoP: estadoB === 'OPERANDO' ? pvB * 0.5 : 0, temperaturaC: 38, eficiencia: 0.97, aislamientoMohm: 20,
          leds: { onGrid: estadoB === 'OPERANDO', offGrid: !red, alarma: estadoB === 'FALLO' || !red }, alarma: estadoB === 'FALLO' ? 'ISO fault' : '', segundosParaConexion: estadoB === 'ESPERA_RED' ? 42 : 0 },
      },
      bateria: { tag: 'BAT-101', soc01: soc, v: 24.6 + 3.1 * soc, vCeldaMin: 3.2, vCeldaMax: 3.3, i: operandoA ? 12 : 0, p: operandoA ? 300 : 0, temperaturaC: 27, bms: ha('BMS_CORTE_BATERIA') ? 'CORTE_BAJA' : 'OK', energiaWh: 2560 * soc },
      red: { disponible: red, v: red ? 231 : 0, f: red ? 50 : 0, p: 400, energiaImportadaWh: 1200, energiaExportadaWh: 900 },
      cargas: { 'LOAD-301': { w: 850, manual: false }, 'LOAD-302': { w: 300, manual: false, alimentada: true } },
      protecciones: prot,
      energia: { produccionAWh: 5400, produccionBWh: 8800, consumoWh: 9100, autoconsumoPct: 71, ahorroEuros: 2.1 },
      alarmas: [],
      averiasActivas: averias.slice(),
    };
  }
  const api = { estadoDemo, posicionSol };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else { window.PCT = window.PCT || {}; PCT.fvEstadoDemo = api; }
})();
