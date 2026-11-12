// Vista interior de los equipos de la planta HTST (DISEÑADOR): al pulsar un equipo, su carcasa se vuelve semitransparente y se ve funcionando por dentro
// (líquido con su nivel real, rodete girando, vástago y muelle de la FDV, canales de las placas, resistencias del calentador...). Al pulsar otro o fuera, se cierra.
// Por defecto la planta se ve sólida y no cambia. El interior se construye de forma PEREZOSA (la primera vez que se abre) y está oculto el resto del tiempo,
// así no cuesta llamadas de dibujo. Las funciones puras (sin THREE) van aparte para probarlas con node:test.
(function () {
  const K = typeof require !== 'undefined' ? require('./kit.js') : PCT.htstKit;
  const P = typeof require !== 'undefined' ? require('./puertos.js') : PCT.htstPuertos;
  const EQ = typeof require !== 'undefined' ? require('./equipos_proceso.js') : PCT.htstEquiposProceso;
  const PI = Math.PI;

  const OPACIDAD_CARCASA = 0.28;
  /** Equipos con vista interior y qué piezas (por la clave de material con que se construyeron) pasan a ser semitransparentes al abrirlos. */
  const CARCASAS = {
    'TK-101': ['inox'], 'HW-101': ['gris'], 'P-101': ['inox'], 'P-102': ['inox'], 'P-103': ['inox'], 'HX-101': ['instanciada'],
    'FDV-101': ['inox'], 'SV-101': ['laton', 'negro'], 'FLT-101': ['inox'],
  };
  const TAGS_CON_INTERIOR = Object.keys(CARCASAS);
  const tieneInterior = tag => Object.prototype.hasOwnProperty.call(CARCASAS, tag);
  /** ¿Esta pieza (con userData.clave) es carcasa del equipo y debe verse semitransparente al abrirlo? */
  const esCarcasa = (tag, clave) => !!clave && tieneInterior(tag) && CARCASAS[tag].includes(clave);

  /* ---------- funciones puras ---------- */
  const limitar = K.limitar;
  /** Escala y centro (y) de una columna de líquido de `altura` cm que empieza en `yBase`, según el nivel en %. Nunca llega a cero (se oculta aparte). */
  function columnaLiquido(nivelPct, yBase, altura) {
    const n = limitar(K.num(nivelPct, 0), 0, 100) / 100, alto = Math.max(0.01, altura * n);
    return { alto, y: yBase + alto / 2, visible: n > 0.005 };
  }
  /** Radianes por segundo del rodete de una bomba: marcha, sin fallo y proporcional a la velocidad del variador (P-101) o 100 % si no la hay. */
  const velocidadRodeteRadS = eq => K.velocidadAngularVisual(!!(eq && eq.marcha) && !(eq && eq.fallo), eq && eq.velocidadPct);
  /** Posiciones (y, en cm del equipo) de las piezas móviles de la FDV según la apertura 0..1 (1 = avance): tapón, membrana y paso entre vueltas del muelle. */
  function posicionesFDV(apertura) {
    const a = limitar(K.num(apertura, 0), 0, 1);
    const tapon = 11 + 6 * a, membrana = 35 + 5 * a;
    return { tapon, membrana, vastagoLargo: membrana - tapon, vastagoY: (membrana + tapon) / 2, pasoMuelle: (43 - (membrana + 0.8)) / 6 };
  }
  /** Altura (y) del núcleo de la electroválvula piloto: sube al energizarla. */
  const alturaNucleoSV = energizada => 12.5 + 1.5 * (energizada ? 1 : 0);
  /** Canales del intercambiador: uno por cada hueco entre placas de un mismo paquete. `fluido` 0 = producto, 1 = el otro fluido (alternan). */
  function canalesHX() {
    const pos = EQ.posicionesPlacas(), canales = [];
    for (const paquete of ['regeneracion', 'calentamiento', 'enfriamiento']) {
      const xs = pos[paquete];
      for (let i = 0; i < xs.length - 1; i++) canales.push({ paquete, x: (xs[i] + xs[i + 1]) / 2, fluido: i % 2 });
    }
    return canales;
  }
  /** Velocidades de los puntos de flujo (cm/s) por fluido y paquete, a partir del estado; 0 = parado. El producto sube y el otro fluido baja (contracorriente). */
  function velocidadesHX(estado) {
    const caudal = K.caudalLh(estado), v = caudal > 0 ? 6 + 16 * limitar(caudal / 2000, 0, 1.5) : 0;
    const p102 = !!K.equipoDe(estado, 'P-102').marcha, p103 = !!K.equipoDe(estado, 'P-103').marcha, frio = K.valvulaAbierta(estado, 'XV-301');
    return {
      regeneracion: { 0: v, 1: caudal > 0 && p103 ? v * 0.9 : 0 },
      calentamiento: { 0: v, 1: p102 ? 14 : 0 },
      enfriamiento: { 0: v, 1: frio ? 10 : 0 },
    };
  }
  /** Colores de los canales del intercambiador según las temperaturas del proceso. */
  function coloresHX(estado) {
    const t = clave => K.temperaturaDe(estado, clave, 20);
    return {
      regeneracion: [K.colorProducto((t('entrada') + t('trasRegeneracion')) / 2), K.colorProducto(t('salidaTubo'))],
      calentamiento: [K.colorProducto(t('trasCalentamiento')), K.colorAguaCaliente(K.temperaturaAguaCaliente(estado))],
      enfriamiento: [K.colorProducto(t('salidaFinal')), K.AZUL_AGUA],
    };
  }
  /** Fase (0..1) de un punto que avanza `vel` cm/s sobre un recorrido de `largo` cm, desplazado por el reloj y el índice. */
  const faseFlujo = (i, n, reloj, vel, largo) => ((i / n + (reloj * vel) / largo) % 1 + 1) % 1;

  /* ---------- construcción 3D ---------- */
  function crear(THREE, elementos) {
    const kit = K.crearKit(THREE);
    const interiores = {};        // tag → { grupo, actualizar(estado, dt) }
    const guardadas = [];         // [malla, material original, renderOrder] mientras hay un equipo abierto
    const clones = [];
    let abierto = null, reloj = 0;

    const ninguno = () => {};
    const basico = (color, opciones = {}) => kit.registrar(new THREE.MeshBasicMaterial(Object.assign({ color }, opciones)));
    const translucido = (color, opacidad) => kit.matDinamico(color, { transparent: true, opacity: opacidad, depthWrite: false });
    function pieza(grupo, geometria, material, pos = [0, 0, 0], rot = [0, 0, 0], orden = 0) {
      const m = kit.malla(geometria, material, grupo, null, pos, rot); m.raycast = ninguno; m.renderOrder = orden; return m;
    }
    const abierta = (r, h, seg) => kit.registrar(new THREE.CylinderGeometry(r, r, h, seg, 1, true));
    const flechas = (grupo, cuantas, color) => {                          // chevrones (conos) que avanzan por un recorrido recto
      const lista = [];
      for (let i = 0; i < cuantas; i++) lista.push(pieza(grupo, kit.cono(1.5, 0.1, 2.6, 8), basico(color), [0, 0, 0], [0, 0, 0], 4));
      return lista;
    };
    const colocarFlechas = (lista, a, b, fase, visible) => {              // a → b en coordenadas locales; la punta del cono apunta de a hacia b
      const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), largo = dir.length(); dir.normalize();
      for (let i = 0; i < lista.length; i++) {
        const f = ((i / lista.length + fase) % 1 + 1) % 1, m = lista[i];
        m.visible = visible; if (!visible) continue;
        m.position.set(a[0] + dir.x * largo * f, a[1] + dir.y * largo * f, a[2] + dir.z * largo * f);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      }
    };

    /* TK-101: líquido con su nivel y el agitador */
    function tanque(g) {
      const grupo = new THREE.Group(); g.add(grupo);
      const mat = translucido(K.VERDE_PRODUCTO, 0.8);
      const cuerpo = pieza(grupo, kit.cil(31.8, 1, 28), mat, [0, 50, 0], [0, 0, 0], 1);
      const fondo = pieza(grupo, kit.cono(10, 31.8, 6, 24), mat, [0, 19, 0], [0, 0, 0], 1);
      const agit = new THREE.Group(); grupo.add(agit);
      pieza(agit, kit.cil(0.8, 62, 8), kit.mat('inoxMate'), [0, 58, 0]);
      for (const y of [32, 52]) pieza(agit, kit.caja(22, 1, 4), kit.mat('inox'), [0, y, 0]);
      let ultimo = -1;
      return { grupo, actualizar(estado, dt) {
        const c = columnaLiquido(K.nivelTanquePct(estado), 22, 56);
        cuerpo.visible = c.visible; fondo.visible = K.nivelTanquePct(estado) > 0.5;
        cuerpo.scale.y = c.alto; cuerpo.position.y = c.y;
        const hex = K.colorProducto(K.num(estado && estado.tanque && estado.tanque.temperaturaC, 4));
        if (hex !== ultimo) { mat.color.setHex(hex); ultimo = hex; }
        if (c.visible) agit.rotation.y += (dt || 0) * 1.2;                  // el agitador gira despacio mientras hay leche
      } };
    }

    /* HW-101: agua con su nivel, las dos resistencias y el flotador de nivel bajo */
    function calentador(g) {
      const grupo = new THREE.Group(); g.add(grupo);
      const mat = translucido(0x3a8fd0, 0.72);
      const agua = pieza(grupo, kit.cil(16.2, 1, 24), mat, [0, 38, 0], [0, 0, 0], 1);
      const m1 = basico(0x6a6f75), m2 = basico(0x6a6f75);
      for (const x of [-9, -6.5, -4]) pieza(grupo, kit.cil(0.8, 38, 8), m1, [x, 33, 0]);
      for (const x of [4, 6.5, 9]) pieza(grupo, kit.cil(0.8, 38, 8), m2, [x, 33, 0]);
      pieza(grupo, kit.cil(0.6, 6, 6), m1, [-6.5, 52.4, 0], [0, 0, PI / 2]); pieza(grupo, kit.cil(0.6, 6, 6), m2, [6.5, 52.4, 0], [0, 0, PI / 2]);
      const Y_LSL = 11.8 + 52.4 * 0.15;                                      // 15 % de nivel: donde actúa LSL-301
      pieza(grupo, kit.toro(16.3, 0.3, PI * 2, 30), basico(0xff3b30), [0, Y_LSL, 0], [PI / 2, 0, 0]);
      pieza(grupo, kit.cil(0.4, 10, 6), kit.mat('inoxMate'), [12, Y_LSL + 3, 0]);
      const matFlot = basico(0x35e06b);
      const flotador = pieza(grupo, kit.esfera(1.7, 8), matFlot, [12, Y_LSL + 8, 0]);
      let u1 = -1, u2 = -1, u3 = -1, u4 = -1;
      return { grupo, actualizar(estado) {
        const c = columnaLiquido(K.nivelAguaCalientePct(estado), 11, 54.5);
        agua.visible = c.visible; agua.scale.y = c.alto; agua.position.y = c.y;
        const t = K.colorAguaCaliente(K.temperaturaAguaCaliente(estado)); if (t !== u1) { mat.color.setHex(t); u1 = t; }
        const b1 = K.bancoEncendido(estado, 1) ? 0xff7a1a : 0x6a6f75, b2 = K.bancoEncendido(estado, 2) ? 0xff7a1a : 0x6a6f75;
        if (b1 !== u2) { m1.color.setHex(b1); u2 = b1; } if (b2 !== u3) { m2.color.setHex(b2); u3 = b2; }
        const bajo = K.contactoLSL(estado) === 'abierto', hex = bajo ? 0xff3b30 : 0x35e06b;
        if (hex !== u4) { matFlot.color.setHex(hex); u4 = hex; }
        flotador.position.y = Math.max(Y_LSL - 1.5, Math.min(Y_LSL + 8, c.y + c.alto / 2 - 1.5)); // el flotador sigue al agua entre sus topes
      } };
    }

    /* P-101, P-102 y P-103: rodete con álabes que gira, fluido y flechas de flujo (aspiración axial, descarga tangencial) */
    function bomba(tag) {
      return g => {
        const grupo = new THREE.Group(); g.add(grupo);
        const agua = tag === 'P-102';
        const mat = translucido(agua ? K.colorAguaCaliente(70) : K.VERDE_PRODUCTO, 0.55);
        pieza(grupo, kit.cil(8.4, 7.2, 22), mat, [-10, 13, 0], [PI / 2, 0, 0], 1);
        const imp = new THREE.Group(); imp.position.set(-10, 13, 0); grupo.add(imp);
        pieza(imp, kit.cil(6.2, 0.8, 22), kit.mat('inox'), [0, 0, -2.4], [PI / 2, 0, 0]);
        pieza(imp, kit.cil(1.6, 6, 10), kit.mat('inoxMate'), [0, 0, 0], [PI / 2, 0, 0]);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * PI * 2;
          pieza(imp, kit.caja(5.2, 0.55, 4.4), kit.mat('inoxMate'), [Math.cos(a) * 3.8, Math.sin(a) * 3.8, 0.4], [0, 0, a + 0.5]);   // álabes inclinados (curvos)
        }
        pieza(grupo, kit.cil(1.1, 14, 8), kit.mat('inoxMate'), [-3, 13, 0], [0, 0, PI / 2]);
        const ent = P.puerto(tag, 'ent'), sal = P.puerto(tag, 'sal'), p = g.position;
        const e = [ent[0] - p.x, ent[1], ent[2] - p.z], s = [sal[0] - p.x, sal[1], sal[2] - p.z];
        const fIn = flechas(grupo, 3, 0x7dff9c), fOut = flechas(grupo, 3, 0xffd166);
        let fase = 0, ultimo = -1;
        return { grupo, actualizar(estado, dt) {
          const eq = K.equipoDe(estado, tag), w = velocidadRodeteRadS(eq), marcha = w > 0;
          imp.rotation.z -= w * (dt || 0);
          fase = (fase + (dt || 0) * (0.3 + w / (PI * 3))) % 1;
          colocarFlechas(fIn, [e[0], e[1], e[2] + 11], [e[0], e[1], 3], fase, marcha);
          colocarFlechas(fOut, [s[0], 17, s[2]], [s[0], s[1] - 1, s[2]], fase, marcha);
          const hex = agua ? K.colorAguaCaliente(K.temperaturaAguaCaliente(estado)) : K.colorProducto(K.temperaturaDe(estado, 'entrada', 4));
          if (hex !== ultimo) { mat.color.setHex(hex); ultimo = hex; }
          mat.opacity = marcha ? 0.55 : 0.3;
        } };
      };
    }

    /* HX-101: canales de las placas con el flujo a contracorriente */
    function intercambiador(g) {
      const grupo = new THREE.Group(); g.add(grupo);
      const canales = canalesHX(), n = canales.length;
      const matCanal = basico(0xffffff, { transparent: true, opacity: 0.55, depthWrite: false });
      const losas = new THREE.InstancedMesh(kit.registrar(kit.caja(0.8, 58, 46)), matCanal, n); losas.frustumCulled = false; losas.renderOrder = 1; losas.raycast = ninguno;
      const m = new THREE.Matrix4(), c = new THREE.Color();
      canales.forEach((k, i) => { m.setPosition(k.x, 41, 0); losas.setMatrixAt(i, m); losas.setColorAt(i, c.setHex(0x888888)); });
      grupo.add(losas);
      const PUNTOS = 3, matPunto = basico(0xffffff);
      const puntos = new THREE.InstancedMesh(kit.registrar(kit.caja(0.6, 2.4, 2.4)), matPunto, n * PUNTOS); puntos.frustumCulled = false; puntos.renderOrder = 2; puntos.raycast = ninguno;
      grupo.add(puntos);
      let firma = '', reloj2 = 0;
      const Y0 = 12, LARGO = 58;
      return { grupo, actualizar(estado, dt) {
        reloj2 += dt || 0;
        const col = coloresHX(estado), vel = velocidadesHX(estado), nueva = JSON.stringify(col);
        if (nueva !== firma) {
          firma = nueva;
          canales.forEach((k, i) => losas.setColorAt(i, c.setHex(col[k.paquete][k.fluido])));
          losas.instanceColor.needsUpdate = true;
        }
        canales.forEach((k, i) => {
          const v = vel[k.paquete][k.fluido], sube = k.fluido === 0;
          for (let j = 0; j < PUNTOS; j++) {
            const idx = i * PUNTOS + j;
            if (v <= 0) { m.makeScale(0, 0, 0); puntos.setMatrixAt(idx, m); continue; }
            const f = faseFlujo(j, PUNTOS, reloj2, v, LARGO), y = sube ? Y0 + f * LARGO : Y0 + (1 - f) * LARGO;
            m.makeTranslation(k.x, y, 0); puntos.setMatrixAt(idx, m);
          }
        });
        puntos.instanceMatrix.needsUpdate = true;
      } };
    }

    /* FDV-101: asiento, tapón y vástago que se mueven, membrana y muelle del actuador neumático, aire y flujo */
    function fdv(g) {
      const grupo = new THREE.Group(); g.add(grupo);
      for (const y of [10, 18]) pieza(grupo, kit.toro(2.2, 0.4, PI * 2, 12), kit.mat('laton'), [0, y, 0], [PI / 2, 0, 0]);
      const tapon = pieza(grupo, kit.cono(1.2, 2.4, 2.2, 12), kit.mat('laton'), [0, 11, 0]);
      const vastago = pieza(grupo, kit.cil(0.7, 1, 8), kit.mat('inox'), [0, 28, 0]);
      const membrana = pieza(grupo, kit.cil(6.8, 0.6, 20), kit.mat('rojo'), [0, 35, 0]);
      const aire = pieza(grupo, kit.cil(6.5, 1, 18), translucido(0x7fd0ff, 0.4), [0, 34, 0], [0, 0, 0], 1);
      const muelle = []; for (let i = 0; i < 6; i++) muelle.push(pieza(grupo, kit.toro(3, 0.35, PI * 2, 10), kit.mat('inoxMate'), [0, 40, 0], [PI / 2, 0, 0]));
      const fCom = flechas(grupo, 2, 0x7dff9c), fAv = flechas(grupo, 2, 0x7dff9c), fDe = flechas(grupo, 2, 0xffb020);
      let fase = 0;
      return { grupo, actualizar(estado, dt) {
        const a = K.aperturaFDV(estado), p = posicionesFDV(a);
        tapon.position.y = p.tapon; vastago.scale.y = p.vastagoLargo; vastago.position.y = p.vastagoY; membrana.position.y = p.membrana;
        muelle.forEach((r, i) => { r.position.y = p.membrana + 0.8 + p.pasoMuelle * (i + 0.5); });
        aire.visible = a > 0.05; aire.scale.y = Math.max(0.01, p.membrana - 33); aire.position.y = 33 + Math.max(0.01, p.membrana - 33) / 2;
        fase = (fase + (dt || 0) * 0.8) % 1;
        const hay = K.caudalLh(estado) > 0;
        colocarFlechas(fCom, [0, 14, -9], [0, 14, -2], fase, hay);
        colocarFlechas(fAv, [1, 14, 0], [9, 14, 0], fase, hay && a >= 0.5);
        colocarFlechas(fDe, [-1, 14, 0], [-9, 14, 0], fase, hay && a < 0.5);
      } };
    }

    /* SV-101: bobina de cobre y núcleo que sube al energizarla */
    function piloto(g) {
      const grupo = new THREE.Group(); g.add(grupo);
      const matBobina = basico(0xb87333);
      pieza(grupo, kit.cil(2.25, 5.8, 14), matBobina, [0, 14.5, 0]);
      const nucleo = pieza(grupo, kit.cil(0.7, 8, 8), kit.mat('inox'), [0, 12.5, 0]);
      pieza(grupo, kit.toro(0.9, 0.25, PI * 2, 10), kit.mat('laton'), [0, 8, 0], [PI / 2, 0, 0]);
      const aire = flechas(grupo, 2, 0x7fd0ff);
      let fase = 0, ultimo = -1;
      return { grupo, actualizar(estado, dt) {
        const on = !!K.equipoDe(estado, 'SV-101').energizada;
        nucleo.position.y = alturaNucleoSV(on);
        const hex = on ? 0xff9a3c : 0xb87333; if (hex !== ultimo) { matBobina.color.setHex(hex); ultimo = hex; }
        fase = (fase + (dt || 0) * 0.9) % 1;
        colocarFlechas(aire, [-1.5, 4, 0], [4.8, 4, 0], fase, on);
      } };
    }

    /* FLT-101: cesta del colador con la suciedad retenida */
    function filtro(g) {
      const grupo = new THREE.Group(); g.add(grupo);
      const cesta = pieza(grupo, abierta(3.8, 8, 14), kit.matDinamico(0x7d848b, { transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }), [0, 17, 0], [0, 0, 0], 1);
      for (const y of [14, 17, 20]) pieza(grupo, kit.toro(3.8, 0.25, PI * 2, 14), kit.mat('inoxMate'), [0, y, 0], [PI / 2, 0, 0]);
      const matSucio = kit.matDinamico(0x6b4a2f);
      const sucio = pieza(grupo, kit.cil(3.5, 1, 12), matSucio, [0, 13.1, 0]);
      const fl = flechas(grupo, 3, 0x7dff9c);
      let fase = 0;
      return { grupo, actualizar(estado, dt) {
        const o = limitar(K.num(K.equipoDe(estado, 'FLT-101').obstruccion01, 0), 0, 1), h = Math.max(0.01, o * 6);
        sucio.scale.y = h; sucio.position.y = 13 + h / 2; sucio.visible = o > 0.02;
        fase = (fase + (dt || 0) * 0.6) % 1;
        colocarFlechas(fl, [0, 12, -10], [0, 12, 10], fase, K.caudalLh(estado) > 0);
      } };
    }

    const DEFINICIONES = { 'TK-101': tanque, 'HW-101': calentador, 'P-101': bomba('P-101'), 'P-102': bomba('P-102'), 'P-103': bomba('P-103'), 'HX-101': intercambiador,
      'FDV-101': fdv, 'SV-101': piloto, 'FLT-101': filtro };

    function aplicarTransparencia(tag, g) {
      g.traverse(o => {
        if (!(o.isMesh || o.isInstancedMesh) || !o.userData || !esCarcasa(tag, o.userData.clave) || !o.material || o.material.isMeshBasicMaterial) return;
        guardadas.push([o, o.material, o.renderOrder]);
        const c = o.material.clone(); c.transparent = true; c.opacity = OPACIDAD_CARCASA; c.depthWrite = false;
        o.material = c; o.renderOrder = 3; clones.push(c);
      });
    }
    function restaurar() {
      for (const [o, mat, orden] of guardadas) { o.material = mat; o.renderOrder = orden; }
      guardadas.length = 0;
      for (const c of clones) c.dispose();
      clones.length = 0;
    }

    /** Abre el equipo `tag` (si tiene interior) y cierra el que hubiera abierto. Con un tag sin interior, o vacío, solo cierra. */
    function abrir(tag) {
      if (tag === abierto) return;
      cerrar();
      if (!tag || !tieneInterior(tag) || !elementos[tag]) return;
      const g = elementos[tag].grupo;
      if (!interiores[tag]) interiores[tag] = DEFINICIONES[tag](g);
      interiores[tag].grupo.visible = true;
      aplicarTransparencia(tag, g);
      abierto = tag;
    }
    function cerrar() {
      if (!abierto) return;
      restaurar();
      if (interiores[abierto]) interiores[abierto].grupo.visible = false;
      abierto = null;
    }
    function actualizar(estado, dt) {
      if (!abierto || !estado) return;
      reloj += dt || 0;
      interiores[abierto].actualizar(estado, dt);
    }
    return { abrir, cerrar, actualizar, abierto: () => abierto, liberar() { cerrar(); kit.liberar(); } };
  }

  const api = { crear, TAGS_CON_INTERIOR, CARCASAS, OPACIDAD_CARCASA, tieneInterior, esCarcasa, columnaLiquido, velocidadRodeteRadS, posicionesFDV, alturaNucleoSV,
    canalesHX, velocidadesHX, coloresHX, faseFlujo };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstInteriores = api; }
})();
