// Caseta metálica de la cubierta en 3D (DISEÑADOR): chapa gris pardo nervada con puerta corredera ABIERTA, tejado a dos aguas con canalón blanco, rejillas de ventilación,
// y por dentro el tablero crema con las canaletas blancas («Unex», «Efapel»), el césped del suelo, cajas de registro y trastos. Elemento CAS-001 (solo la carcasa).
// «Corte» vuelve translúcidas las paredes y el tejado; «Tapa» quita el tejado; la avería de ventilación tapada pone tapas sobre las rejillas.
(function () {
  const K = typeof require !== 'undefined' ? require('./kit.js') : PCT.fvKit;
  const D = typeof require !== 'undefined' ? require('./disposicion.js') : PCT.fvDisposicion;
  const Base = typeof require !== 'undefined' ? require('./base_fv.js') : PCT.fvBase;
  const C = D.CASETA;

  function pintarUnex(ctx, w, h) {
    ctx.fillStyle = '#f4f4f1'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) {
      const x = (i + 0.5) * w / 6;
      ctx.fillStyle = '#d6212b'; ctx.beginPath(); ctx.ellipse(x, h / 2, w / 15, h * 0.36, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.font = `800 ${Math.round(h * 0.42)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('Unex', x, h / 2 + 1);
    }
  }
  function pintarEfapel(ctx, w, h) {
    ctx.fillStyle = '#f3f4f4'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1d3f8f'; ctx.font = `800 ${Math.round(h * 0.34)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let f = 0; f < 2; f++) for (let i = 0; i < 8; i++) ctx.fillText('EFAPEL', (i + 0.5 + (f ? 0.5 : 0)) * w / 8, h * (f ? 0.74 : 0.28));
  }

  function crear(THREE) {
    const kit = K.crearKit(THREE), base = Base.crearBase(kit);
    const g = base.nuevoGrupo('CAS-001', null, [C.x, 0, C.z]);
    const raiz = new THREE.Group(); raiz.position.set(C.x, 0, C.z); base.grupo.add(raiz);   // decorado interior (sin elemento propio)
    const hw = C.ancho / 2, hd = C.fondo / 2, hm = C.altoMuro;
    // Materiales propios de la carcasa (translúcidos en la vista «Corte»)
    const matMuro = kit.matDinamico('taupe'), matNervio = kit.matDinamico('taupeClaro'), matTecho = kit.matDinamico(0x9b9283), matMarco = kit.matDinamico('blanco');
    const translucidos = [matMuro, matNervio, matTecho, matMarco];

    const ens = kit.ensamble();
    // Muros (chapa de 1 cm): norte, este, oeste y sur con el hueco de la puerta
    ens.caja(C.ancho, hm, 1, matMuro, [0, hm / 2, -hd + 0.5]);
    ens.caja(1, hm, C.fondo, matMuro, [hw - 0.5, hm / 2, 0]); ens.caja(1, hm, C.fondo, matMuro, [-hw + 0.5, hm / 2, 0]);
    ens.caja(hw + C.puerta.x0, hm, 1, matMuro, [(-hw + C.puerta.x0) / 2, hm / 2, hd - 0.5]);
    ens.caja(hw - C.puerta.x1, hm, 1, matMuro, [(hw + C.puerta.x1) / 2, hm / 2, hd - 0.5]);
    ens.caja(C.puerta.x1 - C.puerta.x0, hm - C.puerta.alto, 1, matMuro, [(C.puerta.x0 + C.puerta.x1) / 2, (hm + C.puerta.alto) / 2, hd - 0.5]);
    // Nervios verticales de la chapa (cada 14 cm) en las caras exteriores
    for (let x = -hw + 12; x < hw - 6; x += 14) { ens.caja(2.6, hm - 6, 0.9, matNervio, [x, hm / 2, -hd - 0.4]); }
    for (let z = -hd + 12; z < hd - 6; z += 14) for (const s of [-1, 1]) ens.caja(0.9, hm - 6, 2.6, matNervio, [s * (hw + 0.4), hm / 2, z]);
    for (let x = -hw + 12; x < -hw + 70; x += 14) ens.caja(2.6, hm - 6, 0.9, matNervio, [x, hm / 2, hd + 0.4]);
    for (let x = C.puerta.x1 + 8; x < hw - 6; x += 14) ens.caja(2.6, hm - 6, 0.9, matNervio, [x, hm / 2, hd + 0.4]);
    // Tejado a dos aguas: dos faldones con vuelo, cumbrera, canalón blanco y los frontones triangulares
    const alfa = Math.atan((C.altoCumbrera - hm - 0.5) / (hd + 6)), largo = (hd + 6) / Math.cos(alfa);
    ens.caja(C.ancho + 12, 2.2, largo, matTecho, [0, hm + 0.8 + (C.altoCumbrera - hm) / 2 * 0.98, -(hd + 6) / 2], [-alfa, 0, 0]);
    ens.caja(C.ancho + 12, 2.2, largo, matTecho, [0, hm + 0.8 + (C.altoCumbrera - hm) / 2 * 0.98, (hd + 6) / 2], [alfa, 0, 0]);
    ens.caja(C.ancho + 13, 3, 7, matMarco, [0, C.altoCumbrera + 0.6, 0]);
    for (const s of [-1, 1]) {
      ens.caja(C.ancho + 12, 4, 4.5, matMarco, [0, hm - 1, s * (hd + 5)]);
      ens.add(kit.prisma([[-hd, hm], [hd, hm], [0, C.altoCumbrera]], 1), matMuro, [s * (hw - 0.5), 0, 0]);
    }
    // Puerta corredera ABIERTA: marco de aluminio blanco, carril en el suelo y dos hojas corridas por fuera del muro (la A 70 cm a la izquierda y la B 35 a la derecha)
    ens.caja(4, C.puerta.alto, 3, matMarco, [C.puerta.x0, C.puerta.alto / 2, hd + 1]).caja(4, C.puerta.alto, 3, matMarco, [C.puerta.x1, C.puerta.alto / 2, hd + 1]);
    ens.caja(C.puerta.x1 - C.puerta.x0 + 4, 4, 3, matMarco, [(C.puerta.x0 + C.puerta.x1) / 2, C.puerta.alto + 2, hd + 1]);
    ens.caja(C.puerta.x1 - C.puerta.x0 + 8, 3, 8, 'galvanizado', [0, 1.5, hd + 3]);
    ens.caja(C.ancho + 4, 4, 8, 'galvanizado', [0, 2, hd + 4.5]);                            // zócalo galvanizado a todo lo ancho
    const hojas = [[-105, 0], [70, 0]];
    for (const [x] of hojas) {
      ens.caja(70, C.puerta.alto - 4, 1.6, matMuro, [x, C.puerta.alto / 2 + 2, hd + 6.5]);
      ens.caja(3, C.puerta.alto - 4, 2.4, matMarco, [x - 33, C.puerta.alto / 2 + 2, hd + 6.5]).caja(3, C.puerta.alto - 4, 2.4, matMarco, [x + 33, C.puerta.alto / 2 + 2, hd + 6.5]);
      for (let k = -28; k <= 28; k += 14) ens.caja(2.4, C.puerta.alto - 12, 0.8, matNervio, [x + k, C.puerta.alto / 2 + 2, hd + 7.6]);
    }
    ens.caja(3.2, 14, 3, matMarco, [-105 + 34, 100, hd + 8.5]).caja(3.2, 14, 3, matMarco, [70 - 34, 100, hd + 8.5]);     // tiradores
    // Rejillas de ventilación blancas (dos hojas con lamas) en lo alto de las paredes este y oeste: por fuera y por dentro
    const rejillas = [{ s: 1, z: -20 }, { s: -1, z: -10 }];
    for (const { s, z } of rejillas) for (const lado of [1, -1]) {
      const x = s * (hw + (lado > 0 ? 1.1 : -1.2));
      for (const dz of [-9.5, 9.5]) {
        ens.caja(1.4, 14, 17.5, 'blanco', [x, 183, z + dz]);
        for (let k = 0; k < 5; k++) ens.caja(1.0, 1.1, 15, 'gris', [x + s * lado * 0.6, 178.5 + k * 2.6, z + dz]);
      }
    }
    const mallasCarcasa = ens.construir(g, 'CAS-001');
    const mallaTecho = mallasCarcasa.find(m => m.material === matTecho);

    // Tapas de la avería «ventilación tapada» (cartón o plástico sobre las rejillas, por fuera)
    const tapas = new THREE.Group(); g.add(tapas);
    const matTapa = kit.matDinamico(0x6b5a45);
    for (const { s, z } of rejillas) { const t = kit.malla(kit.caja(1.2, 18, 42), matTapa, tapas, 'CAS-001', [s * (hw + 2.6), 183, z]); t.castShadow = true; }
    tapas.visible = false;
    base.alCambiarEfectos('CAS-001', e => { tapas.visible = e.has('ventilacion_tapada'); });

    /* ---------- Interior (en `raiz`, coordenadas locales de la caseta) ---------- */
    const ensI = kit.ensamble(), ht = C.altoTablero, zN = D.SEMI.zN, xE = D.SEMI.x;
    ensI.caja(2 * xE, ht, 1, 'crema', [0, ht / 2, zN - 0.5]);
    ensI.caja(1, ht, 2 * -zN, 'crema', [xE + 0.5, ht / 2, 0]).caja(1, ht, 2 * -zN, 'crema', [-xE - 0.5, ht / 2, 0]);
    for (const x of [-138, -90, -42, 6, 54, 102]) ensI.caja(0.5, ht, 0.3, 'cremaOscuro', [x + 0.5, ht / 2, zN + 0.1]);          // juntas del tablero
    for (const z of [-70, 0, 70]) for (const s of [-1, 1]) ensI.caja(0.3, ht, 0.5, 'cremaOscuro', [s * (xE - 0.1), ht / 2, z]);
    ensI.caja(1.2, ht, 1.2, 'tierra', [xE - 0.6, ht / 2, zN + 0.6]).caja(1.2, ht, 1.2, 'tierra', [-xE + 0.6, ht / 2, zN + 0.6]);  // cantos de tablero (aglomerado)
    // chapa interior gris verdosa sobre el tablero
    ensI.caja(2 * xE, C.altoMuro - ht, 0.4, 'interiorMetal', [0, (C.altoMuro + ht) / 2, zN - 0.7]);
    ensI.caja(0.4, C.altoMuro - ht, 2 * -zN, 'interiorMetal', [xE + 0.7, (C.altoMuro + ht) / 2, 0]).caja(0.4, C.altoMuro - ht, 2 * -zN, 'interiorMetal', [-xE - 0.7, (C.altoMuro + ht) / 2, 0]);
    // canaletas: «Unex» arriba del tablero (cinta con el nombre) y «Efapel» a media altura; tira vertical «Unex» junto a la caja de continua
    const UNEX = { y0: ht, alto: 10, prof: 2.5 }, EFA = { y0: 88, alto: 6.5, prof: 5 };
    ensI.caja(2 * xE, UNEX.alto, UNEX.prof, 'blanco', [0, UNEX.y0 + UNEX.alto / 2, zN + UNEX.prof / 2]);
    ensI.caja(UNEX.prof, UNEX.alto, 2 * -zN, 'blanco', [xE - UNEX.prof / 2, UNEX.y0 + UNEX.alto / 2, 0]).caja(UNEX.prof, UNEX.alto, 2 * -zN, 'blanco', [-xE + UNEX.prof / 2, UNEX.y0 + UNEX.alto / 2, 0]);
    ensI.caja(2 * xE, EFA.alto, EFA.prof, 'blanco', [0, EFA.y0 + EFA.alto / 2, zN + EFA.prof / 2]);
    ensI.caja(EFA.prof, EFA.alto, 2 * -zN, 'blanco', [xE - EFA.prof / 2, EFA.y0 + EFA.alto / 2, 0]).caja(EFA.prof, EFA.alto, 2 * -zN, 'blanco', [-xE + EFA.prof / 2, EFA.y0 + EFA.alto / 2, 0]);
    ensI.caja(5, 72, 3, 'blanco', [-12, 94.5 + 36, zN + 1.5]);
    // suelo de césped artificial y zócalo galvanizado de la puerta
    ensI.construir(raiz, 'CAS-001', { sinRayo: false });
    const matCesped = kit.matDinamico('cesped');
    const cesped = kit.malla(new THREE.PlaneGeometry(2 * xE, 2 * hd - 6), matCesped, raiz, null, [0, 0.7, 0], [-Math.PI / 2, 0, 0]); cesped.receiveShadow = true; cesped.raycast = () => {};
    const unex = kit.pantalla(512, 64, pintarUnex), efapel = kit.pantalla(512, 64, pintarEfapel);
    const plano = (w, h, tex, pos, giro) => {
      if (!tex) return null;
      const m = kit.malla(new THREE.PlaneGeometry(w, h), kit.matDinamico(0xffffff, { map: tex.textura }), raiz, null, pos, [0, giro, 0]); m.raycast = () => {}; return m;
    };
    plano(2 * xE, UNEX.alto, unex, [0, UNEX.y0 + UNEX.alto / 2, zN + UNEX.prof + 0.05], 0);
    plano(2 * -zN, UNEX.alto, unex, [xE - UNEX.prof - 0.05, UNEX.y0 + UNEX.alto / 2, 0], -Math.PI / 2);
    plano(2 * -zN, UNEX.alto, unex, [-xE + UNEX.prof + 0.05, UNEX.y0 + UNEX.alto / 2, 0], Math.PI / 2);
    plano(2 * xE, EFA.alto, efapel, [0, EFA.y0 + EFA.alto / 2, zN + EFA.prof + 0.05], 0);
    plano(2 * -zN, EFA.alto, efapel, [xE - EFA.prof - 0.05, EFA.y0 + EFA.alto / 2, 0], -Math.PI / 2);
    plano(2 * -zN, EFA.alto, efapel, [-xE + EFA.prof + 0.05, EFA.y0 + EFA.alto / 2, 0], Math.PI / 2);
    plano(5, 72, unex, [-12, 94.5 + 36, zN + 3.05], 0);

    // Cajas de registro blancas (decorado) y trastos del suelo
    const ensD = kit.ensamble();
    for (const [nombre, def] of Object.entries(D.DECORADO)) {
      if (!nombre.startsWith('caja_registro')) continue;
      const a = D.anclaje(def), m = def.ancho / 2;
      // construida en su marco de pared y colocada con un grupo
      const gg = new THREE.Group(); gg.position.set(a.pos[0], a.pos[1], a.pos[2]); gg.rotation.y = a.giro; raiz.add(gg);
      const e2 = kit.ensamble();
      e2.caja(def.ancho, def.alto, def.fondo, 'blancoCaja', [0, def.alto / 2, def.fondo / 2]);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) e2.add(kit.cil(0.9, 1, 8), 'gris', [sx * (m - 2), def.alto / 2 + sy * (def.alto / 2 - 2), def.fondo + 0.3], [Math.PI / 2, 0, 0]);
      e2.caja(def.ancho - 3, 0.6, def.fondo - 2, 'blanco', [0, 3, def.fondo - 4]);
      e2.construir(gg, 'CAS-001');
    }
    const caja1 = D.DECORADO.caja_herramientas.caja;                                        // caja de herramientas azul verdosa con tapa de metal
    ensD.caja(caja1.x1 - caja1.x0, 14, caja1.z1 - caja1.z0, 0x2f8a88, [(caja1.x0 + caja1.x1) / 2, 7, (caja1.z0 + caja1.z1) / 2]);
    ensD.caja(caja1.x1 - caja1.x0 - 2, 6, caja1.z1 - caja1.z0 - 2, 0xf0a040, [(caja1.x0 + caja1.x1) / 2, 17, (caja1.z0 + caja1.z1) / 2]);
    ensD.caja(14, 3, 3, 'negro', [(caja1.x0 + caja1.x1) / 2, 21.5, (caja1.z0 + caja1.z1) / 2]);
    ensD.construir(raiz, null);

    // Elemento CAS-001 también para el interior (para que «Ver en 3D» de la caseta incluya el tablero y las canaletas)
    g.add(raiz); base.grupo.remove(raiz);
    raiz.position.set(0, 0, 0);

    /* ---------- Vistas ---------- */
    let corte = false, tapa = true;
    function ponerCorte(v) {
      corte = !!v;
      for (const m of translucidos) { m.transparent = corte; m.opacity = corte ? 0.16 : 1; m.depthWrite = !corte; m.needsUpdate = true; }
      ponerTapa(tapa);
    }
    function ponerTapa(v) {
      tapa = !!v;
      if (mallaTecho) mallaTecho.visible = tapa;
    }
    /** Abre/cierra el tejado: en «Corte» el tejado se ve translúcido igualmente. */
    const tejadoVisible = () => tapa;

    base.alActualizar(() => {});
    function liberar() { kit.liberar(); }
    return { grupo: base.grupo, elementos: base.elementos, actualizar: base.actualizar, finalizar: base.finalizar, liberar, ponerCorte, ponerTapa, tejadoVisible, kit,
      materialesCorte: translucidos, grupoInterior: raiz };
  }

  const api = { crear, pintarUnex, pintarEfapel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else { window.PCT = window.PCT || {}; PCT.fvCaseta = api; }
})();
