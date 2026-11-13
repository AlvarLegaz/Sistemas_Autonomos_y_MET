// Maletín de instrumentos de la instalación fotovoltaica (parte con DOM; la lógica de cada aparato está en instrumentos_fv.js y el cuaderno en cuaderno_fv.js).
//   · El botón «Instrumentos» de la cabecera y la pestaña «Instrumentos» del lateral abren el MALETÍN: multímetro, pinza, megóhmetro, trazador I-V y cámara termográfica.
//   · Al coger uno queda «en la mano»: una ventanita fija (abajo a la derecha) con su pantalla y sus mandos, y sobre el sinóptico aparecen los PUNTOS DE MEDIDA (multímetro),
//     los CABLES que se pueden abrazar (pinza) o la VISTA TÉRMICA (cámara). Un toque en el sinóptico MIDE (no acciona el equipo); el botón «Maniobrar» de la ventanita
//     deja pasar los toques para abrir un seccionador sin soltar el instrumento.
//   · Pensado para el dedo: si el toque cae cerca de varios puntos, el instrumento pregunta cuál con botones grandes; tocar un equipo lista sus bornes; y todo se puede
//     elegir también en listas desplegables (teclado y lector de pantalla). Nada depende de pasar el ratón por encima.
//   · Cada medida se apunta sola en el CUADERNO (pestaña Instrumentos), donde se anota, se marca como evidencia y se borra.
(function () {
  const enNode = typeof require !== 'undefined';
  const I = enNode ? require('./instrumentos_fv.js') : PCT.fvInstrumentos;
  const E = enNode ? require('../scada2d/esquema_fv.js') : PCT.fvEsquema;
  const K = enNode ? require('./cuaderno_fv.js') : PCT.fvCuaderno;
  const F = enNode ? require('./formato_fv.js') : PCT.fvFormato;
  const NS = 'http://www.w3.org/2000/svg', ANCHO = 1740, RADIO_TOQUE_PX = 24;
  const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /**
   * Qué hacer con un toque: `cerca` son los ids a menos del radio (del más cercano al más lejano) con su distancia en píxeles de pantalla [{ id, px }].
   * → { elegido } si uno está claramente más cerca que los demás, { dudas: [ids] } si hay que preguntar (hasta 6) o {} si no hay ninguno.
   */
  function resolverToque(cerca) {
    if (!cerca || !cerca.length) return {};
    if (cerca.length === 1 || (cerca[0].px <= 9 && cerca[1].px > 2.2 * Math.max(4, cerca[0].px))) return { elegido: cerca[0].id };
    return { dudas: cerca.slice(0, 6).map(c => c.id) };
  }
  /**
   * ¿Ha cambiado la lectura lo bastante como para apuntarla otra vez sin que el alumno mueva el instrumento? (p. ej. abre el seccionador con las puntas puestas y la
   * continuidad pasa de «peligro» a «OL»). Cambia si aparece o desaparece el peligro, si pasa de abierto a cerrado, o si el valor varía más de un 15 % (y más de `minimo`).
   */
  function cambioNotable(antes, ahora, minimo = 1) {
    if (!antes || !ahora || !ahora.ok) return false;
    if (!!antes.peligro !== !!ahora.peligro) return true;
    const a = antes.valor, b = ahora.valor;
    if ((a === Infinity) !== (b === Infinity)) return true;
    if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) return (a === null) !== (b === null);
    return Math.abs(b - a) > Math.max(minimo, 0.15 * Math.max(Math.abs(a), Math.abs(b)));
  }
  /** Opciones de un desplegable de puntos agrupadas por equipo: [{ equipo, puntos: [{ id, descripcion }] }]. */
  function gruposDePuntos(puntos) {
    const G = new Map();
    for (const p of puntos || []) { const q = p.equipo || E.equipoDePunto(p.id) || 'Otros'; if (!G.has(q)) G.set(q, []); G.get(q).push({ id: p.id, descripcion: p.descripcion || p.id }); }
    return [...G.entries()].map(([equipo, pts]) => ({ equipo, puntos: pts }));
  }

  /**
   * Crea el maletín. ctx: { sim(), svg, pestana (elemento del panel de la pestaña), cuaderno, avisar(texto), alPeligro(texto, lectura), alCoger(id | null) }.
   * Devuelve { coger(id), guardar(), enMano(), actualizar(), abrirMaletin(origen), pintarCuaderno() }.
   */
  function crear(ctx) {
    const sim = () => ctx.sim(), svg = ctx.svg, cuaderno = ctx.cuaderno;
    let enMano = null, maniobrar = false, ultimaLectura = null;
    const multi = { modo: 'VDC', roja: null, negra: null, activa: 'roja' }, pinza = { modo: 'DC', id: null }, meg = { id: 'STR-201.+', lectura: null }, traz = { cadena: 'STR-101', lectura: null }, cam = { id: null };

    /* ----- capa sobre el sinóptico ----- */
    const capa = document.createElementNS(NS, 'g'); capa.setAttribute('id', 'capa-instrumentos'); svg.appendChild(capa);
    const gTermica = document.createElementNS(NS, 'g'), gObjetivos = document.createElementNS(NS, 'g'), gPuntas = document.createElementNS(NS, 'g');
    gTermica.setAttribute('class', 'capa-termica'); gObjetivos.setAttribute('class', 'capa-objetivos'); gPuntas.setAttribute('class', 'capa-puntas'); capa.append(gTermica, gObjetivos, gPuntas);
    const escala = () => (svg.getBoundingClientRect().width / ANCHO) || 1;
    const nodo = (tag, attrs, padre) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (padre) padre.appendChild(n); return n; };
    let objetivos = [];      // [{ id, x, y }] en unidades del dibujo
    function pintarObjetivos(mapa, ids, clase) {
      gObjetivos.replaceChildren(); objetivos = [];
      for (const id of ids) {
        const q = mapa[id]; if (!q) continue;
        const g = nodo('g', { class: `objetivo ${clase}`, 'data-id': id }, gObjetivos);
        nodo('circle', { cx: q[0], cy: q[1], r: q[2].length > 1 ? 7.5 : 6.5 }, g);
        const t = nodo('text', { x: q[0], y: q[1] + 3 }, g); t.textContent = q[2];
        objetivos.push({ id, x: q[0], y: q[1] });
      }
    }
    function pintarPuntas() {
      gPuntas.replaceChildren();
      for (const o of gObjetivos.querySelectorAll('.objetivo')) o.classList.remove('roja', 'negra', 'elegido');
      const marcar = (id, clase) => { const o = id && gObjetivos.querySelector(`.objetivo[data-id="${CSS.escape(id)}"]`); if (!o) return; o.classList.add(clase); const c = o.querySelector('circle'); nodo('circle', { class: `punta-marca ${clase}`, cx: c.getAttribute('cx'), cy: c.getAttribute('cy'), r: 11 }, gPuntas); };
      if (enMano === 'multimetro') { marcar(multi.roja, 'roja'); marcar(multi.negra, 'negra'); }
      if (enMano === 'pinza') marcar(pinza.id, 'elegido');
    }
    // vista térmica: una forma por elemento de sim.termografia(), coloreada con la paleta de la cámara
    let zonasDom = new Map();
    function pintarTermica() {
      const zonas = I.mapaTermico(sim()), ids = zonas.map(z => z.id).join('|');
      if (pintarTermica.ids !== ids) {
        pintarTermica.ids = ids; gTermica.replaceChildren(); zonasDom = new Map();
        const conSub = new Set(zonas.filter(z => z.tipo === 'subcadena').map(z => String(z.id).split('.')[0]));
        const geo = zonas.map(z => ({ z, g: z.tipo === 'panel' && conSub.has(z.id) ? null : E.zonaTermica(z.id, z.tipo, z.tag) })).filter(x => x.g)
          .sort((a, b) => (b.g.forma === 'rect' ? b.g.w * b.g.h : 0) - (a.g.forma === 'rect' ? a.g.w * a.g.h : 0));      // las grandes debajo, las pequeñas y los conectores encima
        for (const { z, g } of geo) {
          const el = g.forma === 'circulo' ? nodo('circle', { cx: g.x, cy: g.y, r: g.r }, gTermica) : nodo('rect', { x: g.x, y: g.y, width: g.w, height: g.h, rx: 2 }, gTermica);
          el.setAttribute('class', `zona-termica${g.forma === 'circulo' ? ' conector' : ''}`); el.dataset.zona = z.id;
          zonasDom.set(z.id, { el, x: g.forma === 'circulo' ? g.x : g.x + g.w / 2, y: g.forma === 'circulo' ? g.y : g.y + g.h / 2, conector: g.forma === 'circulo' });
        }
        for (const [x, t] of [[640, 'aire de la caseta'], [1010, 'rejilla']]) { const tx = nodo('text', { x: x + 126, y: 28, class: 'rotulo-termico' }, gTermica); tx.textContent = t; }
      }
      const esc_ = I.escalaTermica(zonas), calientes = new Set(I.puntosCalientes(zonas));
      for (const z of zonas) { const d = zonasDom.get(z.id); if (!d) continue; const c = I.colorTermico(z.tempC, esc_); if (d.color !== c) { d.color = c; d.el.style.fill = c; } d.el.classList.toggle('caliente', calientes.has(z.id)); d.el.classList.toggle('elegida', z.id === cam.id); }
      return { zonas, escala: esc_ };
    }

    /* ----- ventanita del instrumento en la mano ----- */
    const mano = document.createElement('section');
    mano.id = 'instrumento-mano'; mano.hidden = true; mano.setAttribute('aria-label', 'Instrumento en la mano');
    mano.innerHTML = '<header><b class="im-nombre"></b><button type="button" class="im-toque" aria-pressed="false" title="Deja pasar los toques al sinóptico para abrir o cerrar un interruptor sin soltar el instrumento">Maniobrar</button>' +
      '<button type="button" class="im-guardar" aria-label="Guardar el instrumento en el maletín" title="Guardar el instrumento">×</button></header><div class="im-cuerpo"></div><div class="im-elegir" hidden></div><ul class="im-avisos" aria-live="polite"></ul>';
    document.body.appendChild(mano);
    const $ = s => mano.querySelector(s), cuerpo = $('.im-cuerpo'), elegir = $('.im-elegir'), avisosUl = $('.im-avisos');
    const poner = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
    const lcd = '<div class="lcd" role="status" aria-live="off"><span class="lcd-valor">— — —</span><span class="lcd-unidad"></span></div>';
    const botonesModo = (modos, actual) => `<div class="im-modos" role="group" aria-label="Selector de función">${modos.map(m => `<button type="button" data-modo="${m.id}" aria-pressed="${m.id === actual}" title="${esc(m.titulo)}">${esc(m.nombre)}</button>`).join('')}</div>`;
    const opcionesPuntos = () => '<option value="">— elegir —</option>' + gruposDePuntos(sim().puntos).map(g => `<optgroup label="${esc(g.equipo)}">${g.puntos.map(p => `<option value="${esc(p.id)}">${esc(p.id)} · ${esc(p.descripcion)}</option>`).join('')}</optgroup>`).join('');
    const hora = () => { const e = sim().estado; return { t: e.t, hora: (e.reloj && e.reloj.texto) || '' }; };
    let apuntada = null;      // última lectura apuntada del instrumento en la mano (para apuntar sola una lectura que cambia mucho sin mover el instrumento)
    function apuntar(datos, lectura) {
      if (!lectura || lectura.noDisponible || (!lectura.ok && !lectura.bloqueado)) return;
      apuntada = { peligro: !!lectura.peligro, valor: lectura.valor, ok: lectura.ok };
      cuaderno.anadir(Object.assign(hora(), { valor: lectura.valor, unidad: lectura.unidad, texto: lectura.texto, peligro: !!lectura.peligro, valida: lectura.ok && lectura.valida !== false }, datos));
      if (lectura.peligro && ctx.alPeligro) ctx.alPeligro(lectura.avisos && lectura.avisos[0] ? lectura.avisos[0].texto : 'Medida peligrosa', lectura);
    }
    function pintarLectura(l) {
      ultimaLectura = l;
      const v = $('.lcd-valor'), u = $('.lcd-unidad');
      if (v) { poner(v, l ? l.pantalla || '— — —' : '— — —'); poner(u, l ? l.unidad || '' : ''); const caja = v.parentNode; caja.classList.toggle('peligro', !!(l && (l.peligro || l.bloqueado))); caja.setAttribute('aria-label', l ? `${l.pantalla || ''} ${l.unidad || ''}` : 'sin lectura'); }
      const firma = JSON.stringify(l ? l.avisos || [] : []);
      if (avisosUl.dataset.firma !== firma) { avisosUl.dataset.firma = firma; avisosUl.innerHTML = (l ? l.avisos || [] : []).map(a => `<li class="av-${a.nivel}">${a.nivel === 'peligro' ? '⚠ ' : ''}${esc(a.texto)}</li>`).join(''); }
    }
    function preguntar(ids, describir, alElegir, titulo = '¿Cuál de estos?') {
      elegir.hidden = false;
      elegir.innerHTML = `<p>${esc(titulo)}</p>${ids.map(id => `<button type="button" data-id="${esc(id)}"><b>${esc(id)}</b><small>${esc(describir(id))}</small></button>`).join('')}<button type="button" data-id="" class="cancelar">Ninguno</button>`;
      elegir.onclick = ev => { const b = ev.target.closest('button'); if (!b) return; elegir.hidden = true; elegir.innerHTML = ''; if (b.dataset.id) alElegir(b.dataset.id); };
      const primero = elegir.querySelector('button'); if (primero && document.activeElement && mano.contains(document.activeElement)) primero.focus();
    }
    const cerrarPregunta = () => { elegir.hidden = true; elegir.innerHTML = ''; };

    /* ----- multímetro ----- */
    const describirPunto = id => I.descripcionPunto(sim(), id);
    function montarMultimetro() {
      cuerpo.innerHTML = `<div class="im-fila">${lcd}${botonesModo(I.MODOS_MULTIMETRO, multi.modo)}</div>
        <div class="im-puntas"><button type="button" class="punta roja" data-punta="roja" aria-pressed="true"><span aria-hidden="true">●</span> Roja <b>—</b></button><button type="button" class="punta negra" data-punta="negra" aria-pressed="false"><span aria-hidden="true">●</span> Negra <b>—</b></button><button type="button" class="im-cambiar" title="Intercambiar las puntas" aria-label="Intercambiar las puntas">⇄</button></div>
        <details class="im-lista"><summary>Elegir los puntos en una lista</summary><label>Punta roja<select data-sel="roja">${opcionesPuntos()}</select></label><label>Punta negra<select data-sel="negra">${opcionesPuntos()}</select></label></details>`;
      pintarObjetivos(E.PUNTOS_XY, (sim().puntos || []).map(p => p.id), 'punto');
      refrescarMultimetro(false);
    }
    function ponerPunta(id, cual = multi.activa) {
      multi[cual] = id; multi.activa = cual === 'roja' ? 'negra' : 'roja'; cerrarPregunta();
      refrescarMultimetro(true);
    }
    function refrescarMultimetro(apunta) {
      for (const c of ['roja', 'negra']) { const b = cuerpo.querySelector(`[data-punta="${c}"]`); if (!b) return; poner(b.querySelector('b'), multi[c] || '—'); b.setAttribute('aria-pressed', String(multi.activa === c)); b.title = multi[c] ? describirPunto(multi[c]) : `Toca aquí y luego un punto del sinóptico para colocar la punta ${c}`; const s = cuerpo.querySelector(`[data-sel="${c}"]`); if (s && s.value !== (multi[c] || '')) s.value = multi[c] || ''; }
      cuerpo.querySelectorAll('.im-modos button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.modo === multi.modo)));
      pintarPuntas();
      const l = I.lecturaMultimetro(sim(), multi.modo, multi.roja, multi.negra); pintarLectura(l);
      if (apunta && multi.roja && multi.negra) apuntar({ instrumento: 'multimetro', modo: multi.modo, modoTexto: (I.MODOS_MULTIMETRO.find(m => m.id === multi.modo) || {}).nombre, puntos: [multi.roja, multi.negra] }, l);
    }

    /* ----- pinza ----- */
    const conductores = () => I.conductores(sim());
    const describirConductor = id => (conductores().find(c => c.id === id) || {}).descripcion || id;
    function montarPinza() {
      const L = conductores();
      cuerpo.innerHTML = `<div class="im-fila">${lcd}${botonesModo(I.MODOS_PINZA, pinza.modo)}</div><p class="im-sel">Cable: <b>—</b> <small></small></p>
        ${L.length ? `<details class="im-lista"><summary>Elegir el cable en una lista</summary><label>Conductor<select data-sel="conductor"><option value="">— elegir —</option>${L.map(c => `<option value="${esc(c.id)}">${esc(c.id)} · ${esc(c.descripcion)}</option>`).join('')}</select></label></details>` : ''}`;
      pintarObjetivos(E.PINZA_XY, L.map(c => c.id), 'cable');
      refrescarPinza(false);
    }
    function refrescarPinza(apunta) {
      const p = cuerpo.querySelector('.im-sel'); if (!p) return;
      poner(p.querySelector('b'), pinza.id || '—'); poner(p.querySelector('small'), pinza.id ? describirConductor(pinza.id) : '');
      const s = cuerpo.querySelector('[data-sel="conductor"]'); if (s && s.value !== (pinza.id || '')) s.value = pinza.id || '';
      cuerpo.querySelectorAll('.im-modos button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.modo === pinza.modo)));
      pintarPuntas();
      const l = I.tiene(sim(), 'corriente') || pinza.id ? I.lecturaPinza(sim(), pinza.id, pinza.modo) : I.lecturaPinza(sim(), 'x', pinza.modo); pintarLectura(l);
      if (apunta && pinza.id) apuntar({ instrumento: 'pinza', modo: pinza.modo, modoTexto: (I.MODOS_PINZA.find(m => m.id === pinza.modo) || {}).nombre, puntos: [pinza.id] }, l);
    }

    /* ----- megóhmetro ----- */
    function montarMegohmetro() {
      const pts = Array.isArray(sim().puntosAislamiento) && sim().puntosAislamiento.length ? sim().puntosAislamiento : I.CADENAS.flatMap(c => ['+', '-'].map(s => ({ id: `${c}.${s}`, descripcion: `${s === '+' ? 'Positivo' : 'Negativo'} de ${c} a tierra` })));
      if (!pts.some(p => p.id === meg.id)) meg.id = pts[0].id;
      cuerpo.innerHTML = `<div class="im-fila">${lcd}<button type="button" class="im-accion" data-accion="ensayar">Ensayar</button></div>
        <label class="im-campo">Polo que se ensaya contra tierra<select data-sel="aislamiento">${pts.map(p => `<option value="${esc(p.id)}"${p.id === meg.id ? ' selected' : ''}>${esc(p.id)} · ${esc(p.descripcion || '')}</option>`).join('')}</select></label>
        <p class="im-nota">Toca una cadena del sinóptico para elegirla. El ensayo inyecta alta tensión: exige el seccionador del campo ABIERTO.</p>`;
      gObjetivos.replaceChildren(); objetivos = []; pintarPuntas();
      pintarLectura(meg.lectura || { pantalla: '— — —', unidad: 'MΩ', avisos: [{ nivel: 'info', texto: 'Elige el polo y pulsa «Ensayar».' }] });
    }
    function ensayar() {
      const [cadena, polo] = [meg.id.split('.')[0], meg.id.split('.')[1] || '+'];
      meg.lectura = I.lecturaMegohmetro(sim(), cadena, polo); pintarLectura(meg.lectura);
      apuntar({ instrumento: 'megohmetro', puntos: [meg.id] }, meg.lectura);
    }

    /* ----- trazador I-V ----- */
    function montarTrazador() {
      cuerpo.innerHTML = `<div class="im-fila"><label class="im-campo">Cadena<select data-sel="cadena">${I.CADENAS.map(c => `<option${c === traz.cadena ? ' selected' : ''}>${c}</option>`).join('')}</select></label><button type="button" class="im-accion" data-accion="trazar">Trazar curva</button></div>
        <canvas class="im-curva" width="340" height="170" role="img" aria-label="Curva I-V medida y de referencia"></canvas>
        <p class="im-leyenda"><i class="l-medida"></i>medida <i class="l-ref"></i>referencia (cadena sana con esta luz) <i class="l-mpp"></i>máxima potencia</p><div class="im-tabla"></div>
        <p class="im-nota">Toca una cadena o un panel del sinóptico para elegirla.</p>`;
      gObjetivos.replaceChildren(); objetivos = []; pintarPuntas();
      pintarTrazador();
    }
    function trazar() {
      traz.lectura = I.lecturaTrazador(sim(), traz.cadena, 80); traz.lectura.cadena = traz.cadena; pintarTrazador();
      if (traz.lectura.ok) apuntar({ instrumento: 'trazadorIV', puntos: [traz.cadena] }, traz.lectura);
    }
    function pintarTrazador() {
      const l = traz.lectura && traz.lectura.cadena === traz.cadena ? traz.lectura : null, lienzo = cuerpo.querySelector('canvas'), tabla = cuerpo.querySelector('.im-tabla'); if (!lienzo) return;
      const css = getComputedStyle(document.documentElement), col = (n, d) => css.getPropertyValue(n).trim() || d;
      const c = lienzo.getContext('2d'), w = lienzo.width, h = lienzo.height, x0 = 34, y0 = h - 20, aw = w - x0 - 8, ah = y0 - 8;
      c.clearRect(0, 0, w, h); c.fillStyle = col('--panel', '#222'); c.fillRect(0, 0, w, h);
      const curva = l && l.ok ? l.curva : [], ref = l && l.ok && l.referencia ? l.referencia : [];
      const vMax = Math.max(10, ...curva.concat(ref).map(q => q.v)) * 1.04, iMax = Math.max(1, ...curva.concat(ref).map(q => q.i)) * 1.12;
      c.strokeStyle = col('--borde', '#555'); c.fillStyle = col('--tenue', '#999'); c.lineWidth = 1; c.font = '10px system-ui,sans-serif';
      c.beginPath(); c.moveTo(x0, 8); c.lineTo(x0, y0); c.lineTo(x0 + aw, y0); c.stroke();
      c.textAlign = 'right'; for (let k = 0; k <= 2; k++) c.fillText(F.dec(iMax * k / 2, 1), x0 - 3, y0 - ah * k / 2 + 3);
      c.textAlign = 'center'; for (let k = 0; k <= 2; k++) c.fillText(F.dec(vMax * k / 2, 0), x0 + aw * k / 2 - (k === 2 ? 8 : 0), h - 6);
      c.textAlign = 'left'; c.fillText('A', 4, 12); c.textAlign = 'right'; c.fillText('V', w - 2, h - 6);
      const X = v => x0 + aw * v / vMax, Y = i => y0 - ah * i / iMax;
      const linea = (pts, color, dash, ancho) => { if (pts.length < 2) return; c.save(); c.strokeStyle = color; c.lineWidth = ancho; c.setLineDash(dash); c.beginPath(); pts.forEach((q, k) => (k ? c.lineTo(X(q.v), Y(Math.max(0, q.i))) : c.moveTo(X(q.v), Y(Math.max(0, q.i))))); c.stroke(); c.restore(); };
      linea(ref, col('--tenue', '#999'), [5, 4], 1.5); linea(curva, col('--fv', '#C98F00'), [], 2.5);
      if (l && l.ok && l.resumen.pmpp > 1) { c.fillStyle = col('--error', '#c00'); c.beginPath(); c.arc(X(l.resumen.vmpp), Y(l.resumen.impp), 4, 0, 6.3); c.fill(); }
      if (!l) { tabla.innerHTML = ''; pintarLectura({ pantalla: '', unidad: '', avisos: [{ nivel: 'info', texto: `Pulsa «Trazar curva» para medir ${traz.cadena}. Hace falta sol: al menos 400 W/m² en el plano de los paneles.` }] }); return; }
      if (!l.ok) { tabla.innerHTML = ''; pintarLectura(l); return; }
      const r = l.resumen, q = l.resumenRef, f = (v, d) => F.dec(v, d), fila = (n, a, b, u) => `<tr><th scope="row">${n}</th><td>${a} ${u}</td><td>${b === null ? '—' : `${b} ${u}`}</td></tr>`;
      tabla.innerHTML = `<table><thead><tr><th></th><th scope="col">Medida</th><th scope="col">Referencia</th></tr></thead><tbody>${fila('Voc', f(r.voc, 1), q ? f(q.voc, 1) : null, 'V')}${fila('Isc', f(r.isc, 2), q ? f(q.isc, 2) : null, 'A')}${fila('Pmpp', f(r.pmpp, 0), q ? f(q.pmpp, 0) : null, 'W')}${fila('Factor de forma', f(r.ff, 2), q && q.ff ? f(q.ff, 2) : null, '')}</tbody></table>
        <p class="im-resumen">${l.desviacionPct === null ? '' : `Desviación de potencia: <b>${l.desviacionPct > 0 ? '+' : ''}${f(l.desviacionPct, 1)} %</b> · `}Escalones: <b>${r.escalones}</b>${F.num(l.irradiancia) ? ` · ${f(l.irradiancia, 0)} W/m²` : ''}${F.num(l.temperaturaCelulaC) ? ` · célula ${f(l.temperaturaCelulaC, 0)} °C` : ''}</p>`;
      pintarLectura(l);
    }

    /* ----- cámara termográfica ----- */
    function montarCamara() {
      cuerpo.innerHTML = `<div class="im-fila">${lcd}<div class="im-escala"><span class="esc-min"></span><i style="background:linear-gradient(90deg,${I.PALETA.map(p => `rgb(${p.join(',')})`).join(',')})"></i><span class="esc-max"></span></div></div><p class="im-sel">Zona: <b>—</b></p>
        <p class="im-nota">Toca un panel, un conector, un aparato o la batería para leer su temperatura. Los puntos calientes llevan un borde blanco.</p>`;
      gObjetivos.replaceChildren(); objetivos = []; pintarPuntas(); pintarTermica.ids = null;
      refrescarCamara(false);
    }
    function refrescarCamara(apunta) {
      const { zonas, escala: e } = pintarTermica();
      poner(cuerpo.querySelector('.esc-min'), `${e.min} °C`); poner(cuerpo.querySelector('.esc-max'), `${e.max} °C`);
      if (!zonas.length) { pintarLectura(I.lecturaTermografia(sim(), '')); return; }
      const z = zonas.find(x => x.id === cam.id);
      poner(cuerpo.querySelector('.im-sel b'), z ? `${z.id} · ${z.nombre}` : '—');
      const l = z ? I.lecturaTermografia(sim(), cam.id) : { pantalla: '— — —', unidad: '°C', avisos: [{ nivel: 'info', texto: 'Toca una zona de la imagen térmica.' }] };
      pintarLectura(l);
      if (apunta && z) apuntar({ instrumento: 'termografia', puntos: [cam.id] }, l);
    }

    /* ----- coger y guardar ----- */
    const MONTAR = { multimetro: montarMultimetro, pinza: montarPinza, megohmetro: montarMegohmetro, trazadorIV: montarTrazador, termografia: montarCamara };
    function coger(id) {
      if (!MONTAR[id]) return guardar();
      enMano = id; maniobrar = false; apuntada = null; cerrarPregunta(); avisosUl.dataset.firma = '';
      const inst = I.INSTRUMENTOS.find(x => x.id === id);
      poner($('.im-nombre'), inst.nombre); $('.im-toque').setAttribute('aria-pressed', 'false');
      mano.hidden = false; mano.dataset.instrumento = id;
      svg.classList.toggle('termica', id === 'termografia'); if (id !== 'termografia') gTermica.replaceChildren(), pintarTermica.ids = null;
      svg.classList.add('midiendo'); document.body.dataset.instrumento = id;
      MONTAR[id](); pintarMaletines();
      if (ctx.alCoger) ctx.alCoger(id);
    }
    function guardar() {
      if (!enMano) return;
      enMano = null; mano.hidden = true; cerrarPregunta(); gObjetivos.replaceChildren(); gPuntas.replaceChildren(); gTermica.replaceChildren(); pintarTermica.ids = null; objetivos = [];
      svg.classList.remove('midiendo', 'termica', 'maniobrando'); delete document.body.dataset.instrumento; pintarMaletines();
      if (ctx.alCoger) ctx.alCoger(null);
    }
    $('.im-guardar').addEventListener('click', guardar);
    $('.im-toque').addEventListener('click', () => { maniobrar = !maniobrar; $('.im-toque').setAttribute('aria-pressed', String(maniobrar)); svg.classList.toggle('maniobrando', maniobrar); ctx.avisar(maniobrar ? 'Maniobrar: ahora un toque en el sinóptico acciona el equipo (el instrumento sigue midiendo). Pulsa otra vez «Maniobrar» para volver a medir.' : 'Medir: un toque en el sinóptico coloca el instrumento.'); });
    cuerpo.addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.modo) { if (enMano === 'multimetro') { multi.modo = b.dataset.modo; refrescarMultimetro(true); } else if (enMano === 'pinza') { pinza.modo = b.dataset.modo; refrescarPinza(true); } }
      else if (b.dataset.punta) { multi.activa = b.dataset.punta; refrescarMultimetro(false); ctx.avisar(`Toca un punto del sinóptico para colocar la punta ${b.dataset.punta}.`); }
      else if (b.classList.contains('im-cambiar')) { [multi.roja, multi.negra] = [multi.negra, multi.roja]; refrescarMultimetro(true); }
      else if (b.dataset.accion === 'ensayar') ensayar();
      else if (b.dataset.accion === 'trazar') trazar();
    });
    cuerpo.addEventListener('change', ev => {
      const s = ev.target.closest('select'); if (!s) return;
      if (s.dataset.sel === 'roja' || s.dataset.sel === 'negra') { multi[s.dataset.sel] = s.value || null; refrescarMultimetro(true); }
      else if (s.dataset.sel === 'conductor') { pinza.id = s.value || null; refrescarPinza(true); }
      else if (s.dataset.sel === 'aislamiento') { meg.id = s.value; meg.lectura = null; pintarLectura({ pantalla: '— — —', unidad: 'MΩ', avisos: [{ nivel: 'info', texto: 'Pulsa «Ensayar».' }] }); }
      else if (s.dataset.sel === 'cadena') { traz.cadena = s.value; pintarTrazador(); }
    });

    /* ----- toques sobre el sinóptico con un instrumento en la mano (captura: antes de que el equipo se accione) ----- */
    function puntoDelToque(ev) { const m = svg.getScreenCTM(); if (!m) return null; const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; return p.matrixTransform(m.inverse()); }
    const cadenaDeTag = tag => (/^STR-/.test(tag) ? tag : (['A', 'B'].flatMap(c => PCT.fvLayout.CAMPOS[c].cadenas).find(s => s.paneles.includes(tag)) || {}).id || null);
    svg.addEventListener('click', ev => {
      if (!enMano || maniobrar) return;
      ev.stopImmediatePropagation(); ev.preventDefault();
      const p = puntoDelToque(ev), k = escala(), gEquipo = ev.target.closest ? ev.target.closest('g[data-tag]') : null, tag = gEquipo ? gEquipo.dataset.tag : null;
      const cerca = lista => (p ? lista.map(o => ({ id: o.id, px: Math.hypot(o.x - p.x, o.y - p.y) * k })).filter(o => o.px <= RADIO_TOQUE_PX).sort((a, b) => a.px - b.px) : []);
      if (enMano === 'multimetro' || enMano === 'pinza') {
        const esMulti = enMano === 'multimetro', poner_ = id => (esMulti ? ponerPunta(id) : (pinza.id = id, cerrarPregunta(), refrescarPinza(true))), describir = esMulti ? describirPunto : describirConductor;
        const r = resolverToque(cerca(objetivos));
        if (r.elegido) return poner_(r.elegido);
        if (r.dudas) return preguntar(r.dudas, describir, poner_, esMulti ? `¿En qué punto pongo la punta ${multi.activa}?` : '¿Qué cable abrazo?');
        const delEquipo = tag ? (esMulti ? E.puntosDeEquipo(tag, sim().puntos) : conductores().filter(c => c.equipo === tag || E.equipoDePunto(c.id) === tag).map(c => c.id)) : [];
        if (delEquipo.length === 1) return poner_(delEquipo[0]);
        if (delEquipo.length) return preguntar(delEquipo, describir, poner_, esMulti ? `Bornes de ${tag}: ¿dónde pongo la punta ${multi.activa}?` : `Cables de ${tag}: ¿cuál abrazo?`);
        ctx.avisar(esMulti ? 'Toca uno de los puntos de medida (círculos) o un equipo para ver sus bornes.' : 'Toca una de las marcas de los cables (círculos).');
        return;
      }
      if (enMano === 'megohmetro' || enMano === 'trazadorIV') {
        const cadena = tag ? cadenaDeTag(tag) : null;
        if (!cadena) { ctx.avisar('Toca una cadena o un panel para elegir la cadena.'); return; }
        if (enMano === 'trazadorIV') { traz.cadena = cadena; const s = cuerpo.querySelector('[data-sel="cadena"]'); if (s) s.value = cadena; trazar(); }
        else { const s = cuerpo.querySelector('[data-sel="aislamiento"]'), polo = meg.id.split('.')[1] || '+'; meg.id = `${cadena}.${polo}`; if (s) s.value = meg.id; meg.lectura = null; pintarLectura({ pantalla: '— — —', unidad: 'MΩ', avisos: [{ nivel: 'info', texto: `${meg.id} elegido. Pulsa «Ensayar».` }] }); }
        return;
      }
      if (enMano === 'termografia') {
        const bajo = ev.target.closest ? ev.target.closest('[data-zona]') : null;
        const con = cerca([...zonasDom.entries()].filter(([, d]) => d.conector).map(([id, d]) => ({ id, x: d.x, y: d.y })));
        const ids = [...new Set(con.map(c => c.id).concat(bajo && !con.some(c => c.id === bajo.dataset.zona) ? [bajo.dataset.zona] : []))];
        const elegirZona = id => { cam.id = id; cerrarPregunta(); refrescarCamara(true); };
        if (!ids.length) { ctx.avisar('Toca una zona coloreada de la imagen térmica.'); return; }
        if (ids.length === 1 || (bajo && bajo.classList.contains('conector'))) return elegirZona(bajo && bajo.classList.contains('conector') ? bajo.dataset.zona : ids[0]);
        const zonas = I.mapaTermico(sim());
        preguntar(ids.slice(0, 6), id => (zonas.find(z => z.id === id) || {}).nombre || id, elegirZona, '¿Qué zona mido?');
      }
    }, true);

    /* ----- maletín (pestaña y ventana emergente) y cuaderno ----- */
    const htmlMaletin = () => `<div class="maletin" role="group" aria-label="Instrumentos del maletín">${I.INSTRUMENTOS.map(x => `<button type="button" data-instrumento="${x.id}" aria-pressed="${enMano === x.id}" title="${esc(x.ayuda)}"><span class="ico" aria-hidden="true">${esc(x.icono)}</span><span>${esc(x.corto)}</span></button>`).join('')}</div>`;
    const pestana = ctx.pestana;
    pestana.innerHTML = `<section class="grupo-mando" aria-label="Maletín de instrumentos"><h2>MALETÍN DE INSTRUMENTOS</h2><div class="hueco-maletin"></div>
        <p class="aviso-profesor im-ayuda">Coge un instrumento y toca el sinóptico para medir. Cada medida se apunta sola en el cuaderno.</p><div class="botones-fila"><button type="button" class="guardar-instrumento" disabled>Guardar el instrumento</button></div></section>
      <section class="grupo-mando cuaderno" aria-label="Cuaderno de medidas"><h2 class="cuaderno-titulo">CUADERNO DE MEDIDAS</h2><ul class="lista-cuaderno"></ul><div class="botones-fila"><button type="button" class="vaciar-cuaderno">Vaciar el cuaderno</button></div></section>`;
    let ventana = null;
    function pintarMaletines() {
      pestana.querySelector('.hueco-maletin').innerHTML = htmlMaletin(); pestana.querySelector('.guardar-instrumento').disabled = !enMano;
      const inst = enMano && I.INSTRUMENTOS.find(x => x.id === enMano); poner(pestana.querySelector('.im-ayuda'), inst ? `En la mano: ${inst.nombre}. ${inst.ayuda}` : 'Coge un instrumento y toca el sinóptico para medir. Cada medida se apunta sola en el cuaderno.');
      if (ventana && !ventana.hidden) ventana.querySelector('.hueco-maletin').innerHTML = htmlMaletin();
    }
    const alElegirInstrumento = ev => { const b = ev.target.closest('[data-instrumento]'); if (!b) return false; if (enMano === b.dataset.instrumento) guardar(); else coger(b.dataset.instrumento); return true; };
    pestana.addEventListener('click', ev => {
      if (alElegirInstrumento(ev)) return;
      const b = ev.target.closest('button'); if (!b) return;
      if (b.classList.contains('guardar-instrumento')) guardar();
      else if (b.classList.contains('vaciar-cuaderno')) { cuaderno.limpiar(); ctx.avisar('Cuaderno vacío.'); }
      else if (b.dataset.borrar) cuaderno.borrar(b.dataset.borrar);
    });
    pestana.addEventListener('change', ev => {
      const el = ev.target;
      if (el.dataset.nota) cuaderno.anotar(el.dataset.nota, el.value);
      else if (el.dataset.evidencia) cuaderno.marcar(el.dataset.evidencia, el.checked);
    });
    function pintarCuaderno() {
      const L = cuaderno.lista().slice().reverse(), ul = pestana.querySelector('.lista-cuaderno');
      poner(pestana.querySelector('.cuaderno-titulo'), L.length ? `CUADERNO DE MEDIDAS · ${L.length}` : 'CUADERNO DE MEDIDAS');
      pestana.querySelector('.vaciar-cuaderno').disabled = !L.length;
      if (ul.contains(document.activeElement) && document.activeElement.dataset.nota && L.some(e => String(e.id) === document.activeElement.dataset.nota)) return;      // no se repinta mientras se escribe una nota
      ul.innerHTML = L.length ? L.map(e => `<li class="${e.peligro ? 'peligro' : e.valida === false ? 'invalida' : ''}"><p><b>${esc(K.textoEntrada(e))}</b></p>
          <div class="cu-fila"><label class="cu-ev"><input type="checkbox" data-evidencia="${e.id}"${e.evidencia ? ' checked' : ''}> Evidencia</label><input type="text" data-nota="${e.id}" value="${esc(e.nota)}" maxlength="${K.MAX_NOTA}" placeholder="Nota…" aria-label="Nota de la medida ${e.id}"><button type="button" data-borrar="${e.id}" aria-label="Borrar la medida ${e.id}" title="Borrar">×</button></div></li>`).join('')
        : '<li class="vacio">Todavía no has medido nada. Coge un instrumento del maletín.</li>';
    }
    cuaderno.alCambiar(pintarCuaderno);

    /** Ventana emergente del maletín (botón «Instrumentos» de la cabecera): para coger un instrumento sin bajar hasta el panel lateral. */
    function abrirMaletin(origen) {
      if (!ventana) {
        ventana = document.createElement('div'); ventana.id = 'maletin-fv'; ventana.setAttribute('role', 'dialog'); ventana.setAttribute('aria-modal', 'true'); ventana.setAttribute('aria-labelledby', 'maletin-titulo'); document.body.appendChild(ventana);
        ventana.innerHTML = '<header><h3 id="maletin-titulo">Maletín de instrumentos</h3><button type="button" class="cerrar" aria-label="Cerrar (Esc)">×</button></header><div class="hueco-maletin"></div><p class="nota">Coge uno y toca el sinóptico para medir. Las medidas se apuntan solas en el cuaderno (pestaña Instrumentos).</p>';
        const cerrar = () => { ventana.hidden = true; if (ventana.origen && ventana.origen.focus) ventana.origen.focus(); };
        ventana.addEventListener('click', ev => { if (ev.target.closest('.cerrar')) cerrar(); else if (alElegirInstrumento(ev)) cerrar(); });
        document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !ventana.hidden) cerrar(); });
      }
      ventana.origen = origen || document.activeElement; ventana.hidden = false; pintarMaletines();
      ventana.querySelector('[data-instrumento]').focus();
    }

    /** Se llama en cada refresco de la página: la lectura del instrumento en la mano sigue viva. */
    function actualizar() {
      if (!enMano) return;
      if (enMano === 'multimetro') { const l = I.lecturaMultimetro(sim(), multi.modo, multi.roja, multi.negra); if (multi.roja && multi.negra && cambioNotable(apuntada, l, 1)) refrescarMultimetro(true); else pintarLectura(l); }
      else if (enMano === 'pinza') { if (pinza.id) { const l = I.lecturaPinza(sim(), pinza.id, pinza.modo); if (cambioNotable(apuntada, l, 0.5)) refrescarPinza(true); else pintarLectura(l); } }
      else if (enMano === 'termografia') refrescarCamara(false);
    }

    pintarMaletines(); pintarCuaderno();
    return { coger, guardar, enMano: () => enMano, actualizar, abrirMaletin, pintarCuaderno, lectura: () => ultimaLectura };
  }

  const api = { resolverToque, cambioNotable, gruposDePuntos, crear, RADIO_TOQUE_PX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') (window.PCT = window.PCT || {}).fvPanelInstrumentos = api;
})();
