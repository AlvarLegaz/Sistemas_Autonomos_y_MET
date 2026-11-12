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

  const porId = id => CATALOGO.find(a => a.id === id) || null;
  const api = { CATALOGO, porId, TAGS_AI, TAGS_TT };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstCatalogo = api; }
})();
