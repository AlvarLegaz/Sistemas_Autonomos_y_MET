// Diagrama de FUERZA (circuito de potencia) de la planta real HTST: acometida de 400 V trifásicos, armario QE-001, magnetotérmico QF-102, contactores KM-102 / KM-201 /
// KM-202, variador VFD-101, bombas P-101 y P-102, bancos de resistencias del calentador HW-101 y fuente PS-001 con el fusible F-201 que alimenta el mando.
// Dibujo unifilar (una línea = tres fases, con trazos oblicuos). Mismo marco que el SCADA: especificación ['tag', {atributos}, ...hijos] para PCT.canvas.Canvas y
// `crearObjetos(canvas)` con objetos `actualizar(estado)`. El ESTADO EN VIVO sale de una función pura (`calcularFuerza`), que da a cada elemento un estado (data-e)
// y, si lleva texto, el texto: el CSS (css/diagramas.css) pinta por data-e y el texto repite el estado, así que no se distingue solo por color.
// Este archivo también exporta `comun`: las piezas que comparten Fuerza y Mando (lectura del estado, constructores del dibujo, leyenda y enlace con el lienzo).
(function () {
  const esNode = typeof require !== 'undefined';
  const layout = esNode ? require('../layout.js') : PCT.htstLayout;
  const instrumentos = esNode ? require('../modelo/instrumentos.js') : (PCT.htstInstrumentos || null);

  /* ---------- lectura del estado (pura; tolera que falte cualquier campo) ---------- */
  const eq = (e, tag) => (e && e.equipos && e.equipos[tag]) || {};
  const nivelDI = (e, tag) => (e && e.instrumentos && e.instrumentos[tag] ? e.instrumentos[tag].nivel : undefined);
  const salidaDO = (e, tag) => !!(e && e.salidasPLC && e.salidasPLC.DO && e.salidasPLC.DO[tag]);
  const salidaAO = (e, tag) => Number((e && e.salidasPLC && e.salidasPLC.AO && e.salidasPLC.AO[tag]) || 0);
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const dec = (v, c = 1) => v.toFixed(c).replace('.', ',');
  /** 'vivo' (con tensión) | 'muerto' (sin tensión) | 'sd' (sin datos: no hay estado). */
  const vivo = (hay, cond) => (hay ? (cond ? 'vivo' : 'muerto') : 'sd');

  /** Fuente de 24 V y fusible: { fuente: 'ok'|'degradada'|'sin'|'sd', v, fundido, barra (¿hay 24 V tras el fusible?), vBarra }. */
  function alimentacion(e) {
    const f = eq(e, 'F-201'), ps = eq(e, 'PS-001'), hay = !!e;
    const v = num(ps.tensionV, ps.ok === false ? 0 : (e && e.alimentacion ? num(e.alimentacion.v24, 24) : 24));
    const fuente = !hay ? 'sd' : v >= 22 ? 'ok' : v > 1 ? 'degradada' : 'sin';
    const fundido = !!f.fundido, barra = hay && fuente !== 'sin' && fuente !== 'sd' && !fundido;
    return { fuente, v, fundido, barra, vBarra: barra ? v : 0 };
  }
  /** Seta ES-001 rearmada (el contacto NC está cerrado). */
  const setaRearmada = e => { const s = eq(e, 'ES-001'); return s.rearmado !== undefined ? !!s.rearmado : nivelDI(e, 'ES-001') !== 0; };
  const magnetoArmado = e => { const q = eq(e, 'QF-102'); return q.armado !== undefined ? !!q.armado : nivelDI(e, 'QF-102') !== 0; };
  const contactorCerrado = (e, tag) => { const k = eq(e, tag); return !!(k.cerrado || k.pegado); };
  /** Banco de resistencias n (1 o 2) conectado de verdad: contactor cerrado y magnetotérmico armado. */
  function bancoActivo(e, n) {
    const hw = eq(e, 'HW-101'), clave = `banco${n}`;
    return hw[clave] !== undefined ? !!hw[clave] : contactorCerrado(e, `KM-20${n}`) && magnetoArmado(e);
  }
  /** Niveles físicos de los contactos de campo (antes de la alimentación), o null si el estado no es el completo del simulador. */
  function contactosFisicos(e) {
    try { return instrumentos && e && e.tanque && e.equipos ? instrumentos.nivelesDigitales(e, !!eq(e, 'PB-001').pulsado) : null; } catch (error) { return null; }
  }

  /* ---------- constructores del dibujo ---------- */
  const txt = (x, y, t, clase = 'dg-t', anchor = 'middle', extra = {}) => ['text', Object.assign({ x, y, class: clase, 'text-anchor': anchor }, extra), t];
  const txv = (id, x, y, t = '—', clase = 'dg-f', anchor = 'middle') => txt(x, y, t, clase, anchor, { id, 'data-e': 'sd' });   // texto que cambia con el estado
  const cable = (id, d) => ['path', { id, class: 'dg-cable', 'data-e': 'sd', d }];
  const fijo = (d, clase = '') => ['path', { class: `dg-cable dg-fijo ${clase}`.trim(), d }];
  const caja = (x, y, w, h) => ['rect', { class: 'dg-caja dg-sim', x, y, width: w, height: h, rx: 4 }];
  const dis = (id, ...hijos) => ['g', { id, class: 'dg-dis', 'data-e': 'sd' }, ...hijos];
  const nodo = (x, y) => ['circle', { class: 'dg-nodo', cx: x, cy: y, r: 4 }];
  const g = (tag, ...hijos) => ['g', { 'data-tag': tag, tabindex: 0, role: 'button', 'aria-label': tag, class: 'dg-equipo' }, ...hijos];

  /** Leyenda en dos filas: [x, y, items]. Cada item: [tipo, texto]. Las anchuras se estiman (8,4 px por carácter) para no pisar al siguiente. */
  function leyendaSvg(x1, y1, x2, y2) {
    const A = ['vivo', 'con tensión'], B = ['muerto', 'sin tensión'], C = ['on', 'activo · cerrado · en marcha'], D = ['off', 'abierto · parado'], E = ['fallo', 'fallo · disparado · fundido'];
    const hijos = [];
    const fila = (x, y, items) => items.forEach(([tipo, texto]) => {
      if (tipo === 'vivo' || tipo === 'muerto') hijos.push(['path', { class: 'dg-cable', 'data-e': tipo, d: `M${x} ${y - 5} h28` }]);
      else {
        hijos.push(['rect', { class: `dg-leg dg-leg-${tipo}`, x: x + 7, y: y - 13, width: 14, height: 14, rx: 2 }]);
        if (tipo === 'fallo') hijos.push(['path', { class: 'dg-leg-x', d: `M${x + 10} ${y - 10} l8 8 M${x + 18} ${y - 10} l-8 8` }]);
      }
      hijos.push(txt(x + 36, y, texto, 'dg-t', 'start'));
      x += 36 + Math.ceil(texto.length * 8.4) + 26;
    });
    fila(x1, y1, [A, B, C]); fila(x2, y2, [D, E]);
    return ['g', { class: 'dg-leyenda', role: 'img', 'aria-label': 'Leyenda: línea gruesa con tensión, fina sin tensión, relleno activo, hueco abierto, rojo con aspa fallo' }, ...hijos];
  }

  /** Todos los tags (data-tag) y todos los ids que hay en una especificación. */
  function recorrer(esquema, alVisitar) {
    (function paso(nodoEsp) {
      if (!Array.isArray(nodoEsp)) return;
      const a = nodoEsp[1] && typeof nodoEsp[1] === 'object' && !Array.isArray(nodoEsp[1]) ? nodoEsp[1] : null;
      if (a) alVisitar(a, nodoEsp);
      nodoEsp.forEach(paso);
    })(esquema);
  }
  const tagsDe = esquema => { const t = new Set(); recorrer(esquema, a => { if (a['data-tag']) t.add(a['data-tag']); }); return t; };
  const idsDe = esquema => { const t = new Set(); recorrer(esquema, a => { if (a.id) t.add(a.id); }); return t; };

  /**
   * Enlace con el lienzo: un solo objeto cuya `actualizar(estado)` calcula el modelo y escribe en cada elemento su data-e y su texto (solo si cambian),
   * y deja en el aria-label de cada equipo su estado.
   */
  function crearObjetosDesde(canvas, calcular, ariaDe) {
    const nodos = new Map(), ultimo = new Map();
    const grupos = (canvas.buscarTodos ? canvas.buscarTodos('g[data-tag]') : []).map(el => ({ el, tag: el.getAttribute('data-tag'), texto: '' }));
    return [{
      actualizar(e) {
        const m = calcular(e);
        for (const id of Object.keys(m)) {
          let n = nodos.get(id); if (n === undefined) { n = canvas.buscar(id) || null; nodos.set(id, n); }
          if (!n) continue;
          const v = m[id], u = ultimo.get(id) || {};
          if (u.e !== v.e) { n.setAttribute('data-e', v.e); u.e = v.e; }
          if (v.t !== undefined && u.t !== v.t) { n.textContent = v.t; u.t = v.t; }
          ultimo.set(id, u);
        }
        const etiquetas = ariaDe(e);
        for (const o of grupos) { const t = etiquetas[o.tag] || o.tag; if (t !== o.texto) { o.texto = t; o.el.setAttribute('aria-label', t); } }
      },
    }];
  }

  const comun = { layout, eq, nivelDI, salidaDO, salidaAO, num, dec, vivo, alimentacion, setaRearmada, magnetoArmado, contactorCerrado, bancoActivo, contactosFisicos,
    txt, txv, cable, fijo, caja, dis, nodo, g, leyendaSvg, tagsDe, idsDe, crearObjetosDesde };

  /* ---------- modelo en vivo de Fuerza ---------- */
  function calcularFuerza(e) {
    const hay = !!e, a = alimentacion(e), armado = magnetoArmado(e), m = {};
    const cerr = tag => contactorCerrado(e, tag);
    const V = cond => ({ e: vivo(hay, cond) });
    const p101 = eq(e, 'P-101'), p102 = eq(e, 'P-102'), vfd = eq(e, 'VFD-101');
    const fallo = !!(vfd.fallo || p101.fallo), marcha101 = !!p101.marcha && !fallo, marcha102 = !!p102.marcha;
    const si = (cond, a1, b1) => (hay ? (cond ? a1 : b1) : '—');

    m['w-acometida'] = V(true); m['w-bus'] = V(true);
    m['f-bus-t'] = { e: vivo(hay, true), t: hay ? 'BARRA 400 V · CON TENSIÓN' : 'BARRA 400 V · SIN DATOS' };

    // QF-102 y sus tres derivaciones
    m['w-qf-in'] = V(true); m['w-qf-out'] = V(armado); m['w-sub'] = V(armado);
    m['f-qf102'] = { e: hay ? (armado ? 'cerrado' : 'disparado') : 'sd' }; m['f-qf102-t'] = { e: m['f-qf102'].e, t: si(armado, 'ARMADO', 'DISPARADO') };
    for (const [k, tag] of [['km102', 'KM-102'], ['km201', 'KM-201'], ['km202', 'KM-202']]) {
      const c = cerr(tag);
      m[`w-${k}-in`] = V(armado); m[`w-${k}-out`] = V(armado && c);
      m[`f-${k}`] = { e: hay ? (c ? 'cerrado' : 'abierto') : 'sd' }; m[`f-${k}-t`] = { e: m[`f-${k}`].e, t: si(c, 'CERRADO', 'ABIERTO') };
    }
    const amp = x => (typeof x === 'number' && x > 0 ? ` · ${dec(x)} A` : '');
    m['f-p102'] = { e: hay ? (marcha102 ? 'marcha' : 'parado') : 'sd' }; m['f-p102-t'] = { e: m['f-p102'].e, t: si(marcha102, `EN MARCHA${amp(p102.corrienteA)}`, 'PARADA') };
    // bancos de resistencias y total del calentador
    const b1 = bancoActivo(e, 1), b2 = bancoActivo(e, 2), kw = (b1 ? 30 : 0) + (b2 ? 30 : 0);
    m['f-b1'] = { e: hay ? (b1 ? 'on' : 'off') : 'sd' }; m['f-b1-t'] = { e: m['f-b1'].e, t: si(b1, 'CONECTADO', 'DESCONECTADO') };
    m['f-b2'] = { e: hay ? (b2 ? 'on' : 'off') : 'sd' }; m['f-b2-t'] = { e: m['f-b2'].e, t: si(b2, 'CONECTADO', 'DESCONECTADO') };
    m['f-hw-t'] = { e: hay ? (kw ? 'on' : 'off') : 'sd', t: hay ? `HW-101 · POTENCIA ${kw} kW` : 'HW-101 · —' };

    // variador y bomba de leche
    m['w-vfd-in'] = V(true); m['w-vfd-out'] = V(marcha101);
    m['f-vfd'] = { e: hay ? (fallo ? 'fallo' : marcha101 ? 'marcha' : 'parado') : 'sd' };
    m['f-vfd-t'] = { e: m['f-vfd'].e, t: si(fallo, '✕ FALLO', marcha101 ? 'EN MARCHA' : 'PARADO') };
    m['f-vfd-v'] = { e: m['f-vfd'].e, t: hay ? `${Math.round(num(p101.velocidadPct, 0))} % vel.` : '—' };
    m['f-p101'] = { e: hay ? (marcha101 ? 'marcha' : 'parado') : 'sd' }; m['f-p101-t'] = { e: m['f-p101'].e, t: si(marcha101, `EN MARCHA${amp(p101.corrienteA)}`, 'PARADA') };

    // fuente de 24 V y fusible
    m['w-ps-in'] = V(true); m['w-ps-out'] = V(a.fuente === 'ok' || a.fuente === 'degradada'); m['w-24v'] = V(a.barra);
    m['f-ps'] = { e: a.fuente }; m['f-ps-v'] = { e: a.fuente, t: hay ? `${dec(a.v)} V` : '—' };
    m['f-ps-t'] = { e: a.fuente, t: { ok: 'OK', degradada: 'DEGRADADA', sin: 'SIN SALIDA', sd: '—' }[a.fuente] };
    m['f-f201'] = { e: hay ? (a.fundido ? 'fundido' : 'ok') : 'sd' }; m['f-f201-t'] = { e: m['f-f201'].e, t: si(a.fundido, 'FUNDIDO', 'OK') };
    m['f-24v'] = { e: vivo(hay, a.barra) }; m['f-24v-t'] = { e: vivo(hay, a.barra), t: hay ? (a.barra ? `${dec(a.vBarra)} V · CON TENSIÓN` : '0 V · SIN TENSIÓN') : '—' };
    return m;
  }

  /** Etiqueta accesible de cada equipo dibujado en Fuerza. */
  function ariaFuerza(e) {
    const m = calcularFuerza(e), t = id => (m[id].t || '').toLowerCase();
    return { 'QE-001': `QE-001, armario eléctrico, ${t('f-bus-t')}`, 'QF-102': `QF-102, ${t('f-qf102-t')}`, 'KM-102': `KM-102, contactor ${t('f-km102-t')}`,
      'KM-201': `KM-201, contactor ${t('f-km201-t')}, banco 1 ${t('f-b1-t')}`, 'KM-202': `KM-202, contactor ${t('f-km202-t')}, banco 2 ${t('f-b2-t')}`,
      'P-102': `P-102, ${t('f-p102-t')}`, 'P-101': `P-101, ${t('f-p101-t')}`, 'VFD-101': `VFD-101, ${t('f-vfd-t')}`, 'HW-101': t('f-hw-t').replace('hw-101', 'HW-101'),
      'PS-001': `PS-001, ${t('f-ps-v')}, ${t('f-ps-t')}`, 'F-201': `F-201, ${t('f-f201-t')}` };
  }

  /* ---------- dibujo ---------- */
  const VIEWBOX = '0 0 1600 800';
  const Y_BUS = 250;

  /** Contactor de potencia en la derivación x (entra por la sub-barra y = 420): cable, contacto principal, estado, y el cable de salida hasta y = 620. */
  function contactor(tag, x, k) {
    return [cable(`w-${k}-in`, `M${x} 420 V450`),
      dis(`f-${k}`, caja(x - 26, 438, 52, 64), ['circle', { class: 'dg-borne', cx: x, cy: 450, r: 3 }], ['circle', { class: 'dg-borne', cx: x, cy: 490, r: 3 }],
        ['path', { class: 'dg-cuchilla dg-on-only', d: `M${x} 450 V490` }], ['path', { class: 'dg-cuchilla dg-off-only', d: `M${x} 450 L${x + 18} 486` }]),
      cable(`w-${k}-out`, `M${x} 490 V620`), txt(x + 34, 462, tag, 'dg-f', 'start'), txv(`f-${k}-t`, x + 34, 482, '—', 'dg-f', 'start')];
  }
  const motor = (tag, x, k, nombre) => g(tag, dis(`f-${k}`, ['circle', { class: 'dg-caja dg-sim', cx: x, cy: 650, r: 30 }], txt(x, 647, 'M', 'dg-v'), txt(x, 666, '3~', 'dg-t')),
    txt(x, 706, tag, 'dg-f'), txv(`f-${k}-t`, x, 726, '—'), txt(x, 746, nombre, 'dg-t'));
  const banco = (tag, x, k, n) => [
    dis(`f-${k}`, ['path', { class: 'dg-res', d: `M${x} 620 V628 L${x + 11} 636 L${x - 11} 650 L${x + 11} 664 L${x - 11} 678 L${x} 686 V694` }]),
    txt(x, 718, `Banco ${n} · 30 kW`, 'dg-f'), txv(`f-${k}-t`, x, 738, '—')];

  function construirFuerza() {
    const hijos = [
      txt(24, 40, 'FUERZA · circuito de potencia (unifilar)', 'dg-g', 'start'),
      txt(24, 64, 'Una línea = tres fases. Clic izquierdo acciona; clic derecho abre la ficha.', 'dg-t', 'start'),
      leyendaSvg(640, 34, 780, 62),
      // armario QE-001: marco, acometida y seccionador general con diferencial
      g('QE-001', ['rect', { class: 'dg-armario', x: 190, y: 80, width: 1400, height: 500, rx: 8 }], txt(206, 106, 'QE-001 · ARMARIO ELÉCTRICO', 'dg-f', 'start'),
        txt(1580, 570, 'bornas de salida', 'dg-t', 'end'),
        ['path', { class: 'dg-trazos', d: `M97 ${Y_BUS + 8} l8 -16 M105 ${Y_BUS + 8} l8 -16 M113 ${Y_BUS + 8} l8 -16` }],
        txt(105, 226, 'ACOMETIDA', 'dg-f'), txt(105, 284, '400 V · 3~ · 50 Hz', 'dg-t'),
        caja(216, 206, 150, 88), txt(291, 234, 'Seccionador', 'dg-t'), txt(291, 254, 'general +', 'dg-t'), txt(291, 274, 'diferencial', 'dg-t'),
        cable('w-acometida', `M20 ${Y_BUS} H216`), cable('w-bus', `M366 ${Y_BUS} H1560`), txv('f-bus-t', 390, 226, '—', 'dg-f', 'start'),
        ['path', { class: 'dg-trazos', d: `M700 ${Y_BUS + 8} l8 -16 M708 ${Y_BUS + 8} l8 -16 M716 ${Y_BUS + 8} l8 -16` }]),
      // QF-102: magnetotérmico de P-102 y del calentador
      g('QF-102', cable('w-qf-in', `M520 ${Y_BUS} V322`), dis('f-qf102', caja(496, 304, 48, 76), ['circle', { class: 'dg-borne', cx: 520, cy: 322, r: 3 }], ['circle', { class: 'dg-borne', cx: 520, cy: 362, r: 3 }],
        ['path', { class: 'dg-cuchilla dg-on-only', d: 'M520 322 V362' }], ['path', { class: 'dg-cuchilla dg-off-only', d: 'M520 322 L538 356' }]),
        cable('w-qf-out', 'M520 362 V420'), txt(556, 332, 'QF-102', 'dg-f', 'start'), txv('f-qf102-t', 556, 352, '—', 'dg-f', 'start'), txt(556, 372, 'P-102 y calentador', 'dg-t', 'start')),
      cable('w-sub', 'M300 420 H640'), nodo(520, 420),
      g('KM-102', ...contactor('KM-102', 300, 'km102')),
      motor('P-102', 300, 'p102', 'Bomba agua caliente'),
      g('HW-101', ['rect', { class: 'dg-armario dg-campo', x: 375, y: 596, width: 370, height: 180, rx: 8 }], txv('f-hw-t', 560, 764, '—')),
      g('KM-201', ...contactor('KM-201', 460, 'km201'), ...banco('KM-201', 460, 'b1', 1)),
      g('KM-202', ...contactor('KM-202', 640, 'km202'), ...banco('KM-202', 640, 'b2', 2)),
      // variador VFD-101 con la bomba P-101
      cable('w-vfd-in', `M900 ${Y_BUS} V300`),
      g('VFD-101', dis('f-vfd', caja(840, 300, 120, 110)), txt(900, 326, 'VFD-101', 'dg-f'), txt(900, 346, 'variador', 'dg-t'), txv('f-vfd-t', 900, 374), txv('f-vfd-v', 900, 396, '—', 'dg-t')),
      cable('w-vfd-out', 'M900 410 V620'), motor('P-101', 900, 'p101', 'Bomba de leche'),
      // fuente de 24 V y fusible hacia el mando
      cable('w-ps-in', `M1230 ${Y_BUS} V300`), txt(1246, 284, '230 V CA (fase + neutro)', 'dg-t', 'start'),
      g('PS-001', dis('f-ps', caja(1160, 300, 140, 100)), txt(1230, 326, 'PS-001', 'dg-f'), txt(1230, 346, 'FUENTE 24 V CC', 'dg-t'), txv('f-ps-v', 1230, 372, '—', 'dg-v'), txv('f-ps-t', 1230, 392)),
      cable('w-ps-out', 'M1230 400 V430'),
      g('F-201', dis('f-f201', caja(1218, 430, 24, 48), ['path', { class: 'dg-hilo dg-on-only', d: 'M1230 436 V472' }],
        ['path', { class: 'dg-hilo dg-off-only', d: 'M1230 436 V447 M1230 461 V472 M1223 446 L1237 462 M1237 446 L1223 462' }]),
        txt(1260, 452, 'F-201', 'dg-f', 'start'), txv('f-f201-t', 1260, 472, '—', 'dg-f', 'start'),
        cable('w-24v', 'M1230 478 V604'), dis('f-24v', ['path', { class: 'dg-flecha', d: 'M1221 600 L1230 616 L1239 600 Z' }]),
        txt(1230, 640, 'A MANDO (24 V CC)', 'dg-f'), txv('f-24v-t', 1230, 660)),
      txt(1350, 690, 'La seta ES-001 no corta la', 'dg-t', 'start'), txt(1350, 710, 'potencia: abre las bobinas', 'dg-t', 'start'), txt(1350, 730, 'con el relé de seguridad', 'dg-t', 'start'),
      txt(1350, 750, '(ver la vista Mando).', 'dg-t', 'start'),
    ];
    return ['svg', { viewBox: VIEWBOX, class: 'dg-svg', role: 'group', 'aria-label': 'Diagrama de fuerza de la planta HTST: acometida de 400 V, armario QE-001, bombas, variador y calentador. Cada equipo se puede abrir con Intro.' }, ...hijos];
  }

  const ESQUEMA = construirFuerza();
  const tagsDelEsquema = (esquema = ESQUEMA) => tagsDe(esquema);
  const crearObjetos = canvas => crearObjetosDesde(canvas, calcularFuerza, ariaFuerza);

  const api = { VIEWBOX, ESQUEMA, construirFuerza, tagsDelEsquema, crearObjetos, calcularFuerza, ariaFuerza, comun };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstDiagramaFuerza = api; }
})();
