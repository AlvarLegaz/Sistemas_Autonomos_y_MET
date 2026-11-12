// Panel «Mando» de la instalación fotovoltaica (pestaña del lateral).
//   Siempre (modos Normal y Revisión): las CONDICIONES del día: fecha, hora solar y nubosidad.
//   Solo en Revisión (el alumno controla todo; sin cuadros de confirmación, la consecuencia se avisa pero no se pregunta): sombras por panel, suciedad de los campos, temperatura
//   ambiente, interruptores y protecciones, red, cargas, modo del EASun, encendido de los inversores, SoC inicial de la batería y el panel de AVERÍAS del profesor (layout.AVERIAS).
// La construcción del DOM es del navegador; lo que decide el texto de cada botón es puro.
(function () {
  const enNode = typeof require !== 'undefined';
  const layout = enNode ? require('../layout.js') : PCT.fvLayout;
  const F = enNode ? require('./formato_fv.js') : PCT.fvFormato;

  const PROTECCIONES = ['QS-101', 'QB-101', 'QS-201', 'QF-301', 'ID-301', 'QF-302', 'QF-303'];
  const FUSIBLES = ['F-101', 'F-102', 'FB-101'];
  const DESCARGADORES = ['SPD-101', 'SPD-201', 'SPD-301'];
  const MODOS_EASUN = [['SOLAR_PRIMERO', 'Solar primero'], ['RED_PRIMERO', 'Red primero'], ['BATERIA_PRIMERO', 'Batería primero']];

  /** Texto del botón de una protección según su estado: lo que hace el clic. */
  function textoBotonProteccion(estado) {
    return { CERRADO: 'Abrir', ABIERTO: 'Cerrar', DISPARADO: 'Rearmar', FUNDIDO: 'Sustituir fusible', AGOTADO: 'Sustituir cartucho' }[estado] || '—';
  }
  const escapar = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nombreEquipo = tag => { const q = layout.EQUIPOS.find(x => x.tag === tag); return q ? q.nombre.replace(/\s*\(.*\)$/, '') : tag; };
  const paneles = () => layout.EQUIPOS.filter(q => q.tipo === 'panel').map(q => q.tag);

  /**
   * Construye el panel en `contenedor`. ctx: { sim(), accionar(tag), alCambiarReloj(), alCambiar(), avisar(texto) }. Devuelve { actualizar(estado, modo) }.
   */
  function crearPanelMando(contenedor, ctx) {
    const sim = () => ctx.sim();
    const fila = (id, titulo, min, max, paso, valor, unidad = '') => `<label class="fila-rango"><span>${titulo}</span><output id="o-${id}">${valor}${unidad}</output><input type="range" id="${id}" min="${min}" max="${max}" step="${paso}" value="${valor}"></label>`;
    contenedor.innerHTML = `
      <section class="grupo-mando" aria-label="Condiciones del día">
        <h2>CONDICIONES DEL DÍA</h2>
        <label class="fila-fecha"><span>Fecha</span><input type="date" id="c-fecha" min="2026-01-01" max="2026-12-31" value="2026-06-21"></label>
        <div class="botones-fila"><button type="button" data-fecha="172">Verano · 21 jun</button><button type="button" data-fecha="355">Invierno · 21 dic</button></div>
        ${fila('c-hora', 'Hora solar', 0, 24, 0.25, 9)}
        ${fila('c-nub', 'Nubosidad', 0, 100, 1, 10, ' %')}
      </section>
      <div class="solo-revision">
        <section class="grupo-mando" aria-label="Interruptores y protecciones"><h2>INTERRUPTORES Y PROTECCIONES</h2>
          <ul class="lista-prot" id="lista-prot">${PROTECCIONES.concat(FUSIBLES, DESCARGADORES).map(t => `<li data-tag="${t}"><span class="nombre"><b>${t}</b><small>${escapar(nombreEquipo(t))}</small></span><output id="ps-${t}">—</output><button type="button" data-prot="${t}">—</button></li>`).join('')}</ul></section>
        <section class="grupo-mando" aria-label="Inversores y batería"><h2>INVERSORES Y BATERÍA</h2>
          <label class="fila-select"><span>Modo del EASun</span><select id="r-modo">${MODOS_EASUN.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></label>
          <div class="botones-fila dos"><button type="button" data-inv="INV-101" id="r-inv101">Apagar EASun</button><button type="button" data-inv="INV-201" id="r-inv201">Apagar ZCS</button></div>
          ${fila('r-soc', 'SoC inicial de la batería', 0, 100, 1, 80, ' %')}
          <div class="botones-fila"><button type="button" id="r-soc-aplicar">Poner la batería a ese SoC</button></div></section>
        <section class="grupo-mando" aria-label="Red y cargas"><h2>RED Y CARGAS</h2>
          <div class="botones-fila"><button type="button" data-red="1" id="r-red">Cortar la red</button></div>
          ${fila('r-vred', 'Tensión de red', 180, 270, 1, 230, ' V')}
          ${fila('r-l301', 'LOAD-301 · consumo del centro', 0, 3000, 50, 0, ' W')}
          <label class="fila-check"><input type="checkbox" id="r-l301-auto" checked> LOAD-301 automática (perfil del día)</label>
          ${fila('r-l302', 'LOAD-302 · cargas protegidas', 0, 3000, 50, 0, ' W')}
          <label class="fila-check"><input type="checkbox" id="r-l302-auto" checked> LOAD-302 automática (perfil del día)</label></section>
        <section class="grupo-mando" aria-label="Ambiente"><h2>AMBIENTE</h2>
          ${fila('r-sucA', 'Suciedad del campo A', 0, 60, 1, 5, ' %')}
          ${fila('r-sucB', 'Suciedad del campo B', 0, 60, 1, 5, ' %')}
          ${fila('r-tamb', 'Temperatura ambiente', -5, 45, 1, 20, ' °C')}
          <label class="fila-check"><input type="checkbox" id="r-tamb-auto" checked> Temperatura automática (ciclo del día)</label>
          <details class="sombras"><summary>Sombras por panel</summary><div class="rejilla-sombras">${paneles().map(t => `<label><span>${t}</span><output id="o-sh-${t}">0 %</output><input type="range" data-sombra="${t}" id="sh-${t}" min="0" max="100" step="5" value="0" aria-label="Sombra sobre ${t}"></label>`).join('')}</div></details></section>
        <section class="grupo-mando" aria-label="Averías del profesor"><h2>AVERÍAS DEL PROFESOR</h2>
          <p class="aviso-profesor">Activa una avería y el alumno la diagnostica con las lecturas, los LEDs y las gráficas. Los efectos salen de la física del modelo.</p>
          <ul class="lista-averias" id="lista-averias">${layout.AVERIAS.map(a => `<li><label><input type="checkbox" data-averia="${a.id}"> <span>${escapar(a.titulo)}<small>${a.tag}</small></span></label></li>`).join('')}</ul>
          <div class="botones-fila"><button type="button" id="r-averias-limpiar">Quitar todas las averías</button></div></section>
      </div>`;
    const $ = id => contenedor.querySelector(`#${id}`);
    const enfocado = el => document.activeElement === el;
    const cambio = () => { if (ctx.alCambiar) ctx.alCambiar(); };

    // Condiciones del día (los dos modos)
    $('c-fecha').addEventListener('change', () => { const d = F.deValorFecha($('c-fecha').value); if (d) { sim().ordenes.reloj.poner({ diaAnio: d }); ctx.alCambiarReloj(); cambio(); } });
    contenedor.querySelectorAll('[data-fecha]').forEach(b => b.addEventListener('click', () => { sim().ordenes.reloj.poner({ diaAnio: Number(b.dataset.fecha) }); ctx.alCambiarReloj(); cambio(); }));
    $('c-hora').addEventListener('input', () => { const h = Number($('c-hora').value); $('o-c-hora').textContent = F.formatoHora(h); sim().ordenes.reloj.poner({ horaSolar: h }); ctx.alCambiarReloj(); cambio(); });
    $('c-nub').addEventListener('input', () => { const n = Number($('c-nub').value); $('o-c-nub').textContent = `${n} %`; sim().ordenes.ambiente.poner({ nubosidad: n / 100 }); cambio(); });
    // Revisión
    contenedor.querySelector('#lista-prot').addEventListener('click', e => { const b = e.target.closest('button[data-prot]'); if (b) { ctx.accionar(b.dataset.prot); cambio(); } });
    contenedor.querySelectorAll('[data-inv]').forEach(b => b.addEventListener('click', () => { ctx.accionar(b.dataset.inv); cambio(); }));
    $('r-red').addEventListener('click', () => { ctx.accionar('RED-301'); cambio(); });
    $('r-modo').addEventListener('change', () => { sim().ordenes.inversor.modoEasun($('r-modo').value); cambio(); });
    $('r-soc').addEventListener('input', () => { $('o-r-soc').textContent = `${$('r-soc').value} %`; });
    $('r-soc-aplicar').addEventListener('click', () => { sim().ordenes.bateria.socInicial(Number($('r-soc').value)); ctx.avisar(`Batería puesta al ${$('r-soc').value} % de SoC.`); cambio(); });
    $('r-vred').addEventListener('input', () => { $('o-r-vred').textContent = `${$('r-vred').value} V`; sim().ordenes.red.tension(Number($('r-vred').value)); cambio(); });
    for (const [id, tag] of [['r-l301', 'LOAD-301'], ['r-l302', 'LOAD-302']]) {
      $(id).addEventListener('input', () => { $(`o-${id}`).textContent = `${$(id).value} W`; $(`${id}-auto`).checked = false; sim().ordenes.cargas.poner(tag, Number($(id).value)); cambio(); });
      $(`${id}-auto`).addEventListener('change', () => { if ($(`${id}-auto`).checked) sim().ordenes.cargas.poner(tag, null); else sim().ordenes.cargas.poner(tag, Number($(id).value)); cambio(); });
    }
    for (const [id, clave] of [['r-sucA', 'suciedadA'], ['r-sucB', 'suciedadB']]) $(id).addEventListener('input', () => { $(`o-${id}`).textContent = `${$(id).value} %`; sim().ordenes.ambiente.poner({ [clave]: Number($(id).value) / 100 }); cambio(); });
    $('r-tamb').addEventListener('input', () => { $('o-r-tamb').textContent = `${$('r-tamb').value} °C`; $('r-tamb-auto').checked = false; sim().ordenes.ambiente.poner({ temperaturaAmbienteC: Number($('r-tamb').value) }); cambio(); });
    $('r-tamb-auto').addEventListener('change', () => { sim().ordenes.ambiente.poner({ temperaturaAmbienteC: $('r-tamb-auto').checked ? null : Number($('r-tamb').value) }); cambio(); });
    contenedor.querySelectorAll('[data-sombra]').forEach(r => r.addEventListener('input', () => { $(`o-sh-${r.dataset.sombra}`).textContent = `${r.value} %`; sim().ordenes.ambiente.sombra(r.dataset.sombra, Number(r.value) / 100); cambio(); }));
    contenedor.querySelectorAll('[data-averia]').forEach(c => c.addEventListener('change', () => {
      if (c.checked) sim().ordenes.averias.activar(c.dataset.averia); else sim().ordenes.averias.desactivar(c.dataset.averia);
      ctx.avisar(`${c.checked ? 'Avería activada' : 'Avería quitada'}: ${(layout.AVERIAS.find(a => a.id === c.dataset.averia) || {}).titulo || c.dataset.averia}`); cambio();
    }));
    $('r-averias-limpiar').addEventListener('click', () => { sim().ordenes.averias.limpiar(); ctx.avisar('Todas las averías quitadas.'); cambio(); });

    const poner = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
    /** Pone los controles al día con el estado (los que se están tocando no se mueven). */
    function actualizar(e) {
      if (!e) return;
      if (!enfocado($('c-fecha'))) { const v = F.aValorFecha(e.reloj.diaAnio); if ($('c-fecha').value !== v) $('c-fecha').value = v; }
      if (!enfocado($('c-hora'))) { $('c-hora').value = String(Math.round(e.reloj.horaSolar * 4) / 4); poner($('o-c-hora'), F.formatoHora(e.reloj.horaSolar)); } else poner($('o-c-hora'), F.formatoHora(Number($('c-hora').value)));
      if (!enfocado($('c-nub'))) { $('c-nub').value = String(Math.round(e.ambiente.nubosidad * 100)); poner($('o-c-nub'), `${Math.round(e.ambiente.nubosidad * 100)} %`); }
      for (const t of PROTECCIONES.concat(FUSIBLES, DESCARGADORES)) {
        const p = (e.protecciones || {})[t] || {}, b = contenedor.querySelector(`[data-prot="${t}"]`);
        poner($(`ps-${t}`), (p.estado || '—').toLowerCase()); poner(b, textoBotonProteccion(p.estado));
        const li = b.closest('li'); li.dataset.estado = p.estado || ''; b.disabled = !p.estado || (FUSIBLES.concat(DESCARGADORES).includes(t) && p.estado !== 'FUNDIDO' && p.estado !== 'AGOTADO');
      }
      const i1 = (e.inversores['INV-101'] || {}).estado, i2 = (e.inversores['INV-201'] || {}).estado;
      poner($('r-inv101'), i1 === 'APAGADO' ? 'Encender EASun' : 'Apagar EASun'); poner($('r-inv201'), i2 === 'APAGADO' ? 'Encender ZCS' : 'Apagar ZCS');
      if (!enfocado($('r-modo')) && $('r-modo').value !== (e.inversores['INV-101'] || {}).modo && (e.inversores['INV-101'] || {}).modo) $('r-modo').value = e.inversores['INV-101'].modo;
      poner($('r-red'), e.red.disponible === false ? 'Reponer la red' : 'Cortar la red');
      if (!enfocado($('r-vred')) && e.red && e.red.disponible !== false && Number.isFinite(e.red.v)) { const v = Math.round(e.red.v); if ($('r-vred').value !== String(v)) $('r-vred').value = String(v); poner($('o-r-vred'), `${v} V`); }
      for (const [id, tag] of [['r-l301', 'LOAD-301'], ['r-l302', 'LOAD-302']]) if (!enfocado($(`${id}-auto`)) && e.cargas[tag] && typeof e.cargas[tag].manual === 'boolean') $(`${id}-auto`).checked = !e.cargas[tag].manual;
      for (const [id, tag] of [['r-l301', 'LOAD-301'], ['r-l302', 'LOAD-302']]) if ($(`${id}-auto`).checked && !enfocado($(id))) { const w = Math.round((e.cargas[tag].w || 0) / 50) * 50; $(id).value = String(w); poner($(`o-${id}`), `${Math.round(e.cargas[tag].w || 0)} W`); }
      if (!enfocado($('r-sucA'))) { const v = Math.round(e.ambiente.suciedad.A * 100); $('r-sucA').value = String(v); poner($('o-r-sucA'), `${v} %`); }
      if (!enfocado($('r-sucB'))) { const v = Math.round(e.ambiente.suciedad.B * 100); $('r-sucB').value = String(v); poner($('o-r-sucB'), `${v} %`); }
      if ($('r-tamb-auto').checked && !enfocado($('r-tamb'))) { $('r-tamb').value = String(Math.round(e.ambiente.temperaturaAmbienteC)); poner($('o-r-tamb'), `${Math.round(e.ambiente.temperaturaAmbienteC)} °C`); }
      for (const a of e.campos ? ['A', 'B'] : []) for (const c of e.campos[a].cadenas) for (const p of c.paneles) { const r = $(`sh-${p.tag}`); if (r && !enfocado(r)) { const v = Math.round(p.sombra01 * 100 / 5) * 5; if (r.value !== String(v)) r.value = String(v); poner($(`o-sh-${p.tag}`), `${Math.round(p.sombra01 * 100)} %`); } }
      const activas = new Set(e.averiasActivas || []);
      contenedor.querySelectorAll('[data-averia]').forEach(c => { if (c.checked !== activas.has(c.dataset.averia)) c.checked = activas.has(c.dataset.averia); });
    }
    /** Deja los controles como el modelo recién puesto en Normal o restablecido: cargas y temperatura en automático y tensión de red nominal. */
    function restablecer() {
      for (const id of ['r-l301', 'r-l302', 'r-tamb']) $(`${id}-auto`).checked = true;
      $('r-vred').value = '230'; poner($('o-r-vred'), '230 V');
      contenedor.querySelectorAll('[data-averia]').forEach(c => { c.checked = false; });
    }
    return { actualizar, restablecer };
  }

  const api = { PROTECCIONES, FUSIBLES, DESCARGADORES, MODOS_EASUN, textoBotonProteccion, crearPanelMando };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') (window.PCT = window.PCT || {}).fvPanelRevision = api;
})();
