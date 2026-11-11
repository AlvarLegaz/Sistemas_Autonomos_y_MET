// Disposición de la planta 3D: pasa las coordenadas del esquema 2D (viewBox 1000 × 480, ver scada/esquema_pct23.js) al plano de la mesa.
// Contrato común de todos los módulos de planta3d/. Unidades: cm. Ejes: X a la derecha, Z hacia la cámara, Y hacia arriba (la mesa está en Y = 0).
// La disposición sale del diagrama del manual (p. 8 y 12); las distancias son ilustrativas.
(function () {
  const ESCALA = 0.22;                  // cm por unidad del esquema: un depósito de 70 u de ancho mide ≈ 15,5 cm (Ø real 155 mm)
  const CENTRO_PX = { x: 500, y: 240 };
  const ALTURA_TUBO_CM = 3.2;           // eje de las tuberías sobre la mesa
  const MESA = { ancho: 232, fondo: 112, grosor: 2 };

  /** Punto del esquema (px) → plano de la mesa (cm). */
  const aPlano = (xPx, yPx) => ({ x: (xPx - CENTRO_PX.x) * ESCALA, z: (yPx - CENTRO_PX.y) * ESCALA });

  // Centro de cada equipo en el esquema (px). Los depósitos y la heat unit se miden por su caja.
  const POSICIONES_PX = {
    TANKA: { x: 915, y: 140 }, TANKB: { x: 815, y: 140 }, HEAT: { x: 85, y: 105 },
    N1: { x: 720, y: 250 }, N2: { x: 208, y: 150 },
    SOL1: { x: 460, y: 80 }, SOL2: { x: 865, y: 250 }, SOL3: { x: 550, y: 440 }, SOL4: { x: 915, y: 36 }, SOL5: { x: 815, y: 36 },
    V1: { x: 666, y: 440 }, PRV1: { x: 724, y: 440 }, V2: { x: 865, y: 213 }, V3: { x: 803, y: 234 },
    FILTER: { x: 260, y: 207 }, F1: { x: 260, y: 168 }, HOLDING: { x: 370, y: 110 },
    T1: { x: 330, y: 45 }, T2: { x: 175, y: 62 }, T3: { x: 700, y: 400 }, T4: { x: 260, y: 272 }, T5: { x: 513, y: 275 },
    REGEN: { x: 369, y: 341 }, CALENT: { x: 495, y: 341 }, ENFRIA: { x: 621, y: 341 },
  };
  const posicion = id => aPlano(POSICIONES_PX[id].x, POSICIONES_PX[id].y);

  /*
   * Contrato de cada módulo de planta3d/ (equipos.js, tuberias.js, valvulas_instrumentos.js):
   *
   *   crear(THREE, estadoInicial) → { grupo, elementos, actualizar(estado, observaciones), liberar() }
   *
   *   grupo       THREE.Group con todo el módulo, en coordenadas de la mesa (usa aPlano/posicion de este archivo).
   *   elementos   { [id]: { id, grupo, ancla, ayuda } } — un elemento por pieza seleccionable.
   *               id: el del esquema (N1, SOL3, T2, TANKA…); ayuda: clave de PCT.ayudaTextos.ELEMENTOS (casi siempre = id);
   *               ancla: THREE.Vector3 sobre la pieza donde se pondrá su etiqueta.
   *               Todas las mallas seleccionables llevan mesh.userData.id = id.
   *   actualizar  se llama cada fotograma con el estado del simulador y PCT.planta.observaciones(estado): no cree objetos aquí.
   *   liberar     dispose de geometrías, materiales y texturas.
   *
   * Cada módulo es un IIFE con doble exportación (module.exports en Node / PCT.planta3d<Nombre> en el navegador, ver escena.js) y la parte sin
   * THREE (cálculos, trayectorias, textos) en funciones puras exportadas aparte para poder probarlas con node:test.
   */
  const api = { ESCALA, ALTURA_TUBO_CM, MESA, POSICIONES_PX, aPlano, posicion };
  if (typeof module !== 'undefined') module.exports = api; else PCT.planta3dLayout = api;
})();
