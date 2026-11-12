// Esquema UNIFILAR de la instalación fotovoltaica de la cubierta, en DOS hojas: CONTINUA (paneles, cadenas, fusibles, seccionadores, descargadores, inversores y batería)
// y ALTERNA (acometida, cuadro QA-301 con sus protecciones, medidor, inversores, cargas y toma). Una línea = el conductor o la pareja de conductores del tramo.
// Mismo marco que los diagramas de la planta real: especificación ['tag', {atributos}, ...hijos] para PCT.canvas.Canvas y `crearObjetos(canvas)`. El ESTADO EN VIVO sale
// de una función pura (`calcularUnifilar`), que da a cada elemento un estado (data-e) y, si lleva texto, el texto: el CSS (css/diagramas.css) pinta por data-e y el
// texto repite el estado, de modo que nunca se distingue solo por el color (cambia también la forma: cuchilla abierta, hilo roto, aspa).
// Todo lo que se dibuja es SUPUESTO a partir de las fotos (ver ../layout.js): el orden de los aparatos dentro del cuadro y de la caja «HT 8WAY» se ha ordenado para que se lea bien.
(function () {
  const esNode = typeof require !== 'undefined';
  const layout = esNode ? require('../layout.js') : PCT.fvLayout;

  /* ---------- lectura del estado (pura; tolera que falte cualquier campo) ---------- */
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const dec = (v, c = 1) => num(v, 0).toFixed(c).replace('.', ',');
  const fmtP = w => { const x = Math.abs(num(w, 0)); return x >= 1000 ? `${dec(x / 1000, 2)} kW` : `${Math.round(x)} W`; };
  const fmtPs = w => { const x = num(w, 0); return `${x > 0.5 ? '+' : x < -0.5 ? '−' : ''}${fmtP(x)}`; };
  const corto = (t, n) => { const s = String(t || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const TXT_PROT = { cerrado: 'CERRADO', abierto: 'ABIERTO', disparado: 'DISPARADO', fundido: 'FUNDIDO', agotado: 'AGOTADO', ok: 'SANO' };
  const TXT_INV = { OPERANDO: 'OPERANDO', ESPERA: 'EN ESPERA', APAGADO: 'APAGADO', FALLO: '✕ FALLO', REDUCIDO: 'REDUCIDO', ESPERA_AISLAMIENTO: 'ESPERA AISLAM.', ESPERA_RED: 'ESPERA RED' };
  const E_INV = { OPERANDO: 'on', ESPERA: 'espera', APAGADO: 'off', FALLO: 'fallo', REDUCIDO: 'degradada', ESPERA_AISLAMIENTO: 'espera', ESPERA_RED: 'espera' };

  const tipoDe = tag => { const q = layout.EQUIPOS.find(x => x.tag === tag); return q ? q.tipo : ''; };
  /** Estado de una protección: 'cerrado'|'abierto'|'disparado'|'fundido'|'agotado'|'ok' (fusible o descargador sano) o 'sd' (sin datos). */
  function estadoProt(e, tag) {
    const p = e && e.protecciones && e.protecciones[tag];
    if (!p || !p.estado) return 'sd';
    const s = String(p.estado).toLowerCase(), sano = tipoDe(tag) === 'fusible' || tipoDe(tag) === 'descargador';
    return s === 'cerrado' && sano ? 'ok' : s;
  }
  const deja = s => s === 'cerrado' || s === 'ok';
  const cadenaDe = (e, id) => { for (const k of ['A', 'B']) { const c = e && e.campos && e.campos[k]; for (const x of (c && c.cadenas) || []) if (x.id === id) return x; } return null; };
  const panelDe = (e, tag) => { for (const k of ['A', 'B']) { const c = e && e.campos && e.campos[k]; for (const x of (c && c.cadenas) || []) for (const p of x.paneles || []) if (p.tag === tag) return p; } return null; };
  const inversor = (e, tag) => (e && e.inversores && e.inversores[tag]) || {};
  const hayAveria = (e, id) => !!(e && Array.isArray(e.averiasActivas) && e.averiasActivas.includes(id));

  /* ---------- constructores del dibujo ---------- */
  const txt = (x, y, t, clase = 'dg-t', anchor = 'middle', extra = {}) => ['text', Object.assign({ x, y, class: clase, 'text-anchor': anchor }, extra), t];
  const txv = (id, x, y, t = '—', clase = 'dg-t', anchor = 'middle') => txt(x, y, t, clase, anchor, { id, 'data-e': 'sd' });
  const cable = (id, d, clase = '') => ['path', { id, class: `dg-cable ${clase}`.trim(), 'data-e': 'sd', d }];
  const fijo = (d, clase = '') => ['path', { class: `dg-cable dg-fijo ${clase}`.trim(), d }];
  const enlace = d => ['path', { class: 'dg-cable dg-enlace', d }];
  const dis = (id, ...hijos) => ['g', { id, class: 'dg-dis', 'data-e': 'sd' }, ...hijos];
  const nodo = (x, y) => ['circle', { class: 'dg-nodo', cx: x, cy: y, r: 4 }];
  const g = (tag, ...hijos) => ['g', { 'data-tag': tag, tabindex: 0, role: 'button', 'aria-label': tag, class: 'dg-equipo' }, ...hijos];
  const borne = (x, y) => ['circle', { class: 'dg-borne', cx: x, cy: y, r: 3 }];
  const tierra = (x, y) => ['path', { class: 'dg-trazos', d: `M${x} ${y} h-26 M${x} ${y - 12} v24 M${x + 7} ${y - 8} v16 M${x + 14} ${y - 4} v8` }];
  const flechaAbajo = (x, y) => ['path', { class: 'dg-flecha', d: `M${x - 7} ${y} L${x} ${y + 12} L${x + 7} ${y} Z` }];

  /** Polo de seccionador / interruptor / magnetotérmico: caja con cuchilla (cerrada o abierta). */
  function polo(id, cx, cy, vertical) {
    const w = vertical ? 36 : 56, h = vertical ? 56 : 36, a = vertical ? [cx, cy - 18] : [cx - 18, cy], b = vertical ? [cx, cy + 18] : [cx + 18, cy], o = vertical ? [cx + 15, cy + 10] : [cx + 14, cy - 15];
    return dis(id, ['rect', { class: 'dg-caja dg-sim', x: cx - w / 2, y: cy - h / 2, width: w, height: h, rx: 4 }], borne(a[0], a[1]), borne(b[0], b[1]),
      ['path', { class: 'dg-cuchilla dg-on-only', d: `M${a[0]} ${a[1]} L${b[0]} ${b[1]}` }], ['path', { class: 'dg-cuchilla dg-off-only', d: `M${a[0]} ${a[1]} L${o[0]} ${o[1]}` }]);
  }
  /** Fusible (horizontal): caja con hilo entero o roto con aspa. */
  const fusible = (id, cx, cy) => dis(id, ['rect', { class: 'dg-caja dg-sim', x: cx - 22, y: cy - 12, width: 44, height: 24, rx: 3 }],
    ['path', { class: 'dg-hilo dg-on-only', d: `M${cx - 22} ${cy} H${cx + 22}` }], ['path', { class: 'dg-hilo dg-off-only', d: `M${cx - 22} ${cy} H${cx - 8} M${cx + 8} ${cy} H${cx + 22} M${cx - 6} ${cy - 6} L${cx + 6} ${cy + 6} M${cx + 6} ${cy - 6} L${cx - 6} ${cy + 6}` }]);
  /** Descargador de sobretensiones (varistor): el aspa aparece cuando está agotado. */
  const descargador = (id, cx, cy, h = 50) => dis(id, ['rect', { class: 'dg-caja dg-sim', x: cx - 20, y: cy - h / 2, width: 40, height: h, rx: 4 }],
    ['rect', { class: 'dg-celda', x: cx - 7, y: cy - h / 2 + 9, width: 14, height: h - 18, rx: 2 }], ['path', { class: 'dg-celda', d: `M${cx - 14} ${cy + 8} L${cx + 14} ${cy - 8}` }],
    ['path', { class: 'dg-hilo dg-off-only dg-aspa', d: `M${cx - 18} ${cy - h / 2 + 3} L${cx + 18} ${cy + h / 2 - 3} M${cx + 18} ${cy - h / 2 + 3} L${cx - 18} ${cy + h / 2 - 3}` }]);
  /** Panel fotovoltaico: rectángulo con las tres subcadenas con diodo de paso y la diagonal. */
  const panel = (tag, x, y) => g(tag, dis(`c-pv-${tag}`, ['rect', { class: 'dg-caja dg-sim', x: x - 36, y: y - 23, width: 72, height: 46, rx: 3 }],
    ['path', { class: 'dg-celda', d: `M${x - 12} ${y - 23} V${y + 23} M${x + 12} ${y - 23} V${y + 23} M${x - 36} ${y + 23} L${x + 36} ${y - 23}` }]), txt(x, y - 30, tag, 'dg-t'));

  /** Leyenda en dos filas: cada elemento es [tipo, texto]. */
  function leyendaSvg(x1, y1, f1, x2, y2, f2) {
    const hijos = [];
    const fila = (x, y, items) => items.forEach(([tipo, texto]) => {
      if (['vivo', 'muerto', 'pos', 'neg'].includes(tipo)) hijos.push(['path', { class: `dg-cable ${tipo === 'pos' ? 'dg-p' : tipo === 'neg' ? 'dg-n' : ''}`.trim(), 'data-e': tipo === 'muerto' ? 'muerto' : 'vivo', d: `M${x} ${y - 5} h28` }]);
      else {
        hijos.push(['rect', { class: `dg-leg dg-leg-${tipo}`, x: x + 7, y: y - 13, width: 14, height: 14, rx: 2 }]);
        if (tipo === 'fallo') hijos.push(['path', { class: 'dg-leg-x', d: `M${x + 10} ${y - 10} l8 8 M${x + 18} ${y - 10} l-8 8` }]);
      }
      hijos.push(txt(x + 36, y, texto, 'dg-t', 'start'));
      x += 36 + Math.ceil(texto.length * 8.6) + 26;
    });
    fila(x1, y1, f1); fila(x2, y2, f2);
    return ['g', { class: 'dg-leyenda', role: 'img', 'aria-label': 'Leyenda: conductor grueso de color con tensión, fino y gris sin ella; relleno verde cerrado o sano, hueco abierto, rojo con aspa disparado, fundido o agotado' }, ...hijos];
  }

  /** Todos los tags (data-tag) y todos los ids que hay en una especificación. */
  function recorrer(esquema, alVisitar) {
    (function paso(n) { if (!Array.isArray(n)) return; const a = n[1] && typeof n[1] === 'object' && !Array.isArray(n[1]) ? n[1] : null; if (a) alVisitar(a, n); n.forEach(paso); })(esquema);
  }
  const tagsDe = esquema => { const t = new Set(); recorrer(esquema, a => { if (a['data-tag']) t.add(a['data-tag']); }); return t; };
  const idsDe = esquema => { const t = new Set(); recorrer(esquema, a => { if (a.id) t.add(a.id); }); return t; };

  /** Enlace con el lienzo: un solo objeto cuya `actualizar(estado)` calcula el modelo y escribe en cada elemento su data-e y su texto (solo si cambian). */
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

  /* ---------- hoja de CONTINUA ---------- */
  const VIEWBOX_CC = '0 0 1600 780', VIEWBOX_CA = '0 0 1600 700';
  const FILAS_A = [{ id: 'STR-101', k: 's101', y: 140, tags: ['PV-101', 'PV-102', 'PV-103'], f: 'F-101', kf: 'f101' }, { id: 'STR-102', k: 's102', y: 270, tags: ['PV-104', 'PV-105', 'PV-106'], f: 'F-102', kf: 'f102' }];
  const FILAS_B = [{ id: 'STR-201', k: 's201', y: 500, tags: ['PV-201', 'PV-202', 'PV-203', 'PV-204'], yn: 560 }, { id: 'STR-202', k: 's202', y: 620, tags: ['PV-205', 'PV-206', 'PV-207', 'PV-208'], yn: 680 }];
  const xsPaneles = n => Array.from({ length: n }, (_, i) => 100 + 100 * i);

  /** Una cadena: paneles en serie (− a la izquierda, + a la derecha), conductores entre paneles y texto con la medida. */
  function cadenaDibujo(f) {
    const xs = xsPaneles(f.tags.length), x1 = xs[xs.length - 1] + 36;
    const enlaces = xs.slice(0, -1).map(x => `M${x + 36} ${f.y} H${x + 64}`).join(' ');
    return [...f.tags.map((t, i) => panel(t, xs[i], f.y)),
      g(f.id, cable(`c-${f.k}-w`, enlaces, 'dg-p'), txv(`c-${f.k}-t`, (xs[0] + xs[xs.length - 1]) / 2, f.y + 48, '—', 'dg-t')),
      txt(44, f.y - 8, '−', 'dg-v'), txt(x1 + 16, f.y - 8, '+', 'dg-v')];
  }

  function construirContinua() {
    const A = FILAS_A, B = FILAS_B, h = [
      txt(24, 36, 'CONTINUA (CC)', 'dg-g', 'start'),
      txt(24, 60, 'Dos conductores por tramo: + y −. Clic derecho abre la ficha de cada símbolo.', 'dg-t', 'start'),
      leyendaSvg(760, 34, [['pos', 'conductor + con tensión'], ['neg', 'conductor − con tensión'], ['muerto', 'sin tensión']], 760, 60, [['on', 'cerrado · sano'], ['off', 'abierto'], ['fallo', 'disparado · fundido · agotado']]),
      txt(24, 92, 'CAMPO A · 6 paneles de 250 Wp (2 cadenas de 3) hacia el híbrido EASun de 24 V', 'dg-z', 'start'),
    ];
    // campo A: cadenas, retornos negativos y fusibles de la + en la caja CB-101 (HT 8WAY)
    for (const f of A) h.push(...cadenaDibujo(f));
    h.push(cable('c-a-n1', 'M64 140 H30 V330 H52', 'dg-n'), cable('c-a-n2', 'M64 270 H52 V330', 'dg-n'), nodo(52, 330));
    h.push(cable('c-a-p1a', 'M336 140 H418', 'dg-p'), cable('c-a-p2a', 'M336 270 H418', 'dg-p'), cable('c-a-p1b', 'M462 140 H500 V205', 'dg-p'), cable('c-a-p2b', 'M462 270 H500 V205', 'dg-p'), nodo(500, 205));
    h.push(cable('c-a-pbus', 'M500 205 H532', 'dg-p'), cable('c-a-nbus', 'M52 330 H532', 'dg-n'), cable('c-a-pq', 'M588 205 H900', 'dg-p'), cable('c-a-nq', 'M588 330 H900', 'dg-n'));
    h.push(g('CB-101', ['rect', { class: 'dg-armario', x: 396, y: 96, width: 434, height: 300, rx: 8 }], txt(408, 118, 'CB-101 · caja HT 8WAY', 'dg-f', 'start')));
    for (const f of A) h.push(g(f.f, fusible(`c-${f.kf}`, 440, f.y), txt(440, f.y + 36, f.f, 'dg-f'), txv(`c-${f.kf}-t`, 440, f.y + 54, '—', 'dg-f')));
    h.push(g('QS-101', polo('c-qs101-a', 560, 205, false), polo('c-qs101-b', 560, 330, false), enlace('M560 223 V312'), txt(560, 176, 'QS-101', 'dg-f'), txv('c-qs101-t', 560, 374, '—', 'dg-f')));
    h.push(cable('c-a-spd-p', 'M700 205 V240', 'dg-p'), cable('c-a-spd-n', 'M700 290 V330', 'dg-n'), nodo(700, 205), nodo(700, 330));
    h.push(g('SPD-101', descargador('c-spd101', 700, 265), tierra(770, 265), txt(668, 254, 'SPD-101', 'dg-f', 'end'), txv('c-spd101-t', 668, 274, '—', 'dg-f', 'end')));
    // inversor EASun, comunicaciones y batería
    h.push(g('COM-101', dis('c-com', ['rect', { class: 'dg-caja dg-sim', x: 940, y: 94, width: 200, height: 32, rx: 5 }], txt(1040, 115, 'COM-101 · Wi-Fi/RS485', 'dg-t'))), enlace('M1040 126 V140'));
    h.push(g('INV-101', dis('c-inv1', ['rect', { class: 'dg-caja dg-sim', x: 900, y: 140, width: 280, height: 250, rx: 8 }],
      txt(908, 209, 'PV+', 'dg-t', 'start'), txt(908, 334, 'PV−', 'dg-t', 'start'), txt(1172, 209, 'BAT+', 'dg-t', 'end'), txt(1172, 334, 'BAT−', 'dg-t', 'end'),
      txt(1040, 168, 'INV-101', 'dg-f'), txt(1040, 188, 'EASun híbrido 3 kW', 'dg-t'), txv('c-i1-t', 1040, 212, '—', 'dg-f'), txv('c-i1-modo', 1040, 232), txv('c-i1-pv', 1040, 252), txv('c-i1-bat', 1040, 272),
      txv('c-i1-red', 1040, 292), txv('c-i1-ca', 1040, 312), txv('c-i1-temp', 1040, 332), txt(1000, 380, 'AC IN', 'dg-t'), txt(1080, 380, 'AC OUT', 'dg-t'))));
    h.push(cable('c-a-acin', 'M1000 390 V430', 'dg-ac'), flechaAbajo(1000, 428), cable('c-a-acout', 'M1080 390 V430', 'dg-ac'), flechaAbajo(1080, 428),
      txt(1020, 458, 'AC IN ← QF-302', 'dg-t', 'end'), txt(1060, 458, 'AC OUT → cargas', 'dg-t', 'start'), txt(1040, 480, 'ver hoja de alterna', 'dg-t'));
    h.push(cable('c-a-bp1', 'M1180 205 H1212', 'dg-p'), cable('c-a-bp2', 'M1268 205 H1308', 'dg-p'), cable('c-a-bp3', 'M1352 205 H1420', 'dg-p'), cable('c-a-bn1', 'M1180 330 H1212', 'dg-n'), cable('c-a-bn2', 'M1268 330 H1420', 'dg-n'));
    h.push(g('QB-101', polo('c-qb101-a', 1240, 205, false), polo('c-qb101-b', 1240, 330, false), enlace('M1240 223 V312'), txt(1240, 176, 'QB-101', 'dg-f'), txv('c-qb101-t', 1240, 374, '—', 'dg-f')));
    h.push(g('FB-101', fusible('c-fb101', 1330, 205), txt(1330, 176, 'FB-101', 'dg-f'), txv('c-fb101-t', 1330, 244, '—', 'dg-f')));
    h.push(g('BAT-101', dis('c-bat', ['rect', { class: 'dg-caja dg-sim', x: 1420, y: 150, width: 160, height: 240, rx: 8 }],
      txt(1500, 178, 'BAT-101', 'dg-f'), txt(1500, 198, 'LiFePO4 25,6 V', 'dg-t'), txt(1500, 218, '100 Ah · 2,56 kWh', 'dg-t'), txv('c-bat-soc', 1500, 250, '—', 'dg-f'), txv('c-bat-v', 1500, 272), txv('c-bat-p', 1500, 294), txv('c-bat-bms', 1500, 316), txv('c-bat-temp', 1500, 338))),
      txt(1408, 196, '+', 'dg-v', 'end'), txt(1408, 321, '−', 'dg-v', 'end'));
    // campo B
    h.push(txt(24, 440, 'CAMPO B · 8 paneles de 400 Wp (2 cadenas de 4, una por entrada MPPT) hacia el ZCS Azzurro, sin batería', 'dg-z', 'start'));
    for (const f of B) h.push(...cadenaDibujo(f));
    h.push(cable('c-b-n1a', 'M64 500 H30 V560 H532', 'dg-n'), cable('c-b-n2a', 'M64 620 H30 V680 H532', 'dg-n'), cable('c-b-p1a', 'M436 500 H532', 'dg-p'), cable('c-b-p2a', 'M436 620 H532', 'dg-p'));
    h.push(cable('c-b-p1b', 'M588 500 H900', 'dg-p'), cable('c-b-n1b', 'M588 560 H900', 'dg-n'), cable('c-b-p2b', 'M588 620 H900', 'dg-p'), cable('c-b-n2b', 'M588 680 H900', 'dg-n'));
    h.push(['rect', { class: 'dg-armario', x: 496, y: 448, width: 334, height: 290, rx: 8 }], txt(508, 728, 'caja auxiliar de continua del campo B', 'dg-t', 'start'));
    h.push(g('QS-201', ...[500, 560, 620, 680].map((y, i) => polo(`c-qs201-${i + 1}`, 560, y, false)), enlace('M598 518 V662'), txt(560, 472, 'QS-201', 'dg-f'), txv('c-qs201-t', 610, 540, '—', 'dg-f', 'start')));
    h.push(cable('c-b-spd-a', 'M700 560 V575', 'dg-n'), cable('c-b-spd-b', 'M700 605 V620', 'dg-p'), nodo(700, 560), nodo(700, 620));
    h.push(g('SPD-201', descargador('c-spd201', 700, 590, 30), tierra(680, 590), txt(730, 586, 'SPD-201', 'dg-f', 'start'), txv('c-spd201-t', 730, 606, '—', 'dg-f', 'start')));
    h.push(g('INV-201', dis('c-inv2', ['rect', { class: 'dg-caja dg-sim', x: 900, y: 470, width: 280, height: 240, rx: 8 }],
      txt(908, 504, 'PV1+', 'dg-t', 'start'), txt(908, 564, 'PV1−', 'dg-t', 'start'), txt(908, 624, 'PV2+', 'dg-t', 'start'), txt(908, 684, 'PV2−', 'dg-t', 'start'),
      txt(1040, 500, 'INV-201 · ZCS', 'dg-f'), txt(1040, 520, 'Azzurro 3 kW', 'dg-t'), txv('c-i2-t', 1040, 548, '—', 'dg-f'), txv('c-i2-m1', 1040, 574), txv('c-i2-m2', 1040, 596), txv('c-i2-ca', 1040, 618),
      txv('c-i2-temp', 1040, 640), txv('c-i2-aisl', 1040, 662), txt(1040, 700, 'AC', 'dg-t'))));
    h.push(cable('c-b-acout', 'M1040 710 V740', 'dg-ac'), flechaAbajo(1040, 738), txt(1040, 772, 'AC → QF-303 (hoja de alterna)', 'dg-t'));
    h.push(enlace('M1180 640 H1262'), txt(1270, 644, 'RS485 ↔ MED-201', 'dg-t', 'start'));
    h.push(txt(1300, 520, 'Sin batería (supuesto):', 'dg-t', 'start'), txt(1300, 540, 'el ZCS vierte o autoconsume', 'dg-t', 'start'), txt(1300, 560, 'y desconecta si falta la red.', 'dg-t', 'start'));
    h.push(txt(24, 772, 'Esquema y valores supuestos a partir de las fotos.', 'dg-t', 'start'));
    return ['svg', { viewBox: VIEWBOX_CC, class: 'dg-svg', role: 'group', 'aria-label': 'Esquema unifilar de continua: campos A y B, cajas de continua, inversores y batería. Cada símbolo se puede abrir con Intro.' }, ...h];
  }

  /* ---------- hoja de ALTERNA ---------- */
  function construirAlterna() {
    const h = [
      txt(24, 36, 'ALTERNA (CA)', 'dg-g', 'start'),
      txt(24, 60, 'Una línea = fase + neutro (+ tierra). Clic derecho abre la ficha de cada símbolo.', 'dg-t', 'start'),
      leyendaSvg(760, 34, [['vivo', 'con tensión 230 V'], ['muerto', 'sin tensión']], 760, 60, [['on', 'cerrado · sano'], ['off', 'abierto'], ['fallo', 'disparado · fundido · agotado']]),
      g('RED-301', dis('a-red', ['rect', { class: 'dg-caja dg-sim', x: 40, y: 262, width: 140, height: 76, rx: 6 }], txt(110, 292, 'RED-301', 'dg-f'), txt(110, 314, 'acometida', 'dg-t')), txv('a-red-t', 110, 360), txv('a-red-e', 110, 382, '—', 'dg-f')),
      cable('a-w1', 'M180 300 H222', 'dg-ac'), cable('a-w2', 'M278 300 H352', 'dg-ac'), cable('a-w3', 'M408 300 H482', 'dg-ac'), cable('a-w4', 'M538 300 H600', 'dg-ac'), cable('a-bus', 'M600 300 H1540', 'dg-ac dg-barra'),
      g('QA-301', ['rect', { class: 'dg-armario', x: 205, y: 190, width: 1360, height: 330, rx: 8 }], txt(220, 212, 'QA-301 · cuadro de alterna estanco de la caseta', 'dg-f', 'start')),
      g('QF-301', polo('a-qf301', 250, 300, false), txt(250, 262, 'QF-301', 'dg-f'), txv('a-qf301-t', 250, 342, '—', 'dg-f')),
      g('ID-301', polo('a-id301', 380, 300, false), txt(380, 262, 'ID-301', 'dg-f'), txv('a-id301-t', 380, 342, '—', 'dg-f')),
      g('MED-201', dis('a-med', ['rect', { class: 'dg-caja dg-sim', x: 484, y: 272, width: 52, height: 56, rx: 4 }], txt(510, 305, 'kWh', 'dg-t')), txt(510, 262, 'MED-201', 'dg-f'), txv('a-med-t', 510, 234, '—', 'dg-t')),
      txv('a-bus-t', 1540, 286, '—', 'dg-f', 'end'),
      // descargador de alterna
      cable('a-spd', 'M700 300 V245', 'dg-ac'), nodo(700, 300),
      g('SPD-301', descargador('a-spd301', 700, 245, 50), tierra(770, 245), txt(668, 234, 'SPD-301', 'dg-f', 'end'), txv('a-spd301-t', 668, 254, '—', 'dg-f', 'end')),
      // consumo del centro
      cable('a-l301w', 'M720 300 V390', 'dg-ac'), nodo(720, 300),
      g('LOAD-301', dis('a-l301', ['rect', { class: 'dg-caja dg-sim', x: 650, y: 390, width: 140, height: 66, rx: 6 }], txt(720, 414, 'LOAD-301', 'dg-f'), txv('a-l301-t', 720, 438)), txt(720, 478, 'consumo del centro', 'dg-t')),
      // línea del EASun: QF-302 en la entrada y en la salida
      cable('a-qf302w', 'M900 300 V330', 'dg-ac'), nodo(900, 300), cable('a-i1in', 'M900 386 V450', 'dg-ac'),
      g('QF-302', polo('a-qf302', 900, 358, true), polo('a-qf302o', 1100, 520, false), txt(936, 348, 'QF-302 · entrada', 'dg-f', 'start'), txv('a-qf302-t', 936, 370, '—', 'dg-f', 'start'), txt(1100, 492, 'QF-302 · salida', 'dg-f')),
      g('INV-101', dis('a-inv1', ['rect', { class: 'dg-caja dg-sim', x: 800, y: 450, width: 200, height: 140, rx: 8 }], txt(900, 476, 'INV-101', 'dg-f'), txt(900, 496, 'EASun híbrido', 'dg-t'), txv('a-inv1-t', 900, 524, '—', 'dg-f'), txv('a-inv1-red', 900, 548), txv('a-inv1-ca', 900, 570))),
      txt(892, 428, 'AC IN', 'dg-t', 'end'), txt(1006, 508, 'AC OUT', 'dg-t', 'start'),
      cable('a-i1o1', 'M1000 520 H1072', 'dg-ac'), cable('a-i1o2', 'M1128 520 H1205', 'dg-ac'), nodo(1180, 520), cable('a-toma-w', 'M1180 520 V440', 'dg-ac'),
      g('TC-301', dis('a-tc301', ['circle', { class: 'dg-caja dg-sim', cx: 1180, cy: 418, r: 22 }], ['path', { class: 'dg-hilo', d: 'M1172 410 V426 M1188 410 V426' }]), txt(1214, 412, 'TC-301', 'dg-f', 'start'), txv('a-tc301-t', 1214, 434, '—', 'dg-f', 'start')),
      g('LOAD-302', dis('a-l302', ['rect', { class: 'dg-caja dg-sim', x: 1205, y: 490, width: 140, height: 60, rx: 6 }], txt(1275, 514, 'LOAD-302', 'dg-f'), txv('a-l302-t', 1275, 536)), txt(1275, 574, 'cargas protegidas', 'dg-t')),
      // línea del ZCS
      cable('a-qf303w', 'M1460 300 V330', 'dg-ac'), nodo(1460, 300), cable('a-i2in', 'M1460 386 V450', 'dg-ac'),
      g('QF-303', polo('a-qf303', 1460, 358, true), txt(1496, 348, 'QF-303', 'dg-f', 'start'), txv('a-qf303-t', 1496, 370, '—', 'dg-f', 'start')),
      g('INV-201', dis('a-inv2', ['rect', { class: 'dg-caja dg-sim', x: 1370, y: 450, width: 180, height: 130, rx: 8 }], txt(1460, 476, 'INV-201 · ZCS', 'dg-f'), txv('a-inv2-t', 1460, 504, '—', 'dg-f'), txv('a-inv2-ca', 1460, 528), txv('a-inv2-v', 1460, 552))),
      txt(1452, 428, 'AC', 'dg-t', 'end'),
      enlace('M1460 580 V650 H530 V328'), txt(980, 640, 'RS485 INV-201 ↔ MED-201', 'dg-t'),
      txt(24, 680, 'Esquema y valores supuestos a partir de las fotos del cuadro (el orden de los aparatos puede variar).', 'dg-t', 'start'),
    ];
    return ['svg', { viewBox: VIEWBOX_CA, class: 'dg-svg', role: 'group', 'aria-label': 'Esquema unifilar de alterna: acometida, cuadro QA-301 con sus protecciones, inversores, cargas y toma. Cada símbolo se puede abrir con Intro.' }, ...h];
  }

  /* ---------- modelo en vivo (ids de las dos hojas) ---------- */
  function calcularUnifilar(e) {
    const hay = !!e, m = {};
    const V = c => ({ e: hay ? (c ? 'vivo' : 'muerto') : 'sd' });
    const P = tag => estadoProt(e, tag), si = (c, a, b) => (hay ? (c ? a : b) : '—');
    const prot = (ids, tag, idt) => { const s = P(tag); for (const id of [].concat(ids)) m[id] = { e: s }; if (idt) m[idt] = { e: s, t: TXT_PROT[s] || '—' }; return s; };

    // paneles y cadenas
    const llega = {}, vivoS = {};
    for (const f of FILAS_A.concat(FILAS_B)) {
      const c = cadenaDe(e, f.id), v = num(c && c.v, 0);
      vivoS[f.id] = !!c && v > 5; llega[f.id] = vivoS[f.id] && !c.abierta;
      m[`c-${f.k}-w`] = V(vivoS[f.id]);
      m[`c-${f.k}-t`] = { e: !c ? 'sd' : c.abierta ? 'disparado' : 'ok', t: c ? `${f.id} · ${dec(v)} V · ${dec(c.i)} A · ${Math.round(num(c.p, 0))} W${c.abierta ? ' · ABIERTA' : ''}` : '—' };
      for (const tag of f.tags) {
        const p = panelDe(e, tag), degradado = p && ((p.bypass || []).some(Boolean) || num(p.sombra01, 0) > 0.3);
        m[`c-pv-${tag}`] = { e: !p ? 'sd' : degradado ? 'degradada' : num(p.p, 0) > 1 ? 'on' : 'off' };
      }
    }
    // campo A: fusibles, seccionador y descargador
    prot('c-f101', 'F-101', 'c-f101-t'); prot('c-f102', 'F-102', 'c-f102-t');
    const qsA = prot(['c-qs101-a', 'c-qs101-b'], 'QS-101', 'c-qs101-t'), spdA = prot('c-spd101', 'SPD-101', 'c-spd101-t');
    m['c-a-n1'] = V(llega['STR-101']); m['c-a-n2'] = V(llega['STR-102']); m['c-a-nbus'] = V(llega['STR-101'] || llega['STR-102']);
    m['c-a-p1a'] = V(llega['STR-101']); m['c-a-p2a'] = V(llega['STR-102']);
    const p1b = llega['STR-101'] && deja(P('F-101')), p2b = llega['STR-102'] && deja(P('F-102'));
    m['c-a-p1b'] = V(p1b); m['c-a-p2b'] = V(p2b); m['c-a-pbus'] = V(p1b || p2b);
    const campoVivoA = hay && (p1b || p2b) && deja(qsA), negVivoA = hay && (llega['STR-101'] || llega['STR-102']) && deja(qsA);
    m['c-a-pq'] = V(campoVivoA); m['c-a-nq'] = V(negVivoA); m['c-a-spd-p'] = V(campoVivoA); m['c-a-spd-n'] = V(negVivoA);

    // inversor EASun, batería y su protección
    const i1 = inversor(e, 'INV-101'), bat = (e && e.bateria) || {}, batVivo = hay && num(bat.v, 0) > 5;
    m['c-inv1'] = { e: hay && i1.estado ? (E_INV[i1.estado] || 'off') : 'sd' };
    m['c-i1-t'] = { e: m['c-inv1'].e, t: hay && i1.estado ? (TXT_INV[i1.estado] || i1.estado) : '—' };
    m['c-i1-modo'] = { e: 'ok', t: hay ? String(i1.modo || '—').replace('_', ' ') : '—' };
    m['c-i1-pv'] = { e: 'ok', t: hay ? `PV ${fmtP(i1.pvP)} · ${Math.round(num(i1.pvV, 0))} V` : '—' };
    m['c-i1-bat'] = { e: 'ok', t: hay ? `Bat ${fmtPs(i1.bateriaP)}` : '—' };
    m['c-i1-red'] = { e: 'ok', t: hay ? `Red ${fmtPs(i1.redP)}` : '—' };
    m['c-i1-ca'] = { e: 'ok', t: hay ? `Carga ${fmtP(i1.cargaP)}` : '—' };
    m['c-i1-temp'] = { e: num(i1.temperaturaC, 0) > 70 ? 'degradada' : 'ok', t: hay ? `${Math.round(num(i1.temperaturaC, 0))} °C · η ${Math.round(num(i1.eficiencia, 0) * (num(i1.eficiencia, 0) <= 1.5 ? 100 : 1))} %` : '—' };
    const qb = prot(['c-qb101-a', 'c-qb101-b'], 'QB-101', 'c-qb101-t'), fb = prot('c-fb101', 'FB-101', 'c-fb101-t');
    m['c-a-bp3'] = V(batVivo); m['c-a-bn2'] = V(batVivo);
    m['c-a-bp2'] = V(batVivo && deja(fb)); m['c-a-bp1'] = V(batVivo && deja(fb) && deja(qb)); m['c-a-bn1'] = V(batVivo && deja(qb));
    const ecom = hayAveria(e, 'COMUNICACION_PERDIDA_EASUN');
    m['c-com'] = { e: hay ? (ecom ? 'fallo' : 'ok') : 'sd' };
    const bmsOK = !bat.bms || bat.bms === 'OK';
    m['c-bat'] = { e: !hay ? 'sd' : bmsOK ? 'on' : 'fallo' };
    m['c-bat-soc'] = { e: m['c-bat'].e, t: hay ? `SoC ${Math.round(num(bat.soc01, 0) * 100)} %` : '—' };
    m['c-bat-v'] = { e: m['c-bat'].e, t: hay ? `${dec(bat.v)} V · ${num(bat.i, 0) >= 0 ? '+' : '−'}${dec(Math.abs(num(bat.i, 0)))} A` : '—' };
    m['c-bat-p'] = { e: m['c-bat'].e, t: hay ? `P ${fmtPs(bat.p)}` : '—' };
    m['c-bat-bms'] = { e: bmsOK || !hay ? m['c-bat'].e : 'fallo', t: hay ? `BMS ${({ CORTE_BAJA: 'CORTE BAJA', CORTE_ALTA: 'CORTE ALTA', CORTE_CORRIENTE: 'CORTE I' })[bat.bms] || String(bat.bms || 'OK')}` : '—' };
    m['c-bat-temp'] = { e: m['c-bat'].e, t: hay ? `${Math.round(num(bat.temperaturaC, 0))} °C` : '—' };

    // campo B
    const qsB = prot([1, 2, 3, 4].map(n => `c-qs201-${n}`), 'QS-201', 'c-qs201-t'); prot('c-spd201', 'SPD-201', 'c-spd201-t');
    const l1 = llega['STR-201'], l2 = llega['STR-202'], qbOK = deja(qsB);
    m['c-b-p1a'] = V(l1); m['c-b-n1a'] = V(l1); m['c-b-p2a'] = V(l2); m['c-b-n2a'] = V(l2);
    m['c-b-p1b'] = V(l1 && qbOK); m['c-b-n1b'] = V(l1 && qbOK); m['c-b-p2b'] = V(l2 && qbOK); m['c-b-n2b'] = V(l2 && qbOK);
    m['c-b-spd-a'] = m['c-b-n1b']; m['c-b-spd-b'] = m['c-b-p2b'];
    const i2 = inversor(e, 'INV-201'), mp = (i2.mppt || []);
    m['c-inv2'] = { e: hay && i2.estado ? (E_INV[i2.estado] || 'off') : 'sd' };
    m['c-i2-t'] = { e: m['c-inv2'].e, t: hay && i2.estado ? (TXT_INV[i2.estado] || i2.estado) : '—' };
    for (const n of [0, 1]) { const q = mp[n] || {}; m[`c-i2-m${n + 1}`] = { e: 'ok', t: hay ? `MPPT${n + 1} ${Math.round(num(q.v, 0))} V · ${dec(q.i)} A` : '—' }; }
    m['c-i2-ca'] = { e: 'ok', t: hay ? `AC ${fmtP(i2.acP)} · ${Math.round(num(i2.acV, 0))} V` : '—' };
    m['c-i2-temp'] = { e: num(i2.temperaturaC, 0) > 70 ? 'degradada' : 'ok', t: hay ? `${Math.round(num(i2.temperaturaC, 0))} °C · η ${Math.round(num(i2.eficiencia, 0) * (num(i2.eficiencia, 0) <= 1.5 ? 100 : 1))} %` : '—' };
    m['c-i2-aisl'] = { e: hay && num(i2.aislamientoMohm, 99) < 1 ? 'fallo' : 'ok', t: hay ? `Aislam. ${dec(i2.aislamientoMohm, 1)} MΩ` : '—' };

    // ---- alterna ----
    const red = (e && e.red) || {}, redViva = hay && red.disponible !== false && num(red.v, 230) > 20;
    m['a-red'] = { e: !hay ? 'sd' : redViva ? 'on' : 'fallo' };
    m['a-red-t'] = { e: m['a-red'].e, t: hay ? `${dec(red.v)} V · ${dec(red.f, 2)} Hz` : '—' };
    m['a-red-e'] = { e: m['a-red'].e, t: hay ? (redViva ? 'CON TENSIÓN' : 'SIN TENSIÓN') : '—' };
    const q1 = prot('a-qf301', 'QF-301', 'a-qf301-t'), d1 = prot('a-id301', 'ID-301', 'a-id301-t');
    const tras1 = redViva && deja(q1), tras2 = tras1 && deja(d1);
    m['a-w1'] = V(redViva); m['a-w2'] = V(tras1); m['a-w3'] = V(tras2); m['a-w4'] = V(tras2); m['a-bus'] = V(tras2);
    m['a-bus-t'] = { e: hay ? (tras2 ? 'vivo' : 'muerto') : 'sd', t: hay ? (tras2 ? `BARRA ${dec(red.v)} V · CON TENSIÓN` : 'BARRA SIN TENSIÓN') : '—' };
    const pr = num(red.p, 0);
    m['a-med'] = { e: hay ? (tras2 ? 'on' : 'off') : 'sd' };
    m['a-med-t'] = { e: 'ok', t: hay ? (pr > 0.5 ? `importa ${fmtP(pr)}` : pr < -0.5 ? `exporta ${fmtP(pr)}` : '0 W') : '—' };
    prot('a-spd301', 'SPD-301', 'a-spd301-t'); m['a-spd'] = V(tras2);
    m['a-l301w'] = V(tras2);
    const l301 = (e && e.cargas && e.cargas['LOAD-301']) || {};
    m['a-l301'] = { e: hay ? (tras2 ? 'on' : 'off') : 'sd' }; m['a-l301-t'] = { e: 'ok', t: hay ? `${fmtP(l301.w)}${l301.manual ? ' · man.' : ''}` : '—' };
    const q2 = prot(['a-qf302', 'a-qf302o'], 'QF-302', 'a-qf302-t');
    m['a-qf302w'] = V(tras2); m['a-i1in'] = V(tras2 && deja(q2));
    m['a-inv1'] = m['c-inv1']; m['a-inv1-t'] = m['c-i1-t'];
    m['a-inv1-red'] = { e: 'ok', t: hay ? `Red ${fmtPs(i1.redP)}` : '—' }; m['a-inv1-ca'] = { e: 'ok', t: hay ? `Carga ${fmtP(i1.cargaP)}` : '—' };
    const l302 = (e && e.cargas && e.cargas['LOAD-302']) || {}, alim = !!(i1.estado && i1.estado !== 'APAGADO' && i1.estado !== 'FALLO') || (tras2 && deja(q2));
    const alimentada = hay && (l302.alimentada !== undefined ? !!l302.alimentada : alim);
    m['a-i1o1'] = V(alimentada); m['a-i1o2'] = V(alimentada && deja(q2)); m['a-toma-w'] = V(alimentada && deja(q2));
    m['a-tc301'] = { e: hay ? (alimentada && deja(q2) ? 'on' : 'off') : 'sd' }; m['a-tc301-t'] = { e: m['a-tc301'].e, t: hay ? (alimentada && deja(q2) ? 'CON TENSIÓN' : 'SIN TENSIÓN') : '—' };
    m['a-l302'] = { e: hay ? (alimentada && deja(q2) ? 'on' : 'off') : 'sd' }; m['a-l302-t'] = { e: 'ok', t: hay ? (alimentada && deja(q2) ? `${fmtP(l302.w)}${l302.manual ? ' · man.' : ''}` : 'SIN TENSIÓN') : '—' };
    const q3 = prot('a-qf303', 'QF-303', 'a-qf303-t');
    m['a-qf303w'] = V(tras2); m['a-i2in'] = V(tras2 && deja(q3));
    m['a-inv2'] = m['c-inv2']; m['a-inv2-t'] = m['c-i2-t'];
    m['a-inv2-ca'] = { e: 'ok', t: hay ? `AC ${fmtP(i2.acP)} · ${dec(i2.acF, 1)} Hz` : '—' };
    m['a-inv2-v'] = { e: 'ok', t: hay ? (num(i2.vertidoP, 0) < -0.5 || num(i2.vertidoP, 0) > 0.5 ? `${num(i2.vertidoP, 0) > 0 ? 'Vierte' : 'Toma'} ${fmtP(i2.vertidoP)}` : 'Sin vertido') : '—' };
    // conexiones a la hoja de continua
    m['c-a-acin'] = m['a-i1in']; m['c-a-acout'] = V(alimentada);
    m['c-b-acout'] = V(tras2 && deja(q3) && (i2.estado === 'OPERANDO' || i2.estado === 'REDUCIDO'));
    return m;
  }

  /** Etiqueta accesible de cada equipo dibujado. */
  function ariaUnifilar(e) {
    const m = calcularUnifilar(e), t = (id, ...resto) => (m[id] && m[id].t ? m[id].t : '—').toLowerCase();
    const o = { 'CB-101': 'CB-101, caja de continua HT 8WAY del campo A', 'QA-301': 'QA-301, cuadro de alterna de la caseta' };
    const prot = (tag, id, texto) => { o[tag] = `${tag}, ${texto}, ${t(id)}`; };
    prot('F-101', 'c-f101-t', 'fusible de cadena'); prot('F-102', 'c-f102-t', 'fusible de cadena'); prot('QS-101', 'c-qs101-t', 'seccionador de continua'); prot('SPD-101', 'c-spd101-t', 'descargador de continua');
    prot('QB-101', 'c-qb101-t', 'magnetotérmico de la batería'); prot('FB-101', 'c-fb101-t', 'portafusible de la batería'); prot('QS-201', 'c-qs201-t', 'seccionador de continua del campo B'); prot('SPD-201', 'c-spd201-t', 'descargador de continua del campo B');
    prot('QF-301', 'a-qf301-t', 'magnetotérmico general'); prot('ID-301', 'a-id301-t', 'diferencial'); prot('QF-302', 'a-qf302-t', 'magnetotérmico de la línea del EASun'); prot('QF-303', 'a-qf303-t', 'magnetotérmico de la línea del ZCS'); prot('SPD-301', 'a-spd301-t', 'descargador de alterna');
    for (const f of FILAS_A.concat(FILAS_B)) o[f.id] = `${f.id}, ${t(`c-${f.k}-t`)}`;
    o['INV-101'] = `INV-101, inversor EASun, ${t('c-i1-t')}, ${t('c-i1-pv')}`; o['INV-201'] = `INV-201, inversor ZCS, ${t('c-i2-t')}, ${t('c-i2-ca')}`;
    o['BAT-101'] = `BAT-101, batería, ${t('c-bat-soc')}, ${t('c-bat-v')}`; o['RED-301'] = `RED-301, acometida, ${t('a-red-e')}, ${t('a-red-t')}`; o['MED-201'] = `MED-201, medidor, ${t('a-med-t')}`;
    o['LOAD-301'] = `LOAD-301, consumo del centro, ${t('a-l301-t')}`; o['LOAD-302'] = `LOAD-302, cargas protegidas, ${t('a-l302-t')}`; o['TC-301'] = `TC-301, toma de corriente, ${t('a-tc301-t')}`; o['COM-101'] = 'COM-101, módulo de comunicaciones';
    for (const f of FILAS_A.concat(FILAS_B)) for (const tag of f.tags) { const p = panelDe(e, tag); o[tag] = `${tag}, panel${p ? `, ${Math.round(num(p.p, 0))} W` : ''}`; }
    return o;
  }

  /* ---------- estado de ejemplo con la forma EXACTA del contrato (ARQUITECTURA.md §3): sirve para las pruebas y para abrir la página sin simulador ---------- */
  function estadoEjemplo() {
    const mk = (id, tags, vp, ip) => ({ id, abierta: false, v: vp * tags.length, i: ip, p: vp * tags.length * ip, voc: vp * 1.22 * tags.length, vmpp: vp * tags.length * 1.04, impp: ip * 1.06, mppEnCurso: true,
      paneles: tags.map(t => ({ tag: t, p: vp * ip, v: vp, tempCelulaC: 51, sombra01: 0, bypass: [false, false, false] })) });
    const cA = layout.CAMPOS.A.cadenas.map(c => mk(c.id, c.paneles, 29.5, 6.8)), cB = layout.CAMPOS.B.cadenas.map(c => mk(c.id, c.paneles, 30.0, 10.4));
    const suma = cs => ({ p: cs.reduce((a, c) => a + c.p, 0), v: cs[0].v, i: cs.reduce((a, c) => a + c.i, 0), cadenas: cs });
    const prot = {}; for (const q of layout.EQUIPOS) if (['seccionador_cc', 'magnetotermico_cc', 'magnetotermico', 'diferencial', 'fusible', 'descargador'].includes(q.tipo)) prot[q.tag] = { estado: 'CERRADO', causa: '' };
    return {
      t: 0, reloj: { diaAnio: 172, horaSolar: 12, texto: '21 jun · 12:00', esDia: true }, sol: { alturaGrados: 75, azimutGrados: 0 }, ambiente: { ghWm2: 900, nubosidad: 0.1, temperaturaAmbienteC: 31, suciedad: { A: 0.03, B: 0.02 } },
      campos: { A: Object.assign({ gPlanoWm2: 930 }, suma(cA)), B: Object.assign({ gPlanoWm2: 900 }, suma(cB)) },
      inversores: {
        'INV-101': { estado: 'OPERANDO', modo: 'SOLAR_PRIMERO', pvV: 88.5, pvI: 13.6, pvP: 1204, bateriaP: 380, redP: 0, cargaP: 780, temperaturaC: 46, eficiencia: 0.93, etapaCarga: 'CC', alarma: '', leds: { red: false, bateria: true, fallo: false } },
        'INV-201': { estado: 'OPERANDO', mppt: [{ v: 120, i: 10.4, p: 1248, activo: true }, { v: 120, i: 10.4, p: 1248, activo: true }], acP: 2400, acV: 232, acF: 50, vertidoP: 1500, temperaturaC: 52, eficiencia: 0.96, aislamientoMohm: 20, leds: { onGrid: true, offGrid: false, alarma: false }, alarma: '', segundosParaConexion: 0 } },
      bateria: { tag: 'BAT-101', soc01: 0.78, v: 26.4, vCeldaMin: 3.29, vCeldaMax: 3.31, i: 14.4, p: 380, temperaturaC: 27, bms: 'OK', energiaWh: 1997 },
      red: { disponible: true, v: 231, f: 50, p: -1500, energiaImportadaWh: 1200, energiaExportadaWh: 300 },
      cargas: { 'LOAD-301': { w: 900, manual: false }, 'LOAD-302': { w: 780, manual: false, alimentada: true } },
      protecciones: prot, energia: { produccionAWh: 5000, produccionBWh: 9000, consumoWh: 7000, autoconsumoPct: 60, ahorroEuros: 1.2 }, alarmas: [], averiasActivas: [],
    };
  }

  /* ---------- exportación ---------- */
  const ESQUEMA_CC = construirContinua(), ESQUEMA_CA = construirAlterna();
  const HOJAS = [{ id: 'continua', nombre: 'Continua (CC)', esquema: ESQUEMA_CC, viewBox: VIEWBOX_CC }, { id: 'alterna', nombre: 'Alterna (CA)', esquema: ESQUEMA_CA, viewBox: VIEWBOX_CA }];
  const tagsDelEsquema = () => { const t = new Set(); for (const h of HOJAS) tagsDe(h.esquema).forEach(x => t.add(x)); return t; };
  const crearObjetos = canvas => crearObjetosDesde(canvas, calcularUnifilar, ariaUnifilar);

  const comun = { layout, num, dec, fmtP, fmtPs, corto, estadoProt, deja, cadenaDe, panelDe, inversor, hayAveria, txt, txv, cable, fijo, enlace, dis, nodo, g, borne, tierra, polo, fusible, descargador, panel, leyendaSvg, tagsDe, idsDe, recorrer, crearObjetosDesde, estadoEjemplo };
  const api = { VIEWBOX_CC, VIEWBOX_CA, ESQUEMA_CC, ESQUEMA_CA, HOJAS, tagsDelEsquema, crearObjetos, calcularUnifilar, ariaUnifilar, estadoEjemplo, comun };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.fvDiagramaUnifilar = api; }
})();
