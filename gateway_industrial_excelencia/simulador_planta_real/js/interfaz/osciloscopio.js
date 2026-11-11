// Osciloscopio virtual: dibuja la forma de onda que calcula el modelo (sim.medidas.medir('osciloscopio', ...)). La parte pura
// (generación y muestreo de la onda, escalas, medidas de la onda) se prueba sin navegador.
(function () {
  const puntosMedida = typeof require !== 'undefined' ? require('./puntos_medida.js') : PCT.htstPuntosMedida;

  const BASES_DE_TIEMPO_S = [0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5];
  const DIVISIONES_X = 10, DIVISIONES_Y = 8, MUESTRAS = 400;

  /** Generador pseudoaleatorio con semilla (mismo ruido en cada dibujo de la misma medida, sin parpadeo). */
  function crearAleatorio(semilla) {
    let a = semilla >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const gauss = alea => { const u = Math.max(alea(), 1e-9), v = alea(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

  /**
   * Valor de la onda en el instante t. Descriptor: { tipo: 'cc' | 'seno' | 'pwm' | 'cuadrada' | 'ruido', nivel (V, valor medio),
   * amplitud (V, de pico), frecuenciaHz, duty (0..1), rizado (V pp, componente a 100 Hz), ruidoRms (V), picos: { cadaS, altura, anchoS } }.
   */
  function valorOnda(d, t, alea) {
    let v = d.nivel === undefined ? 0 : d.nivel;
    const f = d.frecuenciaHz || 0;
    switch (d.tipo) {
      case 'seno': v += (d.amplitud || 0) * Math.sin(2 * Math.PI * f * t); break;
      case 'pwm': case 'cuadrada': { const fase = (t * f) % 1; v += (d.amplitud === undefined ? 1 : d.amplitud) * (fase < (d.duty === undefined ? 0.5 : d.duty) ? 1 : 0); break; }
      default: break;
    }
    if (d.rizado) v += (d.rizado / 2) * Math.sin(2 * Math.PI * 100 * t);
    if (d.picos && d.picos.cadaS) { const fase = t % d.picos.cadaS; if (fase < (d.picos.anchoS || d.picos.cadaS / 50)) v += d.picos.altura || 0; }
    if (d.ruidoRms) v += d.ruidoRms * gauss(alea);
    return v;
  }

  /** N muestras de la onda con la base de tiempo (segundos por división). */
  function muestrearOnda(descriptor, tPorDiv, n = MUESTRAS, semilla = 1) {
    const alea = crearAleatorio(semilla), salida = new Array(n), total = tPorDiv * DIVISIONES_X;
    for (let i = 0; i < n; i++) salida[i] = valorOnda(descriptor, total * i / (n - 1), alea);
    return salida;
  }

  /** Interpreta lo que devuelve el modelo: { muestras:[], intervaloS } o un descriptor (con onda:{...} o a pelo). */
  function interpretarOnda(bruto) {
    if (bruto === null || bruto === undefined) return { descriptor: { tipo: 'cc', nivel: 0 }, vacio: true, unidad: 'V' };
    if (typeof bruto === 'number') return { descriptor: { tipo: 'cc', nivel: bruto }, unidad: 'V' };
    const o = bruto.onda && typeof bruto.onda === 'object' && !Array.isArray(bruto.onda) ? bruto.onda : bruto;
    const muestras = Array.isArray(bruto.onda) ? bruto.onda : Array.isArray(o.muestras) ? o.muestras : null;
    if (bruto.ok === false) return { descriptor: { tipo: 'cc', nivel: 0 }, vacio: true, unidad: 'V', texto: bruto.texto || '' };
    if (muestras) return { muestras, intervaloS: o.intervaloS || (o.dtMs ? o.dtMs / 1000 : 0) || bruto.intervaloS || (bruto.dtMs ? bruto.dtMs / 1000 : 0) || 0.0001, unidad: bruto.unidad || o.unidad || 'V', texto: bruto.texto || '' };
    return { descriptor: o, unidad: bruto.unidad || o.unidad || 'V' };
  }

  /** Muestras a dibujar para una base de tiempo, vengan generadas o como tabla (se remuestrea). */
  function muestrasParaPantalla(onda, tPorDiv, semilla) {
    if (onda.muestras) {
      const total = tPorDiv * DIVISIONES_X, salida = new Array(MUESTRAS);
      for (let i = 0; i < MUESTRAS; i++) {
        const idx = Math.min(onda.muestras.length - 1, Math.floor((total * i / (MUESTRAS - 1)) / onda.intervaloS) % onda.muestras.length);
        salida[i] = onda.muestras[idx];
      }
      return salida;
    }
    return muestrearOnda(onda.descriptor, tPorDiv, MUESTRAS, semilla);
  }

  /** Número «bonito» (1, 2, 5 × 10^n) igual o mayor que x. */
  function numeroBonito(x) {
    if (x <= 0 || !Number.isFinite(x)) return 1;
    const exp = Math.floor(Math.log10(x)), base = x / Math.pow(10, exp);
    const bonito = base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10;
    return bonito * Math.pow(10, exp);
  }

  /**
   * Escala vertical automática: voltios por división y valor central de la pantalla. En acoplamiento CA se quita la media y se amplía
   * la señal (para ver el rizado o el ruido sobre un nivel de continua); en CC se ve la tensión completa, centrada.
   */
  function escalaVertical(muestras, acoplamiento = 'CC') {
    const min = Math.min(...muestras), max = Math.max(...muestras), pp = max - min, centro = (min + max) / 2;
    const base = acoplamiento === 'CA' ? pp * 1.25 / (DIVISIONES_Y - 2) : Math.max(pp * 1.25 / (DIVISIONES_Y - 2), Math.abs(centro) * 0.3 / (DIVISIONES_Y / 2));
    return { vPorDiv: numeroBonito(Math.max(base, 0.001)), centro: acoplamiento === 'CA' ? 0 : centro, min, max };
  }

  /** Quita la componente continua (acoplamiento CA del osciloscopio). */
  function sinContinua(muestras) {
    const media = muestras.reduce((s, v) => s + v, 0) / muestras.length;
    return muestras.map(v => v - media);
  }

  /** Medidas de la onda (las que da el propio osciloscopio): pico a pico, media, valor eficaz y frecuencia por cruces de la media. */
  function medidasDeOnda(muestras, tPorDiv) {
    const n = muestras.length, media = muestras.reduce((s, v) => s + v, 0) / n;
    const min = Math.min(...muestras), max = Math.max(...muestras);
    const rms = Math.sqrt(muestras.reduce((s, v) => s + v * v, 0) / n);
    // Frecuencia: se miden los instantes en que la onda sube cruzando la media (con histéresis para el ruido) y se promedia el periodo entre el primero y el último.
    const umbral = (max - min) * 0.1, tiempoTotal = tPorDiv * DIVISIONES_X, cruces = [];
    let anterior = muestras[0] - media;
    for (let i = 1; i < n; i++) {
      const actual = muestras[i] - media;
      if (anterior < -umbral / 2 && actual >= umbral / 2) cruces.push(i);
      if (Math.abs(actual) > umbral / 2) anterior = actual;
    }
    const frecuenciaHz = cruces.length >= 2 ? (cruces.length - 1) / ((cruces[cruces.length - 1] - cruces[0]) * tiempoTotal / (n - 1)) : 0;
    return { min, max, picoAPico: max - min, media, rms, frecuenciaHz };
  }

  // Prefijos de las magnitudes por debajo de la unidad: V → mV, mA → µA, A → mA (nunca «mmA»).
  const SUBUNIDAD = { V: ['mV', 1000], mA: ['µA', 1000], A: ['mA', 1000] };
  const formatoSI = (valor, unidad) => {
    const a = Math.abs(valor), sub = SUBUNIDAD[unidad];
    if (a !== 0 && a < 1 && sub) return `${(valor * sub[1]).toFixed(a < 0.01 ? 2 : 1).replace('.', ',')} ${sub[0]}`;
    return `${valor.toFixed(a < 10 ? 2 : 1).replace('.', ',')} ${unidad}`;
  };
  const formatoTiempo = s => (s >= 1 ? `${s} s` : s >= 0.001 ? `${s * 1000} ms` : `${Math.round(s * 1e6)} µs`);

  /* ---------- parte con DOM ---------- */
  function dibujar(lienzo, muestras, escala, tPorDiv, estilo) {
    const c = lienzo.getContext('2d'), w = lienzo.width, h = lienzo.height;
    c.fillStyle = estilo.fondo; c.fillRect(0, 0, w, h);
    c.strokeStyle = estilo.rejilla; c.lineWidth = 1; c.beginPath();
    for (let i = 0; i <= DIVISIONES_X; i++) { const x = Math.round(i * w / DIVISIONES_X) + 0.5; c.moveTo(x, 0); c.lineTo(x, h); }
    for (let j = 0; j <= DIVISIONES_Y; j++) { const y = Math.round(j * h / DIVISIONES_Y) + 0.5; c.moveTo(0, y); c.lineTo(w, y); }
    c.stroke();
    c.strokeStyle = estilo.traza; c.lineWidth = 2; c.beginPath();
    const aY = v => h / 2 - (v - escala.centro) / escala.vPorDiv * (h / DIVISIONES_Y);
    muestras.forEach((v, i) => { const x = i * (w - 1) / (muestras.length - 1), y = Math.max(0, Math.min(h, aY(v))); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
    c.stroke();
  }

  /** Puntos en los que el modelo da una forma de onda (no todos): se prueba cada punto una vez. */
  function puntosConOnda(sim, lista) {
    const medidas = sim && sim.medidas;
    if (!medidas || typeof medidas.medir !== 'function') return [];
    return lista.filter(p => { try { const r = medidas.medir('osciloscopio', p.id, null, 'onda', sim.estado()); return !!r && r.ok !== false; } catch (error) { return false; } });
  }

  /** Dibuja el osciloscopio en `contenedor`. contexto: { sim, alMedir(medida) }. */
  function crearOsciloscopio(contenedor, contexto) {
    const lista = puntosConOnda(contexto.sim(), puntosMedida.puntosDisponibles(contexto.sim()));
    contenedor.innerHTML = `<h3>Osciloscopio</h3>
      <canvas class="osc-pantalla" width="480" height="320" aria-label="Pantalla del osciloscopio"></canvas>
      <p class="osc-datos" aria-live="off"></p>
      <label>Sonda en <select class="osc-punto">${lista.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('')}</select></label>
      <label>Base de tiempo <select class="osc-base">${BASES_DE_TIEMPO_S.map(t => `<option value="${t}"${t === 0.005 ? ' selected' : ''}>${formatoTiempo(t)}/div</option>`).join('')}</select></label>
      <label>Acoplamiento <select class="osc-acople"><option value="CC">CC (tensión completa)</option><option value="CA">CA (solo la variación: rizado y ruido)</option></select></label>
      <button type="button" class="osc-anotar">Anotar medida</button>`;
    const lienzo = contenedor.querySelector('canvas'), datos = contenedor.querySelector('.osc-datos');
    const selPunto = contenedor.querySelector('.osc-punto'), selBase = contenedor.querySelector('.osc-base'), selAcople = contenedor.querySelector('.osc-acople');
    let ultima = null, textoModelo = '';
    function refrescar() {
      const sim = contexto.sim(), medidas = sim && sim.medidas;
      if (!medidas || typeof medidas.medir !== 'function') { datos.textContent = 'El modelo de la planta no está cargado.'; return; }
      let bruto;
      try { bruto = medidas.medir('osciloscopio', selPunto.value, null, 'onda', sim.estado()); } catch (error) { datos.textContent = String(error.message || error); return; }
      const onda = interpretarOnda(bruto), tPorDiv = Number(selBase.value);
      textoModelo = onda.texto || '';
      const completas = muestrasParaPantalla(onda, tPorDiv, 7), acople = selAcople.value;
      const muestras = acople === 'CA' ? sinContinua(completas) : completas;
      const escala = escalaVertical(muestras, acople), m = medidasDeOnda(completas, tPorDiv);
      const css = getComputedStyle(document.documentElement);
      dibujar(lienzo, muestras, escala, tPorDiv, { fondo: '#0b1410', rejilla: '#24473a', traza: css.getPropertyValue('--ok').trim() || '#4CC28A' });
      datos.textContent = `${formatoSI(escala.vPorDiv, onda.unidad)}/div · pico a pico ${formatoSI(m.picoAPico, onda.unidad)} · media ${formatoSI(m.media, onda.unidad)} · eficaz ${formatoSI(m.rms, onda.unidad)}` +
        (m.frecuenciaHz ? ` · ${Math.round(m.frecuenciaHz)} Hz` : '') + (textoModelo ? ` · ${textoModelo}` : '');
      ultima = { instrumento: 'osciloscopio', punto: selPunto.value, base: `${formatoTiempo(tPorDiv)}/div`, texto: datos.textContent };
    }
    contenedor.querySelector('.osc-anotar').addEventListener('click', () => { refrescar(); if (contexto.alMedir && ultima) contexto.alMedir(ultima); });
    [selPunto, selBase, selAcople].forEach(s => s.addEventListener('change', refrescar));
    setInterval(refrescar, 700);
    refrescar();
    return { seleccionar(id) { if (id) selPunto.value = id; refrescar(); } };
  }

  const api = { BASES_DE_TIEMPO_S, DIVISIONES_X, DIVISIONES_Y, MUESTRAS, crearAleatorio, valorOnda, muestrearOnda, interpretarOnda, muestrasParaPantalla,
    numeroBonito, escalaVertical, sinContinua, medidasDeOnda, puntosConOnda, formatoSI, formatoTiempo, crearOsciloscopio };
  if (typeof module !== 'undefined') module.exports = api; else PCT.htstOsciloscopio = api;
})();
