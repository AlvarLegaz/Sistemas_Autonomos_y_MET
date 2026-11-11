// Escena de la planta completa en 3D: junta los equipos, las tuberías y las válvulas e instrumentos sobre una mesa.
// Mismo contrato que escena.js (raiz, elementos, actualizar...), pero actualizar recibe además el estado y las observaciones.
(function () {
  const layout = typeof require !== 'undefined' ? require('./layout.js') : PCT.planta3dLayout;
  const modulos = () => (typeof require !== 'undefined'
    ? [require('./equipos.js'), require('./tuberias.js'), require('./valvulas_instrumentos.js')]
    : [PCT.planta3dEquipos, PCT.planta3dTuberias, PCT.planta3dValvulasInstrumentos]);
  const { MESA } = layout;

  function crearEscena(THREE) {
    const raiz = new THREE.Group();
    const recursos = [];
    const guardar = r => { recursos.push(r); return r; };

    const material = (color, opciones = {}) => guardar(new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.6, metalness: 0.3 }, opciones)));
    const caja = (ancho, alto, fondo, mat, x, y, z) => {
      const m = new THREE.Mesh(guardar(new THREE.BoxGeometry(ancho, alto, fondo)), mat); m.position.set(x, y, z); m.receiveShadow = true; m.castShadow = true; raiz.add(m); return m;
    };
    const ALTO_PATA = 40, G = MESA.grosor;
    // Tablero con marco de aluminio, cuatro patas y un suelo lejos para que se lea la profundidad.
    caja(MESA.ancho, G, MESA.fondo, material(0x2b333c, { roughness: 0.8, metalness: 0.15 }), 0, -G / 2, 0);
    const aluminio = material(0xaeb8c2, { roughness: 0.35, metalness: 0.8 });
    caja(MESA.ancho + 2, G + 0.8, 1, aluminio, 0, -G / 2 - 0.2, MESA.fondo / 2 + 0.5);
    caja(MESA.ancho + 2, G + 0.8, 1, aluminio, 0, -G / 2 - 0.2, -MESA.fondo / 2 - 0.5);
    caja(1, G + 0.8, MESA.fondo, aluminio, MESA.ancho / 2 + 0.5, -G / 2 - 0.2, 0);
    caja(1, G + 0.8, MESA.fondo, aluminio, -MESA.ancho / 2 - 0.5, -G / 2 - 0.2, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) caja(3.2, ALTO_PATA, 3.2, aluminio, sx * (MESA.ancho / 2 - 4), -G - ALTO_PATA / 2, sz * (MESA.fondo / 2 - 4));
    const sueloY = -G - ALTO_PATA;
    const suelo = new THREE.Mesh(guardar(new THREE.CircleGeometry(260, 64)), material(0x161b20, { roughness: 0.95, metalness: 0 }));
    suelo.rotation.x = -Math.PI / 2; suelo.position.y = sueloY; suelo.receiveShadow = true; raiz.add(suelo);
    const rejillaSuelo = guardar(new THREE.GridHelper(520, 52, 0x242b32, 0x1b2127)); rejillaSuelo.position.y = sueloY + 0.05; raiz.add(rejillaSuelo);
    const rejilla = guardar(new THREE.GridHelper(MESA.ancho, 29, 0x3a444f, 0x2f3841)); rejilla.position.y = 0.02; raiz.add(rejilla);
    // Rótulo del frontal del tablero.
    const lienzo = document.createElement('canvas'); lienzo.width = 1024; lienzo.height = 128;
    const c2 = lienzo.getContext('2d'); c2.fillStyle = '#7e8a96'; c2.font = '700 64px system-ui, sans-serif'; c2.textBaseline = 'middle'; c2.fillText('PCT23 · PASTEURIZACIÓN', 20, 66);
    const textura = guardar(new THREE.CanvasTexture(lienzo)); textura.colorSpace = THREE.SRGBColorSpace;
    const rotulo = new THREE.Mesh(guardar(new THREE.PlaneGeometry(56, 7)), guardar(new THREE.MeshBasicMaterial({ map: textura, transparent: true })));
    rotulo.position.set(-MESA.ancho / 2 + 34, 0.05, MESA.fondo / 2 - 5.5); rotulo.rotation.x = -Math.PI / 2; raiz.add(rotulo);

    const partes = modulos().map(m => m.crear(THREE));
    const elementos = {};
    for (const parte of partes) { raiz.add(parte.grupo); Object.assign(elementos, parte.elementos); }
    raiz.updateMatrixWorld(true);

    function actualizar(lecturas, estado, observaciones) {
      if (!estado) return;
      for (const parte of partes) parte.actualizar(estado, observaciones);
    }

    let contorno = null;
    function resaltar(id) {
      if (contorno) { raiz.remove(contorno); contorno.geometry.dispose(); contorno = null; }
      if (!id || !elementos[id]) return;
      raiz.updateMatrixWorld(true);
      contorno = new THREE.Box3Helper(new THREE.Box3().setFromObject(elementos[id].grupo).expandByScalar(0.8), 0xf68b11);
      raiz.add(contorno);
    }
    function mallasSeleccionables() {
      const lista = [];
      for (const e of Object.values(elementos)) e.grupo.traverse(o => { if (o.isMesh || o.isInstancedMesh) lista.push(o); });
      return lista.filter(o => o.userData.id);
    }
    function liberar() { for (const p of partes) p.liberar(); for (const r of recursos) if (r && r.dispose) r.dispose(); if (contorno) contorno.geometry.dispose(); }

    return { raiz, elementos, actualizar, resaltar, ponerCorte() {}, ponerTapa() {}, mallasSeleccionables, liberar, sombras: true,
      vistaInicial: { azimut: 0.0, elevacion: 0.72, distancia: 300, minimo: 40, maximo: 420, objetivo: { x: 0, y: 4, z: 0 } } };
  }

  const api = { crearEscena };
  if (typeof module !== 'undefined') module.exports = api; else PCT.planta3d = api;
})();
