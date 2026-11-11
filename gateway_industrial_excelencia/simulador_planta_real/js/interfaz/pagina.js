// Página de operación de la planta real HTST: monta la barra de mando, el SCADA 2D, las alarmas, las gráficas, los instrumentos virtuales, las hojas del
// alumno y el panel del profesor, y mueve la simulación. Las funciones puras (elegir simulación, resumen del estado, lista de alarmas) se prueban con node:test.
(function () {
  /** La simulación real (PROGRAMADOR-MODELO) si está cargada; si no, null. Acepta PCT.htst.simulacion y PCT.htstSimulacion. */
  function localizarSimulacion(espacio) {
    const cand = (espacio.htst && espacio.htst.simulacion) || espacio.htstSimulacion;
    return cand && typeof cand.crearSimulacion === 'function' ? cand : null;
  }

  const NOMBRES_MODO = { PARADA: 'Parada', RECIRCULACION_AGUA: 'Recirculación de agua', PRODUCCION: 'Producción', CIP: 'Limpieza CIP' };
  const dec = (v, c = 1) => (typeof v === 'number' ? v.toFixed(c).replace('.', ',') : '—');
  const formatoReloj = s => { const t = Math.floor(s); return [Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60].map(n => String(n).padStart(2, '0')).join(':'); };

  /** Texto corto de estado para la barra: modo, TT-103, caudal y posición de la FDV. */
  function resumenEstado(estado) {
    if (!estado) return '—';
    const tt = estado.instrumentos && estado.instrumentos['TT-103'], fdv = estado.equipos && estado.equipos['FDV-101'];
    const lectura = tt && tt.calidad && tt.calidad !== 'OK' ? `⚠ ${tt.calidad}` : tt && typeof tt.valorPLC === 'number' ? `${dec(tt.valorPLC)} °C` : '—';
    return `${NOMBRES_MODO[estado.modo] || estado.modo} · TT-103 ${lectura} · caudal ${Math.round((estado.proceso && estado.proceso.caudalLh) || 0)} L/h · FDV ${fdv ? (fdv.posicion === 'AVANCE' ? 'AVANCE' : fdv.posicion === 'DESVIO' ? 'DESVÍO' : '…') : '—'}`;
  }

  /** Alarmas ordenadas: las más recientes primero. Cada una: { clave, texto, desdeS }. */
  function listaAlarmas(estado) {
    return ((estado && estado.alarmas) || []).slice().sort((a, b) => b.desdeS - a.desdeS).map(a => ({ clave: `${a.codigo}:${a.tag}`, texto: `${a.codigo} · ${a.tag} · ${a.texto}`, desdeS: a.desdeS, nivel: a.nivel }));
  }

  /* ---------- parte con DOM ---------- */
  const escapar = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

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
    const mapa = { sim: () => sim };

    raiz.innerHTML = `
      <header class="cab"><h1><a href="./" title="Planta real HTST"><img class="logo" src="/simulador/img/logo-politecnico.png" alt="CIFP Politécnico Cartagena" width="166" height="60"><span class="sim">PLANTA REAL HTST · PASTEURIZADOR DE LECHE</span></a></h1>
        <button type="button" id="boton-planta3d">Planta 3D</button><button type="button" id="boton-ayuda">? Ayuda</button></header>
      <div id="avisos"></div>
      <div class="barra" role="region" aria-label="Operación de la planta">
        <div class="acciones"><button id="sim-play" type="button">Iniciar</button><button id="sim-pause" type="button" disabled>Pausar</button><button id="sim-reset" type="button">Reiniciar</button>
          <button id="sim-es" type="button" class="paro">PARO DE EMERGENCIA</button><button id="sim-rearme" type="button">Rearmar</button></div>
        <div class="pista"><p class="estado-manual" aria-live="polite"><b id="sim-time">00:00:00</b><span id="sim-status">—</span></p></div>
        <div class="derecha"><label>Modo <select id="sim-modo">${Object.entries(NOMBRES_MODO).map(([id, n]) => `<option value="${id}">${n}</option>`).join('')}</select></label>
          <label>TT-103 consigna <input id="sim-consigna" type="number" min="60" max="85" step="0.5" value="73.5"> °C</label>
          <div class="velocidad" role="group" aria-label="Velocidad de simulación"><button type="button" data-v="1" aria-pressed="true">1×</button><button type="button" data-v="5" aria-pressed="false">5×</button><button type="button" data-v="20" aria-pressed="false">20×</button></div></div>
      </div>
      <div class="cuerpo"><main class="escena"><div class="lienzo" id="esquema"></div><div id="leyenda"></div>
          <p class="pie-sim">Pulsa cualquier equipo del esquema para ver su ficha. Valores numéricos típicos e ilustrativos.</p></main>
        <aside class="lateral" aria-label="Alarmas, gráficas, instrumentos y hojas">
          <div class="pestanas" role="tablist"><button type="button" role="tab" data-p="p-alarmas" aria-selected="true">Alarmas</button><button type="button" role="tab" data-p="p-graficas" aria-selected="false">Gráficas</button>
            <button type="button" role="tab" data-p="p-instrumentos" aria-selected="false">Instrumentos</button><button type="button" role="tab" data-p="p-hojas" aria-selected="false">Hojas</button>
            ${profesor ? '<button type="button" role="tab" data-p="p-profesor" aria-selected="false">Profesor</button>' : ''}</div>
          <div class="panel-pestana" id="p-alarmas" role="tabpanel"><h2>Alarmas activas</h2><ul id="lista-alarmas" aria-live="polite"></ul><div id="cargador"></div></div>
          <div class="panel-pestana" id="p-graficas" role="tabpanel" hidden></div>
          <div class="panel-pestana" id="p-instrumentos" role="tabpanel" hidden><div id="multimetro"></div><div id="osciloscopio"></div></div>
          <div class="panel-pestana" id="p-hojas" role="tabpanel" hidden></div>
          ${profesor ? '<div class="panel-pestana" id="p-profesor" role="tabpanel" hidden></div>' : ''}</aside></div>`;
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
    const ficha = PCT.htstAyuda.iniciarAyuda(canvas.svg, { sim: () => sim, alVer3d: tag => PCT.visor3d.abrirEnVentana('HTST', () => sim.estado(), tag), alMedir: tag => irAMedir(tag) });

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
      document.querySelectorAll('.pestanas [role="tab"]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.p === id)));
      document.querySelectorAll('.lateral .panel-pestana').forEach(p => { p.hidden = p.id !== id; });
      if (id === 'p-graficas') graficas.redibujar();
    }
    document.querySelector('.pestanas').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b) seleccionarPestana(b.dataset.p); });

    // Mando
    let corriendo = false, velocidad = 1;
    const actualizarBotones = () => { $('sim-play').disabled = corriendo; $('sim-pause').disabled = !corriendo; };
    $('sim-play').addEventListener('click', () => { if (sim.estado().modo === 'PARADA') { sim.ordenes.arrancar(); $('sim-modo').value = sim.estado().modo; } corriendo = true; actualizarBotones(); registro.anotar('accion', 'Iniciar la simulación'); });
    $('sim-pause').addEventListener('click', () => { corriendo = false; actualizarBotones(); registro.anotar('accion', 'Pausar la simulación'); });
    $('sim-reset').addEventListener('click', () => { sim.reiniciar(); historial.limpiar(); corriendo = false; actualizarBotones(); $('sim-modo').value = 'PARADA'; registro.anotar('accion', 'Reiniciar la planta'); refrescar(); });
    $('sim-modo').addEventListener('change', () => { sim.ordenes.modo($('sim-modo').value); registro.anotar('accion', `Modo ${$('sim-modo').value}`); });
    $('sim-consigna').addEventListener('change', () => { sim.ordenes.consignaTemperaturaC(Number($('sim-consigna').value)); registro.anotar('accion', `Consigna de TT-103: ${$('sim-consigna').value} °C`); });
    // Seta ES-001: el modelo real la mueve con paroEmergencia(true/false); PB-001 es el pulsador local de rearme del PLC. (La demostración solo conoce pulsador.)
    $('sim-es').addEventListener('click', () => { if (sim.ordenes.paroEmergencia) sim.ordenes.paroEmergencia(true); else sim.ordenes.pulsador('ES-001'); registro.anotar('accion', 'Se pulsa el paro de emergencia ES-001'); });
    $('sim-rearme').addEventListener('click', () => { if (sim.ordenes.paroEmergencia) sim.ordenes.paroEmergencia(false); sim.ordenes.pulsador('PB-001'); registro.anotar('accion', 'Se rearma: seta ES-001 liberada y pulsador PB-001'); });
    document.querySelector('.velocidad').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; velocidad = Number(b.dataset.v); document.querySelectorAll('.velocidad button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
    $('boton-planta3d').addEventListener('click', () => PCT.visor3d.abrirEnVentana('HTST', () => sim.estado()));
    $('boton-ayuda').addEventListener('click', () => { const cont = PCT.htstTextosAyuda.GUIA.map(([t, h]) => `<h4>${t}</h4>${h}`).join(''); ficha.cerrar(); mostrarGuia(cont); });

    function mostrarGuia(html) {
      let g = document.getElementById('guia-htst');
      if (!g) { g = document.createElement('div'); g.id = 'guia-htst'; g.setAttribute('role', 'dialog'); document.body.appendChild(g); g.addEventListener('click', e => { if (e.target.closest('button')) g.hidden = true; }); document.addEventListener('keydown', e => { if (e.key === 'Escape') g.hidden = true; }); }
      g.innerHTML = `<header><h3>Ayuda · planta real HTST</h3><button type="button" aria-label="Cerrar (Esc)">×</button></header><div class="cuerpo">${html}</div>`; g.hidden = false;
    }

    // Bucle
    let alarmasVistas = new Set();
    function refrescar() {
      const e = sim.estado();
      objetos.forEach(o => o.actualizar(e, PCT.htstEsquema.lecturasEsquema(e)));
      canvas.svg.classList.toggle('en-pausa', !corriendo);
      $('sim-time').textContent = formatoReloj(e.tiempoS); $('sim-status').textContent = resumenEstado(e);
      document.body.dataset.estado = e.alarmas && e.alarmas.length ? 'alarma' : corriendo ? 'marcha' : 'reposo';
      const alarmas = listaAlarmas(e);
      $('lista-alarmas').innerHTML = alarmas.length ? alarmas.map(a => `<li class="alarma-${escapar(a.nivel || 'media')}">${escapar(a.texto)}</li>`).join('') : '<li class="sin-alarmas">Sin alarmas.</li>';
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
    PCT.htstApp = { estadoActual: () => sim.estado(), sim, registro, enDemostracion };
  }

  const api = { localizarSimulacion, resumenEstado, listaAlarmas, formatoReloj, NOMBRES_MODO, iniciar };
  // Fuera de PCT: modulos.js (de simulador_pct23) hace `var PCT = {}` al cargarse y borraría lo que hubiera antes.
  if (typeof module !== 'undefined') module.exports = api;
  else { window.HTST_PAGINA = api; if (document.getElementById('app')) iniciar().catch(error => { console.error(error); document.getElementById('app').innerHTML = `<p class="aviso-planta">No se pudo iniciar la planta: ${escapar(error.message || error)}</p>`; }); }
})();
