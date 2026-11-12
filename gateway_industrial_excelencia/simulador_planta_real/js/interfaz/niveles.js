// Niveles de dificultad de la planta real HTST (divulgación progresiva). Los tres niveles usan el MISMO simulador; solo cambia lo que se enseña:
//   Nivel 1 «Conocer la planta»: solo el recorrido de la leche, con nombres sencillos y sin siglas; 2 modos (Parada y Automático); sin averías ni instrumentos.
//   Nivel 2 «Operar»: todos los equipos con sus tags, los 5 modos, el panel Manual, las alarmas y las lecturas de los instrumentos en solo lectura.
//   Nivel 3 «Mantenimiento»: todo (averías, multímetro, osciloscopio, hojas de calibración y de enclavamientos, panel del profesor).
// Este archivo es DECLARATIVO y solo contiene funciones puras (se prueban con node:test): qué ve cada nivel, qué modos y pestañas se permiten, los nombres y
// textos sencillos del nivel 1 y el estado en lenguaje claro. Quien dibuja (pagina.js, esquema_htst.js, ayuda_htst.js, visor_htst.js) solo pregunta aquí.
(function () {
  const NIVELES = {
    1: { id: 1, nombre: 'Conocer la planta', corto: 'Conocer',
      descripcion: 'Solo el recorrido de la leche, con nombres sencillos. Pulsa Iniciar y elige Automático para ver cómo se pasteuriza la leche.' },
    2: { id: 2, nombre: 'Operar', corto: 'Operar',
      descripcion: 'Todos los equipos con sus códigos, los cinco modos (también Manual), las alarmas y las lecturas de los instrumentos.' },
    3: { id: 3, nombre: 'Mantenimiento', corto: 'Mantenimiento',
      descripcion: 'Todo: averías, multímetro, osciloscopio y hojas de calibración y de pruebas de enclavamientos.' },
  };
  const IDS = [1, 2, 3];
  const NIVEL_POR_DEFECTO = 1;                  // quien entra por primera vez empieza por el más sencillo
  const NIVEL_PROFESOR = 3;                     // el profesor, si no ha elegido nada, ve todo
  const CLAVE_ALMACEN = 'htst-nivel';

  /** 1, 2 o 3 si el valor es válido (número o texto); si no, null. */
  function nivelValido(valor) {
    const n = Number(valor);
    return IDS.includes(n) && String(valor).trim() !== '' ? n : null;
  }

  const parametros = busqueda => { try { return new URLSearchParams(busqueda || ''); } catch (error) { return new URLSearchParams(''); } };

  /** Nivel con el que arranca la página: ?nivel= de la dirección, si no el guardado en el navegador, si no 1 (o 3 para el profesor). */
  function nivelInicial({ search = '', guardado = null, profesor = false } = {}) {
    return nivelValido(parametros(search).get('nivel')) || nivelValido(guardado) || (profesor ? NIVEL_PROFESOR : NIVEL_POR_DEFECTO);
  }
  /** Con &bloquear=1 (o true) el selector queda deshabilitado: así el profesor fija el nivel con un enlace. Solo vale si la dirección trae un nivel válido. */
  function bloqueado(search) {
    const p = parametros(search);
    return nivelValido(p.get('nivel')) !== null && ['1', 'true', 'si', 'sí'].includes(String(p.get('bloquear') || '').toLowerCase());
  }

  /* ---------- qué equipos se ven en el 2D y en el 3D ---------- */
  // Nivel 1: el recorrido de la leche. Todo lo demás (sensores, válvulas de llenado, limpieza, armario, contactores) aparece en el nivel 2.
  const EQUIPOS_NIVEL_1 = ['TK-101', 'P-101', 'HX-101', 'HT-101', 'FDV-101', 'HW-201', 'P-201'];
  const NOMBRES_SENCILLOS = {
    'TK-101': 'Tanque de leche', 'P-101': 'Bomba de leche', 'HX-101': 'Intercambiador de placas', 'HT-101': 'Tubo de residencia',
    'FDV-101': 'Válvula de desvío', 'HW-201': 'Calentador de agua', 'P-201': 'Bomba de agua caliente',
  };
  /** Nivel mínimo en el que un equipo (tag) aparece: 1 para el recorrido de la leche, 2 para el resto. */
  const nivelMinimoDeTag = tag => (EQUIPOS_NIVEL_1.includes(tag) ? 1 : 2);
  const visibleEnNivel = (tag, nivel) => nivelMinimoDeTag(tag) <= nivel;
  /** Lista de tags visibles en un nivel, dada la lista completa (p. ej., los de la escena). */
  const tagsVisibles = (tags, nivel) => [...tags].filter(t => visibleEnNivel(t, nivel));
  const nombreSencillo = tag => NOMBRES_SENCILLOS[tag] || null;

  /* ---------- modos y pestañas ---------- */
  // En el nivel 1 el selector solo ofrece «Parada» y «Automático» (que arranca: recirculación y, cuando se cumplen las condiciones, producción).
  const OPCIONES_NIVEL_1 = [{ valor: 'PARADA', nombre: 'Parada' }, { valor: 'AUTO', nombre: 'Automático' }];
  const MODOS_PLC = ['PARADA', 'MANUAL', 'RECIRCULACION_AGUA', 'PRODUCCION', 'CIP'];
  const MODOS_NIVEL_1 = ['PARADA', 'RECIRCULACION_AGUA', 'PRODUCCION'];

  /** Opciones del selector de modo: [{ valor, nombre }]. En los niveles 2 y 3, los modos del PLC con sus nombres (nombreDe(modo)). */
  function opcionesDeModo(nivel, ordenModos = MODOS_PLC, nombreDe = m => m) {
    return nivel === 1 ? OPCIONES_NIVEL_1.slice() : ordenModos.map(m => ({ valor: m, nombre: nombreDe(m) }));
  }
  /** ¿Se puede estar en este modo del PLC en este nivel? */
  const modoPermitido = (nivel, modo) => (nivel === 1 ? MODOS_NIVEL_1.includes(modo) : MODOS_PLC.includes(modo));
  /** Modo del PLC más cercano que sí se permite (MANUAL y CIP no existen en el nivel 1: se pasa a PARADA). */
  const modoMasCercano = (nivel, modo) => (modoPermitido(nivel, modo) ? modo : 'PARADA');
  /** Valor del selector que corresponde a un modo del PLC (en el nivel 1, RECIRCULACIÓN y PRODUCCIÓN son «Automático»). */
  const valorDeSelector = (nivel, modo) => (nivel === 1 ? (modo === 'PARADA' ? 'PARADA' : 'AUTO') : modo);

  const PESTANAS = {
    1: ['p-graficas'],
    2: ['p-alarmas', 'p-manual', 'p-graficas', 'p-instrumentos'],
    3: ['p-alarmas', 'p-manual', 'p-graficas', 'p-instrumentos', 'p-hojas', 'p-profesor'],
  };
  const pestanasPermitidas = nivel => (PESTANAS[nivel] || PESTANAS[3]).slice();
  const pestanaPermitida = (nivel, id) => pestanasPermitidas(nivel).includes(id);
  /** Capacidades por nivel (para mostrar u ocultar de una vez cada pieza de la interfaz). */
  const capacidades = nivel => ({
    siglas: nivel >= 2, modoManual: nivel >= 2, alarmasCompletas: nivel >= 2, consigna: nivel >= 2, lecturasInstrumentos: nivel === 2,
    herramientasMedida: nivel >= 3, hojas: nivel >= 3, averias: nivel >= 3, profesor: nivel >= 3, medirEnFicha: nivel >= 3,
  });

  /* ---------- nivel 1: textos sencillos ---------- */
  const FICHAS_NIVEL_1 = {
    'TK-101': { queEs: 'Es el depósito donde espera la leche antes de entrar en la máquina.',
      queHace: 'Guarda la leche y la deja salir hacia la bomba. Si la leche no está bien pasteurizada, vuelve aquí.' },
    'P-101': { queEs: 'Es la bomba que empuja la leche por toda la instalación.',
      queHace: 'Cuando se enciende, mueve la leche por el intercambiador y el tubo. Si va más rápido, pasa más leche cada hora.' },
    'HX-101': { queEs: 'Son muchas placas de acero finas: por un lado pasa la leche y por el otro, agua. Así se pasa el calor sin mezclarlas.',
      queHace: 'Tiene 3 zonas. La primera precalienta la leche con el calor de la que ya está caliente. La segunda la calienta con agua caliente. La tercera la enfría con agua fría.' },
    'HT-101': { queEs: 'Es un tubo largo y aislado por el que la leche caliente tiene que tardar un rato.',
      queHace: 'Para quedar pasteurizada, la leche debe estar unos 15 segundos a 72 °C o más. El tubo hace que tarde ese tiempo.' },
    'FDV-101': { queEs: 'Es la válvula que decide si la leche sigue adelante o vuelve atrás.',
      queHace: 'Si la leche llega a 72 °C, la deja pasar a la salida. Si no llega, la devuelve al tanque para que nunca salga leche mal pasteurizada. Es una seguridad.' },
    'HW-201': { queEs: 'Calienta el agua que luego calienta la leche.',
      queHace: 'Tiene dos resistencias eléctricas dentro del agua. El agua caliente circula por el intercambiador y le pasa su calor a la leche, sin mezclarse con ella.' },
    'P-201': { queEs: 'Es la bomba que hace circular el agua caliente.',
      queHace: 'Mueve el agua desde el calentador hasta el intercambiador y la devuelve. Sin esta bomba, la leche no se calienta.' },
  };
  /** Ficha sencilla del nivel 1: { nombre, queEs, queHace } o null si el equipo no está en ese nivel. */
  const fichaSencilla = tag => (FICHAS_NIVEL_1[tag] ? Object.assign({ nombre: NOMBRES_SENCILLOS[tag] }, FICHAS_NIVEL_1[tag]) : null);

  const GUIA_NIVEL_1 = [
    ['1. La leche entra', '<p>Empieza en el <b>tanque de leche</b>. La <b>bomba de leche</b> la empuja por toda la instalación.</p>'],
    ['2. Se calienta sin mezclarse', '<p>En el <b>intercambiador de placas</b> la leche pasa junto a agua caliente, separada por una placa de acero. Así se calienta sin mezclarse con el agua.</p>'],
    ['3. Espera en el tubo', '<p>En el <b>tubo de residencia</b> la leche espera unos 15 segundos a 72 °C o más. Con ese tiempo y esa temperatura queda pasteurizada.</p>'],
    ['4. La válvula decide', '<p>La <b>válvula de desvío</b> mira la temperatura. Si la leche llegó a 72 °C, la deja salir. Si no, la devuelve al tanque.</p>'],
    ['5. Se enfría y sale', '<p>Antes de salir se enfría con agua fría. <b>Para probarlo:</b> pulsa <b>Iniciar</b> y elige <b>Automático</b>. Pulsa cualquier equipo para saber qué es y qué hace.</p>'],
  ];

  /* ---------- nivel 1: estado en lenguaje claro ---------- */
  const T_PASTEURIZACION_C = 72;       // ejemplo ilustrativo (igual que en las fichas)
  const fmt = (v, c = 1) => v.toFixed(c).replace('.', ',');
  const numero = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const instrumento = (e, tag) => (e && e.instrumentos && e.instrumentos[tag]) || {};
  const lazoMal = (e, tag) => { const c = instrumento(e, tag).calidad; return !!c && c !== 'OK'; };
  const hayAlarmaGrave = e => !!(e && e.alarmas && e.alarmas.some(a => a && a.nivel !== 'estado'));
  const modoDe = e => (e && e.modo) || 'PARADA';
  const fdvPosicion = e => (e && e.equipos && e.equipos['FDV-101'] && e.equipos['FDV-101'].posicion) || null;

  /** Franja de estado del nivel 1: { clase: 'ok' | 'atencion' | 'reposo', texto, simbolo }. Frases cortas y sin siglas. */
  function estadoSimple(e) {
    const modo = modoDe(e), t = numero(instrumento(e, 'TT-103').valorPLC), paro = e && e.plc && e.plc.paro;
    if (paro) return { clase: 'atencion', simbolo: '⚠', texto: 'Atención: la planta se ha parado por seguridad (paro de emergencia). Pulsa Rearmar para volver a empezar.' };
    if (modo === 'PARADA') return { clase: 'reposo', simbolo: '●', texto: 'La planta está parada. Pulsa Iniciar y elige Automático para empezar.' };
    if (lazoMal(e, 'TT-103')) return { clase: 'atencion', simbolo: '⚠', texto: 'Atención: el termómetro no da lectura. Por seguridad la leche se desvía.' };
    if (hayAlarmaGrave(e)) return { clase: 'atencion', simbolo: '⚠', texto: 'Atención: la planta ha detectado un problema. Los detalles se ven en el nivel 2.' };
    if (modo === 'PRODUCCION') {
      if (fdvPosicion(e) === 'AVANCE') return { clase: 'ok', simbolo: '✔', texto: `Todo bien: la leche llega a ${t !== null ? fmt(t) : '72'} °C y pasa a la salida.` };
      return { clase: 'atencion', simbolo: '⚠', texto: `Atención: la leche no llega a ${T_PASTEURIZACION_C} °C, se está desviando.` };
    }
    return { clase: 'reposo', simbolo: '●', texto: `Preparando: el agua se está calentando. Cuando la leche llegue a ${T_PASTEURIZACION_C} °C, empezará a producir.` };
  }

  /** Las tres tarjetas de valores del nivel 1: [{ id, titulo, valor, clase, simbolo, estado }]. En palabras y con «normal / atención». */
  function tarjetasNivel1(e) {
    const modo = modoDe(e), parada = modo === 'PARADA';
    const t = numero(instrumento(e, 'TT-103').valorPLC), q = numero(e && e.proceso && e.proceso.caudalLh), n = numero(e && e.tanque && e.tanque.nivelPct);
    const tarjeta = (id, titulo, valor, clase, estado) => ({ id, titulo, valor, clase, simbolo: clase === 'ok' ? '✔' : clase === 'atencion' ? '⚠' : '●', estado });
    let temp;
    if (parada && t === null) temp = tarjeta('n1-temp', 'Temperatura al salir del tubo:', '—', 'reposo', 'En reposo');          // aún sin lectura: la planta no ha arrancado
    else if (lazoMal(e, 'TT-103') || t === null) temp = tarjeta('n1-temp', 'Temperatura al salir del tubo:', '—', 'atencion', 'Atención: sin lectura');
    else if (parada) temp = tarjeta('n1-temp', 'Temperatura al salir del tubo:', `${fmt(t)} °C`, 'reposo', 'En reposo');
    else if (t >= T_PASTEURIZACION_C) temp = tarjeta('n1-temp', 'Temperatura al salir del tubo:', `${fmt(t)} °C`, 'ok', 'Normal: suficiente');
    else if (modo === 'RECIRCULACION_AGUA') temp = tarjeta('n1-temp', 'Temperatura al salir del tubo:', `${fmt(t)} °C`, 'reposo', `Calentando: aún no llega a ${T_PASTEURIZACION_C} °C`);    // preparando: es lo normal
    else temp = tarjeta('n1-temp', 'Temperatura al salir del tubo:', `${fmt(t)} °C`, 'atencion', `Atención: aún no llega a ${T_PASTEURIZACION_C} °C`);
    let caudal;
    if (q === null) caudal = tarjeta('n1-caudal', 'Caudal de leche:', '—', 'reposo', 'En reposo');
    else if (parada) caudal = tarjeta('n1-caudal', 'Caudal de leche:', `${Math.round(q)} litros por hora`, 'reposo', 'En reposo');
    else if (q > 0) caudal = tarjeta('n1-caudal', 'Caudal de leche:', `${Math.round(q)} litros por hora`, 'ok', 'Normal: circula la leche');
    else caudal = tarjeta('n1-caudal', 'Caudal de leche:', '0 litros por hora', 'atencion', 'Atención: no circula leche');
    let nivel;
    if (n === null) nivel = tarjeta('n1-nivel', 'Tanque de leche:', '—', 'reposo', 'En reposo');
    else if (n < 15) nivel = tarjeta('n1-nivel', 'Tanque de leche:', `${Math.round(n)} % lleno`, 'atencion', 'Atención: casi vacío');
    else if (n > 95) nivel = tarjeta('n1-nivel', 'Tanque de leche:', `${Math.round(n)} % lleno`, 'atencion', 'Atención: casi lleno');
    else nivel = tarjeta('n1-nivel', 'Tanque de leche:', `${Math.round(n)} % lleno`, 'ok', 'Normal');
    return [temp, caudal, nivel];
  }

  /** «Estado ahora» de la ficha del nivel 1, en una frase sencilla. */
  function estadoVivoNivel1(tag, e) {
    const eq = tag => (e && e.equipos && e.equipos[tag]) || {};
    const t = numero(instrumento(e, 'TT-103').valorPLC), agua = numero(instrumento(e, 'TT-201').valorPLC);
    switch (tag) {
      case 'TK-101': return numero(e && e.tanque && e.tanque.nivelPct) !== null ? `Está al ${Math.round(e.tanque.nivelPct)} % de su capacidad.` : '—';
      case 'P-101': case 'P-201': return eq(tag).marcha ? 'Encendida.' : 'Apagada.';
      case 'HT-101': return t !== null ? `La leche sale del tubo a ${fmt(t)} °C.` : 'Todavía sin lectura: la planta no ha arrancado.';
      case 'HX-101': return t !== null ? `Después del calentamiento, la leche llega a ${fmt(t)} °C.` : 'Todavía sin lectura: la planta no ha arrancado.';
      case 'FDV-101': return fdvPosicion(e) === 'AVANCE' ? (modoDe(e) === 'RECIRCULACION_AGUA' ? 'Está abierta mientras la planta se prepara.' : 'Deja pasar la leche a la salida.') : 'Devuelve la leche al tanque.';
      case 'HW-201': {
        const b = (eq('KM-201').cerrado ? 1 : 0) + (eq('KM-202').cerrado ? 1 : 0);
        return `${agua !== null ? `Agua a ${fmt(agua, 0)} °C. ` : ''}${b} de 2 resistencias encendidas.`;
      }
      default: return '—';
    }
  }

  /** Texto corto de la válvula de desvío en el dibujo del nivel 1. */
  const textoFdvNivel1 = e => (fdvPosicion(e) === 'AVANCE' ? (modoDe(e) === 'RECIRCULACION_AGUA' ? 'Abierta (preparando)' : 'Deja pasar la leche') : fdvPosicion(e) === 'DESVIO' ? 'Devuelve la leche' : '…');

  /** Títulos y valores de los «chips» de la barra en el nivel 1 (sin siglas). */
  function chipNivel1(id, titulo, valor) {
    if (id === 'tt103') return { titulo: 'Temperatura', valor };
    if (id === 'fdv') return { titulo: 'Válvula de desvío', valor: valor === 'AVANCE' ? 'Deja pasar' : valor === 'DESVÍO' ? 'Desvía' : valor };
    return { titulo, valor };
  }
  /** Descripción de los dos modos del nivel 1 (texto bajo el selector). */
  const INFO_MODOS_NIVEL_1 = 'Parada: todo apagado. Automático: la planta arranca sola, calienta el agua y, cuando la leche llega a 72 °C, produce leche pasteurizada.';

  const api = { NIVELES, IDS, NIVEL_POR_DEFECTO, CLAVE_ALMACEN, EQUIPOS_NIVEL_1, NOMBRES_SENCILLOS, OPCIONES_NIVEL_1, MODOS_NIVEL_1, FICHAS_NIVEL_1, GUIA_NIVEL_1, INFO_MODOS_NIVEL_1,
    nivelValido, nivelInicial, bloqueado, nivelMinimoDeTag, visibleEnNivel, tagsVisibles, nombreSencillo, opcionesDeModo, modoPermitido, modoMasCercano, valorDeSelector,
    pestanasPermitidas, pestanaPermitida, capacidades, fichaSencilla, estadoSimple, tarjetasNivel1, estadoVivoNivel1, chipNivel1, textoFdvNivel1 };

  // Nivel actual compartido con el 3D (visor_htst.js lo consulta al abrir) y con la ventana aparte. Lo fija la página (pagina.js) o la dirección (visor3d.html).
  let actual = 3;                  // sin página (Node, banco de pruebas) se comporta como el nivel 3; la página y la ventana del 3D lo fijan al abrir
  api.nivelActual = () => actual;
  api.fijarNivel = n => { const v = nivelValido(n); if (v) actual = v; return actual; };

  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstNiveles = api; }
})();
