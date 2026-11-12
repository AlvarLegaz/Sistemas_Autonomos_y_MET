// Contrato del simulador de la instalación fotovoltaica de la cubierta del Politécnico: equipos, circuitos y especificaciones.
// Lo escribe el ARQUITECTO; los demás agentes lo LEEN y no lo cambian (si algo falta, lo piden). Detalle y decisiones en ../ARQUITECTURA.md.
// TODAS las especificaciones son SUPUESTOS razonables a partir de las fotos de la instalación (no se leyeron las placas de características):
// están aquí, juntas y con su motivo, para que el profesor las corrija con los datos reales.
(function () {
  const INSTALACION = {
    centro: 'CIFP Politécnico de Cartagena', nombre: 'Instalación fotovoltaica de la cubierta', corto: 'FV-01',
    modos: { normal: 'Normal', manual: 'Revisión' },
    latitudGrados: 37.6, longitudGrados: -0.98, zonaHoraria: 'Europe/Madrid',     // Cartagena
  };

  // Numeración: letras = qué es; la CENTENA del número = a qué circuito pertenece (como en la planta real HTST).
  const CIRCUITOS = {
    0: 'Caseta y servicios comunes',
    1: 'Instalación A · híbrido EASun 24 V con batería',
    2: 'Instalación B · híbrido ZCS Azzurro (autoconsumo con vertido)',
    3: 'Cuadro de alterna, red y cargas',
  };
  const circuitoDe = tag => { const n = Number(String(tag).split('-')[1]); return Number.isFinite(n) ? Math.floor(n / 100) : null; };

  // Los dos campos de paneles (la geometría exacta del 3D la decide el diseñador; aquí solo lo que necesita el modelo).
  //  A: 6 paneles policristalinos de marco plateado, en el suelo de la cubierta sobre perfiles y bloques (inclinación baja), orientados al sur. 2 cadenas de 3 en serie.
  //  B: 8 paneles monocristalinos negros, sobre bloques triangulares de hormigón, 3 filas, orientados al sur. 2 cadenas de 4 en serie (una por entrada MPPT del ZCS).
  //  (En las fotos hay además otro grupo de paneles antiguos a la derecha: NO está conectado a nada de este simulador; el 3D lo pinta de adorno.)
  const PANEL_A = { modelo: 'Policristalino 60 células (supuesto)', wp: 250, voc: 37.5, isc: 8.9, vmp: 30.5, imp: 8.2, coefPotencia: -0.0043, coefVoc: -0.0032, noctC: 46, celulas: 60, subcadenasBypass: 3, areaM2: 1.64 };
  const PANEL_B = { modelo: 'Monocristalino half-cut 108 células (supuesto)', wp: 400, voc: 37.1, isc: 13.5, vmp: 31.0, imp: 12.9, coefPotencia: -0.0035, coefVoc: -0.0027, noctC: 43, celulas: 108, subcadenasBypass: 3, areaM2: 1.82 };

  const CAMPOS = {
    A: { id: 'A', nombre: 'Campo A · policristalino', panel: PANEL_A, inclinacionGrados: 15, azimutGrados: 0, /* 0 = sur, + hacia el oeste */ cadenas: [
      { id: 'STR-101', paneles: ['PV-101', 'PV-102', 'PV-103'] }, { id: 'STR-102', paneles: ['PV-104', 'PV-105', 'PV-106'] } ] },
    B: { id: 'B', nombre: 'Campo B · monocristalino', panel: PANEL_B, inclinacionGrados: 28, azimutGrados: 0, cadenas: [
      { id: 'STR-201', paneles: ['PV-201', 'PV-202', 'PV-203', 'PV-204'] }, { id: 'STR-202', paneles: ['PV-205', 'PV-206', 'PV-207', 'PV-208'] } ] },
  };

  const INVERSORES = {
    'INV-101': { modelo: 'EASun híbrido 24 V (supuesto: 3 kW, MPPT 60–145 V, cargador 60 A)', potenciaAcW: 3000, mpptVmin: 60, mpptVmax: 145, vocMax: 145, iMpptMax: 60, bateriaV: 24, cargaMaxA: 60, descargaMaxA: 100, eficienciaMax: 0.93,
      modos: ['SOLAR_PRIMERO', 'RED_PRIMERO', 'BATERIA_PRIMERO'], tensionCorteBajaV: 21.0, tensionRearmeV: 25.0, tensionFlotacionV: 27.2, tensionAbsorcionV: 28.4 },
    'INV-201': { modelo: 'ZCS Azzurro híbrido monofásico (supuesto: 3 kW, 2 MPPT 90–450 V, sin batería)', potenciaAcW: 3000, mppt: [{ id: 'MPPT1', vMin: 90, vMax: 450, vArranque: 100, iMax: 13 }, { id: 'MPPT2', vMin: 90, vMax: 450, vArranque: 100, iMax: 13 }],
      vocMax: 550, eficienciaMax: 0.97, tiempoReconexionS: 60 },
  };

  // LiFePO4 24 V (8 celdas en serie) 100 Ah con BMS, como la de las fotos (25,6 V · 100 Ah ≈ 2,56 kWh).
  const BATERIA = { tag: 'BAT-101', modelo: 'LiFePO4 25,6 V · 100 Ah con BMS', celdas: 8, capacidadAh: 100, energiaWh: 2560, vCeldaMax: 3.65, vCeldaMin: 2.5, corrienteMaxCargaA: 100, corrienteMaxDescargaA: 100, socMinUtilPct: 10 };

  const RED = { tensionV: 230, frecuenciaHz: 50, toleranciaTensionPct: 10 };

  /** Lista cerrada de equipos. `tipo` guía a la interfaz y al 3D. */
  const EQUIPOS = [
    // 0xx · caseta y comunes
    { tag: 'CAS-001', nombre: 'Caseta metálica de la cubierta', tipo: 'caseta' },
    { tag: 'BAN-001', nombre: 'Bandeja de rejilla de cables de la cubierta', tipo: 'bandeja' },
    // 1xx · instalación A
    ...[1, 2, 3, 4, 5, 6].map(n => ({ tag: 'PV-10' + n, nombre: 'Panel policristalino ' + n + ' del campo A', tipo: 'panel', campo: 'A' })),
    { tag: 'STR-101', nombre: 'Cadena 1 del campo A (PV-101 a PV-103 en serie)', tipo: 'cadena', campo: 'A' },
    { tag: 'STR-102', nombre: 'Cadena 2 del campo A (PV-104 a PV-106 en serie)', tipo: 'cadena', campo: 'A' },
    { tag: 'CB-101', nombre: 'Caja de conexión de continua del campo A (fusibles de cadena, seccionador y descargador)', tipo: 'caja_cc' },
    { tag: 'F-101', nombre: 'Fusible de la cadena STR-101', tipo: 'fusible' },
    { tag: 'F-102', nombre: 'Fusible de la cadena STR-102', tipo: 'fusible' },
    { tag: 'QS-101', nombre: 'Seccionador de continua del campo A', tipo: 'seccionador_cc' },
    { tag: 'SPD-101', nombre: 'Descargador de sobretensiones de continua del campo A', tipo: 'descargador' },
    { tag: 'INV-101', nombre: 'Inversor híbrido EASun 24 V', tipo: 'inversor_hibrido' },
    { tag: 'QB-101', nombre: 'Magnetotérmico de continua de la batería (2P)', tipo: 'magnetotermico_cc' },
    { tag: 'FB-101', nombre: 'Portafusible de la batería', tipo: 'fusible' },
    { tag: 'BAT-101', nombre: 'Batería LiFePO4 25,6 V 100 Ah con BMS', tipo: 'bateria' },
    { tag: 'COM-101', nombre: 'Módulo de comunicaciones (Wi-Fi/RS485) del EASun', tipo: 'comunicaciones' },
    // 2xx · instalación B
    ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ tag: 'PV-20' + n, nombre: 'Panel monocristalino ' + n + ' del campo B', tipo: 'panel', campo: 'B' })),
    { tag: 'STR-201', nombre: 'Cadena 1 del campo B (PV-201 a PV-204 en serie, entrada MPPT1)', tipo: 'cadena', campo: 'B' },
    { tag: 'STR-202', nombre: 'Cadena 2 del campo B (PV-205 a PV-208 en serie, entrada MPPT2)', tipo: 'cadena', campo: 'B' },
    { tag: 'QS-201', nombre: 'Seccionador de continua del campo B (en el propio inversor y en la caja auxiliar)', tipo: 'seccionador_cc' },
    { tag: 'SPD-201', nombre: 'Descargador de sobretensiones de continua del campo B', tipo: 'descargador' },
    { tag: 'INV-201', nombre: 'Inversor híbrido ZCS Azzurro', tipo: 'inversor_hibrido' },
    { tag: 'MED-201', nombre: 'Medidor de red del ZCS (consumo e inyección)', tipo: 'medidor' },
    // 3xx · cuadro de alterna, red y cargas
    { tag: 'QA-301', nombre: 'Cuadro de alterna de la caseta', tipo: 'cuadro_ca' },
    { tag: 'QF-301', nombre: 'Magnetotérmico general del cuadro de alterna', tipo: 'magnetotermico' },
    { tag: 'ID-301', nombre: 'Diferencial de 30 mA del cuadro de alterna', tipo: 'diferencial' },
    { tag: 'QF-302', nombre: 'Magnetotérmico de la línea del EASun (entrada de red y salida a cargas)', tipo: 'magnetotermico' },
    { tag: 'QF-303', nombre: 'Magnetotérmico de la línea del ZCS (vertido)', tipo: 'magnetotermico' },
    { tag: 'SPD-301', nombre: 'Descargador de sobretensiones de alterna', tipo: 'descargador' },
    { tag: 'TC-301', nombre: 'Toma de corriente (schuko) de la caseta', tipo: 'toma' },
    { tag: 'RED-301', nombre: 'Acometida de red del centro (230 V, 50 Hz)', tipo: 'red' },
    { tag: 'LOAD-301', nombre: 'Consumo del centro (cargas de la instalación B y de la red)', tipo: 'carga' },
    { tag: 'LOAD-302', nombre: 'Cargas protegidas (salida del EASun)', tipo: 'carga' },
  ];

  /** Averías posibles (las implementa el modelo; la lista y los ids son contrato para la interfaz y las pruebas). */
  const AVERIAS = [
    { id: 'CADENA_ABIERTA_A1', titulo: 'Cadena STR-101 abierta (conector MC4 sin enchufar)', tag: 'STR-101' },
    { id: 'CADENA_ABIERTA_B1', titulo: 'Cadena STR-201 abierta (cable cortado)', tag: 'STR-201' },
    { id: 'FUSIBLE_F101', titulo: 'Fusible F-101 fundido', tag: 'F-101' },
    { id: 'DIODO_BYPASS_PV104', titulo: 'Diodo de paso de PV-104 en cortocircuito (pierde un tercio del panel)', tag: 'PV-104' },
    { id: 'DIODO_BYPASS_ABIERTO_PV203', titulo: 'Diodo de paso de PV-203 abierto (sombra parcial hunde toda la cadena)', tag: 'PV-203' },
    { id: 'CONECTOR_RESISTIVO_B2', titulo: 'Conector MC4 con alta resistencia en STR-202 (calienta y pierde potencia)', tag: 'STR-202' },
    { id: 'FALLO_AISLAMIENTO_B', titulo: 'Fallo de aislamiento a tierra en el campo B (el ZCS no arranca)', tag: 'STR-201' },
    { id: 'SPD_DISPARADO_A', titulo: 'Descargador SPD-101 agotado (testigo en rojo)', tag: 'SPD-101' },
    { id: 'QB_DISPARADO', titulo: 'Magnetotérmico de batería QB-101 disparado', tag: 'QB-101' },
    { id: 'BMS_CORTE_BATERIA', titulo: 'El BMS corta la batería por baja tensión de celda', tag: 'BAT-101' },
    { id: 'CELDA_DESEQUILIBRADA', titulo: 'Celda desequilibrada: el BMS corta antes de lo normal', tag: 'BAT-101' },
    { id: 'VENTILACION_TAPADA', titulo: 'Rejillas de ventilación de la caseta tapadas (los inversores se calientan y reducen potencia)', tag: 'CAS-001' },
    { id: 'DIFERENCIAL_DISPARADO', titulo: 'Diferencial ID-301 disparado', tag: 'ID-301' },
    { id: 'RED_CAIDA', titulo: 'Fallo de red de la acometida (el ZCS se desconecta por anti-isla)', tag: 'RED-301' },
    { id: 'SOBRETENSION_RED', titulo: 'Tensión de red alta (253 V): el ZCS reduce y desconecta', tag: 'RED-301' },
    { id: 'COMUNICACION_PERDIDA_EASUN', titulo: 'Se pierde la comunicación Wi-Fi/RS485 del EASun (solo se ve en las lecturas remotas)', tag: 'COM-101' },
    { id: 'SUCIEDAD_ALTA_A', titulo: 'Paneles del campo A muy sucios (pérdida de producción)', tag: 'STR-101' },
    { id: 'SOMBRA_PARAPETO', titulo: 'Sombra del pretil o de un objeto sobre la fila delantera del campo B', tag: 'PV-205' },
  ];

  const api = { INSTALACION, CIRCUITOS, circuitoDe, PANEL_A, PANEL_B, CAMPOS, INVERSORES, BATERIA, RED, EQUIPOS, AVERIAS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { (window.PCT = window.PCT || {}).fvLayout = api; }
})();
