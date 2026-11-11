(function () {
  const { ELEMENTOS, ETIQUETA_POR_TEXTO, ETIQUETA_POR_ID, GUIA_COMUN, GUIA_MANUAL, GUIA_AUTOMATICO,
    GUIA_DEMOSTRACION, GUIA_INICIO, GUIA_SUPUESTOS, lista } = PCT.ayudaTextos;
  const CAJAS = ['HEAT', 'TANKA', 'TANKB', 'REGEN', 'CALENT', 'ENFRIA'];
  const TITULOS_GUIA = {
    manual: 'Ayuda · modo manual', automatico: 'Ayuda · modo automático',
    demostracion: 'Ayuda · modo demostración', inicio: 'Ayuda · simulador de la PCT23',
  };
  const formatoDecimal = v => v.toFixed(1).replace('.', ',');
  const capacidad = () => PCT.constantesFisicas.CONSTANTES_FISICAS.capacidadDepositoMl;
  const porcentaje = (estado, deposito) => Math.round(PCT.estadoPlanta.porcentajeLlenado(estado, deposito));

  let ventana = null, velo = null, guia = null, claveActual = null, temporizador = null;
  let tipoGuia = 'inicio';
  let obtenerEstado = () => null;

  /* ---------- identificar el elemento pulsado ---------- */
  function distanciaRectangulos(a, b) {
    const desfaseX = Math.max(a.x - (b.x + b.width), 0, b.x - (a.x + a.width));
    const desfaseY = Math.max(a.y - (b.y + b.height), 0, b.y - (a.y + a.height));
    return Math.hypot(desfaseX, desfaseY);
  }

  const norm = s => s.replace(/[↑→←\s]+$/g, '').trim().toUpperCase();

  function textoMasCercano(svg, caja, limite, valida) {
    let mejor = null, distanciaMinima = limite;
    for (const texto of svg.querySelectorAll('text')) {
      const clave = ETIQUETA_POR_TEXTO[norm(texto.textContent)];
      if (!clave || !valida(clave)) continue;
      const distancia = distanciaRectangulos(caja, texto.getBBox());
      if (distancia < distanciaMinima) { distanciaMinima = distancia; mejor = clave; }
    }
    return mejor;
  }

  function claveDeCaja(rectangulo, svg) {
    return textoMasCercano(svg, rectangulo.getBBox(), 40, clave => CAJAS.includes(clave));
  }

  function claveDeTuberia(tubo) {
    const datos = tubo.dataset;
    if (datos.ruta === 'desvio') return 'DESVIO';
    if (datos.ruta === 'normal') return 'FINAL';
    if (datos.solenoide) return datos.solenoide;
    if (datos.bomba) return datos.bomba === 'N2' ? 'TUBO_N2' : 'TUBO_N1';
    if (datos.circuito) return 'TUBO_FRIO';
    return 'TUBO';
  }

  function claveDeNodo(nodo) {
    const id = nodo.id || '';
    if (ETIQUETA_POR_ID[id]) return ETIQUETA_POR_ID[id];
    if (/^[gv]-/.test(id) && (ELEMENTOS[id.slice(2)] || /^T[1-5]$/.test(id.slice(2)))) return id.slice(2);
    const salida = nodo.dataset && nodo.dataset.salida;
    return salida && ELEMENTOS[salida] ? salida : null;
  }

  function claveDeAncestros(nodo, svg) {
    for (let n = nodo; n && n !== svg; n = n.parentNode) {
      const clave = claveDeNodo(n);
      if (clave) return clave;
    }
    return null;
  }

  function puntoEnSvg(evento, svg) {
    const matriz = svg.getScreenCTM();
    if (!matriz) return null;
    const punto = svg.createSVGPoint();
    punto.x = evento.clientX; punto.y = evento.clientY;
    return punto.matrixTransform(matriz.inverse());
  }

  function claveDeArea(evento, svg) {
    const punto = puntoEnSvg(evento, svg);
    if (!punto) return null;
    for (const rectangulo of svg.querySelectorAll('rect.caja')) {
      const cajaRectangulo = rectangulo.getBBox();
      const dentro = punto.x >= cajaRectangulo.x && punto.x <= cajaRectangulo.x + cajaRectangulo.width && punto.y >= cajaRectangulo.y && punto.y <= cajaRectangulo.y + cajaRectangulo.height;
      if (dentro) { const clave = claveDeCaja(rectangulo, svg); if (clave) return clave; }
    }
    return textoMasCercano(svg, { x: punto.x, y: punto.y, width: 0, height: 0 }, 48, () => true);
  }

  function claveDeSvg(evento, svg) {
    const el = evento.target;
    const porNodo = claveDeAncestros(el, svg);
    if (porNodo) return porNodo;
    const tubo = el.closest('.tubo');
    if (tubo && tubo.tagName.toLowerCase() === 'path') return claveDeTuberia(tubo);
    if (el.matches && el.matches('rect.caja')) { const clave = claveDeCaja(el, svg); if (clave) return clave; }
    return claveDeArea(evento, svg);
  }

  // Tarjetas del panel de control: id «t-N1», «t-SOL1», «t-RES»...
  function claveDeTarjeta(el) {
    const tarjeta = el.closest && el.closest('[id^="t-"]');
    if (!tarjeta || el.closest('svg')) return null;
    const clave = tarjeta.id.slice(2);
    return ELEMENTOS[clave] ? clave : null;
  }

  function claveDelElemento(evento) {
    const tarjeta = claveDeTarjeta(evento.target);
    if (tarjeta) return tarjeta;
    const svg = evento.target.closest && evento.target.closest('svg');
    return svg ? claveDeSvg(evento, svg) : null;
  }

  /* ---------- estado ahora ---------- */
  const LECTURAS = {
    N1: (e, o) => `${e.salidas.N1 ? 'En marcha' : 'Parada'} · PWM ${Math.round(e.consignas.velocidadN1Pct)} % · sentido ${+e.giro.N1} (OUT06) · caudal ${Math.round(o.F1)} ml/min`,
    N2: e => `${e.salidas.N2 ? 'En marcha' : 'Parada'} · PWM ${Math.round(e.consignas.velocidadN2Pct)} % · sentido ${+e.giro.N2} (OUT05)`,
    SOL1: e => (e.salidas.SOL1 ? 'Activa: producto desviado (recircula al tanque)' : 'Sin activar: producto a la salida normal'),
    SOL2: e => (e.salidas.SOL2 ? 'Activa: alimenta desde el tanque B' : 'En reposo: alimenta desde el tanque A'),
    SOL3: e => (e.salidas.SOL3 ? 'Abierta: circula agua fría' : 'Cerrada'),
    SOL4: e => (e.salidas.SOL4 ? 'Abierta: llenando el tanque A' : 'Cerrada'),
    SOL5: e => (e.salidas.SOL5 ? 'Abierta: llenando el tanque B' : 'Cerrada'),
    F1: (e, o) => `${Math.round(o.F1)} ml/min`,
    L1: (e, o) => `${Math.round(o.L1)} mm`,
    LL: (e, o) => (o.LL ? 'Nivel bajo detectado' : 'Nivel por encima del bajo'),
    HL: (e, o) => (o.HL ? 'Nivel alto detectado' : 'Nivel por debajo del alto'),
    TERM: (e, o) => (o.TERM ? 'Disparado: calefactor cortado' : 'Normal'),
    RES: e => `${e.salidas.RES ? 'ON' : 'OFF'} · potencia ${formatoDecimal(e.consignas.potenciaPct)} % (${Math.round(e.consignas.potenciaPct * 50 / 100)}/50 ciclos)`,
    HEAT: (e, o) => `T2 = ${formatoDecimal(o.T2)} °C · calefactor ${e.salidas.RES ? 'ON ' + formatoDecimal(e.consignas.potenciaPct) + ' %' : 'OFF'} · N2 ${e.salidas.N2 ? 'en marcha' : 'parada'}${o.TERM ? ' · TERMOSTATO DISPARADO' : ''}`,
    TANKA: e => `${porcentaje(e, 'A')} % · ${Math.round(e.depositoAMl)} ml de ${capacidad()}`,
    TANKB: e => `${porcentaje(e, 'B')} % · ${Math.round(e.depositoBMl)} ml de ${capacidad()}`,
    DESVIO: e => `${Math.round(e.desviadoMl)} ml recirculados · ${e.salidas.SOL1 && e.salidas.N1 ? 'circulando ahora' : 'sin circulación'}`,
    FINAL: e => `${Math.round(e.finalMl)} ml de producto acabado`,
    DRAIN: e => `${formatoDecimal(e.desagueMl / 1000)} L enviados a desagüe`,
    HOLDING: (e, o) => `T1 a la salida: ${formatoDecimal(o.T1)} °C`,
  };
  ['T1', 'T2', 'T3', 'T4', 'T5'].forEach(clave => { LECTURAS[clave] = (e, o) => `${formatoDecimal(o[clave])} °C`; });

  function textoEstadoVivo(clave) {
    const estado = obtenerEstado();
    const lectura = LECTURAS[clave];
    if (!estado || !lectura) return '';
    return lectura(estado, PCT.planta.observaciones(estado));
  }

  /* ---------- ventana de un elemento ---------- */
  function refrescarEstadoVivo() {
    if (claveActual && !ventana.hidden) ventana.querySelector('.estado-vivo').textContent = textoEstadoVivo(claveActual) || '—';
  }

  function cerrarAyuda() {
    if (ventana) { ventana.hidden = true; velo.hidden = true; if (guia) guia.hidden = true; }
    claveActual = null;
    clearInterval(temporizador);
  }

  function abrirAyuda(clave) {
    const elemento = ELEMENTOS[clave];
    claveActual = clave;
    ventana.querySelector('h3').textContent = elemento.titulo;
    ventana.querySelector('.etiqueta-ayuda').textContent = elemento.etiqueta;
    ventana.querySelector('.que-es').textContent = elemento.queEs;
    ventana.querySelector('.en-simulador').textContent = elemento.enSimulador;
    ventana.querySelector('.pie').textContent = `Fuente: manual de la PCT23, ${elemento.paginas}. Pulsa la × o Esc para cerrar.`;
    const boton3d = ventana.querySelector('.boton-3d');
    boton3d.hidden = !elemento.modelo3d;
    boton3d.onclick = () => { cerrarAyuda(); PCT.visor3d.abrirEnVentana(elemento.modelo3d, obtenerEstado, elemento.foco3d); };
    velo.hidden = false; ventana.hidden = false;
    refrescarEstadoVivo();
    clearInterval(temporizador);
    temporizador = setInterval(refrescarEstadoVivo, 500);
  }

  function crearVentana() {
    ventana = document.createElement('div');
    ventana.id = 'ventana-ayuda'; ventana.hidden = true;
    ventana.setAttribute('role', 'dialog'); ventana.setAttribute('aria-label', 'Ayuda del elemento');
    ventana.innerHTML = '<header><h3></h3><button type="button" aria-label="Cerrar (Esc)" title="Cerrar (Esc)">×</button></header><span class="etiqueta-ayuda"></span>' +
      '<div class="cuerpo"><p class="que-es"></p><div class="titulo-seccion">En el simulador</div><p class="en-simulador"></p>' +
      '<div class="titulo-seccion">Estado ahora</div><p class="estado-vivo"></p>' +
      '<button type="button" class="boton-3d" hidden>Ver modelo 3D ▸</button></div><div class="pie"></div>';
    velo = document.createElement('div');
    velo.id = 'velo-ayuda'; velo.hidden = true;
    document.body.append(velo, ventana);
    ventana.querySelector('button').addEventListener('click', cerrarAyuda);
  }

  /* ---------- guía de la pantalla ---------- */
  function textoModos() {
    const modos = PCT.constantesControl.MODOS_REGULACION;
    return '<p>Son los que cita el manual (operación manual, entradas ON/OFF, lazos simples, cascada y lazos múltiples). Las consignas y las ganancias de los lazos son <b>supuestos</b>: el manual no da valores.</p>' +
      lista(modos.map(m => `<b>${m.nombre}</b> (manual, ${m.manual}): ${m.detalle}`));
  }

  function seccionesAutomatico() {
    return GUIA_AUTOMATICO.map(seccion => (seccion[1] === null ? ['Modos de regulación del calefactor', textoModos()] : seccion));
  }

  function seccionesDeGuia(tipo) {
    if (tipo === 'manual') return [...GUIA_COMUN, ...GUIA_MANUAL, GUIA_SUPUESTOS];
    if (tipo === 'automatico') return [...GUIA_COMUN, ...seccionesAutomatico(), GUIA_SUPUESTOS];
    if (tipo === 'demostracion') return [...GUIA_COMUN, ...GUIA_DEMOSTRACION, GUIA_SUPUESTOS];
    return [GUIA_COMUN[0], ...GUIA_INICIO, GUIA_SUPUESTOS];
  }

  function abrirGuia() {
    const cuerpo = guia.querySelector('.cuerpo');
    guia.querySelector('h3').textContent = TITULOS_GUIA[tipoGuia] || TITULOS_GUIA.inicio;      // tipo nuevo (planta_real): título de reserva
    cuerpo.innerHTML = seccionesDeGuia(tipoGuia).map(seccion => `<h4>${seccion[0]}</h4>${seccion[1]}`).join('');
    cuerpo.scrollTop = 0;
    cerrarAyuda();
    velo.hidden = false;
    guia.hidden = false;
  }

  function crearGuia() {
    guia = document.createElement('div');
    guia.id = 'guia-ayuda'; guia.hidden = true;
    guia.setAttribute('role', 'dialog'); guia.setAttribute('aria-label', 'Guía de ayuda');
    guia.innerHTML = '<header><h3></h3><button type="button" aria-label="Cerrar (Esc)" title="Cerrar (Esc)">×</button></header>' +
      '<div class="cuerpo"></div><div class="pie">Pulsa la × o Esc para cerrar.</div>';
    document.body.appendChild(guia);
    guia.querySelector('button').addEventListener('click', cerrarAyuda);
  }

  function anadirBotonGuia() {
    const cabecera = document.querySelector('header.cab');
    if (!cabecera) return;
    const planta = document.createElement('button');
    planta.type = 'button'; planta.id = 'boton-planta3d'; planta.textContent = 'Planta 3D';
    planta.addEventListener('click', () => PCT.visor3d.abrirEnVentana('PLANTA', obtenerEstado));
    cabecera.appendChild(planta);
    const boton = document.createElement('button');
    boton.type = 'button'; boton.id = 'boton-ayuda'; boton.textContent = '? Ayuda';
    boton.addEventListener('click', abrirGuia);
    cabecera.appendChild(boton);
  }

  function anadirPista() {
    const lienzo = document.querySelector('.lienzo');
    if (!lienzo) return;
    const pista = document.createElement('p');
    pista.id = 'pista-ayuda'; pista.className = 'pie-sim';
    pista.textContent = 'Clic derecho (o mantén pulsado 3 s en pantallas táctiles) sobre cualquier elemento del esquema (bombas, válvulas, sensores, depósitos…) para ver qué es.';
    lienzo.insertAdjacentElement('afterend', pista);
  }

  /* ---------- eventos ---------- */
  let tactil = false, suprimirClic = false;

  function alPulsarDerecho(evento) {
    if (ventana.contains(evento.target) || guia.contains(evento.target)) return;
    if (tactil) { evento.preventDefault(); return; }
    const clave = claveDelElemento(evento);
    if (!clave || !ELEMENTOS[clave]) { cerrarAyuda(); return; }
    evento.preventDefault();
    abrirAyuda(clave);
  }

  function alPulsarFuera(evento) {
    if (suprimirClic) return;
    const abierto = !ventana.hidden || !guia.hidden;
    if (abierto && !ventana.contains(evento.target) && !guia.contains(evento.target) && evento.button === 0) cerrarAyuda();
  }

  function abrirPorPulsacion(evento) {
    const clave = claveDelElemento(evento);
    if (!clave || !ELEMENTOS[clave]) return;
    suprimirClic = true;
    setTimeout(() => { suprimirClic = false; }, 800);
    abrirAyuda(clave);
  }

  function iniciarPulsacionLarga() {
    const larga = PCT.pulsacionLarga.crearPulsacionLarga({ alCumplir: abrirPorPulsacion });
    const esTactil = e => e.pointerType === 'touch' || e.pointerType === 'pen';
    document.addEventListener('pointerdown', e => {
      tactil = esTactil(e);
      if (!tactil || ventana.contains(e.target) || guia.contains(e.target)) return;
      larga.empezar(e.clientX, e.clientY, { target: e.target, clientX: e.clientX, clientY: e.clientY });
    });
    document.addEventListener('pointermove', e => { if (esTactil(e)) larga.mover(e.clientX, e.clientY); });
    document.addEventListener('pointerup', e => { if (esTactil(e)) larga.terminar(); });
    document.addEventListener('pointercancel', larga.cancelar);
    document.addEventListener('scroll', larga.cancelar, true);
    document.addEventListener('click', e => {
      if (!suprimirClic) return;
      suprimirClic = false;
      e.preventDefault(); e.stopImmediatePropagation();
    }, true);
  }

  /** tipo: 'manual', 'automatico', 'demostracion' o 'inicio'; obtener() devuelve el estado de la planta. */
  function iniciarAyuda(tipo, obtener) {
    tipoGuia = tipo;
    obtenerEstado = obtener || (() => null);
    crearVentana();
    crearGuia();
    anadirBotonGuia();
    anadirPista();
    document.addEventListener('contextmenu', alPulsarDerecho);
    document.addEventListener('mousedown', alPulsarFuera);
    iniciarPulsacionLarga();
    document.addEventListener('keydown', evento => { if (evento.key === 'Escape') cerrarAyuda(); });
  }

  PCT.ayuda = { iniciarAyuda, estadoActual: () => obtenerEstado() };
})();
