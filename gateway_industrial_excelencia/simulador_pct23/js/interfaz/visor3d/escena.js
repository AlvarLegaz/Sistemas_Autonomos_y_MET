// Escena 3D de un depósito con Three.js: cuerpo de vidrio, líquido, captadores y conexiones. Unidades: cm.
(function () {
  const { GEOMETRIA, MODELOS } = typeof require !== 'undefined' ? require('./especificaciones.js') : PCT.visor3dEspecificaciones;
  const COLOR = { agua: 0x2f7fc7, calida: 0xf0803a, acento: 0xf68b11, ok: 0x3fb950, inactivo: 0x6b7480, alarma: 0xf85149,
    acero: 0x9aa6b1, oscuro: 0x2a3038, frio: 0x2f7fc7, caliente: 0xd9480f };
  const limitar = (valor, minimo, maximo) => Math.max(minimo, Math.min(maximo, valor));
  const aRadianes = grados => grados * Math.PI / 180;

  function crearEscena(THREE, clave) {
    const modelo = MODELOS[clave];
    const R = GEOMETRIA.diametroCm / 2, H = GEOMETRIA.alturaCm, UTIL = GEOMETRIA.alturaUtilCm;
    const raiz = new THREE.Group();
    const elementos = {};
    const actualizadores = {};
    const recortables = [];
    const recursos = [];
    const planoCorte = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);

    // ---------- utilidades ----------
    const guardar = recurso => { recursos.push(recurso); return recurso; };
    const material = (color, opciones = {}) => guardar(new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.45, metalness: 0.45 }, opciones)));
    const malla = (geometria, mat, padre) => { const m = new THREE.Mesh(guardar(geometria), mat); padre.add(m); return m; };
    const polar = (radio, angulo, altura) => new THREE.Vector3(radio * Math.sin(aRadianes(angulo)), altura, radio * Math.cos(aRadianes(angulo)));
    const orientar = (m, direccion) => m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direccion.clone().normalize());
    const radial = angulo => new THREE.Vector3(Math.sin(aRadianes(angulo)), 0, Math.cos(aRadianes(angulo)));

    // Registra un elemento seleccionable: sus mallas llevan el id para el picking.
    function registrar(id, tipo, grupo, ancla, datos) {
      grupo.traverse(o => { if (o.isMesh) o.userData.id = id; });
      raiz.add(grupo);
      elementos[id] = { id, tipo, grupo, ancla, datos };
    }

    // ---------- cuerpo del depósito ----------
    const base = new THREE.Group(); raiz.add(base);
    malla(new THREE.CylinderGeometry(R + 2.2, R + 2.6, 1.2, 64), material(COLOR.oscuro, { roughness: 0.7 }), base).position.y = -0.6;
    const rejilla = guardar(new THREE.GridHelper(70, 28, 0x39424d, 0x232a31)); rejilla.position.y = -1.25; raiz.add(rejilla);

    const matVidrio = guardar(new THREE.MeshPhysicalMaterial({ color: 0xaed4ff, transparent: true, opacity: 0.17, roughness: 0.08, metalness: 0,
      side: THREE.DoubleSide, depthWrite: false }));
    const vidrio = malla(new THREE.CylinderGeometry(R, R, H, 72, 1, true), matVidrio, raiz); vidrio.position.y = H / 2; vidrio.renderOrder = 3;
    const matBorde = material(0xc9d3dc, { roughness: 0.3 });
    for (const y of [0, H]) { const aro = malla(new THREE.TorusGeometry(R, 0.28, 10, 72), matBorde, raiz); aro.rotation.x = Math.PI / 2; aro.position.y = y; }
    const matTapa = guardar(new THREE.MeshStandardMaterial({ color: 0x3a424b, transparent: true, opacity: 0.38, roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false }));
    const tapa = malla(new THREE.CylinderGeometry(R + 0.5, R + 0.5, 0.7, 72), matTapa, raiz); tapa.position.y = H + 0.35; tapa.renderOrder = 3;
    recortables.push(matVidrio, matTapa);

    // Escala de altura en la pared: marcas cada 5 cm y rótulos cada 10.
    const marcas = [];
    for (let cm = 0; cm <= UTIL; cm += 5) marcas.push(polar(R + 0.02, -8, cm), polar(R + (cm % 10 === 0 ? 0.75 : 0.45), -8, cm));
    const escala = new THREE.LineSegments(guardar(new THREE.BufferGeometry().setFromPoints(marcas)), guardar(new THREE.LineBasicMaterial({ color: 0xdfe6ee })));
    raiz.add(escala);
    function rotulo(texto, posicion) {
      const lienzo = document.createElement('canvas'); lienzo.width = 96; lienzo.height = 48;
      const c = lienzo.getContext('2d'); c.fillStyle = '#e6edf3'; c.font = '600 30px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(texto, 48, 26);
      const textura = guardar(new THREE.CanvasTexture(lienzo));
      const sprite = new THREE.Sprite(guardar(new THREE.SpriteMaterial({ map: textura, depthTest: false, transparent: true })));
      sprite.scale.set(3.6, 1.8, 1); sprite.position.copy(posicion); sprite.renderOrder = 10; raiz.add(sprite);
    }
    for (let cm = 0; cm <= UTIL; cm += 10) rotulo(`${cm} cm`, polar(R + 2.9, -8, cm));

    // ---------- líquido ----------
    const matLiquido = guardar(new THREE.MeshPhysicalMaterial({ color: COLOR.agua, transparent: true, opacity: 0.58, roughness: 0.15, metalness: 0,
      side: THREE.DoubleSide, depthWrite: false }));
    const liquido = malla(new THREE.CylinderGeometry(R - 0.15, R - 0.15, 1, 72, 1, false), matLiquido, raiz); liquido.renderOrder = 1;
    recortables.push(matLiquido);
    const colorFrio = new THREE.Color(COLOR.agua), colorCalido = new THREE.Color(COLOR.calida);

    // ---------- captadores ----------
    const colorSensor = (activo, alarma) => (alarma ? COLOR.alarma : activo ? COLOR.ok : COLOR.inactivo);

    function constructores() {
      return {
        sonda_nivel(c) {
          const g = new THREE.Group(); const p = polar(c.radioCm, c.anguloGrados, 0); g.position.set(p.x, 0, p.z);
          const largo = H + 1.2 - c.alturaCm, acero = material(COLOR.acero);
          malla(new THREE.CylinderGeometry(0.45, 0.45, largo, 20), acero, g).position.y = c.alturaCm + largo / 2;
          malla(new THREE.SphereGeometry(0.62, 20, 14), acero, g).position.y = c.alturaCm;
          malla(new THREE.CylinderGeometry(1.1, 1.1, 1.8, 24), material(COLOR.oscuro), g).position.y = H + 1.9;
          const anillo = malla(new THREE.TorusGeometry(0.95, 0.2, 10, 28), material(COLOR.acento, { emissive: COLOR.acento, emissiveIntensity: 0.5 }), g);
          anillo.rotation.x = Math.PI / 2;
          actualizadores[c.id] = s => { anillo.position.y = limitar(s.marcaCm, 0, UTIL); };
          return { grupo: g, ancla: new THREE.Vector3(p.x, H + 3.6, p.z) };
        },
        flotador(c) {
          const g = new THREE.Group(); const p = polar(c.radioCm, c.anguloGrados, 0); g.position.set(p.x, 0, p.z);
          const largo = H + 1.2 - (c.alturaCm - 3), acero = material(COLOR.acero);
          malla(new THREE.CylinderGeometry(0.25, 0.25, largo, 16), acero, g).position.y = c.alturaCm - 3 + largo / 2;
          malla(new THREE.CylinderGeometry(0.6, 0.6, 0.35, 16), acero, g).position.y = c.alturaCm - 3;
          malla(new THREE.BoxGeometry(1.4, 1.4, 1.4), material(COLOR.oscuro), g).position.y = H + 1.5;
          const matFlotador = material(COLOR.inactivo, { roughness: 0.4, metalness: 0.1, emissive: COLOR.inactivo, emissiveIntensity: 0.15 });
          malla(new THREE.CylinderGeometry(1.5, 1.5, 1.2, 28), matFlotador, g).position.y = c.alturaCm;
          actualizadores[c.id] = s => { matFlotador.color.setHex(colorSensor(s.activo)); matFlotador.emissive.setHex(colorSensor(s.activo)); };
          return { grupo: g, ancla: new THREE.Vector3(p.x, H + 3.2, p.z) };
        },
        sonda_temp(c) {
          const g = new THREE.Group(); const p = polar(c.radioCm, c.anguloGrados, 0); g.position.set(p.x, 0, p.z);
          const largo = H + 1.2 - c.alturaCm, acero = material(COLOR.acero);
          malla(new THREE.CylinderGeometry(0.22, 0.22, largo, 14), acero, g).position.y = c.alturaCm + largo / 2;
          const matPunta = material(COLOR.agua, { emissive: COLOR.agua, emissiveIntensity: 0.5 });
          malla(new THREE.SphereGeometry(0.62, 20, 14), matPunta, g).position.y = c.alturaCm;
          malla(new THREE.CylinderGeometry(0.9, 0.9, 1.6, 20), material(COLOR.oscuro), g).position.y = H + 1.8;
          const frio = new THREE.Color(COLOR.agua), calor = new THREE.Color(0xf04d3a);
          actualizadores[c.id] = s => { matPunta.color.copy(frio).lerp(calor, limitar((s.valor - 20) / 60, 0, 1)); matPunta.emissive.copy(matPunta.color); };
          return { grupo: g, ancla: new THREE.Vector3(p.x, H + 3.4, p.z) };
        },
        termostato(c) {
          const g = new THREE.Group(); const direccion = radial(c.anguloGrados);
          const matCuerpo = material(COLOR.ok, { emissive: COLOR.ok, emissiveIntensity: 0.25 });
          const cuerpo = malla(new THREE.CylinderGeometry(1.7, 1.7, 1.1, 28), matCuerpo, g);
          orientar(cuerpo, direccion); cuerpo.position.copy(polar(R + 0.95, c.anguloGrados, c.alturaCm));
          const placa = malla(new THREE.CylinderGeometry(2.3, 2.3, 0.3, 28), material(COLOR.oscuro), g);
          orientar(placa, direccion); placa.position.copy(polar(R + 0.3, c.anguloGrados, c.alturaCm));
          actualizadores[c.id] = s => { const color = colorSensor(s.activo, s.alarma); matCuerpo.color.setHex(color); matCuerpo.emissive.setHex(color); };
          return { grupo: g, ancla: polar(R + 2.2, c.anguloGrados, c.alturaCm + 2.2) };
        },
        resistencia(c) {
          const g = new THREE.Group(); const y0 = c.alturaCm, y1 = y0 + 7, radioEspira = 4.3, vueltas = 5, pasos = vueltas * 28;
          const puntos = [];
          for (let i = 0; i <= pasos; i++) {
            const t = i / pasos, angulo = t * vueltas * Math.PI * 2;
            puntos.push(new THREE.Vector3(radioEspira * Math.sin(angulo), y0 + (y1 - y0) * t, radioEspira * Math.cos(angulo)));
          }
          const matEspira = material(0x7f858c, { emissive: 0xff5a00, emissiveIntensity: 0, roughness: 0.35, metalness: 0.7 });
          malla(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(puntos), pasos * 2, 0.34, 10, false), matEspira, g);
          const acero = material(COLOR.acero);
          malla(new THREE.CylinderGeometry(5.3, 5.3, 0.5, 40), material(COLOR.oscuro), g).position.y = y0 - 0.5;
          for (const extremo of [puntos[0], puntos[puntos.length - 1]]) {
            const largo = H + 1.2 - extremo.y;
            malla(new THREE.CylinderGeometry(0.3, 0.3, largo, 12), acero, g).position.set(extremo.x, extremo.y + largo / 2, extremo.z);
          }
          malla(new THREE.BoxGeometry(2.2, 1.2, 1.6), material(COLOR.oscuro), g).position.set(0, H + 1.4, radioEspira);
          const luz = new THREE.PointLight(0xff7a1a, 0, 34, 1.4); luz.position.set(0, y0 + 3.5, 0); g.add(luz);
          actualizadores[c.id] = s => {
            matEspira.emissiveIntensity = s.activo ? 0.5 + 1.8 * limitar(s.potencia / 100, 0, 1) : 0;
            matEspira.color.setHex(s.activo ? 0xd9531a : 0x7f858c);
            luz.intensity = s.activo ? 260 * limitar(s.potencia / 100, 0, 1) : 0;
          };
          return { grupo: g, ancla: new THREE.Vector3(radioEspira, H + 3.2, 0) };
        },
      };
    }
    const crear = constructores();
    for (const captador of modelo.captadores) {
      const { grupo, ancla } = crear[captador.tipo](captador);
      registrar(captador.id, 'captador', grupo, ancla, captador);
    }

    // ---------- conexiones (tuberías) ----------
    for (const conexion of modelo.conexiones) {
      const g = new THREE.Group(), direccion = radial(conexion.anguloGrados), largo = 5.5;
      const color = clave === 'HEAT' ? COLOR.caliente : COLOR.frio, mat = material(conexion.tipo === 'entrada' ? color : COLOR.acero, { roughness: 0.5 });
      const tubo = malla(new THREE.CylinderGeometry(0.9, 0.9, largo, 24), mat, g);
      orientar(tubo, direccion); tubo.position.copy(polar(R + largo / 2, conexion.anguloGrados, conexion.alturaCm));
      const brida = malla(new THREE.CylinderGeometry(1.5, 1.5, 0.5, 24), material(COLOR.oscuro), g);
      orientar(brida, direccion); brida.position.copy(polar(R + 0.4, conexion.anguloGrados, conexion.alturaCm));
      const flecha = malla(new THREE.ConeGeometry(1.25, 2.4, 20), material(COLOR.acento, { emissive: COLOR.acento, emissiveIntensity: 0.45 }), g);
      orientar(flecha, conexion.tipo === 'entrada' ? direccion.clone().negate() : direccion);   // la punta indica hacia dónde va el fluido
      flecha.position.copy(polar(R + largo + 1.3, conexion.anguloGrados, conexion.alturaCm));
      registrar(conexion.id, 'conexion', g, polar(R + largo + 3, conexion.anguloGrados, conexion.alturaCm), conexion);
    }

    // ---------- estado en vivo ----------
    function actualizar(lecturas) {
      const h = lecturas.alturaLiquidoCm;
      liquido.visible = h > 0.02; liquido.scale.y = Math.max(h, 0.001); liquido.position.y = h / 2;
      if (lecturas.temperaturaAguaC != null) matLiquido.color.copy(colorFrio).lerp(colorCalido, limitar((lecturas.temperaturaAguaC - 20) / 50, 0, 1));
      for (const id of Object.keys(actualizadores)) actualizadores[id](lecturas.sensores[id]);
    }

    let contorno = null;
    function resaltar(id) {
      if (contorno) { raiz.remove(contorno); contorno.geometry.dispose(); contorno = null; }
      if (!id || !elementos[id]) return;
      const caja = new THREE.Box3().setFromObject(elementos[id].grupo);
      contorno = new THREE.Box3Helper(caja.expandByScalar(0.6), COLOR.acento);
      raiz.add(contorno);
    }

    function ponerCorte(activo) {
      for (const m of recortables) { m.clippingPlanes = activo ? [planoCorte] : []; m.needsUpdate = true; }
    }
    const ponerTapa = visible => { tapa.visible = visible; };

    function mallasSeleccionables() {
      const lista = [];
      for (const e of Object.values(elementos)) e.grupo.traverse(o => { if (o.isMesh) lista.push(o); });
      return lista;
    }

    function liberar() {
      for (const r of recursos) if (r && r.dispose) r.dispose();
      if (contorno) contorno.geometry.dispose();
    }

    return { raiz, elementos, actualizar, resaltar, ponerCorte, ponerTapa, mallasSeleccionables, liberar,
      vistaInicial: { azimut: 0.62, elevacion: 0.34, distancia: 66, minimo: 24, maximo: 150, objetivo: { x: 0, y: H / 2 - 2, z: 0 } } };
  }

  const api = { crearEscena, COLOR };
  if (typeof module !== 'undefined') module.exports = api; else PCT.visor3dEscena = api;
})();
