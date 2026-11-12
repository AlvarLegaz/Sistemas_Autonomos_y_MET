// Equipos de proceso de la planta HTST en 3D (DISEÑADOR): tanque de balance, filtro, bombas centrífugas, intercambiador de placas, tubo de residencia,
// FDV neumática con su piloto, unidad de aire, calentador de agua y válvulas todo/nada. Acero inoxidable con materiales ligeros y piezas fusionadas.
// Contrato de layout.js: crear(THREE, estadoInicial) → { grupo, elementos, actualizar(estado, lecturas), liberar() }. Ids = tags ISA.
(function () {
  const K = typeof require !== 'undefined' ? require('./kit.js') : PCT.htstKit;
  const B = typeof require !== 'undefined' ? require('./base_equipo.js') : PCT.htstBase;
  const P = typeof require !== 'undefined' ? require('./puertos.js') : PCT.htstPuertos;
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.htstLayout;
  const PI = Math.PI;
  const TAGS = ['TK-101', 'FLT-101', 'P-101', 'P-102', 'P-103', 'HX-101', 'HT-101', 'FDV-101', 'SV-101', 'FRL-101', 'HW-101', 'XV-301', 'XV-401', 'XV-101', 'XV-102', 'XV-302', 'XV-303'];

  // Distribución de las placas del intercambiador: tres paquetes (regeneración, calentamiento, enfriamiento) separados por placas de bastidor.
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

  function crear(THREE, estadoInicial) {
    const kit = K.crearKit(THREE);
    const base = B.crearBase(kit);
    const local = (tag, nombre, g) => { const p = P.puerto(tag, nombre); return [p[0] - g.position.x, p[1], p[2] - g.position.z]; };

    /* ---------- TK-101 tanque de balance ---------- */
    (function () {
      const g = base.nuevoGrupo('TK-101'), e = kit.ensamble();
      for (const [sx, sz] of [[-24, -24], [24, -24], [-24, 24], [24, 24]]) e.add(kit.cil(2, 22, 8), 'inoxMate', [sx, 11, sz]);
      e.add(kit.cil(33, 56, 24), 'inox', [0, 50, 0]);                          // cuerpo
      e.add(kit.cono(10, 33, 6, 24), 'inox', [0, 19, 0]);                      // fondo cónico
      e.add(kit.cono(33, 8, 10, 24), 'inox', [0, 83, 0]);                      // techo cónico
      e.add(kit.cil(8.5, 2, 16), 'inoxMate', [0, 89, 0]);                      // tapa de la boca de hombre
      e.add(kit.cil(5.5, 10, 12), 'azul', [0, 95, 0]);                         // motorreductor del agitador
      e.add(kit.cil(2.2, 8, 8), 'inoxMate', [0, 91, 0]);
      const s = local('TK-101', 'sal', g), r = local('TK-101', 'ret', g);
      e.add(kit.cil(1.9, 5, 10), 'inox', [s[0] - 1.5, s[1], s[2]], [0, 0, PI / 2]); e.add(kit.toro(2.6, 0.5), 'inoxMate', [s[0] - 4, s[1], s[2]], [0, PI / 2, 0]);
      e.add(kit.cil(1.9, 7, 10), 'inox', [r[0], r[1] - 2, r[2]]); e.add(kit.toro(2.6, 0.5), 'inoxMate', [r[0], r[1] + 1.5, r[2]], [PI / 2, 0, 0]);
      e.add(kit.cil(0.5, 54, 6), 'inoxMate', [-37, 50, 0]);                    // soportes del visor de nivel
      e.add(kit.cil(2, 2, 8), 'inoxMate', [-35, 24, 0], [0, 0, PI / 2]); e.add(kit.cil(2, 2, 8), 'inoxMate', [-35, 76, 0], [0, 0, PI / 2]);
      const matVisor = kit.matDinamico(K.VERDE_PRODUCTO);                      // el producto es verde
      const columna = kit.malla(kit.cil(1.1, 52, 8), matVisor, g, 'TK-101', [-37, 50, 0]);
      kit.malla(kit.cil(1.8, 52, 8), kit.matDinamico(0x9fc4d9, { transparent: true, opacity: 0.35, depthWrite: false }), g, 'TK-101', [-37, 50, 0]);
      // Rebosadero: boquilla en la parte alta del frente del tanque, con un chorro y un charco que aparecen solo si el tanque desborda.
      e.add(kit.cil(1.3, 7, 8), 'inox', [-14, 74.5, 31.2], [PI / 2, 0, 0]); e.add(kit.cil(1.3, 6, 8), 'inox', [-14, 72, 34.5]);
      e.construir(g, 'TK-101');
      const matChorro = kit.matDinamico(K.VERDE_PRODUCTO, { transparent: true, opacity: 0.8, depthWrite: false });
      const chorro = kit.malla(kit.cil(1.0, 70, 8), matChorro, g, 'TK-101', [-14, 37, 34.5]);
      const charco = kit.malla(kit.cil(7, 0.5, 20), matChorro, g, 'TK-101', [-14, 2.3, 34.5]);
      chorro.visible = false; charco.visible = false; chorro.raycast = () => {}; charco.raycast = () => {};       // no se seleccionan
      base.registrar('TK-101', g, [70, 96, 70]);
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

    /* ---------- FLT-101 filtro de aspiración (colador) ---------- */
    (function () {
      const g = base.nuevoGrupo('FLT-101'), e = kit.ensamble();
      e.add(kit.cil(1.9, 24, 10), 'inox', [0, 12, 0], [PI / 2, 0, 0]);            // tubo pasante (eje z)
      e.add(kit.cil(5, 10, 16), 'inox', [0, 17, 0]);                               // cuerpo del colador (derivación vertical)
      e.add(kit.toro(5.6, 0.7), 'inoxMate', [0, 22, 0], [PI / 2, 0, 0]);          // abrazadera tri-clamp
      e.add(kit.cil(4, 2, 12), 'inoxMate', [0, 11, 0]);
      const matTapa = kit.matDinamico(0xc3cbd3);
      kit.malla(kit.cono(5, 3, 3, 14), matTapa, g, 'FLT-101', [0, 24, 0]).userData.clave = 'inox';
      e.construir(g, 'FLT-101');
      base.registrar('FLT-101', g, [14, 28, 26], 34);
      let oscuro = false;
      base.alCambiarEfectos('FLT-101', ef => { oscuro = ef.has('colador_oscuro'); });
      base.alActualizar(estado => {
        const o = K.num(K.equipoDe(estado, 'FLT-101').obstruccion01, 0);
        matTapa.color.setHex(K.mezclarHex(0xc3cbd3, 0x6b4a2f, oscuro ? Math.max(o, 0.8) : o));
      });
    })();

    /* ---------- bombas centrífugas P-101, P-103 y P-102 ---------- */
    function bomba(tag) {
      const g = base.nuevoGrupo(tag), e = kit.ensamble();
      const ent = local(tag, 'ent', g), sal = local(tag, 'sal', g);
      e.add(kit.caja(40, 3, 24), 'inoxMate', [2, 1.5, 0]);                         // bancada
      e.add(kit.cil(9, 8, 18), 'inox', [-10, 13, 0], [PI / 2, 0, 0]);              // voluta
      e.add(kit.cil(2.2, 12, 10), 'inox', [ent[0], ent[1], ent[2] + 6], [PI / 2, 0, 0]); e.add(kit.toro(2.8, 0.5), 'inoxMate', [ent[0], ent[1], ent[2]], [0, 0, 0]);
      e.add(kit.cil(2.2, 13, 10), 'inox', [sal[0], (13 + sal[1]) / 2, sal[2]]); e.add(kit.toro(2.8, 0.5), 'inoxMate', [sal[0], sal[1], sal[2]], [PI / 2, 0, 0]);
      e.add(kit.caja(10, 8, 8), 'inoxMate', [1, 6, 0]);                            // linterna
      e.add(kit.cil(8.5, 22, 16), 'azul', [12, 13, 0], [0, 0, PI / 2]);           // motor
      for (const x of [5, 9, 13, 17]) e.add(kit.toro(8.7, 0.5, PI * 2, 14), 'azul', [x, 13, 0], [0, PI / 2, 0]);
      e.add(kit.caja(8, 5, 6), 'negro', [12, 23.5, 0]);                            // caja de bornas
      e.add(kit.cono(8.5, 6.5, 3, 14), 'oscuro', [24.5, 13, 0], [0, 0, -PI / 2]);  // cubierta del ventilador
      const ventilador = new THREE.Group(); ventilador.position.set(23.2, 13, 0); g.add(ventilador);
      kit.malla(kit.caja(0.6, 11, 1.2), kit.mat('inoxMate'), ventilador, tag); kit.malla(kit.caja(0.6, 1.2, 11), kit.mat('inoxMate'), ventilador, tag);
      const matLed = kit.matLed(0x777777);
      kit.malla(kit.esfera(1, 8), matLed, g, tag, [12, 26.8, 0]);
      e.construir(g, tag);
      base.registrar(tag, g, [46, 31, 26], 36);
      let angulo = 0, ultimoLed = -1;
      base.alActualizar((estado, dt) => {
        const eq = K.equipoDe(estado, tag);
        angulo += K.velocidadAngularVisual(!!eq.marcha && !eq.fallo, eq.velocidadPct) * dt; ventilador.rotation.x = angulo;
        const led = eq.fallo ? 0xff3b30 : eq.marcha ? 0x35e06b : 0x777777;
        if (led !== ultimoLed) { matLed.color.setHex(led); ultimoLed = led; }
      });
    }
    bomba('P-101'); bomba('P-103'); bomba('P-102');

    /* ---------- HX-101 intercambiador de placas ---------- */
    (function () {
      const g = base.nuevoGrupo('HX-101'), e = kit.ensamble();
      const pos = posicionesPlacas();
      e.add(kit.caja(3, 72, 56), 'azul', [-48, 40, 0]);                            // placa fija del bastidor
      e.add(kit.caja(3, 72, 56), 'azul', [pos.x1 + 1.5, 40, 0]);                   // placa móvil
      for (const x of pos.separadores) e.add(kit.caja(2.4, 66, 52), 'rojo', [x, 41, 0]);   // placas intermedias (conexiones de los paquetes)
      e.add(kit.cil(1.6, 100, 10), 'inoxMate', [0, 77, 0], [0, 0, PI / 2]);        // barra portadora
      e.add(kit.cil(1.2, 100, 10), 'inoxMate', [0, 4, 0], [0, 0, PI / 2]);         // barra guía inferior
      for (const [y, z] of [[14, -24], [14, 24], [66, -24], [66, 24]]) e.add(kit.cil(0.8, 96, 8), 'inox', [0, y, z], [0, 0, PI / 2]);   // tirantes
      for (const x of [-48, pos.x1 + 1.5]) e.add(kit.caja(6, 4, 52), 'inoxMate', [x, 2, 0]);                                                // patas
      // toberas de la parte superior: los puertos de tubería
      for (const nombre of ['raw_in', 'past_in', 'cal_out', 'fin_out', 'hot_in', 'hot_out', 'cold_in', 'cold_out']) {
        const p = local('HX-101', nombre, g);
        e.add(kit.cil(1.9, 10, 10), 'inox', [p[0], p[1] - 4, p[2]]); e.add(kit.toro(2.6, 0.5), 'inoxMate', [p[0], p[1] - 0.2, p[2]], [PI / 2, 0, 0]);
      }
      // juntas: una tira oscura bajo cada paquete
      e.add(kit.caja(pos.regeneracion.length * PLACAS.paso, 1, 50), 'junta', [(pos.regeneracion[0] + pos.regeneracion.at(-1)) / 2, 8.5, 0]);
      e.add(kit.caja(pos.calentamiento.length * PLACAS.paso, 1, 50), 'junta', [(pos.calentamiento[0] + pos.calentamiento.at(-1)) / 2, 8.5, 0]);
      e.add(kit.caja(pos.enfriamiento.length * PLACAS.paso, 1, 50), 'junta', [(pos.enfriamiento[0] + pos.enfriamiento.at(-1)) / 2, 8.5, 0]);
      e.construir(g, 'HX-101');
      // placas: una sola malla instanciada, con color por instancia (cada paquete toma el color de su fluido)
      const total = PLACAS.regeneracion + PLACAS.calentamiento + PLACAS.enfriamiento;
      const matPlaca = kit.matDinamico(0xffffff);
      const placas = new THREE.InstancedMesh(kit.registrar(kit.caja(0.55, 62, 50)), matPlaca, total);
      placas.userData.id = 'HX-101'; placas.userData.clave = 'instanciada'; placas.frustumCulled = false;
      const m = new THREE.Matrix4(), color = new THREE.Color();
      const rangos = { regeneracion: [0, PLACAS.regeneracion], calentamiento: [PLACAS.regeneracion, PLACAS.regeneracion + PLACAS.calentamiento], enfriamiento: [PLACAS.regeneracion + PLACAS.calentamiento, total] };
      for (const paquete of Object.keys(rangos)) pos[paquete].forEach((x, i) => { m.setPosition(x, 41, 0); placas.setMatrixAt(rangos[paquete][0] + i, m); });
      for (let i = 0; i < total; i++) placas.setColorAt(i, color.setHex(0xc3cbd3));
      g.add(placas);
      // fuga de placa: gota y charco
      const gota = kit.malla(kit.esfera(0.9, 8), kit.matLed(0xdfeeff), g, 'HX-101', [-27, 6, 27]); gota.visible = false;
      const charco = kit.malla(kit.cil(5, 0.3, 14), kit.matDinamico(0xd8e4ee, { transparent: true, opacity: 0.8 }), g, 'HX-101', [-27, 0.2, 29]); charco.visible = false;
      let fuga = false;
      base.alCambiarEfectos('HX-101', ef => { fuga = ef.has('goteo'); gota.visible = fuga; charco.visible = fuga; });
      base.registrar('HX-101', g, [104, 82, 60]);
      const ultimos = { regeneracion: -1, calentamiento: -1, enfriamiento: -1 };
      let fase = 0;
      base.alActualizar((estado, dt) => {
        const caliente = (hex) => hex;
        const colores = {
          regeneracion: K.mezclarHex(0xc3cbd3, 0xf2b690, (K.temperaturaDe(estado, 'trasRegeneracion', 20) - 20) / 60),
          calentamiento: K.mezclarHex(0xc3cbd3, 0xe8743c, (K.temperaturaDe(estado, 'aguaCaliente', 20) - 20) / 70),
          enfriamiento: K.mezclarHex(0xc3cbd3, 0x7fc4ea, (30 - K.temperaturaDe(estado, 'salidaFinal', 20)) / 26),
        };
        for (const paquete of Object.keys(rangos)) {
          const hex = caliente(colores[paquete] | 0);
          if (hex === ultimos[paquete]) continue;
          ultimos[paquete] = hex; color.setHex(hex);
          for (let i = rangos[paquete][0]; i < rangos[paquete][1]; i++) placas.setColorAt(i, color);
          placas.instanceColor.needsUpdate = true;
        }
        if (fuga) { fase = (fase + dt * 1.6) % 1; gota.position.y = 8 - 8 * fase * fase; }
      });
    })();

    /* ---------- HT-101 tubo de residencia (serpentín de tres pasos) ---------- */
    (function () {
      const g = base.nuevoGrupo('HT-101'), e = kit.ensamble();
      const matTubo = kit.matDinamico(0xc3cbd3);
      for (const y of [20, 34, 48]) e.add(kit.cil(1.9, 80, 10), matTubo, [0, y, 0], [0, 0, PI / 2]);
      e.add(kit.toro(7, 1.9, PI, 14), matTubo, [40, 27, 0], [0, 0, -PI / 2]);          // codo derecho (pasos 1-2)
      e.add(kit.toro(7, 1.9, PI, 14), matTubo, [-40, 41, 0], [0, 0, PI / 2]);          // codo izquierdo (pasos 2-3)
      const ent = local('HT-101', 'ent', g), sal = local('HT-101', 'sal', g);
      e.add(kit.cil(1.9, 8, 10), matTubo, [ent[0] + 4, ent[1], ent[2]], [0, 0, PI / 2]); e.add(kit.cil(1.9, 8, 10), matTubo, [sal[0] - 4, sal[1], sal[2]], [0, 0, PI / 2]);
      for (const x of [-34, -17, 0, 17, 34]) e.add(kit.toro(2.6, 0.45, PI * 2, 10), 'inoxMate', [x, 20, 0], [0, PI / 2, 0]);     // abrazaderas
      for (const x of [-26, 26]) { e.add(kit.caja(3, 52, 3), 'inoxMate', [x, 26, -4]); e.add(kit.caja(3, 3, 12), 'inoxMate', [x, 49.5, 0]); e.add(kit.caja(3, 3, 12), 'inoxMate', [x, 19, 0]); }
      e.construir(g, 'HT-101');
      base.registrar('HT-101', g, [96, 58, 24], 64);
      let ultimo = -1;
      base.alActualizar(estado => {
        const hex = K.colorTuboCaliente(K.temperaturaDe(estado, 'salidaTubo', 20));
        if (hex !== ultimo) { matTubo.color.setHex(hex); ultimo = hex; }
      });
    })();

    /* ---------- FDV-101 válvula de desvío neumática (3 vías) ---------- */
    (function () {
      const g = base.nuevoGrupo('FDV-101'), e = kit.ensamble();
      e.add(kit.caja(9, 10, 9), 'inox', [0, 14, 0]);                                  // cuerpo de tres vías
      e.add(kit.cil(1.9, 8, 10), 'inox', [0, 14, -6], [PI / 2, 0, 0]); e.add(kit.cil(1.9, 8, 10), 'inox', [7, 14, 0], [0, 0, PI / 2]); e.add(kit.cil(1.9, 8, 10), 'inox', [-7, 14, 0], [0, 0, PI / 2]);
      e.add(kit.toro(2.7, 0.5), 'inoxMate', [0, 14, -10], [0, 0, 0]); e.add(kit.toro(2.7, 0.5), 'inoxMate', [10, 14, 0], [0, PI / 2, 0]); e.add(kit.toro(2.7, 0.5), 'inoxMate', [-10, 14, 0], [0, PI / 2, 0]);
      e.add(kit.cil(2.5, 6, 10), 'inox', [0, 22, 0]);                                  // cuello
      e.add(kit.cil(0.8, 12, 6), 'inoxMate', [-3.2, 29, 0]); e.add(kit.cil(0.8, 12, 6), 'inoxMate', [3.2, 29, 0]);   // yugo
      e.add(kit.cil(7, 12, 18), 'inox', [0, 38, 0]); e.add(kit.cil(7.4, 2, 18), 'azul', [0, 45, 0]); e.add(kit.cil(7.4, 2, 18), 'azul', [0, 32, 0]);   // actuador neumático
      e.add(kit.cil(5, 25, 8), 'inoxMate', [0, 6, 0]);                                  // pie
      e.add(kit.cil(0.6, 7, 6), 'oscuro', [0, 28, 0]); e.construir(g, 'FDV-101');
      const vastago = kit.malla(kit.cil(0.8, 8, 8), kit.mat('inox'), g, 'FDV-101', [0, 26, 0]);
      base.registrar('FDV-101', g, [24, 50, 22], 56);
      let ultimo = -1;
      base.alActualizar(estado => {
        const a = K.aperturaFDV(estado);
        if (a !== ultimo) { vastago.position.y = 24 + 4 * a; ultimo = a; }          // el vástago sube al pasar a avance
      });
    })();

    /* ---------- SV-101 electroválvula piloto ---------- */
    (function () {
      const g = base.nuevoGrupo('SV-101'), e = kit.ensamble();
      e.add(kit.caja(8, 6, 6), 'laton', [0, 8, 0]); e.add(kit.cil(2.6, 7, 12), 'negro', [0, 14.5, 0]); e.add(kit.caja(3, 2, 3), 'negro', [0, 19, 0]);
      e.add(kit.cil(0.5, 6, 6), 'inoxMate', [4, 4, 0], [0, 0, PI / 2]);
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

    /* ---------- FRL-101 unidad de aire ---------- */
    (function () {
      const g = base.nuevoGrupo('FRL-101'), e = kit.ensamble();
      e.add(kit.caja(14, 3, 10), 'inoxMate', [0, 1.5, 0]);
      e.add(kit.cil(3.2, 9, 12), 'vidrio', [-4.5, 8, 0]); e.add(kit.cil(3.6, 5, 12), 'inox', [-4.5, 14.5, 0]);       // filtro
      e.add(kit.cil(3.2, 9, 12), 'inoxMate', [4.5, 8, 0]); e.add(kit.cil(3.6, 5, 12), 'inox', [4.5, 14.5, 0]);       // regulador / lubricador
      e.add(kit.cil(0.5, 5, 6), 'negro', [4.5, 19, 0]);
      e.construir(g, 'FRL-101');
      const matManometro = kit.matDinamico(0xf2f0e6);
      kit.malla(kit.cil(2.6, 1, 14), matManometro, g, 'FRL-101', [4.5, 21, 0]);
      base.registrar('FRL-101', g, [16, 24, 12], 30);
      let rojo = false, ultimo = -1;
      base.alCambiarEfectos('FRL-101', ef => { rojo = ef.has('manometro_rojo'); ultimo = -1; });
      base.alActualizar(estado => {
        const aire = K.equipoDe(estado, 'FDV-101').aireOK !== false && !rojo;
        const hex = aire ? 0xf2f0e6 : 0xff3b30;
        if (hex !== ultimo) { matManometro.color.setHex(hex); ultimo = hex; }
      });
    })();

    /* ---------- HW-101 calentador de agua caliente (dos bancos) ---------- */
    (function () {
      const g = base.nuevoGrupo('HW-101'), e = kit.ensamble();
      for (const [sx, sz] of [[-12, -12], [12, -12], [-12, 12], [12, 12]]) e.add(kit.cil(1.6, 10, 8), 'inoxMate', [sx, 5, sz]);
      e.add(kit.cil(17, 56, 22), 'gris', [0, 38, 0]);                                  // camisa aislante
      e.add(kit.cil(17.6, 2, 22), 'inoxMate', [0, 10.5, 0]); e.add(kit.cil(17.6, 2, 22), 'inoxMate', [0, 66.5, 0]);
      e.add(kit.cono(17, 6, 8, 22), 'gris', [0, 70, 0]);
      e.add(kit.cil(1.9, 8, 10), 'inox', [-21, 20, 0], [0, 0, PI / 2]); e.add(kit.cil(1.9, 8, 10), 'inox', [-21, 62, 0], [0, 0, PI / 2]);
      e.add(kit.caja(10, 8, 6), 'negro', [-8, 16, -18]); e.add(kit.caja(10, 8, 6), 'negro', [8, 16, -18]);       // cajas de bornas de los dos bancos (detrás: delante tapaban el visor)
      // Visor frontal: marco oscuro, columna de agua con su nivel y los dos bancos de resistencias, de tres varillas cada uno, que brillan en naranja
      // cuando su contactor está cerrado. La marca roja es el nivel bajo (15 %) donde actúa LSL-301.
      const VX = -3, VZ = 17.6, VY0 = 11.8, VALTO = 52.4, MARCA_LSL = VY0 + VALTO * 0.15;
      e.add(kit.caja(11, 54, 1.4), 'negro', [VX, 38, VZ]);
      e.add(kit.caja(11.4, 0.7, 0.4), 'rojo', [VX, MARCA_LSL, VZ + 1.3]);
      const resB1 = kit.matLed(0x6a6f75), resB2 = kit.matLed(0x6a6f75), eb1 = kit.ensamble(), eb2 = kit.ensamble();
      for (const dx of [-3.4, -2.0, -0.6]) eb1.add(kit.cil(0.5, 7, 6), resB1, [VX + dx, 15.5, VZ + 2.0]);
      for (const dx of [0.6, 2.0, 3.4]) eb2.add(kit.cil(0.5, 7, 6), resB2, [VX + dx, 15.5, VZ + 2.0]);
      e.construir(g, 'HW-101'); eb1.construir(g, 'HW-101'); eb2.construir(g, 'HW-101');
      const matAgua = kit.matDinamico(0x3a8fd0);
      const aguaVisor = kit.malla(kit.caja(9.6, 1, 0.9), matAgua, g, 'HW-101', [VX, VY0 + 1, VZ + 0.9]);
      const lamparaNivel = kit.malla(kit.esfera(1.4, 8), kit.matLed(0xff3b30), g, 'HW-101', [VX, 66.6, VZ + 0.2]);
      lamparaNivel.visible = false;
      const matBanco1 = kit.matLed(0x555555), matBanco2 = kit.matLed(0x555555);
      kit.malla(kit.esfera(1.1, 8), matBanco1, g, 'HW-101', [VX - 3.8, 67.4, VZ + 0.6]); kit.malla(kit.esfera(1.1, 8), matBanco2, g, 'HW-101', [VX + 3.8, 67.4, VZ + 0.6]);   // pilotos B1 y B2 sobre el visor
      const matJacket = kit.matDinamico(0xd9dcde); const camisa = kit.malla(kit.cil(17.2, 8, 22), matJacket, g, 'HW-101', [0, 56, 0]); camisa.userData.clave = 'gris';
      base.registrar('HW-101', g, [40, 78, 40], 84);
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
        const bajo = K.contactoLSL(estado) === 'abierto';                                // LSL-301 abierto: nivel bajo, resistencias en peligro
        if (bajo !== u6) { lamparaNivel.visible = bajo; u6 = bajo; }
      });
      camisa.visible = true;
    })();

    /* ---------- válvulas todo/nada: XV-301 y XV-401 (servicios) y XV-101, XV-102, XV-302, XV-303 (llenado y vaciado) ---------- */
    // `fluido`: color de las bandas que rodean las bocas (producto verde, agua fría azul, agua caliente naranja, CIP verde amarillento).
    // Abierta: el actuador sube, asoma el vástago y el capuchón se pone verde; cerrada: capuchón gris y vástago recogido.
    function valvulaTodoNada(tag, fluido, giro = 0) {
      const g = base.nuevoGrupo(tag), e = kit.ensamble();
      g.rotation.y = giro;
      const matBanda = kit.matDinamico(fluido);
      e.add(kit.esfera(3.4, 10), 'inox', [0, 10, 0]);
      e.add(kit.cil(1.9, 6, 10), 'inox', [0, 10, 6.6], [PI / 2, 0, 0]); e.add(kit.cil(1.9, 6, 10), 'inox', [0, 10, -6.6], [PI / 2, 0, 0]);   // bocas (z = ±8: puertos)
      e.add(kit.toro(2.7, 0.5), 'inoxMate', [0, 10, 9.6]); e.add(kit.toro(2.7, 0.5), 'inoxMate', [0, 10, -9.6]);
      e.add(kit.toro(2.3, 0.55, Math.PI * 2, 10), matBanda, [0, 10, 5.2]); e.add(kit.toro(2.3, 0.55, Math.PI * 2, 10), matBanda, [0, 10, -5.2]);
      e.add(kit.cil(1.2, 4, 8), 'inoxMate', [0, 14.5, 0]); e.add(kit.cil(3, 5, 12), 'azul', [0, 18.5, 0]);                               // actuador
      e.construir(g, tag);
      const matCapuchon = kit.matLed(0x777777);
      const capuchon = kit.malla(kit.cil(2.2, 1.6, 12), matCapuchon, g, tag, [0, 21.8, 0]);
      const vastago = kit.malla(kit.cil(0.55, 2.2, 6), kit.mat('inoxMate'), g, tag, [0, 22.7, 0]);
      vastago.visible = false;
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
    valvulaTodoNada('XV-302', K.AZUL_AGUA); valvulaTodoNada('XV-303', K.NARANJA_AGUA_CALIENTE, PI / 2);      // XV-303 va girada para no salirse del patín

    return { grupo: base.grupo, elementos: base.elementos, actualizar: base.actualizar, liberar: kit.liberar, TAGS };
  }

  const api = { crear, TAGS, PLACAS, posicionesPlacas };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstEquiposProceso = api; }
})();
