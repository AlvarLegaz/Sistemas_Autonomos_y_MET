// Escena 3D de la instalación fotovoltaica de la cubierta (DISEÑADOR): la cubierta con su entorno, los campos A y B y los paneles antiguos, la bandeja con los cables, la caseta
// metálica con su interior y todos los equipos. Mismo contrato que escena_planta.js de la planta real (raiz, elementos, actualizar(lecturas, estado), resaltar, aislar, vistaDe,
// ponerCorte, ponerTapa, mallasSeleccionables, liberar, luces propias, ajustesRender, ponerCalidad, vistaInicial) y se registra como PCT.visor3dEscenas.fv.
// La luz sigue al reloj solar: el sol se mueve según `estado.sol`, la nubosidad lo atenúa, el cielo cambia de color y de noche queda la luz de relleno y la del interior.
(function () {
  const K = typeof require !== 'undefined' ? require('./kit.js') : PCT.fvKit;
  const D = typeof require !== 'undefined' ? require('./disposicion.js') : PCT.fvDisposicion;
  const ENTORNO = typeof require !== 'undefined' ? require('./entorno_cubierta.js') : PCT.fvEntorno;
  const PANELES = typeof require !== 'undefined' ? require('./paneles.js') : PCT.fvPaneles;
  const CASETA = typeof require !== 'undefined' ? require('./caseta.js') : PCT.fvCaseta;
  const EQUIPOS = typeof require !== 'undefined' ? require('./equipos_fv.js') : PCT.fvEquipos;
  const CABLEADO = typeof require !== 'undefined' ? require('./cableado_fv.js') : PCT.fvCableado;
  const C = D.CASETA;

  /* ---------- Luz y calidad gráfica (funciones puras: se prueban sin THREE). Unidades de three r169 (cm en la escena). ---------- */
  const LUCES = {
    alta: { escalaSol: 1.0, escalaHemi: 1.0, sombras: true, interior: { color: 0xfff1dc, intensidad: 5200, distancia: 360, decaimiento: 2 }, render: { toneMapping: 'neutral', exposicion: 1.0, sombras: true } },
    baja: { escalaSol: 0.62, escalaHemi: 0.95, sombras: false, interior: null, render: { toneMapping: 'ninguno', exposicion: 1.0, sombras: false } },
  };
  const lucesDeCalidad = calidad => LUCES[calidad === 'alta' ? 'alta' : 'baja'];
  const BLANCO = 0xffffff;
  const DIST_SOL = 4200, OBJETIVO_SOL = [-100, 0, -120];

  /** Vista pedida en la dirección: ?vista=azimut,elevacion,distancia,x,y,z (radianes y cm); para enseñar o comprobar un rincón concreto. */
  function vistaDeLaDireccion() {
    try {
      const v = (new URLSearchParams(location.search).get('vista') || '').split(',').map(Number);
      if (v.length < 6 || v.some(n => !Number.isFinite(n))) return null;
      return { azimut: v[0], elevacion: v[1], distancia: v[2], minimo: 20, maximo: 4500, far: 16000, objetivo: { x: v[3], y: v[4], z: v[5] } };
    } catch (error) { return null; }
  }

  /** `opciones` (la pasa el visor): { calidad: 'alta' | 'baja' (forzada), porSoftware: bool }. Sin DOM (pruebas) siempre sale 'baja'. */
  function crearEscena(THREE, clave, opciones = {}) {
    const raiz = new THREE.Group();
    const recursos = [];
    const guardar = r => { recursos.push(r); return r; };
    let calidad = typeof document === 'undefined' ? 'baja' : K.elegirCalidad({ forzada: opciones.calidad, porSoftware: opciones.porSoftware });
    if (typeof document === 'undefined' && opciones.calidad === 'alta') calidad = 'alta';                     // las pruebas pueden pedir PBR sin entorno
    const envMap = calidad === 'alta' && typeof document !== 'undefined' ? guardar(K.crearEntorno(THREE)) : null;
    K.fijarEstilo({ calidad, envMap });

    const partes = [ENTORNO.crear(THREE), PANELES.crear(THREE), CASETA.crear(THREE), EQUIPOS.crear(THREE), CABLEADO.crear(THREE)];
    const [pEntorno, pPaneles, pCaseta, pEquipos] = partes;
    const elementos = {};
    for (const parte of partes) { raiz.add(parte.grupo); Object.assign(elementos, parte.elementos); }
    raiz.updateMatrixWorld(true);
    for (const parte of partes) parte.finalizar();

    /* ---------- Luces (fuera de `raiz`: aislar() oculta hermanos dentro de ella y no debe apagar la luz) ---------- */
    const luces = new THREE.Group(), preset = lucesDeCalidad(calidad);
    const hemi = new THREE.HemisphereLight(0xb4d0ee, 0x6a665c, 0.7);
    const sol = new THREE.DirectionalLight(0xfff0dc, 2.5); sol.target.position.set(...OBJETIVO_SOL);
    luces.add(hemi, sol, sol.target);
    if (preset.sombras) {
      sol.castShadow = true; sol.shadow.mapSize.set(2048, 2048); sol.shadow.bias = -0.0005; sol.shadow.normalBias = 0.6; sol.shadow.radius = 3;
      Object.assign(sol.shadow.camera, { left: -1350, right: 1350, top: 1350, bottom: -1350, near: 800, far: 7600 }); sol.shadow.camera.updateProjectionMatrix();
    }
    let luzInterior = null;
    if (preset.interior) { const L = preset.interior; luzInterior = new THREE.PointLight(L.color, L.intensidad, L.distancia, L.decaimiento); luzInterior.position.set(C.x, 190, C.z); luces.add(luzInterior); }

    // Luz de relleno para ver un equipo aislado (?foco=TAG&solo=1): la carcasa ya no tapa la luz y los equipos de la pared miran a donde el sol no llega
    const relleno = new THREE.DirectionalLight(0xffffff, 0); luces.add(relleno, relleno.target);
    let aislado = false, luzActual = null;
    function actualizarLuz(estado) {
      const luz = K.luzSolar(estado), dir = K.direccionSol(estado && estado.sol), p = lucesDeCalidad(calidad);
      sol.position.set(OBJETIVO_SOL[0] + dir.x * DIST_SOL, Math.max(OBJETIVO_SOL[1] + dir.y * DIST_SOL, 40), OBJETIVO_SOL[2] + dir.z * DIST_SOL);
      sol.intensity = luz.intensidad * p.escalaSol; sol.color.setHex(luz.color);
      sol.visible = luz.intensidad > 0.01;
      hemi.intensity = luz.hemiIntensidad * p.escalaHemi * (aislado ? 1.5 : 1.15); hemi.color.setHex(luz.hemiCielo); hemi.groundColor.setHex(luz.hemiSuelo);
      relleno.intensity = aislado ? 0.55 + 0.9 * luz.dia : 0;
      relleno.visible = aislado;
      if (luzInterior) { luzInterior.intensity = lucesDeCalidad('alta').interior.intensidad * (0.45 + 0.55 * (1 - luz.dia)); luzInterior.color.setHex(K.mezclarHex(0xffe6c4, 0xfff6ea, luz.dia)); }
      luzActual = luz;
    }
    actualizarLuz(null);

    function actualizar(lecturas, estado) {
      if (!estado) return;
      actualizarLuz(estado);
      for (const parte of partes) parte.actualizar(estado, lecturas);
    }

    /** Baja la calidad en caliente (modo lento del visor): luces sencillas, sin sombras, y los materiales PBR pierden entorno, metal y brillo. Solo baja. */
    function ponerCalidad(nuevo) {
      if (nuevo !== 'baja' || calidad === 'baja') return calidad;
      calidad = 'baja';
      sol.castShadow = false; if (sol.shadow.map) { sol.shadow.map.dispose(); sol.shadow.map = null; }
      if (luzInterior) luzInterior.visible = false;
      raiz.traverse(o => {
        if (!(o.isMesh || o.isInstancedMesh)) return;
        o.castShadow = o.receiveShadow = false;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (m && m.isMeshStandardMaterial) { m.envMap = null; m.metalness = 0; m.roughness = 1; m.needsUpdate = true; }
        }
      });
      actualizarLuz(null);
      return calidad;
    }
    const ajustesRender = () => Object.assign({}, lucesDeCalidad(calidad).render);

    /* ---------- Selección, resaltado, vistas ---------- */
    let contorno = null;
    function resaltar(id) {
      if (contorno) { raiz.remove(contorno); contorno.geometry.dispose(); contorno = null; }
      if (!id || !elementos[id]) return;
      raiz.updateMatrixWorld(true);
      contorno = new THREE.Box3Helper(new THREE.Box3().setFromObject(elementos[id].grupo).expandByScalar(0.8), 0xf68b11);
      raiz.add(contorno);
    }
    const ocultados = [];
    function restaurar() { for (const o of ocultados) o.visible = true; ocultados.length = 0; aislado = false; actualizarLuz(null); }
    function aislar(id) {
      const el = elementos[id];
      if (!el || !el.grupo) return false;
      restaurar();
      const v = vistaDe(id);
      if (v) {                                                                                  // relleno desde el lado por el que se mira el equipo
        const c = v.objetivo; relleno.target.position.set(c.x, c.y, c.z);
        relleno.position.set(c.x + Math.sin(v.azimut) * 700, c.y + 350, c.z + Math.cos(v.azimut) * 700);
      }
      aislado = true;
      for (let n = el.grupo; n !== raiz && n.parent; n = n.parent) {
        for (const hermano of n.parent.children) if (hermano !== n && hermano.visible) { hermano.visible = false; ocultados.push(hermano); }
      }
      return true;
    }
    /** Pared en la que está un equipo del interior (para mirarlo de frente): 'N' | 'E' | 'O' | null. */
    function paredDe(id) {
      const tag = D.ANIDADOS[id] || id, def = D.INTERIOR[tag];
      return def ? (def.pared === 'LIBRE' ? 'N' : def.pared) : null;
    }
    /** Vista centrada en un equipo y a la distancia justa para verlo entero (de frente si va en una pared de la caseta); null si no existe. */
    function vistaDe(id) {
      const el = elementos[id];
      if (!el || !el.grupo) return null;
      raiz.updateMatrixWorld(true);
      const caja = new THREE.Box3().setFromObject(el.grupo), centro = caja.getCenter(new THREE.Vector3()), tam = caja.getSize(new THREE.Vector3());
      const radio = Math.max(8, tam.length() / 2), pared = paredDe(id);
      const azimut = { N: 0.18, E: -Math.PI / 2 + 0.18, O: Math.PI / 2 - 0.18 }[pared];
      const distancia = Math.max(radio * 3.2, pared ? 45 : 60);
      return { azimut: azimut !== undefined ? azimut : 0.45, elevacion: pared ? 0.12 : 0.55, distancia, minimo: Math.max(6, radio * 0.45), maximo: Math.max(distancia * 3, 400), far: 16000, objetivo: { x: centro.x, y: centro.y, z: centro.z } };
    }
    const visibleEnCadena = o => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };
    function mallasSeleccionables() {
      const lista = [];
      raiz.traverse(o => { if ((o.isMesh || o.isInstancedMesh) && o.userData.id) lista.push(o); });
      return ocultados.length ? lista.filter(visibleEnCadena) : lista;
    }
    function liberar() {
      for (const parte of partes) parte.liberar();
      for (const r of recursos) if (r && r.dispose) r.dispose();
      if (sol.shadow.map) sol.shadow.map.dispose();
      if (contorno) contorno.geometry.dispose();
      K.fijarEstilo({ calidad: 'baja' });
    }
    const ponerCorte = v => { pCaseta.ponerCorte(!!v); };
    const ponerTapa = v => { pCaseta.ponerTapa(!!v); pEquipos.ponerTapa(!!v); };

    const escena = { raiz, elementos, actualizar, resaltar, aislar, restaurar, vistaDe, ponerCorte, ponerTapa, mallasSeleccionables, liberar, sombras: false,
      luces, iluminacionPropia: true, ajustesRender, ponerCalidad, get calidad() { return calidad; }, get luz() { return luzActual; }, partes, sol, hemi,
      vistaInicial: vistaDeLaDireccion() || { azimut: 0.62, elevacion: 0.36, distancia: 1150, minimo: 40, maximo: 4200, far: 16000, objetivo: { x: -520, y: 80, z: -230 } } };
    if (typeof window !== 'undefined') window.fvUltimaEscena = escena;                  // para depurar desde la consola del navegador
    return escena;
  }

  const api = { crearEscena, crear: crearEscena, LUCES, lucesDeCalidad };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { window.PCT = window.PCT || {}; PCT.fvEscena = api; PCT.visor3dEscenas = PCT.visor3dEscenas || {}; PCT.visor3dEscenas.fv = api; }
  void BLANCO; void CABLEADO; void EQUIPOS;
})();
