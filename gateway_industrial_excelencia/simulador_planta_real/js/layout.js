// Contrato de la planta real HTST (pasteurizador de leche): equipos, posiciones en el patín (skid) y mapa de señales con el PLC.
// Lo escribe el ARQUITECTO; los demás agentes lo LEEN y no lo cambian (si algo falta, lo piden). Detalle y decisiones en ../ARQUITECTURA.md.
// Unidades: cm. Ejes (como simulador_pct23/js/interfaz/visor3d/planta3d/layout.js): X a la derecha, Z hacia la cámara, Y hacia arriba.
// El origen es el centro del patín; el suelo del patín está en Y = 0. Valores típicos de la literatura: ilustrativos, no de una instalación concreta.
(function () {
  const SKID = { ancho: 320, fondo: 150, alto: 20 };       // bancada de acero inoxidable sobre la que va todo menos el armario
  const ALTURA_TUBO_CM = 55;                               // eje de las tuberías sobre el suelo del patín
  const DIAMETRO_TUBO_CM = 3.8;                            // tubo sanitario de 1,5" (DN40), con abrazaderas tri-clamp

  // Proceso de ejemplo (ilustrativo): 72 °C durante 15 s. El volumen del tubo de residencia se dimensiona con el caudal máximo.
  const PROCESO = {
    temperaturaPasteurizacionC: 72, tiempoResidenciaMinS: 15,
    caudalNominalLh: 2000, caudalMaximoLh: 2500, volumenTuboResidenciaL: 10.5,   // 10,5 L / (2500 L/h = 0,694 L/s) = 15,1 s
    temperaturaEntradaC: 4, temperaturaSalidaObjetivoC: 4, consignaTT103C: 73.5,
    diferencialMinimoRegeneracionBar: 0.07,               // lado pasteurizado ≥ lado crudo + 0,07 bar (≈ 1 psi)
    aireMinimoBar: 4.5,
  };

  /** Lista cerrada de equipos: tag ISA, nombre, tipo y zona del proceso. Nada fuera de esta lista existe en la planta. */
  const EQUIPOS = [
    // Proceso
    { tag: 'TK-101', nombre: 'Tanque de balance', tipo: 'tanque', zona: 'entrada' },
    { tag: 'FLT-101', nombre: 'Filtro de aspiración (colador)', tipo: 'filtro', zona: 'entrada' },
    { tag: 'P-101', nombre: 'Bomba centrífuga de alimentación (con variador)', tipo: 'bomba', zona: 'entrada' },
    { tag: 'HX-101', nombre: 'Intercambiador de placas (regeneración, calentamiento y enfriamiento)', tipo: 'intercambiador', zona: 'intercambio' },
    { tag: 'HT-101', nombre: 'Tubo de residencia', tipo: 'tubo_residencia', zona: 'residencia' },
    { tag: 'FDV-101', nombre: 'Válvula de desvío de flujo neumática (3 vías)', tipo: 'valvula_neumatica', zona: 'salida' },
    { tag: 'SV-101', nombre: 'Electroválvula piloto de la FDV (24 V CC, muelle a desvío)', tipo: 'electrovalvula_piloto', zona: 'salida' },
    { tag: 'FRL-101', nombre: 'Unidad de aire (filtro, regulador, lubricador)', tipo: 'neumatica', zona: 'servicios' },
    // Agua caliente y fría
    { tag: 'HW-101', nombre: 'Calentador de agua caliente (dos bancos de resistencias)', tipo: 'calentador', zona: 'agua_caliente' },
    { tag: 'P-102', nombre: 'Bomba del agua caliente', tipo: 'bomba', zona: 'agua_caliente' },
    { tag: 'XV-301', nombre: 'Válvula de agua fría (todo/nada)', tipo: 'valvula_todo_nada', zona: 'agua_fria' },
    { tag: 'XV-401', nombre: 'Válvula de CIP (todo/nada)', tipo: 'valvula_todo_nada', zona: 'cip' },
    // Llenado y vaciado (mando manual y reposición automática de niveles)
    { tag: 'XV-101', nombre: 'Válvula de llenado del tanque de balance (todo/nada)', tipo: 'valvula_todo_nada', zona: 'entrada' },
    { tag: 'XV-102', nombre: 'Válvula de vaciado del tanque de balance (todo/nada)', tipo: 'valvula_todo_nada', zona: 'entrada' },
    { tag: 'XV-302', nombre: 'Válvula de llenado del depósito de agua caliente (todo/nada)', tipo: 'valvula_todo_nada', zona: 'agua_caliente' },
    { tag: 'XV-303', nombre: 'Válvula de vaciado del depósito de agua caliente (todo/nada)', tipo: 'valvula_todo_nada', zona: 'agua_caliente' },
    // Instrumentación
    { tag: 'TT-101', nombre: 'Pt100 + transmisor: leche cruda a la entrada', tipo: 'sonda_temperatura', zona: 'entrada' },
    { tag: 'TT-102', nombre: 'Pt100 + transmisor: leche cruda tras la regeneración', tipo: 'sonda_temperatura', zona: 'regeneracion' },
    { tag: 'TT-103', nombre: 'Pt100 + transmisor: salida del tubo de residencia (termómetro legal)', tipo: 'sonda_temperatura', zona: 'residencia' },
    { tag: 'TT-104', nombre: 'Pt100 + transmisor: producto a la salida', tipo: 'sonda_temperatura', zona: 'salida' },
    { tag: 'TT-105', nombre: 'Pt100 + transmisor: agua caliente', tipo: 'sonda_temperatura', zona: 'agua_caliente' },
    { tag: 'TT-106', nombre: 'Pt100 + transmisor: leche pasteurizada tras la regeneración (antes del enfriamiento)', tipo: 'sonda_temperatura', zona: 'regeneracion' },
    { tag: 'TSH-101', nombre: 'Termostato de seguridad del agua caliente (contacto NC)', tipo: 'termostato', zona: 'agua_caliente' },
    { tag: 'LSL-301', nombre: 'Interruptor de nivel bajo del depósito de agua caliente (flotador, NC): protege las resistencias', tipo: 'flotador', zona: 'agua_caliente' },
    { tag: 'LSH-301', nombre: 'Interruptor de nivel alto del depósito de agua caliente (flotador)', tipo: 'flotador', zona: 'agua_caliente' },
    { tag: 'FT-101', nombre: 'Caudalímetro electromagnético', tipo: 'caudalimetro', zona: 'entrada' },
    { tag: 'PT-101', nombre: 'Transmisor de presión: lado crudo', tipo: 'presion', zona: 'regeneracion' },
    { tag: 'PT-102', nombre: 'Transmisor de presión: lado pasteurizado', tipo: 'presion', zona: 'regeneracion' },
    { tag: 'LT-101', nombre: 'Transmisor de nivel (presión hidrostática) del tanque de balance', tipo: 'nivel', zona: 'entrada' },
    { tag: 'LSH-101', nombre: 'Interruptor de nivel alto (flotador)', tipo: 'flotador', zona: 'entrada' },
    { tag: 'LSL-101', nombre: 'Interruptor de nivel bajo (flotador, NC)', tipo: 'flotador', zona: 'entrada' },
    { tag: 'ZS-101', nombre: 'Final de carrera de la FDV: posición avance', tipo: 'final_carrera', zona: 'salida' },
    { tag: 'ZS-102', nombre: 'Final de carrera de la FDV: posición desvío', tipo: 'final_carrera', zona: 'salida' },
    { tag: 'PSL-201', nombre: 'Presostato de aire comprimido bajo', tipo: 'presostato', zona: 'servicios' },
    // Eléctrico y control
    { tag: 'QE-001', nombre: 'Armario eléctrico (seccionador, magnetotérmicos, diferencial, bornas)', tipo: 'armario', zona: 'control' },
    { tag: 'PS-001', nombre: 'Fuente de alimentación 24 V CC', tipo: 'fuente', zona: 'control' },
    { tag: 'F-201', nombre: 'Fusible general de los 24 V de instrumentos', tipo: 'fusible', zona: 'control' },
    { tag: 'VFD-101', nombre: 'Variador de frecuencia de P-101', tipo: 'variador', zona: 'control' },
    { tag: 'KM-102', nombre: 'Contactor de P-102', tipo: 'contactor', zona: 'control' },
    { tag: 'KM-201', nombre: 'Contactor del banco 1 del calentador', tipo: 'contactor', zona: 'control' },
    { tag: 'KM-202', nombre: 'Contactor del banco 2 del calentador', tipo: 'contactor', zona: 'control' },
    { tag: 'QF-102', nombre: 'Magnetotérmico de P-102 y del calentador', tipo: 'magnetotermico', zona: 'control' },
    { tag: 'PB-001', nombre: 'Pulsador de marcha / reset local', tipo: 'pulsador', zona: 'control' },
    { tag: 'ES-001', nombre: 'Paro de emergencia (seta, contacto NC) con relé de seguridad', tipo: 'paro_emergencia', zona: 'control' },
    { tag: 'PLC-001', nombre: 'PLC con tarjetas AI-1, AI-2, DI-1, DI-2, DO-1 y AO-1', tipo: 'plc', zona: 'control' },
    { tag: 'HMI-001', nombre: 'Pantalla SCADA / HMI', tipo: 'hmi', zona: 'control' },
    { tag: 'HL-001', nombre: 'Baliza de alarma', tipo: 'baliza', zona: 'control' },
  ];

  // Posición (x, z en cm) y tamaño aproximado del equipo sobre el patín. Los de zona 'control' van en el armario QE-001, aparte del patín.
  const POSICIONES_CM = {
    'TK-101': { x: -135, z: -35, ancho: 70, fondo: 70, alto: 90 },
    'FLT-101': { x: -105, z: -5, ancho: 12, fondo: 12, alto: 20 },
    'P-101': { x: -100, z: 35, ancho: 40, fondo: 25, alto: 30 },
    'FT-101': { x: -68, z: 35, ancho: 18, fondo: 18, alto: 25 },
    'HX-101': { x: 0, z: -35, ancho: 100, fondo: 60, alto: 80 },
    'HT-101': { x: 72, z: -40, ancho: 90, fondo: 40, alto: 60 },
    'FDV-101': { x: 118, z: -5, ancho: 20, fondo: 20, alto: 45 },
    'SV-101': { x: 118, z: 12, ancho: 8, fondo: 8, alto: 12 },
    'FRL-101': { x: 135, z: 25, ancho: 14, fondo: 10, alto: 20 },
    'HW-101': { x: 20, z: 45, ancho: 40, fondo: 40, alto: 80 },
    'P-102': { x: -5, z: 55, ancho: 30, fondo: 22, alto: 25 },
    'XV-301': { x: 75, z: 40, ancho: 12, fondo: 12, alto: 20 },
    'XV-401': { x: 100, z: 40, ancho: 12, fondo: 12, alto: 20 },
    'XV-101': { x: -90, z: -62, ancho: 12, fondo: 12, alto: 20 }, 'XV-102': { x: -140, z: 12, ancho: 12, fondo: 12, alto: 20 },
    'XV-302': { x: 52, z: 62, ancho: 12, fondo: 12, alto: 20 }, 'XV-303': { x: 20, z: 72, ancho: 12, fondo: 12, alto: 20 },
    'LSL-301': { x: 6, z: 48 }, 'LSH-301': { x: 6, z: 55 }, 'TT-106': { x: 3, z: -35 },
    'TT-101': { x: -120, z: 0 }, 'TT-102': { x: -28, z: -5 }, 'TT-103': { x: 104, z: -35 }, 'TT-104': { x: 150, z: 30 }, 'TT-105': { x: 5, z: 40 },
    'TSH-101': { x: 28, z: 45 },
    'PT-101': { x: -22, z: 5 }, 'PT-102': { x: 4, z: 5 },
    'LT-101': { x: -120, z: -50 }, 'LSH-101': { x: -150, z: -35 }, 'LSL-101': { x: -150, z: -20 },
    'ZS-101': { x: 126, z: -12 }, 'ZS-102': { x: 110, z: -12 }, 'PSL-201': { x: 135, z: 10 },
    'QE-001': { x: 215, z: -55, ancho: 60, fondo: 30, alto: 140, fueraDelPatin: true },   // armario junto al patín, a la derecha
  };

  /**
   * Mapa de señales con el PLC (todo lo que el PLC lee o escribe). tipo: AI (analógica de entrada), DI, DO, AO.
   * `senal`: '4-20mA', '0-10V' o '24V'. `rango`: [mínimo, máximo] de la magnitud para AI/AO. `logica` (digitales): cómo se lee el 1.
   * Falla de lazo 4-20 mA: por debajo de 3,6 mA = hilo roto; por encima de 21 mA = cortocircuito/sobreescala (ver ARQUITECTURA.md).
   */
  const s = (tipo, tag, descripcion, senal, canal, extra = {}) => Object.assign({ tipo, tag, descripcion, senal, canal }, extra);
  const SENALES = [
    // Entradas analógicas, tarjeta AI-1 (8 canales, lazos de 4-20 mA alimentados a 24 V)
    s('AI', 'TT-101', 'Temperatura de leche cruda a la entrada', '4-20mA', 'AI1.01', { rango: [0, 100], unidad: '°C' }),
    s('AI', 'TT-102', 'Temperatura de leche cruda tras la regeneración', '4-20mA', 'AI1.02', { rango: [0, 100], unidad: '°C' }),
    s('AI', 'TT-103', 'Temperatura a la salida del tubo de residencia', '4-20mA', 'AI1.03', { rango: [0, 100], unidad: '°C' }),
    s('AI', 'TT-104', 'Temperatura del producto a la salida', '4-20mA', 'AI1.04', { rango: [0, 100], unidad: '°C' }),
    s('AI', 'TT-105', 'Temperatura del agua caliente', '4-20mA', 'AI1.05', { rango: [0, 150], unidad: '°C' }),
    s('AI', 'FT-101', 'Caudal de leche', '4-20mA', 'AI1.06', { rango: [0, 3000], unidad: 'L/h' }),
    s('AI', 'PT-101', 'Presión lado crudo de la regeneración', '4-20mA', 'AI1.07', { rango: [0, 6], unidad: 'bar' }),
    s('AI', 'PT-102', 'Presión lado pasteurizado de la regeneración', '4-20mA', 'AI1.08', { rango: [0, 6], unidad: 'bar' }),
    // Tarjeta AI-2
    s('AI', 'LT-101', 'Nivel del tanque de balance', '4-20mA', 'AI2.01', { rango: [0, 100], unidad: '%' }),
    s('AI', 'TT-106', 'Temperatura de la leche pasteurizada antes del enfriamiento', '4-20mA', 'AI2.02', { rango: [0, 100], unidad: '°C' }),
    // Entradas digitales, tarjeta DI-1 (16 canales, 24 V CC)
    s('DI', 'ES-001', 'Paro de emergencia', '24V', 'DI1.01', { logica: '1 = rearmado (contacto NC cerrado); 0 = pulsado o hilo roto' }),
    s('DI', 'TSH-101', 'Termostato de seguridad del agua caliente', '24V', 'DI1.02', { logica: '1 = normal (NC cerrado); 0 = sobretemperatura o hilo roto' }),
    s('DI', 'LSH-101', 'Nivel alto del tanque de balance', '24V', 'DI1.03', { logica: '1 = nivel alto alcanzado' }),
    s('DI', 'LSL-101', 'Nivel bajo del tanque de balance', '24V', 'DI1.04', { logica: '1 = hay leche sobre el nivel bajo (NC); 0 = vacío o hilo roto' }),
    s('DI', 'ZS-101', 'FDV en posición de avance', '24V', 'DI1.05', { logica: '1 = en avance' }),
    s('DI', 'ZS-102', 'FDV en posición de desvío', '24V', 'DI1.06', { logica: '1 = en desvío' }),
    s('DI', 'PSL-201', 'Presión de aire suficiente', '24V', 'DI1.07', { logica: '1 = aire OK; 0 = presión baja' }),
    s('DI', 'P-101', 'P-101 en marcha (relé de marcha del variador)', '24V', 'DI1.08', { logica: '1 = en marcha' }),
    s('DI', 'KM-102', 'Contactor de P-102 cerrado (aux.)', '24V', 'DI1.09', { logica: '1 = cerrado' }),
    // DI1.10 libre (era el contactor KM-103 de la booster P-103, que se quitó; el resto de canales no se renumeran)
    s('DI', 'KM-201', 'Contactor del banco 1 cerrado (aux.)', '24V', 'DI1.11', { logica: '1 = cerrado' }),
    s('DI', 'KM-202', 'Contactor del banco 2 cerrado (aux.)', '24V', 'DI1.12', { logica: '1 = cerrado' }),
    s('DI', 'VFD-101', 'Fallo del variador', '24V', 'DI1.13', { logica: '1 = fallo' }),
    s('DI', 'QF-102', 'Magnetotérmico de P-102 y calentador OK', '24V', 'DI1.14', { logica: '1 = armado' }),
    s('DI', 'PS-001', 'Fuente de 24 V OK', '24V', 'DI1.15', { logica: '1 = OK' }),
    s('DI', 'PB-001', 'Pulsador de marcha / reset local', '24V', 'DI1.16', { logica: '1 = pulsado' }),
    // Tarjeta DI-2
    s('DI', 'LSL-301', 'Nivel bajo del depósito de agua caliente', '24V', 'DI2.01', { logica: '1 = hay agua sobre el nivel bajo (NC); 0 = nivel bajo o hilo roto' }),
    s('DI', 'LSH-301', 'Nivel alto del depósito de agua caliente', '24V', 'DI2.02', { logica: '1 = nivel alto alcanzado' }),
    // Salidas digitales, tarjeta DO-1 (16 canales, relé)
    s('DO', 'P-101', 'Orden de marcha de P-101 (al variador)', '24V', 'DO1.01', { logica: '1 = marcha' }),
    s('DO', 'P-102', 'Orden de marcha de P-102 (KM-102)', '24V', 'DO1.02', { logica: '1 = marcha' }),
    // DO1.03 libre (era la orden de marcha de la booster P-103, que se quitó; el resto de canales no se renumeran)
    s('DO', 'KM-201', 'Banco 1 del calentador (bobina de KM-201)', '24V', 'DO1.04', { logica: '1 = conecta' }),
    s('DO', 'KM-202', 'Banco 2 del calentador (bobina de KM-202)', '24V', 'DO1.05', { logica: '1 = conecta' }),
    s('DO', 'SV-101', 'Piloto de la FDV', '24V', 'DO1.06', { logica: '1 = avance (con aire); 0 = desvío (muelle, seguridad positiva)' }),
    s('DO', 'XV-301', 'Válvula de agua fría', '24V', 'DO1.07', { logica: '1 = abierta' }),
    s('DO', 'XV-401', 'Válvula de CIP', '24V', 'DO1.08', { logica: '1 = abierta' }),
    s('DO', 'HL-001', 'Baliza de alarma', '24V', 'DO1.09', { logica: '1 = encendida' }),
    s('DO', 'XV-101', 'Válvula de llenado del tanque de balance', '24V', 'DO1.10', { logica: '1 = abierta' }),
    s('DO', 'XV-102', 'Válvula de vaciado del tanque de balance', '24V', 'DO1.11', { logica: '1 = abierta' }),
    s('DO', 'XV-302', 'Válvula de llenado del depósito de agua caliente', '24V', 'DO1.12', { logica: '1 = abierta' }),
    s('DO', 'XV-303', 'Válvula de vaciado del depósito de agua caliente', '24V', 'DO1.13', { logica: '1 = abierta' }),
    // Salida analógica, tarjeta AO-1
    s('AO', 'VFD-101', 'Referencia de velocidad del variador', '0-10V', 'AO1.01', { rango: [0, 100], unidad: '%' }),
  ];

  const MODOS = ['PARADA', 'MANUAL', 'RECIRCULACION_AGUA', 'PRODUCCION', 'CIP'];
  /** Modos de funcionamiento: nombre para la pantalla, qué es y qué hace (o no hace) el PLC en cada uno. */
  const MODOS_INFO = {
    PARADA: { nombre: 'Parada', tipo: 'automatico',
      descripcion: 'Planta parada: bombas, calentador y válvulas de proceso apagados.',
      automatiza: 'Solo mantiene los niveles (repone el tanque de balance y el depósito de agua caliente).' },
    MANUAL: { nombre: 'Manual', tipo: 'manual',
      descripcion: 'El operador manda cada actuador: bombas, variador, bancos del calentador, FDV, válvulas de agua fría y de CIP y los llenados y vaciados.',
      automatiza: 'Nada: ni niveles, ni consigna de temperatura, ni la FDV. Siguen activas las protecciones cableadas: paro de emergencia, termostato TSH-101, 24 V, aire de la FDV, nivel bajo de calentador, calentador sin P-102 y marcha en seco de P-101.' },
    RECIRCULACION_AGUA: { nombre: 'Recirculación de agua', tipo: 'automatico',
      descripcion: 'Modo previo a producir: el agua circula y la planta se calienta hasta cumplir las condiciones de pasteurización.',
      automatiza: 'Caudal, calentamiento en cascada, FDV (en avance solo con lazos sanos, aire y diferencial), agua fría y niveles.' },
    PRODUCCION: { nombre: 'Producción', tipo: 'automatico',
      descripcion: 'Producción de leche pasteurizada: la FDV solo avanza con 72 °C, 15 s de residencia, diferencial de regeneración y aire.',
      automatiza: 'Todo; si se pierden las condiciones durante 10 s vuelve a recirculación.' },
    CIP: { nombre: 'Limpieza CIP', tipo: 'automatico',
      descripcion: 'Limpieza en el sitio por pasos (enjuague, sosa caliente, enjuague, ácido, enjuague).',
      automatiza: 'Caudal fijo, temperatura de cada paso, válvula de CIP y paso de un paso al siguiente por tiempos.' },
  };
  const POSICIONES_FDV = ['AVANCE', 'DESVIO', 'MOVIENDO'];
  const CALIDAD_SENAL = ['OK', 'ABIERTO', 'CORTO', 'RUIDO', 'DERIVA', 'CONGELADO'];   // estado de un lazo de instrumento (ver averías)
  const LIMITES_LAZO_MA = { hiloRoto: 3.6, nominalMin: 4, nominalMax: 20, sobreescala: 21 };

  /** mA de un lazo 4-20 mA para un valor de proceso dentro de [min, max] (se limita a 3,6 – 21 mA fuera de rango). */
  function aMilisamperios(valor, min, max) {
    const mA = 4 + 16 * (valor - min) / (max - min);
    return Math.min(LIMITES_LAZO_MA.sobreescala, Math.max(LIMITES_LAZO_MA.hiloRoto, mA));
  }
  /** Valor de proceso a partir de los mA de un lazo 4-20 mA (sin limitar: lo que de verdad interpreta la tarjeta). */
  const deMilisamperios = (mA, min, max) => min + (mA - 4) / 16 * (max - min);

  const equipo = tag => EQUIPOS.find(e => e.tag === tag) || null;
  const senal = tag => SENALES.filter(x => x.tag === tag);
  const posicion = tag => POSICIONES_CM[tag] || null;

  /*
   * Contrato de cada módulo 3D (todos en js/visor3d_htst/, ver ARQUITECTURA.md §5):
   *
   *   crear(THREE, estadoInicial) → { grupo, elementos, actualizar(estado, lecturas), liberar() }
   *
   *   grupo       THREE.Group en coordenadas del patín (usa posicion(tag) de este archivo).
   *   elementos   { [tag]: { id: tag, grupo, ancla, ayuda } } — un elemento por equipo de EQUIPOS; ancla: THREE.Vector3 sobre la pieza.
   *               Todas las mallas seleccionables llevan mesh.userData.id = tag.
   *   actualizar  cada fotograma, sin crear objetos. `estado` es el de js/modelo/estado.js (ARQUITECTURA.md §4): lee estado.equipos[tag].
   *   liberar     dispose de geometrías, materiales y texturas.
   * Cada módulo es un IIFE con doble exportación (module.exports / PCT.htst<Nombre>) y deja las funciones puras (cálculos, trayectorias, textos) exportadas
   * aparte para probarlas con node:test.
   */
  const api = { SKID, ALTURA_TUBO_CM, DIAMETRO_TUBO_CM, PROCESO, EQUIPOS, POSICIONES_CM, SENALES, MODOS, MODOS_INFO, POSICIONES_FDV, CALIDAD_SENAL,
    LIMITES_LAZO_MA, aMilisamperios, deMilisamperios, equipo, senal, posicion };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstLayout = api; }
})();
