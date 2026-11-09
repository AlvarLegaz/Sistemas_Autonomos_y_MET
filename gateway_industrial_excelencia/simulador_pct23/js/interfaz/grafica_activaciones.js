(function () {
  // Series en porcentaje: potencia de la resistencia y velocidad de las bombas (0 % si están apagadas).
  const SERIES_PORCENTAJE = [
    { id: 'RES', texto: 'RES · potencia', color: '#d66d2b' },
    { id: 'N1', texto: 'N1 · velocidad', color: '#2d80c7' },
    { id: 'N2', texto: 'N2 · velocidad', color: '#c04f9a' },
  ];
  const PISTAS_DIGITALES = [
    ['SOL1', '#22a2a0'], ['SOL2', '#22a2a0'], ['SOL3', '#22a2a0'], ['SOL4', '#22a2a0'], ['SOL5', '#22a2a0'],
  ];
  const RANGO_PORCENTAJE = { minimo: 0, maximo: 100, marcas: [0, 50, 100] };
  const ALTO_PORCENTAJE = 74, ALTO_PISTA = 20, SEPARACION = 8;
  const LIMITE_MUESTRAS = 3600;
  const ALTO_SOLO = 208;
  const historial = [];
  let visibles = [];   // la parte del historial que cae dentro de la base de tiempos elegida
  let seleccion = null;

  // Cada serie vale su porcentaje solo si el actuador está conectado; apagado vale 0.
  function tomarMuestra(estado) {
    const s = estado.salidas, c = estado.consignas;
    const muestra = {
      tiempo: estado.tiempo,
      RES: s.RES ? c.potenciaPct : 0,
      N1: s.N1 ? c.velocidadN1Pct : 0,
      N2: s.N2 ? c.velocidadN2Pct : 0,
    };
    for (const [id] of PISTAS_DIGITALES) muestra[id] = Boolean(s[id]);
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

  // unir = true continúa el trazo actual (para cerrar un relleno); false empieza uno nuevo.
  function trazarEscalon(contexto, campo, x, y, unir = false) {
    visibles.forEach((m, i) => {
      if (i === 0) contexto[unir ? 'lineTo' : 'moveTo'](x(m.tiempo), y(m[campo]));
      else { contexto.lineTo(x(m.tiempo), y(visibles[i - 1][campo])); contexto.lineTo(x(m.tiempo), y(m[campo])); }
    });
  }

  function dibujarSerie(contexto, serie, x, y, base, rellenar) {
    contexto.beginPath();
    trazarEscalon(contexto, serie.id, x, y);
    contexto.strokeStyle = serie.color; contexto.lineWidth = 2; contexto.stroke();
    if (!rellenar) return;
    contexto.beginPath(); contexto.moveTo(x(visibles[0].tiempo), base);
    trazarEscalon(contexto, serie.id, x, y, true);
    contexto.lineTo(x(visibles[visibles.length - 1].tiempo), base); contexto.closePath();
    contexto.globalAlpha = 0.28; contexto.fillStyle = serie.color; contexto.fill(); contexto.globalAlpha = 1;
  }

  // Panel de porcentajes: una serie sola (con relleno) o las tres a la vez.
  function pintarPorcentajes(contexto, g, x, tenue, borde, series, alto = ALTO_PORCENTAJE, rango = RANGO_PORCENTAJE) {
    const base = g.arriba + alto;
    const y = v => base - (v - rango.minimo) / (rango.maximo - rango.minimo) * alto;
    for (const v of rango.marcas) {
      contexto.beginPath(); contexto.moveTo(g.izquierda, y(v)); contexto.lineTo(g.derecha, y(v));
      contexto.strokeStyle = borde; contexto.lineWidth = 1; contexto.stroke();
      contexto.fillStyle = tenue; contexto.textBaseline = 'middle'; contexto.textAlign = 'right'; contexto.fillText(v, g.izquierda - 6, y(v)); contexto.textAlign = 'left';
    }
    series.forEach((serie, i) => {
      contexto.fillStyle = serie.color;
      contexto.fillText(serie.id, 2, base - alto * (series.length === 1 ? 0.5 : 0.8 - i * 0.3));
    });
    series.forEach(serie => dibujarSerie(contexto, serie, x, y, base, series.length === 1 || serie.id === 'RES'));
  }

  function pintarPista(contexto, g, x, id, color, arriba, borde, altoPista = ALTO_PISTA) {
    const base = arriba + altoPista - 4, alto = arriba + 4;
    contexto.beginPath(); contexto.moveTo(g.izquierda, base + 2); contexto.lineTo(g.derecha, base + 2);
    contexto.strokeStyle = borde; contexto.lineWidth = 1; contexto.stroke();
    contexto.beginPath();
    visibles.forEach((m, i) => {
      const nivel = m[id] ? alto : base;
      if (i === 0) contexto.moveTo(x(m.tiempo), nivel);
      else { contexto.lineTo(x(m.tiempo), visibles[i - 1][id] ? alto : base); contexto.lineTo(x(m.tiempo), nivel); }
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
    visibles = PCT.escalaGrafica.recortarVentana(historial, utiles.baseDeTiempo());
    const tenue = utiles.colorCss('--tenue', '#6b7380'), borde = utiles.colorCss('--borde', '#dde1e6');
    const g = geometria(canvas.width), x = crearEjeX(g, visibles);
    contexto.font = '12px system-ui,sans-serif';
    if (seleccion) pintarSola(contexto, g, x, tenue, borde);
    else pintarTodas(contexto, g, x, tenue, borde);
  }

  function pintarSola(contexto, g, x, tenue, borde) {
    const serie = SERIES_PORCENTAJE.find(s => s.id === seleccion);
    if (serie) {
      const rango = PCT.escalaGrafica.rangoLimpio(visibles.map(m => m[serie.id]), 5, { minimo: 0, maximo: 100 });
      pintarPorcentajes(contexto, g, x, tenue, borde, [serie], ALTO_SOLO, rango);
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
    pintarPorcentajes(contexto, g, x, tenue, borde, SERIES_PORCENTAJE);
    let arriba = g.arriba + ALTO_PORCENTAJE + SEPARACION;
    for (const [id, color] of PISTAS_DIGITALES) {
      rotular(contexto, id, arriba + ALTO_PISTA / 2 - 2, tenue);
      pintarPista(contexto, g, x, id, color, arriba, borde);
      arriba += ALTO_PISTA;
    }
    rotularEje(contexto, g, arriba - 4);
  }

  function rotularEje(contexto, g, abajo) {
    PCT.grafica.rotularTiempos(contexto, { izquierda: g.izquierda, derecha: g.derecha, abajo }, visibles[0].tiempo, visibles[visibles.length - 1].tiempo);
  }

  function iniciarLeyenda() {
    const contenedor = document.getElementById('leyenda-act');
    if (!contenedor) return;
    const items = [...SERIES_PORCENTAJE, ...PISTAS_DIGITALES.map(([id, color]) => ({ id, texto: id, color }))];
    PCT.grafica.crearLeyenda(contenedor, items, id => { seleccion = id; pintar(); });
  }

  const api = { tomarMuestra, registrar, reiniciar, pintar, ventana: () => historial };
  if (typeof module !== 'undefined') module.exports = api;
  else { PCT.graficaActivaciones = api; iniciarLeyenda(); }
})();
