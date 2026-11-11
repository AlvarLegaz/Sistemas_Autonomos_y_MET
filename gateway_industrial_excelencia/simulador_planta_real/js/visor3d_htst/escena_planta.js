// Escena de la planta HTST completa en 3D (DISEÑADOR): el patín con todos los equipos de proceso, las tuberías con flujo, los instrumentos y el armario
// eléctrico. Mismo contrato que escena.js/planta3d.js del visor de la maqueta (raiz, elementos, actualizar(lecturas, estado), resaltar, ponerCorte,
// ponerTapa, mallasSeleccionables, liberar, vistaInicial), de modo que se registra como PCT.visor3dEscenas.htst (ARQUITECTURA.md §7.2).
// Rendimiento: materiales Lambert, sin sombras ni antialias, geometrías fusionadas por equipo y placas instanciadas.
(function () {
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.htstLayout;
  const modulos = () => (typeof require !== 'undefined'
    ? [require('./equipos_proceso.js'), require('./tuberias.js'), require('./instrumentos.js'), require('./armario.js')]
    : [PCT.htstEquiposProceso, PCT.htstTuberias, PCT.htstInstrumentos3d, PCT.htstArmario]);
  const { SKID } = layout;

  function crearEscena(THREE) {
    const raiz = new THREE.Group();
    const recursos = [];
    const guardar = r => { recursos.push(r); return r; };
    const mat = (color, opciones = {}) => guardar(new THREE.MeshLambertMaterial(Object.assign({ color }, opciones)));
    const caja = (w, h, d, material, x, y, z) => { const m = new THREE.Mesh(guardar(new THREE.BoxGeometry(w, h, d)), material); m.position.set(x, y, z); raiz.add(m); return m; };

    // Patín de acero inoxidable (cubierta con borde de bandeja de recogida, vigas y patas) y suelo de la sala.
    const matPatin = mat(0x8c969f), matViga = mat(0x6d767f), matSuelo = mat(0x1b2025);
    caja(SKID.ancho, 2, SKID.fondo, matPatin, 0, -1, 0);
    for (const sz of [-1, 1]) caja(SKID.ancho, 3, 2, matPatin, 0, 1.5, sz * (SKID.fondo / 2 - 1));            // borde de la bandeja
    for (const sx of [-1, 1]) caja(2, 3, SKID.fondo, matPatin, sx * (SKID.ancho / 2 - 1), 1.5, 0);
    for (const z of [-60, 0, 60]) caja(SKID.ancho - 8, 6, 5, matViga, 0, -5, z);                                // vigas
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) caja(8, SKID.alto - 6, 8, matViga, sx * (SKID.ancho / 2 - 10), -SKID.alto / 2 - 3, sz * (SKID.fondo / 2 - 10));   // patas
    const suelo = new THREE.Mesh(guardar(new THREE.CircleGeometry(330, 40)), matSuelo); suelo.rotation.x = -Math.PI / 2; suelo.position.y = -SKID.alto; raiz.add(suelo);
    const rejilla = guardar(new THREE.GridHelper(660, 66, 0x252c33, 0x1f252b)); rejilla.position.y = -SKID.alto + 0.1; raiz.add(rejilla);
    // zócalo bajo el armario (queda fuera del patín)
    const pos = layout.posicion('QE-001');
    caja(76, SKID.alto + 1, 46, matViga, pos.x, -SKID.alto / 2 - 0.5, pos.z);
    // rótulo de la planta en el frente del patín
    const lienzo = document.createElement('canvas'); lienzo.width = 1024; lienzo.height = 96;
    const c2 = lienzo.getContext('2d'); c2.fillStyle = '#aeb8c2'; c2.font = '700 54px system-ui, sans-serif'; c2.textBaseline = 'middle'; c2.fillText('PASTEURIZADOR HTST · LECHE', 12, 50);
    const textura = guardar(new THREE.CanvasTexture(lienzo)); textura.colorSpace = THREE.SRGBColorSpace;
    const rotulo = new THREE.Mesh(guardar(new THREE.PlaneGeometry(130, 12)), guardar(new THREE.MeshBasicMaterial({ map: textura, transparent: true })));
    rotulo.position.set(-90, 0.05, SKID.fondo / 2 - 8); rotulo.rotation.x = -Math.PI / 2; rotulo.raycast = () => {}; raiz.add(rotulo);

    const partes = modulos().map(m => m.crear(THREE));
    const elementos = {};
    for (const parte of partes) { raiz.add(parte.grupo); Object.assign(elementos, parte.elementos); }
    raiz.updateMatrixWorld(true);

    function actualizar(lecturas, estado) {
      if (!estado) return;
      for (const parte of partes) parte.actualizar(estado, lecturas);
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
      for (const e of Object.values(elementos)) e.grupo.traverse(o => { if ((o.isMesh || o.isInstancedMesh) && o.userData.id) lista.push(o); });
      for (const parte of partes) parte.grupo.traverse(o => { if ((o.isMesh || o.isInstancedMesh) && o.userData.id && !lista.includes(o)) lista.push(o); });
      return lista;
    }
    function liberar() {
      for (const parte of partes) parte.liberar();
      for (const r of recursos) if (r && r.dispose) r.dispose();
      if (contorno) contorno.geometry.dispose();
    }

    // La planta mide 420 cm de punta a punta (con el armario): hace falta una cámara con far ≥ 1100. `vistaInicial.far` lo indica; el visor de la maqueta
    // usa far = 500 fijo, así que el programador de interfaz debe leer `escena.vistaInicial.far || 500` al crear la cámara.
    return { raiz, elementos, actualizar, resaltar, ponerCorte() {}, ponerTapa() {}, mallasSeleccionables, liberar, sombras: false,
      vistaInicial: { azimut: 0.4, elevacion: 0.5, distancia: 470, minimo: 60, maximo: 600, far: 1100, objetivo: { x: 35, y: 35, z: 0 } } };
  }

  const api = { crearEscena, crear: crearEscena };
  if (typeof module !== 'undefined') module.exports = api;
  else { window.PCT = window.PCT || {}; PCT.htstEscenaPlanta = api; PCT.visor3dEscenas = PCT.visor3dEscenas || {}; PCT.visor3dEscenas.htst = api; }
})();
