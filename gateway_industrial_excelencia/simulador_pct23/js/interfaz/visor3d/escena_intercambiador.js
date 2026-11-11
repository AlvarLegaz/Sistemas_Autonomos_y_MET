// Escena 3D del intercambiador de placas con Three.js: tres secciones en línea (regeneración, calentamiento, enfriamiento).
// Mismo contrato que escena.js (raiz, elementos, actualizar, resaltar...). Unidades: cm. La geometría es ilustrativa: el manual no da medidas.
(function () {
  const { MODELOS } = typeof require !== 'undefined' ? require('./especificaciones.js') : PCT.visor3dEspecificaciones;
  const COLOR = { agua: 0x2f7fc7, calida: 0xd9633a, acento: 0xf68b11, acero: 0x9aa6b1, oscuro: 0x2a3038, frio: 0x2f7fc7, caliente: 0xd9480f, ok: 0x3fb950, inactivo: 0x6b7480 };
  const limitar = (valor, minimo, maximo) => Math.max(minimo, Math.min(maximo, valor));

  // Eje X: regeneración, calentamiento y enfriamiento una detrás de otra. Cada una es un bloque de placas finas.
  const Y0 = 3, ALTO = 16, FONDO = 6.5, CENTRO_Y = Y0 + ALTO / 2;
  const SECCIONES = {
    SEC_REGEN: { x0: -15, x1: -5.5, base: 0x8d9aa6 },
    SEC_CALENT: { x0: -4.7, x1: 4.7, base: 0x8d9aa6 },
    SEC_ENFRIA: { x0: 5.5, x1: 15, base: 0x8d9aa6 },
  };
  // Conexiones: posición del arranque de la tubería y su dirección hacia fuera.
  const PUERTOS = {
    PROD_ENTRADA: { p: [-15.9, CENTRO_Y - 3.5, 0], d: [-1, 0, 0] },
    PROD_SALIDA: { p: [15.9, CENTRO_Y - 3.5, 0], d: [1, 0, 0] },
    AGUA_CAL_ENTRADA: { p: [-2, Y0 + ALTO + 0.3, 0], d: [0, 1, 0] },
    AGUA_CAL_SALIDA: { p: [2, Y0 - 0.3, 0], d: [0, -1, 0] },
    AGUA_FRIA_ENTRADA: { p: [7.5, Y0 - 0.3, 0], d: [0, -1, 0] },
    AGUA_FRIA_SALIDA: { p: [12.5, Y0 + ALTO + 0.3, 0], d: [0, 1, 0] },
  };
  const SONDAS = { T5: { x: 0 }, T3: { x: 13.3 } };

  function crearEscena(THREE, clave) {
    const modelo = MODELOS[clave];
    const raiz = new THREE.Group();
    const elementos = {}, actualizadores = {}, recursos = [];
    const guardar = r => { recursos.push(r); return r; };
    const material = (color, opciones = {}) => guardar(new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.45, metalness: 0.55 }, opciones)));
    const malla = (geometria, mat, padre) => { const m = new THREE.Mesh(guardar(geometria), mat); padre.add(m); return m; };
    const vec = a => new THREE.Vector3(a[0], a[1], a[2]);
    const orientar = (m, d) => m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vec(d).normalize());
    function registrar(id, tipo, grupo, ancla, datos) {
      grupo.traverse(o => { if (o.isMesh) o.userData.id = id; });
      raiz.add(grupo); elementos[id] = { id, tipo, grupo, ancla, datos };
    }

    // Suelo, patas y bastidor (no seleccionables).
    const rejilla = guardar(new THREE.GridHelper(70, 28, 0x39424d, 0x232a31)); rejilla.position.y = -1.25; raiz.add(rejilla);
    const base = malla(new THREE.BoxGeometry(38, 1.2, 12), material(COLOR.oscuro, { roughness: 0.7 }), raiz); base.position.y = -0.6;
    const bastidor = material(0xc9d3dc, { roughness: 0.35 });
    for (const x of [-15.9, 15.9]) {                                           // placas de apriete de los extremos
      const placa = malla(new THREE.BoxGeometry(0.9, ALTO + 2, FONDO + 1.5), bastidor, raiz); placa.position.set(x, CENTRO_Y, 0);
      const pata = malla(new THREE.BoxGeometry(2.4, Y0 - 0.2, FONDO + 1.5), material(COLOR.oscuro), raiz); pata.position.set(x, (Y0 - 0.2) / 2, 0);
    }
    for (const [y, z] of [[Y0 - 0.2, 2.6], [Y0 - 0.2, -2.6], [Y0 + ALTO + 0.2, 2.6], [Y0 + ALTO + 0.2, -2.6]]) {   // tirantes
      const tirante = malla(new THREE.CylinderGeometry(0.28, 0.28, 32.4, 14), material(COLOR.acero), raiz);
      tirante.rotation.z = Math.PI / 2; tirante.position.set(0, y, z);
    }

    // Secciones: paquete de placas (una malla por placa) separado del siguiente por una junta oscura.
    const colorFrio = new THREE.Color(0x7d98ad), colorCalido = new THREE.Color(COLOR.calida);
    for (const [id, s] of Object.entries(SECCIONES)) {
      const g = new THREE.Group();
      const matPlaca = material(s.base, { roughness: 0.3, metalness: 0.75, emissive: 0x000000 });
      const matJunta = material(0x1d2228, { roughness: 0.85, metalness: 0.05 });
      const n = Math.round((s.x1 - s.x0) / 0.7);
      for (let i = 0; i < n; i++) {
        const x = s.x0 + (i + 0.5) * (s.x1 - s.x0) / n;
        const placa = malla(new THREE.BoxGeometry(0.34, ALTO, FONDO), i % 2 ? matPlaca : matJunta, g); placa.position.set(x, CENTRO_Y, 0);
      }
      registrar(id, 'captador', g, new THREE.Vector3((s.x0 + s.x1) / 2, Y0 + ALTO + 5.5, 0), modelo.captadores.find(c => c.id === id));
      actualizadores[id] = l => {
        matPlaca.color.copy(colorFrio).lerp(colorCalido, limitar((l.tempC - 20) / 55, 0, 1));
        matPlaca.emissive.copy(matPlaca.color); matPlaca.emissiveIntensity = l.activo ? 0.28 : 0.04;
      };
    }

    // Sondas de temperatura (T5 y T3): vástago vertical clavado en el paquete.
    for (const c of modelo.captadores.filter(x => x.tipo === 'sonda_placas')) {
      const g = new THREE.Group(), x = SONDAS[c.id].x, acero = material(COLOR.acero);
      malla(new THREE.CylinderGeometry(0.28, 0.28, 4, 14), acero, g).position.set(x, Y0 + ALTO + 2, 0.2);
      const matPunta = material(COLOR.agua, { emissive: COLOR.agua, emissiveIntensity: 0.5 });
      malla(new THREE.SphereGeometry(0.62, 18, 14), matPunta, g).position.set(x, Y0 + ALTO + 0.2, 0.2);
      malla(new THREE.CylinderGeometry(0.9, 0.9, 1.4, 20), material(COLOR.oscuro), g).position.set(x, Y0 + ALTO + 4.4, 0.2);
      registrar(c.id, 'captador', g, new THREE.Vector3(x, Y0 + ALTO + 6.6, 0.2), c);
      const frio = new THREE.Color(COLOR.agua), calor = new THREE.Color(0xf04d3a);
      actualizadores[c.id] = l => { matPunta.color.copy(frio).lerp(calor, limitar((l.valor - 20) / 60, 0, 1)); matPunta.emissive.copy(matPunta.color); };
    }

    // Conexiones: tubería, brida y cono que indica hacia dónde va el fluido.
    for (const conexion of modelo.conexiones) {
      const puerto = PUERTOS[conexion.id], g = new THREE.Group(), largo = 4.2, dir = vec(puerto.d), origen = vec(puerto.p);
      const agua = conexion.id.startsWith('AGUA_FRIA') ? COLOR.frio : conexion.id.startsWith('AGUA_CAL') ? COLOR.caliente : 0xd9d3b0;
      const tubo = malla(new THREE.CylinderGeometry(0.9, 0.9, largo, 24), material(agua, { roughness: 0.5 }), g);
      orientar(tubo, puerto.d); tubo.position.copy(origen).addScaledVector(dir, largo / 2);
      const brida = malla(new THREE.CylinderGeometry(1.5, 1.5, 0.5, 24), material(COLOR.oscuro), g);
      orientar(brida, puerto.d); brida.position.copy(origen).addScaledVector(dir, 0.2);
      const flecha = malla(new THREE.ConeGeometry(1.25, 2.4, 20), material(COLOR.acento, { emissive: COLOR.acento, emissiveIntensity: 0.45 }), g);
      orientar(flecha, conexion.tipo === 'entrada' ? dir.clone().negate().toArray() : puerto.d);
      flecha.position.copy(origen).addScaledVector(dir, largo + 1.3);
      registrar(conexion.id, 'conexion', g, origen.clone().addScaledVector(dir, largo + 3), conexion);
    }

    function actualizar(lecturas) { for (const id of Object.keys(actualizadores)) actualizadores[id](lecturas.sensores[id]); }

    let contorno = null;
    function resaltar(id) {
      if (contorno) { raiz.remove(contorno); contorno.geometry.dispose(); contorno = null; }
      if (!id || !elementos[id]) return;
      contorno = new THREE.Box3Helper(new THREE.Box3().setFromObject(elementos[id].grupo).expandByScalar(0.6), COLOR.acento);
      raiz.add(contorno);
    }
    function mallasSeleccionables() {
      const lista = [];
      for (const e of Object.values(elementos)) e.grupo.traverse(o => { if (o.isMesh) lista.push(o); });
      return lista;
    }
    function liberar() { for (const r of recursos) if (r && r.dispose) r.dispose(); if (contorno) contorno.geometry.dispose(); }

    return { raiz, elementos, actualizar, resaltar, ponerCorte() {}, ponerTapa() {}, mallasSeleccionables, liberar,
      vistaInicial: { azimut: 0.55, elevacion: 0.32, distancia: 78, minimo: 30, maximo: 160, objetivo: { x: 0, y: CENTRO_Y - 2, z: 0 } } };
  }

  const api = { crearEscena, COLOR };
  if (typeof module !== 'undefined') module.exports = api; else PCT.visor3dEscenaIntercambiador = api;
})();
