// Instrumentación de la planta HTST en 3D (DISEÑADOR): sondas Pt100 con cabezal y transmisor 4-20 mA, termostato de seguridad, caudalímetro
// electromagnético, transmisores de presión y de nivel, flotadores, finales de carrera de la FDV y presostato de aire. Cada uno con un LED de
// estado del lazo (verde OK, ámbar ruido o deriva, rojo lazo abierto o en corto) y los efectos de avería (cable cortado, LED apagado).
(function () {
  const K = typeof require !== 'undefined' ? require('./kit.js') : PCT.htstKit;
  const B = typeof require !== 'undefined' ? require('./base_equipo.js') : PCT.htstBase;
  const T = typeof require !== 'undefined' ? require('./tuberias.js') : PCT.htstTuberias;
  const PI = Math.PI;
  const TAGS = ['TT-101', 'TT-102', 'TT-103', 'TT-104', 'TT-105', 'TSH-101', 'FT-101', 'PT-101', 'PT-102', 'LT-101', 'LSH-101', 'LSL-101', 'LSL-301', 'ZS-101', 'ZS-102', 'PSL-201'];

  // Sitio de montaje de cada instrumento (cm, coordenadas del patín): sobre su tubo (punto medio del tramo horizontal más largo), o sobre un equipo.
  // Los de nivel van en la pared del tanque TK-101 (centro (-135, -35), radio 33): z = -35 + √(33² − dx²).
  const MONTAJE_RUTA = { 'TT-101': 'LECHE_CRUDA_1', 'TT-103': 'LECHE_TRAS_TUBO', 'TT-104': 'LECHE_SALIDA', 'TT-105': 'AGUA_CALIENTE_2', 'PT-101': 'LECHE_CRUDA_5', 'PT-102': 'LECHE_AVANCE' };
  const pared = (dx, y) => [-135 + dx, y, -35 + Math.sqrt(33 * 33 - dx * dx)];
  const MONTAJE_FIJO = {
    'TT-102': [-12, 72, -10],                      // en la parte alta del intercambiador, entre los paquetes de regeneración y calentamiento
    'FT-101': [-68, 25, 35],                       // en línea entre la bomba P-101 y la P-103
    'TSH-101': [28, 42, 62.5],                     // en la pared frontal del calentador
    'LT-101': pared(10, 26), 'LSH-101': pared(-15, 70), 'LSL-101': pared(-15, 32),
    'LSL-301': [6, 18, 54.6],                      // flotador de nivel bajo en la pared del calentador HW-101 (centro (20, 45), radio 17), por debajo del visor frontal
    'ZS-101': [127, 26, -5], 'ZS-102': [111, 26, -5], 'PSL-201': [135, 18, 10],       // los finales de carrera, en el yugo de la FDV
  };
  /** Posición de montaje de un instrumento (función pura, sin THREE). */
  function montaje(tag) {
    if (MONTAJE_RUTA[tag]) return T.puntoSobreRuta(MONTAJE_RUTA[tag]);
    return MONTAJE_FIJO[tag] || null;
  }

  function crear(THREE) {
    const kit = K.crearKit(THREE);
    const base = B.crearBase(kit);
    const grupoEn = (tag) => { const m = montaje(tag), g = new THREE.Group(); g.position.set(m[0], m[1], m[2]); base.grupo.add(g); return g; };

    // LED de lazo de un instrumento: color según `calidad`; con el efecto led_apagado se apaga. Devuelve la función de actualización.
    function enlazarLed(tag, matLed) {
      let apagado = false, ultimo = -1;
      base.alCambiarEfectos(tag, ef => { apagado = ef.has('led_apagado'); ultimo = -1; });
      base.alActualizar(estado => {
        const hex = apagado ? 0x333333 : K.colorLedCalidad(K.instrumentoDe(estado, tag).calidad);
        if (hex !== ultimo) { matLed.color.setHex(hex); ultimo = hex; }
      });
    }
    // Cable del instrumento: dos mitades; con `cable_cortado` la segunda se separa y asoma un extremo rojo.
    function cable(tag, g, y, largo) {
      const mitad = largo / 2, mat = kit.mat('negro');
      const a = kit.malla(kit.cil(0.35, mitad, 6), mat, g, tag, [3 + mitad / 2, y, 0], [0, 0, PI / 2]);
      const b = kit.malla(kit.cil(0.35, mitad, 6), mat, g, tag, [3 + mitad * 1.5, y, 0], [0, 0, PI / 2]);
      const punta = kit.malla(kit.esfera(0.7, 6), kit.matLed(0xff3b30), g, tag, [3 + mitad, y, 0]); punta.visible = false;
      base.alCambiarEfectos(tag, ef => {
        const cortado = ef.has('cable_cortado');
        b.position.set(3 + mitad * 1.5 + (cortado ? 2.2 : 0), y - (cortado ? 1.2 : 0), 0); b.rotation.z = PI / 2 + (cortado ? 0.35 : 0); punta.visible = cortado;
      });
    }

    /* ---------- Pt100 con cabezal y transmisor 4-20 mA (TT-101..105) ---------- */
    function sondaTemperatura(tag) {
      const g = grupoEn(tag), e = kit.ensamble();
      e.add(kit.cil(2.3, 6, 10), 'inox', [0, 3.5, 0]); e.add(kit.toro(2.9, 0.5, PI * 2, 10), 'inoxMate', [0, 6.8, 0], [PI / 2, 0, 0]);   // Té con abrazadera
      e.add(kit.cil(0.9, 9, 8), 'inox', [0, 11, 0]);                                          // vaina termométrica
      e.add(kit.cil(2.4, 4, 12), 'azul', [0, 17, 0]);                                         // cabezal de conexión
      e.add(kit.cil(2.1, 3, 12), 'gris', [0, 20.5, 0]);                                       // transmisor de cabeza (4-20 mA)
      e.construir(g, tag);
      const led = kit.matLed(0x35e06b); kit.malla(kit.esfera(0.7, 6), led, g, tag, [0, 22.4, 0]);
      cable(tag, g, 17, 16);
      enlazarLed(tag, led);
      base.registrar(tag, g, [8, 24, 8], g.position.y + 30);
    }
    for (const tag of ['TT-101', 'TT-102', 'TT-103', 'TT-104', 'TT-105']) sondaTemperatura(tag);

    /* ---------- TSH-101 termostato de seguridad (contacto NC) ---------- */
    (function () {
      const tag = 'TSH-101', g = grupoEn(tag), e = kit.ensamble();
      e.add(kit.caja(7, 9, 5), 'gris', [0, 0, -2]); e.add(kit.cil(1.2, 3, 8), 'inoxMate', [0, -4.5, -5], [PI / 2, 0, 0]); e.add(kit.cil(0.4, 12, 6), 'inoxMate', [0, -6, -9], [PI / 2, 0, 0]);
      e.construir(g, tag);
      const reset = kit.matDinamico(0xc0392b); kit.malla(kit.cil(1.4, 1.5, 10), reset, g, tag, [0, 1.5, 1], [PI / 2, 0, 0]);
      const led = kit.matLed(0x35e06b); kit.malla(kit.esfera(0.7, 6), led, g, tag, [0, 3.5, 0.6]);
      let rojo = false, ultimo = -1;
      base.alCambiarEfectos(tag, ef => { rojo = ef.has('resaltar_rojo'); ultimo = -1; });
      base.alActualizar(estado => {
        const disparado = !!K.equipoDe(estado, tag).disparado || K.instrumentoDe(estado, tag).nivel === 0 || rojo;
        const hex = disparado ? 0xff3b30 : 0x35e06b;
        if (hex !== ultimo) { led.color.setHex(hex); ultimo = hex; }
      });
      base.registrar(tag, g, [9, 12, 14], g.position.y + 12);
    })();

    /* ---------- FT-101 caudalímetro electromagnético ---------- */
    (function () {
      const tag = 'FT-101', g = grupoEn(tag), e = kit.ensamble();
      e.add(kit.cil(4.4, 8, 16), 'inox', [0, 0, 0], [0, 0, PI / 2]);                         // tubo de medida con las bobinas
      e.add(kit.cil(5.4, 1.4, 16), 'inoxMate', [-4.2, 0, 0], [0, 0, PI / 2]); e.add(kit.cil(5.4, 1.4, 16), 'inoxMate', [4.2, 0, 0], [0, 0, PI / 2]);   // bridas
      e.add(kit.cil(1.6, 6, 8), 'inoxMate', [0, 6, 0]); e.add(kit.caja(9, 6, 6), 'gris', [0, 11, 0]);                                   // cuello y transmisor
      e.add(kit.cil(1.9, 9, 10), 'inox', [-8.5, 0, 0], [0, 0, PI / 2]); e.add(kit.cil(1.9, 9, 10), 'inox', [8.5, 0, 0], [0, 0, PI / 2]);
      e.construir(g, tag);
      const pantalla = kit.matLed(0x2d6b3a); kit.malla(kit.caja(5.2, 2.6, 0.4), pantalla, g, tag, [0, 11.5, 3.2]);
      const led = kit.matLed(0x35e06b); kit.malla(kit.esfera(0.6, 6), led, g, tag, [3.3, 8.8, 3.2]);
      cable(tag, g, 8, 12);
      enlazarLed(tag, led);
      let ultimoP = -1;
      base.alActualizar(estado => {
        const hex = K.caudalLh(estado) > 0 ? 0x3ddc84 : 0x2d6b3a;
        if (hex !== ultimoP) { pantalla.color.setHex(hex); ultimoP = hex; }
      });
      base.registrar(tag, g, [24, 18, 12], g.position.y + 18);
    })();

    /* ---------- PT-101 y PT-102 transmisores de presión ---------- */
    function presion(tag) {
      const g = grupoEn(tag), e = kit.ensamble();
      e.add(kit.cil(2.3, 4, 10), 'inox', [0, 3, 0]); e.add(kit.toro(2.9, 0.5, PI * 2, 10), 'inoxMate', [0, 5.2, 0], [PI / 2, 0, 0]);
      e.add(kit.cil(1.7, 9, 8), 'inoxMate', [0, 10, 0]); e.add(kit.cil(2.3, 3, 6), 'inox', [0, 12.5, 0]);   // cuerpo con tuerca hexagonal
      e.add(kit.cil(2.2, 5, 12), 'gris', [0, 16, 0]);
      e.construir(g, tag);
      const led = kit.matLed(0x35e06b); kit.malla(kit.esfera(0.6, 6), led, g, tag, [0, 18.8, 0]);
      cable(tag, g, 16, 14);
      enlazarLed(tag, led);
      base.registrar(tag, g, [8, 20, 8], g.position.y + 24);
    }
    presion('PT-101'); presion('PT-102');

    /* ---------- LT-101 transmisor de nivel y flotadores LSH-101, LSL-101 ---------- */
    (function () {
      const tag = 'LT-101', g = grupoEn(tag), e = kit.ensamble();
      e.add(kit.cil(2.4, 3, 12), 'inox', [0, 0, 1.5], [PI / 2, 0, 0]); e.add(kit.cil(1.6, 8, 10), 'inoxMate', [0, 0, 6], [PI / 2, 0, 0]); e.add(kit.caja(6, 5, 5), 'gris', [0, 0, 11]);
      e.construir(g, tag);
      const led = kit.matLed(0x35e06b); kit.malla(kit.esfera(0.6, 6), led, g, tag, [0, 2.9, 11]);
      enlazarLed(tag, led);
      base.registrar(tag, g, [8, 9, 18], g.position.y + 8);
    })();
    function flotador(tag) {
      const g = grupoEn(tag), e = kit.ensamble();
      e.add(kit.cil(2.4, 3, 12), 'inox', [0, 0, 1.5], [PI / 2, 0, 0]); e.add(kit.caja(6, 6, 7), 'oscuro', [0, 0, 6]); e.add(kit.cil(0.4, 9, 6), 'inoxMate', [0, 0, -3.5], [PI / 2, 0, 0]);
      e.construir(g, tag);
      const led = kit.matLed(0x35e06b); kit.malla(kit.esfera(0.6, 6), led, g, tag, [0, 3.4, 6]);
      let ultimo = -1;
      base.alActualizar(estado => {
        const hex = K.colorLedCalidad(K.instrumentoDe(estado, tag).calidad) === 0x35e06b && K.instrumentoDe(estado, tag).nivel === 0 ? 0x888888 : K.colorLedCalidad(K.instrumentoDe(estado, tag).calidad);
        if (hex !== ultimo) { led.color.setHex(hex); ultimo = hex; }
      });
      base.registrar(tag, g, [8, 8, 12], g.position.y + 9);
    }
    flotador('LSH-101'); flotador('LSL-101');

    /* ---------- LSL-301 flotador de nivel bajo del agua caliente (NC): contacto cerrado = hay agua; abierto = nivel bajo o hilo roto ---------- */
    (function () {
      const tag = 'LSL-301', g = grupoEn(tag), e = kit.ensamble();
      e.add(kit.cil(2.4, 3, 12), 'inox', [0, 0, 1.5], [PI / 2, 0, 0]); e.add(kit.caja(6, 6, 7), 'oscuro', [0, 0, 6]); e.add(kit.cil(0.4, 9, 6), 'inoxMate', [0, 0, -3.5], [PI / 2, 0, 0]);
      e.construir(g, tag);
      const led = kit.matLed(0x35e06b); kit.malla(kit.esfera(0.7, 6), led, g, tag, [0, 3.6, 6]);
      const brazo = kit.malla(kit.cil(0.35, 5, 6), kit.mat('inoxMate'), g, tag, [0, -3, 8.5], [PI / 2, 0, 0]);     // brazo del flotador: horizontal con agua, caído sin ella
      enlazarLed(tag, led);
      let ultimo = null;
      base.alActualizar(estado => {
        const contacto = K.contactoLSL(estado, tag);
        if (contacto === ultimo) return;
        ultimo = contacto;
        brazo.rotation.x = contacto === 'abierto' ? PI / 2 + 0.9 : PI / 2;
        led.color.setHex(contacto === 'abierto' ? 0xff3b30 : K.colorLedCalidad(K.instrumentoDe(estado, tag).calidad));
      });
      base.registrar(tag, g, [8, 12, 14], g.position.y + 9);
    })();

    /* ---------- ZS-101 y ZS-102 finales de carrera de la FDV, PSL-201 presostato ---------- */
    function interruptor(tag, ancho, sentidoBrazo) {
      const g = grupoEn(tag), e = kit.ensamble();
      e.add(kit.caja(ancho, 4, 4), 'negro', [0, 0, 0]); e.add(kit.cil(0.5, 5, 6), 'inoxMate', [0, -3, 0]);
      if (sentidoBrazo) e.add(kit.cil(0.6, 6, 6), 'inoxMate', [sentidoBrazo * 5, 0, 0], [0, 0, PI / 2]);        // soporte hasta el yugo de la válvula
      e.construir(g, tag);
      const led = kit.matLed(0x888888); kit.malla(kit.esfera(0.6, 6), led, g, tag, [0, 2.5, 0]);
      let ultimo = -1;
      base.alActualizar(estado => {
        const activo = K.instrumentoDe(estado, tag).nivel === 1 || K.instrumentoDe(estado, tag).nivel === true;
        const hex = activo ? 0x35e06b : 0x888888;
        if (hex !== ultimo) { led.color.setHex(hex); ultimo = hex; }
      });
      base.registrar(tag, g, [ancho + 2, 7, 8], g.position.y + 9);
    }
    interruptor('ZS-101', 5, -1); interruptor('ZS-102', 5, 1);
    (function () {
      const tag = 'PSL-201', g = grupoEn(tag), e = kit.ensamble();
      e.add(kit.caja(5, 6, 4), 'gris', [0, 0, 0]); e.add(kit.cil(0.5, 6, 6), 'inoxMate', [0, -5, 0]);
      e.construir(g, tag);
      const led = kit.matLed(0x35e06b); kit.malla(kit.esfera(0.6, 6), led, g, tag, [0, 3.6, 0]);
      let rojo = false, ultimo = -1;
      base.alCambiarEfectos(tag, ef => { rojo = ef.has('manometro_rojo') || ef.has('resaltar_rojo'); ultimo = -1; });
      base.alActualizar(estado => {
        const bajo = K.instrumentoDe(estado, tag).nivel === 0 || rojo;
        const hex = bajo ? 0xff3b30 : 0x35e06b;
        if (hex !== ultimo) { led.color.setHex(hex); ultimo = hex; }
      });
      base.registrar(tag, g, [7, 9, 6], g.position.y + 10);
    })();

    return { grupo: base.grupo, elementos: base.elementos, actualizar: base.actualizar, liberar: kit.liberar, TAGS };
  }

  const api = { crear, TAGS, montaje };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstInstrumentos3d = api; }
})();
