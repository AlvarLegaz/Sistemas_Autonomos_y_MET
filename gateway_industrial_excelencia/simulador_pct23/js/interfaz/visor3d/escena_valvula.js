// Escena 3D de una electroválvula con Three.js: cuerpo transparente, solenoide (bobina de cobre), émbolo con muelle y puertos. Unidades: cm.
// Mismo contrato que escena_bomba.js. Con corriente en la bobina el émbolo sube y el fluido va por el camino activo. Geometría ilustrativa.
(function () {
  const { MODELOS } = typeof require !== 'undefined' ? require('./especificaciones.js') : PCT.visor3dEspecificaciones;
  const COLOR = { acento: 0xf68b11, acero: 0x9aa6b1, oscuro: 0x2a3038, laton: 0xc9a23a, cobre: 0xc9772c, ambar: 0xffb020, producto: 0x2f9e44, agua: 0x2f7fc7 };
  const ELEVACION_EMBOLO_CM = 2.2;     // cuánto sube el émbolo con la bobina activa
  const SUAVIZADO_POR_S = 12;          // rapidez con que el émbolo alcanza su posición (1 / segundos)

  /* ---------- lógica pura (se prueba con node:test) ---------- */

  /** Altura (cm sobre su posición de reposo) a la que debe estar el émbolo. */
  const alturaObjetivoEmbolo = activo => (activo ? ELEVACION_EMBOLO_CM : 0);

  /** Avance suave hacia el objetivo: exponencial, independiente de los fotogramas por segundo. */
  const suavizar = (actual, objetivo, dtSegundos) => actual + (objetivo - actual) * (1 - Math.exp(-SUAVIZADO_POR_S * Math.max(0, dtSegundos)));

  /** Ids de las conexiones por las que pasa el fluido, según las vías y el camino ('abierta'|'cerrada' en 2 vías, 'reposo'|'activa' en 3). */
  function caminosIluminados(vias, camino) {
    if (vias === 2) return camino === 'abierta' ? ['ENTRADA', 'SALIDA'] : [];
    if (camino === 'activa') return ['COMUN', 'VIA_ACTIVA'];
    return ['COMUN', 'VIA_REPOSO'];
  }

  /** Color del fluido: producto (verde) en SOL1 y SOL2, agua fría (azul) en el resto. */
  const colorFluido = salida => (salida === 'SOL1' || salida === 'SOL2' ? COLOR.producto : COLOR.agua);

  // Puertos: posición de la boca (x, y) y dirección hacia fuera (+1 derecha, -1 izquierda). El cuerpo mide 12 de ancho, centrado en x = 0.
  const MEDIO_ANCHO = 6, ALTO_EJE = 4;
  const PUERTOS = {
    ENTRADA: { x: -MEDIO_ANCHO, y: ALTO_EJE, d: -1 }, SALIDA: { x: MEDIO_ANCHO, y: ALTO_EJE, d: 1 },
    COMUN: { x: -MEDIO_ANCHO, y: ALTO_EJE, d: -1 }, VIA_REPOSO: { x: MEDIO_ANCHO, y: 2.2, d: 1 }, VIA_ACTIVA: { x: MEDIO_ANCHO, y: 5.8, d: 1 },
  };

  /* ---------- escena ---------- */

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
    const colorAgua = colorFluido(modelo.salida);
    const colorLuz = new THREE.Color(COLOR.ambar);

    // Suelo y bancada (no seleccionables).
    const rejilla = guardar(new THREE.GridHelper(60, 24, 0x39424d, 0x232a31)); rejilla.position.y = -1.25; raiz.add(rejilla);
    malla(new THREE.BoxGeometry(26, 1.2, 14), material(COLOR.oscuro, { roughness: 0.7 }), raiz).position.y = -0.6;

    // Cuerpo: caja de latón transparente (se puede quitar con «Tapa») y un zócalo macizo debajo.
    const matCuerpo = material(COLOR.laton, { transparent: true, opacity: 0.26, roughness: 0.3, metalness: 0.7, side: THREE.DoubleSide, depthWrite: false });
    const cuerpo = malla(new THREE.BoxGeometry(MEDIO_ANCHO * 2, 8, 6), matCuerpo, raiz); cuerpo.position.set(0, 4, 0); cuerpo.renderOrder = 3;
    malla(new THREE.BoxGeometry(MEDIO_ANCHO * 2 + 1, 0.8, 7), material(0x7d6a2b), raiz).position.set(0, 0.4, 0);
    malla(new THREE.BoxGeometry(MEDIO_ANCHO * 2 + 0.6, 0.6, 6.6), material(0x7d6a2b), raiz).position.set(0, 8.1, 0);

    // Canales interiores: un tramo por conexión hacia la cámara central (x = 0). Se iluminan solo si por ahí pasa el fluido.
    const canales = {};
    function tramo(p0, p1, radio, mat, padre) {
      const v0 = new THREE.Vector3(...p0), v1 = new THREE.Vector3(...p1), dir = v1.clone().sub(v0), largo = dir.length();
      const m = malla(new THREE.CylinderGeometry(radio, radio, largo, 20), mat, padre);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()); m.position.copy(v0).add(v1).multiplyScalar(0.5);
      return m;
    }

    // Conexiones: canal interior + tubo exterior + brida + flecha que apunta hacia donde va el fluido (hacia dentro si es entrada).
    for (const conexion of modelo.conexiones) {
      const puerto = PUERTOS[conexion.id], g = new THREE.Group(), largo = 5;
      const mat = material(colorAgua, { roughness: 0.4, metalness: 0.1, emissive: colorAgua, emissiveIntensity: 0.05, transparent: true, opacity: 0.45 });
      canales[conexion.id] = mat;
      tramo([puerto.x, puerto.y, 0], [0, ALTO_EJE, 0], 0.9, mat, g);                                   // canal dentro del cuerpo
      tramo([puerto.x, puerto.y, 0], [puerto.x + puerto.d * largo, puerto.y, 0], 0.9, material(colorAgua, { roughness: 0.5, metalness: 0.2 }), g);   // tubo exterior
      const brida = malla(new THREE.CylinderGeometry(1.5, 1.5, 0.5, 24), material(COLOR.oscuro), g);
      brida.rotation.z = Math.PI / 2; brida.position.set(puerto.x + puerto.d * 0.3, puerto.y, 0);
      const flecha = malla(new THREE.ConeGeometry(1.2, 2.4, 20), material(COLOR.acento, { emissive: COLOR.acento, emissiveIntensity: 0.45 }), g);
      const haciaDentro = conexion.tipo === 'entrada';
      const punta = new THREE.Vector3(haciaDentro ? -puerto.d : puerto.d, 0, 0);
      flecha.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), punta);
      flecha.position.set(puerto.x + puerto.d * (largo + 1.4), puerto.y, 0);
      registrar(conexion.id, 'conexion', g, new THREE.Vector3(puerto.x + puerto.d * (largo + 3.2), puerto.y + 1.4, 0), conexion);
    }

    // Émbolo: punta que cierra el paso, vástago de acero, collarín y muelle. Todo se mueve en vertical.
    const embolo = new THREE.Group();
    const acero = material(COLOR.acero, { roughness: 0.3, metalness: 0.85 });
    malla(new THREE.CylinderGeometry(1.5, 1.5, 0.5, 28), material(0x5b646c, { roughness: 0.5 }), embolo).position.y = ALTO_EJE + 0.55;   // punta sobre el asiento
    malla(new THREE.CylinderGeometry(0.7, 0.7, 8.4, 22), acero, embolo).position.y = ALTO_EJE + 0.8 + 4.2;                      // vástago
    malla(new THREE.CylinderGeometry(1.35, 1.35, 0.5, 22), acero, embolo).position.y = 6.3;                                    // collarín
    const muelle = new THREE.Group(); muelle.position.y = 6.3; embolo.add(muelle);                                              // muelle (hélice de altura 1, se estira con la escala)
    const puntosMuelle = [];
    for (let i = 0; i <= 60; i++) { const t = i / 60, a = t * 6 * Math.PI * 2; puntosMuelle.push(new THREE.Vector3(1.2 * Math.sin(a), t, 1.2 * Math.cos(a))); }
    malla(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(puntosMuelle), 120, 0.1, 8, false), material(0xdfe6ee, { roughness: 0.3, metalness: 0.8 }), muelle);
    registrar('EMBOLO', 'captador', embolo, new THREE.Vector3(-2.5, 13.5, 0), modelo.captadores.find(c => c.id === 'EMBOLO'));

    // Solenoide: carcasa oscura con espiras de cobre alrededor del vástago; brilla en ámbar con corriente.
    const bobina = new THREE.Group();
    malla(new THREE.CylinderGeometry(2.4, 2.4, 6.2, 36, 1, true), material(0x30363d, { roughness: 0.7, side: THREE.DoubleSide, transparent: true, opacity: 0.5, depthWrite: false }), bobina).position.set(0, 11.2, 0);
    const matCobre = material(COLOR.cobre, { roughness: 0.35, metalness: 0.9, emissive: COLOR.ambar, emissiveIntensity: 0 });
    for (let i = 0; i < 14; i++) {
      const espira = malla(new THREE.TorusGeometry(2.55, 0.2, 10, 40), matCobre, bobina);
      espira.rotation.x = Math.PI / 2; espira.position.set(0, 8.7 + i * 0.4, 0);
    }
    malla(new THREE.CylinderGeometry(2.8, 2.8, 0.5, 36), material(COLOR.oscuro), bobina).position.set(0, 14.5, 0);
    malla(new THREE.CylinderGeometry(2.8, 2.8, 0.4, 36), material(COLOR.oscuro), bobina).position.set(0, 8.4, 0);
    registrar('BOBINA', 'captador', bobina, new THREE.Vector3(2.8, 14.8, 0), modelo.captadores.find(c => c.id === 'BOBINA'));

    let ultimo = null, altura = 0;
    function actualizar(lecturas) {
      const s = lecturas.sensores, ahora = performance.now();
      const primera = ultimo === null, dt = primera ? 0 : Math.min((ahora - ultimo) / 1000, 0.1); ultimo = ahora;
      const activaBobina = !!(s.BOBINA && s.BOBINA.activo), activoEmbolo = !!(s.EMBOLO && s.EMBOLO.activo);
      altura = primera ? alturaObjetivoEmbolo(activoEmbolo) : suavizar(altura, alturaObjetivoEmbolo(activoEmbolo), dt);   // el primer fotograma no anima
      embolo.position.y = altura;
      muelle.scale.y = Math.max(0.2, 8 - (6.3 + altura));
      matCobre.emissiveIntensity = activaBobina ? 0.9 : 0; matCobre.emissive.copy(colorLuz);
      const iluminados = caminosIluminados(modelo.vias, lecturas.camino);
      for (const [id, mat] of Object.entries(canales)) {
        const encendido = iluminados.includes(id);
        mat.emissiveIntensity = encendido ? 0.75 : 0.05; mat.opacity = encendido ? 0.85 : 0.3;
      }
    }

    let contorno = null;
    function resaltar(id) {
      if (contorno) { raiz.remove(contorno); contorno.geometry.dispose(); contorno = null; }
      if (!id || !elementos[id]) return;
      raiz.updateMatrixWorld(true);
      contorno = new THREE.Box3Helper(new THREE.Box3().setFromObject(elementos[id].grupo).expandByScalar(0.6), COLOR.acento);
      raiz.add(contorno);
    }
    const mallasSeleccionables = () => { const l = []; for (const e of Object.values(elementos)) e.grupo.traverse(o => { if (o.isMesh) l.push(o); }); return l; };
    const liberar = () => { for (const r of recursos) if (r && r.dispose) r.dispose(); if (contorno) contorno.geometry.dispose(); };

    return { raiz, elementos, actualizar, resaltar, ponerCorte() {}, ponerTapa: v => { cuerpo.visible = v; }, mallasSeleccionables, liberar,
      vistaInicial: { azimut: 0.45, elevacion: 0.22, distancia: 58, minimo: 22, maximo: 130, objetivo: { x: 0, y: 7, z: 0 } } };
  }

  const api = { crearEscena, alturaObjetivoEmbolo, suavizar, caminosIluminados, colorFluido, ELEVACION_EMBOLO_CM, PUERTOS };
  if (typeof module !== 'undefined') module.exports = api; else PCT.visor3dEscenaValvula = api;
})();
