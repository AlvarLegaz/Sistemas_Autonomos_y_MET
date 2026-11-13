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
  const PULSADORES = ['PB-001', 'TSH-201'];    // se «pulsan»: rearme local del PLC y rearme del termostato de seguridad

  /**
   * Qué hace un clic izquierdo sobre el equipo `tag` con el estado `estado`. Devuelve { tipo, ... }:
   *   'seta' | 'liberar-seta'  → pulsa o libera la seta ES-001 (vale en cualquier modo)
   *   'pulsador'               → pulsa PB-001 o TSH-201 (rearme)
   *   'orden'                  → { tag, valor } orden manual al actuador
   *   (una orden peligrosa lleva además `aviso` con su consecuencia: se muestra, pero no se pide confirmación)
   *   'bloqueado' | 'aviso' | 'info' → { texto } mensaje para el operador, sin orden
   */
  function decidirClic(tag, estado) {
    const e = estado || {};
    if (tag === 'ES-001') { const es = (e.equipos && e.equipos['ES-001']) || {}; return { tipo: es.rearmado === false ? 'liberar-seta' : 'seta' }; }
    if (PULSADORES.includes(tag)) return { tipo: 'pulsador', tag };
    const mando = ALIAS[tag] || tag, pm = PM(), def = pm.mandoDe(mando);
    if (!def) return { tipo: 'info', texto: `${tag} no se acciona. Clic derecho: ficha.` };
    const esElectrovalvula = /^XV-[0-9]+$/.test(mando);                // las electroválvulas se accionan a mano en cualquier modo (no las gobierna el PLC)
    if (e.modo !== 'MANUAL' && !esElectrovalvula) return { tipo: 'aviso', texto: `Para accionar ${mando}, pasa a ${nombresModos().manual}.` };
    if (def.tipo === 'numerico') return { tipo: 'aviso', texto: 'Velocidad de P-101: − y + del panel de mando.' };
    const nuevo = !pm.ordenDe(e, mando);
    if (nuevo) {
      const bloqueo = pm.bloqueo(e, mando);
      if (bloqueo) return { tipo: 'bloqueado', tag: mando, texto: `${mando} bloqueado: ${bloqueo}` };
      const riesgo = pm.peligro(e, mando);
      if (riesgo) return { tipo: 'orden', tag: mando, valor: 1, aviso: riesgo };      // en Revisión el operador manda: se avisa de la consecuencia pero no se pregunta
    }
    return { tipo: 'orden', tag: mando, valor: nuevo ? 1 : 0 };
  }

  /** Estado todo/nada (1 o 0) de los motores, los bancos, la FDV (1 = en avance) y las electroválvulas, para el cronograma de las gráficas. */
  function estadosDigitales(estado) {
    const q = tag => (estado && estado.equipos && estado.equipos[tag]) || {};
    return {
      'P-101': q('P-101').marcha ? 1 : 0, 'P-201': q('P-201').marcha ? 1 : 0, 'KM-201': q('KM-201').cerrado ? 1 : 0, 'KM-202': q('KM-202').cerrado ? 1 : 0,
      'FDV-101': q('FDV-101').posicion === 'AVANCE' ? 1 : 0, 'XV-101': q('XV-101').abierta ? 1 : 0, 'XV-102': q('XV-102').abierta ? 1 : 0, 'XV-301': q('XV-301').abierta ? 1 : 0,
      'XV-201': q('XV-201').abierta ? 1 : 0, 'XV-202': q('XV-202').abierta ? 1 : 0, 'XV-401': q('XV-401').abierta ? 1 : 0,
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
      { id: 'diferencial', texto: `ΔP de regeneración ≥ ${dec(P.diferencialMinimoRegeneracionBar, 2)} bar`, ok: dp !== null && dp >= P.diferencialMinimoRegeneracionBar, valor: dp === null ? '—' : `${dec(dp, 2)} bar` },
      { id: 'aire', texto: 'Aire suficiente (PSL-501)', ok: !!(I['PSL-501'] && I['PSL-501'].nivel === 1), valor: I['PSL-501'] && I['PSL-501'].nivel === 1 ? 'sí' : 'bajo' },
      { id: 'lazos', texto: 'Lazos TT-103, FT-101, PT-101, PT-102 sanos', ok: malos.length === 0, valor: malos.length ? malos.join(', ') : 'sanos' },
    ];
  }

  /**
   * Lo que hace el botón de la caldera en Revisión. Si algún banco está pedido, lo apaga; si no, lo enciende: arranca P-201 (sin circulación las resistencias se cortarían)
   * y conecta los dos bancos de 30 kW, salvo que una protección lo impida (termostato, nivel bajo, 24 V, paro…): entonces dice el motivo.
   * Devuelve { accion: 'apagar' | 'encender' | 'bloqueado', ordenes, texto, peligro }.
   */
  function planCaldera(estado) {
    const e = estado || {}, pm = PM();
    if (pm.ordenDe(e, 'KM-201') || pm.ordenDe(e, 'KM-202')) return { accion: 'apagar', ordenes: [['KM-201', 0], ['KM-202', 0]] };
    const eq = e.equipos || {};
    const conBomba = Object.assign({}, e, { equipos: Object.assign({}, eq, { 'P-201': Object.assign({}, eq['P-201'], { marcha: true }) }) });    // como si P-201 ya girase
    const bloqueo = pm.bloqueo(conBomba, 'KM-201');
    if (bloqueo) return { accion: 'bloqueado', texto: `Caldera bloqueada: ${bloqueo}` };
    return { accion: 'encender', ordenes: [['P-201', 1], ['KM-201', 1], ['KM-202', 1]], peligro: pm.peligro(e, 'KM-201') };
  }

  /** Nivel del depósito de agua caliente según sus dos interruptores (LSL-201 abre en nivel bajo, LSH-201 cierra en nivel alto): 'bajo', 'normal' o 'alto'. Sin porcentaje. */
  function nivelAgua(estado) {
    const I = (estado && estado.instrumentos) || {};
    if (I['LSL-201'] && I['LSL-201'].nivel === 0) return 'bajo';
    if (I['LSH-201'] && I['LSH-201'].nivel === 1) return 'alto';
    return 'normal';
  }

  const dec = (v, c = 0) => (typeof v === 'number' ? v.toFixed(c).replace('.', ',') : '—');
  const formatoReloj = s => { const t = Math.floor(s || 0); return [Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60].map(n => String(n).padStart(2, '0')).join(':'); };
  const nombresModos = () => (layout && layout.PLANTA && layout.PLANTA.modos) || { normal: 'Normal', manual: 'Revisión' };
  const nombreModo = modo => { const m = layout && layout.MODOS_INFO && layout.MODOS_INFO[modo]; return m ? m.nombre : (modo || '—'); };

  /** Texto de la línea de estado de la barra: planta (modo y marcha), niveles y la alarma más grave. */
  function textoEstado(e, corriendo) {
    if (!e) return '—';
    if (e.plc && e.plc.paro) return 'PARO DE EMERGENCIA: pulsa REARME en el panel del esquema.';
    const activas = (e.alarmas || []).filter(a => a.nivel !== 'estado');
    const M = nombresModos(), modo = e.modo === 'MANUAL' ? M.manual : `${M.normal} · ${nombreModo(e.modo)}`;
    const base = `${modo} · ${corriendo ? 'en marcha' : 'detenida'} · tanque ${dec(e.tanque && e.tanque.nivelPct)} % · agua: ${nivelAgua(e)}`;
    if (!activas.length) return `${base} · sin alarmas`;
    const a = activas[0];
    return `${base} · ${activas.length} ${activas.length === 1 ? 'alarma' : 'alarmas'}: ${a.tag ? a.tag + ' ' : ''}${a.texto || a.codigo || ''}`;
  }

  /* ---------- parte con DOM ---------- */
  const escapar = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const VENTANA = 'popup=yes,width=1180,height=780';

  const guia = () => { const M = nombresModos(); return [
    ['Manejo', '<p><b>Clic izquierdo</b>: acciona el equipo. <b>Clic derecho</b>: ficha con estado y «Ver en 3D». Las <b>electroválvulas (XV)</b> las manejas tú en cualquier modo: el PLC no repone niveles ni abre el agua fría.</p>'],
    [`${M.manual} (modo manual)`, '<p>Mandas tú cada actuador; el PLC solo mantiene las protecciones. <b>No hay Iniciar</b>: el reloj corre siempre. <b>Restablecer</b> vuelve al estado inicial. Tienes barras de <b>velocidad de P-101</b> y <b>nivel de los depósitos</b> (también nivel inicial), <b>Llenar los dos depósitos</b> y <b>Rearme</b>.</p>'],
    [`${M.normal}`, '<p>El PLC lleva la planta. Pulsa <b>Iniciar</b>: pasa de recirculación de agua a producción al cumplirse las condiciones. Panel <b>Mando y consignas</b>: caudal, consigna TT-103, MARCHA, PARO, REARME y <b>LLENAR LOS DOS DEPÓSITOS</b>. Al cambiar de modo se conserva el estado, niveles incluidos.</p>'],
    ['Numeración', `<p>Las letras dicen qué es (P bomba, TT termómetro, LSL nivel bajo…) y la <b>centena</b>, el circuito: ${Object.entries(layout.CIRCUITOS).map(([n, c]) => `<b>${n}xx</b> ${c.toLowerCase()}`).join(', ')}. Un instrumento lleva el número de su equipo: LSL-201 y LSH-201 son de HW-201.</p>`],
    ['Ventanas', '<p><b>Fuerza</b> y <b>Mando</b>: planos eléctricos en vivo. <b>Planta 3D</b>: la planta completa.</p>'],
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
    const nivelesIniciales = modo => { if (sim.ordenes.nivelDeposito) { for (const [cual, pct] of Object.entries(NIVELES_INICIALES[modo])) sim.ordenes.nivelDeposito(cual, pct); sim.paso(0.2); } };    // el paso corto deja los interruptores de nivel al día
    nivelesIniciales('normal');
    const escena3dOk = PCT.htstVisor.registrar();
    const N = PCT.htstNiveles; N.fijarNivel(3);
    const P = layout.PLANTA || { fabrica: 'Planta real', estacion: 'Pasteurizador HTST', corto: '' };

    raiz.innerHTML = `<header class="cab">
        <h1><img class="logo" src="/simulador/img/logo-politecnico.png" alt="CIFP Politécnico Cartagena" width="166" height="60"><span class="sim">${escapar(P.fabrica.toUpperCase())} · ${escapar(P.corto)}<small>${escapar(P.estacion)} · HTST de leche</small><small class="mencion">Red Estatal de Centros de Excelencia de Formación Profesional · Sector Químico</small></span></h1>
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
              <label><span>Agua caliente</span><output id="o-nivel-agua">nivel alto</output><input type="range" id="nivel-agua" min="0" max="100" step="1" value="100"></label>
              <span class="botones-manual"><button type="button" id="m-caldera">Encender caldera</button><button type="button" id="m-llenar">Llenar los dos depósitos</button><button type="button" id="m-rearme">Rearme</button></span>
              <fieldset class="ctl-temp" id="ctl-temp"><legend>Temperatura del agua (TT-201)</legend>
                <label>Control <select id="ct-modo"><option value="off">Desactivado</option><option value="histeresis">Histéresis (todo/nada)</option><option value="pid">PID</option></select></label>
                <label>Objetivo <span class="num"><input type="number" id="ct-consigna" min="20" max="85" step="0.5" value="70"> °C</span></label>
                <label data-solo="histeresis">Histéresis (±½ banda) <span class="num"><input type="number" id="ct-banda" min="0.5" max="20" step="0.5" value="4"> °C</span></label>
                <div class="ct-pid" data-solo="pid"><label>Kp <input type="number" id="ct-kp" min="0" max="100" step="0.5" value="10"></label><label>Ki <input type="number" id="ct-ki" min="0" max="5" step="0.01" value="0.05"></label><label>Kd <input type="number" id="ct-kd" min="0" max="500" step="1" value="0"></label></div>
                <p id="ct-estado" class="estado-pie">Desactivado: calientas tú con la caldera.</p></fieldset></div></div>
          <div class="panel-pestana" id="p-lecturas" role="tabpanel" aria-labelledby="t-lecturas" hidden>
            <section class="condiciones" aria-label="Condiciones de la FDV"><h2 id="cond-titulo">LA FDV…</h2><ul id="lista-condiciones"></ul></section>
            <section class="contadores" aria-label="Contadores"><h2>CONTADORES</h2><dl id="lista-contadores"></dl></section>
            <div id="lecturas"></div></div>
        </aside>
      </div>
      <footer class="pie-copyright">© 2026 Álvar Legaz Aparicio. Todos los derechos reservados.</footer>`;
    const $ = id => document.getElementById(id);
    const avisos = [];
    if (enDemostracion) avisos.push('Modelo de demostración: falta el modelo real de la planta.');
    if (!escena3dOk) avisos.push('Falta la escena 3D: «Planta 3D» no mostrará la planta.');
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
    let corriendo = false, velocidad = 1, temporizadorAviso = null, llenadoPrevio = false;
    // El llenado de los depósitos y el control de temperatura los ejecuta el MODELO en cada paso fijo (R6 del contrato): aquí solo se mandan órdenes y se lee estado().operador.
    const operador = () => sim.estado().operador || { control: { modo: 'off', consignaC: 70, bandaC: 4, kp: 10, ki: 0.05, kd: 0, salidaPct: 0, encendido: false, sinLectura: false }, llenado: { activo: false, final: '' } };
    const llenando = () => !!operador().llenado.activo;
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
      if (d.tipo === 'seta') { if (sim.ordenes.paroEmergencia) sim.ordenes.paroEmergencia(true); else sim.ordenes.pulsador('ES-001'); avisar('Seta ES-001 pulsada: paro de emergencia. Para arrancar, REARME.'); }
      else if (d.tipo === 'liberar-seta') { if (sim.ordenes.paroEmergencia) sim.ordenes.paroEmergencia(false); avisar('Seta ES-001 liberada. Falta REARME (PB-001).'); }
      else if (d.tipo === 'pulsador') { sim.ordenes.pulsador(d.tag); avisar(`${d.tag} pulsado.`); }
      else if (d.tipo === 'orden') { sim.ordenes.manual(d.tag, d.valor); if (d.aviso) avisar(`⚠ ${d.tag}: ${d.aviso}`); }
      else avisar(d.texto);
      aplicarAhora(); refrescar();
    }

    // Llenado de los dos depósitos: el modelo abre XV-101 y XV-201 hasta que estén llenos y cierra cada una al llegar (sim.ordenes.llenarDepositos)
    function cancelarLlenado() { if (llenando() && sim.ordenes.llenarDepositos) sim.ordenes.llenarDepositos(false); llenadoPrevio = false; }
    /** Avisa cuando el modelo da por terminado el llenado (depósitos llenos o paro de emergencia). */
    function vigilarLlenado() {
      const l = operador().llenado;
      if (llenadoPrevio && !l.activo && (l.final === 'lleno' || l.final === 'paro')) avisar(l.final === 'paro' ? 'Llenado cancelado: paro de emergencia.' : 'Depósitos llenos: XV-101 y XV-201 cerradas.');
      llenadoPrevio = !!l.activo;
    }
    function alternarLlenado() {
      if (!sim.ordenes.llenarDepositos) return;
      if (llenando()) { sim.ordenes.llenarDepositos(false); llenadoPrevio = false; avisar('Llenado cancelado.'); return; }
      sim.ordenes.llenarDepositos(true); llenadoPrevio = true;
      if (!corriendo) { corriendo = true; actualizarBotones(); }               // el nivel solo sube si pasa el tiempo
      avisar('Llenando TK-101 (XV-101) y agua caliente (XV-201).');
    }
    const actualizarBotones = () => { $('sim-play').disabled = corriendo; $('sim-pause').disabled = !corriendo; };
    $('sim-play').addEventListener('click', () => { if (sim.estado().modo === 'PARADA') sim.ordenes.arrancar(); corriendo = true; actualizarBotones(); refrescar(); });
    $('sim-pause').addEventListener('click', () => { corriendo = false; actualizarBotones(); refrescar(); });
    $('sim-reset').addEventListener('click', async () => {
      const si = await confirmar({ titulo: '¿Restablecer la planta?', mensaje: 'Vuelve al estado inicial con todo parado. No se puede deshacer.', ok: 'Restablecer' });
      if (!si) return;
      const eraManual = enManual();
      sim.reiniciar(); historial.limpiar(); nivelesIniciales(eraManual ? 'revision' : 'normal'); llenadoPrevio = false;
      if (eraManual) { corriendo = true; actualizarBotones(); ponerModo('MANUAL'); }          // en Manual sigue en Manual y con el reloj en marcha
      else { corriendo = false; actualizarBotones(); refrescar(); }
    });
    $('sim-parar').addEventListener('click', () => {
      cancelarLlenado();
      if (enManual()) { for (const [tag, valor] of PCT.htstPanelManual.PARADA_SEGURA) sim.ordenes.manual(tag, valor); } else sim.ordenes.parar();
      aplicarAhora(); refrescar();
    });
    // Manual: el reloj corre siempre (no hay «Iniciar»: lo que mandas ocurre al momento, como en una planta de verdad) y se restablece con «Restablecer».
    // Automático: el PLC lleva la planta; se pasa a parada y se arranca con «Iniciar» (el estado, niveles incluidos, se conserva).
    $('modo-manual').addEventListener('click', () => { if (enManual()) return; if (sim.estado().tiempoS < 1) nivelesIniciales('revision'); cancelarLlenado(); corriendo = true; actualizarBotones(); ponerModo('MANUAL'); });
    $('modo-auto').addEventListener('click', () => { if (!enManual()) return; if (sim.estado().tiempoS < 1) nivelesIniciales('normal'); ponerControl('off'); for (const t of ['KM-201', 'KM-202', 'P-201']) sim.ordenes.manual(t, null); cancelarLlenado(); corriendo = false; actualizarBotones(); ponerModo('PARADA'); });
    document.querySelector('.velocidad').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; velocidad = Number(b.dataset.v); document.querySelectorAll('.velocidad button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });

    // Ajustes del modo Manual: velocidad de P-101 y nivel de los depósitos por barra (el nivel sirve de nivel inicial); sin tocarlas, las barras siguen el valor real
    for (const [id, cual] of [['nivel-tanque', 'tanque'], ['nivel-agua', 'aguaCaliente']]) {
      $(id).addEventListener('input', () => { if (sim.ordenes.nivelDeposito) sim.ordenes.nivelDeposito(cual, $(id).value); aplicarAhora(); refrescar(); });
    }
    $('vel-p101').addEventListener('input', () => { sim.ordenes.manual('VFD-101', Number($('vel-p101').value)); $('o-vel-p101').textContent = `${$('vel-p101').value} %`; aplicarAhora(); refrescar(); });
    $('m-llenar').addEventListener('click', () => { alternarLlenado(); aplicarAhora(); refrescar(); });
    $('m-caldera').addEventListener('click', alternarCaldera);
    // Enciende o apaga el calefactor (P-201 y los dos bancos). Lo usan el botón del panel y el botón dibujado junto al calentador HW-201 del esquema.
    async function alternarCaldera() {
      if (modoControl() !== 'off') ponerControl('off');                          // el botón manda sobre el control automático de la temperatura
      const plan = planCaldera(sim.estado());
      if (plan.accion === 'bloqueado') { avisar(plan.texto); return; }
      for (const [tag, valor] of plan.ordenes) sim.ordenes.manual(tag, valor);
      avisar(plan.accion === 'encender' ? `Caldera encendida: P-201 y los dos bancos. ⚠ ${plan.peligro}` : 'Caldera apagada.');
      aplicarAhora(); refrescar();
    }
    $('m-rearme').addEventListener('click', () => { accionesPanel.rearme(); aplicarAhora(); refrescar(); });

    // Control de temperatura del agua en Revisión: objetivo para TT-201 con histéresis (todo/nada) o PID, que manda P-201 y los dos bancos (KM-201, KM-202) como lo haría un operador.
    // Las protecciones del PLC (termostato, nivel bajo, sin circulación…) siguen cortando por encima de todo.
    const leerNumero = (id, defecto) => { const n = Number($(id).value); return Number.isFinite(n) ? n : defecto; };
    const modoControl = () => operador().control.modo;
    function mostrarCamposControl() { for (const el of document.querySelectorAll('#ctl-temp [data-solo]')) el.hidden = el.dataset.solo !== modoControl(); }
    /** Manda al modelo el control de temperatura con lo que hay en los campos (cada orden reinicia el controlador). */
    function ponerControl(modo) {
      if (sim.ordenes.controlTemperatura) sim.ordenes.controlTemperatura({ modo, consignaC: leerNumero('ct-consigna', 70), bandaC: leerNumero('ct-banda', 4), kp: leerNumero('ct-kp', 10), ki: leerNumero('ct-ki', 0.05), kd: leerNumero('ct-kd', 0) });
      $('ct-modo').value = modoControl(); mostrarCamposControl();
    }
    /** Línea de estado del control, a partir de estado().operador.control (la calcula el modelo). */
    function textoControl(e) {
      const c = (e.operador || operador()).control;
      if (c.modo === 'off') return 'Desactivado: calientas tú con la caldera.';
      if (c.sinLectura) return 'Sin lectura válida de TT-201: bancos apagados.';
      const tt = e.instrumentos && e.instrumentos['TT-201'], T = tt && typeof tt.valorPLC === 'number' ? tt.valorPLC : null;
      if (T === null) return 'Sin lectura válida de TT-201: bancos apagados.';
      const conectados = (PCT.htstPanelManual.ordenDe(e, 'KM-201') ? 1 : 0) + (PCT.htstPanelManual.ordenDe(e, 'KM-202') ? 1 : 0), bloqueo = PCT.htstPanelManual.bloqueo(e, 'KM-201');
      return `${c.modo === 'pid' ? `PID: salida ${dec(c.salidaPct, 0)} %` : `Histéresis: ${c.encendido ? 'calentando' : 'esperando'}`} · objetivo ${dec(c.consignaC, 1)} °C · medida ${dec(T, 1)} °C · bancos ${conectados}/2${bloqueo && !conectados ? ` · bloqueado: ${bloqueo}` : ''}`;
    }
    $('ct-modo').addEventListener('change', () => { ponerControl($('ct-modo').value); aplicarAhora(); refrescar(); });
    for (const id of ['ct-kp', 'ct-ki', 'ct-kd', 'ct-consigna', 'ct-banda']) $(id).addEventListener('change', () => { if (modoControl() !== 'off') ponerControl(modoControl()); });
    mostrarCamposControl();

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
      const textoCtl = textoControl(e); if ($('ct-estado').textContent !== textoCtl) $('ct-estado').textContent = textoCtl;
      if (document.activeElement !== $('ct-modo') && $('ct-modo').value !== modoControl()) { $('ct-modo').value = modoControl(); mostrarCamposControl(); }      // el modelo apaga el control al salir de Manual
      consignasPanel.llenando = llenando();
      const calderaOn = !!(PCT.htstPanelManual.ordenDe(e, 'KM-201') || PCT.htstPanelManual.ordenDe(e, 'KM-202'));
      const textoCaldera = calderaOn ? 'Apagar caldera' : 'Encender caldera'; if ($('m-caldera').textContent !== textoCaldera) $('m-caldera').textContent = textoCaldera;
      $('m-caldera').classList.toggle('activo', calderaOn);
      const textoLlenar = llenando() ? 'Llenando… (cancelar)' : 'Llenar los dos depósitos'; if ($('m-llenar').textContent !== textoLlenar) $('m-llenar').textContent = textoLlenar;
      for (const [id, nivel] of [['vel-p101', e.salidasPLC && e.salidasPLC.AO && e.salidasPLC.AO['VFD-101']], ['nivel-tanque', e.tanque && e.tanque.nivelPct], ['nivel-agua', e.aguaCaliente && e.aguaCaliente.nivelPct]]) {
        if (typeof nivel !== 'number') continue;
        const arrastrando = document.activeElement === $(id), v = String(Math.round(nivel));
        if (!arrastrando && $(id).value !== v) $(id).value = v;
        const texto = id === 'nivel-agua' ? `nivel ${nivelAgua(e)}` : `${arrastrando ? $(id).value : v} %`;      // el depósito de agua solo tiene dos interruptores de nivel: no da porcentaje
        if ($(`o-${id}`).textContent !== texto) $(`o-${id}`).textContent = texto;
      }
      // Mando de Normal (panel lateral)
      const poner = (id, t) => { const el = $(id); if (el.textContent !== t) el.textContent = t; };
      const paro = !!(e.plc && e.plc.paro), pos = e.equipos && e.equipos['FDV-101'] && e.equipos['FDV-101'].posicion;
      poner('mn-caudal', `${Math.round(consignasPanel.caudalLh)} L/h`); poner('mn-tt103', `${dec(consignasPanel.tt103C, 1)} °C`);
      poner('mn-agua', e.plc && typeof e.plc.consignaAguaC === 'number' ? `${dec(e.plc.consignaAguaC, 1)} °C` : '—');
      poner('mn-agua-sub', `TT-201: ${PCT.htstEsquema.textoInstrumento(e, 'TT-201')} · TSH a 90 °C`);
      poner('mn-caudal-sub', `consigna de P-101 · FT-101: ${PCT.htstEsquema.textoInstrumento(e, 'FT-101')}`);
      poner('mn-estado', paro ? `PARO: ${((e.plc && e.plc.motivosParo) || []).join(', ') || 'pulsa REARME'}` : `${nombreModo(e.modo)} · FDV ${pos === 'AVANCE' ? 'en avance' : pos === 'DESVIO' ? 'en desvío' : 'moviéndose'}`);
      const bot = a => document.querySelector(`#mando-normal [data-accion="${a}"]`);
      bot('marcha').classList.toggle('activo', e.modo !== 'PARADA' && !paro); bot('paro').classList.toggle('activo', e.modo === 'PARADA' && !paro);
      bot('rearme').classList.toggle('alarma', paro || (e.instrumentos && e.instrumentos['TSH-201'] && e.instrumentos['TSH-201'].nivel === 0));
      bot('llenar').classList.toggle('activo', llenando()); poner('mn-llenar', llenando() ? 'Llenando… (cancelar)' : 'Llenar los dos depósitos');
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
      vigilarLlenado();
      refrescar();
      if (corriendo) { const e = sim.estado(), v = {}; for (const [tag, i] of Object.entries(e.instrumentos || {})) if (i && typeof i.valorPLC === 'number') v[tag] = i.valorPLC; historial.registrar(e.tiempoS, Object.assign(v, estadosDigitales(e))); }
      if (performance.now() - ultimaGrafica > 1000) { ultimaGrafica = performance.now(); graficas.redibujar(); }
    }, 250);
    refrescar();

    // Para las ventanas aparte (3D, Fuerza y Mando) y para las pruebas
    PCT.htstApp = { estadoActual: () => sim.estado(), sim, enDemostracion, nivel: () => 3, ponerModo, accionarEquipo: accionar, llenarDepositos: alternarLlenado };
  }

  const api = { ALIAS, LLENO_PCT, NIVELES_INICIALES, decidirClic, planCaldera, condicionesFdv, estadosDigitales, nivelAgua, textoEstado, formatoReloj, nombreModo, iniciar };
  if (typeof module !== 'undefined') module.exports = api;
  else { window.HTST_PAGINA_SIMPLE = api; if (document.getElementById('app')) iniciar().catch(error => { console.error(error); document.getElementById('app').innerHTML = `<p class="aviso-planta">No se pudo iniciar la planta: ${escapar(error.message || error)}</p>`; }); }
})();
