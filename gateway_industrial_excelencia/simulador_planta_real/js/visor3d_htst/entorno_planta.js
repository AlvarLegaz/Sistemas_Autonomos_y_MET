// Entorno de la planta HTST en 3D (DISEÑADOR): el detalle de la nave y del patín que no son equipos de proceso, para que parezca una planta lechera real.
//   Patín: faldón y perfiles de la bancada, patas con placas de anclaje, bandeja de goteo bajo el patín, barandilla de protección (detrás y a la izquierda),
//   placa de características del conjunto, carteles de seguridad en el armario y en el calentador, etiquetas de tubería con el fluido y el sentido.
//   Cables: bandeja portacables metálica con tapa parcial desde el armario hasta los equipos, con los cables dentro y los conductos que bajan a los instrumentos
//   y a las bombas (solo rutas: los instrumentos no se tocan).
//   Servicios: depósito de CIP con su bomba y válvulas, conectado a XV-401 por el punto donde el esquema dibuja «SOLUCIÓN CIP»; salida «ENVASADO» con manguera y
//   carro de cajas; acometidas de agua de red, agua fría y aire comprimido (con FRL), pila con sifón y desagüe, retorno de CIP, extintor, botiquín, cuadro de
//   avisos, lavaojos, puerta de salida, extractores, luminarias (solo geometría), bolardos, plataforma de mantenimiento y marcas, manchas y desgaste del suelo.
// Todo es procedural y ligero (menos de 15 000 triángulos): las piezas se funden por material (kit.ensamble) y los carteles comparten UNA textura (atlas).
// Es decorativo: ninguna malla se puede seleccionar (raycast desactivado) y no hay elementos de equipo. Las funciones puras (plan de la bandeja y de sus bajadas,
// etiquetas de tubería, empaquetado del atlas, cajas ocupadas) se exportan aparte para probarlas con node:test.
(function () {
  const K = typeof require !== 'undefined' ? require('./kit.js') : PCT.htstKit;
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.htstLayout;
  const TUB = typeof require !== 'undefined' ? require('./tuberias.js') : PCT.htstTuberias;
  const INS = typeof require !== 'undefined' ? require('./instrumentos.js') : PCT.htstInstrumentos3d;
  const { SKID } = layout;
  const PI = Math.PI;
  const FY = -SKID.alto;                                   // suelo de la nave (el del patín está en y = 0)
  const NAVE = { ancho: 900, fondo: 800, zPared: -400, altoPared: 360 };      // los mismos valores que escena_planta.js (lo comprueba una prueba)
  const PASILLO = { x0: -200, x1: 270, z0: SKID.fondo / 2 + 3, z1: 134 };     // franja de trabajo delante del patín (con la canaleta): sin nada sólido encima
  const CIP = { x: 248, z: 56, r: 20, y0: -10, alto: 70 };                    // depósito de solución de limpieza, a la derecha del patín
  const BANDEJA = { y: 136, ancho: 12, alto: 5, zTras: -60, zFrente: 66, xDer: 150, xIzq: -150, xArmario: 185, zPosteTras: -72, zPosteFrente: 74 };
  const MARGEN = 1.5;
  const MESES = 'Año 2026';

  /* ---------- Funciones puras ---------- */
  const distSeg3 = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], l2 = dx * dx + dy * dy + dz * dz;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) / l2)) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy, p[2] - a[2] - t * dz);
  };
  const distSegPlanta = (x, z, a, b) => {
    const dx = b[0] - a[0], dz = b[2] - a[2], l2 = dx * dx + dz * dz;
    const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / l2)) : 0;
    return Math.hypot(x - a[0] - t * dx, z - a[2] - t * dz);
  };
  const solapan = (a, b, m = 0) => a[0] < b[1] + m && a[1] > b[0] - m && a[2] < b[3] + m && a[3] > b[2] - m && a[4] < b[5] + m && a[5] > b[4] - m;   // cajas [x0,x1,y0,y1,z0,z1]

  /** Cajas [x0,x1,y0,y1,z0,z1] de los equipos e instrumentos del patín: las dadas en ctx.cajas (medidas del 3D real) o, si no hay, las estimadas del layout. */
  function cajasDe(ctx) {
    if (ctx && ctx.cajas) return Object.entries(ctx.cajas).map(([tag, c]) => ({ tag, c }));
    const l = [];
    for (const q of layout.EQUIPOS) {
      const p = layout.posicion(q.tag);
      if (p && p.ancho && !p.fueraDelPatin) l.push({ tag: q.tag, c: [p.x - p.ancho / 2, p.x + p.ancho / 2, 0, p.alto, p.z - p.fondo / 2, p.z + p.fondo / 2] });
    }
    for (const t of INS.TAGS) { const m = INS.montaje(t); if (m) l.push({ tag: t, c: [m[0] - 10, m[0] + 10, m[1] - 12, m[1] + 24, m[2] - 10, m[2] + 10] }); }
    return l;
  }
  function porticosPorDefecto() {
    try { const E = typeof require !== 'undefined' ? require('./escena_planta.js') : PCT.htstEscenaPlanta; return E.porticosTuberia().map(p => p.x); } catch (_) { return [-25, 85]; }
  }

  /**
   * Plan de la bandeja portacables (función pura): postes de apoyo en los bordes del patín (detrás y delante) que no pisan equipos, tubos ni los pórticos, y las
   * bajadas (conductos) hasta cada instrumento y cada motor por una columna libre: ni dentro de otro equipo ni a menos de 2,5 cm del eje de un tubo.
   * Devuelve { y, cajas, postesTras: [x], postesFrente: [x], bajadas: [{ tag, x, z, yAbajo, lado: 'tras'|'frente' }], omitidas: [tag] }.
   */
  function planificar(ctx = {}) {
    const cajas = cajasDe(ctx), rutas = ctx.rutas || TUB.RUTAS, porticos = ctx.porticos || porticosPorDefecto();
    const yB = BANDEJA.y, yBajo = yB - BANDEJA.alto / 2 - 0.2;
    const radioTubo = TUB.RADIO_TUBO_CM;
    const tramos = [];
    for (const r of rutas) for (let i = 1; i < r.puntos.length; i++) tramos.push({ a: r.puntos[i - 1], b: r.puntos[i], radio: r.radio || radioTubo });

    // postes: la placa (8 × 8 cm) no puede pisar un equipo, un tubo ni un poste de pórtico
    const posteLibre = (x, z) => {
      const placa = [x - 4, x + 4, 0, 2, z - 4, z + 4];
      if (cajas.some(q => solapan(placa, q.c, 2))) return false;
      if (porticos.some(px => Math.abs(x - px) < 10)) return false;
      if (Math.abs(x) > SKID.ancho / 2 - 6) return false;
      return !tramos.some(t => distSegPlanta(x, z, t.a, t.b) < t.radio + 5);
    };
    const elegir = (z, desde, hasta, paso) => {
      const lista = [];
      for (let t = desde; hasta > desde ? t <= hasta : t >= hasta; t += paso) {
        let mejor = null;
        for (const d of [0, 6, -6, 12, -12, 18, -18]) if (posteLibre(t + d, z) && (!lista.length || Math.abs(lista[lista.length - 1] - (t + d)) > 35)) { mejor = t + d; break; }
        if (mejor !== null && Math.abs(mejor) <= BANDEJA.xDer) lista.push(mejor);
      }
      return lista;
    };
    const postesTras = elegir(BANDEJA.zPosteTras, BANDEJA.xDer, BANDEJA.xIzq, -(BANDEJA.xDer - BANDEJA.xIzq) / 4);
    const postesFrente = elegir(BANDEJA.zPosteFrente, BANDEJA.xDer, BANDEJA.xIzq, -(BANDEJA.xDer - BANDEJA.xIzq) / 4);

    // bajadas
    const columnaLibre = (x, z, yAbajo, tag) => {
      const col = [x - 0.9, x + 0.9, yAbajo, yBajo, z - 0.9, z + 0.9];
      if (cajas.some(q => q.tag !== tag && solapan(col, q.c, MARGEN))) return false;
      if (porticos.some(px => Math.abs(x - px) < 4)) return false;
      for (let y = yAbajo; y <= yBajo; y += 2) for (const t of tramos) if (distSeg3([x, y, z], t.a, t.b) < t.radio + 1.7) return false;
      return true;
    };
    const objetivos = INS.TAGS.concat(['P-101', 'P-201']);
    const bajadas = [], omitidas = [];
    for (const tag of objetivos) {
      const q = cajas.find(c => c.tag === tag);
      if (!q) continue;
      const c = q.c, cx = (c[0] + c[1]) / 2, cz = (c[4] + c[5]) / 2;
      const prueba = [];
      for (let dx = -12; dx <= 12; dx += 3) for (let dz = -12; dz <= 12; dz += 3) {
        const x = cx + dx, z = cz + dz;
        if (x > c[0] + 3 && x < c[1] - 3 && z > c[4] + 3 && z < c[5] - 3) prueba.push([x, z, Math.hypot(dx, dz)]);
      }
      prueba.sort((p, r) => p[2] - r[2]);
      const yAbajo = c[3] - 1.5;
      const buena = prueba.find(([x, z]) => columnaLibre(x, z, yAbajo, tag));
      if (!buena) { omitidas.push(tag); continue; }
      bajadas.push({ tag, x: buena[0], z: buena[1], yAbajo, lado: buena[1] < 3 ? 'tras' : 'frente' });
    }
    return { y: yB, cajas, postesTras, postesFrente, bajadas, omitidas };
  }

  /** Texto de la etiqueta de un tubo (función pura). */
  function textoEtiqueta(ruta) {
    const id = ruta.id;
    if (ruta.fluido === 'leche') return /CRUDA|LLENADO|VACIADO/.test(id) ? 'LECHE CRUDA' : /DESVIO/.test(id) ? 'LECHE DESVÍO' : /CALIENTE|TRAS_TUBO/.test(id) ? 'LECHE CALIENTE' : 'LECHE PAST.';
    return { agua_caliente: 'AGUA CALIENTE', agua_fria: 'AGUA FRÍA', cip: 'SOLUCIÓN CIP' }[ruta.fluido] || ruta.fluido.toUpperCase();
  }
  /**
   * Etiquetas de tubería (función pura): una por tubo (menos el aire y los que tienen pendiente), pegada al lado de delante (x-run) o de la derecha (z-run) del
   * tramo horizontal más largo, en un sitio libre de uniones tri-clamp, cintas de color y del instrumento del tubo. `dir` = +1 si la flecha apunta hacia la derecha del
   * cartel. Devuelve [{ ruta, fluido, texto, x, y, z, eje, dir, celda }].
   */
  function etiquetasTuberia(rutas = TUB.RUTAS) {
    const lista = [], mitad = 6.4;
    rutas.forEach(r => {
      if (r.fluido === 'aire' || r.pendiente) return;
      let mejor = null;
      for (let i = 1; i < r.puntos.length; i++) {
        const a = r.puntos[i - 1], b = r.puntos[i];
        if (a[1] !== b[1]) continue;
        const l = Math.hypot(b[0] - a[0], b[2] - a[2]);
        if (!mejor || l > mejor.l) mejor = { a, b, l, ini: i === 1, fin: i === r.puntos.length - 1 };
      }
      if (!mejor || mejor.l < 26) return;
      const { a, b, l } = mejor;
      const uniones = TUB.posicionesUniones(l, mejor.ini, mejor.fin);
      const prohibidos = [].concat(uniones.map(u => [u - 4, u + 4]), TUB.posicionesBandas(l, uniones).map(s => [s - 2.4, s + 2.4]), r.anclas ? [[l / 2 - 9, l / 2 + 9]] : []);
      if (mejor.ini) prohibidos.push([0, 11]); if (mejor.fin) prohibidos.push([l - 11, l]);
      let s = null;
      for (let d = 0; d <= l / 2; d += 1) for (const sg of [-1, 1]) {
        const c = l / 2 + sg * d;
        if (c - mitad < 6 || c + mitad > l - 6) continue;
        if (prohibidos.every(([p, q]) => c + mitad < p || c - mitad > q)) { s = c; break; }
      }
      if (s === null) return;
      const ux = (b[0] - a[0]) / l, uz = (b[2] - a[2]) / l, eje = Math.abs(ux) > 0.5 ? 'x' : 'z';
      const x = a[0] + ux * s, z = a[2] + uz * s, rr = (r.radio || TUB.RADIO_TUBO_CM) + 0.12;
      const sentidoMundo = eje === 'x' ? Math.sign(ux) : Math.sign(uz), dir = eje === 'x' ? sentidoMundo : -sentidoMundo;   // en el cartel de un tubo a lo largo de z, «derecha» es -z
      const texto = textoEtiqueta(r);
      lista.push({ ruta: r.id, fluido: r.fluido, texto, x: eje === 'x' ? x : x + rr, y: a[1], z: eje === 'x' ? z + rr : z, eje, dir, celda: `tub|${texto}|${dir > 0 ? 'd' : 'i'}` });
    });
    return lista;
  }

  /** Empaquetado por filas de las celdas del atlas (función pura): { pos: { id: { x, y, w, h } }, alto }. */
  function empaquetar(celdas, ancho = 1024) {
    const orden = celdas.slice().sort((p, q) => q.h - p.h || q.w - p.w), pos = {};
    let x = 0, y = 0, fila = 0;
    for (const c of orden) {
      if (pos[c.id]) continue;
      if (x + c.w > ancho) { x = 0; y += fila; fila = 0; }
      pos[c.id] = { x, y, w: c.w, h: c.h }; x += c.w; fila = Math.max(fila, c.h);
    }
    return { pos, alto: y + fila };
  }
  const CELDAS_FIJAS = [
    { id: 'placa', w: 1024, h: 256, tipo: 'placa' },
    { id: 'electrico', w: 128, h: 128, tipo: 'electrico' }, { id: 'caliente', w: 128, h: 128, tipo: 'caliente' }, { id: 'moviles', w: 128, h: 128, tipo: 'moviles' },
    { id: 'corrosivo', w: 128, h: 128, tipo: 'corrosivo' }, { id: 'epi', w: 128, h: 128, tipo: 'epi' }, { id: 'extintor', w: 128, h: 128, tipo: 'extintor' },
    { id: 'botiquin', w: 128, h: 128, tipo: 'botiquin' }, { id: 'lavaojos', w: 128, h: 128, tipo: 'lavaojos' },
    { id: 'salida', w: 256, h: 128, tipo: 'salida' }, { id: 'avisos', w: 256, h: 192, tipo: 'avisos' }, { id: 'tanqueCip', w: 256, h: 128, tipo: 'tanqueCip' },
    { id: 'envasado', w: 256, h: 64, tipo: 'texto', texto: 'ENVASADO', fondo: '#1c4f7c', color: '#ffffff' },
    { id: 'zonaLibre', w: 256, h: 64, tipo: 'texto', texto: 'ZONA LIBRE · 1 m', fondo: '#15181c', color: '#f4c20d' },
    { id: 'acRed', w: 192, h: 48, tipo: 'texto', texto: 'AGUA DE RED', fondo: '#1f8a4c', color: '#ffffff' },
    { id: 'acFria', w: 192, h: 48, tipo: 'texto', texto: 'AGUA FRÍA', fondo: '#2f7fc7', color: '#ffffff' },
    { id: 'acAire', w: 192, h: 48, tipo: 'texto', texto: 'AIRE COMPRIMIDO', fondo: '#7fc4e4', color: '#10222e' },
    { id: 'acDesague', w: 192, h: 48, tipo: 'texto', texto: 'DESAGÜE', fondo: '#555c63', color: '#ffffff' },
    { id: 'acCip', w: 192, h: 48, tipo: 'texto', texto: 'RETORNO CIP', fondo: '#d8b92a', color: '#1b1b1b' },
    { id: 'acCipRed', w: 192, h: 48, tipo: 'texto', texto: 'SOLUCIÓN CIP', fondo: '#d8b92a', color: '#1b1b1b' },
  ];
  const COLOR_FLUIDO = { leche: ['#2f9e44', '#ffffff'], agua_caliente: ['#d9631e', '#ffffff'], agua_fria: ['#2f7fc7', '#ffffff'], cip: ['#e8d23a', '#1b1b1b'] };
  const celdasDe = etiquetas => {
    const lista = CELDAS_FIJAS.slice(), vistas = new Set();
    for (const t of etiquetas) if (!vistas.has(t.celda)) { vistas.add(t.celda); lista.push({ id: t.celda, w: 224, h: 48, tipo: 'tub', texto: t.texto, dir: t.dir, fluido: t.fluido }); }
    return lista;
  };

  /* ---------- Pintado de los carteles en el atlas ---------- */
  function pintarCelda(g, c, p) {
    const { x, y, w, h } = p;
    g.save(); g.translate(x, y);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const fuente = (px, peso = 700) => { g.font = `${peso} ${px}px system-ui, sans-serif`; };
    const triangulo = simbolo => {
      g.fillStyle = '#f4c20d'; g.strokeStyle = '#111'; g.lineWidth = 8; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(64, 10); g.lineTo(120, 112); g.lineTo(8, 112); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#111'; g.strokeStyle = '#111'; simbolo();
    };
    const cuadro = (fondo, simbolo) => { g.fillStyle = fondo; g.fillRect(4, 4, w - 8, h - 8); g.strokeStyle = '#fff'; g.lineWidth = 4; g.strokeRect(10, 10, w - 20, h - 20); g.fillStyle = '#fff'; g.strokeStyle = '#fff'; simbolo(); };
    switch (c.tipo) {
      case 'placa': {
        const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#d9dee2'); gr.addColorStop(1, '#a9b1b8');
        g.fillStyle = gr; g.fillRect(0, 0, w, h); g.strokeStyle = '#4c555c'; g.lineWidth = 6; g.strokeRect(5, 5, w - 10, h - 10);
        g.fillStyle = '#6c757c'; for (const [rx, ry] of [[22, 22], [w - 22, 22], [22, h - 22], [w - 22, h - 22]]) { g.beginPath(); g.arc(rx, ry, 7, 0, 7); g.fill(); }
        g.fillStyle = '#15191c'; g.textAlign = 'left';
        fuente(46, 800); g.fillText(`${layout.PLANTA.fabrica.toLocaleUpperCase('es')} · ${layout.PLANTA.corto}`, 52, 52);
        fuente(30, 700); g.fillText('PASTEURIZADOR HTST DE PLACAS · LECHE', 52, 100);
        fuente(27, 600);
        g.fillText(`Caudal ${layout.PROCESO.caudalNominalLh} L/h (máx. ${layout.PROCESO.caudalMaximoLh})  ·  ${layout.PROCESO.temperaturaPasteurizacionC} °C / ${layout.PROCESO.tiempoResidenciaMinS} s`, 52, 148);
        g.fillText(`${MESES}  ·  Nº ${layout.PLANTA.corto}-2026-001  ·  400 V 3N~ 50 Hz  ·  Mando 24 V CC`, 52, 190);
        fuente(22, 600); g.fillText('Uso didáctico · Mantenimiento Electrónico', 52, 230);
        break;
      }
      case 'electrico': triangulo(() => { g.beginPath(); [[70, 38], [48, 78], [62, 78], [54, 102], [82, 64], [67, 64], [78, 38]].forEach(([a, b], i) => (i ? g.lineTo(a, b) : g.moveTo(a, b))); g.closePath(); g.fill(); }); break;
      case 'caliente': triangulo(() => {
        g.lineWidth = 6; g.lineCap = 'round';
        for (const dx of [-16, 0, 16]) { g.beginPath(); g.moveTo(64 + dx, 94); g.bezierCurveTo(54 + dx, 82, 74 + dx, 72, 64 + dx, 58); g.stroke(); }
        g.fillRect(40, 98, 48, 6);
      }); break;
      case 'moviles': triangulo(() => {
        g.lineWidth = 7; g.beginPath(); g.arc(64, 80, 15, 0, 7); g.stroke();
        for (let i = 0; i < 8; i++) { g.save(); g.translate(64, 80); g.rotate(i * PI / 4); g.fillRect(-4, -26, 8, 10); g.restore(); }
        g.fillStyle = '#f4c20d'; g.beginPath(); g.arc(64, 80, 6, 0, 7); g.fill();
      }); break;
      case 'corrosivo': {
        g.fillStyle = '#fff'; g.strokeStyle = '#111'; g.lineWidth = 6;
        g.beginPath(); g.moveTo(64, 6); g.lineTo(122, 64); g.lineTo(64, 122); g.lineTo(6, 64); g.closePath(); g.fill(); g.stroke();
        g.fillStyle = '#111'; g.beginPath(); g.moveTo(64, 64); g.lineTo(122, 64); g.lineTo(64, 122); g.lineTo(6, 64); g.closePath(); g.fill();
        g.fillStyle = '#fff'; fuente(26, 800); g.fillText('8', 64, 92); g.fillStyle = '#111'; fuente(16, 800); g.fillText('CORROSIVO', 64, 38); break;
      }
      case 'epi': {
        g.fillStyle = '#1f5fa8'; g.beginPath(); g.arc(64, 64, 58, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 4; g.beginPath(); g.arc(64, 64, 50, 0, 7); g.stroke();
        g.fillStyle = '#fff'; fuente(44, 800); g.fillText('EPI', 64, 52); fuente(15, 700); g.fillText('GAFAS Y', 64, 84); g.fillText('GUANTES', 64, 100); break;
      }
      case 'extintor': cuadro('#c8281e', () => {
        g.beginPath(); g.roundRect ? g.roundRect(50, 44, 28, 58, 8) : g.rect(50, 44, 28, 58); g.fill();
        g.fillRect(58, 30, 12, 16); g.fillRect(62, 26, 24, 6); g.lineWidth = 5; g.beginPath(); g.moveTo(80, 36); g.quadraticCurveTo(96, 44, 92, 74); g.stroke();
      }); break;
      case 'botiquin': cuadro('#1e8f4e', () => { g.fillRect(52, 26, 24, 76); g.fillRect(26, 52, 76, 24); }); break;
      case 'lavaojos': cuadro('#1e8f4e', () => {
        for (const ex of [46, 82]) { g.beginPath(); g.ellipse(ex, 52, 14, 9, 0, 0, 7); g.fill(); }
        g.fillStyle = '#1e8f4e'; for (const ex of [46, 82]) { g.beginPath(); g.arc(ex, 52, 4.5, 0, 7); g.fill(); }
        g.fillStyle = '#fff'; for (const [dx, dy] of [[40, 80], [56, 92], [72, 80], [88, 92]]) { g.beginPath(); g.moveTo(dx, dy - 8); g.lineTo(dx + 6, dy + 3); g.lineTo(dx - 6, dy + 3); g.closePath(); g.fill(); }
      }); break;
      case 'salida': {
        g.fillStyle = '#12a150'; g.fillRect(2, 2, w - 4, h - 4); g.strokeStyle = '#fff'; g.lineWidth = 5; g.strokeRect(9, 9, w - 18, h - 18);
        g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineWidth = 7; g.lineCap = 'round';
        g.beginPath(); g.arc(64, 34, 8, 0, 7); g.fill(); g.beginPath(); g.moveTo(60, 48); g.lineTo(76, 68); g.lineTo(98, 70); g.moveTo(68, 62); g.lineTo(52, 92); g.moveTo(76, 68); g.lineTo(84, 98); g.moveTo(60, 50); g.lineTo(40, 62); g.stroke();
        fuente(46, 800); g.fillText('SALIDA', 176, 44); g.beginPath(); g.moveTo(134, 90); g.lineTo(226, 90); g.lineTo(212, 76); g.moveTo(226, 90); g.lineTo(212, 104); g.stroke(); break;
      }
      case 'avisos': {
        g.fillStyle = '#b98b56'; g.fillRect(0, 0, w, h); g.strokeStyle = '#6b4a2b'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
        const hojas = [[20, 20, 70, 90, '#fff'], [102, 26, 60, 70, '#f6e58a'], [176, 18, 66, 96, '#fff'], [26, 112, 84, 64, '#cfe3f4'], [126, 110, 50, 66, '#fff'], [188, 124, 54, 50, '#f4c8c8']];
        for (const [hx, hy, hw, hh, col] of hojas) {
          g.fillStyle = col; g.fillRect(hx, hy, hw, hh); g.fillStyle = '#8a8f94'; for (let r = 0; r < Math.floor(hh / 12) - 1; r++) g.fillRect(hx + 6, hy + 18 + r * 12, hw - 12 - (r % 3) * 8, 3);
          g.fillStyle = '#111'; g.fillRect(hx + 6, hy + 6, hw * 0.5, 5); g.fillStyle = '#c0392b'; g.beginPath(); g.arc(hx + hw / 2, hy + 4, 3.5, 0, 7); g.fill();
        }
        break;
      }
      case 'tanqueCip': {
        g.fillStyle = '#15181c'; g.fillRect(0, 0, w, h); g.fillStyle = '#f4c20d'; g.fillRect(0, 0, w, 44);
        g.fillStyle = '#111'; fuente(30, 800); g.fillText('DEPÓSITO CIP', w / 2, 24);
        g.fillStyle = '#fff'; fuente(26, 700); g.fillText('SOLUCIÓN DE LIMPIEZA', w / 2, 68); fuente(21, 600); g.fillText('NaOH 2 %  ·  HNO₃ 1 %  ·  80 L', w / 2, 100);
        g.strokeStyle = '#f4c20d'; g.lineWidth = 4; g.strokeRect(3, 3, w - 6, h - 6); break;
      }
      case 'texto': {
        g.fillStyle = c.fondo; g.fillRect(0, 0, w, h); g.strokeStyle = c.color; g.lineWidth = 3; g.strokeRect(4, 4, w - 8, h - 8);
        let px = Math.floor(h * 0.52); do { fuente(px, 800); px -= 2; } while (g.measureText(c.texto).width > w - 24 && px > 10);
        g.fillStyle = c.color; g.fillText(c.texto, w / 2, h / 2 + 2); break;
      }
      case 'tub': {
        const [fondo, color] = COLOR_FLUIDO[c.fluido] || ['#555', '#fff'];
        g.fillStyle = fondo; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3);
        g.fillStyle = color; g.strokeStyle = color; g.lineWidth = 6; g.lineCap = 'round'; g.lineJoin = 'round';
        const x0 = c.dir > 0 ? 14 : 58, x1 = c.dir > 0 ? w - 58 : w - 14;
        let px = 26; do { fuente(px, 800); px -= 2; } while (g.measureText(c.texto).width > x1 - x0 - 4 && px > 10);
        g.fillText(c.texto, (x0 + x1) / 2, h / 2 + 2);
        const ax = c.dir > 0 ? w - 14 : 14, d = c.dir > 0 ? -1 : 1;     // punta de la flecha
        g.beginPath(); g.moveTo(ax + d * 34, h / 2); g.lineTo(ax, h / 2); g.moveTo(ax + d * 12, h / 2 - 11); g.lineTo(ax, h / 2); g.lineTo(ax + d * 12, h / 2 + 11); g.stroke();
        break;
      }
      default: break;
    }
    g.restore();
  }
  function pintarPeligro(g) {      // franjas amarillas y negras a 45° (se repiten)
    g.fillStyle = '#f4c20d'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#15181c';
    for (const o of [-64, 0, 64]) { g.beginPath(); g.moveTo(o, 64); g.lineTo(o + 32, 64); g.lineTo(o + 96, 0); g.lineTo(o + 64, 0); g.closePath(); g.fill(); }
  }

  /** Geometría única con posición, normal y uv a partir de piezas { g (no indexada, con uv), m (Matrix4) }. */
  function fusionarUV(THREE, piezas) {
    let n = 0;
    for (const p of piezas) n += p.g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    const v = new THREE.Vector3(), nm = new THREE.Matrix3(); let o = 0;
    for (const p of piezas) {
      const a = p.g.attributes; nm.getNormalMatrix(p.m);
      for (let i = 0; i < a.position.count; i++, o++) {
        v.fromBufferAttribute(a.position, i).applyMatrix4(p.m); pos[o * 3] = v.x; pos[o * 3 + 1] = v.y; pos[o * 3 + 2] = v.z;
        v.fromBufferAttribute(a.normal, i).applyMatrix3(nm).normalize(); nor[o * 3] = v.x; nor[o * 3 + 1] = v.y; nor[o * 3 + 2] = v.z;
        uv[o * 2] = a.uv.getX(i); uv[o * 2 + 1] = a.uv.getY(i);
      }
      p.g.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  }

  function crear(THREE, ctx = {}) {
    const kit = K.crearKit(THREE), reg = kit.registrar;
    const grupo = new THREE.Group();
    const conDOM = typeof document !== 'undefined' && !!document.createElement;
    const sinRayo = m => { m.raycast = () => {}; return m; };
    const solidos = [];       // cajas de lo voluminoso, para las pruebas y el aislamiento de choques
    const S = (id, x0, x1, y0, y1, z0, z1, zona = 'nave') => solidos.push({ id, caja: [x0, x1, y0, y1, z0, z1], zona });

    // cajas del 3D real (los equipos ya construidos por los otros módulos): con ellas la bandeja no choca con nada
    let cajasReales = ctx.cajas || null;
    if (!cajasReales && ctx.partes) {
      cajasReales = {};
      const els = {};
      for (const p of ctx.partes) Object.assign(els, p.elementos);
      const tags = layout.EQUIPOS.filter(q => { const p = layout.posicion(q.tag); return INS.TAGS.includes(q.tag) || (p && p.ancho && !p.fueraDelPatin); }).map(q => q.tag);
      for (const tag of tags) {
        if (!els[tag]) continue;
        els[tag].grupo.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(els[tag].grupo);
        cajasReales[tag] = [b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z];
      }
    }
    const plan = planificar({ cajas: cajasReales || undefined, porticos: ctx.porticos });

    /* ----- ensambles y ayudas de dibujo ----- */
    const e = kit.ensamble();
    const B = (w, h, d, k, x, y, z, rot) => { e.add(kit.caja(w, h, d), k, [x, y, z], rot || [0, 0, 0]); };
    const lados = (r, seg) => (r < 1.6 ? Math.min(seg, 6) : r < 4 ? Math.min(seg, 8) : Math.min(seg, 14));       // pocas caras: el presupuesto es de 15 000 triángulos
    const C = (r, h, seg, k, x, y, z, rot) => { e.add(kit.cil(r, h, lados(r, seg)), k, [x, y, z], rot || [0, 0, 0]); };
    const CX = (r, h, seg, k, x, y, z) => C(r, h, seg, k, x, y, z, [0, 0, PI / 2]);      // eje a lo largo de x
    const CZ = (r, h, seg, k, x, y, z) => C(r, h, seg, k, x, y, z, [PI / 2, 0, 0]);       // eje a lo largo de z
    const ESF = (r, k, x, y, z) => { e.add(new THREE.IcosahedronGeometry(r, 0), k, [x, y, z]); };       // codo o nudo: un icosaedro (20 triángulos)
    const ejeY = new THREE.Vector3(0, 1, 0), qv = new THREE.Quaternion(), ev = new THREE.Euler(), dv = new THREE.Vector3();
    const barra = (a, b, r, seg, k) => {
      dv.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const l = dv.length();
      if (l < 1e-6) return;
      qv.setFromUnitVectors(ejeY, dv.normalize()); ev.setFromQuaternion(qv);
      e.add(kit.cil(r, l, seg), k, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], [ev.x, ev.y, ev.z]);
    };
    const ADORNO = { inox: 'inox', mate: 'inoxMate', osc: 'oscuro', amar: 'amarillo' };
    const GRIS_PVC = 0xb3b7ba, AMARILLO = 0xe0b030, ROJO_EXT = 0xc8281e, VERDE_EQ = 0x1e8f4e, AZUL_CAJA = 0x3a78b8, CARTON = 0xc9a36a, VERDE_LUZ = 0xf6f2dc;
    const matLuz = kit.matLed(VERDE_LUZ);
    const NEGRO = 'negro';

    /* ---------- Atlas de carteles ---------- */
    const etiquetas = etiquetasTuberia();
    const celdas = celdasDe(etiquetas), emp = empaquetar(celdas);
    let matAtlas, matPeligro;
    if (conDOM) {
      const lienzo = document.createElement('canvas'); lienzo.width = 1024; lienzo.height = 1024;
      const g = lienzo.getContext('2d');
      g.fillStyle = '#888'; g.fillRect(0, 0, 1024, 1024);
      for (const c of celdas) pintarCelda(g, c, emp.pos[c.id]);
      const tx = reg(new THREE.CanvasTexture(lienzo)); tx.colorSpace = THREE.SRGBColorSpace;
      matAtlas = reg(new THREE.MeshLambertMaterial({ map: tx }));
      const lp = document.createElement('canvas'); lp.width = 64; lp.height = 64; pintarPeligro(lp.getContext('2d'));
      const tp = reg(new THREE.CanvasTexture(lp)); tp.colorSpace = THREE.SRGBColorSpace; tp.wrapS = tp.wrapT = THREE.RepeatWrapping;
      matPeligro = reg(new THREE.MeshLambertMaterial({ map: tp }));
    } else { matAtlas = reg(new THREE.MeshLambertMaterial({ color: 0xdddddd })); matPeligro = reg(new THREE.MeshLambertMaterial({ color: 0xd6b11e })); }
    const carteles = [], peligros = [];
    const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(), v4 = new THREE.Vector3(), un = new THREE.Vector3(1, 1, 1);
    const matriz = (x, y, z, ry, rx) => { e4.set(rx || 0, ry || 0, 0, 'YXZ'); q4.setFromEuler(e4); return m4.compose(v4.set(x, y, z), q4, un).clone(); };
    /** Cartel (celda del atlas) de w × h cm: ry gira alrededor de y (la cara mira a +z con ry = 0) y rx = -π/2 lo tumba en el suelo. */
    function cartel(id, w, h, x, y, z, ry = 0, rx = 0) {
      const p = emp.pos[id];
      if (!p) throw new Error('Celda de atlas desconocida: ' + id);
      const g = new THREE.PlaneGeometry(w, h).toNonIndexed(), uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.x + uv.getX(i) * p.w) / 1024, 1 - (p.y + (1 - uv.getY(i)) * p.h) / 1024);
      carteles.push({ g, m: matriz(x, y, z, ry, rx) });
    }
    /** Rectángulo de franjas de peligro en el suelo. */
    function franja(w, d, x, z) {
      const g = new THREE.PlaneGeometry(w, d).toNonIndexed(), uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 10, uv.getY(i) * d / 10);
      peligros.push({ g, m: matriz(x, FY + 0.22, z, 0, -PI / 2) });
    }

    /* ======================= 1. PATÍN ======================= */
    const Ah = SKID.ancho / 2, Fh = SKID.fondo / 2;
    // faldón de chapa bajo el borde de la cubierta y perfiles transversales de la bancada
    B(SKID.ancho + 1.2, 10, 0.6, ADORNO.mate, 0, -7, Fh + 0.3); B(SKID.ancho + 1.2, 10, 0.6, ADORNO.mate, 0, -7, -Fh - 0.3);
    for (const sx of [-1, 1]) B(0.6, 10, SKID.fondo, ADORNO.mate, sx * (Ah + 0.3), -7, 0);
    for (const x of [-100, -45, 15, 75, 125]) { B(5, 6, SKID.fondo - 8, ADORNO.osc, x, -11, 0); B(2, 1.2, SKID.fondo - 8, ADORNO.mate, x, -7.6, 0); }
    // patas: placa de anclaje con cuatro pernos; dos patas más a mitad del patín; travesaños atrás y a los lados
    const patas = [[-150, -65], [150, -65], [-150, 65], [150, 65], [0, -65], [0, 65]];
    for (const [x, z] of patas) {
      if (Math.abs(x) < 1) B(8, SKID.alto - 6, 8, 0x6d767f, x, FY / 2 - 3, z);
      B(15, 1, 15, ADORNO.mate, x, FY + 0.5, z);
      for (const [dx, dz] of [[-5.5, -5.5], [5.5, -5.5], [-5.5, 5.5], [5.5, 5.5]]) B(1.4, 2.4, 1.4, ADORNO.inox, x + dx, FY + 1.7, z + dz);
    }
    B(2 * 150, 3, 3, 0x6d767f, 0, -14, -65); for (const sx of [-1, 1]) B(3, 3, 130, 0x6d767f, sx * 150, -14, 0);
    // bandeja de goteo bajo el patín (chapa de inox con labio; el labio de delante se abre donde baja el desagüe, en x = 40)
    const zP0 = -80, zP1 = Fh + 2, dP = zP1 - zP0, zPc = (zP0 + zP1) / 2;       // la bandeja llega hasta z = 77: la franja de trabajo empieza en 78
    B(SKID.ancho + 14, 0.6, dP, 0x59626a, 0, FY + 0.3, zPc);
    B(SKID.ancho + 14, 3.5, 0.8, ADORNO.mate, 0, FY + 1.75, zP0); B(0.8, 3.5, dP, ADORNO.mate, -Ah - 7, FY + 1.75, zPc); B(0.8, 3.5, dP, ADORNO.mate, Ah + 7, FY + 1.75, zPc);
    B(Ah + 7 + 34, 3.5, 0.8, ADORNO.mate, (-Ah - 7 + 34) / 2, FY + 1.75, zP1); B(Ah + 7 - 46, 3.5, 0.8, ADORNO.mate, (46 + Ah + 7) / 2, FY + 1.75, zP1);
    S('bandeja_goteo', -Ah - 7.4, Ah + 7.4, FY, FY + 3.6, zP0 - 0.4, zP1 + 0.4, 'patin');
    // barandilla de protección amarilla por detrás y por la izquierda (los lados sin acceso): postes con placa, pasamanos y barra intermedia
    const xr0 = -176, xr1 = 168, zr0 = -82, zr1 = 70, yAlto = 95, yMedio = 50;
    for (const x of [-176, -91, -6, 79, 164]) { B(3, yAlto - FY, 3, AMARILLO, x, (yAlto + FY) / 2, zr0); B(9, 1, 9, ADORNO.mate, x, FY + 0.5, zr0); }
    for (const z of [-6, 70]) { B(3, yAlto - FY, 3, AMARILLO, xr0, (yAlto + FY) / 2, z); B(9, 1, 9, ADORNO.mate, xr0, FY + 0.5, z); }
    for (const y of [yAlto, yMedio]) { CX(1.5, xr1 - xr0, 8, AMARILLO, (xr0 + xr1) / 2, y, zr0); CZ(1.5, zr1 - zr0, 8, AMARILLO, xr0, y, (zr0 + zr1) / 2); }
    B(xr1 - xr0, 8, 0.8, AMARILLO, (xr0 + xr1) / 2, FY + 6, zr0);                    // rodapié de la barandilla
    S('barandilla_tras', xr0 - 1.5, xr1 + 1.5, yMedio - 1.5, yAlto + 1.5, zr0 - 1.5, zr0 + 1.5, 'nave');
    S('barandilla_izq', xr0 - 1.5, xr0 + 1.5, yMedio - 1.5, yAlto + 1.5, zr0, zr1 + 1.5, 'nave');
    // placa de características del conjunto (en el faldón de delante) y carteles de seguridad
    cartel('placa', 36, 9, 115, -7, Fh + 0.65, 0);
    const pos = layout.posicion('QE-001');
    cartel('electrico', 7, 7, pos.x + 30.2, 62, pos.z, PI / 2);                                  // lateral derecho del armario (el de la izquierda tiene la ventilación)
    cartel('moviles', 7, 7, pos.x + 30.2, 50, pos.z, PI / 2);
    const HW = { x: 20, z: 45, r: 17.4 };
    for (const [id, fi] of [['caliente', 1.25], ['electrico', 1.65]]) cartel(id, 5, 5, HW.x + HW.r * Math.sin(fi), 73, HW.z + HW.r * Math.cos(fi), fi);
    // etiquetas de tubería con el fluido y el sentido
    for (const t of etiquetas) cartel(t.celda, 12.2, 2.6, t.x, t.y, t.z, t.eje === 'x' ? 0 : PI / 2);

    /* ======================= 2. BANDEJA PORTACABLES ======================= */
    const yB = plan.y, Wb = BANDEJA.ancho, Hb = BANDEJA.alto;
    const COLORES_CABLE = [NEGRO, 0x74797e, 0x2e7fd6, 0xe0b030];
    function bandejaX(x0, x1, z) {      // tramo a lo largo de x entre x0 < x1, centrado en z
      const l = x1 - x0, cx = (x0 + x1) / 2;
      B(l, 0.5, Wb, ADORNO.mate, cx, yB - Hb / 2 + 0.25, z); for (const s of [-1, 1]) B(l, Hb, 0.5, ADORNO.mate, cx, yB, z + s * (Wb / 2 - 0.25));
      for (let t = x0 + 4; t + 14 < x1; t += 46) B(28, 0.4, Wb + 0.8, ADORNO.inox, Math.min(t + 14, x1 - 14), yB + Hb / 2 + 0.2, z);     // tapas parciales
      COLORES_CABLE.forEach((k, i) => B(l - 1, 1, 1, k, cx, yB - Hb / 2 + 1.1, z - 3.6 + i * 2.4));
      S('bandeja_x', x0, x1, yB - Hb / 2 - 0.2, yB + Hb / 2 + 0.6, z - Wb / 2, z + Wb / 2, 'patin');
    }
    function bandejaZ(z0, z1, x) {
      const l = z1 - z0, cz = (z0 + z1) / 2;
      B(Wb, 0.5, l, ADORNO.mate, x, yB - Hb / 2 + 0.25, cz); for (const s of [-1, 1]) B(0.5, Hb, l, ADORNO.mate, x + s * (Wb / 2 - 0.25), yB, cz);
      for (let t = z0 + 4; t + 14 < z1; t += 46) B(Wb + 0.8, 0.4, 28, ADORNO.inox, x, yB + Hb / 2 + 0.2, Math.min(t + 14, z1 - 14));
      COLORES_CABLE.forEach((k, i) => B(1, 1, l - 1, k, x - 3.6 + i * 2.4, yB - Hb / 2 + 1.1, cz));
      S('bandeja_z', x - Wb / 2, x + Wb / 2, yB - Hb / 2 - 0.2, yB + Hb / 2 + 0.6, z0, z1, 'patin');
    }
    bandejaX(BANDEJA.xIzq, BANDEJA.xArmario, BANDEJA.zTras);                             // por detrás, hasta la pared izquierda del armario
    bandejaZ(BANDEJA.zTras - Wb / 2, BANDEJA.zFrente + Wb / 2, BANDEJA.xDer);             // cruce a la derecha del patín
    bandejaX(BANDEJA.xIzq, BANDEJA.xDer, BANDEJA.zFrente);                               // por delante
    B(2, 14, 24, ADORNO.osc, BANDEJA.xArmario + 1, yB, BANDEJA.zTras);                   // brida de entrada al armario
    // postes en el borde del patín con brazo bajo la bandeja
    for (const [lista, zp, zb] of [[plan.postesTras, BANDEJA.zPosteTras, BANDEJA.zTras], [plan.postesFrente, BANDEJA.zPosteFrente, BANDEJA.zFrente]]) {
      for (const x of lista) {
        B(8, 1, 8, ADORNO.mate, x, 0.5, zp); B(3, yB - Hb / 2 - 1, 3, ADORNO.mate, x, (yB - Hb / 2 - 1) / 2 + 0.5, zp);
        B(3, 1.6, Math.abs(zp - zb) + 3, ADORNO.mate, x, yB - Hb / 2 - 0.8, (zp + zb) / 2);
        S('poste_bandeja', x - 4, x + 4, 0, yB - Hb / 2, zp - 4, zp + 4, 'patin');
      }
    }
    // bajadas: conducto corrugado que baja de la bandeja a cada instrumento y cada motor (solo la ruta; el instrumento no se toca)
    for (const b of plan.bajadas) {
      const zb = b.lado === 'tras' ? BANDEJA.zTras : BANDEJA.zFrente, yH = yB - Hb / 2 - 2.2;
      if (Math.abs(b.z - zb) > 1) CZ(0.9, Math.abs(b.z - zb) + 0.9, 6, 0x23272c, b.x, yH, (b.z + zb) / 2);
      ESF(1.0, 0x23272c, b.x, yH, b.z, 6); B(1.8, 1, 1.8, ADORNO.mate, b.x, yH + 1.8, zb);
      C(0.9, yH - b.yAbajo, 6, 0x23272c, b.x, (yH + b.yAbajo) / 2, b.z);
      C(1.35, 1.6, 6, ADORNO.inox, b.x, b.yAbajo + 0.8, b.z);                            // prensaestopas
      for (let y = b.yAbajo + 14; y < yH - 8; y += 26) C(1.2, 0.7, 6, ADORNO.mate, b.x, y, b.z);   // bridas
      S('bajada_' + b.tag, b.x - 0.9, b.x + 0.9, b.yAbajo, yH, b.z - 0.9, b.z + 0.9, 'patin');
    }

    /* ======================= 3. CIP: depósito, bomba y válvulas ======================= */
    const T = CIP;
    for (const [dx, dz] of [[-13, -13], [13, -13], [-13, 13], [13, 13]]) { B(3, T.y0 - FY, 3, ADORNO.mate, T.x + dx, (T.y0 + FY) / 2, T.z + dz); B(7, 0.8, 7, ADORNO.mate, T.x + dx, FY + 0.4, T.z + dz); }
    C(T.r, T.alto, 16, 'inox', T.x, T.y0 + T.alto / 2, T.z);                                 // virola
    e.add(kit.cono(T.r, 7, 9, 16), 'inox', [T.x, T.y0 + T.alto + 4.5, T.z]);                // tapa cónica
    e.add(kit.cono(T.r, 4, 6, 16), 'inox', [T.x, T.y0 - 3, T.z], [PI, 0, 0]);               // fondo cónico hacia el desagüe
    for (const y of [T.y0 + 18, T.y0 + 52]) C(T.r + 0.5, 1.2, 16, ADORNO.mate, T.x, y, T.z);   // aros de refuerzo
    C(6.5, 2.4, 12, ADORNO.mate, T.x - 6, T.y0 + T.alto + 10, T.z - 4); C(1.6, 2.5, 8, NEGRO, T.x - 6, T.y0 + T.alto + 12, T.z - 4);   // boca de hombre
    C(4.2, 11, 10, 'azul', T.x + 8, T.y0 + T.alto + 15, T.z - 2); C(1.4, 7, 8, ADORNO.mate, T.x + 8, T.y0 + T.alto + 22, T.z - 2);       // motor del agitador
    CZ(1.3, 5, 8, ADORNO.inox, T.x - 12, T.y0 + T.alto + 8, T.z + 6); CX(1.3, 5, 8, ADORNO.inox, T.x - 9.5, T.y0 + T.alto + 12, T.z + 6);                // venteo
    // visor de nivel (tubo de vidrio con marcas) por delante, a la derecha
    const dxv = 14, zv = T.z + Math.sqrt(T.r * T.r - dxv * dxv);
    C(1.0, 44, 8, 'vidrio', T.x + dxv, T.y0 + 30, zv + 1.4); for (const y of [T.y0 + 10, T.y0 + 52]) CZ(1.2, 3.6, 8, ADORNO.mate, T.x + dxv, y, zv + 0.7);
    C(0.75, 26, 6, 0x3d7fd0, T.x + dxv, T.y0 + 21, zv + 1.4);                               // líquido (azul de la sosa)
    // boca de salida abajo, hacia la bomba
    const yTubo = -4, zT = T.z;
    CX(2.2, 22, 10, 'inox', 217, yTubo, zT);                                                // del fondo del tanque (x = 228) a la entrada de la bomba (x = 206)
    S('cip_tanque', T.x - T.r, T.x + T.r, FY, T.y0 + T.alto + 9, T.z - T.r, T.z + T.r, 'nave');
    // bomba centrífuga de limpieza: motor a lo largo de x, voluta con la entrada hacia el tanque y salida hacia arriba
    const bx = 186;
    B(40, 2, 18, 0x59626a, bx + 1, FY + 1, zT); for (const dx of [-8, 8]) B(5, 7, 12, ADORNO.mate, bx + dx, FY + 5.5, zT);
    CX(7, 20, 14, 'azul', bx, yTubo, zT); for (const dx of [-8, -3, 2, 7]) CX(7.4, 0.8, 14, ADORNO.mate, bx + dx, yTubo, zT);
    e.add(kit.cono(7, 4.5, 5, 14), 'oscuro', [bx - 12.5, yTubo, zT], [0, 0, PI / 2]);
    B(7, 5, 6, ADORNO.osc, bx + 2, yTubo + 9.5, zT);                                            // caja de bornas
    CX(9, 8, 16, ADORNO.inox, bx + 14, yTubo, zT); CX(5, 3, 12, ADORNO.mate, bx + 18.5, yTubo, zT);
    S('cip_bomba', bx - 15, bx + 20, FY, yTubo + 15, zT - 9, zT + 9, 'nave');
    // aspiración: válvula de mariposa y unión tri-clamp
    const xValvula = 214;
    B(5, 10, 5, 'laton', xValvula, yTubo, zT); C(1.2, 3, 6, NEGRO, xValvula, yTubo + 6.5, zT); B(2, 1.4, 12, 0x2e9e55, xValvula, yTubo + 8.6, zT);
    for (const s of [-1, 1]) CX(3.6, 0.7, 10, ADORNO.inox, xValvula + s * 3.2, yTubo, zT);
    // impulsión a XV-401: sube a la altura de los puertos del patín, cruza el borde por z = 56 y entra por la boca de XV-401 (puerto ent)
    const yI = 10, xFinal = 100, xS = bx + 14;
    const impulsion = [[xS, yTubo + 4, zT], [xS, yI, zT], [xFinal, yI, zT], [xFinal, yI, 48]];
    for (let i = 1; i < impulsion.length; i++) {
      const a = impulsion[i - 1], b = impulsion[i];
      barra(a, b, 2.2, 10, 'inox');
      S('cip_tubo', Math.min(a[0], b[0]) - 2.2, Math.max(a[0], b[0]) + 2.2, Math.min(a[1], b[1]) - 2.2, Math.max(a[1], b[1]) + 2.2, Math.min(a[2], b[2]) - 2.2, Math.max(a[2], b[2]) + 2.2, 'patin');
    }
    for (const p of impulsion.slice(1, -1)) ESF(2.9, 'inox', p[0], p[1], p[2], 8);
    for (const x of [170, 122]) { CX(3.45, 0.5, 10, ADORNO.inox, x - 0.45, yI, zT); CX(3.45, 0.5, 10, ADORNO.inox, x + 0.45, yI, zT); CX(3.0, 0.5, 10, 'blanco', x, yI, zT); B(1.2, 1.4, 1.2, ADORNO.mate, x, yI + 3.9, zT); }
    B(5.5, 6.5, 5.5, 'laton', 144, yI, zT); C(1.0, 3, 6, NEGRO, 144, yI + 4.4, zT); B(12, 1.4, 2, 'rojo', 144, yI + 6.2, zT + 0);     // llave de bola con palanca
    // manómetro de la impulsión
    C(0.8, 4, 6, ADORNO.inox, 160, yI + 3, zT); CZ(3.6, 2.2, 12, NEGRO, 160, yI + 7.6, zT + 0.4); CZ(3.0, 0.5, 12, 'blanco', 160, yI + 7.6, zT + 1.5);
    // apoyo del tubo en el suelo, fuera del patín (en x = 177)
    B(3, yI - 2.2 - FY, 3, ADORNO.mate, 178, (yI - 2.2 + FY) / 2, zT); B(8, 0.8, 8, ADORNO.mate, 178, FY + 0.4, zT); B(8, 1, 4.6, ADORNO.mate, 178, yI - 2.2 - 0.5, zT);
    B(3, yI - 2.2, 3, ADORNO.mate, 140, (yI - 2.2) / 2, zT + 1.5); B(8, 1, 8, ADORNO.mate, 140, 0.5, zT + 1.5);
    // bidones de sosa y de ácido sobre un cubeto de retención, a la derecha (fuera del pasillo marcado)
    const cx2 = 299, cz2 = 62;
    B(56, 4, 56, AMARILLO, cx2, FY + 2.5, cz2);
    for (const [dx, dz, col] of [[-13, 0, AZUL_CAJA], [13, 0, 0xc0392b]]) {
      C(10.5, 34, 12, col, cx2 + dx, FY + 4.5 + 17, cz2 + dz); for (const y of [8, 26]) C(10.9, 1.2, 12, ADORNO.mate, cx2 + dx, FY + 4.5 + y, cz2 + dz); C(3.2, 2, 8, NEGRO, cx2 + dx + 4, FY + 4.5 + 35, cz2 + dz);
    }
    for (const [sx, sz, w, d] of [[0, -1, 56, 0.8], [0, 1, 56, 0.8]]) B(w, 4, d, AMARILLO, cx2, FY + 5.5, cz2 + sz * 27.6);
    for (const sx of [-1, 1]) B(0.8, 4, 56, AMARILLO, cx2 + sx * 27.6, FY + 5.5, cz2);
    S('cubeto_cip', cx2 - 28, cx2 + 28, FY, FY + 40, cz2 - 28, cz2 + 28, 'nave');
    // lavaojos de emergencia junto a la zona de química
    const ex = 292, ez = 14;
    C(9, 2, 12, ADORNO.mate, ex, FY + 1, ez); C(2.2, 76, 10, 'inox', ex, FY + 39, ez); C(1.2, 22, 8, 'inox', ex, FY + 87, ez); B(22, 22, 0.8, 'blanco', ex, FY + 112, ez - 0.5);
    C(11, 5, 14, VERDE_EQ, ex, FY + 78, ez); C(8.5, 0.8, 14, ADORNO.mate, ex, FY + 80.7, ez);
    for (const dx of [-5, 5]) { C(0.9, 7, 6, ADORNO.inox, ex + dx, FY + 84, ez); C(1.5, 1.6, 8, 'rojo', ex + dx, FY + 88, ez); }
    B(16, 1, 6, AMARILLO, ex, FY + 62, ez + 6.5); barra([ex, FY + 62, ez + 3], [ex, FY + 66, ez + 1.8], 0.6, 6, ADORNO.inox);
    cartel('lavaojos', 20, 20, ex, FY + 112, ez + 0.1);
    S('lavaojos', ex - 11, ex + 11, FY, FY + 124, ez - 11, ez + 11, 'nave');
    // carteles del depósito
    const a1 = dx => Math.asin(dx / T.r), zS = dx => T.z + Math.sqrt(T.r * T.r - dx * dx) + 0.2;
    cartel('tanqueCip', 15, 7.5, T.x - 4, T.y0 + 24, zS(-4), a1(-4));
    cartel('corrosivo', 7, 7, T.x - 9, T.y0 + 45, zS(-9), a1(-9)); cartel('epi', 7, 7, T.x + 3, T.y0 + 45, zS(3), a1(3));
    cartel('moviles', 6, 6, bx + 4, yTubo + 16, zT + 3.6 + 5.5);                           // sobre la bomba: partes móviles (en un poste corto)
    B(0.8, 7, 0.8, ADORNO.mate, bx + 4, yTubo + 11, zT + 7.5);

    /* ======================= 4. SALIDA «ENVASADO»: manguera y carro con cajas ======================= */
    const ps = TUB.RUTAS.find(r => r.id === 'LECHE_SALIDA').puntos.slice(-1)[0];                     // [160, 40, 30]: boca de salida del producto
    CX(1.9, 11, 12, 'inox', ps[0] + 5.5, ps[1], ps[2]); for (const s of [-0.5, 0.5]) CX(3.2, 0.5, 10, ADORNO.inox, ps[0] + 10.5 + s, ps[1], ps[2]);
    CX(3, 0.5, 10, 'blanco', ps[0] + 10.5, ps[1], ps[2]);
    // manguera sanitaria de silicona con virolas hasta la boquilla de llenado, sobre las cajas
    e.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[ps[0] + 11, ps[1], ps[2]], [ps[0] + 17, ps[1] + 6, ps[2] - 1], [ps[0] + 23, ps[1] + 8, ps[2] - 4], [ps[0] + 26, ps[1] + 4, ps[2] - 6]].map(a => new THREE.Vector3(a[0], a[1], a[2]))), 10, 1.3, 6, false), 0xd9d6c8);
    C(1.1, 7, 6, ADORNO.inox, ps[0] + 26, ps[1] + 1.5, ps[2] - 6); C(1.8, 1.4, 8, ADORNO.mate, ps[0] + 26, ps[1] + 5.2, ps[2] - 6);
    // carro de plataforma con cuatro ruedas, asa a la derecha y dos pisos de cajas de producto envasado
    const car = { x: 197, z: 20, w: 50, d: 40 };
    B(car.w, 7, car.d, 0x59626a, car.x, -12.5, car.z);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { C(3, 2, 8, NEGRO, car.x + sx * 20, -17, car.z + sz * 15, [0, 0, PI / 2]); B(2, 3, 2, ADORNO.osc, car.x + sx * 20, -13.6, car.z + sz * 15); }
    for (const sz of [-1, 1]) C(0.9, 42, 6, ADORNO.mate, car.x + car.w / 2 - 1, -9 + 21, car.z + sz * 17);
    CZ(0.9, 36, 6, ADORNO.mate, car.x + car.w / 2 - 1, 33, car.z);
    for (let piso = 0; piso < 2; piso++) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const bxx = car.x - 2 + sx * 12.2, bzz = car.z + sz * 9.8, byy = -9 + 11 + piso * 22.4;
      B(24, 22, 19, AZUL_CAJA, bxx, byy, bzz); B(24.4, 1.6, 19.4, 0x2d5f92, bxx, byy + 10.6, bzz);
      B(12, 7, 0.4, 'blanco', bxx, byy + 1, bzz + sz * 9.6);                       // etiqueta en la cara de fuera
    }
    cartel('envasado', 24, 6, car.x, -12.5, car.z + car.d / 2 + 0.1);
    S('carro_envasado', car.x - car.w / 2, car.x + car.w / 2 + 2, FY, 49, car.z - car.d / 2, car.z + car.d / 2, 'nave');

    /* ======================= 5. ARMARIO: zona libre, bolardos y suelo ======================= */
    franja(66, 3.2, pos.x, -3.4); franja(3.2, 27.2, pos.x - 31.6, -17); franja(3.2, 27.2, pos.x + 31.6, -17);      // la base del armario cierra el cuarto lado
    cartel('zonaLibre', 22, 5.5, pos.x, FY + 0.26, -17, 0, -PI / 2);
    for (const [bx2, bz2] of [[176, -18], [263, -12], [265, -60], [265, -92]]) {
      C(5, 90, 10, AMARILLO, bx2, FY + 45, bz2);
      for (const y of [FY + 18, FY + 46, FY + 74]) C(5.2, 9, 10, 0x15181c, bx2, y, bz2);
      e.add(kit.cono(5, 0.5, 3, 10), 0xe0b030, [bx2, FY + 91.5, bz2]); C(7.5, 1.2, 10, ADORNO.mate, bx2, FY + 0.6, bz2);
      S('bolardo', bx2 - 5.2, bx2 + 5.2, FY, FY + 93, bz2 - 5.2, bz2 + 5.2, 'nave');
    }
    // plataforma de mantenimiento móvil de tres peldaños con barandilla, junto al calentador (aparcada fuera de la franja de trabajo)
    const el = { x: 20, z: 168 }, hT = 58;
    for (const sx of [-1, 1]) {
      B(2, hT, 24, 'inox', el.x + sx * 21, FY + hT / 2, el.z - 12); B(2, 38, 12, 'inox', el.x + sx * 21, FY + 19, el.z + 6); B(2, 18, 12, 'inox', el.x + sx * 21, FY + 9, el.z + 18);
      for (const [pz] of [[el.z - 23], [el.z - 1]]) B(2.4, 92, 2.4, AMARILLO, el.x + sx * 21, FY + hT + 46, pz);
      CZ(1.3, 22, 8, AMARILLO, el.x + sx * 21, FY + hT + 88, el.z - 12); CZ(1.0, 22, 8, AMARILLO, el.x + sx * 21, FY + hT + 48, el.z - 12);
      C(3.6, 2.4, 8, NEGRO, el.x + sx * 17, FY + 3.6, el.z - 12, [0, 0, PI / 2]); C(3.6, 2.4, 8, NEGRO, el.x + sx * 17, FY + 3.6, el.z + 17, [0, 0, PI / 2]);
    }
    CX(1.3, 42, 8, AMARILLO, el.x, FY + hT + 88, el.z - 23); CX(1.0, 42, 8, AMARILLO, el.x, FY + hT + 48, el.z - 23);
    B(40, 1.8, 24, 'inox', el.x, FY + hT, el.z - 12); B(40, 1.6, 11, 'inox', el.x, FY + 38, el.z + 6); B(40, 1.6, 11, 'inox', el.x, FY + 18, el.z + 18);
    S('plataforma_mantenimiento', el.x - 23, el.x + 23, FY, FY + hT + 94, el.z - 24, el.z + 24, 'nave');

    /* ======================= 6. NAVE: pared del fondo ======================= */
    const Wz = NAVE.zPared;
    function acometida(x, yMain, tono, idRotulo, cfg = {}) {
      const zr = Wz + 22, yT = FY + yMain;
      C(2.6, yT - FY, 10, 'inox', x, (yT + FY) / 2, zr); CZ(2.6, zr - (Wz + 12), 10, 'inox', x, yT, (zr + Wz + 12) / 2); ESF(3.0, 'inox', x, yT, zr, 8);
      C(5.5, 1, 10, ADORNO.mate, x, FY + 0.5, zr);
      B(5, 9, 5, 'laton', x, FY + 70, zr); C(1.0, 3, 6, NEGRO, x, FY + 76.5, zr); B(13, 1.4, 2.2, 'rojo', x, FY + 78.2, zr);          // llave de corte con palanca
      for (const y of [FY + 64, FY + 76]) C(3.5, 1.8, 6, ADORNO.mate, x, y, zr);
      C(2.95, 5, 10, tono, x, FY + 115, zr);                                                                                    // cinta de color
      CZ(1.8, 11, 8, 'inox', x, FY + 40, zr + 6.5); CZ(2.7, 4, 8, 'laton', x, FY + 40, zr + 13.5); CZ(1.6, 1.4, 8, NEGRO, x, FY + 40, zr + 16);   // toma con racor rápido
      C(0.8, 4, 6, ADORNO.inox, x + 0, FY + 96, zr + 3.6); CZ(3.8, 2.2, 12, NEGRO, x, FY + 96, zr + 6.2); CZ(3.1, 0.5, 12, 'blanco', x, FY + 96, zr + 7.4); B(0.4, 2.6, 0.3, 'rojo', x + 0.6, FY + 96.6, zr + 7.8, [0, 0, -0.7]);   // aguja   // manómetro
      if (cfg.frl) {          // filtro, regulador y lubricador en línea, con vaso y pomo
        C(4.8, 3, 10, 'grisOscuro', x, FY + 128, zr); C(3.8, 14, 10, 'vidrio', x, FY + 119, zr + 0);
        C(4.4, 9, 10, 'grisOscuro', x, FY + 139, zr); C(2.3, 4, 8, NEGRO, x, FY + 145.5, zr);
        C(4.8, 3, 10, 'grisOscuro', x, FY + 150, zr); C(3.8, 12, 10, 0xe8a838, x, FY + 156, zr);
      }
      cartel(idRotulo, 28.8, 7.2, x + 18, FY + 84, Wz + 0.2);
    }
    acometida(-330, 194, 0x1f8a4c, 'acRed'); acometida(-290, 194, 0x2f7fc7, 'acFria'); acometida(-250, 212, 0x7fc4e4, 'acAire', { frl: true });
    // pila de acero con grifo y sifón, y desagüe de suelo sifónico
    const px = -190;
    B(60, 12, 40, 'inox', px, FY + 86, Wz + 22); B(52, 0.6, 32, 'oscuro', px, FY + 92.2, Wz + 22); B(60, 16, 2, 'inox', px, FY + 100, Wz + 1.2);
    for (const sx of [-1, 1]) B(3, 36, 3, ADORNO.mate, px + sx * 26, FY + 66, Wz + 4); S('pila', px - 30, px + 30, FY + 80, FY + 108, Wz, Wz + 42, 'nave');
    C(1.1, 12, 8, 'inox', px, FY + 98, Wz + 8); CZ(0.9, 10, 8, 'inox', px, FY + 104, Wz + 13); B(6, 1, 1.2, 'rojo', px, FY + 110.5, Wz + 8);
    C(2.0, 8, 8, ADORNO.inox, px, FY + 76, Wz + 22); e.add(kit.toro(4, 1.8, PI, 10), 'inox', [px + 4, FY + 72, Wz + 22], [0, 0, PI]);
    C(2.0, 6, 8, ADORNO.inox, px + 8, FY + 75, Wz + 22); CZ(2.0, 18, 8, ADORNO.inox, px + 8, FY + 78, Wz + 14);
    C(2.3, 78, 8, GRIS_PVC, px + 8, FY + 39, Wz + 6); C(4.4, 3, 10, GRIS_PVC, px + 8, FY + 1.5, Wz + 6);
    const dx0 = px + 40, dz0 = Wz + 55;       // sumidero sifónico de suelo
    B(32, 0.8, 32, ADORNO.mate, dx0, FY + 0.4, dz0); B(28, 0.5, 28, 0x15181c, dx0, FY + 0.7, dz0);
    for (let i = -5; i <= 5; i++) B(0.9, 0.9, 27, 'inoxMate', dx0 + i * 2.4, FY + 1.25, dz0);
    cartel('acDesague', 28.8, 7.2, px + 40, FY + 18, Wz + 0.2);
    // retorno de CIP: tubería sanitaria que sale del suelo, hace un codo y entra en la pared con unión tri-clamp y tapón
    const rx = 120, rz = Wz + 16;
    C(2.4, 56, 10, 'inox', rx, FY + 28, rz); ESF(2.9, 'inox', rx, FY + 56, rz, 8); CZ(2.4, rz - Wz - 2, 10, 'inox', rx, FY + 56, (rz + Wz + 2) / 2); C(5.5, 1, 10, ADORNO.mate, rx, FY + 0.5, rz);
    for (const y of [FY + 24]) for (const s of [-0.5, 0.5]) C(3.8, 0.5, 10, ADORNO.inox, rx, y + s, rz); C(3.5, 0.5, 10, 'blanco', rx, FY + 24, rz);
    cartel('acCip', 28.8, 7.2, rx + 20, FY + 56, Wz + 0.2);
    // cuadro de avisos, botiquín y extintor
    B(68, 52, 1.4, 0x7a6a58, -110, FY + 136, Wz + 0.7); cartel('avisos', 64, 48, -110, FY + 136, Wz + 1.5);
    B(26, 22, 8, VERDE_EQ, -40, FY + 130, Wz + 4); B(24, 1, 0.8, 'blanco', -40, FY + 130, Wz + 8.2); cartel('botiquin', 18, 18, -40, FY + 164, Wz + 0.3);
    C(7.5, 40, 12, ROJO_EXT, 30, FY + 96, Wz + 9); C(3.2, 5, 8, NEGRO, 30, FY + 118.5, Wz + 9); B(3, 4, 6, 'oscuro', 30, FY + 121.5, Wz + 9); B(12, 1.6, 2.4, 'oscuro', 33, FY + 123.2, Wz + 9);
    C(0.8, 24, 6, NEGRO, 36, FY + 108, Wz + 15); for (const y of [FY + 82, FY + 108]) B(18, 3, 2, 'oscuro', 30, y, Wz + 17.2);
    cartel('extintor', 22, 22, 30, FY + 164, Wz + 0.3);
    S('extintor', 22, 38, FY + 75, FY + 125, Wz, Wz + 19, 'nave');
    // puerta de salida de emergencia con barra antipánico y rótulo verde
    const dpx = 330;
    B(96, 192, 2, 0x8a949c, dpx, FY + 96, Wz + 1.5);
    for (const sx of [-1, 1]) B(4, 194, 4, 'grisOscuro', dpx + sx * 48.5, FY + 97, Wz + 1.5); B(101, 4, 4, 'grisOscuro', dpx, FY + 194, Wz + 1.5);
    CX(1.2, 56, 8, 'inox', dpx - 20, FY + 100, Wz + 4.4); for (const dd of [-44, 4]) B(2, 2, 3.2, ADORNO.osc, dpx + dd, FY + 100, Wz + 3);
    B(8, 22, 2.2, ADORNO.mate, dpx + 38, FY + 108, Wz + 3.6);
    cartel('salida', 48, 24, dpx, FY + 246, Wz + 0.3);
    // extractores de pared
    for (const fx of [-340, 340]) {
      CZ(30, 14, 18, 'grisOscuro', fx, FY + 300, Wz + 8); CZ(26, 1, 18, 0x15181c, fx, FY + 300, Wz + 14.8);
      for (let i = -2; i <= 2; i++) B(54, 1.2, 1.4, 'gris', fx, FY + 300 + i * 9, Wz + 15.6);
      for (let k = 0; k < 4; k++) B(24, 5, 1, 'oscuro', fx, FY + 300, Wz + 14, [0, 0, k * PI / 4 + 0.3]);
      CZ(4, 3, 10, ADORNO.osc, fx, FY + 300, Wz + 15);
      B(2, 10, 14, ADORNO.mate, fx - 34, FY + 300, Wz + 8);
    }

    /* ======================= 7. NAVE: estructura y luminarias (solo geometría) ======================= */
    const yViga = FY + 345;
    for (const zv2 of [-200, 220]) {
      B(NAVE.ancho - 20, 2, 16, 'grisOscuro', 0, yViga + 9, zv2); B(NAVE.ancho - 20, 2, 16, 'grisOscuro', 0, yViga - 9, zv2); B(NAVE.ancho - 20, 16, 1.6, 'grisOscuro', 0, yViga, zv2);
      for (const sx of [-1, 1]) { B(20, FY + 366 - FY - 0, 20, 'grisOscuro', sx * 436, (FY + FY + 366) / 2, zv2); B(34, 1.4, 34, ADORNO.mate, sx * 436, FY + 0.7, zv2); }
      S('viga_techo', -NAVE.ancho / 2, NAVE.ancho / 2, yViga - 10, yViga + 10, zv2 - 8, zv2 + 8, 'nave');
      for (const lx of [-300, -100, 100, 300]) {
        B(120, 6, 16, 'blanco', lx, yViga - 28, zv2); e.add(kit.caja(112, 1.4, 11), matLuz, [lx, yViga - 31.4, zv2]);
        for (const dx of [-40, 40]) { C(0.35, 17, 4, NEGRO, lx + dx, yViga - 17, zv2); }
      }
    }

    /* ======================= 8. SUELO: charcos, desgaste y marcas ======================= */
    const matCharco = kit.matDinamico(0x1b2c3c, { transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const matDesgaste = kit.matDinamico(0x0e1114, { transparent: true, opacity: 0.12, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mancha = (mat, x, z, ax, az, giro = 0) => e.add(new THREE.CircleGeometry(1, 10), mat, [x, FY + 0.3, z], [-PI / 2, 0, giro], [ax, az, 1]);
    for (const [x, z, a, b] of [[dx0, dz0 + 6, 14, 9], [40, 110, 10, 5], [41, 82, 6, 4], [T.x - T.r - 10, zT + 4, 8, 5], [bx + 4, zT + 14, 6, 4], [-188, Wz + 34, 9, 5], [ps[0] + 24, ps[2] + 22, 7, 4]])
      mancha(matCharco, x, z, a, b);
    let semilla = 7; const alea = () => { semilla = (semilla * 16807) % 2147483647; return semilla / 2147483647; };
    for (let i = 0; i < 18; i++) mancha(matDesgaste, -170 + alea() * 420, 84 + alea() * 46, 8 + alea() * 14, 2.5 + alea() * 3, (alea() - 0.5) * 0.3);   // pasos delante del patín
    for (let i = 0; i < 6; i++) mancha(matDesgaste, car.x - 40 + alea() * 10, car.z + (alea() - 0.5) * 30, 14 + alea() * 8, 1.6, 0);                          // ruedas del carro
    for (let i = 0; i < 6; i++) mancha(matDesgaste, dpx - 50 + alea() * 100, Wz + 20 + alea() * 30, 10 + alea() * 12, 3 + alea() * 2, (alea() - 0.5) * 0.4);   // delante de la puerta
    // flechas verdes de salida pintadas en el suelo, delante de la puerta
    const matVerde = kit.matDinamico(0x1e8f4e, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    e.add(kit.caja(4, 0.12, 60), matVerde, [dpx - 40, FY + 0.28, Wz + 40]); e.add(kit.caja(4, 0.12, 60), matVerde, [dpx + 40, FY + 0.28, Wz + 40]);

    /* ======================= Construcción de mallas ======================= */
    const mallas = e.construir(grupo, undefined);
    for (const m of mallas) sinRayo(m);
    const mallaUV = (piezas, material) => {
      if (!piezas.length) return;
      const m = sinRayo(new THREE.Mesh(reg(fusionarUV(THREE, piezas)), material)); grupo.add(m);
    };
    mallaUV(carteles, matAtlas); mallaUV(peligros, matPeligro);
    grupo.traverse(o => { if (o.isMesh) o.raycast = () => {}; });
    grupo.userData.entorno = true;
    return { grupo, elementos: {}, actualizar() {}, liberar() { kit.liberar(); }, plan, solidos, etiquetas };
  }

  const api = { crear, planificar, etiquetasTuberia, textoEtiqueta, empaquetar, celdasDe, CELDAS_FIJAS, cajasDe, solapan, distSeg3, NAVE, PASILLO, CIP, BANDEJA, FY };
  if (typeof module !== 'undefined') module.exports = api;
  else { window.PCT = window.PCT || {}; PCT.htstEntorno = api; }
})();
