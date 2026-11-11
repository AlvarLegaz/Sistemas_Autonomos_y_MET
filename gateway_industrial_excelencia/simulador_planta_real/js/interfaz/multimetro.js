// Multímetro virtual: solo dibuja lo que calcula el modelo (sim.medidas.medir, js/modelo/medidas.js). Los modos son los del modelo
// ('V', 'mA', 'ohm', 'continuidad', 'temperatura', 'presion') y se mide en un punto de prueba respecto a masa. La parte pura (formato, interpretación de la
// medida, avisos de seguridad) está separada para poder probarla sin navegador.
(function () {
  const puntosMedida = typeof require !== 'undefined' ? require('./puntos_medida.js') : PCT.htstPuntosMedida;

  const MODOS = [
    { id: 'V', nombre: 'Tensión (V)', unidad: 'V' },
    { id: 'mA', nombre: 'Corriente (mA, en serie)', unidad: 'mA', enSerie: true },
    { id: 'ohm', nombre: 'Resistencia (Ω, sin tensión)', unidad: 'Ω', sinTension: true },
    { id: 'continuidad', nombre: 'Continuidad (sin tensión)', unidad: 'Ω', sinTension: true },
    { id: 'temperatura', nombre: 'Temperatura (°C)', unidad: '°C' },
    { id: 'presion', nombre: 'Presión (bar)', unidad: 'bar' },
  ];
  const UMBRAL_CONTINUIDAD_OHM = 50;
  const modo = id => MODOS.find(m => m.id === id) || MODOS[0];
  const decimales = (valor, cifras) => valor.toFixed(cifras).replace('.', ',');

  /** Texto de la pantalla para un valor en la unidad base del modo. null o infinito en ohmios = fuera de escala (OL). */
  function formatear(idModo, valor) {
    const m = modo(idModo);
    if (valor === null || valor === undefined || Number.isNaN(valor)) return 'OL';
    if (m.unidad === 'Ω') {
      if (!Number.isFinite(valor)) return 'OL';
      if (valor < 1000) return `${decimales(valor, valor < 10 ? 2 : 1)} Ω`;
      if (valor < 1e6) return `${decimales(valor / 1000, 2)} kΩ`;
      return `${decimales(valor / 1e6, 2)} MΩ`;
    }
    if (!Number.isFinite(valor)) return 'OL';
    if (m.unidad === 'mA') return `${decimales(valor, 2)} mA`;       // en un lazo 4-20 mA importan los centésimos
    if (m.unidad === '°C') return `${decimales(valor, 1)} °C`;
    if (m.unidad === 'bar') return `${decimales(valor, 2)} bar`;
    return Math.abs(valor) < 1 && valor !== 0 ? `${decimales(valor * 1000, 0)} mV` : `${decimales(valor, Math.abs(valor) < 100 ? 2 : 1)} V`;
  }

  /**
   * Interpreta lo que devuelve sim.medidas.medir(): { ok, valor, unidad, texto, continuidad?, ... }. ok = false significa que el punto o el modo no valen
   * (el texto dice qué modo usar). También acepta un número suelto.
   */
  function interpretarMedida(bruto) {
    if (bruto === null || bruto === undefined) return { ok: false, valor: null, texto: 'Sin medida', continuidad: false };
    if (typeof bruto === 'number') return { ok: true, valor: bruto, texto: '', continuidad: false };
    return { ok: bruto.ok !== false, valor: typeof bruto.valor === 'number' ? bruto.valor : null, texto: bruto.texto || '', continuidad: !!bruto.continuidad };
  }

  /** Avisos didácticos para el modo y el punto elegidos (aunque el modelo sepa más): ohmios sin tensión, mA en serie... */
  function avisosDeUso(idModo, punto) {
    const m = modo(idModo), avisos = [];
    if (!punto) { avisos.push('Elige un punto de prueba.'); return avisos; }
    if (m.sinTension) avisos.push('Ohmios y continuidad se miden SIN tensión: desconecta, bloquea y comprueba la ausencia de tensión antes.');
    if (m.enSerie) avisos.push('Los mA se miden EN SERIE: abre el lazo y pon el multímetro en el hueco (nunca en paralelo con la fuente).');
    if (punto.modo && punto.modo !== idModo) avisos.push(`Este punto se mide normalmente en «${modo(punto.modo).nombre}».`);
    return avisos;
  }

  /** Una lectura completa: llama al modelo y devuelve el texto de la pantalla. */
  function leerMultimetro(sim, { modo: idModo, punto }) {
    const medidas = sim && sim.medidas;
    if (!medidas || typeof medidas.medir !== 'function') return { texto: '—', valor: null, aviso: 'El modelo de la planta no está cargado.', ok: false, continuidad: false };
    let bruto;
    try { bruto = medidas.medir('multimetro', punto, null, idModo, sim.estado()); }
    catch (error) { return { texto: 'ERR', valor: null, aviso: String(error && error.message || error), ok: false, continuidad: false }; }
    const lectura = interpretarMedida(bruto);
    if (!lectura.ok) return { texto: 'ERR', valor: null, aviso: lectura.texto, ok: false, continuidad: false };
    const continuidad = idModo === 'continuidad' && (lectura.continuidad || (lectura.valor !== null && lectura.valor < UMBRAL_CONTINUIDAD_OHM));
    return { texto: formatear(idModo, lectura.valor), valor: lectura.valor, aviso: lectura.texto && !/^\d/.test(lectura.texto) && lectura.texto !== formatear(idModo, lectura.valor) ? lectura.texto : '', ok: true, continuidad };
  }

  /* ---------- parte con DOM ---------- */
  /** Dibuja el multímetro en `contenedor`. contexto: { sim(), alMedir(medida) } (alMedir deja constancia en el registro). */
  function crearMultimetro(contenedor, contexto) {
    const lista = puntosMedida.puntosDisponibles(contexto.sim());
    contenedor.innerHTML = `<h3>Multímetro</h3>
      <div class="mm-pantalla" aria-live="polite"><span class="mm-valor">—</span><span class="mm-modo"></span></div>
      <label>Función <select class="mm-modo-sel">${MODOS.map(m => `<option value="${m.id}">${m.nombre}</option>`).join('')}</select></label>
      <label>Punto de prueba (la otra punta, en masa) <select class="mm-punto">${lista.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('')}</select></label>
      <p class="mm-avisos" role="note"></p>
      <button type="button" class="mm-medir">Medir y anotar</button>`;
    const pantalla = contenedor.querySelector('.mm-valor'), etiquetaModo = contenedor.querySelector('.mm-modo');
    const selModo = contenedor.querySelector('.mm-modo-sel'), selPunto = contenedor.querySelector('.mm-punto'), avisos = contenedor.querySelector('.mm-avisos');
    const punto = () => lista.find(p => p.id === selPunto.value);
    function refrescar() {
      const p = punto();
      const lectura = leerMultimetro(contexto.sim(), { modo: selModo.value, punto: p && p.id });
      pantalla.textContent = lectura.texto;
      pantalla.classList.toggle('continuidad', lectura.continuidad);
      etiquetaModo.textContent = modo(selModo.value).nombre;
      avisos.textContent = [lectura.aviso, ...avisosDeUso(selModo.value, p)].filter(Boolean).join(' ');
      return { lectura, p };
    }
    selPunto.addEventListener('change', () => { const p = punto(); if (p && p.modo) selModo.value = p.modo; refrescar(); });      // propone la función natural del punto
    selModo.addEventListener('change', refrescar);
    contenedor.querySelector('.mm-medir').addEventListener('click', () => {
      const { lectura, p } = refrescar();
      if (contexto.alMedir) contexto.alMedir({ instrumento: 'multimetro', funcion: selModo.value, punto: p && p.id, texto: lectura.texto, valor: lectura.valor });
    });
    if (punto() && punto().modo) selModo.value = punto().modo;
    setInterval(refrescar, 500);
    refrescar();
    return { seleccionar(id) { if (id && lista.some(p => p.id === id)) { selPunto.value = id; if (punto().modo) selModo.value = punto().modo; } refrescar(); } };
  }

  const api = { MODOS, UMBRAL_CONTINUIDAD_OHM, formatear, interpretarMedida, avisosDeUso, leerMultimetro, crearMultimetro };
  if (typeof module !== 'undefined') module.exports = api; else PCT.htstMultimetro = api;
})();
