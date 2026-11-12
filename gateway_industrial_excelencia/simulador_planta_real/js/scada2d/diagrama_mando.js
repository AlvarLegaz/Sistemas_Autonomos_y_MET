// Diagrama de MANDO (circuito de control de 24 V CC) de la planta real HTST, en forma de escalera: PS-001 → F-201 → barra de +24 V; a la izquierda, las entradas
// digitales del PLC (seguridad, realimentación de equipos y campo) con su contacto y su dirección DI; el PLC-001 en el centro; a la derecha, las salidas
// (DO y AO) con lo que mueve cada una (bobinas de contactores, piloto de la FDV, electroválvulas, baliza y orden al variador), la barra de 0 V y el HMI-001.
// El relé de seguridad KS (ES-001) corta el común de las salidas; la baliza HL-001 no pasa por él. Direcciones tomadas de layout.js (SENALES).
// El estado en vivo sale de `calcularMando(estado)` (pura): cada elemento recibe un estado (data-e) y, si lleva texto, el texto; ver css/diagramas.css.
// Usa las piezas comunes que exporta diagrama_fuerza.js (cárgalo antes).
(function () {
  const F = typeof require !== 'undefined' ? require('./diagrama_fuerza.js') : PCT.htstDiagramaFuerza;
  const { layout, eq, nivelDI, salidaDO, salidaAO, num, dec, vivo, alimentacion, setaRearmada, contactosFisicos, txt, txv, cable, caja, dis, nodo, g, leyendaSvg, tagsDe, idsDe, crearObjetosDesde } = F.comun;

  const VIEWBOX = '0 0 1600 800';
  const Y0 = 232, PASO = 31, X_RIEL_24 = 60, X_RIEL_0 = 1540, Y_BARRA = 124;
  const yFila = i => Y0 + PASO * i;
  const canalDe = (tag, tipo) => (layout.senal(tag).find(s => s.tipo === tipo) || {}).canal || '';

  /** Entradas digitales en el orden en que se dibujan: [tag, descripción, normalmente cerrado (NC) / el 0 es anormal]. Tres bandas: seguridad, realimentación y proceso. */
  const BANDAS = [{ de: 0, a: 3, titulo: 'SEGURIDAD' }, { de: 4, a: 10, titulo: 'REALIMENTACIÓN' }, { de: 11, a: 16, titulo: 'PROCESO' }];
  const FILAS_DI = [
    ['ES-001', 'seta emergencia (NC)', true], ['TSH-101', 'termostato agua (NC)', true], ['PSL-201', 'aire presión OK', true], ['PB-001', 'pulsador marcha (NA)', false],
    ['QF-102', 'protección OK', true], ['PS-001', 'fuente 24 V OK', true], ['VFD-101', 'fallo variador', false], ['P-101', 'marcha variador', false],
    ['KM-102', 'aux. contactor', false], ['KM-201', 'aux. contactor', false], ['KM-202', 'aux. contactor', false],
    ['LSH-101', 'nivel alto TK-101', false], ['LSL-101', 'nivel bajo TK-101 (NC)', true], ['ZS-101', 'FDV en avance', false], ['ZS-102', 'FDV en desvío', false],
    ['LSL-301', 'nivel bajo agua (NC)', true], ['LSH-301', 'nivel alto agua', false],
  ];
  /** Salidas: clave (tag de la señal), tipo, fila, tag del equipo que mueve, texto, clase de carga ('bobina', 'lampara' o 'vfd'). */
  const FILAS_DO = [
    { clave: 'P-101', tipo: 'DO', fila: 0, tag: 'VFD-101', texto: 'DO · orden de marcha (RUN)', carga: 'vfd' },
    { clave: 'VFD-101', tipo: 'AO', fila: 1, tag: 'VFD-101', texto: 'AO · referencia 0-10 V', carga: 'vfd' },
    { clave: 'P-102', tipo: 'DO', fila: 3, tag: 'KM-102', texto: 'KM-102 · bobina de P-102', carga: 'bobina' },
    { clave: 'KM-201', tipo: 'DO', fila: 4, tag: 'KM-201', texto: 'KM-201 · bobina banco 1', carga: 'bobina' },
    { clave: 'KM-202', tipo: 'DO', fila: 5, tag: 'KM-202', texto: 'KM-202 · bobina banco 2', carga: 'bobina' },
    { clave: 'SV-101', tipo: 'DO', fila: 6, tag: 'SV-101', texto: 'SV-101 · piloto de la FDV', carga: 'bobina' },
    { clave: 'XV-301', tipo: 'DO', fila: 7, tag: 'XV-301', texto: 'XV-301 · agua fría', carga: 'bobina' },
    { clave: 'XV-401', tipo: 'DO', fila: 8, tag: 'XV-401', texto: 'XV-401 · CIP', carga: 'bobina' },
    { clave: 'XV-101', tipo: 'DO', fila: 9, tag: 'XV-101', texto: 'XV-101 · llenado TK-101', carga: 'bobina' },
    { clave: 'XV-102', tipo: 'DO', fila: 10, tag: 'XV-102', texto: 'XV-102 · vaciado TK-101', carga: 'bobina' },
    { clave: 'XV-302', tipo: 'DO', fila: 11, tag: 'XV-302', texto: 'XV-302 · llenado agua cal.', carga: 'bobina' },
    { clave: 'XV-303', tipo: 'DO', fila: 12, tag: 'XV-303', texto: 'XV-303 · vaciado agua cal.', carga: 'bobina' },
    { clave: 'HL-001', tipo: 'DO', fila: 13, tag: 'HL-001', texto: 'HL-001 · baliza de alarma', carga: 'lampara' },
  ];
  const NC_ANORMAL = new Set(FILAS_DI.filter(f => f[2]).map(f => f[0]));

  /* ---------- modelo en vivo ---------- */
  /** ¿Está cerrado el contacto de campo de esa entrada? (estado físico, antes de la alimentación: con el fusible fundido el contacto sigue como estaba). */
  function contactoCerrado(e, tag, fisicos) {
    if (tag === 'ES-001') return setaRearmada(e);
    if (fisicos && fisicos[tag] !== undefined) return fisicos[tag] === 1;
    return nivelDI(e, tag) === 1;
  }
  /** ¿Tiene tensión la carga de esa salida? Pasa por el relé de seguridad (menos la baliza) y necesita los 24 V. */
  function cargaEnergizada(e, fila, a, es) {
    const orden = fila.tipo === 'AO' ? salidaAO(e, fila.clave) > 0 : salidaDO(e, fila.clave);
    if (fila.clave === 'SV-101' && eq(e, 'SV-101').energizada !== undefined) return !!eq(e, 'SV-101').energizada && a.barra;
    return !!e && a.barra && orden && (fila.clave === 'HL-001' || es);
  }

  function calcularMando(e) {
    const hay = !!e, a = alimentacion(e), es = setaRearmada(e), fis = contactosFisicos(e), m = {};
    const V = c => ({ e: vivo(hay, c) });
    m['w-m-ps'] = V(a.fuente === 'ok' || a.fuente === 'degradada'); m['w-m-f'] = V(a.barra); m['m-bus'] = V(a.barra); m['m-rail'] = V(a.barra); m['w-ks-in'] = V(a.barra);
    m['m-ps'] = { e: a.fuente }; m['m-ps-t'] = { e: a.fuente, t: hay ? `${dec(a.v)} V · ${{ ok: 'OK', degradada: 'BAJA', sin: 'SIN SALIDA', sd: '—' }[a.fuente]}` : '—' };
    m['m-f201'] = { e: hay ? (a.fundido ? 'fundido' : 'ok') : 'sd' }; m['m-f201-t'] = { e: m['m-f201'].e, t: hay ? (a.fundido ? 'FUNDIDO' : 'OK') : '—' };
    m['m-bus-t'] = { e: vivo(hay, a.barra), t: !hay ? 'BARRA +24 V · SIN DATOS' : a.barra ? (a.fuente === 'degradada' ? `BARRA +24 V · BAJA (${dec(a.v)} V)` : 'BARRA +24 V · CON TENSIÓN') : 'BARRA +24 V · SIN TENSIÓN' };
    // relé de seguridad KS: cierra con la seta rearmada y 24 V
    const ks = es && a.barra;
    m['m-ks'] = { e: hay ? (ks ? 'cerrado' : 'disparado') : 'sd' }; m['w-ks-out'] = V(ks);
    m['m-ks-t'] = { e: m['m-ks'].e, t: hay ? (ks ? 'KS · SALIDAS HABILITADAS' : 'KS · SALIDAS CORTADAS') : 'KS · —' };

    // entradas
    for (const [tag] of FILAS_DI) {
      const c = contactoCerrado(e, tag, fis), lee = nivelDI(e, tag);
      m[`m-c-${tag}`] = { e: !hay ? 'sd' : c ? (tag === 'VFD-101' ? 'fallo' : 'cerrado') : (NC_ANORMAL.has(tag) ? 'disparado' : 'abierto') };
      m[`w-a-${tag}`] = V(a.barra); m[`w-b-${tag}`] = V(a.barra && c);
      const ev = lee === undefined ? 'sd' : lee === 1 ? 'uno' : 'cero';
      m[`m-v-${tag}`] = { e: ev }; m[`m-vt-${tag}`] = { e: ev, t: lee === undefined ? '—' : String(lee) };
    }
    // salidas y sus cargas
    for (const f of FILAS_DO) {
      const k = f.clave, en = cargaEnergizada(e, f, a, es), orden = f.tipo === 'AO' ? salidaAO(e, k) > 0 : salidaDO(e, k);
      m[`w-o-${k}`] = V(en);
      const ev = !hay ? 'sd' : orden ? 'uno' : 'cero';
      m[`m-ov-${k}`] = { e: ev }; m[`m-ovt-${k}`] = { e: ev, t: !hay ? '—' : f.tipo === 'AO' ? `${Math.round(salidaAO(e, k))} %` : orden ? '1' : '0' };
      if (f.carga === 'vfd') continue;
      const lampara = f.carga === 'lampara';
      m[`m-l-${k}`] = { e: !hay ? 'sd' : en ? (lampara ? 'encendida' : 'energizada') : 'apagada' };
      m[`m-lt-${k}`] = { e: m[`m-l-${k}`].e, t: !hay ? '—' : en ? (lampara ? 'ENCENDIDA' : 'ENERGIZADA') : (lampara ? 'APAGADA' : 'SIN TENSIÓN') };
    }
    // variador (cargas de las dos primeras filas)
    const p101 = eq(e, 'P-101'), fallo = !!(eq(e, 'VFD-101').fallo || p101.fallo), marcha = !!p101.marcha && !fallo;
    m['m-vfd'] = { e: !hay ? 'sd' : fallo ? 'fallo' : marcha ? 'marcha' : 'parado' }; m['m-vfd-t'] = { e: m['m-vfd'].e, t: !hay ? '—' : fallo ? '✕ FALLO' : marcha ? 'EN MARCHA' : 'PARADO' };
    // PLC y HMI
    const plc = (e && e.plc) || {}, info = layout.MODOS_INFO[e && e.modo], paro = !!plc.paro;
    m['m-plc-t'] = { e: !hay ? 'sd' : paro ? 'fallo' : 'on', t: `PLC-001 · ${!hay ? '—' : paro ? 'PARO' : (info ? info.nombre : (e.modo || '—'))}` };
    const motivos = (plc.motivosParo || []).join(', ');
    m['m-plc-sub'] = { e: !hay ? 'sd' : paro ? 'fallo' : 'on', t: !hay ? '' : paro ? `paro: ${motivos || 'pulsa rearme'}`.slice(0, 29) : 'sin paro' };
    const alarmas = e && Array.isArray(e.alarmas) ? e.alarmas.filter(x => x.nivel !== 'estado').length : 0;
    m['m-hmi'] = { e: !hay ? 'sd' : alarmas ? 'alarma' : 'normal' }; m['m-hmi-t'] = { e: m['m-hmi'].e, t: !hay ? '—' : alarmas ? `${alarmas} ALARMA${alarmas > 1 ? 'S' : ''} ACTIVA${alarmas > 1 ? 'S' : ''}` : 'SIN ALARMAS' };
    return m;
  }

  /** Etiqueta accesible de cada equipo dibujado en Mando (un equipo puede salir como entrada y como salida). */
  function ariaMando(e) {
    const m = calcularMando(e), partes = {}, anota = (tag, t) => { (partes[tag] = partes[tag] || []).push(t); };
    anota('PS-001', `fuente de 24 V, ${m['m-ps-t'].t}`); anota('F-201', `fusible ${m['m-f201-t'].t.toLowerCase()}`);
    for (const [tag, desc] of FILAS_DI) anota(tag, `${desc}, entrada ${canalDe(tag, 'DI')} = ${m[`m-vt-${tag}`].t}`);
    for (const f of FILAS_DO) if (f.carga !== 'vfd') anota(f.tag, `${f.texto.split(' · ')[1] || f.texto}, ${canalDe(f.clave, f.tipo)} = ${m[`m-ovt-${f.clave}`].t}, ${m[`m-lt-${f.clave}`].t.toLowerCase()}`);
    anota('VFD-101', `orden de marcha y referencia, ${m['m-vfd-t'].t.toLowerCase()}`);
    anota('ES-001', m['m-ks-t'].t.toLowerCase()); anota('PLC-001', m['m-plc-t'].t); anota('HMI-001', m['m-hmi-t'].t.toLowerCase());
    const r = {};
    for (const [tag, p] of Object.entries(partes)) r[tag] = `${tag}, ${p.join('; ')}`;
    return r;
  }

  /* ---------- dibujo ---------- */
  const borne = (x, y) => ['circle', { class: 'dg-borne', cx: x, cy: y, r: 5 }];
  const filaDI = (tag, desc, i) => {
    const y = yFila(i);
    return { equipo: g(tag, cable(`w-a-${tag}`, `M${X_RIEL_24} ${y} H92`),
      dis(`m-c-${tag}`, caja(84, y - 12, 48, 24), ['circle', { class: 'dg-borne', cx: 92, cy: y, r: 3 }], ['circle', { class: 'dg-borne', cx: 124, cy: y, r: 3 }],
        ['path', { class: 'dg-cuchilla dg-on-only', d: `M92 ${y} H124` }], ['path', { class: 'dg-cuchilla dg-off-only', d: `M92 ${y} L121 ${y - 12}` }]),
      cable(`w-b-${tag}`, `M124 ${y} H520`), txt(150, y - 7, `${tag} · ${desc}`, 'dg-t', 'start')),
    plc: [borne(520, y), txt(534, y + 5, canalDe(tag, 'DI'), 'dg-t', 'start'),
      ['rect', { id: `m-v-${tag}`, class: 'dg-valor dg-sim', 'data-e': 'sd', x: 606, y: y - 10, width: 44, height: 20, rx: 3 }], txv(`m-vt-${tag}`, 628, y + 5, '—', 'dg-f')] };
  };
  function construirMando() {
    const hijos = [], plc = [];
    for (const b of BANDAS) {
      const ya = yFila(b.de) - 17;
      hijos.push(['rect', { class: 'dg-banda', x: 36, y: ya, width: 476, height: PASO * (b.a - b.de) + 30, rx: 4 }], txt(508, yFila(b.de) - 7, b.titulo, 'dg-z', 'end'));
    }
    hijos.unshift(txt(24, 40, 'MANDO · circuito de control 24 V CC', 'dg-g', 'start'), leyendaSvg(640, 34, 780, 62));
    // alimentación: PS-001 → F-201 → barra de +24 V
    hijos.push(
      g('PS-001', dis('m-ps', caja(100, 54, 160, 54)), txt(180, 76, 'PS-001 · FUENTE', 'dg-f'), txv('m-ps-t', 180, 98, '—', 'dg-v'), cable('w-m-ps', 'M260 80 H300')),
      g('F-201', dis('m-f201', caja(300, 70, 40, 20), ['path', { class: 'dg-hilo dg-on-only', d: 'M304 80 H336' }], ['path', { class: 'dg-hilo dg-off-only', d: 'M304 80 H314 M326 80 H336 M313 74 L323 86 M323 74 L313 86' }]),
        txt(320, 58, 'F-201', 'dg-f'), txv('m-f201-t', 320, 112, '—'), cable('w-m-f', `M340 80 H380 V${Y_BARRA}`)),
      cable('m-bus', `M${X_RIEL_24} ${Y_BARRA} H1560`), cable('m-rail', `M${X_RIEL_24} ${Y_BARRA} V${yFila(16)}`), nodo(380, Y_BARRA), txv('m-bus-t', 1560, 114, '—', 'dg-f', 'end'),
      txt(72, 148, '+24 V', 'dg-f', 'start'));
    // entradas
    FILAS_DI.forEach(([tag, desc], i) => { const f = filaDI(tag, desc, i); hijos.push(f.equipo, ['circle', { class: 'dg-nodo', cx: X_RIEL_24, cy: yFila(i), r: 3 }]); plc.push(...f.plc); });
    // relé de seguridad KS (parte de ES-001): corta el común de las salidas
    hijos.push(g('ES-001', cable('w-ks-in', `M960 ${Y_BARRA} V136`), dis('m-ks', caja(944, 130, 32, 36), ['circle', { class: 'dg-borne', cx: 960, cy: 140, r: 3 }], ['circle', { class: 'dg-borne', cx: 960, cy: 160, r: 3 }],
      ['path', { class: 'dg-cuchilla dg-on-only', d: 'M960 140 V160' }], ['path', { class: 'dg-cuchilla dg-off-only', d: 'M960 140 L974 156' }]),
      cable('w-ks-out', 'M960 160 V172'), txv('m-ks-t', 990, 154, '—', 'dg-f', 'start')));
    // salidas
    hijos.push(['path', { class: 'dg-cable dg-fijo', d: `M${X_RIEL_0} 224 V${yFila(13) + 14}` }], txt(X_RIEL_0, 214, '0 V', 'dg-f'));
    const dentroVfd = [];
    for (const f of FILAS_DO) {
      const y = yFila(f.fila), k = f.clave;
      plc.push(borne(1020, y), txt(1006, y + 5, canalDe(k, f.tipo), 'dg-t', 'end'), ['rect', { id: `m-ov-${k}`, class: 'dg-valor dg-sim', 'data-e': 'sd', x: 902, y: y - 10, width: 44, height: 20, rx: 3 }], txv(`m-ovt-${k}`, 924, y + 5, '—', 'dg-f'));
      if (f.carga === 'vfd') { dentroVfd.push(cable(`w-o-${k}`, `M1020 ${y} H1330`), txt(1050, y - 7, f.texto, 'dg-t', 'start')); continue; }
      const simbolo = f.carga === 'lampara' ? ['circle', { class: 'dg-caja dg-sim', cx: 1312, cy: y, r: 12 }] : caja(1290, y - 11, 44, 22);
      const x = f.carga === 'lampara' ? ['path', { class: 'dg-hilo', d: `M${1312 - 8} ${y - 8} l16 16 M${1312 + 8} ${y - 8} l-16 16` }] : null;
      hijos.push(g(f.tag, cable(`w-o-${k}`, `M1020 ${y} H1290`), dis(`m-l-${k}`, simbolo, ...(x ? [x] : [])), ['path', { class: 'dg-cable dg-fijo', d: `M1334 ${y} H${X_RIEL_0}` }],
        txt(1050, y - 7, f.texto, 'dg-t', 'start'), txv(`m-lt-${k}`, 1350, y - 7, '—', 'dg-f', 'start')));
    }
    // variador: dos entradas (RUN y referencia) y su indicación
    hijos.push(g('VFD-101', ...dentroVfd, dis('m-vfd', caja(1330, 210, 170, 74)), txt(1342, 237, 'RUN', 'dg-t', 'start'), txt(1342, 268, 'REF', 'dg-t', 'start'),
      txt(1446, 236, 'VFD-101', 'dg-f'), txv('m-vfd-t', 1446, 262), ['path', { class: 'dg-cable dg-fijo', d: `M1500 247 H${X_RIEL_0}` }]));
    // PLC-001
    hijos.push(g('PLC-001', ['rect', { class: 'dg-caja dg-plc', x: 520, y: 172, width: 500, height: 584, rx: 8 }], txv('m-plc-t', 770, 196, '—', 'dg-v'), txv('m-plc-sub', 770, 216, '', 'dg-t'), ...plc));
    // HMI-001
    hijos.push(g('HMI-001', ['path', { class: 'dg-cable dg-fijo dg-enlace', d: 'M1020 705 H1100' }], txt(1060, 694, 'Ethernet', 'dg-t'), dis('m-hmi', caja(1100, 668, 230, 74)), txt(1215, 692, 'HMI-001', 'dg-f'), txv('m-hmi-t', 1215, 716, '—')));
    hijos.push(txt(1346, 674, 'HL-001 no pasa por el relé', 'dg-t', 'start'), txt(1346, 694, 'KS: sigue avisando con la', 'dg-t', 'start'), txt(1346, 714, 'seta pulsada.', 'dg-t', 'start'));
    return ['svg', { viewBox: VIEWBOX, class: 'dg-svg', role: 'group', 'aria-label': 'Diagrama de mando de la planta HTST: fuente y fusible de 24 V, entradas y salidas del PLC y lo que mueve cada salida. Cada equipo se puede abrir con Intro.' }, ...hijos];
  }

  const ESQUEMA = construirMando();
  const tagsDelEsquema = (esquema = ESQUEMA) => tagsDe(esquema);
  const crearObjetos = canvas => crearObjetosDesde(canvas, calcularMando, ariaMando);

  const api = { VIEWBOX, ESQUEMA, construirMando, tagsDelEsquema, crearObjetos, calcularMando, ariaMando, FILAS_DI, FILAS_DO, BANDAS, idsDe };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstDiagramaMando = api; }
})();
