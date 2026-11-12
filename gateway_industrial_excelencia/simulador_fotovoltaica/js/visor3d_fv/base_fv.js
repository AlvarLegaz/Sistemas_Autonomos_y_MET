// Base común de los módulos 3D de la instalación fotovoltaica (DISEÑADOR): registro de elementos seleccionables, halo de avería y actualización con el estado.
// Cada módulo (paneles, caseta, equipos, entorno) crea una base, registra sus equipos y recibe de ella el actualizar(estado) del contrato.
(function () {
  const efectos = typeof require !== 'undefined' ? require('./efectos_averias.js') : PCT.fvEfectosAverias;

  /** kit: de crearKit(THREE). Devuelve la base de un módulo. */
  function crearBase(kit) {
    const THREE = kit.THREE;
    const grupo = new THREE.Group();
    const elementos = {};
    const actualizadores = [];                 // (estado, dt) => void
    const ganchosEfectos = new Map();          // tag → lista de (Set de efectos) => void
    const halos = new Map();
    const matHaloRojo = kit.registrar(new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.3, depthWrite: false }));
    const matHaloAmbar = kit.registrar(new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.3, depthWrite: false }));
    const geometriaHalo = kit.registrar(new THREE.BoxGeometry(1, 1, 1));
    let firma = null, ultimo = null;

    /** Crea el grupo de un elemento seleccionable y lo registra. `padre` por defecto es el grupo del módulo; con otro padre el elemento va anidado. */
    function nuevoGrupo(tag, padre, pos, giro) {
      const g = new THREE.Group();
      if (pos) g.position.set(pos[0], pos[1], pos[2]);
      if (giro) g.rotation.y = giro;
      (padre || grupo).add(g);
      elementos[tag] = { id: tag, grupo: g, ancla: new THREE.Vector3(), ayuda: tag };
      g.userData.tag = tag;
      return g;
    }
    /** Cuando todo está colocado (y la matriz del mundo calculada): ancla de la etiqueta y halo de cada elemento. */
    function finalizar() {
      const caja = new THREE.Box3();
      for (const [tag, e] of Object.entries(elementos)) {
        if (halos.has(tag)) continue;
        caja.setFromObject(e.grupo);
        if (caja.isEmpty()) { e.ancla.set(0, 0, 0); continue; }
        const c = caja.getCenter(new THREE.Vector3()), s = caja.getSize(new THREE.Vector3());
        e.ancla.set(c.x, caja.max.y + 6, c.z);
        if (Math.max(s.x, s.y, s.z) > 350) continue;                    // cadenas y bandeja: una caja roja tan grande taparía media cubierta (su aviso son el MC4 suelto y el cartel del panel)
        const halo = new THREE.Mesh(geometriaHalo, matHaloRojo);
        halo.scale.set(s.x + 2, s.y + 2, s.z + 2); halo.position.copy(c);
        halo.visible = false; halo.renderOrder = 5; halo.raycast = () => {};
        grupo.add(halo); halos.set(tag, halo);
      }
    }
    function alActualizar(f) { actualizadores.push(f); }
    function alCambiarEfectos(tag, f) { if (!ganchosEfectos.has(tag)) ganchosEfectos.set(tag, []); ganchosEfectos.get(tag).push(f); }

    const VACIO = new Set();
    function aplicarEfectos(mapa) {
      for (const [tag, halo] of halos) {
        const e = mapa.get(tag) || VACIO;
        const rojo = e.has('resaltar_rojo'), ambar = !rojo && e.has('resaltar_ambar');
        halo.visible = rojo || ambar; halo.material = rojo ? matHaloRojo : matHaloAmbar;
      }
      for (const [tag, ganchos] of ganchosEfectos) { const e = mapa.get(tag) || VACIO; for (let i = 0; i < ganchos.length; i++) ganchos[i](e); }
    }
    /** El actualizar(estado, lecturas) del contrato: reaplica los efectos solo si cambiaron las averías. */
    function actualizar(estado) {
      const ahora = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const dt = ultimo === null ? 0 : Math.min((ahora - ultimo) / 1000, 0.1); ultimo = ahora;
      const nueva = efectos.firmaAverias(estado && estado.averiasActivas);
      if (nueva !== firma) { firma = nueva; aplicarEfectos(efectos.efectosPorTag(estado && estado.averiasActivas)); }
      for (let i = 0; i < actualizadores.length; i++) actualizadores[i](estado, dt);
    }
    return { grupo, elementos, nuevoGrupo, finalizar, alActualizar, alCambiarEfectos, actualizar, aplicarEfectos };
  }

  const api = { crearBase };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else { window.PCT = window.PCT || {}; PCT.fvBase = api; }
})();
