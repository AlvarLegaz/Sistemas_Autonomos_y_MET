// Galería de componentes 2D (página componentes.html): el intercambiador de placas solo, sus variantes y cómo se unen los tres bloques de la planta.
// Es una página didáctica y de desarrollo: no forma parte del esquema de la planta. Usa solo lo compartido (Canvas, Tuberia) y el widget.
// Convención del widget: circuito A = producto (franja de abajo), circuito B = servicio (franja de arriba), a contracorriente.
(function () {
  const W = PCT.htstIntercambiadorBasico;
  const { Canvas } = PCT.canvas;
  const $ = id => document.getElementById(id);

  const LECHE_FRIA = { fluido: 'leche', etiqueta: 'Leche cruda' }, LECHE_CALIENTE = { fluido: 'leche', etiqueta: 'Leche pasteur.' };
  const LECHE = { fluido: 'leche', etiqueta: 'Leche' };
  const AGUA_CALIENTE = { fluido: 'agua_caliente', etiqueta: 'Agua caliente' }, AGUA_FRIA = { fluido: 'agua_fria', etiqueta: 'Agua fría' };
  const circulando = (extra = {}) => Object.assign({ circulaA: true, circulaB: true, velocidadA: 60, velocidadB: 60 }, extra);

  /** Dibuja un widget en un <figure> y devuelve { figura, widget }. */
  function figura(destino, cfg, lectura, texto) {
    const L = W.limites(cfg), fig = document.createElement('figure'), pie = document.createElement('figcaption');
    const canvas = new Canvas(['svg', { viewBox: `${L.x} ${L.y} ${L.ancho} ${L.alto}`, role: 'group', 'aria-label': `Ejemplo: ${texto}` }, W.especificacion(cfg, lectura)]);
    pie.textContent = texto;
    fig.append(canvas.svg, pie); destino.appendChild(fig);
    const widget = W.enlazar(canvas, cfg);
    widget.actualizar(lectura);
    return { figura: fig, widget, canvas };
  }

  /* ---------- variantes ---------- */
  const VARIANTES = [
    { texto: 'Calentamiento: el agua caliente (arriba) calienta la leche (abajo) a contracorriente.', cfg: { tag: 'EJ-1', titulo: 'Calentamiento', circuitoA: LECHE, circuitoB: AGUA_CALIENTE },
      lectura: circulando({ tEntradaA: 65, tSalidaA: 73, tEntradaB: 80, tSalidaB: 72 }) },
    { texto: 'Regeneración: la leche pasteurizada que vuelve (arriba) precalienta la leche cruda (abajo). Mismo widget, dos circuitos de leche.', cfg: { tag: 'EJ-2', titulo: 'Regeneración', circuitoA: LECHE_FRIA, circuitoB: LECHE_CALIENTE },
      lectura: circulando({ tEntradaA: 4, tSalidaA: 65, tEntradaB: 73, tSalidaB: 12 }) },
    { texto: 'Enfriamiento: el agua fría (abajo) termina de enfriar la leche pasteurizada (arriba).', cfg: { tag: 'EJ-3', titulo: 'Enfriamiento', circuitoA: AGUA_FRIA, circuitoB: LECHE_CALIENTE },
      lectura: circulando({ tEntradaA: 1, tSalidaA: 8, tEntradaB: 12, tSalidaB: 4 }) },
    { texto: 'En paralelo (los dos en el mismo sentido): las salidas se acercan a una temperatura intermedia y la leche se calienta menos. Por eso se usa contracorriente.', cfg: { tag: 'EJ-4', titulo: 'En paralelo', flujo: 'paralelo', circuitoA: LECHE, circuitoB: AGUA_CALIENTE },
      lectura: circulando({ tEntradaA: 65, tSalidaA: 70, tEntradaB: 80, tSalidaB: 74 }) },
    { texto: 'Con 2 vueltas: menos recorrido, menos superficie de intercambio.', cfg: { tag: 'EJ-5', titulo: '2 vueltas', pasadas: 2, circuitoA: LECHE, circuitoB: AGUA_CALIENTE },
      lectura: circulando({ tEntradaA: 65, tSalidaA: 70, tEntradaB: 80, tSalidaB: 75 }) },
    { texto: 'Con 5 vueltas: más recorrido, más superficie. Si no caben con el grosor del tubo, el widget pone las que caben.', cfg: { tag: 'EJ-6', titulo: '5 vueltas', pasadas: 5, ancho: 360, circuitoA: LECHE, circuitoB: AGUA_CALIENTE },
      lectura: circulando({ tEntradaA: 65, tSalidaA: 76, tEntradaB: 80, tSalidaB: 68 }) },
    { texto: 'Parado: los flujos se apagan y no se mueven.', cfg: { tag: 'EJ-7', titulo: 'Parado', circuitoA: LECHE, circuitoB: AGUA_CALIENTE },
      lectura: { tEntradaA: 20, tSalidaA: 20, tEntradaB: 22, tSalidaB: 22 } },
    { texto: 'Ensuciado (60 %): trazo fino y entrecortado, y aviso. Pasa menos caudal y el intercambio empeora.', cfg: { tag: 'EJ-8', titulo: 'Ensuciado', circuitoA: LECHE, circuitoB: AGUA_CALIENTE },
      lectura: circulando({ obstruccion: 0.6, velocidadA: 25, tEntradaA: 65, tSalidaA: 67, tEntradaB: 80, tSalidaB: 78 }) },
    { texto: 'Fuga entre circuitos: marca roja entre los dos; la leche y el agua se mezclan.', cfg: { tag: 'EJ-9', titulo: 'Fuga', circuitoA: LECHE, circuitoB: AGUA_CALIENTE },
      lectura: circulando({ fuga: true, tEntradaA: 65, tSalidaA: 71, tEntradaB: 80, tSalidaB: 72 }) },
  ];

  /* ---------- widget en vivo con controles ---------- */
  function vivo() {
    const cfg = { tag: 'HX-VIVO', titulo: 'Intercambiador', ancho: 320, alto: 240, circuitoA: LECHE, circuitoB: AGUA_CALIENTE };
    const { widget, canvas } = figura($('vivo-figura'), cfg, circulando({ tEntradaA: 4, tSalidaA: 65, tEntradaB: 80, tSalidaB: 70 }), 'Pulsa o usa el teclado (Tab, Intro) sobre el intercambiador para ver su ficha.');
    const campos = { caudal: 60, obstruccion: 60 };
    let estado = 'normal';
    function aplicar() {
      const circula = campos.caudal > 0;
      widget.actualizar({ circulaA: circula, circulaB: circula, velocidadA: campos.caudal, velocidadB: campos.caudal,
        obstruccion: estado === 'ensuciado' ? campos.obstruccion / 100 : 0, fuga: estado === 'fuga' });
      for (const k of Object.keys(campos)) { const o = $('o-' + k); if (o) o.textContent = `${campos[k]} %`; }
    }
    for (const k of Object.keys(campos)) $('c-' + k).addEventListener('input', e => { campos[k] = Number(e.target.value); aplicar(); });
    $('c-estado').addEventListener('change', e => { estado = e.target.value; $('fila-obstruccion').hidden = estado !== 'ensuciado'; aplicar(); });
    aplicar();
    // Ficha: igual que en la planta, un equipo se abre con clic o con Intro / Espacio.
    const ficha = $('ficha');
    const abrir = g => { ficha.textContent = g.getAttribute('aria-label'); };
    canvas.svg.addEventListener('click', e => { const g = e.target.closest && e.target.closest('g[data-tag]'); if (g) abrir(g); });
    canvas.svg.addEventListener('keydown', e => { if (e.key !== 'Enter' && e.key !== ' ') return; const g = e.target.closest && e.target.closest('g[data-tag]'); if (g) { e.preventDefault(); abrir(g); } });
  }

  /* ---------- los tres bloques de la planta, unidos como en la realidad ---------- */
  // Recorrido de la leche: cruda → REGENERACIÓN (abajo) → CALENTAMIENTO (abajo) → tubo de retención → vuelve a REGENERACIÓN (arriba)
  // → ENFRIAMIENTO (arriba) → sale pasteurizada. Por eso el enfriamiento va a la izquierda de la regeneración.
  function tresBloques() {
    const comun = { y: 70, ancho: 230, alto: 190 };
    const enf = Object.assign({ tag: 'HX-ENF', titulo: 'Enfriamiento', x: 0, circuitoA: AGUA_FRIA, circuitoB: LECHE_CALIENTE }, comun);
    const reg = Object.assign({ tag: 'HX-REG', titulo: 'Regeneración', x: 520, circuitoA: LECHE_FRIA, circuitoB: LECHE_CALIENTE }, comun);
    const cal = Object.assign({ tag: 'HX-CAL', titulo: 'Calentamiento', x: 1040, circuitoA: LECHE, circuitoB: AGUA_CALIENTE }, comun);
    const bloques = [enf, reg, cal];
    const lecturas = [circulando({ tEntradaA: 1, tSalidaA: 8, tEntradaB: 12, tSalidaB: 4 }), circulando({ tEntradaA: 4, tSalidaA: 65, tEntradaB: 73, tSalidaB: 12 }),
      circulando({ tEntradaA: 65, tSalidaA: 73, tEntradaB: 80, tSalidaB: 72 })];
    const conectores = [...W.conectoresEntreBloques(enf, reg), ...W.conectoresEntreBloques(reg, cal)].map((c, i) => ({ id: `union-${i}`, d: c.d, fluido: 'leche' }));
    // tubo de retención: de la salida de la leche del calentamiento, por encima de todo, a la entrada de arriba de la regeneración
    const Pc = W.puertos(cal), Pr = W.puertos(reg), yArriba = comun.y - 64;
    const retencion = [Pc.salidaA, { x: Pc.salidaA.x + 100, y: Pc.salidaA.y }, { x: Pc.salidaA.x + 100, y: yArriba }, { x: Pr.entradaB.x + 110, y: yArriba }, { x: Pr.entradaB.x + 110, y: Pr.entradaB.y }, Pr.entradaB];
    conectores.push({ id: 'retencion', fluido: 'leche', d: W.ruta(retencion) });
    const L = bloques.map(W.limites), x0 = Math.min(...L.map(c => c.x)) - 30, x1 = Math.max(...L.map(c => c.x + c.ancho)) + 20, y0 = yArriba - 30, y1 = Math.max(...L.map(c => c.y + c.alto));
    const Pe = W.puertos(enf);
    const texto = (x, y, t, anclaje = 'middle') => ['text', { class: 'ic-fluido-texto', x, y, 'text-anchor': anclaje }, t];
    const esquema = ['svg', { viewBox: `${x0} ${y0} ${x1 - x0} ${y1 - y0}`, role: 'group', 'aria-label': 'Los tres bloques del pasteurizador unidos como en la planta' },
      ...conectores.map(c => ['path', { class: 'ic-circuito activo', 'data-circuito': c.id, 'data-fluido': c.fluido, d: c.d }]),
      ...bloques.map(b => W.especificacion(b)),
      texto((Pc.salidaA.x + Pr.entradaB.x) / 2 + 50, yArriba - 12, 'Tubo de retención'),
      texto(Pe.salidaB.x - 6, Pe.salidaB.y + 17, 'Leche pasteurizada', 'end')];
    const canvas = new Canvas(esquema), destino = $('tres-bloques');
    destino.appendChild(canvas.svg);
    bloques.forEach((b, i) => W.enlazar(canvas, b).actualizar(lecturas[i]));
    for (const c of conectores) new PCT.tuberia.Tuberia(canvas, `[data-circuito="${c.id}"]`, () => true, () => 60).actualizar({});
  }

  /* ---------- boceto del SCADA: pasteurizador completo, leche por arriba y agua por abajo ---------- */
  // Fila de intercambiadores: ENFRIAMIENTO · REGENERACIÓN · CALENTAMIENTO, y a la derecha el tubo de retención y la válvula de desvío (FDV).
  // Recorrido de la leche: TK-101 → P-101 → regeneración (abajo, se precalienta) → calentamiento (arriba) → retención → FDV:
  //   - temperatura correcta (AVANCE): vuelve a la regeneración por arriba (cede su calor a la leche cruda) → enfriamiento → envasado;
  //   - temperatura baja (DESVÍO): vuelve al depósito TK-101 por abajo de todo.
  // Agua por abajo: la caliente con su depósito HW-201 y su bomba P-201 bajo el calentamiento; la fría viene de la red y va a desagüe.
  // Depósitos: TK-101 con nivel continuo LT-101 (da el nivel exacto) y HW-201 con interruptores de nivel alto (LSH-201) y bajo (LSL-201).
  // Cada depósito tiene su electroválvula de llenado (XV-101, XV-201) y otra de purga para limpieza (XV-102, XV-202), en un circuito aparte.
  // Agua fría de red con su electroválvula XV-401: si no abre, la leche sale caliente (TT-104 sube).
  // HW-201 se calienta con la resistencia R-301; el termopar TE-301 corta la resistencia si el agua pasa de 95 °C, y LSL-201 si falta agua.
  // En el widget la franja de arriba es el circuito B y la de abajo el A.
  function bocetoPlanta() {
    const caja = { y: 170, ancho: 240, alto: 180, nombres: false };
    const LECHE_P = { fluido: 'leche', etiqueta: 'Leche pasteurizada' }, LECHE_C = { fluido: 'leche', etiqueta: 'Leche cruda' };
    const enf = Object.assign({ tag: 'HX-103', titulo: 'HX-103 · Enfriamiento', x: 230, sentidoA: 'derecha', circuitoA: AGUA_FRIA, circuitoB: LECHE_P }, caja);
    const reg = Object.assign({ tag: 'HX-101', titulo: 'HX-101 · Regeneración', x: 650, sentidoA: 'derecha', circuitoA: LECHE_C, circuitoB: LECHE_P }, caja);
    const cal = Object.assign({ tag: 'HX-102', titulo: 'HX-102 · Calentamiento', x: 1070, sentidoA: 'izquierda', circuitoA: AGUA_CALIENTE, circuitoB: LECHE_C }, caja);
    const Pe = W.puertos(enf), Pr = W.puertos(reg), Pc = W.puertos(cal);
    const leche = { tag: 'TK-101', nombre: 'Depósito de leche', fluido: 'leche', x: 700, y: 460, ancho: 130, alto: 180, etiquetaX: 790, numero: true };
    const caliente = { tag: 'HW-201', nombre: 'Agua caliente', fluido: 'agua_caliente', x: 1130, y: 470, ancho: 120, alto: 120, etiquetaX: 1165, numero: false, resistencia: true };
    const fondo = d => d.y + d.alto, centro = d => d.x + d.ancho / 2, derecha = d => d.x + d.ancho;
    const V = { x: 1660, y: Pc.salidaB.y, r: 22 };                    // válvula de desvío FDV-101 (3 vías): entra por la izquierda, avance a la derecha, desvío abajo
    const tubos = [
      { id: 'b-red', fluido: 'agua_fria', valvula: 'XV-401', puntos: [{ x: 70, y: Pe.entradaA.y }, Pe.entradaA] },
      { id: 'b-desague', fluido: 'agua_fria', valvula: 'XV-401', puntos: [Pe.salidaA, { x: 530, y: Pe.salidaA.y }, { x: 530, y: 470 }] },
      { id: 'b-cruda-1', fluido: 'leche', activo: () => estado.marcha, puntos: [{ x: leche.x, y: fondo(leche) - 30 }, { x: 590, y: fondo(leche) - 30 }, { x: 590, y: Pr.entradaA.y }, Pr.entradaA] },
      { id: 'b-cruda-2', fluido: 'leche', activo: () => estado.marcha, puntos: [Pr.salidaA, { x: 972, y: Pr.salidaA.y }, { x: 972, y: Pc.entradaB.y }, Pc.entradaB] },
      // tubo de retención: una onda (sinusoide de 3 vueltas) entre el calentamiento y la sonda TT-103
      { id: 'b-retencion', fluido: 'leche', activo: () => estado.marcha, puntos: [Pc.salidaB, ...Array.from({ length: 121 }, (_, i) => ({ x: 1380 + i * 200 / 120, y: V.y + 20 * Math.sin(2 * Math.PI * 3 * i / 120) })), { x: V.x - V.r, y: V.y }] },
      { id: 'b-avance', fluido: 'leche', activo: () => avance(), puntos: [{ x: V.x + V.r, y: V.y }, { x: 1730, y: V.y }, { x: 1730, y: 110 }, { x: 950, y: 110 }, { x: 950, y: Pr.entradaB.y }, Pr.entradaB] },
      { id: 'b-desvio', fluido: 'leche', activo: () => estado.marcha && !avance(), puntos: [{ x: V.x, y: V.y + V.r }, { x: V.x, y: 690 }, { x: 870, y: 690 }, { x: 870, y: 490 }, { x: derecha(leche), y: 490 }] },
      { id: 'b-paso', fluido: 'leche', activo: () => avance(), puntos: [Pr.salidaB, Pe.entradaB] },
      { id: 'b-envasado', fluido: 'leche', activo: () => avance(), puntos: [Pe.salidaB, { x: 70, y: Pe.salidaB.y }] },
      { id: 'b-caliente-ida', fluido: 'agua_caliente', activo: () => estado.marcha, puntos: [{ x: derecha(caliente), y: fondo(caliente) - 30 }, { x: 1372, y: fondo(caliente) - 30 }, { x: 1372, y: Pc.entradaA.y }, Pc.entradaA] },
      { id: 'b-caliente-vuelta', fluido: 'agua_caliente', activo: () => estado.marcha, puntos: [Pc.salidaA, { x: 1012, y: Pc.salidaA.y }, { x: 1012, y: caliente.y + 60 }, { x: caliente.x, y: caliente.y + 60 }] },
      // llenado y purga (limpieza): circuitos aparte, solo con la electroválvula abierta
      { id: 'b-llenado-leche', fluido: 'leche', valvula: 'XV-101', puntos: [{ x: 960, y: 420 }, { x: 800, y: 420 }, { x: 800, y: leche.y }] },
      { id: 'b-purga-leche', fluido: 'leche', valvula: 'XV-102', flechaEn: 0.88, puntos: [{ x: 720, y: fondo(leche) }, { x: 720, y: 740 }] },
      { id: 'b-llenado-agua', fluido: 'agua_caliente', valvula: 'XV-201', puntos: [{ x: 1030, y: 420 }, { x: 1190, y: 420 }, { x: 1190, y: caliente.y }] },
      { id: 'b-purga-agua', fluido: 'agua_caliente', valvula: 'XV-202', flechaEn: 0.88, puntos: [{ x: 1232, y: fondo(caliente) }, { x: 1232, y: 648 }] },
    ];
    const deposito = d => {
      const g = ['g', { class: 'boceto-deposito', 'data-tag': d.tag },
        ['rect', { class: 'boceto-cuerpo', x: d.x, y: d.y, width: d.ancho, height: d.alto, rx: 16 }],
        ['rect', { id: `nivel-${d.tag}`, class: 'boceto-nivel', 'data-fluido': d.fluido, x: d.x + 4, y: fondo(d) - 4, width: d.ancho - 8, height: 0, rx: 10 }],
        ['text', { class: 'boceto-tag', x: d.etiquetaX, y: fondo(d) + 24, 'text-anchor': 'middle' }, d.tag],
        ['text', { class: 'ic-fluido', x: d.etiquetaX, y: fondo(d) + 42, 'text-anchor': 'middle' }, d.nombre]];
      if (d.resistencia) {
        const y = fondo(d) - 22, x0 = d.x + 22, x1 = derecha(d) - 22, n = 6, paso = (x1 - x0) / n;
        const zz = Array.from({ length: n + 1 }, (_, i) => `${i ? 'L' : 'M'}${x0 + i * paso} ${i % 2 ? y - 8 : y + 8}`).join(' ');
        g.push(['g', { id: 'r-R-301', class: 'boceto-resistencia', 'data-tag': 'R-301', tabindex: 0, role: 'button', 'aria-label': 'R-301, resistencia de calentamiento (contactor KM-201)' },
          ['path', { d: `M${d.x} ${y} L${x0} ${y} ` + zz.replace('M', 'L') }], ['text', { class: 'boceto-tag', x: centro(d), y: y - 14, 'text-anchor': 'middle' }, 'R-301']]);
      }
      if (d.numero) g.push(['text', { id: `nivel-texto-${d.tag}`, class: 'boceto-nivel-texto', x: centro(d), y: d.y + 40, 'text-anchor': 'middle' }, '']);
      return g;
    };
    const flecha = (t) => {              // punta en el último tramo de cada tubo (en medio o donde diga flechaEn), en el sentido del flujo
      const n = t.puntos.length, p = t.puntos[n - 2], q = t.puntos[n - 1], f = t.flechaEn || 0.5;
      const dx = Math.sign(q.x - p.x), dy = Math.sign(q.y - p.y), x = p.x + (q.x - p.x) * f, y = p.y + (q.y - p.y) * f;
      const pts = dx ? [[x + dx * 7, y], [x - dx * 6, y - 7], [x - dx * 6, y + 7]] : [[x, y + dy * 7], [x - 7, y - dy * 6], [x + 7, y - dy * 6]];
      return ['polygon', { class: 'ic-flecha', 'data-fluido': t.fluido, 'data-tubo': t.id, points: pts.map(r => r.join(',')).join(' ') }];
    };
    const texto = (x, y, t, anclaje = 'middle', clase = 'ic-fluido-texto') => ['text', { class: clase, x, y, 'text-anchor': anclaje }, t];
    const valvulaDesvio = ['g', { class: 'boceto-valvula', 'data-tag': 'FDV-101', tabindex: 0, role: 'button', 'aria-label': 'FDV-101, válvula de desvío de 3 vías con solenoide. En avance.' },
      ['polygon', { points: `${V.x - V.r},${V.y - 12} ${V.x - V.r},${V.y + 12} ${V.x},${V.y}` }],
      ['polygon', { points: `${V.x + V.r},${V.y - 12} ${V.x + V.r},${V.y + 12} ${V.x},${V.y}` }],
      ['polygon', { points: `${V.x - 12},${V.y + V.r} ${V.x + 12},${V.y + V.r} ${V.x},${V.y}` }],
      ['line', { x1: V.x, y1: V.y, x2: V.x, y2: V.y - 26 }],
      ['rect', { class: 'boceto-solenoide', x: V.x - 13, y: V.y - 46, width: 26, height: 20, rx: 3 }],
      ['text', { class: 'boceto-solenoide-texto', x: V.x, y: V.y - 31, 'text-anchor': 'middle' }, 'S']];
    // electroválvula de 2 vías (todo o nada) con su solenoide, sobre un tramo horizontal ('h') o vertical ('v'); lado = dónde va el solenoide
    const valvula = (tag, nombre, x, y, eje, lado, etiqueta) => {
      const r = 12, tri = eje === 'h'
        ? [`${x - r},${y - 9} ${x - r},${y + 9} ${x},${y}`, `${x + r},${y - 9} ${x + r},${y + 9} ${x},${y}`]
        : [`${x - 9},${y - r} ${x + 9},${y - r} ${x},${y}`, `${x - 9},${y + r} ${x + 9},${y + r} ${x},${y}`];
      const sx = lado === 'derecha' ? x + 26 : lado === 'izquierda' ? x - 26 : x, sy = lado === 'arriba' ? y - 26 : y;
      const caja = lado === 'arriba' ? { x: x - 13, y: y - 46 } : lado === 'derecha' ? { x: x + 26, y: y - 10 } : { x: x - 52, y: y - 10 };
      return ['g', { id: `v-${tag}`, class: 'boceto-xv', 'data-tag': tag, tabindex: 0, role: 'button', 'aria-label': `${tag}, ${nombre}` },
        ['polygon', { points: tri[0] }], ['polygon', { points: tri[1] }],
        ['line', { x1: x, y1: y, x2: sx, y2: sy }],
        ['rect', { class: 'boceto-solenoide', x: caja.x, y: caja.y, width: 26, height: 20, rx: 3 }],
        ['text', { class: 'boceto-solenoide-texto', x: caja.x + 13, y: caja.y + 15, 'text-anchor': 'middle' }, 'S'],
        ['text', { class: 'boceto-tag', x: etiqueta.x, y: etiqueta.y, 'text-anchor': etiqueta.anclaje || 'middle' }, tag]];
    };
    // instrumento (TT, FT, LT, LSH…): globo unido al tubo o al depósito por un vástago, arriba, a la derecha o a la izquierda del punto
    const sonda = (tag, x, y, lado) => {
      const cx = lado === 'derecha' ? x + 36 : lado === 'izquierda' ? x - 36 : x, cy = lado === 'arriba' ? y - 36 : y;
      const vastago = lado === 'arriba' ? [cx, cy + 14, x, y - 3] : lado === 'derecha' ? [cx - 14, cy, x + 3, y] : [cx + 14, cy, x, y];
      const etq = lado === 'arriba' ? ['text', { class: 'boceto-tag', x: cx, y: cy - 22, 'text-anchor': 'middle' }, tag]
        : ['text', { class: 'boceto-tag', x: lado === 'derecha' ? cx + 20 : cx - 20, y: cy + 5, 'text-anchor': lado === 'derecha' ? 'start' : 'end' }, tag];
      return ['g', { id: `s-${tag}`, class: 'boceto-sonda', 'data-tag': tag }, ['line', { x1: vastago[0], y1: vastago[1], x2: vastago[2], y2: vastago[3] }], ['circle', { cx, cy, r: 14 }],
        ['text', { x: cx, y: cy + 4, 'text-anchor': 'middle' }, tag.split('-')[0]], etq];
    };
    // bomba: círculo con un triángulo que apunta en el sentido del flujo, sobre un tramo horizontal
    const bomba = (tag, nombre, x, y, sentido) => {
      const s = sentido === 'izquierda' ? -1 : 1, r = 16;
      return ['g', { class: 'boceto-bomba', 'data-tag': tag, tabindex: 0, role: 'button', 'aria-label': `${tag}, ${nombre}` },
        ['circle', { cx: x, cy: y, r }],
        ['polygon', { points: `${x + s * 11},${y} ${x - s * 7},${y - 10} ${x - s * 7},${y + 10}` }],
        ['text', { class: 'boceto-tag', x, y: y + r + 18, 'text-anchor': 'middle' }, tag]];
    };
    const equipos = [
      bomba('P-101', 'bomba de leche (variador VFD-101)', 645, fondo(leche) - 30, 'izquierda'),
      bomba('P-201', 'bomba de agua caliente (contactor KM-203)', 1311, fondo(caliente) - 30, 'derecha'),
      sonda('TT-101', 590, 420, 'derecha'),                         // leche cruda antes de la regeneración
      sonda('FT-101', 590, 495, 'derecha'),                         // caudal de leche, a la salida de la bomba
      sonda('TT-106', 560, Pr.salidaB.y, 'arriba'),                 // leche pasteurizada antes del enfriamiento
      sonda('TT-104', 140, Pe.salidaB.y, 'arriba'),                 // leche a la salida del enfriamiento
      sonda('TT-103', 1608, V.y, 'arriba'),                         // salida del tubo de retención (decide la FDV)
      sonda('LT-101', 735, leche.y, 'arriba'),                      // nivel continuo del depósito de leche
      sonda('LSH-201', caliente.x, caliente.y + 15, 'izquierda'),   // nivel alto del agua caliente
      sonda('LSL-201', caliente.x, fondo(caliente) - 15, 'izquierda'), // nivel bajo del agua caliente
      valvula('XV-101', 'llenado del depósito de leche', 840, 420, 'h', 'arriba', { x: 840, y: 446 }),
      valvula('XV-102', 'purga del depósito de leche (limpieza)', 720, 690, 'v', 'izquierda', { x: 662, y: 695, anclaje: 'end' }),
      valvula('XV-201', 'llenado del depósito de agua caliente', 1150, 420, 'h', 'arriba', { x: 1150, y: 446 }),
      valvula('XV-202', 'purga del depósito de agua caliente (limpieza)', 1232, 616, 'v', 'derecha', { x: 1290, y: 621, anclaje: 'start' }),
      valvula('XV-401', 'agua fría de enfriamiento', 160, Pe.entradaA.y, 'h', 'arriba', { x: 178, y: Pe.entradaA.y - 31, anclaje: 'start' }),
      sonda('TE-301', derecha(caliente), caliente.y + 30, 'derecha'),     // termopar: corta la resistencia si el agua se pasa de temperatura
    ];
    // panel de mando (hueco de abajo a la izquierda): lo que no se hace pulsando un símbolo — consignas y marcha/paro/rearme
    const boton = (id, x, y, w, rotulo, aria) => ['g', { id: `boton-${id}`, class: 'boceto-boton', 'data-accion': id, tabindex: 0, role: 'button', 'aria-label': aria || rotulo },
      ['rect', { x, y, width: w, height: 30, rx: 6 }], ['text', { x: x + w / 2, y: y + 20, 'text-anchor': 'middle' }, rotulo]];
    const fila = (id, y, titulo, sub, que) => [
      ['text', { class: 'boceto-panel-etiqueta', x: 80, y }, titulo],
      ['text', { id: `sub-${id}`, class: 'boceto-panel-sub', x: 80, y: y + 20 }, sub],
      boton(`${id}-menos`, 330, y - 20, 34, '−', `Bajar ${que}`),
      ['text', { id: `consigna-${id}`, class: 'boceto-valor', x: 405, y: y + 1, 'text-anchor': 'middle' }, ''],
      boton(`${id}-mas`, 440, y - 20, 34, '+', `Subir ${que}`)];
    const panel = ['g', { class: 'boceto-panel', role: 'group', 'aria-label': 'Panel de mando: consignas, marcha, paro y rearme' },
      ['rect', { class: 'boceto-panel-fondo', x: 60, y: 398, width: 430, height: 362, rx: 10 }],
      ['text', { class: 'boceto-panel-titulo', x: 80, y: 430 }, 'Mando y consignas'],
      ...fila('vel', 470, 'P-101 · velocidad (VFD-101)', '', 'la velocidad de P-101'),
      ...fila('past', 540, 'Pasteurización (TT-103)', 'Por debajo, FDV-101 desvía', 'la consigna de pasteurización'),
      ...fila('agua', 610, 'Agua caliente (R-301)', 'TE-301 corta a 95 °C', 'la consigna del agua caliente'),
      boton('marcha', 80, 650, 110, 'MARCHA', 'Marcha: arranca P-101 y P-201'),
      boton('paro', 200, 650, 110, 'PARO', 'Paro: para P-101 y P-201'),
      boton('rearme', 320, 650, 154, 'REARME', 'Rearme de la protección TE-301'),
      ['text', { id: 'panel-estado', class: 'boceto-panel-etiqueta', x: 80, y: 712 }, ''],
      ['text', { id: 'panel-estado-2', class: 'boceto-panel-sub', x: 80, y: 736 }, '']];
    const esquema = ['svg', { viewBox: '40 60 1790 715', role: 'group', 'aria-label': 'Boceto del pasteurizador: depósitos, enfriamiento, regeneración, calentamiento, tubo de retención y válvula de desvío' },
      ...tubos.map(t => ['path', { class: 'ic-circuito', 'data-circuito': t.id, 'data-fluido': t.fluido, d: W.ruta(t.puntos) }]),
      ...tubos.map(flecha),
      deposito(leche), deposito(caliente),W.especificacion(enf), W.especificacion(reg), W.especificacion(cal), valvulaDesvio, ...equipos,
      texto(70, Pe.entradaA.y - 10, 'Agua de red', 'start'),
      texto(70, Pe.salidaB.y + 22, 'A envasado', 'start'),
      texto(530, 490, 'Desagüe'),
      texto(1480, Pc.salidaB.y + 50, 'Tubo de retención'),
      texto(1738, 150, 'Avance', 'start'),
      texto(V.x + 8, 400, 'Desvío', 'start'),
      texto(1260, 102, 'Leche pasteurizada (avance)', 'middle', 'ic-fluido'),
      texto(1180, 682, 'Desvío: vuelve al depósito', 'middle', 'ic-fluido'),
      texto(955, 410, 'Recepción', 'end'),
      texto(1030, 440, 'Agua de red', 'start'),
      texto(720, 760, 'Purga (limpieza)'),
      texto(1244, 600, 'Purga', 'start'),
      ['text', { id: 'valor-TT-104', class: 'boceto-valor', x: 160, y: Pe.salidaB.y - 31, 'text-anchor': 'start' }, ''],
      ['text', { id: 'valor-TE-301', class: 'boceto-valor', x: derecha(caliente) + 56, y: caliente.y + 53, 'text-anchor': 'start' }, ''],
      ['text', { id: 'valor-TT-103', class: 'boceto-valor', x: 1588, y: V.y - 32, 'text-anchor': 'end' }, ''],
      panel];
    const canvas = new Canvas(esquema);
    $('boceto-planta').appendChild(canvas.svg);
    const wEnf = W.enlazar(canvas, enf), wReg = W.enlazar(canvas, reg), wCal = W.enlazar(canvas, cal);

    // estado del boceto: niveles (%) y electroválvulas; el nivel sube con el llenado abierto y baja con la purga abierta
    const estado = { niveles: { 'TK-101': 60, 'HW-201': 70 }, abiertas: { 'XV-401': true }, resistencia: true, corte: '', tAgua: 80, tSalida: 4,
      marcha: true, velocidad: 60, consignaPast: 72, consignaAgua: 80, termostato: true, tLeche: 75 };
    const T_CORTE = 95, T_REARME = 90;        // TE-301: corta la resistencia por encima de 95 °C; se rearma a mano (REARME) cuando baja de 90 °C
    const avance = () => estado.marcha && estado.tLeche >= estado.consignaPast;   // FDV-101: avance si TT-103 llega a la consigna
    const coma = (v, d = 0) => v.toFixed(d).replace('.', ',');
    const ALTO = 85, BAJO = 15, VELOCIDAD = { llenado: 4, purga: 6 };   // % por segundo
    const lineas = tubos.map(t => ({ t, tub: new PCT.tuberia.Tuberia(canvas, `[data-circuito="${t.id}"]`, () => (t.valvula ? !!estado.abiertas[t.valvula] : t.activo ? t.activo() : true), () => (t.fluido === 'leche' ? estado.velocidad : 60)) }));
    function pintar() {
      for (const { t, tub } of lineas) {
        tub.actualizar({});
        const p = canvas.svg.querySelector(`[data-tubo="${t.id}"]`);
        if (p && t.valvula) p.classList.toggle('apagada', !estado.abiertas[t.valvula]);
        if (p && t.activo) p.classList.toggle('apagada', !t.activo());
      }
      for (const d of [leche, caliente]) {
        const n = estado.niveles[d.tag], alto = (d.alto - 8) * n / 100, r = canvas.svg.querySelector(`#nivel-${d.tag}`);
        r.setAttribute('y', fondo(d) - 4 - alto); r.setAttribute('height', alto);
        const tx = canvas.svg.querySelector(`#nivel-texto-${d.tag}`);
        if (tx) tx.textContent = `LT-101: ${Math.round(n)} %`;
      }
      const nHW = estado.niveles['HW-201'];
      const v = estado.velocidad, m = estado.marcha, av = avance();
      wEnf.actualizar(circulando({ circulaA: !!estado.abiertas['XV-401'], circulaB: av, velocidadB: v }));
      wReg.actualizar(circulando({ circulaA: m, circulaB: av, velocidadA: v, velocidadB: v }));
      wCal.actualizar(circulando({ circulaA: m, circulaB: m, velocidadB: v }));
      const calienta = estado.resistencia && !estado.corte && estado.termostato;
      const q = (sel) => canvas.svg.querySelector(sel);
      q('#consigna-vel').textContent = `${v} %`;
      q('#sub-vel').textContent = `FT-101: ${m ? (v * 30).toLocaleString('es-ES') : 0} L/h`;
      q('#consigna-past').textContent = `${coma(estado.consignaPast, 1)} °C`;
      q('#consigna-agua').textContent = `${estado.consignaAgua} °C`;
      q('#valor-TT-103').textContent = `${coma(estado.tLeche, 1)} °C`;
      q('#valor-TT-103').classList.toggle('alarma', m && !av);
      q('#boton-marcha').classList.toggle('activo', m);
      q('#boton-paro').classList.toggle('activo', !m);
      q('#boton-rearme').classList.toggle('alarma', estado.corte === 'temperatura');
      q('#panel-estado').textContent = !m ? 'Planta PARADA' : av ? 'En marcha · AVANCE a envasado' : 'En marcha · DESVÍO al depósito';
      q('#panel-estado-2').textContent = estado.corte === 'temperatura' ? (estado.tAgua < T_REARME ? 'TE-301 disparado: pulsa REARME' : 'TE-301 disparado: espera a < 90 °C')
        : !estado.resistencia ? 'R-301 apagada' : estado.corte === 'nivel' ? 'R-301 cortada por LSL-201' : calienta ? 'R-301 calentando' : 'R-301 en reposo (consigna alcanzada)';
      canvas.svg.querySelector('#r-R-301').classList.toggle('on', calienta);
      canvas.svg.querySelector('#s-TE-301').classList.toggle('activa', estado.corte === 'temperatura');
      canvas.svg.querySelector('#valor-TT-104').textContent = `${estado.tSalida.toFixed(1).replace('.', ',')} °C`;
      canvas.svg.querySelector('#valor-TE-301').textContent = `${estado.tAgua.toFixed(0)} °C`;
      canvas.svg.querySelector('#valor-TT-104').classList.toggle('alarma', estado.tSalida > 7);
      canvas.svg.querySelector('#valor-TE-301').classList.toggle('alarma', estado.tAgua >= T_CORTE);
      const bR = document.querySelector('[data-resistencia]');
      if (bR) bR.setAttribute('aria-pressed', estado.resistencia ? 'true' : 'false');
      canvas.svg.querySelector('#s-LSH-201').classList.toggle('activa', nHW >= ALTO);
      canvas.svg.querySelector('#s-LSL-201').classList.toggle('activa', nHW <= BAJO);
      for (const tag of ['XV-101', 'XV-102', 'XV-201', 'XV-202', 'XV-401']) {
        canvas.svg.querySelector(`#v-${tag}`).classList.toggle('abierta', !!estado.abiertas[tag]);
        const b = document.querySelector(`[data-valvula="${tag}"]`);
        if (b) b.setAttribute('aria-pressed', estado.abiertas[tag] ? 'true' : 'false');
      }
      const lectura = $('boceto-lectura');
      if (lectura) lectura.textContent = `TK-101 (LT-101): ${Math.round(estado.niveles['TK-101'])} %  ·  HW-201: ${nHW >= ALTO ? 'nivel ALTO (LSH-201)' : nHW <= BAJO ? 'nivel BAJO (LSL-201)' : 'entre bajo y alto'}`
        + `  ·  Resistencia R-301: ${calienta ? 'calentando' : estado.corte === 'temperatura' ? 'CORTADA por TE-301 (más de 95 °C)' : estado.corte === 'nivel' ? 'CORTADA por LSL-201 (falta agua)' : estado.resistencia ? 'en reposo' : 'apagada'}`
        + `  ·  Agua caliente (TE-301): ${coma(estado.tAgua)} °C  ·  TT-103: ${coma(estado.tLeche, 1)} °C`
        + `  ·  Leche a envasado (TT-104): ${estado.tSalida.toFixed(1).replace('.', ',')} °C${estado.abiertas['XV-401'] ? '' : ' (XV-401 cerrada: no enfría)'}`;
    }
    const bResistencia = document.querySelector('[data-resistencia]');
    if (bResistencia) bResistencia.addEventListener('click', () => { estado.resistencia = !estado.resistencia; pintar(); });
    const acciones = {
      'vel-menos': () => { estado.velocidad = Math.max(20, estado.velocidad - 10); },
      'vel-mas': () => { estado.velocidad = Math.min(100, estado.velocidad + 10); },
      'past-menos': () => { estado.consignaPast = Math.max(65, estado.consignaPast - 0.5); },
      'past-mas': () => { estado.consignaPast = Math.min(80, estado.consignaPast + 0.5); },
      'agua-menos': () => { estado.consignaAgua = Math.max(60, estado.consignaAgua - 1); },
      'agua-mas': () => { estado.consignaAgua = Math.min(99, estado.consignaAgua + 1); },   // hasta 99 °C: así se puede ver disparar TE-301
      marcha: () => { estado.marcha = true; },
      paro: () => { estado.marcha = false; },
      rearme: () => { if (estado.corte === 'temperatura' && estado.tAgua < T_REARME) estado.corte = ''; },
    };
    canvas.svg.querySelectorAll('.boceto-boton').forEach(b => {
      const hacer = () => { acciones[b.dataset.accion](); pintar(); };
      b.addEventListener('click', hacer);
      b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hacer(); } });
    });
    document.querySelectorAll('[data-valvula]').forEach(b => b.addEventListener('click', () => { const tag = b.dataset.valvula; estado.abiertas[tag] = !estado.abiertas[tag]; pintar(); }));
    let antes = performance.now();
    setInterval(() => {
      const ahora = performance.now(), dt = (ahora - antes) / 1000; antes = ahora;
      const mover = (tag, llenado, purga) => {
        const v = estado.niveles[tag] + ((estado.abiertas[llenado] ? VELOCIDAD.llenado : 0) - (estado.abiertas[purga] ? VELOCIDAD.purga : 0)) * dt;
        estado.niveles[tag] = Math.max(0, Math.min(100, v));
      };
      mover('TK-101', 'XV-101', 'XV-102'); mover('HW-201', 'XV-201', 'XV-202');
      // protecciones de la resistencia: termopar TE-301 (temperatura) y LSL-201 (nivel); la de temperatura se rearma al bajar de 90 °C
      if (estado.tAgua >= T_CORTE) estado.corte = 'temperatura';                    // el disparo de TE-301 queda enclavado hasta REARME
      if (estado.niveles['HW-201'] <= BAJO) estado.corte = estado.corte || 'nivel'; else if (estado.corte === 'nivel') estado.corte = '';
      // termostato de la consigna de agua caliente, con 2 °C de histéresis
      if (estado.tAgua >= estado.consignaAgua) estado.termostato = false; else if (estado.tAgua <= estado.consignaAgua - 2) estado.termostato = true;
      const calienta = estado.resistencia && !estado.corte && estado.termostato;
      estado.tAgua += ((calienta ? 2.5 : 0) - 0.02 * (estado.tAgua - 20)) * dt;     // °C/s: la resistencia calienta y el agua pierde calor hacia la leche
      // TT-103: con la planta en marcha la leche llega a unos grados menos que el agua; cuanto más rápida va P-101, menos tiempo se calienta
      const tObjetivo = estado.marcha ? estado.tAgua - 2 - estado.velocidad / 20 : 20;
      estado.tLeche += (tObjetivo - estado.tLeche) * Math.min(1, (estado.marcha ? 0.3 : 0.03) * dt);
      if (avance()) {
        const objetivo = estado.abiertas['XV-401'] ? 4 : 22;                        // sin agua fría la leche sale casi como deja la regeneración
        estado.tSalida += (objetivo - estado.tSalida) * Math.min(1, 0.25 * dt);
      }
      pintar();
    }, 200);
    pintar();
    return { tubos, intercambiadores: [enf, reg, cal], estado, pintar };
  }

  document.addEventListener('DOMContentLoaded', () => {
    vivo();
    const rejilla = $('variantes');
    for (const v of VARIANTES) figura(rejilla, v.cfg, v.lectura, v.texto);
    tresBloques();
    PCT.bocetoPlanta = bocetoPlanta();
  });
})();
