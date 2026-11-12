// Escena de la planta HTST completa en 3D (DISEÑADOR): el patín con todos los equipos de proceso, las tuberías con flujo, los instrumentos y el armario
// eléctrico. Mismo contrato que escena.js/planta3d.js del visor de la maqueta (raiz, elementos, actualizar(lecturas, estado), resaltar, ponerCorte,
// ponerTapa, mallasSeleccionables, liberar, vistaInicial), de modo que se registra como PCT.visor3dEscenas.htst (ARQUITECTURA.md §7.2).
// Rendimiento: materiales Lambert, sin sombras ni antialias, geometrías fusionadas por equipo y placas instanciadas.
(function () {
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.htstLayout;
  const modulos = () => (typeof require !== 'undefined'
    ? [require('./equipos_proceso.js'), require('./tuberias.js'), require('./instrumentos.js'), require('./armario.js')]
    : [PCT.htstEquiposProceso, PCT.htstTuberias, PCT.htstInstrumentos3d, PCT.htstArmario]);
  const INTERIORES = typeof require !== 'undefined' ? require('./interiores.js') : PCT.htstInteriores;
  const TUB = typeof require !== 'undefined' ? require('./tuberias.js') : PCT.htstTuberias;
  const INS = typeof require !== 'undefined' ? require('./instrumentos.js') : PCT.htstInstrumentos3d;
  const { SKID } = layout;

  /* ---------- Nave: canaleta de desagüe delante del patín y pasillo marcado (cm; el suelo de la nave está en y = -SKID.alto) ---------- */
  const NAVE = { ancho: 900, fondo: 800, zPared: -400, altoPared: 360, canaleta: { z: SKID.fondo / 2 + 32, ancho: 22, largo: SKID.ancho + 40 } };

  // Distancia en planta (x, z) de un punto a un segmento.
  function distanciaPlanta(px, pz, a, b) {
    const dx = b[0] - a[0], dz = b[2] - a[2], l2 = dx * dx + dz * dz;
    const t = l2 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[2]) * dz) / l2)) : 0;
    return Math.hypot(px - (a[0] + t * dx), pz - (a[2] + t * dz));
  }

  /**
   * Soportes de tubería (función pura): un poste vertical desde la bancada bajo cada tramo horizontal alto (y ≥ 60 cm) y largo (≥ 60 cm), en el punto
   * medio o, si ahí estorba, al 30 % o al 70 %. Un poste no puede atravesar un equipo (caja del layout + 4 cm), pasar a menos de 5 cm de otro tubo más
   * bajo ni de un montante, ni pisar un instrumento. Devuelve [{ x, z, y (altura del eje del tubo), eje: 'x' | 'z', ruta }].
   */
  function soportesTuberia(rutas = TUB.RUTAS) {
    const cajas = layout.EQUIPOS.map(e => ({ tag: e.tag, p: layout.posicion(e.tag) })).filter(c => c.p && c.p.ancho && !c.p.fueraDelPatin);
    const instrumentos = INS.TAGS.map(t => INS.montaje(t)).filter(Boolean);
    const tramos = [];
    for (const r of rutas) for (let i = 1; i < r.puntos.length; i++) tramos.push({ id: r.id, a: r.puntos[i - 1], b: r.puntos[i] });
    const soportes = [];
    const libre = (x, z, y, id) => {
      if (Math.abs(x) > SKID.ancho / 2 - 6 || Math.abs(z) > SKID.fondo / 2 - 6) return false;
      if (cajas.some(c => Math.abs(x - c.p.x) < c.p.ancho / 2 + 4 && Math.abs(z - c.p.z) < c.p.fondo / 2 + 4)) return false;
      if (instrumentos.some(m => Math.hypot(x - m[0], z - m[2]) < 9 && m[1] < y)) return false;
      for (const t of tramos) {
        if (t.id === id && Math.min(t.a[1], t.b[1]) >= y - 0.1) continue;                 // su propio tramo
        const bajo = Math.min(t.a[1], t.b[1]);
        if (bajo < y - 1 && distanciaPlanta(x, z, t.a, t.b) < 5) return false;          // tubo o montante por debajo del soporte
      }
      if (soportes.some(s => Math.hypot(s.x - x, s.z - z) < 12)) return false;
      return true;
    };
    for (const r of rutas) {
      if (r.fluido === 'aire') continue;
      for (let i = 1; i < r.puntos.length; i++) {
        const a = r.puntos[i - 1], b = r.puntos[i];
        if (Math.abs(a[1] - b[1]) > 1e-6 || a[1] < 60) continue;
        const largo = Math.hypot(b[0] - a[0], b[2] - a[2]);
        if (largo < 60) continue;
        // un soporte cada ~1,1 m; cada uno busca sitio cerca de su punto ideal
        const n = Math.max(1, Math.floor(largo / 110)), paso = 1 / n;
        for (let k = 0; k < n; k++) {
          const ideal = (k + 0.5) * paso;
          for (const d of [0, -0.12, 0.12, -0.24, 0.24, -0.36, 0.36]) {
            const t = ideal + d * paso;
            if (t < 0.08 || t > 0.92) continue;
            const x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t;
            if (libre(x, z, a[1], r.id)) { soportes.push({ x, z, y: a[1], eje: Math.abs(b[0] - a[0]) > 1e-6 ? 'x' : 'z', ruta: r.id }); break; }
          }
        }
      }
    }
    return soportes;
  }

  /**
   * Pórticos de tuberías (función pura): marcos de dos postes en los bordes del patín (z = ±(fondo/2 − 5)) con una viga a lo largo de z a ALTO_PORTICO;
   * de la viga cuelgan varillas hasta cada tubo alto (y ≥ 60) que la cruza a lo largo de x. Se eligen las `cuantos` posiciones x que más tubos cuelgan,
   * separadas ≥ 80 cm, cuyos postes no pisan equipos ni tubos y cuya viga no choca con ningún instrumento.
   * Devuelve [{ x, colgantes: [{ z, y, ruta }] }].
   */
  const ALTO_PORTICO = 116;
  function porticosTuberia(rutas = TUB.RUTAS, cuantos = 2) {
    const zPoste = SKID.fondo / 2 - 5;
    const cajas = layout.EQUIPOS.map(e => layout.posicion(e.tag)).filter(p => p && p.ancho && !p.fueraDelPatin);
    const tramos = [];
    for (const r of rutas) for (let i = 1; i < r.puntos.length; i++) tramos.push({ id: r.id, fluido: r.fluido, a: r.puntos[i - 1], b: r.puntos[i] });
    const instrumentos = INS.TAGS.map(t => INS.montaje(t)).filter(Boolean);
    const posteLibre = (x, z) => !cajas.some(p => Math.abs(x - p.x) < p.ancho / 2 + 5 && Math.abs(z - p.z) < p.fondo / 2 + 5)
      && !tramos.some(t => distanciaPlanta(x, z, t.a, t.b) < 6);
    const candidatos = [];
    for (let x = -SKID.ancho / 2 + 20; x <= SKID.ancho / 2 - 20; x += 5) {
      if (!posteLibre(x, zPoste) || !posteLibre(x, -zPoste)) continue;
      if (instrumentos.some(m => Math.abs(m[0] - x) < 7 && m[1] + 26 > ALTO_PORTICO - 4)) continue;
      if (tramos.some(t => (t.a[1] > ALTO_PORTICO - 6 || t.b[1] > ALTO_PORTICO - 6) && distanciaPlanta(x, 0, [t.a[0], 0, -99], [t.b[0], 0, 99]) < 6)) continue;
      const colgantes = [];
      for (const t of tramos) {
        if (t.fluido === 'aire' || Math.abs(t.a[1] - t.b[1]) > 1e-6 || t.a[1] < 60 || Math.abs(t.a[2] - t.b[2]) > 1e-6) continue;   // solo tramos altos a lo largo de x
        if (x > Math.min(t.a[0], t.b[0]) + 6 && x < Math.max(t.a[0], t.b[0]) - 6 && Math.abs(t.a[2]) < zPoste - 3) colgantes.push({ z: t.a[2], y: t.a[1], ruta: t.id });
      }
      // dos tubos en la misma vertical: solo cuelga el de arriba (la varilla del de abajo lo atravesaría)
      const unicos = colgantes.filter(c => !colgantes.some(o => o !== c && Math.abs(o.z - c.z) < 5 && o.y > c.y));
      if (unicos.length) candidatos.push({ x, colgantes: unicos });
    }
    candidatos.sort((p, q) => q.colgantes.length - p.colgantes.length || Math.abs(p.x) - Math.abs(q.x));
    const elegidos = [];
    for (const c of candidatos) { if (elegidos.length >= cuantos) break; if (elegidos.every(e => Math.abs(e.x - c.x) >= 80)) elegidos.push(c); }
    return elegidos.sort((p, q) => p.x - q.x);
  }

  function crearEscena(THREE) {
    const raiz = new THREE.Group();
    const recursos = [];
    const guardar = r => { recursos.push(r); return r; };
    const mat = (color, opciones = {}) => guardar(new THREE.MeshLambertMaterial(Object.assign({ color }, opciones)));
    const caja = (w, h, d, material, x, y, z) => { const m = new THREE.Mesh(guardar(new THREE.BoxGeometry(w, h, d)), material); m.position.set(x, y, z); raiz.add(m); return m; };

    // Patín de acero inoxidable (cubierta con borde de bandeja de recogida, vigas y patas) y suelo de la sala.
    const matPatin = mat(0x8c969f), matViga = mat(0x6d767f), matSuelo = mat(0x4a545b);
    caja(SKID.ancho, 2, SKID.fondo, matPatin, 0, -1, 0);
    for (const sz of [-1, 1]) caja(SKID.ancho, 3, 2, matPatin, 0, 1.5, sz * (SKID.fondo / 2 - 1));            // borde de la bandeja
    for (const sx of [-1, 1]) caja(2, 3, SKID.fondo, matPatin, sx * (SKID.ancho / 2 - 1), 1.5, 0);
    for (const z of [-60, 0, 60]) caja(SKID.ancho - 8, 6, 5, matViga, 0, -5, z);                                // vigas
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) caja(8, SKID.alto - 6, 8, matViga, sx * (SKID.ancho / 2 - 10), -SKID.alto / 2 - 3, sz * (SKID.fondo / 2 - 10));   // patas
    // Nave: suelo de resina epoxi gris, pared del fondo de panel sándwich blanco con zócalo, tuberías de servicios en la pared,
    // pasillo marcado en amarillo y canaleta de desagüe con rejilla delante del patín (la bandeja del patín desagua en ella).
    const Y0 = -SKID.alto, sinRayo = m => { m.raycast = () => {}; return m; };
    const plano = (w, d, material, x, y, z) => { const m = sinRayo(new THREE.Mesh(guardar(new THREE.PlaneGeometry(w, d)), material)); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); raiz.add(m); return m; };
    plano(NAVE.ancho, NAVE.fondo, matSuelo, 0, Y0, NAVE.zPared + NAVE.fondo / 2);
    const matPared = mat(0xc9cfd3), matJunta = mat(0xa9b0b5), matZocalo = mat(0x6f7b84);
    sinRayo(caja(NAVE.ancho, NAVE.altoPared, 4, matPared, 0, Y0 + NAVE.altoPared / 2, NAVE.zPared - 2));
    for (let x = -NAVE.ancho / 2 + 110; x < NAVE.ancho / 2; x += 110) sinRayo(caja(1.2, NAVE.altoPared, 0.6, matJunta, x, Y0 + NAVE.altoPared / 2, NAVE.zPared + 0.4));   // juntas de los paneles
    sinRayo(caja(NAVE.ancho, 30, 3, matZocalo, 0, Y0 + 15, NAVE.zPared + 1.5));                                                                    // zócalo sanitario
    // tuberías de servicios en la pared (vapor, aire comprimido, agua de red), con ménsulas y bandas de color por fluido
    const SERVICIOS = [[230, 0x9aa3ab, 0xc0392b], [212, 0x9aa3ab, 0x2e86de], [194, 0x9aa3ab, 0x27ae60]];
    for (const [y, color, banda] of SERVICIOS) {
      const tubo = sinRayo(new THREE.Mesh(guardar(new THREE.CylinderGeometry(3, 3, NAVE.ancho - 40, 12)), mat(color)));
      tubo.rotation.z = Math.PI / 2; tubo.position.set(0, Y0 + y, NAVE.zPared + 12); raiz.add(tubo);
      for (let x = -NAVE.ancho / 2 + 60; x < NAVE.ancho / 2 - 40; x += 160) {
        const b = sinRayo(new THREE.Mesh(guardar(new THREE.CylinderGeometry(3.4, 3.4, 8, 12)), mat(banda))); b.rotation.z = Math.PI / 2; b.position.set(x + 40, Y0 + y, NAVE.zPared + 12); raiz.add(b);
        sinRayo(caja(2, 2, 12, matZocalo, x, Y0 + y - 4, NAVE.zPared + 6));
      }
    }
    // Rótulo de la pared del fondo: logo del CIFP Politécnico de Cartagena y «Mantenimiento electrónico» (el logo se carga aparte: el rótulo sale con el texto y el logo se pinta al llegar)
    {
      const lz = document.createElement('canvas'); lz.width = 1536; lz.height = 340;
      const c = lz.getContext('2d'), tx = guardar(new THREE.CanvasTexture(lz)); tx.colorSpace = THREE.SRGBColorSpace;
      const pintar = logo => {
        c.fillStyle = '#f4f6f7'; c.fillRect(0, 0, 1536, 340); c.fillStyle = '#f68b11'; c.fillRect(0, 326, 1536, 14);
        if (logo) { const alto = 190, ancho = alto * (logo.naturalWidth || 166) / (logo.naturalHeight || 60); c.drawImage(logo, 50, 60, ancho, alto); }
        c.fillStyle = '#5a5758'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.font = '800 98px system-ui, sans-serif';
        c.fillText('MANTENIMIENTO', 640, 120); c.fillText('ELECTRÓNICO', 640, 235);
        tx.needsUpdate = true;
      };
      pintar(null);
      if (typeof Image !== 'undefined') { const logo = new Image(); logo.onload = () => pintar(logo); logo.src = '/simulador/img/logo-politecnico.png'; }
      const ROTULO = { ancho: 480, alto: 106, y: Y0 + 290 }, zR = NAVE.zPared + 1.4;
      const rotulo = sinRayo(new THREE.Mesh(guardar(new THREE.PlaneGeometry(ROTULO.ancho, ROTULO.alto)), guardar(new THREE.MeshBasicMaterial({ map: tx }))));
      rotulo.position.set(0, ROTULO.y, zR + 1.2); raiz.add(rotulo);                                          // delante del marco (cuya cara llega a zR + 0,7)
      sinRayo(caja(ROTULO.ancho + 8, ROTULO.alto + 8, 1.4, matZocalo, 0, ROTULO.y, zR));                     // marco
    }
    // pasillo marcado: rectángulo amarillo alrededor del patín y del armario
    const matAmarillo = mat(0xd6b11e), xa = -SKID.ancho / 2 - 40, xb = 270, za = -SKID.fondo / 2 - 40, zb = NAVE.canaleta.z + NAVE.canaleta.ancho / 2 + 16;
    for (const [w, d, x, z] of [[xb - xa, 6, (xa + xb) / 2, za], [xb - xa, 6, (xa + xb) / 2, zb], [6, zb - za, xa, (za + zb) / 2], [6, zb - za, xb, (za + zb) / 2]]) plano(w, d, matAmarillo, x, Y0 + 0.15, z);
    // canaleta: fondo oscuro, bordes de acero y rejilla de pletinas (una malla instanciada)
    const C = NAVE.canaleta, matCanal = mat(0x23292e), matRejilla = mat(0x9aa3ab);
    plano(C.largo, C.ancho, matCanal, 0, Y0 + 0.08, C.z);
    for (const s of [-1, 1]) sinRayo(caja(C.largo, 1.2, 1.6, matRejilla, 0, Y0 + 0.6, C.z + s * (C.ancho / 2 + 0.8)));
    const pletinas = Math.floor(C.largo / 3.2);
    const rejillaCanal = sinRayo(new THREE.InstancedMesh(guardar(new THREE.BoxGeometry(0.6, 1, C.ancho)), matRejilla, pletinas));
    const mR = new THREE.Matrix4();
    for (let i = 0; i < pletinas; i++) { mR.setPosition(-C.largo / 2 + 1.6 + i * 3.2, Y0 + 0.6, C.z); rejillaCanal.setMatrixAt(i, mR); }
    raiz.add(rejillaCanal);
    // desagüe de la bandeja del patín: bajante por debajo de la bancada hasta la canaleta
    const matDesague = mat(0x7d8790);
    const bajante = sinRayo(new THREE.Mesh(guardar(new THREE.CylinderGeometry(2.4, 2.4, SKID.alto - 4, 10)), matDesague)); bajante.position.set(40, -SKID.alto / 2 - 2, SKID.fondo / 2 - 12); raiz.add(bajante);
    const ramal = sinRayo(new THREE.Mesh(guardar(new THREE.CylinderGeometry(2.4, 2.4, C.z - (SKID.fondo / 2 - 12), 10)), matDesague));
    ramal.rotation.x = Math.PI / 2; ramal.position.set(40, Y0 + 3, (C.z + SKID.fondo / 2 - 12) / 2); raiz.add(ramal);

    // Soportes de tubería: poste de inox desde la bancada con placa de anclaje, brazo y abrazadera bajo cada tramo alto (ver soportesTuberia)
    const matSoporte = mat(0xa7b0b8), radioTubo = TUB.RADIO_TUBO_CM;
    for (const s of soportesTuberia()) {
      const alto = s.y - radioTubo - 1.2;
      sinRayo(caja(8, 0.8, 8, matSoporte, s.x, 0.4, s.z));
      sinRayo(caja(3.2, alto, 3.2, matSoporte, s.x, alto / 2, s.z));
      sinRayo(s.eje === 'x' ? caja(3.2, 1.2, 10, matSoporte, s.x, alto + 0.6, s.z) : caja(10, 1.2, 3.2, matSoporte, s.x, alto + 0.6, s.z));
      const abrazadera = sinRayo(new THREE.Mesh(guardar(new THREE.TorusGeometry(radioTubo + 0.7, 0.45, 6, 14, Math.PI)), matSoporte));
      abrazadera.position.set(s.x, s.y, s.z); abrazadera.rotation.set(0, s.eje === 'x' ? Math.PI / 2 : 0, Math.PI); raiz.add(abrazadera);
    }

    // Pórticos: dos postes, viga y varillas con abrazadera hasta cada tubo que cruza (ver porticosTuberia)
    const zP = SKID.fondo / 2 - 5;
    for (const p of porticosTuberia()) {
      for (const s of [-1, 1]) { sinRayo(caja(10, 0.8, 10, matSoporte, p.x, 0.4, s * zP)); sinRayo(caja(4, ALTO_PORTICO, 4, matSoporte, p.x, ALTO_PORTICO / 2, s * zP)); }
      sinRayo(caja(4, 4, 2 * zP + 4, matSoporte, p.x, ALTO_PORTICO + 2, 0));
      for (const c of p.colgantes) {
        const largo = ALTO_PORTICO - c.y - radioTubo;
        sinRayo(caja(0.9, largo, 0.9, matSoporte, p.x, c.y + radioTubo + largo / 2, c.z));
        const ab = sinRayo(new THREE.Mesh(guardar(new THREE.TorusGeometry(radioTubo + 0.7, 0.45, 6, 14)), matSoporte));
        ab.position.set(p.x, c.y, c.z); ab.rotation.y = Math.PI / 2; raiz.add(ab);
      }
    }

    // Placas de identificación (acero con el tag grabado) en los equipos principales
    function placa(texto, nombre, x, y, z, giroY) {
      const lz = document.createElement('canvas'); lz.width = 256; lz.height = 96;
      const c = lz.getContext('2d');
      c.fillStyle = '#d4d9dd'; c.fillRect(0, 0, 256, 96); c.strokeStyle = '#59626a'; c.lineWidth = 6; c.strokeRect(3, 3, 250, 90);
      c.fillStyle = '#15191c'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = '700 44px system-ui, sans-serif'; c.fillText(texto, 128, 38);
      c.font = '600 20px system-ui, sans-serif'; c.fillText(nombre, 128, 74);
      const tx = guardar(new THREE.CanvasTexture(lz)); tx.colorSpace = THREE.SRGBColorSpace;
      const m = sinRayo(new THREE.Mesh(guardar(new THREE.PlaneGeometry(16, 6)), guardar(new THREE.MeshLambertMaterial({ map: tx }))));
      m.position.set(x, y, z); m.rotation.y = giroY || 0; raiz.add(m);
    }
    placa('TK-101', 'TANQUE DE BALANCE', -135, 52, -1.6, 0);
    placa('HX-101', 'INTERCAMBIADOR', -49.7, 56, -35, -Math.PI / 2);      // en la cara exterior de la placa fija del bastidor
    placa('HW-201', 'AGUA CALIENTE', 20 + 17.3 * Math.sin(0.75), 48, 45 + 17.3 * Math.cos(0.75), 0.75);
    // zócalo bajo el armario (queda fuera del patín)
    const pos = layout.posicion('QE-001');
    caja(76, SKID.alto + 1, 46, matViga, pos.x, -SKID.alto / 2 - 0.5, pos.z);
    // rótulo de la planta en el frente del patín
    const lienzo = document.createElement('canvas'); lienzo.width = 1024; lienzo.height = 96;
    const c2 = lienzo.getContext('2d'); c2.fillStyle = '#aeb8c2'; c2.textBaseline = 'middle';
    const textoRotulo = `${layout.PLANTA.fabrica} · ${layout.PLANTA.corto}`.toLocaleUpperCase('es');        // «LÁCTEOS POLITÉCNICO · EP-01»
    let tamanoRotulo = 54;
    do { c2.font = `700 ${tamanoRotulo}px system-ui, sans-serif`; tamanoRotulo -= 2; } while (c2.measureText(textoRotulo).width > lienzo.width - 24 && tamanoRotulo > 20);      // si no cabe, más pequeño
    c2.fillText(textoRotulo, 12, 50);
    const textura = guardar(new THREE.CanvasTexture(lienzo)); textura.colorSpace = THREE.SRGBColorSpace;
    const rotulo = new THREE.Mesh(guardar(new THREE.PlaneGeometry(130, 12)), guardar(new THREE.MeshBasicMaterial({ map: textura, transparent: true })));
    rotulo.position.set(-90, 0.05, SKID.fondo / 2 - 8); rotulo.rotation.x = -Math.PI / 2; rotulo.raycast = () => {}; raiz.add(rotulo);

    const partes = modulos().map(m => m.crear(THREE));
    const elementos = {};
    for (const parte of partes) { raiz.add(parte.grupo); Object.assign(elementos, parte.elementos); }
    raiz.updateMatrixWorld(true);
    // Vista interior: al seleccionar un equipo (resaltar) se abre por dentro; con otro o con nada se cierra. Por defecto todo se ve sólido.
    const interiores = INTERIORES.crear(THREE, elementos);
    let ultimoAhora = null;

    function actualizar(lecturas, estado) {
      if (!estado) return;
      for (const parte of partes) parte.actualizar(estado, lecturas);
      const ahora = performance.now(), dt = ultimoAhora === null ? 0 : Math.min((ahora - ultimoAhora) / 1000, 0.1); ultimoAhora = ahora;
      interiores.actualizar(estado, dt);
    }

    let contorno = null;
    function resaltar(id) {
      if (contorno) { raiz.remove(contorno); contorno.geometry.dispose(); contorno = null; }
      interiores.abrir(id && elementos[id] ? id : null);
      if (!id || !elementos[id]) return;
      raiz.updateMatrixWorld(true);
      contorno = new THREE.Box3Helper(new THREE.Box3().setFromObject(elementos[id].grupo).expandByScalar(0.8), 0xf68b11);
      raiz.add(contorno);
    }
    // Un solo equipo (botón «Ver en 3D» de la ficha): se oculta todo lo demás de la nave y de la planta, menos el equipo y las ramas que lo llevan.
    // Las luces están fuera de `raiz`, así que no se tocan. `restaurar` lo devuelve todo a su sitio.
    const ocultados = [];
    function restaurar() { for (const o of ocultados) o.visible = true; ocultados.length = 0; }
    function aislar(id) {
      const el = elementos[id];
      if (!el || !el.grupo) return false;
      restaurar();
      for (let n = el.grupo; n !== raiz && n.parent; n = n.parent) {
        for (const hermano of n.parent.children) if (hermano !== n && hermano.visible) { hermano.visible = false; ocultados.push(hermano); }
      }
      return true;
    }
    /** Vista (como `vistaInicial`) centrada en un equipo y a la distancia justa para verlo entero; null si no existe. */
    function vistaDe(id) {
      const el = elementos[id];
      if (!el || !el.grupo) return null;
      raiz.updateMatrixWorld(true);
      const caja = new THREE.Box3().setFromObject(el.grupo), centro = caja.getCenter(new THREE.Vector3()), radio = Math.max(8, caja.getSize(new THREE.Vector3()).length() / 2);
      const distancia = radio * 3.2;      // la cámara es de 38° de campo vertical: con 3,2 radios cabe la esfera que rodea al equipo
      return { azimut: 0.5, elevacion: 0.4, distancia, minimo: Math.max(6, radio * 0.5), maximo: distancia * 3, far: 1100, objetivo: { x: centro.x, y: centro.y, z: centro.z } };
    }
    const visibleEnCadena = o => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };
    function mallasSeleccionables() {
      const lista = [];
      for (const e of Object.values(elementos)) e.grupo.traverse(o => { if ((o.isMesh || o.isInstancedMesh) && o.userData.id) lista.push(o); });
      for (const parte of partes) parte.grupo.traverse(o => { if ((o.isMesh || o.isInstancedMesh) && o.userData.id && !lista.includes(o)) lista.push(o); });
      return ocultados.length ? lista.filter(visibleEnCadena) : lista;       // aislado: lo oculto no se puede seleccionar
    }
    function liberar() {
      interiores.liberar();
      for (const parte of partes) parte.liberar();
      for (const r of recursos) if (r && r.dispose) r.dispose();
      if (contorno) contorno.geometry.dispose();
    }

    // La planta mide 420 cm de punta a punta (con el armario): hace falta una cámara con far ≥ 1100. `vistaInicial.far` lo indica; el visor de la maqueta
    // usa far = 500 fijo, así que el programador de interfaz debe leer `escena.vistaInicial.far || 500` al crear la cámara.
    // «Corte» y «Tapa» del visor: los módulos que las entienden (tuberías: acero translúcido; armario: puerta cerrada y translúcida o quitada) reaccionan.
    const ponerCorte = v => { for (const parte of partes) if (parte.ponerCorte) parte.ponerCorte(!!v); };
    const ponerTapa = v => { for (const parte of partes) if (parte.ponerTapa) parte.ponerTapa(!!v); };
    return { raiz, elementos, actualizar, resaltar, aislar, restaurar, vistaDe, ponerCorte, ponerTapa, mallasSeleccionables, liberar, sombras: false,
      vistaInicial: { azimut: 0.4, elevacion: 0.5, distancia: 470, minimo: 60, maximo: 600, far: 1100, objetivo: { x: 35, y: 35, z: 0 } } };
  }

  const api = { crearEscena, crear: crearEscena, soportesTuberia, porticosTuberia, ALTO_PORTICO, NAVE };
  if (typeof module !== 'undefined') module.exports = api;
  else { window.PCT = window.PCT || {}; PCT.htstEscenaPlanta = api; PCT.visor3dEscenas = PCT.visor3dEscenas || {}; PCT.visor3dEscenas.htst = api; }
})();
