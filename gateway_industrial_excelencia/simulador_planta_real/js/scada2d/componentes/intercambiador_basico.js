// Widget 2D «Intercambiador» (esquemático): una caja lisa con DOS flujos que la cruzan en forma de onda (sinusoidal),
// el de servicio arriba (p. ej. agua caliente) y el de producto abajo (p. ej. leche), sin tocarse ni mezclarse. Cada circuito entra
// por un lado y sale por el otro; en las entradas se escribe el nombre del fluido. Las temperaturas de las tomas solo se
// dibujan con `temperaturas: true` (cuando la planta tenga esas sondas).
// Es la base didáctica: más adelante se instanciarán tres bloques (calentamiento, regeneración y enfriamiento) y se unirán por sus puertos.
//
// Geometría:
//   - El circuito A (producto) va por la mitad de abajo y el B (servicio) por la de arriba: al ir cada uno en su franja no pueden cruzarse.
//   - Cada circuito es una onda (coseno) con `pasadas` vueltas; si no caben con el grosor del tubo, se reducen.
//   - Por defecto van a CONTRACORRIENTE (A de izquierda a derecha y B de derecha a izquierda), que es como trabaja un intercambiador de placas
//     de una pasteurizadora. `flujo: 'paralelo'` los pone en el mismo sentido y `sentidoA: 'izquierda'` da la vuelta a todo (para componer bloques).
//
// Uso (navegador):
//   const L = PCT.htstIntercambiadorBasico.limites(config);
//   const canvas = new PCT.canvas.Canvas(['svg', { viewBox: `${L.x} ${L.y} ${L.ancho} ${L.alto}` }, PCT.htstIntercambiadorBasico.especificacion(config)]);
//   const widget = PCT.htstIntercambiadorBasico.enlazar(canvas, config);      // reutiliza Tuberia para el flujo animado
//   widget.actualizar({ circulaA: true, circulaB: true, tEntradaA: 4, tSalidaA: 65, ... });
// La parte pura (geometría, puertos, estados, textos) no necesita navegador y se prueba con node:test.
(function () {
  const limitar = (v, a, b) => Math.max(a, Math.min(b, v));
  const decimal = (v, c = 1) => v.toFixed(c).replace('.', ',');
  const redondear = v => Math.round(v * 10) / 10;

  const FLUIDOS = {
    leche: { nombre: 'Leche', variable: '--producto', clase: 'leche' },
    agua_caliente: { nombre: 'Agua caliente', variable: '--caliente', clase: 'agua_caliente' },
    agua_fria: { nombre: 'Agua fría', variable: '--agua', clase: 'agua_fria' },
  };
  const ESTADOS = ['parado', 'circulando', 'ensuciado', 'fuga', 'fallo'];
  const UMBRAL_ENSUCIADO = 0.3;     // obstruccion (0 a 1) a partir de la cual se avisa y el tubo se marca como sucio
  const TUBO_EXTERIOR_PX = 34;      // largo del tubo que sale de la caja hasta el puerto
  const LATERAL_TEXTOS_PX = 104;    // aire a cada lado para la temperatura y el nombre del fluido
  const ARRIBA_PX = 34;             // aire por encima de la caja para el título
  const AVISOS_PX = 66;             // aire por debajo para los avisos
  const PERIODO_MINIMO_PX = 44;     // ancho mínimo de cada vuelta de la onda

  const POR_DEFECTO = { tag: 'IC-001', titulo: '', x: 0, y: 0, ancho: 300, alto: 230, pasadas: 3, flujo: 'contracorriente', sentidoA: 'derecha', temperaturas: false, nombres: true,
    circuitoA: { fluido: 'leche', etiqueta: '' }, circuitoB: { fluido: 'agua_caliente', etiqueta: '' } };

  /** Configuración completa y válida a partir de la que escribe el que usa el widget. */
  function normalizar(cfg = {}) {
    const c = Object.assign({}, POR_DEFECTO, cfg);
    c.ancho = Math.max(200, Number(c.ancho) || POR_DEFECTO.ancho);
    c.alto = Math.max(170, Number(c.alto) || POR_DEFECTO.alto);
    c.x = Number(c.x) || 0; c.y = Number(c.y) || 0;
    c.pasadas = limitar(Math.round(Number(c.pasadas) || POR_DEFECTO.pasadas), 1, 8);
    c.flujo = c.flujo === 'paralelo' ? 'paralelo' : 'contracorriente';
    c.sentidoA = c.sentidoA === 'izquierda' ? 'izquierda' : 'derecha';
    c.temperaturas = c.temperaturas === true;
    c.nombres = c.nombres !== false;      // nombre del fluido junto a cada entrada (se quita si el esquema ya lo dice)
    const fluido = f => (FLUIDOS[f] ? f : 'leche');
    c.circuitoA = Object.assign({}, POR_DEFECTO.circuitoA, cfg.circuitoA);
    c.circuitoB = Object.assign({}, POR_DEFECTO.circuitoB, cfg.circuitoB);
    c.circuitoA.fluido = fluido(c.circuitoA.fluido); c.circuitoB.fluido = fluido(c.circuitoB.fluido);
    return c;
  }

  /* ---------- geometría ---------- */

  /** Medidas del dibujo: marco, grosor del tubo, franjas de los dos circuitos y número de vueltas que caben. */
  function geometria(c) {
    const { x, y, ancho: w, alto: h } = c;
    const marco = 10;                                          // margen interior de la caja
    const tubo = 6;                                            // grosor del trazo de cada flujo
    const hueco = tubo + 14;                                   // separación entre las dos franjas (ahí se marca la fuga)
    const ymed = y + h / 2;
    const yB = y + marco + 8 + tubo / 2;                       // altura de los puertos del circuito de arriba (B)
    const yA = y + h - marco - 8 - tubo / 2;                   // y la del de abajo (A)
    const amplitud = Math.max(0, ymed - hueco / 2 - tubo / 2 - yB);
    const xs = x + marco + 8 + tubo, xe = x + w - marco - 8 - tubo;
    let n = c.pasadas;
    while (n > 1 && (xe - xs) / n < Math.max(2.6 * tubo, PERIODO_MINIMO_PX)) n--;   // cada vuelta necesita sitio para que se lea como onda
    return { marco, tubo, hueco, ymed, yA, yB, amplitud, xs, xe, pasadas: n, izquierda: x, derecha: x + w };
  }

  /** y de la onda en el punto u (0 a 1) de la franja: la de arriba baja y vuelve; la de abajo sube y vuelve. */
  function ondaY(G, circuito, u) {
    const v = G.amplitud * (1 - Math.cos(2 * Math.PI * G.pasadas * u)) / 2;
    return circuito === 'A' ? G.yA - v : G.yB + v;
  }

  /** Sentido de cada circuito: 'derecha' (entra por la izquierda) o 'izquierda'. */
  function sentidos(c) {
    const A = c.sentidoA, otro = A === 'derecha' ? 'izquierda' : 'derecha';
    return { A, B: c.flujo === 'contracorriente' ? otro : A };
  }

  /** Recorrido de un circuito de izquierda a derecha: puerto, borde de la caja, onda, borde, puerto. */
  function recorridoIzquierdaDerecha(c, G, circuito) {
    const yp = circuito === 'A' ? G.yA : G.yB, muestras = Math.max(24, G.pasadas * 24), onda = [];
    for (let i = 0; i <= muestras; i++) { const u = i / muestras; onda.push({ x: G.xs + u * (G.xe - G.xs), y: ondaY(G, circuito, u) }); }
    return [{ x: G.izquierda - TUBO_EXTERIOR_PX, y: yp }, { x: G.izquierda, y: yp }, ...onda, { x: G.derecha, y: yp }, { x: G.derecha + TUBO_EXTERIOR_PX, y: yp }];
  }

  /** Puntos del circuito 'A' o 'B' en el sentido del flujo (de su puerto de entrada a su puerto de salida). */
  function trazado(cfg, circuito) {
    const c = normalizar(cfg), G = geometria(c);
    const p = recorridoIzquierdaDerecha(c, G, circuito);
    return sentidos(c)[circuito] === 'derecha' ? p : p.reverse();
  }

  /** Texto `d` de un path SVG a partir de los puntos. */
  const ruta = puntos => puntos.map((p, i) => `${i ? 'L' : 'M'}${redondear(p.x)} ${redondear(p.y)}`).join(' ');

  /** Los cuatro puertos (extremo del tubo exterior), en coordenadas del dibujo: { entradaA, salidaA, entradaB, salidaB }, cada uno con x, y y lado. */
  function puertos(cfg) {
    const c = normalizar(cfg), G = geometria(c);
    const lado = p => (p.x < (G.izquierda + G.derecha) / 2 ? 'izquierda' : 'derecha');
    const de = circuito => { const t = trazado(c, circuito), a = t[0], b = t[t.length - 1]; return [{ x: a.x, y: a.y, lado: lado(a) }, { x: b.x, y: b.y, lado: lado(b) }]; };
    const [entradaA, salidaA] = de('A'), [entradaB, salidaB] = de('B');
    return { entradaA, salidaA, entradaB, salidaB };
  }

  /** Rectángulo que ocupa el widget con sus textos (para colocarlo sin que choque con los vecinos). */
  function limites(cfg) {
    const c = normalizar(cfg), lateral = TUBO_EXTERIOR_PX + LATERAL_TEXTOS_PX;
    return { x: c.x - lateral, y: c.y - ARRIBA_PX, ancho: c.ancho + 2 * lateral, alto: c.alto + ARRIBA_PX + AVISOS_PX };
  }

  /* ---------- pruebas geométricas ---------- */

  const orientacion = (a, b, c) => { const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); return Math.abs(v) < 1e-9 ? 0 : (v > 0 ? 1 : -1); };
  const enSegmento = (a, b, p) => Math.min(a.x, b.x) - 1e-9 <= p.x && p.x <= Math.max(a.x, b.x) + 1e-9 && Math.min(a.y, b.y) - 1e-9 <= p.y && p.y <= Math.max(a.y, b.y) + 1e-9;
  /** True si los segmentos ab y cd se cortan o se tocan (incluye solaparse en una recta). */
  function segmentosSeCortan(a, b, c, d) {
    const o1 = orientacion(a, b, c), o2 = orientacion(a, b, d), o3 = orientacion(c, d, a), o4 = orientacion(c, d, b);
    if (o1 !== o2 && o3 !== o4) return true;
    return (o1 === 0 && enSegmento(a, b, c)) || (o2 === 0 && enSegmento(a, b, d)) || (o3 === 0 && enSegmento(c, d, a)) || (o4 === 0 && enSegmento(c, d, b));
  }
  /** True si dos recorridos se cortan o se tocan en algún punto. */
  function hayCruce(p1, p2) {
    for (let i = 0; i < p1.length - 1; i++) for (let j = 0; j < p2.length - 1; j++) if (segmentosSeCortan(p1[i], p1[i + 1], p2[j], p2[j + 1])) return true;
    return false;
  }
  /** True si un recorrido se corta a sí mismo (los segmentos contiguos solo comparten su extremo y no cuentan). */
  function autocruce(p) {
    for (let i = 0; i < p.length - 1; i++) for (let j = i + 2; j < p.length - 1; j++) if (segmentosSeCortan(p[i], p[i + 1], p[j], p[j + 1])) return true;
    return false;
  }
  /** Distancia mínima entre dos recorridos (para comprobar que los tubos no se pisan visualmente). */
  function distanciaMinima(p1, p2) {
    const puntoSegmento = (p, a, b) => {
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      const t = l2 ? limitar(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1) : 0;
      return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    };
    let m = Infinity;
    for (let i = 0; i < p1.length - 1; i++) for (let j = 0; j < p2.length - 1; j++) {
      m = Math.min(m, puntoSegmento(p1[i], p2[j], p2[j + 1]), puntoSegmento(p1[i + 1], p2[j], p2[j + 1]), puntoSegmento(p2[j], p1[i], p1[i + 1]), puntoSegmento(p2[j + 1], p1[i], p1[i + 1]));
    }
    return m;
  }
  /** True si todos los puntos están dentro de la caja. */
  function dentroDeCaja(cfg, puntos) {
    const c = normalizar(cfg);
    return puntos.every(p => p.x >= c.x - 1e-9 && p.x <= c.x + c.ancho + 1e-9 && p.y >= c.y - 1e-9 && p.y <= c.y + c.alto + 1e-9);
  }
  /** La parte del trazado que va por dentro de la caja (sin los tubos exteriores). */
  const interior = (cfg, puntos) => { const c = normalizar(cfg); return puntos.filter(p => p.x >= c.x - 1e-9 && p.x <= c.x + c.ancho + 1e-9); };

  /* ---------- estado (puro) ---------- */

  const LECTURA_VACIA = { circulaA: false, circulaB: false, velocidadA: 60, velocidadB: 60, tEntradaA: null, tSalidaA: null, tEntradaB: null, tSalidaB: null,
    obstruccion: 0, fuga: false, falloSonda: { entradaA: false, salidaA: false, entradaB: false, salidaB: false } };

  /** Lectura completa a partir de la parcial que pase quien lo use. */
  function normalizarLectura(l = {}) {
    const r = Object.assign({}, LECTURA_VACIA, l);
    r.falloSonda = Object.assign({}, LECTURA_VACIA.falloSonda, l.falloSonda);
    for (const k of Object.keys(r.falloSonda)) r.falloSonda[k] = !!r.falloSonda[k];
    r.obstruccion = limitar(Number(r.obstruccion) || 0, 0, 1);
    for (const k of ['circulaA', 'circulaB', 'fuga']) r[k] = !!r[k];
    for (const k of ['tEntradaA', 'tSalidaA', 'tEntradaB', 'tSalidaB']) r[k] = typeof r[k] === 'number' && Number.isFinite(r[k]) ? r[k] : null;
    return r;
  }
  const hayFalloSonda = l => Object.values(l.falloSonda).some(Boolean);

  /** Estado a mostrar. Prioridad: fuga > fallo de sonda > ensuciado > circulando > parado. */
  function claseEstado(lectura) {
    const l = normalizarLectura(lectura);
    if (l.fuga) return 'fuga';
    if (hayFalloSonda(l)) return 'fallo';
    if (l.obstruccion >= UMBRAL_ENSUCIADO) return 'ensuciado';
    return l.circulaA || l.circulaB ? 'circulando' : 'parado';
  }
  const TEXTO_ESTADO = { parado: 'parado', circulando: 'circulando', ensuciado: 'ensuciado: pierde rendimiento', fuga: 'FUGA entre circuitos', fallo: 'fallo en una sonda de temperatura' };
  const textoEstado = lectura => TEXTO_ESTADO[claseEstado(lectura)];

  /** Texto de una temperatura (o «⚠ FALLO» si la sonda falla, «—» si no hay dato). */
  function textoTemperatura(valor, fallo) {
    if (fallo) return '⚠ FALLO';
    return typeof valor === 'number' ? `${decimal(valor)} °C` : '—';
  }

  /** Avisos que se escriben bajo la caja, uno por línea. */
  function avisos(lectura) {
    const l = normalizarLectura(lectura), a = [];
    if (l.fuga) a.push('✕ Fuga entre circuitos: se mezclan');
    if (l.obstruccion >= UMBRAL_ENSUCIADO) a.push(`⚠ Ensuciado ${Math.round(l.obstruccion * 100)} %: pasa menos caudal`);
    if (hayFalloSonda(l)) a.push('⚠ Fallo en una sonda de temperatura');
    return a;
  }

  const nombreFluido = circ => circ.etiqueta || FLUIDOS[circ.fluido].nombre;

  /** aria-label del widget: «TAG, titulo. Leche entra a 4,0 °C y sale a 65,0 °C. Agua caliente … Estado.» */
  function textoAccesible(cfg, lectura) {
    const c = normalizar(cfg), l = normalizarLectura(lectura);
    const parte = (circ, e, s, fe, fs) => {
      const tx = (v, f) => (f ? 'sin lectura fiable' : typeof v === 'number' ? `${decimal(v)} °C` : 'sin dato');
      return `${nombreFluido(circ)} entra a ${tx(e, fe)} y sale a ${tx(s, fs)}.`;
    };
    const f = l.falloSonda;
    return `${c.tag}${c.titulo ? ', ' + c.titulo : ''}. ${parte(c.circuitoA, l.tEntradaA, l.tSalidaA, f.entradaA, f.salidaA)} ${parte(c.circuitoB, l.tEntradaB, l.tSalidaB, f.entradaB, f.salidaB)} Estado: ${textoEstado(l)}.`;
  }

  /* ---------- dibujo ---------- */

  /** Posición de la temperatura de cada toma (encima del tubo, junto al puerto y por fuera) y del nombre del fluido en las entradas (debajo). */
  function etiquetas(cfg) {
    const c = normalizar(cfg), P = puertos(c), lista = [];
    for (const id of ['entradaA', 'salidaA', 'entradaB', 'salidaB']) {
      const p = P[id], fuera = p.lado === 'izquierda' ? -6 : 6, anclaje = p.lado === 'izquierda' ? 'end' : 'start';
      if (c.temperaturas) lista.push({ id, tipo: 'temperatura', x: p.x + fuera, y: p.y - 8, anclaje });
      if (c.nombres && id.startsWith('entrada')) lista.push({ id: `${id}-fluido`, tipo: 'fluido', x: p.x + fuera, y: p.y + 17, anclaje, texto: nombreFluido(id.endsWith('A') ? c.circuitoA : c.circuitoB) });
    }
    return lista;
  }

  /** Puntas de flecha en el tubo exterior de cada toma, en el sentido del flujo. */
  function flechasDeSentido(c, G, circuito) {
    const s = sentidos(c)[circuito] === 'derecha' ? 1 : -1, yp = circuito === 'A' ? G.yA : G.yB;
    const punta = x => `${redondear(x - s * 5)},${redondear(yp - 6)} ${redondear(x + s * 6)},${redondear(yp)} ${redondear(x - s * 5)},${redondear(yp + 6)}`;
    return [punta(G.izquierda - TUBO_EXTERIOR_PX / 2), punta(G.derecha + TUBO_EXTERIOR_PX / 2)];
  }

  /** Especificación (para Canvas) del widget: un <g> con la caja, los dos flujos en onda, las flechas, las temperaturas y los avisos. */
  function especificacion(cfg, lectura) {
    const c = normalizar(cfg), id = c.tag, G = geometria(c);
    const l = normalizarLectura(lectura), { x, y, ancho: w, alto: h } = c;
    const nodos = [['rect', { class: 'ic-caja', x, y, width: w, height: h, rx: 6 }]];
    for (const circuito of ['B', 'A']) {
      const circ = circuito === 'A' ? c.circuitoA : c.circuitoB;
      nodos.push(['path', { id: `ic-${id}-${circuito}`, class: 'ic-circuito', 'data-circuito': `${id}-${circuito}`, 'data-fluido': circ.fluido, d: ruta(trazado(c, circuito)) }]);
      for (const pts of flechasDeSentido(c, G, circuito)) nodos.push(['polygon', { class: 'ic-flecha', 'data-fluido': circ.fluido, points: pts }]);
    }
    const fx = x + w / 2, fy = G.ymed, t = 7;      // marca de fuga: en medio, entre los dos flujos
    nodos.push(['g', { id: `ic-${id}-fuga`, class: 'ic-fuga' }, ['path', { class: 'ic-fuga-marca', d: `M${redondear(fx - t)} ${redondear(fy - t)} L${redondear(fx + t)} ${redondear(fy + t)} M${redondear(fx + t)} ${redondear(fy - t)} L${redondear(fx - t)} ${redondear(fy + t)}` }]]);
    if (c.titulo) nodos.push(['text', { class: 'ic-titulo', x: x + w / 2, y: y - 12, 'text-anchor': 'middle' }, c.titulo]);
    const claveT = { entradaA: 'tEntradaA', salidaA: 'tSalidaA', entradaB: 'tEntradaB', salidaB: 'tSalidaB' };
    for (const e of etiquetas(c)) {
      nodos.push(e.tipo === 'temperatura'
        ? ['text', { id: `ic-${id}-${e.id}`, class: 'ic-temp', x: redondear(e.x), y: redondear(e.y), 'text-anchor': e.anclaje }, textoTemperatura(l[claveT[e.id]], false)]
        : ['text', { class: 'ic-fluido', x: redondear(e.x), y: redondear(e.y), 'text-anchor': e.anclaje }, e.texto]);
    }
    for (let i = 0; i < 3; i++) nodos.push(['text', { id: `ic-${id}-aviso-${i}`, class: 'ic-aviso', x: x + w / 2, y: y + h + 22 + 18 * i, 'text-anchor': 'middle' }, '']);
    return ['g', { id: `g-${id}`, class: 'ic', 'data-tag': id, tabindex: 0, role: 'button', 'aria-label': textoAccesible(c, l), 'data-estado': claseEstado(l) }, ...nodos];
  }

  /**
   * Conecta el widget ya dibujado en `canvas` con su estado. Reutiliza `Tuberia` del SCADA compartido para el flujo animado.
   * Devuelve { actualizar(lectura), puertos } (los puertos son los de `puertos(cfg)`).
   */
  function enlazar(canvas, cfg) {
    const c = normalizar(cfg), id = c.tag;
    const { Tuberia } = typeof require !== 'undefined' ? require('../../../../simulador_pct23/js/interfaz/scada/tuberia.js') : PCT.tuberia;
    const grupo = canvas.buscar(`g-${id}`);
    const nodo = suf => canvas.buscar(`ic-${id}-${suf}`);
    const tubA = new Tuberia(canvas, `[data-circuito="${id}-A"]`, l => !!l.circulaA, l => l.velocidadA);
    const tubB = new Tuberia(canvas, `[data-circuito="${id}-B"]`, l => !!l.circulaB, l => l.velocidadB);
    const claves = { entradaA: ['tEntradaA', 'entradaA'], salidaA: ['tSalidaA', 'salidaA'], entradaB: ['tEntradaB', 'entradaB'], salidaB: ['tSalidaB', 'salidaB'] };
    const memoria = {};      // solo se toca el DOM si algo cambia
    const escribir = (el, clave, texto) => { if (el && memoria[clave] !== texto) { memoria[clave] = texto; el.textContent = texto; } };
    return {
      puertos: puertos(c),
      actualizar(lectura) {
        const l = normalizarLectura(lectura), estado = claseEstado(l);
        tubA.actualizar(l); tubB.actualizar(l);
        grupo.setAttribute('data-estado', estado);
        grupo.classList.toggle('ic-ensuciado', l.obstruccion >= UMBRAL_ENSUCIADO);
        canvas.buscar(`ic-${id}-fuga`).classList.toggle('on', l.fuga);
        for (const [suf, [t, f]] of Object.entries(claves)) {
          const el = nodo(suf), fallo = l.falloSonda[f];
          escribir(el, suf, textoTemperatura(l[t], fallo));
          if (el) el.classList.toggle('alarma', fallo);
        }
        const lista = avisos(l);
        for (let i = 0; i < 3; i++) escribir(nodo(`aviso-${i}`), `aviso${i}`, lista[i] || '');
        const aria = textoAccesible(c, l);
        if (memoria.aria !== aria) { memoria.aria = aria; grupo.setAttribute('aria-label', aria); }
      },
    };
  }

  /**
   * Para unir bloques en fila: tubos rectos entre los puertos del lado derecho de `izq` y los del lado izquierdo de `der` que están a la misma altura,
   * siempre de una SALIDA a una ENTRADA del MISMO fluido (en un sentido o en el otro, según por dónde vaya). Nunca se une agua con leche.
   */
  function conectoresEntreBloques(cfgIzq, cfgDer) {
    const ci = normalizar(cfgIzq), cd = normalizar(cfgDer), Pi = puertos(ci), Pd = puertos(cd), lista = [];
    const fluido = (c, n) => (n.endsWith('A') ? c.circuitoA : c.circuitoB).fluido;
    for (const [nI, pI] of Object.entries(Pi)) for (const [nD, pD] of Object.entries(Pd)) {
      if (pI.lado !== 'derecha' || pD.lado !== 'izquierda' || Math.abs(pI.y - pD.y) > 1e-6 || fluido(ci, nI) !== fluido(cd, nD)) continue;
      if (/^salida/.test(nI) && /^entrada/.test(nD)) lista.push({ desde: `izq.${nI}`, hasta: `der.${nD}`, d: ruta([pI, pD]) });
      if (/^salida/.test(nD) && /^entrada/.test(nI)) lista.push({ desde: `der.${nD}`, hasta: `izq.${nI}`, d: ruta([pD, pI]) });
    }
    return lista;
  }

  const api = { FLUIDOS, ESTADOS, UMBRAL_ENSUCIADO, TUBO_EXTERIOR_PX, LATERAL_TEXTOS_PX, normalizar, geometria, sentidos, trazado, ruta, puertos, limites, interior,
    segmentosSeCortan, hayCruce, autocruce, distanciaMinima, dentroDeCaja, normalizarLectura, claseEstado, textoEstado, textoTemperatura, avisos, textoAccesible,
    etiquetas, especificacion, enlazar, conectoresEntreBloques };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstIntercambiadorBasico = api; }
})();
