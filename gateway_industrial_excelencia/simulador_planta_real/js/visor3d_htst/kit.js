// Kit de construcción 3D de la planta HTST (DISEÑADOR). Materiales LIGEROS (MeshLambert, sin sombras) y ensambles que FUSIONAN las geometrías
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
  const colorTuboCaliente = tC => mezclarHex(0xc3cbd3, 0xf2b690, (tC - 20) / 60);

  // Lectura tolerante del estado v1 (ARQUITECTURA.md §4): si falta un campo se usa un valor por defecto y nunca se lanza una excepción.
  const VACIO = Object.freeze({});
  const equipoDe = (estado, tag) => (estado && estado.equipos && estado.equipos[tag]) || VACIO;
  const instrumentoDe = (estado, tag) => (estado && estado.instrumentos && estado.instrumentos[tag]) || VACIO;
  const num = (v, defecto) => (typeof v === 'number' && Number.isFinite(v) ? v : defecto);
  const temperaturaDe = (estado, clave, defecto = 20) => num(estado && estado.proceso && estado.proceso.temperaturas && estado.proceso.temperaturas[clave], defecto);
  const caudalLh = estado => num(estado && estado.proceso && estado.proceso.caudalLh, 0);
  const nivelTanquePct = estado => limitar(num(estado && estado.tanque && estado.tanque.nivelPct, 60), 0, 100);

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

  function crearKit(THREE) {
    const recursos = [];
    const registrar = r => { recursos.push(r); return r; };
    const materiales = new Map();
    const mat = clave => {
      if (!materiales.has(clave)) materiales.set(clave, registrar(new THREE.MeshLambertMaterial({ color: PALETA[clave] !== undefined ? PALETA[clave] : clave })));
      return materiales.get(clave);
    };
    const matDinamico = (color, opciones = {}) => registrar(new THREE.MeshLambertMaterial(Object.assign({ color }, opciones)));
    const matLed = color => registrar(new THREE.MeshBasicMaterial({ color }));
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
          m.userData.id = id; padre.add(m); mallas.push(m);
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

  const api = { PALETA, limitar, mezclarHex, colorLeche, colorAguaCaliente, colorTuboCaliente, equipoDe, instrumentoDe, num, temperaturaDe, caudalLh,
    nivelTanquePct, aperturaFDV, velocidadAngularVisual, colorLedCalidad, crearKit };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstKit = api; }
})();
