// Esquema de CABLEADO de la instalación fotovoltaica: bornas y conductores de la caja «HT 8WAY» (CB-101), la caja auxiliar de continua del campo B, los dos inversores
// (PV+, PV−, BAT+, BAT−, AC IN/OUT, comunicaciones), la batería y el cuadro de alterna, con sección, color, longitud supuesta y caída de tensión orientativa de cada cable.
// IMPORTANTE: las secciones y las longitudes son SUPUESTOS razonables a partir de las fotos (nadie midió los cables): están todas aquí, juntas (`CABLES`), para que el profesor
// las corrija con los datos reales. La caída de tensión se calcula con ΔV = 2·ρ·L·I / S (ida y vuelta, cobre a unos 70 °C: ρ = 0,0225 Ω·mm²/m) con la corriente EN VIVO del simulador.
// Una línea gruesa = más sección. Los conductores van con su color real: rojo (+) y negro (−) en continua; marrón (fase), azul (neutro) y amarillo-verde (tierra) en alterna.
(function () {
  const esNode = typeof require !== 'undefined';
  const U = esNode ? require('./diagrama_unifilar.js') : PCT.fvDiagramaUnifilar;
  const { comun } = U, { layout, num, dec, txt, txv, g, tagsDe, idsDe } = comun;

  /** Resistividad del cobre a ~70 °C (Ω·mm²/m) y corrientes admisibles orientativas (A) de un cable multiconductor en bandeja o tubo a 40 °C ambiente. SUPUESTOS. */
  const RHO_CU = 0.0225;
  const I_ADMISIBLE = { 1.5: 15, 2.5: 21, 4: 28, 6: 36, 10: 50, 16: 68, 25: 89, 35: 110 };
  const COLOR_HILO = { '+': 'rojo', '−': 'negro', L: 'marrón', N: 'azul', PE: 'amarillo-verde' };

  const PA = layout.PANEL_A, PB = layout.PANEL_B, INV1 = layout.INVERSORES['INV-101'], BAT = layout.BATERIA;
  const iAC = layout.INVERSORES['INV-101'].potenciaAcW / layout.RED.tensionV;     // ≈ 13 A

  /** Cables (un cable = pareja o trío de conductores que van juntos). `medida(e)` es la corriente en vivo; `iDisenoA` la de diseño para dimensionar la sección (1,25·Isc) e `iNominalA` la de trabajo (Imp) para la caída. */
  const CABLES = [
    { id: 'C-A1', tag: 'STR-101', nombre: 'Cadena STR-101 → caja CB-101', tipo: 'cc', seccionMm2: 4, longitudM: 15, vRefV: 3 * PA.vmp, iDisenoA: 1.25 * PA.isc, iNominalA: PA.imp, limitePct: 2, vivo: 'c-s101-w', medida: e => num((comun.cadenaDe(e, 'STR-101') || {}).i, 0), nota: 'cable solar de doble aislamiento 4 mm² de la cubierta a la caseta (supuesto: 15 m por la bandeja)' },
    { id: 'C-A2', tag: 'STR-102', nombre: 'Cadena STR-102 → caja CB-101', tipo: 'cc', seccionMm2: 4, longitudM: 15, vRefV: 3 * PA.vmp, iDisenoA: 1.25 * PA.isc, iNominalA: PA.imp, limitePct: 2, vivo: 'c-s102-w', medida: e => num((comun.cadenaDe(e, 'STR-102') || {}).i, 0), nota: 'igual que C-A1' },
    { id: 'C-A3', tag: 'CB-101', nombre: 'Caja CB-101 → EASun (PV+ / PV−)', tipo: 'cc', seccionMm2: 6, longitudM: 3, vRefV: 3 * PA.vmp, iDisenoA: 2 * 1.25 * PA.isc, iNominalA: 2 * PA.imp, limitePct: 1, vivo: 'c-a-pq', medida: e => num(comun.inversor(e, 'INV-101').pvI, 0), nota: 'las dos cadenas en paralelo: el doble de corriente (supuesto: 3 m)' },
    { id: 'C-A4', tag: 'INV-101', nombre: 'EASun (BAT+ / BAT−) → magnetotérmico QB-101', tipo: 'cc', seccionMm2: 35, longitudM: 0.8, vRefV: BAT.celdas * 3.2, iDisenoA: INV1.descargaMaxA, limitePct: 1.5, vivo: 'c-a-bp1', medida: e => Math.abs(num((e && e.bateria || {}).i, 0)), nota: 'a 24 V la corriente es alta: cable muy grueso y corto (supuesto: 35 mm², 0,8 m)' },
    { id: 'C-A5', tag: 'BAT-101', nombre: 'QB-101 → portafusible FB-101 → bornas de la batería', tipo: 'cc', seccionMm2: 35, longitudM: 1.2, vRefV: BAT.celdas * 3.2, iDisenoA: INV1.descargaMaxA, limitePct: 1.5, vivo: 'c-a-bp3', medida: e => Math.abs(num((e && e.bateria || {}).i, 0)), nota: 'terminales de ojal bien apretados: un borne flojo calienta' },
    { id: 'C-A6', tag: 'QF-302', nombre: 'Cuadro QA-301 (QF-302) → EASun AC IN', tipo: 'ca', seccionMm2: 2.5, longitudM: 5, vRefV: layout.RED.tensionV, iDisenoA: iAC, limitePct: 3, vivo: 'a-i1in', medida: e => Math.abs(num(comun.inversor(e, 'INV-101').redP, 0)) / 230, nota: 'entrada de red del EASun (supuesto: 5 m)' },
    { id: 'C-A7', tag: 'LOAD-302', nombre: 'EASun AC OUT → cuadro QA-301 (cargas protegidas y toma)', tipo: 'ca', seccionMm2: 2.5, longitudM: 8, vRefV: layout.RED.tensionV, iDisenoA: iAC, limitePct: 3, vivo: 'a-i1o1', medida: e => Math.abs(num(comun.inversor(e, 'INV-101').cargaP, 0)) / 230, nota: 'salida de cargas del EASun (supuesto: 8 m)' },
    { id: 'C-B1', tag: 'STR-201', nombre: 'Cadena STR-201 → caja auxiliar del campo B', tipo: 'cc', seccionMm2: 6, longitudM: 20, vRefV: 4 * PB.vmp, iDisenoA: 1.25 * PB.isc, iNominalA: PB.imp, limitePct: 2, vivo: 'c-s201-w', medida: e => num((comun.cadenaDe(e, 'STR-201') || {}).i, 0), nota: 'supuesto: 6 mm² y 20 m (las cadenas de 400 Wp llevan 13 A)' },
    { id: 'C-B2', tag: 'STR-202', nombre: 'Cadena STR-202 → caja auxiliar del campo B', tipo: 'cc', seccionMm2: 6, longitudM: 20, vRefV: 4 * PB.vmp, iDisenoA: 1.25 * PB.isc, iNominalA: PB.imp, limitePct: 2, vivo: 'c-s202-w', medida: e => num((comun.cadenaDe(e, 'STR-202') || {}).i, 0), nota: 'igual que C-B1' },
    { id: 'C-B3', tag: 'QS-201', nombre: 'Caja auxiliar → ZCS entrada MPPT1 (PV1+ / PV1−)', tipo: 'cc', seccionMm2: 4, longitudM: 4, vRefV: 4 * PB.vmp, iDisenoA: 1.25 * PB.isc, iNominalA: PB.imp, limitePct: 1, vivo: 'c-b-p1b', medida: e => num((comun.cadenaDe(e, 'STR-201') || {}).i, 0), nota: 'conectores MC4 en el inversor' },
    { id: 'C-B4', tag: 'SPD-201', nombre: 'Caja auxiliar → ZCS entrada MPPT2 (PV2+ / PV2−)', tipo: 'cc', seccionMm2: 4, longitudM: 4, vRefV: 4 * PB.vmp, iDisenoA: 1.25 * PB.isc, iNominalA: PB.imp, limitePct: 1, vivo: 'c-b-p2b', medida: e => num((comun.cadenaDe(e, 'STR-202') || {}).i, 0), nota: 'igual que C-B3' },
    { id: 'C-B5', tag: 'QF-303', nombre: 'ZCS AC → cuadro QA-301 (QF-303)', tipo: 'ca', seccionMm2: 4, longitudM: 10, vRefV: layout.RED.tensionV, iDisenoA: iAC, limitePct: 3, vivo: 'a-i2in', medida: e => Math.abs(num(comun.inversor(e, 'INV-201').acP, 0)) / 230, nota: 'línea de vertido (supuesto: 4 mm², 10 m)' },
    { id: 'C-C1', tag: 'RED-301', nombre: 'Acometida RED-301 → cuadro QA-301 (QF-301)', tipo: 'ca', seccionMm2: 6, longitudM: 15, vRefV: layout.RED.tensionV, iDisenoA: 25, limitePct: 3, vivo: 'a-w1', medida: e => Math.abs(num((e && e.red || {}).p, 0)) / 230, nota: 'general de 25 A (supuesto)' },
  ];
  // El cable de tierra de la caja HT 8WAY (amarillo-verde) va aparte: no lleva corriente en servicio, solo importa que exista y esté apretado.
  const CABLE_TIERRA = { id: 'C-A9', tag: 'CB-101', nombre: 'Borna PE de CB-101 → tierra de la caseta', tipo: 'pe', seccionMm2: 6, longitudM: 8, nota: 'conductor de protección amarillo-verde (supuesto: 6 mm², 8 m)' };

  const seccionTxt = s => String(s).replace('.', ',');
  const longitudTxt = l => String(l).replace('.', ',');
  /** Caída de tensión de un cable (V y %) con una corriente dada: ΔV = 2·ρ·L·I / S. */
  function caida(c, iA) {
    const dv = c.tipo === 'pe' ? 0 : 2 * RHO_CU * c.longitudM * Math.abs(iA) / c.seccionMm2;
    return { dv, pct: c.vRefV ? dv / c.vRefV * 100 : 0 };
  }
  const hilosDe = c => (c.tipo === 'cc' ? ['+', '−'] : c.tipo === 'ca' ? ['L', 'N', 'PE'] : ['PE']);
  const grosor = s => Math.round((1.6 + 1.8 * Math.sqrt(s)) * 10) / 10;

  /** Filas de la tabla de conductores (la página la dibuja bajo el esquema) con la corriente en vivo. */
  function filasTabla(e) {
    return CABLES.concat([CABLE_TIERRA]).map(c => {
      const i = c.medida ? c.medida(e) : 0, k = caida(c, i), kd = caida(c, c.iNominalA || c.iDisenoA || 0);
      return { id: c.id, nombre: c.nombre, hilos: hilosDe(c).map(h => `${h} ${COLOR_HILO[h]}`).join(' · '), seccionMm2: c.seccionMm2, longitudM: c.longitudM, corrienteA: i, dvV: k.dv, pct: k.pct,
        iDisenoA: c.iDisenoA || 0, iNominalA: c.iNominalA || c.iDisenoA || 0, pctDiseno: kd.pct, limitePct: c.limitePct || 0, admisibleA: I_ADMISIBLE[c.seccionMm2], nota: c.nota, alto: !!c.limitePct && kd.pct > c.limitePct };
    });
  }

  /* ---------- dibujo ---------- */
  const VIEWBOX = '0 0 1600 920';
  const BORNAS = {};      // 'DISPOSITIVO.borna' → [x, y]
  const dibujo = { cajas: [], altos: [], bornas: [], rotulos: [] };

  function dispositivo(id, tag, x, y, w, h, bornas, hijos = [], clase = '', alto = false) {
    for (const [nombre, bx, by] of bornas) { BORNAS[`${id}.${nombre}`] = [bx, by]; dibujo.bornas.push(['rect', { class: 'dg-bor', x: bx - 9, y: by - 9, width: 18, height: 18, rx: 2 }]); }
    const caja = ['rect', { class: `dg-caja dg-sim ${clase}`.trim(), x, y, width: w, height: h, rx: 6 }];
    (alto ? dibujo.altos : dibujo.cajas).push(tag ? g(tag, dis(id, caja), ...hijos) : ['g', {}, caja, ...hijos]);
  }
  const dis = (id, ...hijos) => ['g', { id: `k-${id}`, class: 'dg-dis', 'data-e': 'sd' }, ...hijos];

  // posiciones de los hilos de cada cable (todos rectos: los dos extremos están alineados)
  function trazado(c, rutas) {
    const hs = hilosDe(c);
    c.hilos = hs.map((polo, i) => ({ polo, color: COLOR_HILO[polo], ruta: rutas[i] }));
  }
  const punto = p => (typeof p === 'string' ? BORNAS[p] : p);
  const rutaD = ruta => ruta.map(punto).map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');

  function construirDispositivos() {
    const T = (x, y, t, clase = 'dg-t', ancla = 'middle') => txt(x, y, t, clase, ancla);
    // campo A (cubierta) y su caja HT 8WAY
    dispositivo('CAMPO-A', null, 30, 96, 120, 204, [['S1+', 150, 130], ['S1−', 150, 158], ['S2+', 150, 230], ['S2−', 150, 258]], [T(90, 116, 'CAMPO A', 'dg-f'), T(90, 134, 'cubierta', 'dg-t'), T(90, 200, '6 paneles', 'dg-t'), T(90, 220, '2 cadenas de 3', 'dg-t')], 'dg-campo');
    dispositivo('CB-101', 'CB-101', 340, 96, 220, 204, [['1+', 340, 130], ['1−', 340, 158], ['2+', 340, 230], ['2−', 340, 258], ['O+', 560, 170], ['O−', 560, 198], ['PE', 450, 300]],
      [T(450, 116, 'CB-101 · HT 8WAY', 'dg-f'), T(358, 134, '1+', 'dg-t', 'start'), T(358, 162, '1−', 'dg-t', 'start'), T(358, 234, '2+', 'dg-t', 'start'), T(358, 262, '2−', 'dg-t', 'start'),
        T(450, 134, 'F-101', 'dg-t'), T(450, 234, 'F-102', 'dg-t'), T(450, 196, 'QS-101 · SPD-101', 'dg-t'), T(542, 174, 'O+', 'dg-t', 'end'), T(542, 202, 'O−', 'dg-t', 'end'), T(450, 282, 'PE', 'dg-t')]);
    dispositivo('TIERRA', null, 380, 340, 140, 32, [['1', 450, 340]], [T(450, 361, 'TIERRA', 'dg-t')], 'dg-campo');
    // inversor EASun
    dispositivo('INV-101', 'INV-101', 780, 96, 320, 254, [['PV+', 780, 170], ['PV−', 780, 198], ['BAT+', 810, 350], ['BAT−', 850, 350], ['ACIN-L', 1100, 150], ['ACIN-N', 1100, 174], ['ACIN-PE', 1100, 198], ['ACOUT-L', 1100, 290], ['ACOUT-N', 1100, 314], ['ACOUT-PE', 1100, 338]],
      [T(940, 124, 'INV-101 · EASun', 'dg-f'), T(940, 146, 'híbrido 24 V', 'dg-t'), T(796, 174, 'PV+', 'dg-t', 'start'), T(796, 202, 'PV−', 'dg-t', 'start'), T(810, 338, 'BAT+', 'dg-t'), T(852, 338, 'BAT−', 'dg-t'),
        T(1086, 154, 'L', 'dg-t', 'end'), T(1086, 178, 'N', 'dg-t', 'end'), T(1086, 202, 'PE', 'dg-t', 'end'), T(1086, 294, 'L', 'dg-t', 'end'), T(1086, 318, 'N', 'dg-t', 'end'), T(1086, 342, 'PE', 'dg-t', 'end'),
        T(1086, 130, 'AC IN', 'dg-t', 'end'), T(1086, 270, 'AC OUT', 'dg-t', 'end'), txv('k-i1-t', 940, 250, '—', 'dg-f'), txv('k-i1-pv', 940, 272)]);
    dispositivo('COM-101', 'COM-101', 1000, 40, 150, 34, [], [T(1075, 62, 'COM-101 · RS485', 'dg-t')]);
    dibujo.rotulos.push(['path', { class: 'dg-cable dg-enlace', d: 'M1075 74 V96' }], txt(1065, 90, 'Wi-Fi / RS485', 'dg-t', 'end'));
    // protecciones y batería
    dispositivo('QB-101', 'QB-101', 780, 392, 100, 36, [['1+', 810, 392], ['1−', 850, 392], ['2+', 810, 428], ['2−', 850, 428]], [T(895, 414, 'QB-101 · 2P', 'dg-f', 'start')], '');
    dispositivo('FB-101', 'FB-101', 796, 446, 28, 34, [], [], '', true);
    dibujo.rotulos.push(txt(836, 468, 'FB-101', 'dg-f', 'start'));
    dispositivo('BAT-101', 'BAT-101', 700, 520, 220, 100, [['+', 810, 520], ['−', 850, 520]], [T(810, 552, 'BAT-101', 'dg-f'), txv('k-bat-t', 810, 576), txv('k-bat-i', 810, 598)]);
    // campo B, caja auxiliar e inversor ZCS
    dispositivo('CAMPO-B', null, 30, 660, 120, 220, [['S1+', 150, 700], ['S1−', 150, 728], ['S2+', 150, 800], ['S2−', 150, 828]], [T(90, 686, 'CAMPO B', 'dg-f'), T(90, 704, 'cubierta', 'dg-t'), T(90, 770, '8 paneles', 'dg-t'), T(90, 790, '2 cadenas de 4', 'dg-t')], 'dg-campo');
    dispositivo('CAJA-B', null, 340, 660, 220, 220, [['1+', 340, 700], ['1−', 340, 728], ['2+', 340, 800], ['2−', 340, 828], ['O1+', 560, 700], ['O1−', 560, 728], ['O2+', 560, 800], ['O2−', 560, 828]],
      [T(450, 682, 'CAJA AUXILIAR CC', 'dg-f'), T(358, 704, '1+', 'dg-t', 'start'), T(358, 732, '1−', 'dg-t', 'start'), T(358, 804, '2+', 'dg-t', 'start'), T(358, 832, '2−', 'dg-t', 'start'),
        T(542, 704, '1+', 'dg-t', 'end'), T(542, 732, '1−', 'dg-t', 'end'), T(542, 804, '2+', 'dg-t', 'end'), T(542, 832, '2−', 'dg-t', 'end'), T(450, 870, 'sin tag propio', 'dg-t')], 'dg-campo');
    dispositivo('QS-201', 'QS-201', 382, 756, 76, 32, [], [T(420, 777, 'QS-201', 'dg-t')]);
    dispositivo('SPD-201', 'SPD-201', 462, 756, 80, 32, [], [T(502, 777, 'SPD-201', 'dg-t')]);
    dispositivo('INV-201', 'INV-201', 780, 660, 320, 220, [['PV1+', 780, 700], ['PV1−', 780, 728], ['PV2+', 780, 800], ['PV2−', 780, 828], ['L', 1100, 700], ['N', 1100, 724], ['PE', 1100, 748]],
      [T(940, 684, 'INV-201 · ZCS', 'dg-f'), T(796, 704, 'PV1+', 'dg-t', 'start'), T(796, 732, 'PV1−', 'dg-t', 'start'), T(796, 804, 'PV2+', 'dg-t', 'start'), T(796, 832, 'PV2−', 'dg-t', 'start'),
        T(1086, 704, 'L', 'dg-t', 'end'), T(1086, 728, 'N', 'dg-t', 'end'), T(1086, 752, 'PE', 'dg-t', 'end'), T(1086, 684, 'AC', 'dg-t', 'end'), txv('k-i2-t', 940, 800, '—', 'dg-f'), txv('k-i2-ca', 940, 824)]);
    // cuadro de alterna y acometida
    dispositivo('RED-301', 'RED-301', 1330, 24, 110, 40, [['L', 1360, 64], ['N', 1385, 64], ['PE', 1410, 64]], [T(1385, 49, 'RED-301', 'dg-f')]);
    dispositivo('QA-301', 'QA-301', 1300, 110, 260, 790, [['RED-L', 1360, 110], ['RED-N', 1385, 110], ['RED-PE', 1410, 110], ['IN-L', 1300, 150], ['IN-N', 1300, 174], ['IN-PE', 1300, 198], ['OUT-L', 1300, 290], ['OUT-N', 1300, 314], ['OUT-PE', 1300, 338],
      ['B-L', 1300, 700], ['B-N', 1300, 724], ['B-PE', 1300, 748]],
      [T(1318, 128, 'QF-302 · entrada', 'dg-f', 'start'), T(1318, 270, 'QF-302 · salida', 'dg-f', 'start'), T(1318, 680, 'QF-303 · ZCS', 'dg-f', 'start'),
        ...[['L', 154], ['N', 178], ['PE', 202], ['L', 294], ['N', 318], ['PE', 342], ['L', 704], ['N', 728], ['PE', 752]].map(([t, y]) => T(1318, y, t, 'dg-t', 'start')), T(1430, 880, 'QA-301 · cuadro estanco', 'dg-f')]);
    const fila = (tag, titulo, y, id) => dispositivo(id, tag, 1370, y, 170, 52, [], [T(1455, y + 20, titulo, 'dg-f'), txv(`k-${id}-t`, 1455, y + 40, '—', 'dg-t')]);
    fila('QF-301', 'QF-301', 380, 'QF-301'); fila('ID-301', 'ID-301 · 30 mA', 450, 'ID-301'); fila('SPD-301', 'SPD-301', 520, 'SPD-301'); fila('TC-301', 'TC-301 · toma', 590, 'TC-301');
  }

  const RUTAS = {
    'C-A1': [['CAMPO-A.S1+', 'CB-101.1+'], ['CAMPO-A.S1−', 'CB-101.1−']], 'C-A2': [['CAMPO-A.S2+', 'CB-101.2+'], ['CAMPO-A.S2−', 'CB-101.2−']],
    'C-A3': [['CB-101.O+', 'INV-101.PV+'], ['CB-101.O−', 'INV-101.PV−']], 'C-A4': [['INV-101.BAT+', 'QB-101.1+'], ['INV-101.BAT−', 'QB-101.1−']], 'C-A5': [['QB-101.2+', 'BAT-101.+'], ['QB-101.2−', 'BAT-101.−']],
    'C-A6': [['QA-301.IN-L', 'INV-101.ACIN-L'], ['QA-301.IN-N', 'INV-101.ACIN-N'], ['QA-301.IN-PE', 'INV-101.ACIN-PE']], 'C-A7': [['INV-101.ACOUT-L', 'QA-301.OUT-L'], ['INV-101.ACOUT-N', 'QA-301.OUT-N'], ['INV-101.ACOUT-PE', 'QA-301.OUT-PE']],
    'C-B1': [['CAMPO-B.S1+', 'CAJA-B.1+'], ['CAMPO-B.S1−', 'CAJA-B.1−']], 'C-B2': [['CAMPO-B.S2+', 'CAJA-B.2+'], ['CAMPO-B.S2−', 'CAJA-B.2−']],
    'C-B3': [['CAJA-B.O1+', 'INV-201.PV1+'], ['CAJA-B.O1−', 'INV-201.PV1−']], 'C-B4': [['CAJA-B.O2+', 'INV-201.PV2+'], ['CAJA-B.O2−', 'INV-201.PV2−']],
    'C-B5': [['INV-201.L', 'QA-301.B-L'], ['INV-201.N', 'QA-301.B-N'], ['INV-201.PE', 'QA-301.B-PE']], 'C-C1': [['RED-301.L', 'QA-301.RED-L'], ['RED-301.N', 'QA-301.RED-N'], ['RED-301.PE', 'QA-301.RED-PE']],
    'C-A9': [['CB-101.PE', 'TIERRA.1']],
  };
  // rótulos de cada cable: [x, y de la línea 1 (sección y longitud), y de la línea 2 (caída de tensión), ancla]
  const ROTULOS = {
    'C-A1': [245, 114, 182, 'middle'], 'C-A2': [245, 214, 282, 'middle'], 'C-A3': [670, 154, 222, 'middle'], 'C-A4': [792, 368, 386, 'end'], 'C-A5': [792, 486, 504, 'end'], 'C-A6': [1200, 134, 222, 'middle'], 'C-A7': [1200, 274, 362, 'middle'],
    'C-B1': [245, 684, 752, 'middle'], 'C-B2': [245, 784, 852, 'middle'], 'C-B3': [670, 684, 752, 'middle'], 'C-B4': [670, 784, 852, 'middle'], 'C-B5': [1200, 684, 772, 'middle'], 'C-C1': [1340, 78, 98, 'end'], 'C-A9': [468, 322, null, 'start'],
  };

  function construirCableado() {
    construirDispositivos();
    const todos = CABLES.concat([CABLE_TIERRA]);
    const hilos = [], rotulos = [];
    for (const c of todos) {
      trazado(c, RUTAS[c.id]);
      const w = grosor(c.seccionMm2), caja = [];
      c.hilos.forEach((h, i) => {
        const d = rutaD(h.ruta), id = `k-${c.id}-${i + 1}`, cl = h.color === 'amarillo-verde' ? 'dg-col-amarillo' : `dg-col-${h.color.replace('ó', 'o')}`;
        caja.push(['path', { id, class: `dg-hilo-c ${cl}`, 'data-e': 'sd', 'stroke-width': w, d }]);
        if (h.color === 'amarillo-verde') caja.push(['path', { class: 'dg-hilo-c dg-col-verde dg-rayado', 'stroke-width': w, d }]);
      });
      hilos.push(g(c.tag, ...caja));
      const [x, y1, y2, a] = ROTULOS[c.id];
      if (c.tipo === 'pe') rotulos.push(txt(x, y1, `${c.id} · PE ${seccionTxt(c.seccionMm2)} mm² · ${longitudTxt(c.longitudM)} m`, 'dg-t', a));
      else { rotulos.push(txt(x, y1, `${c.id} · ${seccionTxt(c.seccionMm2)} mm² · ${longitudTxt(c.longitudM)} m`, 'dg-f', a)); rotulos.push(txv(`k-${c.id}-t`, x, y2, '—', 'dg-t', a)); }
    }
    // estados de los dispositivos que no son de continua y títulos
    const cab = [txt(24, 36, 'CABLEADO · bornas y conductores', 'dg-g', 'start'), txt(24, 62, 'Grosor = sección. Colores reales: rojo/negro (CC) y marrón/azul/amarillo-verde (CA). Valores supuestos.', 'dg-t', 'start')];
    return ['svg', { viewBox: VIEWBOX, class: 'dg-svg dg-cableado', role: 'group', 'aria-label': 'Esquema de cableado: bornas y conductores de las cajas de continua, los inversores, la batería y el cuadro de alterna, con sección, color y caída de tensión.' },
      ...cab, ...dibujo.cajas, ...hilos, ...dibujo.altos, ...dibujo.bornas, ...dibujo.rotulos, ...rotulos,
      txt(24, 906, 'ΔV = 2·ρ·L·I / S con la corriente de ahora (cobre a 70 °C). Sale en ámbar si pasa el límite orientativo (ver la tabla).', 'dg-t', 'start')];
  }

  /* ---------- modelo en vivo ---------- */
  function calcularCableado(e) {
    const hay = !!e, m = {}, u = U.calcularUnifilar(e);
    for (const c of CABLES.concat([CABLE_TIERRA])) {
      const vivo = c.vivo && u[c.vivo] ? u[c.vivo].e : (hay ? 'vivo' : 'sd');
      hilosDe(c).forEach((_, i) => { m[`k-${c.id}-${i + 1}`] = { e: c.tipo === 'pe' ? (hay ? 'vivo' : 'sd') : vivo }; });
      if (c.tipo !== 'pe') {
        const i = c.medida(e), k = caida(c, i);
        m[`k-${c.id}-t`] = { e: !hay ? 'sd' : k.pct > c.limitePct ? 'degradada' : 'ok', t: hay ? `ΔV ${dec(k.dv, 2)} V · ${dec(k.pct, 1)} %` : '—' };
      }
    }
    const i1 = comun.inversor(e, 'INV-101'), i2 = comun.inversor(e, 'INV-201'), bat = (e && e.bateria) || {};
    m['k-i1-t'] = { e: u['c-i1-t'].e, t: u['c-i1-t'].t }; m['k-i1-pv'] = { e: 'ok', t: hay ? `PV ${dec(i1.pvV, 0)} V · ${dec(i1.pvI)} A` : '—' };
    m['k-i2-t'] = { e: u['c-i2-t'].e, t: u['c-i2-t'].t }; m['k-i2-ca'] = { e: 'ok', t: hay ? `AC ${dec(i2.acV, 0)} V · ${dec(num(i2.acP, 0) / 230)} A` : '—' };
    m['k-bat-t'] = { e: u['c-bat'].e, t: hay ? `${dec(bat.v)} V · SoC ${Math.round(num(bat.soc01, 0) * 100)} %` : '—' }; m['k-bat-i'] = { e: u['c-bat'].e, t: hay ? `${num(bat.i, 0) >= 0 ? '+' : '−'}${dec(Math.abs(num(bat.i, 0)))} A` : '—' };
    for (const [id, tag, ut] of [['QF-301', 'QF-301', 'a-qf301-t'], ['ID-301', 'ID-301', 'a-id301-t'], ['SPD-301', 'SPD-301', 'a-spd301-t'], ['TC-301', 'TC-301', 'a-tc301-t']]) {
      m[`k-${id}`] = { e: u[ut].e }; m[`k-${id}-t`] = { e: u[ut].e, t: u[ut].t };
    }
    // estado de los demás dispositivos con protecciones o batería
    for (const [id, tag] of [['QB-101', 'QB-101'], ['FB-101', 'FB-101'], ['QS-201', 'QS-201'], ['SPD-201', 'SPD-201']]) m[`k-${id}`] = { e: comun.estadoProt(e, tag) };
    m['k-INV-101'] = { e: u['c-inv1'].e }; m['k-INV-201'] = { e: u['c-inv2'].e }; m['k-BAT-101'] = { e: u['c-bat'].e }; m['k-COM-101'] = { e: u['c-com'].e };
    m['k-RED-301'] = { e: u['a-red'].e }; m['k-CB-101'] = { e: hay ? 'ok' : 'sd' }; m['k-QA-301'] = { e: hay ? 'ok' : 'sd' };
    return m;
  }

  function ariaCableado(e) {
    const m = calcularCableado(e), o = {};
    for (const c of CABLES) o[c.tag] = o[c.tag] || `${c.id}, ${seccionTxt(c.seccionMm2)} mm², ${longitudTxt(c.longitudM)} m, ${(m[`k-${c.id}-t`] || {}).t || ''}`;
    return Object.assign(o, U.ariaUnifilar(e), o);
  }

  const ESQUEMA = construirCableado();
  const tagsDelEsquema = () => tagsDe(ESQUEMA);
  // La caja del cableado se pinta con el estado de los equipos: reutiliza el enlace del unifilar pero con las claves k-
  const crearObjetos = canvas => comun.crearObjetosDesde(canvas, calcularCableado, ariaCableado);

  const api = { VIEWBOX, ESQUEMA, CABLES, CABLE_TIERRA, RHO_CU, I_ADMISIBLE, COLOR_HILO, BORNAS, RUTAS, filasTabla, caida, hilosDe, grosor, tagsDelEsquema, crearObjetos, calcularCableado, ariaCableado };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.fvDiagramaCableado = api; }
})();
