// Esquema 2D (SCADA) de la planta real HTST de leche. Reutiliza los objetos del SCADA de simulador_pct23 (Canvas, Etiqueta, Sensor, Tuberia)
// con su propio esquema, sus tags ISA y su propia lectura del estado (contrato v1, ver ARQUITECTURA.md §4).
//
// Distribución (viewBox 1220 × 660), de izquierda a derecha en el orden del proceso, sin cruces de tubería:
//   fila superior : llenado (XV-101) · TK-101 · desvío de la FDV (por arriba) · agua caliente HW-101 sobre el calentamiento
//   fila de proceso (y = 240): TK-101 → FLT-101 → P-101 → FT-101 → TT-101 → regeneración → P-103 → calentamiento → tubo de residencia → FDV-101
//   retorno pasteurizado (y = 360 → 290 → 470): de la FDV por el lado «pasteurizado» de la regeneración, el enfriamiento y la salida
//   banda inferior: agua fría (XV-301), desagües y limpieza CIP (XV-401); a la derecha, el armario con los LEDs agrupados por función.
// Convención de color (pedida por el usuario): leche = verde, agua fría = azul, agua caliente = naranja, y solo en lo que está activo.
// La parte pura (qué tubos están activos, qué lectura va en cada sitio, qué LEDs, textos de accesibilidad) se exporta para probarla sin navegador.
(function () {
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.htstLayout;
  const compartido = nombre => (typeof require !== 'undefined' ? null : PCT[nombre]);   // en Node solo se usa la parte pura
  const leyenda = typeof require !== 'undefined' ? require('./leyenda.js') : PCT.htstLeyenda;   // la leyenda se dibuja dentro del esquema

  /* ---------- lectura del estado (pura) ---------- */
  const equipo = (e, tag) => (e && e.equipos && e.equipos[tag]) || {};
  const instrumento = (e, tag) => (e && e.instrumentos && e.instrumentos[tag]) || {};
  const caudalLh = e => (e && e.proceso && e.proceso.caudalLh) || 0;
  const enMarcha = (e, tag) => !!equipo(e, tag).marcha;
  const abierta = (e, tag) => { const q = equipo(e, tag); return !!(q.abierta || q.energizada || q.apertura01 > 0); };
  const posicionFdv = e => equipo(e, 'FDV-101').posicion;
  const digital = (e, tag) => instrumento(e, tag).nivel;

  /** Tubos que llevan fluido ahora (para iluminarlos y animar el flujo). */
  function estadoTubos(e) {
    const flujo = caudalLh(e) > 0;
    return {
      crudo: flujo,                                         // de TK-101 hasta la FDV
      avance: flujo && posicionFdv(e) === 'AVANCE',        // producto pasteurizado hacia la salida
      desvio: flujo && posicionFdv(e) === 'DESVIO',        // leche que no llegó a temperatura, de vuelta a TK-101
      caliente: enMarcha(e, 'P-102'),
      fria: abierta(e, 'XV-301'),
      llenado: abierta(e, 'XV-101'),                        // entrada de leche al tanque de balance
      vaciado: abierta(e, 'XV-102'),                        // vaciado del tanque de balance
      llenadoHw: abierta(e, 'XV-302'),                      // agua de red al depósito de agua caliente
      vaciadoHw: abierta(e, 'XV-303'),                      // vaciado del depósito de agua caliente
      cip: abierta(e, 'XV-401'),                            // solución de limpieza
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
  /** Lectura para el dibujo: igual que textoInstrumento, pero un lazo en fallo sale como «⚠ FALLO» (corto, para que no pise a los vecinos); la calidad exacta está en la ficha. */
  const textoInstrumentoCorto = (e, tag) => (alarmaInstrumento(e, tag) ? '⚠ FALLO' : textoInstrumento(e, tag));

  /** Estado del calentador HW-101 para dibujarlo: bancos, potencia, nivel, protección por nivel y termostato. */
  function estadoCalentador(e) {
    const hw = equipo(e, 'HW-101'), nivel = typeof hw.nivelPct === 'number' ? hw.nivelPct : (e && e.aguaCaliente && e.aguaCaliente.nivelPct) || 0;
    const banco1 = !!equipo(e, 'KM-201').cerrado, banco2 = !!equipo(e, 'KM-202').cerrado;
    const potenciaKW = (banco1 ? 1 : 0) * 30 + (banco2 ? 1 : 0) * 30;
    const sinNivel = digital(e, 'LSL-301') === 0;
    return { banco1, banco2, bancos: (banco1 ? 1 : 0) + (banco2 ? 1 : 0), potenciaKW, nivelPct: Math.max(0, Math.min(100, nivel)), sinNivel,
      tshDisparado: digital(e, 'TSH-101') === 0, textoBancos: `${(banco1 ? 1 : 0) + (banco2 ? 1 : 0)}/2 bancos · ${potenciaKW} kW`, textoNivel: `NIVEL ${Math.round(nivel)} %` };
  }

  /**
   * LEDs del armario, agrupados por función: [tag, texto, función «activo» (relleno), función «fallo» (relleno con ✕)].
   * Tres estados distinguibles también en gris: apagado = anillo vacío, activo = relleno, fallo = relleno rojo con ✕ y borde grueso.
   */
  const LEDS = [
    ['PS-001', '24 V', e => digital(e, 'PS-001') === 1, e => digital(e, 'PS-001') === 0],
    ['F-201', 'F-201', e => !equipo(e, 'F-201').fundido, e => !!equipo(e, 'F-201').fundido],
    ['ES-001', 'Seta', e => digital(e, 'ES-001') === 1, e => digital(e, 'ES-001') === 0],
    ['PSL-201', 'Aire', e => digital(e, 'PSL-201') === 1, e => digital(e, 'PSL-201') === 0],
    ['TSH-101', 'TSH', e => digital(e, 'TSH-101') === 1, e => digital(e, 'TSH-101') === 0],
    ['QF-102', 'QF-102', e => digital(e, 'QF-102') === 1, e => digital(e, 'QF-102') === 0],
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
  const GRUPOS_LEDS = [
    { titulo: 'Alimentación', tags: ['PS-001', 'F-201', 'ES-001', 'PSL-201'] },
    { titulo: 'Protecciones', tags: ['TSH-101', 'QF-102', 'VFD-101', 'P-101'] },
    { titulo: 'Contactores', tags: ['KM-102', 'KM-103', 'KM-201', 'KM-202'] },
    { titulo: 'Mando', tags: ['PB-001', 'PLC-001', 'HMI-001', 'HL-001'] },
  ];
  /** 'apagado' | 'activo' | 'fallo' para un LED del armario. */
  function estadoLed(e, tag) {
    const led = LEDS.find(l => l[0] === tag);
    if (!led) return 'apagado';
    if (led[3](e)) return 'fallo';
    return led[2](e) ? 'activo' : 'apagado';
  }

  /** Texto de estado de un equipo para el lector de pantalla (y la ficha): «en marcha», «abierta», «fallo del lazo»… */
  function estadoEquipo(e, tag) {
    const eq = equipo(e, tag), nivel = digital(e, tag);
    if (alarmaInstrumento(e, tag)) return 'fallo del lazo';
    if (tag === 'FDV-101') return posicionFdv(e) === 'AVANCE' ? 'en avance' : posicionFdv(e) === 'DESVIO' ? 'en desvío' : 'en movimiento';
    if (tag === 'TK-101') return `nivel ${Math.round((e && e.tanque && e.tanque.nivelPct) || 0)} por ciento`;
    if (tag === 'HW-101') { const h = estadoCalentador(e); return `${h.bancos} de 2 bancos conectados, ${h.textoNivel.toLowerCase()}${h.sinNivel ? ', nivel bajo: bancos bloqueados' : ''}`; }
    if (tag === 'TSH-101') return nivel === 0 ? 'disparado' : 'normal';
    if (tag === 'ES-001') return nivel === 0 ? 'pulsada' : 'normal';
    if (/^(LSL|LSH|ZS|PSL|PB|PS|QF)-/.test(tag) && nivel !== undefined) return nivel === 1 ? 'activado' : 'desactivado';
    if ('marcha' in eq) return eq.marcha ? 'en marcha' : 'parada';
    if ('cerrado' in eq) return eq.cerrado ? 'cerrado' : 'abierto';
    if ('abierta' in eq) return eq.abierta ? 'abierta' : 'cerrada';
    if ('energizada' in eq) return eq.energizada ? 'energizada' : 'sin tensión';
    if ('fundido' in eq) return eq.fundido ? 'fundido' : 'normal';
    return 'normal';
  }
  /** Etiqueta accesible de un equipo: «TT-103, 73,2 °C, normal». */
  function etiquetaAria(e, tag) {
    const partes = [tag];
    if (layout.senal(tag).some(s => s.tipo === 'AI')) partes.push(textoInstrumento(e, tag).replace('⚠ ', 'fallo '));
    const estado = estadoEquipo(e, tag);
    if (!layout.senal(tag).some(s => s.tipo === 'AI') || estado !== 'fallo del lazo') partes.push(estado.replace(/^fallo del lazo$/, 'normal'));
    return partes.join(', ');
  }

  /* ---------- esquema ---------- */
  const g = (tag, ...hijos) => ['g', { id: `g-${tag}`, 'data-tag': tag, tabindex: 0, role: 'button', 'aria-label': tag }, ...hijos];
  const txt = (x, y, t, clase = 'ht-tag', extra = {}) => ['text', Object.assign({ x, y, class: clase }, extra), t];
  const izq = { style: 'text-anchor:start' }, der = { style: 'text-anchor:end' };       // en línea: gana a la clase .ht-tag (centrada)
  const ruta = (clase, destino, d) => ['path', { class: `tubo ${clase}`.trim(), 'data-ruta': destino, d }];

  /** Burbuja de instrumento al estilo ISA: letras arriba y número abajo, valor en negrita encima. */
  const burbuja = (tag, x, y, valor = true, r = 18, lado = 'encima') => {
    const [letras, numero] = tag.split('-');
    const donde = lado === 'derecha' ? txt(x + r + 8, y + 5, '—', 'ht-valor', { id: `v-${tag}`, style: 'text-anchor:start' }) : txt(x, y - r - 8, '—', 'ht-valor', { id: `v-${tag}` });
    return g(tag, ['circle', { class: 'instr', cx: x, cy: y, r, id: `c-${tag}` }], txt(x, y - 1, letras), txt(x, y + 12, numero), ...(valor ? [donde] : []));
  };
  const bomba = (tag, x, y, fluido) => g(tag, ['circle', { class: `instr bomba ${fluido}`, cx: x, cy: y, r: 20, id: `c-${tag}` }],
    ['path', { d: `M${x - 7} ${y - 10} L${x + 10} ${y} L${x - 7} ${y + 10} Z`, class: 'bomba-flecha' }], txt(x, y + 38, tag));
  /** Válvula de dos vías: horizontal (en un tubo horizontal) o vertical. etiqueta: [líneas] encima, debajo o a la derecha. */
  const valvula = (tag, x, y, fluido, lineas, donde = 'debajo', vertical = false) => {
    const d = vertical ? `M${x - 10} ${y - 11} L${x} ${y} L${x + 10} ${y - 11} Z M${x - 10} ${y + 11} L${x} ${y} L${x + 10} ${y + 11} Z`
      : `M${x - 11} ${y - 10} L${x} ${y} L${x - 11} ${y + 10} Z M${x + 11} ${y - 10} L${x} ${y} L${x + 11} ${y + 10} Z`;
    const textos = lineas.map((t, i) => {
      if (donde === 'derecha') return txt(x + 18, y - 3 + i * 14, t, i === 0 ? 'ht-tag ht-fuerte' : 'ht-tag', izq);
      return txt(x, (donde === 'encima' ? y - 26 - (lineas.length - 1 - i) * 14 : y + 28 + i * 14), t, i === 0 ? 'ht-tag ht-fuerte' : 'ht-tag');
    });
    return g(tag, ['path', { class: `valvula ${fluido}`, d, id: `s-${tag}` }], ...textos);
  };
  const led = (tag, texto, x, y) => ['g', { id: `g-led-${tag}`, 'data-tag': tag, tabindex: 0, role: 'button', 'aria-label': tag, class: 'led' },
    ['circle', { class: 'instr', cx: x, cy: y, r: 9, id: `c-led-${tag}` }], ['path', { class: 'led-x', d: `M${x - 4} ${y - 4} L${x + 4} ${y + 4} M${x + 4} ${y - 4} L${x - 4} ${y + 4}` }], txt(x, y + 24, texto)];

  const X_ARMARIO = { caja: 1105, ancho: 110, columnas: [1135, 1190] };
  function armario() {
    const hijos = [['rect', { class: 'caja', x: X_ARMARIO.caja, y: 14, width: X_ARMARIO.ancho, height: 596, rx: 6 }],
      g('QE-001', txt(1160, 38, 'ARMARIO QE-001', 'ht-tag ht-fuerte'), txt(1160, 54, 'estado del PLC-001'))];
    let y = 92;
    for (const grupo of GRUPOS_LEDS) {
      hijos.push(txt(1115, y, grupo.titulo, 'ht-zona', izq));
      grupo.tags.forEach((tag, i) => {
        const [, texto] = LEDS.find(l => l[0] === tag);
        hijos.push(led(tag, texto, X_ARMARIO.columnas[i % 2], y + 24 + Math.floor(i / 2) * 52));
      });
      y += 140;
    }
    return hijos;
  }

  function construirEsquema() {
    const hijos = [
      // --- tuberías (leche: verde al activarse; agua caliente: naranja; agua fría: azul) ---
      ruta('', 'crudo', 'M170 240 H455 M575 240 H705 M825 240 H850 C860 240 860 218 885 218 H935 C960 218 960 240 967 240 M1003 240 H1035'),
      ruta('', 'crudo', 'M455 240 H575 M705 240 H825'),
      ruta('', 'avance', 'M1035 258 V360 H595 V290 H575 M575 290 H455 M455 290 H425 V470 H455 M455 470 H575 M575 470 H1030'),
      ruta('', 'desvio', 'M1035 222 V22 H150 V120'),
      ruta('caliente', 'caliente', 'M820 97 H842 M878 97 H900 V190 H805 V200 M735 200 V150'),
      ruta('frio', 'fria', 'M20 500 H575 M575 500 H610 V540'),
      ruta('', 'llenado', 'M20 90 H110 V120'),
      ruta('', 'vaciado', 'M130 298 V372'),
      ruta('frio', 'llenadoHw', 'M545 90 H630'),
      ruta('caliente', 'vaciadoHw', 'M630 140 H545'),
      ruta('cip', 'cip', 'M20 580 H260'),
      // --- zona 1: entrada (tanque de balance) ---
      ['rect', { class: 'caja', x: 90, y: 120, width: 80, height: 178, rx: 4 }],
      ['rect', { class: 'liquido producto', id: 'nivel-TK-101', x: 92, y: 250, width: 76, height: 46 }],
      g('TK-101', txt(130, 142, 'TK-101', 'ht-tag ht-fuerte'), txt(130, 214, '—', 'ht-valor', { id: 'v-LT-101' }),
        ['rect', { class: 'banner-alarma', id: 'banner-TK', x: 94, y: 158, width: 72, height: 18, rx: 3 }], txt(130, 171, 'REBOSA', 'ht-tag ht-banner', { id: 't-banner-TK' })),
      g('LSH-101', ['circle', { class: 'instr', cx: 195, cy: 150, r: 12, id: 'c-LSH-101' }], txt(195, 154, 'H')),
      g('LT-101', ['rect', { class: 'manual', x: 183, y: 188, width: 24, height: 24, id: 'c-LT-101' }], txt(195, 204, 'LT')),
      g('LSL-101', ['circle', { class: 'instr', cx: 195, cy: 270, r: 12, id: 'c-LSL-101' }], txt(195, 274, 'L')),
      valvula('XV-101', 60, 90, 'fl-producto', ['XV-101', 'llenado'], 'encima'),
      valvula('XV-102', 130, 335, 'fl-producto', ['XV-102', 'vaciado'], 'derecha', true),
      txt(130, 396, 'A DESAGÜE ↓'),
      // --- zona 2: filtro, bomba de alimentación, caudal y regeneración ---
      g('FLT-101', ['rect', { class: 'manual', x: 223, y: 228, width: 24, height: 24 }], ['path', { d: 'M223 252 L247 228', class: 'filtro-raya' }], txt(235, 218, 'FLT-101')),
      bomba('P-101', 300, 240, 'bomba-producto'),
      burbuja('FT-101', 355, 240), burbuja('TT-101', 430, 240),
      ['rect', { class: 'caja', x: 455, y: 200, width: 120, height: 120, rx: 4 }],
      g('HX-101', ['rect', { class: 'caja', x: 455, y: 200, width: 120, height: 120, rx: 4 }], txt(515, 216, 'REGENERACIÓN', 'ht-tag ht-fuerte'), txt(515, 230, 'HX-101'),
        ['rect', { class: 'caja', x: 705, y: 200, width: 120, height: 120, rx: 4 }], txt(765, 216, 'CALENTAMIENTO', 'ht-tag ht-fuerte'), txt(765, 230, 'HX-101'),
        ['rect', { class: 'caja', x: 455, y: 420, width: 120, height: 100, rx: 4 }], txt(515, 438, 'ENFRIAMIENTO', 'ht-tag ht-fuerte'), txt(515, 452, 'HX-101')),
      ['path', { class: 'tubo', d: 'M455 240 H575 M455 290 H575 M705 240 H825 M455 470 H575 M455 500 H575' }],
      burbuja('PT-101', 420, 156), ['path', { class: 'enlace', d: 'M438 156 H460 V200' }],
      burbuja('TT-102', 610, 240),
      burbuja('PT-102', 515, 372), ['path', { class: 'enlace', d: 'M515 320 V354' }],
      bomba('P-103', 665, 240, 'bomba-producto'),
      // --- zona 3: agua caliente (HW-101) sobre el calentamiento ---
      ['rect', { class: 'caja', x: 630, y: 44, width: 190, height: 106, rx: 4 }],
      ['rect', { class: 'liquido caliente', id: 'nivel-HW-101', x: 632, y: 100, width: 186, height: 48 }],
      g('HW-101', txt(725, 62, 'HW-101 · agua caliente', 'ht-tag ht-fuerte'), txt(725, 78, '—', 'ht-valor', { id: 'v-HW-nivel' }),
        txt(725, 94, '—', 'ht-tag', { id: 'v-HW-bancos' }),
        ['rect', { class: 'banner-alarma', id: 'banner-HW', x: 650, y: 83, width: 150, height: 16, rx: 3 }], txt(725, 95, 'NIVEL BAJO: BLOQUEADO', 'ht-tag ht-banner', { id: 't-banner-HW' }),
        ['path', { class: 'resis', id: 'res-1', d: 'M650 126 L658 106 L666 126 L674 106 L682 126 L690 106 L698 126' }], txt(675, 144, 'B1 · KM-201'),
        ['path', { class: 'resis', id: 'res-2', d: 'M750 126 L758 106 L766 126 L774 106 L782 126 L790 106 L798 126' }], txt(775, 144, 'B2 · KM-202')),
      burbuja('TSH-101', 655, 176, false), burbuja('LSL-301', 695, 176, false),
      ['path', { class: 'enlace', d: 'M655 158 V150 M695 158 V150' }],
      bomba('P-102', 860, 97, 'bomba-caliente'),
      burbuja('TT-105', 900, 150, true, 18, 'derecha'),
      valvula('XV-302', 585, 90, 'fl-agua', ['XV-302', 'llenado'], 'encima'), txt(538, 94, 'AGUA DE RED', 'ht-tag', der),
      valvula('XV-303', 585, 140, 'fl-caliente', ['XV-303', 'vaciado'], 'debajo'), txt(538, 144, 'A DESAGÜE', 'ht-tag', der),
      // --- zonas 4 y 5: tubo de residencia, FDV y su piloto ---
      g('HT-101', ['path', { class: 'tubo', d: 'M850 240 C860 240 860 218 885 218 H935 C960 218 960 240 967 240' }], txt(880, 206, 'HT-101 · residencia')),
      burbuja('TT-103', 985, 240),
      g('FDV-101', ['path', { class: 'valvula fl-producto', id: 's-FDV-101', d: 'M1024 230 L1035 240 L1024 250 Z M1046 230 L1035 240 L1046 250 Z M1026 222 L1035 240 L1044 222 Z' }],
        txt(1046, 300, 'FDV-101', 'ht-tag ht-fuerte', izq), txt(1046, 316, '—', 'ht-tag ht-fuerte', { id: 't-FDV-estado', style: 'text-anchor:start' })),
      g('SV-101', ['circle', { class: 'instr', cx: 1078, cy: 262, r: 14, id: 'c-SV-101' }], txt(1078, 261, 'SV'), txt(1078, 274, '101')),
      g('FRL-101', ['rect', { class: 'manual', x: 1062, y: 190, width: 32, height: 32 }], txt(1078, 205, 'FRL'), txt(1078, 218, '101')),
      ['path', { class: 'enlace', d: 'M1078 222 V248 M1064 262 H1046' }],
      g('ZS-101', ['circle', { class: 'instr', cx: 1005, cy: 300, r: 14, id: 'c-ZS-101' }], txt(1005, 299, 'ZS'), txt(1005, 312, '101')),
      g('ZS-102', ['circle', { class: 'instr', cx: 965, cy: 300, r: 14, id: 'c-ZS-102' }], txt(965, 299, 'ZS'), txt(965, 312, '102')),
      txt(590, 16, '← DESVÍO A TK-101', 'ht-tag ht-fuerte'),
      // --- salida, agua fría y limpieza ---
      burbuja('TT-104', 640, 470),
      txt(1090, 462, 'LECHE PASTEURIZADA →', 'ht-tag ht-fuerte', der),
      txt(20, 440, 'AGUA FRÍA Y LIMPIEZA CIP', 'ht-zona', izq), txt(20, 484, 'AGUA FRÍA →', 'ht-tag ht-fuerte', izq),
      valvula('XV-301', 230, 500, 'fl-agua', ['XV-301', 'agua fría'], 'debajo'),
      txt(610, 562, 'A DESAGÜE ↓'),
      txt(20, 564, 'SOLUCIÓN CIP →', 'ht-tag ht-fuerte', izq),
      valvula('XV-401', 140, 580, 'fl-neutro', ['XV-401', 'CIP'], 'debajo'), txt(268, 584, '→ al circuito de limpieza', 'ht-tag', izq),
      ...leyenda.leyendaSvg(660, 512),
      ...armario(),
    ];
    return ['svg', { viewBox: '0 0 1220 660', role: 'group', 'aria-label': 'Esquema de la planta real HTST de pasteurización de leche. Cada equipo se puede abrir con Intro.' }, ...hijos];
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
  const TUBERIAS = ['crudo', 'avance', 'desvio', 'caliente', 'fria', 'llenado', 'vaciado', 'llenadoHw', 'vaciadoHw', 'cip'];
  const ALTO_TK = { y0: 296, max: 164 }, ALTO_HW = { y0: 148, max: 98 };

  function crearObjetos(canvas) {
    const { Etiqueta } = compartido('etiqueta'), { Sensor } = compartido('sensor'), { Tuberia } = compartido('tuberia');
    const velocidad = e => equipo(e, 'P-101').velocidadPct || 60;
    const marcar = (id, funcion, clase = 'on') => { const el = canvas.buscar(id); return el ? { actualizar(e) { el.classList.toggle(clase, !!funcion(e)); } } : null; };
    const objetos = TUBERIAS.map(r => new Tuberia(canvas, `[data-ruta="${r}"]`, e => estadoTubos(e)[r], r === 'caliente' || r === 'fria' ? () => 60 : velocidad));
    const poner = o => { if (o) objetos.push(o); };

    for (const tag of ['P-101', 'P-102', 'P-103']) poner(marcar(`c-${tag}`, e => enMarcha(e, tag)));
    for (const tag of ['XV-101', 'XV-102', 'XV-301', 'XV-302', 'XV-303', 'XV-401']) poner(marcar(`s-${tag}`, e => abierta(e, tag)));
    poner(marcar('s-FDV-101', e => posicionFdv(e) === 'AVANCE'));
    poner(marcar('c-SV-101', e => !!equipo(e, 'SV-101').energizada));
    poner(marcar('c-ZS-101', e => digital(e, 'ZS-101') === 1)); poner(marcar('c-ZS-102', e => digital(e, 'ZS-102') === 1));
    poner(marcar('c-LSH-101', e => digital(e, 'LSH-101') === 1));
    poner(marcar('c-LSL-101', e => digital(e, 'LSL-101') === 1)); poner(marcar('c-LSL-101', e => digital(e, 'LSL-101') === 0, 'alarma'));
    poner(marcar('c-LSL-301', e => digital(e, 'LSL-301') === 1)); poner(marcar('c-LSL-301', e => digital(e, 'LSL-301') === 0, 'alarma'));
    poner(marcar('c-TSH-101', e => digital(e, 'TSH-101') === 1)); poner(marcar('c-TSH-101', e => digital(e, 'TSH-101') === 0, 'alarma'));

    // Lecturas numéricas y burbujas de los instrumentos analógicos
    objetos.push(new Etiqueta(canvas, 'v-LT-101', e => textoInstrumentoCorto(e, 'LT-101')));
    for (const s of layout.SENALES.filter(x => x.tipo === 'AI')) {
      if (s.tag !== 'LT-101') objetos.push(new Etiqueta(canvas, `v-${s.tag}`, e => textoInstrumentoCorto(e, s.tag)));
      objetos.push(new Sensor(canvas, `c-${s.tag}`, s.tag));
    }
    poner({ actualizar(e) { const t = canvas.buscar('t-FDV-estado'); if (t) t.textContent = posicionFdv(e) === 'AVANCE' ? 'AVANCE' : posicionFdv(e) === 'DESVIO' ? 'DESVÍO' : '…'; } });

    // Niveles
    const nivel = (id, tope, pct) => { const el = canvas.buscar(id); const p = Math.max(0, Math.min(100, pct)); el.setAttribute('height', String(tope.max * p / 100)); el.setAttribute('y', String(tope.y0 - tope.max * p / 100)); };
    poner({ actualizar(e) {
      nivel('nivel-TK-101', ALTO_TK, (e.tanque && e.tanque.nivelPct) || 0);
      const rebosa = !!(e.equipos && e.equipos['TK-101'] && e.equipos['TK-101'].desbordando);       // aviso de rebosadero: XV-101 abierta con el tanque lleno
      canvas.buscar('banner-TK').style.display = rebosa ? '' : 'none'; canvas.buscar('t-banner-TK').style.display = rebosa ? '' : 'none';
    } });

    // Calentador HW-101: depósito con nivel, resistencias R1/R2 y aviso de nivel bajo
    poner({ actualizar(e) {
      const h = estadoCalentador(e);
      nivel('nivel-HW-101', ALTO_HW, h.nivelPct);
      canvas.buscar('res-1').classList.toggle('on', h.banco1); canvas.buscar('res-2').classList.toggle('on', h.banco2);
      canvas.buscar('v-HW-nivel').textContent = h.textoNivel;
      const bancos = canvas.buscar('v-HW-bancos'); bancos.textContent = h.textoBancos; bancos.style.display = h.sinNivel ? 'none' : '';
      canvas.buscar('banner-HW').style.display = h.sinNivel ? '' : 'none'; canvas.buscar('t-banner-HW').style.display = h.sinNivel ? '' : 'none';
      canvas.buscar('g-HW-101').classList.toggle('bloqueado', h.sinNivel);
    } });

    // LEDs del armario: apagado (anillo vacío), activo (relleno) y fallo (relleno rojo con ✕)
    for (const [tag] of LEDS) {
      const grupo = canvas.buscar(`g-led-${tag}`), circulo = canvas.buscar(`c-led-${tag}`);
      poner({ actualizar(e) { const s = estadoLed(e, tag); circulo.classList.toggle('on', s === 'activo'); circulo.classList.toggle('alarma', s === 'fallo'); grupo.classList.toggle('fallo', s === 'fallo'); } });
    }

    // Accesibilidad: cada equipo lleva su estado en el aria-label (solo se reescribe si cambia)
    const grupos = canvas.buscarTodos('g[data-tag]').map(el => ({ el, tag: el.dataset.tag, texto: '' }));
    poner({ actualizar(e) { for (const o of grupos) { const t = etiquetaAria(e, o.tag); if (t !== o.texto) { o.texto = t; o.el.setAttribute('aria-label', t); } } } });
    return objetos;
  }

  /** Lecturas para los objetos que usan el parámetro «lecturas»: aquí, la calidad de cada lazo (true = alarma). */
  function lecturasEsquema(e) {
    const salida = {};
    for (const s of layout.SENALES.filter(x => x.tipo === 'AI')) salida[s.tag] = alarmaInstrumento(e, s.tag);
    return salida;
  }

  const api = { ESQUEMA_HTST, construirEsquema, tagsDelEsquema, LEDS, GRUPOS_LEDS, TUBERIAS, estadoTubos, estadoLed, estadoCalentador, estadoEquipo, etiquetaAria,
    textoInstrumento, textoInstrumentoCorto, alarmaInstrumento, lecturasEsquema, crearObjetos };
  if (typeof module !== 'undefined') module.exports = api; else PCT.htstEsquema = api;
})();
