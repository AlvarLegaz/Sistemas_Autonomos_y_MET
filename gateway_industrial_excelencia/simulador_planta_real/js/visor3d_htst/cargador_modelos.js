// Punto de carga de modelos .glb (DISEÑADOR). NO implementado a propósito: ARQUITECTURA.md §9 exige permiso explícito del usuario antes de descargar nada.
// Hoy `cargarModelo(tag)` devuelve siempre null, así que cada equipo se queda con su versión procedural. Cuando haya un .glb con licencia compatible
// en `simulador_planta_real/modelos/` y un GLTFLoader (script global aparte, misma versión r169 que js/vendor/three.js), se completaría aquí.
(function () {
  const CATALOGO_URL = 'modelos/CATALOGO.json';       // autor, URL, licencia, fecha y hash de cada modelo (no existe todavía)

  /** Promesa con un THREE.Group para el tag, o null si no hay modelo o falla la carga. El visor no espera: carga en segundo plano y sustituye al terminar. */
  function cargarModelo(tag) { return Promise.resolve(null); }

  /** Cuando haya GLTFLoader y modelos, sustituye el grupo procedural de un equipo por el cargado, conservando su id y su ancla. Hoy no hace nada. */
  function sustituir(elemento, modelo) { return false; }

  const api = { CATALOGO_URL, cargarModelo, sustituir };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstCargadorModelos = api; }
})();
