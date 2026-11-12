// Paneles fotovoltaicos en 3D (DISEÑADOR): campo A (6 policristalinos de marco plateado sobre perfiles y bloques), campo B (8 monocristalinos negros sobre bloques
// triangulares de hormigón, 3 filas) y el grupo de paneles antiguos de adorno. Cada panel de los dos campos es un elemento seleccionable (PV-xxx); la sombra por panel
// (`sombra01`), la suciedad, los diodos de paso (`bypass`) y el aviso de cadena abierta se animan con el estado.
(function () {
  const K = typeof require !== 'undefined' ? require('./kit.js') : PCT.fvKit;
  const D = typeof require !== 'undefined' ? require('./disposicion.js') : PCT.fvDisposicion;
  const Base = typeof require !== 'undefined' ? require('./base_fv.js') : PCT.fvBase;

  /* ---------- Texturas de células (canvas procedural, sin imágenes) ---------- */
  function azarDe(semilla) { let s = semilla >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  /** Policristalino de 60 células (10 × 6): azul con vetas, rejilla de plata fina y dos barras colectoras por célula. */
  function pintarPoli(ctx, w, h) {
    const azar = azarDe(5), cols = 10, filas = 6, m = 7, cw = (w - 2 * m) / cols, ch = (h - 2 * m) / filas;
    ctx.fillStyle = '#b9c0ca'; ctx.fillRect(0, 0, w, h);
    for (let f = 0; f < filas; f++) for (let c = 0; c < cols; c++) {
      const x = m + c * cw, y = m + f * ch, v = Math.floor(azar() * 22);
      const d = ctx.createLinearGradient(x, y, x + cw, y + ch); d.addColorStop(0, `rgb(${52 + v},${72 + v},${112 + v})`); d.addColorStop(1, `rgb(${38 + v},${56 + v},${92 + v})`);
      ctx.fillStyle = d; ctx.fillRect(x + 1.2, y + 1.2, cw - 2.4, ch - 2.4);
      ctx.strokeStyle = 'rgba(205,215,230,0.55)'; ctx.lineWidth = 1;
      for (let k = 1; k < 7; k++) { ctx.beginPath(); ctx.moveTo(x + 1.5, y + k * ch / 7); ctx.lineTo(x + cw - 1.5, y + k * ch / 7); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(235,240,250,0.85)'; ctx.lineWidth = 1.6;
      for (const q of [0.33, 0.66]) { ctx.beginPath(); ctx.moveTo(x + cw * q, y + 1.5); ctx.lineTo(x + cw * q, y + ch - 1.5); ctx.stroke(); }
    }
  }
  /** Monocristalino half-cut de 108 células (18 × 6 medias células): casi negro con rejilla clara y la línea central de las medias células. */
  function pintarMono(ctx, w, h) {
    const azar = azarDe(9), cols = 18, filas = 6, m = 6, cw = (w - 2 * m) / cols, ch = (h - 2 * m) / filas;
    ctx.fillStyle = '#6b7282'; ctx.fillRect(0, 0, w, h);
    for (let f = 0; f < filas; f++) for (let c = 0; c < cols; c++) {
      const x = m + c * cw, y = m + f * ch, v = Math.floor(azar() * 10);
      ctx.fillStyle = `rgb(${26 + v},${32 + v},${48 + v})`; ctx.fillRect(x + 1.6, y + 1.6, cw - 3.2, ch - 3.2);
      ctx.strokeStyle = 'rgba(170,185,210,0.6)'; ctx.lineWidth = 1;
      for (const q of [0.25, 0.5, 0.75]) { ctx.beginPath(); ctx.moveTo(x + cw * q, y + 2); ctx.lineTo(x + cw * q, y + ch - 2); ctx.stroke(); }
    }
    ctx.strokeStyle = 'rgba(225,232,245,0.85)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(m, h / 2); ctx.lineTo(w - m, h / 2); ctx.stroke();
  }
  function pintarAviso(ctx, w, h) {
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(w / 2, 6); ctx.lineTo(w - 6, h - 8); ctx.lineTo(6, h - 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#d62828'; ctx.beginPath(); ctx.moveTo(w / 2, 16); ctx.lineTo(w - 17, h - 14); ctx.lineTo(17, h - 14); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.font = '700 ' + Math.round(h * 0.55) + 'px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', w / 2, h * 0.62);
  }

  function crear(THREE) {
    const kit = K.crearKit(THREE), base = Base.crearBase(kit);
    const { grupo } = base;
    const sinTextura = typeof document === 'undefined';
    const texPoli = kit.pantalla(512, 320, pintarPoli), texMono = kit.pantalla(1024, 340, pintarMono), texAviso = kit.pantalla(128, 128, pintarAviso);
    const matBypass = kit.registrar(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }));
    const geoBypass = kit.registrar(new THREE.PlaneGeometry(1, 1));
    const matAviso = texAviso ? kit.registrar(new THREE.SpriteMaterial({ map: texAviso.textura, depthTest: false, transparent: true })) : null;

    function matVidrio(tipo) {
      const tex = tipo === 'B' ? texMono : texPoli;
      const propiedades = tex ? { map: tex.textura, roughness: 0.2, metalness: 0.1, envMapIntensity: 0.95 } : {};
      const base0 = tipo === 'B' ? 0x181d2a : tipo === 'V' ? 0x5c6f96 : 0x2d467a;
      return kit.matDinamico(tex ? 0xffffff : base0, propiedades);
    }

    const paneles = [];          // { tag, tipo, mat, bypass: [mallas], aviso, cache }
    function construirPanel(tag, p, tipo, conElemento) {
      const g = conElemento ? base.nuevoGrupo(tag) : new THREE.Group();
      if (!conElemento) grupo.add(g);
      const pg = new THREE.Group(); pg.position.set(p.x, p.y, p.z); pg.rotation.x = p.inclinacion; g.add(pg);
      const W = p.ancho, L = p.largo, T = p.grueso, ens = kit.ensamble();
      const marco = tipo === 'B' ? 'marcoNegro' : tipo === 'V' ? 'aluminioViejo' : 'aluminio';
      ens.caja(W, T, 3.2, marco, [0, 0, L / 2 - 1.6]).caja(W, T, 3.2, marco, [0, 0, -L / 2 + 1.6]).caja(3.2, T, L - 6.4, marco, [W / 2 - 1.6, 0, 0]).caja(3.2, T, L - 6.4, marco, [-W / 2 + 1.6, 0, 0]);
      ens.caja(W - 6, 0.8, L - 6, tipo === 'B' ? 'negro' : 'blanco', [0, -T / 2 + 0.6, 0]);
      ens.caja(11, 2.6, 6.5, 'negro', [0, -T / 2 - 1.4, -L / 2 + 14]);                          // caja de conexiones (con sus diodos de paso) en la cara trasera
      ens.construir(pg, conElemento ? tag : null);
      const material = matVidrio(tipo);
      const vidrio = new THREE.Mesh(kit.registrar(new THREE.PlaneGeometry(W - 6.4, L - 6.4)), material);
      vidrio.rotation.x = -Math.PI / 2; vidrio.position.y = T / 2 - 0.15; vidrio.receiveShadow = true; vidrio.castShadow = true;
      if (conElemento) vidrio.userData.id = tag; pg.add(vidrio);
      const entrada = { tag, tipo, material, bypass: [], aviso: null, hex: 0xffffff, avisoVisible: false, base: tipo === 'V' ? 0xbac4d6 : 0xffffff };
      if (conElemento) {
        for (let i = 0; i < 3; i++) {
          const b = new THREE.Mesh(geoBypass, matBypass); b.scale.set((W - 6.4) / 3 - 0.4, L - 6.4, 1); b.rotation.x = -Math.PI / 2; b.position.set((i - 1) * (W - 6.4) / 3, T / 2 + 0.1, 0);
          b.visible = false; b.raycast = () => {}; b.renderOrder = 2; pg.add(b); entrada.bypass.push(b);
        }
        if (matAviso) {
          const s = new THREE.Sprite(matAviso); s.scale.set(26, 26, 1); s.position.set(p.x, p.y + 34, p.z); s.visible = false; s.raycast = () => {}; s.renderOrder = 9; g.add(s); entrada.aviso = s;
        }
        paneles.push(entrada);
        base.alCambiarEfectos(tag, e => { entrada.efectoAviso = e.has('panel_aviso'); });
      }
      return entrada;
    }
    for (const [tag, p] of Object.entries(D.PANELES)) construirPanel(tag, p, p.campo, true);
    D.VIEJOS.forEach((p, i) => construirPanel('viejo' + i, p, 'V', false));

    /* ---------- Soportes ---------- */
    const soportes = new THREE.Group(); grupo.add(soportes);
    const ens = kit.ensamble();
    const normal = inc => [0, Math.cos(inc), Math.sin(inc)];
    // Perfiles de aluminio bajo cada columna de paneles (siguen la pendiente), bloques de hormigón al sur y patas al norte.
    function columnaConPerfiles(sur, norte, xs, def, material) {
      const n = normal(def.inclinacion), d = def.grueso / 2 + 2.6;
      const largo = Math.hypot(sur.x - norte.x, sur.y - norte.y, sur.z - norte.z) + def.largo;
      for (const x of xs) {
        const cx = x, cy = (sur.y + norte.y) / 2 - n[1] * d, cz = (sur.z + norte.z) / 2 - n[2] * d;
        ens.caja(4.6, 4.6, largo - 4, material, [cx, cy, cz], [def.inclinacion, 0, 0]);
        const hBloque = Math.max(10, sur.yBajo - 8);
        ens.caja(40, hBloque, 22, 'hormigon', [cx, hBloque / 2, sur.zBajo - 8]);
        // patas al norte y a la mitad
        for (const t of [0.55, 1]) {
          const zp = sur.zBajo + (norte.zAlto - sur.zBajo) * t + (t === 1 ? 6 : 0), yp = sur.yBajo + (norte.yAlto - sur.yBajo) * t - d * n[1] - 3;
          if (yp > 12) ens.caja(3.6, yp - 6, 3.6, material, [cx, 6 + (yp - 6) / 2, zp]);
          ens.caja(26, 6, 22, 'hormigon', [cx, 3, zp]);
        }
      }
    }
    for (const col of [0, 1]) {
      const lista = Object.values(D.PANELES).filter(p => p.campo === 'A' && p.columna === col).sort((a, b) => a.indice - b.indice);
      columnaConPerfiles(lista[0], lista[lista.length - 1], [D.A.xCol[col] - 56, D.A.xCol[col] + 56], D.A, 'aluminio');
    }
    for (let col = 0; col < 2; col++) {
      const lista = D.VIEJOS.filter(p => p.columna === col).sort((a, b) => b.zBajo - a.zBajo);
      columnaConPerfiles(lista[0], lista[lista.length - 1], [D.ANTIGUOS.xCol[col] - 30, D.ANTIGUOS.xCol[col] + 30], D.ANTIGUOS, 'aluminioViejo');
    }
    // Campo B: bloques triangulares de hormigón con hueco triangular y placa de aislante (poliestireno) debajo, como en la foto
    for (let f = 0; f < D.FILAS_B.length; f++) {
      const fila = D.FILAS_B[f].map(t => D.PANELES[t]), p0 = fila[0], zl = p0.zBajo, tg = Math.tan(D.B.inclinacion);
      const xl = Math.min(...fila.map(p => p.x - p.ancho / 2)), xr = Math.max(...fila.map(p => p.x + p.ancho / 2));
      const P = [[zl + 4.5, 0.1], [zl - 100, 0.1], [zl - 100, 2.4 + 100 * tg]];
      const cz = (P[0][0] + P[1][0] + P[2][0]) / 3, cy = (P[0][1] + P[1][1] + P[2][1]) / 3;
      const hueco = P.map(([z, y]) => [cz + (z - cz) * 0.5, cy + (y - cy) * 0.5]);
      const n = fila.length;
      for (let i = 0; i <= n; i++) {
        const x = xl + 22 + i * (xr - xl - 44) / n;
        ens.add(kit.prisma(P, 28, hueco), 'hormigon', [x, 0, 0]);
        ens.caja(38, 3, 112, 'aislante', [x, 1.5 - 0.1, zl - 47]);
      }
    }
    ens.construir(soportes, null);

    /* ---------- Animación ---------- */
    const hexAjustado = (sombra, suciedad, base0) => {
      const f = K.factorSombra(sombra), g = Math.round(255 * f);
      let c = (g << 16) | (g << 8) | g;                                    // oscurece
      c = K.mezclarHex(c, 0xcbbf9c, 0.55 * K.limitar(suciedad, 0, 1) * f);  // el polvo lo aclara y le da un tono arena
      return base0 === 0xffffff ? c : K.mezclarHex(c, base0, 0.5);
    };
    base.alActualizar(estado => {
      const sucia = estado && estado.ambiente && estado.ambiente.suciedad || {};
      const indice = new Map();
      const campos = estado && estado.campos;
      if (campos) for (const campo of Object.values(campos)) for (const c of (campo.cadenas || [])) for (const p of (c.paneles || [])) indice.set(p.tag, { p, abierta: !!c.abierta });
      for (const e of paneles) {
        const d = indice.get(e.tag), p = d && d.p, campo = D.PANELES[e.tag].campo;
        const hex = hexAjustado(p ? p.sombra01 : 0, K.num(sucia[campo], 0), e.base);
        if (hex !== e.hex) { e.hex = hex; e.material.color.setHex(hex); }
        for (let i = 0; i < 3; i++) { const v = !!(p && p.bypass && p.bypass[i]); if (e.bypass[i].visible !== v) e.bypass[i].visible = v; }
        const aviso = !!(d && d.abierta) || !!e.efectoAviso;
        if (e.aviso && e.aviso.visible !== aviso) e.aviso.visible = aviso;
      }
    });

    function liberar() { kit.liberar(); }
    return { grupo, elementos: base.elementos, actualizar: base.actualizar, finalizar: base.finalizar, liberar, kit, sinTextura };
  }

  const api = { crear, pintarPoli, pintarMono };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else { window.PCT = window.PCT || {}; PCT.fvPaneles = api; }
})();
