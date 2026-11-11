// Escena 3D de una bomba peristáltica con Three.js: carcasa, rotor con tres rodillos y tubo flexible. Unidades: cm.
// Mismo contrato que escena.js. El rotor gira según la velocidad y el sentido de la bomba. Geometría ilustrativa.
(function () {
  const { MODELOS } = typeof require !== 'undefined' ? require('./especificaciones.js') : PCT.visor3dEspecificaciones;
  const COLOR = { acento: 0xf68b11, acero: 0x9aa6b1, oscuro: 0x2a3038, ok: 0x3fb950, tubo: 0x7fd495, calida: 0xd9480f, frio: 0x2f7fc7 };
  const RADIO = 7, CENTRO_Y = 9, RPM_MAXIMA = 60;   // a 100 % el rotor da 1 vuelta por segundo (valor didáctico, no real)

  function crearEscena(THREE, clave) {
    const modelo = MODELOS[clave];
    const raiz = new THREE.Group();
    const elementos = {}, recursos = [];
    const guardar = r => { recursos.push(r); return r; };
    const material = (color, opciones = {}) => guardar(new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.45, metalness: 0.55 }, opciones)));
    const malla = (geometria, mat, padre) => { const m = new THREE.Mesh(guardar(geometria), mat); padre.add(m); return m; };
    function registrar(id, tipo, grupo, ancla, datos) {
      grupo.traverse(o => { if (o.isMesh) o.userData.id = id; });
      raiz.add(grupo); elementos[id] = { id, tipo, grupo, ancla, datos };
    }
    const colorFluido = clave === 'BOMBA_N2' ? COLOR.calida : 0x2f9e44;

    // Suelo, bancada y motor (no seleccionables).
    const rejilla = guardar(new THREE.GridHelper(70, 28, 0x39424d, 0x232a31)); rejilla.position.y = -1.25; raiz.add(rejilla);
    malla(new THREE.BoxGeometry(30, 1.2, 16), material(COLOR.oscuro, { roughness: 0.7 }), raiz).position.y = -0.6;
    malla(new THREE.BoxGeometry(11, 11, 4), material(0x3b444e), raiz).position.set(0, CENTRO_Y, -5.5);
    malla(new THREE.BoxGeometry(14.5, 1.2, 8), material(COLOR.oscuro), raiz).position.set(0, 1.4, -2);

    // Carcasa: pared curva abierta por delante, con tapa transparente que se puede quitar.
    const carcasa = malla(new THREE.CylinderGeometry(RADIO + 0.9, RADIO + 0.9, 4.6, 64, 1, true), material(0xc9d3dc, { roughness: 0.35, side: THREE.DoubleSide }), raiz);
    carcasa.rotation.x = Math.PI / 2; carcasa.position.set(0, CENTRO_Y, -1.2);
    const fondo = malla(new THREE.CylinderGeometry(RADIO + 0.9, RADIO + 0.9, 0.6, 64), material(0x59636e), raiz);
    fondo.rotation.x = Math.PI / 2; fondo.position.set(0, CENTRO_Y, -3.6);
    const matTapa = guardar(new THREE.MeshStandardMaterial({ color: 0xaed4ff, transparent: true, opacity: 0.2, roughness: 0.1, metalness: 0, side: THREE.DoubleSide, depthWrite: false }));
    const tapa = malla(new THREE.CylinderGeometry(RADIO + 0.9, RADIO + 0.9, 0.3, 64), matTapa, raiz);
    tapa.rotation.x = Math.PI / 2; tapa.position.set(0, CENTRO_Y, 1.3); tapa.renderOrder = 3;

    // Tubo flexible: arco pegado a la pared interior (de 200° a -20°, pasando por abajo) y dos tramos rectos hasta los conectores.
    const puntos = [];
    const arco = 40, a0 = (200 * Math.PI) / 180, a1 = (-20 * Math.PI) / 180, rTubo = RADIO - 0.6;
    for (let i = 0; i <= arco; i++) { const a = a0 + (a1 - a0) * (i / arco); puntos.push(new THREE.Vector3(rTubo * Math.cos(a), CENTRO_Y + rTubo * Math.sin(a), 0)); }
    const xIn = puntos[0].x, yIn = puntos[0].y, xOut = puntos[arco].x, yOut = puntos[arco].y;
    const camino = [new THREE.Vector3(-RADIO - 7, yIn - 1.5, 0), new THREE.Vector3(xIn - 2, yIn - 0.4, 0), ...puntos, new THREE.Vector3(xOut + 2, yOut - 0.4, 0), new THREE.Vector3(RADIO + 7, yOut - 1.5, 0)];
    const grupoTubo = new THREE.Group();
    const matTubo = material(COLOR.tubo, { roughness: 0.5, metalness: 0.05, transparent: true, opacity: 0.9, emissive: colorFluido, emissiveIntensity: 0 });
    malla(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(camino), 120, 0.7, 14, false), matTubo, grupoTubo);
    registrar('TUBO', 'captador', grupoTubo, new THREE.Vector3(0, CENTRO_Y - RADIO - 1.5, 2.5), modelo.captadores.find(c => c.id === 'TUBO'));

    // Rotor: disco con tres rodillos. Gira alrededor del eje Z.
    const rotor = new THREE.Group(); rotor.position.set(0, CENTRO_Y, 0);
    const matRotor = material(COLOR.acero, { emissive: COLOR.ok, emissiveIntensity: 0 });
    malla(new THREE.CylinderGeometry(3.2, 3.2, 1.4, 40), matRotor, rotor).rotation.x = Math.PI / 2;
    for (let i = 0; i < 3; i++) {
      const a = (i * 2 * Math.PI) / 3 + Math.PI / 2;
      const brazo = malla(new THREE.BoxGeometry(RADIO - 2.2, 0.8, 0.8), matRotor, rotor);
      brazo.position.set(Math.cos(a) * (RADIO - 1.6) / 2 + Math.cos(a) * 1.2, Math.sin(a) * (RADIO - 1.6) / 2 + Math.sin(a) * 1.2, 0); brazo.rotation.z = a;
      const rodillo = malla(new THREE.CylinderGeometry(0.95, 0.95, 1.8, 24), material(0xdfe6ee), rotor);
      rodillo.rotation.x = Math.PI / 2; rodillo.position.set(Math.cos(a) * (RADIO - 1.55), Math.sin(a) * (RADIO - 1.55), 0);
    }
    const marca = malla(new THREE.BoxGeometry(0.8, 0.8, 0.5), material(COLOR.acento, { emissive: COLOR.acento, emissiveIntensity: 0.6 }), rotor);   // marca para ver el giro
    marca.position.set(0, 2.3, 0.9);
    registrar('ROTOR', 'captador', rotor, new THREE.Vector3(0, CENTRO_Y + RADIO + 2.5, 2), modelo.captadores.find(c => c.id === 'ROTOR'));

    // Conexiones: conectores a los lados, con flecha en el sentido normal del fluido (de izquierda a derecha).
    const conectores = { ASPIRACION: { x: -RADIO - 7, y: yIn - 1.5, d: -1 }, IMPULSION: { x: RADIO + 7, y: yOut - 1.5, d: 1 } };
    for (const conexion of modelo.conexiones) {
      const c = conectores[conexion.id], g = new THREE.Group();
      const racor = malla(new THREE.CylinderGeometry(1.2, 1.2, 1.6, 24), material(COLOR.oscuro), g);
      racor.rotation.z = Math.PI / 2; racor.position.set(c.x, c.y, 0);
      const flecha = malla(new THREE.ConeGeometry(1.2, 2.4, 20), material(COLOR.acento, { emissive: COLOR.acento, emissiveIntensity: 0.45 }), g);
      flecha.rotation.z = -Math.PI / 2;                      // punta hacia +X: sentido normal del flujo
      flecha.position.set(c.x + c.d * 2.6 + (conexion.tipo === 'entrada' ? -0.0 : 0), c.y, 0);
      registrar(conexion.id, 'conexion', g, new THREE.Vector3(c.x + c.d * 3.5, c.y + 1, 0), conexion);
    }

    let ultimo = null, angulo = 0;
    function actualizar(lecturas) {
      const r = lecturas.sensores.ROTOR, t = lecturas.sensores.TUBO, ahora = performance.now();
      const dt = ultimo === null ? 0 : Math.min((ahora - ultimo) / 1000, 0.1); ultimo = ahora;
      angulo += (r.inversa ? 1 : -1) * (r.velocidadPct / 100) * (RPM_MAXIMA / 60) * 2 * Math.PI * dt;   // sentido normal: horario visto de frente
      rotor.rotation.z = angulo;
      matRotor.emissiveIntensity = r.activo ? 0.35 : 0;
      matRotor.emissive.setHex(r.inversa ? 0xf85149 : COLOR.ok);
      matTubo.emissiveIntensity = t.activo ? 0.45 : 0;
    }

    let contorno = null;
    function resaltar(id) {
      if (contorno) { raiz.remove(contorno); contorno.geometry.dispose(); contorno = null; }
      if (!id || !elementos[id]) return;
      contorno = new THREE.Box3Helper(new THREE.Box3().setFromObject(elementos[id].grupo).expandByScalar(0.6), COLOR.acento);
      raiz.add(contorno);
    }
    const mallasSeleccionables = () => { const l = []; for (const e of Object.values(elementos)) e.grupo.traverse(o => { if (o.isMesh) l.push(o); }); return l; };
    const liberar = () => { for (const r of recursos) if (r && r.dispose) r.dispose(); if (contorno) contorno.geometry.dispose(); };

    return { raiz, elementos, actualizar, resaltar, ponerCorte() {}, ponerTapa: v => { tapa.visible = v; }, mallasSeleccionables, liberar,
      vistaInicial: { azimut: 0.25, elevacion: 0.2, distancia: 62, minimo: 25, maximo: 140, objetivo: { x: 0, y: CENTRO_Y - 1, z: 0 } } };
  }

  const api = { crearEscena, COLOR };
  if (typeof module !== 'undefined') module.exports = api; else PCT.visor3dEscenaBomba = api;
})();
