// Kit de construcción 3D de la instalación fotovoltaica (DISEÑADOR). Materiales con dos calidades (alta: PBR con mapa de entorno procedural; baja: Lambert) y ensambles que
// FUSIONAN las geometrías estáticas de cada equipo por material (una malla por material). Las funciones puras (sol, cielo, colores, lectura tolerante del estado)
// van aparte para probarlas con node:test sin THREE.
(function () {
  const PALETA = {
    aluminio: 0xc9ced3, aluminioViejo: 0xd9d4c2, marcoNegro: 0x1b1e22, negro: 0x16181b, goma: 0x25282c, blanco: 0xf1f1ec, blancoCaja: 0xe6e8e8, gris: 0x9aa1a7, grisOscuro: 0x4a5057,
    taupe: 0xa89e8e, taupeClaro: 0xb8afa0, interiorMetal: 0x8e9c9a, crema: 0xe6d6a6, cremaOscuro: 0xcdbb87, hormigon: 0xb4ad9f, hormigonOscuro: 0x8f8a80, aislante: 0xe9e3b6,
    cesped: 0x3f7f2c, impermeable: 0x4f555a, impermeableClaro: 0x62686c, azul: 0x1f60ab, azulOscuro: 0x143f73, rojo: 0xc0242b, naranja: 0xe58b1c, amarillo: 0xe6c229, verde: 0x2fa84f,
    cobre: 0xb87333, latonera: 0xb4913d, zcs: 0x5a5e66, vidrio: 0x2a2f34, humo: 0x23282c, galvanizado: 0xc2c8cd, ladrillo: 0xa6482e, ocre: 0xd8b57a, rosa: 0xd9a98c, tierra: 0x8d7b5a,
  };
  const limitar = (v, a, b) => Math.max(a, Math.min(b, v));
  const R = c => (c >> 16) & 255, G = c => (c >> 8) & 255, B = c => c & 255;
  const num = (v, defecto) => (typeof v === 'number' && Number.isFinite(v) ? v : defecto);
  const decimal = (v, c = 1) => num(v, 0).toFixed(c).replace('.', ',');
  function mezclarHex(a, b, t) {
    t = limitar(t, 0, 1);
    return (Math.round(R(a) + (R(b) - R(a)) * t) << 16) | (Math.round(G(a) + (G(b) - G(a)) * t) << 8) | Math.round(B(a) + (B(b) - B(a)) * t);
  }
  const suavizar = (a, b, x) => { const t = limitar((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  /* ---------- Lectura tolerante del estado (contrato de ARQUITECTURA.md §3): nunca lanza ---------- */
  const VACIO = Object.freeze({});
  const inversorDe = (estado, tag) => (estado && estado.inversores && estado.inversores[tag]) || VACIO;
  const proteccionDe = (estado, tag) => (estado && estado.protecciones && estado.protecciones[tag]) || VACIO;
  const bateriaDe = estado => (estado && estado.bateria) || VACIO;
  const averiaActiva = (estado, id) => !!(estado && Array.isArray(estado.averiasActivas) && estado.averiasActivas.some(a => (typeof a === 'string' ? a : a && a.id) === id));
  /** Panel (objeto del estado) por su tag, o VACIO. */
  function panelDe(estado, tag) {
    const campos = estado && estado.campos;
    if (!campos) return VACIO;
    for (const campo of Object.values(campos)) for (const c of (campo.cadenas || [])) for (const p of (c.paneles || [])) if (p.tag === tag) return Object.assign({}, p, { cadena: c });
    return VACIO;
  }
  const cadenaDeEstado = (estado, id) => {
    const campos = estado && estado.campos;
    if (campos) for (const campo of Object.values(campos)) for (const c of (campo.cadenas || [])) if (c.id === id) return c;
    return VACIO;
  };

  /* ---------- Sol, cielo y luz (funciones puras) ---------- */
  /** Vector unitario hacia el sol. Azimut 0 = sur (+z), positivo hacia el oeste (−x); la altura es sobre el horizonte. */
  function direccionSol(sol) {
    const alt = rad(num(sol && sol.alturaGrados, 45)), az = rad(num(sol && sol.azimutGrados, 0));
    return { x: -Math.sin(az) * Math.cos(alt), y: Math.sin(alt), z: Math.cos(az) * Math.cos(alt) };
  }
  function rad(g) { return g * Math.PI / 180; }

  /**
   * Luz que da el sol y el cielo: intensidad del sol (0 de noche; la nubosidad la atenúa mucho), su color (anaranjado al amanecer y al ponerse),
   * y los parámetros de la luz hemisférica de relleno (más difusa con nubes, casi nula de noche).
   */
  function luzSolar(estado) {
    const alt = num(estado && estado.sol && estado.sol.alturaGrados, 45);
    const nub = limitar(num(estado && estado.ambiente && estado.ambiente.nubosidad, 0), 0, 1);
    const dia = suavizar(-3, 14, alt);                               // 0 de noche, 1 a pleno día
    const directa = suavizar(-1, 12, alt) * (1 - 0.9 * nub);
    return {
      altura: alt, esDia: alt > 0, nubosidad: nub, dia,
      intensidad: 3.1 * directa * (0.55 + 0.45 * Math.sin(rad(Math.max(alt, 0)))),
      color: mezclarHex(0xff9a55, 0xfff0dc, suavizar(0, 28, alt)),
      hemiIntensidad: 0.16 + 0.5 * dia + 0.14 * nub * dia,
      hemiCielo: mezclarHex(0x1d2b4d, mezclarHex(0xb4d0ee, 0xcfd6dd, nub), dia),
      hemiSuelo: mezclarHex(0x10141c, 0x6a665c, dia),
      estrellas: 1 - suavizar(-9, 0, alt),
    };
  }
  /** Colores del cielo (cenit y horizonte, 0xRRGGBB) según la altura del sol y la nubosidad. */
  function coloresCielo(alturaGrados, nubosidad) {
    const nub = limitar(num(nubosidad, 0), 0, 1), alt = num(alturaGrados, 45);
    const dia = suavizar(-8, 18, alt), ocaso = Math.exp(-Math.pow((alt - 1) / 7, 2)) * (1 - 0.55 * nub);
    let cenit = mezclarHex(0x050a18, mezclarHex(0x3a7ad0, 0x9aa9ba, nub * 0.8), dia);
    let horizonte = mezclarHex(0x141d38, mezclarHex(0xbcd7ee, 0xcdd3d9, nub * 0.85), dia);
    horizonte = mezclarHex(horizonte, 0xf29a55, ocaso * 0.8);
    cenit = mezclarHex(cenit, 0x56689c, ocaso * 0.35);
    return { cenit, horizonte };
  }
  /** Factor de brillo de un panel con sombra01 (0 = al sol, 1 = a la sombra total): hasta oscurecerlo al 28 %. */
  const factorSombra = s => 1 - 0.72 * limitar(num(s, 0), 0, 1);

  /* ---------- Textos de las pantallas (puros) ---------- */
  /** Líneas de la pantalla LCD del EASun. */
  function textoEasun(inv, bat) {
    const estado = inv.estado || 'APAGADO';
    if (estado === 'APAGADO') return { apagado: true, ac: '', bat: '', pv: '', carga: '', icono: '' };
    return { apagado: false, ac: decimal(num(inv.redP, 0) > 5 || inv.leds && inv.leds.red ? 230 : 0, 0), bat: decimal(num(bat && bat.v, 25.6), 1), pv: decimal(num(inv.pvP, 0), 0), carga: decimal(num(inv.cargaP, 0), 0),
      fallo: estado === 'FALLO', etapa: inv.etapaCarga || 'NINGUNA', modo: inv.modo || '' };
  }
  /** Líneas de la pantalla del ZCS. */
  function textoZcs(inv) {
    const estado = inv.estado || 'APAGADO';
    const nombres = { APAGADO: 'Apagado', ESPERA_AISLAMIENTO: 'Comprobando aislamiento', ESPERA_RED: 'Esperando a la red', OPERANDO: 'Conectado a red', FALLO: 'FALLO', REDUCIDO: 'Potencia reducida' };
    const mppt = inv.mppt || [];
    return { apagado: estado === 'APAGADO', estado: nombres[estado] || estado, pac: decimal(num(inv.acP, 0), 0) + ' W', vac: decimal(num(inv.acV, 0), 0) + ' V', fac: decimal(num(inv.acF, 0), 2) + ' Hz',
      pv1: decimal(num(mppt[0] && mppt[0].v, 0), 0) + ' V  ' + decimal(num(mppt[0] && mppt[0].i, 0), 1) + ' A', pv2: decimal(num(mppt[1] && mppt[1].v, 0), 0) + ' V  ' + decimal(num(mppt[1] && mppt[1].i, 0), 1) + ' A',
      alarma: inv.alarma || '', espera: num(inv.segundosParaConexion, 0) };
  }

  /* ---------- Calidad gráfica y materiales PBR ligeros ---------- */
  const ESTILO = { calidad: 'baja', envMap: null };
  function fijarEstilo(estilo) {
    ESTILO.calidad = estilo && estilo.calidad === 'alta' ? 'alta' : 'baja';
    ESTILO.envMap = ESTILO.calidad === 'alta' && estilo.envMap ? estilo.envMap : null;
  }
  const estiloActual = () => ({ calidad: ESTILO.calidad, envMap: ESTILO.envMap });
  function elegirCalidad({ forzada, porSoftware, lento } = {}) {
    if (forzada === 'alta' || forzada === 'baja') return forzada;
    return porSoftware || lento ? 'baja' : 'alta';
  }
  const PBR = {
    aluminio: { metalness: 0.9, roughness: 0.3, envMapIntensity: 1.3 }, aluminioViejo: { metalness: 0.8, roughness: 0.42, envMapIntensity: 1.0 },
    marcoNegro: { metalness: 0.7, roughness: 0.4, envMapIntensity: 1.0 }, galvanizado: { metalness: 0.6, roughness: 0.45, envMapIntensity: 0.7 },
    taupe: { metalness: 0.45, roughness: 0.46, envMapIntensity: 0.9 }, taupeClaro: { metalness: 0.45, roughness: 0.46, envMapIntensity: 0.9 }, interiorMetal: { metalness: 0.6, roughness: 0.4, envMapIntensity: 0.9 },
    zcs: { metalness: 0.35, roughness: 0.5, envMapIntensity: 0.8 }, negro: { metalness: 0.0, roughness: 0.5, envMapIntensity: 0.6 }, goma: { metalness: 0.0, roughness: 0.85, envMapIntensity: 0.3 },
    hormigon: { metalness: 0.0, roughness: 0.95, envMapIntensity: 0.3 }, hormigonOscuro: { metalness: 0.0, roughness: 0.95, envMapIntensity: 0.3 },
    impermeable: { metalness: 0.0, roughness: 0.92, envMapIntensity: 0.35 }, impermeableClaro: { metalness: 0.0, roughness: 0.92, envMapIntensity: 0.35 },
    cesped: { metalness: 0.0, roughness: 1.0, envMapIntensity: 0.2 }, crema: { metalness: 0.0, roughness: 0.85, envMapIntensity: 0.3 }, cremaOscuro: { metalness: 0.0, roughness: 0.85, envMapIntensity: 0.3 },
    cobre: { metalness: 0.95, roughness: 0.32, envMapIntensity: 1.1 }, latonera: { metalness: 0.95, roughness: 0.34, envMapIntensity: 1.1 },
    vidrio: { metalness: 0.0, roughness: 0.08, envMapIntensity: 1.4 }, humo: { metalness: 0.0, roughness: 0.1, envMapIntensity: 1.3 },
  };
  const PINTURA = { metalness: 0.05, roughness: 0.55, envMapIntensity: 0.7 };
  function parametrosPBR(clave, opciones = {}) {
    if (typeof clave === 'string' && PBR[clave]) return Object.assign({}, PBR[clave]);
    if (opciones.transparent || (typeof opciones.opacity === 'number' && opciones.opacity < 1)) return { metalness: 0, roughness: 0.12, envMapIntensity: 1.2 };
    return Object.assign({}, PINTURA);
  }
  const PROPIEDADES_PBR = new Set(['metalness', 'roughness', 'envMapIntensity', 'roughnessMap', 'metalnessMap', 'normalMap', 'normalScale', 'bumpMap', 'bumpScale', 'envMap', 'clearcoat', 'emissive', 'emissiveIntensity']);
  /** Clase y propiedades del material (puro): Lambert en calidad baja, Standard en alta. */
  function especificacionMaterial(clave, opciones = {}, calidad = ESTILO.calidad) {
    const color = typeof clave === 'string' && PALETA[clave] !== undefined ? PALETA[clave] : clave;
    if (calidad !== 'alta') {
      const props = { color };
      for (const k of Object.keys(opciones)) if (!PROPIEDADES_PBR.has(k)) props[k] = opciones[k];
      return { clase: 'MeshLambertMaterial', props };
    }
    return { clase: 'MeshStandardMaterial', props: Object.assign({ color }, parametrosPBR(clave, opciones), opciones) };
  }

  /**
   * Cubo de entorno de una cubierta al aire libre (sin imágenes): cielo azul con horizonte claro, suelo gris. Lo reflejan los vidrios y metales,
   * así que el panel «tiene cielo». `pintarCaraEntorno` es pura sobre un contexto 2D (se prueba con uno falso).
   */
  const CARAS_ENTORNO = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
  function pintarCaraEntorno(ctx, cara, n = 128) {
    const degradado = (y0, y1, paradas) => { const d = ctx.createLinearGradient(0, y0, 0, y1); for (const [t, c] of paradas) d.addColorStop(t, c); return d; };
    if (cara === 'py') { ctx.fillStyle = '#4f86c8'; ctx.fillRect(0, 0, n, n); ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.arc(n * 0.65, n * 0.35, n * 0.1, 0, Math.PI * 2); ctx.fill(); }
    else if (cara === 'ny') { ctx.fillStyle = '#4b5155'; ctx.fillRect(0, 0, n, n); }
    else {
      ctx.fillStyle = degradado(0, n, [[0, '#5c93d2'], [0.45, '#bcd7ee'], [0.5, '#9aa0a2'], [0.52, '#5d6366'], [1, '#43494c']]); ctx.fillRect(0, 0, n, n);
      ctx.fillStyle = 'rgba(190,176,150,0.7)'; ctx.fillRect(n * 0.1, n * 0.36, n * 0.25, n * 0.14); ctx.fillRect(n * 0.55, n * 0.4, n * 0.3, n * 0.1);
      ctx.fillStyle = 'rgba(60,100,50,0.7)'; ctx.fillRect(0, n * 0.44, n, n * 0.06);
    }
  }
  function crearEntorno(THREE, n = 128) {
    const lienzos = CARAS_ENTORNO.map(cara => { const c = document.createElement('canvas'); c.width = c.height = n; pintarCaraEntorno(c.getContext('2d'), cara, n); return c; });
    const cubo = new THREE.CubeTexture(lienzos);
    cubo.colorSpace = THREE.SRGBColorSpace; cubo.needsUpdate = true;
    return cubo;
  }
  /** Ruido suave en un canvas (enlosable, repetible por semilla): impermeabilizante, césped, hormigón, tablero. */
  function lienzoRuido({ n = 256, base = '#808080', manchas = 90, contraste = 14, grano = 0, semilla = 7, radioMax = 0.16 } = {}) {
    const c = document.createElement('canvas'); c.width = c.height = n;
    const g = c.getContext('2d');
    let s = semilla >>> 0;
    const azar = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    g.fillStyle = base; g.fillRect(0, 0, n, n);
    for (let i = 0; i < manchas; i++) {
      const x = azar() * n, y = azar() * n, r = 4 + azar() * n * radioMax, d = (azar() - 0.5) * 2 * contraste;
      g.fillStyle = d > 0 ? `rgba(255,255,255,${(d / 255).toFixed(3)})` : `rgba(0,0,0,${(-d / 255).toFixed(3)})`;
      for (const [dx, dy] of [[0, 0], [n, 0], [-n, 0], [0, n], [0, -n]]) { g.beginPath(); g.arc(x + dx, y + dy, r, 0, Math.PI * 2); g.fill(); }
    }
    for (let i = 0; i < grano; i++) {                                           // grano fino (arena del impermeabilizante, hebras del césped)
      const x = azar() * n, y = azar() * n, d = azar() < 0.5;
      g.fillStyle = d ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.16)'; g.fillRect(x, y, 1.5, 1.5);
    }
    return c;
  }

  function crearKit(THREE) {
    const recursos = [];
    const registrar = r => { recursos.push(r); return r; };
    const materiales = new Map();
    const calidad = ESTILO.calidad, envMap = ESTILO.envMap;
    const crearMaterial = (clave, opciones) => {
      const { clase, props } = especificacionMaterial(clave, opciones, calidad);
      if (clase === 'MeshStandardMaterial' && envMap && props.envMap === undefined) props.envMap = envMap;
      return registrar(new THREE[clase](props));
    };
    const mat = clave => { if (!materiales.has(clave)) materiales.set(clave, crearMaterial(clave, {})); return materiales.get(clave); };
    const matDinamico = (color, opciones = {}) => crearMaterial(color, opciones);
    const matLed = color => registrar(new THREE.MeshBasicMaterial(calidad === 'alta' ? { color, toneMapped: false } : { color }));
    const tmp = new THREE.Object3D();

    const cil = (r, h, seg = 12) => new THREE.CylinderGeometry(r, r, h, seg);
    const cono = (r1, r2, h, seg = 12) => new THREE.CylinderGeometry(r2, r1, h, seg);
    const caja = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const esfera = (r, seg = 10) => new THREE.SphereGeometry(r, seg, Math.max(5, seg - 3));
    const toro = (radio, tubo, arco = Math.PI * 2, seg = 12) => new THREE.TorusGeometry(radio, tubo, 6, seg, arco);
    /** Prisma triangular de la sección (z, y) con `grosor` a lo largo de x; opcional hueco triangular interior (cm). Sección = [[z, y], ...]. */
    function prisma(puntos, grosor, hueco) {
      const forma = new THREE.Shape(puntos.map(([z, y]) => new THREE.Vector2(z, y)));
      if (hueco) forma.holes.push(new THREE.Path(hueco.map(([z, y]) => new THREE.Vector2(z, y))));
      const g = new THREE.ExtrudeGeometry(forma, { depth: grosor, bevelEnabled: false, steps: 1 });
      g.rotateY(-Math.PI / 2); g.translate(grosor / 2, 0, 0);        // la sección queda en el plano (z, y) y se extruye a lo largo de x, centrada
      return g;
    }
    /** Cable (tubo) siguiendo una lista de puntos [x, y, z] con suavizado. */
    function tubo(puntos, radio = 0.6, tramos = 24, radiales = 5) {
      const curva = new THREE.CatmullRomCurve3(puntos.map(p => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.2);
      return new THREE.TubeGeometry(curva, Math.max(2, Math.min(tramos, puntos.length * 8)), radio, radiales, false);
    }

    function fusionar(lista) {
      let total = 0;
      for (const g of lista) total += g.attributes.position.count;
      const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
      let desplazamiento = 0;
      for (const g of lista) {
        pos.set(g.attributes.position.array, desplazamiento * 3); nor.set(g.attributes.normal.array, desplazamiento * 3);
        desplazamiento += g.attributes.position.count; g.dispose();
      }
      const fusionada = new THREE.BufferGeometry();
      fusionada.setAttribute('position', new THREE.BufferAttribute(pos, 3)); fusionada.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      return fusionada;
    }

    /** Piezas estáticas de un equipo. add() acumula; construir() crea UNA malla por material con userData.id. */
    class Ensamble {
      constructor() { this.porMaterial = new Map(); }
      add(geometria, clave, pos = [0, 0, 0], rot = [0, 0, 0], esc = [1, 1, 1]) {
        tmp.position.set(pos[0], pos[1], pos[2]); tmp.rotation.set(rot[0], rot[1], rot[2]); tmp.scale.set(esc[0], esc[1], esc[2]); tmp.updateMatrix();
        const g = geometria.index ? geometria.toNonIndexed() : geometria.clone();
        geometria.dispose(); g.applyMatrix4(tmp.matrix);
        if (!this.porMaterial.has(clave)) this.porMaterial.set(clave, []);
        this.porMaterial.get(clave).push(g);
        return this;
      }
      /** Atajo: caja w×h×d centrada en `pos`. */
      caja(w, h, d, clave, pos, rot, esc) { return this.add(caja(w, h, d), clave, pos, rot, esc); }
      construir(padre, id, opciones = {}) {
        const mallas = [];
        for (const [clave, lista] of this.porMaterial) {
          const geometria = registrar(fusionar(lista));
          const m = new THREE.Mesh(geometria, typeof clave === 'object' ? clave : mat(clave));
          m.userData.id = id; m.userData.clave = typeof clave === 'object' ? 'dinamico' : clave;
          if (opciones.sinRayo) m.raycast = () => {};
          if (opciones.sombras !== false) { m.castShadow = true; m.receiveShadow = true; }
          padre.add(m); mallas.push(m);
        }
        this.porMaterial.clear();
        return mallas;
      }
    }

    /** Malla suelta (pieza que se anima o cambia de color). */
    function malla(geometria, material, padre, id, pos = [0, 0, 0], rot = [0, 0, 0]) {
      const m = new THREE.Mesh(registrar(geometria), material);
      m.position.set(pos[0], pos[1], pos[2]); m.rotation.set(rot[0], rot[1], rot[2]);
      if (id) m.userData.id = id;
      padre.add(m); return m;
    }
    /** Textura de canvas dibujable (null sin DOM: pruebas en node). `pintar(ctx, ancho, alto)` se llama al crear y en cada repintar(). */
    function pantalla(ancho, alto, pintar) {
      if (typeof document === 'undefined') return null;
      const c = document.createElement('canvas'); c.width = ancho; c.height = alto;
      const ctx = c.getContext('2d'), textura = registrar(new THREE.CanvasTexture(c));
      textura.colorSpace = THREE.SRGBColorSpace; textura.anisotropy = 4;
      const repintar = (...args) => { ctx.clearRect(0, 0, ancho, alto); pintar(ctx, ancho, alto, ...args); textura.needsUpdate = true; };
      repintar();
      return { textura, ctx, canvas: c, repintar };
    }

    return { THREE, PALETA, calidad, envMap, mat, matDinamico, matLed, cil, cono, caja, esfera, toro, prisma, tubo, malla, pantalla, registrar,
      ensamble: () => new Ensamble(), liberar() { for (const r of recursos) if (r && r.dispose) r.dispose(); recursos.length = 0; materiales.clear(); } };
  }

  const api = { PALETA, limitar, num, decimal, suavizar, mezclarHex, rad, inversorDe, proteccionDe, bateriaDe, averiaActiva, panelDe, cadenaDeEstado,
    direccionSol, luzSolar, coloresCielo, factorSombra, textoEasun, textoZcs,
    PBR, fijarEstilo, estiloActual, elegirCalidad, parametrosPBR, especificacionMaterial, CARAS_ENTORNO, pintarCaraEntorno, crearEntorno, lienzoRuido, crearKit };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else { window.PCT = window.PCT || {}; PCT.fvKit = api; }
})();
