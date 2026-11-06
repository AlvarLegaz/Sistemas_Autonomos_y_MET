(function () {
  const { $, formatearTiempo } = PCT.dom;
  const planta = PCT.planta;
  const LIMITE_MUESTRAS = 140;
  const INTERVALO_S = 2;
  const CURVAS = [['T2', '#d66d2b'], ['T1', '#2d80c7'], ['T3', '#22a2a0']];
  const historial = [];
  let ultimoTiempo = -1;
  let marcasConsigna = null;

  function colorCss(nombre, defecto) {
    return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim() || defecto;
  }

  function escala(w, h) {
    const izquierda = 48, derecha = w - 17, arriba = 15, abajo = h - 28;
    const y = v => abajo - (Math.max(15, Math.min(100, v)) - 15) / (100 - 15) * (abajo - arriba);
    return { izquierda, derecha, arriba, abajo, y };
  }

  function dibujarRejilla(contexto, w, h) {
    const e = escala(w, h);
    contexto.font = '12px system-ui,sans-serif';
    contexto.textBaseline = 'middle';
    contexto.lineWidth = 1;
    for (const t of [20, 40, 60, 80, 100]) {
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
    dibujarRaya(contexto, e, marcasConsigna.t1, '#8e8e8e');
    if (marcasConsigna.t2 != null) dibujarRaya(contexto, e, marcasConsigna.t2, '#d66d2b');
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
    for (const [campo, color] of CURVAS) dibujarCurva(contexto, campo, color, x, e.y);
    rotularTiempos(contexto, e, inicio, final);
  }

  function pintarGrafica() {
    const canvas = $('sim-trend');
    const contexto = canvas.getContext('2d');
    if (!contexto) return;
    contexto.clearRect(0, 0, canvas.width, canvas.height);
    dibujarRejilla(contexto, canvas.width, canvas.height);
    dibujarConsignas(contexto, canvas.width, canvas.height);
    if (historial.length >= 1) dibujarCurvas(contexto, canvas.width, canvas.height);
  }

  // El lienzo se dibuja al tamaño con que se ve (así el texto no se deforma).
  function ajustarLienzo() {
    const lienzoGrafica = $('sim-trend');
    const w = Math.round(lienzoGrafica.clientWidth), h = Math.round(lienzoGrafica.clientHeight);
    if (!w || (lienzoGrafica.width === w && lienzoGrafica.height === h)) return;
    lienzoGrafica.width = w;
    lienzoGrafica.height = h;
    pintarGrafica();
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
    pintarGrafica();
  }

  function reiniciarGrafica() {
    historial.length = 0;
    ultimoTiempo = -1;
  }

  window.addEventListener('resize', ajustarLienzo);
  PCT.grafica = { muestrear, pintarGrafica, ajustarLienzo, reiniciarGrafica };
})();
