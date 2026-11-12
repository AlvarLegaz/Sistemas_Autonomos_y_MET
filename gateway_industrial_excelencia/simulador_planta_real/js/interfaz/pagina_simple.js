// Pantalla sencilla de la planta real HTST (la de entrada, como el simulador de la maqueta): cabecera con el nombre de la planta, barra de mando y el SCADA 2D a
// pantalla completa. Clic izquierdo ACCIONA el equipo (en modo Manual) y clic derecho da su FICHA (con el botón «Ver en 3D», que abre solo ese equipo). Fuerza,
// Mando y el 3D son ventanas aparte. La versión con niveles, alarmas, gráficas, hojas y averías sigue en completo.html (pagina.js).
// Las decisiones (qué hace un clic, cómo se llenan los depósitos) son funciones puras que se prueban con node:test.
(function () {
  let layout = typeof require !== 'undefined' ? require('../layout.js') : null;       // en el navegador se toma de PCT.htstLayout cuando el cargador ya lo ha traído
  const PM = () => (typeof require !== 'undefined' ? require('./panel_manual.js') : PCT.htstPanelManual);

  const ALIAS = { 'FDV-101': 'SV-101' };       // la válvula de desvío se acciona por su piloto
  const LLENO_PCT = 99;                        // a partir de este nivel el depósito se da por lleno (el rebosadero empieza en el 100 %)
  const NIVELES_INICIALES = { normal: { tanque: 100, aguaCaliente: 100 }, revision: { tanque: 0, aguaCaliente: 0 } };     // % de partida de cada modo
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
    const esElectrovalvula = /^XV-[0-9]+$/.test(mando);                // las electroválvulas se accionan a mano en cualquier modo (no las gobierna el PLC)
    if (e.modo !== 'MANUAL' && !esElectrovalvula) return { tipo: 'aviso', texto: `Para accionar ${mando} pasa a ${nombresModos().manual} (modo manual). Con el botón derecho ves su ficha.` };
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
      if (lleno || paro) return [tag, 0];                          // las electroválvulas son manuales: al terminar se cierran, y el PLC no las vuelve a abrir
      pendientes++; return [tag, 1];
    });
    return { ordenes, terminado: pendientes === 0, paro };
  }

  /** Estado todo/nada (1 o 0) de los motores, los bancos, la FDV (1 = en avance) y las electroválvulas, para el cronograma de las gráficas. */
  function estadosDigitales(estado) {
    const q = tag => (estado && estado.equipos && estado.equipos[tag]) || {};
    return {
      'P-101': q('P-101').marcha ? 1 : 0, 'P-102': q('P-102').marcha ? 1 : 0, 'KM-201': q('KM-201').cerrado ? 1 : 0, 'KM-202': q('KM-202').cerrado ? 1 : 0,
      'FDV-101': q('FDV-101').posicion === 'AVANCE' ? 1 : 0, 'XV-101': q('XV-101').abierta ? 1 : 0, 'XV-102': q('XV-102').abierta ? 1 : 0, 'XV-301': q('XV-301').abierta ? 1 : 0,
      'XV-302': q('XV-302').abierta ? 1 : 0, 'XV-303': q('XV-303').abierta ? 1 : 0, 'XV-401': q('XV-401').abierta ? 1 : 0,
    };
  }

  /**
   * Las condiciones para que la FDV avance, con su valor actual: [{ id, texto, ok, valor }]. Son las del PLC (seguridad positiva): una sola que falle y la FDV se queda en desvío.
   */
  function condicionesFdv(estado) {
    const e = estado || {}, I = e.instrumentos || {}, P = layout.PROCESO;
    const valor = tag => (I[tag] && typeof I[tag].valorPLC === 'number' ? I[tag].valorPLC : null);
    const sano = tag => !!I[tag] && (!I[tag].calidad || I[tag].calidad === 'OK');
    const tt = valor('TT-103'), tRes = e.proceso && e.proceso.tiempoResidenciaS, p1 = valor('PT-101'), p2 = valor('PT-102'), dp = p1 !== null && p2 !== null ? p2 - p1 : null;
    const lazos = ['TT-103', 'FT-101', 'PT-101', 'PT-102'], malos = lazos.filter(t => !sano(t));
    return [
      { id: 'temperatura', texto: `Temperatura TT-103 ≥ ${dec(P.temperaturaPasteurizacionC, 0)} °C`, ok: tt !== null && tt >= P.temperaturaPasteurizacionC, valor: tt === null ? '—' : `${dec(tt, 1)} °C` },
      { id: 'residencia', texto: `Tiempo de residencia ≥ ${dec(P.tiempoResidenciaMinS, 0)} s`, ok: Number.isFinite(tRes) && tRes >= P.tiempoResidenciaMinS, valor: Number.isFinite(tRes) ? `${dec(tRes, 0)} s` : '—' },
      { id: 'diferencial', texto: `Diferencial de la regeneración ≥ ${dec(P.diferencialMinimoRegeneracionBar, 2)} bar`, ok: dp !== null && dp >= P.diferencialMinimoRegeneracionBar, valor: dp === null ? '—' : `${dec(dp, 2)} bar` },
      { id: 'aire', texto: 'Aire comprimido suficiente (PSL-201)', ok: !!(I['PSL-201'] && I['PSL-201'].nivel === 1), valor: I['PSL-201'] && I['PSL-201'].nivel === 1 ? 'sí' : 'bajo' },
      { id: 'lazos', texto: 'Lazos de TT-103, FT-101, PT-101 y PT-102 sanos', ok: malos.length === 0, valor: malos.length ? malos.join(', ') : 'sanos' },
    ];
  }

  /**
   * Lo que hace el botón de la caldera en Revisión. Si algún banco está pedido, lo apaga; si no, lo enciende: arranca P-102 (sin circulación las resistencias se cortarían)
   * y conecta los dos bancos de 30 kW, salvo que una protección lo impida (termostato, nivel bajo, 24 V, paro…): entonces dice el motivo.
   * Devuelve { accion: 'apagar' | 'encender' | 'bloqueado', ordenes, texto, peligro }.
   */
  function planCaldera(estado) {
    const e = estado || {}, pm = PM();
    if (pm.ordenDe(e, 'KM-201') || pm.ordenDe(e, 'KM-202')) return { accion: 'apagar', ordenes: [['KM-201', 0], ['KM-202', 0]] };
    const eq = e.equipos || {};
    const conBomba = Object.assign({}, e, { equipos: Object.assign({}, eq, { 'P-102': Object.assign({}, eq['P-102'], { marcha: true }) }) });    // como si P-102 ya girase
    const bloqueo = pm.bloqueo(conBomba, 'KM-201');
    if (bloqueo) return { accion: 'bloqueado', texto: `Caldera bloqueada: ${bloqueo}` };
    return { accion: 'encender', ordenes: [['P-102', 1], ['KM-201', 1], ['KM-202', 1]], peligro: pm.peligro(e, 'KM-201') };
  }

  const dec = (v, c = 0) => (typeof v === 'number' ? v.toFixed(c).replace('.', ',') : '—');
  const formatoReloj = s => { const t = Math.floor(s || 0); return [Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60].map(n => String(n).padStart(2, '0')).join(':'); };
  const nombresModos = () => (layout && layout.PLANTA && layout.PLANTA.modos) || { normal: 'Normal', manual: 'Revisión' };
  const nombreModo = modo => { const m = layout && layout.MODOS_INFO && layout.MODOS_INFO[modo]; return m ? m.nombre : (modo || '—'); };

  /** Texto de la línea de estado de la barra: planta (modo y marcha), niveles y la alarma más grave. */
  function textoEstado(e, corriendo) {
    if (!e) return '—';
    if (e.plc && e.plc.paro) return 'PARO DE EMERGENCIA: la planta está parada. Pulsa REARME en el panel del esquema.';
    const activas = (e.alarmas || []).filter(a => a.nivel !== 'estado');
    const M = nombresModos(), modo = e.modo === 'MANUAL' ? `${M.manual} (modo manual)` : `${M.normal} · ${nombreModo(e.modo)}`;
    const base = `${modo} · ${corriendo ? 'en marcha' : 'detenida'} · tanque ${dec(e.tanque && e.tanque.nivelPct)} % · agua caliente ${dec(e.aguaCaliente && e.aguaCaliente.nivelPct)} %`;
    if (!activas.length) return `${base} · sin alarmas`;
    const a = activas[0];
    return `${base} · ${activas.length} ${activas.length === 1 ? 'alarma' : 'alarmas'}: ${a.tag ? a.tag + ' ' : ''}${a.texto || a.codigo || ''}`;
  }

  /* ---------- parte con DOM ---------- */
  const escapar = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const VENTANA = 'popup=yes,width=1180,height=780';

  const guia = () => { const M = nombresModos(); return [
    ['Cómo se maneja', '<p><b>Clic izquierdo</b> sobre un equipo lo acciona (bombas, válvulas, contactores y la seta). <b>Clic derecho</b> abre su ficha: qué es, qué hace, su estado y «Ver en 3D», que abre solo ese equipo. Las <b>electroválvulas (XV)</b> las manejas siempre tú con el clic, en cualquier modo: no las gobierna el PLC, así que ni reponen niveles ni abren el agua fría solas.</p>'],
    [`${M.manual} (modo manual)`, '<p>Mandas tú cada actuador con el clic izquierdo; el PLC solo mantiene las protecciones. <b>No hay Iniciar</b>: el reloj corre siempre y lo que haces ocurre al momento. Con <b>Restablecer</b> vuelves al estado inicial. Debajo del reloj tienes las barras de la <b>velocidad de P-101</b> y del <b>nivel de los dos depósitos</b> (sirven también de nivel inicial), y los botones <b>Llenar los dos depósitos</b> y <b>Rearme</b>.</p>'],
    [`${M.normal}`, '<p>El PLC lleva la planta. Pulsa <b>Iniciar</b> y pasa de recirculación de agua a producción cuando se cumplen las condiciones. En el esquema aparece el panel <b>Mando y consignas</b>: caudal, consigna de pasteurización TT-103, MARCHA, PARO, REARME y <b>LLENAR LOS DOS DEPÓSITOS</b>. Al pasar de un modo a otro se conserva el estado de la planta, niveles incluidos.</p>'],
    ['Ventanas aparte', '<p><b>Fuerza</b> y <b>Mando</b> muestran los planos eléctricos con el estado en vivo; <b>Planta 3D</b> la planta completa. Se siguen moviendo con la planta.</p>'],
  ]; };

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
    const sim = crear.crearSimulacion({ semilla: 1, valvulasManuales: true });       // las electroválvulas XV-* no las gobierna el PLC: se accionan a mano con el clic
    // Nivel de partida de cada modo: en Normal los dos depósitos llenos; en Revisión los dos vacíos, para llenarlos tú. Se aplica al abrir la página, al Restablecer y al cambiar de modo si la planta aún no ha arrancado.
    const nivelesIniciales = modo => { if (sim.ordenes.nivelDeposito) for (const [cual, pct] of Object.entries(NIVELES_INICIALES[modo])) sim.ordenes.nivelDeposito(cual, pct); };
    nivelesIniciales('normal');
    const escena3dOk = PCT.htstVisor.registrar();
    const N = PCT.htstNiveles; N.fijarNivel(3);
    const P = layout.PLANTA || { fabrica: 'Planta real', estacion: 'Pasteurizador HTST', corto: '' };

    raiz.innerHTML = `<header class="cab">
        <h1><img class="logo" src="/simulador/img/logo-politecnico.png" alt="CIFP Politécnico Cartagena" width="166" height="60"><span class="sim">${escapar(P.fabrica.toUpperCase())} · ${escapar(P.corto)}<small>${escapar(P.estacion)} · HTST de leche</small></span></h1>
        <nav class="modos" aria-label="Modo de funcionamiento"><button type="button" id="modo-auto" title="El PLC lleva la planta">${escapar(layout.PLANTA.modos.normal)}</button><button type="button" id="modo-manual" title="Modo manual: mandas tú cada actuador">${escapar(layout.PLANTA.modos.manual)}</button></nav>
        <div class="ventanas" role="group" aria-label="Ventanas aparte"><button type="button" id="v-fuerza">Fuerza</button><button type="button" id="v-mando">Mando</button><button type="button" id="v-3d">Planta 3D</button><button type="button" id="v-ayuda">? Ayuda</button></div>
      </header>
      <div class="barra" role="region" aria-label="Operación de la planta">
        <div class="acciones"><button id="sim-play" type="button">Iniciar</button><button id="sim-pause" type="button" disabled>Pausar</button><button id="sim-reset" type="button">Restablecer</button><button id="sim-parar" type="button" class="paro-todo">Parar todo</button></div>
        <div class="pista"><p class="estado-manual" aria-live="polite"><b id="sim-time">00:00:00</b><span id="sim-status">—</span></p></div>
        <div class="derecha"><div class="velocidad" role="group" aria-label="Velocidad de simulación"><button type="button" data-v="1" aria-pressed="true">1×</button><button type="button" data-v="5" aria-pressed="false">5×</button><button type="button" data-v="20" aria-pressed="false">20×</button></div></div>
      </div>
      <div id="avisos"></div><p id="aviso-clic" class="aviso-clic" role="status" hidden></p>
      <div class="cuerpo-simple">
        <main class="escena"><div class="lienzo" id="esquema"></div>
          <section class="graficas-simple" aria-label="Gráficas de tendencia"><h2>GRÁFICAS</h2><div id="graficas"></div></section></main>
        <aside class="lateral-simple" aria-label="Mando y lecturas">
          <div class="pestanas" role="tablist" aria-label="Paneles"><button type="button" role="tab" id="t-mando" data-p="p-mando" aria-selected="true" aria-controls="p-mando">Mando</button><button type="button" role="tab" id="t-lecturas" data-p="p-lecturas" aria-selected="false" aria-controls="p-lecturas">Lecturas</button></div>
          <div class="panel-pestana" id="p-mando" role="tabpanel" aria-labelledby="t-mando">
            <div class="mando-normal" id="mando-normal" role="group" aria-label="Mando y consignas (modo ${escapar(layout.PLANTA.modos.normal)})">
              <h2>MANDO Y CONSIGNAS</h2>
              <div class="fila-consigna"><span>Caudal de leche<small id="mn-caudal-sub">consigna de P-101</small></span><span class="ctl"><button type="button" data-accion="caudal-menos" aria-label="Bajar la consigna de caudal">−</button><output id="mn-caudal">—</output><button type="button" data-accion="caudal-mas" aria-label="Subir la consigna de caudal">+</button></span></div>
              <div class="fila-consigna"><span>Consigna TT-103<small>por debajo, la FDV-101 desvía</small></span><span class="ctl"><button type="button" data-accion="tt103-menos" aria-label="Bajar la consigna de pasteurización">−</button><output id="mn-tt103">—</output><button type="button" data-accion="tt103-mas" aria-label="Subir la consigna de pasteurización">+</button></span></div>
              <div class="fila-consigna"><span>Agua caliente<small id="mn-agua-sub">consigna en cascada · TSH a 90 °C</small></span><span class="ctl"><output id="mn-agua">—</output></span></div>
              <div class="botones-fila"><button type="button" data-accion="marcha">MARCHA</button><button type="button" data-accion="paro">PARO</button><button type="button" data-accion="rearme">REARME</button></div>
              <button type="button" class="ancho" data-accion="llenar" id="mn-llenar">Llenar los dos depósitos</button>
              <p class="estado-pie" id="mn-estado">—</p></div>
            <div class="ajustes-manual" id="ajustes-manual" role="group" aria-label="Ajustes del modo manual (solo en ${escapar(layout.PLANTA.modos.manual)})">
              <h2>AJUSTES · ${escapar(layout.PLANTA.modos.manual.toUpperCase())}</h2>
              <label><span>Velocidad de P-101</span><output id="o-vel-p101">0 %</output><input type="range" id="vel-p101" min="0" max="100" step="1" value="0"></label>
              <label><span>Tanque de balance</span><output id="o-nivel-tanque">100 %</output><input type="range" id="nivel-tanque" min="0" max="100" step="1" value="100"></label>
              <label><span>Agua caliente</span><output id="o-nivel-agua">100 %</output><input type="range" id="nivel-agua" min="0" max="100" step="1" value="100"></label>
              <span class="botones-manual"><button type="button" id="m-caldera">Encender caldera</button><button type="button" id="m-llenar">Llenar los dos depósitos</button><button type="button" id="m-rearme">Rearme</button></span></div></div>
          <div class="panel-pestana" id="p-lecturas" role="tabpanel" aria-labelledby="t-lecturas" hidden>
            <section class="condiciones" aria-label="Condiciones de la FDV"><h2 id="cond-titulo">LA FDV…</h2><ul id="lista-condiciones"></ul></section>
            <section class="contadores" aria-label="Contadores"><h2>CONTADORES</h2><dl id="lista-contadores"></dl></section>
            <div id="lecturas"></div></div>
        </aside>
      </div>`;
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
    // Gráficas debajo del esquema y tabla de lecturas en la pestaña del panel lateral
    const historial = PCT.htstGrafica.crearHistorial(), graficas = PCT.htstGrafica.crearGraficas($('graficas'), { historial, anchoAuto: true, grupos: PCT.htstGrafica.GRUPOS.concat([PCT.htstGrafica.GRUPO_MOTORES]) });
    const lecturas = PCT.htstPanelLecturas.crearPanelLecturas($('lecturas'));

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
        for (const tag of ['XV-101', 'XV-302']) sim.ordenes.manual(tag, 0);
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
      calefactor: () => alternarCaldera(),
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
    $('mando-normal').addEventListener('click', ev => { const b = ev.target.closest('button[data-accion]'); if (b) pulsarPanel(b); });
    document.querySelector('.lateral-simple .pestanas').addEventListener('click', ev => {
      const b = ev.target.closest('[data-p]'); if (!b) return;
      document.querySelectorAll('.lateral-simple [role="tab"]').forEach(t => t.setAttribute('aria-selected', String(t === b)));
      document.querySelectorAll('.lateral-simple .panel-pestana').forEach(p => { p.hidden = p.id !== b.dataset.p; });
    });
    canvas.svg.addEventListener('click', ev => { const b = ev.target.closest('.panel-boton'); if (b) { ev.stopPropagation(); pulsarPanel(b); } }, true);
    canvas.svg.addEventListener('keydown', ev => { const b = ev.target.closest('.panel-boton'); if (b && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); ev.stopPropagation(); pulsarPanel(b); } }, true);

    // Barra
    const actualizarBotones = () => { $('sim-play').disabled = corriendo; $('sim-pause').disabled = !corriendo; };
    $('sim-play').addEventListener('click', () => { if (sim.estado().modo === 'PARADA') sim.ordenes.arrancar(); corriendo = true; actualizarBotones(); refrescar(); });
    $('sim-pause').addEventListener('click', () => { corriendo = false; actualizarBotones(); refrescar(); });
    $('sim-reset').addEventListener('click', async () => {
      const si = await confirmar({ titulo: '¿Restablecer la planta?', mensaje: 'Vuelve al estado inicial: depósitos en su nivel de partida, todo parado. No se puede deshacer.', ok: 'Restablecer' });
      if (!si) return;
      const eraManual = enManual();
      sim.reiniciar(); historial.limpiar(); nivelesIniciales(eraManual ? 'revision' : 'normal'); llenando = false; consignasPanel.llenando = false;
      if (eraManual) { corriendo = true; actualizarBotones(); ponerModo('MANUAL'); }          // en Manual sigue en Manual y con el reloj en marcha
      else { corriendo = false; actualizarBotones(); refrescar(); }
    });
    $('sim-parar').addEventListener('click', () => {
      llenando = false; consignasPanel.llenando = false;
      if (enManual()) { for (const [tag, valor] of PCT.htstPanelManual.PARADA_SEGURA) sim.ordenes.manual(tag, valor); } else sim.ordenes.parar();
      aplicarAhora(); refrescar();
    });
    // Manual: el reloj corre siempre (no hay «Iniciar»: lo que mandas ocurre al momento, como en una planta de verdad) y se restablece con «Restablecer».
    // Automático: el PLC lleva la planta; se pasa a parada y se arranca con «Iniciar» (el estado, niveles incluidos, se conserva).
    $('modo-manual').addEventListener('click', () => { if (enManual()) return; if (sim.estado().tiempoS < 1) nivelesIniciales('revision'); llenando = false; consignasPanel.llenando = false; corriendo = true; actualizarBotones(); ponerModo('MANUAL'); });
    $('modo-auto').addEventListener('click', () => { if (!enManual()) return; if (sim.estado().tiempoS < 1) nivelesIniciales('normal'); llenando = false; consignasPanel.llenando = false; corriendo = false; actualizarBotones(); ponerModo('PARADA'); });
    document.querySelector('.velocidad').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; velocidad = Number(b.dataset.v); document.querySelectorAll('.velocidad button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });

    // Ajustes del modo Manual: velocidad de P-101 y nivel de los depósitos por barra (el nivel sirve de nivel inicial); sin tocarlas, las barras siguen el valor real
    for (const [id, cual] of [['nivel-tanque', 'tanque'], ['nivel-agua', 'aguaCaliente']]) {
      $(id).addEventListener('input', () => { if (sim.ordenes.nivelDeposito) sim.ordenes.nivelDeposito(cual, $(id).value); $(`o-${id}`).textContent = `${$(id).value} %`; aplicarAhora(); refrescar(); });
    }
    $('vel-p101').addEventListener('input', () => { sim.ordenes.manual('VFD-101', Number($('vel-p101').value)); $('o-vel-p101').textContent = `${$('vel-p101').value} %`; aplicarAhora(); refrescar(); });
    $('m-llenar').addEventListener('click', () => { alternarLlenado(); aplicarAhora(); refrescar(); });
    $('m-caldera').addEventListener('click', alternarCaldera);
    // Enciende o apaga el calefactor (P-102 y los dos bancos). Lo usan el botón del panel y el botón dibujado junto al calentador HW-101 del esquema.
    async function alternarCaldera() {
      const plan = planCaldera(sim.estado());
      if (plan.accion === 'bloqueado') { avisar(plan.texto); return; }
      if (plan.accion === 'encender' && plan.peligro) {
        const si = await confirmar({ titulo: '¿Encender la caldera?', mensaje: `${plan.peligro} Se arranca P-102 y se conectan los dos bancos de resistencias.`, ok: 'Encender' });
        if (!si) return;
      }
      for (const [tag, valor] of plan.ordenes) sim.ordenes.manual(tag, valor);
      avisar(plan.accion === 'encender' ? 'Caldera encendida: P-102 en marcha y los dos bancos conectados.' : 'Caldera apagada.');
      aplicarAhora(); refrescar();
    }
    $('m-rearme').addEventListener('click', () => { accionesPanel.rearme(); aplicarAhora(); refrescar(); });

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
      g.innerHTML = `<header><h3 id="guia-titulo">Ayuda · ${escapar(P.estacion)}</h3><button type="button" aria-label="Cerrar (Esc)">×</button></header><div class="cuerpo">${guia().map(([t, h]) => `<h4>${t}</h4>${h}`).join('')}</div>`; g.hidden = false;
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
      document.body.dataset.modo = manual ? 'manual' : 'auto';
      const calderaOn = !!(PCT.htstPanelManual.ordenDe(e, 'KM-201') || PCT.htstPanelManual.ordenDe(e, 'KM-202'));
      const textoCaldera = calderaOn ? 'Apagar caldera' : 'Encender caldera'; if ($('m-caldera').textContent !== textoCaldera) $('m-caldera').textContent = textoCaldera;
      $('m-caldera').classList.toggle('activo', calderaOn);
      const textoLlenar = llenando ? 'Llenando… (cancelar)' : 'Llenar los dos depósitos'; if ($('m-llenar').textContent !== textoLlenar) $('m-llenar').textContent = textoLlenar;
      for (const [id, nivel] of [['vel-p101', e.salidasPLC && e.salidasPLC.AO && e.salidasPLC.AO['VFD-101']], ['nivel-tanque', e.tanque && e.tanque.nivelPct], ['nivel-agua', e.aguaCaliente && e.aguaCaliente.nivelPct]]) {
        if (typeof nivel !== 'number' || document.activeElement === $(id)) continue;
        const v = String(Math.round(nivel)); if ($(id).value !== v) $(id).value = v; $(`o-${id}`).textContent = `${v} %`;
      }
      // Mando de Normal (panel lateral)
      const poner = (id, t) => { const el = $(id); if (el.textContent !== t) el.textContent = t; };
      const paro = !!(e.plc && e.plc.paro), pos = e.equipos && e.equipos['FDV-101'] && e.equipos['FDV-101'].posicion;
      poner('mn-caudal', `${Math.round(consignasPanel.caudalLh)} L/h`); poner('mn-tt103', `${dec(consignasPanel.tt103C, 1)} °C`);
      poner('mn-agua', e.plc && typeof e.plc.consignaAguaC === 'number' ? `${dec(e.plc.consignaAguaC, 1)} °C` : '—');
      poner('mn-agua-sub', `TT-105: ${PCT.htstEsquema.textoInstrumento(e, 'TT-105')} · TSH a 90 °C`);
      poner('mn-caudal-sub', `consigna de P-101 · FT-101: ${PCT.htstEsquema.textoInstrumento(e, 'FT-101')}`);
      poner('mn-estado', paro ? `PARO: ${((e.plc && e.plc.motivosParo) || []).join(', ') || 'pulsa REARME'}` : `${nombreModo(e.modo)} · FDV ${pos === 'AVANCE' ? 'en avance' : pos === 'DESVIO' ? 'en desvío' : 'moviéndose'}`);
      const bot = a => document.querySelector(`#mando-normal [data-accion="${a}"]`);
      bot('marcha').classList.toggle('activo', e.modo !== 'PARADA' && !paro); bot('paro').classList.toggle('activo', e.modo === 'PARADA' && !paro);
      bot('rearme').classList.toggle('alarma', paro || (e.instrumentos && e.instrumentos['TSH-101'] && e.instrumentos['TSH-101'].nivel === 0));
      bot('llenar').classList.toggle('activo', llenando); poner('mn-llenar', llenando ? 'Llenando… (cancelar)' : 'Llenar los dos depósitos');
      // Lecturas: condiciones de la FDV, contadores y tabla de instrumentos
      const conds = condicionesFdv(e), todas = conds.every(c => c.ok);
      poner('cond-titulo', todas ? 'LA FDV PUEDE AVANZAR' : 'LA FDV SE QUEDA EN DESVÍO');
      const lista = $('lista-condiciones'), firma = conds.map(c => `${c.ok}|${c.valor}`).join('#');
      if (lista.dataset.firma !== firma) { lista.dataset.firma = firma; lista.innerHTML = conds.map(c => `<li class="${c.ok ? 'ok' : 'falta'}"><span class="simbolo" aria-hidden="true">${c.ok ? '✔' : '✖'}</span><span>${escapar(c.texto)}</span><b>${escapar(c.valor)}</b></li>`).join(''); }
      const k = e.contadores || {}, filas = [['Producido', `${dec(k.producidoL, 0)} L`], ['Desviado', `${dec(k.desviadoL, 0)} L`], ['No conforme', `${dec(k.noConformeL, 0)} L`], ['Energía', `${dec(k.energiaKWh, 2)} kWh`]];
      const cont = $('lista-contadores'), firmaC = filas.map(f => f[1]).join('|');
      if (cont.dataset.firma !== firmaC) { cont.dataset.firma = firmaC; cont.innerHTML = filas.map(([n, v]) => `<div><dt>${n}</dt><dd>${v}</dd></div>`).join(''); }
      lecturas.actualizar(e);
      document.body.dataset.estado = e.alarmas && e.alarmas.some(a => a.nivel !== 'estado') ? 'alarma' : corriendo ? 'marcha' : 'reposo';
    }
    let ultimaGrafica = 0;
    setInterval(() => {
      if (corriendo) sim.paso(0.25 * velocidad);
      if (llenando) pasoLlenado();
      refrescar();
      if (corriendo) { const e = sim.estado(), v = {}; for (const [tag, i] of Object.entries(e.instrumentos || {})) if (i && typeof i.valorPLC === 'number') v[tag] = i.valorPLC; historial.registrar(e.tiempoS, Object.assign(v, estadosDigitales(e))); }
      if (performance.now() - ultimaGrafica > 1000) { ultimaGrafica = performance.now(); graficas.redibujar(); }
    }, 250);
    refrescar();

    // Para las ventanas aparte (3D, Fuerza y Mando) y para las pruebas
    PCT.htstApp = { estadoActual: () => sim.estado(), sim, enDemostracion, nivel: () => 3, ponerModo, accionarEquipo: accionar, llenarDepositos: alternarLlenado };
  }

  const api = { ALIAS, LLENO_PCT, NIVELES_INICIALES, decidirClic, planLlenado, planCaldera, condicionesFdv, estadosDigitales, textoEstado, formatoReloj, nombreModo, iniciar };
  if (typeof module !== 'undefined') module.exports = api;
  else { window.HTST_PAGINA_SIMPLE = api; if (document.getElementById('app')) iniciar().catch(error => { console.error(error); document.getElementById('app').innerHTML = `<p class="aviso-planta">No se pudo iniciar la planta: ${escapar(error.message || error)}</p>`; }); }
})();
