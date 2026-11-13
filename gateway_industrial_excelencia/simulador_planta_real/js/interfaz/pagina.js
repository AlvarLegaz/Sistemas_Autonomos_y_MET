// Página de operación de la planta real HTST: monta la zona superior (barra de mando, franja de alarmas y banda de modo), el SCADA 2D, el panel MANUAL,
// las gráficas, los instrumentos virtuales, las hojas del alumno y el panel del profesor, y mueve la simulación. Las funciones puras (elegir simulación,
// resumen del estado, chips, lista de alarmas) se prueban con node:test.
(function () {
  /** La simulación real (PROGRAMADOR-MODELO) si está cargada; si no, null. Acepta PCT.htst.simulacion y PCT.htstSimulacion. */
  function localizarSimulacion(espacio) {
    const cand = (espacio.htst && espacio.htst.simulacion) || espacio.htstSimulacion;
    return cand && typeof cand.crearSimulacion === 'function' ? cand : null;
  }

  // Modos de funcionamiento: nombre y descripción del contrato (layout.MODOS_INFO); si el modelo todavía no los da, los de reserva.
  const RESERVA = {
    PARADA: { nombre: 'Parada', descripcion: 'Planta parada.', automatiza: 'Solo los niveles.' },
    MANUAL: { nombre: 'Manual', descripcion: 'El operador manda cada actuador.', automatiza: 'Nada; solo las protecciones cableadas.' },
    RECIRCULACION_AGUA: { nombre: 'Recirculación de agua', descripcion: 'Modo previo a producir.', automatiza: 'Caudal, calentamiento, FDV y niveles.' },
    PRODUCCION: { nombre: 'Producción', descripcion: 'Leche pasteurizada.', automatiza: 'Todo.' },
    CIP: { nombre: 'Limpieza CIP', descripcion: 'Limpieza en el sitio.', automatiza: 'Pasos de limpieza.' },
  };
  const layoutDisponible = () => (typeof require !== 'undefined' ? require('../layout.js') : (window.PCT && PCT.htstLayout)) || null;
  const MODOS_INFO = () => { const l = layoutDisponible(); return (l && l.MODOS_INFO) || RESERVA; };
  const ORDEN_MODOS = () => { const l = layoutDisponible(); return (l && l.MODOS) || Object.keys(RESERVA); };
  const nombreModo = modo => (MODOS_INFO()[modo] || {}).nombre || modo;
  const nombresModo = () => Object.fromEntries(ORDEN_MODOS().map(m => [m, nombreModo(m)]));        // { MODO: 'Nombre' } con los modos del contrato

  const dec = (v, c = 1) => (typeof v === 'number' ? v.toFixed(c).replace('.', ',') : '—');
  const formatoReloj = s => { const t = Math.floor(s); return [Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60].map(n => String(n).padStart(2, '0')).join(':'); };
  const franja = typeof require !== 'undefined' ? require('./franja_alarmas.js') : null;
  const niveles = typeof require !== 'undefined' ? require('./niveles.js') : null;
  const N = () => niveles || window.PCT.htstNiveles;        // en el navegador se carga después que esta página (lo trae el cargador)

  const lecturaTT103 = estado => {
    const tt = estado && estado.instrumentos && estado.instrumentos['TT-103'];
    return tt && tt.calidad && tt.calidad !== 'OK' ? `⚠ ${tt.calidad}` : tt && typeof tt.valorPLC === 'number' ? `${dec(tt.valorPLC)} °C` : '—';
  };
  const textoFdv = estado => { const fdv = estado && estado.equipos && estado.equipos['FDV-101']; return fdv ? (fdv.posicion === 'AVANCE' ? 'AVANCE' : fdv.posicion === 'DESVIO' ? 'DESVÍO' : '…') : '—'; };

  /** Texto corto de estado para la barra: modo, TT-103, caudal y posición de la FDV. */
  function resumenEstado(estado) {
    if (!estado) return '—';
    return `${nombreModo(estado.modo)} · TT-103 ${lecturaTT103(estado)} · caudal ${Math.round((estado.proceso && estado.proceso.caudalLh) || 0)} L/h · FDV ${textoFdv(estado)}`;
  }

  /** Chips de la barra: [{ id, titulo, valor, clase }]. La FDV en desvío es el estado SEGURO (no una alarma). */
  function datosChips(estado, nivel = 3) {
    const tt = estado && estado.instrumentos && estado.instrumentos['TT-103'];
    const fallo = !!(tt && tt.calidad && tt.calidad !== 'OK');
    const chips = [
      { id: 'reloj', titulo: 'Tiempo', valor: formatoReloj((estado && estado.tiempoS) || 0), clase: 'chip-reloj' },
      { id: 'modo', titulo: 'Modo', valor: estado ? (nivel === 1 ? (estado.modo === 'PARADA' ? 'Parada' : 'Automático') : nombreModo(estado.modo)) : '—', clase: '' },
      { id: 'tt103', titulo: 'TT-103', valor: lecturaTT103(estado), clase: fallo ? 'chip-fallo' : '' },
      { id: 'caudal', titulo: 'Caudal', valor: `${Math.round((estado && estado.proceso && estado.proceso.caudalLh) || 0)} L/h`, clase: '' },
      { id: 'fdv', titulo: 'FDV-101', valor: textoFdv(estado), clase: textoFdv(estado) === 'DESVÍO' ? 'chip-seguro' : '' },
    ];
    // Nivel 1: sin siglas («Temperatura», «Válvula de desvío: Deja pasar / Desvía»)
    return nivel === 1 ? chips.map(c => Object.assign(c, N().chipNivel1(c.id, c.titulo, c.valor))) : chips;
  }

  /** Texto del selector de modo: qué es y qué automatiza el PLC. */
  function descripcionModo(modo, nivel = 3) { if (nivel === 1) return N().INFO_MODOS_NIVEL_1; const m = MODOS_INFO()[modo]; return m ? `${m.descripcion} El PLC automatiza: ${m.automatiza}` : ''; }

  /** Alarmas ordenadas: la más grave primero y, a igual gravedad, la más antigua. Cada una: { clave, texto, desdeS, nivel }. */
  /**
   * Avisos que el PLC no genera pero que salen del estado de la planta (hoy, el rebosadero del tanque de balance). `memoria` guarda desde cuándo está activo cada uno
   * (Map clave → segundos) para que su hora no cambie en cada refresco.
   */
  function alarmasDerivadas(estado, memoria = new Map()) {
    const lista = [];
    const tk = estado && estado.equipos && estado.equipos['TK-101'];
    const activas = new Set();
    if (tk && tk.desbordando) {
      activas.add('R010');
      if (!memoria.has('R010')) memoria.set('R010', (estado && estado.tiempoS) || 0);
      lista.push({ codigo: 'R010', tag: 'TK-101', texto: 'Rebosando: TK-101 lleno con XV-101 abierta. Cierra XV-101.', nivel: 'aviso', desdeS: memoria.get('R010') });
    }
    for (const clave of [...memoria.keys()]) if (!activas.has(clave)) memoria.delete(clave);
    return lista;
  }

  function listaAlarmas(estado, memoria) {
    const f = franja || (typeof window !== 'undefined' && window.PCT && PCT.htstFranjaAlarmas);
    const todas = ((estado && estado.alarmas) || []).concat(alarmasDerivadas(estado, memoria));
    return f ? f.ordenarAlarmas(todas) : todas.map(a => ({ clave: `${a.codigo}:${a.tag}`, texto: `${a.codigo} · ${a.tag} · ${a.texto}`, desdeS: a.desdeS, nivel: a.nivel }));
  }

  /* ---------- parte con DOM ---------- */
  const escapar = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  /** Diálogo de confirmación accesible (role=alertdialog). Devuelve una promesa que resuelve true si se confirma. */
  function confirmar({ titulo, mensaje, ok = 'Confirmar' }) {
    return new Promise(resolver => {
      const antes = document.activeElement;
      const d = document.createElement('div'); d.id = 'dialogo-confirmar'; d.setAttribute('role', 'alertdialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'dlg-titulo'); d.setAttribute('aria-describedby', 'dlg-texto');
      d.innerHTML = `<h3 id="dlg-titulo">${escapar(titulo)}</h3><p id="dlg-texto">${escapar(mensaje)}</p><div class="botones"><button type="button" data-r="0">Cancelar</button><button type="button" data-r="1" class="peligro">${escapar(ok)}</button></div>`;
      document.body.appendChild(d);
      const cerrar = valor => { document.removeEventListener('keydown', teclas, true); d.remove(); if (antes && antes.focus) antes.focus(); resolver(valor); };
      const teclas = e => { if (e.key === 'Escape') { e.stopPropagation(); cerrar(false); } else if (e.key === 'Tab') { const b = [...d.querySelectorAll('button')]; const i = b.indexOf(document.activeElement); e.preventDefault(); b[(i + (e.shiftKey ? -1 : 1) + b.length) % b.length].focus(); } };
      document.addEventListener('keydown', teclas, true);
      d.addEventListener('click', e => { const b = e.target.closest('button'); if (b) cerrar(b.dataset.r === '1'); });
      d.querySelector('[data-r="0"]').focus();
    });
  }

  async function iniciar() {
    const raiz = document.getElementById('app');
    const { faltan } = await window.HTST_CARGADOR.cargarTodo();
    const creador = localizarSimulacion(PCT);
    let enDemostracion = false, crear = creador;
    if (!crear) { await window.HTST_CARGADOR.cargarScript('js/interfaz/simulacion_demo.js'); crear = PCT.htstDemo; enDemostracion = true; }
    const sim = crear.crearSimulacion({ semilla: 1 });
    const registro = PCT.htstHojas.crearRegistro(() => sim.estado().tiempoS);
    const escena3dOk = PCT.htstVisor.registrar();
    const profesor = PCT.htstPanelProfesor.esProfesor({ globalProfesor: window.PCT_ES_PROFESOR === true, hostname: location.hostname, search: location.search });
    // Nivel de dificultad: ?nivel= (con &bloquear=1 el profesor lo fija), si no el guardado en el navegador, si no 1 (3 para el profesor).
    const guardado = () => { try { return localStorage.getItem(N().CLAVE_ALMACEN); } catch (error) { return null; } };
    const fijado = N().bloqueado(location.search);
    let nivel = N().nivelInicial({ search: location.search, guardado: guardado(), profesor });

    raiz.innerHTML = `
      <header class="cab"><h1><a href="./" title="Planta real HTST"><img class="logo" src="/simulador/img/logo-politecnico.png" alt="CIFP Politécnico Cartagena" width="166" height="60"><span class="sim">PLANTA REAL HTST · PASTEURIZADOR DE LECHE</span></a></h1>
        <div class="selector-nivel" id="selector-nivel" role="group" aria-label="Nivel de dificultad" aria-describedby="nivel-info">${N().IDS.map(i => `<button type="button" data-nivel="${i}" aria-pressed="false"><b>Nivel ${i}</b><span>${escapar(N().NIVELES[i].nombre)}</span></button>`).join('')}</div>
        <button type="button" id="boton-planta3d">Planta 3D</button><button type="button" id="boton-ayuda">? Ayuda</button></header>
      <p class="nivel-info" id="nivel-info"></p>
      <div id="avisos"></div><div id="aviso-nivel" class="aviso-planta" role="status" hidden></div>
      <div id="zona-superior">
        <div class="barra" role="region" aria-label="Operación de la planta">
          <div class="acciones">
            <div class="grupo-simulacion" role="group" aria-label="Simulación"><button id="sim-play" type="button">Iniciar</button><button id="sim-pause" type="button" disabled>Pausar</button><button id="sim-reset" type="button">Reiniciar</button></div>
            <div class="grupo-seguridad" role="group" aria-label="Seguridad"><button id="sim-es" type="button" class="paro">PARO DE EMERGENCIA</button><button id="sim-rearme" type="button">Rearmar</button></div>
          </div>
          <div class="pista"><div class="chips" id="chips" aria-label="Estado de la planta"></div></div>
          <div class="derecha"><label>Modo de funcionamiento <select id="sim-modo" aria-describedby="modo-info">${ORDEN_MODOS().map(id => `<option value="${id}">${escapar(nombreModo(id))}</option>`).join('')}</select></label>
            <label class="n-min2">TT-103 consigna <input id="sim-consigna" type="number" min="60" max="85" step="0.5" value="73.5"> °C</label>
            <div class="velocidad" role="group" aria-label="Velocidad de simulación"><button type="button" data-v="1" aria-pressed="true">1×</button><button type="button" data-v="5" aria-pressed="false">5×</button><button type="button" data-v="20" aria-pressed="false">20×</button></div></div>
          <p class="modo-info" id="modo-info"></p>
        </div>
        <div id="franja-alarmas" class="n-min2" role="region" aria-label="Alarmas"></div>
        <div id="franja-simple" class="franja-simple" role="status" aria-label="Estado de la planta"><span class="simbolo" aria-hidden="true"></span><span class="texto"></span></div>
        <p class="banda-manual" id="banda-manual" hidden role="status"></p>
      </div>
      <div class="cuerpo"><main class="escena"><div class="barra-esquema"><div id="leyenda"></div>
            <div class="zoom-esquema" role="group" aria-label="Tamaño del esquema"><button type="button" data-z="-" aria-label="Reducir el esquema">A−</button><button type="button" data-z="legible" aria-pressed="false">Legible</button><button type="button" data-z="ajustar" aria-pressed="false">Ver todo</button><button type="button" data-z="+" aria-label="Ampliar el esquema">A+</button></div></div>
          <div class="lienzo" id="esquema"></div>
          <p class="pie-sim" id="pie-sim">Pulsa un equipo para ver su ficha. Valores típicos e ilustrativos.</p></main>
        <aside class="lateral" aria-label="Alarmas, mandos manuales, gráficas, instrumentos y hojas">
          <div class="pestanas" role="tablist" aria-label="Paneles"><button type="button" role="tab" id="t-alarmas" aria-controls="p-alarmas" data-p="p-alarmas" aria-selected="true" tabindex="0">Alarmas</button>
            <button type="button" role="tab" id="t-manual" aria-controls="p-manual" data-p="p-manual" aria-selected="false" aria-disabled="true" tabindex="-1" title="Solo en modo MANUAL">Manual</button>
            <button type="button" role="tab" id="t-graficas" aria-controls="p-graficas" data-p="p-graficas" aria-selected="false" tabindex="-1">Gráficas</button>
            <button type="button" role="tab" id="t-instrumentos" aria-controls="p-instrumentos" data-p="p-instrumentos" aria-selected="false" tabindex="-1">Instrumentos</button>
            <button type="button" role="tab" id="t-hojas" aria-controls="p-hojas" data-p="p-hojas" aria-selected="false" tabindex="-1">Hojas</button>
            ${profesor ? '<button type="button" role="tab" id="t-profesor" aria-controls="p-profesor" data-p="p-profesor" aria-selected="false" tabindex="-1">Profesor</button>' : ''}</div>
          <div class="panel-pestana" id="p-alarmas" role="tabpanel" aria-labelledby="t-alarmas"><h2>Alarmas activas</h2><ul id="lista-alarmas"></ul><div id="cargador" class="n-min3"></div></div>
          <div class="panel-pestana" id="p-manual" role="tabpanel" aria-labelledby="t-manual" hidden></div>
          <div class="panel-pestana" id="p-graficas" role="tabpanel" aria-labelledby="t-graficas" hidden></div>
          <div class="panel-pestana" id="p-instrumentos" role="tabpanel" aria-labelledby="t-instrumentos" hidden><div id="lecturas" class="solo-n2"></div><div id="multimetro" class="n-min3"></div><div id="osciloscopio" class="n-min3"></div></div>
          <div class="panel-pestana" id="p-hojas" role="tabpanel" aria-labelledby="t-hojas" hidden></div>
          ${profesor ? '<div class="panel-pestana" id="p-profesor" role="tabpanel" aria-labelledby="t-profesor" hidden></div>' : ''}</aside></div>`;
    const $ = id => document.getElementById(id);

    // avisos de lo que falta
    const avisos = [];
    if (enDemostracion) avisos.push('Modelo de demostración: falta el modelo real (física, PLC y averías). Sirve para probar la pantalla, no para evaluar.');
    if (!escena3dOk) avisos.push('Falta la escena 3D: «Planta 3D» no mostrará la planta.');
    if (faltan.length) console.info('[planta real] módulos no cargados:', faltan.join(', '));
    $('avisos').innerHTML = avisos.map(a => `<p class="aviso-planta" role="status">${escapar(a)}</p>`).join('');

    // SCADA 2D
    const { Canvas } = PCT.canvas, canvas = new Canvas(PCT.htstEsquema.ESQUEMA_HTST);
    $('esquema').replaceChildren(canvas.svg);
    // Consignas del panel de mando del esquema (caudal y TT-103): las guarda la página y se las da al PLC
    const PROC = PCT.htstLayout.PROCESO;
    const consignasPanel = { caudalLh: PROC.caudalNominalLh, tt103C: PROC.consignaTT103C };
    const objetos = PCT.htstEsquema.crearObjetos(canvas, { consignas: () => consignasPanel });
    PCT.htstLeyenda.crearLeyenda($('leyenda'));

    // Tamaño del esquema. «Legible» (por defecto): ocupa el ancho del marco pero nunca baja de 1160 px (escala ≥ 0,95: el texto de 12 unidades mide ≥ 11 px y los
    // valores de 14, ≥ 13 px); si no cabe se desplaza dentro del marco (la página nunca tiene scroll horizontal). «Ver todo»: se ajusta al marco (texto pequeño).
    // A− y A+ fijan un ancho propio y lo cambian de 15 en 15 %.
    const ANCHO_LEGIBLE = Math.round(0.95 * (canvas.svg.viewBox.baseVal.width || 1220));   // escala 0,95 sea cual sea el ancho del dibujo
    let tamano = { modo: 'legible', ancho: 0 };
    try { const g = JSON.parse(localStorage.getItem('htst-tamano-esquema') || 'null'); if (g && ['legible', 'ajustar', 'fijo'].includes(g.modo)) tamano = { modo: g.modo, ancho: Number(g.ancho) || 0 }; } catch (error) { /* sin almacenamiento: tamaño legible */ }
    if (tamano.modo === 'fijo' && !(tamano.ancho >= 500)) tamano = { modo: 'legible', ancho: 0 };
    function aplicarTamano() {
      const s = canvas.svg.style;
      if (tamano.modo === 'fijo') { s.width = `${tamano.ancho}px`; s.minWidth = '0'; }
      else { s.width = '100%'; s.minWidth = tamano.modo === 'legible' ? `${ANCHO_LEGIBLE}px` : '0'; }
      for (const m of ['legible', 'ajustar']) document.querySelector(`.zoom-esquema [data-z="${m}"]`).setAttribute('aria-pressed', String(tamano.modo === m));
      try { localStorage.setItem('htst-tamano-esquema', JSON.stringify(tamano)); } catch (error) { /* no pasa nada */ }
    }
    document.querySelector('.zoom-esquema').addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.z === 'legible') tamano = { modo: 'legible', ancho: 0 };
      else if (b.dataset.z === 'ajustar') tamano = { modo: 'ajustar', ancho: 0 };
      else { const actual = canvas.svg.getBoundingClientRect().width; tamano = { modo: 'fijo', ancho: Math.round(Math.max(500, Math.min(3200, b.dataset.z === '+' ? actual * 1.15 : actual / 1.15))) }; }
      aplicarTamano();
    });
    aplicarTamano();

    // Franja de alarmas y panel MANUAL
    const barraAlarmas = PCT.htstFranjaAlarmas.crearFranja($('franja-alarmas'), {
      alVerLista: () => { seleccionarPestana('p-alarmas'); $('p-alarmas').scrollIntoView({ block: 'nearest' }); },
      alReconocer: claves => registro.anotar('alarma', `Alarmas reconocidas: ${claves.join(', ')}`),
    });
    const panelManual = PCT.htstPanelManual.crearPanelManual($('p-manual'), { sim: () => sim, registro, alVolverAAuto: () => ponerModo('RECIRCULACION_AGUA'), alOrden: () => aplicarAhora(), enMarcha: () => corriendo });
    const ficha = PCT.htstAyuda.iniciarAyuda(canvas.svg, { nivel: () => nivel, niveles: N(), sim: () => sim, alVer3d: tag => PCT.visor3d.abrirEnVentana('HTST', () => sim.estado(), tag), alMedir: tag => irAMedir(tag), mandoFicha: tag => panelManual.crearMandoFicha(tag) });

    // Instrumentos, hojas, gráficas, profesor
    const mm = PCT.htstMultimetro.crearMultimetro($('multimetro'), { sim: () => sim, alMedir: m => registro.anotar('medida', `${m.instrumento} ${m.puntoA || m.punto}${m.puntoB ? ' ↔ ' + m.puntoB : ''}: ${m.texto}`, m) });
    const osc = PCT.htstOsciloscopio.crearOsciloscopio($('osciloscopio'), { sim: () => sim, alMedir: m => registro.anotar('medida', `osciloscopio ${m.punto} (${m.base}): ${m.texto}`, m) });
    PCT.htstHojas.crearHojas($('p-hojas'), { sim: () => sim, registro });
    const lecturas = PCT.htstPanelLecturas.crearPanelLecturas($('lecturas'));
    const historial = PCT.htstGrafica.crearHistorial(), graficas = PCT.htstGrafica.crearGraficas($('p-graficas'), { historial });
    if (profesor) PCT.htstPanelProfesor.crearPanelProfesor($('p-profesor'), { sim: () => sim, registro, alCambiar: refrescar });
    PCT.htstPanelProfesor.crearCargadorCodigo($('cargador'), { sim: () => sim, alCargar: () => { registro.anotar('averia', 'Se carga una avería con un código'); refrescar(); } });
    const codigo = PCT.htstPanelProfesor.codigoDeDireccion(location.search);
    if (codigo && nivel === 3) { const r = PCT.htstPanelProfesor.cargarCodigo(sim, codigo); registro.anotar('averia', r.ok ? 'Avería cargada desde el enlace' : r.mensaje); }
    else if (codigo) registro.anotar('averia', 'El enlace trae una avería, pero solo se carga en el nivel 3');

    function irAMedir(tag) {
      seleccionarPestana('p-instrumentos');
      const lista = PCT.htstPuntosMedida.puntosDeEquipo(tag, PCT.htstPuntosMedida.puntosDisponibles(sim));
      if (lista.length) { mm.seleccionar(lista[0].id, (lista.find(p => /:0V$|:-$|:A2$/.test(p.id)) || lista[lista.length - 1]).id); osc.seleccionar(lista[0].id); }
    }
    function seleccionarPestana(id) {
      const boton = document.querySelector(`.pestanas [data-p="${id}"]`);
      if (!boton || boton.hidden || boton.getAttribute('aria-disabled') === 'true') return;
      document.querySelectorAll('.pestanas [role="tab"]').forEach(b => { const s = b.dataset.p === id; b.setAttribute('aria-selected', String(s)); b.tabIndex = s ? 0 : -1; });
      document.querySelectorAll('.lateral .panel-pestana').forEach(p => { p.hidden = p.id !== id; });
      if (id === 'p-graficas') graficas.redibujar();
    }
    document.querySelector('.pestanas').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b) seleccionarPestana(b.dataset.p); });
    // Pestañas con teclado: flechas, Inicio y Fin
    document.querySelector('.pestanas').addEventListener('keydown', e => {
      const tabs = [...document.querySelectorAll('.pestanas [role="tab"]')].filter(t => t.getAttribute('aria-disabled') !== 'true' && !t.hidden);
      const i = tabs.indexOf(document.activeElement); if (i < 0) return;
      const ir = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (ir === undefined) return; e.preventDefault();
      const t = tabs[(ir + tabs.length) % tabs.length]; t.focus(); seleccionarPestana(t.dataset.p);
    });

    // Mando
    let corriendo = false, velocidad = 1, modoAnterior = null;
    const actualizarBotones = () => { $('sim-play').disabled = corriendo; $('sim-pause').disabled = !corriendo; };
    // El PLC solo aplica las órdenes dentro de un paso de la simulación. Con la simulación parada o en pausa se da dos pasos mínimos (0,2 s) para que el modo y
    // las órdenes manuales se reflejen al instante (banda, pestaña Manual, mandos, estado real); los niveles y las temperaturas solo cambian al correr el reloj.
    function aplicarAhora() { if (!corriendo) sim.paso(0.2); }      // dos ticks: el PLC aplica la orden en el primero y el equipo la sigue en el segundo
    function ponerModo(modo) { sim.ordenes.modo(modo); aplicarAhora(); $('sim-modo').value = N().valorDeSelector(nivel, modo); registro.anotar('accion', `Modo ${nombreModo(modo)}`); refrescar(); }
    $('sim-play').addEventListener('click', () => { if (sim.estado().modo === 'PARADA') { sim.ordenes.arrancar(); } corriendo = true; actualizarBotones(); registro.anotar('accion', 'Iniciar la simulación'); refrescar(); });
    $('sim-pause').addEventListener('click', () => { corriendo = false; actualizarBotones(); registro.anotar('accion', 'Pausar la simulación'); refrescar(); });
    $('sim-reset').addEventListener('click', async () => {
      const conAveria = sim.averias && sim.averias.activas && sim.averias.activas().length > 0;
      const si = await confirmar({ titulo: '¿Reiniciar la planta?', mensaje: `Se borran el estado, las gráficas y el registro${conAveria ? ' y las averías cargadas' : ''}. No se puede deshacer.`, ok: 'Reiniciar' });
      if (!si) return;
      sim.reiniciar(); historial.limpiar(); corriendo = false; actualizarBotones(); $('sim-modo').value = 'PARADA'; registro.anotar('accion', 'Reiniciar la planta'); refrescar();
    });
    $('sim-modo').addEventListener('change', () => {
      const v = $('sim-modo').value;
      if (v === 'AUTO') { if (sim.estado().modo === 'PARADA') sim.ordenes.arrancar(); registro.anotar('accion', 'Modo Automático'); }       // nivel 1: «Automático» = arrancar (recirculación → producción)
      else { sim.ordenes.modo(v); registro.anotar('accion', `Modo ${nombreModo(v)}`); }
      aplicarAhora(); refrescar();
    });
    $('sim-consigna').addEventListener('change', () => { sim.ordenes.consignaTemperaturaC(Number($('sim-consigna').value)); consignasPanel.tt103C = Math.min(85, Math.max(60, Number($('sim-consigna').value) || consignasPanel.tt103C)); registro.anotar('accion', `Consigna de TT-103: ${$('sim-consigna').value} °C`); refrescar(); });
    // Panel de mando dentro del esquema: caudal (o velocidad en MANUAL), consigna de TT-103, marcha, paro y rearme
    const accionesPanel = {
      'caudal-menos': () => cambiarCaudal(-1), 'caudal-mas': () => cambiarCaudal(1),
      'tt103-menos': () => cambiarTT103(-0.5), 'tt103-mas': () => cambiarTT103(0.5),
      marcha: () => { sim.ordenes.arrancar(); registro.anotar('accion', 'Panel: MARCHA'); },
      paro: () => { sim.ordenes.parar(); registro.anotar('accion', 'Panel: PARO'); },
      rearme: () => { if (sim.ordenes.paroEmergencia) sim.ordenes.paroEmergencia(false); sim.ordenes.pulsador('PB-001'); sim.ordenes.pulsador('TSH-201'); registro.anotar('accion', 'Panel: REARME (seta liberada, PB-001 y TSH-201)'); },
    };
    function cambiarCaudal(signo) {
      if (sim.estado().modo === 'MANUAL') {
        const v = Math.min(100, Math.max(0, Math.round(((sim.estado().salidasPLC.AO || {})['VFD-101'] || 0) + 10 * signo)));
        sim.ordenes.manual('VFD-101', v); registro.anotar('accion', `Panel: velocidad de P-101 ${v} %`);
      } else {
        consignasPanel.caudalLh = Math.min(PROC.caudalMaximoLh, Math.max(500, consignasPanel.caudalLh + 250 * signo));
        sim.ordenes.consignaCaudalLh(consignasPanel.caudalLh); registro.anotar('accion', `Panel: consigna de caudal ${consignasPanel.caudalLh} L/h`);
      }
    }
    function cambiarTT103(paso) {
      if (sim.estado().modo === 'MANUAL') return;                       // en MANUAL el PLC no regula: la consigna no hace nada
      consignasPanel.tt103C = Math.min(85, Math.max(60, Math.round((consignasPanel.tt103C + paso) * 10) / 10));
      sim.ordenes.consignaTemperaturaC(consignasPanel.tt103C); $('sim-consigna').value = consignasPanel.tt103C;
      registro.anotar('accion', `Panel: consigna de TT-103 ${String(consignasPanel.tt103C).replace('.', ',')} °C`);
    }
    const pulsarPanel = boton => { const f = accionesPanel[boton.dataset.accion]; if (!f) return; f(); aplicarAhora(); refrescar(); };
    canvas.svg.addEventListener('click', ev => { const b = ev.target.closest('.panel-boton'); if (b) { ev.stopPropagation(); pulsarPanel(b); } }, true);
    canvas.svg.addEventListener('keydown', ev => { const b = ev.target.closest('.panel-boton'); if (b && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); ev.stopPropagation(); pulsarPanel(b); } }, true);
    // Seta ES-001: el modelo real la mueve con paroEmergencia(true/false); PB-001 es el pulsador local de rearme del PLC. (La demostración solo conoce pulsador.)
    $('sim-es').addEventListener('click', () => { if (sim.ordenes.paroEmergencia) sim.ordenes.paroEmergencia(true); else sim.ordenes.pulsador('ES-001'); registro.anotar('accion', 'Se pulsa el paro de emergencia ES-001'); refrescar(); });
    $('sim-rearme').addEventListener('click', () => { if (sim.ordenes.paroEmergencia) sim.ordenes.paroEmergencia(false); sim.ordenes.pulsador('PB-001'); registro.anotar('accion', 'Se rearma: seta ES-001 liberada y pulsador PB-001'); refrescar(); });
    document.querySelector('.velocidad').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; velocidad = Number(b.dataset.v); document.querySelectorAll('.velocidad button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
    $('boton-planta3d').addEventListener('click', () => PCT.visor3d.abrirEnVentana('HTST', () => sim.estado()));
    $('boton-ayuda').addEventListener('click', () => { const cont = (nivel === 1 ? N().GUIA_NIVEL_1 : PCT.htstTextosAyuda.GUIA).map(([t, h]) => `<h4>${t}</h4>${h}`).join(''); ficha.cerrar(); mostrarGuia(cont); });

    function mostrarGuia(html) {
      let g = document.getElementById('guia-htst');
      if (!g) { g = document.createElement('div'); g.id = 'guia-htst'; g.setAttribute('role', 'dialog'); g.setAttribute('aria-modal', 'true'); g.setAttribute('aria-labelledby', 'guia-titulo'); document.body.appendChild(g); g.addEventListener('click', e => { if (e.target.closest('button')) { g.hidden = true; if (g.origen && g.origen.focus) g.origen.focus(); } }); document.addEventListener('keydown', e => { if (e.key === 'Escape' && !g.hidden) { g.hidden = true; if (g.origen && g.origen.focus) g.origen.focus(); } }); }
      g.origen = document.activeElement;
      g.innerHTML = `<header><h3 id="guia-titulo">Ayuda · planta real HTST</h3><button type="button" aria-label="Cerrar (Esc)">×</button></header><div class="cuerpo">${html}</div>`; g.hidden = false;
      g.querySelector('button').focus();
    }

    // Bucle
    let alarmasVistas = new Set(), firmaLista = '', ultimoChips = {};
    const memoriaDerivadas = new Map();
    function pintarChips(e) {
      const cont = $('chips');
      for (const c of datosChips(e, nivel)) {
        let el = cont.querySelector(`[data-chip="${c.id}"]`);
        if (!el) { el = document.createElement('div'); el.dataset.chip = c.id; el.innerHTML = `<small>${escapar(c.titulo)}</small><b></b>`; cont.appendChild(el); }
        const rotulo = el.querySelector('small'); if (rotulo.textContent !== c.titulo) rotulo.textContent = c.titulo;
        const clase = `chip ${c.clase}`.trim(); if (el.className !== clase) el.className = clase;
        if (ultimoChips[c.id] !== c.valor) { el.querySelector('b').textContent = c.valor; ultimoChips[c.id] = c.valor; }
        if (c.id === 'reloj') el.querySelector('b').id = 'sim-time';
      }
    }
    function refrescar() {
      const e = sim.estado();
      objetos.forEach(o => o.actualizar(e, PCT.htstEsquema.lecturasEsquema(e)));
      canvas.svg.classList.toggle('en-pausa', !corriendo);
      pintarChips(e);
      document.body.dataset.estado = e.alarmas && e.alarmas.some(a => a.nivel !== 'estado') ? 'alarma' : corriendo ? 'marcha' : 'reposo';

      // modo: selector sincronizado (el PLC puede cambiarlo solo), descripción y banda de MANUAL
      const sel = $('sim-modo');
      const valorSel = N().valorDeSelector(nivel, e.modo);
      if (document.activeElement !== sel && sel.value !== valorSel) sel.value = valorSel;
      const info = descripcionModo(e.modo, nivel); if ($('modo-info').textContent !== info) $('modo-info').textContent = info;
      const manual = e.modo === 'MANUAL' && nivel >= 2, banda = $('banda-manual');
      const textoBanda = manual ? `⚠ MODO MANUAL: mandas tú cada actuador; solo quedan las protecciones cableadas.${corriendo ? '' : ' Simulación parada: pulsa Iniciar para que corra el tiempo.'}` : '';
      banda.hidden = !manual; if (banda.textContent !== textoBanda) banda.textContent = textoBanda;
      const tabManual = $('t-manual');
      tabManual.setAttribute('aria-disabled', String(!manual)); tabManual.title = manual ? '' : 'Solo en modo MANUAL';
      if (manual && modoAnterior !== 'MANUAL') seleccionarPestana('p-manual');
      if (!manual && modoAnterior === 'MANUAL' && !$('p-manual').hidden) seleccionarPestana('p-alarmas');
      modoAnterior = e.modo;
      if (manual) panelManual.actualizar(e);

      // nivel 1: franja de estado en lenguaje claro (en lugar de la de alarmas) y, en el nivel 2, las lecturas de los instrumentos en solo lectura
      if (nivel === 1) {
        const s = N().estadoSimple(e), caja = $('franja-simple'), clave = `${s.clase}|${s.texto}`;
        if (caja.dataset.clave !== clave) { caja.dataset.clave = clave; caja.dataset.estado = s.clase; caja.querySelector('.simbolo').textContent = s.simbolo; caja.querySelector('.texto').textContent = s.texto; }
      }
      if (nivel === 2 && !$('p-instrumentos').hidden) lecturas.actualizar(e);

      // alarmas: franja siempre visible y lista lateral (solo se reescribe si cambia el conjunto)
      barraAlarmas.actualizar((e.alarmas || []).concat(alarmasDerivadas(e, memoriaDerivadas)));
      const alarmas = listaAlarmas(e, memoriaDerivadas), reconocidas = barraAlarmas.reconocidas();
      const firma = alarmas.map(a => `${a.clave}${reconocidas.has(a.clave) ? '*' : ''}`).join('|');
      if (firma !== firmaLista) {
        firmaLista = firma;
        $('lista-alarmas').innerHTML = alarmas.length ? alarmas.map(a => `<li class="alarma-${escapar(a.nivel || 'alarma')}${reconocidas.has(a.clave) ? ' reconocida' : ''}"><span class="simbolo" aria-hidden="true">${a.simbolo || '◆'}</span><span>${escapar(a.texto)}</span><span class="hora">${a.hora || ''}</span></li>`).join('') : '<li class="sin-alarmas">Sin alarmas.</li>';
      }
      for (const a of alarmas) if (!alarmasVistas.has(a.clave)) { alarmasVistas.add(a.clave); registro.anotar('alarma', a.texto); }
      alarmasVistas = new Set([...alarmasVistas].filter(c => alarmas.some(a => a.clave === c)));
    }
    let ultimaGrafica = 0;
    setInterval(() => {
      if (corriendo) sim.paso(0.25 * velocidad);
      refrescar();
      const e = sim.estado();
      if (corriendo) {
        const v = {}; for (const [tag, i] of Object.entries(e.instrumentos || {})) if (i && typeof i.valorPLC === 'number') v[tag] = i.valorPLC;
        historial.registrar(e.tiempoS, v);
      }
      if (performance.now() - ultimaGrafica > 1000 && !document.getElementById('p-graficas').hidden) { ultimaGrafica = performance.now(); graficas.redibujar(); }
    }, 250);

    /* ---------- niveles de dificultad ---------- */
    const SVG_NS = 'http://www.w3.org/2000/svg';
    /** Cambia los textos con data-t1 por su nombre sencillo (nivel 1) o los devuelve a su valor original. Un «|» separa líneas. */
    function aplicarTextosNivel1(activo) {
      for (const el of canvas.svg.querySelectorAll('[data-t1]')) {
        if (el.dataset.t3 === undefined) { el.dataset.t3 = el.textContent; el.dataset.x3 = el.getAttribute('x'); el.dataset.y3 = el.getAttribute('y'); }
        const x = activo && el.dataset.x1 !== undefined ? el.dataset.x1 : el.dataset.x3, y = activo && el.dataset.y1 !== undefined ? el.dataset.y1 : el.dataset.y3;
        el.setAttribute('x', x); el.setAttribute('y', y); el.replaceChildren();
        const lineas = (activo ? el.dataset.t1 : el.dataset.t3).split('|');
        if (lineas.length === 1) el.textContent = lineas[0];
        else lineas.forEach((linea, i) => { const ts = document.createElementNS(SVG_NS, 'tspan'); ts.setAttribute('x', x); ts.setAttribute('dy', i ? '13' : '0'); ts.textContent = linea; el.appendChild(ts); });
      }
    }
    let avisoNivelTimer = null;
    function avisarNivel(texto) {
      const caja = $('aviso-nivel'); caja.textContent = texto; caja.hidden = !texto;
      clearTimeout(avisoNivelTimer); if (texto) avisoNivelTimer = setTimeout(() => { caja.hidden = true; }, 12000);
    }
    function ponerNivel(nuevo, { guardar = true } = {}) {
      const v = N().nivelValido(nuevo); if (!v) return;
      const cambio = v !== nivel; nivel = v; N().fijarNivel(v);
      document.body.dataset.nivel = String(v);
      const info = N().NIVELES[v];
      document.querySelectorAll('#selector-nivel button').forEach(b => { b.setAttribute('aria-pressed', String(Number(b.dataset.nivel) === v)); b.disabled = fijado; b.title = fijado ? 'El profesor ha fijado el nivel' : N().NIVELES[b.dataset.nivel].descripcion; });
      $('nivel-info').textContent = `Nivel ${v} · ${info.nombre}: ${info.descripcion}${fijado ? ' (fijado por el profesor)' : ''}`;
      aplicarTextosNivel1(v === 1);
      $('pie-sim').textContent = v === 1 ? 'Pulsa un equipo para ver qué es. Pasa el ratón para ver su código. Valores típicos e ilustrativos.'
        : 'Pulsa un equipo para ver su ficha. Valores típicos e ilustrativos.';
      // pestañas permitidas en este nivel
      document.querySelectorAll('.pestanas [role="tab"]').forEach(b => { b.hidden = !N().pestanaPermitida(v, b.dataset.p); });
      const abierta = document.querySelector('.pestanas [aria-selected="true"]');
      if (!abierta || abierta.hidden) seleccionarPestana(v === 1 ? 'p-graficas' : 'p-alarmas');
      // selector de modo: los del nivel; si el modo actual no está permitido se pasa al más cercano que sí lo está, avisando
      const sel = $('sim-modo');
      sel.innerHTML = N().opcionesDeModo(v, ORDEN_MODOS(), nombreModo).map(o => `<option value="${o.valor}">${escapar(o.nombre)}</option>`).join('');
      const modo = sim.estado().modo, cercano = N().modoMasCercano(v, modo);
      let aviso = '';
      if (cercano !== modo) { ponerModo(cercano); aviso = `El nivel ${v} no tiene ${nombreModo(modo)}: pasa a ${nombreModo(cercano)}.`; }
      sel.value = N().valorDeSelector(v, sim.estado().modo);
      if (v < 3 && sim.averias && sim.averias.activas && sim.averias.activas().length) aviso += `${aviso ? ' ' : ''}Hay una avería activa: se repara en el nivel 3.`;
      if (cambio) avisarNivel(aviso);
      ficha.cerrar(); chipTag.hidden = true;
      if (guardar && !fijado) { try { localStorage.setItem(N().CLAVE_ALMACEN, String(v)); } catch (error) { /* sin almacenamiento: no se recuerda */ } }
      if (cambio) registro.anotar('accion', `Nivel ${v} · ${info.nombre}`);
      refrescar();
    }
    document.getElementById('selector-nivel').addEventListener('click', e => { const b = e.target.closest('button[data-nivel]'); if (b && !fijado) ponerNivel(Number(b.dataset.nivel)); });

    // Nivel 1: el código (tag) de cada equipo aparece solo al pasar el ratón o con el foco, como un chip pequeño
    const chipTag = document.createElement('div'); chipTag.id = 'chip-tag'; chipTag.hidden = true; chipTag.setAttribute('aria-hidden', 'true'); document.body.appendChild(chipTag);
    const mostrarChip = nodo => {
      const g = nodo && nodo.closest ? nodo.closest('g[data-tag]') : null;
      if (nivel !== 1 || !g) { chipTag.hidden = true; return; }
      const r = g.getBoundingClientRect(); chipTag.textContent = g.dataset.tag;
      chipTag.style.left = `${Math.round(r.left + r.width / 2)}px`; chipTag.style.top = `${Math.round(r.bottom + 6)}px`; chipTag.hidden = false;
    };
    canvas.svg.addEventListener('mouseover', e => mostrarChip(e.target)); canvas.svg.addEventListener('mouseout', () => { chipTag.hidden = true; });
    canvas.svg.addEventListener('focusin', e => mostrarChip(e.target)); canvas.svg.addEventListener('focusout', () => { chipTag.hidden = true; });

    ponerNivel(nivel, { guardar: false });

    // Para la ventana aparte del 3D y para las pruebas
    PCT.htstApp = { estadoActual: () => sim.estado(), sim, registro, enDemostracion, ponerModo, seleccionarPestana, nivel: () => nivel, ponerNivel };
  }

  const api = { localizarSimulacion, resumenEstado, datosChips, descripcionModo, listaAlarmas, alarmasDerivadas, formatoReloj, nombresModo, nombreModo, iniciar };
  // Fuera de PCT: modulos.js (de simulador_pct23) hace `var PCT = {}` al cargarse y borraría lo que hubiera antes.
  if (typeof module !== 'undefined') module.exports = api;
  else { window.HTST_PAGINA = api; if (document.getElementById('app')) iniciar().catch(error => { console.error(error); document.getElementById('app').innerHTML = `<p class="aviso-planta">No se pudo iniciar la planta: ${escapar(error.message || error)}</p>`; }); }
})();
