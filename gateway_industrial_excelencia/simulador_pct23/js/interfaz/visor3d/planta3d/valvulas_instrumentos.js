// Planta 3D: válvulas (SOL1-SOL5, V1, PRV1, V2, V3), sensores de temperatura T1/T3/T4/T5, caudalímetro F1 y carteles de entrada y salida.
// Contrato de planta3d/layout.js. La parte sin Three.js (qué bobina está activa, qué texto se muestra) son funciones puras y se prueban con node:test.
(function () {
  const layout = typeof require !== 'undefined' ? require('./layout.js') : PCT.planta3dLayout;
  const { ALTURA_TUBO_CM, aPlano, posicion } = layout;
  const COLOR = { ok: 0x3fb950, apagado: 0x6b7480, laton: 0xb08d3c, acero: 0x9aa6b1, oscuro: 0x2a3038, acento: 0xf68b11, frio: 0x2f7fc7, caliente: 0xf04d3a };
  const limitar = (valor, minimo, maximo) => Math.max(minimo, Math.min(maximo, valor));
  const decimal = valor => valor.toFixed(1).replace('.', ',');
  const entero = valor => String(Math.round(valor));

  /* ---------- parte pura: qué muestra cada pieza ---------- */
  // Electroválvulas con bobina: la salida del estado que las activa. V3 es manual, pero el simulador la abre con clic (estado.valvulaV3).
  const VALVULAS_ELECTRICAS = ['SOL1', 'SOL2', 'SOL3', 'SOL4', 'SOL5'];
  const VALVULAS_MANUALES = ['V1', 'PRV1', 'V2', 'V3'];
  const SENSORES = ['T1', 'T3', 'T4', 'T5', 'F1'];
  // Carteles con contador: id de ayuda, rótulo del esquema y qué cuentan.
  const CARTELES = {
    DESVIO: { rotulo: 'DIVERTED PRODUCT', px: { x: 460, y: 30 } },
    FINAL: { rotulo: 'FINISHED PRODUCT', px: { x: 975, y: 400 } },
    DRAIN: { rotulo: 'TO DRAIN', px: { x: 556, y: 242 } },
    COLD: { rotulo: 'COLD WATER', px: { x: 975, y: 440 } },
  };

  /** true/false si la pieza tiene bobina o mando que cambia con el estado; null si no cambia (válvula manual fija). */
  function bobinaActiva(id, estado) {
    if (VALVULAS_ELECTRICAS.includes(id)) return !!estado.salidas[id];
    if (id === 'V3') return !!estado.valvulaV3;
    return null;
  }

  /** Texto en vivo de un sensor o de un cartel. */
  function textoLectura(id, estado, observaciones) {
    switch (id) {
      case 'T1': case 'T3': case 'T4': case 'T5': return `${decimal(observaciones[id])} °C`;
      case 'F1': return `${entero(observaciones.F1)} ml/min`;
      case 'DESVIO': return `${entero(estado.desviadoMl)} ml`;
      case 'FINAL': return `${entero(estado.finalMl)} ml`;
      case 'DRAIN': return `${entero(estado.desagueMl)} ml`;
      case 'COLD': return estado.caudalFrioMlMin > 0 ? `${entero(estado.caudalFrioMlMin)} ml/min` : 'cerrada';
      default: return '';
    }
  }

  /** Color de la punta de una sonda de temperatura: azul a 20 °C, rojo a 80 °C (como en el visor de depósitos). */
  const fraccionTemperatura = grados => limitar((grados - 20) / 60, 0, 1);

  /* ---------- parte gráfica ---------- */
  function crear(THREE) {
    const grupo = new THREE.Group();
    const elementos = {}, actualizadores = [], recursos = [];
    const guardar = r => { recursos.push(r); return r; };
    const material = (color, opciones = {}) => guardar(new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.45, metalness: 0.5 }, opciones)));
    const malla = (geometria, mat, padre) => { const m = new THREE.Mesh(guardar(geometria), mat); padre.add(m); return m; };
    const tubo = (radio, largo, mat, padre, eje) => {      // cilindro tumbado en X (eje 'x'), en Z ('z') o vertical (por defecto)
      const m = malla(new THREE.CylinderGeometry(radio, radio, largo, 20), mat, padre);
      if (eje === 'x') m.rotation.z = Math.PI / 2; else if (eje === 'z') m.rotation.x = Math.PI / 2;
      return m;
    };
    function registrar(id, g, ancla, ayuda) {
      g.traverse(o => { if (o.isMesh || o.isSprite) o.userData.id = id; });
      grupo.add(g); elementos[id] = { id, grupo: g, ancla, ayuda: ayuda || id };
    }

    // Sprite de texto: la textura solo se redibuja si cambia el texto.
    function crearRotulo(titulo, ancho = 8.4, alto = 3.6) {
      const lienzo = document.createElement('canvas'); lienzo.width = 224; lienzo.height = 96;
      const c = lienzo.getContext('2d');
      const textura = guardar(new THREE.CanvasTexture(lienzo));
      const sprite = new THREE.Sprite(guardar(new THREE.SpriteMaterial({ map: textura, depthTest: false, transparent: true })));
      sprite.scale.set(ancho, alto, 1); sprite.renderOrder = 10;
      let ultimo = null;
      function poner(valor) {
        if (valor === ultimo) return;
        ultimo = valor;
        c.clearRect(0, 0, 224, 96);
        c.fillStyle = 'rgba(15, 20, 26, 0.85)'; c.strokeStyle = '#ffffff55'; c.lineWidth = 2;
        c.beginPath(); c.roundRect(2, 2, 220, 92, 14); c.fill(); c.stroke();
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillStyle = '#b9c3cc'; let letra = 26;
        do { c.font = `600 ${letra}px system-ui, sans-serif`; letra -= 2; } while (c.measureText(titulo).width > 200 && letra > 12);   // el título largo se encoge para caber
        c.fillText(titulo, 112, 28);
        c.fillStyle = '#ffffff'; c.font = '700 34px system-ui, sans-serif'; c.fillText(valor, 112, 66);
        textura.needsUpdate = true;
      }
      poner('—');
      return { sprite, poner };
    }

    const matLaton = material(COLOR.laton, { metalness: 0.7, roughness: 0.35 });
    const matOscuro = material(COLOR.oscuro, { roughness: 0.7 });
    const matAcero = material(COLOR.acero);

    // Montaje común a las válvulas: el origen del grupo queda sobre el eje de la tubería.
    const nuevaValvula = id => {
      const g = new THREE.Group(); const p = posicion(id); g.position.set(p.x, ALTURA_TUBO_CM, p.z); return g;
    };

    // ---- electroválvulas: cuerpo de latón + bobina que se ilumina al activarse ----
    const TRES_VIAS = { SOL1: new THREE.Vector3(0, 0, -1), SOL2: new THREE.Vector3(0, 0, 1) };   // ramal del desvío (SOL1) y del tanque B (SOL2) en el esquema
    for (const id of VALVULAS_ELECTRICAS) {
      const g = nuevaValvula(id);
      malla(new THREE.BoxGeometry(3.6, 2.6, 2.6), matLaton, g);
      if (TRES_VIAS[id]) {
        const d = TRES_VIAS[id];
        const rama = tubo(0.9, 2.6, matLaton, g, 'z'); rama.position.set(0, 0, d.z * 2.1);
      }
      tubo(0.6, 1.4, matAcero, g).position.y = 2.0;
      const matBobina = material(COLOR.apagado, { emissive: COLOR.apagado, emissiveIntensity: 0.1, metalness: 0.3 });
      const bobina = tubo(1.45, 3.4, matBobina, g); bobina.position.y = 4.4;
      tubo(1.55, 0.35, matOscuro, g).position.y = 6.2;
      const rotulo = crearRotulo(id, 6.4, 2.8);
      rotulo.sprite.position.set(0, 9.6, 0); rotulo.poner(id === 'SOL1' ? 'desvío' : id === 'SOL2' ? 'A / B' : 'cerrada'); g.add(rotulo.sprite);
      registrar(id, g, new THREE.Vector3(g.position.x, g.position.y + 9.6, g.position.z));
      actualizadores.push(estado => {
        const on = bobinaActiva(id, estado);
        matBobina.color.setHex(on ? COLOR.ok : COLOR.apagado); matBobina.emissive.setHex(on ? COLOR.ok : COLOR.apagado); matBobina.emissiveIntensity = on ? 0.6 : 0.1;
        rotulo.poner(textoValvula(id, on));
      });
    }

    // ---- válvulas manuales: cuerpo + volante (V3 gira el mando al abrirla; la PRV1 lleva bonete con muelle) ----
    for (const id of VALVULAS_MANUALES) {
      const g = nuevaValvula(id);
      malla(new THREE.BoxGeometry(3.4, 2.4, 2.4), matAcero, g);
      let mando = null;
      if (id === 'PRV1') {
        tubo(1.5, 3.2, matOscuro, g).position.y = 2.8;
        tubo(0.35, 2.0, matLaton, g).position.y = 5.2;
        malla(new THREE.SphereGeometry(0.8, 14, 10), matLaton, g).position.y = 6.4;
      } else {
        tubo(0.35, 2.4, matAcero, g).position.y = 2.2;
        mando = new THREE.Group(); mando.position.y = 3.4; g.add(mando);
        malla(new THREE.BoxGeometry(4.4, 0.55, 0.8), material(id === 'V3' ? COLOR.acento : 0xc23b32, { metalness: 0.2, roughness: 0.55 }), mando);
        if (id === 'V3') mando.rotation.y = Math.PI / 2;
      }
      registrar(id, g, new THREE.Vector3(g.position.x, g.position.y + 7.8, g.position.z));
      if (id === 'V3') actualizadores.push(estado => { mando.rotation.y = bobinaActiva('V3', estado) ? 0 : Math.PI / 2; });   // abierta: mando a lo largo de la tubería
    }

    // ---- sensores de temperatura: sonda vertical sobre la tubería, con la punta del color de la lectura ----
    const frio = new THREE.Color(COLOR.frio), calor = new THREE.Color(COLOR.caliente);
    for (const id of SENSORES.filter(s => s.startsWith('T'))) {
      const g = nuevaValvula(id);
      tubo(0.9, 1.4, matOscuro, g).position.y = 0.7;
      tubo(0.28, 3.2, matAcero, g).position.y = 3.0;
      const matPunta = material(COLOR.frio, { emissive: COLOR.frio, emissiveIntensity: 0.5 });
      malla(new THREE.SphereGeometry(0.75, 18, 14), matPunta, g).position.y = 0;
      tubo(1.05, 1.6, matOscuro, g).position.y = 5.0;
      const rotulo = crearRotulo(id); rotulo.sprite.position.set(0, 8.6, 0); g.add(rotulo.sprite);
      registrar(id, g, new THREE.Vector3(g.position.x, g.position.y + 8.6, g.position.z));
      actualizadores.push((estado, obs) => {
        matPunta.color.copy(frio).lerp(calor, fraccionTemperatura(obs[id])); matPunta.emissive.copy(matPunta.color);
        rotulo.poner(textoLectura(id, estado, obs));
      });
    }

    // ---- F1: caudalímetro de turbina en línea (cuerpo cilíndrico con cabezal) ----
    {
      const g = nuevaValvula('F1');
      tubo(1.5, 5.2, matAcero, g, 'z');
      tubo(1.9, 0.8, matOscuro, g, 'z').position.z = 2.2; tubo(1.9, 0.8, matOscuro, g, 'z').position.z = -2.2;
      tubo(1.0, 2.2, matOscuro, g).position.y = 2.1;
      const matLed = material(COLOR.apagado, { emissive: COLOR.apagado, emissiveIntensity: 0.1 });
      malla(new THREE.SphereGeometry(0.55, 14, 10), matLed, g).position.y = 3.5;
      const rotulo = crearRotulo('F1', 10.5, 3.6); rotulo.sprite.position.set(0, 8.0, 0); g.add(rotulo.sprite);
      registrar('F1', g, new THREE.Vector3(g.position.x, g.position.y + 8.0, g.position.z));
      actualizadores.push((estado, obs) => {
        const marcha = obs.F1 > 0;
        matLed.color.setHex(marcha ? COLOR.ok : COLOR.apagado); matLed.emissive.setHex(marcha ? COLOR.ok : COLOR.apagado); matLed.emissiveIntensity = marcha ? 0.7 : 0.1;
        rotulo.poner(textoLectura('F1', estado, obs));
      });
    }

    // ---- carteles de entrada y salida con su contador en vivo ----
    for (const [id, cartel] of Object.entries(CARTELES)) {
      const g = new THREE.Group(); const p = aPlano(cartel.px.x, cartel.px.y);
      g.position.set(p.x, 0, p.z);
      malla(new THREE.BoxGeometry(2.0, 0.6, 2.0), matOscuro, g).position.y = 0.3;
      tubo(0.25, 5.2, matAcero, g).position.y = 3.0;
      const rotulo = crearRotulo(cartel.rotulo, 11.6, 5.0); rotulo.sprite.position.set(0, 8.2, 0); g.add(rotulo.sprite);
      registrar(id, g, new THREE.Vector3(g.position.x, 10.8, g.position.z));
      actualizadores.push((estado, obs) => rotulo.poner(textoLectura(id, estado, obs)));
    }

    function actualizar(estado, observaciones) { for (const f of actualizadores) f(estado, observaciones); }
    function liberar() { for (const r of recursos) if (r && r.dispose) r.dispose(); }
    return { grupo, elementos, actualizar, liberar };
  }

  /** Texto bajo el rótulo de una electroválvula (solo se muestra al activarse o en reposo). */
  function textoValvula(id, activa) {
    if (id === 'SOL1') return activa ? 'desvío' : 'producto';
    if (id === 'SOL2') return activa ? 'tanque B' : 'tanque A';
    return activa ? 'abierta' : 'cerrada';
  }

  const api = { crear, bobinaActiva, textoLectura, textoValvula, fraccionTemperatura, VALVULAS_ELECTRICAS, VALVULAS_MANUALES, SENSORES, CARTELES };
  if (typeof module !== 'undefined') module.exports = api; else PCT.planta3dValvulasInstrumentos = api;
})();
