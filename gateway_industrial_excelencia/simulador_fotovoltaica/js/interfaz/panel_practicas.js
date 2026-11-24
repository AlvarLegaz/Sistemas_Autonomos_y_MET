// Pestaña «Prácticas» (modo Prácticas): lista de prácticas guiadas de mantenimiento y, en curso, los pasos con el ICONO de la operación (pinza, multímetro, trazador,
// cámara, maniobra, pregunta) y un TICK cuando se cumplen. La lógica está en practicas_fv.js; aquí solo el DOM.
//   'lista' (se elige una práctica) → 'curso' (se sigue el guion) → 'fin' (nota, parte de mantenimiento y avería revelada).
// Mientras una práctica con avería está en curso, `oculto()` es true: la página oculta lecturas y alarmas, igual que en Diagnóstico.
(function () {
  const enNode = typeof require !== 'undefined';
  const P = enNode ? require('./practicas_fv.js') : PCT.fvPracticas;
  const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nota1 = n => n.toFixed(1).replace('.', ',');
  const CLAVE = 'fv.practicas.v1';

  /**
   * Crea la pestaña en `contenedor`. ctx: { sim() , cuaderno, I (instrumentos_fv), empezar(practica) → prepara la instalación, terminar(), abrirMaletin(), avisar(texto),
   * explicacion(averiaId) → texto de la avería revelada, almacen (localStorage) }.
   * Devuelve { entrar(), salir(), actualizar(), oculto(), fase(), anotarPeligro(texto) }.
   */
  function crear(contenedor, ctx) {
    let fase = 'lista', g = null, ultimaFirma = '', textoPista = '', indicePista = -1;
    const leer = () => { try { return JSON.parse((ctx.almacen && ctx.almacen.getItem(CLAVE)) || '{}') || {}; } catch (error) { return {}; } };
    const guardar = (id, nota) => { try { const d = leer(); if (!(d[id] >= nota)) d[id] = nota; if (ctx.almacen) ctx.almacen.setItem(CLAVE, JSON.stringify(d)); } catch (error) { /* sin almacenamiento: no se guarda */ } };
    const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
    const chip = (paso, estado) => { const i = P.icono(paso); return `<span class="pr-icono pr-${i.clase} pr-${estado}" role="img" aria-label="${esc(i.etiqueta)}${estado === 'hecho' ? ' (hecho)' : ''}" title="${esc(i.etiqueta)}"><b>${esc(i.glifo)}</b>${estado === 'hecho' ? '<i class="pr-tick" aria-hidden="true">✓</i>' : ''}</span>`; };

    function pintarLista() {
      const hechas = leer();
      contenedor.innerHTML = '<h2 class="pr-titulo">Prácticas de mantenimiento</h2><p class="pr-intro">Cada práctica es una orden de trabajo guiada. Usa los instrumentos del maletín sobre el sinóptico: el paso se marca con ✓ cuando la medida es la correcta.</p>' +
        '<ul class="pr-lista">' + P.PRACTICAS.map(p => `<li><button type="button" class="pr-tarjeta" data-id="${p.id}"><span class="pr-cab"><b>${esc(p.titulo)}</b><small>${esc(p.nivel)} · ${p.duracionMin} min · ${p.pasos.length} pasos</small></span>` +
          `<span class="pr-iconos" aria-hidden="true">${p.pasos.map(s => chip(s, 'pendiente')).join('')}</span><span class="pr-mejor">${hechas[p.id] != null ? `<span class="pr-tick-grande" aria-hidden="true">✓</span> Mejor nota ${nota1(hechas[p.id])}` : 'Sin hacer'}</span></button></li>`).join('') + '</ul>';
      contenedor.querySelectorAll('.pr-tarjeta').forEach(b => b.addEventListener('click', () => empezar(P.porId(b.dataset.id))));
    }
    function empezar(p) {
      if (!p) return;
      ctx.empezar(p); g = P.crearGuion(p, { sim: ctx.sim, cuaderno: ctx.cuaderno, I: ctx.I }); fase = 'curso'; ultimaFirma = ''; pintar();
    }
    function pintarCurso() {
      const p = g.practica, actual = g.indice, paso = g.pasoActual(), hechos = g.completados;
      const lista = p.pasos.map((s, k) => {
        const estado = k < actual ? 'hecho' : k === actual ? 'actual' : 'pendiente';
        const por = k < actual ? ((hechos.find(h => h.id === k) || {}).porQue || '') : '';
        return `<li class="pr-paso pr-${estado}"${estado === 'actual' ? ' aria-current="step"' : ''}>${chip(s, estado)}<div class="pr-texto"><span class="pr-num">Paso ${k + 1} de ${p.pasos.length}</span>` +
          `${estado === 'pendiente' ? '<span class="pr-oculto">…</span>' : `<span class="pr-instr">${esc(s.titulo)}</span>`}${por ? `<span class="pr-porque">${esc(por)}</span>` : ''}</div></li>`;
      }).join('');
      let accion = '';
      if (paso && paso.tipo === 'respuesta') accion = `<div class="pr-respuestas" role="group" aria-label="Respuestas">${paso.opciones.map((o, k) => `<button type="button" data-k="${k}">${esc(o)}</button>`).join('')}</div>`;
      const pistaN = g.nivelPista();
      contenedor.innerHTML = `<div class="pr-cab-curso"><button type="button" class="pr-volver">← Prácticas</button><h2 class="pr-titulo">${esc(p.titulo)}</h2></div>` +
        `<p class="pr-orden"><b>Orden de trabajo.</b> ${esc(p.orden)}</p>` +
        `<div class="pr-barra" role="progressbar" aria-valuemin="0" aria-valuemax="${p.pasos.length}" aria-valuenow="${actual}"><span style="width:${Math.round(100 * actual / p.pasos.length)}%"></span></div>` +
        `<ol class="pr-pasos">${lista}</ol>${accion}<p class="pr-aviso" role="status" aria-live="polite">${esc(g.ultimoMensaje || '')}</p>` +
        `<div class="pr-botones"><button type="button" class="pr-maletin">Abrir maletín</button><button type="button" class="pr-pista"${pistaN >= 3 ? ' disabled' : ''}>Pista (${pistaN}/3)</button></div><p class="pr-pista-texto" aria-live="polite"></p>`;
      contenedor.querySelector('.pr-volver').addEventListener('click', salirAlistado);
      contenedor.querySelector('.pr-maletin').addEventListener('click', () => ctx.abrirMaletin && ctx.abrirMaletin());
      if (indicePista !== g.indice) { indicePista = g.indice; textoPista = ''; }
      contenedor.querySelector('.pr-pista-texto').textContent = textoPista;
      contenedor.querySelector('.pr-pista').addEventListener('click', () => { const t = g.pista(); textoPista = `Pista ${g.nivelPista()}: ${t}`; pintar(); });
      contenedor.querySelectorAll('.pr-respuestas button').forEach(b => b.addEventListener('click', () => { g.responder(Number(b.dataset.k)); comprobarFin(); pintar(); }));
    }
    function pintarFin() {
      const r = g.resumen(), p = g.practica, expl = p.averia && ctx.explicacion ? ctx.explicacion(p.averia) : '';
      guardar(p.id, r.nota);
      contenedor.innerHTML = `<div class="pr-cab-curso"><h2 class="pr-titulo"><span class="pr-tick-grande" aria-hidden="true">✓</span> Práctica completada</h2></div><p class="pr-nota">Nota <b>${nota1(r.nota)}</b> / 10</p>` +
        `<ul class="pr-desglose"><li>${r.pasos} de ${r.pasos} pasos ✓</li><li>Pistas usadas: ${r.pistas}</li><li>Respuestas o medidas erróneas: ${r.fallos}</li><li>Maniobras peligrosas: ${r.peligros}</li></ul>` +
        `<h3>Parte de mantenimiento</h3><p class="pr-parte">${esc(r.conclusion)}</p>${expl ? `<h3>Qué le pasaba a la instalación</h3><p class="pr-parte">${esc(expl)}</p>` : ''}` +
        `<ol class="pr-pasos pr-resumen">${p.pasos.map(s => `<li class="pr-paso pr-hecho">${chip(s, 'hecho')}<div class="pr-texto"><span class="pr-instr">${esc(s.titulo)}</span></div></li>`).join('')}</ol>` +
        '<div class="pr-botones"><button type="button" class="pr-repetir">Repetir</button><button type="button" class="pr-otra">Otra práctica</button></div>';
      contenedor.querySelector('.pr-repetir').addEventListener('click', () => empezar(p));
      contenedor.querySelector('.pr-otra').addEventListener('click', salirAlistado);
    }
    function salirAlistado() { if (fase === 'curso' && g && !g.hecho) ctx.avisar('Práctica abandonada. La instalación vuelve a estar sana.'); ctx.terminar(); g = null; fase = 'lista'; pintar(); }
    function comprobarFin() { if (g && g.hecho && fase === 'curso') { fase = 'fin'; ctx.terminar(true); } }
    function pintar() { if (fase === 'lista') pintarLista(); else if (fase === 'curso') pintarCurso(); else pintarFin(); }

    return {
      entrar() { fase = 'lista'; g = null; pintar(); },
      salir() { if (fase === 'curso') ctx.terminar(); g = null; fase = 'lista'; },
      fase: () => fase,
      oculto: () => fase === 'curso' && !!(g && g.practica.averia),
      anotarPeligro(texto) { if (g && fase === 'curso') g.anotarPeligro(texto); },
      /** Se llama en cada refresco: evalúa el guion y, si algo ha cambiado (paso cumplido, aviso nuevo), repinta. */
      actualizar() {
        if (fase !== 'curso' || !g) return;
        const r = g.evaluar(); comprobarFin();
        const firma = `${fase}|${g.indice}|${g.ultimoMensaje}|${g.nivelPista()}`;
        if (r.avanzo || firma !== ultimaFirma) { ultimaFirma = firma; pintar(); }
      },
    };
  }

  const api = { crear, CLAVE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') (window.PCT = window.PCT || {}).fvPanelPracticas = api;
})();
