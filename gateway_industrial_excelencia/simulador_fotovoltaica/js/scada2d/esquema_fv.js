// Sinóptico 2D (SVG) de la instalación fotovoltaica de la cubierta, hecho a partir de las fotos: a la izquierda los dos campos de paneles (A: 2 cadenas de 3; B: 2 cadenas
// de 4) con su bandeja de cables; dentro de la caseta, la caja «HT 8WAY» y el EASun con su batería (arriba) y la caja auxiliar y el ZCS Azzurro (abajo); a la derecha el cuadro
// de alterna con la acometida de red y las dos cargas. Los flujos de potencia son cables animados con su sentido (flechas y puntos en movimiento) y su grosor sigue la potencia;
// en cada tramo hay una burbuja de medida (V, A, W). El estado de cada equipo se ve por COLOR y por FORMA (verde = en servicio, ámbar = aviso, rojo = alarma, gris = parado).
// Todo lo que decide qué se dibuja (estado visual de cada equipo, reparto de flujos, textos de las burbujas) es puro y se prueba sin navegador (tests/interfaz_esquema.test.js).
(function () {
  const enNode = typeof require !== 'undefined';
  const layout = enNode ? require('../layout.js') : PCT.fvLayout;
  const F = enNode ? require('../interfaz/formato_fv.js') : PCT.fvFormato;
  const compartido = nombre => (enNode ? null : PCT[nombre]);
  const { formatoPotencia, formatoTension, formatoCorriente, formatoPorcentaje, formatoTemperatura, dec } = F;

  const TIPOS = {}; for (const q of layout.EQUIPOS) TIPOS[q.tag] = q.tipo;
  const PROTECCIONES = ['QS-101', 'QB-101', 'QS-201', 'QF-301', 'ID-301', 'QF-302', 'QF-303'];
  const FUSIBLES = ['F-101', 'F-102', 'FB-101'];
  const DESCARGADORES = ['SPD-101', 'SPD-201', 'SPD-301'];

  /* ---------- lectura del estado (pura) ---------- */
  const campo = (e, id) => (e && e.campos && e.campos[id]) || null;
  const inversor = (e, tag) => (e && e.inversores && e.inversores[tag]) || {};
  const proteccion = (e, tag) => (e && e.protecciones && e.protecciones[tag]) || {};
  const bateria = e => (e && e.bateria) || {};
  const red = e => (e && e.red) || {};
  const carga = (e, tag) => (e && e.cargas && e.cargas[tag]) || {};
  const averiaActiva = (e, id) => !!(e && e.averiasActivas && e.averiasActivas.includes(id));
  function cadenaDe(e, id) { for (const c of ['A', 'B']) { const f = campo(e, c); const x = f && (f.cadenas || []).find(s => s.id === id); if (x) return x; } return null; }
  function panelDe(e, tag) { for (const c of ['A', 'B']) { const f = campo(e, c); for (const s of (f && f.cadenas) || []) { const p = (s.paneles || []).find(x => x.tag === tag); if (p) return { panel: p, cadena: s }; } } return null; }
  const numero = (v, def = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : def);

  /** Severidad más grave de las alarmas del modelo que cuelgan de ese tag: 'alarma' | 'aviso' | 'ok' (info) | null. */
  function alarmaDeTag(e, tag) {
    let mejor = null;
    for (const a of (e && e.alarmas) || []) { if (a.tag === tag) { const s = F.DE_SEVERIDAD[a.severidad] || 'aviso'; mejor = mejor ? F.peor(mejor, s) : s; } }
    return mejor === 'ok' ? null : mejor;
  }

  /**
   * Estado visual de un equipo: 'ok' (verde, en servicio), 'aviso' (ámbar), 'alarma' (rojo) o 'parado' (gris). Sale del estado del modelo, no de números fijos.
   */
  function estadoVisual(e, tag) {
    if (!e) return 'parado';
    const tipo = TIPOS[tag];
    const conAlarma = base => { const a = alarmaDeTag(e, tag); return a ? F.peor(base, a) : base; };
    const hayFlujo = () => numero(campo(e, 'A') && campo(e, 'A').p) + numero(campo(e, 'B') && campo(e, 'B').p) > 1;
    switch (tipo) {
      case 'panel': {
        const d = panelDe(e, tag); if (!d) return 'parado';
        const { panel, cadena } = d;
        if (cadena.abierta) return conAlarma('alarma');
        if ((panel.bypass || []).some(Boolean) || numero(panel.sombra01) > 0.25) return conAlarma('aviso');
        return conAlarma(numero(panel.p) > 1 ? 'ok' : 'parado');
      }
      case 'cadena': {
        const s = cadenaDe(e, tag); if (!s) return 'parado';
        if (s.abierta) return conAlarma('alarma');
        return conAlarma(numero(s.p) > 1 ? 'ok' : 'parado');
      }
      case 'fusible': { const x = proteccion(e, tag).estado; return conAlarma(x === 'FUNDIDO' ? 'alarma' : x === 'ABIERTO' ? 'parado' : 'ok'); }
      case 'seccionador_cc': case 'magnetotermico_cc': case 'magnetotermico': case 'diferencial': {
        const x = proteccion(e, tag).estado;
        return conAlarma(x === 'DISPARADO' || x === 'FUNDIDO' ? 'alarma' : x === 'ABIERTO' ? 'parado' : 'ok');
      }
      case 'descargador': return conAlarma(proteccion(e, tag).estado === 'AGOTADO' ? 'alarma' : 'ok');
      case 'inversor_hibrido': {
        const x = inversor(e, tag).estado;
        const base = x === 'OPERANDO' ? 'ok' : x === 'FALLO' ? 'alarma' : x === 'REDUCIDO' || x === 'ESPERA_AISLAMIENTO' || x === 'ESPERA_RED' ? 'aviso' : 'parado';
        return conAlarma(base);
      }
      case 'bateria': { const b = bateria(e); return conAlarma(b.bms && b.bms !== 'OK' ? 'alarma' : numero(b.soc01, 1) < 0.15 ? 'aviso' : 'ok'); }
      case 'red': { const r = red(e); return conAlarma(r.disponible === false ? 'alarma' : numero(r.v, 230) > 253 ? 'aviso' : 'ok'); }
      case 'carga': { const c = carga(e, tag); return conAlarma(c.alimentada === false ? 'alarma' : numero(c.w) > 0 ? 'ok' : 'parado'); }
      case 'medidor': return conAlarma(inversor(e, 'INV-201').estado === 'OPERANDO' ? 'ok' : 'parado');
      case 'comunicaciones': return conAlarma(averiaActiva(e, 'COMUNICACION_PERDIDA_EASUN') ? 'aviso' : 'ok');
      case 'caseta': { const t = Math.max(numero(inversor(e, 'INV-101').temperaturaC), numero(inversor(e, 'INV-201').temperaturaC)); return conAlarma(averiaActiva(e, 'VENTILACION_TAPADA') || t > 65 ? 'aviso' : 'ok'); }
      case 'caja_cc': case 'cuadro_ca': case 'toma': case 'bandeja': return conAlarma(hayFlujo() || tipo === 'cuadro_ca' ? 'ok' : 'parado');
      default: return conAlarma('parado');
    }
  }

  /** Texto de estado de un equipo para el lector de pantalla y la barra de estado: «cerrado», «OPERANDO, 2,1 kW»… */
  function estadoEquipo(e, tag) {
    if (!e) return '—';
    const tipo = TIPOS[tag];
    switch (tipo) {
      case 'panel': { const d = panelDe(e, tag); if (!d) return '—'; return `${formatoPotencia(d.panel.p)}, ${formatoTemperatura(d.panel.tempCelulaC)} de célula${numero(d.panel.sombra01) > 0 ? `, sombra ${Math.round(d.panel.sombra01 * 100)} %` : ''}${(d.panel.bypass || []).some(Boolean) ? ', diodo de paso activo' : ''}`; }
      case 'cadena': { const s = cadenaDe(e, tag); if (!s) return '—'; return s.abierta ? `abierta, Voc ${formatoTension(s.voc)}` : `${formatoTension(s.v)}, ${formatoCorriente(s.i)}, ${formatoPotencia(s.p)}`; }
      case 'fusible': case 'seccionador_cc': case 'magnetotermico_cc': case 'magnetotermico': case 'diferencial': case 'descargador': return (proteccion(e, tag).estado || '—').toLowerCase();
      case 'inversor_hibrido': { const i = inversor(e, tag); return `${(i.estado || '—').replace(/_/g, ' ').toLowerCase()}${tag === 'INV-101' ? `, ${formatoPotencia(i.pvP)} solar` : `, ${formatoPotencia(i.acP)} a la red`}`; }
      case 'bateria': { const b = bateria(e); return `${formatoPorcentaje(b.soc01)}, ${formatoTension(b.v)}, BMS ${b.bms || '—'}`; }
      case 'red': { const r = red(e); return r.disponible === false ? 'sin red' : `${formatoTension(r.v)}, ${dec(r.f, 2)} Hz`; }
      case 'carga': return `${formatoPotencia(carga(e, tag).w)}${carga(e, tag).alimentada === false ? ', sin alimentación' : ''}`;
      default: return estadoVisual(e, tag) === 'parado' ? 'sin actividad' : estadoVisual(e, tag) === 'ok' ? 'en servicio' : estadoVisual(e, tag);
    }
  }
  /** Etiqueta accesible de un equipo: «INV-101, funcionando, operando». */
  function etiquetaAria(e, tag) {
    const q = layout.EQUIPOS.find(x => x.tag === tag), v = estadoVisual(e, tag);
    return `${tag}${q ? ' ' + q.nombre : ''}, ${{ ok: 'en servicio', aviso: 'aviso', alarma: 'alarma', parado: 'parado' }[v]}, ${estadoEquipo(e, tag)}`;
  }

  /* ---------- flujos de potencia ---------- */
  // Cada tramo se dibuja con una ruta en un sentido (el de «positivo»); `sentido` = +1 si la potencia va en ese sentido y −1 si va al revés.
  //   kind: 'solar' (continua de paneles, ámbar), 'bateria' (verde), 'red' (alterna de la red, azul), 'carga' (alterna hacia consumos y producción del ZCS, violeta)
  const TRAMOS = {
    'STR-101': { kind: 'solar', desde: 'STR-101', hacia: 'CB-101' }, 'STR-102': { kind: 'solar', desde: 'STR-102', hacia: 'CB-101' },
    'CCA': { kind: 'solar', desde: 'CB-101', hacia: 'INV-101' },
    'BAT': { kind: 'bateria', desde: 'INV-101', hacia: 'BAT-101' },
    'STR-201': { kind: 'solar', desde: 'STR-201', hacia: 'INV-201' }, 'STR-202': { kind: 'solar', desde: 'STR-202', hacia: 'INV-201' },
    'LOAD-302': { kind: 'carga', desde: 'INV-101', hacia: 'LOAD-302' },
    'REDA': { kind: 'red', desde: 'QA-301', hacia: 'INV-101' },
    'ZCS': { kind: 'carga', desde: 'INV-201', hacia: 'QA-301' },
    'RED': { kind: 'red', desde: 'RED-301', hacia: 'QA-301' },
    'LOAD-301': { kind: 'carga', desde: 'QA-301', hacia: 'LOAD-301' },
  };
  const UMBRAL_FLUJO_W = 1;
  /**
   * Reparto de flujos de potencia del estado: { idTramo: { p /* W, siempre ≥ 0 *\/, sentido /* +1 o −1 *\/, activo, kind } }.
   * Las cadenas y el campo dan su potencia hacia la caja y el inversor; la batería es + si carga (el flujo baja al banco) y − si descarga; la red es + si importa del centro.
   */
  function repartoFlujos(e) {
    const r = {};
    const poner = (id, w, sentido = 1) => { const p = Math.abs(numero(w)); r[id] = { p, sentido: numero(w) < 0 ? -sentido : sentido, activo: p > UMBRAL_FLUJO_W, kind: TRAMOS[id].kind }; };
    for (const id of ['STR-101', 'STR-102', 'STR-201', 'STR-202']) { const s = cadenaDe(e, id); poner(id, s && !s.abierta ? s.p : 0); }
    const fa = campo(e, 'A'); poner('CCA', fa ? fa.p : 0);
    const i1 = inversor(e, 'INV-101'), i2 = inversor(e, 'INV-201'), b = bateria(e);
    poner('BAT', typeof i1.bateriaP === 'number' ? i1.bateriaP : b.p);
    const alim = carga(e, 'LOAD-302');
    poner('LOAD-302', typeof i1.cargaP === 'number' ? i1.cargaP : (alim.alimentada === false ? 0 : alim.w));
    poner('REDA', numero(i1.redP));
    poner('ZCS', numero(i2.acP));
    poner('RED', numero(red(e).p));
    poner('LOAD-301', carga(e, 'LOAD-301').w);
    return r;
  }

  /** Grosor (px) y duración de ciclo (s) del flujo animado de un tramo para una potencia: más potencia, más grueso y más rápido. */
  const grosorFlujo = p => 3 + 5 * Math.min(1, Math.max(0, p) / 3000);
  const cicloFlujo = p => 1.8 - 1.3 * Math.min(1, Math.max(0, p) / 3000);

  /* ---------- burbujas de medida ---------- */
  const conSigno = (v, c = 1) => (typeof v === 'number' && Number.isFinite(v) ? `${v > 0.005 ? '+' : ''}${dec(v, c)}` : '—');
  /** Textos de las burbujas de medida: { id: [líneas] }. Las de cadena (STR-*) son de una sola línea. */
  function lecturasBurbujas(e) {
    const L = {};
    for (const id of ['STR-101', 'STR-102', 'STR-201', 'STR-202']) {
      const s = cadenaDe(e, id);
      L[id] = [!s ? '—' : s.abierta ? `ABIERTA · Voc ${formatoTension(s.voc, 0)}` : `${formatoTension(s.v, 0)} · ${formatoCorriente(s.i, 1)} · ${formatoPotencia(s.p)}`];
    }
    const fa = campo(e, 'A'), b = bateria(e), r = red(e), i1 = inversor(e, 'INV-101'), i2 = inversor(e, 'INV-201');
    L.CCA = [formatoTension(fa && fa.v, 0), formatoCorriente(fa && fa.i, 1), formatoPotencia(fa && fa.p)];
    L.BAT = [formatoTension(b.v), `${conSigno(b.i, 1)} A`, formatoPotencia(b.p)];
    const v = r.disponible === false ? 0 : numero(r.v, 230);
    L['LOAD-302'] = [formatoTension(v, 0), formatoPotencia(typeof i1.cargaP === 'number' ? i1.cargaP : carga(e, 'LOAD-302').w)];
    L.REDA = [formatoTension(v, 0), formatoPotencia(Math.max(0, numero(i1.redP)))];
    L.ZCS = [formatoTension(i2.acV, 0), `${dec(i2.acF, 2)} Hz`, formatoPotencia(i2.acP)];
    L.RED = [formatoTension(r.disponible === false ? 0 : r.v, 0), `${dec(r.disponible === false ? 0 : r.f, 2)} Hz`, r.disponible === false ? 'SIN RED' : `${numero(r.p) < -UMBRAL_FLUJO_W ? 'exporta' : 'importa'} ${formatoPotencia(Math.abs(numero(r.p)))}`];
    L['LOAD-301'] = [formatoTension(v, 0), formatoPotencia(carga(e, 'LOAD-301').w)];
    return L;
  }

  /** Líneas de la pantalla del EASun, del ZCS y de la batería, y textos de las cajas. { id: texto } */
  function textosEquipos(e) {
    const T = {};
    const i1 = inversor(e, 'INV-101'), i2 = inversor(e, 'INV-201'), b = bateria(e), r = red(e), fa = campo(e, 'A'), fb = campo(e, 'B');
    const nombreEstado = s => (s ? s.replace(/_/g, ' ') : '—');
    T['t-INV-101-estado'] = nombreEstado(i1.estado);
    T['t-INV-101-l1'] = `PV ${formatoTension(fa && fa.v, 0)}  ${formatoPotencia(i1.pvP)}`;
    T['t-INV-101-l2'] = `BAT ${formatoTension(b.v)}  ${formatoPorcentaje(b.soc01)}`;
    T['t-INV-101-l3'] = `${i1.etapaCarga && i1.etapaCarga !== 'NINGUNA' ? i1.etapaCarga : 'sin carga'} · ${formatoTemperatura(i1.temperaturaC)}`;
    T['t-INV-101-modo'] = `modo ${nombreEstado(i1.modo).toLowerCase()}`;
    T['t-INV-101-alarma'] = i1.alarma || '';
    T['t-INV-201-estado'] = nombreEstado(i2.estado);
    const m = i2.mppt || [];
    T['t-INV-201-l1'] = m[0] ? `MPPT1 ${formatoTension(m[0].v, 0)}  ${formatoPotencia(m[0].p)}` : 'MPPT1 —';
    T['t-INV-201-l2'] = m[1] ? `MPPT2 ${formatoTension(m[1].v, 0)}  ${formatoPotencia(m[1].p)}` : 'MPPT2 —';
    T['t-INV-201-l3'] = i2.estado === 'ESPERA_RED' ? `conecta en ${Math.max(0, Math.ceil(numero(i2.segundosParaConexion)))} s` : `aislamiento ${dec(i2.aislamientoMohm, 1)} MΩ`;
    T['t-INV-201-l4'] = `${formatoPotencia(i2.acP)} · ${formatoTemperatura(i2.temperaturaC)}`;
    T['t-INV-201-alarma'] = i2.alarma || '';
    T['t-BAT-101-v'] = `${formatoTension(b.v)} · ${formatoPorcentaje(b.soc01)}`;
    T['t-BAT-101-i'] = `${conSigno(b.i, 1)} A · ${formatoTemperatura(b.temperaturaC)}`;
    T['t-BAT-101-bms'] = `BMS ${b.bms || '—'}`;
    T['t-BAT-101-celdas'] = `celdas ${dec(b.vCeldaMin, 2)}–${dec(b.vCeldaMax, 2)} V`;
    T['t-RED-301-estado'] = r.disponible === false ? 'SIN RED' : 'red del centro';
    T['t-LOAD-301-w'] = formatoPotencia(carga(e, 'LOAD-301').w);
    T['t-LOAD-301-modo'] = carga(e, 'LOAD-301').manual ? 'manual' : 'automático';
    T['t-LOAD-302-w'] = formatoPotencia(carga(e, 'LOAD-302').w);
    T['t-LOAD-302-modo'] = carga(e, 'LOAD-302').alimentada === false ? 'SIN ALIMENTACIÓN' : carga(e, 'LOAD-302').manual ? 'manual' : 'automático';
    T['t-MED-201'] = formatoPotencia(i2.vertidoP);
    T['t-fa'] = fa ? `${formatoPotencia(fa.p)} · ${dec(numero(e.campos.A.gPlanoWm2), 0)} W/m²` : '—';
    T['t-fb'] = fb ? `${formatoPotencia(fb.p)} · ${dec(numero(e.campos.B.gPlanoWm2), 0)} W/m²` : '—';
    return T;
  }

  /** LEDs de los inversores: { 'led-INV-101-red': bool, … } */
  function ledsInversores(e) {
    const a = inversor(e, 'INV-101').leds || {}, z = inversor(e, 'INV-201').leds || {};
    return { 'led-INV-101-red': !!a.red, 'led-INV-101-bateria': !!a.bateria, 'led-INV-101-fallo': !!a.fallo, 'led-INV-201-onGrid': !!z.onGrid, 'led-INV-201-offGrid': !!z.offGrid, 'led-INV-201-alarma': !!z.alarma };
  }

  /* ---------- esquema ---------- */
  const W = 1740, H = 860;
  const VIEWBOX = `0 0 ${W} ${H}`;
  const g = (tag, ...hijos) => ['g', { id: `g-${tag}`, 'data-tag': tag, tabindex: 0, role: 'button', 'aria-label': tag }, ...hijos];
  const txt = (x, y, t, clase = 'fv-tag', extra = {}) => ['text', Object.assign({ x, y, class: clase }, extra), t];
  const izq = { style: 'text-anchor:start' }, der = { style: 'text-anchor:end' };
  const cable = (id, d) => ['path', { class: `cable ${TRAMOS[id].kind}`, 'data-flujo': id, d }];
  const hilo = d => ['path', { class: 'hilo', d }];

  /** Panel solar: marco, celdas, sombra (capa oscura), las tres subcadenas con diodo de paso (rojas si el diodo conduce), su tag y su potencia. */
  function panel(tag, x, y, w, h) {
    const celdas = []; for (let i = 1; i < 6; i++) celdas.push(`M${x + w * i / 6} ${y + 2} V${y + h - 2}`); for (let j = 1; j < 4; j++) celdas.push(`M${x + 2} ${y + h * j / 4} H${x + w - 2}`);
    const t = (w - 8) / 3;
    return g(tag, ['rect', { class: 'forma panel', id: `p-${tag}`, x, y, width: w, height: h, rx: 3 }], ['path', { class: 'celdas', d: celdas.join(' ') }],
      ['rect', { class: 'sombra', id: `sh-${tag}`, x, y, width: w, height: h, rx: 3 }],
      ...[0, 1, 2].map(k => ['rect', { class: 'bypass', id: `by-${tag}-${k}`, x: x + 4 + k * t, y: y + h - 8, width: t - 2, height: 5, rx: 1 }]),
      ['rect', { class: 'etq-fondo', x: x + w / 2 - 33, y: y + 7, width: 66, height: 33, rx: 4 }],
      txt(x + w / 2, y + 21, tag, 'fv-tag fv-mini fv-fuerte'), txt(x + w / 2, y + 35, '—', 'fv-valor fv-mini', { id: `pw-${tag}` }));
  }
  /** Burbuja de medida centrada en (cx, cy) con `n` líneas; el texto lo pone la página. */
  function burbuja(id, cx, cy, w, n) {
    const h = n * 15 + 9, y0 = cy - h / 2;
    return ['g', { class: 'burbuja', id: `b-${id}` }, ['rect', { x: cx - w / 2, y: y0, width: w, height: h, rx: 6 }],
      ...Array.from({ length: n }, (_, k) => txt(cx, y0 + 16 + k * 15, '—', 'fv-medida', { id: `bt-${id}-${k}` }))];
  }
  /** Interruptor automático / seccionador / diferencial: palanca arriba (cerrado) o torcida (abierto o disparado). */
  function interruptor(tag, x, y, rotulo = tag) {
    return g(tag, ['rect', { class: 'forma', x: x - 12, y: y - 19, width: 24, height: 38, rx: 4 }],
      ['path', { class: 'palanca pal-c', d: `M${x} ${y - 11} V${y + 9}` }], ['path', { class: 'palanca pal-a', d: `M${x} ${y + 9} L${x + 8} ${y - 9}` }],
      ['circle', { class: 'borna', cx: x, cy: y - 19, r: 2.6 }], ['circle', { class: 'borna', cx: x, cy: y + 19, r: 2.6 }],
      txt(x, y + 34, rotulo, 'fv-tag fv-mini fv-fuerte'));
  }
  /** Fusible: cuerpo con hilo; si está fundido el hilo se corta. */
  function fusible(tag, x, y, lado = 'abajo') {
    return g(tag, ['rect', { class: 'forma', x: x - 16, y: y - 8, width: 32, height: 16, rx: 3 }], ['path', { class: 'fus-hilo', d: `M${x - 12} ${y} H${x + 12}` }],
      ['path', { class: 'fus-roto', d: `M${x - 12} ${y} H${x - 4} M${x + 4} ${y} H${x + 12} M${x - 3} ${y - 5} L${x + 3} ${y + 5}` }],
      txt(x, lado === 'abajo' ? y + 24 : y - 14, tag, 'fv-tag fv-mini fv-fuerte'));
  }
  /** Descargador de sobretensiones con testigo (verde sano, rojo agotado). */
  function descargador(tag, x, y) {
    return g(tag, ['rect', { class: 'forma', x: x - 19, y: y - 14, width: 38, height: 28, rx: 4 }], txt(x - 5, y + 4, 'SPD', 'fv-tag fv-mini'), ['circle', { class: 'testigo', cx: x + 12, cy: y - 5, r: 4 }],
      txt(x, y + 29, tag, 'fv-tag fv-mini fv-fuerte'));
  }
  const led = (id, x, y, texto) => ['g', { class: 'led-fv' }, ['circle', { class: 'led', id, cx: x, cy: y, r: 5 }], txt(x, y + 15, texto, 'fv-tag fv-micro')];

  function construirEsquema() {
    const hijos = [];
    const add = (...x) => hijos.push(...x);
    
    // --- caseta y bandeja (de fondo; solo el trazo recibe el clic para no tapar lo de dentro) ---
    add(g('CAS-001', ['rect', { class: 'caseta', x: 392, y: 12, width: 1016, height: 826, rx: 10 }], txt(404, 30, 'CASETA METÁLICA · CAS-001', 'fv-zona', izq)));
    add(g('BAN-001', ['rect', { class: 'bandeja', x: 355, y: 40, width: 28, height: 740, rx: 4 }], txt(369, 410, 'BANDEJA DE REJILLA · BAN-001', 'fv-zona', { transform: 'rotate(-90 369 410)' })));

    // --- campo A: 6 paneles policristalinos, 2 cadenas de 3 ---
    add(txt(20, 36, 'CAMPO A · 6 paneles policristalinos de 250 Wp · 15° al sur', 'fv-zona', izq), txt(20, 52, '—', 'fv-valor fv-izq', Object.assign({ id: 't-fa' }, izq)));
    layout.CAMPOS.A.cadenas.forEach((s, fila) => {
      const y = 70 + fila * 120;
      add(...s.paneles.map((tag, k) => panel(tag, 20 + k * 110, y, 100, 64)));
      add(g(s.id, ['rect', { class: 'forma cadena', x: 20, y: y + 70, width: 320, height: 24, rx: 12 }], txt(180, y + 87, '—', 'fv-valor', { id: `bt-${s.id}-0` })));
      add(txt(24, y - 6, s.id, 'fv-tag fv-mini', izq));
    });
    // --- campo B: 8 paneles monocristalinos negros, 2 cadenas de 4 ---
    add(txt(20, 496, 'CAMPO B · 8 paneles monocristalinos de 400 Wp · 28° al sur', 'fv-zona', izq), txt(20, 512, '—', 'fv-valor', Object.assign({ id: 't-fb' }, izq)));
    layout.CAMPOS.B.cadenas.forEach((s, fila) => {
      const y = 530 + fila * 125;
      add(...s.paneles.map((tag, k) => panel(tag, 20 + k * 84, y, 76, 60)));
      add(g(s.id, ['rect', { class: 'forma cadena', x: 20, y: y + 66, width: 320, height: 24, rx: 12 }], txt(180, y + 83, '—', 'fv-valor', { id: `bt-${s.id}-0` })));
      add(txt(24, y - 6, s.id, 'fv-tag fv-mini', izq));
    });

    // --- cables de continua del campo A (hilo gris debajo, flujo animado encima) ---
    add(cable('STR-101', 'M340 102 H510 V162'), cable('STR-102', 'M340 222 H510 V162'), cable('CCA', 'M510 162 H760'));
    // caja «HT 8WAY»
    add(g('CB-101', ['rect', { class: 'forma caja', x: 400, y: 44, width: 200, height: 262, rx: 8 }], txt(500, 62, 'CB-101 · caja HT 8WAY', 'fv-tag fv-fuerte')));
    add(fusible('F-101', 450, 102), fusible('F-102', 450, 222), interruptor('QS-101', 560, 162), descargador('SPD-101', 560, 258));
    add(['path', { class: 'enlace', d: 'M560 181 V244' }]);
    // --- inversor EASun ---
    add(g('INV-101', ['rect', { class: 'forma inversor easun', x: 760, y: 50, width: 200, height: 250, rx: 10 }], ['rect', { class: 'franja-azul', x: 760, y: 262, width: 200, height: 38, rx: 0 }],
      txt(860, 72, 'INV-101 · EASun híbrido', 'fv-tag fv-fuerte'), txt(860, 90, '—', 'fv-tag fv-chip', { id: 't-INV-101-estado' }),
      ['rect', { class: 'pantalla', x: 780, y: 100, width: 160, height: 62, rx: 6 }],
      txt(788, 120, '—', 'fv-pantalla', Object.assign({ id: 't-INV-101-l1' }, izq)), txt(788, 138, '—', 'fv-pantalla', Object.assign({ id: 't-INV-101-l2' }, izq)), txt(788, 156, '—', 'fv-pantalla', Object.assign({ id: 't-INV-101-l3' }, izq)),
      led('led-INV-101-red', 800, 186, 'AC'), led('led-INV-101-bateria', 840, 186, 'BAT'), led('led-INV-101-fallo', 880, 186, 'FALLO'),
      txt(860, 224, '—', 'fv-tag', { id: 't-INV-101-modo' }), txt(860, 244, '', 'fv-tag fv-alarma-txt', { id: 't-INV-101-alarma' }),
      txt(860, 286, 'Hybrid Solar Inverter', 'fv-tag fv-mini fv-blanco')));
    add(g('COM-101', ['rect', { class: 'forma', x: 722, y: 262, width: 34, height: 18, rx: 3 }], txt(739, 275, 'COM', 'fv-tag fv-micro'), txt(739, 295, 'COM-101', 'fv-tag fv-micro')));
    add(txt(752, 156, 'PV', 'fv-tag fv-mini', der));
    // salida a cargas, entrada de red y batería
    add(cable('LOAD-302', 'M960 100 H1530'), cable('REDA', 'M1270 215 H960'));
    add(txt(966, 88, 'salida a cargas protegidas', 'fv-tag fv-mini', izq), txt(966, 203, 'entrada de red', 'fv-tag fv-mini', izq));
    add(cable('BAT', 'M860 300 V400'));
    add(interruptor('QB-101', 860, 330), fusible('FB-101', 860, 376, 'izq'));
    add(g('BAT-101', ['rect', { class: 'forma bateria', x: 760, y: 400, width: 200, height: 112, rx: 8 }], txt(860, 420, 'BAT-101 · LiFePO4 25,6 V 100 Ah', 'fv-tag fv-fuerte'),
      ['rect', { class: 'soc-fondo', x: 776, y: 430, width: 168, height: 16, rx: 4 }], ['rect', { class: 'soc', id: 'soc-BAT-101', x: 776, y: 430, width: 0, height: 16, rx: 4 }],
      txt(860, 464, '—', 'fv-valor', { id: 't-BAT-101-v' }), txt(860, 481, '—', 'fv-tag', { id: 't-BAT-101-i' }), txt(860, 497, '—', 'fv-tag fv-mini', { id: 't-BAT-101-bms' }), txt(860, 508, '', 'fv-tag fv-micro', { id: 't-BAT-101-celdas' })));

    // --- campo B: caja auxiliar y ZCS ---
    add(cable('STR-201', 'M340 560 H760'), cable('STR-202', 'M340 685 H760'));
    add(['rect', { class: 'caja-aux', x: 410, y: 522, width: 190, height: 262, rx: 8 }], txt(505, 540, 'Caja de continua del campo B', 'fv-tag fv-mini'));
    add(g('QS-201', ['rect', { class: 'forma', x: 470, y: 548, width: 26, height: 150, rx: 4 }], ['path', { class: 'palanca pal-c', d: 'M483 562 V598 M483 650 V686' }], ['path', { class: 'palanca pal-a', d: 'M483 598 L491 562 M483 686 L491 650' }],
      txt(483, 716, 'QS-201', 'fv-tag fv-mini fv-fuerte')));
    add(descargador('SPD-201', 560, 745), ['path', { class: 'enlace', d: 'M560 685 V731' }]);
    add(g('INV-201', ['rect', { class: 'forma inversor zcs', x: 760, y: 520, width: 200, height: 200, rx: 10 }], txt(860, 542, 'INV-201 · ZCS Azzurro', 'fv-tag fv-fuerte'), txt(860, 560, '—', 'fv-tag fv-chip', { id: 't-INV-201-estado' }),
      ['rect', { class: 'pantalla', x: 776, y: 570, width: 168, height: 78, rx: 6 }],
      txt(784, 589, '—', 'fv-pantalla', Object.assign({ id: 't-INV-201-l1' }, izq)), txt(784, 606, '—', 'fv-pantalla', Object.assign({ id: 't-INV-201-l2' }, izq)),
      txt(784, 623, '—', 'fv-pantalla', Object.assign({ id: 't-INV-201-l3' }, izq)), txt(784, 640, '—', 'fv-pantalla', Object.assign({ id: 't-INV-201-l4' }, izq)),
      led('led-INV-201-onGrid', 796, 668, 'On-Grid'), led('led-INV-201-offGrid', 860, 668, 'Off-Grid'), led('led-INV-201-alarma', 924, 668, 'Alarm'),
      txt(860, 706, '', 'fv-tag fv-alarma-txt', { id: 't-INV-201-alarma' })));
    add(txt(752, 552, 'MPPT1', 'fv-tag fv-mini', der), txt(752, 677, 'MPPT2', 'fv-tag fv-mini', der));
    add(cable('ZCS', 'M960 600 H1270'));
    add(g('MED-201', ['rect', { class: 'forma', x: 988, y: 582, width: 44, height: 36, rx: 4 }], txt(1010, 597, 'kWh', 'fv-tag fv-micro'), txt(1010, 611, '—', 'fv-valor fv-micro', { id: 't-MED-201' }), txt(1010, 636, 'MED-201', 'fv-tag fv-mini fv-fuerte')));

    // --- cuadro de alterna, red y cargas ---
    add(cable('RED', 'M1530 420 H1270'), cable('LOAD-301', 'M1270 700 H1530'));
    add(hilo('M1270 215 V700'));
    add(g('QA-301', ['rect', { class: 'forma caja', x: 1170, y: 140, width: 220, height: 680, rx: 8 }], txt(1280, 160, 'QA-301 · cuadro de alterna', 'fv-tag fv-fuerte')));
    add(interruptor('QF-302', 1215, 215), interruptor('QF-303', 1215, 600), interruptor('QF-301', 1345, 420), interruptor('ID-301', 1300, 420));
    add(descargador('SPD-301', 1230, 770), ['path', { class: 'enlace', d: 'M1270 700 V756' }], g('TC-301', ['rect', { class: 'forma', x: 1330, y: 752, width: 40, height: 36, rx: 6 }], ['circle', { class: 'borna', cx: 1344, cy: 770, r: 3 }], ['circle', { class: 'borna', cx: 1358, cy: 770, r: 3 }], txt(1350, 806, 'TC-301 schuko', 'fv-tag fv-mini fv-fuerte')));
    add(['path', { class: 'enlace', d: 'M1350 700 V752' }]);
    add(g('RED-301', ['rect', { class: 'forma red', x: 1530, y: 370, width: 200, height: 100, rx: 8 }], txt(1630, 392, 'RED-301 · acometida', 'fv-tag fv-fuerte'), txt(1630, 412, '—', 'fv-tag fv-chip', { id: 't-RED-301-estado' }),
      ['path', { class: 'torre', d: 'M1630 420 l-14 40 M1630 420 l14 40 M1620 436 h20 M1616 448 h28 M1608 424 h44' }]));
    add(g('LOAD-302', ['rect', { class: 'forma carga', x: 1530, y: 60, width: 200, height: 80, rx: 8 }], txt(1630, 82, 'LOAD-302 · cargas protegidas', 'fv-tag fv-fuerte'), txt(1630, 106, '—', 'fv-valor fv-grande', { id: 't-LOAD-302-w' }), txt(1630, 128, '—', 'fv-tag', { id: 't-LOAD-302-modo' })));
    add(g('LOAD-301', ['rect', { class: 'forma carga', x: 1530, y: 660, width: 200, height: 80, rx: 8 }], txt(1630, 682, 'LOAD-301 · consumo del centro', 'fv-tag fv-fuerte'), txt(1630, 706, '—', 'fv-valor fv-grande', { id: 't-LOAD-301-w' }), txt(1630, 728, '—', 'fv-tag', { id: 't-LOAD-301-modo' })));

    // --- burbujas de medida (encima de los cables) ---
    add(burbuja('CCA', 685, 162, 86, 3), burbuja('BAT', 936, 346, 86, 3), burbuja('LOAD-302', 1130, 100, 86, 2), burbuja('REDA', 1100, 215, 86, 2), burbuja('ZCS', 1110, 600, 86, 3),
      burbuja('RED', 1471, 420, 112, 3), burbuja('LOAD-301', 1471, 700, 86, 2));

    // --- leyenda (dentro del dibujo, a la misma escala) ---
    const xl = 20, yl = 800, it = (i, claseLinea, t, ancho = 130) => [['path', { class: `cable ${claseLinea} activo`, d: `M${xl + i * ancho} ${yl} h26` }], txt(xl + i * ancho + 32, yl + 4, t, 'fv-tag fv-mini', izq)];
    add(['g', { id: 'leyenda-esquema', 'aria-hidden': 'true' }, txt(xl, yl - 14, 'LEYENDA', 'fv-zona', izq), ...it(0, 'solar', 'Solar (continua)'), ...it(1, 'bateria', 'Batería'), ...it(2, 'red', 'Red (alterna)'), ...it(3, 'carga', 'Consumo / ZCS'),
      ...[['ok', 'En servicio'], ['aviso', 'Aviso'], ['alarma', 'Alarma'], ['parado', 'Parado']].flatMap(([c, t], i) => [['rect', { class: `muestra e-${c}`, x: xl + i * 130, y: yl + 18, width: 22, height: 12, rx: 3 }], txt(xl + i * 130 + 30, yl + 28, t, 'fv-tag fv-mini', izq)])]);

    return ['svg', { viewBox: VIEWBOX, role: 'group', 'aria-label': 'Sinóptico de la instalación fotovoltaica de la cubierta. Cada equipo se puede accionar con Intro y su ficha se abre con la tecla de menú.' }, ...hijos];
  }
  const ESQUEMA_FV = construirEsquema();

  /** Todos los tags (data-tag) que aparecen en el esquema, para comprobar que no falta ningún equipo. */
  function tagsDelEsquema(esquema = ESQUEMA_FV) {
    const tags = new Set();
    (function recorrer(nodo) {
      if (!Array.isArray(nodo)) return;
      const a = nodo[1] && typeof nodo[1] === 'object' && !Array.isArray(nodo[1]) ? nodo[1] : null;
      if (a && a['data-tag']) tags.add(a['data-tag']);
      nodo.forEach(recorrer);
    })(esquema);
    return tags;
  }
  /** Ids de todos los elementos del esquema (para comprobar que los textos que se actualizan existen). */
  function idsDelEsquema(esquema = ESQUEMA_FV) {
    const ids = new Set();
    (function recorrer(nodo) {
      if (!Array.isArray(nodo)) return;
      const a = nodo[1] && typeof nodo[1] === 'object' && !Array.isArray(nodo[1]) ? nodo[1] : null;
      if (a && a.id) ids.add(a.id);
      nodo.forEach(recorrer);
    })(esquema);
    return ids;
  }

  /* ---------- objetos vivos (solo en el navegador) ---------- */
  function crearObjetos(canvas) {
    const objetos = [];
    const poner = (id, t) => { const el = canvas.buscar(id); if (el && el.textContent !== t) el.textContent = t; };
    const conmutar = (id, clase, on) => { const el = canvas.buscar(id); if (el) el.classList.toggle(clase, !!on); };

    // Flujos: cada cable gris lleva encima un trazo animado (puntos que se mueven) y flechas fijas que dicen el SENTIDO de la potencia (se dan la vuelta si el flujo se invierte)
    const NS = 'http://www.w3.org/2000/svg';
    const flujos = canvas.buscarTodos('path[data-flujo]').map(base => {
      const id = base.getAttribute('data-flujo'), kind = id in TRAMOS ? TRAMOS[id].kind : '';
      const sobre = document.createElementNS(NS, 'path');
      sobre.setAttribute('d', base.getAttribute('d')); sobre.setAttribute('class', `corriente ${kind}`);
      const flechas = document.createElementNS(NS, 'g'); flechas.setAttribute('class', `flechas ${kind}`);
      const largo = base.getTotalLength(), n = Math.max(1, Math.floor(largo / 90)), marcas = [];
      for (let k = 0; k < n; k++) {
        const s = largo * (k + 0.5) / n, a = base.getPointAtLength(Math.max(0, s - 1)), b = base.getPointAtLength(Math.min(largo, s + 1)), c = base.getPointAtLength(s);
        const tri = document.createElementNS(NS, 'path'); tri.setAttribute('d', 'M-7 -6 L7 0 L-7 6 z');
        tri.dataset.x = c.x.toFixed(1); tri.dataset.y = c.y.toFixed(1); tri.dataset.ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI).toFixed(1);
        flechas.appendChild(tri); marcas.push(tri);
      }
      base.after(sobre); sobre.after(flechas); return { id, base, sobre, flechas, marcas, sentido: 0 };
    });
    objetos.push({ actualizar(e) {
      const reparto = repartoFlujos(e);
      for (const f of flujos) {
        const r = reparto[f.id] || { p: 0, sentido: 1, activo: false };
        f.base.classList.toggle('activo', r.activo); f.sobre.classList.toggle('activo', r.activo); f.flechas.classList.toggle('activo', r.activo);
        f.sobre.classList.toggle('inversa', r.sentido < 0);
        if (!r.activo) { f.base.style.strokeWidth = ''; continue; }
        const g = grosorFlujo(r.p);
        f.sobre.style.strokeWidth = g.toFixed(1); f.base.style.strokeWidth = (g + 2).toFixed(1); f.sobre.style.animationDuration = `${cicloFlujo(r.p).toFixed(2)}s`;
        if (f.sentido !== r.sentido) { f.sentido = r.sentido; for (const t of f.marcas) t.setAttribute('transform', `translate(${t.dataset.x} ${t.dataset.y}) rotate(${Number(t.dataset.ang) + (r.sentido < 0 ? 180 : 0)})`); }
      }
    } });

    // Burbujas de medida
    objetos.push({ actualizar(e) { const L = lecturasBurbujas(e); for (const [id, lineas] of Object.entries(L)) lineas.forEach((t, k) => poner(`bt-${id}-${k}`, t)); } });
    // Textos de los equipos y LEDs
    objetos.push({ actualizar(e) {
      for (const [id, t] of Object.entries(textosEquipos(e))) poner(id, t);
      for (const [id, on] of Object.entries(ledsInversores(e))) conmutar(id, 'on', on);
      conmutar('led-INV-101-fallo', 'alarma', ledsInversores(e)['led-INV-101-fallo']); conmutar('led-INV-201-alarma', 'alarma', ledsInversores(e)['led-INV-201-alarma']);
      const soc = canvas.buscar('soc-BAT-101'); if (soc) { const f = Math.max(0, Math.min(1, numero(bateria(e).soc01))); soc.setAttribute('width', String((168 * f).toFixed(1))); }
    } });
    // Paneles: potencia, sombra y diodos de paso
    const paneles = layout.EQUIPOS.filter(q => q.tipo === 'panel').map(q => q.tag);
    objetos.push({ actualizar(e) {
      for (const tag of paneles) {
        const d = panelDe(e, tag); if (!d) continue;
        poner(`pw-${tag}`, formatoPotencia(d.panel.p));
        const sh = canvas.buscar(`sh-${tag}`); if (sh) { const o = String((0.62 * Math.min(1, numero(d.panel.sombra01))).toFixed(2)); if (sh.style.opacity !== o) sh.style.opacity = o; }
        for (let k = 0; k < 3; k++) conmutar(`by-${tag}-${k}`, 'on', (d.panel.bypass || [])[k]);
      }
    } });
    // Estado de cada equipo: color (clase e-*), forma (palanca abierta, fusible roto, testigo) y etiqueta accesible
    const grupos = canvas.buscarTodos('g[data-tag]').map(el => ({ el, tag: el.dataset.tag, visual: '', aria: '' }));
    objetos.push({ actualizar(e) {
      for (const o of grupos) {
        const v = estadoVisual(e, o.tag);
        if (v !== o.visual) { o.visual = v; for (const c of F.ESTADOS_VISUALES) o.el.classList.toggle(`e-${c}`, c === v); }
        const a = etiquetaAria(e, o.tag); if (a !== o.aria) { o.aria = a; o.el.setAttribute('aria-label', a); }
        const est = proteccion(e, o.tag).estado;
        if (PROTECCIONES.includes(o.tag)) o.el.classList.toggle('abierta', est !== undefined && est !== 'CERRADO');
        if (FUSIBLES.includes(o.tag)) o.el.classList.toggle('fundido', est === 'FUNDIDO');
        if (DESCARGADORES.includes(o.tag)) o.el.classList.toggle('agotado', est === 'AGOTADO');
      }
    } });
    return objetos;
  }

  const api = { ESQUEMA_FV, VIEWBOX, TRAMOS, TIPOS, PROTECCIONES, FUSIBLES, DESCARGADORES, construirEsquema, tagsDelEsquema, idsDelEsquema, estadoVisual, estadoEquipo, etiquetaAria,
    repartoFlujos, grosorFlujo, cicloFlujo, lecturasBurbujas, textosEquipos, ledsInversores, alarmaDeTag, cadenaDe, panelDe, crearObjetos };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') (window.PCT = window.PCT || {}).fvEsquema = api;
})();
