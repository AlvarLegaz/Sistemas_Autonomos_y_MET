// Tuberías de la planta 3D: los trazados salen de los paths del esquema 2D (ESQUEMA_PCT23) y se levantan sobre la mesa.
// Cada tubo se ilumina y muestra partículas de flujo con la misma lógica que scada/esquema_pct23.js (crearTuberias).
// La parte sin THREE (parseo, codos, qué tubo está activo) son funciones puras y se prueban con node:test.
(function () {
  const layout = typeof require !== 'undefined' ? require('./layout.js') : PCT.planta3dLayout;
  const { aPlano, ALTURA_TUBO_CM } = layout;

  const RADIO_TUBO_CM = 0.55;
  const RADIO_CODO_CM = 2.2;
  const ALTURA_CRUCE_CM = 1.9;          // un tubo que cruza a otro pasa por encima: arco de esta altura
  const SEPARACION_PARTICULAS_CM = 6;
  const COLOR = { producto: 0xd9d3b0, caliente: 0xd9480f, frio: 0x2f7fc7 };

  /* ---------- funciones puras ---------- */

  /** Path SVG (solo M, H, V, L, C absolutos, como en el esquema) → lista de trazos, cada uno una lista de puntos {x, y} en px. */
  function parsearPath(d) {
    const fichas = d.match(/[A-Za-z]|-?\d+(?:\.\d+)?/g) || [];
    const trazos = [];
    let actual = null, comando = null, i = 0;
    const numero = () => Number(fichas[i++]);
    const ultimo = () => actual[actual.length - 1];
    while (i < fichas.length) {
      if (/[A-Za-z]/.test(fichas[i])) comando = fichas[i++];
      if (comando === 'M') { actual = [{ x: numero(), y: numero() }]; trazos.push(actual); comando = 'L'; }
      else if (comando === 'H') actual.push({ x: numero(), y: ultimo().y });
      else if (comando === 'V') actual.push({ x: ultimo().x, y: numero() });
      else if (comando === 'L') actual.push({ x: numero(), y: numero() });
      else if (comando === 'C') {
        const p0 = ultimo(), p1 = { x: numero(), y: numero() }, p2 = { x: numero(), y: numero() }, p3 = { x: numero(), y: numero() };
        for (let k = 1; k <= 12; k++) {
          const t = k / 12, u = 1 - t;
          actual.push({ x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
                        y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y });
        }
      } else throw new Error(`Comando de path no soportado: ${comando}`);
    }
    return trazos;
  }

  /** Redondea las esquinas de una polilínea con curvas cuadráticas. Solo toca vértices con un giro de más de ~25°. */
  function redondearEsquinas(puntos, radio, pasos = 6) {
    if (puntos.length < 3) return puntos.slice();
    const salida = [puntos[0]];
    for (let i = 1; i < puntos.length - 1; i++) {
      const a = puntos[i - 1], p = puntos[i], b = puntos[i + 1];
      const e1 = { x: p.x - a.x, y: p.y - a.y }, e2 = { x: b.x - p.x, y: b.y - p.y };
      const l1 = Math.hypot(e1.x, e1.y), l2 = Math.hypot(e2.x, e2.y);
      if (l1 < 1e-9 || l2 < 1e-9) continue;
      const coseno = (e1.x * e2.x + e1.y * e2.y) / (l1 * l2);
      if (coseno > 0.9) { salida.push(p); continue; }          // casi recto: no se redondea
      const r = Math.min(radio, l1 * 0.5, l2 * 0.5);
      const entrada = { x: p.x - e1.x / l1 * r, y: p.y - e1.y / l1 * r }, salidaP = { x: p.x + e2.x / l2 * r, y: p.y + e2.y / l2 * r };
      for (let k = 0; k <= pasos; k++) {
        const t = k / pasos, u = 1 - t;
        salida.push({ x: u * u * entrada.x + 2 * u * t * p.x + t * t * salidaP.x, y: u * u * entrada.y + 2 * u * t * p.y + t * t * salidaP.y });
      }
    }
    salida.push(puntos[puntos.length - 1]);
    return salida;
  }

  /** Trazo en px del esquema → puntos 3D {x, y, z} en cm. Un cruce se levanta en arco para pasar por encima del otro tubo. */
  function trazoA3D(puntosPx, cruce) {
    const planos = puntosPx.map(p => aPlano(p.x, p.y));
    if (cruce) {
      const a = planos[0], b = planos[planos.length - 1], n = 16;
      return Array.from({ length: n + 1 }, (_, k) => {
        const t = k / n;
        return { x: a.x + (b.x - a.x) * t, y: ALTURA_TUBO_CM + ALTURA_CRUCE_CM * Math.sin(Math.PI * t), z: a.z + (b.z - a.z) * t };
      });
    }
    return redondearEsquinas(planos.map(p => ({ x: p.x, y: p.z })), RADIO_CODO_CM)
      .map(p => ({ x: p.x, y: ALTURA_TUBO_CM, z: p.y }));
  }

  // Tubo lógico (id) al que pertenece un path según sus atributos, y clave de ayuda que se abre al pulsarlo.
  function identificarTubo(atributos) {
    if (atributos['data-bomba']) return { id: `TUBO_${atributos['data-bomba']}`, ayuda: atributos['data-bomba'] };
    if (atributos['data-ruta'] === 'normal') return { id: 'TUBO_PRODUCTO', ayuda: 'FINAL' };
    if (atributos['data-ruta'] === 'desvio') return { id: 'TUBO_DESVIO', ayuda: 'DESVIO' };
    if (atributos['data-tanque']) return { id: `TUBO_TANQUE_${atributos['data-tanque']}`, ayuda: `TANK${atributos['data-tanque']}` };
    if (atributos['data-solenoide']) return { id: `TUBO_${atributos['data-solenoide']}`, ayuda: atributos['data-solenoide'] };
    const circuito = atributos['data-circuito'];
    if (circuito === 'frio') return { id: 'TUBO_FRIO', ayuda: 'SOL3' };
    if (circuito === 'colector-frio') return { id: 'TUBO_COLECTOR_FRIO', ayuda: 'SOL3' };
    if (circuito === 'colector-superior') return { id: 'TUBO_COLECTOR_SUPERIOR', ayuda: 'SOL4' };
    return null;
  }

  /**
   * Recorre el esquema y devuelve los tubos lógicos: [{ id, ayuda, clase, trazos: [{ puntos3D, inverso, cruce, sinFlujo }] }].
   * Entran los paths con class "tubo ..." que pertenecen a un circuito; los cables de instrumentos (líneas) se ignoran.
   */
  function definirTubos(esquema) {
    const tubos = new Map();
    const visitar = (nodo, dentroDeCruces) => {
      if (!Array.isArray(nodo)) return;
      const [etiqueta, atributos = {}, ...hijos] = nodo;
      if (etiqueta === 'path' && typeof atributos.d === 'string' && /\btubo\b/.test(atributos.class || '')) {
        const identidad = identificarTubo(atributos);
        if (identidad) {
          const clase = /\bcaliente\b/.test(atributos.class) ? 'caliente' : /\bfrio\b/.test(atributos.class) ? 'frio' : 'producto';
          if (!tubos.has(identidad.id)) tubos.set(identidad.id, { id: identidad.id, ayuda: identidad.ayuda, clase, trazos: [] });
          for (const trazo of parsearPath(atributos.d)) {
            tubos.get(identidad.id).trazos.push({
              puntos3D: trazoA3D(trazo, dentroDeCruces), inverso: atributos['data-sentido'] === 'inverso',
              cruce: dentroDeCruces, sinFlujo: atributos['data-sin-flujo'] === '1',
            });
          }
        }
        return;
      }
      const cruces = dentroDeCruces || (etiqueta === 'g' && /Cruces/.test(atributos['aria-label'] || ''));
      for (const hijo of hijos) visitar(hijo, cruces);
    };
    visitar(esquema, false);
    return [...tubos.values()];
  }

  // Misma lógica que crearTuberias de esquema_pct23.js. velocidadPct es null cuando el tramo no depende de una bomba.
  function estadoTuberias(e) {
    const s = e.salidas, vN1 = e.consignas.velocidadN1Pct, gN1 = !!e.giro.N1;
    return {
      TUBO_N1: { activo: !!s.N1, velocidadPct: vN1, invertido: gN1 },
      TUBO_N2: { activo: !!s.N2, velocidadPct: e.consignas.velocidadN2Pct, invertido: !!e.giro.N2 },
      TUBO_PRODUCTO: { activo: !!(s.N1 && !s.SOL1), velocidadPct: vN1, invertido: gN1 },
      TUBO_DESVIO: { activo: !!(s.N1 && s.SOL1), velocidadPct: vN1, invertido: gN1 },
      TUBO_TANQUE_A: { activo: !s.SOL2, velocidadPct: vN1, invertido: gN1 },
      TUBO_TANQUE_B: { activo: !!s.SOL2, velocidadPct: vN1, invertido: gN1 },
      TUBO_SOL4: { activo: !!s.SOL4, velocidadPct: null, invertido: false },
      TUBO_SOL5: { activo: !!s.SOL5, velocidadPct: null, invertido: false },
      TUBO_FRIO: { activo: !!s.SOL3, velocidadPct: null, invertido: false },
      TUBO_COLECTOR_FRIO: { activo: !!(s.SOL3 || s.SOL4 || s.SOL5), velocidadPct: null, invertido: false },
      TUBO_COLECTOR_SUPERIOR: { activo: !!(s.SOL4 || s.SOL5), velocidadPct: null, invertido: false },
    };
  }

  // Igual que scada/tuberia.js: más velocidad de bomba, partículas más rápidas (de 2 s por ciclo al 10 % a 0,5 s al 100 %).
  const segundosPorCiclo = velocidadPct => 2.2 - 0.017 * Math.min(100, Math.max(10, velocidadPct));
  const VELOCIDAD_SIN_BOMBA_PCT = 50;
  const fraccion = x => ((x % 1) + 1) % 1;

  /** Posición relativa (0 a 1) a lo largo del trazo de la partícula i, dada la fase acumulada y el sentido (1 o -1). */
  const posicionParticula = (i, cuantas, fase, sentido) => fraccion(i / cuantas + sentido * fase);

  /* ---------- escena ---------- */

  function crear(THREE, estadoInicial, esquema) {
    const definicion = definirTubos(esquema || (typeof require !== 'undefined' ? require('../../scada/esquema_pct23.js') : PCT.esquemaPct23).ESQUEMA_PCT23);
    const grupo = new THREE.Group();
    const elementos = {}, recursos = [], tubos = [];
    const guardar = r => { recursos.push(r); return r; };
    const matrizTemporal = new THREE.Object3D();
    const geometriaParticula = guardar(new THREE.SphereGeometry(0.72, 12, 10));

    for (const tubo of definicion) {
      const g = new THREE.Group();
      const material = guardar(new THREE.MeshStandardMaterial({ color: COLOR[tubo.clase], roughness: 0.45, metalness: 0.15, emissive: COLOR[tubo.clase], emissiveIntensity: 0 }));
      const materialParticula = guardar(new THREE.MeshBasicMaterial({ color: 0xffffff }));
      const pistas = [];
      for (const trazo of tubo.trazos) {
        const curva = new THREE.CatmullRomCurve3(trazo.puntos3D.map(p => new THREE.Vector3(p.x, p.y, p.z)), false, 'centripetal');
        const malla = new THREE.Mesh(guardar(new THREE.TubeGeometry(curva, Math.min(Math.max(trazo.puntos3D.length * 3, 12), 700), RADIO_TUBO_CM, 12, false)), material);
        malla.userData.id = tubo.id; g.add(malla);
        if (trazo.sinFlujo) continue;
        const cuantas = Math.max(2, Math.round(curva.getLength() / SEPARACION_PARTICULAS_CM));
        const particulas = new THREE.InstancedMesh(geometriaParticula, materialParticula, cuantas);
        particulas.visible = false; particulas.frustumCulled = false; g.add(particulas);
        pistas.push({ curva, particulas, cuantas, sentido: trazo.inverso ? -1 : 1 });
      }
      const principal = tubo.trazos[0], medio = principal.puntos3D[Math.floor(principal.puntos3D.length / 2)];
      elementos[tubo.id] = { id: tubo.id, grupo: g, ancla: new THREE.Vector3(medio.x, medio.y + 2.5, medio.z), ayuda: tubo.ayuda };
      grupo.add(g);
      tubos.push({ id: tubo.id, material, pistas, fase: 0 });
    }

    let ultimo = null;
    function actualizar(estado) {
      const ahora = performance.now(), dt = ultimo === null ? 0 : Math.min((ahora - ultimo) / 1000, 0.1); ultimo = ahora;
      const activos = estadoTuberias(estado);
      for (const tubo of tubos) {
        const a = activos[tubo.id] || { activo: false };
        tubo.material.emissiveIntensity = a.activo ? 0.4 : 0;
        for (const pista of tubo.pistas) pista.particulas.visible = a.activo;
        if (!a.activo) continue;
        tubo.fase += dt / segundosPorCiclo(a.velocidadPct == null ? VELOCIDAD_SIN_BOMBA_PCT : a.velocidadPct);
        for (const pista of tubo.pistas) {
          const sentido = pista.sentido * (a.invertido ? -1 : 1);
          for (let i = 0; i < pista.cuantas; i++) {
            matrizTemporal.position.copy(pista.curva.getPointAt(posicionParticula(i, pista.cuantas, tubo.fase, sentido)));
            matrizTemporal.updateMatrix();
            pista.particulas.setMatrixAt(i, matrizTemporal.matrix);
          }
          pista.particulas.instanceMatrix.needsUpdate = true;
        }
      }
    }

    function liberar() { for (const r of recursos) if (r && r.dispose) r.dispose(); for (const t of tubos) for (const p of t.pistas) p.particulas.dispose(); }

    if (estadoInicial) actualizar(estadoInicial);
    return { grupo, elementos, actualizar, liberar };
  }

  const api = { crear, parsearPath, redondearEsquinas, trazoA3D, identificarTubo, definirTubos, estadoTuberias, segundosPorCiclo, posicionParticula,
    RADIO_TUBO_CM, ALTURA_CRUCE_CM };
  if (typeof module !== 'undefined') module.exports = api; else PCT.planta3dTuberias = api;
})();
