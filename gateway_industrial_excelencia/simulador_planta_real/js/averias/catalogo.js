// Catálogo de las 16 averías electrónicas de la planta HTST (esquema de ARQUITECTURA.md §6.1). Solo datos: el efecto físico lo aplica motor.js.
// Cada avería dice qué equipos toca, qué se ve en el SCADA y en el 3D, cómo se diagnostica con el multímetro/osciloscopio y cómo se resuelve.
// Los puntos de medida (p. ej. 'F-001:SALIDA') están definidos en js/modelo/medidas.js.
(function () {
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.htstLayout;
  const TAGS_TT = ['TT-101', 'TT-102', 'TT-103', 'TT-104', 'TT-201'];
  const TAGS_AI = layout.SENALES.filter(s => s.tipo === 'AI').map(s => s.tag);

  const opcion = (opciones, defecto, descripcion) => ({ tipo: 'opcion', opciones, defecto, descripcion });
  const numero = (min, max, defecto, unidad, descripcion) => ({ tipo: 'numero', min, max, defecto, unidad, descripcion });
  const paso = (n, instrumento, punto, esperado, conAveria, modo) => ({ paso: n, instrumento, punto, modo, esperado, conAveria });

  const CATALOGO = [
    { id: 'AV-LAZO-ABIERTO', nombre: 'Lazo 4-20 mA abierto (cable roto o bornas flojas)', capa: 'lazo', equipos: ['TT-103'], dificultad: 1,
      parametros: { tag: opcion(TAGS_AI, 'TT-103', 'Instrumento cuyo lazo se corta') },
      efectos: [{ gancho: 'instrumento', tag: '{tag}', modificacion: 'mA = 0, calidad ABIERTO' }],
      sintomasScada: ['Lectura a 0 mA con calidad ABIERTO y alarma A101', 'Si es TT-103 o FT-101, la FDV pasa a desvío y no se produce'],
      sintomas3d: [{ tag: '{tag}', efecto: 'cable_cortado' }, { tag: '{tag}', efecto: 'resaltar_rojo' }],
      diagnostico: [paso(1, 'multimetro', '{tag}:LAZO', '4-20 mA según la temperatura', '0 mA', 'mA'), paso(2, 'multimetro', '{tag}:+', 'unos 19 V en las bornas del transmisor', '0 V en las bornas (no le llega alimentación)', 'V'),
        paso(3, 'multimetro', 'QE-001:AI-{tag}', '24 V en la borna del PLC', '24 V en el PLC: el corte está en el cable', 'V')],
      solucion: { texto: 'Reconectar o sustituir el cable cortado y apretar las bornas.', accion: 'reparar', tag: null },
      alarmasEsperadas: ['A101'], pistas: ['¿Qué corriente circula por el lazo?', '¿Llega alimentación al transmisor?', 'Compara la tensión en el PLC con la de las bornas del transmisor.'] },

    { id: 'AV-PT100-ABIERTA', nombre: 'Pt100 abierta (burnout alto)', capa: 'sensor', equipos: ['TT-103'], dificultad: 1,
      parametros: { tag: opcion(TAGS_TT, 'TT-103', 'Sonda que se abre') },
      efectos: [{ gancho: 'instrumento', tag: '{tag}', modificacion: 'mA = 21,5 (burnout alto), calidad CORTO' }],
      sintomasScada: ['Lectura a fondo de escala (más de 21 mA) y alarma A102'],
      sintomas3d: [{ tag: '{tag}', efecto: 'resaltar_rojo' }],
      diagnostico: [paso(1, 'multimetro', '{tag}:LAZO', '4-20 mA según la temperatura', 'Más de 21 mA', 'mA'), paso(2, 'multimetro', '{tag}:PT100', 'Unos 100 Ω a 0 °C (110 Ω a 25 °C)', 'Infinito (circuito abierto)', 'ohm')],
      solucion: { texto: 'Sustituir la sonda Pt100.', accion: 'sustituir', tag: null },
      alarmasEsperadas: ['A102'], pistas: ['El transmisor indica burnout hacia arriba.', 'Desconecta la sonda y mide su resistencia.'] },

    { id: 'AV-PT100-CORTO', nombre: 'Pt100 en cortocircuito', capa: 'sensor', equipos: ['TT-103'], dificultad: 1,
      parametros: { tag: opcion(TAGS_TT, 'TT-103', 'Sonda que se pone en corto') },
      efectos: [{ gancho: 'instrumento', tag: '{tag}', modificacion: 'mA = 3,55 (lectura mínima), calidad CORTO' }],
      sintomasScada: ['Lectura muy baja (≈ 3,6 mA) y alarma A102 por sonda en corto'],
      sintomas3d: [{ tag: '{tag}', efecto: 'resaltar_rojo' }],
      diagnostico: [paso(1, 'multimetro', '{tag}:LAZO', '4-20 mA según la temperatura', 'Unos 3,5 mA, por debajo del mínimo', 'mA'), paso(2, 'multimetro', '{tag}:PT100', 'Unos 100 Ω a 0 °C', '0 Ω (cortocircuito)', 'ohm')],
      solucion: { texto: 'Sustituir la sonda Pt100.', accion: 'sustituir', tag: null },
      alarmasEsperadas: ['A102'], pistas: ['El valor es imposible: temperatura muy por debajo de lo real.', 'Mide la resistencia de la sonda.'] },

    { id: 'AV-DERIVA-TT103', nombre: 'Deriva de calibración de TT-103 (termómetro legal)', capa: 'sensor', equipos: ['TT-103'], dificultad: 3,
      parametros: { offsetC: numero(-6, 6, 3, '°C', 'Error de lectura (positivo = lee más de lo real)') },
      efectos: [{ gancho: 'instrumento', tag: 'TT-103', modificacion: 'valor leído = real + offset' }],
      sintomasScada: ['Sin alarma. Si lee de más, el producto sale sin pasteurizar y solo el balance de temperaturas lo delata'],
      sintomas3d: [],
      diagnostico: [paso(1, 'multimetro', 'TT-103:BANO', 'Temperatura real en baño patrón a 72,0 °C', 'El lazo da una lectura distinta de la del patrón', 'temperatura'), paso(2, 'multimetro', 'TT-103:LAZO', '4-20 mA correspondientes a la temperatura real', 'mA que no coincide con la del patrón', 'mA')],
      solucion: { texto: 'Recalibrar el transmisor o sustituirlo. Nunca se anula ni se compensa en el PLC.', accion: 'recalibrar', tag: null },
      alarmasEsperadas: [], pistas: ['No hay alarma: hay que comparar con un patrón.', 'Compara TT-102 y TT-104 con TT-103 (balance de temperaturas).', 'Mide en baño con un termómetro de referencia.'] },

    { id: 'AV-RUIDO-4-20', nombre: 'Ruido en el lazo 4-20 mA (interferencia del variador)', capa: 'lazo', equipos: ['FT-101'], dificultad: 2,
      parametros: { tag: opcion(TAGS_AI, 'FT-101', 'Lazo con interferencia'), amplitudMA: numero(1, 12, 8, 'mA', 'Amplitud del ruido') },
      efectos: [{ gancho: 'instrumento', tag: '{tag}', modificacion: 'mA += ruido de la frecuencia del variador, calidad RUIDO' }],
      sintomasScada: ['Lectura inestable y alarmas A102 intermitentes', 'La FDV puede conmutar de avance a desvío por saltos del caudal'],
      sintomas3d: [{ tag: '{tag}', efecto: 'resaltar_rojo' }],
      diagnostico: [paso(1, 'osciloscopio', '{tag}:LAZO', 'Línea casi recta a la corriente del proceso', 'Picos grandes a la frecuencia del variador', 'osciloscopio'), paso(2, 'multimetro', '{tag}:MALLA', 'Malla conectada a tierra por un extremo', 'Malla sin conectar o doble tierra', 'continuidad')],
      solucion: { texto: 'Usar cable apantallado, conectar la malla a tierra por un solo extremo y separar el cable de la potencia del variador.', accion: 'reparar', tag: null },
      alarmasEsperadas: ['A102'], pistas: ['Con el multímetro la media parece normal.', 'Usa el osciloscopio sobre el lazo.', 'Fíjate por dónde pasa el cable.'] },

    { id: 'AV-FUSIBLE-F201', nombre: 'Fusible F-001 de 24 V fundido', capa: 'alimentacion', equipos: ['F-001'], dificultad: 1,
      parametros: {},
      efectos: [{ gancho: 'alimentacion', tag: 'F-001', modificacion: 'se pierden los 24 V de instrumentos (lazos y entradas digitales a 0)' }],
      sintomasScada: ['Alarma A140 y todos los lazos a 0 mA a la vez', 'Paro de seguridad y FDV en desvío'],
      sintomas3d: [{ tag: 'F-001', efecto: 'led_apagado' }, { tag: 'F-001', efecto: 'resaltar_rojo' }],
      diagnostico: [paso(1, 'multimetro', 'F-001:ENTRADA', '24 V', '24 V (la fuente está bien)', 'V'), paso(2, 'multimetro', 'F-001:SALIDA', '24 V', '0 V (después del fusible no hay tensión)', 'V'),
        paso(3, 'multimetro', 'F-001:FUSIBLE', 'Continuidad (≈ 0 Ω)', 'Circuito abierto', 'continuidad')],
      solucion: { texto: 'Buscar la causa del cortocircuito en los lazos y sustituir el fusible por otro del mismo valor.', accion: 'sustituir', tag: 'F-001' },
      alarmasEsperadas: ['A140'], pistas: ['Todos los lazos fallan a la vez: el fallo es común.', 'Mide antes y después del fusible.'] },

    { id: 'AV-FUENTE-24V', nombre: 'Fuente de 24 V degradada (18 V con rizado)', capa: 'alimentacion', equipos: ['PS-001'], dificultad: 2,
      parametros: {},
      efectos: [{ gancho: 'alimentacion', tag: 'PS-001', modificacion: 'v24 = 18 V con rizado; los transmisores saturan' }],
      sintomasScada: ['Lazos saturados (más de 21 mA), alarma A140 y paro de seguridad'],
      sintomas3d: [{ tag: 'PS-001', efecto: 'led_apagado' }, { tag: 'PS-001', efecto: 'resaltar_rojo' }],
      diagnostico: [paso(1, 'multimetro', 'PS-001:SALIDA', '24 V CC', 'Unos 18 V', 'V'), paso(2, 'osciloscopio', 'PS-001:SALIDA', '24 V casi planos', 'Rizado grande sobre 18 V', 'osciloscopio')],
      solucion: { texto: 'Sustituir la fuente de alimentación.', accion: 'sustituir', tag: 'PS-001' },
      alarmasEsperadas: ['A140'], pistas: ['Mide la tensión de salida de la fuente.', 'Mira su forma de onda con el osciloscopio.'] },

    { id: 'AV-KM-PEGADO', nombre: 'Contactor del calentador con los contactos soldados', capa: 'potencia', equipos: ['KM-201'], dificultad: 2,
      parametros: { tag: opcion(['KM-201', 'KM-202'], 'KM-201', 'Contactor que se queda pegado') },
      efectos: [{ gancho: 'salida', tag: '{tag}', modificacion: 'la salida física queda a 1 con la orden a 0' }],
      sintomasScada: ['Alarma A130 (orden 0 y contacto auxiliar 1)', 'La temperatura del agua sube sin control y puede saltar TSH-201'],
      sintomas3d: [{ tag: '{tag}', efecto: 'contactos_cerrados' }, { tag: '{tag}', efecto: 'resaltar_rojo' }],
      diagnostico: [paso(1, 'multimetro', '{tag}:BOBINA', '0 V con la orden a 0', '0 V (el PLC no lo ordena)', 'V'), paso(2, 'multimetro', '{tag}:CARGA', '0 V con el contactor abierto', '400 V en la carga: el calentador sigue alimentado', 'V'),
        paso(3, 'multimetro', '{tag}:CONTACTOS', 'Circuito abierto sin orden', 'Cerrados (≈ 0 Ω)', 'ohm')],
      solucion: { texto: 'Cortar la alimentación, sustituir el contactor y revisar la causa (arco o sobrecorriente).', accion: 'sustituir', tag: null },
      alarmasEsperadas: ['A130'], pistas: ['¿Está el calentador alimentado aunque el PLC no lo pida?', 'Mide la tensión en la carga con la orden a 0.'] },

    { id: 'AV-KM-NO-CIERRA', nombre: 'Contactor que no cierra (contactos quemados o bobina sin fuerza)', capa: 'potencia', equipos: ['KM-203', 'KM-201', 'KM-202'], dificultad: 2,
      parametros: { tag: opcion(['KM-203', 'KM-201', 'KM-202'], 'KM-203', 'Contactor que no cierra') },
      efectos: [{ gancho: 'salida', tag: '{tag}', modificacion: 'la salida física queda a 0 con la orden a 1' }],
      sintomasScada: ['Alarma A130 (orden 1 y contacto auxiliar 0)', 'Con KM-203 la bomba P-201 se para y la temperatura no sube; con KM-201 o KM-202 un banco del calentador no conecta y el agua calienta más despacio'],
      sintomas3d: [{ tag: '{tag}', efecto: 'resaltar_rojo' }],
      diagnostico: [paso(1, 'multimetro', '{tag}:BOBINA', '24 V con la orden a 1', '24 V (la bobina recibe orden)', 'V'), paso(2, 'multimetro', '{tag}:CARGA', '400 V en la carga', '0 V en bornas de la carga', 'V'),
        paso(3, 'multimetro', '{tag}:BOBINA-R', 'Unos 650 Ω', 'Valor normal o abierta según el fallo', 'ohm')],
      solucion: { texto: 'Sustituir el contactor.', accion: 'sustituir', tag: null },
      alarmasEsperadas: ['A130'], pistas: ['El PLC ordena cerrar pero el auxiliar dice que no.', 'Mide la tensión en la bobina y en la carga.'] },

    { id: 'AV-BOBINA-ABIERTA', nombre: 'Bobina abierta del piloto SV-101', capa: 'actuador', equipos: ['SV-101'], dificultad: 2,
      parametros: {},
      efectos: [{ gancho: 'salida', tag: 'SV-101', modificacion: 'el piloto no se energiza nunca (bobina de resistencia infinita)' }],
      sintomasScada: ['Alarma A120: la FDV nunca llega a avance (ZS-101 = 0)', 'No hay producción: la FDV queda en desvío'],
      sintomas3d: [{ tag: 'SV-101', efecto: 'led_apagado' }, { tag: 'SV-101', efecto: 'resaltar_rojo' }],
      diagnostico: [paso(1, 'multimetro', 'SV-101:BORNAS', '24 V con la orden de avance', '24 V (el PLC lo manda)', 'V'), paso(2, 'multimetro', 'SV-101:BOBINA', 'Unos 220 Ω', 'Infinito (bobina abierta)', 'ohm')],
      solucion: { texto: 'Sustituir la bobina del piloto.', accion: 'sustituir', tag: 'SV-101' },
      alarmasEsperadas: ['A120'], pistas: ['El PLC da la orden y la FDV no se mueve.', '¿Llegan los 24 V al piloto?', 'Mide la resistencia de la bobina.'] },

    { id: 'AV-FDV-ATASCADA', nombre: 'FDV atascada en avance', capa: 'actuador', equipos: ['FDV-101'], dificultad: 3,
      parametros: {},
      efectos: [{ gancho: 'proceso', tag: 'FDV-101', modificacion: 'el vástago no sale de avance (ZS-102 nunca llega)' }],
      sintomasScada: ['Alarma A120: al pedir desvío, ZS-102 no llega', 'El PLC hace paro de seguridad y para P-101'],
      sintomas3d: [{ tag: 'FDV-101', efecto: 'resaltar_rojo' }],
      diagnostico: [paso(1, 'multimetro', 'FDV-101:ZS-102', 'Continuidad con la FDV en desvío', 'Sin continuidad aunque no hay tensión en el piloto', 'continuidad'), paso(2, 'multimetro', 'FRL-501:MANOMETRO', '6 bar de aire', 'Aire correcto: el fallo es mecánico', 'presion')],
      solucion: { texto: 'Desmontar y reparar la válvula (vástago, juntas y muelle).', accion: 'reparar', tag: 'FDV-101' },
      alarmasEsperadas: ['A120'], pistas: ['El piloto está sin tensión y la válvula no vuelve.', 'Comprueba el aire y la posición de los finales de carrera.'] },

    { id: 'AV-AIRE-BAJO', nombre: 'Presión de aire baja (fuga o regulador mal ajustado)', capa: 'neumatica', equipos: ['FRL-501'], dificultad: 1,
      parametros: { presionBar: numero(2, 4.4, 3.5, 'bar', 'Presión de aire disponible') },
      efectos: [{ gancho: 'proceso', tag: 'FRL-501', modificacion: 'presión de aire por debajo del mínimo (4,5 bar)' }],
      sintomasScada: ['Alarma A160 (PSL-501 = 0), FDV lenta y conmutación a desvío', 'No se puede pasar a avance'],
      sintomas3d: [{ tag: 'FRL-501', efecto: 'resaltar_rojo' }],
      diagnostico: [paso(1, 'multimetro', 'FRL-501:MANOMETRO', '6 bar', 'Menos de 4,5 bar', 'presion'), paso(2, 'multimetro', 'PSL-501:CONTACTO', 'Continuidad con el aire correcto', 'Sin continuidad (presostato abierto)', 'continuidad')],
      solucion: { texto: 'Localizar y reparar la fuga y ajustar el regulador a 6 bar.', accion: 'reparar', tag: 'FRL-501' },
      alarmasEsperadas: ['A160'], pistas: ['Mira el manómetro de la unidad de aire.', 'El presostato indica aire bajo.'] },

    { id: 'AV-VFD-SOBRETEMP', nombre: 'Variador sobrecalentado (ventilador parado o filtro sucio)', capa: 'potencia', equipos: ['VFD-101'], dificultad: 2,
      parametros: {},
      efectos: [{ gancho: 'proceso', tag: 'VFD-101', modificacion: 'el disipador sube hasta disparar a 80 °C' }],
      sintomasScada: ['A150 tras unos minutos; P-101 se para y el caudal cae a 0'],
      sintomas3d: [{ tag: 'VFD-101', efecto: 'resaltar_rojo' }],
      diagnostico: [paso(1, 'multimetro', 'VFD-101:DISIPADOR', 'Unos 50 °C en marcha', 'Más de 80 °C y subiendo', 'temperatura'), paso(2, 'multimetro', 'VFD-101:VENTILADOR', '24 V en el ventilador', '0 V: ventilador parado', 'V')],
      solucion: { texto: 'Limpiar el filtro y sustituir el ventilador del variador.', accion: 'limpiar', tag: 'VFD-101' },
      alarmasEsperadas: ['A150'], pistas: ['Toca el disipador (mide su temperatura).', '¿Gira el ventilador?'] },

    { id: 'AV-PLACA-FUGA', nombre: 'Placa perforada en la regeneración', capa: 'proceso', equipos: ['HX-101'], dificultad: 3,
      parametros: { fuga01: numero(0.1, 1, 0.9, '', 'Gravedad de la fuga (1 = diferencial invertido)') },
      efectos: [{ gancho: 'proceso', tag: 'HX-101', modificacion: 'el diferencial PT-102 - PT-101 baja hasta invertirse' }],
      sintomasScada: ['Alarma A110 (diferencial por debajo de 0,07 bar o invertido)', 'La FDV pasa a desvío: no se cumplen las condiciones'],
      sintomas3d: [{ tag: 'HX-101', efecto: 'goteo' }],
      diagnostico: [paso(1, 'multimetro', 'PT-101:LAZO', 'Presión del lado crudo', 'Presión crudo casi igual o mayor que la del pasteurizado', 'mA'), paso(2, 'multimetro', 'PT-102:LAZO', 'Presión del lado pasteurizado mayor que la del crudo', 'Diferencial bajo o invertido', 'mA')],
      solucion: { texto: 'Localizar la placa con prueba de presión y sustituirla junto con sus juntas.', accion: 'sustituir', tag: 'HX-101' },
      alarmasEsperadas: ['A110'], pistas: ['Compara las dos presiones de la regeneración.', 'El lado pasteurizado debe estar siempre por encima.'] },

    { id: 'AV-FILTRO-OBSTRUIDO', nombre: 'Colador de aspiración obstruido', capa: 'proceso', equipos: ['FLT-101'], dificultad: 1,
      parametros: { obstruccion01: numero(0.3, 0.95, 0.7, '', 'Grado de obstrucción') },
      efectos: [{ gancho: 'proceso', tag: 'FLT-101', modificacion: 'el caudal baja con la velocidad constante y baja la presión' }],
      sintomasScada: ['FT-101 y la presión del lado crudo caen con la misma velocidad del variador', 'P-101 trabaja con la corriente baja'],
      sintomas3d: [{ tag: 'FLT-101', efecto: 'resaltar_rojo' }],
      diagnostico: [paso(1, 'multimetro', 'FLT-101:PRESION-ANTES', 'Presión de aspiración normal', 'Presión alta antes del colador', 'presion'), paso(2, 'multimetro', 'FLT-101:PRESION-DESPUES', 'Casi igual que antes', 'Mucho menor que antes: pérdida de carga', 'presion')],
      solucion: { texto: 'Desmontar y limpiar el colador.', accion: 'limpiar', tag: 'FLT-101' },
      alarmasEsperadas: [], pistas: ['Con la misma velocidad hay menos caudal.', 'Mide la presión antes y después del colador.'] },

    { id: 'AV-TSH-DISPARADO', nombre: 'Termostato TSH-201 abierto (disparo real o falso contacto)', capa: 'sensor', equipos: ['TSH-201'], dificultad: 2,
      parametros: {},
      efectos: [{ gancho: 'proceso', tag: 'TSH-201', modificacion: 'el contacto NC queda abierto aunque el agua esté fría' }],
      sintomasScada: ['Alarma A170 y paro de seguridad: calentador fuera. Rearme manual'],
      sintomas3d: [{ tag: 'TSH-201', efecto: 'resaltar_rojo' }],
      diagnostico: [paso(1, 'multimetro', 'TSH-201:CONTACTO', 'Continuidad en frío (NC cerrado)', 'Circuito abierto aunque el agua está fría', 'continuidad'), paso(2, 'multimetro', 'TT-201:LAZO', 'mA de una temperatura normal', 'Temperatura del agua normal: no hay sobretemperatura real', 'mA')],
      solucion: { texto: 'Sustituir el termostato (no cierra en frío). Nunca se puentea.', accion: 'sustituir', tag: 'TSH-201' },
      alarmasEsperadas: ['A170'], pistas: ['¿Está el agua realmente caliente?', 'Comprueba la continuidad del contacto en frío.'] },
  ];

  // FIRMAS DE DIAGNÓSTICO (contrato v1, comun/CONTRATO.md §5.4): escenario donde se ve la avería, medidas clave con rangos numéricos de `medir`
  // (con la avería y sin ella, comprobados con el modelo: criterio C37), 3 pistas de menos a más concretas, explicación y averías que despistan.
  // Se cuelgan de cada avería como `firma`; el resto del catálogo no cambia. Rango: { min, max, unidad } con null = sin límite (OL cumple max:null).
  const r = (min, max, unidad) => ({ min, max, unidad });
  const mm = (magnitud, a) => ({ instrumento: 'multimetro', magnitud, a });
  const termometro = elemento => ({ instrumento: 'termometro', magnitud: 'temperatura', elemento });
  const manometro = elemento => ({ instrumento: 'manometro', magnitud: 'presion', elemento });
  const clave = (peticion, sano, averia, texto, extra) => Object.assign({ peticion }, extra || {}, { esperadoSano: sano, esperadoAveria: averia, texto });
  const guion = (tipo, destino, valores) => Object.assign({ tipo }, destino ? { destino } : {}, valores ? { valores } : {}, { origen: 'guion' });
  const llenar = () => [guion('nivelDeposito', 'TK-101', { pct: 100 }), guion('nivelDeposito', 'HW-201', { pct: 100 })];
  // Escenario 1: depósitos llenos y MARCHA; a los 15 min la planta sana está en producción con agua a unos 75 °C.
  const enMarcha = () => ({ simulador: 'planta_real', versionContrato: 1, id: 'htst_en_marcha', titulo: 'Planta en marcha con agua',
    condiciones: {}, ordenesIniciales: llenar().concat([guion('arrancar')]), esperaS: 900 });
  // Escenario 2: depósitos llenos y planta parada; todo el circuito está casi a la misma temperatura y el PLC no manda ninguna salida de potencia.
  const parada = () => ({ simulador: 'planta_real', versionContrato: 1, id: 'htst_parada', titulo: 'Planta parada con los depósitos llenos',
    condiciones: {}, ordenesIniciales: llenar(), esperaS: 60 });
  const firma = (escenario, sintoma, medidasClave, pistas, explicacion, distractores) => ({ sintoma, escenario, esperaS: escenario.esperaS, medidasClave, pistas, explicacion, distractores });

  const FIRMAS = {
    'AV-LAZO-ABIERTO': firma(enMarcha(), 'TT-103 marca 0 mA, salta A101 y la planta no pasa a producción.', [
      clave(mm('corriente', 'TT-103:LAZO'), r(12, 20.5, 'mA'), r(null, 0.5, 'mA'), 'En serie con el lazo de TT-103: 0 mA. No circula corriente.'),
      clave(mm('tension', 'TT-103:+'), r(12, 24, 'V'), r(null, 1, 'V'), 'En las bornas del transmisor: 0 V. No le llega alimentación.'),
      clave(mm('tension', 'QE-001:AI-TT-103'), r(22, 26, 'V'), r(22, 26, 'V'), 'En la entrada del PLC sí hay 24 V: la alimentación sale bien y el corte está en el cable.'),
    ],['Mira qué corriente circula por el lazo de TT-103.', '¿Llega tensión a las bornas del transmisor?', 'Compara la tensión en la entrada del PLC (QE-001:AI-TT-103) con la de las bornas del transmisor: si en el PLC hay 24 V, el corte está en el cable.'],
    'El cable del lazo 4-20 mA de TT-103 está cortado o una borna está floja. Sin corriente el PLC lee 0 mA, da A101 y no deja producir. Se repara reconectando el cable y apretando las bornas.',
    ['AV-PT100-CORTO', 'AV-FUSIBLE-F201']),

    'AV-PT100-ABIERTA': firma(enMarcha(), 'TT-103 marca fondo de escala (más de 21 mA) y salta A102.', [
      clave(mm('corriente', 'TT-103:LAZO'), r(12, 20.5, 'mA'), r(21, null, 'mA'), 'Lazo de TT-103: más de 21 mA. El transmisor avisa de sonda abierta (burnout alto).'),
      clave(mm('resistencia', 'TT-103:PT100'), r(110, 140, 'Ω'), r(1000, null, 'Ω'), 'Sonda desconectada: OL. La Pt100 está abierta.'),
    ], ['El valor es imposible: más de 20 mA.', 'El transmisor está bien alimentado; mira la sonda.', 'Desconecta la Pt100 de TT-103 y mide su resistencia: debería dar unos 100 Ω más 0,385 Ω por °C.'],
    'La Pt100 de TT-103 está abierta. El transmisor lo detecta y lleva el lazo a más de 21 mA (burnout alto) para que el PLC lo vea como fallo. Se sustituye la sonda.',
    ['AV-FUENTE-24V', 'AV-LAZO-ABIERTO']),

    'AV-PT100-CORTO': firma(enMarcha(), 'TT-103 marca menos de 4 mA y salta A102.', [
      clave(mm('corriente', 'TT-103:LAZO'), r(12, 20.5, 'mA'), r(null, 3.8, 'mA'), 'Lazo de TT-103: unos 3,5 mA, por debajo del mínimo.'),
      clave(mm('resistencia', 'TT-103:PT100'), r(110, 140, 'Ω'), r(null, 1, 'Ω'), 'Sonda desconectada: casi 0 Ω. La Pt100 está en corto.'),
    ], ['La temperatura que marca es imposible: muy por debajo de la real.', 'El lazo funciona: hay corriente, pero por debajo de 4 mA.', 'Desconecta la Pt100 de TT-103 y mide su resistencia.'],
    'La Pt100 de TT-103 está en cortocircuito. El transmisor lee una resistencia casi nula y baja el lazo por debajo de 4 mA. Se sustituye la sonda.',
    ['AV-LAZO-ABIERTO', 'AV-PT100-ABIERTA']),

    'AV-DERIVA-TT103': firma(parada(), 'Sin alarmas. Con la planta parada, TT-103 marca más que TT-102.', [
      clave(mm('corriente', 'TT-103:LAZO'), r(-0.3, 0.3, 'mA'), r(0.4, 1.5, 'mA'), 'Diferencia entre los lazos de TT-103 y TT-102 con la planta parada: casi medio mA, unos 3 °C.',
        { referencia: mm('corriente', 'TT-102:LAZO') }),
    ], ['No hay alarma: tienes que comparar con otra medida.', 'Con la planta parada, TT-102 y TT-103 están casi a la misma temperatura.', 'Mide la corriente de los lazos de TT-102 y TT-103 y compáralas. Confírmalo con TT-103 en baño patrón.'],
    'El transmisor de TT-103 se ha descalibrado y lee unos grados de más. Es grave: es el termómetro legal y el producto puede salir sin pasteurizar sin que salte ninguna alarma. Se recalibra o se sustituye; nunca se compensa en el PLC.',
    ['AV-PT100-CORTO', 'AV-RUIDO-4-20']),

    'AV-RUIDO-4-20': firma(enMarcha(), 'FT-101 da saltos y la FDV conmuta sola a desvío.', [
      clave(mm('continuidad', 'FT-101:MALLA'), r(null, 1, 'Ω'), r(1000, null, 'Ω'), 'Malla del cable de FT-101: sin continuidad a tierra.'),
    ], ['Con el multímetro la media del lazo parece normal.', 'Mira el lazo de FT-101 con el osciloscopio: hay picos a la frecuencia del variador.', 'Comprueba la continuidad de la malla del cable de FT-101 a tierra.'],
    'El cable de FT-101 recoge la interferencia del variador porque su malla no está a tierra. Los picos hacen saltar el caudal y la FDV pasa a desvío. Se conecta la malla a tierra por un extremo y se separa el cable de la potencia.',
    ['AV-LAZO-ABIERTO', 'AV-FUENTE-24V']),

    'AV-FUSIBLE-F201': firma(enMarcha(), 'Todos los lazos a 0 mA a la vez, A140 y paro de seguridad.', [
      clave(mm('tension', 'F-001:SALIDA'), r(22, 26, 'V'), r(null, 1, 'V'), 'Después del fusible F-001: 0 V.'),
      clave(mm('continuidad', 'F-001:FUSIBLE'), r(null, 1, 'Ω'), r(1000, null, 'Ω'), 'Fusible F-001 sin tensión: circuito abierto. Está fundido.'),
    ], ['Fallan todos los lazos a la vez: busca algo común a todos.', 'Mide la tensión antes y después del fusible F-001.', 'Antes del fusible hay 24 V y después 0 V: comprueba la continuidad del fusible sin tensión.'],
    'El fusible F-001 de los 24 V de instrumentos se ha fundido. Todos los transmisores y entradas se quedan sin alimentación y el PLC para la planta. Busca la causa del corto y cambia el fusible por otro igual.',
    ['AV-FUENTE-24V', 'AV-LAZO-ABIERTO']),

    'AV-FUENTE-24V': firma(enMarcha(), 'Todos los lazos saturados por encima de 21 mA, A140 y paro de seguridad.', [
      clave(mm('tension', 'PS-001:SALIDA'), r(23, 25.5, 'V'), r(15, 20, 'V'), 'Salida de la fuente PS-001: unos 18 V en lugar de 24 V.'),
      clave(mm('tension', 'QE-001:AI-TT-103'), r(23, 25.5, 'V'), r(15, 20, 'V'), 'Entrada del PLC de TT-103: unos 18 V. Les llega poca tensión a todos los lazos.'),
    ], ['Fallan todos los lazos a la vez, pero no a 0 mA.', 'Mide la tensión de salida de la fuente de 24 V.', 'Mira la salida de PS-001 con el osciloscopio: hay mucho rizado.'],
    'La fuente PS-001 está degradada: da unos 18 V con mucho rizado. Los transmisores no tienen tensión suficiente y saturan. Se sustituye la fuente.',
    ['AV-FUSIBLE-F201', 'AV-PT100-ABIERTA']),

    'AV-KM-PEGADO': firma(parada(), 'Con la planta parada, el calentador sigue alimentado y salta A130.', [
      clave(mm('tension', 'KM-201:CARGA'), r(null, 1, 'V'), r(300, null, 'V'), 'En la carga de KM-201 hay 400 V aunque el PLC no lo manda.'),
      clave(mm('resistencia', 'KM-201:CONTACTOS'), r(1000, null, 'Ω'), r(null, 1, 'Ω'), 'Contactos de KM-201 sin orden: casi 0 Ω. Están soldados.'),
    ], ['El PLC no da la orden y el auxiliar dice que el contactor está cerrado.', 'Mide la tensión en la bobina y en la carga de KM-201.', 'Bobina a 0 V y carga a 400 V: corta la potencia y mide los contactos.'],
    'Los contactos de KM-201 se han soldado. El banco del calentador sigue conectado aunque el PLC lo apague y el agua puede subir hasta disparar TSH-201. Se corta la alimentación y se sustituye el contactor.',
    ['AV-KM-NO-CIERRA', 'AV-TSH-DISPARADO']),

    'AV-KM-NO-CIERRA': firma(enMarcha(), 'A130: el PLC manda cerrar KM-203 y no cierra. P-201 parada y el agua no se calienta.', [
      clave(mm('tension', 'KM-203:BOBINA'), r(22, 26, 'V'), r(22, 26, 'V'), 'Bobina de KM-203: 24 V. El PLC sí da la orden.'),
      clave(mm('tension', 'KM-203:CARGA'), r(300, null, 'V'), r(null, 1, 'V'), 'En la carga de KM-203: 0 V aunque la bobina tiene orden.'),
      clave(mm('resistencia', 'KM-203:CONTACTOS'), r(null, 1, 'Ω'), r(1000, null, 'Ω'), 'Contactos de KM-203: abiertos.'),
    ], ['El PLC ordena cerrar y el auxiliar dice que no.', 'Mide la tensión en la bobina de KM-203: ¿le llega la orden?', 'Bobina a 24 V y carga a 0 V: el contactor no cierra.'],
    'El contactor KM-203 no cierra: contactos quemados o bobina sin fuerza. La bomba P-201 no arranca y el agua caliente no circula. Se sustituye el contactor.',
    ['AV-KM-PEGADO', 'AV-TSH-DISPARADO']),

    'AV-BOBINA-ABIERTA': firma(enMarcha(), 'A120: la FDV no llega nunca a avance y no hay producción.', [
      clave(mm('resistencia', 'SV-101:BOBINA'), r(150, 300, 'Ω'), r(10000, null, 'Ω'), 'Bobina de SV-101 desconectada: OL. Está abierta.'),
      clave(mm('continuidad', 'FDV-101:ZS-101'), r(null, 1, 'Ω'), r(1000, null, 'Ω'), 'Final de carrera de avance ZS-101: abierto. La FDV no ha llegado a avance.'),
    ], ['El PLC pide avance y la FDV no se mueve.', '¿Llegan los 24 V al piloto SV-101 cuando el PLC da la orden?', 'Desconecta la bobina de SV-101 y mide su resistencia: debería dar unos 220 Ω.'],
    'La bobina del piloto SV-101 está abierta. Aunque el PLC le dé 24 V, no se energiza, el aire no llega a la FDV y la válvula se queda en desvío. Se sustituye la bobina.',
    ['AV-FDV-ATASCADA', 'AV-AIRE-BAJO']),

    'AV-FDV-ATASCADA': firma(enMarcha(), 'A120: al pedir desvío la FDV no vuelve. Paro de seguridad y P-101 parada.', [
      clave(mm('tension', 'SV-101:BORNAS'), r(22, 26, 'V'), r(null, 1, 'V'), 'Piloto SV-101 sin tensión: el PLC pide desvío.'),
      clave(mm('corriente', 'FT-101:LAZO'), r(10, null, 'mA'), r(null, 4.5, 'mA'), 'Lazo de FT-101: unos 4 mA. No hay caudal: P-101 está parada.'),
      clave(mm('continuidad', 'FDV-101:ZS-101'), r(null, 1, 'Ω'), r(null, 1, 'Ω'), 'Final de carrera de avance ZS-101: cerrado. La FDV sigue en avance sin aire en el piloto.'),
    ],['El piloto está sin tensión y la válvula no vuelve a desvío.', 'Comprueba los finales de carrera: ZS-101 sigue cerrado y ZS-102 no llega.', 'Mira el manómetro del aire: si está a 6 bar, el fallo es mecánico.'],
    'El vástago de la FDV está atascado en avance. Con el piloto sin tensión el muelle debería llevarla a desvío y no lo hace. El PLC lo detecta y para la planta. Se desmonta y se repara la válvula.',
    ['AV-BOBINA-ABIERTA', 'AV-AIRE-BAJO']),

    'AV-AIRE-BAJO': firma(enMarcha(), 'A160: presostato de aire abierto; la planta no pasa a producción.', [
      clave(manometro('FRL-501:MANOMETRO'), r(5.5, 6.5, 'bar'), r(null, 4.5, 'bar'), 'Manómetro de la unidad de aire: menos de 4,5 bar.'),
      clave(mm('continuidad', 'PSL-501:CONTACTO'), r(null, 1, 'Ω'), r(1000, null, 'Ω'), 'Contacto del presostato PSL-501: abierto.'),
    ], ['La alarma es del aire comprimido.', 'Mira el manómetro de la unidad FRL-501.', 'Con menos de 4,5 bar el presostato se abre y la FDV no puede ir a avance.'],
    'La presión de aire es baja por una fuga o por el regulador mal ajustado. La FDV no tiene fuerza para ir a avance y el presostato bloquea la producción. Se repara la fuga y se ajusta el regulador a 6 bar.',
    ['AV-FDV-ATASCADA', 'AV-BOBINA-ABIERTA']),

    'AV-VFD-SOBRETEMP': firma(enMarcha(), 'A150 a los pocos minutos: P-101 se para y el caudal cae a 0.', [
      clave(termometro('VFD-101:DISIPADOR'), r(null, 70, '°C'), r(80, null, '°C'), 'Disipador del variador: más de 80 °C.'),
      clave(mm('tension', 'VFD-101:VENTILADOR'), r(22, 26, 'V'), r(null, 1, 'V'), 'Ventilador del variador: 0 V. Está parado.'),
    ], ['El variador ha disparado por temperatura.', 'Mide la temperatura del disipador del variador.', '¿Gira el ventilador? Mide su alimentación.'],
    'El ventilador del variador está parado o el filtro sucio. El disipador se calienta hasta 80 °C y el variador dispara. Se limpia el filtro y se cambia el ventilador.',
    ['AV-FILTRO-OBSTRUIDO', 'AV-KM-NO-CIERRA']),

    'AV-PLACA-FUGA': firma(enMarcha(), 'A110: el diferencial de presión de la regeneración es bajo o se invierte.', [
      clave(mm('corriente', 'PT-102:LAZO'), r(0.8, null, 'mA'), r(null, 0.3, 'mA'), 'PT-102 menos PT-101: casi 0 mA o negativo. El lado pasteurizado ya no está por encima.',
        { referencia: mm('corriente', 'PT-101:LAZO') }),
      clave(mm('corriente', 'FT-101:LAZO'), r(13, 16, 'mA'), r(13, 16, 'mA'), 'Lazo de FT-101: caudal normal. La bomba y la aspiración van bien.'),
    ],['Compara las dos presiones de la regeneración.', 'El lado pasteurizado (PT-102) debe estar siempre por encima del crudo (PT-101).', 'Mide los dos lazos y réstalos: si la diferencia es casi 0 o negativa, hay paso entre los dos lados.'],
    'Una placa de la regeneración está perforada. La presión de los dos lados se iguala y el crudo puede contaminar el producto pasteurizado. El PLC lo detecta y desvía. Se localiza la placa con una prueba de presión y se cambia con sus juntas.',
    ['AV-FILTRO-OBSTRUIDO', 'AV-DERIVA-TT103']),

    'AV-FILTRO-OBSTRUIDO': firma(enMarcha(), 'Sin alarmas: el caudal baja con el variador a la misma velocidad.', [
      clave(manometro('FLT-101:PRESION-DESPUES'), r(-0.1, 0.1, 'bar'), r(null, -0.15, 'bar'), 'Después del colador hay bastante menos presión que antes: pérdida de carga.',
        { referencia: manometro('FLT-101:PRESION-ANTES') }),
      clave(mm('corriente', 'FT-101:LAZO'), r(13, 16, 'mA'), r(null, 11, 'mA'), 'Lazo de FT-101: menos caudal del que pide la consigna.'),
    ], ['Con la misma velocidad de la bomba hay menos caudal.', 'El problema está en la aspiración de P-101.', 'Mide la presión antes y después del colador FLT-101.'],
    'El colador de aspiración está obstruido. La bomba no puede aspirar todo el caudal y la presión cae después del colador. Se desmonta y se limpia.',
    ['AV-VFD-SOBRETEMP', 'AV-PLACA-FUGA']),

    'AV-TSH-DISPARADO': firma(enMarcha(), 'A170 y paro de seguridad con el agua fría. El rearme no sirve.', [
      clave(mm('continuidad', 'TSH-201:CONTACTO'), r(null, 1, 'Ω'), r(1000, null, 'Ω'), 'Contacto NC de TSH-201 en frío: abierto.'),
      clave(mm('corriente', 'TT-201:LAZO'), r(10, null, 'mA'), r(null, 8, 'mA'), 'Lazo de TT-201: el agua está fría. No hay sobretemperatura real.'),
    ], ['¿Está el agua realmente caliente?', 'Mira TT-201: si el agua está fría, el disparo es falso.', 'Comprueba la continuidad del contacto de TSH-201 en frío: debe estar cerrado.'],
    'El termostato de seguridad TSH-201 se ha quedado abierto aunque el agua está fría. El PLC saca el calentador y para la planta. Se sustituye el termostato; nunca se puentea.',
    ['AV-KM-PEGADO', 'AV-KM-NO-CIERRA']),
  };
  for (const a of CATALOGO) if (FIRMAS[a.id]) a.firma = FIRMAS[a.id];

  const porId = id => CATALOGO.find(a => a.id === id) || null;
  const api = { CATALOGO, porId, TAGS_AI, TAGS_TT };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstCatalogo = api; }
})();
