// Armario eléctrico QE-001 en 3D (DISEÑADOR), con la puerta abierta para ver el interior: magnetotérmico, fuente de 24 V, fusible, PLC con módulos,
// variador, tres contactores (bomba de agua caliente y los dos bancos del calentador) y bornas; en la puerta, el HMI, la seta de emergencia y el pulsador; encima, la baliza. Cada pieza lleva su tag.
// LED y estados salen de `estado` (ver ARQUITECTURA.md §4); las averías mueven los LED y los contactos (led_apagado, contactos_cerrados…).
(function () {
  const K = typeof require !== 'undefined' ? require('./kit.js') : PCT.htstKit;
  const B = typeof require !== 'undefined' ? require('./base_equipo.js') : PCT.htstBase;
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.htstLayout;
  const PI = Math.PI;
  const TAGS = ['QE-001', 'PS-001', 'F-001', 'QF-201', 'VFD-101', 'KM-203', 'KM-201', 'KM-202', 'PLC-001', 'HMI-001', 'HL-001', 'ES-001', 'PB-001'];

  // Cuerpo del armario (cm): centro en la posición del layout. Dispositivos: x centro, y base, ancho, alto, fondo (sobre la placa de montaje).
  const CUERPO = { ancho: 60, fondo: 30, alto: 140, z: -13.5 };
  const DISPOSITIVOS = {
    'QF-201': { x: -22, y: 118, w: 4, h: 9, d: 6 },
    'PS-001': { x: -8, y: 114, w: 12, h: 14, d: 8 },
    'F-001': { x: 10, y: 118, w: 3, h: 10, d: 6 },
    'PLC-001': { x: 0, y: 90, w: 40, h: 18, d: 8 },
    'VFD-101': { x: -14, y: 40, w: 18, h: 38, d: 14 },
    'KM-203': { x: 3, y: 60, w: 8, h: 12, d: 8 },
    'KM-201': { x: 3, y: 42, w: 8, h: 12, d: 8 }, 'KM-202': { x: 13, y: 42, w: 8, h: 12, d: 8 },
  };
  const PUERTA = { giroRad: 1.75, bisagraX: 29 };      // puerta abierta unos 100°, con la bisagra a la derecha: la cara exterior mira a la cámara

  /** Posición mundo (cm) de un punto de la puerta abierta, dado su (x, y) en el plano de la puerta (x ≤ 0: desde la bisagra hacia el borde libre). */
  function puntoPuerta(centroX, centroZ, lx, ly) {
    return [centroX + PUERTA.bisagraX + lx * Math.cos(PUERTA.giroRad), ly, centroZ + CUERPO.fondo / 2 - lx * Math.sin(PUERTA.giroRad)];
  }

  function crear(THREE) {
    const kit = K.crearKit(THREE);
    const base = B.crearBase(kit);
    const pos = layout.posicion('QE-001');
    const CX = pos.x, CZ = pos.z;
    const zDispositivo = d => CUERPO.z + 0.5 + d / 2;
    const dispositivo = tag => {
      const d = DISPOSITIVOS[tag], g = new THREE.Group();
      g.position.set(CX + d.x, d.y, CZ + zDispositivo(d.d)); base.grupo.add(g); return { g, d };
    };

    /* ---------- QE-001 cuerpo, placa de montaje, canaletas, bornas y puerta ---------- */
    (function () {
      const g = new THREE.Group(); g.position.set(CX, 0, CZ); base.grupo.add(g);
      const e = kit.ensamble(), x0 = CUERPO.ancho / 2, z0 = CUERPO.fondo / 2;
      e.add(kit.caja(CUERPO.ancho, 4, CUERPO.fondo), 'oscuro', [0, 2, 0]);                                       // zócalo
      e.add(kit.caja(CUERPO.ancho, CUERPO.alto, 2), 'gris', [0, CUERPO.alto / 2, -z0 + 1]);                     // fondo
      e.add(kit.caja(2, CUERPO.alto, CUERPO.fondo), 'gris', [-x0 + 1, CUERPO.alto / 2, 0]); e.add(kit.caja(2, CUERPO.alto, CUERPO.fondo), 'gris', [x0 - 1, CUERPO.alto / 2, 0]);
      e.add(kit.caja(CUERPO.ancho, 2, CUERPO.fondo), 'gris', [0, CUERPO.alto - 1, 0]);                          // techo
      e.add(kit.caja(CUERPO.ancho - 4, CUERPO.alto - 8, 0.8), 'naranja', [0, CUERPO.alto / 2 + 2, CUERPO.z + 0.1]);   // placa de montaje
      e.add(kit.caja(54, 6, 5), 'junta', [0, 30, zDispositivo(5)]); e.add(kit.caja(54, 6, 5), 'junta', [0, 106, zDispositivo(5)]); e.add(kit.caja(54, 4, 4), 'junta', [0, 76, zDispositivo(4)]);
      e.add(kit.caja(52, 1, 2), 'inoxMate', [0, 21, zDispositivo(2)]);                                           // carril DIN de bornas
      for (let i = 0; i < 17; i++) e.add(kit.caja(2.4, 6, 4), i % 4 === 3 ? 'amarillo' : 'grisOscuro', [-24 + i * 3, 24, zDispositivo(4)]);   // bornas
      e.construir(g, 'QE-001');
      base.registrar('QE-001', g, [CUERPO.ancho + 8, CUERPO.alto, CUERPO.fondo + 4], CUERPO.alto + 8);
      // puerta abierta (pivote en la bisagra derecha)
      const pivote = new THREE.Group(); pivote.position.set(CX + PUERTA.bisagraX, 0, CZ + z0); pivote.rotation.y = PUERTA.giroRad; base.grupo.add(pivote);
      const ep = kit.ensamble();
      ep.add(kit.caja(58, CUERPO.alto - 2, 2), 'gris', [-29, CUERPO.alto / 2, 0]);
      ep.add(kit.caja(58, 3, 2.4), 'grisOscuro', [-29, CUERPO.alto - 3, 0]);
      ep.construir(pivote, 'QE-001');
      // mandos de la puerta: HMI, seta y pulsador (cara exterior = +z del pivote)
      const sobrePuerta = (tag, lx, ly, tamano) => {
        const gp = new THREE.Group(); gp.position.set(lx, ly, 1); pivote.add(gp);
        base.registrar(tag, gp, tamano);
        base.elementos[tag].ancla.set(...puntoPuerta(CX, CZ, lx, ly + tamano[1] + 8));
        return gp;
      };
      // HMI-001
      const hmi = sobrePuerta('HMI-001', -29, 100, [28, 20, 3]);
      const eh = kit.ensamble(); eh.add(kit.caja(28, 20, 2), 'negro', [0, 0, 0]); eh.construir(hmi, 'HMI-001');
      const pantalla = kit.matLed(0x1b3a5c); kit.malla(kit.caja(24, 16, 0.4), pantalla, hmi, 'HMI-001', [0, 0, 1.2]);
      const franja = kit.matLed(0xff3b30); const franjaMalla = kit.malla(kit.caja(24, 3, 0.4), franja, hmi, 'HMI-001', [0, 6.5, 1.5]); franjaMalla.visible = false;
      // ES-001 paro de emergencia (seta con base amarilla)
      const es = sobrePuerta('ES-001', -16, 70, [10, 8, 10]);
      const ee = kit.ensamble(); ee.add(kit.cil(5, 1.2, 16), 'amarillo', [0, 0, 0], [PI / 2, 0, 0]); ee.construir(es, 'ES-001');
      const seta = kit.malla(kit.cil(3.6, 3, 16), kit.matDinamico(0xc0392b), es, 'ES-001', [0, 0, 2.2], [PI / 2, 0, 0]);
      // PB-001 pulsador de marcha
      const pb = sobrePuerta('PB-001', -42, 70, [8, 8, 6]);
      const ebp = kit.ensamble(); ebp.add(kit.cil(3, 1, 14), 'negro', [0, 0, 0], [PI / 2, 0, 0]); ebp.construir(pb, 'PB-001');
      const matPb = kit.matDinamico(0x2e9e55); const botonPb = kit.malla(kit.cil(2.3, 2, 14), matPb, pb, 'PB-001', [0, 0, 1.4], [PI / 2, 0, 0]);
      let ultHmi = -1, ultEs = null, ultPb = -1;
      base.alActualizar(estado => {
        const alarmas = estado && estado.alarmas ? estado.alarmas.length : 0;
        const hex = alarmas ? 0x5c2b1b : 0x1b3a5c;
        if (hex !== ultHmi) { pantalla.color.setHex(hex); ultHmi = hex; }
        franjaMalla.visible = alarmas > 0;
        const pulsada = !!K.equipoDe(estado, 'ES-001').pulsado || K.instrumentoDe(estado, 'ES-001').nivel === 0;
        if (pulsada !== ultEs) { seta.position.z = pulsada ? 1.2 : 2.2; ultEs = pulsada; }
        const marcha = K.instrumentoDe(estado, 'PB-001').nivel === 1;
        const hexPb = marcha ? 0x7dffb0 : 0x2e9e55;
        if (hexPb !== ultPb) { matPb.color.setHex(hexPb); botonPb.position.z = marcha ? 1.0 : 1.4; ultPb = hexPb; }
      });
    })();

    /* ---------- QF-201 magnetotérmico ---------- */
    (function () {
      const { g, d } = dispositivo('QF-201'), e = kit.ensamble();
      e.add(kit.caja(d.w, d.h, d.d), 'blanco', [0, d.h / 2, 0]); e.add(kit.caja(2.4, 1.2, 1.2), 'negro', [0, d.h - 1.2, d.d / 2]);
      e.construir(g, 'QF-201');
      const palanca = kit.malla(kit.caja(2, 3.5, 1.2), kit.mat('negro'), g, 'QF-201', [0, d.h - 3, d.d / 2 + 0.4]);
      base.registrar('QF-201', g, [d.w + 2, d.h, d.d + 2], d.y + d.h + 10);
      let ultimo = null;
      base.alActualizar(estado => {
        const armado = K.instrumentoDe(estado, 'QF-201').nivel !== 0;
        if (armado !== ultimo) { palanca.rotation.x = armado ? 0 : 0.7; ultimo = armado; }
      });
    })();

    /* ---------- PS-001 fuente de 24 V CC ---------- */
    (function () {
      const { g, d } = dispositivo('PS-001'), e = kit.ensamble();
      e.add(kit.caja(d.w, d.h, d.d), 'inoxMate', [0, d.h / 2, 0]); e.add(kit.caja(d.w - 2, 4, 0.6), 'negro', [0, d.h - 4, d.d / 2 + 0.2]);
      e.add(kit.caja(6, 1.5, 0.8), 'grisOscuro', [0, 3, d.d / 2 + 0.3]);
      e.construir(g, 'PS-001');
      const led = kit.matLed(0x35e06b); kit.malla(kit.esfera(0.7, 6), led, g, 'PS-001', [d.w / 2 - 2.5, d.h - 1.5, d.d / 2 + 0.4]);
      let apagado = false, ultimo = -1;
      base.alCambiarEfectos('PS-001', ef => { apagado = ef.has('led_apagado'); ultimo = -1; });
      base.alActualizar(estado => {
        const v = K.num(K.equipoDe(estado, 'PS-001').v24, 24);
        const hex = apagado ? 0x333333 : v < 21 ? 0xffb020 : 0x35e06b;
        if (hex !== ultimo) { led.color.setHex(hex); ultimo = hex; }
      });
      base.registrar('PS-001', g, [d.w + 2, d.h, d.d + 2], d.y + d.h + 8);
    })();

    /* ---------- F-001 fusible de 24 V ---------- */
    (function () {
      const { g, d } = dispositivo('F-001'), e = kit.ensamble();
      e.add(kit.caja(d.w, d.h, d.d), 'gris', [0, d.h / 2, 0]); e.add(kit.cil(1, 3, 8), 'amarillo', [0, d.h - 1.5, d.d / 2 + 0.5], [PI / 2, 0, 0]);
      e.construir(g, 'F-001');
      const led = kit.matLed(0x35e06b); kit.malla(kit.esfera(0.55, 6), led, g, 'F-001', [0, 2, d.d / 2 + 0.5]);
      let apagado = false, ultimo = -1;
      base.alCambiarEfectos('F-001', ef => { apagado = ef.has('led_apagado'); ultimo = -1; });
      base.alActualizar(estado => {
        const hex = apagado || K.equipoDe(estado, 'F-001').fundido ? 0x333333 : 0x35e06b;    // el LED indica que hay 24 V después del fusible
        if (hex !== ultimo) { led.color.setHex(hex); ultimo = hex; }
      });
      base.registrar('F-001', g, [d.w + 3, d.h, d.d + 2], d.y + d.h + 8);
    })();

    /* ---------- PLC-001 ---------- */
    (function () {
      const { g, d } = dispositivo('PLC-001'), e = kit.ensamble();
      e.add(kit.caja(d.w, d.h, d.d), 'oscuro', [0, d.h / 2, 0]);
      for (let i = 0; i < 8; i++) e.add(kit.caja(4.4, d.h - 1, 0.8), i % 2 ? 'grisOscuro' : 'negro', [-d.w / 2 + 3 + i * 4.7, d.h / 2, d.d / 2 + 0.3]);   // módulos (CPU, AI, DI, DO, AO…)
      e.construir(g, 'PLC-001');
      // una fila de ocho LED con color por instancia (parpadean al ritmo de las E/S)
      const leds = new THREE.InstancedMesh(kit.registrar(new THREE.SphereGeometry(0.6, 6, 5)), kit.registrar(new THREE.MeshBasicMaterial({ color: 0xffffff })), 8);
      const m = new THREE.Matrix4(), c = new THREE.Color();
      for (let i = 0; i < 8; i++) { m.setPosition(-d.w / 2 + 3 + i * 4.7, d.h - 2.5, d.d / 2 + 0.9); leds.setMatrixAt(i, m); leds.setColorAt(i, c.setHex(0x35e06b)); }
      leds.userData.id = 'PLC-001'; g.add(leds);
      let t = 0, ultimaFase = -1;
      base.alActualizar((estado, dt) => {
        t += dt; const fase = Math.floor(t * 4) % 8;
        const alarmas = estado && estado.alarmas ? estado.alarmas.length : 0;
        if (fase === ultimaFase) return;
        ultimaFase = fase;
        for (let i = 0; i < 8; i++) leds.setColorAt(i, c.setHex(i === 0 ? (alarmas ? 0xff3b30 : 0x35e06b) : ((i + fase) % 3 === 0 ? 0xffb020 : 0x1d6b3a)));
        leds.instanceColor.needsUpdate = true;
      });
      base.registrar('PLC-001', g, [d.w + 2, d.h, d.d + 2], d.y + d.h + 8);
    })();

    /* ---------- VFD-101 variador de P-101 ---------- */
    (function () {
      const { g, d } = dispositivo('VFD-101'), e = kit.ensamble();
      e.add(kit.caja(d.w, d.h, d.d), 'gris', [0, d.h / 2, 0]); e.add(kit.caja(d.w - 4, 8, 0.8), 'negro', [0, d.h - 9, d.d / 2 + 0.3]);
      for (let i = 0; i < 6; i++) e.add(kit.caja(d.w - 2, 0.8, 4), 'grisOscuro', [0, 4 + i * 2, d.d / 2 + 1.5]);                                        // aletas del disipador
      e.construir(g, 'VFD-101');
      const pantalla = kit.matLed(0x35e06b); kit.malla(kit.caja(8, 3, 0.4), pantalla, g, 'VFD-101', [0, d.h - 9, d.d / 2 + 0.8]);
      const ventilador = new THREE.Group(); ventilador.position.set(0, d.h + 1.5, 0); g.add(ventilador);
      kit.malla(kit.caja(9, 0.5, 1.2), kit.mat('negro'), ventilador, 'VFD-101'); kit.malla(kit.caja(1.2, 0.5, 9), kit.mat('negro'), ventilador, 'VFD-101');
      let angulo = 0, ultimo = -1;
      base.alActualizar((estado, dt) => {
        const v = K.equipoDe(estado, 'VFD-101'), marcha = !!v.marcha && !v.fallo;
        angulo += K.velocidadAngularVisual(marcha, 100) * dt * 3; ventilador.rotation.y = angulo;
        const hex = v.fallo ? 0xff3b30 : marcha ? 0x35e06b : 0x777777;
        if (hex !== ultimo) { pantalla.color.setHex(hex); ultimo = hex; }
      });
      base.registrar('VFD-101', g, [d.w + 2, d.h + 4, d.d + 2], d.y + d.h + 10);
    })();

    /* ---------- KM-203, KM-201, KM-202 contactores ---------- */
    function contactor(tag) {
      const { g, d } = dispositivo(tag), e = kit.ensamble();
      e.add(kit.caja(d.w, d.h, d.d), 'negro', [0, d.h / 2, 0]); e.add(kit.caja(d.w - 1.5, 2, 1), 'grisOscuro', [0, d.h - 3, d.d / 2 + 0.4]);
      e.construir(g, tag);
      const led = kit.matLed(0x777777); kit.malla(kit.esfera(0.6, 6), led, g, tag, [d.w / 2 - 1.5, d.h - 6, d.d / 2 + 0.6]);
      const matBandera = kit.matDinamico(0xc0392b); const bandera = kit.malla(kit.caja(5, 1.4, 1), matBandera, g, tag, [0, 3, d.d / 2 + 0.6]);   // indicador mecánico de contactos
      let forzadoCerrado = false, forzadoAbierto = false, ultimo = '';
      base.alCambiarEfectos(tag, ef => { forzadoCerrado = ef.has('contactos_cerrados'); forzadoAbierto = ef.has('contactos_abiertos'); ultimo = ''; });
      base.alActualizar(estado => {
        const k = K.equipoDe(estado, tag);
        const cerrado = forzadoCerrado || (!forzadoAbierto && (!!k.cerrado || !!k.pegado));
        const clave = (cerrado ? 'C' : 'A') + (forzadoCerrado ? 'p' : '') + (forzadoAbierto ? 'x' : '');
        if (clave === ultimo) return;
        ultimo = clave;
        bandera.position.y = cerrado ? 5.5 : 3;
        led.color.setHex(forzadoCerrado ? 0xff3b30 : forzadoAbierto ? 0x333333 : cerrado ? 0x35e06b : 0x777777);
      });
      base.registrar(tag, g, [d.w + 2, d.h, d.d + 2], d.y + d.h + 8);
    }
    for (const tag of ['KM-203', 'KM-201', 'KM-202']) contactor(tag);

    /* ---------- HL-001 baliza de alarma, sobre el armario ---------- */
    (function () {
      const g = new THREE.Group(); g.position.set(CX + 18, CUERPO.alto, CZ); base.grupo.add(g);
      const e = kit.ensamble(); e.add(kit.cil(3.6, 2, 14), 'negro', [0, 1, 0]); e.add(kit.cil(1.2, 4, 8), 'inoxMate', [0, 4, 0]); e.construir(g, 'HL-001');
      const mat = kit.matDinamico(0x6b1d19, { transparent: true, opacity: 0.9 });
      kit.malla(new THREE.CylinderGeometry(3.2, 3.6, 7, 14), mat, g, 'HL-001', [0, 8.5, 0]);
      base.registrar('HL-001', g, [8, 14, 8], CUERPO.alto + 22);
      let t = 0, ultimo = -1;
      base.alActualizar((estado, dt) => {
        t += dt;
        const encendida = !!K.equipoDe(estado, 'HL-001').encendida || (estado && estado.alarmas && estado.alarmas.length > 0);
        const hex = encendida ? (Math.floor(t * 2) % 2 ? 0xff3b30 : 0xff9a8f) : 0x6b1d19;
        if (hex !== ultimo) { mat.color.setHex(hex); ultimo = hex; }
      });
    })();

    return { grupo: base.grupo, elementos: base.elementos, actualizar: base.actualizar, liberar: kit.liberar, TAGS };
  }

  const api = { crear, TAGS, DISPOSITIVOS, CUERPO, PUERTA, puntoPuerta };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstArmario = api; }
})();
