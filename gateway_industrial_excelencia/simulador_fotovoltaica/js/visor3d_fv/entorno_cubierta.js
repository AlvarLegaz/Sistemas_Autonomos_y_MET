// Entorno de la cubierta en 3D (DISEÑADOR): suelo de impermeabilizante, pretil con barandilla blanca, césped artificial con losas, bloques de hormigón, tuberías y conductos
// de fondo, unidad exterior de aire acondicionado, el edificio de detrás, y a lo lejos la ciudad de Cartagena y el monte. El cielo es una cúpula con degradado que sigue al sol
// (color según su altura y la nubosidad), con disco solar, estrellas de noche y nubes que aparecen con la nubosidad. Todo procedural.
(function () {
  const K = typeof require !== 'undefined' ? require('./kit.js') : PCT.fvKit;
  const D = typeof require !== 'undefined' ? require('./disposicion.js') : PCT.fvDisposicion;
  const Base = typeof require !== 'undefined' ? require('./base_fv.js') : PCT.fvBase;
  const CU = D.CUBIERTA;
  const RADIO_CIELO = 7000, Y_CALLE = -1600;

  /** Generador pseudoaleatorio repetible. */
  const azarDe = semilla => { let s = semilla >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
  /** Edificios del fondo (función pura): [{ x, z, ancho, fondo, alto (techo, y), color: 'ocre' | 'blanco' | 'rosa' | 'ladrillo' }] en un anillo alrededor de la cubierta, sin pisarla. */
  function edificiosDeFondo(n = 44) {
    const azar = azarDe(31), lista = [], colores = ['ocre', 'blanco', 'rosa', 'ladrillo', 'ocre', 'blanco'];
    let intentos = 0;
    while (lista.length < n && intentos++ < 800) {
      const ang = azar() * Math.PI * 2, r = 2300 + azar() * 3600, x = 25 + Math.cos(ang) * r * 1.15, z = -125 + Math.sin(ang) * r;
      const ancho = 380 + azar() * 520, fondo = 340 + azar() * 420, alto = -520 + azar() * 760;
      if (x > CU.x0 - 1500 && x < CU.x1 + 1500 && z > CU.z0 - 1500 && z < CU.z1 + 1800 && Math.hypot(x - 25, z + 125) < 2000) continue;
      lista.push({ x, z, ancho, fondo, alto, color: colores[Math.floor(azar() * colores.length)] });
    }
    return lista;
  }

  function pintarFachada(ctx, w, h) {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    const cols = 6, filas = 10, cw = w / cols, ch = h / filas;
    for (let f = 0; f < filas; f++) for (let c = 0; c < cols; c++) {
      ctx.fillStyle = 'rgba(40,52,66,0.78)'; ctx.fillRect(c * cw + cw * 0.22, f * ch + ch * 0.2, cw * 0.56, ch * 0.5);
      ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(c * cw + cw * 0.18, f * ch + ch * 0.7, cw * 0.64, ch * 0.06);
    }
  }
  function pintarEdificioNorte(ctx, w, h) {
    ctx.fillStyle = '#ddd7c4'; ctx.fillRect(0, 0, w, h);
    for (let f = 0; f < 6; f++) for (let c = 0; c < 22; c++) {
      ctx.fillStyle = '#34414f'; ctx.fillRect(c * (w / 22) + 6, 50 + f * 84, w / 22 - 12, 44);
      ctx.fillStyle = '#c9c2ae'; ctx.fillRect(c * (w / 22) + 3, 96 + f * 84, w / 22 - 6, 4);
    }
    ctx.fillStyle = 'rgba(120,110,90,0.18)'; for (let i = 0; i < 40; i++) ctx.fillRect(Math.random() * w, Math.random() * h, 60, 6);
  }

  function crear(THREE) {
    const kit = K.crearKit(THREE), base = Base.crearBase(kit);
    const { grupo } = base, sinTexturas = typeof document === 'undefined';
    const sinRayo = m => { m.raycast = () => {}; return m; };
    const textura = (parametros, rx, ry) => {
      if (sinTexturas) return null;
      const t = kit.registrar(new THREE.CanvasTexture(K.lienzoRuido(parametros)));
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
    };
    const plano = (w, d, material, x, y, z) => { const m = sinRayo(new THREE.Mesh(kit.registrar(new THREE.PlaneGeometry(w, d)), material)); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; grupo.add(m); return m; };
    const anchoC = CU.x1 - CU.x0, fondoC = CU.z1 - CU.z0, cx = (CU.x0 + CU.x1) / 2, cz = (CU.z0 + CU.z1) / 2;

    /* ---------- Suelo: impermeabilizante gris con juntas de la lámina ---------- */
    const mapaSuelo = textura({ n: 256, base: '#757b80', manchas: 120, contraste: 9, grano: 5000, semilla: 3, radioMax: 0.05 }, anchoC / 200, fondoC / 200);
    const matSuelo = mapaSuelo ? kit.matDinamico(0xffffff, { map: mapaSuelo, roughness: 0.95, metalness: 0 }) : kit.matDinamico('impermeable');
    plano(anchoC, fondoC, matSuelo, cx, 0, cz);
    const e = kit.ensamble();
    for (let x = CU.x0 + 60; x < CU.x1; x += 100) e.caja(1.2, 0.2, fondoC, 'impermeableClaro', [x, 0.12, cz]);                  // solapes de la lámina
    e.caja(anchoC, 0.2, 30, 'impermeableClaro', [cx, 0.12, CU.z1 - 15]).caja(30, 0.2, fondoC, 'impermeableClaro', [CU.x1 - 15, 0.12, cz]).caja(30, 0.2, fondoC, 'impermeableClaro', [CU.x0 + 15, 0.12, cz]);

    /* ---------- Pretil y barandilla blanca (sur, este y oeste) ---------- */
    const hp = CU.alturaPretil;
    e.caja(anchoC + 50, hp, 24, 'hormigon', [cx + 25, hp / 2, CU.z1 + 12]);
    e.caja(24, hp, fondoC + 24, 'hormigon', [CU.x1 + 12, hp / 2, cz + 12]).caja(24, hp, fondoC + 24, 'hormigon', [CU.x0 - 12, hp / 2, cz + 12]);
    e.caja(anchoC + 56, 3, 28, 'hormigonOscuro', [cx + 25, hp + 1.5, CU.z1 + 12]);
    e.caja(28, 3, fondoC + 28, 'hormigonOscuro', [CU.x1 + 12, hp + 1.5, cz + 12]).caja(28, 3, fondoC + 28, 'hormigonOscuro', [CU.x0 - 12, hp + 1.5, cz + 12]);
    const alt = CU.alturaBarandilla, yb = hp + 3, BLANCO = 0xeceef0;
    // barandilla de tubo blanco: montantes redondos con placa de anclaje y tres tubos horizontales (como en las fotos), con una escuadra de refuerzo cada pocos montantes
    const poste = (x, z, k) => {
      e.add(kit.cil(2.1, alt, 8), BLANCO, [x, yb + alt / 2, z]); e.caja(12, 0.8, 12, 'galvanizado', [x, yb + 0.4, z]);
      for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) e.add(kit.cil(0.55, 0.8, 6), 'galvanizado', [x + dx, yb + 1.0, z + dz]);
      e.add(kit.esfera(2.3, 6), BLANCO, [x, yb + alt + 0.4, z]);
      if (k % 3 === 0) e.add(kit.cil(0.9, 38, 6), BLANCO, [x, yb + 16, z - 12], [0.55, 0, 0]);
    };
    for (let x = CU.x0 - 12; x <= CU.x1 + 12; x += 160) poste(x, CU.z1 + 12, Math.round((x - CU.x0) / 160));
    for (let z = CU.z0; z <= CU.z1; z += 160) { poste(CU.x1 + 12, z, 1); poste(CU.x0 - 12, z, 1); }
    for (const h of [0.35, 0.7, 1.0]) {
      e.add(kit.cil(1.7, anchoC + 50, 8), BLANCO, [cx + 25, yb + alt * h - 1, CU.z1 + 12], [0, 0, Math.PI / 2]);
      e.add(kit.cil(1.7, fondoC + 24, 8), BLANCO, [CU.x1 + 12, yb + alt * h - 1, cz + 12], [Math.PI / 2, 0, 0]).add(kit.cil(1.7, fondoC + 24, 8), BLANCO, [CU.x0 - 12, yb + alt * h - 1, cz + 12], [Math.PI / 2, 0, 0]);
    }

    /* ---------- Edificio del norte con tuberías y conductos de fondo ---------- */
    const zN = CU.z0, tFach = sinTexturas ? null : (() => { const c = document.createElement('canvas'); c.width = 1400; c.height = 560; pintarEdificioNorte(c.getContext('2d'), 1400, 560); const t = kit.registrar(new THREE.CanvasTexture(c)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; })();
    e.caja(2300, 1000, 20, 0xd8d2c0, [25, 500, zN - 10]).caja(2300, 40, 60, 0xb9b4a6, [25, 1010, zN - 20]);
    e.caja(2300, 70, 40, 0xe6e2d6, [25, 4, zN - 20]);
    if (tFach) { const f = sinRayo(new THREE.Mesh(kit.registrar(new THREE.PlaneGeometry(2300, 920)), kit.matDinamico(0xffffff, { map: tFach, roughness: 0.9, metalness: 0 }))); f.position.set(25, 540, zN + 0.4); f.receiveShadow = true; grupo.add(f); }
    // conducto grande de chapa galvanizada, tuberías de PVC gris y pasamuros
    e.add(kit.cil(27, 2000, 18), 'galvanizado', [25, 250, zN + 60], [0, 0, Math.PI / 2]);
    for (let x = -900; x < 1000; x += 260) { e.caja(8, 6, 40, 'grisOscuro', [x, 280, zN + 60]); e.caja(4, 270, 4, 'grisOscuro', [x, 140, zN + 60]); }
    e.add(kit.cil(5.5, 1900, 10), 0x8e9398, [25, 12, zN + 22], [0, 0, Math.PI / 2]);
    e.add(kit.cil(3.6, 1800, 8), 0x8e9398, [25, 34, zN + 18], [0, 0, Math.PI / 2]);
    for (const x of [-980, -720, -300, 140, 420, 800, 960]) { e.add(kit.cil(5.5, 40, 10), 0x8e9398, [x, 18, zN + 22]); }
    e.add(kit.cil(5.5, 90, 10), 0x7d776b, [-880, 12, -520], [0, 0, Math.PI / 2 + 0.1]).add(kit.cil(5.5, 70, 10), 0x7d776b, [-865, 12, -440], [0, 0, Math.PI / 2 - 0.3]);   // tubos tirados
    e.add(kit.cil(3, 300, 8), 'galvanizado', [900, 150, -420]).caja(26, 8, 8, 'negro', [900, 300, -420]);                       // mástil de la estación meteorológica
    // unidad exterior del aire acondicionado, junto al pretil de la izquierda
    e.caja(32, 74, 88, 0xe8e6e0, [-936, 37, -150]).caja(30, 4, 86, 0xcfcdc7, [-936, 76, -150]);
    e.add(kit.cil(27, 1.4, 20), 'negro', [-919.5, 40, -150], [0, 0, Math.PI / 2]);
    for (let k = 0; k < 4; k++) e.add(kit.caja(0.6, 52, 1.2), 'galvanizado', [-918.6, 40, -150], [k * Math.PI / 4, 0, 0]);
    e.add(kit.cil(3, 3, 8), 'galvanizado', [-919, 40, -150], [0, 0, Math.PI / 2]);
    // bobina de cable de la acometida, enrollada en el suelo junto a la caseta
    for (let k = 0; k < 4; k++) e.add(kit.toro(36 - k * 0.5, 2.6, Math.PI * 2, 16), 'grisOscuro', [-505, 2.6 + k * 4.8, -400], [Math.PI / 2, 0, 0]);
    // bloques de hormigón sueltos por la cubierta (con dos huecos) y losas de la cubierta sobre el césped
    const bloques = [[-585, 110, 0.4], [-571, 112, 0.2], [-460, 120, 1.2], [60, -390, 0.2], [80, -190, 1.5], [660, 40, 0.6], [690, 55, 0.7], [-120, 150, 0.3], [-950, 60, 0.5], [540, -330, 0.2]];
    for (const [x, z, giro] of bloques) {
      e.add(kit.caja(39, 14, 19), 'hormigon', [x, 7, z], [0, giro, 0]);
      for (const dx of [-9, 9]) e.add(kit.caja(11, 0.3, 9), 'hormigonOscuro', [x + dx * Math.cos(giro), 14.05, z - dx * Math.sin(giro)], [0, giro, 0]);
    }
    e.construir(grupo, null, { sinRayo: false });

    /* ---------- Césped artificial y losas ---------- */
    const mapaCesped = textura({ n: 128, base: '#3a6d2b', manchas: 60, contraste: 14, grano: 1800, semilla: 8, radioMax: 0.06 }, 5, 5);
    const matCesped = mapaCesped ? kit.matDinamico(0xe4ecde, { map: mapaCesped, roughness: 1, metalness: 0 }) : kit.matDinamico('cesped');
    const parches = [[-900, -560, -216, 200], [-1000 + 4, -940, -690, 430], [660, 740, -330, 300], [-540, -440, -216, 80]];
    for (const [x0, x1, z0, z1] of parches) plano(x1 - x0, z1 - z0, matCesped, (x0 + x1) / 2, 0.45, (z0 + z1) / 2);
    const el = kit.ensamble();
    for (const [x, z, g] of [[-700, 150, 0.15], [-640, 60, -0.1], [700, 220, 0.3], [-960, -300, 0.05]]) {
      el.caja(62, 5, 62, 'hormigon', [x, 3.4, z], [0, g, 0]);
      el.caja(64, 1.4, 64, 0xb9d5b6, [x, 0.9, z], [0, g, 0]);
    }
    el.construir(grupo, null);

    /* ---------- Lejanía: calle, edificios de Cartagena, árboles y monte ---------- */
    const matCalle = kit.matDinamico(0x56595c);
    plano(24000, 24000, matCalle, 0, Y_CALLE, 0);
    const colorEdificio = { ocre: 0xd8b57a, blanco: 0xe6e3dc, rosa: 0xd9a98c, ladrillo: 0xa9573c };
    const matsEd = {};
    const facha = (() => { if (sinTexturas) return null; const c = document.createElement('canvas'); c.width = 128; c.height = 256; pintarFachada(c.getContext('2d'), 128, 256); const t = kit.registrar(new THREE.CanvasTexture(c)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; })();
    for (const [k, c] of Object.entries(colorEdificio)) matsEd[k] = kit.matDinamico(c, facha ? { map: facha, roughness: 0.9, metalness: 0 } : {});
    for (const b of edificiosDeFondo()) {
      const alto = b.alto - Y_CALLE, m = new THREE.Mesh(kit.registrar(new THREE.BoxGeometry(b.ancho, alto, b.fondo)), matsEd[b.color]);
      m.position.set(b.x, Y_CALLE + alto / 2, b.z); m.raycast = () => {}; grupo.add(m);
    }
    // El edificio que hay DEBAJO de la cubierta: sin él la cubierta parecía una losa flotando sobre la calle cuando la cámara bajaba al borde (se veía el vacío y los otros edificios por debajo)
    {
      const w = anchoC + 48, d = CU.z1 + 24 - zN, h = -0.6 - Y_CALLE;
      const matCara = (rx, ry) => {
        if (!facha) return matsEd.blanco;
        const t = kit.registrar(facha.clone()); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
        return kit.matDinamico(colorEdificio.blanco, { map: t, roughness: 0.9, metalness: 0 });
      };
      const lado = matCara(d / 520, h / 640), frente = matCara(w / 520, h / 640);
      const cuerpo = new THREE.Mesh(kit.registrar(new THREE.BoxGeometry(w, h, d)), [lado, lado, matsEd.blanco, matsEd.blanco, frente, frente]);
      cuerpo.position.set((CU.x0 + CU.x1) / 2, Y_CALLE + h / 2, (zN + CU.z1 + 24) / 2); cuerpo.raycast = () => {}; grupo.add(cuerpo);
    }
    const eA = kit.ensamble(), azar = azarDe(77);
    for (let i = 0; i < 46; i++) {                                                                           // árboles y pinos de la calle, sobre todo al sur
      const x = -1800 + azar() * 3800, z = 700 + azar() * 1500, r = 90 + azar() * 90;
      eA.add(kit.cil(10, 140, 6), 0x5a4630, [x, Y_CALLE + 70, z]); eA.add(kit.esfera(r, 7), azar() < 0.5 ? 0x4b7a3a : 0x3c6b34, [x, Y_CALLE + 140 + r * 0.8, z]);
    }
    for (const [x, z, rx, ry, col, h] of [[3800, 3900, 1900, 2200, 0x9b8b64, 0], [-4200, 4300, 1500, 1500, 0xa39a85, 0], [900, 6300, 2600, 1100, 0x9aa294, 0]]) {
      const cerro = new THREE.Mesh(kit.registrar(new THREE.SphereGeometry(1, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2)), kit.matDinamico(col));
      cerro.scale.set(rx, ry, rx); cerro.position.set(x, Y_CALLE, z); cerro.raycast = () => {}; grupo.add(cerro); void h;
    }
    eA.construir(grupo, null, { sombras: false });

    /* ---------- Cielo: cúpula con degradado, disco solar, estrellas y nubes ---------- */
    const geoCielo = kit.registrar(new THREE.SphereGeometry(RADIO_CIELO, 24, 16));
    const nV = geoCielo.attributes.position.count, colores = new Float32Array(nV * 3);
    geoCielo.setAttribute('color', new THREE.BufferAttribute(colores, 3));
    const cielo = sinRayo(new THREE.Mesh(geoCielo, kit.registrar(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false }))));
    cielo.renderOrder = -10; cielo.frustumCulled = false; grupo.add(cielo);
    const matSol = kit.registrar(new THREE.MeshBasicMaterial({ color: 0xfff6dc, toneMapped: false, fog: false }));
    const disco = sinRayo(new THREE.Mesh(kit.registrar(new THREE.SphereGeometry(110, 14, 8)), matSol)); disco.frustumCulled = false; grupo.add(disco);
    const matAureola = kit.registrar(new THREE.MeshBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false }));
    const aureola = sinRayo(new THREE.Mesh(kit.registrar(new THREE.SphereGeometry(330, 14, 8)), matAureola)); aureola.frustumCulled = false; grupo.add(aureola);
    const estrellasPos = new Float32Array(240 * 3);
    for (let i = 0; i < 240; i++) { const a = azar() * Math.PI * 2, el2 = Math.asin(0.08 + azar() * 0.92), r = RADIO_CIELO * 0.96; estrellasPos.set([r * Math.cos(el2) * Math.cos(a), r * Math.sin(el2), r * Math.cos(el2) * Math.sin(a)], i * 3); }
    const geoEst = kit.registrar(new THREE.BufferGeometry()); geoEst.setAttribute('position', new THREE.BufferAttribute(estrellasPos, 3));
    const matEst = kit.registrar(new THREE.PointsMaterial({ color: 0xffffff, size: 2.4, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    const estrellas = sinRayo(new THREE.Points(geoEst, matEst)); estrellas.frustumCulled = false; grupo.add(estrellas);
    const matNube = kit.registrar(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, fog: false }));
    const geoNube = kit.registrar(new THREE.SphereGeometry(1, 9, 5)), nubes = [];
    for (let i = 0; i < 16; i++) {
      const g = new THREE.Group(), a = azar() * Math.PI * 2, el2 = 0.1 + azar() * 0.7, r = RADIO_CIELO * 0.9;
      g.position.set(r * Math.cos(el2) * Math.cos(a), r * Math.sin(el2), r * Math.cos(el2) * Math.sin(a)); g.lookAt(0, 0, 0);
      for (let k = 0; k < 4; k++) { const p = new THREE.Mesh(geoNube, matNube); p.scale.set(420 + azar() * 380, 120 + azar() * 70, 90); p.position.set((k - 1.5) * 380 + azar() * 90, azar() * 80, 0); p.raycast = () => {}; g.add(p); }
      g.visible = false; g.userData.umbral = i / 16; grupo.add(g); nubes.push(g);
    }
    let firmaCielo = null;
    function pintarCielo(alt, nub) {
      const { cenit, horizonte } = K.coloresCielo(alt, nub), pos = geoCielo.attributes.position, cA = [(cenit >> 16 & 255) / 255, (cenit >> 8 & 255) / 255, (cenit & 255) / 255], cH = [(horizonte >> 16 & 255) / 255, (horizonte >> 8 & 255) / 255, (horizonte & 255) / 255];
      for (let i = 0; i < nV; i++) {
        const h = Math.max(0, pos.getY(i) / RADIO_CIELO), t = Math.pow(h, 0.55), oscuro = pos.getY(i) < 0 ? 0.7 : 1;
        for (let c = 0; c < 3; c++) colores[i * 3 + c] = (cH[c] + (cA[c] - cH[c]) * t) * oscuro;
      }
      geoCielo.attributes.color.needsUpdate = true;
    }
    pintarCielo(45, 0.1);
    base.alActualizar(estado => {
      const luz = K.luzSolar(estado), dir = K.direccionSol(estado && estado.sol), alt = luz.altura, nub = luz.nubosidad;
      const f = `${Math.round(alt * 2)}|${Math.round(nub * 20)}`;
      if (f !== firmaCielo) {
        firmaCielo = f; pintarCielo(alt, nub);
        matNube.color.setHex(K.mezclarHex(0x232b3c, 0xffffff, luz.dia * (1 - 0.35 * nub))); matNube.opacity = 0.45 + 0.5 * luz.dia;
        matEst.opacity = 0.9 * luz.estrellas * (1 - nub);
        nubes.forEach(n => { n.visible = n.userData.umbral < nub * 1.25 + (nub > 0.02 ? 0.05 : -1); });
      }
      disco.position.set(dir.x * 6500, dir.y * 6500, dir.z * 6500); aureola.position.copy(disco.position);
      disco.visible = aureola.visible = alt > -3 && nub < 0.92;
      matSol.color.setHex(K.mezclarHex(0xff8a3a, 0xfff6dc, K.suavizar(0, 25, alt))); matAureola.opacity = 0.22 * (1 - nub);
    });

    function liberar() { kit.liberar(); }
    return { grupo, elementos: base.elementos, actualizar: base.actualizar, finalizar: base.finalizar, liberar, kit, cielo, disco };
  }

  const api = { crear, edificiosDeFondo, RADIO_CIELO, Y_CALLE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else { window.PCT = window.PCT || {}; PCT.fvEntorno = api; }
})();
