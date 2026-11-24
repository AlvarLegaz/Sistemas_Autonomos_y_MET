// Pestaña «Prácticas» (modo Prácticas): lista de prácticas guiadas de mantenimiento y, en curso, los pasos con el ICONO de la operación (pinza, multímetro, trazador,
// cámara, maniobra, pregunta) y un TICK cuando se cumplen. Si el profesor ha desbloqueado un EXAMEN, aparece arriba: la misma práctica, pero sin pistas, sin pasos
// ni ✓: el alumno mide libremente, contesta y entrega; la nota se calcula al entregar y va al aula. La lógica está en practicas_fv.js; aquí solo el DOM.
//   'lista' → 'curso' (guiada) → 'fin'     ·     'lista' → 'examen' → 'examen_fin' (nota; siguiente intento si le quedan)
// Mientras una práctica con avería está en curso o en examen, `oculto()` es true: la página oculta lecturas y alarmas, igual que en Diagnóstico.
(function () {
  const enNode = typeof require !== 'undefined';
  const P = enNode ? require('./practicas_fv.js') : PCT.fvPracticas;
  const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nota1 = n => n.toFixed(1).replace('.', ',');
  const CLAVE = 'fv.practicas.v1';

  /**
   * Crea la pestaña en `contenedor`. ctx: { sim() , cuaderno, I (instrumentos_fv), empezar(practica) → prepara la instalación, terminar(completada), abrirMaletin(), avisar(texto),
   * explicacion(averiaId) → texto de la avería revelada, almacen (localStorage),
   * examenPendiente?() → Promise<{ id, practica, titulo, intentos, intentos_max } | null> (el examen que el profesor ha desbloqueado; sin aula no hay),
   * enviarExamen?(examen, { nota, detalle }) → Promise<{ ok, cuerpo }> (POST al aula) }.
   * Devuelve { entrar(), salir(), actualizar(), oculto(), fase(), anotarPeligro(texto) }.
   */
  function crear(contenedor, ctx) {
    let fase = 'lista', g = null, ultimaFirma = '', textoPista = '', indicePista = -1;
    let examen = null, practicaExamen = null, respuestas = {}, peligros = 0, resultado = null, confirmando = false, enviando = false;
    const leer = () => { try { return JSON.parse((ctx.almacen && ctx.almacen.getItem(CLAVE)) || '{}') || {}; } catch (error) { return {}; } };
    const guardar = (id, nota) => { try { const d = leer(); if (!(d[id] >= nota)) d[id] = nota; if (ctx.almacen) ctx.almacen.setItem(CLAVE, JSON.stringify(d)); } catch (error) { /* sin almacenamiento: no se guarda */ } };
    const chip = (paso, estado) => { const i = P.icono(paso); return `<span class="pr-icono pr-${i.clase} pr-${estado}" role="img" aria-label="${esc(i.etiqueta)}${estado === 'hecho' ? ' (hecho)' : ''}" title="${esc(i.etiqueta)}"><b>${esc(i.glifo)}</b>${estado === 'hecho' ? '<i class="pr-tick" aria-hidden="true">✓</i>' : ''}</span>`; };
    const hoy = () => { try { return new Date().toISOString().slice(0, 10); } catch (error) { return ''; } };
    const ahoraTxt = () => { try { return new Date().toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' }); } catch (error) { return ''; } };
    /** Guarda `texto` como archivo descargable (solo en el navegador). */
    function descargar(nombre, texto) {
      if (typeof document === 'undefined' || typeof Blob === 'undefined') return false;
      const url = URL.createObjectURL(new Blob([texto], { type: 'text/html;charset=utf-8' })), a = document.createElement('a');
      a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); return true;
    }
    const intentosTexto = e => `Intento ${Math.min(e.intentos + 1, e.intentos_max)} de ${e.intentos_max}`;

    function cargarExamen() {
      if (!ctx.examenPendiente) return;
      Promise.resolve(ctx.examenPendiente()).then(e => { examen = e && P.porId(e.practica) ? e : null; if (fase === 'lista') pintar(); }).catch(() => { /* sin aula: no hay examen */ });
    }

    /* ---------- lista ---------- */
    function pintarLista() {
      const hechas = leer();
      const aviso = examen ? `<div class="pr-examen" role="status"><b>Examen desbloqueado por tu profesor</b><span>${esc(examen.titulo)} · ${esc(intentosTexto(examen))}${examen.intentos_max > 1 ? ` (se guarda la mejor nota)` : ''}. Sin pistas ni ayudas.</span><button type="button" class="pr-examen-ir">Empezar el examen</button></div>` : '';
      contenedor.innerHTML = `<h2 class="pr-titulo">Prácticas de mantenimiento</h2>${aviso}<p class="pr-intro">Cada práctica es una orden de trabajo guiada. Usa los instrumentos del maletín sobre el sinóptico: el paso se marca con ✓ cuando la medida es la correcta.</p>` +
        '<ul class="pr-lista">' + P.PRACTICAS.map(p => `<li><button type="button" class="pr-tarjeta" data-id="${p.id}"><span class="pr-cab"><b>${esc(p.titulo)}</b><small>${esc(p.nivel)} · ${p.duracionMin} min · ${p.pasos.length} pasos</small></span>` +
          `<span class="pr-iconos" aria-hidden="true">${p.pasos.map(s => chip(s, 'pendiente')).join('')}</span><span class="pr-mejor">${hechas[p.id] != null ? `<span class="pr-tick-grande" aria-hidden="true">✓</span> Mejor nota ${nota1(hechas[p.id])}` : 'Sin hacer'}</span></button></li>`).join('') + '</ul>';
      contenedor.querySelectorAll('.pr-tarjeta').forEach(b => b.addEventListener('click', () => empezar(P.porId(b.dataset.id))));
      const ir = contenedor.querySelector('.pr-examen-ir'); if (ir) ir.addEventListener('click', empezarExamen);
    }
    function empezar(p) {
      if (!p) return;
      ctx.empezar(p); g = P.crearGuion(p, { sim: ctx.sim, cuaderno: ctx.cuaderno, I: ctx.I }); fase = 'curso'; ultimaFirma = ''; pintar();
    }

    /* ---------- práctica guiada ---------- */
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
        '<div class="pr-botones"><button type="button" class="pr-informe">Descargar informe</button><button type="button" class="pr-repetir">Repetir</button><button type="button" class="pr-otra">Otra práctica</button></div>';
      contenedor.querySelector('.pr-informe').addEventListener('click', () => descargar(P.nombreInforme('Práctica', p.id, hoy()), P.informeHtml({ tipo: 'Práctica', fecha: ahoraTxt(), cerrado: true,
        detalle: { practica: p.id, titulo: p.titulo, nota: r.nota, pistas: r.pistas, fallos: r.fallos, peligros: r.peligros, conclusion: p.conclusion, pasos: p.pasos.map((x, k) => ({ paso: k + 1, titulo: x.titulo, ok: true })), cuaderno: ctx.cuaderno.lista().slice(-25).map(e => ({ hora: e.hora, instrumento: e.instrumento, modo: e.modo, puntos: (e.puntos || []).join(' ↔ '), texto: e.texto, peligro: e.peligro })) } })));
      contenedor.querySelector('.pr-repetir').addEventListener('click', () => empezar(p));
      contenedor.querySelector('.pr-otra').addEventListener('click', salirAlistado);
    }

    /* ---------- examen ---------- */
    function empezarExamen() {
      if (!examen) return;
      practicaExamen = P.porId(examen.practica); if (!practicaExamen) return;
      ctx.empezar(practicaExamen); respuestas = {}; peligros = 0; resultado = null; confirmando = false; enviando = false; fase = 'examen'; pintar();
    }
    function pintarExamen() {
      const p = practicaExamen;
      const preguntas = p.pasos.map((s, k) => s.tipo !== 'respuesta' ? '' : `<fieldset class="pr-pregunta"><legend>${esc(s.pregunta)}</legend>${s.opciones.map((o, j) => `<label class="pr-opcion"><input type="radio" name="q${k}" value="${j}"${Number(respuestas[k]) === j && respuestas[k] !== undefined ? ' checked' : ''}> <span>${esc(o)}</span></label>`).join('')}</fieldset>`).join('');
      contenedor.innerHTML = `<div class="pr-cab-curso"><button type="button" class="pr-volver">← Salir</button><h2 class="pr-titulo">Examen · ${esc(examen.titulo)}</h2></div>` +
        `<p class="pr-examen-info"><b>${esc(intentosTexto(examen))}.</b> Sin pistas ni ayudas: mide con los instrumentos, contesta y entrega. Si sales sin entregar, el intento no se cuenta.</p>` +
        `<p class="pr-orden"><b>Orden de trabajo.</b> ${esc(p.orden)}</p><div class="pr-botones"><button type="button" class="pr-maletin">Abrir maletín</button></div>` +
        `<h3>Hoja del examen</h3>${preguntas}<p class="pr-aviso" role="status" aria-live="polite"></p>` +
        `<div class="pr-botones"><button type="button" class="pr-entregar">${confirmando ? 'Confirmar la entrega' : 'Entregar el examen'}</button>${confirmando ? '<button type="button" class="pr-cancelar">Seguir con el examen</button>' : ''}</div>`;
      contenedor.querySelector('.pr-volver').addEventListener('click', salirAlistado);
      contenedor.querySelector('.pr-maletin').addEventListener('click', () => ctx.abrirMaletin && ctx.abrirMaletin());
      contenedor.querySelectorAll('.pr-pregunta input').forEach(i => i.addEventListener('change', () => { respuestas[Number(i.name.slice(1))] = Number(i.value); confirmando = false; const b = contenedor.querySelector('.pr-entregar'); if (b) b.textContent = 'Entregar el examen'; const c = contenedor.querySelector('.pr-cancelar'); if (c) c.remove(); }));
      const c = contenedor.querySelector('.pr-cancelar'); if (c) c.addEventListener('click', () => { confirmando = false; pintar(); });
      contenedor.querySelector('.pr-entregar').addEventListener('click', () => {
        const sin = p.pasos.filter((s, k) => s.tipo === 'respuesta' && respuestas[k] === undefined).length;
        if (!confirmando) { confirmando = true; pintar(); const a = contenedor.querySelector('.pr-aviso'); if (a) a.textContent = sin ? `Te faltan ${sin} pregunta(s) por contestar. Se corregirán como fallo.` : 'Revisa tus medidas y respuestas. Al confirmar, el intento se cuenta.'; return; }
        entregarExamen();
      });
    }
    function entregarExamen() {
      if (enviando) return; enviando = true;
      const res = P.evaluarExamen(practicaExamen, { sim: ctx.sim, cuaderno: ctx.cuaderno, I: ctx.I, respuestas, peligros, intento: Math.min(examen.intentos + 1, examen.intentos_max) });
      const envio = ctx.enviarExamen ? Promise.resolve(ctx.enviarExamen(examen, res)) : Promise.resolve({ ok: false, cuerpo: null });
      resultado = { res, envio: null }; pintarEnviando();
      envio.then(r => finExamen(res, r), () => finExamen(res, { ok: false, cuerpo: null }));
    }
    function pintarEnviando() { contenedor.innerHTML = '<h2 class="pr-titulo">Entregando el examen…</h2><p class="pr-intro" role="status">Guardando tu hoja en el aula.</p>'; }
    function finExamen(res, r) {
      enviando = false; resultado = { res, envio: r };
      if (r && r.ok && r.cuerpo) { examen.intentos = r.cuerpo.intentos; examen.intentos_max = r.cuerpo.intentos_max; }
      fase = 'examen_fin'; if (envioOk() && !quedanIntentos()) ctx.terminar(true); pintar();      // si el envío falló, la avería sigue oculta: el intento no se ha contado
    }
    const envioOk = () => !!(resultado && resultado.envio && resultado.envio.ok);
    const quedanIntentos = () => !!(resultado && resultado.envio && resultado.envio.ok && resultado.envio.cuerpo && resultado.envio.cuerpo.quedan > 0);
    function pintarExamenFin() {
      const { res, envio } = resultado, p = practicaExamen, ok = !!(envio && envio.ok), quedan = ok && envio.cuerpo ? envio.cuerpo.quedan : 0;
      if (ok) guardar(p.id, res.nota);
      const expl = !quedan && p.averia && ctx.explicacion ? ctx.explicacion(p.averia) : '';
      contenedor.innerHTML = `<div class="pr-cab-curso"><h2 class="pr-titulo">${ok ? '<span class="pr-tick-grande" aria-hidden="true">✓</span> Examen entregado' : 'Examen sin guardar'}</h2></div>` +
        (ok ? `<p class="pr-nota">Nota de este intento <b>${nota1(res.nota)}</b> / 10</p>` : '<p class="pr-aviso" role="alert">No se pudo guardar en el aula (sin conexión o sesión caducada). Tu intento NO se ha contado: pulsa «Reintentar el envío».</p>') +
        `<ul class="pr-desglose"><li>Medidas y maniobras pedidas: ${res.medidas.hechas} de ${res.medidas.total}</li><li>Respuestas acertadas: ${res.respuestas.acertadas} de ${res.respuestas.total}</li><li>Maniobras peligrosas: ${res.peligros}</li></ul>` +
        (ok ? (quedan > 0 ? `<p>Te quedan <b>${quedan}</b> intento${quedan === 1 ? '' : 's'}. Se guarda la mejor nota. La avería sigue oculta.</p>` : `<p>No te quedan intentos.</p><h3>Parte de mantenimiento</h3><p class="pr-parte">${esc(p.conclusion)}</p>${expl ? `<h3>Qué le pasaba a la instalación</h3><p class="pr-parte">${esc(expl)}</p>` : ''}`) : '') +
        `<div class="pr-botones"><button type="button" class="pr-informe">Descargar informe</button>${ok ? (quedan > 0 ? '<button type="button" class="pr-otro-intento">Siguiente intento</button>' : '') : '<button type="button" class="pr-reintentar">Reintentar el envío</button>'}<button type="button" class="pr-otra">Volver a las prácticas</button></div>`;
      contenedor.querySelector('.pr-informe').addEventListener('click', () => descargar(P.nombreInforme('Examen', p.id, hoy()), P.informeHtml({ tipo: 'Examen', fecha: ahoraTxt(), intento: res.detalle.intento, intentosMax: examen.intentos_max, cerrado: ok && quedan === 0, detalle: Object.assign({}, res.detalle, { conclusion: p.conclusion }) })));
      const o = contenedor.querySelector('.pr-otro-intento'); if (o) o.addEventListener('click', empezarExamen);
      const re = contenedor.querySelector('.pr-reintentar'); if (re) re.addEventListener('click', () => { fase = 'examen'; confirmando = true; entregarExamen(); });
      contenedor.querySelector('.pr-otra').addEventListener('click', () => { const fin = !quedanIntentos(); if (fin) examen = null; salirAlistado(true); cargarExamen(); });
    }

    function salirAlistado(sinAviso) {
      if ((fase === 'curso' && g && !g.hecho) || fase === 'examen') ctx.avisar('Abandonado. La instalación vuelve a estar sana.');
      ctx.terminar(); g = null; fase = 'lista'; resultado = null; pintar();
    }
    function comprobarFin() { if (g && g.hecho && fase === 'curso') { fase = 'fin'; ctx.terminar(true); } }
    function pintar() { if (fase === 'lista') pintarLista(); else if (fase === 'curso') pintarCurso(); else if (fase === 'fin') pintarFin(); else if (fase === 'examen') pintarExamen(); else pintarExamenFin(); }

    return {
      entrar() { fase = 'lista'; g = null; pintar(); cargarExamen(); },
      salir() { if (fase === 'curso' || fase === 'examen') ctx.terminar(); g = null; fase = 'lista'; },
      fase: () => fase,
      oculto: () => !!((fase === 'curso' && g && g.practica.averia) || (fase === 'examen' && practicaExamen && practicaExamen.averia) || (fase === 'examen_fin' && !(envioOk() && !quedanIntentos()) && practicaExamen && practicaExamen.averia)),
      anotarPeligro(texto) { if (g && fase === 'curso') g.anotarPeligro(texto); else if (fase === 'examen') peligros++; },
      /** Se llama en cada refresco: en la práctica guiada evalúa el guion y repinta si algo cambia; en el examen no hace nada (sin ayudas ni marcas). */
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
