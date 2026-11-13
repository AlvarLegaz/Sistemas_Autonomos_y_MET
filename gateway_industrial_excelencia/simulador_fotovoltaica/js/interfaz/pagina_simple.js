// Página del simulador de la instalación fotovoltaica de la cubierta: cabecera con el nombre, modos Normal y Revisión, barra con el reloj solar y las velocidades (×1, ×60, ×600,
// ×3600), el sinóptico a la izquierda, el panel lateral (Mando | Lecturas) y las gráficas debajo, a todo el ancho. Clic izquierdo ACCIONA el equipo (en Revisión) y clic derecho
// abre su FICHA (con «Ver en 3D»). Unifilar, Cableado y la instalación en 3D son ventanas aparte (sus botones solo aparecen si la página existe).
// Normal: la instalación funciona sola y el alumno elige día, hora y nubosidad. Revisión: el alumno controla todo; sin cuadros de confirmación (se avisa de la consecuencia pero no se pregunta).
// Las decisiones (qué hace un clic, cómo se aplica una orden, el texto de estado) son funciones puras que se prueban con node:test.
(function () {
  const enNode = typeof require !== 'undefined';
  let layout = enNode ? require('../layout.js') : null;
  const F = enNode ? require('./formato_fv.js') : null;
  const fmt = () => (enNode ? F : PCT.fvFormato);
  const E = () => (enNode ? require('../scada2d/esquema_fv.js') : PCT.fvEsquema);

  const VELOCIDADES = [1, 60, 600, 3600];                                   // veces el tiempo real del reloj solar
  const PROTECCIONES = ['QS-101', 'QB-101', 'QS-201', 'QF-301', 'ID-301', 'QF-302', 'QF-303'];
  const SUSTITUIBLES = ['F-101', 'F-102', 'FB-101', 'SPD-101', 'SPD-201', 'SPD-301'];      // fusibles y cartuchos de descargador: no se abren, se sustituyen cuando fallan
  const INVERSORES = ['INV-101', 'INV-201'];
  const CADENAS = ['STR-101', 'STR-102', 'STR-201', 'STR-202'];
  const PASO_MAX_S = 5;                                                     // el modelo se integra a pasos de hasta 5 s simulados
  const PERIODO_MS = 250;

  /** Qué pasa si se abre cada protección (se avisa, no se pregunta). */
  const CONSECUENCIAS = {
    'QS-101': 'el campo A se desconecta del EASun: dejará de cargar la batería con sol.',
    'QB-101': 'el EASun pierde la batería: sin ella no puede estabilizar el bus de continua ni dar energía por la noche.',
    'QS-201': 'el campo B se desconecta del ZCS: dejará de producir.',
    'QF-301': 'el cuadro se queda sin red: el ZCS se desconecta por anti-isla y LOAD-301 se apaga.',
    'ID-301': 'el cuadro se queda sin red: el ZCS se desconecta por anti-isla y LOAD-301 se apaga.',
    'QF-302': 'el EASun pierde la entrada de red: si la batería se agota las cargas protegidas se quedan sin tensión.',
    'QF-303': 'el ZCS no puede entregar a la red: se desconecta por anti-isla.',
    'INV-101': 'las cargas protegidas LOAD-302 se quedan sin alimentación y la batería deja de cargarse.',
    'INV-201': 'el campo B deja de producir y el centro consume todo de la red.',
    'RED-301': 'el ZCS se desconecta (anti-isla) y el EASun pasa a isla con la batería.',
  };
  const nombresModos = () => (layout && layout.INSTALACION && layout.INSTALACION.modos) || { normal: 'Normal', manual: 'Revisión' };

  /**
   * Qué hace un clic izquierdo sobre el equipo `tag` con el estado `estado` y el modo de la página ('normal' o 'revision'). Devuelve { tipo, ... }:
   *   'cadena'  → { tag } elige la cadena para la curva I-V (vale en cualquier modo)
   *   'orden'   → { tag, accion: 'abrir'|'cerrar'|'rearmar'|'encender'|'apagar'|'red-cortar'|'red-reponer' } (puede llevar `aviso` con la consecuencia: se muestra, no se pregunta)
   *   'sombra' → { tag, valor, texto } pone la sombra de un panel (0, 0,5 o 1)
   *   'aviso' | 'info' → { texto } mensaje para el operador, sin orden
   */
  function decidirClic(tag, estado, modo = 'normal') {
    const e = estado || {}, diag = modo === 'diagnostico', revision = modo === 'revision' || diag, M = nombresModos();      // en Diagnóstico se maniobra como en Revisión, pero no se repara ni se ve la curva sin el trazador
    const pedirRevision = () => ({ tipo: 'aviso', texto: `Para accionar ${tag} pasa a ${M.manual}. Con el botón derecho ves su ficha.` });
    if (CADENAS.includes(tag)) return diag ? { tipo: 'aviso', texto: `En Diagnóstico la curva de ${tag} se mide con el trazador I-V del maletín (botón «Instrumentos»).` } : { tipo: 'cadena', tag };
    if (PROTECCIONES.includes(tag)) {
      if (!revision) return pedirRevision();
      const est = (e.protecciones && e.protecciones[tag] && e.protecciones[tag].estado) || 'CERRADO';
      if (est === 'CERRADO') return { tipo: 'orden', tag, accion: 'abrir', aviso: `al abrir ${tag}, ${CONSECUENCIAS[tag]}` };
      if (est === 'ABIERTO') return { tipo: 'orden', tag, accion: 'cerrar' };
      if (est === 'DISPARADO') return { tipo: 'orden', tag, accion: 'rearmar' };
      return { tipo: 'info', texto: `${tag}: ${est.toLowerCase()}.` };
    }
    if (SUSTITUIBLES.includes(tag)) {
      if (diag) return { tipo: 'aviso', texto: `${tag}: sustituirlo es reparar. Primero entrega tu hoja de diagnóstico; para saber si está bien, mídelo.` };      // el mismo texto esté sano o no: no delata la avería
      const est = (e.protecciones && e.protecciones[tag] && e.protecciones[tag].estado) || 'CERRADO';
      if (est !== 'FUNDIDO' && est !== 'AGOTADO') return { tipo: 'info', texto: `${tag} está sano: no se acciona. Si falla (fusible fundido, testigo del descargador en rojo) se sustituye con un clic en Revisión.` };
      return revision ? { tipo: 'orden', tag, accion: 'rearmar' } : pedirRevision();
    }
    if (INVERSORES.includes(tag)) {
      if (!revision) return pedirRevision();
      const apagado = !!(e.inversores && e.inversores[tag] && e.inversores[tag].estado === 'APAGADO');
      return apagado ? { tipo: 'orden', tag, accion: 'encender' } : { tipo: 'orden', tag, accion: 'apagar', aviso: `al apagar ${tag}, ${CONSECUENCIAS[tag]}` };
    }
    if (tag === 'RED-301') {
      if (diag) return { tipo: 'aviso', texto: 'La acometida no se maniobra en Diagnóstico: mide su tensión con el multímetro.' };
      if (!revision) return pedirRevision();
      const cae = !(e.red && e.red.disponible === false);
      return cae ? { tipo: 'orden', tag, accion: 'red-cortar', aviso: `al cortar la red, ${CONSECUENCIAS['RED-301']}` } : { tipo: 'orden', tag, accion: 'red-reponer' };
    }
    if (/^PV-/.test(tag)) {       // en Revisión, tocar un panel pone o quita su sombra (0 → 50 % → 100 % → 0): sirve con el dedo, sin tirador
      if (!revision) return pedirRevision();
      const p = (e.campos && ['A', 'B'].map(c => e.campos[c]).filter(Boolean).flatMap(c => c.cadenas).flatMap(c => c.paneles).find(x => x.tag === tag)) || {}, s = Number.isFinite(p.sombra01) ? p.sombra01 : 0;
      const valor = s < 0.25 ? 0.5 : s < 0.75 ? 1 : 0;
      return { tipo: 'sombra', tag, valor, texto: valor === 0 ? `${tag}: sin sombra.` : `${tag}: sombra del ${Math.round(valor * 100)} %. Toca otra vez para cambiarla.` };
    }
    if (tag === 'BAT-101') return { tipo: 'info', texto: 'El SoC inicial de la batería se pone en el panel Mando (Revisión). Con el botón derecho ves su ficha.' };
    if (tag === 'LOAD-301' || tag === 'LOAD-302') return { tipo: 'info', texto: `La potencia de ${tag} se pone en el panel Mando (Revisión). Con el botón derecho ves su ficha.` };
    return { tipo: 'info', texto: `${tag} no se acciona. Con el botón derecho ves su ficha.` };
  }

  /** Texto del botón de la ficha para una decisión de tipo 'orden'. */
  function textoAccion(d) {
    return { abrir: `Abrir ${d.tag}`, cerrar: `Cerrar ${d.tag}`, rearmar: SUSTITUIBLES.includes(d.tag) ? `Sustituir ${d.tag}` : `Rearmar ${d.tag}`, encender: `Encender ${d.tag}`, apagar: `Apagar ${d.tag}`, 'red-cortar': 'Cortar la red', 'red-reponer': 'Reponer la red' }[d.accion] || d.accion;
  }

  /** Aplica una decisión 'orden' al simulador. Devuelve el texto que se le muestra al operador. */
  function ejecutarOrden(sim, d) {
    const o = sim.ordenes;
    switch (d.accion) {
      case 'abrir': o.protecciones.abrir(d.tag); break;
      case 'cerrar': o.protecciones.cerrar(d.tag); break;
      case 'rearmar': o.protecciones.rearmar(d.tag); if (!SUSTITUIBLES.includes(d.tag)) { try { o.protecciones.cerrar(d.tag); } catch (error) { /* ya quedó cerrada */ } } break;     // rearmar un disparo deja la protección lista; se cierra
      case 'encender': o.inversor.encender(d.tag, true); break;
      case 'apagar': o.inversor.encender(d.tag, false); break;
      case 'red-cortar': o.red.disponible(false); break;
      case 'red-reponer': o.red.disponible(true); break;
      default: return '';
    }
    const pasado = { abrir: 'abierto', cerrar: 'cerrado', rearmar: SUSTITUIBLES.includes(d.tag) ? 'sustituido' : 'rearmado', encender: 'encendido', apagar: 'apagado', 'red-cortar': 'sin red', 'red-reponer': 'con red' }[d.accion];
    return `${d.tag} ${pasado}.${d.aviso ? ' ⚠ ' + d.aviso.charAt(0).toUpperCase() + d.aviso.slice(1) : ''}`;
  }

  /** Vuelve la instalación a funcionamiento normal (al pasar de Revisión a Normal): cargas en automático, red, protecciones cerradas, sin sombras ni averías, EASun en solar primero. */
  function restaurarNormal(sim) {
    const o = sim.ordenes, L = layout || require('../layout.js');
    const seguro = fn => { try { fn(); } catch (error) { /* una orden que no procede (p. ej. rearmar algo que no está disparado) no impide restaurar lo demás */ } };
    o.averias.limpiar();
    for (const t of ['LOAD-301', 'LOAD-302']) seguro(() => o.cargas.poner(t, null));
    seguro(() => o.red.disponible(true)); seguro(() => o.red.tension(230));
    for (const t of SUSTITUIBLES) seguro(() => o.protecciones.rearmar(t));
    for (const t of PROTECCIONES) { seguro(() => o.protecciones.rearmar(t)); seguro(() => o.protecciones.cerrar(t)); }
    for (const q of L.EQUIPOS.filter(x => x.tipo === 'panel')) seguro(() => o.ambiente.sombra(q.tag, 0));
    seguro(() => o.ambiente.poner({ temperaturaAmbienteC: null, suciedadA: 0, suciedadB: 0 }));
    seguro(() => o.inversor.modoEasun('SOLAR_PRIMERO')); for (const t of INVERSORES) seguro(() => o.inversor.encender(t, true));
  }

  /** Texto de la línea de estado de la barra: modo, marcha, producción, batería y la alarma más grave. */
  function textoEstado(e, corriendo, modo = 'normal') {
    if (!e) return '—';
    const f = enNode ? F : PCT.fvFormato, M = nombresModos();
    const prod = ((e.campos && e.campos.A && e.campos.A.p) || 0) + ((e.campos && e.campos.B && e.campos.B.p) || 0);
    if (modo === 'diagnostico') return `Diagnóstico (avería oculta) · ${corriendo ? 'en marcha' : 'en pausa'} · ${e.reloj && e.reloj.esDia ? 'de día' : 'de noche'} · sin lecturas ni alarmas explicadas: mide con los instrumentos`;
    const al = (e.alarmas || []).filter(a => a.severidad !== 'info');
    const base = `${modo === 'revision' ? `${M.manual} (todo en tus manos)` : M.normal} · ${corriendo ? 'en marcha' : 'en pausa'} · ${e.reloj && e.reloj.esDia ? 'de día' : 'de noche'} · FV ${f.formatoPotencia(prod)} · batería ${f.formatoPorcentaje(e.bateria && e.bateria.soc01)}`;
    if (!al.length) return `${base} · sin alarmas`;
    const a = al[0];
    return `${base} · ${al.length} ${al.length === 1 ? 'alarma' : 'alarmas'}: ${a.tag ? a.tag + ' ' : ''}${a.texto || a.codigo || ''}`;
  }
  const textoReloj = e => (e && e.reloj && (e.reloj.texto || (enNode ? F : PCT.fvFormato).formatoReloj(e.reloj.diaAnio, e.reloj.horaSolar))) || '—';

  /* ---------- parte con DOM ---------- */
  const escapar = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const VENTANA = 'popup=yes,width=1180,height=780';

  const guia = () => { const M = nombresModos(); return [
    ['Cómo se maneja', '<p><b>Clic izquierdo</b> sobre un equipo lo acciona (en Revisión: interruptores, fusibles, descargadores, inversores y la red) o, en una cadena de paneles, la elige para la curva I-V. <b>Clic derecho</b> abre su ficha: qué es, qué hace, su estado en vivo, qué mirar al mantenerlo y «Ver en 3D», que abre solo esa pieza. Con el teclado: Intro o Espacio acciona; la tecla de menú abre la ficha. En pantalla táctil, <b>mantén pulsado 3 s</b> un equipo para ver su descripción.</p>'],
    [`${M.normal}`, '<p>La instalación funciona sola. Pulsa <b>Iniciar</b> y elige la <b>fecha</b>, la <b>hora solar</b> y la <b>nubosidad</b> en el panel Mando: observa cómo cambian la producción de cada campo, la carga de la batería y el reparto con la red. Las <b>velocidades</b> (×1, ×60, ×600, ×3600) aceleran el reloj solar: a ×3600 un día entero pasa en 24 s.</p>'],
    [`${M.manual}`, '<p>Controlas tú: sombras por panel, suciedad, temperatura, interruptores y protecciones, red, cargas, modo del EASun, SoC inicial y el panel de <b>averías del profesor</b>. No hay cuadros de confirmación: el aviso de la consecuencia aparece abajo y la orden se ejecuta. Al volver a Normal se restaura la instalación.</p>'],
    ['Cómo leer el sinóptico', '<p>Los <b>cables</b> se animan con el sentido de la potencia (flecha y puntos) y son más gruesos cuanto más potencia llevan: amarillo = solar, verde = batería, azul = red, violeta = consumo y producción del ZCS. Las <b>burbujas</b> dan tensión, corriente y potencia de cada tramo. El <b>color</b> de cada equipo (y su forma: palanca abierta, fusible roto, testigo) dice su estado: verde en servicio, ámbar aviso, rojo alarma, gris parado.</p>'],
    ['Cómo se numeran los equipos', `<p>Las letras dicen qué es (PV panel, STR cadena, QS seccionador, QB, QF y ID protecciones, INV inversor, BAT batería, LOAD carga) y la <b>centena</b> del número, a qué circuito pertenece: ${Object.entries(layout.CIRCUITOS).map(([n, c]) => `<b>${n}xx</b> ${escapar(c.toLowerCase())}`).join('; ')}.</p>`],
    ['En el iPad', '<p>Un <b>toque corto</b> acciona el equipo; <b>mantén pulsado 3 s</b> un equipo para ver su descripción (un anillo se va llenando; si mueves el dedo se cancela). No hace falta pasar el ratón por nada. Con los botones − / + del sinóptico lo acercas y lo desplazas con el dedo.</p>'],
    ['Instrumentos de medida', '<p>El botón <b>Instrumentos</b> (y la pestaña del mismo nombre) abre el maletín. Coge uno y queda «en la mano», en una ventanita con su pantalla; mientras lo tienes, <b>un toque en el sinóptico mide</b> en vez de accionar (el botón <b>Maniobrar</b> de la ventanita deja pasar los toques para abrir un interruptor sin soltarlo).</p><ul><li><b>Multímetro</b> (V⎓, V∿, Ω-continuidad): toca un punto para la punta roja y otro para la negra. Si el toque cae entre varios puntos, o tocas un equipo, te pregunta en cuál. Signo negativo = puntas al revés.</li><li><b>Pinza amperimétrica</b> (A⎓, A∿): toca la marca de un cable; da la corriente con su signo y sentido.</li><li><b>Megóhmetro</b>: aislamiento de cada polo de una cadena a tierra; exige el seccionador abierto.</li><li><b>Trazador I-V</b>: curva medida frente a la de referencia, con Voc, Isc, Pmpp, factor de forma, desviación y escalones.</li><li><b>Cámara termográfica</b>: vista térmica con su escala; toca una zona para leer su temperatura.</li></ul><p>Cada medida se apunta sola en el <b>cuaderno</b> (pestaña Instrumentos), donde puedes anotarla, marcarla como evidencia y borrarla.</p>'],
    ['Modo Diagnóstico', '<p>La instalación tiene una <b>avería oculta</b>: la que te asigna tu profesor o, si no hay ninguna, una al azar para practicar. Desaparecen las ayudas que la delatarían (lecturas, alarmas explicadas, burbujas, gráficas, colores de estado): quedan las pantallas y los LED de los equipos, las palancas y los testigos, como en la realidad. Puedes cambiar la fecha, la hora y la nubosidad (hace falta sol para muchas medidas), abrir y cerrar interruptores, apagar inversores y sombrear paneles. Rellena la <b>hoja</b> (síntoma, medidas que lo demuestran, elemento, avería y reparación) y pulsa <b>Entregar</b>: se corrige al momento con nota de 0 a 10. Cuentan el acierto, las medidas clave que hayas hecho, la hoja completa y el tiempo; restan las pistas, las maniobras peligrosas y los intentos anteriores. Después puedes reintentar o ver la avería y repararla.</p>'],
    ['Cómo diagnosticar (orden de la norma IEC 62446-1)', '<ol><li><b>Inspección visual</b>: palancas, testigos de los descargadores, pantallas y LED de los inversores, sombras y suciedad. Sin tocar nada.</li><li><b>Continuidad de las tierras</b> y de los conductores de protección (óhmetro, sin tensión; pinza en el conductor de tierra: no debe pasar corriente).</li><li><b>Polaridad</b> de cada cadena con el multímetro en V⎓: signo positivo con la punta roja en el «+».</li><li><b>Tensión en vacío (Voc)</b> de cada cadena con el seccionador abierto: cadenas iguales deben dar lo mismo (± 5 %). Un tercio de panel de menos = un diodo de paso; 0 V = cadena abierta.</li><li><b>Corriente</b> (Isc o de trabajo) con la pinza: cadenas iguales con el mismo sol, la misma corriente. 0 A con tensión = circuito abierto aguas abajo (fusible, seccionador).</li><li><b>Aislamiento</b> de cada polo a tierra con el megóhmetro, con el seccionador abierto: por encima del mínimo (1 MΩ; 0,5 MΩ en campos de menos de 120 V).</li><li><b>Curva I-V</b> con más de 400 W/m²: compara con la de referencia. Escalones = diodos de paso; poca corriente = suciedad o sombra; curva «tumbada» = resistencia en serie.</li><li><b>Termografía</b> con la instalación en carga: conectores, bornas y células más calientes que sus iguales.</li></ol><p>Ve siempre de lo general a lo concreto: primero qué campo o qué inversor falla, luego qué cadena y por último qué elemento. Compara con el elemento igual que sí funciona.</p>'],
    ['Riesgos de cada medida', '<ul><li><b>Continua</b>: los paneles dan tensión siempre que hay luz, aunque el seccionador esté abierto. En continua el arco no se apaga solo: <b>nunca abras un seccionador ni un conector MC4 con carga</b> (apaga antes el inversor).</li><li><b>Multímetro</b>: categoría CAT III 1000 V, puntas con protección, una sola mano. <b>Nunca midas continuidad ni resistencia con tensión</b>. No uses la entrada de amperios en paralelo.</li><li><b>Pinza</b>: abraza un solo conductor; haz el cero en continua. No abre el circuito: es la forma segura de medir corriente.</li><li><b>Megóhmetro</b>: inyecta de 250 a 1000 V. Seccionador abierto, inversor y descargadores desconectados, nadie tocando los paneles; al acabar, descarga la cadena.</li><li><b>Trazador I-V</b>: se conecta a la cadena aislada del inversor y la pone en cortocircuito un instante: conectores bien enchufados y polaridad comprobada antes.</li><li><b>Termografía</b>: sin contacto, pero con la instalación en carga y las tapas abiertas: distancia de seguridad y cuidado con los reflejos del sol.</li><li><b>Batería</b>: corriente de cortocircuito de miles de amperios. Herramienta aislada y nada metálico encima.</li></ul>'],
    ['Ventanas aparte', '<p><b>Unifilar</b> y <b>Cableado</b> son los planos eléctricos con el estado en vivo; <b>Instalación 3D</b> es la cubierta y la caseta. Se siguen moviendo con la instalación.</p>'],
  ]; };

  async function iniciar() {
    const raiz = document.getElementById('app');
    const { faltan } = await window.FV_CARGADOR.cargarTodo();
    layout = PCT.fvLayout;
    const f = PCT.fvFormato;
    const cand = PCT.fv && typeof PCT.fv.crearSimulacion === 'function' ? PCT.fv : null;
    let crear = cand, enDemostracion = false;
    if (!crear) { await window.FV_CARGADOR.cargarScript('js/interfaz/estado_demo.js'); crear = PCT.fvDemo; enDemostracion = true; }
    const sim = crear.crearSimulacion({ semilla: 1, diaAnio: 172, horaSolar: 9, nubosidad: 0.1 });
    sim.paso(0.2);
    const I = layout.INSTALACION, M = I.modos;

    raiz.innerHTML = `<header class="cab">
        <h1><img class="logo" src="/simulador/img/logo-politecnico.png" alt="CIFP Politécnico Cartagena" width="166" height="60"><span class="sim">${escapar(I.centro.toUpperCase())} · ${escapar(I.corto)}<small>${escapar(I.nombre)}</small></span></h1>
        <nav class="modos" aria-label="Modo de funcionamiento"><button type="button" id="modo-normal" title="La instalación funciona sola: tú eliges día, hora y nubosidad">${escapar(M.normal)}</button><button type="button" id="modo-revision" title="Tú controlas todo: sombras, interruptores, red, cargas y averías">${escapar(M.manual)}</button><button type="button" id="modo-diagnostico" title="Avería oculta: la encuentras midiendo con los instrumentos y entregas una hoja con nota">Diagnóstico</button></nav>
        <div class="ventanas" role="group" aria-label="Instrumentos y ventanas aparte"><button type="button" id="v-instrumentos" class="destacado" title="Maletín: multímetro, pinza, megóhmetro, trazador I-V y cámara termográfica">Instrumentos</button><button type="button" id="v-unifilar">Unifilar</button><button type="button" id="v-cableado">Cableado</button><button type="button" id="v-3d">Instalación 3D</button><button type="button" id="v-ayuda">? Ayuda</button></div>
      </header>
      <div class="barra" role="region" aria-label="Operación de la simulación">
        <div class="acciones"><button id="sim-play" type="button">Iniciar</button><button id="sim-pause" type="button" disabled>Pausar</button><button id="sim-reset" type="button">Restablecer</button></div>
        <div class="pista"><p class="estado-manual" aria-live="polite"><b id="sim-time">—</b><span id="sim-status">—</span></p></div>
        <div class="derecha"><span class="etq-vel" id="etq-vel">Reloj solar</span><div class="velocidad" role="group" aria-labelledby="etq-vel">${VELOCIDADES.map((v, k) => `<button type="button" data-v="${v}" aria-pressed="${k === 0}">×${v}</button>`).join('')}</div></div>
      </div>
      <div id="avisos"></div><p id="aviso-clic" class="aviso-clic" role="status" hidden></p>
      <div class="cuerpo-simple">
        <main class="escena"><div class="zoom-esquema" role="group" aria-label="Tamaño del sinóptico"><span>Sinóptico</span><button type="button" id="zoom-menos" aria-label="Alejar el sinóptico">−</button><button type="button" id="zoom-ajustar" aria-label="Ver el sinóptico entero">Ver entero</button><button type="button" id="zoom-mas" aria-label="Acercar el sinóptico">+</button><output id="zoom-nivel" aria-live="polite"></output></div>
          <div class="lienzo" id="esquema" tabindex="-1"></div>
          <section class="resumen-fv" aria-label="Qué está pasando y energía del día"><div class="tarjeta-fv" id="diagnostico" aria-live="off"></div><div class="tarjeta-fv" id="energia-dia"></div></section></main>
        <aside class="lateral-simple" aria-label="Mando y lecturas">
          <div class="pestanas" role="tablist" aria-label="Paneles"><button type="button" role="tab" id="t-mando" data-p="p-mando" aria-selected="true" aria-controls="p-mando">Mando</button><button type="button" role="tab" id="t-lecturas" data-p="p-lecturas" aria-selected="false" aria-controls="p-lecturas">Lecturas</button><button type="button" role="tab" id="t-instrumentos" data-p="p-instrumentos" aria-selected="false" aria-controls="p-instrumentos">Instrumentos</button><button type="button" role="tab" id="t-diagnostico" data-p="p-diagnostico" aria-selected="false" aria-controls="p-diagnostico" hidden>Diagnóstico</button></div>
          <div class="panel-pestana" id="p-mando" role="tabpanel" aria-labelledby="t-mando"></div>
          <div class="panel-pestana" id="p-lecturas" role="tabpanel" aria-labelledby="t-lecturas" hidden></div>
          <div class="panel-pestana" id="p-instrumentos" role="tabpanel" aria-labelledby="t-instrumentos" hidden></div>
          <div class="panel-pestana" id="p-diagnostico" role="tabpanel" aria-labelledby="t-diagnostico" hidden></div>
        </aside>
        <section class="graficas-simple" aria-label="Gráficas"><h2>GRÁFICAS</h2><div id="graficas"></div></section>
      </div>
      <footer class="pie-copyright">© 2026 Álvar Legaz Aparicio · Todos los derechos reservados.</footer>`;
    const $ = id => document.getElementById(id);
    const avisos = [];
    if (enDemostracion) avisos.push('Modelo de demostración: el modelo real de la instalación todavía no está cargado.');
    if (faltan.length) console.info('[fotovoltaica] módulos no cargados:', faltan.join(', '));
    $('avisos').innerHTML = avisos.map(a => `<p class="aviso-planta" role="status">${escapar(a)}</p>`).join('');

    // Estado de la página
    let corriendo = false, velocidad = 1, modo = 'normal', temporizadorAviso = null, ultimaGrafica = 0, baseEnergia = null, diaAnterior = null, firmaDiag = '', firmaEnergia = '';
    const D = PCT.fvDiagnostico;
    const reiniciarBaseEnergia = () => { baseEnergia = D.tomarBase(sim.estado); diaAnterior = null; firmaEnergia = ''; };
    const estado = () => sim.estado;
    const aplicarAhora = () => { if (!corriendo) sim.paso(0.2); };
    function avisar(texto) {
      const c = $('aviso-clic'); c.textContent = texto; c.hidden = !texto;
      clearTimeout(temporizadorAviso); if (texto) temporizadorAviso = setTimeout(() => { c.hidden = true; }, 8000);
    }

    // Sinóptico, gráficas y paneles
    const { Canvas } = PCT.canvas, canvas = new Canvas(PCT.fvEsquema.ESQUEMA_FV);
    $('esquema').replaceChildren(canvas.svg);
    let diag = null;      // hoja de diagnóstico (se crea más abajo)
    const oculto = () => modo === 'diagnostico' && !!diag && diag.oculto();      // ¿se ocultan ahora las ayudas que delatarían la avería?
    const modoClic = () => (modo === 'diagnostico' && !oculto() ? 'revision' : modo);      // tras ver la avería, se repara como en Revisión
    const objetos = PCT.fvEsquema.crearObjetos(canvas, { oculto });
    // Zoom del sinóptico: 0 = entero (cabe en el ancho); 1–3 = ancho mínimo del dibujo con desplazamiento (táctil: arrastrar con el dedo; también pellizcar)
    const NIVELES_ZOOM = [0, 1100, 1450, 1740];
    let nivelZoom = -1;
    const nivelPorDefecto = () => { const w = $('esquema').clientWidth; return w >= 1000 ? 0 : w >= 700 ? 1 : 2; };
    // Zona táctil: los equipos pequeños (interruptores, fusibles, descargadores…) reciben un rectángulo invisible para que midan al menos 44 px en pantalla, sea cual sea el zoom
    const NS_SVG = 'http://www.w3.org/2000/svg';
    function ajustarToques() {
      const escala = canvas.svg.getBoundingClientRect().width / 1740; if (!(escala > 0)) return;
      const minimo = 44 / escala;
      for (const g of canvas.svg.querySelectorAll('g[data-tag]')) {
        const r = g.querySelector(':scope > rect.forma'); if (!r) continue;
        const x = r.x.baseVal.value, y = r.y.baseVal.value, w = r.width.baseVal.value, h = r.height.baseVal.value;
        if (w >= minimo && h >= minimo) { const t = g.querySelector(':scope > rect.toque'); if (t) t.remove(); continue; }
        let t = g.querySelector(':scope > rect.toque');
        if (!t) { t = document.createElementNS(NS_SVG, 'rect'); t.setAttribute('class', 'toque'); g.insertBefore(t, g.firstChild); }
        const W = Math.max(w, minimo), H = Math.max(h, minimo);
        t.setAttribute('x', (x + w / 2 - W / 2).toFixed(1)); t.setAttribute('y', (y + h / 2 - H / 2).toFixed(1)); t.setAttribute('width', W.toFixed(1)); t.setAttribute('height', H.toFixed(1));
      }
    }
    function ponerZoom(n) {
      nivelZoom = Math.max(0, Math.min(NIVELES_ZOOM.length - 1, n));
      const min = NIVELES_ZOOM[nivelZoom]; canvas.svg.style.minWidth = min ? `${min}px` : ''; $('esquema').classList.toggle('ampliado', min > 0);
      $('zoom-nivel').textContent = `${Math.round(canvas.svg.getBoundingClientRect().width / 17.4)} %`;
      ajustarToques();
      $('zoom-menos').disabled = nivelZoom === 0; $('zoom-mas').disabled = nivelZoom === NIVELES_ZOOM.length - 1;
    }
    let zoomManual = false;      // si el alumno lo toca, ya no se ajusta solo al girar la pantalla
    $('zoom-menos').addEventListener('click', () => { zoomManual = true; ponerZoom(nivelZoom - 1); }); $('zoom-mas').addEventListener('click', () => { zoomManual = true; ponerZoom(nivelZoom + 1); }); $('zoom-ajustar').addEventListener('click', () => { zoomManual = true; ponerZoom(0); });
    ponerZoom(nivelPorDefecto());
let anchoPrevio = $('esquema').clientWidth;
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => { const w = $('esquema').clientWidth; if (!zoomManual && Math.abs(w - anchoPrevio) > 40) { anchoPrevio = w; ponerZoom(nivelPorDefecto()); } ajustarToques(); $('zoom-nivel').textContent = `${Math.round(canvas.svg.getBoundingClientRect().width / 17.4)} %`; }).observe($('esquema'));
    const historial = PCT.fvGrafica.crearHistorial();
    const graficas = PCT.fvGrafica.crearGraficas($('graficas'), {
      historial, anchoAuto: true,
      curvaIV: id => { try { const s = PCT.fvEsquema.cadenaDe(estado(), id); return { id, curva: sim.curvaIV(id, 80), cadena: s, trabajo: s && !s.abierta ? { v: s.v, i: s.i, p: s.p } : null }; } catch (error) { console.error(error); return null; } },
    });
    const lecturas = PCT.fvPanelLecturas.crearPanelLecturas($('p-lecturas'));
    reiniciarBaseEnergia();
    function accionar(tag) {
      const d = decidirClic(tag, estado(), modoClic());
      const peligro = modo === 'diagnostico' ? PCT.fvReto.peligroManiobra(d, estado()) : '';
      if (peligro) { ejecutarOrden(sim, d); avisar(`⚠ ${peligro}`); diag.anotarPeligro(peligro); }
      else if (d.tipo === 'cadena') { graficas.seleccionarCadena(d.tag); avisar(`Curva I-V de ${d.tag} (más abajo, en las gráficas).`); }
      else if (d.tipo === 'orden') avisar(ejecutarOrden(sim, d));
      else if (d.tipo === 'sombra') { sim.ordenes.ambiente.sombra(d.tag, d.valor); avisar(d.texto); }
      else avisar(d.texto);
      aplicarAhora(); refrescar();
    }
    const panelMando = PCT.fvPanelRevision.crearPanelMando($('p-mando'), { sim: () => sim, accionar, alCambiarReloj: () => { historial.limpiar(); reiniciarBaseEnergia(); aplicarAhora(); }, alCambiar: () => { aplicarAhora(); refrescar(); }, avisar });
    const ficha = PCT.fvAyuda.iniciarAyuda(canvas.svg, {
      sim: () => sim, textos: PCT.fvTextosAyuda,
      alVer3d: tag => window.open(PCT.fvAyuda.urlVisor3d(tag), 'fv_3d_pieza', VENTANA),
      clicIzquierdo: tag => accionar(tag), oculto,
      accion: tag => { const d = decidirClic(tag, estado(), modoClic()); return d.tipo === 'orden' ? { texto: textoAccion(d), ejecutar: () => accionar(tag) } : null; },
    });

    // Pestañas
    function elegirPestana(b) {
      document.querySelectorAll('.lateral-simple [role="tab"]').forEach(t => t.setAttribute('aria-selected', String(t === b)));
      document.querySelectorAll('.lateral-simple .panel-pestana').forEach(p => { p.hidden = p.id !== b.dataset.p; });
    }
    document.querySelector('.lateral-simple .pestanas').addEventListener('click', ev => { const b = ev.target.closest('[data-p]'); if (b) elegirPestana(b); });

    // Instrumentos de medida, cuaderno y hoja de diagnóstico
    const cuaderno = PCT.fvCuaderno.crearCuaderno();
    const instrumentos = PCT.fvPanelInstrumentos.crear({ sim: () => sim, svg: canvas.svg, pestana: $('p-instrumentos'), cuaderno, avisar, alPeligro: texto => { if (diag) diag.anotarPeligro(texto); } });
    $('v-instrumentos').addEventListener('click', () => instrumentos.abrirMaletin($('v-instrumentos')));
    const catalogo = (PCT.fv && PCT.fv.catalogoAverias) || null;
    /** Pone la avería del reto en la instalación sana, en las condiciones en que se manifiesta (escenario de su firma), sin enseñarla. */
    function ponerAveriaOculta(id, firma) {
      restaurarNormal(sim);
      try { if (catalogo && catalogo.prepararEscenario && firma && firma.escenario) catalogo.prepararEscenario(sim, firma); } catch (error) { /* sin escenario: la avería se pone en las condiciones actuales */ }
      sim.ordenes.averias.activar(id);
      const espera = Math.max(10, Math.min(3600, Number(firma && firma.escenario && firma.escenario.esperaS) || 60));
      for (const dt of f.subdividir(espera, PASO_MAX_S)) sim.paso(dt);
      historial.limpiar(); reiniciarBaseEnergia(); panelMando.restablecer();
    }
    let almacen = null; try { almacen = window.localStorage; } catch (error) { almacen = null; }
    diag = PCT.fvPanelDiagnostico.crear($('p-diagnostico'), { cuaderno, catalogo, avisar, almacen,
      empezar: (reto, firma) => { ponerAveriaOculta(reto.averia, firma); corriendo = true; actualizarBotones(); refrescar(); },
      revelar: () => { refrescar(); graficas.redibujar(); },
      terminar: () => { restaurarNormal(sim); panelMando.restablecer(); aplicarAhora(); refrescar(); },
    });

    // Barra
    const actualizarBotones = () => { $('sim-play').disabled = corriendo; $('sim-pause').disabled = !corriendo; };
    $('sim-play').addEventListener('click', () => { corriendo = true; actualizarBotones(); refrescar(); });
    $('sim-pause').addEventListener('click', () => { corriendo = false; actualizarBotones(); refrescar(); });
    $('sim-reset').addEventListener('click', () => {      // sin cuadro de confirmación: vuelve al comienzo del día
      const averia = modo === 'diagnostico' && oculto() ? diag.averia() : null;      // en un reto, restablecer vuelve al comienzo PERO la avería oculta sigue
      sim.reiniciar(); panelMando.restablecer(); historial.limpiar(); sim.paso(0.2); reiniciarBaseEnergia(); corriendo = false;
      if (averia) { ponerAveriaOculta(averia, diag.firma()); corriendo = true; }
      actualizarBotones(); avisar(averia ? 'Instalación restablecida al comienzo del reto (la avería sigue ahí).' : 'Instalación restablecida.'); refrescar();
    });
    document.querySelector('.velocidad').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      velocidad = Number(b.dataset.v); document.querySelectorAll('.velocidad button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    });
    // Modos
    function ponerModo(nuevo) {
      if (nuevo === modo) return;
      if (modo === 'revision' && nuevo === 'normal') { restaurarNormal(sim); panelMando.restablecer(); avisar('Modo Normal: la instalación vuelve a funcionar sola (cargas automáticas, protecciones cerradas, sin averías ni sombras).'); }
      if (modo === 'diagnostico' || nuevo === 'diagnostico') {      // al entrar y al salir de Diagnóstico la instalación queda sana: el reto en curso se abandona y no se puede «mirar» la avería desde Revisión
        const habia = modo === 'diagnostico' && diag.fase() !== 'inicio';
        restaurarNormal(sim); panelMando.restablecer(); if (modo === 'diagnostico') diag.salir();
        avisar(nuevo === 'diagnostico' ? 'Modo Diagnóstico: empieza un reto en la pestaña Diagnóstico. Las lecturas y las alarmas se ocultan: se mide con los instrumentos.' : habia ? 'Has salido de Diagnóstico: el reto queda abandonado y la instalación vuelve a estar sana.' : 'La instalación vuelve a funcionar con normalidad.');
      }
      modo = nuevo; aplicarAhora();
      if (nuevo === 'diagnostico') { diag.entrar(); $('t-diagnostico').hidden = false; elegirPestana($('t-diagnostico')); }
      refrescar(); graficas.redibujar();
    }
    $('modo-normal').addEventListener('click', () => ponerModo('normal'));
    $('modo-revision').addEventListener('click', () => ponerModo('revision'));
    $('modo-diagnostico').addEventListener('click', () => ponerModo('diagnostico'));

    // Ventanas aparte
    $('v-3d').addEventListener('click', () => window.open('visor3d.html', 'fv_3d', VENTANA));
    $('v-unifilar').addEventListener('click', () => window.open('unifilar.html', 'fv_unifilar', VENTANA));
    $('v-cableado').addEventListener('click', () => window.open('cableado.html', 'fv_cableado', VENTANA));
    for (const [id, url] of [['v-unifilar', 'unifilar.html'], ['v-cableado', 'cableado.html'], ['v-3d', 'visor3d.html']]) {      // el botón solo aparece si la página existe (sin botones muertos)
      $(id).hidden = true;
      fetch(url, { method: 'HEAD' }).then(r => { if (r.ok) $(id).hidden = false; }).catch(() => { /* sin la página: el botón sigue oculto */ });
    }
    $('v-ayuda').addEventListener('click', () => {
      ficha.cerrar();
      let g = document.getElementById('guia-fv');
      if (!g) { g = document.createElement('div'); g.id = 'guia-fv'; g.setAttribute('role', 'dialog'); g.setAttribute('aria-modal', 'true'); g.setAttribute('aria-labelledby', 'guia-titulo'); document.body.appendChild(g);
        g.addEventListener('click', e => { if (e.target.closest('button')) { g.hidden = true; if (g.origen && g.origen.focus) g.origen.focus(); } });
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && !g.hidden) { g.hidden = true; if (g.origen && g.origen.focus) g.origen.focus(); } }); }
      g.origen = document.activeElement;
      g.innerHTML = `<header><h3 id="guia-titulo">Ayuda · ${escapar(I.nombre)}</h3><button type="button" aria-label="Cerrar (Esc)">×</button></header><div class="cuerpo">${guia().map(([t, h]) => `<h4>${t}</h4>${h}`).join('')}</div>`; g.hidden = false;
      g.querySelector('button').focus();
    });

    const NIVEL = { ok: 'en servicio', aviso: 'aviso', alarma: 'alarma', parado: 'parado' };
    function pintarResumen(e) {
      if (baseEnergia && baseEnergia.dia !== null && e.reloj.diaAnio !== baseEnergia.dia) {      // al pasar la medianoche empieza un día nuevo y se guarda el resumen del que acaba de terminar
        const fin = D.resumenEnergia(e, baseEnergia), fecha = PCT.fvFormato.textoFecha(baseEnergia.dia); reiniciarBaseEnergia(); diaAnterior = { fecha, fin };
      }
      const dg = ['INV-101', 'INV-201'].map(t => [t, D.diagnosticoInversor(e, t)]), fd = JSON.stringify(dg);
      if (fd !== firmaDiag) {
        firmaDiag = fd;
        $('diagnostico').innerHTML = '<h2>¿POR QUÉ PRODUCE O NO PRODUCE CADA INVERSOR?</h2>' + dg.map(([t, d]) => `<div class="diag e-${d.nivel}"><p class="diag-cab"><b>${t === 'INV-101' ? 'EASun INV-101 · campo A' : 'ZCS INV-201 · campo B'}</b><span class="diag-estado">${escapar(NIVEL[d.nivel])} · ${escapar(d.estado)}</span></p><p><b>Causa:</b> ${escapar(d.causa)}</p>${d.efecto ? `<p><b>Efecto:</b> ${escapar(d.efecto)}</p>` : ''}</div>`).join('');
      }
      const r = D.resumenEnergia(e, baseEnergia), fe = JSON.stringify(D.filasEnergia(r)) + Math.round(r.cubiertoPct) + (diaAnterior ? diaAnterior.fecha : '');
      if (fe !== firmaEnergia) {
        firmaEnergia = fe;
        $('energia-dia').innerHTML = `<h2>ENERGÍA DEL DÍA <small>(desde las ${escapar(PCT.fvFormato.formatoHora(baseEnergia && baseEnergia.hora !== undefined ? baseEnergia.hora : 0))} del ${escapar(PCT.fvFormato.textoFecha(e.reloj.diaAnio))})</small></h2><dl>${D.filasEnergia(r).map(([n, v]) => `<div><dt>${escapar(n)}</dt><dd>${escapar(v)}</dd></div>`).join('')}</dl><p class="nota">Cubre el sol el ${Math.round(r.cubiertoPct)} % del consumo. Autoconsumo = lo producido que no se vierte a la red; ahorro a ${String(D.TARIFA_EUR_KWH).replace('.', ',')} €/kWh.</p>${diaAnterior ? `<p class="nota ayer"><b>Día anterior (${escapar(diaAnterior.fecha)}):</b> producida ${escapar(PCT.fvFormato.formatoEnergia(diaAnterior.fin.produccion))}, consumida ${escapar(PCT.fvFormato.formatoEnergia(diaAnterior.fin.consumo))}, importada ${escapar(PCT.fvFormato.formatoEnergia(diaAnterior.fin.importada))}, exportada ${escapar(PCT.fvFormato.formatoEnergia(diaAnterior.fin.exportada))}, autoconsumo ${Math.round(diaAnterior.fin.autoconsumoPct)} %, ahorro ${PCT.fvFormato.dec(diaAnterior.fin.ahorroEuros, 2)} €.</p>` : ''}`;
      }
    }

    function refrescar() {
      const e = estado();
      objetos.forEach(o => o.actualizar(e));
      canvas.svg.classList.toggle('en-pausa', !corriendo);
      const sel = graficas.cadena();
      for (const c of CADENAS) { const g = canvas.buscar(`g-${c}`); if (g) g.classList.toggle('elegida', c === sel); }
      const t = textoReloj(e); if ($('sim-time').textContent !== t) $('sim-time').textContent = t;
      const texto = textoEstado(e, corriendo, modo); if ($('sim-status').textContent !== texto) $('sim-status').textContent = texto;
      for (const m of ['normal', 'revision', 'diagnostico']) { const b = $(`modo-${m}`); if (m === modo) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
      const oc = oculto();
      document.body.dataset.modo = modo; document.body.dataset.oculto = oc ? '1' : '0';
      // pestañas: en Diagnóstico aparece la hoja y, mientras la avería está oculta, desaparecen las lecturas (con sus alarmas)
      $('t-diagnostico').hidden = modo !== 'diagnostico'; $('t-lecturas').hidden = oc;
      const elegida = document.querySelector('.lateral-simple [role="tab"][aria-selected="true"]'); if (!elegida || elegida.hidden) elegirPestana($('t-mando'));
      panelMando.actualizar(e); if (!oc) lecturas.actualizar(e); pintarResumen(e); instrumentos.actualizar(); diag.actualizar();
      document.body.dataset.estado = e.alarmas && e.alarmas.some(a => a.severidad === 'alarma') ? 'alarma' : corriendo ? 'marcha' : 'reposo';
    }
    setInterval(() => {
      if (corriendo) {
        const intervalo = velocidad === 1 ? 2 : velocidad === 60 ? 30 : 60;
        for (const dt of f.subdividir(PERIODO_MS / 1000 * velocidad, PASO_MAX_S)) { sim.paso(dt); const e = estado(); historial.registrar(e.t, PCT.fvGrafica.valoresHistorial(e), e.reloj, intervalo); }
      }
      refrescar();
      if (performance.now() - ultimaGrafica > 1000) { ultimaGrafica = performance.now(); graficas.redibujar(); }
    }, PERIODO_MS);
    refrescar(); historial.registrar(estado().t, PCT.fvGrafica.valoresHistorial(estado()), estado().reloj, 0); graficas.redibujar();

    // Para las ventanas aparte (3D, Unifilar, Cableado) y para las pruebas
    PCT.fvApp = { estadoActual: () => sim.estado, sim, enDemostracion, ponerModo, modo: () => modo, accionarEquipo: accionar, velocidades: VELOCIDADES, instrumentos, cuaderno };
  }

  const api = { VELOCIDADES, PROTECCIONES, SUSTITUIBLES, INVERSORES, CADENAS, CONSECUENCIAS, PASO_MAX_S, decidirClic, textoAccion, ejecutarOrden, restaurarNormal, textoEstado, textoReloj,
    formatoReloj: (d, h) => fmt().formatoReloj(d, h), iniciar };
  void E;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { window.FV_PAGINA_SIMPLE = api; if (document.getElementById('app')) iniciar().catch(error => { console.error(error); document.getElementById('app').innerHTML = `<p class="aviso-planta">No se pudo iniciar la instalación: ${escapar(error.message || error)}</p>`; }); }
})();
