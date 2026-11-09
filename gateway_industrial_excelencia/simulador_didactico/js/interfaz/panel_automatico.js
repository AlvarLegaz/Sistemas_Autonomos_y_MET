(function () {
  const { $, formatearEntero, formatearDecimal, formatearTiempo } = PCT.dom;
  const { ScadaWidget, lecturasDeEstado } = PCT.scadaWidget;
  const { registrarEventoEnPantalla, vaciarRegistro } = PCT.registroEventos;
  const esquema = PCT.esquemaPct23;
  const grafica = PCT.grafica;
  const estadoPlanta = PCT.estadoPlanta;
  const planta = PCT.planta;
  const motor = PCT.secuencia;
  const alarmas = PCT.alarmas;
  const alcance = PCT.alcanzabilidad;
  const CONTROL = PCT.constantesControl;
  const FISICA = PCT.constantesFisicas.CONSTANTES_FISICAS;
  const limitar = PCT.matematicas.limitar;
  const FASES_VISIBLES = CONTROL.ORDEN_FASES.concat(['finalizada']);
  const ORDEN_SALTO = CONTROL.ORDEN_FASES.slice(0, -1);
  const AJUSTES = ['modo', 'reg', 'origen', 'ref', 'caudal', 't1', 't2', 'hist', 'pot', 'f1'];
  const FASES_CON_PRODUCTO = ['produccion', 'lavado', 'parada', 'finalizada'];

  let estado = null, secuencia = null, esquemaScada = null;
  let ejecutando = false, velocidad = 1, demo = false;
  let refTodo = true, origenPrevio = null;

  const todos = selector => Array.from(document.querySelectorAll(selector));
  const otroTanque = deposito => (deposito === 'A' ? 'B' : 'A');
  const redondeoPct = deposito => Math.round(estadoPlanta.porcentajeLlenado(estado, deposito));

  function registrar(mensaje, tiempo = estado.tiempo) {
    registrarEventoEnPantalla(`[${formatearTiempo(tiempo)}] ${mensaje}`);
  }

  function volcarEventos() {
    for (const evento of secuencia.eventos.splice(0)) registrar(evento.mensaje, evento.tiempo);
  }

  function ponerEtiqueta(id, clase, texto) {
    $(id).className = `chip ${clase}`;
    $(id).lastElementChild.textContent = texto;
  }

  /* ---------- ajustes ---------- */
  function configInicial() {
    return demo ? alcance.configDemostracion(Number($('cfg-t1').value), $('cfg-origen').value) : undefined;
  }

  function aplicarDepositoOrigen() {
    const origen = $('cfg-origen').value;
    estadoPlanta.ponerLlenado(estado, origen, Number($('llen-demo').value));
    estadoPlanta.ponerLlenado(estado, otroTanque(origen), 0);
  }

  // Automático: el tanque que no es el de origen queda vacío. Al cambiar de origen, el nuevo recibe el llenado del anterior.
  function vaciarDepositoNoElegido(cambio) {
    const nuevo = $('cfg-origen').value;
    if (cambio && origenPrevio && origenPrevio !== nuevo) {
      estadoPlanta.ponerLlenado(estado, nuevo, estadoPlanta.porcentajeLlenado(estado, origenPrevio));
    }
    estadoPlanta.ponerLlenado(estado, otroTanque(nuevo), 0);
    origenPrevio = nuevo;
  }

  function iniciarSelectorRegulacion() {
    for (const modo of CONTROL.MODOS_REGULACION) {
      const opcion = document.createElement('option');
      opcion.value = modo.id; opcion.textContent = modo.nombre;
      opcion.selected = modo.id === secuencia.ajustes.modoRegulacion;
      $('cfg-modo').appendChild(opcion);
    }
  }

  function leerValoresDelPanel() {
    const ajustes = secuencia.ajustes;
    ajustes.modoRegulacion = demo ? $('cfg-reg').value : $('cfg-modo').value;
    ajustes.origen = $('cfg-origen').value;
    ajustes.caudalPct = Number($('cfg-caudal').value);
    ajustes.consignaT1C = Number($('cfg-t1').value);
    ajustes.consignaT2C = Number($('cfg-t2').value);
    ajustes.histeresisT2C = Number($('cfg-hist').value);
    ajustes.potenciaManualPct = Number($('cfg-pot').value);
    ajustes.consignaF1MlMin = Number($('cfg-f1').value);
  }

  // Demostración: solo se elige la temperatura; el caudal y el modo los decide la planta.
  function aplicarModoDemostracion() {
    $('cfg-t1').max = String(alcance.t1MaximaDemostracion());
    if (secuencia.ajustes.modoRegulacion === 'onoff') {
      Object.assign(secuencia.ajustes, alcance.configDemostracionTodoNada($('cfg-t1').value, $('cfg-origen').value, secuencia.ajustes));
      return;
    }
    const decision = alcance.configDemostracion($('cfg-t1').value, $('cfg-origen').value);
    $('cfg-caudal').value = String(decision.caudalPct);
    Object.assign(secuencia.ajustes, decision);
  }

  // Producción de referencia: nunca más de lo que hay en el tanque de origen.
  function aplicarReferencia() {
    const ajustes = secuencia.ajustes;
    const maximo = motor.referenciaMaxima(estado, ajustes.origen);
    const deslizador = $('cfg-ref');
    deslizador.min = String(maximo < 50 ? 0 : 50);
    deslizador.max = String(maximo);
    if (refTodo || Number(deslizador.value) > maximo) deslizador.value = String(maximo);
    const referencia = Math.min(Number(deslizador.value), maximo);
    ajustes.volumenObjetivoMl = referencia >= maximo ? null : referencia;
    $('o-ref').textContent = referencia >= maximo ? `${referencia} ml (todo el tanque)`
      : `${referencia} ml (${Math.round(referencia / maximo * 100)} % del tanque)`;
  }

  function avisoTemperatura(ajustes) {
    const t1Estable = alcance.t1Estacionaria(ajustes);
    if (t1Estable < ajustes.consignaT1C - 1) {
      return { mal: true, texto: `Con esta configuración T1 se estabilizaría en ≈ ${formatearDecimal(t1Estable)} °C, por debajo de ${ajustes.consignaT1C} °C: saltará la alarma de precalentamiento.` };
    }
    const caudal = ajustes.modoRegulacion === 'multiple' ? ajustes.consignaF1MlMin / FISICA.caudalMaxN1MlMin * 100 : ajustes.caudalPct;
    const maximo = alcance.t1Alcanzable(caudal, ajustes.potenciaMaxPct);
    return { mal: false, texto: `T1 podrá llegar a ${ajustes.consignaT1C} °C con esta configuración (el modelo da hasta ≈ ${formatearDecimal(maximo)} °C).` };
  }

  function avisoDemostracionTodoNada(ajustes, pocoProducto, fin) {
    const texto = `Todo o nada sobre T2: la resistencia se conecta al ${ajustes.potenciaMaxPct} % por debajo de ${ajustes.consignaT2C - ajustes.histeresisT2C} °C y se desconecta por encima de ${ajustes.consignaT2C + ajustes.histeresisT2C} °C. N1 al ${ajustes.caudalPct} %; producirá ${fin}.`;
    const extra = pocoProducto ? ` Con el tanque ${ajustes.origen} tan vacío no arrancará: saltará la alarma.` : '';
    return { mal: pocoProducto, texto: texto + extra };
  }

  function avisoDemostracion(ajustes) {
    const ml = Number($('llen-demo').value) / 100 * FISICA.capacidadDepositoMl;
    const pocoProducto = ml < ajustes.volumenMinimoMl;
    const fin = ajustes.volumenObjetivoMl != null ? `${ajustes.volumenObjetivoMl} ml` : 'hasta agotar el tanque';
    if (ajustes.modoRegulacion === 'onoff') return avisoDemostracionTodoNada(ajustes, pocoProducto, fin);
    const texto = `Hasta ${alcance.t1MaximaDemostracion()} °C con este modelo. Para ${ajustes.consignaT1C} °C la planta usará N1 al ${ajustes.caudalPct} % (el mayor caudal con el que llega) y producirá ${fin} (o hasta que pulses Terminar producción).`;
    const extra = pocoProducto ? ` Con el tanque ${ajustes.origen} tan vacío (${Math.round(ml)} ml) no arrancará: saltará la alarma.` : '';
    return { mal: pocoProducto, texto: texto + extra };
  }

  function pintarAvisoConfiguracion() {
    const ajustes = secuencia.ajustes;
    const general = avisoTemperatura(ajustes);
    const demostracion = demo ? avisoDemostracion(ajustes) : null;
    $('cfg-aviso').textContent = demostracion ? demostracion.texto : general.texto;
    const mal = general.mal || (demostracion !== null && demostracion.mal);
    $('cfg-aviso').className = mal ? 'sec-aviso mal' : 'sec-aviso';
  }

  function mostrarCamposDelModo() {
    const ajustes = secuencia.ajustes;
    const modo = CONTROL.MODOS_REGULACION.find(m => m.id === ajustes.modoRegulacion);
    $('cfg-modo-desc').textContent = `${modo.detalle} (manual, ${modo.manual}; consignas y ganancias supuestas)`;
    todos('[data-modos]').forEach(campo => { campo.hidden = !campo.dataset.modos.split(' ').includes(ajustes.modoRegulacion); });
    $('avanzado').hidden = demo && ajustes.modoRegulacion !== 'onoff';
  }

  function leerConfiguracionDelPanel() {
    leerValoresDelPanel();
    if (demo) aplicarModoDemostracion();
    aplicarReferencia();
    mostrarCamposDelModo();
    pintarAvisoConfiguracion();
    for (const id of ['t1', 't2', 'hist', 'pot', 'f1', 'caudal']) $(`o-${id}`).textContent = $(`cfg-${id}`).value;
  }

  function bloquearAjustes(bloqueado) {
    for (const id of AJUSTES) $(`cfg-${id}`).disabled = bloqueado;
  }

  /* ---------- acciones ---------- */
  function accionSobreSecuencia(accion) {
    accion();
    volcarEventos();
    pintarPanel();
  }

  function iniciarSecuencia() {
    leerConfiguracionDelPanel();
    if (motor.iniciar(secuencia, estado)) { ejecutando = true; registrar('Secuencia iniciada'); }
    volcarEventos();
    pintarPanel();
  }

  function alternarPausa() {
    ejecutando = !ejecutando;
    registrar(ejecutando ? 'Reanudada' : 'En pausa');
    pintarPanel();
  }

  function reiniciarPlanta() {
    estado = estadoPlanta.crearEstado();
    secuencia = motor.crearSecuencia(configInicial());
    ejecutando = false;
    if (demo) aplicarDepositoOrigen(); else vaciarDepositoNoElegido(false);
    grafica.reiniciarGrafica();
    vaciarRegistro();
    registrar('Planta y secuencia reiniciadas');
    leerConfiguracionDelPanel();
    pintarPanel();
  }

  /* ---------- simulación ---------- */
  function puedeAvanzar() {
    const terminada = ['reposo', 'finalizada'].includes(secuencia.fase);
    return ejecutando && !(terminada && !estado.salidas.N2);
  }

  function avanzarSecuencia() {
    const total = 0.25 * velocidad;
    const pasos = Math.max(1, Math.ceil(total));
    const segundosPaso = total / pasos;
    for (let i = 0; i < pasos; i++) motor.paso(secuencia, estado, segundosPaso);
    volcarEventos();
    if (secuencia.fase === 'finalizada') { ejecutando = false; registrar('Secuencia finalizada'); }
  }

  function alPaso() {
    if (puedeAvanzar()) avanzarSecuencia();
    pintarPanel();
  }

  function ponerVelocidad(nueva) {
    velocidad = nueva;
    pintarPanel();
  }

  /* ---------- representación ---------- */
  function estadoVisual() {
    if (secuencia.fase === 'alarma') return 'alarma';
    if (secuencia.fase === 'finalizada') return 'fin';
    if (secuencia.fase === 'reposo') return 'reposo';
    return ejecutando ? 'marcha' : 'pausa';
  }

  function textoMotivo(visual) {
    if (visual === 'reposo') return 'Revisa los ajustes y pulsa Iniciar.';
    if (visual === 'fin') return 'Secuencia terminada. Cambia los ajustes y repite si quieres.';
    return secuencia.motivo ? `Motivo del cambio de fase: ${secuencia.motivo}` : '';
  }

  function producidoEnSecuencia() {
    return FASES_CON_PRODUCTO.includes(secuencia.fase) ? Math.max(0, estado.finalMl - secuencia.finalInicialMl) : 0;
  }

  function avanceDeFase(producido) {
    const ajustes = secuencia.ajustes;
    if (secuencia.fase === 'arranque') return secuencia.segundosFase / ajustes.segundosArranque * 100;
    if (secuencia.fase === 'lavado') return secuencia.segundosFase / ajustes.segundosLavado * 100;
    if (secuencia.fase === 'produccion' && ajustes.volumenObjetivoMl != null) return producido / ajustes.volumenObjetivoMl * 100;
    return null;
  }

  function textoAvanceProducto(producido) {
    const referencia = secuencia.ajustes.volumenObjetivoMl;
    if (!FASES_CON_PRODUCTO.includes(secuencia.fase)) return '';
    return referencia != null ? `${formatearEntero(producido)} de ${formatearEntero(referencia)} ml producidos` : `${formatearEntero(producido)} ml producidos`;
  }

  function pintarPistaFases(visual) {
    const indice = FASES_VISIBLES.indexOf(secuencia.fase);
    todos('#fases li').forEach(itemFase => {
      const posicion = FASES_VISIBLES.indexOf(itemFase.dataset.fase);
      itemFase.className = (secuencia.fase === itemFase.dataset.fase ? 'actual ' : '') + (indice >= 0 && posicion < indice ? 'hecha' : '');
      itemFase.style.removeProperty('--avance');
    });
    $('fase-nombre').textContent = CONTROL.NOMBRES_FASE[secuencia.fase];
    $('fase-nombre').className = `fase-nombre ${visual === 'alarma' ? 'alarma' : visual === 'fin' ? 'fin' : ejecutando ? 'marcha' : ''}`;
    $('fase-motivo').textContent = textoMotivo(visual);
    $('tiempo-fase').textContent = formatearTiempo(secuencia.segundosFase);
    const producido = producidoEnSecuencia();
    $('k-avance').textContent = textoAvanceProducto(producido);
    pintarAvanceFase(visual, producido);
  }

  function pintarAvanceFase(visual, producido) {
    const actual = document.querySelector('#fases li.actual');
    const avance = avanceDeFase(producido);
    if (actual && visual === 'marcha' && avance != null) actual.style.setProperty('--avance', limitar(avance, 0, 100).toFixed(1));
  }

  function textoPieT2(ajustes) {
    const calefactor = estado.salidas.RES ? `encendido al ${formatearDecimal(estado.consignas.potenciaPct)} %` : 'apagado';
    switch (ajustes.modoRegulacion) {
      case 'onoff': return `Consigna ${ajustes.consignaT2C} °C ± ${ajustes.histeresisT2C} °C. Calefactor ${calefactor}.`;
      case 'T2': return `Consigna ${ajustes.consignaT2C} °C. Calefactor ${calefactor}.`;
      case 'cascada': return secuencia.consignaT2Activa != null ? `Consigna calculada ${formatearDecimal(secuencia.consignaT2Activa)} °C. Calefactor ${calefactor}.` : `Calefactor ${calefactor}.`;
      case 'manual': return `Potencia fija. Calefactor ${calefactor}.`;
      default: return `Calefactor ${calefactor}.`;
    }
  }

  const ESCALA_TERMOMETRO = 80;   // de 20 a 100 °C
  function fraccionTermometro(temperatura) {
    return limitar((temperatura - 20) / ESCALA_TERMOMETRO, 0, 1) * 100;
  }

  function pintarTermometro(id, valor, marca, pie) {
    $(`k-${id}`).innerHTML = `${formatearDecimal(valor)}<small>°C</small>`;
    $(`r-${id}`).style.width = `${fraccionTermometro(valor)}%`;
    const marcador = $(`m-${id}`);
    if (marcador) {
      marcador.hidden = marca == null;
      if (marca != null) marcador.style.left = `${fraccionTermometro(marca)}%`;
    }
    if (pie != null) $(`p-${id}`).textContent = pie;
  }

  function marcaT2(ajustes) {
    if (ajustes.modoRegulacion === 'cascada') return secuencia.consignaT2Activa;
    return ['T2', 'onoff'].includes(ajustes.modoRegulacion) ? ajustes.consignaT2C : null;
  }

  function consignasGrafica() {
    return { t1: secuencia.ajustes.consignaT1C, t2: marcaT2(secuencia.ajustes) };
  }

  function pintarTermometros(observaciones) {
    const ajustes = secuencia.ajustes;
    pintarTermometro('t1', observaciones.T1, ajustes.consignaT1C,
      `Consigna ${ajustes.consignaT1C} °C. Por debajo de ${ajustes.consignaT1C - ajustes.toleranciaDesvioC} °C el producto se desvía.`);
    pintarTermometro('t2', observaciones.T2, marcaT2(ajustes), textoPieT2(ajustes));
    pintarTermometro('t3', observaciones.T3, null, null);
  }

  function pintarProducto() {
    const producido = producidoEnSecuencia();
    const referencia = secuencia.ajustes.volumenObjetivoMl;
    $('k-final').innerHTML = `${formatearEntero(producido)} <small>ml</small>`;
    $('barra-ref').hidden = referencia == null;
    if (referencia != null) $('r-ref').style.width = `${limitar(producido / referencia * 100, 0, 100)}%`;
    $('p-ref').textContent = referencia != null ? `${formatearEntero(producido)} de ${formatearEntero(referencia)} ml de referencia`
      : 'Sin referencia: produce hasta agotar el tanque de origen.';
    $('k-desv').textContent = `${formatearEntero(estado.desviadoMl)} ml`;
    $('k-total').textContent = `${formatearEntero(estado.finalMl + estado.desviadoMl)} ml`;
    $('k-sol1').textContent = estado.salidas.SOL1 ? 'Desvío activo' : 'Salida normal';
  }

  function pintarTanques() {
    for (const [sufijo, ml] of [['a', estado.depositoAMl], ['b', estado.depositoBMl]]) {
      const porcentaje = ml / FISICA.capacidadDepositoMl * 100;
      $(`k-t${sufijo}`).textContent = `${formatearEntero(ml)} ml (${Math.round(porcentaje)} %)`;
      $(`r-t${sufijo}`).style.width = `${porcentaje}%`;
    }
  }

  function pintarDepositos() {
    for (const deposito of ['A', 'B']) {
      const campo = $(`llen-${deposito}`);
      if (document.activeElement !== campo) campo.value = String(redondeoPct(deposito));
      $(`ollen-${deposito}`).textContent = `${redondeoPct(deposito)} %`;
    }
    if (demo) pintarDepositoDemostracion();
  }

  function pintarDepositoDemostracion() {
    const campo = $('llen-demo');
    const origen = $('cfg-origen').value;
    if (document.activeElement !== campo) campo.value = String(redondeoPct(origen));
    $('ollen-demo').textContent = `${redondeoPct(origen)} %`;
  }

  function pintarAlarma() {
    $('alarma-caja').hidden = !secuencia.alarma;
    if (!secuencia.alarma) return;
    $('alarma-causa').textContent = secuencia.alarma.causa;
    $('alarma-accion').textContent = `Acción correctiva: ${secuencia.alarma.accion}`;
  }

  function pintarBotones() {
    const fin = ['reposo', 'finalizada'].includes(secuencia.fase);
    const enAlarma = secuencia.fase === 'alarma';
    $('b-iniciar').disabled = !fin;
    $('b-pausa').disabled = fin || enAlarma;
    $('b-pausa').textContent = ejecutando || fin || enAlarma ? 'Ⅱ Pausar' : '▶ Reanudar';
    $('b-parar').disabled = fin || enAlarma || secuencia.fase === 'parada';
    $('b-saltar').disabled = !ORDEN_SALTO.includes(secuencia.fase);
    $('b-terminar').disabled = secuencia.fase !== 'produccion';
    $('b-emergencia').disabled = secuencia.fase === 'reposo';
    $('b-reconocer').disabled = !enAlarma;
    bloquearAjustes(!fin);
    for (const deposito of ['A', 'B']) $(`llen-${deposito}`).disabled = !fin;
    if (demo) $('llen-demo').disabled = !fin;
  }

  function pintarEtiquetas() {
    const fin = ['reposo', 'finalizada'].includes(secuencia.fase);
    const enAlarma = secuencia.fase === 'alarma';
    const clase = enAlarma ? 'error' : secuencia.fase === 'finalizada' || ejecutando ? 'ok' : 'aviso';
    ponerEtiqueta('chip-fase', clase, `Fase: ${CONTROL.NOMBRES_FASE[secuencia.fase]}${ejecutando || fin || enAlarma ? '' : ' (en pausa)'}`);
    ponerEtiqueta('chip-tiempo', 'ok', `Simulado ${formatearTiempo(estado.tiempo)} · ${velocidad}×`);
    const sinProducto = estado.vacio && secuencia.fase !== 'lavado';
    const claseIo = estado.temperaturaCorte || sinProducto ? 'error' : 'ok';
    const textoIo = estado.temperaturaCorte ? 'Corte térmico simulado' : sinProducto ? 'Sin producto en origen' : 'E/S virtuales';
    ponerEtiqueta('chip-io', claseIo, textoIo);
  }

  function pintarPanel() {
    const observaciones = planta.observaciones(estado);
    esquemaScada.actualizar(estado);
    const visual = estadoVisual();
    document.body.dataset.estado = visual;
    pintarPistaFases(visual);
    pintarTermometros(observaciones);
    pintarProducto();
    pintarTanques();
    pintarDepositos();
    pintarAlarma();
    pintarBotones();
    pintarEtiquetas();
    grafica.muestrear(estado, consignasGrafica());
  }

  /* ---------- montaje ---------- */
  function montarEsquema() {
    const canvas = esquema.crearCanvasPct23();
    esquemaScada = new ScadaWidget('esquema', canvas);
    esquemaScada.anadirObjetos(esquema.crearObjetosPct23(canvas));
  }

  function configurarAjustes() {
    $('cfg-ref').addEventListener('input', () => { refTodo = Number($('cfg-ref').value) >= Number($('cfg-ref').max); });
    for (const id of AJUSTES) $(`cfg-${id}`).addEventListener('input', () => leerConfiguracionDelPanel());
    $('cfg-origen').addEventListener('change', () => {
      if (demo) aplicarDepositoOrigen(); else vaciarDepositoNoElegido(true);
      leerConfiguracionDelPanel();
      pintarPanel();
    });
  }

  function configurarLlenado(deposito) {
    const campo = $(`llen-${deposito}`);
    campo.addEventListener('input', () => {
      estadoPlanta.ponerLlenado(estado, deposito, Number(campo.value));
      leerConfiguracionDelPanel();
      pintarPanel();
    });
    campo.addEventListener('change', () => registrar(`Llenado del tanque ${deposito}: ${campo.value} %`));
  }

  function configurarLlenadoDemostracion() {
    const campo = $('llen-demo');
    campo.addEventListener('input', () => {
      aplicarDepositoOrigen();
      leerConfiguracionDelPanel();
      pintarPanel();
    });
    campo.addEventListener('change', () => registrar(`Llenado del tanque ${$('cfg-origen').value}: ${campo.value} % (el otro, vacío)`));
  }

  function configurarBotones() {
    $('b-iniciar').addEventListener('click', iniciarSecuencia);
    $('b-pausa').addEventListener('click', alternarPausa);
    $('b-parar').addEventListener('click', () => accionSobreSecuencia(() => motor.ordenarParada(secuencia, estado)));
    $('b-terminar').addEventListener('click', () => accionSobreSecuencia(() => motor.terminarProduccion(secuencia, estado)));
    $('b-saltar').addEventListener('click', () => accionSobreSecuencia(() => motor.saltarFase(secuencia, estado)));
    $('b-emergencia').addEventListener('click', () => { ejecutando = true; accionSobreSecuencia(() => motor.emergencia(secuencia, estado)); });
    $('b-reconocer').addEventListener('click', () => { ejecutando = true; accionSobreSecuencia(() => alarmas.reconocer(secuencia, estado)); });
    $('b-reset').addEventListener('click', reiniciarPlanta);
  }

  function configurarLlenados() {
    configurarLlenado('A');
    configurarLlenado('B');
    if (demo) configurarLlenadoDemostracion();
  }

  /** esDemostracion: true en la página de demostración (solo se elige la temperatura). */
  function iniciarPanelAutomatico(esDemostracion) {
    demo = esDemostracion;
    estado = estadoPlanta.crearEstado();
    secuencia = motor.crearSecuencia(configInicial());
    montarEsquema();
    iniciarSelectorRegulacion();
    configurarAjustes();
    configurarLlenados();
    configurarBotones();
    if (demo) aplicarDepositoOrigen(); else vaciarDepositoNoElegido(false);
    grafica.ajustarLienzo();
    registrar('Sesión local: no hay conexión con equipos');
    leerConfiguracionDelPanel();
    pintarPanel();
  }

  PCT.panelAutomatico = { iniciarPanelAutomatico, alPaso, ponerVelocidad, estadoActual: () => estado };
})();
