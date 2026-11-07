(function () {
  const PISTAS_DIGITALES = [
    ['N1', '#2d80c7'], ['N2', '#2d80c7'],
    ['SOL1', '#22a2a0'], ['SOL2', '#22a2a0'], ['SOL3', '#22a2a0'], ['SOL4', '#22a2a0'], ['SOL5', '#22a2a0'],
  ];
  const COLOR_RESISTENCIA = '#d66d2b';
  const RANGO_POTENCIA = { minimo: 0, maximo: 100, marcas: [0, 50, 100] };
  const ALTO_POTENCIA = 74, ALTO_PISTA = 20, SEPARACION = 8;
  const LIMITE_MUESTRAS = 140;
  const ALTO_SOLO = 208;
  const historial = [];
  let seleccion = null;

  // La potencia efectiva es la consigna solo si la resistencia está conectada.
  function tomarMuestra(estado) {
    const muestra = { tiempo: estado.tiempo, RES: estado.salidas.RES ? estado.consignas.potenciaPct : 0 };
    for (const [id] of PISTAS_DIGITALES) muestra[id] = Boolean(estado.salidas[id]);
    return muestra;
  }

  function registrar(estado) {
    historial.push(tomarMuestra(estado));
    if (historial.length > LIMITE_MUESTRAS) historial.shift();
  }

  function reiniciar() { historial.length = 0; }

  function geometria(w) {
    return { izquierda: 48, derecha: w - 17, arriba: 8 };
  }

  function crearEjeX(g, ventana) {
    const inicio = ventana[0].tiempo, final = ventana[ventana.length - 1].tiempo;
    return t => g.izquierda + (t - inicio) / Math.max(1, final - inicio) * (g.derecha - g.izquierda);
  }

  function rotular(contexto, texto, y, color, x = 6) {
    contexto.fillStyle = color;
    contexto.textBaseline = 'middle';
    contexto.fillText(texto, x, y);
  }

  function pintarPotencia(contexto, g, x, tenue, borde, alto = ALTO_POTENCIA, rango = RANGO_POTENCIA) {
    const base = g.arriba + alto;
    const y = v => base - (v - rango.minimo) / (rango.maximo - rango.minimo) * alto;
    for (const v of rango.marcas) {
      contexto.beginPath(); contexto.moveTo(g.izquierda, y(v)); contexto.lineTo(g.derecha, y(v));
      contexto.strokeStyle = borde; contexto.lineWidth = 1; contexto.stroke();
      contexto.fillStyle = tenue; contexto.textBaseline = 'middle'; contexto.textAlign = 'right'; contexto.fillText(v, g.izquierda - 6, y(v)); contexto.textAlign = 'left';
    }
    contexto.fillStyle = COLOR_RESISTENCIA; contexto.fillText('RES', 2, base - alto / 2);
    contexto.beginPath(); contexto.moveTo(x(historial[0].tiempo), base);
    historial.forEach((m, i) => {
      contexto.lineTo(x(m.tiempo), y(i ? historial[i - 1].RES : m.RES));
      contexto.lineTo(x(m.tiempo), y(m.RES));
    });
    contexto.lineTo(x(historial[historial.length - 1].tiempo), base); contexto.closePath();
    contexto.globalAlpha = 0.28; contexto.fillStyle = COLOR_RESISTENCIA; contexto.fill(); contexto.globalAlpha = 1;
    contexto.strokeStyle = COLOR_RESISTENCIA; contexto.lineWidth = 2; contexto.stroke();
  }

  function pintarPista(contexto, g, x, id, color, arriba, borde, altoPista = ALTO_PISTA) {
    const base = arriba + altoPista - 4, alto = arriba + 4;
    contexto.beginPath(); contexto.moveTo(g.izquierda, base + 2); contexto.lineTo(g.derecha, base + 2);
    contexto.strokeStyle = borde; contexto.lineWidth = 1; contexto.stroke();
    contexto.beginPath();
    historial.forEach((m, i) => {
      const nivel = m[id] ? alto : base;
      if (i === 0) contexto.moveTo(x(m.tiempo), nivel);
      else { contexto.lineTo(x(m.tiempo), historial[i - 1][id] ? alto : base); contexto.lineTo(x(m.tiempo), nivel); }
    });
    contexto.strokeStyle = color; contexto.lineWidth = 2; contexto.stroke();
  }

  function pintar() {
    const canvas = document.getElementById('sim-activaciones');
    const contexto = canvas && canvas.getContext('2d');
    if (!contexto) return;
    const utiles = PCT.grafica;
    contexto.clearRect(0, 0, canvas.width, canvas.height);
    if (!historial.length) return;
    const tenue = utiles.colorCss('--tenue', '#6b7380'), borde = utiles.colorCss('--borde', '#dde1e6');
    const g = geometria(canvas.width), x = crearEjeX(g, historial);
    contexto.font = '12px system-ui,sans-serif';
    if (seleccion) pintarSola(contexto, g, x, tenue, borde);
    else pintarTodas(contexto, g, x, tenue, borde);
  }

  function pintarSola(contexto, g, x, tenue, borde) {
    if (seleccion === 'RES') {
      const rango = PCT.escalaGrafica.rangoLimpio(historial.map(m => m.RES), 5, { minimo: 0, maximo: 100 });
      pintarPotencia(contexto, g, x, tenue, borde, ALTO_SOLO, rango);
    } else {
      const color = PISTAS_DIGITALES.find(p => p[0] === seleccion)[1];
      rotular(contexto, seleccion, g.arriba + ALTO_SOLO / 2, tenue, 4);
      pintarPista(contexto, g, x, seleccion, color, g.arriba, borde, ALTO_SOLO);
      contexto.textAlign = 'right';
      rotular(contexto, 'ON', g.arriba + 4, tenue, g.izquierda - 6);
      rotular(contexto, 'OFF', g.arriba + ALTO_SOLO - 4, tenue, g.izquierda - 6);
      contexto.textAlign = 'left';
    }
    rotularEje(contexto, g, g.arriba + ALTO_SOLO + SEPARACION + 2);
  }

  function pintarTodas(contexto, g, x, tenue, borde) {
    pintarPotencia(contexto, g, x, tenue, borde);
    let arriba = g.arriba + ALTO_POTENCIA + SEPARACION;
    for (const [id, color] of PISTAS_DIGITALES) {
      rotular(contexto, id, arriba + ALTO_PISTA / 2 - 2, tenue);
      pintarPista(contexto, g, x, id, color, arriba, borde);
      arriba += ALTO_PISTA;
    }
    rotularEje(contexto, g, arriba - 4);
  }

  function rotularEje(contexto, g, abajo) {
    PCT.grafica.rotularTiempos(contexto, { izquierda: g.izquierda, derecha: g.derecha, abajo }, historial[0].tiempo, historial[historial.length - 1].tiempo);
  }

  function iniciarLeyenda() {
    const contenedor = document.getElementById('leyenda-act');
    if (!contenedor) return;
    const items = [{ id: 'RES', texto: 'RES · potencia', color: COLOR_RESISTENCIA },
      ...PISTAS_DIGITALES.map(([id, color]) => ({ id, texto: id, color }))];
    PCT.grafica.crearLeyenda(contenedor, items, id => { seleccion = id; pintar(); });
  }

  const api = { tomarMuestra, registrar, reiniciar, pintar, ventana: () => historial };
  if (typeof module !== 'undefined') module.exports = api;
  else { PCT.graficaActivaciones = api; iniciarLeyenda(); }
})();
