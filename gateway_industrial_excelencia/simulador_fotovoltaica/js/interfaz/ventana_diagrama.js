// Ventana aparte de los esquemas eléctricos (unifilar.html y cableado.html): dibuja el esquema con el Canvas del SCADA, lo refresca cada 250 ms con el estado de la ventana que la
// abrió (window.opener.PCT.fvApp.estadoActual()) y, si no hay ventana de origen, con el simulador (PCT.fv.crearSimulacion, si está cargado) o con un estado de ejemplo parado.
// Clic derecho (o la tecla de menú) sobre un símbolo = ficha; clic izquierdo, Intro o Espacio = accionarlo en la página principal (PCT.fvApp.accionarEquipo(tag), si existe;
// sin ventana de origen abre la ficha). Solo navegador: la parte pura está en js/scada2d/diagrama_unifilar.js y diagrama_cableado.js.
(function () {
  const VISTAS = {
    unifilar: { nombre: 'Unifilar', modulo: 'fvDiagramaUnifilar', otra: ['cableado', 'Cableado'] },
    cableado: { nombre: 'Cableado', modulo: 'fvDiagramaCableado', otra: ['unifilar', 'Unifilar'] },
  };
  const SCRIPTS = ['/simulador/js/utilidades/modulos.js', '/simulador/js/interfaz/scada/canvas.js', 'js/layout.js', 'js/scada2d/diagrama_unifilar.js', 'js/scada2d/diagrama_cableado.js', 'js/interfaz/textos_ayuda.js'];

  function cargarScript(ruta) {
    return new Promise(resolver => { const s = document.createElement('script'); s.src = ruta; s.async = false; s.onload = () => resolver(true); s.onerror = () => resolver(false); document.head.appendChild(s); });
  }
  const el = (tag, atributos, ...hijos) => { const n = document.createElement(tag); Object.entries(atributos || {}).forEach(([k, v]) => { if (k === 'texto') n.textContent = v; else n.setAttribute(k, v); }); hijos.forEach(h => n.append(h)); return n; };
  const tagDelElemento = (nodo, raiz) => { for (let n = nodo; n && n !== raiz; n = n.parentNode) { if (n.dataset && n.dataset.tag) return n.dataset.tag; } return null; };

  /** Ficha flotante de un equipo con la API de PCT.fvTextos. Devuelve { abrir(tag, desde), cerrar() }. */
  function crearFicha(estado) {
    const T = PCT.fvTextos, cuadro = el('div', { class: 'dg-ficha', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dg-ficha-titulo', hidden: '' });
    cuadro.innerHTML = '<header><h3 id="dg-ficha-titulo"></h3><button type="button" class="dg-cerrar" aria-label="Cerrar (Esc)" title="Cerrar (Esc)">×</button></header><p class="dg-etiqueta"></p><div class="dg-cuerpo"></div>';
    document.body.appendChild(cuadro);
    let actual = null, origen = null, temporizador = null;
    const lista = (titulo, items, clase) => {
      if (!items || !items.length) return '';
      const li = items.map(i => `<li>${i}</li>`).join('');
      return `<h4>${titulo}</h4><ul${clase ? ` class="${clase}"` : ''}>${li}</ul>`;
    };
    const vivo = () => { if (!actual || cuadro.hidden) return; const n = cuadro.querySelector('.dg-vivo'); if (n) n.textContent = T.estadoVivo(actual, estado()) || '—'; };
    function cerrar() {
      if (cuadro.hidden) return;
      cuadro.hidden = true; actual = null; clearInterval(temporizador);
      if (origen && origen.isConnected && origen.focus) origen.focus();
      origen = null;
    }
    function abrir(tag, desde) {
      const f = T.fichaDe(tag); if (!f) return;
      if (cuadro.hidden) origen = desde || document.activeElement;
      actual = tag;
      cuadro.querySelector('h3').textContent = f.titulo; cuadro.querySelector('.dg-etiqueta').textContent = f.etiqueta;
      const av = (f.averias || []).map(a => `${a.titulo} <small>(${a.id})</small>`);
      cuadro.querySelector('.dg-cuerpo').innerHTML = `<h4>Qué es</h4><p>${f.queEs}</p><h4>Para qué sirve</h4><p>${f.paraQue}</p>` + lista('Cómo falla y qué síntoma da', f.fallos) + lista('Qué medir con el multímetro', f.medir) +
        lista('Riesgos', f.riesgos, 'dg-riesgo') + lista('Averías relacionadas', av) + '<h4>Estado ahora</h4><p class="dg-vivo"></p>';
      cuadro.hidden = false; vivo(); clearInterval(temporizador); temporizador = setInterval(vivo, 500);
      cuadro.querySelector('.dg-cerrar').focus();
    }
    cuadro.querySelector('.dg-cerrar').addEventListener('click', cerrar);
    document.addEventListener('keydown', e => {
      if (cuadro.hidden) return;
      if (e.key === 'Escape') { cerrar(); return; }
      if (e.key === 'Tab') {   // el foco da la vuelta dentro de la ficha
        const c = [...cuadro.querySelectorAll('button')]; if (!c.length) return;
        if (e.shiftKey && document.activeElement === c[0]) { e.preventDefault(); c[c.length - 1].focus(); } else if (!e.shiftKey && document.activeElement === c[c.length - 1]) { e.preventDefault(); c[0].focus(); }
      }
    });
    return { abrir, cerrar };
  }

  const fmt = (v, c = 2) => (typeof v === 'number' && isFinite(v) ? v.toFixed(c).replace('.', ',') : '—');
  /** Tabla de conductores (cableado): sección, longitud, corriente en vivo, caída de tensión y comprobación con la corriente nominal. */
  function crearTabla(C) {
    const tabla = el('table', { class: 'dg-tabla' }), cuerpo = el('tbody');
    tabla.append(el('caption', { texto: 'Conductores (valores SUPUESTOS: sección y longitud)' }),
      el('thead', {}, el('tr', {}, ...['Cable', 'De → a', 'Conductores', 'Sección', 'Long.', 'I ahora', 'ΔV ahora', 'ΔV nominal', 'Admisible', 'Nota'].map(t => el('th', { scope: 'col', texto: t })))), cuerpo);
    const filas = new Map();
    for (const f of C.filasTabla(null)) {
      const celdas = { ahora: el('td', { class: 'dg-num' }), dv: el('td', { class: 'dg-num' }) };
      const nominal = el('td', { class: 'dg-num' });
      nominal.textContent = f.limitePct ? `${fmt(f.pctDiseno, 1)} % (límite ${fmt(f.limitePct, 1)} %)` : '—'; if (f.alto) nominal.classList.add('dg-alto');
      const tr = el('tr', {}, el('th', { scope: 'row', texto: f.id }), el('td', { texto: f.nombre }), el('td', { texto: f.hilos }), el('td', { class: 'dg-num', texto: `${fmt(f.seccionMm2, 1)} mm²` }),
        el('td', { class: 'dg-num', texto: `${fmt(f.longitudM, 1)} m` }), celdas.ahora, celdas.dv, nominal, el('td', { class: 'dg-num', texto: f.admisibleA ? `${f.admisibleA} A (diseño ${fmt(f.iDisenoA, 1)} A)` : '—' }), el('td', { texto: f.nota }));
      cuerpo.append(tr); filas.set(f.id, celdas);
    }
    const actualizar = e => { for (const f of C.filasTabla(e)) { const c = filas.get(f.id); c.ahora.textContent = f.id === 'C-A9' ? '—' : `${fmt(f.corrienteA, 1)} A`; c.dv.textContent = f.id === 'C-A9' ? '—' : `${fmt(f.dvV, 2)} V · ${fmt(f.pct, 1)} %`; } };
    return { tabla, actualizar };
  }

  /** Prepara la ventana. `vista` es 'unifilar' o 'cableado'. Devuelve { sim, estado, objetos } (sim solo si no hay ventana de origen y hay modelo: sirve para probar). */
  async function iniciar(vista) {
    const V = VISTAS[vista], $ = id => document.getElementById(id);
    for (const ruta of SCRIPTS) await cargarScript(ruta);
    const D = PCT[V.modulo], L = PCT.fvLayout, inst = (L && L.INSTALACION) || { centro: '', corto: 'FV-01' };
    const titulo = `${inst.corto} · ${V.nombre}`;
    document.title = `Instalación fotovoltaica · ${V.nombre}`; $('dg-titulo').textContent = `Instalación fotovoltaica ${inst.corto} · ${V.nombre}`;
    $('dg-otra').textContent = `Ver ${V.otra[1]}`; $('dg-otra').setAttribute('href', `${V.otra[0]}.html`);
    $('dg-cerrar').addEventListener('click', () => window.close());
    void titulo;

    // estado: el de la ventana de origen; si no la hay, el simulador (si está cargado) o un estado de ejemplo
    const origen = () => { try { const o = window.opener; return o && !o.closed && o.PCT && o.PCT.fvApp ? o : null; } catch (error) { return null; } };
    let ultimo = null, sim = null;
    if (!origen()) {
      if (PCT.fv && PCT.fv.crearSimulacion) { sim = PCT.fv.crearSimulacion({}); sim.paso(1); ultimo = sim.estado; $('dg-aviso').textContent = 'Abierta sin el simulador detrás: se muestra una instalación propia en reposo.'; }
      else { ultimo = PCT.fvDiagramaUnifilar.estadoEjemplo(); $('dg-aviso').textContent = 'Abierta sin el simulador detrás: se muestra un estado de ejemplo (no es la simulación en marcha).'; }
      $('dg-aviso').hidden = false;
    }
    const estado = () => {
      const o = origen();
      if (o) { try { const e = o.PCT.fvApp.estadoActual ? o.PCT.fvApp.estadoActual() : (o.PCT.fvApp.sim && o.PCT.fvApp.sim.estado); if (e) ultimo = e; } catch (error) { /* la ventana de origen se cerró */ } }
      else if (sim) { try { sim.paso(0.25); ultimo = sim.estado; } catch (error) { /* se queda el último */ } }
      return ultimo;
    };

    // dibujo
    const pagina = $('dg-pagina'), objetos = [], svgs = [];
    const hojas = vista === 'unifilar' ? D.HOJAS : [{ id: 'cableado', nombre: 'Bornas y conductores', esquema: D.ESQUEMA }];
    for (const h of hojas) {
      const canvas = new PCT.canvas.Canvas(h.esquema);
      pagina.append(el('section', { class: 'dg-hoja', 'aria-label': h.nombre }, el('h2', { texto: h.nombre }), el('div', { class: 'dg-lienzo' }, canvas.svg)));
      objetos.push(...D.crearObjetos(canvas)); svgs.push(canvas.svg);
    }
    let tabla = null;
    if (vista === 'cableado') {
      tabla = crearTabla(D); pagina.append(el('div', { class: 'dg-tabla-caja' }, tabla.tabla),
        el('p', { class: 'dg-supuesto', texto: 'Las secciones, las longitudes y las corrientes admisibles son SUPUESTOS razonables a partir de las fotos (nadie midió los cables): el profesor puede corregirlos en js/scada2d/diagrama_cableado.js. La caída de tensión orientativa es ΔV = 2·ρ·L·I / S con cobre a 70 °C (ρ = 0,0225 Ω·mm²/m).' }));
    }

    // fichas (clic derecho) y acción (clic izquierdo)
    const ficha = crearFicha(estado), conOrigen = () => { const o = origen(); return o && o.PCT.fvApp.accionarEquipo ? o : null; };
    const abrirFicha = e => { const tag = tagDelElemento(e.target, e.currentTarget); if (tag && PCT.fvTextos.fichaDe(tag)) { e.preventDefault(); ficha.abrir(tag, e.target.closest ? e.target.closest('g[data-tag]') : null); } };
    for (const svg of svgs) {
      svg.addEventListener('contextmenu', abrirFicha);
      svg.addEventListener('click', e => { const tag = tagDelElemento(e.target, svg), o = conOrigen(); if (!tag) return; if (o) o.PCT.fvApp.accionarEquipo(tag); else abrirFicha(e); });
      svg.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const gr = e.target.closest && e.target.closest('g[data-tag]'); if (!gr) return;
        e.preventDefault(); const o = conOrigen(); if (o) o.PCT.fvApp.accionarEquipo(gr.dataset.tag); else ficha.abrir(gr.dataset.tag, gr);
      });
    }

    function refrescar() {
      const e = estado();
      try { objetos.forEach(o => o.actualizar(e)); if (tabla) tabla.actualizar(e); } catch (error) { console.error(error); }
      $('dg-modo').textContent = e && e.reloj ? `${e.reloj.texto}${e.reloj.esDia ? '' : ' · noche'}` : 'Sin estado';
    }
    refrescar(); setInterval(refrescar, 250);
    return { sim, estado, objetos, ficha };
  }

  window.FV_VENTANA_DIAGRAMA = { iniciar };
})();
