(function () {
  const { $, formatearTiempo } = PCT.dom;
  const planta = PCT.planta;
  const LIMITE_MUESTRAS = 140;
  const INTERVALO_S = 2;
  const CURVAS = [['T2', '#d66d2b'], ['T1', '#2d80c7'], ['T3', '#22a2a0']];
  const historial = [];
  let ultimoTiempo = -1;
  const COMPLETO = { minimo: 15, maximo: 100, marcas: [20, 40, 60, 80, 100] };
  let marcasConsigna = null;
  let serieActiva = null;
  let rango = COMPLETO;

  function colorCss(nombre, defecto) {
    return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim() || defecto;
  }

  function escala(w, h) {
    const izquierda = 48, derecha = w - 17, arriba = 15, abajo = h - 28;
    const y = v => abajo - (Math.max(rango.minimo, Math.min(rango.maximo, v)) - rango.minimo) / (rango.maximo - rango.minimo) * (abajo - arriba);
    return { izquierda, derecha, arriba, abajo, y };
  }

  function dibujarRejilla(contexto, w, h) {
    const e = escala(w, h);
    contexto.font = '12px system-ui,sans-serif';
    contexto.textBaseline = 'middle';
    contexto.lineWidth = 1;
    for (const t of rango.marcas) {
      contexto.beginPath();
      contexto.moveTo(e.izquierda, e.y(t));
      contexto.lineTo(e.derecha, e.y(t));
      contexto.strokeStyle = colorCss('--borde', '#dde1e6');
      contexto.stroke();
      contexto.fillStyle = colorCss('--tenue', '#6b7380');
      contexto.fillText(t + '°', 10, e.y(t));
    }
  }

  // Consignas en discontinua: T1 (gris) y, si el modo la usa, la de T2 (naranja).
  function dibujarRaya(contexto, e, valor, color) {
    contexto.setLineDash([6, 5]);
    contexto.beginPath();
    contexto.moveTo(e.izquierda, e.y(valor));
    contexto.lineTo(e.derecha, e.y(valor));
    contexto.strokeStyle = color;
    contexto.lineWidth = 1.5;
    contexto.stroke();
    contexto.setLineDash([]);
  }

  function dibujarConsignas(contexto, w, h) {
    if (!marcasConsigna) return;
    const e = escala(w, h);
    if (!serieActiva || serieActiva === 'T1') dibujarRaya(contexto, e, marcasConsigna.t1, '#8e8e8e');
    if (marcasConsigna.t2 != null && (!serieActiva || serieActiva === 'T2')) dibujarRaya(contexto, e, marcasConsigna.t2, '#d66d2b');
  }

  function dibujarCurva(contexto, campo, color, x, y) {
    contexto.beginPath();
    historial.forEach((v, i) => {
      if (i === 0) contexto.moveTo(x(v.tiempo), y(v[campo]));
      else contexto.lineTo(x(v.tiempo), y(v[campo]));
    });
    contexto.strokeStyle = color;
    contexto.lineWidth = 2.5;
    contexto.stroke();
  }

  function rotularTiempos(contexto, e, inicio, final) {
    contexto.fillStyle = colorCss('--tenue', '#6b7380');
    contexto.textBaseline = 'bottom';
    contexto.fillText(formatearTiempo(inicio), e.izquierda, e.abajo + 22);
    const hasta = formatearTiempo(final);
    contexto.fillText(hasta, e.derecha - contexto.measureText(hasta).width, e.abajo + 22);
  }

  function dibujarCurvas(contexto, w, h) {
    const e = escala(w, h);
    const inicio = historial[0].tiempo, final = historial[historial.length - 1].tiempo;
    const x = t => e.izquierda + (t - inicio) / Math.max(1, final - inicio) * (e.derecha - e.izquierda);
    for (const [campo, color] of CURVAS) if (!serieActiva || serieActiva === campo) dibujarCurva(contexto, campo, color, x, e.y);
    rotularTiempos(contexto, e, inicio, final);
  }

  function consignaDe(campo) {
    if (!marcasConsigna) return null;
    return campo === 'T1' ? marcasConsigna.t1 : campo === 'T2' ? marcasConsigna.t2 : null;
  }

  function calcularRango() {
    if (!serieActiva) return COMPLETO;
    const valores = historial.map(v => v[serieActiva]);
    const consigna = consignaDe(serieActiva);
    if (consigna != null) valores.push(consigna);
    return PCT.escalaGrafica.rangoLimpio(valores, 2, { minimo: 0, maximo: 120 }) || COMPLETO;
  }

  function pintarGrafica() {
    rango = calcularRango();
    const canvas = $('sim-trend');
    const contexto = canvas.getContext('2d');
    if (!contexto) return;
    contexto.clearRect(0, 0, canvas.width, canvas.height);
    dibujarRejilla(contexto, canvas.width, canvas.height);
    dibujarConsignas(contexto, canvas.width, canvas.height);
    if (historial.length >= 1) dibujarCurvas(contexto, canvas.width, canvas.height);
    if (PCT.graficaActivaciones) PCT.graficaActivaciones.pintar();
  }

  // El lienzo se dibuja al tamaño con que se ve (así el texto no se deforma).
  function ajustarLienzoDe(lienzo, pintar) {
    const w = Math.round(lienzo.clientWidth), h = Math.round(lienzo.clientHeight);
    if (!w || (lienzo.width === w && lienzo.height === h)) return;
    lienzo.width = w;
    lienzo.height = h;
    pintar();
  }

  function ajustarLienzo() {
    ajustarLienzoDe($('sim-trend'), pintarGrafica);
    const activaciones = PCT.graficaActivaciones;
    if (activaciones) ajustarLienzoDe($('sim-activaciones'), activaciones.pintar);
  }

  // marcas: { t1, t2 } consignas a dibujar; sin marcas (manual) no se dibuja ninguna.
  function muestrear(estado, marcas) {
    marcasConsigna = marcas || null;
    const t = estado.tiempo;
    if (t - ultimoTiempo < INTERVALO_S && historial.length) { pintarGrafica(); return; }
    const o = planta.observaciones(estado);
    historial.push({ tiempo: t, T1: o.T1, T2: o.T2, T3: o.T3 });
    if (historial.length > LIMITE_MUESTRAS) historial.shift();
    ultimoTiempo = t;
    if (PCT.graficaActivaciones) PCT.graficaActivaciones.registrar(estado);
    pintarGrafica();
  }

  function reiniciarGrafica() {
    historial.length = 0;
    ultimoTiempo = -1;
    if (PCT.graficaActivaciones) PCT.graficaActivaciones.reiniciar();
  }

  // Leyenda de botones: uno por serie más «Todas»; pulsar de nuevo la serie activa vuelve a todas.
  function crearLeyenda(contenedor, items, alElegir) {
    let activa = null;
    const botones = [{ id: null, texto: 'Todas' }, ...items].map(item => {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'ley-boton';
      boton.innerHTML = item.color ? `<i style="background:${item.color}"></i>${item.texto}` : item.texto;
      boton.addEventListener('click', () => marcar(item.id !== null && item.id === activa ? null : item.id, true));
      contenedor.appendChild(boton);
      return [item.id, boton];
    });
    function marcar(id, avisar) {
      activa = id;
      botones.forEach(([clave, boton]) => boton.setAttribute('aria-pressed', String(clave === id)));
      if (avisar) alElegir(id);
    }
    marcar(null, false);
    return { marcar };
  }

  function iniciarLeyenda() {
    const contenedor = $('leyenda-temp');
    if (!contenedor) return;
    const items = [['T2', 'T2 · agua caliente'], ['T1', 'T1 · salida del tubo'], ['T3', 'T3 · producto final']]
      .map(([id, texto]) => ({ id, texto, color: CURVAS.find(c => c[0] === id)[1] }));
    crearLeyenda(contenedor, items, id => { serieActiva = id; pintarGrafica(); });
  }

  iniciarLeyenda();
  window.addEventListener('resize', ajustarLienzo);
  PCT.grafica = { muestrear, pintarGrafica, ajustarLienzo, reiniciarGrafica, colorCss, rotularTiempos, crearLeyenda, ventana: () => historial };
})();
