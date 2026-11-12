// Catálogo de averías (las 18 de AVERIAS de layout.js, mismos ids y tags) con lo que necesita el profesor y el alumno:
// descripción, síntomas esperados en el sinóptico, alarmas que deben aparecer, forma de diagnosticarla y reparación.
// Los EFECTOS no están aquí: los produce la física del modelo leyendo qué averías hay activas (ver simulacion.js, cadena.js, bateria.js e inversores).
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

  const CATALOGO = layout.AVERIAS.map(a => Object.assign({ id: a.id, titulo: a.titulo, tag: a.tag, dificultad: 2, descripcion: a.titulo, sintomas: [], alarmas: [], diagnostico: [], solucion: { texto: '', accion: 'reparar', tag: a.tag }, parametros: {}, efecto: EFECTOS[a.id] || null }, EXTRA[a.id] || {}));
  const porId = id => CATALOGO.find(a => a.id === id) || null;

  const api = { CATALOGO, porId };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { const P = (window.PCT = window.PCT || {}); (P.fv = P.fv || {}).catalogoAverias = api; }
})();
