// Tuberías sanitarias de la planta HTST en 3D (DISEÑADOR): recorridos ortogonales entre los puertos de los equipos (puertos.js), codos redondeados,
// abrazaderas tri-clamp y partículas de flujo (una InstancedMesh por tubo) que solo aparecen en los tubos con fluido y avanzan a una velocidad uniforme en cm/s.
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
    { id: 'LECHE_CRUDA_4', ayuda: 'FT-101', fluido: 'leche', de: p('FT-101', 'sal'), a: p('P-103', 'ent'), carril: 48 },
    { id: 'LECHE_CRUDA_5', ayuda: 'P-103', fluido: 'leche', de: p('P-103', 'sal'), a: p('HX-101', 'raw_in'), carril: 90, anclas: 'PT-101' },
    { id: 'LECHE_CALIENTE', ayuda: 'HX-101', fluido: 'leche', de: p('HX-101', 'cal_out'), a: p('HT-101', 'ent'), carril: 92 },
    { id: 'LECHE_TRAS_TUBO', ayuda: 'HT-101', fluido: 'leche', de: p('HT-101', 'sal'), a: p('FDV-101', 'com'), carril: 60, anclas: 'TT-103' },
    { id: 'LECHE_AVANCE', ayuda: 'FDV-101', fluido: 'leche', de: p('FDV-101', 'avance'), a: p('HX-101', 'past_in'), carril: 100, anclas: 'PT-102' },
    { id: 'LECHE_SALIDA', ayuda: 'HX-101', fluido: 'leche', de: p('HX-101', 'fin_out'), a: SALIDA, carril: 96, anclas: 'TT-104' },
    { id: 'LECHE_DESVIO', ayuda: 'FDV-101', fluido: 'leche', de: p('FDV-101', 'desvio'), a: p('TK-101', 'ret'), carril: 106 },
    { id: 'AGUA_CALIENTE_1', ayuda: 'HW-101', fluido: 'agua_caliente', de: p('HW-101', 'sal'), a: p('P-102', 'ent'), carril: 30 },
    { id: 'AGUA_CALIENTE_2', ayuda: 'P-102', fluido: 'agua_caliente', de: p('P-102', 'sal'), a: p('HX-101', 'hot_in'), carril: 70, anclas: 'TT-105' },
    { id: 'AGUA_CALIENTE_RETORNO', ayuda: 'HX-101', fluido: 'agua_caliente', de: p('HX-101', 'hot_out'), a: p('HW-101', 'ent'), carril: 76 },
    { id: 'AGUA_FRIA_1', ayuda: 'XV-301', fluido: 'agua_fria', de: SUMINISTRO, a: p('XV-301', 'ent'), carril: 10 },
    { id: 'AGUA_FRIA_2', ayuda: 'XV-301', fluido: 'agua_fria', de: p('XV-301', 'sal'), a: p('HX-101', 'cold_in'), carril: 82 },
    { id: 'AGUA_FRIA_DESAGUE', ayuda: 'HX-101', fluido: 'agua_fria', de: p('HX-101', 'cold_out'), a: DESAGUE, carril: 86 },
    { id: 'CIP', ayuda: 'XV-401', fluido: 'cip', de: p('XV-401', 'sal'), a: p('HX-101', 'raw_in'), carril: 88 },
    { id: 'AIRE_1', ayuda: 'FRL-101', fluido: 'aire', de: p('FRL-101', 'sal'), a: p('SV-101', 'ent'), carril: 24, radio: 0.55 },
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

  /** Qué tubos llevan fluido y a qué velocidad: { [id]: { activo, velocidadCmS } }. Reglas de ARQUITECTURA.md §2.1 y §2.3. */
  function estadoRutas(estado) {
    const caudal = K.caudalLh(estado), a = K.aperturaFDV(estado);
    const leche = caudal > 0, vl = velocidadLeche(caudal);
    const bomba102 = !!K.equipoDe(estado, 'P-102').marcha, frio = !!K.equipoDe(estado, 'XV-301').abierta, cip = !!K.equipoDe(estado, 'XV-401').abierta;
    const r = {};
    for (const t of RUTAS) r[t.id] = { activo: false, velocidadCmS: 0 };
    for (const id of ['LECHE_CRUDA_1', 'LECHE_CRUDA_2', 'LECHE_CRUDA_3', 'LECHE_CRUDA_4', 'LECHE_CRUDA_5', 'LECHE_CALIENTE', 'LECHE_TRAS_TUBO']) r[id] = { activo: leche, velocidadCmS: vl };
    r.LECHE_AVANCE = { activo: leche && a > 0.5, velocidadCmS: vl }; r.LECHE_SALIDA = { activo: leche && a > 0.5, velocidadCmS: vl };
    r.LECHE_DESVIO = { activo: leche && a < 0.5, velocidadCmS: vl };
    for (const id of ['AGUA_CALIENTE_1', 'AGUA_CALIENTE_2', 'AGUA_CALIENTE_RETORNO']) r[id] = { activo: bomba102, velocidadCmS: VELOCIDAD_AGUA_CM_S };
    for (const id of ['AGUA_FRIA_1', 'AGUA_FRIA_2', 'AGUA_FRIA_DESAGUE']) r[id] = { activo: frio, velocidadCmS: VELOCIDAD_AGUA_CM_S };
    r.CIP = { activo: cip, velocidadCmS: VELOCIDAD_AGUA_CM_S };
    return r;
  }

  const COLOR_TUBO = { leche: 0xd3dae1, agua_caliente: 0xd9a58a, agua_fria: 0x8fb9d9, cip: 0xb7c98a, aire: 0x6f8ea6 };
  const COLOR_PARTICULA = { leche: 0xffffff, agua_caliente: 0xff9a4d, agua_fria: 0x5ab0ff, cip: 0xd6f06a, aire: 0xffffff };

  /** Posición (índice de la tabla de puntos espaciados 1 cm) de la partícula i de un tubo de `n` puntos. Función pura. */
  const indiceParticula = (i, separacionCm, avanceCm, n) => (((Math.floor(i * separacionCm + avanceCm)) % n) + n) % n;

  function crear(THREE) {
    const kit = K.crearKit(THREE);
    const grupo = new THREE.Group();
    const elementos = {};
    const tubos = [];
    const tmp = new THREE.Object3D();
    const V = a => new THREE.Vector3(a[0], a[1], a[2]);
    const geometriaParticula = kit.registrar(new THREE.SphereGeometry(1, 8, 6));

    for (const ruta of RUTAS) {
      const radio = ruta.radio || RADIO_TUBO_CM;
      const camino = new THREE.CurvePath();
      for (const s of esquinas(ruta.puntos, RADIO_CODO_CM)) camino.add(s.tipo === 'L' ? new THREE.LineCurve3(V(s.a), V(s.b)) : new THREE.QuadraticBezierCurve3(V(s.a), V(s.c), V(s.b)));
      const longitud = Math.max(2, Math.round(camino.getLength()));
      const g = new THREE.Group(), id = 'TUBO_' + ruta.id;
      const matTubo = kit.matDinamico(COLOR_TUBO[ruta.fluido]);
      kit.malla(new THREE.TubeGeometry(camino, Math.min(500, Math.ceil(longitud / 1.5)), radio, 8, false), matTubo, g, id);
      const tabla = camino.getSpacedPoints(longitud);                              // 1 cm entre puntos: las partículas leen de aquí, sin getPointAt por fotograma
      // abrazaderas tri-clamp cada ~70 cm (solo en los tubos de proceso, no en el aire)
      if (ruta.fluido !== 'aire') {
        const e = kit.ensamble();
        for (let k = 35; k < longitud - 10; k += 70) {
          tmp.position.copy(tabla[k]); tmp.lookAt(tabla[Math.min(k + 1, tabla.length - 1)]);
          e.add(kit.toro(radio + 0.9, 0.55, Math.PI * 2, 10), 'inoxMate', [tmp.position.x, tmp.position.y, tmp.position.z], [tmp.rotation.x, tmp.rotation.y, tmp.rotation.z]);
        }
        e.construir(g, id);
      }
      let particulas = null, cuantas = 0;
      if (ruta.fluido !== 'aire') {
        cuantas = Math.max(2, Math.round(longitud / SEPARACION_PARTICULAS_CM));
        particulas = new THREE.InstancedMesh(geometriaParticula, kit.registrar(new THREE.MeshBasicMaterial({ color: COLOR_PARTICULA[ruta.fluido] })), cuantas);
        particulas.scale.setScalar(radio * 0.55);
        particulas.frustumCulled = false; particulas.visible = false; particulas.raycast = () => {};
        grupo.add(particulas);
      }
      const medio = tabla[Math.floor(tabla.length / 2)];
      elementos[id] = { id, grupo: g, ancla: new THREE.Vector3(medio.x, medio.y + 5, medio.z), ayuda: ruta.ayuda };
      grupo.add(g);
      tubos.push({ ruta, id, matTubo, particulas, cuantas, tabla, longitud, avance: 0, mat: new THREE.Matrix4() });
    }

    let ultimo = null, ultimoColorLeche = -1;
    function actualizar(estado) {
      const ahora = performance.now(), dt = ultimo === null ? 0 : Math.min((ahora - ultimo) / 1000, 0.1); ultimo = ahora;
      const activos = estadoRutas(estado);
      const hexLeche = K.colorTuboCaliente(K.temperaturaDe(estado, 'salidaTubo', 20));
      for (const t of tubos) {
        const a = activos[t.ruta.id];
        if (t.ruta.id === 'LECHE_CALIENTE' || t.ruta.id === 'LECHE_TRAS_TUBO') { if (hexLeche !== ultimoColorLeche) t.matTubo.color.setHex(hexLeche); }
        if (!t.particulas) continue;
        t.particulas.visible = a.activo;
        if (!a.activo) continue;
        t.avance += a.velocidadCmS * dt;
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

    return { grupo, elementos, actualizar, liberar: kit.liberar, TAGS: Object.keys(elementos) };
  }

  const api = { crear, autoruta, esquinas, longitudRuta, RUTAS, rutaPorId, puntoSobreRuta, estadoRutas, velocidadLeche, VELOCIDAD_AGUA_CM_S, indiceParticula, RADIO_TUBO_CM };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstTuberias = api; }
})();
