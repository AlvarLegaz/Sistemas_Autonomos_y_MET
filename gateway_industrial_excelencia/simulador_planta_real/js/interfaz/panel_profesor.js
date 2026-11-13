// Panel del profesor: elige y provoca averías (con parámetros), las retira y genera un código o un enlace para que el alumno cargue la misma.
// También el cargador de código para el alumno. Trabaja contra la API del motor de averías (sim.averias, ver ARQUITECTURA.md §6.2).
(function () {
  const NOMBRES_CAPA = { sensor: 'Sensores', lazo: 'Lazos 4-20 mA', alimentacion: 'Alimentación', actuador: 'Actuadores', potencia: 'Potencia',
    neumatica: 'Neumática', proceso: 'Proceso', comunicaciones: 'Comunicaciones' };
  const ESTRELLAS = { 1: '●○○ básica', 2: '●●○ media', 3: '●●● difícil' };

  /**
   * ¿Se muestra el panel del profesor? Solo si el aula lo marca (window.PCT_ES_PROFESOR = true, que el servidor inyecta solo en sesiones de
   * profesor) o, SOLO en local (localhost) para probar, con ?profesor=1. En el aula nunca vale el parámetro de la dirección.
   */
  function esProfesor({ globalProfesor = false, hostname = '', search = '' } = {}) {
    if (globalProfesor === true) return true;
    const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
    return local && /(^|[?&])profesor=1(&|$)/.test(search);
  }

  const dificultadTexto = n => ESTRELLAS[n] || ESTRELLAS[1];
  const nombreCapa = capa => NOMBRES_CAPA[capa] || capa;

  /** Agrupa el catálogo por capa, en el orden de NOMBRES_CAPA, y dentro de cada una por dificultad. */
  function agruparPorCapa(catalogo) {
    const grupos = new Map();
    for (const capa of Object.keys(NOMBRES_CAPA)) grupos.set(capa, []);
    for (const a of catalogo) { if (!grupos.has(a.capa)) grupos.set(a.capa, []); grupos.get(a.capa).push(a); }
    return [...grupos.entries()].filter(([, lista]) => lista.length).map(([capa, lista]) => ({ capa, nombre: nombreCapa(capa), averias: lista.slice().sort((x, y) => (x.dificultad || 1) - (y.dificultad || 1) || x.nombre.localeCompare(y.nombre, 'es')) }));
  }

  /** Enlace que abre la planta con esa avería ya cargada (?averia=CÓDIGO), partiendo de la dirección actual sin parámetros ni ancla. */
  function enlaceAveria(urlActual, codigo) {
    const base = String(urlActual).split('#')[0].split('?')[0];
    return `${base}?averia=${encodeURIComponent(codigo)}`;
  }
  /** Código de avería que trae la dirección (?averia=...), o null. */
  function codigoDeDireccion(search) {
    const m = /(^|[?&])averia=([^&]+)/.exec(search || '');
    if (!m) return null;
    try { return decodeURIComponent(m[2]); } catch (error) { return null; }
  }

  /** Valores por defecto de los parámetros de una avería según su catálogo (parametros: { nombre: { min, max, defecto, unidad } }). */
  function parametrosPorDefecto(avería) {
    const salida = {};
    for (const [nombre, p] of Object.entries(avería.parametros || {})) salida[nombre] = p.defecto;
    return salida;
  }

  /* ---------- DOM ---------- */
  const escapar = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /** Carga una avería desde un código (para el alumno y para el profesor). Devuelve { ok, mensaje, instancia }. */
  function cargarCodigo(sim, codigo) {
    const motor = sim && sim.averias;
    if (!motor || typeof motor.desdeCodigo !== 'function') return { ok: false, mensaje: 'El motor de averías no está cargado.' };
    try {
      const r = motor.desdeCodigo(String(codigo).trim());
      if (r === false || (r && r.ok === false)) return { ok: false, mensaje: `Código no válido${r && r.motivo ? ': ' + r.motivo : ''}` };
      return { ok: true, mensaje: 'Avería cargada.', instancia: r };
    } catch (error) { return { ok: false, mensaje: `Código no válido: ${error && error.message ? error.message : error}` }; }
  }

  /** Cuadro para pegar un código (alumno o profesor). */
  function crearCargadorCodigo(contenedor, contexto) {
    contenedor.innerHTML = `<label>Código de avería <input type="text" class="codigo-entrada" placeholder="HTST-…"></label>
      <button type="button" class="codigo-cargar">Cargar</button> <span class="codigo-mensaje" aria-live="polite"></span>`;
    contenedor.querySelector('.codigo-cargar').addEventListener('click', () => {
      const r = cargarCodigo(contexto.sim(), contenedor.querySelector('.codigo-entrada').value);
      contenedor.querySelector('.codigo-mensaje').textContent = r.mensaje;
      if (r.ok && contexto.alCargar) contexto.alCargar(r);
    });
  }

  /** Dibuja el panel del profesor. contexto: { sim(), alCambiar(), registro? }. */
  function crearPanelProfesor(contenedor, contexto) {
    const motor = () => contexto.sim().averias;
    contenedor.innerHTML = `<h3>Panel del profesor: averías</h3>
      <p class="aviso-profesor">Solo lo ves tú. Provoca una avería y pasa el código o el enlace al alumno.</p>
      <div class="averias-activas" aria-live="polite"></div>
      <div class="averias-catalogo"></div>
      <div class="cargador-codigo"></div>`;
    const activasEl = contenedor.querySelector('.averias-activas'), catalogoEl = contenedor.querySelector('.averias-catalogo');
    crearCargadorCodigo(contenedor.querySelector('.cargador-codigo'), { sim: contexto.sim, alCargar: () => { pintarActivas(); if (contexto.alCambiar) contexto.alCambiar(); } });

    function pintarCatalogo() {
      const m = motor();
      if (!m || typeof m.listar !== 'function') { catalogoEl.innerHTML = '<p>El motor de averías no está cargado.</p>'; return; }
      catalogoEl.innerHTML = agruparPorCapa(m.listar()).map(g => `<details><summary>${escapar(g.nombre)} (${g.averias.length})</summary>` +
        g.averias.map(a => `<div class="averia" data-id="${escapar(a.id)}"><div><b>${escapar(a.nombre)}</b> <small>${dificultadTexto(a.dificultad)} · ${escapar((a.equipos || []).join(', '))}</small></div>` +
          Object.entries(a.parametros || {}).map(([n, p]) => (p.tipo === 'opcion'
            ? `<label>${escapar(p.descripcion || n)} <select data-param="${escapar(n)}">${p.opciones.map(o => `<option${o === p.defecto ? ' selected' : ''}>${escapar(o)}</option>`).join('')}</select></label>`
            : `<label>${escapar(p.descripcion || n)} <input type="number" data-param="${escapar(n)}" min="${p.min}" max="${p.max}" step="any" value="${p.defecto}"> ${escapar(p.unidad || '')}</label>`)).join('') +
          `<button type="button" class="averia-inyectar">Provocar</button></div>`).join('') + '</details>').join('');
    }
    let firmaActivas = null;
    const nombreDe = id => { const m = motor(), c = m && m.listar ? m.listar().find(x => x.id === id) : null; return c ? c.nombre : id; };
    function pintarActivas() {
      const m = motor(), lista = m && typeof m.activas === 'function' ? m.activas() : [];
      const firma = JSON.stringify(lista.map(a => [a.instancia, Array.isArray(a.intentos) ? a.intentos.length : a.intentos]));
      if (firma === firmaActivas) return;                 // sin cambios: no se repinta (así no se borra el código generado)
      firmaActivas = firma;
      activasEl.innerHTML = lista.length ? '<h4>Activas ahora</h4>' + lista.map(a => `<div class="averia-activa" data-instancia="${escapar(a.instancia)}"><b>${escapar(a.nombre || nombreDe(a.id))}</b>
        <small>${escapar((a.tags || a.equipos || []).join(', '))} · intentos: ${a.intentos === undefined ? 0 : (Array.isArray(a.intentos) ? a.intentos.length : a.intentos)}</small>
        <button type="button" class="averia-quitar">Quitar</button></div>`).join('') +
        '<div class="fila-form"><button type="button" class="averia-codigo">Generar código</button> <button type="button" class="averia-enlace">Copiar enlace</button> <output class="codigo-salida"></output></div>' : '<p>Sin averías activas.</p>';
    }
    catalogoEl.addEventListener('click', e => {
      const boton = e.target.closest('.averia-inyectar');
      if (!boton) return;
      const caja = boton.closest('.averia'), parametros = {};
      caja.querySelectorAll('[data-param]').forEach(i => { parametros[i.dataset.param] = i.tagName === 'SELECT' ? i.value : parseFloat(i.value); });
      try {
        const instancia = motor().inyectar(caja.dataset.id, parametros);
        if (instancia === null || instancia === undefined || instancia === false) alert(`No se puede provocar: ${(motor().ultimoMotivoRechazo && motor().ultimoMotivoRechazo()) || 'es incoherente con otra avería activa'}`);
        else if (contexto.registro) contexto.registro.anotar('averia', `El profesor provoca ${caja.dataset.id}`, { instancia });
      } catch (error) { alert(`No se puede provocar: ${error.message || error}`); }
      pintarActivas(); if (contexto.alCambiar) contexto.alCambiar();
    });
    activasEl.addEventListener('click', e => {
      if (e.target.closest('.averia-quitar')) { motor().quitar(e.target.closest('.averia-activa').dataset.instancia); pintarActivas(); if (contexto.alCambiar) contexto.alCambiar(); return; }
      const salida = activasEl.querySelector('.codigo-salida');
      if (e.target.closest('.averia-codigo')) salida.textContent = motor().codigo();
      if (e.target.closest('.averia-enlace')) {
        const enlace = enlaceAveria(location.href, motor().codigo());
        salida.textContent = enlace;
        if (navigator.clipboard) navigator.clipboard.writeText(enlace).catch(() => {});
      }
    });
    pintarCatalogo(); pintarActivas();
    setInterval(pintarActivas, 2000);
  }

  const api = { esProfesor, dificultadTexto, nombreCapa, agruparPorCapa, enlaceAveria, codigoDeDireccion, parametrosPorDefecto, cargarCodigo, crearCargadorCodigo, crearPanelProfesor };
  if (typeof module !== 'undefined') module.exports = api; else PCT.htstPanelProfesor = api;
})();
