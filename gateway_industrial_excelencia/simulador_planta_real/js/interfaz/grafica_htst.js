// Gráficas de tendencia de la planta real: temperaturas, caudal y presiones. No reutiliza grafica.js de la maqueta (está atado a sus series T1, T2, T3).
// El historial y la escala son puros (se prueban sin navegador); el dibujo en canvas va al final.
(function () {
  const GRUPOS = [
    { id: 'temperaturas', titulo: 'Temperaturas (°C)', unidad: '°C', series: [['TT-101', '#2d80c7'], ['TT-102', '#22a2a0'], ['TT-103', '#d66d2b'], ['TT-104', '#8f6bd6'], ['TT-105', '#c9a227']] },
    { id: 'caudal', titulo: 'Caudal (L/h)', unidad: 'L/h', series: [['FT-101', '#46b07c']] },
    { id: 'presiones', titulo: 'Presiones (bar)', unidad: 'bar', series: [['PT-101', '#2d80c7'], ['PT-102', '#d66d2b']] },
  ];
  // Motores y electroválvulas en el tiempo: una fila por equipo, con bloque de color cuando está en marcha / abierta (señales todo/nada: 1 o 0). Opcional: `contexto.grupos`.
  const GRUPO_MOTORES = { id: 'motores', titulo: 'Motores y electroválvulas', tipo: 'digital', alto: 220, series: [
    ['P-101', '#46b07c', 'P-101 bomba de leche'], ['P-102', '#d66d2b', 'P-102 bomba de agua caliente'], ['KM-201', '#c9a227', 'KM-201 banco 1'], ['KM-202', '#c9a227', 'KM-202 banco 2'],
    ['FDV-101', '#2d80c7', 'FDV-101 en avance'], ['XV-101', '#22a2a0', 'XV-101 llenado tanque'], ['XV-102', '#22a2a0', 'XV-102 vaciado tanque'], ['XV-301', '#2d80c7', 'XV-301 agua fría'],
    ['XV-302', '#22a2a0', 'XV-302 llenado agua caliente'], ['XV-303', '#22a2a0', 'XV-303 vaciado agua caliente'], ['XV-401', '#8f6bd6', 'XV-401 CIP']] };
  const BASES_DE_TIEMPO = [['1 min', 60], ['5 min', 300], ['15 min', 900], ['Todo', null]];

  /** Historial de muestras: una fila { t, v: { tag: valor } } cada `intervaloS` segundos de simulación (descarta las más viejas). */
  function crearHistorial(limite = 1800, intervaloS = 2) {
    const filas = [];
    let ultimo = -Infinity;
    return {
      registrar(tS, valores) {
        if (tS < ultimo) { filas.length = 0; ultimo = -Infinity; }          // la simulación se reinició
        if (tS - ultimo < intervaloS) return false;
        filas.push({ t: tS, v: Object.assign({}, valores) }); ultimo = tS;
        if (filas.length > limite) filas.shift();
        return true;
      },
      ventana(segundos) { if (segundos === null || !filas.length) return filas.slice(); const desde = filas[filas.length - 1].t - segundos; return filas.filter(f => f.t >= desde); },
      limpiar() { filas.length = 0; ultimo = -Infinity; },
      longitud: () => filas.length,
    };
  }

  /** Rango del eje vertical (con un margen y números redondos) para los valores dados; mínimo `minimoAncho` de alto. */
  function rangoDe(valores, minimoAncho = 1) {
    const v = valores.filter(Number.isFinite);
    if (!v.length) return { minimo: 0, maximo: minimoAncho };
    let min = Math.min(...v), max = Math.max(...v);
    if (max - min < minimoAncho) { const c = (max + min) / 2; min = c - minimoAncho / 2; max = c + minimoAncho / 2; }
    const margen = (max - min) * 0.1, paso = Math.pow(10, Math.floor(Math.log10(max - min + margen * 2)) - 1);
    return { minimo: Math.floor((min - margen) / paso) * paso, maximo: Math.ceil((max + margen) / paso) * paso };
  }

  /** Puntos (x, y en píxeles) de una serie para dibujar. Los valores no numéricos (lazo roto) cortan la línea con null. */
  function puntosDeSerie(filas, tag, ancho, alto, rango, tMin, tMax) {
    const span = Math.max(tMax - tMin, 1e-9), alt = rango.maximo - rango.minimo || 1;
    return filas.map(f => {
      const valor = f.v[tag];
      if (!Number.isFinite(valor)) return null;
      return [(f.t - tMin) / span * ancho, alto - (Math.max(rango.minimo, Math.min(rango.maximo, valor)) - rango.minimo) / alt * alto];
    });
  }

  /* ---------- DOM ---------- */
  /** Dibuja las gráficas en `contenedor`. contexto: { historial, grupos (por defecto GRUPOS), anchoAuto (el lienzo toma el ancho que le da la página) }. Devuelve { redibujar() }. */
  function crearGraficas(contenedor, contexto) {
    let ventanaS = 300;
    const grupos = contexto.grupos || GRUPOS;
    contenedor.innerHTML = '<div class="graf-barra" role="group" aria-label="Base de tiempos">' + BASES_DE_TIEMPO.map(([n, s]) => `<button type="button" data-s="${s}" aria-pressed="${s === ventanaS}">${n}</button>`).join('') + '</div>' +
      grupos.map(g => `<figure class="graf" data-fig="${g.id}"><figcaption>${g.titulo}${g.tipo === 'digital' ? '' : `<span class="graf-leyenda">${g.series.map(([tag, color]) => `<i style="background:${color}"></i>${tag}`).join(' ')}</span>`}</figcaption><canvas width="520" height="${g.alto || 150}" data-grupo="${g.id}"></canvas></figure>`).join('');
    contenedor.querySelector('.graf-barra').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      ventanaS = b.dataset.s === 'null' ? null : Number(b.dataset.s);
      contenedor.querySelectorAll('.graf-barra button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      redibujar();
    });
    /** Cronograma: una fila por señal todo/nada, con un bloque de color mientras vale 1. */
    function dibujarDigital(c, filas, grupo, w, h, css) {
      const padIzq = 190, ancho = w - padIzq - 8, alto = h - 16 - 6, fila = alto / grupo.series.length;
      const tMin = filas[0].t, tMax = filas[filas.length - 1].t, span = Math.max(tMax - tMin, 1e-9), xDe = t => padIzq + (t - tMin) / span * ancho;
      c.font = '11px system-ui,sans-serif'; c.textBaseline = 'middle';
      grupo.series.forEach(([tag, color, etiqueta], i) => {
        const y0 = 3 + i * fila, centro = y0 + fila / 2;
        c.strokeStyle = css.getPropertyValue('--borde').trim() || '#555'; c.lineWidth = 1; c.beginPath(); c.moveTo(padIzq, y0 + fila - 0.5); c.lineTo(padIzq + ancho, y0 + fila - 0.5); c.stroke();
        c.fillStyle = css.getPropertyValue('--tenue').trim() || '#999'; c.textAlign = 'left'; c.fillText(etiqueta || tag, 6, centro);
        c.fillStyle = color;
        for (let k = 0; k < filas.length; k++) {
          if (filas[k].v[tag] !== 1) continue;
          const x1 = xDe(filas[k].t), x2 = xDe(k + 1 < filas.length ? filas[k + 1].t : filas[k].t);
          c.fillRect(x1, y0 + 3, Math.max(x2 - x1, 1.5), fila - 7);
        }
      });
      c.fillStyle = css.getPropertyValue('--tenue').trim() || '#999'; c.textAlign = 'left'; c.fillText(`${Math.round(tMax - tMin)} s`, padIzq, h - 6);
    }
    function redibujar() {
      const filas = contexto.historial.ventana(ventanaS);
      const css = getComputedStyle(document.documentElement);
      for (const grupo of grupos) {
        const lienzo = contenedor.querySelector(`canvas[data-grupo="${grupo.id}"]`);
        if (contexto.anchoAuto && lienzo.clientWidth > 50 && lienzo.width !== Math.round(lienzo.clientWidth)) lienzo.width = Math.round(lienzo.clientWidth);
        const c = lienzo.getContext('2d'), w = lienzo.width, h = lienzo.height;
        c.clearRect(0, 0, w, h);
        c.fillStyle = css.getPropertyValue('--panel').trim() || '#222'; c.fillRect(0, 0, w, h);
        if (filas.length < 2) continue;
        if (grupo.tipo === 'digital') { dibujarDigital(c, filas, grupo, w, h, css); continue; }
        const padIzq = 44, padAbajo = 16, ancho = w - padIzq - 8, alto = h - padAbajo - 8;
        const rango = rangoDe(filas.flatMap(f => grupo.series.map(([tag]) => f.v[tag])), grupo.unidad === '°C' ? 10 : grupo.unidad === 'bar' ? 0.5 : 50);
        const tMin = filas[0].t, tMax = filas[filas.length - 1].t;
        c.strokeStyle = css.getPropertyValue('--borde').trim() || '#555'; c.fillStyle = css.getPropertyValue('--tenue').trim() || '#999'; c.font = '11px system-ui,sans-serif'; c.lineWidth = 1;
        for (let i = 0; i <= 4; i++) { const y = 8 + alto * i / 4; c.beginPath(); c.moveTo(padIzq, y); c.lineTo(padIzq + ancho, y); c.stroke(); c.fillText((rango.maximo - (rango.maximo - rango.minimo) * i / 4).toFixed(grupo.unidad === 'L/h' ? 0 : 1), 4, y + 4); }
        c.fillText(`${Math.round(tMax - tMin)} s`, padIzq, h - 3);
        for (const [tag, color] of grupo.series) {
          c.strokeStyle = color; c.lineWidth = 2; c.beginPath();
          let abierto = false;
          for (const p of puntosDeSerie(filas, tag, ancho, alto, rango, tMin, tMax)) {
            if (!p) { abierto = false; continue; }
            if (abierto) c.lineTo(padIzq + p[0], 8 + p[1]); else { c.moveTo(padIzq + p[0], 8 + p[1]); abierto = true; }
          }
          c.stroke();
        }
      }
    }
    return { redibujar };
  }

  const api = { GRUPOS, GRUPO_MOTORES, BASES_DE_TIEMPO, crearHistorial, rangoDe, puntosDeSerie, crearGraficas };
  if (typeof module !== 'undefined') module.exports = api; else PCT.htstGrafica = api;
})();
