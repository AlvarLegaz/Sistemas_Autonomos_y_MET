// Pruebas de la luz y los materiales del 3D de la planta (DISEÑADOR): nivel de calidad, parámetros PBR, entorno procedural, presets de luz y la escena
// construida con el THREE real del simulador (con un DOM falso mínimo para los canvas), en calidad alta y bajando a baja en caliente.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const K = require('../js/visor3d_htst/kit.js');
const ESC = require('../js/visor3d_htst/escena_planta.js');

function cargarThree() {
  const ventana = {};
  new Function('window', fs.readFileSync(path.join(__dirname, '../../simulador_pct23/js/vendor/three.js'), 'utf8'))(ventana);
  return ventana.THREE;
}
const THREE = cargarThree();

// Contexto 2D falso: acepta cualquier llamada y cuenta los rectángulos y paradas de degradado pintados.
function contextoFalso() {
  const cuenta = { rect: 0, paradas: 0, degradados: 0 };
  const ctx = new Proxy({ cuenta }, {
    get(o, k) {
      if (k in o) return o[k];
      if (k === 'createLinearGradient') return () => { cuenta.degradados++; return { addColorStop() { cuenta.paradas++; } }; };
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'fillRect') return () => { cuenta.rect++; };
      return () => {};
    },
    set() { return true; },
  });
  return ctx;
}
function conDocumentoFalso(fn) {
  const antes = global.document;
  global.document = { createElement: () => ({ width: 0, height: 0, getContext: () => contextoFalso() }) };
  try { return fn(); } finally { if (antes === undefined) delete global.document; else global.document = antes; }
}

/* ---------- funciones puras ---------- */
test('calidad: lo forzado manda; sin forzar, el dibujo por software o un visor lento dan baja', () => {
  assert.equal(K.elegirCalidad({ forzada: 'alta', porSoftware: true }), 'alta');
  assert.equal(K.elegirCalidad({ forzada: 'baja' }), 'baja');
  assert.equal(K.elegirCalidad({ porSoftware: true }), 'baja');
  assert.equal(K.elegirCalidad({ lento: true }), 'baja');
  assert.equal(K.elegirCalidad({}), 'alta');
  assert.equal(K.elegirCalidad(), 'alta');
  assert.equal(K.elegirCalidad({ forzada: 'ultra' }), 'alta', 'un valor desconocido no fuerza nada');
});

test('PBR: el inox es metal brillante, la goma y el plástico no son metal y lo translúcido es vidrio o líquido', () => {
  assert.ok(K.parametrosPBR('inox').metalness > 0.8 && K.parametrosPBR('inox').roughness < 0.35);
  assert.ok(K.parametrosPBR('inoxMate').roughness > K.parametrosPBR('inox').roughness, 'el cepillado es más rugoso');
  assert.equal(K.parametrosPBR('junta').metalness, 0);
  assert.ok(K.parametrosPBR('junta').roughness > 0.8);
  assert.equal(K.parametrosPBR('negro').metalness, 0);
  assert.ok(K.parametrosPBR('laton').metalness > 0.9);
  const liquido = K.parametrosPBR(0x3a8fd0, { transparent: true, opacity: 0.5 });
  assert.equal(liquido.metalness, 0); assert.ok(liquido.roughness < 0.2);
  assert.equal(K.parametrosPBR(0xffffff, { map: {} }).metalness, 0, 'una cara con textura (manómetro, placa) es plástico');
});

test('PBR: por color, un gris azulado claro es acero y la pintura de colores vivos no lo es', () => {
  assert.ok(K.pareceAcero(0xc3cbd3));
  assert.ok(K.pareceAcero(0xa7b0b8));
  assert.ok(!K.pareceAcero(0x1f5fa8), 'azul de motor');
  assert.ok(!K.pareceAcero(0xc0392b), 'rojo');
  assert.ok(!K.pareceAcero(0xf2f0e6), 'blanco cálido');
  assert.ok(!K.pareceAcero(0x2a2f36), 'oscuro');
  assert.ok(K.parametrosPBR(0xc3cbd3).metalness > 0.8);
  assert.ok(K.parametrosPBR(0xc0392b).metalness < 0.2);
});

test('especificación de material: baja es Lambert sin propiedades PBR; alta es Standard con ellas; lo explícito manda', () => {
  const b = K.especificacionMaterial('inox', { metalness: 0.5, roughness: 0.5, envMapIntensity: 2, transparent: true }, 'baja');
  assert.equal(b.clase, 'MeshLambertMaterial');
  assert.deepEqual(Object.keys(b.props).sort(), ['color', 'transparent'], 'sin metalness/roughness: Lambert avisaría por consola');
  assert.equal(b.props.color, K.PALETA.inox);
  const a = K.especificacionMaterial('inox', {}, 'alta');
  assert.equal(a.clase, 'MeshStandardMaterial');
  assert.equal(a.props.color, K.PALETA.inox); assert.equal(a.props.metalness, K.PBR.inox.metalness);
  const e = K.especificacionMaterial('inox', { roughness: 0.9 }, 'alta');
  assert.equal(e.props.roughness, 0.9, 'un parámetro explícito pisa al de la tabla');
  assert.equal(K.especificacionMaterial(0xabcdef, {}, 'otra').clase, 'MeshLambertMaterial', 'una calidad desconocida es baja');
});

test('entorno: cada una de las seis caras se pinta con rectángulos y degradados, sin lanzar', () => {
  assert.deepEqual(K.CARAS_ENTORNO, ['px', 'nx', 'py', 'ny', 'pz', 'nz']);
  for (const cara of K.CARAS_ENTORNO) {
    const ctx = contextoFalso();
    K.pintarCaraEntorno(ctx, cara, 64);
    assert.ok(ctx.cuenta.rect >= 2, `${cara}: pocos rectángulos`);
    assert.ok(ctx.cuenta.degradados >= 1 && ctx.cuenta.paradas >= 2, `${cara}: sin degradado`);
  }
  const techo = contextoFalso(); K.pintarCaraEntorno(techo, 'py', 64);
  const suelo = contextoFalso(); K.pintarCaraEntorno(suelo, 'ny', 64);
  assert.ok(techo.cuenta.rect > suelo.cuenta.rect, 'el techo lleva las luminarias y las correas');
});

test('luz: baja repite la iluminación de siempre del visor; alta añade sol con sombras, luminarias y tone mapping', () => {
  const b = ESC.lucesDeCalidad('baja'), a = ESC.lucesDeCalidad('alta');
  assert.equal(b.hemi.intensidad, 1.15); assert.equal(b.sol.intensidad, 1.6); assert.equal(b.contra.intensidad, 0.7);
  assert.equal(b.sol.sombras, false); assert.equal(b.luminarias, null);
  assert.equal(b.render.toneMapping, 'ninguno'); assert.equal(b.render.sombras, false);
  assert.equal(a.sol.sombras, true); assert.equal(a.render.sombras, true);
  assert.equal(a.luminarias.x.length, 3); assert.equal(a.luminarias.z.length, 3);
  assert.ok(['aces', 'neutral'].includes(a.render.toneMapping));
  assert.ok(a.render.exposicion > 0.6 && a.render.exposicion < 1.6, 'exposición razonable');
  assert.equal(ESC.lucesDeCalidad('rara'), b, 'cualquier valor desconocido es baja');
  // el techo de la nave (360 cm) debe quedar por encima de las luminarias
  assert.ok(a.luminarias.altura < ESC.NAVE.altoPared);
});

/* ---------- kit con THREE real ---------- */
test('kit: sin estilo fijado todo es Lambert (como siempre); con estilo alta, Standard con el entorno y LED sin tone mapping', () => {
  K.fijarEstilo({ calidad: 'baja' });
  const k0 = K.crearKit(THREE);
  assert.ok(k0.mat('inox').isMeshLambertMaterial && k0.matDinamico(0x123456).isMeshLambertMaterial);
  assert.equal(k0.matLed(0xff0000).toneMapped, true);
  k0.liberar();
  const entorno = { isTexture: true, dispose() {} };
  K.fijarEstilo({ calidad: 'alta', envMap: entorno });
  try {
    const k1 = K.crearKit(THREE);
    const inox = k1.mat('inox');
    assert.ok(inox.isMeshStandardMaterial);
    assert.ok(inox.metalness > 0.8); assert.equal(inox.envMap, entorno);
    assert.equal(k1.mat('inox'), inox, 'mat() guarda en caché por clave');
    const pintura = k1.matDinamico(0xc0392b);
    assert.ok(pintura.metalness < 0.2);
    const vidrio = k1.matDinamico(0x9fc4d9, { transparent: true, opacity: 0.35, depthWrite: false });
    assert.equal(vidrio.transparent, true); assert.equal(vidrio.opacity, 0.35); assert.ok(vidrio.roughness < 0.2);
    assert.equal(k1.matLed(0xff0000).toneMapped, false);
    pintura.color.setHex(0x2e9e55); pintura.opacity = 0.5;                       // los módulos recolorean y hacen translúcidos sus materiales: tiene que seguir siendo posible
    assert.equal(pintura.color.getHex(), 0x2e9e55);
    k1.liberar();
  } finally { K.fijarEstilo({ calidad: 'baja' }); }
  assert.equal(K.estiloActual().calidad, 'baja'); assert.equal(K.estiloActual().envMap, null);
});

test('estilo: con calidad baja el entorno se ignora aunque se pase', () => {
  K.fijarEstilo({ calidad: 'baja', envMap: { isTexture: true } });
  assert.equal(K.estiloActual().envMap, null);
  K.fijarEstilo({ calidad: 'rara' });
  assert.equal(K.estiloActual().calidad, 'baja');
});

/* ---------- escena completa ---------- */
test('escena en calidad alta: luces propias, sombras, materiales Standard con entorno; baja en caliente y se libera', () => {
  conDocumentoFalso(() => {
    const escena = ESC.crearEscena(THREE, 'HTST', { calidad: 'alta' });
    try {
      assert.equal(escena.calidad, 'alta'); assert.equal(escena.iluminacionPropia, true);
      const luces = escena.luces.children.filter(o => o.isLight);
      assert.equal(luces.filter(l => l.isPointLight).length, 3, 'tres luminarias de techo');
      assert.ok(luces.some(l => l.isHemisphereLight) && luces.filter(l => l.isDirectionalLight).length === 2);
      const sol = luces.find(l => l.isDirectionalLight && l.castShadow);
      assert.ok(sol, 'el sol proyecta sombras'); assert.equal(sol.shadow.mapSize.x, 2048);
      assert.equal(escena.ajustesRender().sombras, true);
      let estandar = 0, lambert = 0, proyectan = 0, reciben = 0, conEntorno = 0;
      escena.raiz.traverse(o => {
        if (!(o.isMesh || o.isInstancedMesh)) return;
        const m = o.material;
        if (m.isMeshStandardMaterial) { estandar++; if (m.envMap) conEntorno++; }
        if (m.isMeshLambertMaterial) lambert++;
        if (o.castShadow) proyectan++;
        if (o.receiveShadow) reciben++;
      });
      assert.ok(estandar > 100, `materiales PBR: ${estandar}`); assert.ok(lambert < estandar * 0.2, `los Lambert sueltos (placas con textura de otros módulos) son pocos: ${lambert}`);
      assert.ok(conEntorno > estandar * 0.9, 'casi todo lleva el mapa de entorno');
      assert.ok(proyectan > 100 && reciben > 100, `sombras: ${proyectan} proyectan, ${reciben} reciben`);
      // el suelo lleva textura y rugosidad moteada
      const suelo = escena.raiz.children.find(o => o.isMesh && o.material.roughnessMap);
      assert.ok(suelo && suelo.material.map, 'suelo de resina con mapa de color y de rugosidad');
      assert.equal(escena.ponerCalidad('alta'), 'alta', 'no se sube de nivel en caliente');

      assert.equal(escena.ponerCalidad('baja'), 'baja');
      assert.equal(escena.calidad, 'baja');
      assert.equal(escena.ajustesRender().toneMapping, 'ninguno'); assert.equal(escena.ajustesRender().sombras, false);
      assert.ok(!sol.castShadow); assert.equal(sol.intensity, 1.6);
      assert.ok(luces.filter(l => l.isPointLight).every(l => !l.visible), 'luminarias apagadas');
      let restos = 0;
      escena.raiz.traverse(o => {
        if (!(o.isMesh || o.isInstancedMesh)) return;
        if (o.castShadow || o.receiveShadow) restos++;
        if (o.material.isMeshStandardMaterial && (o.material.envMap || o.material.metalness !== 0)) restos++;
      });
      assert.equal(restos, 0, 'sin sombras ni entorno ni metal tras bajar la calidad');
    } finally { escena.liberar(); }
    assert.equal(K.estiloActual().calidad, 'baja', 'liberar deja el estilo global en baja');
  });
});

test('escena en calidad baja: todo Lambert, sin entorno, sombras ni tone mapping, con las luces de siempre', () => {
  conDocumentoFalso(() => {
    const escena = ESC.crearEscena(THREE, 'HTST', { calidad: 'baja' });
    try {
      assert.equal(escena.calidad, 'baja');
      let otros = 0, sombras = 0;
      escena.raiz.traverse(o => {
        if (!(o.isMesh || o.isInstancedMesh)) return;
        if (o.material.isMeshStandardMaterial) otros++;
        if (o.castShadow) sombras++;
      });
      assert.equal(otros, 0); assert.equal(sombras, 0);
      const luces = escena.luces.children.filter(o => o.isLight);
      assert.equal(luces.length, 3, 'hemisférica, sol y contraluz');
      assert.equal(escena.ajustesRender().toneMapping, 'ninguno');
      assert.equal(escena.ponerCalidad('baja'), 'baja', 'bajar estando ya en baja no hace nada');
    } finally { escena.liberar(); }
  });
});

test('escena por software: sin forzar, porSoftware da calidad baja', () => {
  conDocumentoFalso(() => {
    const escena = ESC.crearEscena(THREE, 'HTST', { porSoftware: true });
    try { assert.equal(escena.calidad, 'baja'); } finally { escena.liberar(); }
    const buena = ESC.crearEscena(THREE, 'HTST', {});
    try { assert.equal(buena.calidad, 'alta'); } finally { buena.liberar(); }
  });
});
