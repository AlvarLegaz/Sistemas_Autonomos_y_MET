// Catálogo de averías (las 18 de AVERIAS de layout.js, mismos ids y tags) con lo que necesita el profesor y el alumno:
// descripción, síntomas esperados en el sinóptico, alarmas que deben aparecer, forma de diagnosticarla y reparación.
// Los EFECTOS no están aquí: los produce la física del modelo leyendo qué averías hay activas (ver simulacion.js, cadena.js, bateria.js e inversores).
// FIRMA DE DIAGNÓSTICO (para los instrumentos de medida y el modo de avería oculta; formato en ../../API_INSTRUMENTOS.md §6): cada entrada lleva `firma` =
//   { sintoma, escenario, medidasClave, pistas, explicacion, distractores }. `diagnostico` sigue siendo la lista de textos de siempre y, además, lleva colgadas
//   esas mismas propiedades (a.diagnostico.sintoma, a.diagnostico.medidasClave…). Ayudas: leerMedida(sim, medida), cumple(valor, rango), prepararEscenario(sim, firma).
//   dificultad: 1 fácil · 2 media · 3 difícil.   solucion.accion: 'rearmar' (la maniobra del alumno retira la avería), 'sustituir', 'reparar', 'limpiar', 'despejar'.
(function () {
  const layout = typeof require !== 'undefined' ? require('../layout.js') : window.PCT.fvLayout;

  const EXTRA = {
    CADENA_ABIERTA_A1: { dificultad: 1, descripcion: 'Un conector MC4 de la cadena STR-101 está sin enchufar: la cadena no entrega corriente.',
      sintomas: ['El campo A produce aproximadamente la mitad que de costumbre.', 'La cadena STR-101 muestra 0 A y su tensión en vacío (Voc) sigue presente en la caja.', 'La curva I-V de STR-101 es plana en 0 A.'],
      alarmas: [], diagnostico: ['Medir la tensión de la cadena en CB-101 con y sin cargar: hay Voc pero ninguna corriente.', 'Comprobar la continuidad de la cadena entre sus extremos.'],
      solucion: { texto: 'Enchufar y comprobar el conector MC4 de la cadena STR-101.', accion: 'reparar', tag: 'STR-101' } },
    CADENA_ABIERTA_B1: { dificultad: 1, descripcion: 'El cable de la cadena STR-201 está cortado: el MPPT1 del ZCS no recibe tensión.',
      sintomas: ['El MPPT1 del ZCS muestra 0 V y 0 A; el MPPT2 trabaja normal.', 'El campo B rinde la mitad.', 'El ZCS avisa de cadena sin tensión.'],
      alarmas: ['ZCS_CADENA_ABIERTA'], diagnostico: ['Medir la tensión en el borne MPPT1 del ZCS (0 V) y en el extremo de la cadena (Voc).', 'Seguir el cable hasta encontrar el corte.'],
      solucion: { texto: 'Reparar o sustituir el tramo de cable cortado de STR-201.', accion: 'reparar', tag: 'STR-201' } },
    FUSIBLE_F101: { dificultad: 1, descripcion: 'El fusible F-101 de la cadena STR-101 está fundido.',
      sintomas: ['La cadena STR-101 no entrega corriente aunque hay sol.', 'La producción del campo A baja a la mitad.', 'El fusible aparece FUNDIDO en el cuadro.'],
      alarmas: ['FUSIBLE_FUNDIDO'], diagnostico: ['Medir continuidad del fusible F-101 (circuito abierto).', 'Buscar la causa antes de sustituirlo (cortocircuito, sobrecorriente inversa).'],
      solucion: { texto: 'Sustituir F-101 por otro del mismo calibre una vez descartada la causa.', accion: 'sustituir', tag: 'F-101' } },
    DIODO_BYPASS_PV104: { dificultad: 3, descripcion: 'El diodo de paso de una subcadena del panel PV-104 está en cortocircuito: esa subcadena queda anulada.',
      sintomas: ['La tensión de STR-102 baja un tercio de la de un panel (~10 V menos).', 'La potencia de la cadena baja un 11 % aproximadamente.', 'En la curva I-V de STR-102 el codo se desplaza a menor tensión.'],
      alarmas: [], diagnostico: ['Comparar la tensión en vacío de STR-102 con la de STR-101 (≈ 12 V menos).', 'Medir cada panel aparte: PV-104 da 2/3 de su Voc.'],
      solucion: { texto: 'Sustituir el panel PV-104 (o su caja de conexiones con diodos).', accion: 'sustituir', tag: 'PV-104' } },
    DIODO_BYPASS_ABIERTO_PV203: { dificultad: 3, descripcion: 'El diodo de paso de la subcadena de PV-203 está abierto: una sombra parcial en ese panel hunde toda la cadena STR-201.',
      sintomas: ['Sin sombra todo parece normal.', 'Con una sombra del 30 % sobre PV-203 la cadena STR-201 cae ≈ 65 % (con el diodo sano caería ≈ 25 %), y el panel se calienta unos 18 °C más (punto caliente).', 'La curva I-V de STR-201 pierde casi toda la corriente con poca sombra.'],
      alarmas: [], diagnostico: ['Sombrear ligeramente PV-203 y comparar con la sombra equivalente en PV-202.', 'Medir con el diodo desconectado (sin tensión directa).'],
      solucion: { texto: 'Sustituir el panel PV-203 o la caja de conexiones (diodo de paso).', accion: 'sustituir', tag: 'PV-203' } },
    CONECTOR_RESISTIVO_B2: { dificultad: 2, descripcion: 'Un conector MC4 de STR-202 tiene mala conexión (resistencia alta): calienta y pierde potencia.',
      sintomas: ['El MPPT2 entrega menos potencia que el MPPT1 con la misma luz (≈ 11 % menos; el campo B, ≈ 5 %).', 'El conector se calienta (termografía): con 1 Ω equivalente y 13 A pasa de 100 °C.', 'La tensión de la cadena en carga cae más de lo normal.'],
      alarmas: [], diagnostico: ['Comparar las potencias de MPPT1 y MPPT2.', 'Medir la caída de tensión en el conector con la cadena en carga.'],
      solucion: { texto: 'Cambiar el conector MC4 con el crimpado correcto.', accion: 'reparar', tag: 'STR-202' },
      parametros: { resistenciaOhm: { defecto: 1.0, min: 0.2, max: 5 } } },
    FALLO_AISLAMIENTO_B: { dificultad: 2, descripcion: 'Hay una fuga a tierra en el campo B (cable pelado o panel húmedo): el ZCS no pasa la comprobación de aislamiento.',
      sintomas: ['El ZCS nunca llega a conectar: se queda en fallo con el LED de alarma.', 'El campo B tiene sol y tensión pero no inyecta.', 'Medida de aislamiento muy baja (< 0,5 MΩ).'],
      alarmas: ['ZCS_AISLAMIENTO'], diagnostico: ['Leer el aislamiento que mide el ZCS (por debajo de 0,5 MΩ no conecta).', 'Medir con megóhmetro (sim.aislamiento) cada cadena a tierra por separado: la que falla da unas décimas de MΩ y las sanas, decenas.'],
      solucion: { texto: 'Localizar y reparar el cable o panel con fuga a tierra.', accion: 'reparar', tag: 'STR-201' } },
    SPD_DISPARADO_A: { dificultad: 1, descripcion: 'El descargador de sobretensiones SPD-101 está agotado (testigo rojo): la instalación funciona pero sin protección.',
      sintomas: ['Todo funciona con normalidad.', 'El testigo del SPD-101 está en rojo.'],
      alarmas: ['SPD_AGOTADO'], diagnostico: ['Revisar visualmente los testigos de los descargadores.'],
      solucion: { texto: 'Sustituir el cartucho del descargador SPD-101.', accion: 'sustituir', tag: 'SPD-101' } },
    QB_DISPARADO: { dificultad: 1, descripcion: 'El magnetotérmico de continua QB-101 está disparado: el EASun pierde la batería.',
      sintomas: ['El EASun pasa a FALLO y deja de usar el sol.', 'Sin batería: las cargas protegidas solo se alimentan de la red.', 'La tensión de batería no llega al inversor.'],
      alarmas: ['PROTECCION_DISPARADA', 'EASUN_SIN_BATERIA'], diagnostico: ['Medir tensión a ambos lados de QB-101.'],
      solucion: { texto: 'Buscar la causa del disparo y rearmar QB-101.', accion: 'rearmar', tag: 'QB-101' } },
    BMS_CORTE_BATERIA: { dificultad: 2, descripcion: 'El BMS corta la descarga de la batería por baja tensión de celda (detección errónea).',
      sintomas: ['La batería no entrega corriente: el EASun usa la red o deja sin alimentar las cargas.', 'La batería sigue admitiendo carga.', 'Alarma de BMS en corte por baja tensión.'],
      alarmas: ['BMS_CORTE_BAJA'], diagnostico: ['Comparar la tensión de celdas con el estado del BMS.'],
      solucion: { texto: 'Revisar y recalibrar o sustituir el BMS.', accion: 'reparar', tag: 'BAT-101' } },
    CELDA_DESEQUILIBRADA: { dificultad: 3, descripcion: 'Una celda está desequilibrada: el BMS corta antes en carga (celda alta) y en descarga (celda baja).',
      sintomas: ['La diferencia entre la celda más baja y la más alta es mucho mayor de lo normal.', 'El BMS corta con SoC intermedio.', 'Capacidad útil reducida.'],
      alarmas: [], diagnostico: ['Medir tensión de cada celda y comparar.'],
      solucion: { texto: 'Equilibrar las celdas o sustituir la celda defectuosa.', accion: 'reparar', tag: 'BAT-101' } },
    VENTILACION_TAPADA: { dificultad: 2, descripcion: 'Las rejillas de ventilación de la caseta están tapadas: los inversores se calientan y reducen potencia.',
      sintomas: ['La temperatura de los inversores sube más de lo normal.', 'Pasan a REDUCIDO por temperatura aunque haya poca carga.', 'La caseta está mucho más caliente que el exterior.'],
      alarmas: ['EASUN_REDUCIDO_TEMP', 'ZCS_REDUCIDO_TEMP'], diagnostico: ['Medir temperaturas de los inversores y de la caseta.', 'Inspeccionar las rejillas.'],
      solucion: { texto: 'Despejar las rejillas de ventilación.', accion: 'despejar', tag: 'CAS-001' } },
    DIFERENCIAL_DISPARADO: { dificultad: 1, descripcion: 'El diferencial ID-301 ha saltado: el cuadro de alterna se queda sin red.',
      sintomas: ['El ZCS se desconecta (sin red) y el EASun pierde su entrada de red.', 'LOAD-301 sin tensión.', 'ID-301 aparece DISPARADO.'],
      alarmas: ['PROTECCION_DISPARADA', 'ZCS_SIN_RED'], diagnostico: ['Medir tensión antes y después de ID-301.'],
      solucion: { texto: 'Buscar la fuga y rearmar ID-301.', accion: 'rearmar', tag: 'ID-301' } },
    RED_CAIDA: { dificultad: 1, descripcion: 'Falla la red de la acometida.',
      sintomas: ['El ZCS se desconecta por anti-isla (LEDs Off-Grid y Alarma).', 'LOAD-301 sin tensión.', 'El EASun mantiene LOAD-302 con sol y batería.'],
      alarmas: ['RED_CAIDA', 'ZCS_SIN_RED'], diagnostico: ['Medir tensión en la acometida RED-301.'],
      solucion: { texto: 'Esperar a que vuelva la red (la maniobra del profesor la restablece).', accion: 'despejar', tag: 'RED-301' } },
    SOBRETENSION_RED: { dificultad: 2, descripcion: 'La tensión de la red está en 253 V: el ZCS reduce potencia y desconecta.',
      sintomas: ['El ZCS no inyecta o lo hace con potencia reducida.', 'La tensión medida en el cuadro es 253 V.'],
      alarmas: ['ZCS_SOBRETENSION_RED'], diagnostico: ['Medir la tensión de red en QA-301.'],
      solucion: { texto: 'La tensión se corrige en la red (avisar a la compañía); el profesor la restablece.', accion: 'despejar', tag: 'RED-301' } },
    COMUNICACION_PERDIDA_EASUN: { dificultad: 1, descripcion: 'Se pierde la comunicación del módulo COM-101 del EASun.',
      sintomas: ['El inversor funciona con normalidad.', 'Las lecturas remotas del EASun dejan de actualizarse.'],
      alarmas: ['EASUN_COM_PERDIDA'], diagnostico: ['Comprobar el LED del módulo Wi-Fi/RS485 y el cableado.'],
      solucion: { texto: 'Revisar o sustituir el módulo de comunicaciones COM-101.', accion: 'sustituir', tag: 'COM-101' } },
    SUCIEDAD_ALTA_A: { dificultad: 1, descripcion: 'Los paneles del campo A están muy sucios (≈ 30 % de pérdida).',
      sintomas: ['La producción del campo A baja un 30 % respecto a lo esperado con esa irradiancia.', 'Tensión y corriente algo menores en ambas cadenas.'],
      alarmas: [], diagnostico: ['Comparar la producción de A con la de B (relativa a su potencia) en igualdad de condiciones.'],
      solucion: { texto: 'Limpiar los paneles del campo A.', accion: 'limpiar', tag: 'STR-101' } },
    SOMBRA_PARAPETO: { dificultad: 2, descripcion: 'El pretil proyecta sombra sobre la fila delantera del campo B (PV-205 y PV-206) cuando el sol está bajo.',
      sintomas: ['En las primeras y últimas horas la cadena STR-202 cae mucho más que STR-201.', 'La curva P-V de STR-202 tiene dos máximos.', 'A mediodía en verano no se nota.'],
      alarmas: [], diagnostico: ['Comparar STR-201 y STR-202 por la mañana y a mediodía.', 'Observar la sombra en el 3D.'],
      solucion: { texto: 'Retirar el objeto o reubicar la fila delantera.', accion: 'despejar', tag: 'PV-205' } },
  };

  /**
   * CUÁNTO CAE LA POTENCIA en cada avería respecto a la esperada (lo que da la planta sana con la misma luz), para el diagnóstico didáctico.
   * `perdidaPct` es el rango de `estado.campos[campo].diagnostico.perdidaPct` en el escenario patrón: junio, cielo despejado, a `horaSolar` (11 por defecto),
   * batería al 30 % (el EASun aprovecha todo el sol) y la avería activa unos minutos; `sombra` = sombras previas por panel; `porCadena` = { id: [min, max] } de la cadena afectada.
   * `null` = la avería no se nota en la potencia de los paneles (se ve en otras lecturas: alarmas, temperaturas, estado de la batería).
   */
  const EFECTOS = {
    CADENA_ABIERTA_A1: { campo: 'A', perdidaPct: [45, 55], porCadena: { 'STR-101': [95, 100] }, texto: 'El campo A pierde la mitad (una de sus dos cadenas no entrega).' },
    CADENA_ABIERTA_B1: { campo: 'B', perdidaPct: [45, 55], porCadena: { 'STR-201': [95, 100] }, texto: 'El campo B pierde la mitad (el MPPT1 no recibe nada).' },
    FUSIBLE_F101: { campo: 'A', perdidaPct: [45, 55], porCadena: { 'STR-101': [95, 100] }, texto: 'El campo A pierde la mitad.' },
    DIODO_BYPASS_PV104: { campo: 'A', perdidaPct: [4, 11], porCadena: { 'STR-102': [9, 15] }, texto: 'STR-102 pierde ≈ 12 % (un tercio de un panel de tres); el campo A, ≈ 7 %.' },
    DIODO_BYPASS_ABIERTO_PV203: { campo: 'B', perdidaPct: [22, 42], porCadena: { 'STR-201': [50, 80] }, sombra: { 'PV-203': 0.3 },
      texto: 'Sin sombra no se nota nada; con una sombra del 30 % sobre PV-203, STR-201 pierde ≈ 65 % (con el diodo sano perdería ≈ 25 %).' },
    CONECTOR_RESISTIVO_B2: { campo: 'B', perdidaPct: [3, 8], porCadena: { 'STR-202': [8, 14] }, texto: 'STR-202 pierde ≈ 11 % (170 W de calor en el conector con 1 Ω); el campo B, ≈ 5 %.' },
    FALLO_AISLAMIENTO_B: { campo: 'B', perdidaPct: [95, 100], texto: 'El campo B no inyecta nada: el ZCS no conecta.' },
    SPD_DISPARADO_A: null,
    QB_DISPARADO: { campo: 'A', perdidaPct: [95, 100], texto: 'El EASun pierde la batería, no arranca el sol y el campo A no produce.' },
    BMS_CORTE_BATERIA: null,
    CELDA_DESEQUILIBRADA: null,
    VENTILACION_TAPADA: null,
    DIFERENCIAL_DISPARADO: { campo: 'B', perdidaPct: [95, 100], texto: 'El ZCS se queda sin red: el campo B no inyecta. El campo A sigue (cargando la batería y las cargas protegidas).' },
    RED_CAIDA: { campo: 'B', perdidaPct: [95, 100], texto: 'El ZCS se desconecta por anti-isla: el campo B no inyecta.' },
    SOBRETENSION_RED: { campo: 'B', perdidaPct: [95, 100], texto: 'A 253 V el ZCS desconecta: el campo B no inyecta.' },
    COMUNICACION_PERDIDA_EASUN: null,
    SUCIEDAD_ALTA_A: { campo: 'A', perdidaPct: [25, 32], porCadena: { 'STR-101': [25, 32], 'STR-102': [25, 32] }, texto: 'Las dos cadenas del campo A pierden ≈ 28 % (la suciedad del 30 % menos lo que baja la temperatura de célula).' },
    SOMBRA_PARAPETO: { campo: 'B', perdidaPct: [20, 40], porCadena: { 'STR-202': [45, 70] }, horaSolar: 8, texto: 'A las 8 h de junio STR-202 pierde ≈ 60 % y el campo B ≈ 30 %; a mediodía no se nota.' },
  };


  // ------------------------------------------------------------------------------------------------------------------------------------------
  // FIRMA DE DIAGNÓSTICO de cada avería: cómo se localiza SOLO con los instrumentos (multímetro, pinza, megóhmetro, trazador I-V y cámara termográfica),
  // siguiendo las comprobaciones de la puesta en marcha de IEC 62446-1. Todo lo que dice se comprueba contra el modelo en tests/averias_diagnostico.test.js.
  //   escenario: condiciones en las que la avería se manifiesta (lo que falta se toma de ESCENARIO_BASE).
  //   medidasClave[k]: { instrumento, puntos | conductor | tag, modo ('tension'|'resistencia', multímetro), campo (trazador y termografía), referencia (la lectura es
  //     la diferencia con esta otra medida: comparar con un igual), preparar (maniobras previas), esperadoSano / esperadoAveria: { min, max, unidad }, texto }.
  //     «Sano» es la planta sin la avería en el MISMO escenario (misma hora, mismas sombras y cargas). Infinity = «OL» del óhmetro.
  const ESCENARIO_BASE = { diaAnio: 172, horaSolar: 11, nubosidad: 0, socInicialPct: 30, esperaS: 120 };
  const r = (min, max, unidad) => ({ min, max, unidad });
  const OL = unidad => ({ min: 1e6, max: Infinity, unidad: unidad || 'Ω' });
  const V = (puntos, sano, averia, texto, extra) => Object.assign({ instrumento: 'multimetro', modo: 'tension', puntos, esperadoSano: sano, esperadoAveria: averia, texto }, extra || {});
  const OHM = (puntos, sano, averia, texto, extra) => Object.assign({ instrumento: 'multimetro', modo: 'resistencia', puntos, esperadoSano: sano, esperadoAveria: averia, texto }, extra || {});
  const A = (conductor, sano, averia, texto, extra) => Object.assign({ instrumento: 'pinza', conductor, esperadoSano: sano, esperadoAveria: averia, texto }, extra || {});
  const MOHM = (tag, sano, averia, texto, extra) => Object.assign({ instrumento: 'megohmetro', tag, esperadoSano: sano, esperadoAveria: averia, texto }, extra || {});
  const IV = (tag, campo, sano, averia, texto) => ({ instrumento: 'trazadorIV', tag, campo, esperadoSano: sano, esperadoAveria: averia, texto });
  const TERMO = (tag, sano, averia, texto, campo) => ({ instrumento: 'termografia', tag, campo: campo || 'deltaC', esperadoSano: sano, esperadoAveria: averia, texto });
  const abrir = tag => [{ orden: 'abrir', tag }];

  const FIRMAS = {
    CADENA_ABIERTA_A1: {
      sintoma: 'El campo A produce más o menos la mitad de lo que debería con este sol. No hay ninguna alarma ni ningún testigo encendido.',
      medidasClave: [
        A('STR-101.+', r(4, 12, 'A'), r(-0.05, 0.05, 'A'), 'Pinza en el cable positivo de STR-101: no pasa corriente, mientras que por STR-102 pasan varios amperios.'),
        V(['STR-101.+', 'F-101.1'], r(-1, 1, 'V'), r(5, 70, 'V'), 'Entre el extremo de la cadena en la cubierta y la entrada de su fusible debería haber 0 V (es el mismo cable): si hay tensión, el cable está interrumpido entre los dos puntos.'),
        V(['F-101.1', 'F-101.2'], r(-0.5, 0.5, 'V'), r(-0.5, 0.5, 'V'), 'En bornes del fusible F-101 hay 0 V: el fusible está bien (descarta el fusible fundido).'),
        IV('STR-101', 'isc', r(4, 12, 'A'), r(0, 0.01, 'A'), 'El trazador conectado a la llegada de STR-101 a la caja no ve curva: ni tensión ni corriente.'),
      ],
      pistas: ['Compara lo que producen las dos cadenas del campo A: una de las dos no aporta nada.', 'El problema está en la cadena STR-101, entre los paneles de la cubierta y la caja de continua CB-101.',
        'Con la pinza verás 0 A en STR-101. Mide con el multímetro entre STR-101.+ (en la cubierta) y F-101.1 (en la caja): hay tensión donde debería haber 0 V.'],
      explicacion: 'Un conector MC4 del cable de bajada de STR-101 está sin enchufar: los paneles tienen su tensión en vacío, pero el circuito está abierto y no puede circular corriente. El fusible está bien. Se repara enchufando el conector hasta oír el clic (con el seccionador QS-101 abierto: nunca se abre ni se cierra un MC4 con carga).',
      distractores: ['FUSIBLE_F101', 'SUCIEDAD_ALTA_A', 'DIODO_BYPASS_PV104'] },
    CADENA_ABIERTA_B1: {
      sintoma: 'El campo B produce la mitad y el ZCS avisa de que una entrada MPPT no tiene tensión.',
      medidasClave: [
        V(['INV-201.mppt1+', 'INV-201.mppt1-'], r(90, 170, 'V'), r(-1, 1, 'V'), 'En la entrada MPPT1 del ZCS no hay tensión, y en la MPPT2 sí.'),
        V(['STR-201.+', 'QS-201.1'], r(-1, 1, 'V'), r(90, 170, 'V'), 'Entre el extremo de la cadena en la cubierta y la entrada del seccionador aparece toda la tensión de la cadena: el cable está cortado entre los dos puntos.'),
        A('STR-201.+', r(6, 14, 'A'), r(-0.05, 0.05, 'A'), 'Pinza en el cable de STR-201: 0 A.'),
        MOHM('STR-201.+', r(15, 200, 'MΩ'), r(15, 200, 'MΩ'), 'El aislamiento de STR-201 es correcto: no es una fuga a tierra.', { preparar: abrir('QS-201') }),
      ],
      pistas: ['El inversor ZCS dice qué entrada se ha quedado sin tensión.', 'La cadena STR-201 (entrada MPPT1) no llega al inversor: sigue su cable desde la cubierta hasta el seccionador QS-201.',
        'Mide tensión en INV-201.mppt1+ / mppt1- (0 V) y luego entre STR-201.+ y QS-201.1: ahí está toda la tensión de la cadena.'],
      explicacion: 'El cable de bajada de STR-201 está cortado: los paneles dan su tensión en vacío en la cubierta, pero no llega al seccionador ni al MPPT1. Se repara sustituyendo el tramo dañado (o rehaciendo el empalme con conectores MC4 bien crimpados), con QS-201 abierto.',
      distractores: ['FALLO_AISLAMIENTO_B', 'SOMBRA_PARAPETO', 'CONECTOR_RESISTIVO_B2'] },
    FUSIBLE_F101: {
      sintoma: 'El campo A produce la mitad y en la caja de continua CB-101 hay un aviso de fusible.',
      medidasClave: [
        V(['F-101.1', 'F-101.2'], r(-0.5, 0.5, 'V'), r(5, 70, 'V'), 'Un fusible sano en servicio tiene 0 V entre sus bornes; si hay tensión, está abierto.'),
        OHM(['F-101.1', 'F-101.2'], r(0, 1, 'Ω'), OL(), 'Con QS-101 abierto (sin carga), el óhmetro marca «OL» en el fusible fundido y casi 0 Ω en el sano.', { preparar: abrir('QS-101') }),
        A('STR-101.+', r(4, 12, 'A'), r(-0.05, 0.05, 'A'), 'Pinza en STR-101: 0 A.'),
        IV('STR-101', 'desviacionPct', r(-5, 5, '%'), r(-5, 5, '%'), 'La curva I-V de STR-101, medida antes del fusible, es normal: los paneles y el cable están bien (descarta la cadena abierta).'),
        TERMO('F-101', r(3, 20, '°C'), r(-1, 1, '°C'), 'En la termografía F-101 está frío (no lleva corriente) y su vecino F-102 templado.'),
      ],
      pistas: ['Una de las dos cadenas del campo A no aporta corriente.', 'Mira en la caja de continua CB-101: las protecciones de la cadena STR-101.',
        'Mide tensión entre F-101.1 y F-101.2: en un fusible sano hay 0 V. Para medir su continuidad abre antes QS-101.'],
      explicacion: 'El fusible F-101 se ha fundido: la cadena STR-101 queda desconectada de la barra. Un fusible de cadena se funde por una sobrecorriente inversa (otra cadena alimentando un defecto) o por envejecimiento. Antes de cambiarlo por otro gPV del mismo calibre hay que comprobar la cadena (curva I-V y aislamiento) y abrir QS-101.',
      distractores: ['CADENA_ABIERTA_A1', 'SUCIEDAD_ALTA_A', 'DIODO_BYPASS_PV104'] },
    DIODO_BYPASS_PV104: {
      sintoma: 'El campo A rinde un poco menos de lo esperado (≈ 5–10 %). Sin alarmas.',
      medidasClave: [
        IV('STR-102', 'desviacionVocPct', r(-2.5, 2.5, '%'), r(-15, -8, '%'), 'La Voc de STR-102 es un 11 % menor que la esperada (falta un tercio de un panel de tres) y la Isc es normal.'),
        V(['PV-104.+', 'PV-104.-'], r(-1.5, 1.5, 'V'), r(-16, -5, 'V'), 'PV-104 da unos 9–12 V menos que su vecino PV-105 (dos tercios de su tensión).', { referencia: ['PV-105.+', 'PV-105.-'] }),
        TERMO('PV-104.s1', r(-2, 2, '°C'), r(3, 15, '°C'), 'Un tercio de PV-104 se ve más caliente que el resto: la subcadena en cortocircuito no entrega potencia.'),
        A('STR-102.+', r(-0.5, 0.5, 'A'), r(-3, -0.3, 'A'), 'STR-102 lleva alrededor de 1 A menos que STR-101: están en paralelo, trabajan a la misma tensión y a STR-102, que tiene menos tensión, le queda lejos su punto óptimo.', { referencia: 'STR-101.+' }),
      ],
      pistas: ['Las dos cadenas del campo A deberían comportarse igual: compara sus tensiones.', 'A la cadena STR-102 le falta tensión: mide panel por panel.',
        'Mide la tensión de PV-104 (PV-104.+ / PV-104.-) y compárala con PV-105 y PV-106, o mira PV-104 con la cámara termográfica.'],
      explicacion: 'Un diodo de paso de PV-104 se ha quedado en cortocircuito (suele pasar tras una sobretensión o por sobrecalentamiento con sombras): puentea permanentemente su subcadena, que deja de aportar tensión, y el panel da dos tercios. Se sustituye el diodo de la caja de conexiones o el panel.',
      distractores: ['SUCIEDAD_ALTA_A', 'CADENA_ABIERTA_A1', 'FUSIBLE_F101'] },
    DIODO_BYPASS_ABIERTO_PV203: {
      escenario: { sombras: { 'PV-203': 0.3 }, esperaS: 700 },
      sintoma: 'Hay una sombra pequeña sobre el panel PV-203 (hojas, un objeto) y la cadena STR-201 pierde mucha más potencia de la que corresponde a una sombra tan pequeña.',
      medidasClave: [
        TERMO('PV-203.s1', r(-30, 3, '°C'), r(15, 80, '°C'), 'La subcadena sombreada de PV-203 está mucho más caliente que el resto del campo (punto caliente): con el diodo sano estaría más fría.'),
        IV('STR-201', 'escalones', r(1, 3, ''), r(0, 0, ''), 'Con el diodo sano la sombra deja un escalón en la curva; aquí no hay escalón: la curva entera se hunde.'),
        V(['PV-203.+', 'PV-203.-'], r(10, 32, 'V'), r(-80, 5, 'V'), 'Con la cadena en carga, el panel sombreado con el diodo sano da unos dos tercios de su tensión; aquí su tensión es NEGATIVA: las células sombreadas están en inversa, consumiendo.'),
        IV('STR-201', 'desviacionPct', r(-45, -5, '%'), r(-100, -50, '%'), 'La potencia máxima cae más del 50 % (con el diodo sano, en torno a un 25 %).'),
      ],
      pistas: ['Una sombra pequeña no debería tirar toda una cadena: para eso están los diodos de paso.', 'Mira el panel sombreado de STR-201 (PV-203) con la cámara termográfica.',
        'Traza la curva I-V de STR-201: si el diodo de paso funcionara verías un escalón; y en la termografía PV-203.s1 es un punto caliente.'],
      explicacion: 'El diodo de paso de la subcadena sombreada de PV-203 está abierto: no puede desviar la corriente, así que las células sombreadas limitan la corriente de toda la cadena, trabajan en inversa y se calientan (punto caliente, puede quemar el panel). Sin sombra no se nota. Se sustituye el diodo de la caja de conexiones o el panel, y se retira la sombra.',
      distractores: ['SOMBRA_PARAPETO', 'CONECTOR_RESISTIVO_B2', 'CADENA_ABIERTA_B1'] },
    CONECTOR_RESISTIVO_B2: {
      sintoma: 'La entrada MPPT2 del ZCS da un 10 % menos de potencia que la MPPT1 con el mismo sol. Sin alarmas.',
      medidasClave: [
        TERMO('STR-202.mc4.2', r(-3, 3, '°C'), r(30, 300, '°C'), 'El conector MC4 entre PV-206 y PV-207 está decenas de grados más caliente que los demás.'),
        V(['PV-206.+', 'PV-207.-'], r(0, 0.3, 'V'), r(4, 30, 'V'), 'En carga, entre los dos lados de un conector sano hay centésimas de voltio; en este caen varios voltios (V = I·R).'),
        IV('STR-202', 'desviacionPct', r(-3, 3, '%'), r(-20, -6, '%'), 'La curva de STR-202 tiene Voc e Isc normales pero el codo caído (menos factor de forma): resistencia en serie.'),
        IV('STR-202', 'desviacionVocPct', r(-2.5, 2.5, '%'), r(-2.5, 2.5, '%'), 'La Voc es la esperada: no es un diodo de paso ni un panel que falte.'),
      ],
      pistas: ['Las dos cadenas del campo B son iguales y reciben el mismo sol: una rinde menos.', 'El problema está en el cableado de la cadena STR-202 en la cubierta, no en los paneles.',
        'Pasa la cámara termográfica por los conectores MC4 de STR-202, o mide la caída de tensión en cada conector con la cadena en carga (PV-206.+ / PV-207.-).'],
      explicacion: 'Un conector MC4 mal crimpado, sucio o de otra marca que su pareja tiene resistencia de contacto alta: disipa P = I²·R (más de 100 W con 1 Ω y 13 A), se calienta hasta poder arder y resta tensión a la cadena. Se corta y se monta un conector nuevo de la misma marca con la crimpadora adecuada, con QS-201 abierto.',
      distractores: ['SOMBRA_PARAPETO', 'DIODO_BYPASS_ABIERTO_PV203', 'CADENA_ABIERTA_B1'] },
    FALLO_AISLAMIENTO_B: {
      sintoma: 'Hay sol y tensión en el campo B, pero el ZCS no conecta: se queda en fallo con el LED de alarma y no inyecta nada.',
      medidasClave: [
        MOHM('STR-201.+', r(15, 200, 'MΩ'), r(0.01, 0.5, 'MΩ'), 'Megóhmetro (500 V) de STR-201 a tierra con QS-201 abierto: centésimas de MΩ en lugar de decenas (mínimo de la norma: 1 MΩ).', { preparar: abrir('QS-201') }),
        MOHM('STR-202.+', r(15, 200, 'MΩ'), r(15, 200, 'MΩ'), 'STR-202 da decenas de MΩ: la fuga está en STR-201.', { preparar: abrir('QS-201') }),
        V(['PV-203.+', 'TIERRA'], r(8, 80, 'V'), r(-1, 1, 'V'), 'En un campo sano y aislado ningún borne está a 0 V de tierra; aquí PV-203.+ sí: la fuga está en ese punto (entre PV-203 y PV-204).'),
        A('PE.QS-201', r(0, 0.0001, 'A'), r(0.0003, 0.01, 'A'), 'Por el conductor de protección del campo B circula una fuga de cerca de 1 mA (en sano, microamperios).'),
      ],
      pistas: ['Lee la alarma del ZCS: antes de conectar comprueba una cosa del campo de paneles.', 'Es un fallo de aislamiento del campo B: hay que saber cuál de las dos cadenas tiene la fuga a tierra.',
        'Abre QS-201 y mide con el megóhmetro STR-201.+ y STR-202.+ a tierra. Después, con el multímetro, busca el borne de panel que está a 0 V de TIERRA.'],
      explicacion: 'Un cable pelado o un panel con humedad deja pasar corriente a la estructura (tierra). El ZCS mide el aislamiento antes de conectar y, por debajo de 0,5 MΩ, no arranca: con un inversor sin transformador la fuga sería peligrosa. Se localiza midiendo cada cadena y cada tramo, y se repara el cable o se sustituye el panel.',
      distractores: ['CADENA_ABIERTA_B1', 'RED_CAIDA', 'SOBRETENSION_RED', 'DIFERENCIAL_DISPARADO'] },
    SPD_DISPARADO_A: {
      sintoma: 'Todo funciona con normalidad, pero el descargador de la caja CB-101 tiene el testigo en rojo.',
      medidasClave: [
        OHM(['SPD-101.11', 'SPD-101.12'], r(0, 1, 'Ω'), OL(), 'El contacto de señalización del descargador (bornes 11-12) está cerrado con el cartucho sano y abierto («OL») con el cartucho agotado.'),
        IV('STR-101', 'desviacionPct', r(-5, 5, '%'), r(-5, 5, '%'), 'La producción no cambia: el descargador agotado no afecta al funcionamiento, solo deja la instalación sin protección.'),
      ],
      pistas: ['No falla la producción: falta una protección.', 'Revisa los descargadores de sobretensiones: el de la caja de continua del campo A.',
        'Mide la continuidad del contacto de señalización SPD-101.11 / SPD-101.12: abierto = cartucho agotado.'],
      explicacion: 'El descargador ha derivado sobretensiones (rayos, maniobras) hasta agotar su varistor y su desconectador térmico lo ha separado: el testigo pasa a rojo y el contacto de señalización se abre. La planta sigue funcionando, pero la próxima sobretensión llegará al inversor. Se sustituye el cartucho enchufable.',
      distractores: ['COMUNICACION_PERDIDA_EASUN'] },
    QB_DISPARADO: {
      sintoma: 'El EASun está en fallo y no aprovecha el sol; las cargas protegidas solo se alimentan de la red.',
      medidasClave: [
        V(['QB-101.1', 'QB-101.2'], r(-0.5, 0.5, 'V'), r(20, 30, 'V'), 'Entre la entrada y la salida de un magnetotérmico cerrado hay 0 V; aquí está toda la tensión de la batería: está abierto.'),
        V(['INV-101.bat+', 'INV-101.bat-'], r(20, 30, 'V'), r(-0.5, 0.5, 'V'), 'A los bornes de batería del EASun no llega tensión.'),
        V(['BAT-101.+', 'BAT-101.-'], r(20, 30, 'V'), r(20, 30, 'V'), 'La batería tiene su tensión normal: no es la batería ni su BMS.'),
        A('BAT-101.cable+', r(2, 70, 'A'), r(-0.05, 0.05, 'A'), 'No circula corriente por los cables de la batería.'),
      ],
      pistas: ['El EASun necesita la batería para trabajar: lee su alarma.', 'Sigue el circuito de la batería: batería, portafusible FB-101, magnetotérmico QB-101 y bornes del inversor.',
        'Mide tensión a la entrada y a la salida de QB-101 (QB-101.1 y QB-101.2 respecto al negativo): hay 25 V antes y 0 V después.'],
      explicacion: 'El magnetotérmico de continua QB-101 ha disparado (sobrecorriente o cortocircuito en los cables de batería). Sin batería el EASun no puede regular y se bloquea. Hay que buscar la causa (apriete de bornes, cables, consumo excesivo) antes de rearmarlo.',
      distractores: ['BMS_CORTE_BATERIA', 'CELDA_DESEQUILIBRADA'] },
    BMS_CORTE_BATERIA: {
      escenario: { horaSolar: 23, socInicialPct: 70, modoEasun: 'BATERIA_PRIMERO', cargas: { 'LOAD-302': 500 }, esperaS: 120 },
      sintoma: 'De noche, con la batería cargada, el EASun no la usa: alimenta las cargas protegidas desde la red y avisa de batería baja.',
      medidasClave: [
        A('BAT-101.cable+', r(-60, -8, 'A'), r(-0.05, 30, 'A'), 'La batería debería estar descargándose (corriente negativa) para alimentar las cargas; no entrega nada (como mucho, se carga desde la red).'),
        A('QF-302.L', r(0, 0.4, 'A'), r(1.5, 10, 'A'), 'Las cargas protegidas están tirando de la red por la línea del EASun.'),
        V(['BAT-101.c3', 'BAT-101.c2'], r(-0.012, 0.012, 'V'), r(-0.012, 0.012, 'V'), 'Todas las celdas tienen la misma tensión (≈ 3,3 V): ninguna está baja. El corte del BMS es falso.', { referencia: ['BAT-101.c1', 'BAT-101.c0'] }),
        V(['QB-101.1', 'QB-101.2'], r(-0.5, 0.5, 'V'), r(-0.5, 0.5, 'V'), 'QB-101 está cerrado y la tensión llega al inversor: no es el magnetotérmico.'),
      ],
      pistas: ['La batería tiene carga y aun así no se usa: alguien le prohíbe descargarse.', 'Mira la batería y su BMS, no el inversor: ¿qué dice el BMS y qué tensión tienen de verdad las celdas?',
        'Con la pinza en BAT-101.cable+ no hay descarga. Mide las 8 celdas en las tomas BAT-101.c0…c8: todas están bien, luego el BMS corta sin motivo.'],
      explicacion: 'El BMS ha abierto la descarga por «tensión baja de celda», pero las celdas están bien: es una detección errónea (cable de medida de celda flojo, BMS averiado o descalibrado). La batería admite carga pero no entrega. Se revisan los cables de equilibrado y se recalibra o sustituye el BMS.',
      distractores: ['CELDA_DESEQUILIBRADA', 'QB_DISPARADO'] },
    CELDA_DESEQUILIBRADA: {
      sintoma: 'La batería parece tener menos capacidad de la que debería: el BMS corta la descarga con carga todavía (SoC intermedio) y corta la carga antes de llenarse.',
      medidasClave: [
        V(['BAT-101.c3', 'BAT-101.c2'], r(-0.012, 0.012, 'V'), r(-0.3, -0.02, 'V'), 'La celda 3 tiene decenas de milivoltios menos que las demás (en una batería sana no se diferencian más de unos milivoltios).', { referencia: ['BAT-101.c1', 'BAT-101.c0'] }),
        V(['BAT-101.+', 'BAT-101.-'], r(20, 30, 'V'), r(20, 30, 'V'), 'La tensión total de la batería es normal: midiendo solo el total no se ve el problema.'),
        V(['QB-101.1', 'QB-101.2'], r(-0.5, 0.5, 'V'), r(-0.5, 0.5, 'V'), 'QB-101 está cerrado: no es el magnetotérmico.'),
      ],
      pistas: ['La tensión total de la batería engaña: el BMS vigila celda a celda.', 'Mide las ocho celdas de la batería por las tomas de equilibrado.',
        'Mide cada celda entre BAT-101.c(k) y BAT-101.c(k-1): la celda 3 (c3–c2) está claramente más baja que las demás.'],
      explicacion: 'Una celda ha perdido capacidad o se ha descargado más que las otras: llega antes al mínimo en descarga y otra llega antes al máximo en carga, y el BMS corta por ellas aunque el conjunto tenga energía. Se corrige con una carga de equilibrado lenta o sustituyendo la celda.',
      distractores: ['BMS_CORTE_BATERIA', 'QB_DISPARADO'] },
    VENTILACION_TAPADA: {
      escenario: { esperaS: 2400 },
      sintoma: 'Los inversores van cada vez más calientes y, con carga alta, pasan a potencia reducida.',
      medidasClave: [
        TERMO('CAS-001', r(0, 11, '°C'), r(14, 80, '°C'), 'El aire del interior de la caseta está muy por encima de la temperatura exterior.'),
        TERMO('CAS-001.rejilla', r(-2, 1, '°C'), r(-80, -10, '°C'), 'Por la rejilla de ventilación debería salir aire caliente: está fría, a la temperatura de fuera.'),
        V(['RED-301.L', 'N'], r(207, 252, 'V'), r(207, 252, 'V'), 'La red es normal: la reducción de potencia no es por tensión de red alta.'),
      ],
      pistas: ['No es una avería eléctrica: es de temperatura.', 'No mires solo los inversores: mira la caseta entera con la cámara termográfica.',
        'Compara con la cámara la temperatura del interior (CAS-001) con la exterior, y mira la rejilla (CAS-001.rejilla): está fría porque no sale aire.'],
      explicacion: 'Las rejillas de ventilación están tapadas (cajas, plásticos, suciedad): el calor que disipan los inversores y la batería no sale, la caseta se calienta y los inversores reducen potencia para protegerse. Se despejan las rejillas y se comprueba que el aire circula.',
      distractores: ['SOBRETENSION_RED', 'CONECTOR_RESISTIVO_B2'] },
    DIFERENCIAL_DISPARADO: {
      sintoma: 'El consumo del centro (LOAD-301) y la toma de la caseta se quedan sin tensión y el ZCS se desconecta. Las cargas protegidas siguen con el EASun.',
      medidasClave: [
        V(['ID-301.1', 'N'], r(207, 252, 'V'), r(207, 252, 'V'), 'A la entrada del diferencial hay tensión de red: la red y QF-301 están bien.'),
        V(['ID-301.2', 'N'], r(207, 252, 'V'), r(0, 1, 'V'), 'A la salida del diferencial no hay tensión: está abierto.'),
        OHM(['ID-301.1', 'ID-301.2'], r(0, 1, 'Ω'), OL(), 'Con QF-301 abierto (sin tensión), el óhmetro confirma que el diferencial no tiene continuidad.', { preparar: abrir('QF-301') }),
      ],
      pistas: ['Parte del cuadro de alterna se ha quedado sin tensión, pero la red está presente.', 'Sigue la tensión por el cuadro QA-301 desde la acometida: QF-301, ID-301 y las salidas.',
        'Mide ID-301.1 y ID-301.2 respecto a N: 230 V a la entrada y 0 V a la salida.'],
      explicacion: 'El diferencial de 30 mA ha saltado por una corriente de fuga a tierra (un receptor con defecto, humedad). Aguas abajo no queda tensión y el ZCS se desconecta por anti-isla. Antes de rearmar hay que buscar la fuga (medir el aislamiento de los circuitos); si vuelve a saltar, se van conectando los circuitos de uno en uno.',
      distractores: ['RED_CAIDA', 'SOBRETENSION_RED', 'FALLO_AISLAMIENTO_B'] },
    RED_CAIDA: {
      sintoma: 'El consumo del centro se queda sin tensión y el ZCS se desconecta con los LED Off-Grid y Alarma. El EASun mantiene las cargas protegidas con sol y batería.',
      medidasClave: [
        V(['RED-301.L', 'N'], r(207, 252, 'V'), r(0, 1, 'V'), 'En la acometida no hay tensión: el fallo es de la red, no de la instalación.'),
        V(['INV-101.salida.L', 'N'], r(207, 252, 'V'), r(207, 252, 'V'), 'El EASun sigue dando 230 V a las cargas protegidas (trabaja en isla con la batería).'),
        A('QF-303.L', r(3, 14, 'A'), r(0, 0.05, 'A'), 'El ZCS no inyecta: sin red se desconecta en menos de un segundo (protección anti-isla).'),
      ],
      pistas: ['¿Quién sigue con tensión y quién no? Eso dice de dónde falta la alimentación.', 'Empieza por el principio del cuadro de alterna: la acometida RED-301.',
        'Mide RED-301.L respecto a N: 0 V. Los interruptores están todos cerrados: falta la red.'],
      explicacion: 'Se ha ido la red de distribución. El ZCS, conectado a red, debe desconectarse (anti-isla) para no dar tensión a una línea en la que puede haber alguien trabajando. El EASun, que tiene batería, sigue alimentando su salida. No hay nada que reparar en la instalación: al volver la red el ZCS reconecta solo tras su espera.',
      distractores: ['DIFERENCIAL_DISPARADO', 'SOBRETENSION_RED', 'FALLO_AISLAMIENTO_B'] },
    SOBRETENSION_RED: {
      sintoma: 'Hay sol y hay red, pero el ZCS se desconecta o no llega a conectar. El resto funciona.',
      medidasClave: [
        V(['RED-301.L', 'N'], r(207, 252, 'V'), r(252.5, 300, 'V'), 'La tensión de red está en 253 V: por encima del +10 % de 230 V.'),
        A('QF-303.L', r(3, 14, 'A'), r(0, 0.05, 'A'), 'El ZCS no inyecta corriente.'),
        V(['ID-301.2', 'N'], r(207, 252, 'V'), r(252.5, 300, 'V'), 'En el cuadro hay tensión (alta): no ha saltado ninguna protección.'),
      ],
      pistas: ['El ZCS vigila la red antes de inyectar: lee su alarma.', 'Mide la red en el cuadro de alterna con cuidado: no basta con ver que «hay tensión».',
        'Mide RED-301.L respecto a N: 253 V. El límite del inversor es 230 V + 10 %.'],
      explicacion: 'La tensión de la red está en el límite alto (línea larga, transformador con la toma alta o mucha generación cerca). El inversor está obligado a reducir y a desconectarse a 253 V. No se arregla en la instalación: se avisa a la distribuidora y, mientras tanto, se revisa la sección de la línea del inversor para no añadir más subida.',
      distractores: ['RED_CAIDA', 'DIFERENCIAL_DISPARADO', 'FALLO_AISLAMIENTO_B', 'VENTILACION_TAPADA'] },
    COMUNICACION_PERDIDA_EASUN: {
      sintoma: 'El EASun funciona con normalidad, pero sus lecturas remotas (aplicación, monitorización) han dejado de actualizarse.',
      medidasClave: [
        V(['COM-101.A', 'COM-101.B'], r(1.5, 3.5, 'V'), r(-0.3, 0.3, 'V'), 'Entre las líneas A y B del RS485 debería haber unos 2 V con el bus activo; hay 0 V: el módulo no transmite.'),
        V(['COM-101.5V', 'COM-101.GND'], r(4.7, 5.3, 'V'), r(4.7, 5.3, 'V'), 'Al módulo le llega su alimentación de 5 V desde el inversor: el fallo es del propio módulo, no del inversor.'),
        IV('STR-101', 'desviacionPct', r(-5, 5, '%'), r(-5, 5, '%'), 'La parte de potencia está bien: la producción es la esperada.'),
      ],
      pistas: ['La instalación produce bien: lo que falla es que no se ve desde fuera.', 'Mira el módulo de comunicaciones COM-101 enchufado al EASun.',
        'Mide la alimentación del módulo (COM-101.5V / GND: 5 V) y el par RS485 (COM-101.A / B): sin actividad, 0 V.'],
      explicacion: 'El módulo Wi-Fi/RS485 ha dejado de comunicar (avería del módulo, conector flojo o configuración perdida). El inversor no depende de él para funcionar, pero se pierde la monitorización y las alarmas a distancia. Se reenchufa, se reconfigura o se sustituye.',
      distractores: ['SPD_DISPARADO_A'] },
    SUCIEDAD_ALTA_A: {
      sintoma: 'El campo A produce bastante menos (≈ 30 %) de lo que corresponde al sol que hay; el campo B va bien. Sin alarmas.',
      medidasClave: [
        IV('STR-101', 'desviacionIscPct', r(-4, 4, '%'), r(-38, -22, '%'), 'La Isc de STR-101 es un 30 % menor que la esperada con esta irradiancia…'),
        IV('STR-102', 'desviacionIscPct', r(-4, 4, '%'), r(-38, -22, '%'), '… y la de STR-102 también: afecta por igual a todo el campo.'),
        IV('STR-101', 'desviacionVocPct', r(-2.5, 2.5, '%'), r(-2.5, 4, '%'), 'La Voc es prácticamente la esperada y la curva no tiene escalones: llega menos luz a todas las células.'),
        A('STR-101.+', r(-0.7, 0.7, 'A'), r(-0.7, 0.7, 'A'), 'Las dos cadenas llevan la misma corriente (baja): no es una cadena averiada.', { referencia: 'STR-102.+' }),
      ],
      pistas: ['Compara lo que produce cada campo con lo que debería producir con este sol.', 'Afecta a todo el campo A por igual, a las dos cadenas: no busques un panel ni un cable.',
        'Traza la curva I-V de STR-101 y de STR-102: corriente un 30 % por debajo de la esperada, tensión normal y sin escalones. Y mira los paneles.'],
      explicacion: 'Los paneles del campo A, casi horizontales, acumulan polvo y excrementos que la lluvia no arrastra: llega menos luz a las células y la corriente baja en proporción. No hay nada roto. Se limpian con agua sin cal y cepillo suave, a primera hora (nunca con el panel caliente).',
      distractores: ['CADENA_ABIERTA_A1', 'FUSIBLE_F101', 'DIODO_BYPASS_PV104'] },
    SOMBRA_PARAPETO: {
      escenario: { horaSolar: 8, esperaS: 700 },
      sintoma: 'A primera y a última hora la entrada MPPT2 del ZCS produce mucho menos que la MPPT1; a mediodía las dos van iguales.',
      medidasClave: [
        IV('STR-202', 'escalones', r(0, 0, ''), r(1, 4, ''), 'La curva I-V de STR-202 tiene escalones: hay subcadenas que reciben menos luz y sus diodos de paso conducen.'),
        IV('STR-202', 'desviacionPct', r(-4, 4, '%'), r(-90, -15, '%'), 'La potencia máxima de STR-202 queda muy por debajo de la esperada; la de STR-201 no.'),
        TERMO('PV-205.s1', r(-2, 2, '°C'), r(-40, -1.5, '°C'), 'La parte baja de PV-205 (y de PV-206) está más fría que el resto: está en sombra.'),
        MOHM('STR-202.+', r(15, 200, 'MΩ'), r(15, 200, 'MΩ'), 'El aislamiento es correcto y los conectores no se calientan: la cadena no tiene ninguna avería eléctrica.', { preparar: abrir('QS-201') }),
      ],
      pistas: ['Fíjate en la hora: ¿falla todo el día o solo con el sol bajo?', 'Mira la fila delantera del campo B (PV-205 y PV-206), la más cercana al pretil.',
        'Traza la curva I-V de STR-202 con el sol bajo: aparecen escalones (diodos de paso trabajando). En la termografía, la parte baja de PV-205 y PV-206 está fría.'],
      explicacion: 'Con el sol bajo, el pretil de la cubierta da sombra a la parte inferior de los dos paneles delanteros. Sus subcadenas sombreadas se puentean con los diodos de paso (escalones en la curva) y el MPPT puede quedarse en un máximo local. No hay nada averiado: se resuelve retirando el obstáculo, separando la fila del pretil o elevándola.',
      distractores: ['DIODO_BYPASS_ABIERTO_PV203', 'CONECTOR_RESISTIVO_B2', 'CADENA_ABIERTA_B1'] },
  };

  /** Hace la medida clave `m` con las funciones reales de la simulación → { ok, valor, texto }. Con opciones.maniobrar aplica antes `m.preparar` y lo deshace después. */
  function leerMedida(sim, m, opciones = {}) {
    const cerrar = [];
    if (opciones.maniobrar) for (const p of m.preparar || []) if (p.orden === 'abrir' && sim.estado.protecciones[p.tag] && sim.estado.protecciones[p.tag].estado === 'CERRADO') { sim.ordenes.protecciones.abrir(p.tag); cerrar.push(p.tag); }
    const una = ref => {
      if (m.instrumento === 'multimetro') {
        const p = ref || m.puntos;
        if (m.modo === 'resistencia') { const x = sim.resistencia(p[0], p[1]); return { ok: x.ok, valor: x.ok ? x.ohm : NaN, texto: x.texto }; }
        const x = sim.medir(p[0], p[1]); return { ok: x.ok && x.tipo !== 'sin_referencia', valor: x.valor, texto: x.texto };
      }
      if (m.instrumento === 'pinza') { const x = sim.corriente(ref || m.conductor); return { ok: x.ok, valor: x.valor, texto: x.texto }; }
      if (m.instrumento === 'megohmetro') { const x = sim.aislamiento(ref || m.tag); return { ok: x.ok, valor: x.ok ? x.mohm : NaN, texto: x.texto }; }
      if (m.instrumento === 'trazadorIV') { const x = sim.resumenIV(ref || m.tag); return { ok: !!x.ok, valor: x.ok ? Number(x[m.campo || 'desviacionPct']) : NaN, texto: x.texto }; }
      if (m.instrumento === 'termografia') {
        const e = sim.termografia().elementos.find(q => q.tag === (ref || m.tag));
        return e ? { ok: true, valor: e[m.campo || 'deltaC'], texto: `${e.tempC.toFixed(1)} °C (${e.deltaC >= 0 ? '+' : ''}${e.deltaC.toFixed(1)} °C)${e.nota ? ' · ' + e.nota : ''}` } : { ok: false, valor: NaN, texto: 'Elemento desconocido' };
      }
      return { ok: false, valor: NaN, texto: 'Instrumento desconocido' };
    };
    let res = una(null);
    if (m.referencia && res.ok) { const b = una(m.referencia); res = { ok: b.ok, valor: res.valor - b.valor, texto: `${res.texto} frente a ${b.texto}` }; }
    for (const tag of cerrar) sim.ordenes.protecciones.cerrar(tag);
    return res;
  }
  /** ¿Está el valor dentro del rango { min, max }? (Infinity vale como «OL».) */
  const cumple = (valor, rango) => typeof valor === 'number' && !Number.isNaN(valor) && !!rango && valor >= rango.min && valor <= rango.max;
  /** Deja la simulación en las condiciones en las que la avería se manifiesta (hora, cielo, SoC, modo, cargas, sombras). No activa la avería ni avanza el tiempo. */
  function prepararEscenario(sim, firma) {
    const e = Object.assign({}, ESCENARIO_BASE, (firma && firma.escenario) || {});
    sim.ordenes.reloj.poner({ diaAnio: e.diaAnio, horaSolar: e.horaSolar });
    sim.ordenes.ambiente.poner({ nubosidad: e.nubosidad });
    sim.ordenes.bateria.socInicial(e.socInicialPct);
    if (e.modoEasun) sim.ordenes.inversor.modoEasun(e.modoEasun);
    for (const [tag, w] of Object.entries(e.cargas || {})) sim.ordenes.cargas.poner(tag, w);
    for (const [tag, v] of Object.entries(e.sombras || {})) sim.ordenes.ambiente.sombra(tag, v);
    return e;
  }

  const CATALOGO = layout.AVERIAS.map(a => {
    const e = Object.assign({ id: a.id, titulo: a.titulo, tag: a.tag, dificultad: 2, descripcion: a.titulo, sintomas: [], alarmas: [], diagnostico: [], solucion: { texto: '', accion: 'reparar', tag: a.tag }, parametros: {}, efecto: EFECTOS[a.id] || null }, EXTRA[a.id] || {});
    const f = FIRMAS[a.id] || { sintoma: e.sintomas[0] || a.titulo, medidasClave: [], pistas: [], explicacion: e.descripcion, distractores: [] };
    e.firma = { sintoma: f.sintoma, escenario: Object.assign({}, ESCENARIO_BASE, f.escenario || {}), medidasClave: f.medidasClave, pistas: f.pistas, explicacion: f.explicacion, distractores: f.distractores };
    e.diagnostico = Object.assign(e.diagnostico.slice(), e.firma);         // la lista de textos de antes, con la firma colgada
    return e;
  });
  const porId = id => CATALOGO.find(a => a.id === id) || null;

  const api = { CATALOGO, porId, ESCENARIO_BASE, leerMedida, cumple, prepararEscenario };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { const P = (window.PCT = window.PCT || {}); (P.fv = P.fv || {}).catalogoAverias = api; }
})();
