// Kit de construcción 3D de la planta HTST (DISEÑADOR). Materiales LIGEROS (MeshLambert en calidad baja; PBR con entorno en calidad alta) y ensambles que FUSIONAN las geometrías
// estáticas de cada equipo por material: así un equipo de cien piezas cuesta 2 o 3 llamadas de dibujo en vez de cien.
// Las funciones puras (colores por temperatura, lectura tolerante del estado, ángulos) van aparte para probarlas con node:test.
(function () {
  const PALETA = {
    inox: 0xc3cbd3, inoxMate: 0x98a2ac, oscuro: 0x2a2f36, negro: 0x15181c, azul: 0x1f5fa8, rojo: 0xc0392b, verde: 0x2e9e55, amarillo: 0xe0b030,
    laton: 0xb4913d, junta: 0x1c2025, gris: 0xd9dcde, grisOscuro: 0x7d848b, naranja: 0xd9631e, blanco: 0xf2f0e6, cobre: 0xb87333,
    agua: 0x2f7fc7, cian: 0x4fb7d8, vidrio: 0x9fc4d9, suelo: 0x20262c, patin: 0x8c969f,
  };
  const limitar = (v, a, b) => Math.max(a, Math.min(b, v));
  const R = (c) => (c >> 16) & 255, G = (c) => (c >> 8) & 255, B = (c) => c & 255;

  /** Mezcla dos colores 0xRRGGBB: t = 0 da `a`; t = 1 da `b`. */
  function mezclarHex(a, b, t) {
    t = limitar(t, 0, 1);
    return (Math.round(R(a) + (R(b) - R(a)) * t) << 16) | (Math.round(G(a) + (G(b) - G(a)) * t) << 8) | Math.round(B(a) + (B(b) - B(a)) * t);
  }
  // La leche fría es blanca y la caliente se vuelve algo cremosa/ámbar; el agua caliente va del azul al naranja rojizo.
  const colorLeche = tC => mezclarHex(0xf6f3ea, 0xf0be8c, (tC - 4) / 70);
  const colorAguaCaliente = tC => mezclarHex(0x3a8fd0, 0xe2572a, (tC - 20) / 70);
  // Convención de colores del usuario: PRODUCTO verde, agua fría azul, agua caliente naranja. La leche en tubos y niveles es verde; con el calor vira a un verde claro cálido.
  const VERDE_PRODUCTO = 0x2f9e44, AZUL_AGUA = 0x2f7fc7, NARANJA_AGUA_CALIENTE = 0xd9631e;
  const colorProducto = tC => mezclarHex(VERDE_PRODUCTO, 0xa6e3a1, (tC - 4) / 70);
  const colorTuboCaliente = tC => mezclarHex(0x8fd1a0, 0xe8c39a, (tC - 20) / 60);

  // Lectura tolerante del estado v1 (ARQUITECTURA.md §4): si falta un campo se usa un valor por defecto y nunca se lanza una excepción.
  const VACIO = Object.freeze({});
  const equipoDe = (estado, tag) => (estado && estado.equipos && estado.equipos[tag]) || VACIO;
  const instrumentoDe = (estado, tag) => (estado && estado.instrumentos && estado.instrumentos[tag]) || VACIO;
  const num = (v, defecto) => (typeof v === 'number' && Number.isFinite(v) ? v : defecto);
  const temperaturaDe = (estado, clave, defecto = 20) => num(estado && estado.proceso && estado.proceso.temperaturas && estado.proceso.temperaturas[clave], defecto);
  const caudalLh = estado => num(estado && estado.proceso && estado.proceso.caudalLh, 0);
  const nivelTanquePct = estado => limitar(num(estado && estado.tanque && estado.tanque.nivelPct, 60), 0, 100);

  /** Nivel (%) del depósito de agua caliente: `aguaCaliente.nivelPct` y, si falta, el del equipo HW-201; por defecto 70 %. */
  function nivelAguaCalientePct(estado) {
    const a = estado && estado.aguaCaliente, h = equipoDe(estado, 'HW-201');
    return limitar(num(a && a.nivelPct, num(h.nivelPct, 70)), 0, 100);
  }
  /** Temperatura (°C) del agua caliente: aguaCaliente.temperaturaC, luego HW-201 y por último proceso.temperaturas.aguaCaliente. */
  function temperaturaAguaCaliente(estado) {
    const a = estado && estado.aguaCaliente, h = equipoDe(estado, 'HW-201');
    return num(a && a.temperaturaC, num(h.temperaturaC, temperaturaDe(estado, 'aguaCaliente', 20)));
  }
  /** ¿Está encendido el banco n (1 o 2) del calentador? Manda el contactor KM-201/KM-202 (`cerrado`); si no hay dato, `banco1`/`banco2` de HW-201. */
  function bancoEncendido(estado, n) {
    const km = equipoDe(estado, n === 1 ? 'KM-201' : 'KM-202');
    if (typeof km.cerrado === 'boolean') return km.cerrado;
    return !!equipoDe(estado, 'HW-201')[n === 1 ? 'banco1' : 'banco2'];
  }
  /** Contacto del flotador de nivel bajo LSL-201 (NC): 'cerrado' = hay agua, 'abierto' = nivel bajo o hilo roto, 'desconocido' = sin dato. */
  function contactoLSL(estado, tag = 'LSL-201') {
    const c = equipoDe(estado, tag).contactoCerrado;
    if (typeof c === 'boolean') return c ? 'cerrado' : 'abierto';
    const n = instrumentoDe(estado, tag).nivel;
    return n === 1 || n === true ? 'cerrado' : n === 0 || n === false ? 'abierto' : 'desconocido';
  }
  /** ¿Está abierta una válvula todo/nada (`abierta`)? */
  const valvulaAbierta = (estado, tag) => !!equipoDe(estado, tag).abierta;
  /** ¿Rebosa el tanque de balance? (`tanque.desbordando` o `equipos['TK-101'].desbordando`). */
  const tanqueDesbordando = estado => !!((estado && estado.tanque && estado.tanque.desbordando) || equipoDe(estado, 'TK-101').desbordando);

  /** Apertura 0..1 de la FDV (1 = avance, 0 = desvío): usa `apertura01` y, si no está, `posicion`. */
  function aperturaFDV(estado) {
    const e = equipoDe(estado, 'FDV-101');
    if (typeof e.apertura01 === 'number') return limitar(e.apertura01, 0, 1);
    return e.posicion === 'AVANCE' ? 1 : e.posicion === 'MOVIENDO' ? 0.5 : 0;
  }

  /** Radianes por segundo del giro VISUAL de una bomba o un ventilador: 100 % = una vuelta y media por segundo. */
  const velocidadAngularVisual = (marcha, velocidadPct) => (marcha ? limitar(num(velocidadPct, 100), 0, 100) / 100 * Math.PI * 3 : 0);

  /** Color de un LED de lazo según la calidad de la señal del instrumento. */
  function colorLedCalidad(calidad) {
    if (calidad === 'OK' || calidad === undefined) return 0x35e06b;
    if (calidad === 'RUIDO' || calidad === 'DERIVA') return 0xffb020;
    if (calidad === 'CONGELADO') return 0x5aa7ff;
    return 0xff3b30;                                    // ABIERTO, CORTO
  }

  /* ---------- Calidad gráfica y materiales PBR ligeros ----------
   * Dos niveles: 'alta' (MeshStandardMaterial con metal/rugosidad y mapa de entorno procedural, luz de nave y sombras suaves) y 'baja' (los materiales Lambert de
   * siempre: sin mapa de entorno ni sombras; es el nivel del «modo lento» del visor). El nivel vigente es un estilo global que la escena fija ANTES de crear los
   * módulos (cada módulo hace su propio crearKit), así ningún módulo cambia de firma. Sin estilo fijado (pruebas, otras escenas) todo es Lambert como antes. */
  const ESTILO = { calidad: 'baja', envMap: null };
  /** Fija el estilo de los kits que se creen a partir de ahora: { calidad: 'alta' | 'baja', envMap }. Con calidad baja el envMap se ignora. */
  function fijarEstilo(estilo) {
    ESTILO.calidad = estilo && estilo.calidad === 'alta' ? 'alta' : 'baja';
    ESTILO.envMap = ESTILO.calidad === 'alta' && estilo.envMap ? estilo.envMap : null;
  }
  const estiloActual = () => ({ calidad: ESTILO.calidad, envMap: ESTILO.envMap });

  /**
   * Nivel de calidad (función pura). `forzada` ('alta' | 'baja', p. ej. de ?calidad= en la dirección) manda sobre todo; si no, el dibujo por software
   * (sin tarjeta gráfica) o un visor ya declarado lento dan 'baja' y cualquier otro caso 'alta'.
   */
  function elegirCalidad({ forzada, porSoftware, lento } = {}) {
    if (forzada === 'alta' || forzada === 'baja') return forzada;
    return porSoftware || lento ? 'baja' : 'alta';
  }

  // Parámetros PBR por material de la paleta (metalness 0..1, roughness 0..1, intensidad del entorno). Todo lo no listado se trata como pintura/plástico.
  const PBR = {
    inox: { metalness: 0.92, roughness: 0.22, envMapIntensity: 1.5 },        // acero inoxidable satinado: refleja la nave
    inoxMate: { metalness: 0.85, roughness: 0.38, envMapIntensity: 1.25 },     // inox cepillado
    patin: { metalness: 0.82, roughness: 0.42, envMapIntensity: 0.95 },
    laton: { metalness: 0.95, roughness: 0.34, envMapIntensity: 1.1 },
    cobre: { metalness: 0.95, roughness: 0.32, envMapIntensity: 1.1 },
    oscuro: { metalness: 0.45, roughness: 0.5, envMapIntensity: 0.8 },        // fundición / acero pintado oscuro
    grisOscuro: { metalness: 0.5, roughness: 0.48, envMapIntensity: 0.85 },
    negro: { metalness: 0.0, roughness: 0.55, envMapIntensity: 0.7 },         // plástico y goma negros
    junta: { metalness: 0.0, roughness: 0.9, envMapIntensity: 0.35 },         // goma
    vidrio: { metalness: 0.0, roughness: 0.08, envMapIntensity: 1.3 },
    agua: { metalness: 0.0, roughness: 0.1, envMapIntensity: 1.2 },
    suelo: { metalness: 0.0, roughness: 0.4, envMapIntensity: 0.9 },
  };
  const PINTURA = { metalness: 0.08, roughness: 0.48, envMapIntensity: 0.8 };
  const LIQUIDO = { metalness: 0.0, roughness: 0.1, envMapIntensity: 1.2 };
  const PLASTICO_CON_TEXTURA = { metalness: 0.0, roughness: 0.4, envMapIntensity: 0.8 };

  /** ¿Un color 0xRRGGBB parece acero? Claro y casi gris con un punto azulado (los blancos cálidos y los colores vivos son pintura). */
  function pareceAcero(color) {
    const r = R(color), g = G(color), b = B(color);
    return Math.max(r, g, b) - Math.min(r, g, b) < 36 && (r + g + b) / 3 > 120 && b >= r - 3;
  }

  /**
   * Parámetros PBR de un material (función pura). `clave` es una clave de la paleta o un color 0xRRGGBB; `opciones` son las del material
   * (transparent, map…). Un material translúcido es vidrio o líquido; uno con textura, plástico; un gris azulado claro, acero; el resto, pintura.
   * Los parámetros explícitos de `opciones` (metalness, roughness…) siempre mandan: este resultado solo rellena lo que falta.
   */
  function parametrosPBR(clave, opciones = {}) {
    let base;
    if (typeof clave === 'string' && PBR[clave]) base = PBR[clave];
    else if (opciones.transparent || (typeof opciones.opacity === 'number' && opciones.opacity < 1)) base = LIQUIDO;
    else if (opciones.map) base = PLASTICO_CON_TEXTURA;
    else {
      const color = typeof clave === 'string' ? PALETA[clave] : clave;
      base = typeof color === 'number' && pareceAcero(color) ? PBR.inox : PINTURA;
    }
    return Object.assign({}, base);
  }

  const PROPIEDADES_PBR = new Set(['metalness', 'roughness', 'envMapIntensity', 'roughnessMap', 'metalnessMap', 'normalMap', 'normalScale', 'bumpMap', 'bumpScale', 'envMap', 'clearcoat']);

  /** Clase y propiedades del material que pide un color/clave con las opciones dadas, según la calidad (función pura, probada sin THREE). */
  function especificacionMaterial(clave, opciones = {}, calidad = ESTILO.calidad) {
    const color = typeof clave === 'string' && PALETA[clave] !== undefined ? PALETA[clave] : clave;
    if (calidad !== 'alta') {                                                   // Lambert no tiene propiedades PBR: se descartan para no llenar la consola de avisos
      const props = { color };
      for (const k of Object.keys(opciones)) if (!PROPIEDADES_PBR.has(k)) props[k] = opciones[k];
      return { clase: 'MeshLambertMaterial', props };
    }
    return { clase: 'MeshStandardMaterial', props: Object.assign({ color }, parametrosPBR(clave, opciones), opciones) };
  }

  /**
   * Cubo de entorno de una nave industrial (sin red ni imágenes): seis caras de 128 px dibujadas con canvas 2D. Techo gris con dos filas de luminarias
   * lineales, paredes de panel con una franja de ventanas y suelo de resina con su reflejo. Los metales reflejan esto, así que el acero «tiene nave».
   * `pintarCara(ctx, cara, n)` es pura sobre un contexto 2D (se prueba con uno falso); `crearEntorno` necesita DOM.
   */
  const CARAS_ENTORNO = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
  function pintarCaraEntorno(ctx, cara, n = 128) {
    const degradado = (x0, y0, x1, y1, paradas) => { const d = ctx.createLinearGradient(x0, y0, x1, y1); for (const [t, c] of paradas) d.addColorStop(t, c); return d; };
    if (cara === 'py') {                                                       // techo: oscuro, con tres filas de luminarias lineales muy brillantes
      ctx.fillStyle = degradado(0, 0, 0, n, [[0, '#454c52'], [1, '#5d656c']]); ctx.fillRect(0, 0, n, n);
      ctx.fillStyle = '#ffffff';
      for (const x of [0.2, 0.5, 0.8]) ctx.fillRect(n * (x - 0.04), n * 0.06, n * 0.08, n * 0.88);
      ctx.fillStyle = '#333a40'; for (let k = 1; k < 6; k++) ctx.fillRect(0, n * k / 6 - 1.5, n, 3);                // correas del techo
    } else if (cara === 'ny') {                                                // suelo de resina: oscuro, con el reflejo alargado de las luminarias
      ctx.fillStyle = '#2d343a'; ctx.fillRect(0, 0, n, n);
      ctx.fillStyle = degradado(0, 0, n, 0, [[0, 'rgba(255,255,255,0)'], [0.2, 'rgba(255,255,255,0.45)'], [0.35, 'rgba(255,255,255,0)'], [0.5, 'rgba(255,255,255,0.45)'], [0.65, 'rgba(255,255,255,0)'], [0.8, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]); ctx.fillRect(0, 0, n, n);
    } else {                                                                   // paredes: claras arriba y oscuras abajo, con una franja de ventanas muy brillante
      ctx.fillStyle = degradado(0, 0, 0, n, [[0, '#cfd6db'], [0.5, '#8d98a0'], [1, '#2f373d']]); ctx.fillRect(0, 0, n, n);
      ctx.fillStyle = cara === 'pz' ? '#f3f7fa' : '#ffffff';
      for (const x of (cara === 'px' || cara === 'nx') ? [0.1, 0.38, 0.66] : [0.06, 0.52]) ctx.fillRect(n * x, n * 0.14, n * (cara === 'pz' ? 0.34 : 0.24), n * 0.24);
      ctx.fillStyle = 'rgba(40,48,54,0.55)'; for (let k = 1; k < 5; k++) ctx.fillRect(n * k / 5, 0, 2, n);          // juntas de paneles
    }
  }
  function crearEntorno(THREE, n = 128) {
    const lienzos = CARAS_ENTORNO.map(cara => {
      const c = document.createElement('canvas'); c.width = c.height = n; pintarCaraEntorno(c.getContext('2d'), cara, n); return c;
    });
    const cubo = new THREE.CubeTexture(lienzos);
    cubo.colorSpace = THREE.SRGBColorSpace; cubo.needsUpdate = true;
    return cubo;
  }

  /**
   * Ruido suave en un canvas (para suelo y pared: desgaste y manchas). Devuelve el canvas; `semilla` hace el resultado repetible y la textura enlosable
   * (los puntos se dibujan también desplazados un tamaño para que los bordes casen).
   */
  function lienzoRuido({ n = 256, base = '#808080', manchas = 90, contraste = 14, rayas = 0, semilla = 7 } = {}) {
    const c = document.createElement('canvas'); c.width = c.height = n;
    const g = c.getContext('2d');
    let s = semilla >>> 0;
    const azar = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    g.fillStyle = base; g.fillRect(0, 0, n, n);
    for (let i = 0; i < manchas; i++) {
      const x = azar() * n, y = azar() * n, r = 6 + azar() * n * 0.16, d = (azar() - 0.5) * 2 * contraste;
      g.fillStyle = d > 0 ? `rgba(255,255,255,${(d / 255).toFixed(3)})` : `rgba(0,0,0,${(-d / 255).toFixed(3)})`;
      for (const [dx, dy] of [[0, 0], [n, 0], [-n, 0], [0, n], [0, -n]]) { g.beginPath(); g.arc(x + dx, y + dy, r, 0, Math.PI * 2); g.fill(); }
    }
    g.lineWidth = 1;
    for (let i = 0; i < rayas; i++) {                                           // arañazos finos y cortos
      const x = azar() * n, y = azar() * n, l = 6 + azar() * 22, a = azar() * Math.PI;
      g.strokeStyle = `rgba(255,255,255,${(0.04 + azar() * 0.06).toFixed(3)})`; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    return c;
  }

  function crearKit(THREE) {
    const recursos = [];
    const registrar = r => { recursos.push(r); return r; };
    const materiales = new Map();
    const calidad = ESTILO.calidad, envMap = ESTILO.envMap;     // el estilo vigente al crear el kit: los materiales de este kit lo respetan siempre
    // Material de la calidad vigente: Lambert (baja) o Standard con metal/rugosidad y entorno (alta).
    const crearMaterial = (clave, opciones) => {
      const { clase, props } = especificacionMaterial(clave, opciones, calidad);
      if (clase === 'MeshStandardMaterial' && envMap && props.envMap === undefined) props.envMap = envMap;
      return registrar(new THREE[clase](props));
    };
    const mat = clave => {
      if (!materiales.has(clave)) materiales.set(clave, crearMaterial(clave, {}));
      return materiales.get(clave);
    };
    const matDinamico = (color, opciones = {}) => crearMaterial(color, opciones);
    const matLed = color => registrar(new THREE.MeshBasicMaterial(calidad === 'alta' ? { color, toneMapped: false } : { color }));    // los LED no se apagan con el tone mapping
    const tmp = new THREE.Object3D();

    // Geometrías de poca resolución: el presupuesto es ≤ 150 000 triángulos en toda la planta.
    const cil = (r, h, seg = 14) => new THREE.CylinderGeometry(r, r, h, seg);
    const cono = (r1, r2, h, seg = 14) => new THREE.CylinderGeometry(r2, r1, h, seg);
    const caja = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const esfera = (r, seg = 10) => new THREE.SphereGeometry(r, seg, Math.max(6, seg - 3));
    const toro = (radio, tubo, arco = Math.PI * 2, seg = 12) => new THREE.TorusGeometry(radio, tubo, 7, seg, arco);

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

    /** Conjunto de piezas estáticas de un equipo. add() acumula; construir() crea UNA malla por material con userData.id = tag. */
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
      construir(padre, id) {
        const mallas = [];
        for (const [clave, lista] of this.porMaterial) {
          const geometria = registrar(fusionar(lista));
          const m = new THREE.Mesh(geometria, typeof clave === 'object' ? clave : mat(clave));
          m.userData.id = id; m.userData.clave = typeof clave === 'object' ? 'dinamico' : clave; padre.add(m); mallas.push(m);
        }
        this.porMaterial.clear();
        return mallas;
      }
    }

    /** Malla suelta (para piezas que se animan o cambian de color): lleva el id del equipo para la selección. */
    function malla(geometria, material, padre, id, pos = [0, 0, 0], rot = [0, 0, 0]) {
      const m = new THREE.Mesh(registrar(geometria), material);
      m.position.set(pos[0], pos[1], pos[2]); m.rotation.set(rot[0], rot[1], rot[2]);
      if (id) m.userData.id = id;
      padre.add(m); return m;
    }

    return { THREE, PALETA, mat, matDinamico, matLed, cil, cono, caja, esfera, toro, malla, registrar,
      ensamble: () => new Ensamble(), liberar() { for (const r of recursos) if (r && r.dispose) r.dispose(); recursos.length = 0; materiales.clear(); } };
  }

  const api = { PALETA, VERDE_PRODUCTO, AZUL_AGUA, NARANJA_AGUA_CALIENTE, limitar, mezclarHex, colorLeche, colorProducto, colorAguaCaliente, colorTuboCaliente,
    nivelAguaCalientePct, temperaturaAguaCaliente, bancoEncendido, contactoLSL, valvulaAbierta, tanqueDesbordando, equipoDe, instrumentoDe, num, temperaturaDe, caudalLh,
    nivelTanquePct, aperturaFDV, velocidadAngularVisual, colorLedCalidad, crearKit,
    PBR, fijarEstilo, estiloActual, elegirCalidad, parametrosPBR, especificacionMaterial, pareceAcero, CARAS_ENTORNO, pintarCaraEntorno, crearEntorno, lienzoRuido };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstKit = api; }
})();
