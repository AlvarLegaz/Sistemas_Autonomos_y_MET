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
    const e = estado || {}, revision = modo === 'revision', M = nombresModos();
    const pedirRevision = () => ({ tipo: 'aviso', texto: `Para accionar ${tag} pasa a ${M.manual}. Con el botón derecho ves su ficha.` });
    if (CADENAS.includes(tag)) return { tipo: 'cadena', tag };
    if (PROTECCIONES.includes(tag)) {
      if (!revision) return pedirRevision();
      const est = (e.protecciones && e.protecciones[tag] && e.protecciones[tag].estado) || 'CERRADO';
      if (est === 'CERRADO') return { tipo: 'orden', tag, accion: 'abrir', aviso: `al abrir ${tag}, ${CONSECUENCIAS[tag]}` };
      if (est === 'ABIERTO') return { tipo: 'orden', tag, accion: 'cerrar' };
      if (est === 'DISPARADO') return { tipo: 'orden', tag, accion: 'rearmar' };
      return { tipo: 'info', texto: `${tag}: ${est.toLowerCase()}.` };
    }
    if (SUSTITUIBLES.includes(tag)) {
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
        <nav class="modos" aria-label="Modo de funcionamiento"><button type="button" id="modo-normal" title="La instalación funciona sola: tú eliges día, hora y nubosidad">${escapar(M.normal)}</button><button type="button" id="modo-revision" title="Tú controlas todo: sombras, interruptores, red, cargas y averías">${escapar(M.manual)}</button></nav>
        <div class="ventanas" role="group" aria-label="Ventanas aparte"><button type="button" id="v-unifilar">Unifilar</button><button type="button" id="v-cableado">Cableado</button><button type="button" id="v-3d">Instalación 3D</button><button type="button" id="v-ayuda">? Ayuda</button></div>
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
          <div class="pestanas" role="tablist" aria-label="Paneles"><button type="button" role="tab" id="t-mando" data-p="p-mando" aria-selected="true" aria-controls="p-mando">Mando</button><button type="button" role="tab" id="t-lecturas" data-p="p-lecturas" aria-selected="false" aria-controls="p-lecturas">Lecturas</button></div>
          <div class="panel-pestana" id="p-mando" role="tabpanel" aria-labelledby="t-mando"></div>
          <div class="panel-pestana" id="p-lecturas" role="tabpanel" aria-labelledby="t-lecturas" hidden></div>
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
    const objetos = PCT.fvEsquema.crearObjetos(canvas);
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
      const d = decidirClic(tag, estado(), modo);
      if (d.tipo === 'cadena') { graficas.seleccionarCadena(d.tag); avisar(`Curva I-V de ${d.tag} (más abajo, en las gráficas).`); }
      else if (d.tipo === 'orden') avisar(ejecutarOrden(sim, d));
      else if (d.tipo === 'sombra') { sim.ordenes.ambiente.sombra(d.tag, d.valor); avisar(d.texto); }
      else avisar(d.texto);
      aplicarAhora(); refrescar();
    }
    const panelMando = PCT.fvPanelRevision.crearPanelMando($('p-mando'), { sim: () => sim, accionar, alCambiarReloj: () => { historial.limpiar(); reiniciarBaseEnergia(); aplicarAhora(); }, alCambiar: () => { aplicarAhora(); refrescar(); }, avisar });
    const ficha = PCT.fvAyuda.iniciarAyuda(canvas.svg, {
      sim: () => sim, textos: PCT.fvTextosAyuda,
      alVer3d: tag => window.open(PCT.fvAyuda.urlVisor3d(tag), 'fv_3d_pieza', VENTANA),
      clicIzquierdo: tag => accionar(tag),
      accion: tag => { const d = decidirClic(tag, estado(), modo); return d.tipo === 'orden' ? { texto: textoAccion(d), ejecutar: () => accionar(tag) } : null; },
    });

    // Pestañas
    document.querySelector('.lateral-simple .pestanas').addEventListener('click', ev => {
      const b = ev.target.closest('[data-p]'); if (!b) return;
      document.querySelectorAll('.lateral-simple [role="tab"]').forEach(t => t.setAttribute('aria-selected', String(t === b)));
      document.querySelectorAll('.lateral-simple .panel-pestana').forEach(p => { p.hidden = p.id !== b.dataset.p; });
    });

    // Barra
    const actualizarBotones = () => { $('sim-play').disabled = corriendo; $('sim-pause').disabled = !corriendo; };
    $('sim-play').addEventListener('click', () => { corriendo = true; actualizarBotones(); refrescar(); });
    $('sim-pause').addEventListener('click', () => { corriendo = false; actualizarBotones(); refrescar(); });
    $('sim-reset').addEventListener('click', () => {      // sin cuadro de confirmación: vuelve al comienzo del día
      sim.reiniciar(); panelMando.restablecer(); historial.limpiar(); sim.paso(0.2); reiniciarBaseEnergia(); corriendo = false; actualizarBotones(); avisar('Instalación restablecida.'); refrescar();
    });
    document.querySelector('.velocidad').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      velocidad = Number(b.dataset.v); document.querySelectorAll('.velocidad button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    });
    // Modos
    function ponerModo(nuevo) {
      if (nuevo === modo) return;
      if (modo === 'revision' && nuevo === 'normal') { restaurarNormal(sim); panelMando.restablecer(); avisar('Modo Normal: la instalación vuelve a funcionar sola (cargas automáticas, protecciones cerradas, sin averías ni sombras).'); }
      modo = nuevo; aplicarAhora(); refrescar();
    }
    $('modo-normal').addEventListener('click', () => ponerModo('normal'));
    $('modo-revision').addEventListener('click', () => ponerModo('revision'));

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
      if (modo === 'normal') { $('modo-normal').setAttribute('aria-current', 'page'); $('modo-revision').removeAttribute('aria-current'); } else { $('modo-revision').setAttribute('aria-current', 'page'); $('modo-normal').removeAttribute('aria-current'); }
      document.body.dataset.modo = modo;
      panelMando.actualizar(e); lecturas.actualizar(e); pintarResumen(e);
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
    PCT.fvApp = { estadoActual: () => sim.estado, sim, enDemostracion, ponerModo, modo: () => modo, accionarEquipo: accionar, velocidades: VELOCIDADES };
  }

  const api = { VELOCIDADES, PROTECCIONES, SUSTITUIBLES, INVERSORES, CADENAS, CONSECUENCIAS, PASO_MAX_S, decidirClic, textoAccion, ejecutarOrden, restaurarNormal, textoEstado, textoReloj,
    formatoReloj: (d, h) => fmt().formatoReloj(d, h), iniciar };
  void E;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { window.FV_PAGINA_SIMPLE = api; if (document.getElementById('app')) iniciar().catch(error => { console.error(error); document.getElementById('app').innerHTML = `<p class="aviso-planta">No se pudo iniciar la instalación: ${escapar(error.message || error)}</p>`; }); }
})();
