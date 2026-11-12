// Gráficas de la instalación fotovoltaica, a todo el ancho: potencia de cada campo, consumo y red; SoC y tensión de la batería; irradiancia y temperatura; cronograma de estados
// (inversores, protecciones y red); y la curva I-V / P-V de la cadena elegida (sim.curvaIV) con su punto de máxima potencia y su punto de trabajo.
// El historial, las escalas y la curva son puros (se prueban sin navegador); el dibujo en canvas va al final. El tiempo del eje es el del RELOJ SOLAR simulado.
(function () {
  const enNode = typeof require !== 'undefined';
  const F = enNode ? require('./formato_fv.js') : PCT.fvFormato;
  const { formatoPotencia, formatoHora, textoFecha, dec } = F;

  const C = { A: '#e0a100', B: '#2d80c7', consumo: '#8f6bd6', red: '#1f9e8f', soc: '#2f9e6a', v: '#d66d2b', gh: '#c9a227', gA: '#e0861a', gB: '#2d80c7', t: '#e5484d' };
  const GRUPOS = [
    { id: 'potencia', titulo: 'Potencia: campos fotovoltaicos, consumo y red', ancho: 'completo', formato: v => formatoPotencia(v), series: [
      ['pA', C.A, 'Campo A'], ['pB', C.B, 'Campo B'], ['consumo', C.consumo, 'Consumo'], ['red', C.red, 'Red (+ importa, − exporta)']], minimo: 500 },
    { id: 'bateria', titulo: 'Batería: carga (SoC) y tensión', formato: v => `${dec(v, 0)} %`, formatoDer: v => `${dec(v, 1)} V`, series: [['soc', C.soc, 'SoC (%)'], ['vBat', C.v, 'Tensión (V)', 'der']], minimo: 10, minimoDer: 1, noNegativo: true },
    { id: 'clima', titulo: 'Irradiancia y temperatura', formato: v => `${dec(v, 0)} W/m²`, formatoDer: v => `${dec(v, 0)} °C`, series: [['gh', C.gh, 'Horizontal'], ['gA', C.gA, 'Plano A'], ['gB', C.gB, 'Plano B'], ['tAmb', C.t, 'Ambiente (°C)', 'der']], minimo: 200, minimoDer: 5, noNegativo: true },
    { id: 'estados', titulo: 'Cronograma de estados', tipo: 'estados', ancho: 'completo', alto: 230, series: [
      ['INV-101', 'EASun INV-101'], ['INV-201', 'ZCS INV-201'], ['BAT-101', 'Batería BAT-101'], ['RED-301', 'Red RED-301'], ['QS-101', 'QS-101 seccionador A'], ['QB-101', 'QB-101 batería'], ['QS-201', 'QS-201 seccionador B'],
      ['QF-301', 'QF-301 general'], ['ID-301', 'ID-301 diferencial'], ['QF-302', 'QF-302 línea EASun'], ['QF-303', 'QF-303 línea ZCS']] },
  ];
  const BASES_DE_TIEMPO = [['1 h', 3600], ['6 h', 21600], ['24 h', 86400], ['Todo', null]];
  const CADENAS = ['STR-101', 'STR-102', 'STR-201', 'STR-202'];

  /** Historial de muestras: una fila { t, d, h, v: { serie: valor } } cada `intervaloS` s simulados (descarta las más viejas). */
  function crearHistorial(limite = 4000, intervaloS = 10) {
    const filas = [];
    let ultimo = -Infinity;
    return {
      registrar(tS, valores, reloj = {}, intervalo = intervaloS) {
        if (tS < ultimo) { filas.length = 0; ultimo = -Infinity; }
        if (tS - ultimo < intervalo) return false;
        filas.push({ t: tS, d: reloj.diaAnio, h: reloj.horaSolar, v: Object.assign({}, valores) }); ultimo = tS;
        if (filas.length > limite) filas.shift();
        return true;
      },
      ventana(segundos) { if (segundos === null || !filas.length) return filas.slice(); const desde = filas[filas.length - 1].t - segundos; return filas.filter(f => f.t >= desde); },
      limpiar() { filas.length = 0; ultimo = -Infinity; },
      longitud: () => filas.length,
    };
  }

  /** Valores que se registran en el historial en cada instante (una sola función, para que la página y las pruebas coincidan). */
  function valoresHistorial(e) {
    const v = {}, n = x => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
    if (!e) return v;
    const campos = e.campos || {}, cg = e.cargas || {};
    v.pA = n(campos.A && campos.A.p); v.pB = n(campos.B && campos.B.p);
    v.consumo = n(cg['LOAD-301'] && cg['LOAD-301'].w) + n(cg['LOAD-302'] && cg['LOAD-302'].w);
    v.red = n(e.red && e.red.p);
    v.soc = n(e.bateria && e.bateria.soc01) * 100; v.vBat = n(e.bateria && e.bateria.v);
    v.gh = n(e.ambiente && e.ambiente.ghWm2); v.gA = n(campos.A && campos.A.gPlanoWm2); v.gB = n(campos.B && campos.B.gPlanoWm2); v.tAmb = n(e.ambiente && e.ambiente.temperaturaAmbienteC);
    const E = enNode ? require('../scada2d/esquema_fv.js') : PCT.fvEsquema;
    for (const [tag] of GRUPOS[3].series) v[tag] = F.GRAVEDAD[E.estadoVisual(e, tag)];      // 0 parado, 1 en servicio, 2 aviso, 3 alarma
    return v;
  }

  /** Escalón «redondo» (1, 2, 2,5, 5 × 10^k) igual o mayor que `x`. */
  function pasoRedondo(x) {
    const e = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1e-12))));
    for (const m of [1, 2, 2.5, 5, 10]) { if (m * e >= x - 1e-12) return m * e; }
    return 10 * e;
  }
  /** Rango del eje vertical para los valores dados, con 4 divisiones de escalón redondo y un margen; mínimo `minimoAncho` de alto. */
  function rangoDe(valores, minimoAncho = 1) {
    const v = valores.filter(Number.isFinite);
    if (!v.length) return { minimo: 0, maximo: minimoAncho };
    let min = Math.min(...v), max = Math.max(...v);
    if (max - min < minimoAncho) { const c = (max + min) / 2; min = c - minimoAncho / 2; max = c + minimoAncho / 2; }
    const margen = (max - min) * 0.06;
    let paso = pasoRedondo((max - min + 2 * margen) / 4), lo = Math.floor((min - margen) / paso) * paso;
    for (let i = 0; i < 40 && lo + 4 * paso < max + margen; i++) { paso = pasoRedondo(paso * 1.01); lo = Math.floor((min - margen) / paso) * paso; }
    return { minimo: Math.round(lo * 1e9) / 1e9, maximo: Math.round((lo + 4 * paso) * 1e9) / 1e9 };
  }
  /** Puntos (x, y en píxeles) de una serie; los valores no numéricos cortan la línea con null. */
  function puntosDeSerie(filas, tag, ancho, alto, rango, tMin, tMax) {
    const span = Math.max(tMax - tMin, 1e-9), alt = rango.maximo - rango.minimo || 1;
    return filas.map(f => {
      const valor = f.v[tag];
      if (!Number.isFinite(valor)) return null;
      return [(f.t - tMin) / span * ancho, alto - (Math.max(rango.minimo, Math.min(rango.maximo, valor)) - rango.minimo) / alt * alto];
    });
  }
  /** Rótulo de tiempo de una fila del historial: «21 jun 09:30». */
  const rotuloFila = f => (f && Number.isFinite(f.h) ? `${Number.isFinite(f.d) ? textoFecha(f.d) + ' ' : ''}${formatoHora(f.h)}` : '');

  /**
   * Datos de la curva I-V / P-V: { vMax, iMax, pMax, mpp: {v, i, p}, puntos } a partir de [{ v, i, p }]. El punto de máxima potencia sale de la propia curva.
   */
  function resumenCurva(curva) {
    const puntos = (curva || []).filter(q => Number.isFinite(q.v) && Number.isFinite(q.i));
    if (!puntos.length) return { vMax: 0, iMax: 0, pMax: 0, mpp: { v: 0, i: 0, p: 0 }, puntos: [] };
    let mpp = puntos[0]; for (const q of puntos) { const p = Number.isFinite(q.p) ? q.p : q.v * q.i; if (p > (Number.isFinite(mpp.p) ? mpp.p : mpp.v * mpp.i)) mpp = q; }
    return { vMax: Math.max(...puntos.map(q => q.v)), iMax: Math.max(...puntos.map(q => q.i)), pMax: Math.max(...puntos.map(q => (Number.isFinite(q.p) ? q.p : q.v * q.i))), mpp: { v: mpp.v, i: mpp.i, p: Number.isFinite(mpp.p) ? mpp.p : mpp.v * mpp.i }, puntos };
  }
  /** Cuántos máximos locales tiene la curva de potencia (más de uno = sombra parcial con diodos de paso: el MPPT puede quedarse en el pico equivocado). */
  function maximosLocales(curva) {
    const p = (curva || []).map(q => (Number.isFinite(q.p) ? q.p : q.v * q.i)); let n = 0;
    const tope = Math.max(0, ...p);
    for (let k = 1; k < p.length - 1; k++) if (p[k] > p[k - 1] && p[k] >= p[k + 1] && p[k] > tope * 0.05) n++;
    return n;
  }

  /* ---------- DOM ---------- */
  /**
   * Dibuja las gráficas en `contenedor`. contexto: { historial, anchoAuto, curvaIV() → { id, curva, mpp?: {v,i,p}, trabajo?: {v,i} } | null, alElegirCadena(id) }.
   * Devuelve { redibujar(), seleccionarCadena(id), cadena() }.
   */
  function crearGraficas(contenedor, contexto) {
    let ventanaS = null, cadena = CADENAS[0];
    contenedor.innerHTML = '<div class="graf-barra" role="group" aria-label="Base de tiempos (reloj solar simulado)">' + BASES_DE_TIEMPO.map(([n, s]) => `<button type="button" data-s="${s}" aria-pressed="${s === ventanaS}">${n}</button>`).join('') + '</div>' +
      GRUPOS.map(g => `<figure class="graf${g.ancho === 'completo' ? ' completo' : ''}" data-fig="${g.id}"><figcaption>${g.titulo}${g.tipo === 'estados' ? '<span class="graf-leyenda"><i style="background:#2f9e6a"></i>en servicio <i style="background:#e0a33a"></i>aviso <i style="background:#e5484d"></i>alarma <i style="background:#8a949e"></i>parado/abierto</span>' : `<span class="graf-leyenda">${g.series.map(([, color, nombre]) => `<i style="background:${color}"></i>${nombre}`).join(' ')}</span>`}</figcaption><canvas width="520" height="${g.alto || 200}" data-grupo="${g.id}" role="img" aria-label="${g.titulo}"></canvas></figure>`).join('') +
      `<figure class="graf completo" data-fig="iv"><figcaption>Curva I-V y P-V de la cadena <span class="graf-leyenda"><i style="background:${C.B}"></i>I (A) <i style="background:${C.A}"></i>P (W) <i style="background:none;border:2px solid #e5484d"></i>máxima potencia <i style="background:#2f9e6a"></i>punto de trabajo</span></figcaption>` +
      `<div class="graf-barra" role="group" aria-label="Cadena de la curva I-V">${CADENAS.map(c => `<button type="button" data-cadena="${c}" aria-pressed="${c === cadena}">${c}</button>`).join('')}<output class="graf-iv-datos" aria-live="off"></output></div><canvas width="520" height="250" data-grupo="iv" role="img" aria-label="Curva I-V y P-V de la cadena seleccionada"></canvas></figure>`;
    contenedor.querySelector('.graf-barra').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      ventanaS = b.dataset.s === 'null' ? null : Number(b.dataset.s);
      contenedor.querySelectorAll('.graf-barra:first-child button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      redibujar();
    });
    function seleccionarCadena(id) {
      if (!CADENAS.includes(id)) return;
      cadena = id; contenedor.querySelectorAll('button[data-cadena]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.cadena === id)));
      if (contexto.alElegirCadena) contexto.alElegirCadena(id);
      redibujar();
    }
    contenedor.querySelector('[data-fig="iv"] .graf-barra').addEventListener('click', e => { const b = e.target.closest('button[data-cadena]'); if (b) seleccionarCadena(b.dataset.cadena); });

    const css = () => getComputedStyle(document.documentElement);
    const color = (c, n, def) => c.getPropertyValue(n).trim() || def;
    function preparar(lienzo) {
      if (contexto.anchoAuto && lienzo.clientWidth > 50 && lienzo.width !== Math.round(lienzo.clientWidth)) lienzo.width = Math.round(lienzo.clientWidth);
      const c = lienzo.getContext('2d'), s = css();
      c.clearRect(0, 0, lienzo.width, lienzo.height); c.fillStyle = color(s, '--panel', '#222'); c.fillRect(0, 0, lienzo.width, lienzo.height);
      return { c, w: lienzo.width, h: lienzo.height, s, borde: color(s, '--borde', '#555'), tenue: color(s, '--tenue', '#999') };
    }
    function dibujarLineas(lienzo, filas, grupo) {
      const { c, w, h, borde, tenue } = preparar(lienzo);
      if (filas.length < 2) { c.fillStyle = tenue; c.font = '13px system-ui,sans-serif'; c.textAlign = 'center'; c.fillText('Pulsa Iniciar: la gráfica se va dibujando con el tiempo simulado', w / 2, h / 2); return; }
      const izq = 60, der = grupo.series.some(s => s[3] === 'der') ? 52 : 12, ancho = w - izq - der, alto = h - 16 - 24, y0 = 10;
      const sel = lado => grupo.series.filter(s => (s[3] || 'izq') === lado);
      const sinNegativos = r => (grupo.noNegativo ? { minimo: Math.max(0, r.minimo), maximo: r.maximo } : r);
      const rangoIz = sinNegativos(rangoDe(filas.flatMap(f => sel('izq').map(([tag]) => f.v[tag])).concat(grupo.id === 'bateria' ? [0, 100] : grupo.id === 'potencia' || grupo.id === 'clima' ? [0] : []), grupo.minimo || 1));
      const rangoDr = sel('der').length ? rangoDe(filas.flatMap(f => sel('der').map(([tag]) => f.v[tag])), grupo.minimoDer || 1) : null;
      const tMin = filas[0].t, tMax = filas[filas.length - 1].t;
      c.font = '11px system-ui,sans-serif'; c.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = y0 + alto * i / 4; c.strokeStyle = borde; c.beginPath(); c.moveTo(izq, y); c.lineTo(izq + ancho, y); c.stroke();
        c.fillStyle = tenue; c.textAlign = 'right'; c.fillText(grupo.formato(rangoIz.maximo - (rangoIz.maximo - rangoIz.minimo) * i / 4), izq - 4, y + 4);
        if (rangoDr) { c.textAlign = 'left'; c.fillText(grupo.formatoDer(rangoDr.maximo - (rangoDr.maximo - rangoDr.minimo) * i / 4), izq + ancho + 4, y + 4); }
      }
      if (rangoIz.minimo < 0 && rangoIz.maximo > 0) { const y = y0 + alto * rangoIz.maximo / (rangoIz.maximo - rangoIz.minimo); c.strokeStyle = tenue; c.setLineDash([4, 3]); c.beginPath(); c.moveTo(izq, y); c.lineTo(izq + ancho, y); c.stroke(); c.setLineDash([]); }
      c.fillStyle = tenue; c.textAlign = 'left'; c.fillText(rotuloFila(filas[0]), izq, h - 6); c.textAlign = 'right'; c.fillText(rotuloFila(filas[filas.length - 1]), izq + ancho, h - 6);
      for (const [tag, col, , lado] of grupo.series) {
        const rg = (lado || 'izq') === 'der' ? rangoDr : rangoIz;
        c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); let abierto = false;
        for (const p of puntosDeSerie(filas, tag, ancho, alto, rg, tMin, tMax)) { if (!p) { abierto = false; continue; } if (abierto) c.lineTo(izq + p[0], y0 + p[1]); else { c.moveTo(izq + p[0], y0 + p[1]); abierto = true; } }
        c.stroke();
      }
    }
    function dibujarEstados(lienzo, filas, grupo) {
      const { c, w, h, borde, tenue } = preparar(lienzo);
      if (filas.length < 2) return;
      const padIzq = 178, ancho = w - padIzq - 10, alto = h - 18 - 4, fila = alto / grupo.series.length;
      const tMin = filas[0].t, tMax = filas[filas.length - 1].t, span = Math.max(tMax - tMin, 1e-9), xDe = t => padIzq + (t - tMin) / span * ancho;
      c.font = '11px system-ui,sans-serif'; c.textBaseline = 'middle';
      const col = [F.COLOR_ESTADO.parado, F.COLOR_ESTADO.ok, F.COLOR_ESTADO.aviso, F.COLOR_ESTADO.alarma];
      grupo.series.forEach(([tag, etiqueta], i) => {
        const y0 = 3 + i * fila, centro = y0 + fila / 2;
        c.strokeStyle = borde; c.lineWidth = 1; c.beginPath(); c.moveTo(padIzq, y0 + fila - 0.5); c.lineTo(padIzq + ancho, y0 + fila - 0.5); c.stroke();
        c.fillStyle = tenue; c.textAlign = 'left'; c.fillText(etiqueta, 6, centro);
        for (let k = 0; k < filas.length; k++) {
          const v = filas[k].v[tag]; if (!Number.isFinite(v)) continue;
          const x1 = xDe(filas[k].t), x2 = xDe(k + 1 < filas.length ? filas[k + 1].t : filas[k].t);
          c.fillStyle = col[v] || col[0]; c.globalAlpha = v === 0 ? 0.35 : 1; c.fillRect(x1, y0 + 3, Math.max(x2 - x1, 1.5), fila - 7); c.globalAlpha = 1;
        }
      });
      c.textBaseline = 'alphabetic'; c.fillStyle = tenue; c.textAlign = 'left'; c.fillText(rotuloFila(filas[0]), padIzq, h - 4); c.textAlign = 'right'; c.fillText(rotuloFila(filas[filas.length - 1]), padIzq + ancho, h - 4);
    }
    function dibujarIV(lienzo) {
      const { c, w, h, borde, tenue, s } = preparar(lienzo), dat = contexto.curvaIV ? contexto.curvaIV(cadena) : null;
      const salida = contenedor.querySelector('.graf-iv-datos');
      if (!dat || !dat.curva || dat.curva.length < 2) { c.fillStyle = tenue; c.font = '13px system-ui,sans-serif'; c.textAlign = 'center'; c.fillText('Sin curva (cadena sin datos)', w / 2, h / 2); salida.textContent = ''; return; }
      const R = resumenCurva(dat.curva), izq = 52, der = 56, ancho = w - izq - der, alto = h - 20 - 26, y0 = 12;
      const vMax = Math.max(R.vMax, 1) * 1.04, iMax = Math.max(R.iMax, 0.5) * 1.15, pMax = Math.max(R.pMax, 10) * 1.15;
      const X = v => izq + v / vMax * ancho, YI = i => y0 + alto - i / iMax * alto, YP = p => y0 + alto - p / pMax * alto;
      c.font = '11px system-ui,sans-serif';
      for (let k = 0; k <= 4; k++) {
        const y = y0 + alto * k / 4; c.strokeStyle = borde; c.lineWidth = 1; c.beginPath(); c.moveTo(izq, y); c.lineTo(izq + ancho, y); c.stroke();
        c.fillStyle = C.B; c.textAlign = 'right'; c.fillText(`${dec(iMax * (1 - k / 4), 1)} A`, izq - 4, y + 4); c.fillStyle = C.A; c.textAlign = 'left'; c.fillText(formatoPotencia(pMax * (1 - k / 4)), izq + ancho + 4, y + 4);
        const x = izq + ancho * k / 4; c.fillStyle = tenue; c.textAlign = 'center'; c.fillText(`${dec(vMax * k / 4, 0)} V`, x, h - 8);
      }
      const trazo = (col, fx, fy, disc) => { c.strokeStyle = col; c.lineWidth = 2.2; c.setLineDash(disc ? [6, 3] : []); c.beginPath(); R.puntos.forEach((q, k) => { const px = fx(q), py = fy(q); if (k) c.lineTo(px, py); else c.moveTo(px, py); }); c.stroke(); c.setLineDash([]); };
      trazo(C.B, q => X(q.v), q => YI(q.i)); trazo(C.A, q => X(q.v), q => YP(Number.isFinite(q.p) ? q.p : q.v * q.i), true);
      const mpp = dat.mpp || R.mpp;
      c.strokeStyle = '#e5484d'; c.lineWidth = 2.5; c.beginPath(); c.arc(X(mpp.v), YP(mpp.p), 7, 0, 2 * Math.PI); c.stroke();
      if (dat.trabajo && Number.isFinite(dat.trabajo.v)) { c.fillStyle = '#2f9e6a'; c.beginPath(); c.arc(X(dat.trabajo.v), YI(dat.trabajo.i), 5.5, 0, 2 * Math.PI); c.fill(); }
      const pico = maximosLocales(dat.curva);
      salida.textContent = `Máxima potencia ${formatoPotencia(mpp.p)} a ${dec(mpp.v, 0)} V y ${dec(mpp.i, 1)} A${dat.trabajo ? ` · trabaja a ${dec(dat.trabajo.v, 0)} V y ${dec(dat.trabajo.i, 1)} A` : ''}${pico > 1 ? ` · ${pico} picos de potencia: sombra parcial` : ''}`;
      void s;
    }
    function redibujar() {
      const filas = contexto.historial.ventana(ventanaS);
      for (const grupo of GRUPOS) {
        const lienzo = contenedor.querySelector(`canvas[data-grupo="${grupo.id}"]`);
        if (grupo.tipo === 'estados') dibujarEstados(lienzo, filas, grupo); else dibujarLineas(lienzo, filas, grupo);
      }
      dibujarIV(contenedor.querySelector('canvas[data-grupo="iv"]'));
    }
    return { redibujar, seleccionarCadena, cadena: () => cadena };
  }

  const api = { GRUPOS, BASES_DE_TIEMPO, CADENAS, crearHistorial, valoresHistorial, rangoDe, puntosDeSerie, rotuloFila, resumenCurva, maximosLocales, crearGraficas };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') (window.PCT = window.PCT || {}).fvGrafica = api;
})();
