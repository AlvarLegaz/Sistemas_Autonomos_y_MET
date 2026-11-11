// Esquema 2D (SCADA) de la planta real HTST. Reutiliza los objetos del SCADA de simulador_pct23 (Canvas, Etiqueta, Valvula, Sensor, Tuberia)
// pero con su propio esquema, sus tags ISA y su propia lectura del estado (contrato v1, ver ARQUITECTURA.md §4).
// La parte pura (qué tubos están activos, qué lectura va en cada sitio, qué LEDs) se exporta aparte para probarla sin navegador.
(function () {
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.htstLayout;
  const compartido = nombre => (typeof require !== 'undefined' ? null : PCT[nombre]);   // en Node solo se usa la parte pura

  /* ---------- lectura del estado (pura) ---------- */
  const equipo = (e, tag) => (e && e.equipos && e.equipos[tag]) || {};
  const instrumento = (e, tag) => (e && e.instrumentos && e.instrumentos[tag]) || {};
  const caudalLh = e => (e && e.proceso && e.proceso.caudalLh) || 0;
  const enMarcha = (e, tag) => !!equipo(e, tag).marcha;
  const abierta = (e, tag) => { const q = equipo(e, tag); return !!(q.abierta || q.energizada || q.apertura01 > 0); };
  const posicionFdv = e => equipo(e, 'FDV-101').posicion;

  /** Tubos que llevan fluido ahora (para iluminarlos y animar el flujo). */
  function estadoTubos(e) {
    const flujo = caudalLh(e) > 0;
    return {
      crudo: flujo,                                         // de TK-101 hasta la FDV
      avance: flujo && posicionFdv(e) === 'AVANCE',        // producto pasteurizado hacia la salida
      desvio: flujo && posicionFdv(e) === 'DESVIO',        // leche que no llegó a temperatura, de vuelta a TK-101
      caliente: enMarcha(e, 'P-102'),
      fria: abierta(e, 'XV-301'),
    };
  }

  const unidadDe = tag => (layout.senal(tag).find(s => s.tipo === 'AI') || {}).unidad || '';
  const decimal = (v, c = 1) => v.toFixed(c).replace('.', ',');

  /** Texto de la lectura de un instrumento analógico: valor del PLC con su unidad, o el fallo del lazo si no es de fiar. */
  function textoInstrumento(e, tag) {
    const i = instrumento(e, tag);
    if (i.calidad && i.calidad !== 'OK') return `⚠ ${i.calidad}`;
    if (typeof i.valorPLC !== 'number') return '—';
    const u = unidadDe(tag);
    return `${decimal(i.valorPLC, u === 'L/h' ? 0 : 1)} ${u}`;
  }
  const alarmaInstrumento = (e, tag) => { const c = instrumento(e, tag).calidad; return !!c && c !== 'OK'; };

  /** LEDs del cuadro del armario: [tag, texto, función que dice si está «bien» (verde) y otra si debe verse en rojo]. */
  const digital = (e, tag) => instrumento(e, tag).nivel;
  const LEDS = [
    ['PS-001', '24 V', e => digital(e, 'PS-001') === 1, e => digital(e, 'PS-001') === 0],
    ['F-201', 'F-201', e => !equipo(e, 'F-201').fundido, e => !!equipo(e, 'F-201').fundido],
    ['ES-001', 'Seta', e => digital(e, 'ES-001') === 1, e => digital(e, 'ES-001') === 0],
    ['TSH-101', 'TSH', e => digital(e, 'TSH-101') === 1, e => digital(e, 'TSH-101') === 0],
    ['QF-102', 'QF-102', e => digital(e, 'QF-102') === 1, e => digital(e, 'QF-102') === 0],
    ['PSL-201', 'Aire', e => digital(e, 'PSL-201') === 1, e => digital(e, 'PSL-201') === 0],
    ['VFD-101', 'VFD', e => !equipo(e, 'VFD-101').fallo, e => !!equipo(e, 'VFD-101').fallo],
    ['P-101', 'P-101', e => enMarcha(e, 'P-101'), () => false],
    ['KM-102', 'KM-102', e => !!equipo(e, 'KM-102').cerrado, () => false],
    ['KM-103', 'KM-103', e => !!equipo(e, 'KM-103').cerrado, () => false],
    ['KM-201', 'KM-201', e => !!equipo(e, 'KM-201').cerrado, () => false],
    ['KM-202', 'KM-202', e => !!equipo(e, 'KM-202').cerrado, () => false],
    ['PB-001', 'PB', e => digital(e, 'PB-001') === 1, () => false],
    ['PLC-001', 'PLC', () => true, () => false],
    ['HMI-001', 'HMI', () => true, () => false],
    ['HL-001', 'Baliza', () => false, e => !!(e && e.salidasPLC && e.salidasPLC.DO && e.salidasPLC.DO['HL-001'])],
  ];

  /* ---------- esquema ---------- */
  const g = (tag, ...hijos) => ['g', { id: `g-${tag}`, 'data-tag': tag }, ...hijos];
  const txt = (x, y, t, clase = 'etiqueta', extra = {}) => ['text', Object.assign({ x, y, class: clase }, extra), t];
  const circulo = (x, y, r, id) => ['circle', Object.assign({ class: 'instr', cx: x, cy: y, r }, id ? { id } : {})];
  const PEQUENO = 'font-size:9px';

  const sensor = (tag, x, y, corto = tag) => g(tag, circulo(x, y, 16, `c-${tag}`), txt(x, y + 3, corto, 'etiqueta', { style: PEQUENO }), txt(x, y - 22, '—', 'lectura', { id: `v-${tag}`, style: 'font-size:11px' }));
  const bomba = (tag, x, y, punta = 1) => g(tag, circulo(x, y, 18), ['path', { d: `M${x - 6 * punta} ${y - 9} L${x + 9 * punta} ${y} L${x - 6 * punta} ${y + 9} Z`, fill: 'var(--tubo)' }], txt(x, y + 34, tag));
  const valvula2 = (tag, x, y) => g(tag, ['path', { class: 'valvula', d: `M${x - 11} ${y - 10} L${x} ${y} L${x - 11} ${y + 10} Z M${x + 11} ${y - 10} L${x} ${y} L${x + 11} ${y + 10} Z` }], txt(x, y + 28, tag));
  const valvula3 = (tag, x, y) => g(tag, ['path', { class: 'valvula', d: `M${x - 11} ${y - 10} L${x} ${y} L${x - 11} ${y + 10} Z M${x + 11} ${y - 10} L${x} ${y} L${x + 11} ${y + 10} Z M${x - 9} ${y - 18} L${x} ${y} L${x + 9} ${y - 18} Z` }], txt(x, y + 28, tag));
  const caja = (tag, x, y, w, h, etiqueta, yEtiqueta) => g(tag, ['rect', { class: 'caja', x, y, width: w, height: h, rx: 4 }], txt(x + w / 2, yEtiqueta === undefined ? y + h + 16 : yEtiqueta, etiqueta, 'lectura'));
  const led = (tag, x, y, texto) => ['g', { id: `g-led-${tag}`, 'data-tag': tag }, circulo(x, y, 7, `c-led-${tag}`), txt(x, y + 20, texto, 'lectura', { style: PEQUENO })];

  function construirEsquema() {
    const filaLeds = LEDS.map(([tag, texto], i) => led(tag, 215 + (i % 8) * 62, i < 8 ? 100 : 160, texto));
    const hijos = [
      // --- tuberías (de leche: verde al activarse; agua caliente: naranja; agua fría: azul) ---
      ['path', { class: 'tubo', 'data-ruta': 'crudo', d: 'M120 350 H330 M460 340 H520 M640 350 H700 C730 350 730 300 760 300 H800 C830 300 830 350 860 350 H880' }],
      ['path', { class: 'tubo', 'data-ruta': 'crudo', d: 'M470 350 H520' }],
      ['path', { class: 'tubo', 'data-ruta': 'avance', d: 'M880 350 V385 H460 M330 385 H312 V470 H330 M460 470 H720 H960' }],
      ['path', { class: 'tubo', 'data-ruta': 'desvio', d: 'M880 350 V225 H75 V260' }],
      ['path', { class: 'tubo caliente', 'data-ruta': 'caliente', d: 'M640 490 H690 V390 H640 M520 390 H508 V505 H560' }],
      ['path', { class: 'tubo frio', 'data-ruta': 'fria', d: 'M40 500 H330 M460 500 H482 V530' }],
      // --- depósito ---
      ['rect', { class: 'caja', x: 30, y: 260, width: 90, height: 120, rx: 4 }],
      ['rect', { class: 'liquido', id: 'nivel-TK-101', x: 32, y: 320, width: 86, height: 58 }],
      g('TK-101', txt(75, 252, 'TK-101'), txt(75, 400, '—', 'lectura', { id: 'v-LT-101' })),
      g('LSH-101', circulo(140, 275, 11, 'c-LSH-101'), txt(140, 279, 'H', 'etiqueta', { style: PEQUENO })),
      g('LSL-101', circulo(140, 360, 11, 'c-LSL-101'), txt(140, 364, 'L', 'etiqueta', { style: PEQUENO })),
      g('LT-101', ['rect', { class: 'manual', x: 128, y: 300, width: 24, height: 22 }], txt(140, 316, 'LT', 'etiqueta', { style: PEQUENO })),
      // --- proceso ---
      g('FLT-101', ['rect', { class: 'manual', x: 142, y: 338, width: 24, height: 24 }], ['path', { d: 'M142 362 L166 338', stroke: 'var(--tubo)', 'stroke-width': 1.5 }], txt(154, 382, 'FLT-101', 'lectura', { style: PEQUENO })),
      bomba('P-101', 205, 350),
      sensor('FT-101', 268, 350, 'FT'),
      sensor('TT-101', 305, 305, 'TT-101'),
      sensor('PT-101', 395, 295, 'PT-101'),
      caja('HX-101', 330, 310, 130, 100, 'REGENERACIÓN (HX-101)'),
      ['path', { class: 'tubo', d: 'M335 340 H455 M335 385 H455' }],
      sensor('TT-102', 478, 305, 'TT-102'),
      sensor('PT-102', 318, 435, 'PT-102'),
      bomba('P-103', 490, 350),
      ['rect', { class: 'caja', x: 520, y: 310, width: 120, height: 100, rx: 4 }], txt(580, 426, 'CALENTAMIENTO', 'lectura'),
      ['path', { class: 'tubo', d: 'M525 350 H635 M525 390 H635' }],
      ['rect', { class: 'caja', x: 330, y: 440, width: 130, height: 80, rx: 4 }], txt(395, 536, 'ENFRIAMIENTO', 'lectura'),
      ['path', { class: 'tubo', d: 'M335 470 H455 M335 500 H455' }],
      g('HT-101', ['path', { class: 'tubo', d: 'M700 350 C730 350 730 300 760 300 H800 C830 300 830 350 860 350' }], txt(780, 285, 'HT-101 · tubo de residencia', 'lectura')),
      sensor('TT-103', 826, 255, 'TT-103'),
      valvula3('FDV-101', 880, 350),
      g('SV-101', circulo(920, 300, 9, 'c-SV-101'), txt(955, 304, 'SV-101', 'lectura', { style: PEQUENO })),
      g('FRL-101', ['rect', { class: 'manual', x: 945, y: 260, width: 24, height: 20 }], txt(957, 295, 'FRL', 'lectura', { style: PEQUENO })),
      g('ZS-101', circulo(910, 335, 7, 'c-ZS-101'), txt(910, 322, 'ZS1', 'lectura', { style: PEQUENO })),
      g('ZS-102', circulo(850, 335, 7, 'c-ZS-102'), txt(850, 322, 'ZS2', 'lectura', { style: PEQUENO })),
      sensor('TT-104', 735, 440, 'TT-104'),
      txt(960, 462, 'LECHE PASTEURIZADA →', 'lectura', { style: 'text-anchor:end;font-weight:700' }),
      txt(780, 215, '← DESVÍO A TK-101', 'lectura', { style: 'font-weight:700' }),
      // --- agua caliente y fría ---
      g('HW-101', ['rect', { class: 'caja', x: 560, y: 450, width: 80, height: 70, rx: 4 }], ['path', { class: 'tubo', d: 'M575 505 L585 480 L595 505 L605 480 L615 505 L625 480' }], txt(600, 536, 'HW-101', 'lectura')),
      bomba('P-102', 690, 490),
      sensor('TT-105', 735, 395, 'TT-105'),
      g('TSH-101', circulo(545, 470, 11, 'c-TSH-101'), txt(545, 474, 'TSH', 'etiqueta', { style: PEQUENO })),
      valvula2('XV-301', 200, 500),
      valvula2('XV-401', 60, 470),
      txt(40, 520, 'AGUA FRÍA ←', 'lectura', { style: 'font-weight:700' }),
      txt(482, 548, 'A DESAGÜE', 'lectura', { style: PEQUENO }),
      // --- armario: lo que ve el PLC ---
      ['rect', { class: 'caja', x: 200, y: 52, width: 540, height: 150, rx: 6 }],
      g('QE-001', txt(470, 74, 'ARMARIO QE-001 · estado del PLC-001', 'etiqueta')),
      ...filaLeds,
    ];
    return ['svg', { viewBox: '0 0 1000 560', role: 'img', 'aria-label': 'Esquema de la planta real HTST de pasteurización de leche' }, ...hijos];
  }

  const ESQUEMA_HTST = construirEsquema();
  /** Todos los tags (data-tag) que aparecen en el esquema, para comprobar que no falta ningún equipo. */
  function tagsDelEsquema(esquema = ESQUEMA_HTST) {
    const tags = new Set();
    (function recorrer(nodo) {
      if (!Array.isArray(nodo)) return;
      const atributos = nodo[1] && typeof nodo[1] === 'object' && !Array.isArray(nodo[1]) ? nodo[1] : null;
      if (atributos && atributos['data-tag']) tags.add(atributos['data-tag']);
      nodo.forEach(recorrer);
    })(esquema);
    return tags;
  }

  /* ---------- objetos SCADA (solo en el navegador) ---------- */
  function crearObjetos(canvas) {
    const { Etiqueta } = compartido('etiqueta'), { Valvula } = compartido('valvula'), { Sensor } = compartido('sensor'), { Tuberia } = compartido('tuberia');
    const velocidad = e => equipo(e, 'P-101').velocidadPct || 60;
    const objetos = [
      new Tuberia(canvas, '[data-ruta="crudo"]', e => estadoTubos(e).crudo, velocidad),
      new Tuberia(canvas, '[data-ruta="avance"]', e => estadoTubos(e).avance, velocidad),
      new Tuberia(canvas, '[data-ruta="desvio"]', e => estadoTubos(e).desvio, velocidad),
      new Tuberia(canvas, '[data-ruta="caliente"]', e => estadoTubos(e).caliente, () => 60),
      new Tuberia(canvas, '[data-ruta="fria"]', e => estadoTubos(e).fria, () => 60),
      new Valvula(canvas, 'g-P-101', e => enMarcha(e, 'P-101')), new Valvula(canvas, 'g-P-102', e => enMarcha(e, 'P-102')), new Valvula(canvas, 'g-P-103', e => enMarcha(e, 'P-103')),
      new Valvula(canvas, 'g-XV-301', e => abierta(e, 'XV-301')), new Valvula(canvas, 'g-XV-401', e => abierta(e, 'XV-401')),
      new Valvula(canvas, 'g-FDV-101', e => posicionFdv(e) === 'AVANCE'), new Valvula(canvas, 'g-SV-101', e => !!equipo(e, 'SV-101').energizada),
      new Valvula(canvas, 'g-ZS-101', e => digital(e, 'ZS-101') === 1), new Valvula(canvas, 'g-ZS-102', e => digital(e, 'ZS-102') === 1),
      new Valvula(canvas, 'g-HW-101', e => !!(equipo(e, 'HW-101').banco1 || equipo(e, 'HW-101').banco2)),
      new Valvula(canvas, 'g-LSH-101', e => digital(e, 'LSH-101') === 1), new Valvula(canvas, 'g-LSL-101', e => digital(e, 'LSL-101') === 1),
      new Etiqueta(canvas, 'v-LT-101', e => textoInstrumento(e, 'LT-101')),
    ];
    for (const s of layout.SENALES.filter(x => x.tipo === 'AI' && x.tag !== 'LT-101')) {
      objetos.push(new Etiqueta(canvas, `v-${s.tag}`, e => textoInstrumento(e, s.tag)));
      objetos.push(new Sensor(canvas, `c-${s.tag}`, s.tag));
    }
    objetos.push({ actualizar(e) { const el = canvas.buscar('nivel-TK-101'); const pct = Math.max(0, Math.min(100, (e.tanque && e.tanque.nivelPct) || 0)); el.setAttribute('height', String(116 * pct / 100)); el.setAttribute('y', String(378 - 116 * pct / 100)); } });
    for (const [tag, , bien, mal] of LEDS) {
      const circuloLed = canvas.buscar(`c-led-${tag}`);
      objetos.push({ actualizar(e) { circuloLed.classList.toggle('on', !!bien(e)); circuloLed.classList.toggle('alarma', !!mal(e)); } });
    }
    return objetos;
  }

  /** Lecturas para los objetos que usan el parámetro «lecturas»: aquí, la calidad de cada lazo (true = alarma). */
  function lecturasEsquema(e) {
    const salida = {};
    for (const s of layout.SENALES.filter(x => x.tipo === 'AI')) salida[s.tag] = alarmaInstrumento(e, s.tag);
    return salida;
  }

  const api = { ESQUEMA_HTST, construirEsquema, tagsDelEsquema, LEDS, estadoTubos, textoInstrumento, alarmaInstrumento, lecturasEsquema, crearObjetos };
  if (typeof module !== 'undefined') module.exports = api; else PCT.htstEsquema = api;
})();
