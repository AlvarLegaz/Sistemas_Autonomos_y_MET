// Textos de ayuda de la planta real HTST: una ficha por equipo (con su tag ISA) y la guía de la pantalla. Todo lo numérico es típico e ilustrativo.
(function () {
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.htstLayout;

  // Por tag: qué es (función real en la planta), qué hace en el simulador y qué fallos habituales tiene (para mantenimiento electrónico).
  const FICHAS = {
    'TK-101': ['Recibe y estabiliza la leche cruda antes de la bomba. Evita que entre aire y amortigua los cambios de caudal.', 'Nivel por LT-101 (4-20 mA) y los flotadores LSH-101 y LSL-101. El desvío de la FDV devuelve aquí la leche que no llegó a temperatura.'],
    'FLT-101': ['Colador de aspiración: retiene trozos y suciedad que dañarían la bomba y las placas.', 'Si se atasca, cae el caudal de FT-101 y la presión de aspiración. Se limpia a mano.'],
    'P-101': ['Bomba centrífuga de alimentación, movida por un motor con variador de frecuencia (VFD-101). Da el caudal de producción.', 'El PLC manda marcha (DO1.01) y velocidad (AO1.01, 0-10 V). Si el variador falla (DI1.13) o se sobrecalienta, para.'],
    'P-103': ['Bomba booster del lado crudo: mantiene la presión del lado crudo por debajo de la del pasteurizado en la regeneración.', 'Solo marcha con P-101 en marcha, la FDV en avance y el diferencial correcto. Contactor KM-103.'],
    'HX-101': ['Intercambiador de placas con tres secciones: regeneración (la leche pasteurizada caliente precalienta a la cruda), calentamiento (agua caliente) y enfriamiento (agua fría).', 'La regeneración ahorra energía. Una placa perforada mezcla crudo y pasteurizado: por eso el lado pasteurizado debe tener más presión (ΔP ≥ 0,07 bar, ejemplo).'],
    'HT-101': ['Tubo de residencia: mantiene la leche a la temperatura de pasteurización el tiempo exigido (ejemplo ilustrativo: 72 °C durante 15 s).', 'Su volumen está dimensionado para el caudal máximo. El PLC calcula el tiempo de residencia con el caudal de FT-101.'],
    'FDV-101': ['Válvula de desvío de flujo de 3 vías, neumática. Es la seguridad alimentaria: solo deja pasar la leche a la salida si se ha pasteurizado bien.', 'Seguridad positiva: sin tensión o sin aire el muelle la lleva a DESVÍO. Pasa a AVANCE solo con TT-103 ≥ 72 °C, tiempo de residencia correcto, ΔP de regeneración correcto, aire bueno y lazos sanos.'],
    'SV-101': ['Electroválvula piloto de 24 V CC que lleva el aire comprimido al actuador de la FDV.', 'Energizada = avance; sin tensión = desvío (muelle). Si la bobina se abre, la FDV nunca avanza (alarma A120).'],
    'FRL-101': ['Filtro, regulador y lubricador del aire comprimido que mueve la FDV.', 'PSL-201 avisa si la presión baja (alarma A160): sin aire, la FDV queda en desvío.'],
    'HW-101': ['Calentador del circuito de agua caliente, con dos bancos de resistencias controlados por contactores.', 'El banco 1 trabaja todo/nada con histéresis sobre TT-105 y el banco 2 se ajusta en cascada con TT-103. TSH-101 es su seguridad.'],
    'P-102': ['Bomba que hace circular el agua caliente por la sección de calentamiento del intercambiador.', 'Contactor KM-102 y magnetotérmico QF-102. Sin P-102 no se calienta el producto y el calentador no puede conectarse.'],
    'XV-101': ['Válvula todo/nada de llenado del tanque de balance: deja entrar la leche (o el agua de prueba) a TK-101.', 'DO1.10: abierta, el tanque sube unos 2600 L/h (valor ilustrativo). En automático el PLC la abre con histéresis sobre LT-101; en MANUAL la mandas tú. Si el tanque llega al 100 % rebosa.'],
    'XV-102': ['Válvula todo/nada de vaciado del tanque de balance: lo drena a desagüe.', 'DO1.11: abierta, el tanque baja unos 2400 L/h además de lo que saca P-101. Con el tanque vacío P-101 se para por marcha en seco (LSL-101).'],
    'XV-302': ['Válvula todo/nada de llenado del depósito de agua caliente: mete agua de red (fría) en HW-101.', 'DO1.12: abierta, el depósito sube unos 1500 L/h y el agua se enfría porque entra a unos 15 °C. En automático el PLC la usa para reponer el nivel.'],
    'XV-303': ['Válvula todo/nada de vaciado del depósito de agua caliente: lo drena a desagüe.', 'DO1.13: abierta, el depósito baja unos 1800 L/h. Con el nivel bajo LSL-301 abre y las resistencias se desconectan (se dañarían en seco).'],
    'LSL-301': ['Flotador de nivel bajo del depósito de agua caliente, con contacto normalmente cerrado: protege las resistencias para que nunca trabajen sin agua.', 'DI2.01: contacto cerrado = hay agua; abierto = nivel bajo (alarma A230) y los bancos del calentador se cortan, también en modo MANUAL.'],
    'XV-301': ['Válvula todo/nada del agua fría de la sección de enfriamiento.', 'DO1.07. Abierta enfría el producto hasta unos 4 °C (ejemplo) antes de la salida.'],
    'XV-401': ['Válvula todo/nada del circuito de limpieza CIP.', 'DO1.08. Solo se abre en el modo CIP.'],
    'TT-101': ['Pt100 con transmisor 4-20 mA: temperatura de la leche cruda a la entrada.', 'Lazo AI1.01 de 0 a 100 °C. 4 mA = 0 °C, 20 mA = 100 °C.'],
    'TT-102': ['Pt100 con transmisor: leche cruda tras la regeneración (precalentada).', 'Lazo AI1.02. Sirve para ver si la regeneración funciona (≈ 66 °C en el ejemplo).'],
    'TT-103': ['Pt100 con transmisor a la salida del tubo de residencia. Es el termómetro legal: decide si la leche pasa o se desvía.', 'Lazo AI1.03. Si el lazo falla (hilo roto, sobreescala), la FDV pasa a desvío. Debe calibrarse periódicamente con un patrón.'],
    'TT-104': ['Pt100 con transmisor: producto a la salida, ya enfriado.', 'Lazo AI1.04. Comprueba que el enfriamiento funciona (≈ 4 °C en el ejemplo).'],
    'TT-105': ['Pt100 con transmisor: temperatura del agua caliente.', 'Lazo AI1.05 de 0 a 150 °C. Regula el banco 1 del calentador.'],
    'TSH-101': ['Termostato de seguridad del agua caliente, con contacto normalmente cerrado (NC) que abre al pasar el límite.', 'DI1.02: 1 = normal, 0 = disparado o hilo roto. Corta el calentador; el rearme es manual. Nunca se puentea.'],
    'FT-101': ['Caudalímetro electromagnético: mide el caudal de leche sin partes móviles.', 'Lazo AI1.06 de 0 a 3000 L/h. Con el caudal se calcula el tiempo de residencia. El ruido del variador lo perturba si el cable no está apantallado.'],
    'PT-101': ['Transmisor de presión del lado crudo de la regeneración.', 'Lazo AI1.07 de 0 a 6 bar.'],
    'PT-102': ['Transmisor de presión del lado pasteurizado de la regeneración.', 'Lazo AI1.08. PT-102 − PT-101 debe ser ≥ 0,07 bar (ejemplo); si no, hay una fuga de placa o un fallo de la booster.'],
    'LT-101': ['Transmisor de nivel (presión hidrostática) del tanque de balance.', 'Lazo AI2.01 en %.'],
    'LSH-101': ['Flotador de nivel alto del tanque de balance.', 'DI1.03: 1 = nivel alto alcanzado.'],
    'LSL-101': ['Flotador de nivel bajo del tanque de balance (contacto NC).', 'DI1.04: 1 = hay leche; 0 = vacío o hilo roto. Protege la bomba contra marcha en seco.'],
    'ZS-101': ['Final de carrera de la FDV: avisa de que está en posición de avance.', 'DI1.05. El PLC lo compara con la orden: si no coincide, alarma A120.'],
    'ZS-102': ['Final de carrera de la FDV: avisa de que está en posición de desvío.', 'DI1.06.'],
    'PSL-201': ['Presostato de aire comprimido: avisa de presión baja.', 'DI1.07: 1 = aire suficiente.'],
    'QE-001': ['Armario eléctrico: seccionador, magnetotérmicos, diferencial, bornas, PLC, fuente y contactores.', 'Aquí se hacen la mayoría de las medidas con el multímetro: tensiones en bornas, bobinas, fusible.'],
    'PS-001': ['Fuente de alimentación de 24 V CC para instrumentos, PLC y bobinas.', 'DI1.15 avisa de que está OK. Si baja o tiene rizado, los lazos 4-20 mA se saturan y el PLC puede reiniciarse (alarma A140).'],
    'F-201': ['Fusible general de los 24 V de instrumentos.', 'Si se funde, todos los lazos caen a 0 mA a la vez (alarma A140). Mide 24 V antes y después para comprobarlo.'],
    'VFD-101': ['Variador de frecuencia que regula la velocidad de P-101.', 'Referencia 0-10 V (AO1.01) y fallo DI1.13. Con el disipador a más de 80 °C o el ventilador parado, se protege y para (alarma A150).'],
    'KM-102': ['Contactor de P-102 (potencia del motor).', 'Orden DO1.02; auxiliar DI1.09 confirma que cerró. Si la orden y el auxiliar no coinciden más de 3 s: alarma A130.'],
    'KM-103': ['Contactor de P-103.', 'Orden DO1.03; auxiliar DI1.10.'],
    'KM-201': ['Contactor del banco 1 del calentador.', 'Orden DO1.04; auxiliar DI1.11. Con los contactos soldados el banco sigue calentando aunque la orden sea 0.'],
    'KM-202': ['Contactor del banco 2 del calentador.', 'Orden DO1.05; auxiliar DI1.12.'],
    'QF-102': ['Magnetotérmico de P-102 y del calentador.', 'DI1.14: 1 = armado.'],
    'PB-001': ['Pulsador de marcha y de rearme local.', 'DI1.16.'],
    'ES-001': ['Paro de emergencia: seta con contacto NC y relé de seguridad.', 'DI1.01: 1 = rearmado; 0 = pulsado o hilo roto. Lleva la planta a desvío y apaga calentador y bombas (alarma A180).'],
    'PLC-001': ['Autómata programable con tarjetas de entradas analógicas (AI), digitales (DI), salidas digitales (DO) y analógica (AO).', 'Ejecuta el programa de la planta: arranque, producción, desvío, paro de seguridad, CIP y alarmas.'],
    'HMI-001': ['Pantalla SCADA / HMI del operador.', 'Es la pantalla que estás viendo: lecturas, alarmas y mandos.'],
    'HL-001': ['Baliza luminosa de alarma.', 'DO1.09. Se enciende con una alarma activa.'],
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
    ['Qué estás viendo', '<p>Una planta industrial de pasteurización HTST de leche, con su SCADA y su planta en 3D. Está pensada para practicar <b>mantenimiento electrónico</b>: lazos 4-20 mA, alimentación de 24 V, contactores, variador y seguridad positiva.</p>'],
    ['Cómo se opera', '<p>Pulsa <b>Iniciar</b>, elige el modo (recirculación de agua, producción o CIP) y arranca. Verás que la leche solo avanza a la salida cuando TT-103 llega a la temperatura y se cumplen los enclavamientos; si no, la <b>FDV</b> la desvía.</p>'],
    ['Cómo se diagnostica', '<p>Cuando el profesor provoca una avería, no te dice cuál es. Usa los <b>síntomas del SCADA</b>, el <b>3D</b>, el <b>multímetro</b> y el <b>osciloscopio</b> (pestaña Instrumentos), anota lo que mides y, cuando lo sepas, aplica la solución en la hoja de diagnóstico.</p>'],
    ['Antes de tocar nada', '<p>En la realidad: parar, bloquear, señalizar y comprobar que no hay tensión. Ohmios y continuidad se miden sin tensión. Los mA se miden en serie. Nunca se puentean la seta ni el termostato.</p>'],
    ['Valores ilustrativos', '<p>El 72 °C durante 15 s, el diferencial de 0,07 bar y los rangos de los instrumentos son <b>ejemplos típicos</b>, no los de una instalación concreta ni los de la norma que te aplique.</p>'],
  ];

  const api = { FICHAS, construirElementos, estadoVivo, GUIA };
  if (typeof module !== 'undefined') module.exports = api; else PCT.htstTextosAyuda = api;
})();
