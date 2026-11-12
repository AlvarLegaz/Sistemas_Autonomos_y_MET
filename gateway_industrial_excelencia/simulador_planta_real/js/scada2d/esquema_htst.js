// Esquema 2D (SCADA) de la planta real HTST de leche. Reutiliza los objetos del SCADA de simulador_pct23 (Canvas, Etiqueta, Sensor, Tuberia)
// con su propio esquema, sus tags ISA y su propia lectura del estado (contrato v1, ver ARQUITECTURA.md §4).
//
// Distribución (viewBox 1220 × 660), de izquierda a derecha en el orden del proceso, sin cruces de tubería:
//   fila superior : llenado (XV-101) · TK-101 · desvío de la FDV (por arriba) · agua caliente HW-101 sobre el calentamiento
//   fila de proceso (y = 240): TK-101 → FLT-101 → P-101 → FT-101 → TT-101 → regeneración → calentamiento → tubo de residencia → FDV-101
//   retorno pasteurizado (y = 360 → 290 → 470): de la FDV por el lado «pasteurizado» de la regeneración, el enfriamiento y la salida
//   banda inferior: agua fría (XV-301), desagües y limpieza CIP (XV-401); a la derecha, el armario con los LEDs agrupados por función.
// Niveles de dificultad: cada elemento lleva data-n="2" si no aparece en el nivel 1 (CSS: body[data-nivel="1"] [data-n="2"] { display: none }); los textos con data-t1
// cambian a su nombre sencillo en el nivel 1 (pagina.js los intercambia) y lo marcado data-solo-n1 solo se ve en el nivel 1 (tarjetas de valores y pista).
// Convención de color (pedida por el usuario): leche = verde, agua fría = azul, agua caliente = naranja, y solo en lo que está activo.
// La parte pura (qué tubos están activos, qué lectura va en cada sitio, qué LEDs, textos de accesibilidad) se exporta para probarla sin navegador.
(function () {
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.htstLayout;
  const compartido = nombre => (typeof require !== 'undefined' ? null : PCT[nombre]);   // en Node solo se usa la parte pura
  const leyenda = typeof require !== 'undefined' ? require('./leyenda.js') : PCT.htstLeyenda;   // la leyenda se dibuja dentro del esquema
  const niveles = typeof require !== 'undefined' ? require('../interfaz/niveles.js') : PCT.htstNiveles;
  /** Nivel en que está la página (data-nivel del body); sin página (Node, banco de pruebas) se comporta como el nivel 3. */
  const nivelPagina = () => (typeof document !== 'undefined' && document.body && Number(document.body.dataset.nivel)) || 3;

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
    { titulo: 'Contactores', tags: ['KM-102', 'KM-201', 'KM-202'] },
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
  /** Etiqueta accesible de un equipo: «TT-103, 73,2 °C, normal». En el nivel 1 usa el nombre sencillo: «Bomba de leche, encendida». */
  function etiquetaAria(e, tag, nivel = 3) {
    if (nivel === 1 && niveles.nombreSencillo(tag)) return `${niveles.nombreSencillo(tag)}, ${niveles.estadoVivoNivel1(tag, e)}`;
    const partes = [tag];
    if (layout.senal(tag).some(s => s.tipo === 'AI')) partes.push(textoInstrumento(e, tag).replace('⚠ ', 'fallo '));
    const estado = estadoEquipo(e, tag);
    if (!layout.senal(tag).some(s => s.tipo === 'AI') || estado !== 'fallo del lazo') partes.push(estado.replace(/^fallo del lazo$/, 'normal'));
    return partes.join(', ');
  }

  /* ---------- esquema ---------- */
  // Distribución nueva (viewBox 1600 × 800), según el boceto aprobado: leche por arriba y agua por abajo, sin cruces de tubería.
  //   fila de intercambio (cajas de y = 100 a 260): ENFRIAMIENTO · REGENERACIÓN · CALENTAMIENTO, las tres secciones del mismo HX-101, dibujadas con la
  //   geometría del widget del intercambiador (dos flujos en onda); a la derecha, el tubo de residencia en onda, TT-103 y la FDV-101.
  //   avance: de la FDV sube y vuelve por arriba (y = 40) al lado pasteurizado de la regeneración → enfriamiento → envasado (a la izquierda).
  //   desvío: de la FDV baja y vuelve por abajo (y = 620) al tanque TK-101.
  //   abajo: TK-101 (bajo la regeneración) con P-101 y FT/TT/PT-101 subiendo a la regeneración; HW-101 (bajo el calentamiento) con P-102 y sus resistencias.
  //   abajo a la izquierda: panel de mando y consignas (niveles 2 y 3); a la derecha, el armario con los LEDs agrupados por función.
  const W = typeof require !== 'undefined' ? require('./componentes/intercambiador_basico.js') : PCT.htstIntercambiadorBasico;
  const CAJA_HX = { y: 100, ancho: 220, alto: 160, pasadas: 3, temperaturas: false, nombres: false };
  const SECCIONES = {
    enfriamiento: Object.assign({ tag: 'HX-101', x: 150, sentidoA: 'derecha', circuitoA: { fluido: 'agua_fria' }, circuitoB: { fluido: 'leche' } }, CAJA_HX),
    regeneracion: Object.assign({ tag: 'HX-101', x: 560, sentidoA: 'derecha', circuitoA: { fluido: 'leche' }, circuitoB: { fluido: 'leche' } }, CAJA_HX),
    calentamiento: Object.assign({ tag: 'HX-101', x: 980, sentidoA: 'izquierda', circuitoA: { fluido: 'agua_caliente' }, circuitoB: { fluido: 'leche' } }, CAJA_HX),
  };
  const Pe = W.puertos(SECCIONES.enfriamiento), Pr = W.puertos(SECCIONES.regeneracion), Pc = W.puertos(SECCIONES.calentamiento);
  const FDV = { x: 1420, y: Pc.salidaB.y };
  const TK = { x: 600, y: 340, ancho: 100, alto: 200 }, HW = { x: 960, y: 380, ancho: 180, alto: 140 };
  const ARMARIO = { x: 1484, ancho: 112 };
  const VIEWBOX = '0 0 1600 800';
  const d = puntos => W.ruta(puntos);
  const p = (x, y) => ({ x, y });
  /** Tubo de residencia: onda de 3 vueltas entre el calentamiento y TT-103. */
  const ondaResidencia = () => Array.from({ length: 61 }, (_, i) => p(1255 + i * 1.5, FDV.y + 12 * Math.sin(2 * Math.PI * 3 * i / 60)));

  const g = (tag, ...hijos) => ['g', Object.assign({ id: `g-${tag}`, 'data-tag': tag, tabindex: 0, role: 'button', 'aria-label': tag }, niveles.nivelMinimoDeTag(tag) > 1 ? { 'data-n': 2 } : {}), ...hijos];
  /** Atributos de un texto que en el nivel 1 se cambia por su nombre sencillo (líneas separadas por «|»; x e y opcionales para recolocarlo). */
  const n1 = (texto, x, y) => { const o = { 'data-t1': texto }; if (x !== undefined) o['data-x1'] = x; if (y !== undefined) o['data-y1'] = y; return o; };
  const solo2 = { 'data-n': 2 };
  const txt = (x, y, t, clase = 'ht-tag', extra = {}) => ['text', Object.assign({ x, y, class: clase }, extra), t];
  const izq = { style: 'text-anchor:start' }, der = { style: 'text-anchor:end' };       // en línea: gana a la clase .ht-tag (centrada)
  const RUTAS_NIVEL_2 = ['llenado', 'vaciado', 'llenadoHw', 'vaciadoHw', 'cip'];       // tuberías que no se ven en el nivel 1
  const ruta = (clase, destino, dd) => ['path', Object.assign({ class: `tubo ${clase}`.trim(), 'data-ruta': destino, d: dd }, RUTAS_NIVEL_2.includes(destino) ? solo2 : {})];

  /** Instrumento ISA unido al tubo por un vástago: letras arriba y número abajo; el valor (si lo tiene) por fuera, en el lado del globo. */
  const instr = (tag, x, y, lado, conValor = true, r = 16) => {
    const s = 22 + r;
    const [cx, cy] = lado === 'arriba' ? [x, y - s] : lado === 'abajo' ? [x, y + s] : lado === 'izquierda' ? [x - s, y] : [x + s, y];
    const vastago = lado === 'arriba' ? `M${x} ${y} V${cy + r}` : lado === 'abajo' ? `M${x} ${y} V${cy - r}` : lado === 'izquierda' ? `M${x} ${y} H${cx + r}` : `M${x} ${y} H${cx - r}`;
    const [letras, numero] = tag.split('-'), id = `v-${tag}`;
    const valor = !conValor ? [] : [lado === 'arriba' ? txt(cx, cy - r - 8, '—', 'ht-valor', { id }) : lado === 'abajo' ? txt(cx, cy + r + 18, '—', 'ht-valor', { id })
      : lado === 'izquierda' ? txt(cx - r - 8, cy + 5, '—', 'ht-valor', { id, style: 'text-anchor:end' }) : txt(cx + r + 8, cy + 5, '—', 'ht-valor', { id, style: 'text-anchor:start' })];
    return g(tag, ['path', { class: 'vastago', d: vastago }], ['circle', { class: 'instr', cx, cy, r, id: `c-${tag}` }], txt(cx, cy - 1, letras), txt(cx, cy + 12, numero), ...valor);
  };
  /** Bomba: círculo con el triángulo en el sentido del flujo ('derecha' o 'izquierda'); el tag debajo. */
  const bomba = (tag, x, y, fluido, sentido, nombre1) => {
    const k = sentido === 'izquierda' ? -1 : 1;
    return g(tag, ['circle', { class: `instr bomba ${fluido}`, cx: x, cy: y, r: 20, id: `c-${tag}` }],
      ['path', { d: `M${x - 7 * k} ${y - 10} L${x + 10 * k} ${y} L${x - 7 * k} ${y + 10} Z`, class: 'bomba-flecha' }], txt(x, y + 38, tag, 'ht-tag', nombre1 ? n1(...nombre1) : {}));
  };
  /** Válvula de dos vías: horizontal (en un tubo horizontal) o vertical. etiqueta: [líneas] encima, debajo o a la derecha. */
  const valvula = (tag, x, y, fluido, lineas, donde = 'debajo', vertical = false) => {
    const dv = vertical ? `M${x - 10} ${y - 11} L${x} ${y} L${x + 10} ${y - 11} Z M${x - 10} ${y + 11} L${x} ${y} L${x + 10} ${y + 11} Z`
      : `M${x - 11} ${y - 10} L${x} ${y} L${x - 11} ${y + 10} Z M${x + 11} ${y - 10} L${x} ${y} L${x + 11} ${y + 10} Z`;
    const textos = lineas.map((t, i) => {
      if (donde === 'derecha') return txt(x + 18, y - 3 + i * 14, t, i === 0 ? 'ht-tag ht-fuerte' : 'ht-tag', izq);
      return txt(x, (donde === 'encima' ? y - 26 - (lineas.length - 1 - i) * 14 : y + 28 + i * 14), t, i === 0 ? 'ht-tag ht-fuerte' : 'ht-tag');
    });
    return g(tag, ['path', { class: `valvula ${fluido}`, d: dv, id: `s-${tag}` }], ...textos);
  };
  const led = (tag, texto, x, y) => ['g', { id: `g-led-${tag}`, 'data-tag': tag, tabindex: 0, role: 'button', 'aria-label': tag, class: 'led', 'data-n': 2 },
    ['circle', { class: 'instr', cx: x, cy: y, r: 9, id: `c-led-${tag}` }], ['path', { class: 'led-x', d: `M${x - 4} ${y - 4} L${x + 4} ${y + 4} M${x + 4} ${y - 4} L${x - 4} ${y + 4}` }], txt(x, y + 24, texto)];

  const X_ARMARIO = { caja: ARMARIO.x, ancho: ARMARIO.ancho, columnas: [ARMARIO.x + 28, ARMARIO.x + 84] };
  function armario() {
    const c = ARMARIO.x + ARMARIO.ancho / 2;
    const hijos = [['rect', { class: 'caja', x: X_ARMARIO.caja, y: 14, width: X_ARMARIO.ancho, height: 596, rx: 6, 'data-n': 2 }],
      g('QE-001', txt(c, 38, 'ARMARIO', 'ht-tag ht-fuerte'), txt(c, 54, 'QE-001 · PLC-001'))];
    let y = 92;
    for (const grupo of GRUPOS_LEDS) {
      hijos.push(txt(X_ARMARIO.caja + 10, y, grupo.titulo, 'ht-zona', Object.assign({ 'data-n': 2 }, izq)));
      grupo.tags.forEach((tag, i) => {
        const [, texto] = LEDS.find(l => l[0] === tag);
        hijos.push(led(tag, texto, X_ARMARIO.columnas[i % 2], y + 24 + Math.floor(i / 2) * 52));
      });
      y += 140;
    }
    return hijos;
  }

  /** Una sección del intercambiador: la caja y su título (dentro del grupo HX-101); los flujos en onda van aparte, como tubos animados. */
  const cajaSeccion = (c, titulo, sub, t1, s1) => [['rect', { class: 'caja', x: c.x, y: c.y, width: c.ancho, height: c.alto, rx: 6 }],
    txt(c.x + c.ancho / 2, c.y - 28, titulo, 'ht-tag ht-fuerte', n1(t1)), txt(c.x + c.ancho / 2, c.y - 12, sub, 'ht-tag', n1(s1))];
  const ondas = (c, rutaA, claseA, rutaB, claseB) => [ruta(claseA, rutaA, d(W.trazado(c, 'A'))), ruta(claseB, rutaB, d(W.trazado(c, 'B')))];

  /** Panel de mando y consignas (niveles 2 y 3): lo que no se hace pulsando un equipo. Los botones los conecta pagina.js (data-accion). */
  const PANEL = { x: 20, y: 480, ancho: 400, alto: 290 };
  const botonPanel = (accion, x, y, w, rotulo, aria) => ['g', { class: 'panel-boton', 'data-accion': accion, tabindex: 0, role: 'button', 'aria-label': aria },
    ['rect', { x, y, width: w, height: 32, rx: 6 }], txt(x + w / 2, y + 21, rotulo, 'ht-tag ht-fuerte')];
  function panelMando() {
    const X = PANEL.x + 16, fila = (id, y, titulo, sub, conBotones, que) => [
      txt(X, y, titulo, 'ht-tag ht-fuerte', Object.assign({ id: `panel-${id}-titulo` }, izq)), txt(X, y + 16, sub, 'ht-tag', Object.assign({ id: `panel-${id}-sub` }, izq)),
      txt(323, y + 1, '—', 'ht-valor', { id: `panel-${id}` }),
      ...(conBotones ? [botonPanel(`${id}-menos`, 246, y - 21, 36, '−', `Bajar ${que}`), botonPanel(`${id}-mas`, 364, y - 21, 36, '+', `Subir ${que}`)] : [])];
    return ['g', { id: 'panel-mando', 'data-n': 2, role: 'group', 'aria-label': 'Mando y consignas' },
      ['rect', { class: 'panel-fondo', x: PANEL.x, y: PANEL.y, width: PANEL.ancho, height: PANEL.alto, rx: 8 }],
      txt(X, PANEL.y + 26, 'MANDO Y CONSIGNAS', 'ht-zona', izq),
      ...fila('caudal', 540, 'Caudal de leche', 'consigna de P-101 (variador)', true, 'la consigna de caudal'),
      ...fila('tt103', 598, 'Consigna TT-103', 'por debajo, la FDV-101 desvía', true, 'la consigna de pasteurización'),
      ...fila('agua', 656, 'Agua caliente', 'consigna en cascada · TSH a 90 °C', false, ''),
      botonPanel('marcha', X, 690, 110, 'MARCHA', 'Marcha: arranca la planta (recirculación y, si cumple, producción)'),
      botonPanel('paro', X + 120, 690, 110, 'PARO', 'Paro: lleva la planta a parada'),
      botonPanel('rearme', X + 240, 690, 128, 'REARME', 'Rearme: libera la seta, pulsa PB-001 y rearma el termostato TSH-101'),
      txt(X, 750, '—', 'ht-tag ht-fuerte', Object.assign({ id: 'panel-estado' }, izq))];
  }

  function construirEsquema() {
    const S = SECCIONES, yB = Pr.entradaB.y, yA = Pr.entradaA.y;
    const hijos = [
      // --- tuberías (leche: verde al activarse; agua caliente: naranja; agua fría: azul) ---
      ruta('', 'crudo', d([p(650, TK.y + TK.alto), p(650, 570), p(490, 570), p(490, yA), Pr.entradaA])),
      ruta('', 'crudo', d([Pr.salidaA, p(900, yA), p(900, Pc.entradaB.y), Pc.entradaB])),
      ruta('', 'crudo', d([Pc.salidaB, p(1255, FDV.y), ...ondaResidencia(), p(FDV.x - 11, FDV.y)])),
      ...ondas(S.regeneracion, 'crudo', '', 'avance', ''),
      ...ondas(S.calentamiento, 'caliente', 'caliente', 'crudo', ''),
      ...ondas(S.enfriamiento, 'fria', 'frio', 'avance', ''),
      ruta('', 'avance', d([p(FDV.x + 11, FDV.y), p(1470, FDV.y), p(1470, 40), p(850, 40), p(850, Pr.entradaB.y), Pr.entradaB])),
      ruta('', 'avance', d([Pr.salidaB, Pe.entradaB])),
      ruta('', 'avance', d([Pe.salidaB, p(20, Pe.salidaB.y)])),
      ruta('', 'desvio', d([p(FDV.x, FDV.y + 11), p(FDV.x, 620), p(760, 620), p(760, 400), p(TK.x + TK.ancho, 400)])),
      ruta('caliente', 'caliente', d([p(HW.x + HW.ancho, 490), p(1290, 490), p(1290, Pc.entradaA.y), Pc.entradaA])),
      ruta('caliente', 'caliente', d([Pc.salidaA, p(930, Pc.salidaA.y), p(930, 430), p(HW.x, 430)])),
      ruta('frio', 'fria', d([p(20, Pe.entradaA.y), Pe.entradaA])),
      ruta('frio', 'fria', d([Pe.salidaA, p(420, Pe.salidaA.y), p(420, 270)])),
      ruta('', 'llenado', d([p(840, 300), p(630, 300), p(630, TK.y)])),
      ruta('', 'vaciado', d([p(680, TK.y + TK.alto), p(680, 630)])),
      ruta('frio', 'llenadoHw', d([p(1250, 350), p(1060, 350), p(1060, HW.y)])),
      ruta('caliente', 'vaciadoHw', d([p(1120, HW.y + HW.alto), p(1120, 585)])),
      ruta('cip', 'cip', d([p(440, 705), p(700, 705)])),
      // --- intercambiador de placas HX-101: tres secciones en el mismo bastidor ---
      g('HX-101', ...cajaSeccion(S.enfriamiento, 'ENFRIAMIENTO', 'HX-101 · agua fría', 'ENFRÍA', 'agua fría'),
        ...cajaSeccion(S.regeneracion, 'REGENERACIÓN', 'HX-101 · recupera calor', 'PRECALIENTA', 'recupera calor'),
        ...cajaSeccion(S.calentamiento, 'CALENTAMIENTO', 'HX-101 · agua caliente', 'CALIENTA', 'agua caliente')),
      instr('TT-106', 465, yB, 'arriba'),
      instr('TT-104', 70, Pe.salidaB.y, 'arriba'),
      txt(20, Pe.salidaB.y + 24, '← ENVASADO', 'ht-tag ht-fuerte', Object.assign(n1('← Leche lista'), izq)),
      txt(1150, 30, 'LECHE PASTEURIZADA (AVANCE)', 'ht-tag ht-fuerte', n1('Leche pasteurizada')),
      instr('PT-102', 850, 80, 'derecha'),
      instr('TT-102', 900, 180, 'izquierda'),
      // --- agua fría ---
      txt(20, Pe.entradaA.y - 12, 'AGUA FRÍA →', 'ht-tag ht-fuerte', izq),
      valvula('XV-301', 70, Pe.entradaA.y, 'fl-agua', ['XV-301', 'agua fría'], 'debajo'),
      txt(420, 288, 'A DESAGÜE ↓', 'ht-tag', solo2),
      // --- entrada: tanque de balance, filtro, bomba y medidas de la leche cruda ---
      ['rect', { class: 'caja', x: TK.x, y: TK.y, width: TK.ancho, height: TK.alto, rx: 10 }],
      ['rect', { class: 'liquido producto', id: 'nivel-TK-101', x: TK.x + 2, y: TK.y + TK.alto - 50, width: TK.ancho - 4, height: 48 }],
      g('TK-101', txt(650, TK.y + 22, 'TK-101', 'ht-tag ht-fuerte', n1('Tanque|de leche', 650, TK.y + 20)), txt(650, TK.y + 84, '—', 'ht-valor', { id: 'v-LT-101' }),
        ['rect', { class: 'banner-alarma', id: 'banner-TK', x: TK.x + 6, y: TK.y + 38, width: TK.ancho - 12, height: 18, rx: 3 }], txt(650, TK.y + 51, 'REBOSA', 'ht-tag ht-banner', { id: 't-banner-TK' })),
      instr('LSH-101', TK.x, 370, 'izquierda', false, 14),
      instr('LSL-101', TK.x, 450, 'izquierda', false, 14),
      instr('LT-101', TK.x, 515, 'izquierda', false, 14),
      valvula('XV-101', 760, 300, 'fl-producto', ['XV-101', 'llenado'], 'debajo'),
      txt(848, 304, 'RECEPCIÓN', 'ht-tag ht-fuerte', Object.assign({ 'data-n': 2 }, izq)),
      valvula('XV-102', 680, 590, 'fl-producto', ['XV-102', 'vaciado'], 'derecha', true),
      txt(680, 648, 'A DESAGÜE ↓', 'ht-tag', solo2),
      g('FLT-101', ['rect', { class: 'manual', x: 583, y: 558, width: 24, height: 24 }], ['path', { d: 'M583 582 L607 558', class: 'filtro-raya' }], txt(595, 600, 'FLT-101')),
      bomba('P-101', 545, 570, 'bomba-producto', 'izquierda', ['Bomba de leche', 545, 608]),
      instr('PT-101', 490, 320, 'izquierda'),
      instr('TT-101', 490, 380, 'izquierda'),
      instr('FT-101', 490, 440, 'izquierda'),
      // --- agua caliente: depósito HW-101 con dos bancos de resistencias, bajo el calentamiento ---
      ['rect', { class: 'caja', x: HW.x, y: HW.y, width: HW.ancho, height: HW.alto, rx: 10 }],
      ['rect', { class: 'liquido caliente', id: 'nivel-HW-101', x: HW.x + 2, y: HW.y + HW.alto - 50, width: HW.ancho - 4, height: 48 }],
      g('HW-101', txt(1050, HW.y + HW.alto + 20, 'HW-101 · agua caliente', 'ht-tag ht-fuerte', n1('Calentador de agua')), txt(1050, HW.y + 24, '—', 'ht-valor', { id: 'v-HW-nivel' }),
        txt(1050, HW.y + 42, '—', 'ht-tag', { id: 'v-HW-bancos' }),
        ['rect', { class: 'banner-alarma', id: 'banner-HW', x: HW.x + 15, y: HW.y + 30, width: 150, height: 16, rx: 3 }], txt(1050, HW.y + 42, 'NIVEL BAJO: BLOQUEADO', 'ht-tag ht-banner', { id: 't-banner-HW' }),
        ['path', { class: 'resis', id: 'res-1', d: 'M981 108 L989 88 L997 108 L1005 88 L1013 108 L1021 88 L1029 108'.replace(/(\d+) (\d+)/g, (m, x, y) => `${x} ${Number(y) + 370}`) }], txt(1005, 500, 'B1 · KM-201', 'ht-tag', n1('Resistencia 1')),
        ['path', { class: 'resis', id: 'res-2', d: 'M1071 108 L1079 88 L1087 108 L1095 88 L1103 108 L1111 88 L1119 108'.replace(/(\d+) (\d+)/g, (m, x, y) => `${x} ${Number(y) + 370}`) }], txt(1095, 500, 'B2 · KM-202', 'ht-tag', n1('Resistencia 2'))),
      instr('TSH-101', HW.x, 480, 'izquierda', false, 14),
      instr('LSH-301', HW.x + HW.ancho, 400, 'derecha', false, 14),
      instr('LSL-301', HW.x + HW.ancho, 455, 'derecha', false, 14),
      bomba('P-102', 1215, 490, 'bomba-caliente', 'derecha', ['Bomba de agua|caliente', 1215, 528]),
      instr('TT-105', 1290, 320, 'derecha'),
      valvula('XV-302', 1110, 350, 'fl-agua', ['XV-302', 'llenado'], 'encima'), txt(1250, 336, 'AGUA DE RED', 'ht-tag', Object.assign({ 'data-n': 2 }, der)),
      valvula('XV-303', 1120, 555, 'fl-caliente', ['XV-303', 'vaciado'], 'derecha', true),
      txt(1120, 603, 'A DESAGÜE ↓', 'ht-tag', solo2),
      // --- tubo de residencia, TT-103, FDV con su piloto, aire y finales de carrera ---
      g('HT-101', ['path', { class: 'hit', d: d([p(1255, FDV.y), ...ondaResidencia()]) }], txt(1290, 162, 'HT-101 · residencia', 'ht-tag', n1('Tubo de residencia'))),
      instr('TT-103', 1372, FDV.y, 'abajo'),
      g('FDV-101', ['path', { class: 'valvula fl-producto', id: 's-FDV-101', d: `M${FDV.x - 11} ${FDV.y - 10} L${FDV.x} ${FDV.y} L${FDV.x - 11} ${FDV.y + 10} Z M${FDV.x + 11} ${FDV.y - 10} L${FDV.x} ${FDV.y} L${FDV.x + 11} ${FDV.y + 10} Z M${FDV.x - 9} ${FDV.y + 18} L${FDV.x} ${FDV.y} L${FDV.x + 9} ${FDV.y + 18} Z` }],
        txt(1408, 248, 'FDV-101', 'ht-tag ht-fuerte', Object.assign(n1('Válvula de desvío'), der)), txt(1408, 264, '—', 'ht-tag ht-fuerte', { id: 't-FDV-estado', style: 'text-anchor:end' })),
      g('SV-101', ['circle', { class: 'instr', cx: FDV.x, cy: 70, r: 14, id: 'c-SV-101' }], txt(FDV.x, 69, 'SV'), txt(FDV.x, 82, '101')),
      g('FRL-101', ['rect', { class: 'manual', x: 1352, y: 54, width: 32, height: 32 }], txt(1368, 69, 'FRL'), txt(1368, 82, '101')),
      ['path', { class: 'enlace', 'data-n': 2, d: `M${FDV.x} 84 V${FDV.y - 10} M1384 70 H${FDV.x - 14}` }],
      g('ZS-101', ['circle', { class: 'instr', cx: 1450, cy: 172, r: 14, id: 'c-ZS-101' }], txt(1450, 171, 'ZS'), txt(1450, 184, '101')),
      g('ZS-102', ['circle', { class: 'instr', cx: 1450, cy: 222, r: 14, id: 'c-ZS-102' }], txt(1450, 221, 'ZS'), txt(1450, 234, '102')),
      txt(1300, 612, 'DESVÍO: vuelve a TK-101', 'ht-tag ht-fuerte', n1('Desvío: la leche vuelve al tanque')),
      // --- limpieza CIP ---
      txt(440, 690, 'SOLUCIÓN CIP →', 'ht-tag ht-fuerte', Object.assign({ 'data-n': 2 }, izq)),
      valvula('XV-401', 560, 705, 'fl-neutro', ['XV-401', 'CIP'], 'debajo'), txt(708, 709, '→ al circuito de limpieza', 'ht-tag', Object.assign({ 'data-n': 2 }, izq)),
      ['g', solo2, ...leyenda.leyendaSvg(960, 652)],
      panelMando(),
      // --- solo en el nivel 1: tres tarjetas de valores en palabras y una pista de lo que se verá en el nivel 2 ---
      ['g', { id: 'n1-tarjetas', 'data-solo-n1': 1, 'aria-live': 'off' },
        ...[['n1-temp', 348], ['n1-caudal', 394], ['n1-nivel', 440]].map(([id, y]) => ['g', { id: `${id}-g` },
          txt(20, y, '—', 'ht-valor', { id: `${id}-linea`, style: 'text-anchor:start' }), txt(20, y + 16, '—', 'ht-tag', { id: `${id}-estado`, style: 'text-anchor:start' })]),
        txt(800, 680, 'Hay más equipos: sensores, válvulas de llenado, limpieza y armario eléctrico.', 'ht-tag', izq),
        txt(800, 696, 'Se irán viendo al subir al nivel 2.', 'ht-tag', izq)],
      ...armario(),
    ];
    return ['svg', { viewBox: VIEWBOX, role: 'group', 'aria-label': 'Esquema de la planta real HTST de pasteurización de leche. Cada equipo se puede abrir con Intro.' }, ...hijos];
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
  const ALTO_TK = { y0: TK.y + TK.alto - 2, max: TK.alto - 4 }, ALTO_HW = { y0: HW.y + HW.alto - 2, max: HW.alto - 4 };

  function crearObjetos(canvas, { consignas = () => null } = {}) {
    const { Etiqueta } = compartido('etiqueta'), { Sensor } = compartido('sensor'), { Tuberia } = compartido('tuberia');
    const velocidad = e => equipo(e, 'P-101').velocidadPct || 60;
    const marcar = (id, funcion, clase = 'on') => { const el = canvas.buscar(id); return el ? { actualizar(e) { el.classList.toggle(clase, !!funcion(e)); } } : null; };
    const objetos = TUBERIAS.map(r => new Tuberia(canvas, `[data-ruta="${r}"]`, e => estadoTubos(e)[r], r === 'caliente' || r === 'fria' ? () => 60 : velocidad));
    const poner = o => { if (o) objetos.push(o); };

    for (const tag of ['P-101', 'P-102']) poner(marcar(`c-${tag}`, e => enMarcha(e, tag)));
    for (const tag of ['XV-101', 'XV-102', 'XV-301', 'XV-302', 'XV-303', 'XV-401']) poner(marcar(`s-${tag}`, e => abierta(e, tag)));
    poner(marcar('s-FDV-101', e => posicionFdv(e) === 'AVANCE'));
    poner(marcar('c-SV-101', e => !!equipo(e, 'SV-101').energizada));
    poner(marcar('c-ZS-101', e => digital(e, 'ZS-101') === 1)); poner(marcar('c-ZS-102', e => digital(e, 'ZS-102') === 1));
    poner(marcar('c-LSH-101', e => digital(e, 'LSH-101') === 1));
    poner(marcar('c-LSL-101', e => digital(e, 'LSL-101') === 1)); poner(marcar('c-LSL-101', e => digital(e, 'LSL-101') === 0, 'alarma'));
    poner(marcar('c-LSL-301', e => digital(e, 'LSL-301') === 1)); poner(marcar('c-LSL-301', e => digital(e, 'LSL-301') === 0, 'alarma'));
    poner(marcar('c-LSH-301', e => digital(e, 'LSH-301') === 1));
    poner(marcar('c-TSH-101', e => digital(e, 'TSH-101') === 1)); poner(marcar('c-TSH-101', e => digital(e, 'TSH-101') === 0, 'alarma'));

    // Lecturas numéricas y burbujas de los instrumentos analógicos
    objetos.push(new Etiqueta(canvas, 'v-LT-101', e => textoInstrumentoCorto(e, 'LT-101')));
    for (const s of layout.SENALES.filter(x => x.tipo === 'AI')) {
      if (s.tag !== 'LT-101') objetos.push(new Etiqueta(canvas, `v-${s.tag}`, e => textoInstrumentoCorto(e, s.tag)));
      objetos.push(new Sensor(canvas, `c-${s.tag}`, s.tag));
    }
    poner({ actualizar(e) {
      const t = canvas.buscar('t-FDV-estado'); if (!t) return;
      const avance = posicionFdv(e) === 'AVANCE', desvio = posicionFdv(e) === 'DESVIO';
      t.textContent = nivelPagina() === 1 ? niveles.textoFdvNivel1(e) : (avance ? 'AVANCE' : desvio ? 'DESVÍO' : '…');
    } });
    // Nivel 1: tarjetas de valores en palabras (temperatura al salir del tubo, caudal y nivel del tanque), con símbolo y texto de «normal / atención»
    poner({ actualizar(e) {
      if (nivelPagina() !== 1) return;
      for (const c of niveles.tarjetasNivel1(e)) {
        const l = canvas.buscar(`${c.id}-linea`), s = canvas.buscar(`${c.id}-estado`); if (!l || !s) continue;
        const linea = `${c.titulo} ${c.valor}`, estado = `${c.simbolo} ${c.estado}`;
        if (l.textContent !== linea) l.textContent = linea; if (s.textContent !== estado) s.textContent = estado;
        s.classList.toggle('n1-ok', c.clase === 'ok'); s.classList.toggle('n1-atencion', c.clase === 'atencion');
      }
    } });

    // Panel de mando: consignas (de la página), consigna del agua (cascada del PLC), estado y botones activos
    poner({ actualizar(e) {
      const poner = (id, texto) => { const el = canvas.buscar(id); if (el && el.textContent !== texto) el.textContent = texto; };
      const c = consignas() || {}, manual = e.modo === 'MANUAL', vfd = (e.salidasPLC && e.salidasPLC.AO && e.salidasPLC.AO['VFD-101']) || 0;
      poner('panel-caudal-titulo', manual ? 'Velocidad de P-101' : 'Caudal de leche');
      poner('panel-caudal-sub', manual ? 'orden manual al variador VFD-101' : `consigna de P-101 · FT-101: ${textoInstrumento(e, 'FT-101')}`);
      poner('panel-caudal', manual ? `${Math.round(vfd)} %` : (typeof c.caudalLh === 'number' ? `${Math.round(c.caudalLh)} L/h` : '—'));
      poner('panel-tt103', typeof c.tt103C === 'number' ? `${decimal(c.tt103C)} °C` : '—');
      poner('panel-agua', e.plc && typeof e.plc.consignaAguaC === 'number' ? `${decimal(e.plc.consignaAguaC)} °C` : '—');
      poner('panel-agua-sub', `TT-105: ${textoInstrumento(e, 'TT-105')} · TSH a 90 °C`);
      const paro = e.plc && e.plc.paro, info = layout.MODOS_INFO[e.modo];
      poner('panel-estado', paro ? `PARO: ${(e.plc.motivosParo || []).join(', ') || 'pulsa REARME'}` : `${info ? info.nombre : e.modo} · FDV ${posicionFdv(e) === 'AVANCE' ? 'en avance' : 'en desvío'}`);
      const bot = a => canvas.svg.querySelector(`.panel-boton[data-accion="${a}"]`);
      if (bot('marcha')) bot('marcha').classList.toggle('activo', e.modo !== 'PARADA' && !paro);
      if (bot('paro')) bot('paro').classList.toggle('activo', e.modo === 'PARADA' && !paro);
      if (bot('rearme')) bot('rearme').classList.toggle('alarma', !!paro || digital(e, 'TSH-101') === 0);
      for (const a of ['tt103-menos', 'tt103-mas']) if (bot(a)) bot(a).classList.toggle('inactivo', manual);
    } });

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
      canvas.buscar('v-HW-nivel').textContent = nivelPagina() === 1 ? `Nivel ${Math.round(h.nivelPct)} %` : h.textoNivel;
      const bancos = canvas.buscar('v-HW-bancos'); bancos.textContent = nivelPagina() === 1 ? `${h.bancos} de 2 resistencias` : h.textoBancos; bancos.style.display = h.sinNivel ? 'none' : '';
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
    poner({ actualizar(e) { const nivel = nivelPagina(); for (const o of grupos) { const t = etiquetaAria(e, o.tag, nivel); if (t !== o.texto) { o.texto = t; o.el.setAttribute('aria-label', t); } } } });
    return objetos;
  }

  /** Lecturas para los objetos que usan el parámetro «lecturas»: aquí, la calidad de cada lazo (true = alarma). */
  function lecturasEsquema(e) {
    const salida = {};
    for (const s of layout.SENALES.filter(x => x.tipo === 'AI')) salida[s.tag] = alarmaInstrumento(e, s.tag);
    return salida;
  }

  const api = { ESQUEMA_HTST, VIEWBOX, SECCIONES, construirEsquema, tagsDelEsquema, LEDS, GRUPOS_LEDS, TUBERIAS, estadoTubos, estadoLed, estadoCalentador, estadoEquipo, etiquetaAria,
    textoInstrumento, textoInstrumentoCorto, alarmaInstrumento, lecturasEsquema, crearObjetos };
  if (typeof module !== 'undefined') module.exports = api; else PCT.htstEsquema = api;
})();
