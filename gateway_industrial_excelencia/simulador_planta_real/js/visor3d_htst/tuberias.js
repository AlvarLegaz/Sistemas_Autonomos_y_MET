// Tuberías sanitarias de la planta HTST en 3D (DISEÑADOR): recorridos ortogonales entre los puertos de los equipos (puertos.js), con tubo de acero inoxidable satinado,
// codos de radio, soldaduras orbitales en los codos, uniones tri-clamp (dos virolas, junta y abrazadera con palomilla), cintas de color por fluido, flechas de sentido
// del flujo que avanzan con el fluido y pendiente en los desagües. En la vista «Corte» el acero se hace translúcido y se ve el líquido (con su color) y sus partículas.
// Ids de los tubos: TUBO_<ID> (el visor oculta las etiquetas de los ids que empiezan por TUBO_). Las funciones puras se prueban con node:test.
(function () {
  const K = typeof require !== 'undefined' ? require('./kit.js') : PCT.htstKit;
  const P = typeof require !== 'undefined' ? require('./puertos.js') : PCT.htstPuertos;
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.htstLayout;
  const RADIO_TUBO_CM = layout.DIAMETRO_TUBO_CM / 2;
  const RADIO_CODO_CM = 4.5;
  const SEPARACION_PARTICULAS_CM = 9;

  const p = (tag, nombre) => P.puerto(tag, nombre);
  const SALIDA = P.puerto('SALIDA_PRODUCTO', 'ent'), SUMINISTRO = P.puerto('SUMINISTRO_FRIO', 'sal'), DESAGUE = P.puerto('DESAGUE', 'ent');
  const CIP_EMPALME = [p('HX-101', 'raw_in')[0], 90, 32];     // punto del tubo LECHE_CRUDA_4 (y = 90, tramo en z hacia raw_in) donde entra el CIP en te
  const SUMINISTRO_LECHE = P.puerto('SUMINISTRO_LECHE', 'sal'), DESAGUE_LECHE = P.puerto('DESAGUE_LECHE', 'ent'), DESAGUE_AGUA = P.puerto('DESAGUE_AGUA', 'ent');

  /**
   * Recorrido ortogonal de A a B: sube o baja hasta el carril (altura) `carril`, avanza en x, luego en z y vuelve a bajar a B. Así quedan
   * montantes verticales en las bocas de los equipos y tramos horizontales a alturas distintas por tubo, como en una instalación real.
   */
  function autoruta(a, b, carril) {
    const bruta = [a, [a[0], carril, a[2]], [b[0], carril, a[2]], [b[0], carril, b[2]], b];
    const limpia = [bruta[0]];
    for (let i = 1; i < bruta.length; i++) {
      const u = limpia[limpia.length - 1];
      if (Math.abs(u[0] - bruta[i][0]) + Math.abs(u[1] - bruta[i][1]) + Math.abs(u[2] - bruta[i][2]) > 1e-6) limpia.push(bruta[i]);
    }
    // si tres puntos seguidos están alineados se quita el del medio (un solo tramo recto)
    const salida = [limpia[0]];
    for (let i = 1; i < limpia.length - 1; i++) {
      const a1 = salida[salida.length - 1], b1 = limpia[i], c1 = limpia[i + 1];
      const d1 = [b1[0] - a1[0], b1[1] - a1[1], b1[2] - a1[2]], d2 = [c1[0] - b1[0], c1[1] - b1[1], c1[2] - b1[2]];
      const cruz = [d1[1] * d2[2] - d1[2] * d2[1], d1[2] * d2[0] - d1[0] * d2[2], d1[0] * d2[1] - d1[1] * d2[0]];
      if (Math.abs(cruz[0]) + Math.abs(cruz[1]) + Math.abs(cruz[2]) > 1e-6) salida.push(b1);
    }
    salida.push(limpia[limpia.length - 1]);
    return salida;
  }

  const distancia = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const longitudRuta = puntos => { let l = 0; for (let i = 1; i < puntos.length; i++) l += distancia(puntos[i - 1], puntos[i]); return l; };

  /**
   * Redondea las esquinas de una poligonal: devuelve segmentos { tipo: 'L', a, b } (rectos) y { tipo: 'Q', a, c, b } (curva cuadrática con control c en la
   * esquina). El radio se reduce si el tramo es corto. El final de cada segmento es el principio del siguiente (continuo).
   */
  function esquinas(puntos, radio) {
    const segmentos = [];
    let actual = puntos[0];
    for (let i = 1; i < puntos.length - 1; i++) {
      const prev = puntos[i - 1], v = puntos[i], sig = puntos[i + 1];
      const r = Math.min(radio, distancia(prev, v) / 2, distancia(v, sig) / 2);
      const antes = lerp(v, prev, r / distancia(v, prev)), despues = lerp(v, sig, r / distancia(v, sig));
      if (distancia(actual, antes) > 1e-6) segmentos.push({ tipo: 'L', a: actual, b: antes });
      segmentos.push({ tipo: 'Q', a: antes, c: v, b: despues });
      actual = despues;
    }
    const fin = puntos[puntos.length - 1];
    if (distancia(actual, fin) > 1e-6) segmentos.push({ tipo: 'L', a: actual, b: fin });
    return segmentos;
  }

  // Lista de tubos: id, equipos que une, carril, fluido y cuándo llevan fluido (estadoRutas). Fluidos: leche, agua_caliente, agua_fria, cip, aire.
  const DEFINICION = [
    { id: 'LECHE_CRUDA_1', ayuda: 'TK-101', fluido: 'leche', de: p('TK-101', 'sal'), a: p('FLT-101', 'ent'), carril: 40, anclas: 'TT-101' },
    { id: 'LECHE_CRUDA_2', ayuda: 'FLT-101', fluido: 'leche', de: p('FLT-101', 'sal'), a: p('P-101', 'ent'), carril: 36 },
    { id: 'LECHE_CRUDA_3', ayuda: 'P-101', fluido: 'leche', de: p('P-101', 'sal'), a: p('FT-101', 'ent'), carril: 44 },
    { id: 'LECHE_CRUDA_4', ayuda: 'FT-101', fluido: 'leche', de: p('FT-101', 'sal'), a: p('HX-101', 'raw_in'), carril: 90, anclas: 'PT-101' },
    { id: 'LECHE_CALIENTE', ayuda: 'HX-101', fluido: 'leche', de: p('HX-101', 'cal_out'), a: p('HT-101', 'ent'), carril: 104 },
    { id: 'LECHE_TRAS_TUBO', ayuda: 'HT-101', fluido: 'leche', de: p('HT-101', 'sal'), a: p('FDV-101', 'com'), carril: 60, anclas: 'TT-103' },
    { id: 'LECHE_AVANCE', ayuda: 'FDV-101', fluido: 'leche', de: p('FDV-101', 'avance'), a: p('HX-101', 'past_in'), carril: 108, anclas: 'PT-102' },
    // puente exterior entre las placas intermedias: leche pasteurizada de la regeneración al enfriamiento (lleva TT-106)
    { id: 'LECHE_REG_ENF', ayuda: 'HX-101', fluido: 'leche', de: p('HX-101', 'reg_out'), a: p('HX-101', 'enf_in'), carril: 86, anclas: 'TT-106' },
    { id: 'LECHE_SALIDA', ayuda: 'HX-101', fluido: 'leche', de: p('HX-101', 'fin_out'), a: SALIDA, carril: 96, anclas: 'TT-104' },
    { id: 'LECHE_DESVIO', ayuda: 'FDV-101', fluido: 'leche', de: p('FDV-101', 'desvio'), a: p('TK-101', 'ret'), carril: 100 },
    { id: 'AGUA_CALIENTE_1', ayuda: 'HW-201', fluido: 'agua_caliente', de: p('HW-201', 'sal'), a: p('P-201', 'ent'), carril: 30 },
    { id: 'AGUA_CALIENTE_2', ayuda: 'P-201', fluido: 'agua_caliente', de: p('P-201', 'sal'), a: p('HX-101', 'hot_in'), carril: 84, anclas: 'TT-201' },
    { id: 'AGUA_CALIENTE_RETORNO', ayuda: 'HX-101', fluido: 'agua_caliente', de: p('HX-101', 'hot_out'), a: p('HW-201', 'ent'), carril: 76 },
    { id: 'AGUA_FRIA_1', ayuda: 'XV-301', fluido: 'agua_fria', de: SUMINISTRO, a: p('XV-301', 'ent'), carril: 10 },
    { id: 'AGUA_FRIA_2', ayuda: 'XV-301', fluido: 'agua_fria', de: p('XV-301', 'sal'), a: p('HX-101', 'cold_in'), carril: 82 },
    { id: 'AGUA_FRIA_DESAGUE', ayuda: 'HX-101', fluido: 'agua_fria', de: p('HX-101', 'cold_out'), a: DESAGUE, carril: 86, pendiente: 0.04 },
    { id: 'CIP', ayuda: 'XV-401', fluido: 'cip', de: p('XV-401', 'sal'), a: CIP_EMPALME, carril: 100 },       // el CIP se une a la leche cruda en una te sobre su tramo en z (y = 90), no en la boca raw_in: dos tubos no pueden compartir recorrido
    // Llenado y vaciado (modo manual y reposición automática): cada pareja de tubos lleva fluido cuando su válvula está abierta.
    { id: 'LECHE_LLENADO_1', ayuda: 'XV-101', fluido: 'leche', de: SUMINISTRO_LECHE, a: p('XV-101', 'ent'), carril: 10 },
    { id: 'LECHE_LLENADO_2', ayuda: 'XV-101', fluido: 'leche', de: p('XV-101', 'sal'), a: p('TK-101', 'llen'), carril: 62 },
    { id: 'LECHE_VACIADO_1', ayuda: 'XV-102', fluido: 'leche', de: p('TK-101', 'vac'), a: p('XV-102', 'ent'), carril: 26 },
    { id: 'LECHE_VACIADO_2', ayuda: 'XV-102', fluido: 'leche', de: p('XV-102', 'sal'), a: DESAGUE_LECHE, carril: 10, pendiente: 0.1 },
    { id: 'AGUA_LLENADO_1', ayuda: 'XV-201', fluido: 'agua_fria', de: SUMINISTRO, a: p('XV-201', 'ent'), carril: 10 },
    { id: 'AGUA_LLENADO_2', ayuda: 'XV-201', fluido: 'agua_fria', de: p('XV-201', 'sal'), a: p('HW-201', 'llen'), carril: 30 },
    { id: 'AGUA_VACIADO_1', ayuda: 'XV-202', fluido: 'agua_caliente', de: p('HW-201', 'vac'), a: p('XV-202', 'ent'), carril: 14 },
    { id: 'AGUA_VACIADO_2', ayuda: 'XV-202', fluido: 'agua_caliente', de: p('XV-202', 'sal'), a: DESAGUE_AGUA, carril: 10, pendiente: 0.1 },
    { id: 'AIRE_1', ayuda: 'FRL-501', fluido: 'aire', de: p('FRL-501', 'sal'), a: p('SV-101', 'ent'), carril: 24, radio: 0.55 },
    { id: 'AIRE_2', ayuda: 'SV-101', fluido: 'aire', de: p('SV-101', 'sal'), a: p('FDV-101', 'aire'), carril: 42, radio: 0.55 },
  ];
  const RUTAS = DEFINICION.map(d => Object.assign({}, d, { puntos: autoruta(d.de, d.a, d.carril) }));
  const rutaPorId = id => RUTAS.find(r => r.id === id) || null;

  /** Punto medio del tramo horizontal más largo de una ruta: donde se montan los instrumentos que van sobre el tubo. */
  function puntoSobreRuta(id) {
    const r = rutaPorId(id);
    if (!r) return null;
    let mejor = null, largo = -1;
    for (let i = 1; i < r.puntos.length; i++) {
      const a = r.puntos[i - 1], b = r.puntos[i], l = distancia(a, b);
      if (a[1] === b[1] && l > largo) { largo = l; mejor = lerp(a, b, 0.5); }
    }
    return mejor;
  }

  // Velocidad visual de las partículas (cm/s): la misma en todos los tubos con el mismo fluido y caudal, sea cual sea su longitud.
  const velocidadLeche = caudalLh => 14 + 46 * Math.min(1, Math.max(0, caudalLh) / 2500);
  const VELOCIDAD_AGUA_CM_S = 34;
  const VELOCIDAD_LLENADO_CM_S = 40;                    // leche que entra o sale del tanque de balance por XV-101 / XV-102

  /** Qué tubos llevan fluido y a qué velocidad: { [id]: { activo, velocidadCmS } }. Reglas de ARQUITECTURA.md §2.1 y §2.3. */
  function estadoRutas(estado) {
    const caudal = K.caudalLh(estado), a = K.aperturaFDV(estado);
    const leche = caudal > 0, vl = velocidadLeche(caudal);
    const bomba102 = !!K.equipoDe(estado, 'P-201').marcha, frio = !!K.equipoDe(estado, 'XV-301').abierta, cip = !!K.equipoDe(estado, 'XV-401').abierta;
    const r = {};
    for (const t of RUTAS) r[t.id] = { activo: false, velocidadCmS: 0 };
    for (const id of ['LECHE_CRUDA_1', 'LECHE_CRUDA_2', 'LECHE_CRUDA_3', 'LECHE_CRUDA_4', 'LECHE_CALIENTE', 'LECHE_TRAS_TUBO']) r[id] = { activo: leche, velocidadCmS: vl };
    r.LECHE_AVANCE = { activo: leche && a > 0.5, velocidadCmS: vl }; r.LECHE_SALIDA = { activo: leche && a > 0.5, velocidadCmS: vl };
    r.LECHE_REG_ENF = { activo: leche && a > 0.5, velocidadCmS: vl };
    r.LECHE_DESVIO = { activo: leche && a < 0.5, velocidadCmS: vl };
    for (const id of ['AGUA_CALIENTE_1', 'AGUA_CALIENTE_2', 'AGUA_CALIENTE_RETORNO']) r[id] = { activo: bomba102, velocidadCmS: VELOCIDAD_AGUA_CM_S };
    for (const id of ['AGUA_FRIA_1', 'AGUA_FRIA_2', 'AGUA_FRIA_DESAGUE']) r[id] = { activo: frio, velocidadCmS: VELOCIDAD_AGUA_CM_S };
    r.CIP = { activo: cip, velocidadCmS: VELOCIDAD_AGUA_CM_S };
    const llenaTK = K.valvulaAbierta(estado, 'XV-101'), vaciaTK = K.valvulaAbierta(estado, 'XV-102');
    const llenaHW = K.valvulaAbierta(estado, 'XV-201'), vaciaHW = K.valvulaAbierta(estado, 'XV-202');
    for (const id of ['LECHE_LLENADO_1', 'LECHE_LLENADO_2']) r[id] = { activo: llenaTK, velocidadCmS: VELOCIDAD_LLENADO_CM_S };
    for (const id of ['LECHE_VACIADO_1', 'LECHE_VACIADO_2']) r[id] = { activo: vaciaTK, velocidadCmS: VELOCIDAD_LLENADO_CM_S };
    for (const id of ['AGUA_LLENADO_1', 'AGUA_LLENADO_2']) r[id] = { activo: llenaHW, velocidadCmS: VELOCIDAD_AGUA_CM_S };
    for (const id of ['AGUA_VACIADO_1', 'AGUA_VACIADO_2']) r[id] = { activo: vaciaHW, velocidadCmS: VELOCIDAD_AGUA_CM_S };
    return r;
  }

  // Identificación por colores del fluido (cinta de color en la tubería, como en una planta real): producto verde, agua caliente naranja, agua fría azul, CIP amarillo, aire azul claro.
  const COLOR_BANDA = { leche: 0x2f9e44, agua_caliente: 0xd9631e, agua_fria: 0x2f7fc7, cip: 0xe8d23a, aire: 0x8fd0ea };
  const COLOR_ACERO = 0xbfc7ce;                          // inox satinado (la cinta y el líquido dan el color; el tubo es de acero)
  const COLOR_PARTICULA = { leche: 0xf2fff4, agua_caliente: 0xff9a4d, agua_fria: 0x5ab0ff, cip: 0xd6f06a, aire: 0xffffff };
  const SEPARACION_FLECHAS_CM = 45;
  const SEPARACION_UNIONES_CM = 150;
  const LADOS_TUBO = 12;
  // Temperatura (clave de proceso.temperaturas) que da color al líquido de cada tubo de leche.
  const CLAVE_TEMPERATURA = { LECHE_CALIENTE: 'salidaTubo', LECHE_TRAS_TUBO: 'salidaTubo', LECHE_DESVIO: 'salidaTubo', LECHE_AVANCE: 'trasRegeneracionPas',
    LECHE_REG_ENF: 'trasRegeneracionPas', LECHE_SALIDA: 'salidaFinal' };

  /** Posición (índice de la tabla de puntos espaciados 1 cm) de la partícula i de un tubo de `n` puntos. Función pura. */
  const indiceParticula = (i, separacionCm, avanceCm, n) => (((Math.floor(i * separacionCm + avanceCm)) % n) + n) % n;

  /**
   * Pendiente de los desagües (función pura): en cada tramo horizontal que acaba en un descenso, el extremo final baja `pendiente` × largo (como mucho la
   * mitad del descenso), de modo que el líquido corre hacia el sumidero. No toca los puertos ni los nombres: solo se usa para dibujar.
   */
  function aplicarPendiente(puntos, pendiente) {
    const p = puntos.map(q => q.slice());
    for (let i = 1; i < puntos.length - 1; i++) {
      const a = puntos[i - 1], b = puntos[i], c = puntos[i + 1];
      if (Math.abs(a[1] - b[1]) > 1e-6 || c[1] >= b[1] - 1e-6) continue;
      p[i][1] = b[1] - Math.min(pendiente * distancia(a, b), (b[1] - c[1]) / 2);
    }
    return p;
  }

  /** Distancias (cm desde el principio de un tramo recto) donde va una unión tri-clamp: junto a la boca del equipo (si el tramo toca un puerto) y cada ~150 cm. */
  function posicionesUniones(largo, inicioEsPuerto, finEsPuerto, separacion = SEPARACION_UNIONES_CM) {
    const r = [];
    if (inicioEsPuerto && largo >= 24) r.push(7);
    if (finEsPuerto && largo >= 24) r.push(largo - 7);
    const n = Math.floor(largo / separacion);
    for (let j = 1; j <= n; j++) r.push(largo * j / (n + 1));
    return r.sort((x, y) => x - y);
  }
  /** Distancias de las cintas de color de un tramo recto (ninguna en tramos cortos), separadas de las uniones. */
  function posicionesBandas(largo, uniones = []) {
    const base = largo < 40 ? [] : largo < 80 ? [largo * 0.5] : [largo * 0.3, largo * 0.7];
    return base.filter(x => uniones.every(u => Math.abs(u - x) > 5));
  }
  /** Base ortonormal (x, y, z) con y = tangente y z = el «arriba» del mundo proyectado (o x del mundo si el tubo es vertical). Función pura. */
  function baseDe(t) {
    const l = Math.hypot(t[0], t[1], t[2]) || 1, y = [t[0] / l, t[1] / l, t[2] / l];
    const u = Math.abs(y[1]) > 0.98 ? [1, 0, 0] : [0, 1, 0], d = u[0] * y[0] + u[1] * y[1] + u[2] * y[2];
    let z = [u[0] - d * y[0], u[1] - d * y[1], u[2] - d * y[2]]; const lz = Math.hypot(z[0], z[1], z[2]); z = [z[0] / lz, z[1] / lz, z[2] / lz];
    return { x: [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]], y, z };
  }

  function crear(THREE) {
    const kit = K.crearKit(THREE);
    const grupo = new THREE.Group();
    const elementos = {};
    const tubos = [];
    const V = a => new THREE.Vector3(a[0], a[1], a[2]);
    const geometriaParticula = kit.registrar(new THREE.SphereGeometry(1, 8, 6));
    const m4 = new THREE.Matrix4(), eu = new THREE.Euler(), vx = new THREE.Vector3(), vy = new THREE.Vector3(), vz = new THREE.Vector3();
    /** Euler que lleva el eje +Y local a la dirección `t` dejando +Z local hacia arriba. */
    const eulerDe = t => { const b = baseDe(t); m4.makeBasis(vx.set(...b.x), vy.set(...b.y), vz.set(...b.z)); eu.setFromRotationMatrix(m4); return [eu.x, eu.y, eu.z]; };
    const resta = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const geometriaFlecha = kit.registrar(new THREE.ConeGeometry(0.85, 2.6, 6));
    let vistaCorte = false;

    /** Paredes del tubo (rectas = cilindros abiertos, codos = tubo sobre la curva) con radio `r`; devuelve los tramos rectos para las uniones y las cintas. */
    function paredes(e, segmentos, r, clave, soldar) {
      const rectas = [];
      segmentos.forEach((s, i) => {
        if (s.tipo === 'L') {
          const largo = distancia(s.a, s.b);
          if (largo < 0.05) return;
          const d = resta(s.b, s.a);
          e.add(new THREE.CylinderGeometry(r, r, largo, LADOS_TUBO, 1, true), clave, lerp(s.a, s.b, 0.5), eulerDe(d));
          rectas.push({ a: s.a, b: s.b, largo, d, euler: eulerDe(d), inicioPuerto: i === 0, finPuerto: i === segmentos.length - 1 });
        } else {
          e.add(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(V(s.a), V(s.c), V(s.b)), 6, r, LADOS_TUBO, false), clave);
          if (soldar) {                                                                 // soldaduras orbitales donde el codo se une al tramo recto
            e.add(new THREE.CylinderGeometry(r + 0.12, r + 0.12, 0.45, 10), 'inoxMate', s.a, eulerDe(resta(s.c, s.a)));
            e.add(new THREE.CylinderGeometry(r + 0.12, r + 0.12, 0.45, 10), 'inoxMate', s.b, eulerDe(resta(s.b, s.c)));
          }
        }
      });
      return rectas;
    }
    /** Pieza con eje Y local colocada en `centro` mirando a lo largo del tubo; `y`/`z` la desplazan a lo largo del eje y hacia «arriba» del tubo. */
    const pieza = (e, g, clave, centro, euler, y = 0, z = 0) => { g.translate(0, y, z); e.add(g, clave, centro, euler); };

    for (const ruta of RUTAS) {
      const radio = ruta.radio || RADIO_TUBO_CM;
      const puntosVista = ruta.pendiente ? aplicarPendiente(ruta.puntos, ruta.pendiente) : ruta.puntos;
      const segmentos = esquinas(puntosVista, RADIO_CODO_CM);
      const camino = new THREE.CurvePath();
      for (const s of segmentos) camino.add(s.tipo === 'L' ? new THREE.LineCurve3(V(s.a), V(s.b)) : new THREE.QuadraticBezierCurve3(V(s.a), V(s.c), V(s.b)));
      const longitud = Math.max(2, Math.round(camino.getLength()));
      const g = new THREE.Group(), id = 'TUBO_' + ruta.id;
      const matTubo = kit.matDinamico(COLOR_ACERO);
      const e = kit.ensamble();
      const rectas = paredes(e, segmentos, radio, matTubo, true);
      const banda = COLOR_BANDA[ruta.fluido], aire = ruta.fluido === 'aire';
      for (const t of rectas) {
        const uniones = aire ? [] : posicionesUniones(t.largo, t.inicioPuerto, t.finPuerto);
        const u = t.d.map(v => v / t.largo);
        const en = s => [t.a[0] + u[0] * s, t.a[1] + u[1] * s, t.a[2] + u[2] * s];
        for (const s of uniones) {                                                  // unión tri-clamp: dos virolas, junta blanca y abrazadera con palomilla
          const c = en(s), R = radio;
          pieza(e, new THREE.CylinderGeometry(R + 1.35, R + 1.35, 0.5, 10), 'inox', c, t.euler, -0.4);
          pieza(e, new THREE.CylinderGeometry(R + 1.35, R + 1.35, 0.5, 10), 'inox', c, t.euler, 0.4);
          pieza(e, new THREE.CylinderGeometry(R + 1.1, R + 1.1, 0.5, 10), 'blanco', c, t.euler);
          pieza(e, new THREE.CylinderGeometry(R + 1.7, R + 1.7, 0.28, 10), 'inoxMate', c, t.euler, -0.62);
          pieza(e, new THREE.CylinderGeometry(R + 1.7, R + 1.7, 0.28, 10), 'inoxMate', c, t.euler, 0.62);
          pieza(e, new THREE.CylinderGeometry(R + 1.55, R + 1.55, 1.3, 10, 1, true), 'inoxMate', c, t.euler);
          pieza(e, new THREE.BoxGeometry(1.1, 1.3, 1.1), 'inoxMate', c, t.euler, 0, R + 2.2);
          pieza(e, new THREE.BoxGeometry(0.35, 0.3, 2.6), 'inox', c, t.euler, 0, R + 3.0);
        }
        if (!aire) for (const s of posicionesBandas(t.largo, uniones)) pieza(e, new THREE.CylinderGeometry(radio + 0.16, radio + 0.16, 3.2, 12, 1, true), banda, en(s), t.euler);
      }
      e.construir(g, id);
      const tabla = camino.getSpacedPoints(longitud);                              // 1 cm entre puntos: las partículas y las flechas leen de aquí, sin getPointAt por fotograma
      // flechas de sentido del flujo: conos sobre el tubo (con su orientación precalculada por punto); avanzan con el fluido y se quedan fijas si no circula
      const cuantasFlechas = Math.max(1, Math.round(longitud / SEPARACION_FLECHAS_CM));
      const matrices = new Float32Array(tabla.length * 16);
      for (let i = 0; i < tabla.length; i++) {
        const a = tabla[Math.max(0, i - 1)], b = tabla[Math.min(tabla.length - 1, i + 1)], bs = baseDe([b.x - a.x, b.y - a.y, b.z - a.z]);
        m4.makeBasis(vx.set(...bs.x), vy.set(...bs.y), vz.set(...bs.z));
        m4.setPosition(tabla[i].x + bs.z[0] * (radio + 0.95), tabla[i].y + bs.z[1] * (radio + 0.95), tabla[i].z + bs.z[2] * (radio + 0.95));
        matrices.set(m4.elements, i * 16);
      }
      const matFlecha = kit.registrar(new THREE.MeshBasicMaterial({ color: banda }));
      const flechas = new THREE.InstancedMesh(geometriaFlecha, matFlecha, cuantasFlechas);
      flechas.frustumCulled = false; flechas.raycast = () => {};
      grupo.add(flechas);
      let particulas = null, cuantas = 0;
      if (!aire) {
        cuantas = Math.max(2, Math.round(longitud / SEPARACION_PARTICULAS_CM));
        particulas = new THREE.InstancedMesh(geometriaParticula, kit.registrar(new THREE.MeshBasicMaterial({ color: COLOR_PARTICULA[ruta.fluido] })), cuantas);
        particulas.scale.setScalar(radio * 0.55);
        particulas.frustumCulled = false; particulas.visible = false; particulas.raycast = () => {};
        grupo.add(particulas);
      }
      const medio = tabla[Math.floor(tabla.length / 2)];
      elementos[id] = { id, grupo: g, ancla: new THREE.Vector3(medio.x, medio.y + 5, medio.z), ayuda: ruta.ayuda };
      grupo.add(g);
      const t = { ruta, id, matTubo, particulas, cuantas, tabla, longitud, avance: 0, matrices, flechas, cuantasFlechas, segmentos, grupo: g, radio, nucleo: null, matNucleo: null, hexNucleo: -1, ultimoActivo: null };
      colocarFlechas(t);
      tubos.push(t);
    }

    /** Coloca las flechas de un tubo según su avance (cm recorridos por el fluido). */
    function colocarFlechas(t) {
      const arr = t.flechas.instanceMatrix.array, paso = t.longitud / t.cuantasFlechas;
      for (let i = 0; i < t.cuantasFlechas; i++) {
        const k = ((Math.floor(i * paso + t.avance + paso * 0.5) % t.tabla.length) + t.tabla.length) % t.tabla.length;
        arr.set(t.matrices.subarray(k * 16, k * 16 + 16), i * 16);
      }
      t.flechas.instanceMatrix.needsUpdate = true;
    }
    /** El líquido que va dentro (visible al quitar la transparencia del tubo en «Corte»): se construye la primera vez que hace falta. */
    function crearNucleo(t) {
      t.matNucleo = kit.matDinamico(0xffffff);
      const e = kit.ensamble();
      paredes(e, t.segmentos, t.radio * 0.82, t.matNucleo, false);
      const mallas = e.construir(t.grupo, t.id); t.nucleo = mallas;
      for (const m of mallas) m.raycast = () => {};
    }
    function colorLiquido(ruta, estado) {
      switch (ruta.fluido) {
        case 'leche': return K.colorProducto(K.temperaturaDe(estado, CLAVE_TEMPERATURA[ruta.id] || 'entrada', 20));
        case 'agua_caliente': return K.colorAguaCaliente(K.temperaturaAguaCaliente(estado));
        case 'agua_fria': return K.AZUL_AGUA;
        case 'cip': return 0xd6f06a;
        default: return 0xdfeaf2;
      }
    }
    /** «Corte» / vista transparente: el acero se vuelve translúcido y se ve el líquido, con su color, y el flujo dentro. */
    function ponerCorte(activo) {
      vistaCorte = !!activo;
      for (const t of tubos) {
        t.matTubo.transparent = vistaCorte; t.matTubo.opacity = vistaCorte ? 0.26 : 1; t.matTubo.depthWrite = !vistaCorte; t.matTubo.needsUpdate = true;
        if (vistaCorte && !t.nucleo) crearNucleo(t);
        if (t.nucleo) for (const m of t.nucleo) m.visible = vistaCorte;
        t.hexNucleo = -1;
      }
    }

    let ultimo = null, ultimoColorLeche = -1;
    function actualizar(estado) {
      const ahora = performance.now(), dt = ultimo === null ? 0 : Math.min((ahora - ultimo) / 1000, 0.1); ultimo = ahora;
      const activos = estadoRutas(estado);
      const hexLeche = K.colorTuboCaliente(K.temperaturaDe(estado, 'salidaTubo', 20));
      for (const t of tubos) {
        const a = activos[t.ruta.id];
        if (t.ruta.id === 'LECHE_CALIENTE' || t.ruta.id === 'LECHE_TRAS_TUBO') { if (hexLeche !== ultimoColorLeche) t.matTubo.color.setHex(K.mezclarHex(COLOR_ACERO, hexLeche, 0.16)); }
        if (a.activo !== t.ultimoActivo) { t.flechas.material.color.setHex(a.activo ? COLOR_BANDA[t.ruta.fluido] : 0x5d6770); t.ultimoActivo = a.activo; }
        if (vistaCorte && t.nucleo) {
          const hex = a.activo ? colorLiquido(t.ruta, estado) : K.mezclarHex(colorLiquido(t.ruta, estado), 0x8a949c, 0.7);
          if (hex !== t.hexNucleo) { t.matNucleo.color.setHex(hex); t.hexNucleo = hex; }
        }
        if (a.activo) { t.avance += a.velocidadCmS * dt; if (dt > 0) colocarFlechas(t); }
        if (!t.particulas) continue;
        t.particulas.visible = a.activo && vistaCorte;                                // dentro de un tubo opaco no se verían
        if (!a.activo || !vistaCorte) continue;
        const arr = t.particulas.instanceMatrix.array;
        for (let i = 0; i < t.cuantas; i++) {
          const q = t.tabla[indiceParticula(i, t.longitud / t.cuantas, t.avance, t.tabla.length)];
          const o = i * 16;
          arr[o] = 1; arr[o + 5] = 1; arr[o + 10] = 1; arr[o + 15] = 1; arr[o + 12] = q.x / t.particulas.scale.x; arr[o + 13] = q.y / t.particulas.scale.x; arr[o + 14] = q.z / t.particulas.scale.x;
        }
        t.particulas.instanceMatrix.needsUpdate = true;
      }
      ultimoColorLeche = hexLeche;
    }

    return { grupo, elementos, actualizar, ponerCorte, liberar: kit.liberar, TAGS: Object.keys(elementos) };
  }

  const api = { crear, autoruta, esquinas, longitudRuta, RUTAS, rutaPorId, puntoSobreRuta, estadoRutas, aplicarPendiente, posicionesUniones, posicionesBandas, baseDe, COLOR_BANDA, velocidadLeche, VELOCIDAD_AGUA_CM_S, VELOCIDAD_LLENADO_CM_S, indiceParticula, RADIO_TUBO_CM };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstTuberias = api; }
})();
