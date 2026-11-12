// Paneles fotovoltaicos en 3D (DISEÑADOR): campo A (6 policristalinos de marco plateado sobre perfiles y bloques), campo B (8 monocristalinos negros sobre bloques
// triangulares de hormigón, 3 filas) y el grupo de paneles antiguos de adorno. Cada panel de los dos campos es un elemento seleccionable (PV-xxx); la sombra por panel
// (`sombra01`), la suciedad, los diodos de paso (`bypass`) y el aviso de cadena abierta se animan con el estado.
(function () {
  const K = typeof require !== 'undefined' ? require('./kit.js') : PCT.fvKit;
  const D = typeof require !== 'undefined' ? require('./disposicion.js') : PCT.fvDisposicion;
  const Base = typeof require !== 'undefined' ? require('./base_fv.js') : PCT.fvBase;

  /* ---------- Texturas de células (canvas procedural, sin imágenes) ---------- */
  function azarDe(semilla) { let s = semilla >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  /** Policristalino de 60 células (10 × 6): azul medio con granos (facetas) de distinto tono por célula, 3 barras colectoras de plata y rejilla de dedos finos; juntas claras de la lámina trasera. */
  function pintarPoli(ctx, w, h) {
    const azar = azarDe(5), cols = 10, filas = 6, m = Math.round(w * 0.012), cw = (w - 2 * m) / cols, ch = (h - 2 * m) / filas, hueco = Math.max(3, w * 0.006);
    ctx.fillStyle = '#d3d9e2'; ctx.fillRect(0, 0, w, h);                                           // lámina trasera clara entre células
    for (let f = 0; f < filas; f++) for (let c = 0; c < cols; c++) {
      const x = m + c * cw + hueco / 2, y = m + f * ch + hueco / 2, ww = cw - hueco, hh = ch - hueco, v = Math.floor(azar() * 34) - 14;
      ctx.fillStyle = `rgb(${50 + v},${88 + v},${150 + v})`; ctx.fillRect(x, y, ww, hh);
      for (let k = 0; k < 16; k++) {                                                                 // granos cristalinos: facetas de brillo distinto
        const cx = x + azar() * ww, cy = y + azar() * hh, r = ww * (0.12 + azar() * 0.22), dv = (azar() - 0.5) * 34;
        ctx.fillStyle = `rgba(${dv > 0 ? 190 : 10},${dv > 0 ? 215 : 20},${dv > 0 ? 255 : 60},${(Math.abs(dv) / 255).toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(cx + r * (azar() - 0.5), cy - r); ctx.lineTo(cx + r, cy + r * (azar() - 0.5)); ctx.lineTo(cx + r * (azar() - 0.5), cy + r); ctx.lineTo(cx - r, cy + r * (azar() - 0.5)); ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(190,205,230,0.16)'; ctx.lineWidth = Math.max(1, w * 0.0007);
      for (let k = 1; k < 24; k++) { ctx.beginPath(); ctx.moveTo(x + 1, y + k * hh / 24); ctx.lineTo(x + ww - 1, y + k * hh / 24); ctx.stroke(); }            // dedos finos
      ctx.fillStyle = 'rgba(205,214,232,0.62)'; const bw = Math.max(1.5, w * 0.0021);
      for (const q of [0.2, 0.5, 0.8]) ctx.fillRect(x + ww * q - bw / 2, y, bw, hh);                                                                      // barras colectoras
    }
  }
  /** Monocristalino half-cut de 108 medias células (18 × 6) todo negro: células casi negras con esquinas cortadas (pseudocuadradas), 9 hilos de plata muy finos, línea central vertical entre las dos mitades. */
  function pintarMono(ctx, w, h) {
    const azar = azarDe(9), cols = 18, filas = 6, m = Math.round(w * 0.01), cw = (w - 2 * m) / cols, ch = (h - 2 * m) / filas, hueco = Math.max(2, w * 0.0025);
    ctx.fillStyle = '#0b0d12'; ctx.fillRect(0, 0, w, h);
    for (let f = 0; f < filas; f++) for (let c = 0; c < cols; c++) {
      const extra = c >= cols / 2 ? hueco * 1.6 : 0, x = m + c * cw + hueco / 2 + (c === cols / 2 ? hueco * 1.6 : 0), y = m + f * ch + hueco / 2, ww = cw - hueco, hh = ch - hueco, v = Math.floor(azar() * 9);
      const ch2 = ww * 0.16, esquinas = (c % 2 === 0 ? [1, 0, 0, 1] : [0, 1, 1, 0]);
      ctx.fillStyle = `rgb(${24 + v},${30 + v},${46 + v})`; ctx.beginPath();
      ctx.moveTo(x + (esquinas[0] ? ch2 : 0), y); ctx.lineTo(x + ww - (esquinas[1] ? ch2 : 0), y); ctx.lineTo(x + ww, y + (esquinas[1] ? ch2 : 0)); ctx.lineTo(x + ww, y + hh - (esquinas[2] ? ch2 : 0));
      ctx.lineTo(x + ww - (esquinas[2] ? ch2 : 0), y + hh); ctx.lineTo(x + (esquinas[3] ? ch2 : 0), y + hh); ctx.lineTo(x, y + hh - (esquinas[3] ? ch2 : 0)); ctx.lineTo(x, y + (esquinas[0] ? ch2 : 0)); ctx.closePath(); ctx.fill();
      const g2 = ctx.createLinearGradient(x, y, x + ww, y + hh); g2.addColorStop(0, 'rgba(70,95,150,0.20)'); g2.addColorStop(1, 'rgba(70,95,150,0)'); ctx.fillStyle = g2; ctx.fillRect(x, y, ww, hh);
      ctx.strokeStyle = 'rgba(165,178,200,0.62)'; ctx.lineWidth = Math.max(1, w * 0.0008);
      for (let k = 1; k < 9; k++) { ctx.beginPath(); ctx.moveTo(x + k * ww / 9, y + 1); ctx.lineTo(x + k * ww / 9, y + hh - 1); ctx.stroke(); }
      void extra;
    }
    ctx.fillStyle = '#05070a'; ctx.fillRect(w / 2 - hueco * 1.3, m, hueco * 2.6, h - 2 * m);                      // la línea central de las medias células
    ctx.fillStyle = 'rgba(140,150,175,0.55)'; ctx.fillRect(w / 2 - 1, m, 2, h - 2 * m);
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
    const texPoli = kit.pantalla(1024, 620, pintarPoli), texMono = kit.pantalla(1536, 990, pintarMono), texAviso = kit.pantalla(128, 128, pintarAviso);
    const matBypass = kit.registrar(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }));
    const geoBypass = kit.registrar(new THREE.PlaneGeometry(1, 1));
    const matAviso = texAviso ? kit.registrar(new THREE.SpriteMaterial({ map: texAviso.textura, depthTest: false, transparent: true })) : null;

    function matVidrio(tipo) {
      const tex = tipo === 'B' ? texMono : texPoli;
      const propiedades = tex ? { map: tex.textura, roughness: 0.1, metalness: 0.25, envMapIntensity: tipo === 'B' ? 1.5 : 1.25 } : {};
      const base0 = tipo === 'B' ? 0x181d2a : tipo === 'V' ? 0x5c6f96 : 0x2d467a;
      return kit.matDinamico(tex ? 0xffffff : base0, propiedades);
    }

    const paneles = [];          // { tag, tipo, mat, bypass: [mallas], aviso, cache }
    function construirPanel(tag, p, tipo, conElemento) {
      const g = conElemento ? base.nuevoGrupo(tag) : new THREE.Group();
      if (!conElemento) grupo.add(g);
      const pg = new THREE.Group(); pg.position.set(p.x, p.y, p.z); pg.rotation.x = p.inclinacion; g.add(pg);
      const W = p.ancho, L = p.largo, T = p.grueso, ens = kit.ensamble();
      const marco = tipo === 'B' ? 'marcoNegro' : tipo === 'V' ? 'aluminioViejo' : 'aluminio', lado = tipo === 'B' ? 3.4 : 3.2, ala = 1.5;
      // marco de aluminio con perfil: pared exterior, ala superior que muerde el vidrio y pestaña inferior de refuerzo (las cuatro caras)
      for (const sz of [-1, 1]) {
        ens.caja(W, T, 1.3, marco, [0, 0, sz * (L / 2 - 0.65)]).caja(W - 2.6, 0.55, ala, marco, [0, T / 2 - 0.27, sz * (L / 2 - 1.3 - ala / 2)]).caja(W - 2.6, 0.5, 1.4, marco, [0, -T / 2 + 0.6, sz * (L / 2 - 2.0)]);
        ens.caja(1.3, T, L - 2.6, marco, [sz * (W / 2 - 0.65), 0, 0]).caja(ala, 0.55, L - 5.2, marco, [sz * (W / 2 - 1.3 - ala / 2), T / 2 - 0.27, 0]).caja(1.4, 0.5, L - 5.2, marco, [sz * (W / 2 - 2.0), -T / 2 + 0.6, 0]);
      }
      void lado;
      ens.caja(W - 4, 0.7, L - 4, tipo === 'B' ? 'negro' : 'blanco', [0, -T / 2 + 0.9, 0]);                       // lámina trasera
      ens.caja(15, 3, 8.5, 'negro', [0, -T / 2 - 1.2, -L / 2 + 14]).caja(11, 0.5, 5, 'goma', [0, -T / 2 - 2.9, -L / 2 + 14]);   // caja de conexiones trasera con su tapa
      for (const sx of [-1, 1]) ens.add(kit.cil(0.9, 3.4, 8), 'goma', [sx * 5.2, -T / 2 - 1.2, -L / 2 + 8.5], [Math.PI / 2, 0, 0]);   // prensaestopas de salida de los cables
      ens.caja(24, 0.15, 12, 'blanco', [W * 0.18, -T / 2 + 0.4, 6]).caja(22, 0.12, 1.6, 'negro', [W * 0.18, -T / 2 + 0.33, 9]);      // etiqueta con su código de barras
      // tornillería de sujeción: abrazaderas de aluminio con tornillo allen sobre el marco, junto a cada perfil de soporte (cuatro por panel)
      const xs = tipo === 'B' ? [-W / 2 + 26, W / 2 - 26] : [-56, 56];
      for (const x of xs) for (const sz of [-1, 1]) {
        ens.caja(5.2, 0.5, 2.6, 'galvanizado', [x, T / 2 + 0.25, sz * (L / 2 - 1.2)]);
        ens.add(kit.cil(0.55, 1.1, 6), 'galvanizado', [x, T / 2 + 1.0, sz * (L / 2 - 1.2)]);
        ens.add(kit.cil(0.33, 0.3, 6), 'negro', [x, T / 2 + 1.6, sz * (L / 2 - 1.2)]);
      }
      for (const sz of [-1, 1]) for (const sx of [-1, 1]) ens.add(kit.cil(0.4, 0.4, 6), 'galvanizado', [sx * (W / 2 - 0.05), 0, sz * (L / 2 - 6)], [0, 0, Math.PI / 2]);      // tornillos de las escuadras del marco
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
