// Pantalla sencilla de la planta real HTST (la de entrada, como el simulador de la maqueta): cabecera con el nombre de la planta, barra de mando y el SCADA 2D a
// pantalla completa. Clic izquierdo ACCIONA el equipo (en modo Manual) y clic derecho da su FICHA (con el botón «Ver en 3D», que abre solo ese equipo). Fuerza,
// Mando y el 3D son ventanas aparte. La versión con niveles, alarmas, gráficas, hojas y averías sigue en completo.html (pagina.js).
// Las decisiones (qué hace un clic, cómo se llenan los depósitos) son funciones puras que se prueban con node:test.
(function () {
  let layout = typeof require !== 'undefined' ? require('../layout.js') : null;       // en el navegador se toma de PCT.htstLayout cuando el cargador ya lo ha traído
  const PM = () => (typeof require !== 'undefined' ? require('./panel_manual.js') : PCT.htstPanelManual);

  const ALIAS = { 'FDV-101': 'SV-101' };       // la válvula de desvío se acciona por su piloto
  const LLENO_PCT = 99;                        // a partir de este nivel el depósito se da por lleno (el rebosadero empieza en el 100 %)
  const PULSADORES = ['PB-001', 'TSH-101'];    // se «pulsan»: rearme local del PLC y rearme del termostato de seguridad

  /**
   * Qué hace un clic izquierdo sobre el equipo `tag` con el estado `estado`. Devuelve { tipo, ... }:
   *   'seta' | 'liberar-seta'  → pulsa o libera la seta ES-001 (vale en cualquier modo)
   *   'pulsador'               → pulsa PB-001 o TSH-101 (rearme)
   *   'orden'                  → { tag, valor } orden manual al actuador
   *   'confirmar'              → igual que orden pero peligrosa: { tag, valor, texto } (hay que confirmar)
   *   'bloqueado' | 'aviso' | 'info' → { texto } mensaje para el operador, sin orden
   */
  function decidirClic(tag, estado) {
    const e = estado || {};
    if (tag === 'ES-001') { const es = (e.equipos && e.equipos['ES-001']) || {}; return { tipo: es.rearmado === false ? 'liberar-seta' : 'seta' }; }
    if (PULSADORES.includes(tag)) return { tipo: 'pulsador', tag };
    const mando = ALIAS[tag] || tag, pm = PM(), def = pm.mandoDe(mando);
    if (!def) return { tipo: 'info', texto: `${tag} no se acciona. Con el botón derecho ves su ficha.` };
    if (e.modo !== 'MANUAL') return { tipo: 'aviso', texto: `Para accionar ${mando} pasa a Manual. Con el botón derecho ves su ficha.` };
    if (def.tipo === 'numerico') return { tipo: 'aviso', texto: 'La velocidad de P-101 se cambia en el panel de mando (− y +).' };
    const nuevo = !pm.ordenDe(e, mando);
    if (nuevo) {
      const bloqueo = pm.bloqueo(e, mando);
      if (bloqueo) return { tipo: 'bloqueado', tag: mando, texto: `${mando} bloqueado: ${bloqueo}` };
      const riesgo = pm.peligro(e, mando);
      if (riesgo) return { tipo: 'confirmar', tag: mando, valor: 1, texto: riesgo };
    }
    return { tipo: 'orden', tag: mando, valor: nuevo ? 1 : 0 };
  }

  /**
   * Un paso del llenado de los dos depósitos (tanque de balance con XV-101 y depósito de agua caliente con XV-302). Devuelve { ordenes: [[tag, valor]], terminado, paro }.
   * Abre la válvula de cada depósito que no está lleno y cierra la del que ya lo está (en Manual la orden es 0; en automático se quita el forzado y vuelve a mandar el PLC).
   * Con el paro de emergencia puesto no abre nada: da el llenado por terminado.
   */
  function planLlenado(estado, enManual) {
    const e = estado || {};
    const niveles = [['XV-101', e.tanque && e.tanque.nivelPct], ['XV-302', e.aguaCaliente && e.aguaCaliente.nivelPct]];
    const paro = !!(e.plc && e.plc.paro);
    let pendientes = 0;
    const ordenes = niveles.map(([tag, nivel]) => {
      const lleno = typeof nivel === 'number' && nivel >= LLENO_PCT;
      if (lleno || paro) return [tag, enManual ? 0 : null];
      pendientes++; return [tag, 1];
    });
    return { ordenes, terminado: pendientes === 0, paro };
  }

  const dec = (v, c = 0) => (typeof v === 'number' ? v.toFixed(c).replace('.', ',') : '—');
  const formatoReloj = s => { const t = Math.floor(s || 0); return [Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60].map(n => String(n).padStart(2, '0')).join(':'); };
  const nombreModo = modo => { const m = layout && layout.MODOS_INFO && layout.MODOS_INFO[modo]; return m ? m.nombre : (modo || '—'); };

  /** Texto de la línea de estado de la barra: planta (modo y marcha), niveles y la alarma más grave. */
  function textoEstado(e, corriendo) {
    if (!e) return '—';
    if (e.plc && e.plc.paro) return 'PARO DE EMERGENCIA: la planta está parada. Pulsa REARME en el panel del esquema.';
    const activas = (e.alarmas || []).filter(a => a.nivel !== 'estado');
    const base = `${nombreModo(e.modo)} · ${corriendo ? 'en marcha' : 'detenida'} · tanque ${dec(e.tanque && e.tanque.nivelPct)} % · agua caliente ${dec(e.aguaCaliente && e.aguaCaliente.nivelPct)} %`;
    if (!activas.length) return `${base} · sin alarmas`;
    const a = activas[0];
    return `${base} · ${activas.length} ${activas.length === 1 ? 'alarma' : 'alarmas'}: ${a.tag ? a.tag + ' ' : ''}${a.texto || a.codigo || ''}`;
  }

  /* ---------- parte con DOM ---------- */
  const escapar = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const VENTANA = 'popup=yes,width=1180,height=780';

  const GUIA = [
    ['Cómo se maneja', '<p><b>Clic izquierdo</b> sobre un equipo lo acciona (bombas, válvulas, contactores y la seta). <b>Clic derecho</b> abre su ficha: qué es, qué hace, su estado y «Ver en 3D», que abre solo ese equipo.</p>'],
    ['Manual y Automático', '<p>En <b>Manual</b> mandas tú cada actuador con el clic izquierdo; el PLC solo mantiene las protecciones. En <b>Automático</b> el PLC lleva la planta: pulsa Iniciar y pasa de recirculación de agua a producción cuando se cumplen las condiciones.</p>'],
    ['Panel del esquema', '<p>Abajo a la izquierda: caudal (o velocidad de la bomba en Manual), consigna de pasteurización TT-103, MARCHA, PARO, REARME y <b>LLENAR LOS DOS DEPÓSITOS</b>, que abre las válvulas de llenado hasta que el tanque de balance y el depósito de agua caliente estén llenos.</p>'],
    ['Ventanas aparte', '<p><b>Fuerza</b> y <b>Mando</b> muestran los planos eléctricos con el estado en vivo; <b>Planta 3D</b> la planta completa. Se siguen moviendo con la planta.</p>'],
  ];

  /** Diálogo de confirmación accesible. Devuelve una promesa que resuelve true si se confirma. */
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
    const cand = (PCT.htst && PCT.htst.simulacion) || PCT.htstSimulacion;
    let crear = cand && typeof cand.crearSimulacion === 'function' ? cand : null, enDemostracion = false;
    if (!crear) { await window.HTST_CARGADOR.cargarScript('js/interfaz/simulacion_demo.js'); crear = PCT.htstDemo; enDemostracion = true; }
    layout = PCT.htstLayout;
    const sim = crear.crearSimulacion({ semilla: 1 });
    const escena3dOk = PCT.htstVisor.registrar();
    const N = PCT.htstNiveles; N.fijarNivel(3);
    const P = layout.PLANTA || { fabrica: 'Planta real', estacion: 'Pasteurizador HTST', corto: '' };

    raiz.innerHTML = `<header class="cab">
        <h1><img class="logo" src="/simulador/img/logo-politecnico.png" alt="CIFP Politécnico Cartagena" width="166" height="60"><span class="sim">${escapar(P.fabrica.toUpperCase())} · ${escapar(P.corto)}<small>${escapar(P.estacion)} · HTST de leche</small></span></h1>
        <nav class="modos" aria-label="Modo de funcionamiento"><button type="button" id="modo-manual">Manual</button><button type="button" id="modo-auto">Automático</button></nav>
        <div class="ventanas" role="group" aria-label="Ventanas aparte"><button type="button" id="v-fuerza">Fuerza</button><button type="button" id="v-mando">Mando</button><button type="button" id="v-3d">Planta 3D</button><button type="button" id="v-ayuda">? Ayuda</button></div>
      </header>
      <div class="barra" role="region" aria-label="Operación de la planta">
        <div class="acciones"><button id="sim-play" type="button">Iniciar</button><button id="sim-pause" type="button" disabled>Pausar</button><button id="sim-reset" type="button">Reiniciar</button><button id="sim-parar" type="button" class="paro-todo">Parar todo</button></div>
        <div class="pista"><p class="estado-manual" aria-live="polite"><b id="sim-time">00:00:00</b><span id="sim-status">—</span></p></div>
        <div class="derecha"><div class="velocidad" role="group" aria-label="Velocidad de simulación"><button type="button" data-v="1" aria-pressed="true">1×</button><button type="button" data-v="5" aria-pressed="false">5×</button><button type="button" data-v="20" aria-pressed="false">20×</button></div></div>
      </div>
      <div id="avisos"></div><p id="aviso-clic" class="aviso-clic" role="status" hidden></p>
      <main class="escena"><div class="lienzo" id="esquema"></div></main>`;
    const $ = id => document.getElementById(id);
    const avisos = [];
    if (enDemostracion) avisos.push('Modelo de demostración: el modelo real de la planta todavía no está cargado.');
    if (!escena3dOk) avisos.push('La escena 3D de la planta real todavía no está cargada: «Planta 3D» no mostrará la planta.');
    if (faltan.length) console.info('[planta real] módulos no cargados:', faltan.join(', '));
    $('avisos').innerHTML = avisos.map(a => `<p class="aviso-planta" role="status">${escapar(a)}</p>`).join('');

    // SCADA 2D
    const { Canvas } = PCT.canvas, canvas = new Canvas(PCT.htstEsquema.ESQUEMA_HTST);
    $('esquema').replaceChildren(canvas.svg);
    const PROC = layout.PROCESO;
    const consignasPanel = { caudalLh: PROC.caudalNominalLh, tt103C: PROC.consignaTT103C, llenando: false };
    const objetos = PCT.htstEsquema.crearObjetos(canvas, { consignas: () => consignasPanel });

    // Estado de la página
    let corriendo = false, velocidad = 1, llenando = false, temporizadorAviso = null;
    const aplicarAhora = () => { if (!corriendo) sim.paso(0.2); };           // dos ticks: el PLC aplica la orden en el primero y el equipo la sigue en el segundo
    function avisar(texto) {
      const c = $('aviso-clic'); c.textContent = texto; c.hidden = !texto;
      clearTimeout(temporizadorAviso); if (texto) temporizadorAviso = setTimeout(() => { c.hidden = true; }, 8000);
    }
    const enManual = () => sim.estado().modo === 'MANUAL';
    function ponerModo(modo) { sim.ordenes.modo(modo); aplicarAhora(); refrescar(); }

    // Ficha (clic derecho) con el mando del equipo en Manual; el clic izquierdo acciona
    const contenedorManual = document.createElement('div');
    const panelManual = PCT.htstPanelManual.crearPanelManual(contenedorManual, { sim: () => sim, alVolverAAuto: () => ponerModo('RECIRCULACION_AGUA'), alOrden: () => aplicarAhora(), enMarcha: () => corriendo });
    const ficha = PCT.htstAyuda.iniciarAyuda(canvas.svg, {
      nivel: () => 2, niveles: N, sim: () => sim,
      alVer3d: tag => PCT.visor3d.abrirEnVentana('HTST', () => sim.estado(), tag, true),
      alMedir: () => {}, mandoFicha: tag => panelManual.crearMandoFicha(tag),
      clicIzquierdo: tag => accionar(tag),
    });
    function accionar(tag) {
      const d = decidirClic(tag, sim.estado());
      if (d.tipo === 'seta') { if (sim.ordenes.paroEmergencia) sim.ordenes.paroEmergencia(true); else sim.ordenes.pulsador('ES-001'); avisar('Seta ES-001 pulsada: paro de emergencia. Para volver a arrancar, REARME en el panel del esquema.'); }
      else if (d.tipo === 'liberar-seta') { if (sim.ordenes.paroEmergencia) sim.ordenes.paroEmergencia(false); avisar('Seta ES-001 liberada. Falta REARME (PB-001) para salir del paro.'); }
      else if (d.tipo === 'pulsador') { sim.ordenes.pulsador(d.tag); avisar(`${d.tag} pulsado.`); }
      else if (d.tipo === 'orden') sim.ordenes.manual(d.tag, d.valor);
      else if (d.tipo === 'confirmar') { confirmar({ titulo: `¿Activar ${d.tag}?`, mensaje: d.texto, ok: 'Activar' }).then(si => { if (si) { sim.ordenes.manual(d.tag, d.valor); aplicarAhora(); refrescar(); } }); return; }
      else avisar(d.texto);
      aplicarAhora(); refrescar();
    }

    // Llenado de los dos depósitos: abre XV-101 y XV-302 hasta que estén llenos y cierra cada una al llegar
    function pasoLlenado() {
      const plan = planLlenado(sim.estado(), enManual());
      for (const [tag, valor] of plan.ordenes) sim.ordenes.manual(tag, valor);
      if (plan.terminado) { llenando = false; consignasPanel.llenando = false; avisar(plan.paro ? 'Llenado cancelado: hay un paro de emergencia.' : 'Depósitos llenos: XV-101 y XV-302 cerradas.'); }
    }
    function alternarLlenado() {
      if (llenando) {
        llenando = false; consignasPanel.llenando = false;
        for (const tag of ['XV-101', 'XV-302']) sim.ordenes.manual(tag, enManual() ? 0 : null);
        avisar('Llenado cancelado.'); return;
      }
      llenando = true; consignasPanel.llenando = true;
      if (!corriendo) { corriendo = true; actualizarBotones(); }               // el nivel solo sube si pasa el tiempo
      pasoLlenado(); if (llenando) avisar('Llenando el tanque de balance (XV-101) y el depósito de agua caliente (XV-302).');
    }

    // Panel de mando del esquema: caudal (o velocidad en Manual), consigna de TT-103, marcha, paro, rearme y llenado
    const accionesPanel = {
      'caudal-menos': () => cambiarCaudal(-1), 'caudal-mas': () => cambiarCaudal(1),
      'tt103-menos': () => cambiarTT103(-0.5), 'tt103-mas': () => cambiarTT103(0.5),
      marcha: () => { sim.ordenes.arrancar(); corriendo = true; actualizarBotones(); },
      paro: () => { sim.ordenes.parar(); },
      rearme: () => { if (sim.ordenes.paroEmergencia) sim.ordenes.paroEmergencia(false); sim.ordenes.pulsador('PB-001'); sim.ordenes.pulsador('TSH-101'); },
      llenar: alternarLlenado,
    };
    function cambiarCaudal(signo) {
      if (enManual()) { const v = Math.min(100, Math.max(0, Math.round(((sim.estado().salidasPLC.AO || {})['VFD-101'] || 0) + 10 * signo))); sim.ordenes.manual('VFD-101', v); }
      else { consignasPanel.caudalLh = Math.min(PROC.caudalMaximoLh, Math.max(500, consignasPanel.caudalLh + 250 * signo)); sim.ordenes.consignaCaudalLh(consignasPanel.caudalLh); }
    }
    function cambiarTT103(paso) {
      if (enManual()) return;                                                  // en Manual el PLC no regula: la consigna no hace nada
      consignasPanel.tt103C = Math.min(85, Math.max(60, Math.round((consignasPanel.tt103C + paso) * 10) / 10));
      sim.ordenes.consignaTemperaturaC(consignasPanel.tt103C);
    }
    const pulsarPanel = boton => { const f = accionesPanel[boton.dataset.accion]; if (!f) return; f(); aplicarAhora(); refrescar(); };
    canvas.svg.addEventListener('click', ev => { const b = ev.target.closest('.panel-boton'); if (b) { ev.stopPropagation(); pulsarPanel(b); } }, true);
    canvas.svg.addEventListener('keydown', ev => { const b = ev.target.closest('.panel-boton'); if (b && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); ev.stopPropagation(); pulsarPanel(b); } }, true);

    // Barra
    const actualizarBotones = () => { $('sim-play').disabled = corriendo; $('sim-pause').disabled = !corriendo; };
    $('sim-play').addEventListener('click', () => { if (sim.estado().modo === 'PARADA') sim.ordenes.arrancar(); corriendo = true; actualizarBotones(); refrescar(); });
    $('sim-pause').addEventListener('click', () => { corriendo = false; actualizarBotones(); refrescar(); });
    $('sim-reset').addEventListener('click', async () => {
      const si = await confirmar({ titulo: '¿Reiniciar la planta?', mensaje: 'Se perderá el estado de la planta. No se puede deshacer.', ok: 'Reiniciar' });
      if (!si) return;
      sim.reiniciar(); corriendo = false; llenando = false; consignasPanel.llenando = false; actualizarBotones(); refrescar();
    });
    $('sim-parar').addEventListener('click', () => {
      llenando = false; consignasPanel.llenando = false;
      if (enManual()) { for (const [tag, valor] of PCT.htstPanelManual.PARADA_SEGURA) sim.ordenes.manual(tag, valor); } else sim.ordenes.parar();
      aplicarAhora(); refrescar();
    });
    $('modo-manual').addEventListener('click', () => { llenando = false; consignasPanel.llenando = false; ponerModo('MANUAL'); });
    $('modo-auto').addEventListener('click', () => { if (enManual()) { llenando = false; consignasPanel.llenando = false; ponerModo('RECIRCULACION_AGUA'); } });
    document.querySelector('.velocidad').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; velocidad = Number(b.dataset.v); document.querySelectorAll('.velocidad button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });

    // Ventanas aparte (se siguen moviendo con la planta: leen su estado de esta ventana)
    $('v-3d').addEventListener('click', () => PCT.visor3d.abrirEnVentana('HTST', () => sim.estado()));
    $('v-fuerza').addEventListener('click', () => window.open('fuerza.html', 'pct23_fuerza', VENTANA));
    $('v-mando').addEventListener('click', () => window.open('mando.html', 'pct23_mando', VENTANA));
    for (const [id, url] of [['v-fuerza', 'fuerza.html'], ['v-mando', 'mando.html']]) {      // el botón solo aparece si la ventana existe (así no hay botones muertos)
      $(id).hidden = true;
      fetch(url, { method: 'HEAD' }).then(r => { if (r.ok) $(id).hidden = false; }).catch(() => { /* sin la página: el botón sigue oculto */ });
    }
    $('v-ayuda').addEventListener('click', () => {
      ficha.cerrar();
      let g = document.getElementById('guia-htst');
      if (!g) { g = document.createElement('div'); g.id = 'guia-htst'; g.setAttribute('role', 'dialog'); g.setAttribute('aria-modal', 'true'); g.setAttribute('aria-labelledby', 'guia-titulo'); document.body.appendChild(g);
        g.addEventListener('click', e => { if (e.target.closest('button')) { g.hidden = true; if (g.origen && g.origen.focus) g.origen.focus(); } });
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && !g.hidden) { g.hidden = true; if (g.origen && g.origen.focus) g.origen.focus(); } }); }
      g.origen = document.activeElement;
      g.innerHTML = `<header><h3 id="guia-titulo">Ayuda · ${escapar(P.estacion)}</h3><button type="button" aria-label="Cerrar (Esc)">×</button></header><div class="cuerpo">${GUIA.map(([t, h]) => `<h4>${t}</h4>${h}`).join('')}</div>`; g.hidden = false;
      g.querySelector('button').focus();
    });

    function refrescar() {
      const e = sim.estado(), manual = e.modo === 'MANUAL';
      objetos.forEach(o => o.actualizar(e, PCT.htstEsquema.lecturasEsquema(e)));
      canvas.svg.classList.toggle('en-pausa', !corriendo);
      $('sim-time').textContent = formatoReloj(e.tiempoS);
      const texto = textoEstado(e, corriendo); if ($('sim-status').textContent !== texto) $('sim-status').textContent = texto;
      if (manual) $('modo-manual').setAttribute('aria-current', 'page'); else $('modo-manual').removeAttribute('aria-current');
      if (!manual) $('modo-auto').setAttribute('aria-current', 'page'); else $('modo-auto').removeAttribute('aria-current');
      document.body.dataset.estado = e.alarmas && e.alarmas.some(a => a.nivel !== 'estado') ? 'alarma' : corriendo ? 'marcha' : 'reposo';
    }
    setInterval(() => { if (corriendo) sim.paso(0.25 * velocidad); if (llenando) pasoLlenado(); refrescar(); }, 250);
    refrescar();

    // Para las ventanas aparte (3D, Fuerza y Mando) y para las pruebas
    PCT.htstApp = { estadoActual: () => sim.estado(), sim, enDemostracion, nivel: () => 3, ponerModo, accionarEquipo: accionar, llenarDepositos: alternarLlenado };
  }

  const api = { ALIAS, LLENO_PCT, decidirClic, planLlenado, textoEstado, formatoReloj, nombreModo, iniciar };
  if (typeof module !== 'undefined') module.exports = api;
  else { window.HTST_PAGINA_SIMPLE = api; if (document.getElementById('app')) iniciar().catch(error => { console.error(error); document.getElementById('app').innerHTML = `<p class="aviso-planta">No se pudo iniciar la planta: ${escapar(error.message || error)}</p>`; }); }
})();
