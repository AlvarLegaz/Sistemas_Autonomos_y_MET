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
  function datosChips(estado) {
    const tt = estado && estado.instrumentos && estado.instrumentos['TT-103'];
    const fallo = !!(tt && tt.calidad && tt.calidad !== 'OK');
    return [
      { id: 'reloj', titulo: 'Tiempo', valor: formatoReloj((estado && estado.tiempoS) || 0), clase: 'chip-reloj' },
      { id: 'modo', titulo: 'Modo', valor: estado ? nombreModo(estado.modo) : '—', clase: '' },
      { id: 'tt103', titulo: 'TT-103', valor: lecturaTT103(estado), clase: fallo ? 'chip-fallo' : '' },
      { id: 'caudal', titulo: 'Caudal', valor: `${Math.round((estado && estado.proceso && estado.proceso.caudalLh) || 0)} L/h`, clase: '' },
      { id: 'fdv', titulo: 'FDV-101', valor: textoFdv(estado), clase: textoFdv(estado) === 'DESVÍO' ? 'chip-seguro' : '' },
    ];
  }

  /** Texto del selector de modo: qué es y qué automatiza el PLC. */
  function descripcionModo(modo) { const m = MODOS_INFO()[modo]; return m ? `${m.descripcion} El PLC automatiza: ${m.automatiza}` : ''; }

  /** Alarmas ordenadas: la más grave primero y, a igual gravedad, la más antigua. Cada una: { clave, texto, desdeS, nivel }. */
  function listaAlarmas(estado) {
    const f = franja || (typeof window !== 'undefined' && window.PCT && PCT.htstFranjaAlarmas);
    return f ? f.ordenarAlarmas(estado && estado.alarmas) : ((estado && estado.alarmas) || []).map(a => ({ clave: `${a.codigo}:${a.tag}`, texto: `${a.codigo} · ${a.tag} · ${a.texto}`, desdeS: a.desdeS, nivel: a.nivel }));
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

    raiz.innerHTML = `
      <header class="cab"><h1><a href="./" title="Planta real HTST"><img class="logo" src="/simulador/img/logo-politecnico.png" alt="CIFP Politécnico Cartagena" width="166" height="60"><span class="sim">PLANTA REAL HTST · PASTEURIZADOR DE LECHE</span></a></h1>
        <button type="button" id="boton-planta3d">Planta 3D</button><button type="button" id="boton-ayuda">? Ayuda</button></header>
      <div id="avisos"></div>
      <div id="zona-superior">
        <div class="barra" role="region" aria-label="Operación de la planta">
          <div class="acciones">
            <div class="grupo-simulacion" role="group" aria-label="Simulación"><button id="sim-play" type="button">Iniciar</button><button id="sim-pause" type="button" disabled>Pausar</button><button id="sim-reset" type="button">Reiniciar</button></div>
            <div class="grupo-seguridad" role="group" aria-label="Seguridad"><button id="sim-es" type="button" class="paro">PARO DE EMERGENCIA</button><button id="sim-rearme" type="button">Rearmar</button></div>
          </div>
          <div class="pista"><div class="chips" id="chips" aria-label="Estado de la planta"></div></div>
          <div class="derecha"><label>Modo de funcionamiento <select id="sim-modo" aria-describedby="modo-info">${ORDEN_MODOS().map(id => `<option value="${id}">${escapar(nombreModo(id))}</option>`).join('')}</select></label>
            <label>TT-103 consigna <input id="sim-consigna" type="number" min="60" max="85" step="0.5" value="73.5"> °C</label>
            <div class="velocidad" role="group" aria-label="Velocidad de simulación"><button type="button" data-v="1" aria-pressed="true">1×</button><button type="button" data-v="5" aria-pressed="false">5×</button><button type="button" data-v="20" aria-pressed="false">20×</button></div></div>
          <p class="modo-info" id="modo-info"></p>
        </div>
        <div id="franja-alarmas" role="region" aria-label="Alarmas"></div>
        <p class="banda-manual" id="banda-manual" hidden role="status"></p>
      </div>
      <div class="cuerpo"><main class="escena"><div class="lienzo" id="esquema"></div><div id="leyenda"></div>
          <p class="pie-sim">Pulsa (o tabula y pulsa Intro) cualquier equipo del esquema para ver su ficha. Valores numéricos típicos e ilustrativos.</p></main>
        <aside class="lateral" aria-label="Alarmas, mandos manuales, gráficas, instrumentos y hojas">
          <div class="pestanas" role="tablist" aria-label="Paneles"><button type="button" role="tab" id="t-alarmas" aria-controls="p-alarmas" data-p="p-alarmas" aria-selected="true" tabindex="0">Alarmas</button>
            <button type="button" role="tab" id="t-manual" aria-controls="p-manual" data-p="p-manual" aria-selected="false" aria-disabled="true" tabindex="-1" title="Solo en modo MANUAL">Manual</button>
            <button type="button" role="tab" id="t-graficas" aria-controls="p-graficas" data-p="p-graficas" aria-selected="false" tabindex="-1">Gráficas</button>
            <button type="button" role="tab" id="t-instrumentos" aria-controls="p-instrumentos" data-p="p-instrumentos" aria-selected="false" tabindex="-1">Instrumentos</button>
            <button type="button" role="tab" id="t-hojas" aria-controls="p-hojas" data-p="p-hojas" aria-selected="false" tabindex="-1">Hojas</button>
            ${profesor ? '<button type="button" role="tab" id="t-profesor" aria-controls="p-profesor" data-p="p-profesor" aria-selected="false" tabindex="-1">Profesor</button>' : ''}</div>
          <div class="panel-pestana" id="p-alarmas" role="tabpanel" aria-labelledby="t-alarmas"><h2>Alarmas activas</h2><ul id="lista-alarmas"></ul><div id="cargador"></div></div>
          <div class="panel-pestana" id="p-manual" role="tabpanel" aria-labelledby="t-manual" hidden></div>
          <div class="panel-pestana" id="p-graficas" role="tabpanel" aria-labelledby="t-graficas" hidden></div>
          <div class="panel-pestana" id="p-instrumentos" role="tabpanel" aria-labelledby="t-instrumentos" hidden><div id="multimetro"></div><div id="osciloscopio"></div></div>
          <div class="panel-pestana" id="p-hojas" role="tabpanel" aria-labelledby="t-hojas" hidden></div>
          ${profesor ? '<div class="panel-pestana" id="p-profesor" role="tabpanel" aria-labelledby="t-profesor" hidden></div>' : ''}</aside></div>`;
    const $ = id => document.getElementById(id);

    // avisos de lo que falta
    const avisos = [];
    if (enDemostracion) avisos.push('Modelo de demostración de la interfaz: el modelo real de la planta (física, PLC y averías) todavía no está cargado. Sirve para probar la pantalla, no para evaluar.');
    if (!escena3dOk) avisos.push('La escena 3D de la planta real todavía no está cargada: «Planta 3D» no mostrará la planta.');
    if (faltan.length) console.info('[planta real] módulos no cargados:', faltan.join(', '));
    $('avisos').innerHTML = avisos.map(a => `<p class="aviso-planta" role="status">${escapar(a)}</p>`).join('');

    // SCADA 2D
    const { Canvas } = PCT.canvas, canvas = new Canvas(PCT.htstEsquema.ESQUEMA_HTST);
    $('esquema').replaceChildren(canvas.svg);
    const objetos = PCT.htstEsquema.crearObjetos(canvas);
    PCT.htstLeyenda.crearLeyenda($('leyenda'));

    // Franja de alarmas y panel MANUAL
    const barraAlarmas = PCT.htstFranjaAlarmas.crearFranja($('franja-alarmas'), {
      alVerLista: () => { seleccionarPestana('p-alarmas'); $('p-alarmas').scrollIntoView({ block: 'nearest' }); },
      alReconocer: claves => registro.anotar('alarma', `Alarmas reconocidas: ${claves.join(', ')}`),
    });
    const panelManual = PCT.htstPanelManual.crearPanelManual($('p-manual'), { sim: () => sim, registro, alVolverAAuto: () => ponerModo('RECIRCULACION_AGUA') });
    const ficha = PCT.htstAyuda.iniciarAyuda(canvas.svg, { sim: () => sim, alVer3d: tag => PCT.visor3d.abrirEnVentana('HTST', () => sim.estado(), tag), alMedir: tag => irAMedir(tag), mandoFicha: tag => panelManual.crearMandoFicha(tag) });

    // Instrumentos, hojas, gráficas, profesor
    const mm = PCT.htstMultimetro.crearMultimetro($('multimetro'), { sim: () => sim, alMedir: m => registro.anotar('medida', `${m.instrumento} ${m.puntoA || m.punto}${m.puntoB ? ' ↔ ' + m.puntoB : ''}: ${m.texto}`, m) });
    const osc = PCT.htstOsciloscopio.crearOsciloscopio($('osciloscopio'), { sim: () => sim, alMedir: m => registro.anotar('medida', `osciloscopio ${m.punto} (${m.base}): ${m.texto}`, m) });
    PCT.htstHojas.crearHojas($('p-hojas'), { sim: () => sim, registro });
    const historial = PCT.htstGrafica.crearHistorial(), graficas = PCT.htstGrafica.crearGraficas($('p-graficas'), { historial });
    if (profesor) PCT.htstPanelProfesor.crearPanelProfesor($('p-profesor'), { sim: () => sim, registro, alCambiar: refrescar });
    PCT.htstPanelProfesor.crearCargadorCodigo($('cargador'), { sim: () => sim, alCargar: () => { registro.anotar('averia', 'Se carga una avería con un código'); refrescar(); } });
    const codigo = PCT.htstPanelProfesor.codigoDeDireccion(location.search);
    if (codigo) { const r = PCT.htstPanelProfesor.cargarCodigo(sim, codigo); registro.anotar('averia', r.ok ? 'Avería cargada desde el enlace' : r.mensaje); }

    function irAMedir(tag) {
      seleccionarPestana('p-instrumentos');
      const lista = PCT.htstPuntosMedida.puntosDeEquipo(tag, PCT.htstPuntosMedida.puntosDisponibles(sim));
      if (lista.length) { mm.seleccionar(lista[0].id, (lista.find(p => /:0V$|:-$|:A2$/.test(p.id)) || lista[lista.length - 1]).id); osc.seleccionar(lista[0].id); }
    }
    function seleccionarPestana(id) {
      const boton = document.querySelector(`.pestanas [data-p="${id}"]`);
      if (!boton || boton.getAttribute('aria-disabled') === 'true') return;
      document.querySelectorAll('.pestanas [role="tab"]').forEach(b => { const s = b.dataset.p === id; b.setAttribute('aria-selected', String(s)); b.tabIndex = s ? 0 : -1; });
      document.querySelectorAll('.lateral .panel-pestana').forEach(p => { p.hidden = p.id !== id; });
      if (id === 'p-graficas') graficas.redibujar();
    }
    document.querySelector('.pestanas').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b) seleccionarPestana(b.dataset.p); });
    // Pestañas con teclado: flechas, Inicio y Fin
    document.querySelector('.pestanas').addEventListener('keydown', e => {
      const tabs = [...document.querySelectorAll('.pestanas [role="tab"]')].filter(t => t.getAttribute('aria-disabled') !== 'true');
      const i = tabs.indexOf(document.activeElement); if (i < 0) return;
      const ir = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (ir === undefined) return; e.preventDefault();
      const t = tabs[(ir + tabs.length) % tabs.length]; t.focus(); seleccionarPestana(t.dataset.p);
    });

    // Mando
    let corriendo = false, velocidad = 1, modoAnterior = null;
    const actualizarBotones = () => { $('sim-play').disabled = corriendo; $('sim-pause').disabled = !corriendo; };
    function ponerModo(modo) { sim.ordenes.modo(modo); $('sim-modo').value = modo; registro.anotar('accion', `Modo ${nombreModo(modo)}`); refrescar(); }
    $('sim-play').addEventListener('click', () => { if (sim.estado().modo === 'PARADA') { sim.ordenes.arrancar(); } corriendo = true; actualizarBotones(); registro.anotar('accion', 'Iniciar la simulación'); refrescar(); });
    $('sim-pause').addEventListener('click', () => { corriendo = false; actualizarBotones(); registro.anotar('accion', 'Pausar la simulación'); refrescar(); });
    $('sim-reset').addEventListener('click', async () => {
      const conAveria = sim.averias && sim.averias.activas && sim.averias.activas().length > 0;
      const si = await confirmar({ titulo: '¿Reiniciar la planta?', mensaje: `Se perderán el estado de la planta, el historial de las gráficas y el registro${conAveria ? ' y las averías cargadas' : ''}. No se puede deshacer.`, ok: 'Reiniciar' });
      if (!si) return;
      sim.reiniciar(); historial.limpiar(); corriendo = false; actualizarBotones(); $('sim-modo').value = 'PARADA'; registro.anotar('accion', 'Reiniciar la planta'); refrescar();
    });
    $('sim-modo').addEventListener('change', () => { sim.ordenes.modo($('sim-modo').value); registro.anotar('accion', `Modo ${nombreModo($('sim-modo').value)}`); refrescar(); });
    $('sim-consigna').addEventListener('change', () => { sim.ordenes.consignaTemperaturaC(Number($('sim-consigna').value)); registro.anotar('accion', `Consigna de TT-103: ${$('sim-consigna').value} °C`); });
    // Seta ES-001: el modelo real la mueve con paroEmergencia(true/false); PB-001 es el pulsador local de rearme del PLC. (La demostración solo conoce pulsador.)
    $('sim-es').addEventListener('click', () => { if (sim.ordenes.paroEmergencia) sim.ordenes.paroEmergencia(true); else sim.ordenes.pulsador('ES-001'); registro.anotar('accion', 'Se pulsa el paro de emergencia ES-001'); refrescar(); });
    $('sim-rearme').addEventListener('click', () => { if (sim.ordenes.paroEmergencia) sim.ordenes.paroEmergencia(false); sim.ordenes.pulsador('PB-001'); registro.anotar('accion', 'Se rearma: seta ES-001 liberada y pulsador PB-001'); refrescar(); });
    document.querySelector('.velocidad').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; velocidad = Number(b.dataset.v); document.querySelectorAll('.velocidad button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
    $('boton-planta3d').addEventListener('click', () => PCT.visor3d.abrirEnVentana('HTST', () => sim.estado()));
    $('boton-ayuda').addEventListener('click', () => { const cont = PCT.htstTextosAyuda.GUIA.map(([t, h]) => `<h4>${t}</h4>${h}`).join(''); ficha.cerrar(); mostrarGuia(cont); });

    function mostrarGuia(html) {
      let g = document.getElementById('guia-htst');
      if (!g) { g = document.createElement('div'); g.id = 'guia-htst'; g.setAttribute('role', 'dialog'); g.setAttribute('aria-modal', 'true'); g.setAttribute('aria-labelledby', 'guia-titulo'); document.body.appendChild(g); g.addEventListener('click', e => { if (e.target.closest('button')) { g.hidden = true; if (g.origen && g.origen.focus) g.origen.focus(); } }); document.addEventListener('keydown', e => { if (e.key === 'Escape' && !g.hidden) { g.hidden = true; if (g.origen && g.origen.focus) g.origen.focus(); } }); }
      g.origen = document.activeElement;
      g.innerHTML = `<header><h3 id="guia-titulo">Ayuda · planta real HTST</h3><button type="button" aria-label="Cerrar (Esc)">×</button></header><div class="cuerpo">${html}</div>`; g.hidden = false;
      g.querySelector('button').focus();
    }

    // Bucle
    let alarmasVistas = new Set(), firmaLista = '', ultimoChips = {};
    function pintarChips(e) {
      const cont = $('chips');
      for (const c of datosChips(e)) {
        let el = cont.querySelector(`[data-chip="${c.id}"]`);
        if (!el) { el = document.createElement('div'); el.dataset.chip = c.id; el.innerHTML = `<small>${escapar(c.titulo)}</small><b></b>`; cont.appendChild(el); }
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
      if (document.activeElement !== sel && sel.value !== e.modo) sel.value = e.modo;
      const info = descripcionModo(e.modo); if ($('modo-info').textContent !== info) $('modo-info').textContent = info;
      const manual = e.modo === 'MANUAL', banda = $('banda-manual');
      const textoBanda = manual ? `⚠ MODO MANUAL: el PLC no automatiza. Tú mandas cada actuador; solo siguen las protecciones cableadas.${corriendo ? '' : ' La simulación está en pausa: pulsa Iniciar para que se cumplan tus órdenes.'}` : '';
      banda.hidden = !manual; if (banda.textContent !== textoBanda) banda.textContent = textoBanda;
      const tabManual = $('t-manual');
      tabManual.setAttribute('aria-disabled', String(!manual)); tabManual.title = manual ? '' : 'Solo en modo MANUAL';
      if (manual && modoAnterior !== 'MANUAL') seleccionarPestana('p-manual');
      if (!manual && modoAnterior === 'MANUAL' && !$('p-manual').hidden) seleccionarPestana('p-alarmas');
      modoAnterior = e.modo;
      if (manual) panelManual.actualizar(e);

      // alarmas: franja siempre visible y lista lateral (solo se reescribe si cambia el conjunto)
      barraAlarmas.actualizar(e.alarmas);
      const alarmas = listaAlarmas(e), reconocidas = barraAlarmas.reconocidas();
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
    refrescar();

    // Para la ventana aparte del 3D y para las pruebas
    PCT.htstApp = { estadoActual: () => sim.estado(), sim, registro, enDemostracion, ponerModo, seleccionarPestana };
  }

  const api = { localizarSimulacion, resumenEstado, datosChips, descripcionModo, listaAlarmas, formatoReloj, nombresModo, nombreModo, iniciar };
  // Fuera de PCT: modulos.js (de simulador_pct23) hace `var PCT = {}` al cargarse y borraría lo que hubiera antes.
  if (typeof module !== 'undefined') module.exports = api;
  else { window.HTST_PAGINA = api; if (document.getElementById('app')) iniciar().catch(error => { console.error(error); document.getElementById('app').innerHTML = `<p class="aviso-planta">No se pudo iniciar la planta: ${escapar(error.message || error)}</p>`; }); }
})();
