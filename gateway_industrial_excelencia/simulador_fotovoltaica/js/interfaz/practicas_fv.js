// Prácticas guiadas de mantenimiento (lógica pura, sin DOM; se prueba con node:test en tests/interfaz_practicas.test.js).
// Una práctica es una ORDEN DE TRABAJO con pasos que el alumno cumple usando los instrumentos del maletín (pinza, multímetro, trazador I-V, cámara, megóhmetro)
// y las protecciones del sinóptico. El guion NO mide por él: lee el cuaderno de medidas y el estado de la instalación y solo avanza cuando la medida es la pedida
// y su valor es el que corresponde. Cuatro tipos de paso:
//   'medida'    { instrumento, modo?, puntos: [[a, b], …] (alternativas), rango?: { min, max, abs? }, extra?(entrada, sim) → texto de fallo | '' }
//   'accion'    { protecciones: { tag: 'ABIERTO' }, inversores: { tag: 'APAGADO' } } (estado de la instalación)
//   'respuesta' { pregunta, opciones: [texto], correcta: índice, siFalla }
// Cada paso lleva: titulo (qué hacer), porQue (lo que se aprende al cumplirlo) y pistas (tres niveles: concepto, dónde, casi la solución).
// La avería de una práctica (si la tiene) está oculta hasta que se termina: `oculta` es lo que la página usa para ocultar lecturas y alarmas.
(function () {
  const enNode = typeof require !== 'undefined';
  const num = v => typeof v === 'number' && Number.isFinite(v);
  const enRango = (v, r) => typeof v === 'number' && !Number.isNaN(v) && v >= r.min && v <= r.max;

  const ESCENARIO = { diaAnio: 172, horaSolar: 12, nubosidad: 0, socInicialPct: 30, esperaS: 120 };
  const PUNTOS_NOTA = { pasoCompleto: 0, pista: 0.4, fallo: 0.2, peligro: 1.5 };      // restan de 10 (peligro: por maniobra peligrosa)

  /* ---------- pasos reutilizables ---------- */
  const pinza = (cadena, titulo, rango, porQue, pistas, extra) => ({ tipo: 'medida', instrumento: 'pinza', modo: 'DC', puntos: [[`${cadena}.+`], [`${cadena}.-`]], rango: Object.assign({ abs: true }, rango), titulo, porQue, pistas, extra });
  const voltios = (a, b, titulo, rango, porQue, pistas, extra) => ({ tipo: 'medida', instrumento: 'multimetro', modo: 'VDC', puntos: [[a, b]], rango: Object.assign({ abs: true }, rango), titulo, porQue, pistas, extra });
  /** Comprobación «menos que su gemelo»: la lectura del gemelo se toma en vivo (con el sol de ese momento), así vale a cualquier hora. */
  const menosQue = (gemelo, margen, que) => (e, sim, I) => { const l = I && I.lecturaMultimetro(sim, 'VDC', gemelo[0], gemelo[1]); return l && l.ok && l.valor - Math.abs(e.valor) >= margen ? '' : que; };
  const menosAmperios = (gemelo, margen, que) => (e, sim, I) => { const l = I && I.lecturaPinza(sim, gemelo, 'DC'); return l && l.ok && l.valor - Math.abs(e.valor) >= margen ? '' : que; };
  const trazador = (cadena, titulo, porQue, pistas, extra) => ({ tipo: 'medida', instrumento: 'trazadorIV', puntos: [[cadena]], titulo, porQue, pistas, extra });
  const camara = (zona, titulo, porQue, pistas, extra) => ({ tipo: 'medida', instrumento: 'termografia', puntos: [zona], titulo, porQue, pistas, extra });
  const pregunta = (pregunta, opciones, correcta, porQue, pistas, siFalla) => ({ tipo: 'respuesta', pregunta, titulo: pregunta, opciones, correcta, porQue, pistas, siFalla });

  /* ---------- las cuatro prácticas ---------- */
  const PRACTICAS = [
    {
      id: 'P1', titulo: 'Revisión de producción del campo A', nivel: 'Preventivo', duracionMin: 15, averia: null, escenario: {},
      orden: 'Revisión periódica. El cliente no ha notado nada, pero el contrato incluye comprobar que cada cadena del campo A rinde lo que debe. Compara las dos cadenas y registra las medidas: serán el punto de partida para futuras averías.',
      pasos: [
        pinza('STR-101', 'Mide con la PINZA (A⎓) la corriente de la cadena STR-101: abraza su cable positivo.', { min: 3, max: 12 }, 'Una cadena sana con sol pleno da entre 6 y 11 A. Es la primera comprobación de cualquier revisión: ¿pasa corriente?',
          ['Abre el maletín de instrumentos y coge la pinza amperimétrica.', 'Pon el selector en A⎓ (continua) y toca el cable de STR-101 en el sinóptico.', 'Toca la marca del cable «STR-101.+». Debe salir unos 8 A.']),
        pinza('STR-102', 'Ahora la cadena STR-102, con la misma pinza.', { min: 3, max: 12 }, 'Dos cadenas iguales, con el mismo sol, dan casi la misma corriente. Comparar con un igual es la base del diagnóstico.',
          ['Es la otra cadena del campo A.', 'Toca el cable «STR-102.+».', 'Debe salir muy parecida a la de STR-101 (diferencia de menos de 0,5 A).']),
        voltios('STR-101.+', 'STR-101.-', 'Mide con el MULTÍMETRO (V⎓) la tensión de trabajo de STR-101: punta roja en STR-101.+ y negra en STR-101.-.', { min: 55, max: 105 }, 'Tres paneles en serie dan unos 78 V en servicio. La corriente dice cuánto produce; la tensión, si están todos los paneles.',
          ['Coge el multímetro y ponlo en V⎓.', 'Roja en el polo positivo de STR-101, negra en el negativo.', 'Toca «STR-101.+» y después «STR-101.-». Debe salir unos 78 V (si sale negativo, tienes las puntas al revés).']),
        trazador('STR-101', 'Traza la curva I-V de STR-101 con el TRAZADOR y apunta Voc, Isc y Pmpp.', 'La curva I-V es la huella de la cadena. Si coincide con la de referencia, los paneles, los diodos y las conexiones están bien.',
          ['Coge el trazador I-V y elige la cadena STR-101.', 'Hace falta sol: con menos de 400 W/m² la curva no vale.', 'Elige STR-101 y pulsa «Trazar curva».']),
        pregunta('¿Coincide la curva de STR-101 con la de referencia?', ['Sí, ±5 %: cadena sana', 'No, tiene escalones', 'No, le falta tensión'], 0, 'Una desviación de ±5 % con la referencia se da por buena (IEC 62446-1). Fuera de ahí, hay algo que investigar.',
          ['Mira el aviso del trazador debajo de la curva.', 'Compara los valores con la curva de referencia.', 'La desviación frente a la referencia es 0 %: sana.'], 'Mira de nuevo el resultado del trazador: si no hay escalones ni pérdida de tensión, la curva coincide con la referencia.'),
        camara(/^STR-101\.mc4\./, 'Con la CÁMARA TERMOGRÁFICA, toca uno de los conectores MC4 de STR-101 y lee su temperatura.', 'Un conector sano está a temperatura similar a la del ambiente más unos grados. Un conector con mala conexión se calienta decenas de grados.',
          ['Coge la cámara termográfica.', 'Los conectores MC4 están en los cables de las cadenas.', 'Toca el conector de STR-101 (zona «STR-101.mc4.0»).'], (e, sim, I) => { const l = I && I.lecturaTermografia(sim, e.puntos[0]); return l && l.caliente ? 'Esa zona está caliente: no es lo esperado en esta revisión.' : ''; }),
        pregunta('¿Hay algún punto caliente o desigualdad entre las cadenas del campo A?', ['No: la instalación está correcta', 'Sí, en un conector', 'Sí, una cadena rinde menos'], 0, 'El parte de revisión queda: sin incidencias. Las medidas del cuaderno son tu referencia para la próxima visita.',
          ['Repasa tus medidas del cuaderno.', 'Las dos cadenas dieron lo mismo y ninguna zona estaba caliente.', 'No hay ninguna incidencia.'], 'Repasa el cuaderno: las dos corrientes eran casi iguales, la curva coincidía y el conector estaba frío.'),
      ],
      conclusion: 'Parte de revisión: campo A en estado correcto. Corrientes similares en las dos cadenas (≈ 8 A), tensión de trabajo ≈ 78 V, curva I-V igual a la de referencia y conectores sin calentamiento.',
    },
    {
      id: 'P2', titulo: 'El campo A produce la mitad', nivel: 'Correctivo', duracionMin: 25, averia: 'FUSIBLE_F101', escenario: {},
      orden: 'Aviso del cliente: «Hoy la instalación del campo A produce la mitad y no sé por qué». Sin alarmas visibles. Localiza la causa con los instrumentos y deja la instalación segura para repararla.',
      pasos: [
        pinza('STR-102', 'Empieza por la cadena STR-102 con la PINZA (A⎓): ¿cuánto da?', { min: 3, max: 12 }, 'Primero se mide lo que funciona: da la referencia con la que se compara la cadena sospechosa.',
          ['Coge la pinza amperimétrica en A⎓.', 'Abraza el cable de STR-102.', 'Toca «STR-102.+»: debe salir unos 8 A.']),
        pinza('STR-101', 'Mide ahora la cadena STR-101 con la pinza.', { min: -0.1, max: 0.1 }, 'STR-101 no lleva corriente: la mitad del campo A está fuera de servicio. Ya sabes en qué cadena buscar.',
          ['Es la otra cadena del campo A.', 'Toca el cable de STR-101 en el sinóptico.', 'Toca «STR-101.+»: marcará 0 A.']),
        voltios('STR-101.+', 'STR-101.-', 'Con el MULTÍMETRO (V⎓) mide la tensión de STR-101 (roja en STR-101.+, negra en STR-101.-).', { min: 90, max: 105 }, 'Hay tensión (los paneles están bien) pero no corriente: el circuito está abierto en algún punto aguas abajo. Descartas los paneles.',
          ['Multímetro en V⎓.', 'Mide entre los dos polos de la cadena, en la cubierta.', 'Toca «STR-101.+» y «STR-101.-»: unos 99 V en vacío.']),
        voltios('F-101.1', 'F-101.2', 'Mide con el multímetro (V⎓) entre los dos bornes del fusible F-101: «F-101.1» y «F-101.2».', { min: 5, max: 70 }, 'En un fusible sano en servicio hay 0 V entre sus bornes. Si hay tensión, el fusible está abierto: es el elemento que interrumpe la cadena.',
          ['Un fusible sano deja pasar la corriente sin caída de tensión.', 'Mira en la caja de continua CB-101: fusible de STR-101.', 'Toca «F-101.1» y «F-101.2». Si marca decenas de voltios, el fusible está fundido.']),
        pregunta('¿Qué elemento interrumpe la cadena STR-101?', ['El fusible F-101 (fundido)', 'Un conector MC4 sin enchufar', 'Un panel con el diodo en corto', 'El seccionador QS-101'], 0, 'El fusible de cadena F-101 se ha fundido. Es la causa; ahora toca dejar la instalación segura para sustituirlo.',
          ['Piensa dónde había tensión entre dos puntos que deberían estar al mismo potencial.', 'Esa tensión está en bornes de un elemento de protección.', 'Es el fusible F-101.'], 'Con tensión entre los bornes del fusible y 0 A en la cadena, el fusible está abierto.'),
        { tipo: 'accion', titulo: 'SEGURIDAD: apaga el inversor INV-101 (clic en el sinóptico, con «Maniobrar» si tienes un instrumento en la mano) y después abre el seccionador QS-101.', inversores: { 'INV-101': 'APAGADO' }, protecciones: { 'QS-101': 'ABIERTO' },
          porQue: 'La continua con sol no se apaga sola: abrir un seccionador con carga provoca un arco. Primero se quita la carga (inversor), luego se abre. Nunca al revés.',
          pistas: ['Para abrir en continua sin arco hay que quitar antes la carga.', 'Apaga INV-101 y después abre QS-101.', 'Toca INV-101 (apagar) y luego QS-101 (abrir), en ese orden.'] },
        { tipo: 'medida', instrumento: 'multimetro', modo: 'OHM', puntos: [['F-101.1', 'F-101.2']], rango: { min: 1e6, max: Infinity }, titulo: 'Con la instalación sin carga, mide la CONTINUIDAD (Ω) del fusible F-101 entre «F-101.1» y «F-101.2».',
          porQue: 'Sin tensión, la continuidad confirma el diagnóstico: un fusible fundido marca OL (circuito abierto). Un sano marcaría casi 0 Ω.',
          pistas: ['Pon el multímetro en continuidad (Ω).', 'Los mismos dos bornes del fusible.', 'Debe salir OL (circuito abierto).'] },
      ],
      conclusion: 'Parte de avería: fusible de cadena F-101 fundido. Cadena STR-101 sin corriente (0 A) con Voc normal (≈ 99 V). Instalación asegurada (INV-101 apagado, QS-101 abierto). Reparación: sustituir por un fusible gPV del mismo calibre tras comprobar la cadena (curva I-V y aislamiento).',
    },
    {
      id: 'P3', titulo: 'Una cadena rinde menos (diodo de paso)', nivel: 'Correctivo', duracionMin: 25, averia: 'DIODO_BYPASS_PV104', escenario: {},
      orden: 'Aviso: «El campo A rinde un poco menos de lo normal, sin ninguna alarma». Localiza si la pérdida está en una cadena, en qué panel y por qué.',
      pasos: [
        pinza('STR-101', 'Mide con la PINZA (A⎓) la corriente de STR-101.', { min: 3, max: 12 }, 'La corriente de STR-101 es normal: es la referencia de un igual sano.',
          ['Pinza en A⎓.', 'Abraza el cable positivo de la cadena.', 'Toca «STR-101.+».']),
        pinza('STR-102', 'Mide ahora la corriente de STR-102 y compárala con la anterior.', { min: 2, max: 12 }, 'STR-102 lleva claramente menos corriente que su gemela. Dos cadenas iguales con el mismo sol deberían dar lo mismo: aquí hay algo.',
          ['Es la gemela de STR-101.', 'Toca «STR-102.+».', 'Debe salir ≈ 1 A menos que STR-101 (≈ 7,7 A frente a ≈ 8,8 A).'],
          menosAmperios('STR-101.+', 0.4, 'Esa corriente no es claramente menor que la de STR-101: compara bien las dos cadenas.')),
        trazador('STR-102', 'Traza la curva I-V de STR-102 con el TRAZADOR y fíjate en la Voc frente a la referencia.', 'La Voc de STR-102 sale un 11 % por debajo de la esperada con la Isc normal: falta tensión, no corriente. Falta un tercio de un panel.',
          ['Trazador I-V, cadena STR-102.', 'Compara la Voc medida con la de referencia.', 'Busca el aviso de «Voc por debajo de la esperada».']),
        pregunta('¿Qué se deduce de la curva de STR-102?', ['Falta tensión: un panel o parte de él no aporta', 'Falta corriente: suciedad o sombra', 'Resistencia en serie en un conector'], 0, 'Pérdida de Voc con Isc normal: parte de la cadena en serie está puenteada. No es suciedad (esa baja la corriente).',
          ['Voc mide la tensión; Isc, la corriente.', 'La que falla es la tensión.', 'Falta parte de la cadena en serie.'], 'Voc más baja con Isc normal indica menos células en serie aportando, no menos luz ni más resistencia.'),
        voltios('PV-104.+', 'PV-104.-', 'Mide con el MULTÍMETRO (V⎓) la tensión del panel PV-104 (punta roja en «PV-104.+», negra en «PV-104.-»).', { min: 8, max: 24 }, 'PV-104 da unos 18 V y debería dar 26: falta un tercio. Un panel sano da unos 26 V.',
          ['Multímetro en V⎓.', 'Mide panel por panel; PV-104 es el sospechoso.', 'Toca «PV-104.+» y «PV-104.-».'],
          menosQue(['PV-105.+', 'PV-105.-'], 5, 'Ese panel da casi lo mismo que su vecino: mide el que tiene menos tensión.')),
        voltios('PV-105.+', 'PV-105.-', 'Mide a PV-105 (su vecino) para comparar.', { min: 20, max: 33 }, 'El vecino da 26-27 V: PV-104 tiene unos 9 V menos. Comparar con un igual confirma el panel.',
          ['Es el panel de al lado de la misma cadena.', 'Toca «PV-105.+» y «PV-105.-».', 'Debe salir unos 27 V.']),
        camara(/^PV-104\.s/, 'Con la CÁMARA TERMOGRÁFICA, toca la subcadena PV-104.s1 de ese panel.', 'La subcadena puenteada está más caliente: no entrega potencia y disipa su parte en forma de calor.',
          ['Cámara termográfica.', 'Mira dentro de PV-104.', 'Toca la zona «PV-104.s1».'], (e, sim, I) => { const l = I && I.lecturaTermografia(sim, e.puntos[0]); return l && l.zona && l.zona.deltaC >= 5 ? '' : 'Esa zona no destaca: busca la subcadena más caliente de PV-104.'; }),
        pregunta('¿Cuál es la causa?', ['Diodo de paso de PV-104 en cortocircuito', 'Fusible F-101 fundido', 'Suciedad en el campo A', 'Cadena abierta'], 0, 'El diodo de paso de PV-104 está en cortocircuito: puentea permanentemente su subcadena y el panel da dos tercios de la tensión. Se sustituye el diodo o el panel.',
          ['Un panel da dos tercios de la tensión.', 'Hay un elemento que puentea una subcadena.', 'Es el diodo de paso de PV-104.'], 'Si fuera el fusible o una cadena abierta no habría corriente; suciedad bajaría la corriente. Aquí falta tensión de un panel.'),
      ],
      conclusion: 'Parte de avería: diodo de paso de PV-104 en cortocircuito. STR-102 con ≈ 11 % menos de Voc, PV-104 con ≈ 18 V frente a 27 V de su vecino y subcadena PV-104.s1 caliente. Reparación: sustituir el diodo en la caja de conexiones del panel o el panel completo.',
    },
    {
      id: 'P4', titulo: 'Punto caliente en un conector', nivel: 'Correctivo', duracionMin: 25, averia: 'CONECTOR_RESISTIVO_B2', escenario: {},
      orden: 'Aviso: «La entrada MPPT2 del ZCS entrega menos que la MPPT1 con el mismo sol, y no hay alarma». Encuentra el origen. Cuidado: un conector con mala conexión puede arder.',
      pasos: [
        voltios('INV-201.mppt1+', 'INV-201.mppt1-', 'Mide con el MULTÍMETRO (V⎓) la entrada MPPT1 del ZCS: «INV-201.mppt1+» y «INV-201.mppt1-».', { min: 85, max: 125 }, 'La MPPT1 trabaja normal (≈ 111 V): es la referencia de un igual sano.',
          ['Multímetro en V⎓.', 'Mide en las entradas del inversor ZCS.', 'Toca «INV-201.mppt1+» y «INV-201.mppt1-».']),
        voltios('INV-201.mppt2+', 'INV-201.mppt2-', 'Mide ahora la entrada MPPT2.', { min: 70, max: 125 }, 'La MPPT2 trabaja a ≈ 101 V, 10 V menos: pierde tensión por el camino. Caída de tensión = resistencia anormal en serie.',
          ['La otra entrada del ZCS.', 'Toca «INV-201.mppt2+» y «INV-201.mppt2-».', 'Debe salir ≈ 101 V frente a 111 V de la MPPT1.'],
          menosQue(['INV-201.mppt1+', 'INV-201.mppt1-'], 4, 'La MPPT2 no marca claramente menos que la MPPT1: repasa los puntos.')),
        trazador('STR-202', 'Traza la curva I-V de STR-202 (la que alimenta la MPPT2) con el TRAZADOR.', 'La curva sale «tumbada» y con menos Pmpp: factor de forma bajo con Voc e Isc casi normales. Es la huella de una resistencia en serie.',
          ['Trazador I-V, cadena STR-202.', 'Compara el factor de forma con el de la referencia.', 'Busca el aviso «Factor de forma bajo… resistencia en serie».']),
        pregunta('¿Qué indica un factor de forma bajo con Voc e Isc casi normales?', ['Una resistencia en serie (conexión mala)', 'Suciedad en los paneles', 'Un diodo de paso en cortocircuito'], 0, 'Una resistencia en serie «tumba» la curva sin cambiar Voc ni Isc. Los conectores MC4 son su sospechoso habitual.',
          ['La suciedad baja la corriente; el diodo en corto baja la tensión.', 'Aquí cambia la forma de la curva.', 'Es una resistencia en serie: una conexión mala.']),
        camara(/^STR-202\.mc4\./, 'Con la CÁMARA TERMOGRÁFICA, recorre los conectores MC4 de STR-202 hasta encontrar el punto caliente y tócalo.', 'Un conector con alta resistencia disipa decenas de vatios: el punto caliente delata la conexión defectuosa antes de que arda.',
          ['Cámara termográfica.', 'Los conectores MC4 de STR-202 están entre sus paneles.', 'Es el conector «STR-202.mc4.2».'], (e, sim, I) => { const l = I && I.lecturaTermografia(sim, e.puntos[0]); return l && l.caliente ? '' : 'Esa zona está a temperatura normal: sigue buscando el conector que destaca.'; }),
        pregunta('¿Cuál es la causa?', ['Conector MC4 con alta resistencia', 'Diodo de paso en cortocircuito', 'Fusible fundido', 'Fallo de aislamiento'], 0, 'Un conector MC4 mal crimpado o sin la presión adecuada tiene resistencia alta: calienta y roba potencia. Hay que cambiarlo, nunca apretarlo en caliente.',
          ['Algo que se calienta y pierde tensión.', 'No es un elemento de protección.', 'Es el conector MC4.'], 'El punto caliente en un conector, con caída de tensión y la curva tumbada, indica un conector defectuoso.'),
        { tipo: 'accion', titulo: 'SEGURIDAD antes de tocar nada: apaga el inversor INV-201 y abre el seccionador QS-201.', inversores: { 'INV-201': 'APAGADO' }, protecciones: { 'QS-201': 'ABIERTO' },
          porQue: 'Nunca se desconecta un MC4 con carga: el arco en continua puede quemar el conector y a quien lo toque. Primero se quita la carga, después se abre el seccionador.',
          pistas: ['Quita la carga antes de abrir.', 'INV-201 primero y QS-201 después.', 'Toca INV-201 (apagar) y luego QS-201 (abrir).'] },
      ],
      conclusion: 'Parte de avería: conector MC4 con alta resistencia en STR-202 (entre PV-206 y PV-207, zona STR-202.mc4.2, ≈ 109 °C). MPPT2 ≈ 10 V por debajo de MPPT1, factor de forma bajo. Instalación asegurada (INV-201 apagado, QS-201 abierto). Reparación: sustituir el par de conectores MC4 con el crimpado y la herramienta adecuados.',
    },
  ];

  /** ¿La instalación está como pide un paso de acción (protecciones e inversores en el estado indicado)? */
  function accionCumplida(p, estado) {
    const e = estado || {};
    const protOk = Object.entries(p.protecciones || {}).every(([t, est]) => e.protecciones && e.protecciones[t] && e.protecciones[t].estado === est);
    const invOk = Object.entries(p.inversores || {}).every(([t, est]) => e.inversores && e.inversores[t] && e.inversores[t].estado === est);
    return protOk && invOk;
  }

  /* ---------- el guion de una práctica ---------- */
  const claveCasa = (a, b) => [...a].map(String).sort().join('|') === [...b].map(String).sort().join('|');
  /** ¿La entrada del cuaderno corresponde al instrumento, modo y puntos que pide el paso? */
  function entradaCasa(e, p) {
    if (!e || e.instrumento !== p.instrumento || (p.modo && e.modo !== p.modo)) return false;
    return (p.puntos || []).some(alt => (alt instanceof RegExp ? (e.puntos || []).length === 1 && alt.test(e.puntos[0]) : claveCasa(alt, e.puntos || [])));
  }
  /** Resultado de mirar el cuaderno para un paso de medida: { ok } | { ok: false, texto } | { ok: false, falta: true }. */
  function mirarMedida(p, lista, sim, I) {
    const cand = lista.filter(e => entradaCasa(e, p));
    if (!cand.length) return { ok: false, falta: true };
    let ultimoFallo = '';
    for (const e of cand.slice().reverse()) {
      if (e.peligro || e.valida === false) { ultimoFallo = 'Esa medida no es válida (maniobra o lectura peligrosa). Corrígela y repítela.'; continue; }
      if (p.rango) {
        const crudo = e.valor === null && /^OL|circuito abierto/i.test(e.texto || '') ? Infinity : e.valor, v = p.rango.abs && num(crudo) ? Math.abs(crudo) : crudo;      // «OL» del óhmetro = circuito abierto
        if (!enRango(v, p.rango)) { ultimoFallo = `Has medido ${e.texto || 'otro valor'}, pero el valor no es el esperado en este punto. Repasa el selector del instrumento, la polaridad y que haya sol.`; continue; }
      }
      const extra = p.extra ? p.extra(e, sim, I) : '';
      if (extra) { ultimoFallo = extra; continue; }
      return { ok: true };
    }
    return { ok: false, texto: ultimoFallo };
  }

  /**
   * Crea el guion de una práctica. ctx: { sim() → simulación, cuaderno, I? (instrumentos_fv, para las comprobaciones extra), peligro?(d, estado) → texto }.
   * API: pasoActual() → paso | null, indice, evaluar() → { avanzo, mensaje }, responder(k) → { ok, mensaje }, pista() → texto, pistasUsadas, fallos, peligros, anotarPeligro(texto),
   *   hecho (todos los pasos), nota() → 0–10, resumen() → { titulo, nota, pasos, pistas, fallos, peligros, conclusion }.
   */
  function crearGuion(practica, ctx) {
    let indice = 0, pistas = 0, fallos = 0, nPeligros = 0, nivelPista = 0, ultimoMensaje = '', completados = [];
    const cuaderno = ctx.cuaderno, I = ctx.I;
    const sim = () => ctx.sim();
    const lista = () => (cuaderno ? cuaderno.lista() : []);
    const g = {
      practica,
      get indice() { return indice; },
      get hecho() { return indice >= practica.pasos.length; },
      get pistasUsadas() { return pistas; },
      get fallos() { return fallos; },
      get peligros() { return nPeligros; },
      get completados() { return completados.slice(); },
      get ultimoMensaje() { return ultimoMensaje; },
      pasoActual() { return indice < practica.pasos.length ? practica.pasos[indice] : null; },
      /** Mira el cuaderno y la instalación; si el paso actual está cumplido, avanza (y los siguientes si ya estaban cumplidos). */
      evaluar() {
        let avanzo = false, mensaje = '';
        while (indice < practica.pasos.length) {
          const p = practica.pasos[indice];
          if (p.tipo === 'respuesta') break;      // solo avanza con responder()
          let ok = false;
          if (p.tipo === 'medida') {
            const r = mirarMedida(p, lista(), sim(), I);
            if (r.ok) ok = true; else if (r.texto && r.texto !== ultimoMensaje) { fallos++; mensaje = r.texto; ultimoMensaje = r.texto; }
          } else if (p.tipo === 'accion') {
            ok = accionCumplida(p, sim().estado);
          }
          if (!ok) break;
          completados.push({ id: indice, porQue: p.porQue }); indice++; nivelPista = 0; avanzo = true; ultimoMensaje = '';
        }
        return { avanzo, mensaje };
      },
      /** Contesta el paso de tipo 'respuesta' con la opción k. */
      responder(k) {
        const p = g.pasoActual();
        if (!p || p.tipo !== 'respuesta') return { ok: false, mensaje: '' };
        if (Number(k) === p.correcta) { completados.push({ id: indice, porQue: p.porQue }); indice++; nivelPista = 0; ultimoMensaje = ''; g.evaluar(); return { ok: true, mensaje: p.porQue }; }
        fallos++; ultimoMensaje = p.siFalla || 'No es esa. Vuelve a mirar tus medidas.'; return { ok: false, mensaje: ultimoMensaje };
      },
      /** Siguiente pista del paso actual (3 niveles; cada una resta nota). */
      pista() {
        const p = g.pasoActual(); if (!p) return '';
        const lv = Math.min(nivelPista, (p.pistas || []).length - 1);
        if (nivelPista < (p.pistas || []).length) { nivelPista++; pistas++; }
        return (p.pistas || [])[lv] || '';
      },
      nivelPista: () => nivelPista,
      anotarPeligro(texto) { nPeligros++; ultimoMensaje = texto || ultimoMensaje; },
      /** Nota de 0 a 10: 10 menos las pistas, los fallos y las maniobras peligrosas. */
      nota() { return Math.max(0, Math.min(10, +(10 - pistas * PUNTOS_NOTA.pista - fallos * PUNTOS_NOTA.fallo - nPeligros * PUNTOS_NOTA.peligro).toFixed(1))); },
      resumen() { return { id: practica.id, titulo: practica.titulo, nota: g.nota(), pasos: practica.pasos.length, pistas, fallos, peligros: nPeligros, conclusion: practica.conclusion }; },
    };
    return g;
  }

  /**
   * Corrige un EXAMEN de la práctica: el alumno ha medido libremente (sin pistas ni ✓) y entrega las respuestas de las preguntas de la práctica de una vez.
   * ctx: { sim() , cuaderno, I, respuestas: { [índice de paso]: opción elegida }, peligros }. Nota de 0 a 10: la mitad por las medidas y maniobras que la práctica pide
   * (en cualquier orden, con su valor correcto) y la otra mitad por las respuestas; cada maniobra peligrosa resta 1,5.
   * → { nota, medidas: { hechas, total }, respuestas: { acertadas, total }, peligros, detalle } (detalle es lo que se envía al aula).
   */
  function evaluarExamen(practica, ctx) {
    const lista = ctx.cuaderno ? ctx.cuaderno.lista() : [], estado = ctx.sim().estado;
    let hechas = 0, totalM = 0, acertadas = 0, totalR = 0;
    const pasos = [];
    practica.pasos.forEach((p, k) => {
      let ok;
      if (p.tipo === 'respuesta') { totalR++; ok = Number((ctx.respuestas || {})[k]) === p.correcta; if (ok) acertadas++; }
      else { totalM++; ok = p.tipo === 'accion' ? accionCumplida(p, estado) : mirarMedida(p, lista, ctx.sim(), ctx.I).ok; if (ok) hechas++; }
      pasos.push({ paso: k + 1, tipo: p.tipo, ok: !!ok });
    });
    const peligros = ctx.peligros || 0;
    const base = 10 * (0.5 * (totalM ? hechas / totalM : 1) + 0.5 * (totalR ? acertadas / totalR : 1));
    const nota = Math.max(0, Math.min(10, +(base - PUNTOS_NOTA.peligro * peligros).toFixed(1)));
    // Lo que se guarda en el aula y va al informe: las respuestas dadas, qué pedía cada paso y qué medió el alumno (el cuaderno, como evidencia)
    const corto = (t, n) => String(t == null ? '' : t).slice(0, n);
    const detRespuestas = [], detPasos = pasos.map((x, k) => Object.assign({}, x, { titulo: corto(practica.pasos[k].titulo, 140) }));
    practica.pasos.forEach((p, k) => {
      if (p.tipo !== 'respuesta') return;
      const e = (ctx.respuestas || {})[k], dada = e === undefined || e === null ? null : Number(e);
      detRespuestas.push({ pregunta: corto(p.pregunta, 140), elegida: dada === null ? '' : corto(p.opciones[dada], 120), correcta: corto(p.opciones[p.correcta], 120), ok: dada === p.correcta });
    });
    const detCuaderno = lista.slice(-25).map(e => ({ hora: corto(e.hora, 20), instrumento: e.instrumento, modo: e.modo || '', puntos: (e.puntos || []).slice(0, 2).join(' ↔ '), texto: corto(e.texto, 80), valida: e.valida !== false && !e.peligro, peligro: !!e.peligro }));
    return { nota, medidas: { hechas, total: totalM }, respuestas: { acertadas, total: totalR }, peligros,
      detalle: { practica: practica.id, titulo: practica.titulo, nota, intento: ctx.intento || 1, resumenMedidas: `${hechas} de ${totalM}`, resumenRespuestas: `${acertadas} de ${totalR}`, peligros,
        pasos: detPasos, respuestas: detRespuestas, cuaderno: detCuaderno } };
  }

  /* ---------- informe descargable (alumno y profesor) ---------- */
  const escH = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const notaTxt = n => (typeof n === 'number' ? n.toFixed(1).replace('.', ',') : '—');
  const NOMBRE_INSTR = { multimetro: 'Multímetro', pinza: 'Pinza', megohmetro: 'Megóhmetro', trazadorIV: 'Trazador I-V', termografia: 'Cámara térmica' };
  /**
   * Informe de una práctica o de un examen como documento HTML autónomo (se imprime o se guarda como PDF desde el navegador).
   * info: { alumno?, fecha, tipo: 'Examen' | 'Práctica', intento?, intentosMax?, cerrado (¿se enseñan las respuestas correctas y los pasos pedidos?), detalle: el `detalle` de evaluarExamen,
   *   o de una práctica guiada: { practica, titulo, nota, pistas, fallos, peligros, pasos: [{ titulo, ok }], cuaderno, conclusion } }.
   * Mientras al alumno le queden intentos (`cerrado` false) NO se incluyen las respuestas correctas ni qué pedía cada paso, para no regalar el examen.
   */
  function informeHtml(info) {
    const d = info.detalle || {}, cerrado = !!info.cerrado;
    const filasResp = (d.respuestas || []).map(r => `<tr><td>${escH(r.pregunta)}</td><td>${escH(r.elegida || 'Sin contestar')}</td>${cerrado ? `<td>${escH(r.correcta)}</td><td class="${r.ok ? 'ok' : 'mal'}">${r.ok ? '✓ Correcta' : '✗ Incorrecta'}</td>` : ''}</tr>`).join('');
    const filasMed = (d.cuaderno || []).map(e => `<tr><td>${escH(e.hora)}</td><td>${escH(NOMBRE_INSTR[e.instrumento] || e.instrumento)}${e.modo ? ' ' + escH(e.modo) : ''}</td><td>${escH(e.puntos)}</td><td>${escH(e.texto)}${e.peligro ? ' <b class="mal">(peligrosa)</b>' : ''}</td></tr>`).join('');
    const filasPasos = (d.pasos || []).filter(x => x.titulo).map(x => `<tr><td>${x.paso || ''}</td><td>${escH(x.titulo)}</td><td class="${x.ok ? 'ok' : 'mal'}">${x.ok ? '✓' : '✗'}</td></tr>`).join('');
    const resumen = [info.tipo === 'Examen' ? [`Medidas y maniobras pedidas`, d.resumenMedidas] : null, info.tipo === 'Examen' ? [`Respuestas acertadas`, d.resumenRespuestas] : null,
      d.pistas !== undefined ? ['Pistas usadas', d.pistas] : null, d.fallos !== undefined ? ['Respuestas o medidas erróneas', d.fallos] : null, ['Maniobras peligrosas', d.peligros || 0]].filter(Boolean);
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Informe · ${escH(d.titulo || info.titulo || 'Práctica')}</title>
<style>body{font:16px/1.45 system-ui,sans-serif;margin:24px auto;max-width:820px;padding:0 16px;color:#1b1b1b}h1{margin:0 0 4px;font-size:1.4rem}h2{margin:22px 0 6px;font-size:1.1rem;border-bottom:2px solid #d0d0d0}.meta{color:#555;margin:0 0 12px}.nota{font-size:2rem;font-weight:700;margin:8px 0}table{border-collapse:collapse;width:100%;font-size:.92rem}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f1f1f1}.ok{color:#1b6e2d;font-weight:700}.mal{color:#a01818;font-weight:700}ul{padding-left:20px}footer{margin-top:28px;font-size:.8rem;color:#666}@media print{body{margin:0}}</style></head><body>
<h1>Informe de ${escH(info.tipo === 'Examen' ? 'examen' : 'práctica')} · ${escH(d.titulo || info.titulo || '')}</h1>
<p class="meta">${info.alumno ? `Alumno: <b>${escH(info.alumno)}</b> · ` : ''}${escH(info.fecha || '')}${info.intento ? ` · Intento ${info.intento}${info.intentosMax ? ' de ' + info.intentosMax : ''}` : ''} · Simulador fotovoltaico · CIFP Politécnico de Cartagena</p>
<p class="nota">Nota: ${notaTxt(d.nota)} / 10</p>
<ul>${resumen.map(([k, v]) => `<li>${escH(k)}: <b>${escH(v)}</b></li>`).join('')}</ul>
${filasResp ? `<h2>Respuestas</h2><table><thead><tr><th>Pregunta</th><th>Tu respuesta</th>${cerrado ? '<th>Respuesta correcta</th><th>Resultado</th>' : ''}</tr></thead><tbody>${filasResp}</tbody></table>${cerrado ? '' : '<p class="meta">Las respuestas correctas se mostrarán cuando termines todos tus intentos.</p>'}` : ''}
${filasMed ? `<h2>Medidas realizadas (cuaderno)</h2><table><thead><tr><th>Hora</th><th>Instrumento</th><th>Puntos</th><th>Lectura</th></tr></thead><tbody>${filasMed}</tbody></table>` : ''}
${cerrado && filasPasos ? `<h2>Pasos pedidos</h2><table><thead><tr><th>N.º</th><th>Qué se pedía</th><th></th></tr></thead><tbody>${filasPasos}</tbody></table>` : ''}
${cerrado && d.conclusion ? `<h2>Parte de mantenimiento</h2><p>${escH(d.conclusion)}</p>` : ''}
<footer>© 2026 Álvar Legaz Aparicio · Todos los derechos reservados.</footer></body></html>`;
  }
  /** Nombre de archivo del informe: «informe_examen_P3_2026-11-24.html». */
  const nombreInforme = (tipo, id, fecha) => `informe_${tipo === 'Examen' ? 'examen' : 'practica'}_${id}_${String(fecha || '').replace(/[^0-9-]/g, '').slice(0, 10) || 'hoy'}.html`;

  /** Icono de la operación de un paso: { glifo, etiqueta, clase }. El glifo es el mismo que lleva el instrumento en el maletín. */
  function icono(paso) {
    if (!paso) return { glifo: '', etiqueta: '', clase: '' };
    if (paso.tipo === 'respuesta') return { glifo: '?', etiqueta: 'Pregunta', clase: 'pregunta' };
    if (paso.tipo === 'accion') return { glifo: '⏻', etiqueta: 'Maniobra de seguridad', clase: 'accion' };
    if (paso.instrumento === 'pinza') return { glifo: 'A', etiqueta: 'Pinza amperimétrica', clase: 'pinza' };
    if (paso.instrumento === 'trazadorIV') return { glifo: 'I-V', etiqueta: 'Trazador I-V', clase: 'trazador' };
    if (paso.instrumento === 'termografia') return { glifo: '°C', etiqueta: 'Cámara termográfica', clase: 'camara' };
    if (paso.instrumento === 'megohmetro') return { glifo: 'MΩ', etiqueta: 'Megóhmetro', clase: 'megohmetro' };
    return paso.modo === 'OHM' ? { glifo: 'Ω', etiqueta: 'Multímetro en continuidad', clase: 'multimetro' } : { glifo: 'V', etiqueta: 'Multímetro', clase: 'multimetro' };
  }

  /** Firma que entiende la página (ponerAveriaOculta) para una práctica: escenario base con los cambios de la práctica. */
  const firmaDe = practica => ({ escenario: Object.assign({}, ESCENARIO, practica.escenario || {}) });
  const porId = id => PRACTICAS.find(p => p.id === id) || null;

  const api = { PRACTICAS, PUNTOS_NOTA, ESCENARIO, crearGuion, evaluarExamen, informeHtml, nombreInforme, accionCumplida, firmaDe, porId, icono, entradaCasa, mirarMedida };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') (window.PCT = window.PCT || {}).fvPracticas = api;
})();
