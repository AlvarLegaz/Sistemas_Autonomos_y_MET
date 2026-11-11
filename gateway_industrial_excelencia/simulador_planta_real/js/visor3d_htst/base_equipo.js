// Base común de los módulos de equipos 3D (DISEÑADOR): registro de elementos, halo de avería y actualización con el contrato de layout.js.
// Cada módulo (equipos_proceso, instrumentos, armario) crea una base, registra sus equipos y recibe de ella el actualizar(estado) del contrato.
(function () {
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.htstLayout;
  const efectos = typeof require !== 'undefined' ? require('./efectos_averias.js') : PCT.htstEfectosAverias;

  /** kit: de crearKit(THREE). Devuelve la base de un módulo. */
  function crearBase(kit) {
    const THREE = kit.THREE;
    const grupo = new THREE.Group();
    const elementos = {};
    const actualizadores = [];                 // (estado, dt) => void, uno por equipo con animación
    const ganchosEfectos = new Map();          // tag → lista de (Set de efectos) => void (varios módulos o piezas pueden engancharse al mismo tag)
    const halos = new Map();
    const matHaloRojo = kit.registrar(new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.28, depthWrite: false }));
    const matHaloAmbar = kit.registrar(new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.28, depthWrite: false }));
    const geometriaHalo = kit.registrar(new THREE.BoxGeometry(1, 1, 1));
    let firma = null;
    let ultimo = null;

    /** Crea el grupo de un equipo en su posición del layout (x, z) y lo añade al módulo. */
    function nuevoGrupo(tag, desplazamiento) {
      const p = layout.posicion(tag) || { x: 0, z: 0 };
      const g = new THREE.Group();
      g.position.set(p.x + (desplazamiento ? desplazamiento[0] : 0), 0, p.z + (desplazamiento ? desplazamiento[1] : 0));
      grupo.add(g);
      return g;
    }

    /** Registra el elemento seleccionable de un equipo. `tamano` = [ancho, alto, fondo] del halo y `alturaAncla` la altura de la etiqueta. */
    function registrar(tag, g, tamano, alturaAncla) {
      const ancla = new THREE.Vector3(g.position.x, alturaAncla !== undefined ? alturaAncla : tamano[1] + 8, g.position.z);
      elementos[tag] = { id: tag, grupo: g, ancla, ayuda: tag };
      const halo = new THREE.Mesh(geometriaHalo, matHaloRojo);
      halo.scale.set(tamano[0] + 2, tamano[1] + 2, tamano[2] + 2); halo.position.set(0, tamano[1] / 2, 0);
      halo.visible = false; halo.renderOrder = 5; halo.raycast = () => {};       // el halo no se selecciona
      g.add(halo); halos.set(tag, halo);
      return elementos[tag];
    }

    function alActualizar(f) { actualizadores.push(f); }
    function alCambiarEfectos(tag, f) { if (!ganchosEfectos.has(tag)) ganchosEfectos.set(tag, []); ganchosEfectos.get(tag).push(f); }

    const VACIO = new Set();
    function aplicarEfectos(mapa) {
      for (const [tag, halo] of halos) {
        const e = mapa.get(tag) || VACIO;
        const rojo = e.has('resaltar_rojo'), ambar = !rojo && e.has('resaltar_ambar');
        halo.visible = rojo || ambar;
        halo.material = rojo ? matHaloRojo : matHaloAmbar;
        const ganchos = ganchosEfectos.get(tag);
        if (ganchos) for (let i = 0; i < ganchos.length; i++) ganchos[i](e);
      }
    }

    /** El actualizar(estado, lecturas) del contrato. Reaplica los efectos solo si cambiaron las averías. */
    function actualizar(estado) {
      const ahora = performance.now(), dt = ultimo === null ? 0 : Math.min((ahora - ultimo) / 1000, 0.1); ultimo = ahora;
      const nueva = efectos.firmaAverias(estado && estado.averiasActivas);
      if (nueva !== firma) { firma = nueva; aplicarEfectos(efectos.efectosPorTag(estado && estado.averiasActivas)); }
      for (let i = 0; i < actualizadores.length; i++) actualizadores[i](estado, dt);
    }

    return { grupo, elementos, nuevoGrupo, registrar, alActualizar, alCambiarEfectos, actualizar, aplicarEfectos };
  }

  const api = { crearBase };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstBase = api; }
})();
