// Textos de ayuda de la planta real HTST: una ficha por equipo (con su tag ISA) y la guía de la pantalla. Todo lo numérico es típico e ilustrativo.
(function () {
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.htstLayout;

  // Por tag: qué es (función real en la planta), qué hace en el simulador y qué fallos habituales tiene (para mantenimiento electrónico).
  const FICHAS = {
    'TK-101': ['Recibe la leche cruda antes de la bomba. Evita que entre aire y amortigua los cambios de caudal.', 'Nivel por LT-101 (4-20 mA) y flotadores LSH-101 y LSL-101. El desvío de la FDV devuelve aquí la leche que no llegó a temperatura.'],
    'FLT-101': ['Colador de aspiración: retiene suciedad que dañaría la bomba y las placas.', 'Atascado: bajan el caudal de FT-101 y la presión de aspiración. Se limpia a mano.'],
    'P-101': ['Bomba centrífuga de alimentación con variador (VFD-101). Da el caudal de producción.', 'Marcha DO1.01 y velocidad AO1.01 (0-10 V). Si el variador falla (DI1.13) o se calienta, para.'],
    'HX-101': ['Intercambiador de placas con tres secciones: regeneración (la leche pasteurizada precalienta la cruda), calentamiento (agua caliente) y enfriamiento (agua fría).', 'Una placa perforada mezcla crudo y pasteurizado: por eso el lado pasteurizado va a más presión (ΔP ≥ 0,07 bar, ejemplo).'],
    'HT-101': ['Tubo de residencia: mantiene la leche a temperatura el tiempo exigido (ejemplo: 72 °C durante 15 s).', 'Dimensionado para el caudal máximo. El PLC calcula el tiempo de residencia con FT-101.'],
    'FDV-101': ['Válvula de desvío de 3 vías, neumática. Es la seguridad alimentaria: solo deja salir leche bien pasteurizada.', 'Seguridad positiva: sin tensión o sin aire, el muelle la lleva a DESVÍO. Pasa a AVANCE solo con TT-103 ≥ 72 °C, residencia correcta, ΔP de regeneración correcto, aire y lazos sanos.'],
    'SV-101': ['Electroválvula piloto de 24 V CC que da aire al actuador de la FDV.', 'Con tensión = avance; sin tensión = desvío (muelle). Bobina abierta: la FDV no avanza (A120).'],
    'FRL-501': ['Filtro, regulador y lubricador del aire de la FDV.', 'PSL-501 avisa de presión baja (A160): sin aire, la FDV queda en desvío.'],
    'HW-201': ['Calentador del agua caliente, con dos bancos de resistencias por contactor.', 'Banco 1: todo/nada con histéresis sobre TT-201. Banco 2: en cascada con TT-103. Seguridad: TSH-201.'],
    'P-201': ['Bomba del agua caliente hacia la sección de calentamiento.', 'Contactor KM-203 y magnetotérmico QF-201. Sin P-201 no se calienta el producto ni se conecta el calentador.'],
    'XV-101': ['Válvula todo/nada de llenado de TK-101 (leche o agua de prueba).', 'DO1.10. Abierta: el tanque sube unos 2600 L/h (ilustrativo). En automático la abre el PLC con histéresis sobre LT-101; en MANUAL, tú. Al 100 % rebosa.'],
    'XV-102': ['Válvula todo/nada de vaciado de TK-101 a desagüe.', 'DO1.11. Abierta: el tanque baja unos 2400 L/h más lo que saca P-101. Vacío, P-101 para por marcha en seco (LSL-101).'],
    'XV-201': ['Válvula todo/nada de llenado de HW-201 con agua de red (fría).', 'DO1.12. Abierta: sube unos 1500 L/h y el agua se enfría (entra a unos 15 °C). En automático repone el nivel.'],
    'XV-202': ['Válvula todo/nada de vaciado de HW-201 a desagüe.', 'DO1.13. Abierta: baja unos 1800 L/h. Con nivel bajo, LSL-201 abre y se desconectan las resistencias.'],
    'LSL-201': ['Nivel bajo del agua caliente: flotador de vástago con bola de acero. Si el agua baja, la bola cae y mueve el contacto. Rosca de latón, caja de conexión y prensaestopas; zona baja (15 %).', 'DI2.01, contacto NC (normalmente cerrado) a 2 hilos: 1 = hay agua; 0 = nivel bajo (A230) o hilo roto. Corta los bancos del calentador, también en MANUAL: las resistencias nunca en seco.'],
    'XV-301': ['Válvula todo/nada del agua fría de enfriamiento.', 'DO1.07. Abierta: enfría el producto a unos 4 °C (ejemplo).'],
    'XV-401': ['Válvula todo/nada del circuito CIP.', 'DO1.08. Solo en modo CIP.'],
    'TT-101': ['Pt100 con transmisor de cabeza 4-20 mA en la leche cruda de entrada. La Pt100 vale 100 Ω a 0 °C y sube unos 0,385 Ω/°C. Vaina sanitaria tri-clamp, cabezal azul, prensaestopas y chapa de tag.', 'AI1.01, 0-100 °C: 4 mA = 0 °C, 20 mA = 100 °C. A 2 hilos: el mismo par lleva los 24 V y la señal, en serie con la entrada del PLC. 0 mA: hilo roto o fuente caída; > 20 mA: sonda en corto. LED verde = lazo sano, ámbar = ruido o deriva, rojo = abierto o en corto.'],
    'TT-102': ['Pt100 con transmisor de cabeza 4-20 mA: leche cruda tras la regeneración (precalentada). Vaina sanitaria tri-clamp, cabezal con tapa roscada y prensaestopas.', 'AI1.02, 0-100 °C (2 hilos). Indica si la regeneración funciona (≈ 66 °C en el ejemplo): si cae, placas sucias o caudal excesivo.'],
    'TT-103': ['Pt100 con transmisor de cabeza 4-20 mA a la salida del tubo de residencia. Es el termómetro legal: decide si la leche pasa o se desvía. Vaina tri-clamp, cabezal azul y chapa de tag.', 'AI1.03, 0-100 °C (2 hilos). Si el lazo falla (hilo roto, sobreescala), la FDV va a desvío. Calíbrala con patrón: una deriva aquí es peligrosa porque el LED sigue verde.'],
    'TT-104': ['Pt100 con transmisor de cabeza 4-20 mA: producto a la salida, ya enfriado. Vaina sanitaria tri-clamp y cabezal con transmisor y tapa roscada.', 'AI1.04, 0-100 °C (2 hilos). Comprueba el enfriamiento (≈ 4 °C en el ejemplo).'],
    'TT-106': ['Pt100 con transmisor de cabeza 4-20 mA en el puente de leche pasteurizada, entre regeneración y enfriamiento. Vaina tri-clamp y cabezal con tapa roscada.', 'AI2.02, 0-100 °C (2 hilos): temperatura de entrada al enfriamiento. Comprueba que la regeneración recupera calor.'],
    'TT-201': ['Pt100 con transmisor de cabeza 4-20 mA en el agua caliente. Al no ser producto alimentario, lleva racor roscado con tuerca hexagonal en vez de tri-clamp.', 'AI1.05, 0-150 °C (2 hilos: 4 mA = 0 °C, 20 mA = 150 °C). Regula el banco 1. Lazo abierto: el PLC lo ve por corriente fuera de rango.'],
    'TSH-201': ['Termostato de seguridad de bulbo del agua caliente: el líquido del bulbo se dilata y abre un contacto NC. Protección independiente del PLC. Caja gris con rearme manual rojo y dial de consigna.', 'DI1.02, contacto NC a 2 hilos: 1 = normal; 0 = disparo o hilo roto (seguridad positiva). Corta el calentador; rearme manual con el botón rojo. Nunca se puentea.'],
    'FT-101': ['Caudalímetro electromagnético (ley de Faraday): la leche pasa por un campo magnético y entre dos electrodos aparece una tensión proporcional a la velocidad. Sin partes móviles; tri-clamp y convertidor con pantalla.', 'AI1.06, 0-3000 L/h (4-20 mA). Da el tiempo de residencia. Alimentación aparte y salida por cable apantallado: si la malla no va a tierra, el ruido del variador perturba la señal.'],
    'PT-101': ['Transmisor de presión con membrana de acero inoxidable en tri-clamp: un puente de galgas convierte la deformación en señal. Conector M12 y, al lado, manómetro de esfera de 0 a 6 bar.', 'AI1.07, 0-6 bar (4-20 mA a 2 hilos: 4 mA = 0 bar, 20 mA = 6 bar). Lado crudo de la regeneración. Compara manómetro y PLC: si no coinciden, falla el lazo o el transmisor.'],
    'PT-102': ['Transmisor de presión sanitario, membrana inox en tri-clamp, conector M12 y manómetro de esfera de 0 a 6 bar. Mide el lado pasteurizado de la regeneración.', 'AI1.08, 0-6 bar (4-20 mA a 2 hilos). PT-102 − PT-101 ≥ 0,07 bar (ejemplo): si el pasteurizado no va a más presión, una fuga de placa lo contamina. En planta real suele haber bomba booster; aquí no.'],
    'LT-101': ['Transmisor de nivel hidrostático de TK-101: membrana a ras de la pared baja (tri-clamp, sin huecos) que mide la presión de la columna de leche, proporcional al nivel. Cabezal con pantalla y LED.', 'AI2.01, 0-100 % (4-20 mA a 2 hilos: 4 mA = vacío, 20 mA = lleno). Si deriva o se desconecta, el PLC lee un nivel falso; LSL-101 y LSH-101 son la protección independiente.'],
    'LSH-101': ['Nivel alto de TK-101: horquilla vibrante sanitaria. Al cubrirla la leche, cambia su frecuencia y conmuta el contacto. En tri-clamp al 90 %, cabezal IP65 y conector M12.', 'DI1.03: 1 = nivel alto (contacto NA). 24 V por el M12. LED gris = sin leche, verde = con leche.'],
    'LSL-101': ['Nivel bajo de TK-101: sonda capacitiva sanitaria. La leche cambia la capacidad entre la varilla y la pared del tanque. En tri-clamp al 12 %, cabezal IP65 y conector M12.', 'DI1.04, contacto NC: 1 = hay leche; 0 = vacío o hilo roto. Protege la bomba de la marcha en seco.'],
    'LSH-201': ['Nivel alto del agua caliente: flotador de vástago con disco que sube con el agua y conmuta al llegar a la marca azul del visor (90 %). Rosca de latón, caja de conexión y prensaestopas.', 'DI2.02, contacto NA a 2 hilos: 1 = nivel alto. Este depósito no mide porcentaje: solo tiene LSL-201 y LSH-201.'],
    'ZS-101': ['Final de carrera de la FDV en avance: carcasa de aluminio con palanca de rodillo que pisa el vástago de la válvula. Va en una ménsula atornillada al yugo.', 'DI1.05, contacto NA a 2 hilos: 1 = en avance. Si no coincide con la orden: A120. Palanca pulsada = LED verde.'],
    'ZS-102': ['Final de carrera de la FDV en desvío: carcasa de aluminio con palanca de rodillo, pulsada cuando la válvula cae a desvío por su muelle.', 'DI1.06, contacto NA a 2 hilos: 1 = en desvío. ZS-101 y ZS-102 a la vez (o ninguno): contacto pegado, hilo roto o palanca desajustada.'],
    'PSL-501': ['Presostato de aire de presión baja: una membrana empuja contra un muelle; el tornillo de ajuste de arriba fija el disparo. Racor G1/4 de latón y carcasa con prensaestopas.', 'DI1.07, 2 hilos: 1 = aire suficiente; 0 = presión baja (A160). Sin aire, la FDV queda en desvío.'],
    'QE-001': ['Armario de chapa (RAL 7035) con placa de montaje, carriles DIN y canaletas. De arriba abajo: seccionador QS-001 y diferencial QR-001, magnetotérmico QF-201, fuente PS-001 con fusible F-001 y relé de seguridad KS; PLC-001 con sus tarjetas (alimentación, CPU, AI-1, AI-2, DI-1, DI-2, DO-1, AO-1, un LED por canal); variador VFD-101 y contactores KM-203, KM-201 y KM-202; abajo, bornas X0 (acometida 400 V), X1 (230 V y 24 V), X2 (motores y resistencias), X3 (lazos 4-20 mA) y X4 (digitales), barra de tierra y prensaestopas. Puerta: HMI-001, seta ES-001, pulsador PB-001 y pilotos (24 V, marcha, fallo, manual); baliza HL-001 encima. Colores: negro fuerza, azul claro neutro, rojo +24 V, azul oscuro 0 V, amarillo-verde tierra, naranja y blanco señales.',
      'Aquí se hacen casi todas las medidas: bornas, bobinas A1/A2, fusible. Fuerza (400 V): de X0 por QS-001 y QF-201 a contactores, variador y X2. Mando (24 V): de PS-001 por F-001 al PLC, bobinas y lazos (X3, X4); la seta ES-001 abre KS. LED del PLC y pilotos muestran el estado real. «Corte» hace la puerta translúcida y «Tapa» la quita. Antes de abrir: parar, bloquear y comprobar ausencia de tensión.'],
    'PS-001': ['Fuente de 24 V CC para instrumentos, PLC y bobinas.', 'DI1.15 = OK. Si baja o tiene rizado, los lazos se saturan y el PLC puede reiniciarse (A140).'],
    'F-001': ['Fusible general de los 24 V de instrumentos.', 'Fundido: todos los lazos a 0 mA a la vez (A140). Mide 24 V antes y después.'],
    'VFD-101': ['Variador de frecuencia de P-101.', 'Referencia 0-10 V (AO1.01), fallo DI1.13. Disipador > 80 °C o ventilador parado: se protege y para (A150).'],
    'KM-203': ['Contactor de P-201 (potencia del motor).', 'Orden DO1.02; auxiliar DI1.09. Si no coinciden más de 3 s: A130.'],
    'KM-201': ['Contactor del banco 1 del calentador.', 'Orden DO1.04; auxiliar DI1.11. Con contactos soldados el banco calienta aunque la orden sea 0.'],
    'KM-202': ['Contactor del banco 2 del calentador.', 'Orden DO1.05; auxiliar DI1.12.'],
    'QF-201': ['Magnetotérmico de P-201 y del calentador.', 'DI1.14: 1 = armado.'],
    'PB-001': ['Pulsador de marcha y rearme local.', 'DI1.16.'],
    'ES-001': ['Paro de emergencia: seta con contacto NC y relé de seguridad.', 'DI1.01: 1 = rearmado; 0 = pulsado o hilo roto. Desvío y apagado de calentador y bombas (A180).'],
    'PLC-001': ['Autómata con tarjetas AI, DI, DO y AO.', 'Ejecuta arranque, producción, desvío, paro de seguridad, CIP y alarmas.'],
    'HMI-001': ['Pantalla SCADA del operador.', 'Esta pantalla: lecturas, alarmas y mandos.'],
    'HL-001': ['Baliza de alarma.', 'DO1.09. Se enciende con alarma activa.'],
  };

  const ETIQUETA_POR_TIPO = { tanque: 'Depósito', filtro: 'Filtro', bomba: 'Bomba centrífuga', intercambiador: 'Intercambiador de placas', tubo_residencia: 'Tubería',
    valvula_neumatica: 'Válvula neumática', electrovalvula_piloto: 'Electroválvula', neumatica: 'Neumática', calentador: 'Calentador', valvula_todo_nada: 'Válvula todo/nada',
    sonda_temperatura: 'Sensor de temperatura', termostato: 'Termostato', caudalimetro: 'Sensor de caudal', presion: 'Sensor de presión', nivel: 'Sensor de nivel', flotador: 'Flotador',
    final_carrera: 'Final de carrera', presostato: 'Presostato', armario: 'Armario eléctrico', fuente: 'Fuente de alimentación', fusible: 'Fusible', variador: 'Variador',
    contactor: 'Contactor', magnetotermico: 'Magnetotérmico', pulsador: 'Pulsador', paro_emergencia: 'Paro de emergencia', plc: 'PLC', hmi: 'Pantalla', baliza: 'Baliza' };

  /** Fichas de ayuda: { tag: { titulo, etiqueta, queEs, enSimulador } } para todos los equipos del contrato. */
  function construirElementos(lay = layout) {
    const salida = {};
    for (const e of lay.EQUIPOS) {
      const ficha = FICHAS[e.tag] || [e.nombre, ''];
      salida[e.tag] = { titulo: `${e.tag} · ${e.nombre}`, etiqueta: ETIQUETA_POR_TIPO[e.tipo] || e.tipo, queEs: ficha[0], enSimulador: ficha[1] };
    }
    return salida;
  }

  const escalar = v => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',')) : typeof v === 'boolean' ? (v ? 'sí' : 'no') : String(v));

  /** Texto de «Estado ahora» de un equipo a partir del estado del simulador (contrato v1). */
  function estadoVivo(tag, estado) {
    if (!estado) return '';
    const partes = [];
    const instrumento = estado.instrumentos && estado.instrumentos[tag];
    if (instrumento) {
      if (instrumento.valorPLC !== undefined) partes.push(`${escalar(instrumento.valorPLC)} ${(layout.senal(tag).find(s => s.tipo === 'AI') || {}).unidad || ''}`.trim());
      if (instrumento.mA !== undefined) partes.push(`${instrumento.mA.toFixed(2).replace('.', ',')} mA`);
      if (instrumento.calidad) partes.push(`calidad ${instrumento.calidad}`);
      if (instrumento.nivel !== undefined) partes.push(`entrada del PLC = ${instrumento.nivel}`);
    }
    const equipo = estado.equipos && estado.equipos[tag];
    if (equipo) for (const [campo, valor] of Object.entries(equipo)) { if (valor !== null && typeof valor !== 'object') partes.push(`${campo}: ${escalar(valor)}`); }
    if (!partes.length && tag === 'HX-101' && estado.proceso) partes.push(`entrada ${escalar(estado.proceso.temperaturas.entrada)} °C → tras regeneración ${escalar(estado.proceso.temperaturas.trasRegeneracion)} °C → tras calentamiento ${escalar(estado.proceso.temperaturas.trasCalentamiento)} °C`);
    if (!partes.length && tag === 'HT-101' && estado.proceso) partes.push(`tiempo de residencia ${escalar(estado.proceso.tiempoResidenciaS)} s`);
    return partes.join(' · ');
  }

  const GUIA = [
    ['Qué es', '<p>Planta de pasteurización HTST de leche con SCADA y 3D, para practicar <b>mantenimiento electrónico</b>: lazos 4-20 mA, 24 V, contactores, variador y seguridad positiva.</p>'],
    ['Operar', '<p>Pulsa <b>Iniciar</b>, elige modo (recirculación de agua, producción o CIP) y arranca. La leche solo sale si TT-103 llega a temperatura y se cumplen los enclavamientos; si no, la <b>FDV</b> la desvía.</p>'],
    ['Diagnosticar', '<p>El profesor provoca una avería sin decirte cuál. Usa los <b>síntomas del SCADA</b>, el <b>3D</b>, el <b>multímetro</b> y el <b>osciloscopio</b> (pestaña Instrumentos), anota lo que mides y aplica la solución en la hoja de diagnóstico.</p>'],
    ['Antes de tocar', '<p>En la realidad: parar, bloquear, señalizar y comprobar ausencia de tensión. Ohmios y continuidad, sin tensión. mA, en serie. Nunca se puentean la seta ni el termostato.</p>'],
    ['Valores', '<p>72 °C durante 15 s, 0,07 bar y los rangos de los instrumentos son <b>ejemplos típicos</b>, no los de una instalación ni norma concreta.</p>'],
  ];

  const api = { FICHAS, construirElementos, estadoVivo, GUIA };
  if (typeof module !== 'undefined') module.exports = api; else PCT.htstTextosAyuda = api;
})();
