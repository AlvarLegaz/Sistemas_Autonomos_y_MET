// Cableado y bandeja de rejilla en 3D (DISEÑADOR): la bandeja BAN-001 sobre bloques con los cables rojo/negro de las cuatro cadenas (STR-101, STR-102, STR-201, STR-202),
// los conectores MC4 con cinta amarilla, los puentes entre paneles bajo el marco y la entrada a la caseta; dentro, los cables a cada equipo por las canaletas
// (caja de continua → EASun → magnetotérmico → portafusible → batería, alterna hacia el cuadro y la acometida). Las cadenas abiertas separan su conector MC4.
(function () {
  const K = typeof require !== 'undefined' ? require('./kit.js') : PCT.fvKit;
  const D = typeof require !== 'undefined' ? require('./disposicion.js') : PCT.fvDisposicion;
  const Base = typeof require !== 'undefined' ? require('./base_fv.js') : PCT.fvBase;
  const layout = D.layout, C = D.CASETA;
  const TAGS = ['BAN-001', 'STR-101', 'STR-102', 'STR-201', 'STR-202'];

  /** Desplaza lateralmente (a la izquierda del sentido de la marcha) una poligonal en planta [[x, z], …] con esquinas a inglete. */
  function desplazarPoligonal(pts, l) {
    const n = [];
    for (let i = 1; i < pts.length; i++) { const dx = pts[i][0] - pts[i - 1][0], dz = pts[i][1] - pts[i - 1][1], m = Math.hypot(dx, dz) || 1; n.push([-dz / m, dx / m]); }
    return pts.map((p, i) => {
      const a = n[Math.max(0, i - 1)], b = n[Math.min(n.length - 1, i)], k = 1 + (a[0] * b[0] + a[1] * b[1]);
      return [p[0] + l * (a[0] + b[0]) / k, p[1] + l * (a[1] + b[1]) / k];
    });
  }
  const largoPoligonal = pts => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], (pts[i][2] || 0) - (pts[i - 1][2] || 0)); return s; };
  const largo3 = pts => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]); return s; };
  /** Punto de la caja de conexiones (cara trasera, extremo alto) de un panel, con desplazamiento lateral dx. */
  function juntura(p, dx = 0) {
    const lz = -p.largo / 2 + 14, ly = -p.grueso / 2 - 2.8, c = Math.cos(p.inclinacion), s = Math.sin(p.inclinacion);
    return [p.x + dx, p.y + ly * c - lz * s, p.z + ly * s + lz * c];
  }
  const W = (x, y, z) => D.aMundo(x, y, z);
  const LANE = 2.4, Y_BANDEJA = D.BANDEJA.y + 2.2;

  /** Cables de todas las cadenas: lista { cadena, polo: '+' | '-', puntos (mundo), unionXZ } en el orden de los carriles (norte a sur en la bandeja). */
  function planificarCables() {
    const lista = [];
    for (const campo of Object.values(layout.CAMPOS)) for (const cad of campo.cadenas) {
      const ps = cad.paneles.map(t => D.PANELES[t]), primero = ps[0], ultimo = ps[ps.length - 1];
      const zBandeja = campo.id === 'A' ? D.BANDEJA.puntos[2][1] : D.BANDEJA.puntos[0][1];       // línea de la bandeja a la que llega cada campo
      for (const [polo, p, dx] of [['+', primero, -9], ['-', ultimo, 9]]) {
        const j = juntura(p, dx), xj = p.x + dx;
        // sube/baja por debajo del panel hasta el suelo y corre hacia el sur hasta la bandeja
        const baja = [[j[0], j[1], j[2]], [j[0], 2.2, j[2]], [xj, 1.6, p.zBajo + 4]];
        const llega = [xj, 1.6, zBandeja - 16];
        lista.push({ cadena: cad.id, polo, campo: campo.id, tramoCampo: baja.concat([llega]), xj, zBandeja, paneles: ps });
      }
    }
    lista.sort((a, b) => (a.campo === b.campo ? a.xj - b.xj : (a.campo === 'A' ? -1 : 1)));
    lista.forEach((c, k) => { c.lane = (3.5 - k) * LANE; c.k = k; });
    return lista;
  }

  function crear(THREE) {
    const kit = K.crearKit(THREE), base = Base.crearBase(kit);
    const { grupo } = base;
    const E = {};                                                                      // id → ensamble
    const ens = id => E[id] || (E[id] = kit.ensamble());
    const cable = (id, pts, r, clave, radiales = 4) => {
      const n = Math.max(4, Math.min(260, Math.ceil(largo3(pts) / 7)));
      ens(id).add(kit.tubo(pts, r, n, radiales), clave);
    };
    const gStr = {};
    for (const t of ['STR-101', 'STR-102', 'STR-201', 'STR-202']) gStr[t] = base.nuevoGrupo(t);
    const gBan = base.nuevoGrupo('BAN-001');

    /* ---------- Bandeja de rejilla BAN-001 ---------- */
    {
      const P = D.BANDEJA.puntos, y = D.BANDEJA.y, an = D.BANDEJA.ancho, e = ens('BAN-001');
      for (let i = 1; i < P.length; i++) {
        const a = P[i - 1], b = P[i], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz), alongX = Math.abs(dx) > Math.abs(dz), cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
        const barras = Math.floor(len / 6.5);
        for (let k = 0; k <= barras; k++) {
          const t = k / barras, px = a[0] + dx * t, pz = a[1] + dz * t;
          if (alongX) e.caja(0.55, 0.55, an, 'marcoNegro', [px, y + 0.5, pz]); else e.caja(an, 0.55, 0.55, 'marcoNegro', [px, y + 0.5, pz]);
        }
        for (const s of [-1, 1]) {
          if (alongX) { e.caja(len, 5, 0.55, 'marcoNegro', [cx, y + 2.5, cz + s * an / 2]); e.caja(len, 0.5, 1.1, 'marcoNegro', [cx, y + 5, cz + s * an / 2]); }
          else { e.caja(0.55, 5, len, 'marcoNegro', [cx + s * an / 2, y + 2.5, cz]); e.caja(1.1, 0.5, len, 'marcoNegro', [cx + s * an / 2, y + 5, cz]); }
        }
        // sobre bloques de hormigón cada ~2 m (como en la foto)
        const nb = Math.max(1, Math.floor(len / 200));
        for (let k = 0; k < nb; k++) {
          const t = (k + 0.5) / nb, px = a[0] + dx * t, pz = a[1] + dz * t;
          e.caja(alongX ? 22 : 30, 3.8, alongX ? 30 : 22, 'hormigon', [px, 1.9, pz]);
        }
      }
      e.construir(gBan, 'BAN-001');
    }

    /* ---------- Cables de las cadenas: campo → bandeja → entrada a la caseta → canaletas → equipo ---------- */
    const cables = planificarCables(), A = cables.filter(c => c.campo === 'A'), B = cables.filter(c => c.campo === 'B');
    const conectores = {};                                                              // cadena → [{ arriba, x }]
    const P = D.BANDEJA.puntos;
    const cola = [[P[2][0], P[2][1]], [P[3][0], P[3][1]], [P[4][0], P[4][1]], [P[5][0], P[5][1]]];                 // (60,50) → … → pared de la caseta
    const xPared = C.x + C.ancho / 2 + 3;                                               // por donde sube el cable junto a la pared exterior
    const matMc = kit.mat(0x1c1f24), matMcSup = kit.mat(0x2b3037);
    cables.forEach(c => {
      // recorrido por la bandeja (en planta) desde el punto de unión, con el carril propio de este cable
      const ruta = c.campo === 'A' ? [[c.xj, c.zBandeja]].concat(cola.slice(1)) : [[c.xj, c.zBandeja], [P[1][0], P[1][1]]].concat(cola);
      const tray = desplazarPoligonal(ruta, c.lane).map(p => [p[0], Y_BANDEJA, p[1]]);
      const xu = tray[0][0], zu = tray[0][2], ultimo = tray[tray.length - 1], zl = ultimo[2] - C.z;
      const campoPts = c.tramoCampo.slice(0, -1).concat([[xu, 1.6, zu - 12]]);
      tray[tray.length - 1] = [xPared, Y_BANDEJA, ultimo[2]];
      const interior = [];
      if (c.campo === 'B') {
        const k = B.indexOf(c), zt = [-34, -30, -25, -21][k], yc = 89.4 + 1.15 * k, xB = 132.0;
        interior.push(W(139.5, 22, zl), W(135, 22, zl), W(xB, 24, zl), W(xB, yc, zl), W(xB, yc, zt), W(xB, 98.4, zt));
      } else {
        const k = A.indexOf(c), xt = D.INTERIOR['CB-101'].u + [3.5, 6.5, 9.5, 12.5][k], yc = 89.4 + 1.15 * k, xA = 130.7;
        interior.push(W(139.5, 22, zl), W(135, 22, zl), W(xA, 24, zl), W(xA, yc, zl), W(xA, yc, -101.6), W(xA - 3, yc, -102.4), W(xt, yc, -102.4), W(xt, 121.5, -102.4), W(xt, 124.2, -105));
      }
      const todos = campoPts.concat(tray, [[xPared, 22, ultimo[2]]], interior), sin = [todos[0]];
      for (const p of todos) { const q = sin[sin.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) > 0.8) sin.push(p); }
      cable(c.cadena, sin, 0.6, c.polo === '+' ? 'rojo' : 'negro');
      // MC4 (macho fijo y hembra móvil) en línea sobre el carril de la bandeja, con cinta amarilla de identificación
      const g = gStr[c.cadena], yM = Y_BANDEJA, xm = xu - 14;
      kit.malla(kit.cil(0.95, 4.2, 8), matMc, g, c.cadena, [xm + 2.2, yM, zu], [0, 0, Math.PI / 2]).castShadow = true;
      const arriba = kit.malla(kit.cil(1.15, 4.4, 8), matMcSup, g, c.cadena, [xm - 2.2, yM, zu], [0, 0, Math.PI / 2]); arriba.castShadow = true;
      ens(c.cadena).add(kit.cil(0.8, 1.2, 8), 'amarillo', [xm - 9, yM, zu], [0, 0, Math.PI / 2]);
      (conectores[c.cadena] = conectores[c.cadena] || []).push({ arriba, x: xm - 2.2 });
    });
    // puentes entre los paneles de cada cadena (bajo el marco)
    for (const campo of Object.values(layout.CAMPOS)) for (const cad of campo.cadenas) {
      for (let i = 1; i < cad.paneles.length; i++) {
        const a = D.PANELES[cad.paneles[i - 1]], b = D.PANELES[cad.paneles[i]];
        const ja = juntura(a, 9), jb = juntura(b, -9), med = [(ja[0] + jb[0]) / 2, Math.min(ja[1], jb[1]) - 6, (ja[2] + jb[2]) / 2];
        cable(cad.id, [ja, [ja[0], Math.max(2, ja[1] - 3), ja[2]], med, [jb[0], Math.max(2, jb[1] - 3), jb[2]], jb], 0.55, 'negro');
      }
    }

    /* ---------- Cables interiores a cada equipo (el id es el del equipo de destino) ---------- */
    const I = tag => D.INTERIOR[tag];
    const cb = I('CB-101').u, inv = I('INV-101').u, qb = I('QB-101').u, fb = I('FB-101').u, bx = -40, zc = I('QA-301').u, zz = I('INV-201').u;
    const xW = -D.SEMI.x + 5.7, xW2 = xW + 1.2, zAc = [zc + 3, zc - 3];
    // caja de continua → EASun (positivo y negativo, 10 mm²)
    cable('CB-101', [W(cb - 6, 123.5, -105), W(cb - 6, 121, -102.4), W(cb - 6, 90.0, -101.2), W(inv - 6, 90.0, -101.2), W(inv - 6, 112, -102.2), W(inv - 6, 106.5, -103)], 0.75, 'rojo');
    cable('CB-101', [W(cb - 9, 123.5, -105), W(cb - 9, 121, -102.4), W(cb - 9, 91.2, -101.2), W(inv, 91.2, -101.2), W(inv, 112, -102.2), W(inv, 106.5, -103)], 0.75, 'negro');
    // batería: del EASun al magnetotérmico (QB-101), al portafusible (FB-101) y a los bornes de la batería
    cable('QB-101', [W(inv + 6, 107, -103), W(inv + 6, 100, -98.2), W(qb - 1.8, 78, -98.2), W(qb - 1.8, 73.6, -104.6)], 1.0, 'rojo', 5);
    cable('QB-101', [W(inv + 12, 107, -103), W(inv + 12, 100, -98.2), W(qb + 1.8, 78, -98.2), W(qb + 1.8, 73.6, -104.6)], 1.0, 'negro', 5);
    cable('FB-101', [W(qb - 1.8, 62.8, -104.6), W(qb - 1.8, 58.5, -104), W(fb, 56, -104)], 1.0, 'rojo', 5);
    cable('BAT-101', [W(fb, 42.5, -104), W(fb - 5, 38, -102.5), W(bx - 21, 41.5, -100)], 1.0, 'rojo', 5);
    cable('BAT-101', [W(qb + 1.8, 62.8, -104.6), W(qb + 14, 50, -100.5), W(bx - 14.5, 41.5, -100)], 1.0, 'negro', 5);
    // alterna hacia el cuadro: la del EASun (por la canaleta del fondo) y la del ZCS (desde la pared este)
    cable('QA-301', [W(inv - 12, 106.5, -103), W(inv - 12, 98, -101.0), W(inv - 12, 88.8, -101.0), W(-128, 88.8, -101.0), W(xW + 3, 88.8, -98), W(xW, 88.8, -92), W(xW, 88.8, zAc[0]), W(xW, 96.5, zAc[0]), W(-134.6, 98.6, zAc[0])], 0.95, 0x2d3034);
    cable('QA-301', [W(131, 98.4, zz + 15), W(129.4, 94, zz + 15), W(129.4, 88.8, zz + 15), W(129.4, 88.8, -97), W(124, 88.8, -99.0), W(0, 88.8, -99.0), W(-124, 88.8, -99.0), W(xW2 + 3, 88.8, -95), W(xW2, 88.8, -88), W(xW2, 88.8, zAc[1]), W(xW2, 96.5, zAc[1]), W(-134.6, 98.6, zAc[1])], 0.95, 0x2d3034);
    // acometida: conducto gris del cuadro a la caja de acometida (por fuera de la pared oeste)
    cable('RED-301', [W(-133.5, 157.0, zc - 4), W(-133.5, 165, zc - 4), W(-141, 165, zc - 4), W(-146.2, 165, zc - 4), W(-146.2, 162, zc - 4)], 1.5, 0x8d949a, 6);
    // carga protegida: cable negro del cuadro al carrete del suelo
    cable('LOAD-302', [W(-134.6, 98.6, zc + 9), W(xW - 0.6, 70, zc + 10), W(xW - 3, 30, zc + 6), W(-118, 12, -8), W(-108, 10, -12)], 0.8, 'negro');
    const cablesInt = new THREE.Group(); grupo.add(cablesInt);
    for (const id of Object.keys(E)) {
      if (id === 'BAN-001') continue;
      if (gStr[id]) E[id].construir(gStr[id], id, {}); else E[id].construir(cablesInt, id);
    }

    /* ---------- Animación: conectores MC4 sueltos en las cadenas abiertas ---------- */
    const ganchos = {};
    for (const t of Object.keys(gStr)) {
      ganchos[t] = { efecto: false };
      base.alCambiarEfectos(t, e => { ganchos[t].efecto = e.has('conector_suelto') || e.has('cable_cortado'); });
    }
    base.alActualizar(estado => {
      for (const t of Object.keys(gStr)) {
        const c = K.cadenaDeEstado(estado, t), suelto = !!c.abierta || ganchos[t].efecto;
        for (const m of conectores[t] || []) {
          const x = m.x - (suelto ? 5 : 0);
          if (Math.abs(m.arriba.position.x - x) > 1e-6) { m.arriba.position.x = x; m.arriba.rotation.y = suelto ? 0.45 : 0; }
        }
      }
    });
    function liberar() { kit.liberar(); }
    return { grupo, elementos: base.elementos, actualizar: base.actualizar, finalizar: base.finalizar, liberar, kit, cables };
  }

  const api = { TAGS, crear, desplazarPoligonal, juntura, planificarCables };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else { window.PCT = window.PCT || {}; PCT.fvCableado = api; }
})();
