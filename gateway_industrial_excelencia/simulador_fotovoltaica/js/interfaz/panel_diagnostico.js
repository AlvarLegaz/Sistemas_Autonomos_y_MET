// Pestaña «Diagnóstico» (modo Diagnóstico): reto con una avería oculta, hoja de diagnóstico, pistas graduadas, corrección con nota y envío al aula.
// La lógica (descodificar la clave, corregir, nota, envío) está en reto_fv.js; aquí solo el DOM y el paso entre estados:
//   'inicio' (se busca el reto del profesor o se ofrece practicar) → 'curso' (se mide y se rellena la hoja) → 'entregado' (nota; se puede reintentar) → 'revelado' (se ve la avería y se repara).
// La avería real vive solo en la variable `reto` de este módulo: no se escribe en el DOM ni en la consola hasta que el alumno acierta o pide verla.
(function () {
  const enNode = typeof require !== 'undefined';
  const R = enNode ? require('./reto_fv.js') : PCT.fvReto;
  const K = enNode ? require('./cuaderno_fv.js') : PCT.fvCuaderno;
  const layout = enNode ? require('../layout.js') : PCT.fvLayout;
  const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nota1 = n => n.toFixed(1).replace('.', ',');
  const reloj = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  /** Texto para el alumno del resultado del envío al aula: { estado: HTTP | 0, cuerpo } → { ok, texto }. */
  function textoEnvio(estado, cuerpo) {
    if (estado === 'local') return { ok: false, texto: 'Estás en local (fuera del aula): el resultado no se envía al profesor. Queda guardado en este equipo.' };
    if (estado === 200 && cuerpo && cuerpo.guardado) return { ok: true, texto: 'Resultado guardado en el aula: tu profesor ya puede verlo.' };
    if (estado === 204) return { ok: false, texto: 'No se pudo guardar en el aula: tu sesión no es de alumno autorizado. Queda guardado en este equipo.' };
    if (estado === 400) return { ok: false, texto: `No se pudo guardar en el aula${cuerpo && cuerpo.error ? `: ${cuerpo.error}` : ''}. Queda guardado en este equipo.` };
    if (estado === 401 || estado === 403) return { ok: false, texto: 'No se pudo guardar en el aula: la sesión ha caducado. Entra otra vez. Queda guardado en este equipo.' };
    return { ok: false, texto: 'No se pudo guardar en el aula (sin conexión o error del servidor). Queda guardado en este equipo.' };
  }

  /**
   * Crea la hoja en `contenedor`. ctx: { cuaderno, catalogo, avisar(texto), empezar(reto) /* la página prepara la instalación y activa la avería *\/, revelar() /* la página
   * deja de ocultar *\/, terminar() /* la página quita la avería y restaura *\/, almacen (localStorage) }.
   * Devuelve { entrar(), salir(), fase(), averia() /* para la página, no para la pantalla *\/, anotarPeligro(texto), actualizar(), oculto() }.
   */
  function crear(contenedor, ctx) {
    const cuaderno = ctx.cuaderno;
    let fase = 'inicio', reto = null, firma = null, inicioMs = 0, pistas = 0, peligros = [], intento = 1, resultado = null, buscado = false, delProfesor = null, hoja = { sintoma: '', elemento: '', averia: '', reparacion: '' }, semilla = 1;
    const barra = () => document.getElementById('aula-barra');
    const csrf = () => { const i = barra() && barra().querySelector('input[name=csrf]'); return i ? i.value : null; };
    const segundos = () => Math.max(0, Math.round((Date.now() - inicioMs) / 1000));

    async function buscarReto() {
      buscado = true; delProfesor = null;
      if (!barra()) return;      // en local no hay aula a la que preguntar
      try { const r = await fetch('/api/reto?sim=' + R.SIM, { credentials: 'same-origin', headers: { Accept: 'application/json' } }); if (r.ok) delProfesor = R.leerReto(await r.json()); } catch (error) { /* sin aula o sin conexión: queda la práctica libre */ }
    }
    function empezar(r) {
      reto = r; firma = R.firmaDe(r.averia, ctx.catalogo); fase = 'curso'; inicioMs = Date.now(); pistas = 0; peligros = []; intento = 1; resultado = null; semilla = (Date.now() % 100000) + 1;
      hoja = { sintoma: '', elemento: '', averia: '', reparacion: '' };
      cuaderno.limpiar(); ctx.empezar(r, firma); pintar();
      ctx.avisar('Reto en marcha: hay una avería oculta. Mide con los instrumentos, maniobra y rellena la hoja de diagnóstico.');
    }

    function htmlInicio() {
      const guardados = R.leerResultados(ctx.almacen);
      return `<section class="grupo-mando" aria-label="Reto de diagnóstico"><h2>RETO DE DIAGNÓSTICO</h2>
        <p class="aviso-profesor">La instalación tiene una <b>avería oculta</b>. No hay alarmas explicadas ni lecturas: solo las pantallas y los LED de los equipos, como en la realidad. Averigua qué pasa <b>midiendo</b> con los instrumentos del maletín y maniobrando, y entrega la hoja: se corrige al momento y da nota.</p>
        ${!buscado ? '<p class="aviso-profesor">Buscando el reto de tu profesor…</p>' : delProfesor ? `<p class="reto-profe"><b>Reto de tu profesor:</b> ${esc(delProfesor.titulo)}</p><div class="botones-fila"><button type="button" data-ac="profe" class="principal">Empezar el reto del profesor</button></div>` : `<p class="aviso-profesor">${barra() ? 'Tu profesor no te ha asignado ningún reto ahora mismo.' : 'Estás en local: no hay retos del profesor.'}</p>`}
        <div class="botones-fila"><button type="button" data-ac="azar"${delProfesor ? '' : ' class="principal"'}>Practicar con una avería al azar</button></div></section>
        ${guardados.length ? `<details class="mis-resultados"><summary>Mis resultados en este equipo (${guardados.length})</summary><ul>${guardados.map(g => `<li><b>${esc(nota1(Number(g.nota) || 0))}</b> · ${esc(g.fecha || '')} · ${esc(g.titulo || '')} · ${g.acierto === 1 ? 'acertada' : g.acierto === 0.5 ? 'acierto parcial' : 'no acertada'}${g.intento > 1 ? ` · intento ${g.intento}` : ''}</li>`).join('')}</ul></details>` : ''}`;
    }
    function htmlHoja() {
      const averias = R.barajar(layout.AVERIAS, semilla), conPistas = reto.pistas !== false;
      return `<section class="grupo-mando hoja" aria-label="Hoja de diagnóstico"><h2>HOJA DE DIAGNÓSTICO${intento > 1 ? ` · INTENTO ${intento}` : ''}</h2>
        <p class="reto-cab"><b>${esc(reto.titulo)}</b><span>Tiempo <output class="h-tiempo">0:00</output> · Medidas <output class="h-medidas">0</output></span></p>
        ${R.textoEscenario(firma.escenario) ? `<p class="reto-condiciones"><b>Condiciones del reto:</b> ${esc(R.textoEscenario(firma.escenario))}. Puedes cambiar la fecha, la hora y la nubosidad en la pestaña Mando.</p>` : ''}
        <label class="h-campo">1 · Síntoma observado <small>(qué ves que no va bien, sin instrumentos)</small><textarea data-h="sintoma" rows="2" maxlength="600">${esc(hoja.sintoma)}</textarea></label>
        <div class="h-campo"><span>2 · Medidas que lo demuestran <small>(márcalas en tu cuaderno)</small></span><ul class="h-evidencias"></ul></div>
        <label class="h-campo">3 · Elemento averiado<select data-h="elemento"><option value="">— elige el equipo —</option>${layout.EQUIPOS.map(q => `<option value="${q.tag}"${hoja.elemento === q.tag ? ' selected' : ''}>${q.tag} · ${esc(q.nombre)}</option>`).join('')}</select></label>
        <label class="h-campo">4 · Avería<select data-h="averia"><option value="">— elige la avería —</option>${averias.map(a => `<option value="${a.id}"${hoja.averia === a.id ? ' selected' : ''}>${esc(a.titulo)}</option>`).join('')}</select></label>
        <label class="h-campo">5 · Cómo la repararías<textarea data-h="reparacion" rows="2" maxlength="600">${esc(hoja.reparacion)}</textarea></label>
        <div class="h-pistas"><h3>Pistas <small>(cada una resta ${R.PUNTOS.pista} punto)</small></h3>${conPistas ? `<ol>${firma.pistas.slice(0, pistas).map(p => `<li>${esc(p)}</li>`).join('')}</ol>${pistas < Math.min(3, firma.pistas.length) ? `<div class="botones-fila"><button type="button" data-ac="pista">Pedir la pista ${pistas + 1}</button></div>` : '<p class="aviso-profesor">No quedan más pistas.</p>'}` : '<p class="aviso-profesor">Tu profesor ha desactivado las pistas en este reto.</p>'}</div>
        ${peligros.length ? `<p class="h-peligros">⚠ Maniobras o medidas peligrosas: ${peligros.length}</p>` : ''}
        <div class="botones-fila"><button type="button" data-ac="entregar" class="principal">Entregar</button><button type="button" data-ac="abandonar">Abandonar el reto</button></div></section>`;
    }
    function htmlResultado() {
      const r = resultado, c = r.correccion, revelado = fase === 'revelado', a = layout.AVERIAS.find(x => x.id === reto.averia);
      const titular = c.acierto === 1 ? '✔ Diagnóstico correcto' : c.acierto === 0.5 ? '◐ Diagnóstico parcialmente correcto' : '✖ Diagnóstico incorrecto';
      return `<section class="grupo-mando hoja resultado a-${String(c.acierto).replace('.', '')}" aria-label="Corrección"><h2>CORRECCIÓN${intento > 1 ? ` · INTENTO ${intento}` : ''}</h2>
        <p class="nota-grande"><b>${nota1(r.nota)}</b><span>sobre 10</span></p><p class="titular">${titular}</p>
        <table class="desglose"><tbody>${r.desglose.map(f => `<tr class="${f.puntos < 0 ? 'resta' : ''}"><th scope="row">${esc(f.concepto)}<small>${esc(f.detalle)}</small></th><td>${f.puntos > 0 ? '+' : ''}${String(f.puntos).replace('.', ',')}${f.max ? `<small> / ${String(f.max).replace('.', ',')}</small>` : ''}</td></tr>`).join('')}</tbody></table>
        <p class="envio ${r.envio && r.envio.ok ? 'ok' : ''}" role="status">${esc(r.envio ? r.envio.texto : 'Enviando el resultado al aula…')}</p>
        ${revelado ? `<div class="explicacion"><h3>La avería era</h3><p><b>${esc(a ? a.titulo : reto.averia)}</b> <small>(${esc(a ? a.tag : '')})</small></p><p>${esc(firma.explicacion)}</p>
          ${r.claves.length ? `<h3>Qué medidas la demuestran</h3><ul class="claves">${r.claves.map(k => `<li class="${k.hecha ? 'hecha' : 'falta'}">${k.hecha ? '✔' : '✖'} ${esc(k.texto)}${k.como === 'equivalente' ? ' <small>(hiciste una equivalente)</small>' : ''}</li>`).join('')}</ul>` : ''}
          <p class="aviso-profesor">Ya no se oculta nada: vuelven las lecturas, las alarmas y las gráficas. Repara la avería en el sinóptico (sustituir, rearmar) o en el panel Mando y comprueba que la instalación se recupera.</p></div>` : ''}
        <div class="botones-fila">${!revelado ? '<button type="button" data-ac="reintentar" class="principal">Reintentar (nuevo intento)</button><button type="button" data-ac="revelar">Ver la avería y repararla</button>' : '<button type="button" data-ac="nuevo" class="principal">Nuevo reto</button>'}</div></section>`;
    }
    function pintarEvidencias() {
      const ul = contenedor.querySelector('.h-evidencias'); if (!ul) return;
      const L = cuaderno.lista().slice().reverse();
      ul.innerHTML = L.length ? L.map(e => `<li><label><input type="checkbox" data-ev="${e.id}"${e.evidencia ? ' checked' : ''}> <span>${esc(K.textoEntrada(e))}${e.nota ? ` <small>— ${esc(e.nota)}</small>` : ''}</span></label></li>`).join('') : '<li class="vacio">Aún no has medido nada: abre el maletín (botón «Instrumentos») y mide.</li>';
    }
    function pintar() {
      contenedor.innerHTML = fase === 'inicio' ? htmlInicio() : fase === 'curso' ? htmlHoja() : htmlResultado();
      pintarEvidencias(); actualizar();
    }

    async function entregar() {
      if (!hoja.elemento || !hoja.averia) { ctx.avisar('Antes de entregar elige el elemento averiado y la avería (puntos 3 y 4 de la hoja).'); return; }
      const entradas = cuaderno.lista(), claves = R.medidasClaveHechas(firma.medidasClave, entradas), s = segundos();
      const correccion = R.corregir({ real: reto.averia, averiaRespuesta: hoja.averia, elementoRespuesta: hoja.elemento, distractores: firma.distractores });
      const evidencias = cuaderno.evidencias();
      const { nota, desglose } = R.calcularNota({ correccion, clavesHechas: claves.filter(k => k.hecha).length, clavesTotal: claves.length, medidas: cuaderno.total, pistas, peligros: peligros.length, segundos: s, intento, sintoma: hoja.sintoma, reparacion: hoja.reparacion, evidencias: evidencias.length });
      resultado = { nota, desglose, correccion, claves, envio: null };
      fase = correccion.acierto === 1 ? 'revelado' : 'entregado';
      R.guardarResultado(ctx.almacen, { fecha: new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }), titulo: reto.titulo, reto: reto.id, nota, acierto: correccion.acierto, pistas, medidas: cuaderno.total, segundos: s, intento });
      if (fase === 'revelado') ctx.revelar();
      pintar();
      const token = csrf(), esteResultado = resultado;
      if (token === null) esteResultado.envio = textoEnvio('local');
      else {
        const cuerpo = R.codificarEnvio({ csrf: token, reto: reto.id, averiaReal: reto.averia, averiaRespuesta: hoja.averia, elementoRespuesta: hoja.elemento, acierto: correccion.acierto, nota, pistas, medidas: cuaderno.total, segundos: s,
          detalle: R.detalleJson({ sintoma: hoja.sintoma, reparacion: hoja.reparacion, evidencias: evidencias.map(e => K.textoEntrada(e) + (e.nota ? ` — ${e.nota}` : '')), intento, peligros: peligros.length, titulo: reto.titulo }) });
        try {
          const r = await fetch('/api/reto/resultado', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: cuerpo });
          let json = null; if (r.status !== 204) { try { json = await r.json(); } catch (error) { json = null; } }
          esteResultado.envio = textoEnvio(r.status, json);
        } catch (error) { esteResultado.envio = textoEnvio(0); }
      }
      if (resultado === esteResultado && fase !== 'curso' && fase !== 'inicio') { const p = contenedor.querySelector('.envio'); if (p) { p.textContent = esteResultado.envio.texto; p.classList.toggle('ok', esteResultado.envio.ok); } }
    }

    contenedor.addEventListener('click', ev => {
      const b = ev.target.closest('button[data-ac]'); if (!b) return;
      const ac = b.dataset.ac;
      if (ac === 'azar') empezar(R.retoLibre());
      else if (ac === 'profe' && delProfesor) empezar(delProfesor);
      else if (ac === 'pista') { if (pistas < 3) { pistas++; pintar(); } }
      else if (ac === 'entregar') entregar();
      else if (ac === 'abandonar') { terminar(); ctx.avisar('Reto abandonado: la instalación vuelve a estar sana.'); }
      else if (ac === 'reintentar') { intento++; fase = 'curso'; resultado = null; pintar(); ctx.avisar(`Intento ${intento}: sigue midiendo y corrige tu hoja.`); }
      else if (ac === 'revelar') { fase = 'revelado'; ctx.revelar(); pintar(); }
      else if (ac === 'nuevo') terminar();
    });
    contenedor.addEventListener('input', ev => { const el = ev.target; if (el.dataset && el.dataset.h) hoja[el.dataset.h] = el.value; });
    contenedor.addEventListener('change', ev => { const el = ev.target; if (el.dataset && el.dataset.ev) cuaderno.marcar(el.dataset.ev, el.checked); else if (el.dataset && el.dataset.h) hoja[el.dataset.h] = el.value; });
    cuaderno.alCambiar(() => { if (fase === 'curso' && !(contenedor.contains(document.activeElement) && document.activeElement.dataset.ev)) pintarEvidencias(); });

    function terminar() { const habia = !!reto; reto = null; firma = null; resultado = null; fase = 'inicio'; if (habia) ctx.terminar(); buscado = false; pintar(); buscarReto().then(() => { if (fase === 'inicio') pintar(); }); }
    /** Al entrar en el modo Diagnóstico: se busca el reto del profesor (si la página está en el aula). */
    function entrar() { if (fase !== 'inicio') return; buscado = false; pintar(); buscarReto().then(() => { if (fase === 'inicio') pintar(); }); }
    /** Al salir del modo: el reto en curso se abandona (la página restaura la instalación). */
    function salir() { reto = null; firma = null; resultado = null; fase = 'inicio'; }
    function actualizar() {
      if (fase !== 'curso') return;
      const t = contenedor.querySelector('.h-tiempo'), m = contenedor.querySelector('.h-medidas');
      if (t && t.textContent !== reloj(segundos())) t.textContent = reloj(segundos());
      if (m && m.textContent !== String(cuaderno.total)) m.textContent = String(cuaderno.total);
    }
    function anotarPeligro(texto) { if (fase !== 'curso') return; peligros.push(texto); const p = contenedor.querySelector('.h-peligros'); if (p) p.textContent = `⚠ Maniobras o medidas peligrosas: ${peligros.length}`; else { const s = contenedor.querySelector('.h-pistas'); if (s) s.insertAdjacentHTML('afterend', `<p class="h-peligros">⚠ Maniobras o medidas peligrosas: ${peligros.length}</p>`); } }

    pintar();
    return { entrar, salir, fase: () => fase, averia: () => (reto ? reto.averia : null), firma: () => firma, oculto: () => fase === 'inicio' || fase === 'curso' || fase === 'entregado', anotarPeligro, actualizar };
  }

  const api = { textoEnvio, crear };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') (window.PCT = window.PCT || {}).fvPanelDiagnostico = api;
})();
