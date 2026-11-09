(function () {
  const { $, ponerTexto, formatearEntero, formatearDecimal, formatearTiempo } = PCT.dom;
  const { ScadaWidget, lecturasDeEstado } = PCT.scadaWidget;
  const { registrarEventoEnPantalla, vaciarRegistro } = PCT.registroEventos;
  const esquema = PCT.esquemaPct23;
  const grafica = PCT.grafica;
  const estadoPlanta = PCT.estadoPlanta;
  const planta = PCT.planta;
  const CAPACIDAD_ML = PCT.constantesFisicas.CONSTANTES_FISICAS.capacidadDepositoMl;
  const ACTIVADA = ['activada', 'desactivada'];
  const ENCENDIDA = ['encendida', 'apagada'];

  const CONSIGNAS = [
    { id: 'resistencia', nombre: 'Potencia de la resistencia', campo: 'potenciaPct', texto: v => esquema.textoPotencia(v) },
    { id: 'velocidadN1', nombre: 'Velocidad (PWM)', campo: 'velocidadN1Pct', texto: v => `${v} %` },
    { id: 'velocidadN2', nombre: 'Velocidad (PWM)', campo: 'velocidadN2Pct', texto: v => `${v} %` },
  ];

  let estado = null;
  let esquemaScada = null;
  let ultimoAviso = '';

  // En modo manual la planta arranca con los dos depósitos vacíos.
  function crearEstadoManual() {
    const nuevo = estadoPlanta.crearEstado();
    nuevo.depositoAMl = 0;
    nuevo.depositoBMl = 0;
    return nuevo;
  }

  function registrar(mensaje) {
    registrarEventoEnPantalla(`[${formatearTiempo(estado.tiempo)}] ${mensaje}`);
  }

  function ponerConsigna(consigna, valor) {
    estado.consignas[consigna.campo] = PCT.matematicas.limitar(Number(valor) || 0, 0, 100);
  }

  function alternarSalida(clave, nombre, palabras) {
    estado.salidas[clave] = !estado.salidas[clave];
    registrar(`${nombre}: ${estado.salidas[clave] ? palabras[0] : palabras[1]}`);
    refrescarPantalla();
  }

  function alternarV3() {
    estado.valvulaV3 = !estado.valvulaV3;
    registrar(`V3: ${estado.valvulaV3 ? 'abierta (vacía el tanque B)' : 'cerrada'}`);
    refrescarPantalla();
  }

  function invertirGiro(bomba) {
    estado.giro[bomba] = !estado.giro[bomba];
    registrar(`Sentido de giro ${bomba}: ${Number(estado.giro[bomba])} (${bomba === 'N2' ? 'OUT05' : 'OUT06'})`);
    refrescarPantalla();
  }

  function cerrarElectrovalvulas() {
    for (const clave of ['SOL1', 'SOL2', 'SOL3', 'SOL4', 'SOL5']) estado.salidas[clave] = false;
    registrar('Electroválvulas cerradas');
    refrescarPantalla();
  }

  function pararTodoEnPlanta() {
    for (const clave of PCT.constantesFisicas.SALIDAS) estado.salidas[clave] = false;
    estado.giro.N1 = false;
    estado.giro.N2 = false;
    estado.valvulaV3 = false;
    for (const consigna of CONSIGNAS) ponerConsigna(consigna, 0);
    estado.ejecutando = false;
    registrar('Parada general: simulación en pausa; pulsa Iniciar para continuar');
    refrescarPantalla();
  }

  function cambiarMarcha(marcha, mensaje) {
    estado.ejecutando = marcha;
    registrar(mensaje);
    refrescarPantalla();
  }

  function reiniciarPlanta() {
    estado = crearEstadoManual();
    grafica.reiniciarGrafica();
    ultimoAviso = '';
    vaciarRegistro();
    registrar('Simulador reiniciado');
    refrescarPantalla();
  }

  function configurarValvulas() {
    $('cerrar-valvulas').addEventListener('click', cerrarElectrovalvulas);
  }

  function configurarDepositos() {
    for (const deposito of ['A', 'B']) {
      const deslizador = $(`llen-${deposito}`);
      deslizador.addEventListener('input', () => { estadoPlanta.ponerLlenado(estado, deposito, Number(deslizador.value)); refrescarPantalla(); });
      deslizador.addEventListener('change', () => registrar(`Llenado del tanque ${deposito}: ${deslizador.value} %`));
    }
  }

  function configurarMando() {
    $('sim-play').addEventListener('click', () => cambiarMarcha(true, 'Simulación iniciada'));
    $('sim-pause').addEventListener('click', () => cambiarMarcha(false, 'Simulación pausada'));
    $('sim-reset').addEventListener('click', reiniciarPlanta);
    const pararTodo = document.createElement('button');
    pararTodo.textContent = 'Parar todo';
    pararTodo.id = 'sim-stop-all';
    pararTodo.addEventListener('click', pararTodoEnPlanta);
    $('controles').appendChild(pararTodo);
  }

  function consignaDe(campo) {
    return CONSIGNAS.find(consigna => consigna.campo === campo);
  }

  // Deslizador del panel de controles dentro del esquema.
  function comportamientoDeslizador(campo) {
    const consigna = consignaDe(campo);
    return {
      valorDe: e => e.consignas[campo],
      alCambiar: valor => { ponerConsigna(consigna, valor); refrescarPantalla(); },
      alSoltar: () => registrar(`${consigna.nombre} (${consigna.id}): ${consigna.texto(estado.consignas[campo])}`),
    };
  }

  function textoSentido(girando) {
    return `Sentido: ${girando ? 'atrás' : 'adelante'}`;
  }

  function comportamientoGiro(bomba) {
    return {
      textoDe: e => textoSentido(e.giro[bomba]),
      alPulsar: () => invertirGiro(bomba),
    };
  }

  function comportamientoCalefactor() {
    return {
      textoDe: e => `RES: ${e.salidas.RES ? 'encendida' : 'apagada'}`,
      alPulsar: () => alternarSalida('RES', 'Calefacción', ENCENDIDA),
    };
  }

  function comportamientosControles() {
    return {
      potenciaPct: comportamientoDeslizador('potenciaPct'),
      velocidadN1Pct: comportamientoDeslizador('velocidadN1Pct'),
      velocidadN2Pct: comportamientoDeslizador('velocidadN2Pct'),
      giroN1: comportamientoGiro('N1'),
      giroN2: comportamientoGiro('N2'),
      RES: comportamientoCalefactor(),
    };
  }

  // La resistencia se pulsa en su círculo RES; el cursor indica que es un botón.
  function hacerPulsableResistencia() {
    const grupo = esquemaScada.canvas.buscar('g-PWR');
    grupo.style.cursor = 'pointer';
    grupo.setAttribute('role', 'button');
    esquemaScada.alPulsar('g-PWR', () => alternarSalida('RES', 'Calefacción', ENCENDIDA));
  }

  function montarEsquema() {
    const canvas = esquema.crearCanvasPct23();
    esquemaScada = new ScadaWidget('esquema', canvas);
    esquemaScada.anadirObjetos(esquema.crearObjetosPct23(canvas));
    esquemaScada.anadirObjetos(esquema.crearControlesPct23(canvas, comportamientosControles()));
    for (const clave of ['SOL1', 'SOL2', 'SOL3', 'SOL4', 'SOL5', 'N1', 'N2']) {
      esquemaScada.alPulsar(`g-${clave}`, () => alternarSalida(clave, clave, ACTIVADA));
    }
    esquemaScada.alPulsar('g-V3', alternarV3);
    hacerPulsableResistencia();
  }

  function ponerChip(id, clase, texto) {
    $(id).className = `chip ${clase}`;
    $(id).lastElementChild.textContent = texto;
  }

  function textoEntradasSalidas(e) {
    if (e.temperaturaCorte) return 'Corte térmico simulado';
    if (e.vacio) return 'Sin producto en origen';
    return 'E/S virtuales';
  }

  function refrescarChips() {
    ponerChip('chip-broker', 'ok', 'Sin MQTT · modo local');
    ponerChip('chip-gateway', estado.ejecutando ? 'ok' : 'aviso', estado.ejecutando ? `Simulando · ${estado.velocidad}×` : 'Simulación en pausa');
    ponerChip('chip-io', estado.temperaturaCorte || estado.vacio ? 'error' : 'ok', textoEntradasSalidas(estado));
  }

  function textoFlotadores(lecturas) {
    if (lecturas.HL) return 'HL activo';
    return lecturas.LL ? 'LL activo' : 'entre LL y HL';
  }

  function textoDetalleDeposito(deposito, pct, lecturas) {
    const ml = deposito === 'B' ? estado.depositoBMl : estado.depositoAMl;
    const base = `${formatearEntero(ml)} ml de ${CAPACIDAD_ML}`;
    if (deposito === 'A') return `${base} · L1 = ${formatearEntero(pct * 2.5)} mm`;
    return `${base} · ${textoFlotadores(lecturas)}`;
  }

  function refrescarDepositos() {
    const lecturas = lecturasDeEstado(estado);
    for (const deposito of ['A', 'B']) {
      const deslizador = $(`llen-${deposito}`);
      const pct = estadoPlanta.porcentajeLlenado(estado, deposito);
      deslizador.disabled = estado.ejecutando;
      if (document.activeElement !== deslizador) deslizador.value = String(Math.round(pct));
      ponerTexto(`ollen-${deposito}`, `${Math.round(pct)} %`);
      ponerTexto(`dllen-${deposito}`, textoDetalleDeposito(deposito, pct, lecturas));
    }
  }

  function refrescarDatos() {
    const lecturas = lecturasDeEstado(estado);
    ponerTexto('sim-time', formatearTiempo(estado.tiempo));
    ponerTexto('sim-flow', `${formatearEntero(lecturas.F1)} ml/min`);
    ponerTexto('sim-heat', `${formatearDecimal(lecturas.T2)} °C`);
    ponerTexto('sim-A', `${formatearEntero(estado.depositoAMl)} ml`);
    ponerTexto('sim-B', `${formatearEntero(estado.depositoBMl)} ml`);
    ponerTexto('sim-finished', `${formatearEntero(estado.finalMl)} ml`);
    ponerTexto('sim-diverted', `${formatearEntero(estado.desviadoMl)} ml`);
    ponerTexto('sim-drain', `${formatearDecimal(estado.desagueMl / 1000)} L`);
    $('sim-play').disabled = estado.ejecutando;
    $('sim-pause').disabled = !estado.ejecutando;
    $('sim-velocidad').value = String(estado.velocidad);
  }

  function textoAviso(e) {
    if (e.temperaturaCorte) return 'Corte térmico simulado: resistencia desconectada. Se rearma por debajo de 60 °C; después vuelve a conectarla.';
    if (e.vacio) return 'Depósito seleccionado vacío: la bomba N1 no suministra producto.';
    if (e.salidas.N1 && e.giro.N1) return 'N1 encendida con el sentido de giro invertido (OUT06 = 1). El flujo inverso no se simula.';
    if (e.salidas.N1 && e.consignas.velocidadN1Pct === 0) return 'N1 encendida, pero la consigna de velocidad es 0 %.';
    if (e.salidas.N1 && !e.salidas.N2) return 'N1 circula sin N2: el producto no recibe calentamiento activo significativo.';
    if (e.salidas.N1 && !e.salidas.SOL3) return 'Producto circulando sin refrigeración activa (SOL3 cerrada).';
    if (e.ejecutando) return `Proceso en marcha. Alimentación desde tanque ${e.salidas.SOL2 ? 'B' : 'A'}; salida ${e.salidas.SOL1 ? 'desviada' : 'producto final'}.`;
    return 'Simulación pausada. Puedes modificar los actuadores y luego reanudar.';
  }

  function refrescarAviso() {
    const aviso = textoAviso(estado);
    ponerTexto('sim-status', aviso);
    if (aviso !== ultimoAviso && (estado.temperaturaCorte || estado.vacio)) registrar(aviso);
    ultimoAviso = aviso;
  }

  function refrescarPantalla() {
    esquemaScada.actualizar(estado);
    refrescarDepositos();
    refrescarChips();
    refrescarDatos();
    refrescarAviso();
    grafica.muestrear(estado);
  }

  function alPaso() {
    if (!estado.ejecutando) return;
    planta.avanzar(estado, 0.25 * estado.velocidad);
    refrescarPantalla();
  }

  function ponerVelocidad(velocidad) {
    estado.velocidad = velocidad;
    registrar(`Velocidad de simulación: ${velocidad}×`);
    refrescarPantalla();
  }

  function iniciarPanelManual(estadoInicial) {
    estado = estadoInicial;
    montarEsquema();
    configurarValvulas();
    configurarDepositos();
    configurarMando();
    grafica.ajustarLienzo();
    registrar('Sesión local cargada: no hay conexión con máquinas');
    refrescarPantalla();
  }

  PCT.panelManual = { crearEstadoManual, iniciarPanelManual, alPaso, ponerVelocidad, estadoActual: () => estado };
})();
