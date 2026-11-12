// Instrumentación de la planta HTST en 3D (DISEÑADOR), con detalle de fabricante para que un alumno la reconozca como en una planta de verdad:
// sondas Pt100 con vaina tri-clamp o roscada, cuello, cabezal con tapa y prensaestopas; termostato de seguridad de bulbo; caudalímetro electromagnético
// con convertidor y pantalla; transmisores de presión con manómetro; transmisor de nivel hidrostático de membrana a ras; horquilla vibrante y sonda
// capacitiva en el tanque (sanitario); flotadores de vástago con bola y disco en el depósito de agua caliente; finales de carrera con rodillo y
// presostato con tornillo de ajuste. Todo lleva un LED de estado del lazo (verde OK, ámbar ruido o deriva, rojo abierto o corto) y los efectos de avería
// (cable cortado, LED apagado). Todo es geométrico y procedural: las piezas estáticas se funden por material (kit.ensamble) para dibujar poco.
(function () {
  const K = typeof require !== 'undefined' ? require('./kit.js') : PCT.htstKit;
  const B = typeof require !== 'undefined' ? require('./base_equipo.js') : PCT.htstBase;
  const T = typeof require !== 'undefined' ? require('./tuberias.js') : PCT.htstTuberias;
  const LAYOUT = typeof require !== 'undefined' ? require('../layout.js') : PCT.htstLayout;
  const PI = Math.PI;
  const TAGS = ['TT-101', 'TT-102', 'TT-103', 'TT-104', 'TT-201', 'TT-106', 'TSH-201', 'FT-101', 'PT-101', 'PT-102', 'LT-101', 'LSH-101', 'LSL-101', 'LSL-201', 'LSH-201', 'ZS-101', 'ZS-102', 'PSL-501'];

  // Depósitos donde van atornillados los instrumentos de nivel y temperatura (cm, coordenadas del patín): centro en planta y radio de la pared.
  const TK = { cx: -135, cz: -35, r: 33 };         // tanque de balance TK-101
  const HW = { cx: 20, cz: 45, r: 17 };            // depósito de agua caliente HW-201
  // El visor del tanque va de y = 24 (0 %) a y = 76 (100 %) y el del calentador de y = 11,8 a y = 64,2: así cada interruptor queda a la altura de su nivel.
  const nivelTanque = pct => 24 + 52 * pct / 100;
  const nivelCalentador = pct => 11.8 + 52.4 * pct / 100;
  const enPared = (c, dx, y) => [c.cx + dx, y, c.cz + Math.sqrt(c.r * c.r - dx * dx)];
  const giroPared = (c, dx) => Math.atan2(dx, Math.sqrt(c.r * c.r - dx * dx));     // giro (rad, eje y) para que el eje local z mire hacia fuera de la pared

  // Instrumentos de pared: [depósito, desplazamiento horizontal dx desde su eje (cm), altura y (cm)].
  const PARED = {
    'LT-101': [TK, 8, 26],                          // membrana a ras en la zona baja del tanque, bajo el nivel bajo (≈ 4 %)
    'LSL-101': [TK, -22, nivelTanque(12)],           // sonda capacitiva de nivel bajo, al 12 %
    'LSH-101': [TK, -22, nivelTanque(90)],           // horquilla vibrante de nivel alto, al 90 % (el rebosadero queda más arriba y a la derecha)
    'LSL-201': [HW, 12, nivelCalentador(15)],       // flotador de nivel bajo (15 % del visor, la marca roja), a la derecha del visor: a la izquierda tapaba la bomba P-201
    'LSH-201': [HW, 12, nivelCalentador(90)],       // flotador de nivel alto (90 % del visor, la marca azul), en la misma generatriz que LSL-201
    'TSH-201': [HW, 8, 42],                         // termostato de bulbo en la pared frontal del calentador
  };

  // Sitio de montaje de cada instrumento (cm, coordenadas del patín): sobre su tubo (punto medio del tramo horizontal más largo), o sobre un equipo.
  const MONTAJE_RUTA = { 'TT-101': 'LECHE_CRUDA_1', 'TT-103': 'LECHE_TRAS_TUBO', 'TT-104': 'LECHE_SALIDA', 'TT-201': 'AGUA_CALIENTE_2', 'PT-101': 'LECHE_CRUDA_4', 'PT-102': 'LECHE_AVANCE', 'TT-106': 'LECHE_REG_ENF' };
  const MONTAJE_FIJO = {
    'TT-102': [-12, 72, -10],                      // en la parte alta del intercambiador, entre los paquetes de regeneración y calentamiento
    'FT-101': [-68, 25, 35],                       // en línea entre la bomba P-101 y la entrada del intercambiador
    'ZS-101': [127, 26, -5], 'ZS-102': [111, 26, -5], 'PSL-501': [135, 18, 10],       // los finales de carrera, en el yugo de la FDV
  };
  /** Posición de montaje de un instrumento (función pura, sin THREE). */
  function montaje(tag) {
    if (MONTAJE_RUTA[tag]) return T.puntoSobreRuta(MONTAJE_RUTA[tag]);
    if (PARED[tag]) return enPared(PARED[tag][0], PARED[tag][1], PARED[tag][2]);
    return MONTAJE_FIJO[tag] || null;
  }
  /** Giro (rad, alrededor de y) de un instrumento de pared para que mire hacia fuera del depósito; null si no es de pared. */
  function giro(tag) { return PARED[tag] ? giroPared(PARED[tag][0], PARED[tag][1]) : null; }
  /** Nivel (%) al que está montado un interruptor de nivel, medido en la escala de su depósito (solo LSL/LSH); null en los demás. */
  function nivelDeMontaje(tag) {
    const p = PARED[tag];
    if (!p || !/^LS[HL]-/.test(tag)) return null;
    return p[0] === TK ? (p[2] - 24) / 52 * 100 : (p[2] - 11.8) / 52.4 * 100;
  }
  /** Tipo de instrumento por tag (para el 3D y las pruebas). */
  const TIPO = { 'TT-101': 'pt100_clamp', 'TT-102': 'pt100_clamp', 'TT-103': 'pt100_clamp', 'TT-104': 'pt100_clamp', 'TT-106': 'pt100_clamp', 'TT-201': 'pt100_rosca', 'TSH-201': 'termostato',
    'FT-101': 'electromagnetico', 'PT-101': 'presion', 'PT-102': 'presion', 'LT-101': 'hidrostatico', 'LSH-101': 'horquilla_vibrante', 'LSL-101': 'capacitivo',
    'LSL-201': 'flotador_bola', 'LSH-201': 'flotador_disco', 'ZS-101': 'final_carrera', 'ZS-102': 'final_carrera', 'PSL-501': 'presostato' };

  function crear(THREE) {
    const kit = K.crearKit(THREE);
    const base = B.crearBase(kit);
    const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
    const EJE_Y = new THREE.Vector3(0, 1, 0);
    const Y = [0, 1, 0], X = [1, 0, 0], Z = [0, 0, 1];
    const mas = (p, d, t) => [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t];
    const rotHacia = d => { const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(EJE_Y, V3(d).normalize())); return [e.x, e.y, e.z]; };
    const registrar = (tag, g, tam, ancla, centroHalo) => {
      base.registrar(tag, g, tam, ancla);
      if (centroHalo) g.children[g.children.length - 1].position.set(centroHalo[0], centroHalo[1], centroHalo[2]);     // el halo es el último hijo
    };

    /* ---------- Montaje: grupo en su sitio (y giro si es de pared). `c` es el grupo de diseño: eje y = hacia fuera de la pared, z = hacia abajo ---------- */
    function nuevoMontaje(tag) {
      const m = montaje(tag), g = new THREE.Group(); g.position.set(m[0], m[1], m[2]); base.grupo.add(g);
      if (giro(tag) === null) return { g, c: g };
      g.rotation.y = giro(tag);
      const c = new THREE.Group(); c.rotation.x = PI / 2; g.add(c);
      return { g, c };
    }

    /* ---------- Piezas de catálogo (todas sobre un ensamble `e`; `d` es el eje de la pieza) ---------- */
    const cilindro = (e, c, d, r, h, mat, seg = 14) => e.add(kit.cil(r, h, seg), mat, c, rotHacia(d));
    const hexagono = (e, c, d, r, h, mat = 'inoxMate') => e.add(kit.cil(r, h, 6), mat, c, rotHacia(d));
    // Unión tri-clamp: dos férulas, abrazadera y tornillo de mariposa hacia `lado`.
    function triclamp(e, c, d, r, lado) {
      cilindro(e, c, d, r, 0.55, 'inox', 16); cilindro(e, c, d, r + 0.5, 1.0, 'inoxMate', 16);
      const t = mas(c, lado, r + 0.9);
      cilindro(e, t, lado, 0.35, 1.5, 'inoxMate', 6); e.add(kit.caja(1.5, 0.35, 0.9), 'inoxMate', mas(c, lado, r + 1.7), rotHacia(d));
    }
    // Prensaestopas de latón con tuerca negra: devuelve el punto donde sale el cable.
    function prensa(e, p, d) {
      cilindro(e, mas(p, d, 0.5), d, 0.85, 1.0, 'laton', 8); hexagono(e, mas(p, d, 1.4), d, 0.95, 0.8, 'negro'); cilindro(e, mas(p, d, 2.0), d, 0.6, 0.5, 'negro', 8);
      return mas(p, d, 2.3);
    }
    // Tornillos de cabeza hexagonal en las esquinas de una tapa (centro p, normal d, separaciones sx, sz en los ejes locales x y z del diseño).
    function tornillos(e, p, d, sx, sz) {
      for (const a of [-1, 1]) for (const b of [-1, 1]) cilindro(e, [p[0] + a * sx, p[1], p[2] + b * sz], d, 0.32, 0.4, 'inoxMate', 6);
    }

    /* ---------- Placa de tag: chapa de acero con el nombre impreso (textura de canvas, solo si hay navegador) ---------- */
    function textura(texto) {
      if (typeof document === 'undefined') return null;
      const lz = document.createElement('canvas'); lz.width = 192; lz.height = 64;
      const c = lz.getContext('2d'); if (!c) return null;
      c.fillStyle = '#e7ebee'; c.fillRect(0, 0, 192, 64); c.strokeStyle = '#5b6670'; c.lineWidth = 4; c.strokeRect(2, 2, 188, 60);
      c.fillStyle = '#1b2127'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = '700 36px system-ui, sans-serif'; c.fillText(texto, 96, 34);
      const tx = new THREE.CanvasTexture(lz); tx.colorSpace = THREE.SRGBColorSpace; return kit.registrar(tx);
    }
    /** Chapa con el tag, en el padre `p`, en `pos`, con rotación `rot` (la cara impresa mira a +z local). */
    function placa(tag, p, pos, rot, ancho = 3.6, alto = 1.3) {
      const grp = new THREE.Group(); grp.position.set(pos[0], pos[1], pos[2]); grp.rotation.set(rot[0], rot[1], rot[2]); p.add(grp);
      kit.malla(kit.caja(ancho, alto, 0.12), kit.mat('inoxMate'), grp, tag, [0, 0, 0]);
      const tx = textura(tag);
      const m = kit.malla(new THREE.PlaneGeometry(ancho - 0.2, alto - 0.2), tx ? kit.matDinamico(0xffffff, { map: tx }) : kit.mat('blanco'), grp, tag, [0, 0, 0.065]);
      return m;
    }

    /* ---------- LED de lazo de un instrumento: color según `calidad`; con el efecto led_apagado se apaga ---------- */
    function ledEn(tag, p, pos, r = 0.55) {
      const mat = kit.matLed(0x35e06b);
      kit.malla(kit.esfera(r, 8), mat, p, tag, pos);
      return mat;
    }
    function enlazarLed(tag, matLed) {
      let apagado = false, ultimo = -1;
      base.alCambiarEfectos(tag, ef => { apagado = ef.has('led_apagado'); ultimo = -1; });
      base.alActualizar(estado => {
        const hex = apagado ? 0x333333 : K.colorLedCalidad(K.instrumentoDe(estado, tag).calidad);
        if (hex !== ultimo) { matLed.color.setHex(hex); ultimo = hex; }
      });
    }

    /* ---------- Cable del instrumento: la primera mitad sale recta del prensaestopas y la segunda cuelga; con `cable_cortado` la segunda cae y asoma un extremo rojo ---------- */
    function cable(tag, p, origen, d, abajo, largo) {
      const mitad = largo / 2, mat = kit.mat('negro');
      const a = kit.malla(kit.cil(0.32, mitad, 6), mat, p, tag, mas(origen, d, mitad / 2));
      a.quaternion.setFromUnitVectors(EJE_Y, V3(d).normalize());
      const fin = mas(origen, d, mitad);
      const dirB = V3(d).multiplyScalar(0.55).add(V3(abajo).multiplyScalar(0.83)).normalize();
      const qB = new THREE.Quaternion().setFromUnitVectors(EJE_Y, dirB);
      const piv = new THREE.Group(); piv.position.set(fin[0], fin[1], fin[2]); piv.quaternion.copy(qB); p.add(piv);
      kit.malla(kit.cil(0.32, mitad, 6), mat, piv, tag, [0, mitad / 2, 0]);
      const punta = kit.malla(kit.esfera(0.7, 6), kit.matLed(0xff3b30), p, tag, fin); punta.visible = false;
      let eje = new THREE.Vector3().crossVectors(dirB, V3(abajo)); if (eje.lengthSq() < 1e-6) eje = new THREE.Vector3(1, 0, 0); eje.normalize();
      const qCorte = new THREE.Quaternion().setFromAxisAngle(eje, 0.55).multiply(qB);
      base.alCambiarEfectos(tag, ef => {
        const cortado = ef.has('cable_cortado');
        piv.quaternion.copy(cortado ? qCorte : qB);
        piv.position.set(fin[0] + (cortado ? abajo[0] * 2.2 : 0), fin[1] + (cortado ? abajo[1] * 2.2 : 0), fin[2] + (cortado ? abajo[2] * 2.2 : 0));
        punta.visible = cortado;
      });
    }

    /* ======================= Pt100 con cabezal y transmisor 4-20 mA (TT) =======================
       Sanitarias (leche): tramo en T con férula y abrazadera tri-clamp. TT-201 (agua caliente): racor roscado con tuerca hexagonal.
       Arriba: cuello, tuerca de unión, cabezal de conexión azul con tapa roscada, prensaestopas y chapa de tag colgada con alambre. */
    function sondaTemperatura(tag) {
      const { g, c } = nuevoMontaje(tag), e = kit.ensamble(), clamp = TIPO[tag] === 'pt100_clamp';
      cilindro(e, [0, 2.4, 0], Y, 1.9, 4.8, 'inox', 12);                                           // tramo en T soldado al tubo
      if (clamp) { triclamp(e, [0, 5.0, 0], Y, 2.9, X); cilindro(e, [0, 7.3, 0], Y, 1.05, 4.0, 'inox', 10); }
      else { hexagono(e, [0, 5.6, 0], Y, 2.0, 1.4); cilindro(e, [0, 7.7, 0], Y, 1.05, 3.6, 'inox', 10); e.add(kit.cil(1.3, 2.2, 10), 'laton', [0, 4.8, 0]); }   // racor roscado de latón
      hexagono(e, [0, 9.4, 0], Y, 1.55, 1.0);                                                       // tuerca de unión del cuello
      cilindro(e, [0, 11.3, 0], Y, 2.7, 3.0, 'azul', 16);                                           // cabezal de conexión
      cilindro(e, [0, 13.2, 0], Y, 2.8, 0.4, 'oscuro', 16);                                         // junta de la tapa
      cilindro(e, [0, 14.0, 0], Y, 2.45, 1.2, 'azul', 16);                                          // tapa roscada
      e.add(kit.cono(2.2, 1.1, 0.7, 14), 'azul', [0, 14.95, 0]);
      cilindro(e, [-3.0, 11.3, 0], X, 0.75, 0.7, 'laton', 8);                                       // tapón ciego de la otra entrada
      const salida = prensa(e, [2.7, 11.3, 0], X);
      e.add(kit.toro(1.3, 0.1, PI * 2, 10), 'inoxMate', [0, 8.4, 0], [PI / 2, 0, 0]);               // alambre del tag
      cilindro(e, [0, 8.0, 1.4], Z, 0.09, 0.7, 'inoxMate', 5);
      e.construir(c, tag);
      placa(tag, c, [0, 7.4, 1.78], [0, 0, 0]);
      enlazarLed(tag, ledEn(tag, c, [0, 15.25, 0]));
      cable(tag, c, salida, X, [0, -1, 0], 14);
      registrar(tag, g, [9, 17, 8], g.position.y + 24, [2.5, 8, 0]);
    }
    for (const tag of ['TT-101', 'TT-102', 'TT-103', 'TT-104', 'TT-201', 'TT-106']) sondaTemperatura(tag);

    /* ======================= TSH-201 termostato de seguridad de bulbo (contacto NC) =======================
       Caja con tapa gris oscura, botón rojo de rearme manual, dial de consigna, prensaestopas abajo y racor con tuerca en la pared del calentador. */
    (function () {
      const tag = 'TSH-201', { g, c } = nuevoMontaje(tag), e = kit.ensamble();
      hexagono(e, [0, 0.9, 0], Y, 2.1, 1.2); cilindro(e, [0, 2.9, 0], Y, 1.1, 3.0, 'inox', 10);       // racor con tuerca y vaina del bulbo
      e.add(kit.caja(6.8, 4.6, 8.6), 'gris', [0, 6.5, 0]);                                           // caja
      e.add(kit.caja(6.0, 0.6, 7.8), 'oscuro', [0, 9.1, 0]);                                         // tapa frontal
      cilindro(e, [0, 9.9, -2.0], Y, 1.3, 1.0, 'rojo', 14);                                          // botón de rearme manual
      cilindro(e, [0, 9.7, 1.1], Y, 1.5, 0.7, 'grisOscuro', 16); e.add(kit.caja(0.3, 0.3, 1.4), 'blanco', [0, 10.1, 0.5]);   // dial de consigna con su aguja
      tornillos(e, [0, 9.5, 0], Y, 2.8, 3.4);
      const salida = prensa(e, [0, 6.5, 4.3], Z);
      e.construir(c, tag);
      placa(tag, c, [0, 9.45, 3.0], [-PI / 2, 0, 0], 4.2, 1.0);
      const led = ledEn(tag, c, [2.4, 9.55, -3.3], 0.5);
      cable(tag, c, salida, Z, Z, 14);
      let rojo = false, ultimo = -1;
      base.alCambiarEfectos(tag, ef => { rojo = ef.has('resaltar_rojo'); ultimo = -1; });
      base.alActualizar(estado => {
        const disparado = !!K.equipoDe(estado, tag).disparado || K.instrumentoDe(estado, tag).nivel === 0 || rojo;
        const hex = disparado ? 0xff3b30 : 0x35e06b;
        if (hex !== ultimo) { led.color.setHex(hex); ultimo = hex; }
      });
      registrar(tag, g, [8, 10, 10], g.position.y + 14, [0, 5, 4]);
    })();

    /* ======================= FT-101 caudalímetro electromagnético =======================
       Tubo de medida con tri-clamp en los extremos, cuerpo del sensor con las bobinas, cuello y convertidor blanco con pantalla, teclas y prensaestopas. */
    (function () {
      const tag = 'FT-101', { g, c } = nuevoMontaje(tag), e = kit.ensamble();
      cilindro(e, [0, 0, 0], X, 1.9, 18, 'inox', 14);                                                // tubo de medida
      for (const s of [-1, 1]) { triclamp(e, [s * 8.6, 0, 0], X, 3.0, Z); cilindro(e, [s * 4.3, 0, 0], X, 4.3, 0.6, 'inoxMate', 18); }
      cilindro(e, [0, 0, 0], X, 3.9, 8, 'inox', 18);                                                 // cuerpo del sensor (bobinas y electrodos)
      cilindro(e, [0, 5.0, 0], Y, 2.1, 4.2, 'inoxMate', 12);                                         // cuello
      e.add(kit.caja(9.6, 7.0, 6.4), 'blanco', [0, 10.1, 0]);                                        // convertidor
      e.add(kit.caja(10.0, 0.5, 6.8), 'inoxMate', [0, 13.8, 0]);                                     // visera
      e.add(kit.caja(8.2, 5.6, 0.5), 'oscuro', [0, 10.3, 3.4]);                                      // tapa con ventana
      for (const dx of [-1.6, 0, 1.6]) e.add(kit.caja(0.9, 0.9, 0.25), 'grisOscuro', [dx, 9.3, 3.75]);   // teclas táctiles
      cilindro(e, [-5.1, 10.1, 0], X, 1.0, 0.6, 'laton', 8);
      const salida = prensa(e, [4.8, 10.1, 0], X);
      e.construir(c, tag);
      const pantalla = kit.matLed(0x2d6b3a); kit.malla(kit.caja(5.8, 2.6, 0.3), pantalla, c, tag, [0, 11.6, 3.7]);
      placa(tag, c, [0, 8.0, 3.72], [0, 0, 0], 4.2, 1.0);
      const led = ledEn(tag, c, [3.5, 11.6, 3.75], 0.4);
      cable(tag, c, salida, X, [0, -1, 0], 14);
      enlazarLed(tag, led);
      let ultimoP = -1;
      base.alActualizar(estado => {
        const hex = K.caudalLh(estado) > 0 ? 0x3ddc84 : 0x2d6b3a;
        if (hex !== ultimoP) { pantalla.color.setHex(hex); ultimoP = hex; }
      });
      registrar(tag, g, [24, 15, 10], g.position.y + 20, [2, 5, 0]);
    })();

    /* ======================= PT-101 y PT-102 transmisores de presión (+ manómetro) =======================
       Conexión sanitaria tri-clamp, cuerpo de acero inoxidable con anillo azul, conector M12 acodado y cable. Al lado, un manómetro de esfera con aguja
       que marca de verdad la presión de la planta (0-6 bar). */
    function presion(tag) {
      const { g, c } = nuevoMontaje(tag), e = kit.ensamble();
      cilindro(e, [0, 2.1, 0], Y, 1.9, 4.2, 'inox', 12); triclamp(e, [0, 4.4, 0], Y, 2.9, Z);
      cilindro(e, [0, 6.1, 0], Y, 2.0, 2.6, 'inox', 12); hexagono(e, [0, 8.0, 0], Y, 2.1, 1.2);
      cilindro(e, [0, 11.5, 0], Y, 1.7, 5.8, 'inox', 16); cilindro(e, [0, 13.4, 0], Y, 1.76, 0.6, 'azul', 16);
      cilindro(e, [0, 14.85, 0], Y, 1.3, 0.9, 'negro', 12); cilindro(e, [0, 15.9, 0], Y, 1.0, 1.4, 'laton', 8);                // conector M12 (cabeza y tuerca moleteada)
      cilindro(e, [0, 17.3, 0], Y, 0.85, 1.6, 'negro', 8); cilindro(e, [0.8, 17.3, 0], X, 0.75, 1.6, 'negro', 8);              // codo del conector
      // Manómetro a 9 cm sobre su propia toma: racor, vástago de latón, caja de acero y bisel.
      cilindro(e, [9, 1.7, 0], Y, 1.9, 3.4, 'inox', 12); hexagono(e, [9, 4.0, 0], Y, 1.4, 1.0, 'laton'); cilindro(e, [9, 5.7, 0], Y, 0.8, 2.4, 'laton', 8);
      cilindro(e, [9, 9.9, 0], Z, 3.3, 2.4, 'inox', 20); e.add(kit.toro(3.2, 0.3, PI * 2, 20), 'inoxMate', [9, 9.9, 1.2]);
      e.construir(c, tag);
      const rango = (((LAYOUT.senal ? LAYOUT.senal(tag) : []).find(s => s.tipo === 'AI') || {}).rango) || [0, 6], maxP = rango[1] || 6;
      // esfera del manómetro con sus números (0 abajo a la izquierda, 270° en sentido horario hasta el máximo)
      let tx = null;
      if (typeof document !== 'undefined') {
        const lz = document.createElement('canvas'); lz.width = 128; lz.height = 128;
        const cx = lz.getContext('2d');
        if (cx) {
          cx.fillStyle = '#f4f4ee'; cx.beginPath(); cx.arc(64, 64, 62, 0, PI * 2); cx.fill();
          cx.fillStyle = '#1b2127'; cx.strokeStyle = '#1b2127'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.font = '700 16px system-ui, sans-serif';
          const paso = maxP <= 6 ? 1 : maxP / 6;
          for (let i = 0; i * paso <= maxP + 1e-9; i++) {
            const f = i * paso / maxP, a = (-135 + 270 * f) * PI / 180, s = Math.sin(a), co = Math.cos(a);
            cx.lineWidth = 3; cx.beginPath(); cx.moveTo(64 + 50 * s, 64 - 50 * co); cx.lineTo(64 + 58 * s, 64 - 58 * co); cx.stroke();
            cx.fillText(String(Math.round(i * paso * 10) / 10), 64 + 36 * s, 64 - 36 * co);
          }
          cx.font = '700 13px system-ui, sans-serif'; cx.fillText('bar', 64, 100);
          tx = new THREE.CanvasTexture(lz); tx.colorSpace = THREE.SRGBColorSpace; kit.registrar(tx);
        }
      }
      kit.malla(new THREE.CircleGeometry(2.95, 24), tx ? kit.matDinamico(0xffffff, { map: tx }) : kit.mat('blanco'), c, tag, [9, 9.9, 1.23]);
      const aguja = new THREE.Group(); aguja.position.set(9, 9.9, 1.32); c.add(aguja);
      kit.malla(kit.caja(0.2, 2.5, 0.06), kit.mat('rojo'), aguja, tag, [0, 0.9, 0]);
      kit.malla(kit.cil(0.35, 0.12, 8), kit.mat('negro'), aguja, tag, [0, 0, 0.02], [PI / 2, 0, 0]);
      placa(tag, c, [-0.0, 11.4, 1.9], [0, 0, 0], 2.2, 0.9);
      enlazarLed(tag, ledEn(tag, c, [0, 18.4, 0], 0.5));
      cable(tag, c, [1.6, 17.3, 0], X, [0, -1, 0], 14);
      base.alActualizar(estado => {
        const i = K.instrumentoDe(estado, tag), v = K.num(i.valorProceso, K.num(i.valorPLC, 0));
        aguja.rotation.z = (135 - 270 * K.limitar(v / maxP, 0, 1)) * PI / 180;
      });
      registrar(tag, g, [20, 19, 8], g.position.y + 24, [4.5, 9.5, 0]);
    }
    presion('PT-101'); presion('PT-102');

    /* ======================= LT-101 transmisor de nivel hidrostático (membrana a ras) =======================
       Pegado a la pared baja del tanque con tri-clamp: la membrana toca la leche y mide la presión de la columna. Cabezal de acero con tapa, display y LED. */
    (function () {
      const tag = 'LT-101', { g, c } = nuevoMontaje(tag), e = kit.ensamble();
      cilindro(e, [0, 0.4, 0], Y, 2.2, 2.4, 'inox', 14);                                             // férula soldada a la pared
      cilindro(e, [0, -0.9, 0], Y, 1.7, 0.5, 'oscuro', 14);                                          // membrana a ras con la pared interior
      triclamp(e, [0, 2.0, 0], Y, 2.8, Z);
      hexagono(e, [0, 3.4, 0], Y, 2.7, 1.1); cilindro(e, [0, 6.2, 0], Y, 2.45, 4.5, 'inox', 16);       // cuerpo del sensor
      cilindro(e, [0, 11.2, 0], Y, 3.1, 5.5, 'inox', 18);                                            // cabezal
      cilindro(e, [0, 14.2, 0], Y, 3.3, 1.0, 'inoxMate', 18);                                        // anillo de la tapa roscada
      cilindro(e, [0, 15.0, 0], Y, 2.6, 0.5, 'oscuro', 18);                                          // vidrio de la tapa
      const salida = prensa(e, [0, 11.2, 3.1], Z);
      e.construir(c, tag);
      kit.malla(kit.caja(3.6, 0.2, 1.6), kit.matLed(0x2d6b3a), c, tag, [0, 15.35, 0.3]);           // pantalla
      const led = ledEn(tag, c, [0, 15.4, -1.7], 0.4);
      placa(tag, c, [0, 11.2, -3.12], [PI, 0, 0], 3.2, 1.0);
      enlazarLed(tag, led);
      cable(tag, c, salida, Z, Z, 14);
      registrar(tag, g, [7, 12, 18], g.position.y + 10, [0, 6, 8]);
    })();

    /* ======================= Interruptores de nivel del tanque (sanitarios, M12) =======================
       LSH-101: horquilla vibrante (las dos púas vibran; dentro del líquido cambia la frecuencia). LSL-101: sonda capacitiva con funda blanca. Ambos con
       férula y abrazadera tri-clamp, cabezal de plástico IP65 y conector M12 abajo. Las púas y la sonda entran en el tanque (se ven en el modo transparente). */
    function interruptorTanque(tag) {
      const { g, c } = nuevoMontaje(tag), e = kit.ensamble(), horquilla = TIPO[tag] === 'horquilla_vibrante';
      cilindro(e, [0, 0.5, 0], Y, 2.0, 2.4, 'inox', 14); triclamp(e, [0, 2.1, 0], Y, 2.7, Z);
      if (horquilla) {
        cilindro(e, [0, -2.5, 0], Y, 0.7, 5.5, 'inox', 8);                                           // tubo de extensión
        for (const s of [-1, 1]) e.add(kit.caja(0.4, 5.2, 1.8), 'inox', [s * 0.9, -7.1, 0]);       // las dos púas de la horquilla
        e.add(kit.caja(2.2, 0.5, 1.8), 'inox', [0, -4.6, 0]);
      } else {
        cilindro(e, [0, -4.3, 0], Y, 0.45, 8.6, 'inoxMate', 8);                                      // varilla de la sonda
        cilindro(e, [0, -6.0, 0], Y, 0.75, 4.8, 'blanco', 8);                                        // funda aislante de PTFE
        e.add(kit.esfera(0.75, 8), 'blanco', [0, -8.5, 0]);
      }
      cilindro(e, [0, 3.6, 0], Y, 1.7, 2.0, 'inox', 12);                                             // cuello
      cilindro(e, [0, 8.0, 0], Y, 2.3, 6.4, 'oscuro', 18);                                           // cabezal de plástico IP65
      cilindro(e, [0, 11.5, 0], Y, 2.45, 0.8, horquilla ? 'rojo' : 'amarillo', 18);                  // tapa (roja: alto; amarilla: bajo)
      cilindro(e, [0, 9.0, 2.3], Z, 0.95, 1.4, 'laton', 8); cilindro(e, [0, 9.0, 3.5], Z, 0.7, 1.2, 'negro', 8);   // conector M12 con su tuerca
      e.construir(c, tag);
      enlazarLedFlotador(tag, ledEn(tag, c, [0, 9.8, -2.3], 0.45));
      placa(tag, c, [0, 6.4, -2.31], [PI, 0, 0], 2.6, 0.9);
      registrar(tag, g, [6, 13, 14], g.position.y + 12, [0, 5, 4]);
    }
    // LED de un interruptor de nivel: color de la calidad del lazo y gris si no hay nivel (contacto sin accionar).
    function enlazarLedFlotador(tag, led) {
      let apagado = false, ultimo = -1;
      base.alCambiarEfectos(tag, ef => { apagado = ef.has('led_apagado'); ultimo = -1; });
      base.alActualizar(estado => {
        const i = K.instrumentoDe(estado, tag), calidad = K.colorLedCalidad(i.calidad);
        const hex = apagado ? 0x333333 : (calidad === 0x35e06b && i.nivel === 0 ? 0x888888 : calidad);
        if (hex !== ultimo) { led.color.setHex(hex); ultimo = hex; }
      });
    }
    interruptorTanque('LSH-101'); interruptorTanque('LSL-101');

    /* ======================= Flotadores del depósito de agua caliente (LSL-201 bajo, LSH-201 alto) =======================
       Rosca de latón con tuerca hexagonal en la pared, caja de conexión negra con tapa y cuatro tornillos, prensaestopas y, dentro, vástago articulado con
       bola (nivel bajo) o disco (nivel alto) que sube con el agua (contacto cerrado) y cae sin ella. */
    function flotador(tag) {
      const { g, c } = nuevoMontaje(tag), e = kit.ensamble(), bola = TIPO[tag] === 'flotador_bola';
      cilindro(e, [0, -0.3, 0], Y, 1.3, 3.2, 'laton', 10);                                           // rosca
      hexagono(e, [0, 0.8, 0], Y, 2.2, 1.0);                                                         // tuerca contra la pared
      cilindro(e, [0, 2.6, 0], Y, 1.4, 2.6, 'inoxMate', 10);
      cilindro(e, [0, 2.8, 0], Y, 1.55, 0.5, bola ? 'rojo' : 'azul', 12);                            // anillo de color: rojo = bajo, azul = alto
      e.add(kit.caja(5.6, 3.0, 5.6), 'negro', [0, 5.6, 0]);                                          // caja de conexión
      e.add(kit.caja(5.2, 1.0, 5.2), 'gris', [0, 7.6, 0]);                                           // tapa
      tornillos(e, [0, 8.2, 0], Y, 2.0, 2.0);
      e.add(kit.caja(1.6, 1.0, 1.6), 'inoxMate', [0, -2.1, 0]); cilindro(e, [0, -2.1, 0], X, 0.45, 2.6, 'inoxMate', 6);   // soporte y eje de giro
      const salida = prensa(e, [0, 5.6, 2.8], Z);
      e.construir(c, tag);
      // vástago con su flotador: gira alrededor del eje x en y = -2,1 (arriba = + ángulo)
      const brazo = new THREE.Group(); brazo.position.set(0, -2.1, 0); c.add(brazo);
      kit.malla(kit.cil(0.35, 7.0, 8), kit.mat('inoxMate'), brazo, tag, [0, -3.7, 0]);
      kit.malla(bola ? kit.esfera(2.4, 12) : kit.cil(2.6, 1.0, 16), kit.mat(bola ? 'inox' : 'inoxMate'), brazo, tag, [0, -8.0, 0]);
      placa(tag, c, [0, 8.14, 0.9], [-PI / 2, 0, 0], 3.2, 1.2);
      const led = ledEn(tag, c, [0, 8.2, -1.6], 0.5);
      cable(tag, c, salida, Z, Z, 14);
      let ultimo = null;
      if (bola) {
        // LSL-201 (NC): contacto cerrado = hay agua; abierto = nivel bajo o hilo roto
        enlazarLed(tag, led);
        base.alActualizar(estado => {
          const contacto = K.contactoLSL(estado, tag);
          if (contacto === ultimo) return;
          ultimo = contacto;
          brazo.rotation.x = contacto === 'abierto' ? -0.8 : 0.3;
          led.color.setHex(contacto === 'abierto' ? 0xff3b30 : K.colorLedCalidad(K.instrumentoDe(estado, tag).calidad));
        });
      } else {
        // LSH-201: nivel = 1 cuando el agua llega al 90 %
        enlazarLedFlotador(tag, led);
        base.alActualizar(estado => {
          const alto = K.instrumentoDe(estado, tag).nivel === 1;
          if (alto === ultimo) return;
          ultimo = alto; brazo.rotation.x = alto ? 0.3 : -0.8;
        });
      }
      registrar(tag, g, [6, 12, 17], g.position.y + 13, [0, 3, 3]);
    }
    flotador('LSL-201'); flotador('LSH-201');

    /* ======================= ZS-101 y ZS-102 finales de carrera de la FDV =======================
       Carcasa de aluminio con cabeza giratoria, palanca con rodillo de nylon, entrada de cable abajo y ménsula atornillada al yugo de la válvula.
       Con la posición alcanzada la palanca está pulsada y el LED se pone verde. */
    function finalDeCarrera(tag, hacia) {
      const { g, c } = nuevoMontaje(tag), e = kit.ensamble();
      e.add(kit.caja(4.0, 6.0, 3.4), 'gris', [0, 0, 0]);                                             // carcasa
      e.add(kit.caja(3.4, 1.8, 3.0), 'oscuro', [0, 3.9, 0]);                                         // cabeza
      cilindro(e, [0, 5.2, 0], Y, 0.4, 1.0, 'inoxMate', 8);                                          // eje de la palanca
      e.add(kit.caja(3.4, 4.6, 0.3), 'grisOscuro', [0, -0.2, 1.7]);                                  // tapa frontal
      for (const sy of [-1, 1]) cilindro(e, [-1.3, sy * 1.8 - 0.2, 1.9], Z, 0.3, 0.3, 'inoxMate', 6);
      cilindro(e, [0, -3.8, 0], Y, 0.9, 1.6, 'laton', 10);                                           // entrada de cable
      e.add(kit.caja(6.4, 0.5, 4.0), 'inoxMate', [hacia * 1.2, -3.35, 0]);                           // ménsula
      e.add(kit.caja(0.5, 9.0, 4.0), 'inoxMate', [hacia * 4.2, 0.2, 0]);                             // escuadra al yugo de la válvula
      e.construir(c, tag);
      const palanca = new THREE.Group(); palanca.position.set(0, 5.7, 0); c.add(palanca);
      kit.malla(kit.caja(4.6, 0.5, 0.7), kit.mat('inoxMate'), palanca, tag, [hacia * 2.3, 0, 0]);
      kit.malla(kit.cil(1.1, 0.9, 14), kit.mat('negro'), palanca, tag, [hacia * 4.6, 0, 0], [PI / 2, 0, 0]);     // rodillo
      kit.malla(kit.cil(0.4, 1.1, 8), kit.mat('inox'), palanca, tag, [hacia * 4.6, 0, 0], [PI / 2, 0, 0]);
      placa(tag, c, [0, -0.6, 1.95], [0, 0, 0], 3.0, 1.0);
      const led = ledEn(tag, c, [0, 3.9, 1.6], 0.4);
      cable(tag, c, [0, -4.6, 0], [0, -1, 0], [0, -1, 0], 14);
      let ultimo = -1;
      base.alActualizar(estado => {
        const nivel = K.instrumentoDe(estado, tag).nivel, activo = nivel === 1 || nivel === true;
        const hex = activo ? 0x35e06b : 0x888888;
        if (hex !== ultimo) { led.color.setHex(hex); ultimo = hex; palanca.rotation.y = activo ? -hacia * 0.5 : 0; }
      });
      registrar(tag, g, [10, 10, 5], g.position.y + 12, [hacia * 2, 0, 0]);
    }
    finalDeCarrera('ZS-101', -1); finalDeCarrera('ZS-102', 1);

    /* ======================= PSL-501 presostato de aire comprimido =======================
       Carcasa de plástico con tapa, tornillo de ajuste del punto de disparo arriba, racor G1/4 de latón abajo y prensaestopas lateral. */
    (function () {
      const tag = 'PSL-501', { g, c } = nuevoMontaje(tag), e = kit.ensamble();
      e.add(kit.caja(5.4, 7.0, 4.0), 'grisOscuro', [0, 3.5, 0]);                                     // carcasa
      e.add(kit.caja(5.0, 3.8, 0.4), 'gris', [0, 4.6, 2.2]);                                         // tapa con la placa
      cilindro(e, [0, 7.6, 0], Y, 0.8, 1.2, 'inoxMate', 10); e.add(kit.caja(1.2, 0.25, 0.25), 'negro', [0, 8.25, 0]);   // tornillo de ajuste con su ranura
      cilindro(e, [0, 7.3, 0], Y, 1.3, 0.5, 'inoxMate', 12);
      hexagono(e, [0, -0.6, 0], Y, 1.6, 1.2, 'laton'); cilindro(e, [0, -3.4, 0], Y, 0.9, 4.4, 'laton', 10);   // racor y niple de latón
      cilindro(e, [0, -5.9, 0], X, 1.0, 3.2, 'laton', 8);                                            // te de latón sobre el pie
      cilindro(e, [0, -11.9, 0], Y, 0.9, 12.2, 'inox', 10); e.add(kit.caja(5, 0.5, 5), 'inoxMate', [0, -17.75, 0]);   // pie de tubo atornillado a la bancada
      tornillos(e, [0, -17.4, 0], Y, 1.8, 1.8);
      const salida = prensa(e, [2.7, 4.5, 0], X);
      e.construir(c, tag);
      placa(tag, c, [0, 2.2, 2.45], [0, 0, 0], 3.4, 1.0);
      const led = ledEn(tag, c, [-1.7, 5.6, 2.45], 0.5);
      cable(tag, c, salida, X, [0, -1, 0], 12);
      let rojo = false, ultimo = -1;
      base.alCambiarEfectos(tag, ef => { rojo = ef.has('manometro_rojo') || ef.has('resaltar_rojo'); ultimo = -1; });
      base.alActualizar(estado => {
        const bajo = K.instrumentoDe(estado, tag).nivel === 0 || rojo;
        const hex = bajo ? 0xff3b30 : 0x35e06b;
        if (hex !== ultimo) { led.color.setHex(hex); ultimo = hex; }
      });
      registrar(tag, g, [8, 12, 6], g.position.y + 10, [1, 2, 0]);
    })();

    return { grupo: base.grupo, elementos: base.elementos, actualizar: base.actualizar, liberar: kit.liberar, TAGS };
  }

  const api = { crear, TAGS, TIPO, montaje, giro, nivelDeMontaje };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstInstrumentos3d = api; }
})();
