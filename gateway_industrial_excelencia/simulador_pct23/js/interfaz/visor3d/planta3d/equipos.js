// Planta 3D · equipos: depósitos A, B y heat unit (con sus captadores), intercambiador de placas, bombas N1 y N2, tubo de residencia y filtro.
// Contrato: ver layout.js. Unidades: cm; origen en el centro de la mesa (Y = 0 es la mesa). La mesa y las tuberías las pone otro módulo.
(function () {
  const layout = typeof require !== 'undefined' ? require('./layout.js') : PCT.planta3dLayout;
  const { GEOMETRIA, MODELOS } = typeof require !== 'undefined' ? require('../especificaciones.js') : PCT.visor3dEspecificaciones;
  const { lecturasModelo, fraccionDeLlenado } = typeof require !== 'undefined' ? require('../lecturas.js') : PCT.visor3dLecturas;
  const { ESCALA, posicion } = layout;

  const R = GEOMETRIA.diametroCm / 2, H = GEOMETRIA.alturaCm, UTIL = GEOMETRIA.alturaUtilCm;
  const COLOR = { agua: 0x2f7fc7, calida: 0xd9633a, acento: 0xf68b11, ok: 0x3fb950, inactivo: 0x6b7480, alarma: 0xf85149, acero: 0x9aa6b1, oscuro: 0x2a3038, aislante: 0x8a8f96 };
  const DEPOSITOS = ['TANKA', 'TANKB', 'HEAT'];
  const RPM_MAXIMA = 60;                                         // a 100 % el rotor da 1 vuelta/s (valor didáctico)
  const SECCIONES = ['REGEN', 'CALENT', 'ENFRIA'];
  const CAJA_SECCION_CM = { ancho: 102 * ESCALA, fondo: 64 * ESCALA, alto: 10 };   // cada caja del esquema es de 102 × 64 u
  const IDS_ELEMENTOS = ['TANKA', 'TANKB', 'HEAT', 'L1', 'HL', 'LL', 'RES', 'T2', 'TERM', 'LVL', 'HLC', ...SECCIONES, 'N1', 'N2', 'HOLDING', 'FILTER'];

  /* ---------- funciones puras (sin THREE) ---------- */
  const limitar = (v, a, b) => Math.max(a, Math.min(b, v));
  /** 0 (frío) a 1 (caliente) para teñir agua y placas. */
  const mezclaCalor = (tempC, desde = 20, hasta = 75) => limitar((tempC - desde) / (hasta - desde), 0, 1);
  const fraccionLlenado = (clave, estado) => limitar(fraccionDeLlenado(clave, estado), 0, 1);
  const alturaLiquidoCm = (clave, estado) => fraccionLlenado(clave, estado) * UTIL;
  /** rad/s del rotor: negativo (horario visto de frente) en sentido normal, positivo si el giro está invertido; 0 si la bomba está parada. */
  function velocidadAngularRotor(activa, velocidadPct, inversa) {
    if (!activa) return 0;
    return (inversa ? 1 : -1) * limitar(velocidadPct, 0, 100) / 100 * (RPM_MAXIMA / 60) * 2 * Math.PI;
  }
  const temperaturasSecciones = o => ({ REGEN: o.T4, CALENT: o.T2, ENFRIA: o.T3 });
  const actividadSecciones = e => ({
    REGEN: e.caudalProductoMlMin > 0,
    CALENT: !!e.salidas.N2 && e.consignas.velocidadN2Pct > 0,
    ENFRIA: !!e.salidas.SOL3,
  });
  const estadoBomba = (clave, e) => ({ activa: !!e.salidas[clave], velocidadPct: e.consignas['velocidad' + clave + 'Pct'], inversa: !!e.giro[clave] });
  /** Posición (plano de la mesa) de cada equipo, por id. */
  const posiciones = () => Object.fromEntries(['TANKA', 'TANKB', 'HEAT', 'N1', 'N2', 'HOLDING', 'FILTER', ...SECCIONES].map(id => [id, posicion(id)]));

  /* ---------- construcción ---------- */
  function crear(THREE, estadoInicial) {
    const grupo = new THREE.Group();
    const elementos = {}, actualizadores = [], recursos = [];
    const guardar = r => { recursos.push(r); return r; };
    const material = (color, o = {}) => guardar(new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.45, metalness: 0.5 }, o)));
    const malla = (g, m, padre) => { const x = new THREE.Mesh(guardar(g), m); padre.add(x); return x; };
    const polar = (radio, grados, altura) => new THREE.Vector3(radio * Math.sin(grados * Math.PI / 180), altura, radio * Math.cos(grados * Math.PI / 180));
    const marcar = (g, id, fondo) => g.traverse(o => { if (o.isMesh) { o.userData.id = id; if (fondo) o.userData.fondo = true; } });
    const registrar = (id, g, ancla, ayuda) => { marcar(g, id, false); elementos[id] = { id, grupo: g, ancla, ayuda: ayuda || id }; };
    const colorFrio = new THREE.Color(COLOR.agua), colorCalido = new THREE.Color(COLOR.calida);
    const colorSensor = (activo, alarma) => (alarma ? COLOR.alarma : activo ? COLOR.ok : COLOR.inactivo);

    /* --- depósitos --- */
    function crearDeposito(clave) {
      const modelo = MODELOS[clave], origen = posicion(clave), g = new THREE.Group();
      g.position.set(origen.x, 0, origen.z); grupo.add(g);
      const sobreMesa = v => new THREE.Vector3(origen.x + v.x, v.y, origen.z + v.z);

      const matVidrio = guardar(new THREE.MeshPhysicalMaterial({ color: 0xaed4ff, transparent: true, opacity: 0.17, roughness: 0.08, metalness: 0, side: THREE.DoubleSide, depthWrite: false }));
      const cuerpo = new THREE.Group(); g.add(cuerpo);
      const vidrio = malla(new THREE.CylinderGeometry(R, R, H, 48, 1, true), matVidrio, cuerpo); vidrio.position.y = H / 2; vidrio.renderOrder = 3;
      malla(new THREE.CylinderGeometry(R + 0.4, R + 0.4, 0.6, 48), material(COLOR.oscuro, { roughness: 0.7 }), cuerpo).position.y = 0.3;
      for (const y of [0.6, H]) { const aro = malla(new THREE.TorusGeometry(R, 0.28, 8, 48), material(0xc9d3dc, { roughness: 0.3 }), cuerpo); aro.rotation.x = Math.PI / 2; aro.position.y = y; }
      const matLiquido = guardar(new THREE.MeshPhysicalMaterial({ color: COLOR.agua, transparent: true, opacity: 0.58, roughness: 0.15, metalness: 0, side: THREE.DoubleSide, depthWrite: false }));
      const liquido = malla(new THREE.CylinderGeometry(R - 0.15, R - 0.15, 1, 48), matLiquido, cuerpo); liquido.renderOrder = 1;
      marcar(cuerpo, clave, true);                                  // el vidrio y el líquido se pueden pulsar, pero ceden ante los captadores (userData.fondo)
      elementos[clave] = { id: clave, grupo: cuerpo, ancla: sobreMesa(new THREE.Vector3(0, H + 4, 0)), ayuda: clave };

      const lect = {};                                              // sensores del último fotograma
      const sensores = {};
      for (const c of modelo.captadores) {
        const sg = new THREE.Group(); g.add(sg);
        const p = polar(c.radioCm, c.anguloGrados, 0);
        let actualizar = () => {}, ancla;
        if (c.tipo === 'sonda_nivel' || c.tipo === 'sonda_temp') {
          const esNivel = c.tipo === 'sonda_nivel', largo = H + 1.2 - c.alturaCm, acero = material(COLOR.acero);
          malla(new THREE.CylinderGeometry(esNivel ? 0.45 : 0.22, esNivel ? 0.45 : 0.22, largo, 14), acero, sg).position.set(p.x, c.alturaCm + largo / 2, p.z);
          const punta = material(esNivel ? COLOR.acero : COLOR.agua, { emissive: esNivel ? 0x000000 : COLOR.agua, emissiveIntensity: 0.5 });
          malla(new THREE.SphereGeometry(0.62, 14, 10), punta, sg).position.set(p.x, c.alturaCm, p.z);
          malla(new THREE.CylinderGeometry(1, 1, 1.6, 18), material(COLOR.oscuro), sg).position.set(p.x, H + 1.9, p.z);
          if (esNivel) {
            const anillo = malla(new THREE.TorusGeometry(0.95, 0.2, 8, 20), material(COLOR.acento, { emissive: COLOR.acento, emissiveIntensity: 0.5 }), sg);
            anillo.rotation.x = Math.PI / 2;
            actualizar = s => { anillo.position.set(p.x, limitar(s.marcaCm, 0, UTIL), p.z); };
          } else {
            const calor = new THREE.Color(0xf04d3a);
            actualizar = s => { punta.color.copy(colorFrio).lerp(calor, mezclaCalor(s.valor, 20, 80)); punta.emissive.copy(punta.color); };
          }
          ancla = new THREE.Vector3(p.x, H + 3.4, p.z);
        } else if (c.tipo === 'flotador') {
          const largo = H + 1.2 - (c.alturaCm - 3), acero = material(COLOR.acero);
          malla(new THREE.CylinderGeometry(0.25, 0.25, largo, 12), acero, sg).position.set(p.x, c.alturaCm - 3 + largo / 2, p.z);
          const mat = material(COLOR.inactivo, { roughness: 0.4, metalness: 0.1, emissive: COLOR.inactivo, emissiveIntensity: 0.15 });
          malla(new THREE.CylinderGeometry(1.5, 1.5, 1.2, 20), mat, sg).position.set(p.x, c.alturaCm, p.z);
          malla(new THREE.BoxGeometry(1.4, 1.4, 1.4), material(COLOR.oscuro), sg).position.set(p.x, H + 1.5, p.z);
          actualizar = s => { mat.color.setHex(colorSensor(s.activo)); mat.emissive.setHex(colorSensor(s.activo)); };
          ancla = new THREE.Vector3(p.x, H + 3.2, p.z);
        } else if (c.tipo === 'termostato') {
          const dir = polar(1, c.anguloGrados, 0).normalize();
          const mat = material(COLOR.ok, { emissive: COLOR.ok, emissiveIntensity: 0.25 });
          const cuerpoT = malla(new THREE.CylinderGeometry(1.7, 1.7, 1.1, 20), mat, sg);
          cuerpoT.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); cuerpoT.position.copy(polar(R + 0.95, c.anguloGrados, c.alturaCm));
          actualizar = s => { const col = colorSensor(s.activo, s.alarma); mat.color.setHex(col); mat.emissive.setHex(col); };
          ancla = polar(R + 2.2, c.anguloGrados, c.alturaCm + 2.2);
        } else if (c.tipo === 'resistencia') {
          const y0 = c.alturaCm, y1 = y0 + 7, radioEspira = 4.3, vueltas = 5, pasos = vueltas * 24, puntos = [];
          for (let i = 0; i <= pasos; i++) { const t = i / pasos, a = t * vueltas * 2 * Math.PI; puntos.push(new THREE.Vector3(radioEspira * Math.sin(a), y0 + (y1 - y0) * t, radioEspira * Math.cos(a))); }
          const mat = material(0x7f858c, { emissive: 0xff5a00, emissiveIntensity: 0, roughness: 0.35, metalness: 0.7 });
          malla(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(puntos), pasos * 2, 0.34, 8, false), mat, sg);
          malla(new THREE.CylinderGeometry(5.3, 5.3, 0.5, 32), material(COLOR.oscuro), sg).position.y = y0 - 0.5;
          actualizar = s => { mat.emissiveIntensity = s.activo ? 0.5 + 1.8 * limitar(s.potencia / 100, 0, 1) : 0; mat.color.setHex(s.activo ? 0xd9531a : 0x7f858c); };
          ancla = new THREE.Vector3(radioEspira, H + 3.2, 0);
        }
        registrar(c.id, sg, sobreMesa(ancla), c.ayuda);
        sensores[c.id] = actualizar;
      }

      actualizadores.push((estado, obs) => {
        const l = lecturasModelo(clave, estado, obs);
        liquido.visible = l.alturaLiquidoCm > 0.02; liquido.scale.y = Math.max(l.alturaLiquidoCm, 0.001); liquido.position.y = l.alturaLiquidoCm / 2;
        if (clave === 'HEAT') matLiquido.color.copy(colorFrio).lerp(colorCalido, mezclaCalor(obs.T2, 20, 70));
        for (const id of Object.keys(sensores)) sensores[id](l.sensores[id]);
        lect[clave] = l;
      });
    }
    for (const clave of DEPOSITOS) crearDeposito(clave);

    /* --- intercambiador: tres cajas de placas --- */
    const matsPlaca = {};
    for (const id of SECCIONES) {
      const o = posicion(id), g = new THREE.Group(), { ancho, fondo, alto } = CAJA_SECCION_CM;
      g.position.set(o.x, 0, o.z); grupo.add(g);
      const matPlaca = material(0x8d9aa6, { roughness: 0.3, metalness: 0.75, emissive: 0x000000 }), matJunta = material(0x1d2228, { roughness: 0.85, metalness: 0.05 });
      matsPlaca[id] = matPlaca;
      const n = Math.round(ancho / 0.7);
      for (let i = 0; i < n; i++) malla(new THREE.BoxGeometry(0.34, alto, fondo), i % 2 ? matPlaca : matJunta, g).position.set(-ancho / 2 + (i + 0.5) * ancho / n, 0.6 + alto / 2, 0);
      for (const sx of [-1, 1]) malla(new THREE.BoxGeometry(0.8, alto + 1.4, fondo + 1), material(0xc9d3dc, { roughness: 0.35 }), g).position.set(sx * (ancho / 2 + 0.4), 0.6 + alto / 2, 0);
      malla(new THREE.BoxGeometry(ancho + 2, 0.6, fondo + 1.2), material(COLOR.oscuro, { roughness: 0.7 }), g).position.y = 0.3;
      registrar(id, g, new THREE.Vector3(o.x, alto + 4, o.z), id);
    }
    const colorPlaca = new THREE.Color(0x7d98ad);
    actualizadores.push((estado, obs) => {
      const t = temperaturasSecciones(obs), act = actividadSecciones(estado);
      for (const id of SECCIONES) {
        matsPlaca[id].color.copy(colorPlaca).lerp(colorCalido, mezclaCalor(t[id], 20, 75));
        matsPlaca[id].emissive.copy(matsPlaca[id].color); matsPlaca[id].emissiveIntensity = act[id] ? 0.28 : 0.04;
      }
    });

    /* --- bombas peristálticas N1 y N2 (eje hacia la cámara, rotor que gira) --- */
    const rotores = {};
    for (const clave of ['N1', 'N2']) {
      const o = posicion(clave), g = new THREE.Group(), radio = 4.4, cy = radio + 1.6;
      g.position.set(o.x, 0, o.z); grupo.add(g);
      malla(new THREE.BoxGeometry(radio * 2 + 3, 0.8, radio * 2 + 3), material(COLOR.oscuro, { roughness: 0.7 }), g).position.y = 0.4;
      malla(new THREE.BoxGeometry(radio * 1.6, radio * 1.6, radio), material(0x3b444e), g).position.set(0, cy, -radio * 0.9);
      const carcasa = malla(new THREE.CylinderGeometry(radio + 0.5, radio + 0.5, 2.6, 40, 1, true), material(0xc9d3dc, { roughness: 0.35, side: THREE.DoubleSide }), g);
      carcasa.rotation.x = Math.PI / 2; carcasa.position.set(0, cy, -0.4);
      const tapa = malla(new THREE.CylinderGeometry(radio + 0.5, radio + 0.5, 0.2, 40), guardar(new THREE.MeshPhysicalMaterial({ color: 0xaed4ff, transparent: true, opacity: 0.2, roughness: 0.1, side: THREE.DoubleSide, depthWrite: false })), g);
      tapa.rotation.x = Math.PI / 2; tapa.position.set(0, cy, 0.95); tapa.renderOrder = 3;
      const tubo = malla(new THREE.TorusGeometry(radio - 0.5, 0.4, 8, 36, Math.PI * 1.25), material(0xe9e2c8, { roughness: 0.5, metalness: 0.05, emissive: clave === 'N2' ? COLOR.calida : 0xd9d3b0, emissiveIntensity: 0 }), g);
      tubo.position.set(0, cy, 0); tubo.rotation.z = Math.PI * 1.375;       // arco apoyado abajo
      const rotor = new THREE.Group(); rotor.position.set(0, cy, 0.1); g.add(rotor);
      const matRotor = material(COLOR.acero, { emissive: COLOR.ok, emissiveIntensity: 0 });
      malla(new THREE.CylinderGeometry(1.9, 1.9, 0.9, 24), matRotor, rotor).rotation.x = Math.PI / 2;
      for (let i = 0; i < 3; i++) {
        const a = i * 2 * Math.PI / 3 + Math.PI / 2;
        const brazo = malla(new THREE.BoxGeometry(radio - 1.3, 0.5, 0.5), matRotor, rotor);
        brazo.position.set(Math.cos(a) * (radio - 1) / 2 + Math.cos(a) * 0.7, Math.sin(a) * (radio - 1) / 2 + Math.sin(a) * 0.7, 0); brazo.rotation.z = a;
        const rod = malla(new THREE.CylinderGeometry(0.6, 0.6, 1.1, 16), material(0xdfe6ee), rotor);
        rod.rotation.x = Math.PI / 2; rod.position.set(Math.cos(a) * (radio - 1), Math.sin(a) * (radio - 1), 0);
      }
      malla(new THREE.BoxGeometry(0.5, 0.5, 0.3), material(COLOR.acento, { emissive: COLOR.acento, emissiveIntensity: 0.6 }), rotor).position.set(0, 1.4, 0.6);
      registrar(clave, g, new THREE.Vector3(o.x, cy + radio + 3, o.z), clave);
      rotores[clave] = { rotor, matRotor, tubo, angulo: 0 };
    }
    let ultimo = null;
    actualizadores.push(estado => {
      const ahora = performance.now(), dt = ultimo === null ? 0 : Math.min((ahora - ultimo) / 1000, 0.1); ultimo = ahora;
      for (const clave of ['N1', 'N2']) {
        const r = rotores[clave], b = estadoBomba(clave, estado);
        r.angulo += velocidadAngularRotor(b.activa, b.velocidadPct, b.inversa) * dt; r.rotor.rotation.z = r.angulo;
        r.matRotor.emissiveIntensity = b.activa ? 0.35 : 0; r.matRotor.emissive.setHex(b.inversa ? COLOR.alarma : COLOR.ok);
        r.tubo.material.emissiveIntensity = b.activa && !b.inversa ? 0.45 : 0;
      }
    });

    /* --- tubo de residencia (aislado, enrollado) y filtro --- */
    {
      const o = posicion('HOLDING'), g = new THREE.Group(), puntos = [], vueltas = 4, pasos = vueltas * 28;
      g.position.set(o.x, 0, o.z); grupo.add(g);
      for (let i = 0; i <= pasos; i++) { const t = i / pasos, a = t * vueltas * 2 * Math.PI; puntos.push(new THREE.Vector3(5.5 * Math.cos(a), 2.2 + 1.9 * vueltas * t + 0.0, 5.5 * Math.sin(a))); }
      malla(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(puntos), pasos * 2, 1.2, 12, false), material(COLOR.aislante, { roughness: 0.85, metalness: 0.05 }), g);
      malla(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(puntos), pasos * 2, 0.55, 10, false), material(0xd9d3b0, { roughness: 0.5, metalness: 0.1 }), g);
      malla(new THREE.CylinderGeometry(7.2, 7.2, 0.6, 32), material(COLOR.oscuro, { roughness: 0.7 }), g).position.y = 0.3;
      registrar('HOLDING', g, new THREE.Vector3(o.x, 13, o.z), 'HOLDING');
    }
    {
      const o = posicion('FILTER'), g = new THREE.Group();
      g.position.set(o.x, 0, o.z); grupo.add(g);
      const cuerpoF = malla(new THREE.CylinderGeometry(1.8, 1.8, 6, 24), material(0xc9d3dc, { roughness: 0.3 }), g);
      cuerpoF.rotation.z = Math.PI / 2; cuerpoF.position.y = layout.ALTURA_TUBO_CM;
      for (const sx of [-1, 1]) { const tapaF = malla(new THREE.CylinderGeometry(2.1, 2.1, 0.8, 24), material(COLOR.oscuro), g); tapaF.rotation.z = Math.PI / 2; tapaF.position.set(sx * 3.2, layout.ALTURA_TUBO_CM, 0); }
      malla(new THREE.CylinderGeometry(1.1, 1.1, 2.2, 16), material(COLOR.acero), g).position.set(0, layout.ALTURA_TUBO_CM + 3, 0);
      registrar('FILTER', g, new THREE.Vector3(o.x, 9, o.z), 'FILTER');
    }

    function actualizar(estado, observaciones) { for (const f of actualizadores) f(estado, observaciones); }
    function liberar() { for (const r of recursos) if (r && r.dispose) r.dispose(); }
    grupo.updateMatrixWorld(true);
    if (estadoInicial) actualizar(estadoInicial, require_obs(estadoInicial));
    return { grupo, elementos, actualizar, liberar };
  }

  // Observaciones iniciales solo si hay planta cargada (en el navegador siempre; en Node no se usa crear sin THREE).
  function require_obs(estado) {
    const planta = typeof require !== 'undefined' ? require('../../../modelo/planta.js') : PCT.planta;
    return planta.observaciones(estado);
  }

  const api = { crear, IDS_ELEMENTOS, DEPOSITOS, SECCIONES, CAJA_SECCION_CM, mezclaCalor, fraccionLlenado, alturaLiquidoCm, velocidadAngularRotor,
    temperaturasSecciones, actividadSecciones, estadoBomba, posiciones };
  if (typeof module !== 'undefined') module.exports = api; else PCT.planta3dEquipos = api;
})();
