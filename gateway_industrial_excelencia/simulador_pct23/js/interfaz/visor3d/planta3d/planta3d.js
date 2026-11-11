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

    const mesa = new THREE.Mesh(guardar(new THREE.BoxGeometry(MESA.ancho, MESA.grosor, MESA.fondo)),
      guardar(new THREE.MeshStandardMaterial({ color: 0x2b333c, roughness: 0.75, metalness: 0.2 })));
    mesa.position.y = -MESA.grosor / 2; raiz.add(mesa);
    const rejilla = guardar(new THREE.GridHelper(MESA.ancho, 29, 0x3a444f, 0x2f3841)); rejilla.position.y = 0.02; raiz.add(rejilla);
    const suelo = guardar(new THREE.GridHelper(420, 42, 0x2b333c, 0x1d2329)); suelo.position.y = -MESA.grosor - 0.6; raiz.add(suelo);

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

    return { raiz, elementos, actualizar, resaltar, ponerCorte() {}, ponerTapa() {}, mallasSeleccionables, liberar,
      vistaInicial: { azimut: 0.0, elevacion: 0.72, distancia: 300, minimo: 40, maximo: 420, objetivo: { x: 0, y: 4, z: 0 } } };
  }

  const api = { crearEscena };
  if (typeof module !== 'undefined') module.exports = api; else PCT.planta3d = api;
})();
