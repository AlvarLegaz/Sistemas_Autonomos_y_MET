(function () {
  const { Canvas } = typeof require !== 'undefined' ? require('./canvas.js') : PCT.canvas;
  const { Bomba } = typeof require !== 'undefined' ? require('./bomba.js') : PCT.bomba;
  const { Valvula } = typeof require !== 'undefined' ? require('./valvula.js') : PCT.valvula;
  const { Sensor } = typeof require !== 'undefined' ? require('./sensor.js') : PCT.sensor;
  const { Deposito } = typeof require !== 'undefined' ? require('./deposito.js') : PCT.deposito;
  const { Resistencia } = typeof require !== 'undefined' ? require('./resistencia.js') : PCT.resistencia;
  const { Tuberia } = typeof require !== 'undefined' ? require('./tuberia.js') : PCT.tuberia;
  const { Etiqueta } = typeof require !== 'undefined' ? require('./etiqueta.js') : PCT.etiqueta;

  // Esquema del SVG de la revisión 17 del original. Cada ids y clase se conserva tal cual para el CSS.
  const ESQUEMA_PCT23 = ['svg', { viewBox: '0 0 1000 480', role: 'img', 'aria-label': 'Esquema de la planta PCT23' },
    ['path', { class: 'tubo caliente', 'data-bomba': 'N2', d: 'M140 150 H190 M226 150 H238 V346 H318 H333 V351 L354 365 H380 L401 351 V346 H420 V384 H205 V190 H120 V170' }],
    ['path', { class: 'tubo', 'data-bomba': 'N1', d: 'M850 250 H736 M704 250 H546 V322 H527 V330 L505 344 H481 L459 330 V322 H444 H420 H401 V330 L379 344 H355 L333 330 V322 H318 H260 V110 H330' }],
    ['path', { class: 'tubo', 'data-bomba': 'N1', d: 'M330 110 C310 110 310 80 330 80 H400 C420 80 420 110 400 110 H440 V80 H452' }],
    ['path', { class: 'tubo', 'data-ruta': 'normal', d: 'M468 80 H480 V296 H432 V346 H444 H459 V351 L481 365 H505 L527 351 V346 H546 H554 V322 H570 H585 V330 L607 344 H631 L653 330 V322 H672 V400 H970' }],
    ['path', { class: 'tubo frio', 'data-solenoide': 'SOL5', d: 'M815 35 V18 H915' }],
    ['path', { class: 'tubo frio', 'data-solenoide': 'SOL4', d: 'M915 35 V18' }],
    ['path', { class: 'tubo frio', 'data-circuito': 'colector-frio', d: 'M915 18 H985 V420 H610 V440' }],
    ['path', { class: 'tubo frio', 'data-circuito': 'colector-frio', d: 'M610 440 H652 M680 440 H706 M742 440 H960' }],
    ['path', { class: 'tubo frio', 'data-circuito': 'frio', d: 'M562 440 H610' }],
    ['path', { class: 'tubo frio', 'data-circuito': 'frio', d: 'M535 440 V389 H560 V346 H570 H585 V351 L607 365 H631 L653 351 V346 H672 H684 V285 H556 V242' }],
    ['g', { 'aria-label': 'Cruces de tuberías independientes' },
      ['rect', { x: 428, y: 316, width: 8, height: 12, fill: 'var(--panel)' }],
      ['path', { class: 'tubo', 'data-ruta': 'normal', d: 'M432 314 V330' }],
      ['rect', { x: 668, y: 340, width: 8, height: 12, fill: 'var(--panel)' }],
      ['path', { class: 'tubo frio', 'data-circuito': 'frio', d: 'M662 346 H684' }]],
    ['path', { class: 'tubo', 'data-bomba': 'N1', d: 'M865 262 V215 M800 210 V240' }],
    ['path', { class: 'tubo', 'data-tanque': 'B', d: 'M815 210 V250 H850' }],
    ['path', { class: 'tubo', 'data-tanque': 'A', d: 'M915 210 V250 H880' }],
    ['path', { class: 'tubo', 'data-ruta': 'desvio', d: 'M460 64 V30' }],
    ['text', { x: 521, y: 24, class: 'lectura' }, 'DIVERTED PRODUCT ', ['tspan', { 'font-size': 17, 'font-weight': 700 }, '↑']],
    ['text', { x: 657, y: 24, class: 'lectura', id: 'v-QD', style: 'text-anchor:start;font-weight:700' }, '0 ml'],
    ['rect', { class: 'caja', x: 30, y: 40, width: 110, height: 130, rx: 4 }],
    ['rect', { class: 'liquido', x: 32, y: 75, width: 106, height: 93 }],
    ['polyline', { class: 'tubo', id: 'resistencia', points: '60,70 60,100 76,85 76,115 92,100 92,130 108,115' }],
    ['text', { x: 85, y: 32, class: 'etiqueta' }, 'HEAT UNIT'],
    ['g', {},
      ['line', { x1: 140, y1: 62, x2: 160, y2: 62, class: 'tubo' }],
      ['circle', { class: 'instr', cx: 175, cy: 62, r: 15 }],
      ['text', { x: 175, y: 66, class: 'etiqueta' }, 'T2'],
      ['text', { x: 175, y: 90, class: 'lectura', id: 'v-T2' }, '—']],
    ['g', { id: 'g-PWR' },
      ['line', { x1: 85, y1: 170, x2: 85, y2: 190, class: 'tubo' }],
      ['circle', { class: 'instr', id: 'c-PWR', cx: 85, cy: 205, r: 15 }],
      ['text', { x: 85, y: 209, class: 'etiqueta', style: 'font-size:11px' }, 'RES'],
      ['text', { x: 85, y: 236, class: 'lectura', id: 'v-PWR' }, '—']],
    ['g', {},
      ['circle', { class: 'instr', id: 'c-LVLC', cx: 45, cy: 262, r: 13 }],
      ['text', { x: 45, y: 266, class: 'etiqueta', style: 'font-size:9px' }, 'LVL'],
      ['circle', { class: 'instr', id: 'c-HLC', cx: 85, cy: 262, r: 13 }],
      ['text', { x: 85, y: 266, class: 'etiqueta', style: 'font-size:9px' }, 'HL'],
      ['circle', { class: 'instr', id: 'c-TERM', cx: 125, cy: 262, r: 13 }],
      ['text', { x: 125, y: 266, class: 'etiqueta', style: 'font-size:9px' }, 'TERM']],
    ['g', { class: 'accion', id: 'g-N2', 'data-salida': 'N2' },
      ['circle', { class: 'instr', cx: 208, cy: 150, r: 17 }],
      ['path', { d: 'M202 141 L217 150 L202 159 Z', fill: 'var(--tubo)' }],
      ['text', { x: 208, y: 184, class: 'etiqueta' }, 'N2']],
    ['g', { class: 'accion', id: 'g-N1', 'data-salida': 'N1' },
      ['circle', { class: 'instr', cx: 720, cy: 250, r: 17 }],
      ['path', { d: 'M726 241 L711 250 L726 259 Z', fill: 'var(--tubo)' }],
      ['text', { x: 720, y: 284, class: 'etiqueta' }, 'N1']],
    ['text', { x: 370, y: 140, class: 'etiqueta' }, 'HOLDING TUBE'],
    ['g', {},
      ['circle', { class: 'instr', cx: 330, cy: 45, r: 15 }],
      ['text', { x: 330, y: 49, class: 'etiqueta' }, 'T1'],
      ['text', { x: 330, y: 22, class: 'lectura', id: 'v-T1' }, '—'],
      ['line', { x1: 330, y1: 60, x2: 330, y2: 78, class: 'tubo' }]],
    ['g', {},
      ['line', { x1: 513, y1: 288, x2: 513, y2: 309, class: 'tubo' }],
      ['circle', { class: 'instr', cx: 513, cy: 275, r: 13 }],
      ['text', { x: 513, y: 279, class: 'etiqueta' }, 'T5'],
      ['text', { x: 513, y: 257, class: 'lectura', id: 'v-T5' }, '—']],
    ['g', { class: 'accion', id: 'g-SOL1', 'data-salida': 'SOL1' },
      ['path', { class: 'valvula', d: 'M446 68 L460 80 L446 92 Z M474 68 L460 80 L474 92 Z' }],
      ['text', { x: 500, y: 66, class: 'etiqueta' }, 'SOL1'],
      ['text', { x: 500, y: 52, class: 'lectura' }, 'desvío']],
    ['g', {},
      ['circle', { class: 'instr', cx: 260, cy: 168, r: 15 }],
      ['text', { x: 260, y: 172, class: 'etiqueta' }, 'F1'],
      ['text', { x: 330, y: 172, class: 'lectura', id: 'v-F1' }, '—']],
    ['g', {},
      ['rect', { class: 'manual', x: 248, y: 195, width: 24, height: 24 }],
      ['path', { d: 'M248 219 L272 195', stroke: 'var(--tubo)', 'stroke-width': 1.5 }],
      ['text', { x: 300, y: 212, class: 'lectura' }, 'FILTER']],
    ['g', {},
      ['circle', { class: 'instr', cx: 260, cy: 272, r: 15 }],
      ['text', { x: 260, y: 276, class: 'etiqueta' }, 'T4'],
      ['text', { x: 282, y: 276, class: 'lectura', style: 'text-anchor:start', id: 'v-T4' }, '—']],
    ['g', {},
      ['rect', { class: 'caja', x: 318, y: 309, width: 102, height: 64 }],
      ['rect', { class: 'caja', x: 444, y: 309, width: 102, height: 64 }],
      ['rect', { class: 'caja', x: 570, y: 309, width: 102, height: 64 }],
      ['text', { x: 369, y: 399, class: 'lectura' }, 'regeneración'],
      ['text', { x: 495, y: 399, class: 'lectura' }, 'calentamiento'],
      ['text', { x: 621, y: 399, class: 'lectura' }, 'enfriamiento']],
    ['text', { x: 598, y: 232, class: 'lectura' }, 'TO DRAIN ', ['tspan', { 'font-size': 20, 'font-weight': 700 }, '↑']],
    ['g', {},
      ['circle', { class: 'instr', cx: 700, cy: 400, r: 15 }],
      ['text', { x: 700, y: 404, class: 'etiqueta' }, 'T3'],
      ['text', { x: 700, y: 378, class: 'lectura', id: 'v-T3' }, '—']],
    ['text', { x: 800, y: 392, class: 'lectura' }, 'FINISHED PRODUCT ', ['tspan', { 'font-size': 20, 'font-weight': 700 }, '→']],
    ['text', { x: 800, y: 376, class: 'lectura', id: 'v-QF', style: 'text-anchor:start;font-weight:700' }, '0 ml'],
    ['g', { class: 'accion', id: 'g-SOL3', 'data-salida': 'SOL3' },
      ['path', { class: 'valvula', d: 'M538 430 L550 440 L538 450 Z M562 430 L550 440 L562 450 Z' }],
      ['text', { x: 550, y: 468, class: 'etiqueta' }, 'SOL3']],
    ['g', {},
      ['path', { class: 'valvula on', d: 'M652 431 L665 440 L652 449 Z M680 431 L667 440 L680 449 Z' }],
      ['text', { x: 666, y: 468, class: 'etiqueta' }, 'V1']],
    ['g', {},
      ['path', { class: 'valvula on', d: 'M706 430 L718 440 L706 450 Z M742 430 L718 440 L742 450 Z' }],
      ['text', { x: 724, y: 468, class: 'etiqueta' }, 'PRV1']],
    ['text', { x: 880, y: 460, class: 'lectura' }, 'COLD WATER ', ['tspan', { 'font-size': 20, 'font-weight': 700 }, '←']],
    ['rect', { class: 'caja', x: 780, y: 70, width: 70, height: 140 }],
    ['rect', { class: 'liquido', id: 'nivel-B', x: 782, y: 150, width: 66, height: 58 }],
    ['rect', { class: 'caja', x: 880, y: 70, width: 70, height: 140 }],
    ['rect', { class: 'liquido', id: 'nivel-A', x: 882, y: 150, width: 66, height: 58 }],
    ['text', { x: 815, y: 125, class: 'etiqueta' }, 'B'],
    ['text', { x: 915, y: 125, class: 'etiqueta' }, 'A'],
    ['g', { class: 'accion', id: 'g-SOL5', 'data-salida': 'SOL5' },
      ['path', { class: 'valvula', d: 'M803 36 L815 48 L827 36 Z M803 60 L815 48 L827 60 Z' }],
      ['text', { x: 845, y: 52, class: 'etiqueta' }, 'SOL5']],
    ['g', { class: 'accion', id: 'g-SOL4', 'data-salida': 'SOL4' },
      ['path', { class: 'valvula', d: 'M903 36 L915 48 L927 36 Z M903 60 L915 48 L927 60 Z' }],
      ['text', { x: 945, y: 52, class: 'etiqueta' }, 'SOL4']],
    ['g', { class: 'accion', id: 'g-SOL2', 'data-salida': 'SOL2' },
      ['path', { class: 'valvula', d: 'M848 238 L865 250 L848 262 Z M882 238 L865 250 L882 262 Z M853 276 L865 250 L877 276 Z' }],
      ['text', { x: 905, y: 270, class: 'etiqueta' }, 'SOL2']],
    ['g', { id: 'g-V3', class: 'accion', style: 'cursor:pointer' },
      ['path', { class: 'valvula', d: 'M795 226 L803 234 L795 242 Z M811 226 L803 234 L811 242 Z' }],
      ['text', { x: 787, y: 238, class: 'lectura', style: 'text-anchor:end' }, 'V3']],
    ['g', {},
      ['path', { class: 'manual', d: 'M857 205 L865 213 L873 205 Z' }],
      ['text', { x: 890, y: 226, class: 'lectura' }, 'V2']],
    ['g', {},
      ['line', { x1: 770, y1: 100, x2: 780, y2: 100, class: 'tubo' }],
      ['circle', { class: 'instr', id: 'c-HL', cx: 757, cy: 100, r: 13 }],
      ['text', { x: 757, y: 104, class: 'etiqueta' }, 'HL']],
    ['g', {},
      ['line', { x1: 770, y1: 180, x2: 780, y2: 180, class: 'tubo' }],
      ['circle', { class: 'instr', id: 'c-LL', cx: 757, cy: 180, r: 13 }],
      ['text', { x: 757, y: 184, class: 'etiqueta' }, 'LL']],
    ['g', {},
      ['line', { x1: 950, y1: 170, x2: 962, y2: 170, class: 'tubo' }],
      ['circle', { class: 'instr', cx: 975, cy: 170, r: 13 }],
      ['text', { x: 975, y: 174, class: 'etiqueta' }, 'L1'],
      ['text', { x: 925, y: 236, class: 'lectura', id: 'v-L1', style: 'text-anchor:start;font-weight:700;fill:var(--texto) !important' }, '—']],
  ];

  function textoPotencia(potenciaPct) {
    return `${potenciaPct} % · ${Math.round(potenciaPct * 50 / 100)}/50 ciclos`;
  }

  function crearCanvasPct23() {
    return new Canvas(ESQUEMA_PCT23);
  }

  function crearBombasYValvulas(canvas) {
    const bombas = ['N1', 'N2'].map(clave => new Bomba(canvas, `g-${clave}`, clave));
    const valvulas = ['SOL1', 'SOL2', 'SOL3', 'SOL4', 'SOL5'].map(clave => new Valvula(canvas, `g-${clave}`, e => e.salidas[clave]));
    return [...bombas, ...valvulas, new Valvula(canvas, 'g-V3', e => e.valvulaV3)];
  }

  function crearResistencia(canvas) {
    return [
      new Resistencia(canvas, 'c-PWR', 'resistencia'),
      new Etiqueta(canvas, 'v-PWR', e => `${e.salidas.RES ? 'ON' : 'OFF'} · ${textoPotencia(e.consignas.potenciaPct)}`),
    ];
  }

  function crearDepositosYSensores(canvas) {
    return [
      new Deposito(canvas, 'nivel-A', e => e.depositoAMl),
      new Deposito(canvas, 'nivel-B', e => e.depositoBMl),
      ...['TERM', 'HL', 'LL'].map(clave => new Sensor(canvas, `c-${clave}`, clave)),
    ];
  }

  function crearLecturas(canvas) {
    const { formatearDecimal, formatearEntero } = PCT.dom;
    const temperaturas = ['T1', 'T2', 'T3', 'T4', 'T5'].map(clave =>
      new Etiqueta(canvas, `v-${clave}`, (e, l) => `${formatearDecimal(l[clave])} °C`));
    return [
      ...temperaturas,
      new Etiqueta(canvas, 'v-F1', (e, l) => `${formatearEntero(l.F1)} ml/min`),
      new Etiqueta(canvas, 'v-L1', (e, l) => `${formatearEntero(l.L1)} mm`),
      new Etiqueta(canvas, 'v-QD', e => `${formatearEntero(e.desviadoMl)} ml`),
      new Etiqueta(canvas, 'v-QF', e => `${formatearEntero(e.finalMl)} ml`),
    ];
  }

  function crearTuberias(canvas) {
    return [
      new Tuberia(canvas, '[data-bomba="N1"]', e => e.salidas.N1),
      new Tuberia(canvas, '[data-bomba="N2"]', e => e.salidas.N2),
      new Tuberia(canvas, '[data-ruta="normal"]', e => e.salidas.N1 && !e.salidas.SOL1),
      new Tuberia(canvas, '[data-ruta="desvio"]', e => e.salidas.N1 && e.salidas.SOL1),
      new Tuberia(canvas, '[data-tanque="A"]', e => !e.salidas.SOL2),
      new Tuberia(canvas, '[data-tanque="B"]', e => e.salidas.SOL2),
      new Tuberia(canvas, '[data-solenoide="SOL4"]', e => e.salidas.SOL4),
      new Tuberia(canvas, '[data-solenoide="SOL5"]', e => e.salidas.SOL5),
      new Tuberia(canvas, '[data-circuito="frio"]', e => e.salidas.SOL3),
      new Tuberia(canvas, '[data-circuito="colector-frio"]', e => e.salidas.SOL3 || e.salidas.SOL4 || e.salidas.SOL5),
    ];
  }

  function crearObjetosPct23(canvas) {
    return [
      ...crearTuberias(canvas),
      ...crearBombasYValvulas(canvas),
      ...crearResistencia(canvas),
      ...crearDepositosYSensores(canvas),
      ...crearLecturas(canvas),
    ];
  }

  const api = { ESQUEMA_PCT23, textoPotencia, crearCanvasPct23, crearObjetosPct23 };
  if (typeof module !== 'undefined') module.exports = api; else PCT.esquemaPct23 = api;
})();
