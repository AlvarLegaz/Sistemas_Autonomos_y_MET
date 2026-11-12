// Disposición geométrica de la instalación fotovoltaica en 3D (DISEÑADOR). Función pura: sin THREE ni DOM, para poder probar choques y presupuesto con node:test.
// Unidades: centímetros. Ejes de la escena: +x ESTE, +y ARRIBA, +z SUR (los paneles miran al sur). El suelo de la cubierta está en y = 0.
// Convención del sol (la del contrato): azimut 0 = sur, positivo hacia el OESTE.
(function () {
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.fvLayout;

  /* ---------- Cubierta ---------- */
  const CUBIERTA = { x0: -1000, x1: 1050, z0: -700, z1: 450, alturaPretil: 38, alturaBarandilla: 105 };

  /* ---------- Caseta metálica (centro de su planta en x, z del mundo) ---------- */
  const CASETA = {
    x: -690, z: -330, ancho: 280, fondo: 220, altoMuro: 200, altoCumbrera: 224, grosor: 2,
    puerta: { x0: -70, x1: 70, alto: 182 },               // hueco de la puerta corredera en el muro sur (z local = +fondo/2); hoja A corrida 70 cm a la izquierda y hoja B 35 a la derecha
    abierta: { x0: -70, x1: 35 },                          // hueco libre con las hojas corridas
    tablero: 2, altoTablero: 166,                          // tablero crema que forra las paredes (cara a 2 cm del muro) y cinta de la parte alta
  };
  const SEMI = { x: CASETA.ancho / 2 - CASETA.tablero, zN: -(CASETA.fondo / 2 - CASETA.tablero) };   // caras del tablero: x = ±138, z = −108
  /** Punto de la caseta (coordenadas locales: x este, y arriba, z sur, origen en el centro del suelo) en el mundo. */
  const aMundo = (x, y, z) => [CASETA.x + x, y, CASETA.z + z];

  /**
   * Equipos del interior. `pared`: 'N' (fondo, cara hacia el sur), 'E' (cara hacia el oeste), 'O' (cara hacia el este); `u`: posición a lo largo de la pared (x en N, z en E y O);
   * `y0`: altura del borde inferior; `ancho` (a lo largo de la pared), `alto`, `fondo` (lo que sale de la pared). Pared = 'LIBRE': caja explícita en `caja`.
   */
  const INTERIOR = {
    'INV-101': { pared: 'N', u: -55, y0: 108, ancho: 38, alto: 52, fondo: 15 },
    'CB-101': { pared: 'N', u: 32, y0: 126, ancho: 28, alto: 22, fondo: 11 },
    'QB-101': { pared: 'N', u: -50, y0: 64, ancho: 16, alto: 12, fondo: 6 },
    'FB-101': { pared: 'N', u: -50, y0: 42, ancho: 5, alto: 12, fondo: 5 },
    'BAT-101': { pared: 'LIBRE', caja: { x0: -80, x1: 0, y0: 0, y1: 38, z0: -107, z1: -84 } },
    'COM-101': { pared: 'LIBRE', caja: { x0: -87, x1: -75, y0: 113, y1: 119, z0: -104, z1: -98 } },
    'INV-201': { pared: 'E', u: -20, y0: 104, ancho: 45, alto: 37, fondo: 17 },
    'QS-201': { pared: 'E', u: -84, y0: 128, ancho: 24, alto: 17, fondo: 9 },
    'MED-201': { pared: 'E', u: 30, y0: 130, ancho: 9, alto: 9, fondo: 6 },
    'QA-301': { pared: 'O', u: -10, y0: 100, ancho: 30, alto: 56, fondo: 9 },
  };
  /** Equipos que van DENTRO de otro (no cuentan como choque con él). */
  const ANIDADOS = { 'F-101': 'CB-101', 'F-102': 'CB-101', 'QS-101': 'CB-101', 'SPD-101': 'CB-101', 'SPD-201': 'QS-201',
    'QF-301': 'QA-301', 'ID-301': 'QA-301', 'QF-302': 'QA-301', 'QF-303': 'QA-301', 'SPD-301': 'QA-301', 'TC-301': 'QA-301' };
  /** Cosas decorativas del interior (no son equipos del layout; solo se comprueba que no atraviesan equipos). */
  const DECORADO = {
    'caja_registro_O': { pared: 'O', u: 62, y0: 176, ancho: 22, alto: 18, fondo: 11 },
    'caja_registro_E': { pared: 'E', u: 66, y0: 176, ancho: 22, alto: 18, fondo: 11 },
    'caja_herramientas': { pared: 'LIBRE', caja: { x0: -128, x1: -92, y0: 0, y1: 22, z0: -70, z1: -48 } },
    'carrete': { pared: 'LIBRE', caja: { x0: -118, x1: -82, y0: 0, y1: 34, z0: -30, z1: 6 } },
  };

  /** Caja (x0..x1, y0..y1, z0..z1, locales de la caseta) de un elemento de INTERIOR o DECORADO. */
  function caja(def) {
    if (def.pared === 'LIBRE') return Object.assign({}, def.caja);
    const m = def.ancho / 2;
    if (def.pared === 'N') return { x0: def.u - m, x1: def.u + m, y0: def.y0, y1: def.y0 + def.alto, z0: SEMI.zN, z1: SEMI.zN + def.fondo };
    if (def.pared === 'E') return { x0: SEMI.x - def.fondo, x1: SEMI.x, y0: def.y0, y1: def.y0 + def.alto, z0: def.u - m, z1: def.u + m };
    return { x0: -SEMI.x, x1: -SEMI.x + def.fondo, y0: def.y0, y1: def.y0 + def.alto, z0: def.u - m, z1: def.u + m };       // 'O'
  }
  /** Punto de anclaje en la pared (centro de la cara posterior, en la base) y giro sobre y del equipo, que se modela mirando a +z. */
  function anclaje(def) {
    if (def.pared === 'N') return { pos: [def.u, def.y0, SEMI.zN], giro: 0 };
    if (def.pared === 'E') return { pos: [SEMI.x, def.y0, def.u], giro: -Math.PI / 2 };       // cara hacia −x
    return { pos: [-SEMI.x, def.y0, def.u], giro: Math.PI / 2 };                              // 'O': cara hacia +x
  }
  const cajaInterior = tag => (INTERIOR[tag] ? caja(INTERIOR[tag]) : null);
  /** ¿Se solapan dos cajas (con una holgura negativa de `margen`)? */
  const solapan = (a, b, margen = 0.01) => a.x0 < b.x1 - margen && b.x0 < a.x1 - margen && a.y0 < b.y1 - margen && b.y0 < a.y1 - margen && a.z0 < b.z1 - margen && b.z0 < a.z1 - margen;

  /* ---------- Campos de paneles ---------- */
  const rad = g => g * Math.PI / 180;
  const A = { ancho: 165, largo: 99, grueso: 3.8, inclinacion: rad(layout.CAMPOS.A.inclinacionGrados), yBajo: 24, zSur: -30, xCol: [-345, -176] };
  const B = { ancho: 172, largo: 113, grueso: 3.5, inclinacion: rad(layout.CAMPOS.B.inclinacionGrados), yBajo: 5, xIzq: 110, separacionFilas: 152, zSur: 255, huecoX: 1.5 };
  const ANTIGUOS = { ancho: 99, largo: 165, grueso: 3.5, inclinacion: rad(11), yBajo: 14, xCol: [800, 902], zSur: 150 };

  /** Un panel: centro, tamaño y giro. `lado` = 'A' | 'B' | 'V' (viejos). El panel es una losa de ancho (x) × grueso × largo (a lo largo de la pendiente), con el borde SUR más bajo. */
  function panelEn(def, xCentro, filaSur) {
    const c = Math.cos(def.inclinacion), s = Math.sin(def.inclinacion);
    const paso = def.separacionFilas || def.largo * c + 1.5;
    const zBajo = def.zSur - filaSur * paso;                  // arista baja (sur) de la fila
    return { x: xCentro, y: def.yBajo + (def.largo / 2) * s, z: zBajo - (def.largo / 2) * c, zBajo, zAlto: zBajo - def.largo * c, yBajo: def.yBajo, yAlto: def.yBajo + def.largo * s,
      ancho: def.ancho, largo: def.largo, grueso: def.grueso, inclinacion: def.inclinacion, fila: filaSur };
  }

  const PANELES = {};
  // Campo A: 2 columnas (cada una es una cadena) × 3 filas
  layout.CAMPOS.A.cadenas.forEach((cad, col) => cad.paneles.forEach((tag, fila) => { PANELES[tag] = Object.assign(panelEn(A, A.xCol[col], fila), { campo: 'A', cadena: cad.id, columna: col, indice: fila }); }));
  // Campo B: 3 filas (3 + 3 + 2). Fila delantera (sur): PV-205, 206, 207; central: 201, 202, 203; trasera: 204, 208.
  const FILAS_B = [['PV-205', 'PV-206', 'PV-207'], ['PV-201', 'PV-202', 'PV-203'], ['PV-208', 'PV-204']];     // la fila de atrás son 2 paneles, pegados a la derecha
  const cadenaDe = tag => { for (const campo of Object.values(layout.CAMPOS)) for (const c of campo.cadenas) if (c.paneles.includes(tag)) return c.id; return null; };
  FILAS_B.forEach((fila, f) => fila.forEach((tag, k) => {
    const x = B.xIzq + B.ancho / 2 + (k + 3 - fila.length) * (B.ancho + B.huecoX);
    PANELES[tag] = Object.assign(panelEn(B, x, f), { campo: 'B', cadena: cadenaDe(tag), columna: k, indice: f });
  }));
  const VIEJOS = [];
  for (let col = 0; col < 2; col++) for (let fila = 0; fila < 2; fila++) VIEJOS.push(Object.assign(panelEn(ANTIGUOS, ANTIGUOS.xCol[col], fila), { campo: 'V', columna: col }));

  /** Cajas de los campos (en planta, con su margen) para comprobar que no se pisan entre sí ni con la caseta. */
  function cajaCampo(lado) {
    const lista = lado === 'V' ? VIEJOS : Object.values(PANELES).filter(p => p.campo === lado);
    return { x0: Math.min(...lista.map(p => p.x - p.ancho / 2)), x1: Math.max(...lista.map(p => p.x + p.ancho / 2)), z0: Math.min(...lista.map(p => p.zAlto)), z1: Math.max(...lista.map(p => p.zBajo)) };
  }
  const cajaCaseta = () => ({ x0: CASETA.x - CASETA.ancho / 2 - 8, x1: CASETA.x + CASETA.ancho / 2 + 8, z0: CASETA.z - CASETA.fondo / 2 - 8, z1: CASETA.z + CASETA.fondo / 2 + 14 });

  /** Bandeja de rejilla (puntos en planta; y = 4 sobre la cubierta). Acaba en la pared este de la caseta, donde entran los cables. */
  const ENTRADA_CABLES = { pared: 'E', z: 80, y: 22 };
  const eMundo = aMundo(SEMI.x + CASETA.tablero, 0, ENTRADA_CABLES.z);        // punto de la pared este de la caseta donde entra la bandeja
  const BANDEJA = { y: 4, ancho: 22, alto: 5, puntos: [[640, 268], [60, 268], [60, 50], [CASETA.x + CASETA.ancho / 2 + 40, 50], [CASETA.x + CASETA.ancho / 2 + 40, eMundo[2]], [CASETA.x + CASETA.ancho / 2 + 1, eMundo[2]]] };

  const api = { layout, CUBIERTA, CASETA, SEMI, aMundo, INTERIOR, ANIDADOS, DECORADO, caja, anclaje, cajaInterior, solapan, A, B, ANTIGUOS, PANELES, VIEJOS, FILAS_B,
    cajaCampo, cajaCaseta, BANDEJA, ENTRADA_CABLES, panelEn, rad };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else { window.PCT = window.PCT || {}; PCT.fvDisposicion = api; }
})();
