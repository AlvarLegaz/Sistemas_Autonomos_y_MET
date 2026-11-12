// Equipos de proceso de la planta HTST en 3D (DISEÑADOR): tanque de balance, filtro, bombas centrífugas sanitarias, intercambiador de placas, tubo de residencia,
// FDV neumática con su piloto, unidad de aire, calentador de agua y válvulas todo/nada. Acero inoxidable satinado con soldaduras visibles, uniones tri-clamp con su
// junta, patas regulables, tornillería y placas grabadas. Materiales ligeros (Lambert) y piezas fusionadas por material: cada equipo cuesta pocas llamadas de dibujo.
// Contrato de layout.js: crear(THREE, estadoInicial) → { grupo, elementos, actualizar(estado, lecturas), liberar() }. Ids = tags ISA. Unidades: cm.
(function () {
  const K = typeof require !== 'undefined' ? require('./kit.js') : PCT.htstKit;
  const B = typeof require !== 'undefined' ? require('./base_equipo.js') : PCT.htstBase;
  const P = typeof require !== 'undefined' ? require('./puertos.js') : PCT.htstPuertos;
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.htstLayout;
  const PI = Math.PI;
  const TAGS = ['TK-101', 'FLT-101', 'P-101', 'P-201', 'HX-101', 'HT-101', 'FDV-101', 'SV-101', 'FRL-501', 'HW-201', 'XV-301', 'XV-401', 'XV-101', 'XV-102', 'XV-201', 'XV-202'];

  // Distribución de las placas del intercambiador: tres paquetes (regeneración, calentamiento, enfriamiento) separados por placas de conexión intermedias.
  const PLACAS = { regeneracion: 22, calentamiento: 16, enfriamiento: 14, paso: 1.5, inicio: -45, separador: 3 };
  /** Posición x (local) de cada placa de cada paquete. Función pura: la prueban los tests. */
  function posicionesPlacas() {
    const salida = { regeneracion: [], calentamiento: [], enfriamiento: [], separadores: [], x1: 0 };
    let x = PLACAS.inicio;
    for (const paquete of ['regeneracion', 'calentamiento', 'enfriamiento']) {
      for (let i = 0; i < PLACAS[paquete]; i++) { salida[paquete].push(x + PLACAS.paso / 2); x += PLACAS.paso; }
      if (paquete !== 'enfriamiento') { salida.separadores.push(x + PLACAS.separador / 2 - 0.2); x += PLACAS.separador; }
    }
    salida.x1 = x;
    return salida;
  }

  /** Texto de las placas de características grabadas de cada equipo: [tag, nombre]. Función pura (la prueban los tests). */
  const PLACAS_NOMBRE = {
    'P-101': 'BOMBA DE LECHE', 'P-201': 'BOMBA AGUA CALIENTE', 'FDV-101': 'VALVULA DE DESVIO', 'HT-101': 'TUBO DE RESIDENCIA', 'FLT-101': 'FILTRO',
    'XV-101': 'LLENADO LECHE', 'XV-102': 'VACIADO LECHE', 'XV-201': 'LLENADO AGUA', 'XV-202': 'VACIADO AGUA', 'XV-301': 'AGUA FRIA', 'XV-401': 'LIMPIEZA CIP',
  };
  const nombrePlaca = tag => PLACAS_NOMBRE[tag] || '';
  /** Centro de la voluta de las bombas (cm, locales a la bomba): el eje del rodete va a lo largo de z. */
  const BOMBA = { x: -10, y: 13, z: -3 };

  function crear(THREE, estadoInicial) {
    const kit = K.crearKit(THREE);
    const base = B.crearBase(kit);
    const local = (tag, nombre, g) => { const p = P.puerto(tag, nombre); return [p[0] - g.position.x, p[1], p[2] - g.position.z]; };

    /* ---------- piezas comunes: soldaduras, uniones tri-clamp, tornillería, flechas de flujo y placas grabadas ---------- */
    const IDX = { x: 0, y: 1, z: 2 };
    const rotC = eje => (eje === 'x' ? [0, 0, PI / 2] : eje === 'z' ? [PI / 2, 0, 0] : [0, 0, 0]);       // cilindro con su eje a lo largo de `eje`
    const cilE = (e, r, largo, eje, pos, clave, seg = 14) => e.add(kit.cil(r, largo, seg), clave, pos, rotC(eje));
    const desplazar = (pos, eje, d) => { const p = pos.slice(); p[IDX[eje]] += d; return p; };
    /** Cordón de soldadura: una banda mate algo más gruesa que el tubo, alrededor de un tubo de radio `r`. */
    const soldadura = (e, r, eje, pos, seg = 18) => cilE(e, r + 0.3, 0.7, eje, pos, 'inoxMate', seg);
    /** Tornillo hexagonal (o tuerca) con su arandela, de eje `eje`. */
    const tornillo = (e, pos, eje, r = 0.6, largo = 0.9) => cilE(e, r, largo, eje, pos, 'inoxMate', 6);
    /** Unión tri-clamp: dos férulas, la junta de goma entre ellas, la abrazadera y la tuerca de mariposa. `r` = radio del tubo. */
    function tricamp(e, pos, eje, r = 1.9) {
      cilE(e, r * 1.4, 0.45, eje, desplazar(pos, eje, -0.55), 'inox', 12);
      cilE(e, r * 1.4, 0.45, eje, desplazar(pos, eje, 0.55), 'inox', 12);
      cilE(e, r * 1.33, 0.66, eje, pos, 'junta', 12);
      cilE(e, r * 1.55, 1.25, eje, pos, 'inoxMate', 12);
      const lado = eje === 'y' ? 0 : 1, p = pos.slice(); p[lado] += r * 1.55 + 0.55;
      e.add(kit.caja(1.1, 1.1, 1.1), 'inoxMate', p);
    }
    /** Flecha de sentido de flujo (prisma triangular amarillo) sobre un tubo: `signo` = +1 hacia +eje, -1 hacia -eje. */
    function flecha(e, pos, eje, signo) {
      const rot = eje === 'z' ? [signo * PI / 2, 0, 0] : eje === 'x' ? [0, 0, -signo * PI / 2] : [signo > 0 ? 0 : PI, 0, 0];
      e.add(kit.cono(1.0, 0.05, 2.8, 3), 'amarillo', pos, rot);
    }
    /** Pieza de eje z colocada «radialmente» en una pared cilíndrica: a `rad` del eje vertical del tanque, girada `ang` alrededor de y, a la altura `y`. */
    function radial(e, geo, clave, ang, rad, y, ox = 0, oy = 0) {
      geo.translate(ox, oy, rad); geo.rotateY(ang); geo.translate(0, y, 0); e.add(geo, clave);
    }
    const cilZ = (r, largo, seg = 12) => { const c = kit.cil(r, largo, seg); c.rotateX(PI / 2); return c; };
    /** Placa de características grabada (acero con el tag y el nombre). Solo en el navegador: sin documento (pruebas en node) no hace nada. */
    function placaGrabada(grupo, tag, ancho, alto, pos, giroY = 0, nombre = nombrePlaca(tag)) {
      if (typeof document === 'undefined') return null;
      const lz = document.createElement('canvas'); lz.width = 192; lz.height = Math.max(24, Math.round(192 * alto / ancho));
      const c = lz.getContext('2d'); if (!c) return null;
      c.fillStyle = '#d4d9dd'; c.fillRect(0, 0, lz.width, lz.height); c.strokeStyle = '#59626a'; c.lineWidth = 4; c.strokeRect(2, 2, lz.width - 4, lz.height - 4);
      c.fillStyle = '#15191c'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = `700 ${Math.round(lz.height * (nombre ? 0.44 : 0.6))}px system-ui, sans-serif`; c.fillText(tag, lz.width / 2, lz.height * (nombre ? 0.32 : 0.52));
      if (nombre) { c.font = `600 ${Math.round(lz.height * 0.22)}px system-ui, sans-serif`; c.fillText(nombre, lz.width / 2, lz.height * 0.74); }
      const tx = kit.registrar(new THREE.CanvasTexture(lz)); if (THREE.SRGBColorSpace) tx.colorSpace = THREE.SRGBColorSpace;
      const m = kit.malla(new THREE.PlaneGeometry(ancho, alto), kit.registrar(new THREE.MeshLambertMaterial({ map: tx })), grupo, tag, pos, [0, giroY, 0]);
      return m;
    }

    /* ---------- TK-101 tanque de balance ---------- */
    (function () {
      const g = base.nuevoGrupo('TK-101', [8, 0]), e = kit.ensamble();          // 8 cm a la derecha del layout: patas y virola caben en la bancada
      const R = 33;
      // estructura: cuatro patas con pie regulable (varilla roscada, tuerca y plato), refuerzos horizontales y chapas de unión al faldón
      for (const [sx, sz] of [[-24, -24], [24, -24], [-24, 24], [24, 24]]) {
        e.add(kit.cil(2, 17.5, 10), 'inoxMate', [sx, 12.75, sz]);
        e.add(kit.caja(6, 1.2, 6), 'inoxMate', [sx, 21.6, sz]);
        e.add(kit.cil(0.9, 3.2, 8), 'inoxMate', [sx, 2.3, sz]); e.add(kit.cil(1.5, 1.1, 6), 'inoxMate', [sx, 3.6, sz]); e.add(kit.cil(3.4, 0.6, 12), 'inoxMate', [sx, 0.3, sz]);
      }
      for (const s of [-24, 24]) { cilE(e, 0.7, 48, 'x', [0, 9, s], 'inoxMate', 8); cilE(e, 0.7, 48, 'z', [s, 9, 0], 'inoxMate', 8); }
      // virola, fondo cónico y techo cónico con sus cordones de soldadura (circulares y dos costuras verticales)
      e.add(kit.cil(R, 56, 32), 'inox', [0, 50, 0]);
      e.add(kit.cono(10, R, 6, 32), 'inox', [0, 19, 0]);
      e.add(kit.cono(R, 8, 10, 32), 'inox', [0, 83, 0]);
      for (const y of [22, 50, 78]) e.add(kit.cil(R + 0.3, 0.7, 32), 'inoxMate', [0, y, 0]);
      e.add(kit.cil(10.3, 0.7, 20), 'inoxMate', [0, 16, 0]);
      for (const a of [2.2, -0.7]) e.add(kit.cil(0.35, 56, 6), 'inoxMate', [(R + 0.1) * Math.cos(a), 50, (R + 0.1) * Math.sin(a)]);
      // salida de fondo: tubuladura, tri-clamp y tapón
      e.add(kit.cil(2, 6, 10), 'inox', [0, 13, 0]); tricamp(e, [0, 10.4, 0], 'y'); e.add(kit.cil(2.6, 1.2, 12), 'inoxMate', [0, 9.2, 0]);
      // boca de hombre del techo con su tapa atornillada y el motorreductor del agitador (con aletas, caja de bornas y cubierta del ventilador)
      e.add(kit.cil(8, 1.4, 20), 'inox', [0, 88.7, 0]);
      e.add(kit.cil(9, 1.4, 24), 'inoxMate', [0, 90, 0]);
      for (let i = 0; i < 10; i++) { const a = (i / 10) * PI * 2; tornillo(e, [7.6 * Math.cos(a), 91, 7.6 * Math.sin(a)], 'y', 0.6, 0.9); }
      e.add(kit.cil(3.4, 2.4, 14), 'inox', [0, 91.9, 0]);                                      // linterna del soporte
      e.add(kit.cil(4.6, 3.6, 16), 'azul', [0, 94.9, 0]);                                      // reductor
      e.add(kit.cil(4.0, 8, 16), 'azul', [0, 100.7, 0]);                                       // motor
      for (const y of [98.6, 100.2, 101.8, 103.4]) e.add(kit.cil(4.35, 0.5, 16), 'azul', [0, y, 0]);                  // aletas de refrigeración
      e.add(kit.cil(3.2, 1.2, 14), 'oscuro', [0, 105.3, 0]);                                   // cubierta del ventilador
      e.add(kit.caja(3.6, 3, 3.6), 'negro', [5.4, 101.5, 0]);                                  // caja de bornas
      e.add(kit.cil(0.4, 1.6, 6), 'oscuro', [7.9, 101.5, 0], [0, 0, PI / 2]);
      // mirilla, respiradero con filtro y asa de izado en el techo
      e.add(kit.cil(3, 2.2, 14), 'inox', [18, 84.4, -4]); e.add(kit.cil(2.4, 0.4, 14), 'vidrio', [18, 85.7, -4]);
      e.add(kit.cil(1.3, 4, 10), 'inox', [-18, 85.6, 6]); e.add(kit.cil(1.9, 1.1, 12), 'inoxMate', [-18, 88, 6]);
      // tubuladuras de los puertos de tubería: salida de producto (pared), retorno del desvío (techo), llenado (pared trasera) y vaciado (pared delantera)
      const s = local('TK-101', 'sal', g), r = local('TK-101', 'ret', g), ll = local('TK-101', 'llen', g), va = local('TK-101', 'vac', g);
      e.add(kit.cil(3, 1.2, 12), 'inox', [s[0] + 0.4, s[1], s[2]], [0, 0, PI / 2]); tricamp(e, [s[0] + 2.2, s[1], s[2]], 'x'); soldadura(e, 2.6, 'x', [s[0] + 0.9, s[1], s[2]], 12);
      e.add(kit.cil(1.9, 2.6, 10), 'inox', [r[0], r[1] - 1.7, r[2]]); soldadura(e, 1.9, 'y', [r[0], r[1] - 2.9, r[2]], 12); tricamp(e, [r[0], r[1] - 0.7, r[2]], 'y');
      e.add(kit.cil(3, 1.2, 12), 'inox', [ll[0], ll[1], ll[2] + 0.6], [PI / 2, 0, 0]); tricamp(e, [ll[0], ll[1], ll[2] - 1.6], 'z');
      e.add(kit.cil(3, 1.2, 12), 'inox', [va[0], va[1], va[2] - 0.6], [PI / 2, 0, 0]); tricamp(e, [va[0], va[1], va[2] + 1.6], 'z');
      e.add(kit.cil(1.9, 5, 10), 'inox', [va[0], va[1], va[2] - 2.5], [PI / 2, 0, 0]);                                    // tramo corto desde la pared (la boca queda 1,7 cm delante de ella)
      // tubo de nivel (visor) con sus dos tomas, la válvula de bola inferior, los soportes y la escala graduada
      cilE(e, 0.7, 4, 'x', [-35, 24, 0], 'inoxMate', 8); cilE(e, 0.7, 4, 'x', [-35, 76, 0], 'inoxMate', 8);
      e.add(kit.esfera(1.5, 8), 'inoxMate', [-34.4, 24, 0]); e.add(kit.cil(0.35, 3.4, 6), 'rojo', [-34.4, 24, 2.4], [PI / 2, 0, 0]); e.add(kit.esfera(0.7, 6), 'rojo', [-34.4, 24, 4.1]);
      for (const y of [22.6, 77.4]) { e.add(kit.cil(2.1, 1.4, 12), 'inoxMate', [-37, y, 0]); }
      for (const y of [36, 64]) e.add(kit.caja(4.2, 0.7, 0.7), 'inoxMate', [-35, y, 2.2]);
      for (let i = 0; i <= 10; i++) e.add(kit.caja(0.25, 0.22, i % 5 === 0 ? 2.8 : 1.5), 'oscuro', [-39.2, 24 + 5.2 * i, 0]);
      // rebosadero: boquilla en la parte alta del frente del tanque (con su abrazadera) y tramo vertical; el chorro y el charco aparecen solo si desborda
      e.add(kit.cil(1.3, 7, 8), 'inox', [-14, 74.5, 31.2], [PI / 2, 0, 0]); e.add(kit.cil(1.3, 6, 8), 'inox', [-14, 72, 34.5]);
      tricamp(e, [-14, 73.8, 31.4], 'z', 1.3);
      e.construir(g, 'TK-101');
      const matVisor = kit.matDinamico(K.VERDE_PRODUCTO);                      // el producto es verde
      const columna = kit.malla(kit.cil(1.1, 52, 8), matVisor, g, 'TK-101', [-37, 50, 0]);
      kit.malla(kit.cil(1.8, 52, 8), kit.matDinamico(0x9fc4d9, { transparent: true, opacity: 0.35, depthWrite: false }), g, 'TK-101', [-37, 50, 0]);
      // boca de hombre lateral con su puerta (bisagra, brida atornillada y manilla) en el frente, a la derecha de la placa del tanque
      {
        const h = kit.ensamble(), ang = 0.62;
        radial(h, cilZ(7, 1.4, 20), 'inox', ang, R + 0.3, 44);
        radial(h, cilZ(6, 1.2, 20), 'inoxMate', ang, R + 1.4, 44);
        for (let i = 0; i < 8; i++) { const a = (i / 8) * PI * 2; radial(h, cilZ(0.55, 0.9, 6), 'inoxMate', ang, R + 2.3, 44, 6.4 * Math.cos(a), 6.4 * Math.sin(a)); }
        radial(h, kit.caja(9, 1.1, 0.9), 'inoxMate', ang, R + 2.6, 44); radial(h, cilZ(1.2, 1.2, 8), 'inox', ang, R + 2.5, 44);
        radial(h, kit.caja(2, 5, 1.4), 'inoxMate', ang, R + 1.8, 44, -7, 0);                        // bisagra
        h.construir(g, 'TK-101');
      }
      const matChorro = kit.matDinamico(K.VERDE_PRODUCTO, { transparent: true, opacity: 0.8, depthWrite: false });
      const chorro = kit.malla(kit.cil(1.0, 70, 8), matChorro, g, 'TK-101', [-14, 37, 34.5]);
      const charco = kit.malla(kit.cil(7, 0.5, 20), matChorro, g, 'TK-101', [-14, 2.3, 34.5]);
      chorro.visible = false; charco.visible = false; chorro.raycast = () => {}; charco.raycast = () => {};       // no se seleccionan
      base.registrar('TK-101', g, [70, 100, 70]);
      let reloj = 0;
      let ultimoColor = -1;
      base.alActualizar((estado, dt) => {
        const n = K.nivelTanquePct(estado) / 100;
        columna.scale.y = Math.max(0.02, n); columna.position.y = 24 + 26 * Math.max(0.02, n);
        const hex = K.colorProducto(K.num(estado && estado.tanque && estado.tanque.temperaturaC, 4));
        if (hex !== ultimoColor) { matVisor.color.setHex(hex); ultimoColor = hex; }
        const rebosa = K.tanqueDesbordando(estado);
        chorro.visible = rebosa; charco.visible = rebosa;
        if (rebosa) {                                                       // el chorro tiembla y el charco respira
          reloj += dt || 0;
          const k = 1 + 0.14 * Math.sin(reloj * 14), c = 1 + 0.06 * Math.sin(reloj * 5);
          chorro.scale.set(k, 1, k); charco.scale.set(c, 1, c);
        }
      });
    })();

    /* ---------- FLT-101 filtro de aspiración (colador en T con cesta extraíble) ---------- */
    (function () {
      const g = base.nuevoGrupo('FLT-101', [16, 0]), e = kit.ensamble();          // 16 cm a la derecha del layout: libra las patas del tanque y alinea sus bocas con TK-101.sal
      cilE(e, 1.9, 24, 'z', [0, 12, 0], 'inox', 12);                                  // tubo pasante (eje z)
      cilE(e, 2.5, 7, 'z', [0, 12, 0], 'inox', 14);                                   // cuerpo en T, algo más ancho
      soldadura(e, 2.5, 'z', [0, 12, -3.6], 14); soldadura(e, 2.5, 'z', [0, 12, 3.6], 14);
      tricamp(e, [0, 12, -10.6], 'z'); tricamp(e, [0, 12, 10.6], 'z');          // en los extremos del tubo pasante, que es donde empalman las tuberías
      e.add(kit.cil(5, 10, 18), 'inox', [0, 17, 0]);                                  // carcasa de la cesta (derivación vertical)
      e.add(kit.cil(5.3, 0.7, 18), 'inoxMate', [0, 11.7, 0]);                        // soldadura al cuerpo
      tricamp(e, [0, 22.4, 0], 'y', 3.7);                                             // tapa con tri-clamp
      e.add(kit.cil(1.4, 3.6, 8), 'inoxMate', [0, 26.4, 0]); e.add(kit.esfera(1.3, 8), 'oscuro', [0, 28.4, 0]);   // asa de la tapa
      e.add(kit.cil(1.3, 1.4, 8), 'inoxMate', [4.9, 17, 0], [0, 0, PI / 2]); e.add(kit.cil(0.7, 1.4, 8), 'rojo', [6.2, 17, 0], [0, 0, PI / 2]);    // purga con tapón
      e.add(kit.cil(1.2, 9, 8), 'inoxMate', [0, 4.5, 0]); e.add(kit.cil(3, 0.8, 12), 'inoxMate', [0, 0.4, 0]);       // soporte con placa de apoyo
      flecha(e, [0, 14.4, -3.2], 'z', 1);
      const matTapa = kit.matDinamico(0xc3cbd3);
      kit.malla(kit.cono(5, 3, 3, 18), matTapa, g, 'FLT-101', [0, 24.6, 0]).userData.clave = 'inox';
      e.construir(g, 'FLT-101');
      placaGrabada(g, 'FLT-101', 7.4, 2.8, [0, 17, 5.05], 0, '');
      base.registrar('FLT-101', g, [14, 30, 26], 36);
      let oscuro = false;
      base.alCambiarEfectos('FLT-101', ef => { oscuro = ef.has('colador_oscuro'); });
      base.alActualizar(estado => {
        const o = K.num(K.equipoDe(estado, 'FLT-101').obstruccion01, 0);
        matTapa.color.setHex(K.mezclarHex(0xc3cbd3, 0x6b4a2f, oscuro ? Math.max(o, 0.8) : o));
      });
    })();

    /* ---------- bombas centrífugas sanitarias P-101 y P-201 ---------- */
    // Eje del rodete a lo largo de z: aspiración axial por el lado -z (donde llega el tubo), voluta de carcasa con abrazadera, descarga tangencial hacia arriba,
    // linterna con el acoplamiento visible, motor con aletas, caja de bornas y ventilador bajo su rejilla. Centro de la voluta: (-10, 13, -3).
    function bomba(tag) {
      const g = base.nuevoGrupo(tag), e = kit.ensamble();
      const ent = local(tag, 'ent', g), sal = local(tag, 'sal', g), cx = BOMBA.x, cy = BOMBA.y;
      // bancada sobre cuatro pies regulables
      e.add(kit.caja(26, 2, 31), 'inoxMate', [cx, 3.6, 1.5]);
      for (const [dx, z] of [[-10.5, -12], [10.5, -12], [-10.5, 15], [10.5, 15]]) { e.add(kit.cil(0.8, 2.6, 8), 'inoxMate', [cx + dx, 1.3, z]); e.add(kit.cil(2, 0.4, 10), 'inoxMate', [cx + dx, 0.2, z]); tornillo(e, [cx + dx, 2.6, z], 'y', 1.3, 0.9); }
      e.add(kit.caja(7, 1.4, 5), 'inox', [cx, 5, BOMBA.z]);                          // pie de la voluta
      e.add(kit.caja(13, 1.2, 10), 'azul', [cx, 5.1, 10.2]);                          // pies del motor
      // voluta: carcasa, tapa frontal atornillada, abrazadera con su tensor y brida trasera
      e.add(kit.cil(8.4, 8, 24), 'inox', [cx, cy, BOMBA.z], [PI / 2, 0, 0]);
      e.add(kit.cil(8.7, 1.2, 24), 'inox', [cx, cy, -6.2], [PI / 2, 0, 0]);
      e.add(kit.cil(3.4, 1.5, 14), 'inox', [cx, cy, -7.4], [PI / 2, 0, 0]);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * PI * 2 + 0.2; tornillo(e, [cx + 7.2 * Math.cos(a), cy + 7.2 * Math.sin(a), -7], 'z', 0.55, 0.9); }
      e.add(kit.cil(8.9, 1.4, 24), 'inoxMate', [cx, cy, -4.8], [PI / 2, 0, 0]); e.add(kit.caja(1.6, 1.5, 2.2), 'inoxMate', [cx - 9.3, cy, -4.8]);
      e.add(kit.cil(8.6, 0.9, 24), 'inoxMate', [cx, cy, 0.6], [PI / 2, 0, 0]);
      // aspiración axial (hacia el tubo, por -z) con soldadura y tri-clamp, y descarga tangencial hacia arriba con su cono de transición
      cilE(e, 1.9, 4.5, 'z', [ent[0], ent[1], ent[2] + 2.7], 'inox', 12); soldadura(e, 1.9, 'z', [ent[0], ent[1], ent[2] + 4.6], 12); tricamp(e, [ent[0], ent[1], ent[2] + 0.9], 'z');
      e.add(kit.cono(3.4, 1.9, 2.8, 14), 'inox', [sal[0], 21.8, sal[2]]); e.add(kit.cil(1.9, 3.2, 10), 'inox', [sal[0], (23 + sal[1]) / 2 - 0.2, sal[2]]);
      soldadura(e, 1.9, 'y', [sal[0], 23.2, sal[2]], 12); tricamp(e, [sal[0], sal[1] - 1.4, sal[2]], 'y');
      flecha(e, [cx - 4, cy + 2.2, -9.2], 'z', 1); flecha(e, [sal[0] + 3.3, 24, sal[2]], 'y', 1);
      // sentido de giro: arco con punta de flecha en la tapa frontal
      e.add(kit.toro(5, 0.28, 4.2, 20), 'amarillo', [cx, cy, -8.2], [0, 0, 0.5]);
      { const a = 0.5 + 4.2; e.add(kit.cono(0.9, 0.05, 1.8, 6), 'amarillo', [cx + 5 * Math.cos(a), cy + 5 * Math.sin(a), -8.2], [0, 0, a]); }
      // linterna con cuatro costillas, motor con aletas, escudo trasero, rejilla del ventilador, caja de bornas, prensaestopas y cáncamo
      e.add(kit.cil(6.4, 0.8, 18), 'inoxMate', [cx, cy, 1.4], [PI / 2, 0, 0]);
      for (let i = 0; i < 4; i++) { const a = PI / 4 + (i * PI) / 2; e.add(kit.caja(1.2, 1.2, 2.3), 'inoxMate', [cx + 5.4 * Math.cos(a), cy + 5.4 * Math.sin(a), 2.95]); }
      e.add(kit.cil(7.9, 0.9, 20), 'inoxMate', [cx, cy, 4.45], [PI / 2, 0, 0]);
      e.add(kit.cil(7.5, 10.8, 20), 'azul', [cx, cy, 10.3], [PI / 2, 0, 0]);
      for (const z of [7.2, 9.2, 11.2, 13.2]) e.add(kit.cil(7.85, 0.5, 20), 'azul', [cx, cy, z], [PI / 2, 0, 0]);
      e.add(kit.cil(6.9, 1.2, 18), 'azul', [cx, cy, 16.1], [PI / 2, 0, 0]);
      for (const z of [16.7, 18.8]) e.add(kit.toro(7.2, 0.3, PI * 2, 18), 'oscuro', [cx, cy, z]);
      for (let i = 0; i < 10; i++) { const a = (i / 10) * PI * 2; e.add(kit.caja(0.4, 0.4, 2.2), 'oscuro', [cx + 7.2 * Math.cos(a), cy + 7.2 * Math.sin(a), 17.75]); }
      for (let i = 0; i < 3; i++) e.add(kit.caja(14.6, 0.4, 0.4), 'oscuro', [cx, cy, 18.9], [0, 0, (i * PI) / 3]);
      e.add(kit.caja(7, 4.4, 6.4), 'negro', [cx, cy + 9.7, 10]);                       // caja de bornas
      e.add(kit.caja(5.8, 0.4, 5.2), 'oscuro', [cx, cy + 12, 10]);
      for (const [dx, dz] of [[-2.6, -2.1], [2.6, -2.1], [-2.6, 2.1], [2.6, 2.1]]) tornillo(e, [cx + dx, cy + 12.3, 10 + dz], 'y', 0.35, 0.5);
      cilE(e, 0.9, 2, 'x', [cx + 4.2, cy + 9.7, 10], 'oscuro', 8);
      e.add(kit.toro(1.1, 0.3, PI * 2, 10), 'inoxMate', [cx, cy + 8.4, 6.2], [0, PI / 2, 0]);
      e.add(kit.caja(0.4, 4, 5.4), 'laton', [cx + 7.7, cy, 10.3]);                      // pletina de la placa del motor
      // acoplamiento y ventilador (giran)
      const eje = new THREE.Group(); eje.position.set(cx, cy, 2.9); g.add(eje);
      kit.malla(kit.cil(1.9, 2.1, 12), kit.mat('laton'), eje, tag, [0, 0, 0], [PI / 2, 0, 0]);
      kit.malla(kit.caja(0.7, 4, 0.7), kit.mat('amarillo'), eje, tag, [0, 0, 0]);
      const ventilador = new THREE.Group(); ventilador.position.set(cx, cy, 17.6); g.add(ventilador);
      kit.malla(kit.cil(1.4, 1, 10), kit.mat('inoxMate'), ventilador, tag, [0, 0, 0], [PI / 2, 0, 0]);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * PI * 2; kit.malla(kit.caja(4.4, 0.4, 1.5), kit.mat('inoxMate'), ventilador, tag, [3.6 * Math.cos(a), 3.6 * Math.sin(a), 0], [0.5, 0, a]); }
      const matLed = kit.matLed(0x777777);
      kit.malla(kit.esfera(0.9, 8), matLed, g, tag, [cx, cy + 12.8, 10]);
      e.construir(g, tag);
      placaGrabada(g, tag, 8.6, 4.6, [cx + 7.95, cy, 10.3], PI / 2);
      base.registrar(tag, g, [48, 34, 36], 38);
      let angulo = 0, ultimoLed = -1;
      base.alActualizar((estado, dt) => {
        const eq = K.equipoDe(estado, tag);
        angulo += K.velocidadAngularVisual(!!eq.marcha && !eq.fallo, eq.velocidadPct) * dt;
        ventilador.rotation.z = angulo; eje.rotation.z = angulo;
        const led = eq.fallo ? 0xff3b30 : eq.marcha ? 0x35e06b : 0x777777;
        if (led !== ultimoLed) { matLed.color.setHex(led); ultimoLed = led; }
      });
    }
    bomba('P-101'); bomba('P-201');

    /* ---------- HX-101 intercambiador de placas ---------- */
    // Bastidor azul (cabezal fijo y placa móvil), dos barras portadoras arriba y una guía abajo, seis tornillos de apriete con tuercas, tres paquetes de placas
    // con juntas, placas de conexión de acero entre paquetes, tobera tri-clamp por cada puerto y bandeja de goteo.
    (function () {
      const g = base.nuevoGrupo('HX-101'), e = kit.ensamble();
      const pos = posicionesPlacas(), xm = pos.x1 + 1.5;
      e.add(kit.caja(3, 72, 56), 'azul', [-48, 40, 0]);                            // cabezal fijo
      e.add(kit.caja(3, 72, 56), 'azul', [xm, 40, 0]);                             // placa móvil
      for (const x of [-48, xm]) { e.add(kit.caja(3, 5, 26), 'azul', [x, 76.5, 0]); e.add(kit.caja(3, 3.4, 12), 'azul', [x, 4.7, 0]); }   // orejas de las barras
      for (const y of [22, 58]) e.add(kit.caja(1, 3, 40), 'azul', [xm + 2, y, 0]);   // nervios de la placa móvil
      for (const x of pos.separadores) { e.add(kit.caja(2.4, 66, 52), 'inoxMate', [x, 41, 0]); e.add(kit.caja(2.4, 3, 18), 'inoxMate', [x, 74.5, 0]); }   // placas de conexión (acero)
      for (const z of [-9, 9]) cilE(e, 1.6, 104, 'x', [-1, 77, z], 'inoxMate', 10);   // barras portadoras
      cilE(e, 1.2, 104, 'x', [-1, 5, 0], 'inoxMate', 10);                              // barra guía inferior
      // tornillos de apriete (con arandela y tuerca en ambos extremos)
      for (const [y, z] of [[9, -26], [9, 26], [41, -26.5], [41, 26.5], [71, -26], [71, 26]]) {
        cilE(e, 0.85, 98, 'x', [-3, y, z], 'inox', 8);
        for (const [x, s] of [[-49.9, -1], [xm + 1.9, 1]]) { cilE(e, 2.3, 0.4, 'x', [x, y, z], 'inoxMate', 10); cilE(e, 1.55, 1.5, 'x', [x + s * 1.0, y, z], 'inoxMate', 6); }
      }
      for (const x of [-48, xm]) e.add(kit.caja(8, 4, 52), 'inoxMate', [x, 2, 0]);                    // patas
      for (const x of [-48, xm]) for (const z of [-22, 22]) { e.add(kit.cil(0.9, 1.6, 8), 'inoxMate', [x, 0.8, z]); e.add(kit.cil(2, 0.4, 10), 'inoxMate', [x, 0.2, z]); }
      e.add(kit.caja(88, 0.8, 54), 'inoxMate', [-3, 3.3, 0]);                          // bandeja de goteo
      for (const z of [-27.2, 27.2]) e.add(kit.caja(88, 2.2, 0.8), 'inoxMate', [-3, 4.2, z]);
      for (const x of [-47, 41]) e.add(kit.caja(0.8, 2.2, 54), 'inoxMate', [x, 4.2, 0]);
      // toberas (los puertos de tubería) con su banda de color por fluido (producto verde, agua caliente naranja, agua fría azul) y tri-clamp
      const fluidos = { raw_in: K.VERDE_PRODUCTO, past_in: K.VERDE_PRODUCTO, cal_out: K.VERDE_PRODUCTO, fin_out: K.VERDE_PRODUCTO, reg_out: K.VERDE_PRODUCTO, enf_in: K.VERDE_PRODUCTO,
        hot_in: K.NARANJA_AGUA_CALIENTE, hot_out: K.NARANJA_AGUA_CALIENTE, cold_in: K.AZUL_AGUA, cold_out: K.AZUL_AGUA };
      for (const nombre of Object.keys(fluidos)) {
        const p = local('HX-101', nombre, g);
        e.add(kit.cil(3.3, 1.6, 14), 'inox', [p[0], 72.8, p[2]]); e.add(kit.cil(1.9, 8, 10), 'inox', [p[0], p[1] - 4, p[2]]);
        soldadura(e, 3.3, 'y', [p[0], 73.8, p[2]], 14); e.add(kit.cil(2.15, 1.1, 12), fluidos[nombre], [p[0], p[1] - 6.5, p[2]]);
        tricamp(e, [p[0], p[1] - 1.1, p[2]], 'y');
      }
      e.construir(g, 'HX-101');
      // placas: una sola malla instanciada, con color por instancia (cada paquete toma el color de su fluido); junta oscura entre cada par de placas
      const total = PLACAS.regeneracion + PLACAS.calentamiento + PLACAS.enfriamiento;
      const matPlaca = kit.matDinamico(0xffffff);
      const placas = new THREE.InstancedMesh(kit.registrar(kit.caja(0.55, 62, 50)), matPlaca, total);
      placas.userData.id = 'HX-101'; placas.userData.clave = 'instanciada'; placas.frustumCulled = false;
      const juntas = new THREE.InstancedMesh(kit.registrar(kit.caja(0.9, 61, 49.2)), kit.matDinamico(0x1c2025), total);
      juntas.userData.id = 'HX-101'; juntas.userData.clave = 'instanciada'; juntas.userData.soloCerrado = true; juntas.frustumCulled = false;
      const m = new THREE.Matrix4(), color = new THREE.Color();
      const rangos = { regeneracion: [0, PLACAS.regeneracion], calentamiento: [PLACAS.regeneracion, PLACAS.regeneracion + PLACAS.calentamiento], enfriamiento: [PLACAS.regeneracion + PLACAS.calentamiento, total] };
      for (const paquete of Object.keys(rangos)) pos[paquete].forEach((x, i) => { m.setPosition(x, 41, 0); placas.setMatrixAt(rangos[paquete][0] + i, m); m.setPosition(x + 0.74, 41, 0); juntas.setMatrixAt(rangos[paquete][0] + i, m); });
      for (let i = 0; i < total; i++) placas.setColorAt(i, color.setHex(0xc3cbd3));
      g.add(placas); g.add(juntas);
      // fuga de placa: gota y charco
      const gota = kit.malla(kit.esfera(0.9, 8), kit.matLed(0xdfeeff), g, 'HX-101', [-27, 6, 27]); gota.visible = false;
      const charco = kit.malla(kit.cil(5, 0.3, 14), kit.matDinamico(0xd8e4ee, { transparent: true, opacity: 0.8 }), g, 'HX-101', [-27, 0.2, 29]); charco.visible = false;
      let fuga = false;
      base.alCambiarEfectos('HX-101', ef => { fuga = ef.has('goteo'); gota.visible = fuga; charco.visible = fuga; });
      base.registrar('HX-101', g, [104, 82, 60]);
      const ultimos = { regeneracion: -1, calentamiento: -1, enfriamiento: -1 };
      let fase = 0;
      base.alActualizar((estado, dt) => {
        const colores = {
          regeneracion: K.mezclarHex(0xc3cbd3, 0xf2b690, (K.temperaturaDe(estado, 'trasRegeneracion', 20) - 20) / 60),
          calentamiento: K.mezclarHex(0xc3cbd3, 0xe8743c, (K.temperaturaDe(estado, 'aguaCaliente', 20) - 20) / 70),
          enfriamiento: K.mezclarHex(0xc3cbd3, 0x7fc4ea, (30 - K.temperaturaDe(estado, 'salidaFinal', 20)) / 26),
        };
        for (const paquete of Object.keys(rangos)) {
          const hex = colores[paquete] | 0;
          if (hex === ultimos[paquete]) continue;
          ultimos[paquete] = hex; color.setHex(hex);
          for (let i = rangos[paquete][0]; i < rangos[paquete][1]; i++) placas.setColorAt(i, color);
          placas.instanceColor.needsUpdate = true;
        }
        if (fuga) { fase = (fase + dt * 1.6) % 1; gota.position.y = 8 - 8 * fase * fase; }
      });
    })();

    /* ---------- HT-101 tubo de residencia (serpentín de tres pasos sobre dos caballetes) ---------- */
    (function () {
      const g = base.nuevoGrupo('HT-101', [18, 0]), e = kit.ensamble();          // 18 cm a la derecha del layout: el serpentín empieza a la derecha del bastidor de HX-101
      const LP = 54;                                                              // largo de cada paso (cm)
      const matTubo = kit.matDinamico(0xc3cbd3);
      for (const y of [20, 34, 48]) e.add(kit.cil(1.9, LP, 12), matTubo, [0, y, 0], [0, 0, PI / 2]);
      e.add(kit.toro(7, 1.9, PI, 18), matTubo, [LP / 2, 27, 0], [0, 0, -PI / 2]);      // codo derecho (pasos 1-2)
      e.add(kit.toro(7, 1.9, PI, 18), matTubo, [-LP / 2, 41, 0], [0, 0, PI / 2]);      // codo izquierdo (pasos 2-3)
      const ent = local('HT-101', 'ent', g), sal = local('HT-101', 'sal', g);
      e.add(kit.cil(1.9, 14, 10), matTubo, [ent[0] + 7, ent[1], ent[2]], [0, 0, PI / 2]); e.add(kit.cil(1.9, 8, 10), matTubo, [sal[0] - 4, sal[1], sal[2]], [0, 0, PI / 2]);
      // soldaduras en los codos y uniones tri-clamp cada pocos metros de tubo recto, y las conexiones de entrada y salida
      for (const y of [20, 34, 48]) { for (const x of [-LP / 2, LP / 2]) soldadura(e, 1.9, 'x', [x, y, 0], 12); for (const x of [-8, 8]) tricamp(e, [x, y, 0], 'x'); }
      tricamp(e, [ent[0] + 1.5, ent[1], ent[2]], 'x'); tricamp(e, [sal[0] - 1.5, sal[1], sal[2]], 'x');
      // flechas del sentido de flujo (entra por abajo a la izquierda y sale por arriba a la derecha)
      flecha(e, [0, 20, 2.0], 'x', 1); flecha(e, [0, 34, 2.0], 'x', -1); flecha(e, [0, 48, 2.0], 'x', 1);
      // dos caballetes: montantes, base, travesaños bajo cada paso y abrazaderas atornilladas al tubo
      for (const x of [-17, 17]) {
        for (const z of [-8, 8]) { e.add(kit.caja(2.5, 54, 2.5), 'inoxMate', [x, 27, z]); e.add(kit.cil(2.6, 0.6, 10), 'inoxMate', [x, 0.3, z]); }
        e.add(kit.caja(3, 2.2, 22), 'inoxMate', [x, 1.1, 0]); e.add(kit.caja(3, 2, 20), 'inoxMate', [x, 54.5, 0]);
        for (const y of [20, 34, 48]) { e.add(kit.caja(3, 1.2, 16), 'inoxMate', [x, y - 2.8, 0]); cilE(e, 2.4, 1.4, 'x', [x, y, 0], 'inoxMate', 12); e.add(kit.caja(1.2, 1.2, 3), 'inoxMate', [x, y + 2.9, 0]); }
      }
      e.construir(g, 'HT-101');
      placaGrabada(g, 'HT-101', 9, 3.4, [17, 40, 9.35], 0);
      base.registrar('HT-101', g, [86, 58, 24], 64);
      let ultimo = -1;
      base.alActualizar(estado => {
        const hex = K.colorTuboCaliente(K.temperaturaDe(estado, 'salidaTubo', 20));
        if (hex !== ultimo) { matTubo.color.setHex(hex); ultimo = hex; }
      });
    })();

    /* ---------- FDV-101 válvula de desvío neumática (3 vías) ---------- */
    (function () {
      const g = base.nuevoGrupo('FDV-101'), e = kit.ensamble();
      // soporte: placa de anclaje atornillada, columna y escuadra de apoyo
      e.add(kit.caja(14, 1, 14), 'inoxMate', [0, 0.5, 0]); for (const sx of [-5, 5]) for (const sz of [-5, 5]) tornillo(e, [sx, 1.3, sz], 'y', 0.6, 0.8);
      e.add(kit.cil(2.6, 8.5, 12), 'inoxMate', [0, 5.25, 0]); e.add(kit.cil(3.8, 1, 14), 'inoxMate', [0, 9.5, 0]);
      // cuerpo en T: depósito de la válvula, tramo pasante (x) y entrada común (z) con soldaduras y tri-clamp en los tres puertos
      e.add(kit.cil(4.2, 9, 18), 'inox', [0, 14, 0]);
      e.add(kit.cil(2.6, 14, 14), 'inox', [0, 14, 0], [0, 0, PI / 2]);
      e.add(kit.cil(2.6, 6.5, 14), 'inox', [0, 14, -3.25], [PI / 2, 0, 0]);
      e.add(kit.cil(1.9, 3.6, 10), 'inox', [7.8, 14, 0], [0, 0, PI / 2]); e.add(kit.cil(1.9, 3.6, 10), 'inox', [-7.8, 14, 0], [0, 0, PI / 2]); e.add(kit.cil(1.9, 3.6, 10), 'inox', [0, 14, -8.2], [PI / 2, 0, 0]);
      for (const x of [-6.6, 6.6]) soldadura(e, 2.6, 'x', [x, 14, 0], 12); soldadura(e, 2.6, 'z', [0, 14, -6.2], 12);
      tricamp(e, [9.2, 14, 0], 'x'); tricamp(e, [-9.2, 14, 0], 'x'); tricamp(e, [0, 14, -9.2], 'z');
      flecha(e, [0, 14, -4.7], 'z', 1);
      // unión del cuerpo con el cabezal (abrazadera ancha), cuello y yugo de dos barras donde se montan los finales de carrera
      e.add(kit.cil(3.2, 1, 14), 'inox', [0, 18.9, 0]); e.add(kit.cil(4.6, 1.3, 16), 'inoxMate', [0, 19.1, 0]); e.add(kit.caja(1.2, 1.2, 1.2), 'inoxMate', [5.4, 19.1, 0]);
      e.add(kit.cil(2.5, 3.2, 12), 'inox', [0, 21.1, 0]); e.add(kit.cil(3.6, 1, 14), 'inoxMate', [0, 23, 0]);
      for (const sx of [-1, 1]) { e.add(kit.caja(0.9, 8.5, 5), 'inoxMate', [sx * 3.9, 27.7, 0]); }                 // yugo
      e.add(kit.caja(8.8, 0.8, 5), 'inoxMate', [0, 31.8, 0]);
      // actuador neumático: cuerpo, tapas azules con tornillos, tapa superior con el indicador visual y la toma de aire
      e.add(kit.cil(7, 12, 22), 'inox', [0, 38, 0]); e.add(kit.cil(7.5, 2, 22), 'azul', [0, 45, 0]); e.add(kit.cil(7.5, 2, 22), 'azul', [0, 32, 0]);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * PI * 2; tornillo(e, [6.4 * Math.cos(a), 46.3, 6.4 * Math.sin(a)], 'y', 0.55, 0.7); tornillo(e, [6.4 * Math.cos(a), 30.7, 6.4 * Math.sin(a)], 'y', 0.55, 0.7); }
      e.add(kit.cono(7, 3.6, 2.4, 20), 'azul', [0, 47.2, 0]); e.add(kit.cil(1.3, 3, 10), 'inoxMate', [0, 49.9, 0]); e.add(kit.cil(2, 2.2, 12), 'amarillo', [0, 52, 0]);
      e.add(kit.cil(1.3, 2, 10), 'laton', [5, 42, 5.8], [PI / 2, 0, 0]); tornillo(e, [5, 42, 6.9], 'z', 1.5, 0.8);    // racor de aire (el tubo entra por aquí)
      e.add(kit.cil(0.5, 7, 6), 'oscuro', [0, 28, 0]); e.construir(g, 'FDV-101');
      const vastago = kit.malla(kit.cil(0.8, 8, 8), kit.mat('inox'), g, 'FDV-101', [0, 26, 0]);
      const leva = kit.malla(kit.cil(1.5, 0.8, 12), kit.mat('amarillo'), g, 'FDV-101', [0, 26, 0]);                     // la leva que ven los finales de carrera
      placaGrabada(g, 'FDV-101', 9.4, 3.6, [0, 38, 7.05], 0);
      base.registrar('FDV-101', g, [24, 54, 22], 58);
      let ultimo = -1;
      base.alActualizar(estado => {
        const a = K.aperturaFDV(estado);
        if (a !== ultimo) { vastago.position.y = 24 + 4 * a; leva.position.y = 25 + 4 * a; ultimo = a; }          // el vástago sube al pasar a avance
      });
    })();

    /* ---------- SV-101 electroválvula piloto ---------- */
    (function () {
      const g = base.nuevoGrupo('SV-101'), e = kit.ensamble();
      e.add(kit.caja(9, 6, 6), 'laton', [0, 8, 0]);                                              // cuerpo de latón
      e.add(kit.cil(2.6, 7, 14), 'negro', [0, 14.5, 0]); e.add(kit.cil(2.85, 0.6, 14), 'oscuro', [0, 11.2, 0]); e.add(kit.cil(2.85, 0.6, 14), 'oscuro', [0, 17.8, 0]);   // bobina
      e.add(kit.caja(3.2, 2, 3.4), 'negro', [0, 19, 0]); tornillo(e, [0, 20.2, 0], 'y', 0.4, 0.5);      // conector DIN
      for (const sx of [-4, 4]) { e.add(kit.cil(1.1, 4, 10), 'laton', [sx, 13, 0]); tornillo(e, [sx, 11.4, 0], 'y', 1.4, 0.8); }      // racores de aire: entrada a la derecha, salida a la izquierda
      e.add(kit.cil(0.5, 6, 6), 'inoxMate', [4, 4, 0], [0, 0, PI / 2]);
      e.add(kit.cil(0.9, 1.2, 8), 'rojo', [-4.9, 8, 0], [0, 0, PI / 2]);                              // accionamiento manual
      for (const sx of [-3, 3]) { e.add(kit.cil(1, 2.4, 8), 'inoxMate', [sx, 1.2, 0]); e.add(kit.cil(2, 0.4, 10), 'inoxMate', [sx, 0.2, 0]); }
      e.construir(g, 'SV-101');
      const matLed = kit.matLed(0x777777);
      kit.malla(kit.esfera(0.9, 8), matLed, g, 'SV-101', [0, 20.6, 0]);
      base.registrar('SV-101', g, [10, 22, 10], 28);
      let apagado = false, ultimo = -1;
      base.alCambiarEfectos('SV-101', ef => { apagado = ef.has('led_apagado'); ultimo = -1; });
      base.alActualizar(estado => {
        const energizada = !!K.equipoDe(estado, 'SV-101').energizada && !apagado;
        const hex = apagado ? 0x333333 : energizada ? 0x35e06b : 0x777777;
        if (hex !== ultimo) { matLed.color.setHex(hex); ultimo = hex; }
      });
    })();

    /* ---------- FRL-501 unidad de aire ---------- */
    (function () {
      const g = base.nuevoGrupo('FRL-501'), e = kit.ensamble();
      e.add(kit.caja(14, 3, 10), 'inoxMate', [0, 1.5, 0]);
      e.add(kit.cil(3.2, 9, 12), 'vidrio', [-4.5, 8, 0]); e.add(kit.cil(3.6, 5, 12), 'inox', [-4.5, 14.5, 0]);       // filtro
      e.add(kit.cil(3.2, 9, 12), 'inoxMate', [4.5, 8, 0]); e.add(kit.cil(3.6, 5, 12), 'inox', [4.5, 14.5, 0]);       // regulador / lubricador
      e.add(kit.cil(0.5, 5, 6), 'negro', [4.5, 19, 0]);
      e.add(kit.cil(1.1, 1.6, 10), 'rojo', [-4.5, 0.6 + 3.2, 3.4], [PI / 2, 0, 0]);                                 // purga del filtro
      e.add(kit.cil(1.5, 2, 10), 'laton', [0, 14.5, 0], [0, 0, PI / 2]);                                              // unión entre módulos
      e.add(kit.cil(1.1, 2.6, 10), 'laton', [-4.5, 18.3, 0]);                                                        // racor de salida sobre la tapa del filtro (puerto sal)
      e.construir(g, 'FRL-501');
      const matManometro = kit.matDinamico(0xf2f0e6);
      kit.malla(kit.cil(2.6, 1, 14), matManometro, g, 'FRL-501', [4.5, 21, 0]);
      base.registrar('FRL-501', g, [16, 24, 12], 30);
      let rojo = false, ultimo = -1;
      base.alCambiarEfectos('FRL-501', ef => { rojo = ef.has('manometro_rojo'); ultimo = -1; });
      base.alActualizar(estado => {
        const aire = K.equipoDe(estado, 'FDV-101').aireOK !== false && !rojo;
        const hex = aire ? 0xf2f0e6 : 0xff3b30;
        if (hex !== ultimo) { matManometro.color.setHex(hex); ultimo = hex; }
      });
    })();

    /* ---------- HW-201 calentador de agua caliente (dos bancos) ---------- */
    // Depósito de acero con camisa de aislamiento forrada de chapa (zunchos), tapa superior con respiradero y válvula de seguridad, patas regulables,
    // brida de cada banco de resistencias con su caja de bornas por detrás y tubuladuras tri-clamp. OJO: el nivel solo se conoce por dos interruptores (bajo y alto).
    (function () {
      const g = base.nuevoGrupo('HW-201'), e = kit.ensamble();
      for (const [sx, sz] of [[-12, -12], [12, -12], [-12, 12], [12, 12]]) {
        e.add(kit.cil(1.6, 7, 8), 'inoxMate', [sx, 6.5, sz]); e.add(kit.caja(5, 1, 5), 'inoxMate', [sx, 9.8, sz]);
        e.add(kit.cil(0.8, 2.5, 8), 'inoxMate', [sx, 1.75, sz]); e.add(kit.cil(1.5, 1, 6), 'inoxMate', [sx, 3.3, sz]); e.add(kit.cil(2.6, 0.5, 10), 'inoxMate', [sx, 0.25, sz]);
      }
      e.add(kit.cil(17, 56, 28), 'gris', [0, 38, 0]);                                  // camisa aislante
      e.add(kit.cil(17.6, 2, 28), 'inoxMate', [0, 10.5, 0]); e.add(kit.cil(17.6, 2, 28), 'inoxMate', [0, 66.5, 0]);
      e.add(kit.cono(17, 6, 8, 28), 'gris', [0, 70, 0]);
      for (const y of [20, 46, 63]) { e.add(kit.cil(17.15, 1.3, 28), 'inoxMate', [0, y, 0]); e.add(kit.caja(2.8, 1.8, 1.4), 'inoxMate', [-17.4 * Math.cos(2.3), y, 17.4 * Math.sin(2.3)], [0, -2.3, 0]); }
      e.add(kit.caja(0.5, 54, 3), 'inoxMate', [17.0 * Math.cos(-2.2), 38, 17.0 * Math.sin(-2.2)], [0, 2.2, 0]);          // solape de la chapa
      // tapa superior con brida atornillada, respiradero y válvula de seguridad
      e.add(kit.cil(6.2, 1.6, 20), 'inoxMate', [0, 74.6, 0]);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * PI * 2; tornillo(e, [5 * Math.cos(a), 75.6, 5 * Math.sin(a)], 'y', 0.5, 0.7); }
      e.add(kit.cil(1.4, 3.4, 10), 'inox', [0, 77, 0]); e.add(kit.esfera(1.6, 8), 'oscuro', [0, 79, 0]);
      e.add(kit.cil(1.1, 5, 8), 'inox', [-8, 74.9, 3]); e.add(kit.cil(1.9, 1.1, 10), 'inoxMate', [-8, 77.8, 3]);       // respiradero
      e.add(kit.cil(1.5, 3.4, 10), 'laton', [8.2, 74.2, -3.5]); e.add(kit.cil(1.25, 2.6, 10), 'rojo', [8.2, 76.9, -3.5]); e.add(kit.cil(0.35, 3, 6), 'inoxMate', [8.2, 78.9, -3.5]);   // válvula de seguridad
      // tubuladuras: salida (-x, abajo), retorno (-x, arriba), llenado (+x) y vaciado (frente); cada una con su soldadura y tri-clamp
      const sa = local('HW-201', 'sal', g), en = local('HW-201', 'ent', g), ll = local('HW-201', 'llen', g), va = local('HW-201', 'vac', g);
      for (const p of [sa, en]) { e.add(kit.cil(3, 1.4, 12), 'inox', [p[0] + 1.7, p[1], p[2]], [0, 0, PI / 2]); soldadura(e, 2.6, 'x', [p[0] + 1.1, p[1], p[2]], 12); tricamp(e, [p[0] - 0.2, p[1], p[2]], 'x'); }
      e.add(kit.cil(1.9, 2, 10), 'inox', [ll[0] - 1, ll[1], ll[2]], [0, 0, PI / 2]); e.add(kit.esfera(2.1, 10), 'inox', [ll[0], ll[1], ll[2]]);
      e.add(kit.esfera(2.1, 10), 'inox', [va[0], va[1], va[2] + 0.2]); radial(e, cilZ(2.8, 1.2, 12), 'inoxMate', Math.atan2(va[0], va[2]), Math.hypot(va[0], va[2]) - 0.8, va[1]);
      // bornas de los bancos: brida con tornillos en la pared trasera y caja de conexión con prensaestopas
      for (const bx of [-6.5, 6.5]) {
        e.add(kit.cil(5.2, 1.2, 20), 'inoxMate', [bx, 16, -15.9], [PI / 2, 0, 0]);
        for (let i = 0; i < 6; i++) { const a = (i / 6) * PI * 2; tornillo(e, [bx + 4.1 * Math.cos(a), 16 + 4.1 * Math.sin(a), -16.7], 'z', 0.5, 0.7); }
        e.add(kit.caja(8, 7, 4.6), 'oscuro', [bx, 16, -19.6]); e.add(kit.caja(6.6, 5.6, 0.5), 'grisOscuro', [bx, 16, -22.1]);
        cilE(e, 0.9, 2, 'y', [bx, 11.2, -19.6], 'negro', 8); for (const dx of [-2.6, 2.6]) for (const dy of [-2.2, 2.2]) tornillo(e, [bx + dx, 16 + dy, -22.5], 'z', 0.35, 0.5);
      }
      // Visor frontal: marco oscuro, columna de agua con su nivel y los dos bancos de resistencias, de tres varillas cada uno, que brillan en naranja
      // cuando su contactor está cerrado. La marca roja es el nivel bajo (15 %) donde actúa LSL-201.
      const VX = -3, VZ = 17.6, VY0 = 11.8, VALTO = 52.4, MARCA_LSL = VY0 + VALTO * 0.15;
      e.add(kit.caja(11, 54, 1.4), 'negro', [VX, 38, VZ]);
      for (const y of [11, 65]) e.add(kit.caja(11.8, 1.1, 1.8), 'inoxMate', [VX, y, VZ]);                  // marcos de acero del visor
      for (const dx of [-5.2, 5.2]) for (const y of [11, 65]) tornillo(e, [VX + dx, y, VZ + 1.1], 'z', 0.4, 0.5);
      e.add(kit.caja(11.4, 0.7, 0.4), 'rojo', [VX, MARCA_LSL, VZ + 1.3]);
      e.add(kit.caja(11.4, 0.7, 0.4), 'azul', [VX, VY0 + VALTO * 0.9, VZ + 1.3]);      // marca del nivel alto (90 %), donde actúa LSH-201
      const resB1 = kit.matLed(0x6a6f75), resB2 = kit.matLed(0x6a6f75), eb1 = kit.ensamble(), eb2 = kit.ensamble();
      for (const dx of [-3.4, -2.0, -0.6]) eb1.add(kit.cil(0.5, 7, 6), resB1, [VX + dx, 15.5, VZ + 2.0]);
      for (const dx of [0.6, 2.0, 3.4]) eb2.add(kit.cil(0.5, 7, 6), resB2, [VX + dx, 15.5, VZ + 2.0]);
      e.construir(g, 'HW-201'); eb1.construir(g, 'HW-201'); eb2.construir(g, 'HW-201');
      const matAgua = kit.matDinamico(0x3a8fd0);
      const aguaVisor = kit.malla(kit.caja(9.6, 1, 0.9), matAgua, g, 'HW-201', [VX, VY0 + 1, VZ + 0.9]);
      const lamparaNivel = kit.malla(kit.esfera(1.4, 8), kit.matLed(0xff3b30), g, 'HW-201', [VX, 66.6, VZ + 0.2]);
      lamparaNivel.visible = false;
      const matBanco1 = kit.matLed(0x555555), matBanco2 = kit.matLed(0x555555);
      kit.malla(kit.esfera(1.1, 8), matBanco1, g, 'HW-201', [VX - 3.8, 67.4, VZ + 0.6]); kit.malla(kit.esfera(1.1, 8), matBanco2, g, 'HW-201', [VX + 3.8, 67.4, VZ + 0.6]);   // pilotos B1 y B2 sobre el visor
      const matJacket = kit.matDinamico(0xd9dcde); const camisa = kit.malla(kit.cil(17.2, 8, 28), matJacket, g, 'HW-201', [0, 56, 0]); camisa.userData.clave = 'gris';
      placaGrabada(g, 'B1', 3.6, 1.6, [-6.5, 16, -22.45], PI, ''); placaGrabada(g, 'B2', 3.6, 1.6, [6.5, 16, -22.45], PI, '');
      base.registrar('HW-201', g, [40, 80, 40], 86);
      let u1 = -1, u2 = -1, u3 = -1, u4 = -1, u5 = -1, u6 = null;
      base.alActualizar(estado => {
        const b1 = K.bancoEncendido(estado, 1), b2 = K.bancoEncendido(estado, 2), tAgua = K.temperaturaAguaCaliente(estado);
        const c1 = b1 ? 0xff7a1a : 0x555555, c2 = b2 ? 0xff7a1a : 0x555555;
        if (c1 !== u1) { matBanco1.color.setHex(c1); resB1.color.setHex(b1 ? 0xff7a1a : 0x6a6f75); u1 = c1; }
        if (c2 !== u2) { matBanco2.color.setHex(c2); resB2.color.setHex(b2 ? 0xff7a1a : 0x6a6f75); u2 = c2; }
        const hex = K.mezclarHex(0xd9dcde, 0xe9a27c, (tAgua - 20) / 70);
        if (hex !== u3) { matJacket.color.setHex(hex); u3 = hex; }
        const n = K.nivelAguaCalientePct(estado) / 100;                                  // columna de agua del visor
        if (n !== u4) { aguaVisor.scale.y = Math.max(0.01, VALTO * n); aguaVisor.position.y = VY0 + Math.max(0.01, VALTO * n) / 2; u4 = n; }
        const ca = K.colorAguaCaliente(tAgua);
        if (ca !== u5) { matAgua.color.setHex(ca); u5 = ca; }
        const bajo = K.contactoLSL(estado) === 'abierto';                                // LSL-201 abierto: nivel bajo, resistencias en peligro
        if (bajo !== u6) { lamparaNivel.visible = bajo; u6 = bajo; }
      });
      camisa.visible = true;
    })();

    /* ---------- válvulas todo/nada: XV-301 y XV-401 (servicios) y XV-101, XV-102, XV-201, XV-202 (llenado y vaciado) ---------- */
    // Válvula de mariposa sanitaria con actuador neumático y su piloto de bobina. `fluido`: color de las bandas que rodean las bocas (producto verde, agua fría
    // azul, agua caliente naranja, CIP verde amarillento). Abierta: el capuchón indicador sube y se pone verde y asoma el vástago; cerrada: capuchón gris.
    function valvulaTodoNada(tag, fluido, giro = 0) {
      const g = base.nuevoGrupo(tag), e = kit.ensamble();
      g.rotation.y = giro;
      const matBanda = kit.matDinamico(fluido);
      cilE(e, 3.6, 4.6, 'z', [0, 10, 0], 'inox', 16);                                                    // cuerpo de la mariposa
      for (const s of [-1, 1]) {
        cilE(e, 4.1, 0.7, 'z', [0, 10, s * 2.5], 'inoxMate', 16);                                         // bridas del cuerpo
        cilE(e, 1.9, 5, 'z', [0, 10, s * 5.1], 'inox', 12);                                              // bocas (z = ±8: puertos)
        cilE(e, 2.15, 1, 'z', [0, 10, s * 4.4], matBanda, 12);                                           // banda del color del fluido
        tricamp(e, [0, 10, s * 7.3], 'z');
      }
      flecha(e, [0, 13.45, 0], 'y', 1);
      e.add(kit.cil(1.7, 2.4, 10), 'inox', [0, 14.4, 0]); e.add(kit.cil(2.5, 0.8, 12), 'inoxMate', [0, 13.9, 0]);                  // cuello con abrazadera
      e.add(kit.cil(3.2, 5.6, 16), 'azul', [0, 18.4, 0]); e.add(kit.cil(3.5, 0.6, 16), 'inoxMate', [0, 15.9, 0]); e.add(kit.cil(3.5, 0.6, 16), 'inoxMate', [0, 21.1, 0]);   // actuador
      e.add(kit.cil(1.3, 3, 10), 'negro', [4.6, 20.2, 0], [0, 0, PI / 2]); e.add(kit.cil(0.45, 1.8, 6), 'laton', [3.4, 20.2, 0], [0, 0, PI / 2]);   // piloto de bobina (alto: así XV-202, girada, pasa por encima del visor de HW-201)
      e.add(kit.caja(1.4, 1.2, 1.6), 'negro', [6.4, 20.2, 0]);
      e.construir(g, tag);
      const matCapuchon = kit.matLed(0x777777);
      const capuchon = kit.malla(kit.cil(2.2, 1.6, 12), matCapuchon, g, tag, [0, 21.8, 0]);
      const vastago = kit.malla(kit.cil(0.55, 2.2, 6), kit.mat('inoxMate'), g, tag, [0, 22.7, 0]);
      vastago.visible = false;
      placaGrabada(g, tag, 5.4, 2, [0, 18.4, 3.25], 0, '');
      base.registrar(tag, g, [14, 24, 22], 28);
      let ultimo = null;
      base.alActualizar(estado => {
        const abierta = K.valvulaAbierta(estado, tag);
        if (abierta === ultimo) return;
        ultimo = abierta;
        matCapuchon.color.setHex(abierta ? 0x35e06b : 0x777777);
        capuchon.position.y = abierta ? 23.6 : 21.8; vastago.visible = abierta;
      });
    }
    valvulaTodoNada('XV-301', K.AZUL_AGUA); valvulaTodoNada('XV-401', 0xb7c98a);
    valvulaTodoNada('XV-101', K.VERDE_PRODUCTO); valvulaTodoNada('XV-102', K.VERDE_PRODUCTO);
    valvulaTodoNada('XV-201', K.AZUL_AGUA); valvulaTodoNada('XV-202', K.NARANJA_AGUA_CALIENTE, PI / 2);      // XV-202 va girada para no salirse del patín

    return { grupo: base.grupo, elementos: base.elementos, actualizar: base.actualizar, liberar: kit.liberar, TAGS };
  }

  const api = { crear, TAGS, PLACAS, posicionesPlacas, BOMBA, PLACAS_NOMBRE, nombrePlaca };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstEquiposProceso = api; }
})();
