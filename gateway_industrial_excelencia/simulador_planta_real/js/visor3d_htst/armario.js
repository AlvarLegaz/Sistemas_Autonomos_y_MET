// Armario eléctrico QE-001 en 3D (DISEÑADOR): envolvente de chapa RAL 7035 con puerta (cerradura, rejilla de ventilación, HMI, seta, pulsador y pilotos), placa de montaje
// naranja con carriles DIN, canaletas ranuradas con sus tapas, y dentro, colocados como en un cuadro real: seccionador QS-001, diferencial QR-001, magnetotérmico QF-201,
// fuente PS-001, fusible F-001, relé de seguridad KS, PLC-001 con sus tarjetas (un LED por canal con el estado real), variador VFD-101, contactores KM-203, KM-201 y KM-202,
// regletas de bornas X0-X4 con su numeración, barra de tierra y cables de colores (negro fuerza, azul neutro, rojo +24 V, azul oscuro 0 V, amarillo-verde tierra, naranja
// señales digitales) con bridas; mangueras que suben de los prensaestopas del fondo. Todo cuelga del grupo de QE-001, de modo que «Ver en 3D» (solo=1) lo aísla entero.
// Los LED y los pilotos salen de `estado` (ver ARQUITECTURA.md §4); las averías mueven los LED y los contactos (led_apagado, contactos_cerrados…).
// Vistas del visor: «Transparente» (por defecto) = puerta abierta; «Corte» = puerta cerrada y translúcida (se ve el interior a través); «Tapa» desactivada = sin puerta.
(function () {
  const K = typeof require !== 'undefined' ? require('./kit.js') : PCT.htstKit;
  const B = typeof require !== 'undefined' ? require('./base_equipo.js') : PCT.htstBase;
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.htstLayout;
  const PI = Math.PI;
  const TAGS = ['QE-001', 'PS-001', 'F-001', 'QF-201', 'VFD-101', 'KM-203', 'KM-201', 'KM-202', 'PLC-001', 'HMI-001', 'HL-001', 'ES-001', 'PB-001'];

  // Cuerpo del armario (cm): centro en la posición del layout; `z` es la cara delantera de la placa de montaje (respecto al centro).
  // Dispositivos: x centro, y base, ancho, alto, fondo (sobre la placa). QS-001, QR-001 y KS son piezas del armario sin ficha propia (se ven con su rótulo).
  const CUERPO = { ancho: 60, fondo: 30, alto: 140, z: -12.2 };
  const DISPOSITIVOS = {
    'QS-001': { x: -23.5, y: 117, w: 7, h: 10, d: 7 },
    'QR-001': { x: -16.5, y: 117, w: 7, h: 10, d: 6.5 },
    'QF-201': { x: -9.2, y: 117, w: 5.4, h: 10, d: 6.5 },
    'PS-001': { x: 2, y: 114, w: 12, h: 14, d: 8 },
    'F-001': { x: 12.5, y: 118, w: 3.5, h: 10, d: 6 },
    'KS': { x: 22, y: 118, w: 8, h: 10, d: 7 },
    'PLC-001': { x: 0, y: 86, w: 40, h: 18, d: 8 },
    'VFD-101': { x: -14, y: 38, w: 18, h: 36, d: 14 },
    'KM-203': { x: 2, y: 44, w: 7, h: 14, d: 9 },
    'KM-201': { x: 11, y: 44, w: 9, h: 14, d: 10 },
    'KM-202': { x: 20.5, y: 44, w: 9, h: 14, d: 10 },
  };
  const PUERTA = { giroRad: 1.75, bisagraX: 29 };      // puerta abierta unos 100°, con la bisagra a la derecha: la cara exterior mira a la cámara

  /** Posición mundo (cm) de un punto de la puerta, dado su (x, y) en el plano de la puerta (x ≤ 0: desde la bisagra hacia el borde libre) y su giro (0 = cerrada). */
  function puntoPuerta(centroX, centroZ, lx, ly, giro = PUERTA.giroRad) {
    return [centroX + PUERTA.bisagraX + lx * Math.cos(giro), ly, centroZ + CUERPO.fondo / 2 - lx * Math.sin(giro)];
  }
  /** Qué hace la puerta según la vista del visor: «Tapa» desactivada la quita; «Corte» la cierra y la hace translúcida; si no, abierta (como se ve el interior por defecto). */
  function estadoPuerta(corte, tapa) {
    if (tapa === false) return { visible: false, giro: PUERTA.giroRad, opacidad: 1 };
    return corte ? { visible: true, giro: 0, opacidad: 0.22 } : { visible: true, giro: PUERTA.giroRad, opacidad: 1 };
  }

  /* ---------- PLC: módulos y canales (funciones puras) ---------- */
  const MODULOS_PLC = [{ nombre: 'PWR', leds: 1 }, { nombre: 'CPU', leds: 3 }, { nombre: 'AI-1', leds: 8 }, { nombre: 'AI-2', leds: 8 },
    { nombre: 'DI-1', leds: 16 }, { nombre: 'DI-2', leds: 16 }, { nombre: 'DO-1', leds: 16 }, { nombre: 'AO-1', leds: 4 }];
  /** Canales del PLC tomados del mapa de señales del layout: { modulo (índice en MODULOS_PLC), tarjeta, canal (1…), led (0…), tag, tipo, direccion }. */
  function canalesPLC(lay = layout) {
    const lista = [];
    for (const s of lay.SENALES) {
      const m = /^([A-Z]{2})(\d)\.(\d+)$/.exec(s.canal);
      if (!m) continue;
      const tarjeta = `${m[1]}-${m[2]}`, modulo = MODULOS_PLC.findIndex(x => x.nombre === tarjeta), canal = Number(m[3]);
      if (modulo >= 0) lista.push({ modulo, tarjeta, canal, led: canal - 1, tag: s.tag, tipo: s.tipo, direccion: s.canal });
    }
    return lista;
  }
  const LED_APAGADO = 0x161b18, LED_REPOSO = 0x1f4a2c, LED_VERDE = 0x35e06b, LED_ROJO = 0xff3b30, LED_AMBAR = 0xffb020;
  const tension24 = estado => K.num(K.equipoDe(estado, 'PS-001').v24, K.num(K.equipoDe(estado, 'PS-001').tensionV, 24));
  /** Color del LED de un canal del PLC con el estado real: entradas por su nivel o la calidad del lazo, salidas por la orden del PLC. */
  function colorCanal(estado, canal) {
    if (!estado) return LED_REPOSO;
    if (canal.tipo === 'DI') { const n = K.instrumentoDe(estado, canal.tag).nivel; return n === 1 || n === true ? (canal.tag === 'VFD-101' ? LED_ROJO : LED_VERDE) : LED_REPOSO; }
    if (canal.tipo === 'DO') return estado.salidasPLC && estado.salidasPLC.DO && estado.salidasPLC.DO[canal.tag] ? LED_VERDE : LED_REPOSO;
    if (canal.tipo === 'AO') return K.num(estado.salidasPLC && estado.salidasPLC.AO && estado.salidasPLC.AO[canal.tag], 0) > 0 ? LED_VERDE : LED_REPOSO;
    const i = K.instrumentoDe(estado, canal.tag);
    return i.calidad === undefined && i.mA === undefined ? LED_REPOSO : K.colorLedCalidad(i.calidad);
  }
  /** LED de los módulos PWR y CPU (RUN, error y comunicación) según la tensión de 24 V. */
  function colorLedsCentrales(estado) {
    const v = estado ? tension24(estado) : 24, sana = !!estado && v >= 21;
    return { pwr: sana ? LED_VERDE : v > 1 ? LED_AMBAR : LED_APAGADO, run: sana ? LED_VERDE : LED_APAGADO, err: sana ? LED_APAGADO : LED_ROJO, com: sana ? LED_VERDE : LED_APAGADO };
  }

  /* ---------- bornas (función pura) ---------- */
  const GRUPOS_BORNAS = [
    { grupo: 'X0', nombre: 'acometida 400 V', bornas: ['L1', 'L2', 'L3', 'N', 'PE'] },
    { grupo: 'X1', nombre: '230 V y 24 V', bornas: ['230 V', 'N', '+24V', '0V', 'PE'] },
    { grupo: 'X2', nombre: 'potencia a motores y resistencias', bornas: ['U', 'V', 'W', 'PE', 'U', 'V', 'W', 'PE', 'L1', 'L2', 'L3', 'L1', 'L2', 'L3'] },
    { grupo: 'X3', nombre: 'lazos 4-20 mA', bornas: Array.from({ length: 20 }, (_, i) => (i % 2 ? '-' : '+')) },
    { grupo: 'X4', nombre: 'señales digitales de campo', bornas: Array.from({ length: 12 }, (_, i) => String(i + 1)) },
  ];
  const PASO_BORNA = 0.8, HUECO_GRUPO = 1.6, X_INICIO_BORNAS = -27;
  /** Todas las bornas con su posición x y su número (X1.3 = +24 V, como en los puntos de medida): [{ grupo, numero, etiqueta, funcion, x }]. */
  function listaBornas() {
    const r = []; let x = X_INICIO_BORNAS;
    for (const g of GRUPOS_BORNAS) {
      g.bornas.forEach((f, i) => { r.push({ grupo: g.grupo, numero: i + 1, etiqueta: `${g.grupo}.${i + 1}`, funcion: f, x: x + PASO_BORNA / 2 }); x += PASO_BORNA; });
      x += HUECO_GRUPO;
    }
    return r;
  }
  const xBorna = (grupo, numero) => listaBornas().find(b => b.grupo === grupo && b.numero === numero).x;

  /* ---------- HMI, pilotos y relé de seguridad (funciones puras) ---------- */
  const setaRearmada = estado => { const s = K.equipoDe(estado, 'ES-001'); return s.rearmado !== undefined ? !!s.rearmado : !s.pulsado && K.instrumentoDe(estado, 'ES-001').nivel !== 0; };
  /** El relé de seguridad KS (Mando) cierra con la seta rearmada y 24 V. */
  const ksCerrado = estado => !!estado && setaRearmada(estado) && tension24(estado) >= 21 && !K.equipoDe(estado, 'F-001').fundido;
  /** Pilotos de la puerta: mando (24 V tras el fusible), marcha (alguna bomba en marcha), fallo (alarmas) y manual. */
  function estadoPilotos(estado) {
    const alarmas = estado && estado.alarmas ? estado.alarmas.length : 0;
    return { mando: !!estado && tension24(estado) >= 21 && !K.equipoDe(estado, 'F-001').fundido, marcha: !!K.equipoDe(estado, 'P-101').marcha || !!K.equipoDe(estado, 'P-201').marcha,
      fallo: alarmas > 0, manual: !!estado && estado.modo === 'MANUAL' };
  }
  /** Líneas de la pantalla HMI-001 (cabecera, medidas y alarma). */
  function textoHMI(estado) {
    const modo = estado && layout.MODOS_INFO[estado.modo] ? layout.MODOS_INFO[estado.modo].nombre : '—';
    const alarmas = estado && estado.alarmas ? estado.alarmas.length : 0;
    const fdv = estado ? (K.aperturaFDV(estado) > 0.5 ? 'AVANCE' : 'DESVÍO') : '—';
    const f1 = x => x.toFixed(1).replace('.', ',');
    return { titulo: `${layout.PLANTA.corto} · ${modo.toUpperCase()}`,
      lineas: [`TT-103  ${f1(K.temperaturaDe(estado, 'salidaTubo', 20))} °C`, `Caudal  ${Math.round(K.caudalLh(estado))} L/h`, `FDV  ${fdv}`], alarma: alarmas ? `${alarmas} ALARMA${alarmas > 1 ? 'S' : ''}` : 'SIN ALARMAS', hayAlarma: alarmas > 0 };
  }
  /** Texto de la pantalla del variador: frecuencia de salida, STOP o FALLO. */
  function textoVFD(estado) {
    const v = K.equipoDe(estado, 'VFD-101'), p = K.equipoDe(estado, 'P-101');
    if (v.fallo) return 'FALLO';
    if (!v.marcha) return 'STOP';
    return `${(50 * K.limitar(K.num(p.velocidadPct, 100), 0, 100) / 100).toFixed(1).replace('.', ',')} Hz`;
  }

  /* ---------- rótulos (texto en láminas con atlas de una sola textura) ---------- */
  const TEXTOS_ROTULO = ['QS-001', 'QR-001', 'QF-201', 'PS-001', 'F-001', 'KS', 'PLC-001', 'VFD-101', 'KM-201', 'KM-202', 'KM-203', 'X0', 'X1', 'X2', 'X3', 'X4', 'PE',
    'PWR', 'CPU', 'AI-1', 'AI-2', 'DI-1', 'DI-2', 'DO-1', 'AO-1', '24 V', 'MARCHA', 'FALLO', 'MANUAL', 'PARO EMERGENCIA', 'MARCHA / RESET', 'PELIGRO 400 V', 'QE-001',
    'ESQUEMAS', 'HMI-001', 'ES-001', 'PB-001', 'HL-001', '+24V', '0V', 'L1', 'L2', 'L3', 'N', 'RAL 7035', 'DC OK', 'RUN', 'ERR', 'COM'].concat(Array.from({ length: 20 }, (_, i) => String(i + 1)));
  const ESTILO_ROTULO = { 'PELIGRO 400 V': ['#f2c200', '#15181c'], 'PARO EMERGENCIA': ['#f2c200', '#15181c'], 'PE': ['#cdd23a', '#15181c'], '24 V': ['#f4f4ee', '#15181c'] };

  function crearAtlas(THREE, kit) {
    if (typeof document === 'undefined') return null;
    const col = 8, filas = Math.ceil(TEXTOS_ROTULO.length / col), cw = 256, ch = 64;
    const c = document.createElement('canvas'); c.width = col * cw; c.height = filas * ch;
    const g = c.getContext('2d'), indice = new Map();
    TEXTOS_ROTULO.forEach((t, i) => {
      indice.set(t, i);
      const x = (i % col) * cw, y = Math.floor(i / col) * ch, [fondo, tinta] = ESTILO_ROTULO[t] || ['#eeeee6', '#15181c'];
      g.fillStyle = fondo; g.fillRect(x, y, cw, ch); g.strokeStyle = '#7a8086'; g.lineWidth = 3; g.strokeRect(x + 1.5, y + 1.5, cw - 3, ch - 3);
      g.fillStyle = tinta; g.textAlign = 'center'; g.textBaseline = 'middle';
      let tam = 46; do { g.font = `700 ${tam}px system-ui, sans-serif`; tam -= 2; } while (g.measureText(t).width > cw - 20 && tam > 12);
      g.fillText(t, x + cw / 2, y + ch / 2 + 2);
    });
    const textura = kit.registrar(new THREE.CanvasTexture(c)); textura.colorSpace = THREE.SRGBColorSpace;
    const material = kit.registrar(new THREE.MeshBasicMaterial({ map: textura }));
    return { material, col, filas, indice };
  }
  /** Láminas de texto de un padre: poner(texto, x, y, z, ancho, alto, cara) acumula; construir() crea una sola malla. cara = -1 la gira hacia -z. */
  function lienzoRotulos(atlas, THREE, kit, padre, id) {
    const pos = [], uv = [], idx = [];
    return {
      poner(texto, x, y, z, w, h, cara = 1) {
        if (!atlas || !atlas.indice.has(texto)) return;
        const i = atlas.indice.get(texto), c = i % atlas.col, f = Math.floor(i / atlas.col);
        const u0 = c / atlas.col, u1 = (c + 1) / atlas.col, v0 = 1 - (f + 1) / atlas.filas, v1 = 1 - f / atlas.filas, n = pos.length / 3;
        const xs = cara > 0 ? [-1, 1, 1, -1] : [1, -1, -1, 1];
        for (let k = 0; k < 4; k++) { pos.push(x + xs[k] * w / 2, y + (k < 2 ? -h / 2 : h / 2), z); uv.push(k === 0 || k === 3 ? u0 : u1, k < 2 ? v0 : v1); }
        idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
      },
      construir() {
        if (!pos.length) return null;
        const g = kit.registrar(new THREE.BufferGeometry());
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
        const m = new THREE.Mesh(g, atlas.material); m.userData.id = id; padre.add(m); return m;
      },
    };
  }
  /** Pantalla dinámica (lienzo 2D como textura): devuelve { g, ancho, alto, textura } o null si no hay DOM. */
  function crearPantalla(THREE, kit, ancho, alto) {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas'); c.width = ancho; c.height = alto;
    const textura = kit.registrar(new THREE.CanvasTexture(c)); textura.colorSpace = THREE.SRGBColorSpace;
    return { g: c.getContext('2d'), ancho, alto, textura, material: kit.registrar(new THREE.MeshBasicMaterial({ map: textura })) };
  }
  /** Textura de la canaleta ranurada: dedos de chapa y ranuras transparentes (se repite a lo largo con las UV). */
  function texturaRanuras(THREE, kit) {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas'); c.width = 64; c.height = 16;
    const g = c.getContext('2d'); g.fillStyle = '#b9bfc3'; g.fillRect(0, 0, 40, 16); g.fillStyle = '#9ea5aa'; g.fillRect(0, 0, 40, 3); g.fillRect(0, 13, 40, 3);
    const t = kit.registrar(new THREE.CanvasTexture(c)); t.wrapS = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  const COLOR = { fuerza: 0x23272c, neutro: 0x2e7fd6, mas24: 0xd02a2a, cero24: 0x1b3f9a, tierra: 0xe0b030, tierraRaya: 0x2f9e44, senal: 0xdcdcdc, digital: 0xe8863a, cobre: 0xb87333,
    ral: 0xcdd1d2, ralOscuro: 0xb4b9bb, canaleta: 0xb9bfc3, interior: 0x6a7176, tapa: 0xd3d7d9 };

  function crear(THREE) {
    const kit = K.crearKit(THREE);
    const base = B.crearBase(kit);
    const pos = layout.posicion('QE-001');
    const CX = pos.x, CZ = pos.z, PZ = CUERPO.z, A = CUERPO.ancho / 2, Z0 = CUERPO.fondo / 2, H = CUERPO.alto;
    const atlas = crearAtlas(THREE, kit);
    const qe = new THREE.Group(); qe.position.set(CX, 0, CZ); base.grupo.add(qe);
    const rotulosQE = lienzoRotulos(atlas, THREE, kit, qe, 'QE-001');
    const zDispositivo = d => PZ + d / 2;
    const dispositivo = tag => {
      const d = DISPOSITIVOS[tag], g = new THREE.Group();
      g.position.set(d.x, d.y, zDispositivo(d.d)); qe.add(g); return { g, d };
    };
    /** Registra un elemento seleccionable que cuelga del armario: el ancla (etiqueta) va en coordenadas del mundo. */
    const registrarDentro = (tag, g, tamano, alturaAncla) => {
      const el = base.registrar(tag, g, tamano, alturaAncla); el.ancla.set(CX + g.position.x, alturaAncla !== undefined ? alturaAncla : tamano[1] + 8, CZ + g.position.z); return el;
    };
    /** Rótulo de un dispositivo debajo de él. */
    const rotuloDe = (tag, arriba) => { const d = DISPOSITIVOS[tag], w = Math.min(7, Math.max(4, d.w)); rotulosQE.poner(tag, d.x, arriba ? d.y + d.h + 1.2 : d.y - 1.4, PZ + 0.5, w, w / 4, 1); };

    /* =============== QE-001: envolvente, placa, carriles, canaletas, bornas, cables =============== */
    const e = kit.ensamble();
    const caja = (w, h, d, clave, x, y, z) => e.add(kit.caja(w, h, d), clave, [x, y, z]);
    const cilindro = (r, h, seg, clave, x, y, z, rot) => e.add(kit.cil(r, h, seg), clave, [x, y, z], rot || [0, 0, 0]);
    // envolvente (chapa RAL 7035): zócalo, fondo, laterales, techo y reborde delantero (donde cierra la puerta)
    caja(CUERPO.ancho, 4, CUERPO.fondo, 'oscuro', 0, 2, 0);
    caja(CUERPO.ancho, H, 2, COLOR.ral, 0, H / 2, -Z0 + 1);
    for (const s of [-1, 1]) caja(2, H, CUERPO.fondo, COLOR.ral, s * (A - 1), H / 2, 0);
    caja(CUERPO.ancho + 1.6, 2.4, CUERPO.fondo + 1.6, COLOR.ral, 0, H - 0.2, 0);                                      // techo con pequeño vuelo
    for (const s of [-1, 1]) caja(2.4, H - 6, 1.2, COLOR.ralOscuro, s * (A - 1.2), H / 2 + 1, Z0 - 0.8);              // reborde de la puerta (lados)
    caja(CUERPO.ancho - 4, 2.4, 1.2, COLOR.ralOscuro, 0, H - 2.4, Z0 - 0.8); caja(CUERPO.ancho - 4, 2.4, 1.2, COLOR.ralOscuro, 0, 5.4, Z0 - 0.8);
    caja(CUERPO.ancho - 2, 0.9, CUERPO.fondo - 2, 'gris', 0, 4.4, 0);                                                  // placa pasacables del fondo
    for (const s of [-1, 1]) caja(1.4, 1.4, 1.4, COLOR.ralOscuro, s * (A - 4), H + 1.7, -Z0 + 4);                       // cáncamos de elevación (base)
    // ventilación del lateral izquierdo: marco, lamas inclinadas y filtro
    caja(1.2, 16, 13, 'oscuro', -A - 0.5, 32, 0);
    for (let i = 0; i < 7; i++) e.add(kit.caja(1.0, 0.8, 11.4), 'grisOscuro', [-A - 1.1, 26.4 + i * 1.9, 0], [0, 0, 0.55]);
    // placa de montaje naranja y carriles DIN
    caja(2 * A, H - 12, 0.8, 'naranja', 0, 8 + (H - 12) / 2, PZ - 0.4);
    for (const y of [122, 95, 51]) { caja(2 * A - 2, 3.5, 0.7, 'inoxMate', 0, y, PZ + 0.35); caja(2 * A - 2, 0.5, 0.2, 'oscuro', 0, y, PZ + 0.75); }
    // carril de bornas (A) y barra de tierra
    const bornas = listaBornas(), yBor = 14, hBor = 8;
    caja(2 * A - 2, 3.5, 0.7, 'inoxMate', 0, yBor + hBor / 2, PZ + 0.35);
    for (const b of bornas) {
      const pe = b.funcion === 'PE', color = pe ? 'amarillo' : b.funcion === 'N' ? 0x4aa3e0 : b.funcion === '+24V' ? 'rojo' : b.funcion === '0V' ? 'azul' : b.grupo === 'X0' || b.grupo === 'X2' ? 0xa7adb2 : 0xc7ccd0;
      caja(PASO_BORNA - 0.06, hBor, 4.4, color, b.x, yBor + hBor / 2, PZ + 2.2);
      if (pe) caja(PASO_BORNA - 0.3, 0.9, 0.2, 'verde', b.x, yBor + hBor - 1.2, PZ + 4.45);
      caja(0.45, 0.45, 0.25, 'oscuro', b.x, yBor + hBor - 1.8, PZ + 4.5);                                              // tornillo
      caja(0.4, 0.45, 0.25, 'oscuro', b.x, yBor + 1.8, PZ + 4.5);                                                      // entrada del cable
    }
    for (const g of GRUPOS_BORNAS) {                                                                                    // topes de cada grupo
      const xs = bornas.filter(b => b.grupo === g.grupo).map(b => b.x), a = Math.min(...xs) - PASO_BORNA / 2 - 0.25, z = Math.max(...xs) + PASO_BORNA / 2 + 0.25;
      caja(0.5, hBor + 0.6, 4.6, 'negro', a, yBor + hBor / 2, PZ + 2.3); caja(0.5, hBor + 0.6, 4.6, 'negro', z, yBor + hBor / 2, PZ + 2.3);
      rotulosQE.poner(g.grupo, (a + z) / 2, yBor + hBor + 1.2, PZ + 1.0, Math.min(3.6, Math.max(1.6, z - a)), 0.9, 1);
    }
    // numeración de las bornas: la impresión sale sobre la regleta
    for (const b of bornas) if (b.numero <= 20) rotulosQE.poner(String(b.numero), b.x, yBor - 0.9, PZ + 4.6, 0.78, 0.4, 1);
    // barra de tierra (cobre) con sus tornillos y el cable amarillo-verde que la une a X0
    caja(40, 1.4, 0.8, COLOR.cobre, 0, 10.2, PZ + 0.8); for (let i = 0; i < 14; i++) cilindro(0.35, 0.7, 6, 'inox', -19 + i * 2.9, 10.2, PZ + 1.5, [PI / 2, 0, 0]);
    rotulosQE.poner('PE', 23.5, 10.2, PZ + 0.6, 3.2, 0.8, 1);

    // canaletas ranuradas: fondo, paredes, bridas con ranuras (textura con transparencia) y tapas (parciales, para ver los cables)
    const ranuras = texturaRanuras(THREE, kit);
    const matRanura = ranuras ? kit.registrar(new THREE.MeshLambertMaterial({ map: ranuras, alphaTest: 0.5, side: THREE.DoubleSide })) : null;
    const ductos = [
      { id: 'V1', x: -26, y: 74, w: 3.4, h: 76, vertical: true, tapa: [92, 112] }, { id: 'V2', x: 26.5, y: 74, w: 3, h: 76, vertical: true, tapa: [36, 64] },
      { id: 'D1', x: 0.35, y: 109, w: 49.3, h: 6, tapa: [6, 25] }, { id: 'D2', x: 0.35, y: 80, w: 49.3, h: 9, tapa: [-24, -17.5] }, { id: 'D3', x: 0, y: 30, w: 54, h: 10, tapa: [14, 27] },
    ];
    for (const d of ductos) {
      const largo = d.vertical ? d.h : d.w, ancho = d.vertical ? d.w : d.h, profundidad = 4;
      caja(d.vertical ? d.w : d.w, d.vertical ? d.h : d.h, 0.3, COLOR.interior, d.x, d.y, PZ + 0.15);                // fondo de la canaleta
      const lados = d.vertical ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]];
      for (const [sx, sy] of lados) caja(d.vertical ? 0.25 : d.w, d.vertical ? d.h : 0.25, profundidad, COLOR.canaleta, d.x + sx * (ancho / 2 - 0.12), d.y + sy * (ancho / 2 - 0.12), PZ + profundidad / 2);
      if (matRanura) for (const s of [-1, 1]) {                                                                         // brida ranurada de cada lado
        const g = new THREE.PlaneGeometry(largo, 1.5), uvs = g.attributes.uv; for (let i = 0; i < uvs.count; i++) uvs.setX(i, uvs.getX(i) * largo / 1.1);
        if (d.vertical) g.rotateZ(PI / 2);
        const m = new THREE.Mesh(kit.registrar(g), matRanura); m.userData.id = 'QE-001';
        m.position.set(d.x + (d.vertical ? s * (ancho / 2 - 0.9) : 0), d.y + (d.vertical ? 0 : s * (ancho / 2 - 0.9)), PZ + profundidad - 0.05); qe.add(m);
      }
      const t = d.tapa, mitad = (t[0] + t[1]) / 2, larg = t[1] - t[0];                                                // tapa parcial
      if (d.vertical) caja(d.w - 0.2, larg, 0.4, COLOR.tapa, d.x, mitad, PZ + profundidad + 0.2); else caja(larg, d.h - 0.2, 0.4, COLOR.tapa, mitad, d.y, PZ + profundidad + 0.2);
    }

    // cables (hilos): cajas finas siguiendo la poligonal (x, y) en el plano de la placa; las esquinas se solapan medio grosor para no dejar huecos
    const zHilo = PZ + 1.0;
    function hilo(color, pts, grosor = 0.34, dz = 0, raya) {
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], largo = Math.hypot(x1 - x0, y1 - y0) + grosor;
        if (largo < grosor + 1e-6) continue;
        e.add(kit.caja(largo, grosor, grosor), color, [(x0 + x1) / 2, (y0 + y1) / 2, zHilo + dz], [0, 0, Math.atan2(y1 - y0, x1 - x0)]);
        if (raya) e.add(kit.caja(largo, grosor * 0.4, grosor * 1.05), raya, [(x0 + x1) / 2, (y0 + y1) / 2, zHilo + dz], [0, 0, Math.atan2(y1 - y0, x1 - x0)]);
      }
    }
    const F = COLOR.fuerza;
    // acometida: X0 (L1, L2, L3, N) sube por la canaleta vertical izquierda hasta el seccionador QS-001
    for (let i = 0; i < 4; i++) {
      const xt = xBorna('X0', i + 1), xl = -27.1 + i * 0.55, jy = 24.2 + i * 0.4, xq = -25.6 + i * 1.6, yq = 113.6 + i * 0.5;
      hilo(i < 3 ? F : COLOR.neutro, [[xt, yBor + hBor + 0.3], [xt, jy], [xl, jy], [xl, yq], [xq, yq], [xq, 117]], 0.34, i * 0.1);
    }
    // peines de conexión (cobre aislado) entre QS-001, QR-001 y QF-201
    caja(12.6, 0.7, 0.7, COLOR.cobre, -19.5, 128.4, PZ + 3.5); caja(9.2, 0.7, 0.7, COLOR.cobre, -11.4, 129.6, PZ + 4.8);
    for (let i = 0; i < 4; i++) { caja(0.45, 1.6, 0.45, COLOR.cobre, -25.6 + i * 1.6, 127.8, PZ + 3.5); caja(0.45, 1.6, 0.45, COLOR.cobre, -18.6 + i * 1.6, 127.8, PZ + 3.5); }
    for (const x of [-15.4, -13.8, -11.2, -9.2, -7.2]) caja(0.45, 2.7, 0.45, COLOR.cobre, x, 128.3, PZ + 4.8);
    // QF-201 → derivaciones (KM-203, KM-201, KM-202 y variador): 12 hilos por V2 y las canaletas D1 y D2
    const ramales = [[2, 58.6, 2], [11, 58.6, 2.8], [20.5, 58.6, 2.8], [-14, 74.6, 3]];
    for (let b = 0; b < 4; b++) for (let p = 0; p < 3; p++) {
      const k = b * 3 + p, xq = -11.2 + 2 * p, [cx, ytop, paso] = ramales[b], xt = cx + (p - 1) * paso;
      hilo(F, [[xq, 117], [xq, 111.6 - 0.42 * k], [25.2 + 0.2 * k, 111.6 - 0.42 * k], [25.2 + 0.2 * k, 83.8 - 0.4 * k], [xt, 83.8 - 0.4 * k], [xt, ytop]], 0.34, (k % 3) * 0.12);
    }
    // QR-001 → PS-001 (230 V: fase y neutro)
    hilo(F, [[-18.6, 117], [-18.6, 115.4], [-2.4, 115.4], [-2.4, 114]], 0.34, 0.3); hilo(COLOR.neutro, [[-13.8, 117], [-13.8, 114.7], [-0.4, 114.7], [-0.4, 114]], 0.34, 0.4);
    // 24 V: PS-001 → F-001 → PLC-001 y 0 V al PLC-001
    hilo(COLOR.mas24, [[3.8, 114], [3.8, 113.2], [11.5, 113.2], [11.5, 118]]); hilo(COLOR.mas24, [[13.5, 118], [13.5, 106.5], [-17.4, 106.5], [-17.4, 104.6]], 0.34, 0.2);
    hilo(COLOR.cero24, [[5.8, 114], [5.8, 106.1], [-16.2, 106.1], [-16.2, 104.6]], 0.34, 0.3);
    hilo(COLOR.mas24, [[16, 118], [16, 112.6], [19.5, 112.6], [19.5, 118]], 0.34, 0.2);                                // puente de 24 V hacia el relé de seguridad KS
    // PLC-001 → bobinas de los contactores (naranja), 0 V común y contactos auxiliares de realimentación
    const aA1 = [2 - 2.5, 11 - 3.5, 20.5 - 3.5], aA2 = [2 + 2.5, 11 + 3.5, 20.5 + 3.5], aux = [2, 11, 20.5], xDO = [10.5, 12, 13.5], xDI = [1.4, 2.4, 3.4];
    for (let i = 0; i < 3; i++) {
      hilo(COLOR.digital, [[xDO[i], 86], [xDO[i], 78.6 - 0.35 * i], [aA1[i], 78.6 - 0.35 * i], [aA1[i], 58.8]], 0.3, 0.1 * i);
      hilo(COLOR.cero24, [[aA2[i], 58.8], [aA2[i], 77.5], [-16.8, 77.5], [-16.8, 86]], 0.3, 0.1 * i);
      hilo(COLOR.digital, [[xDI[i], 86], [xDI[i], 77.2 - 0.3 * i], [aux[i] + 1.5, 77.2 - 0.3 * i], [aux[i] + 1.5, 58.8]], 0.3, 0.05 + 0.1 * i);
    }
    // salidas de potencia: contactores y variador → X2 (P-101: U V W; P-201: U V W; banco 1 y banco 2: L1 L2 L3)
    const salidas = [[-17, -14, -11, 38, 1], [0, 2, 4, 44, 5], [8.2, 11, 13.8, 44, 9], [17.7, 20.5, 23.3, 44, 12]];
    let m = 0;
    for (const [x0, x1, x2, yb, n0] of salidas) for (let i = 0; i < 3; i++) {
      const xk = [x0, x1, x2][i], ly = 31.2 - 0.4 * m, xt = xBorna('X2', n0 + i), jy = ly;
      hilo(F, [[xk, yb], [xk, jy], [xt, jy], [xt, yBor + hBor + 0.3]], 0.34, 0.1 * (m % 3)); m++;
    }
    // señales de campo: manguera negra (espiral) que baja por V1 y se abre en X3 y X4 con hilos blancos y naranjas
    const manguera = (x0, y0, x1, y1, g = 1.1) => { e.add(kit.caja(Math.hypot(x1 - x0, y1 - y0) + g, g, g), 'negro', [(x0 + x1) / 2, (y0 + y1) / 2, zHilo + 0.1], [0, 0, Math.atan2(y1 - y0, x1 - x0)]); };
    manguera(-7.2, 86, -7.2, 76.0); manguera(-7.2, 76.0, -24.9, 76.0); manguera(-24.9, 76.0, -24.9, 33.4); manguera(-24.9, 33.4, 19.4, 33.4); manguera(5, 33.4, 5, 26.4); manguera(19.4, 33.4, 19.4, 26.4);
    for (let i = 0; i < 6; i++) { const xt = xBorna('X3', 3 + i * 2); hilo(i % 2 ? COLOR.senal : COLOR.digital, [[5 + (i - 2.5) * 0.4, 26.4], [5 + (i - 2.5) * 0.4, 24.6], [xt, 24.6], [xt, yBor + hBor + 0.3]], 0.26, 0.05 * i); }
    for (let i = 0; i < 5; i++) { const xt = xBorna('X4', 2 + i * 2); hilo(COLOR.digital, [[19.4 + (i - 2) * 0.35, 26.4], [19.4 + (i - 2) * 0.35, 24.4], [xt, 24.4], [xt, yBor + hBor + 0.3]], 0.26, 0.05 * i); }
    // tierra (amarillo-verde): X0.PE → barra de tierra → pasador de la pared lateral
    hilo(COLOR.tierra, [[xBorna('X0', 5), yBor - 0.2], [xBorna('X0', 5), 10.8], [-19.5, 10.8]], 0.4, 0.4, COLOR.tierraRaya); hilo(COLOR.tierra, [[19.5, 10.2], [26.5, 10.2], [26.5, 14]], 0.4, 0.4, COLOR.tierraRaya);
    cilindro(0.7, 1.4, 8, 'inox', 26.5, 14.4, PZ + 1.8, [PI / 2, 0, 0]);
    // bridas de plástico sobre las mangueras y los haces de hilos
    for (const [x, y, hor] of [[-24.9, 40, 1], [-24.9, 50, 1], [-24.9, 60, 1], [-24.9, 70, 1], [-7.2, 82, 1], [-14, 33.4, 0], [-4, 33.4, 0], [12, 33.4, 0], [-26.2, 90, 1], [-26.2, 100, 1], [26.4, 70, 1], [26.4, 95, 1]])
      e.add(kit.caja(hor ? 2.0 : 0.35, hor ? 0.35 : 2.0, 0.5), 'blanco', [x, y, zHilo + 0.55]);
    // prensaestopas y mangueras que suben del fondo hasta cada regleta (acometida, motores y resistencias, lazos 4-20 mA y señales digitales)
    const cables = [[-25, 1.0, 'negro', 6], [-14.5, 0.85, 'negro', 5], [-11.5, 0.85, 'negro', 5], [-8.5, 0.7, 'negro', 5], [-6.2, 0.7, 'negro', 5], [1, 0.6, 0x74797e, 5], [5, 0.6, 0x74797e, 5], [9, 0.6, 0x74797e, 5], [16, 0.55, 0x74797e, 5], [21, 0.55, 0x74797e, 5]];
    for (const [x, r, color, gz] of cables) {
      const zc = PZ + 4.6 + gz * 0.4;
      cilindro(r + 0.55, 1.2, 8, 'grisOscuro', x, 5.6, zc); cilindro(r + 0.8, 0.5, 6, 'grisOscuro', x, 4.9, zc);                                 // prensaestopas y contratuerca
      cilindro(r, yBor - 5.6, 8, color, x, 5.6 + (yBor - 5.6) / 2 + 0.6, zc);                                                                  // manguera
      e.add(kit.caja(2 * r, 2 * r, zc - PZ - 2.0), color, [x, yBor - 0.8, (zc + PZ + 2.0) / 2]);                                                // la manguera se dobla hacia la regleta
    }
    rotulosQE.poner('RAL 7035', -A + 6, 135, -Z0 + 1.7, 5, 1.25, 1);
    e.construir(qe, 'QE-001');
    base.registrar('QE-001', qe, [CUERPO.ancho + 8, CUERPO.alto, CUERPO.fondo + 4], CUERPO.alto + 8);

    /* =============== puerta: pivote en la bisagra derecha, con HMI, seta, pulsador, pilotos, manilla y rejilla =============== */
    const pivote = new THREE.Group(); pivote.position.set(PUERTA.bisagraX, 0, Z0); pivote.rotation.y = PUERTA.giroRad; qe.add(pivote);
    const matPuerta = kit.matDinamico(COLOR.ral);
    const ep = kit.ensamble(), cp = (w, h, d, clave, x, y, z) => ep.add(kit.caja(w, h, d), clave, [x, y, z]);
    cp(58, H - 2, 2, matPuerta, -29, H / 2, 1);                                                                           // hoja de la puerta (cara interior en z = 0)
    cp(58, 1.6, 2.5, COLOR.ralOscuro, -29, H - 2.2, 1.1); cp(58, 1.6, 2.5, COLOR.ralOscuro, -29, 2.2, 1.1);              // pliegues de refuerzo
    cp(54, 1.2, 0.5, 'negro', -29, 6, -0.2); cp(54, 1.2, 0.5, 'negro', -29, H - 6, -0.2); cp(1.2, H - 12, 0.5, 'negro', -3, H / 2, -0.2); cp(1.2, H - 12, 0.5, 'negro', -55, H / 2, -0.2);   // junta de goma
    for (const y of [14, 70, 126]) { ep.add(kit.cil(1.0, 8, 8), 'inoxMate', [1.2, y, 1.4]); cp(3.4, 8, 0.5, 'inoxMate', -0.4, y, 0.4); }                          // bisagras
    // cierre de tres puntos: manilla de cuarto de vuelta en el borde libre, con las varillas y los pestillos por dentro
    cp(4.6, 11, 0.6, 'grisOscuro', -52, 70, 2.3); cp(2.2, 8, 1.4, 'negro', -52, 70, 3.2); ep.add(kit.cil(1.0, 0.8, 10), 'inox', [-52, 76.4, 2.7], [PI / 2, 0, 0]);
    cp(0.6, H - 20, 0.6, 'inox', -51, H / 2, -0.7); cp(3, 1, 0.6, 'inox', -50, H - 8, -0.7); cp(3, 1, 0.6, 'inox', -50, 8, -0.7);
    // rejilla de ventilación con filtro, abajo
    cp(20, 11, 0.6, 'oscuro', -30, 17, 2.3); for (let i = 0; i < 5; i++) ep.add(kit.caja(17.5, 0.9, 0.7), 'grisOscuro', [-30, 13.2 + i * 1.9, 2.7], [-0.5, 0, 0]);
    // bolsillo de esquemas y placa de peligro eléctrico por dentro
    cp(22, 28, 0.8, 'blanco', -29, 104, -0.6); cp(22, 1.2, 1.2, COLOR.ralOscuro, -29, 90.6, -0.8);
    ep.construir(pivote, 'QE-001');
    const rotulosPuerta = lienzoRotulos(atlas, THREE, kit, pivote, 'QE-001');
    rotulosPuerta.poner('PELIGRO 400 V', -29, 134, 2.4, 14, 3.5, 1); rotulosPuerta.poner('QE-001', -29, 123, 2.4, 10, 2.5, 1); rotulosPuerta.poner('ESQUEMAS', -29, 104, -1.05, 12, 3, -1);
    rotulosPuerta.poner('PARO EMERGENCIA', -16, 62.6, 2.4, 11, 2.7, 1); rotulosPuerta.poner('MARCHA / RESET', -42, 62.6, 2.4, 9, 2.25, 1);
    // cable de tierra trenzado que une la puerta con el cuerpo (sigue a la puerta)
    const matTierra = kit.matDinamico(COLOR.tierra);
    let trenza = null;
    function ponerTrenza() {
      if (trenza) { qe.remove(trenza); trenza.geometry.dispose(); }
      const g = pivote.rotation.y, c = Math.cos(g), s = Math.sin(g), pt = (lx, ly, lz) => new THREE.Vector3(PUERTA.bisagraX + lx * c + lz * s, ly, Z0 - lx * s + lz * c);
      const a = pt(-3.5, 24, -0.4), z = new THREE.Vector3(A - 2.6, 24, Z0 - 3), medio = a.clone().lerp(z, 0.5); medio.y -= 6; medio.x -= 0.8 * 0; medio.z += 0;
      trenza = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a, medio, z]), 12, 0.32, 5, false), matTierra); trenza.userData.id = 'QE-001'; trenza.raycast = () => {}; qe.add(trenza);
    }
    ponerTrenza(); kit.malla(kit.cil(0.6, 1.2, 6), kit.mat('inox'), qe, 'QE-001', [A - 2.4, 24, Z0 - 3], [0, 0, PI / 2]);
    const anclasPuerta = [];
    const sobrePuerta = (tag, lx, ly, tamano) => {
      const gp = new THREE.Group(); gp.position.set(lx, ly, 2); pivote.add(gp);
      const el = base.registrar(tag, gp, tamano);
      anclasPuerta.push(() => el.ancla.set(...puntoPuerta(CX, CZ, lx, ly + tamano[1] + 8, pivote.rotation.y)));
      anclasPuerta.at(-1)();
      return gp;
    };

    // HMI-001: marco, pantalla con las lecturas reales (se repinta a 2 Hz como mucho) y teclas
    const hmi = sobrePuerta('HMI-001', -29, 100, [28, 20, 3]);
    const eh = kit.ensamble(); eh.add(kit.caja(28, 20, 1.6), 'negro', [0, 0, 0.8]); for (let i = 0; i < 4; i++) eh.add(kit.caja(3.2, 1.2, 0.4), 'grisOscuro', [-6.6 + i * 4.4, -8.4, 1.8]); eh.construir(hmi, 'HMI-001');
    const panta = crearPantalla(THREE, kit, 288, 192);
    const matPantallaFija = kit.matLed(0x1b3a5c);
    const pantallaHmi = new THREE.Mesh(kit.registrar(new THREE.PlaneGeometry(24, 15.4)), panta ? panta.material : matPantallaFija); pantallaHmi.position.set(0, 1.4, 1.65); pantallaHmi.userData.id = 'HMI-001'; hmi.add(pantallaHmi);
    let firmaHmi = '';
    function pintarHmi(estado) {
      if (!panta) return;
      const t = textoHMI(estado), firma = [t.titulo, ...t.lineas, t.alarma].join('|');
      if (firma === firmaHmi) return;
      firmaHmi = firma; const g = panta.g;
      g.fillStyle = t.hayAlarma ? '#3a1c18' : '#12304e'; g.fillRect(0, 0, 288, 192);
      g.fillStyle = t.hayAlarma ? '#b3261e' : '#1f5fa8'; g.fillRect(0, 0, 288, 36);
      g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.textAlign = 'left'; g.font = '700 22px system-ui, sans-serif'; g.fillText(t.titulo, 10, 19);
      g.font = '600 24px system-ui, sans-serif'; t.lineas.forEach((l, i) => g.fillText(l, 12, 66 + i * 34));
      g.fillStyle = t.hayAlarma ? '#ff6b5e' : '#6ee39a'; g.fillRect(0, 160, 288, 32); g.fillStyle = '#10151a'; g.font = '700 20px system-ui, sans-serif'; g.fillText(t.alarma, 10, 177);
      panta.textura.needsUpdate = true;
    }
    pintarHmi(null);

    // ES-001: seta de paro de emergencia con base amarilla (se hunde al pulsarla)
    const es = sobrePuerta('ES-001', -16, 70, [10, 8, 10]);
    const ee = kit.ensamble(); ee.add(kit.cil(6, 0.5, 18), 'amarillo', [0, 0, 0.25], [PI / 2, 0, 0]); ee.add(kit.cil(3.2, 2, 14), 'negro', [0, 0, 1.4], [PI / 2, 0, 0]); ee.construir(es, 'ES-001');
    const seta = kit.malla(kit.cil(3.6, 2.4, 16), kit.matDinamico(0xc0392b), es, 'ES-001', [0, 0, 3.2], [PI / 2, 0, 0]);
    // PB-001: pulsador de marcha / reset con anillo y piloto verde
    const pb = sobrePuerta('PB-001', -42, 70, [8, 8, 6]);
    const ebp = kit.ensamble(); ebp.add(kit.cil(3, 1, 14), 'negro', [0, 0, 0.5], [PI / 2, 0, 0]); ebp.add(kit.cil(2.6, 1.4, 14), 'inox', [0, 0, 1.4], [PI / 2, 0, 0]); ebp.construir(pb, 'PB-001');
    const matPb = kit.matDinamico(0x2e9e55); const botonPb = kit.malla(kit.cil(2.0, 1.2, 14), matPb, pb, 'PB-001', [0, 0, 2.4], [PI / 2, 0, 0]);
    // pilotos luminosos (24 V, marcha, fallo, manual): son parte del armario
    const pilotos = [['mando', 0xf4f4ee, 0x4c5052, '24 V', -12], ['marcha', 0x35e06b, 0x14391f, 'MARCHA', -24], ['fallo', 0xff3b30, 0x4a1612, 'FALLO', -36], ['manual', 0xffb020, 0x4a3510, 'MANUAL', -48]].map(([clave, on, off, texto, lx]) => {
      const mat = kit.matLed(off), ring = kit.ensamble(); ring.add(kit.cil(1.7, 0.7, 12), 'inox', [lx, 84, 2.35], [PI / 2, 0, 0]); ring.construir(pivote, 'QE-001');
      kit.malla(kit.cil(1.2, 1.3, 12), mat, pivote, 'QE-001', [lx, 84, 2.9], [PI / 2, 0, 0]); rotulosPuerta.poner(texto, lx, 80.4, 2.4, 5.6, 1.4, 1);
      return { clave, on, off, mat, ultimo: -1 };
    });
    for (const r of [rotulosPuerta]) r.construir();
    let ultimaPuerta = '';
    function aplicarPuerta(corte, tapa) {
      const p = estadoPuerta(corte, tapa), clave = `${p.visible}|${p.giro}|${p.opacidad}`;
      if (clave === ultimaPuerta) return; ultimaPuerta = clave;
      pivote.visible = p.visible; pivote.rotation.y = p.giro; matPuerta.transparent = p.opacidad < 1; matPuerta.opacity = p.opacidad; matPuerta.depthWrite = p.opacidad >= 1; matPuerta.needsUpdate = true;
      trenza.visible = p.visible; ponerTrenza(); trenza.visible = p.visible; for (const f of anclasPuerta) f();
    }
    let vistaCorte = false, vistaTapa = true;
    let ultHmiT = 0, ultEs = null, ultPb = -1;
    base.alActualizar((estado, dt) => {
      if (estado) { ultHmiT += dt; if (ultHmiT >= 0.5) { ultHmiT = 0; pintarHmi(estado); } }
      const pulsada = !!K.equipoDe(estado, 'ES-001').pulsado || K.instrumentoDe(estado, 'ES-001').nivel === 0;
      if (pulsada !== ultEs) { seta.position.z = pulsada ? 2.2 : 3.2; ultEs = pulsada; }
      const marcha = K.instrumentoDe(estado, 'PB-001').nivel === 1;
      const hexPb = marcha ? 0x7dffb0 : 0x2e9e55;
      if (hexPb !== ultPb) { matPb.color.setHex(hexPb); botonPb.position.z = marcha ? 2.0 : 2.4; ultPb = hexPb; }
      const pl = estadoPilotos(estado);
      for (const p of pilotos) { const hex = pl[p.clave] ? p.on : p.off; if (hex !== p.ultimo) { p.mat.color.setHex(hex); p.ultimo = hex; } }
    });

    /* =============== dispositivos de la placa =============== */
    // QS-001 seccionador general (maneta giratoria rojo y amarillo; la puerta lo enclava en la realidad)
    (function () {
      const { g, d } = dispositivo('QS-001'), ens = kit.ensamble();
      ens.add(kit.caja(d.w, d.h, d.d), 'oscuro', [0, d.h / 2, 0]); ens.add(kit.caja(5, 5, 0.8), 'amarillo', [0, d.h / 2, d.d / 2 + 0.4]); ens.add(kit.cil(1.7, 1.4, 12), 'rojo', [0, d.h / 2, d.d / 2 + 1.4], [PI / 2, 0, 0]);
      ens.add(kit.caja(0.8, 3.6, 1.0), 'rojo', [0, d.h / 2, d.d / 2 + 2.2]); for (let i = 0; i < 4; i++) { ens.add(kit.caja(1.0, 0.5, 1.0), 'laton', [-2.4 + i * 1.6, 0.3, d.d / 2 - 0.5]); ens.add(kit.caja(1.0, 0.5, 1.0), 'laton', [-2.4 + i * 1.6, d.h - 0.3, d.d / 2 - 0.5]); }
      ens.construir(g, 'QE-001'); rotuloDe('QS-001');
    })();
    // QR-001 diferencial 4P 30 mA: palanca, botón de prueba (T) y ventana de estado
    (function () {
      const { g, d } = dispositivo('QR-001'), ens = kit.ensamble();
      ens.add(kit.caja(d.w, d.h, d.d), 'blanco', [0, d.h / 2, 0]); ens.add(kit.caja(d.w - 1, 3.2, 0.5), 'grisOscuro', [0, d.h - 2.4, d.d / 2 + 0.2]); ens.add(kit.caja(2, 3, 1.2), 'negro', [-1.2, d.h - 2.6, d.d / 2 + 0.6]);
      ens.add(kit.caja(1.3, 1.1, 0.6), 'azul', [1.7, 4, d.d / 2 + 0.3]); ens.add(kit.caja(2.2, 0.9, 0.4), 'verde', [-1.2, 4, d.d / 2 + 0.3]);
      for (let i = 0; i < 4; i++) { ens.add(kit.caja(1.0, 0.5, 1.0), 'laton', [-2.4 + i * 1.6, 0.3, d.d / 2 - 0.5]); ens.add(kit.caja(1.0, 0.5, 1.0), 'laton', [-2.4 + i * 1.6, d.h - 0.3, d.d / 2 - 0.5]); }
      ens.construir(g, 'QE-001'); rotuloDe('QR-001');
    })();
    // QF-201 magnetotérmico de P-201 y del calentador
    (function () {
      const { g, d } = dispositivo('QF-201'), ens = kit.ensamble();
      ens.add(kit.caja(d.w, d.h, d.d), 'blanco', [0, d.h / 2, 0]); ens.add(kit.caja(d.w - 0.8, 2.2, 0.5), 'grisOscuro', [0, 2.4, d.d / 2 + 0.2]);
      for (let i = 0; i < 3; i++) { ens.add(kit.caja(1.0, 0.5, 1.0), 'laton', [-1.8 + i * 1.8, 0.3, d.d / 2 - 0.5]); ens.add(kit.caja(1.0, 0.5, 1.0), 'laton', [-1.8 + i * 1.8, d.h - 0.3, d.d / 2 - 0.5]); }
      ens.construir(g, 'QF-201');
      const palanca = kit.malla(kit.caja(d.w - 1.2, 3.8, 1.2), kit.mat('negro'), g, 'QF-201', [0, d.h - 4, d.d / 2 + 0.4]);
      registrarDentro('QF-201', g, [d.w + 2, d.h, d.d + 2], d.y + d.h + 10); rotuloDe('QF-201');
      let ultimo = null;
      base.alActualizar(estado => { const armado = K.instrumentoDe(estado, 'QF-201').nivel !== 0; if (armado !== ultimo) { palanca.rotation.x = armado ? 0 : 0.7; ultimo = armado; } });
    })();
    // PS-001 fuente de 24 V CC: aluminio con ranuras de ventilación, bornas arriba (230 V) y abajo (24 V) y LED DC OK
    (function () {
      const { g, d } = dispositivo('PS-001'), ens = kit.ensamble();
      ens.add(kit.caja(d.w, d.h, d.d), 'inoxMate', [0, d.h / 2, 0]); ens.add(kit.caja(d.w - 2, 4, 0.6), 'negro', [0, d.h - 4.5, d.d / 2 + 0.2]); ens.add(kit.cil(0.7, 0.6, 8), 'grisOscuro', [3.2, 3, d.d / 2 + 0.3], [PI / 2, 0, 0]);
      for (let i = 0; i < 6; i++) ens.add(kit.caja(d.w - 4, 0.25, 0.3), 'oscuro', [0, 6.2 + i * 0.9, d.d / 2 + 0.1]);
      for (let i = 0; i < 6; i++) ens.add(kit.caja(1.0, 0.5, 1.0), 'laton', [-4.2 + i * 1.7, 0.3, d.d / 2 - 0.5]), ens.add(kit.caja(1.0, 0.5, 1.0), 'laton', [-4.2 + i * 1.7, d.h - 0.3, d.d / 2 - 0.5]);
      ens.construir(g, 'PS-001');
      const led = kit.matLed(0x35e06b); kit.malla(kit.esfera(0.7, 6), led, g, 'PS-001', [d.w / 2 - 2.5, d.h - 1.5, d.d / 2 + 0.4]);
      let apagado = false, ultimo = -1;
      base.alCambiarEfectos('PS-001', ef => { apagado = ef.has('led_apagado'); ultimo = -1; });
      base.alActualizar(estado => {
        const v = K.num(K.equipoDe(estado, 'PS-001').v24, 24);
        const hex = apagado ? 0x333333 : v < 21 ? 0xffb020 : 0x35e06b;
        if (hex !== ultimo) { led.color.setHex(hex); ultimo = hex; }
      });
      registrarDentro('PS-001', g, [d.w + 2, d.h, d.d + 2], d.y + d.h + 8); rotuloDe('PS-001'); rotulosQE.poner('DC OK', d.x + 1.4, d.y + d.h - 6.4, PZ + d.d + 0.1, 3.2, 0.8, 1);
    })();
    // F-001 portafusibles seccionable con LED de presencia de 24 V
    (function () {
      const { g, d } = dispositivo('F-001'), ens = kit.ensamble();
      ens.add(kit.caja(d.w, d.h, d.d), 'gris', [0, d.h / 2, 0]); ens.add(kit.caja(d.w - 0.6, 5.6, 1.2), 'grisOscuro', [0, d.h - 4, d.d / 2 + 0.4]); ens.add(kit.cil(0.9, 2.6, 8), 'amarillo', [0, d.h - 4, d.d / 2 + 1.2], [0, 0, PI / 2 * 0]);
      ens.add(kit.caja(d.w - 1, 0.5, 1), 'laton', [0, 0.3, d.d / 2 - 0.5]); ens.add(kit.caja(d.w - 1, 0.5, 1), 'laton', [0, d.h - 0.3, d.d / 2 - 0.5]);
      ens.construir(g, 'F-001');
      const led = kit.matLed(0x35e06b); kit.malla(kit.esfera(0.55, 6), led, g, 'F-001', [0, 2, d.d / 2 + 0.5]);
      let apagado = false, ultimo = -1;
      base.alCambiarEfectos('F-001', ef => { apagado = ef.has('led_apagado'); ultimo = -1; });
      base.alActualizar(estado => {
        const hex = apagado || K.equipoDe(estado, 'F-001').fundido ? 0x333333 : 0x35e06b;    // el LED indica que hay 24 V después del fusible
        if (hex !== ultimo) { led.color.setHex(hex); ultimo = hex; }
      });
      registrarDentro('F-001', g, [d.w + 3, d.h, d.d + 2], d.y + d.h + 8); rotuloDe('F-001');
    })();
    // KS relé de seguridad de la seta (Mando): cierra con ES-001 rearmada y 24 V
    (function () {
      const { g, d } = dispositivo('KS'), ens = kit.ensamble();
      ens.add(kit.caja(d.w, d.h, d.d), 'amarillo', [0, d.h / 2, 0]); ens.add(kit.caja(d.w - 1, 5.5, 0.5), 'oscuro', [0, d.h - 4, d.d / 2 + 0.2]);
      for (let i = 0; i < 3; i++) { ens.add(kit.caja(1.0, 0.5, 1.0), 'laton', [-2.8 + i * 2.8, 0.3, d.d / 2 - 0.5]); ens.add(kit.caja(1.0, 0.5, 1.0), 'laton', [-2.8 + i * 2.8, d.h - 0.3, d.d / 2 - 0.5]); }
      ens.construir(g, 'QE-001');
      const l1 = kit.matLed(0x35e06b), l2 = kit.matLed(0x35e06b);
      kit.malla(kit.esfera(0.5, 6), l1, g, 'QE-001', [-1.6, d.h - 3, d.d / 2 + 0.5]); kit.malla(kit.esfera(0.5, 6), l2, g, 'QE-001', [1.6, d.h - 3, d.d / 2 + 0.5]);
      rotuloDe('KS'); let ultimo = null;
      base.alActualizar(estado => { const c = ksCerrado(estado); if (c !== ultimo) { l2.color.setHex(c ? 0x35e06b : 0x333333); ultimo = c; } });
    })();
    // PLC-001: fuente, CPU y tarjetas AI-1, AI-2, DI-1, DI-2, DO-1 y AO-1; un LED por canal con el estado real
    (function () {
      const { g, d } = dispositivo('PLC-001'), ens = kit.ensamble(), rot = lienzoRotulos(atlas, THREE, kit, g, 'PLC-001');
      const ancho = 4.8, x0 = -(MODULOS_PLC.length * ancho) / 2 + ancho / 2, centros = MODULOS_PLC.map((_, i) => x0 + i * ancho);
      ens.add(kit.caja(d.w, d.h, d.d - 0.6), 'oscuro', [0, d.h / 2, -0.3]);
      for (const s of [-1, 1]) ens.add(kit.caja(0.8, d.h, d.d), 'grisOscuro', [s * (d.w / 2 - 0.4), d.h / 2, 0]);
      MODULOS_PLC.forEach((mo, i) => {
        const x = centros[i];
        ens.add(kit.caja(ancho - 0.3, d.h - 0.4, d.d), i < 2 ? 'grisOscuro' : 'negro', [x, d.h / 2, 0]); ens.add(kit.caja(ancho - 1, 6.2, 1.0), 'oscuro', [x, 4.2, d.d / 2 + 0.4]);        // módulo y conector de bornas
        for (let k = 0; k < 8; k++) ens.add(kit.caja(0.35, 0.35, 0.3), 'laton', [x - 1.4 + (k % 4) * 0.95, 2.2 + Math.floor(k / 4) * 3.4, d.d / 2 + 0.95]);
        rot.poner(mo.nombre, x, 8.0, d.d / 2 + 0.06, ancho - 0.8, (ancho - 0.8) / 4, 1);
      });
      ens.add(kit.caja(3.2, 1.8, 1.2), 'inoxMate', [centros[1], d.h - 1.6, d.d / 2 + 0.2]);                      // puerto Ethernet de la CPU
      ens.construir(g, 'PLC-001'); rot.construir();
      const canales = canalesPLC(), total = MODULOS_PLC.reduce((a, m) => a + m.leds, 0);
      const primero = []; let acc = 0; for (const m of MODULOS_PLC) { primero.push(acc); acc += m.leds; }
      const leds = new THREE.InstancedMesh(kit.registrar(new THREE.CircleGeometry(0.3, 6)), kit.registrar(new THREE.MeshBasicMaterial({ color: 0xffffff })), total);
      const mt = new THREE.Matrix4(), col = new THREE.Color(), sitio = new Array(total).fill(null);
      MODULOS_PLC.forEach((mo, i) => {
        for (let k = 0; k < mo.leds; k++) {
          const dosColumnas = mo.leds > 8, fila = dosColumnas ? k % 8 : k, columna = dosColumnas ? Math.floor(k / 8) : 0;
          const lx = mo.leds === 1 ? centros[i] : dosColumnas ? centros[i] - 0.95 + columna * 1.9 : centros[i] - 0.9, ly = mo.leds <= 4 ? d.h - 2.2 - k * 1.0 : d.h - 1.4 - fila * 0.95;
          mt.setPosition(lx, ly, d.d / 2 + 0.07); leds.setMatrixAt(primero[i] + k, mt); leds.setColorAt(primero[i] + k, col.setHex(LED_APAGADO));
        }
      });
      for (const c of canales) { const n = primero[c.modulo] + c.led; if (n < primero[c.modulo] + MODULOS_PLC[c.modulo].leds) sitio[n] = c; }
      leds.userData.id = 'PLC-001'; g.add(leds);
      const guardado = new Array(total).fill(-1);
      base.alActualizar(estado => {
        const central = colorLedsCentrales(estado); let cambio = false;
        for (let n = 0; n < total; n++) {
          let hex = LED_APAGADO;
          if (n === primero[0]) hex = central.pwr; else if (n === primero[1]) hex = central.run; else if (n === primero[1] + 1) hex = central.err; else if (n === primero[1] + 2) hex = central.com;
          else if (sitio[n]) hex = colorCanal(estado, sitio[n]);
          if (hex !== guardado[n]) { guardado[n] = hex; leds.setColorAt(n, col.setHex(hex)); cambio = true; }
        }
        if (cambio) leds.instanceColor.needsUpdate = true;
      });
      registrarDentro('PLC-001', g, [d.w + 2, d.h, d.d + 2], d.y + d.h + 8); rotuloDe('PLC-001', true);
    })();
    // VFD-101: variador con teclado y pantalla, aletas del disipador, tapa de bornas y ventilador que gira
    (function () {
      const { g, d } = dispositivo('VFD-101'), ens = kit.ensamble();
      ens.add(kit.caja(d.w, d.h, d.d), 'gris', [0, d.h / 2, 0]); ens.add(kit.caja(d.w - 2, 12, 1.2), 'negro', [0, d.h - 8, d.d / 2 + 0.4]); ens.add(kit.caja(d.w - 1.2, 9, 1.8), 'grisOscuro', [0, 6, d.d / 2 + 0.5]);   // teclado y tapa de bornas
      for (let i = 0; i < 6; i++) ens.add(kit.caja(d.w - 2, 0.5, 3.6), 'grisOscuro', [0, 12 + i * 1.2 + 7, d.d / 2 + 0.2 * 0 - 0.4 + 0.0]);          // ranuras de ventilación (disipador)
      for (let i = 0; i < 5; i++) { ens.add(kit.caja(1.5, 1.1, 0.5), 'inoxMate', [-4.8 + i * 2.4, d.h - 12.6, d.d / 2 + 1.1]); }              // teclas
      ens.add(kit.caja(1.0, 1.0, 0.5), 'verde', [4.2, d.h - 3.8, d.d / 2 + 1.1]); ens.add(kit.caja(1.0, 1.0, 0.5), 'rojo', [6.4, d.h - 3.8, d.d / 2 + 1.1]);
      ens.construir(g, 'VFD-101');
      const rotV = lienzoRotulos(atlas, THREE, kit, g, 'VFD-101'); rotV.poner('RUN', -2.6, d.h - 3.8, d.d / 2 + 1.0, 2.6, 0.7, 1); rotV.poner('VFD-101', 0, 1.8, d.d / 2 + 1.5, 7, 1.7, 1); rotV.construir();
      const pantalla = crearPantalla(THREE, kit, 128, 48);
      const matPantalla = kit.matLed(0x35e06b);
      const display = new THREE.Mesh(kit.registrar(new THREE.PlaneGeometry(9, 3.4)), pantalla ? pantalla.material : matPantalla); display.position.set(-0.6, d.h - 5.4, d.d / 2 + 1.04); display.userData.id = 'VFD-101'; g.add(display);
      const ventilador = new THREE.Group(); ventilador.position.set(0, d.h + 1.5, 0); g.add(ventilador);
      kit.malla(kit.caja(9, 0.5, 1.2), kit.mat('negro'), ventilador, 'VFD-101'); kit.malla(kit.caja(1.2, 0.5, 9), kit.mat('negro'), ventilador, 'VFD-101');
      let angulo = 0, ultimaFirma = '';
      base.alActualizar((estado, dt) => {
        const v = K.equipoDe(estado, 'VFD-101'), marcha = !!v.marcha && !v.fallo;
        angulo += K.velocidadAngularVisual(marcha, 100) * dt * 3; ventilador.rotation.y = angulo;
        const txt = textoVFD(estado), color = v.fallo ? '#ff3b30' : marcha ? '#35e06b' : '#9aa3a8', firma = txt + color;
        if (firma !== ultimaFirma && pantalla) {
          ultimaFirma = firma; const c = pantalla.g; c.fillStyle = '#0c1612'; c.fillRect(0, 0, 128, 48); c.fillStyle = color; c.font = '700 34px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, 64, 26); pantalla.textura.needsUpdate = true;
        }
      });
      registrarDentro('VFD-101', g, [d.w + 2, d.h + 4, d.d + 2], d.y + d.h + 10);
    })();
    // KM-203, KM-201 y KM-202: contactores con bobina (A1/A2), tres polos de potencia, bloque de contactos auxiliares y bandera mecánica
    function contactor(tag) {
      const { g, d } = dispositivo(tag), ens = kit.ensamble();
      ens.add(kit.caja(d.w, d.h, d.d), 'negro', [0, d.h / 2, 0]); ens.add(kit.caja(d.w - 1.2, 3.4, 1.0), 'grisOscuro', [0, d.h - 2.2, d.d / 2 + 0.4]);                 // bloque de auxiliares
      ens.add(kit.caja(d.w - 0.8, d.h * 0.42, 1.0), 'oscuro', [0, d.h * 0.28, d.d / 2 + 0.3]); ens.add(kit.caja(2.6, 1.4, 1.2), 'azul', [0, d.h * 0.28 + 2.2, d.d / 2 + 0.9]);   // placa y pulsador de prueba
      const polos = [-1, 0, 1].map(i => i * (d.w > 8 ? 2.8 : 2));
      for (const x of polos) { ens.add(kit.caja(1.1, 0.6, 1.1), 'laton', [x, d.h + 0.3, d.d / 2 - 1]); ens.add(kit.caja(1.1, 0.6, 1.1), 'laton', [x, -0.3, d.d / 2 - 1]); }
      for (const s of [-1, 1]) ens.add(kit.caja(0.8, 0.6, 0.8), 'laton', [s * (d.w / 2 - 1), d.h + 0.3, d.d / 2 - 1.6]);                                          // bornas de bobina A1 / A2
      ens.add(kit.caja(0.9, 0.5, 0.8), 'laton', [0, d.h - 2.2, d.d / 2 + 1.0]);
      ens.construir(g, tag);
      const led = kit.matLed(0x777777); kit.malla(kit.esfera(0.6, 6), led, g, tag, [d.w / 2 - 1.5, d.h * 0.28 + 3.4, d.d / 2 + 0.9]);
      const bandera = kit.malla(kit.caja(d.w - 3, 1.1, 0.8), kit.matDinamico(0xc0392b), g, tag, [0, 3, d.d / 2 + 1.0]);                                         // indicador mecánico de contactos
      let forzadoCerrado = false, forzadoAbierto = false, ultimo = '';
      base.alCambiarEfectos(tag, ef => { forzadoCerrado = ef.has('contactos_cerrados'); forzadoAbierto = ef.has('contactos_abiertos'); ultimo = ''; });
      base.alActualizar(estado => {
        const k = K.equipoDe(estado, tag);
        const cerrado = forzadoCerrado || (!forzadoAbierto && (!!k.cerrado || !!k.pegado));
        const clave = (cerrado ? 'C' : 'A') + (forzadoCerrado ? 'p' : '') + (forzadoAbierto ? 'x' : '');
        if (clave === ultimo) return;
        ultimo = clave;
        bandera.position.y = cerrado ? d.h * 0.28 + 4.2 : 3;
        led.color.setHex(forzadoCerrado ? 0xff3b30 : forzadoAbierto ? 0x333333 : cerrado ? 0x35e06b : 0x777777);
      });
      registrarDentro(tag, g, [d.w + 2, d.h, d.d + 2], d.y + d.h + 8); rotuloDe(tag);
    }
    for (const tag of ['KM-203', 'KM-201', 'KM-202']) contactor(tag);
    rotulosQE.construir();

    /* =============== HL-001: baliza de alarma sobre el armario =============== */
    (function () {
      const g = new THREE.Group(); g.position.set(18, H + 1, 0); qe.add(g);
      const ens = kit.ensamble(); ens.add(kit.cil(3.6, 2, 14), 'negro', [0, 1, 0]); ens.add(kit.cil(1.2, 4, 8), 'inoxMate', [0, 4, 0]); ens.add(kit.cil(2.8, 0.6, 12), 'grisOscuro', [0, 6.4, 0]); ens.construir(g, 'HL-001');
      const mat = kit.matDinamico(0x6b1d19, { transparent: true, opacity: 0.9 });
      kit.malla(new THREE.CylinderGeometry(3.2, 3.6, 7, 14), mat, g, 'HL-001', [0, 9.6, 0]);
      registrarDentro('HL-001', g, [8, 14, 8], H + 23);
      let t = 0, ultimo = -1;
      base.alActualizar((estado, dt) => {
        t += dt;
        const encendida = !!K.equipoDe(estado, 'HL-001').encendida || (estado && estado.alarmas && estado.alarmas.length > 0);
        const hex = encendida ? (Math.floor(t * 2) % 2 ? 0xff3b30 : 0xff9a8f) : 0x6b1d19;
        if (hex !== ultimo) { mat.color.setHex(hex); ultimo = hex; }
      });
    })();

    /** Vistas del visor: «Corte» cierra la puerta y la hace translúcida; «Tapa» desactivada la quita. */
    const ponerCorte = v => { vistaCorte = !!v; aplicarPuerta(vistaCorte, vistaTapa); };
    const ponerTapa = v => { vistaTapa = !!v; aplicarPuerta(vistaCorte, vistaTapa); };
    aplicarPuerta(false, true);
    qe.updateMatrixWorld(true);
    return { grupo: base.grupo, elementos: base.elementos, actualizar: base.actualizar, ponerCorte, ponerTapa, liberar: kit.liberar, TAGS };
  }

  const api = { crear, TAGS, DISPOSITIVOS, CUERPO, PUERTA, puntoPuerta, estadoPuerta, MODULOS_PLC, canalesPLC, colorCanal, colorLedsCentrales, GRUPOS_BORNAS, listaBornas,
    estadoPilotos, ksCerrado, textoHMI, textoVFD, TEXTOS_ROTULO, COLOR_LED: { apagado: LED_APAGADO, reposo: LED_REPOSO, verde: LED_VERDE, rojo: LED_ROJO, ambar: LED_AMBAR } };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstArmario = api; }
})();
