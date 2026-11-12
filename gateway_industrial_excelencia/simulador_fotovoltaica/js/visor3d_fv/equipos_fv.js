// Equipos del interior de la caseta en 3D (DISEÑADOR), con las pantallas y los LED VIVOS: inversor híbrido EASun (pantalla azul, rejilla, dongle), inversor ZCS Azzurro
// (pantalla LCD y LED On-Grid / Off-Grid / Alarm), batería LiFePO4 con su etiqueta sobre bloques de hormigón, caja de continua «HT 8WAY» con fusibles, seccionador y
// descargador, magnetotérmico y portafusible de la batería, caja auxiliar del campo B, medidor, cuadro de alterna transparente con su aparamenta, acometida y cargas.
// Cada equipo va colocado en su pared con D.INTERIOR (disposicion.js) y es un elemento seleccionable con su tag; los anidados (fusibles, etc.) son hijos de su caja.
(function () {
  const K = typeof require !== 'undefined' ? require('./kit.js') : PCT.fvKit;
  const D = typeof require !== 'undefined' ? require('./disposicion.js') : PCT.fvDisposicion;
  const Base = typeof require !== 'undefined' ? require('./base_fv.js') : PCT.fvBase;
  const C = D.CASETA;
  const TAGS = ['INV-101', 'INV-201', 'BAT-101', 'COM-101', 'CB-101', 'F-101', 'F-102', 'QS-101', 'SPD-101', 'QB-101', 'FB-101', 'QS-201', 'SPD-201', 'MED-201',
    'QA-301', 'QF-301', 'ID-301', 'QF-302', 'QF-303', 'SPD-301', 'TC-301', 'RED-301', 'LOAD-301', 'LOAD-302'];

  /* ---------- Rótulos pintados (canvas) ---------- */
  const rr = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
  /** Frontal del EASun (38 × 52 cm): marco azul de la pantalla con sus 4 botones, logotipo EASUN POWER y la banda azul «Hybrid Solar Inverter». Fondo transparente. */
  function pintarFrenteEasun(ctx, w, h) {
    const X = x => (x + 19) / 38 * w, Y = y => (52 - y) / 52 * h, S = w / 38;
    ctx.fillStyle = '#2a63b0'; rr(ctx, X(-3.4), Y(44.4), 21.6 * S, 20 * S, 2.2 * S); ctx.fill();
    ctx.fillStyle = '#e9f0f8'; ctx.font = `700 ${0.82 * S}px system-ui, sans-serif`; ctx.textAlign = 'center';
    ['ESC', 'UP', 'DOWN', 'ENTER'].forEach((t, i) => { ctx.fillText(t, X(7.4 - 5.1 + i * 3.4), Y(27.1)); ctx.fillStyle = '#0d1520'; ctx.beginPath(); ctx.arc(X(7.4 - 5.1 + i * 3.4), Y(29.3), 0.95 * S, 0, 7); ctx.fill(); ctx.fillStyle = '#e9f0f8'; });
    ctx.font = `700 ${1.0 * S}px system-ui, sans-serif`; ctx.fillStyle = '#1b3358'; ctx.textAlign = 'left';
    ctx.textAlign = 'center'; ctx.font = `700 ${0.85 * S}px system-ui, sans-serif`;
    ['AC/INV', 'CHG', 'FAULT'].forEach((t, i) => ctx.fillText(t, X(4.4 + i * 3.4), Y(31.6)));
    ctx.fillStyle = '#1b5eaa'; ctx.font = `italic 900 ${5.2 * S}px system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.fillText('EA', X(-15.5), Y(11.4));
    ctx.fillStyle = '#1b5eaa'; ctx.fillText('SUN', X(-9.4), Y(14.0)); ctx.font = `italic 800 ${1.9 * S}px system-ui, sans-serif`; ctx.fillStyle = '#2d9d57'; ctx.fillText('POWER', X(-8.6), Y(11.1));
    ctx.fillStyle = '#ffffff'; ctx.font = `italic 700 ${1.9 * S}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.fillText('Hybrid Solar Inverter', X(2), Y(3.6));
  }
  /** Lateral izquierdo del EASun (15 × 24 cm): ranuras de ventilación redondeadas, puertos RS485/RJ45 con el dongle, regleta verde y etiqueta amarilla de aviso (CAUTION). */
  function pintarRejillaEasun(ctx, w, h) {
    ctx.fillStyle = '#eceae6'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d4d6d8'; rr(ctx, w * 0.08, h * 0.03, w * 0.84, h * 0.50, 6); ctx.fill();
    ctx.fillStyle = '#3a3d42';
    for (let r = 0; r < 9; r++) for (let c = 0; c < 5; c++) { rr(ctx, w * (0.14 + c * 0.16), h * (0.06 + r * 0.052), w * 0.1, h * 0.034, 3); ctx.fill(); }
    ctx.fillStyle = '#8d9298'; ctx.fillRect(w * 0.12, h * 0.575, w * 0.2, h * 0.045); ctx.fillRect(w * 0.36, h * 0.575, w * 0.2, h * 0.045);              // dos conectores RJ45
    ctx.fillStyle = '#13161a'; ctx.fillRect(w * 0.14, h * 0.585, w * 0.16, h * 0.025); ctx.fillRect(w * 0.38, h * 0.585, w * 0.16, h * 0.025);
    ctx.fillStyle = '#2fa84f'; ctx.fillRect(w * 0.66, h * 0.565, w * 0.2, h * 0.07); ctx.fillStyle = '#13161a'; for (let i = 0; i < 4; i++) ctx.fillRect(w * (0.68 + i * 0.045), h * 0.58, w * 0.025, h * 0.03);   // regleta verde
    ctx.fillStyle = '#f2c515'; ctx.fillRect(w * 0.12, h * 0.66, w * 0.76, h * 0.3);                                                                        // etiqueta amarilla
    ctx.fillStyle = '#1c1c1c'; ctx.font = `800 ${Math.round(h * 0.045)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.fillText('CAUTION', w * 0.5, h * 0.71);
    ctx.fillStyle = '#3a3a3a'; for (let i = 0; i < 6; i++) ctx.fillRect(w * 0.16, h * (0.74 + i * 0.033), w * (0.5 + 0.2 * ((i * 7) % 3) / 3), h * 0.012);
  }
  /** Pantalla LCD del EASun: cuatro cuadrantes con su rótulo, la cifra grande y su unidad (AC V, BAT V, PV W, LOAD W), más la etapa de carga o FAULT arriba. */
  function pintarLcdEasun(ctx, w, h, d) {
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#071018'); g.addColorStop(1, '#03070b'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#1b3d63'; ctx.lineWidth = 2; ctx.strokeRect(3, 3, w - 6, h - 6);
    if (!d || d.apagado) return;
    ctx.strokeStyle = '#1f4f86'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(w / 2, h * 0.14); ctx.lineTo(w / 2, h - 8); ctx.moveTo(8, h * 0.57); ctx.lineTo(w - 8, h * 0.57); ctx.stroke();
    const cuadrante = (x, y, rotulo, valor, unidad) => {
      ctx.textAlign = 'left'; ctx.fillStyle = '#4fb0ff'; ctx.font = `700 ${h * 0.115}px system-ui, sans-serif`; ctx.fillText(rotulo, x + 10, y + h * 0.12);
      ctx.fillStyle = '#f4f8ff'; ctx.font = `700 ${h * 0.24}px system-ui, sans-serif`; ctx.fillText(valor, x + 10, y + h * 0.36);
      ctx.fillStyle = '#7fc4ff'; ctx.font = `600 ${h * 0.12}px system-ui, sans-serif`; ctx.textAlign = 'right'; ctx.fillText(unidad, x + w / 2 - 12, y + h * 0.36);
    };
    cuadrante(0, h * 0.10, 'AC', d.ac, 'V'); cuadrante(w / 2, h * 0.10, 'BAT', d.bat, 'V'); cuadrante(0, h * 0.54, 'PV', d.pv, 'W'); cuadrante(w / 2, h * 0.54, 'LOAD', d.carga, 'W');
    ctx.textAlign = 'right'; ctx.font = `700 ${h * 0.11}px system-ui, sans-serif`; ctx.fillStyle = d.fallo ? '#ff4b3e' : '#7fe08a';
    ctx.fillText(d.fallo ? 'FAULT' : { CC: 'CHG', ABSORCION: 'ABS', FLOTACION: 'FLT' }[d.etapa] || '', w - 10, h * 0.11);
    ctx.textAlign = 'left'; ctx.fillStyle = '#5a7fa6'; ctx.fillText(d.modo ? String(d.modo).slice(0, 4) : '', 10, h * 0.11);
  }
  /** Frontal del ZCS Azzurro (45 × 37 cm): logotipo, marco negro de la pantalla con los rótulos de los LED y los botones, etiqueta QR y logotipo ZCS. Fondo transparente. */
  function pintarFrenteZcs(ctx, w, h) {
    const X = x => (x + 22.5) / 45 * w, Y = y => (37 - y) / 37 * h, S = w / 45;
    ctx.strokeStyle = '#d9dde3'; ctx.lineWidth = 0.35 * S; ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.beginPath(); ctx.ellipse(X(-6.5), Y(24.4), 5.6 * S, 2.9 * S, 0, 0, 7); ctx.stroke();
    ctx.fillStyle = '#e6e9ee'; ctx.font = `600 ${2.4 * S}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.fillText('AZZURRO', X(-6.5), Y(24.1));
    ctx.font = `700 ${0.9 * S}px system-ui, sans-serif`; ctx.fillText('ZCS', X(-1.3), Y(22.5));
    ctx.fillStyle = '#07090c'; rr(ctx, X(-12.8), Y(15.2), 18.4 * S, 9.2 * S, 1.2 * S); ctx.fill();
    ctx.strokeStyle = '#2b6cc4'; ctx.lineWidth = 0.22 * S; ctx.beginPath(); ctx.moveTo(X(-12.0), Y(6.9)); ctx.lineTo(X(4.8), Y(6.9)); ctx.stroke();
    ctx.fillStyle = '#dfe3e8'; ctx.font = `600 ${0.95 * S}px system-ui, sans-serif`; ctx.textAlign = 'left';
    ctx.fillText('On-Grid', X(1.1), Y(12.3)); ctx.fillText('Off-Grid', X(1.1), Y(10.7)); ctx.fillText('Alarm', X(1.1), Y(9.1));
    ctx.fillStyle = '#12161b';
    for (let i = 0; i < 4; i++) { rr(ctx, X(-9 + i * 3.2), Y(6.2), 2.2 * S, 1.2 * S, 0.3 * S); ctx.fill(); }
    ctx.fillStyle = '#eef0f2'; ctx.fillRect(X(-19), Y(7.0), 4.2 * S, 3.9 * S);
    ctx.fillStyle = '#222'; for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) if ((i * 7 + j * 3) % 4 < 2) ctx.fillRect(X(-18.5 + i * 0.65), Y(6.5 - j * 0.55), 0.5 * S, 0.45 * S);
    ctx.fillStyle = '#eceff2'; ctx.font = `italic 900 ${2.2 * S}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.fillText('ZCS', X(15.6), Y(4.4));
    ctx.fillStyle = '#2f9e44'; ctx.fillRect(X(12.2), Y(2.6), 2 * S, 0.35 * S); ctx.fillStyle = '#f2f2f2'; ctx.fillRect(X(14.2), Y(2.6), 2 * S, 0.35 * S); ctx.fillStyle = '#d63a2f'; ctx.fillRect(X(16.2), Y(2.6), 2 * S, 0.35 * S);
  }
  /** Pantalla del ZCS (LCD gris verdoso con texto oscuro, rejilla de píxeles y rótulos legibles): estado en la primera línea, Pac, red, PV1 y PV2. */
  function pintarLcdZcs(ctx, w, h, d) {
    ctx.fillStyle = d && d.apagado ? '#59615a' : '#aebda6'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.05)'; for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);                       // píxeles del LCD
    if (!d || d.apagado) return;
    ctx.fillStyle = '#1b2418'; ctx.textAlign = 'left'; ctx.font = `800 ${h * 0.155}px system-ui, sans-serif`;
    let fs = h * 0.155; ctx.font = `800 ${fs}px system-ui, sans-serif`;
    while (ctx.measureText(d.estado).width > w - 16 && fs > 8) { fs -= 1; ctx.font = `800 ${fs}px system-ui, sans-serif`; }
    ctx.fillText(d.estado, 8, h * 0.17);
    ctx.fillRect(6, h * 0.215, w - 12, 2);
    ctx.font = `700 ${h * 0.14}px system-ui, sans-serif`;
    ctx.fillText('Pac ' + d.pac, 8, h * 0.40); ctx.fillText(d.vac + '  ' + d.fac, 8, h * 0.58); ctx.fillText('PV1 ' + d.pv1, 8, h * 0.76); ctx.fillText('PV2 ' + d.pv2, 8, h * 0.94);
    if (d.alarma) { ctx.fillStyle = '#8c1d14'; ctx.textAlign = 'right'; ctx.fillText(d.alarma.slice(0, 14), w - 6, h * 0.40); }
    else if (d.espera > 0) { ctx.textAlign = 'right'; ctx.fillText(Math.round(d.espera) + ' s', w - 6, h * 0.40); }
  }
  /** Etiqueta de la batería (46 × 13 cm): azul con panal, EASUN POWER, LiFePO4 25.6V-100AH y textos de aviso. */
  function pintarEtiquetaBateria(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#1f6fd0'); g.addColorStop(1, '#0e4aa0'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1.4;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 30; c++) { const x = c * 30 + (r % 2 ? 15 : 0), y = r * 26; ctx.beginPath(); for (let k = 0; k < 6; k++) { const a = Math.PI / 3 * k + Math.PI / 6; ctx[k ? 'lineTo' : 'moveTo'](x + 15 * Math.cos(a), y + 15 * Math.sin(a)); } ctx.closePath(); ctx.stroke(); }
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; ctx.font = `italic 900 ${h * 0.3}px system-ui, sans-serif`; ctx.fillText('EA', w * 0.02, h * 0.33);
    ctx.fillStyle = '#fff'; ctx.fillText('SUN', w * 0.12, h * 0.3); ctx.font = `italic 800 ${h * 0.12}px system-ui, sans-serif`; ctx.fillStyle = '#7de08d'; ctx.fillText('POWER', w * 0.13, h * 0.44);
    ctx.fillStyle = '#ffffff'; ctx.font = `700 ${h * 0.14}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.fillText('LiFePO4', w * 0.46, h * 0.2); ctx.fillText('25.6V-100AH', w * 0.46, h * 0.38);
    ctx.textAlign = 'left'; ctx.font = `700 ${h * 0.12}px system-ui, sans-serif`; ctx.fillText('iBattery-EA-24V-100AH', w * 0.02, h * 0.66);
    ctx.font = `500 ${h * 0.07}px system-ui, sans-serif`; ctx.fillText('Lithium Iron Phosphate Rechargeable Deep Cycle Battery', w * 0.02, h * 0.93);
    ctx.font = `600 ${h * 0.065}px system-ui, sans-serif`; ctx.textAlign = 'right'; ctx.fillText('CAUTION · Do not short circuit', w * 0.98, h * 0.12); ctx.fillText('Made in China', w * 0.98, h * 0.93);
  }
  /** Pantallita de la batería (SoC, tensión y estado del BMS). */
  function pintarPantallaBateria(ctx, w, h, d) {
    ctx.fillStyle = '#06090d'; ctx.fillRect(0, 0, w, h);
    if (!d) return;
    const ok = d.bms === 'OK', col = !ok ? '#ff5a4d' : d.soc < 0.2 ? '#ffb020' : '#4fe07a';
    ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.font = `800 ${h * 0.46}px system-ui, sans-serif`; ctx.fillText(Math.round(d.soc * 100) + '%', 6, h * 0.5);
    ctx.font = `600 ${h * 0.2}px system-ui, sans-serif`; ctx.fillStyle = '#d7e3f5'; ctx.fillText(ok ? d.v.toFixed(1).replace('.', ',') + ' V' : 'BMS: ' + d.bms.replace('CORTE_', 'corte '), 6, h * 0.8);
    ctx.fillStyle = '#26303d'; ctx.fillRect(w * 0.62, h * 0.18, w * 0.34, h * 0.28); ctx.fillStyle = col; ctx.fillRect(w * 0.62 + 2, h * 0.18 + 2, (w * 0.34 - 4) * d.soc, h * 0.28 - 4);
  }
  const pintarEtiquetaCaja = texto => (ctx, w, h) => { ctx.fillStyle = '#111'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#fff'; ctx.font = `700 ${h * 0.5}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(texto, w / 2, h / 2 + 1); };
  const pintarPlacaCaja = (t1, t2) => (ctx, w, h) => { ctx.fillStyle = '#e9ecee'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#59626a'; ctx.lineWidth = 3; ctx.strokeRect(2, 2, w - 4, h - 4); ctx.fillStyle = '#15191c'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `800 ${h * 0.38}px system-ui, sans-serif`; ctx.fillText(t1, w / 2, h * 0.34); ctx.font = `600 ${h * 0.2}px system-ui, sans-serif`; ctx.fillText(t2, w / 2, h * 0.74); };

  /** Frontal de un módulo DIN (diferencial, magnetotérmico, descargador, fusible, toma) pintado en un canvas: hueco de la palanca, ventanita de estado, marca, calibre y curva. `o`: { tipo, cuerpo, texto, marca, polos }. */
  function pintarModulo(ctx, w, h, o) {
    const tipo = o.tipo || 'int', css = '#' + (typeof o.cuerpo === 'number' ? o.cuerpo : 0xe3e6e8).toString(16).padStart(6, '0');
    ctx.fillStyle = css; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.13)'; ctx.fillRect(0, 0, Math.max(1.5, w * 0.025), h); ctx.fillRect(w - Math.max(1.5, w * 0.025), 0, Math.max(1.5, w * 0.025), h);
    const marca = o.marca || 'AEG', polos = o.polos || 1;
    if (tipo === 'toma') {
      const g = ctx.createRadialGradient(w / 2, h * 0.5, w * 0.05, w / 2, h * 0.5, w * 0.42); g.addColorStop(0, '#9a9a96'); g.addColorStop(0.75, '#cfcfca'); g.addColorStop(1, '#f2f2ee');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(w / 2, h * 0.5, w * 0.40, 0, 7); ctx.fill();
      ctx.fillStyle = '#26282a'; for (const sx of [-1, 1]) { ctx.beginPath(); ctx.arc(w / 2 + sx * w * 0.14, h * 0.5, w * 0.045, 0, 7); ctx.fill(); }
      ctx.fillStyle = '#b8bcc0'; ctx.fillRect(w * 0.44, h * 0.08, w * 0.12, h * 0.05); ctx.fillRect(w * 0.44, h * 0.87, w * 0.12, h * 0.05);              // contactos de tierra
      ctx.fillStyle = '#44484c'; ctx.font = `700 ${w * 0.1}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.fillText('16A 250V~', w / 2, h * 0.97);
      return;
    }
    if (tipo === 'spd') {                                                                                       // dos cartuchos enchufables con su ventanita
      for (let i = 0; i < 2; i++) {
        const x = w * (0.08 + i * 0.47), cw = w * 0.4, g = ctx.createLinearGradient(x, 0, x + cw, 0); g.addColorStop(0, '#9aa2a8'); g.addColorStop(0.5, '#c4cacf'); g.addColorStop(1, '#8e969c');
        ctx.fillStyle = g; rr(ctx, x, h * 0.07, cw, h * 0.52, w * 0.03); ctx.fill();
        ctx.fillStyle = '#10161a'; ctx.fillRect(x + cw * 0.3, h * 0.12, cw * 0.4, h * 0.07);
      }
      ctx.fillStyle = '#1b2024'; ctx.font = `800 ${Math.min(h * 0.1, w * 0.13)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.fillText(o.texto || 'SPD T2', w / 2, h * 0.7);
      ctx.font = `600 ${Math.min(h * 0.07, w * 0.09)}px system-ui, sans-serif`; ctx.fillText(marca, w / 2, h * 0.83);
      return;
    }
    if (tipo === 'fus') {                                                                                       // portafusibles estrecho: texto girado
      ctx.fillStyle = '#c3c7cb'; ctx.fillRect(w * 0.12, h * 0.06, w * 0.76, h * 0.2);
      ctx.save(); ctx.translate(w * 0.56, h * 0.62); ctx.rotate(-Math.PI / 2); ctx.fillStyle = '#20242a'; ctx.textAlign = 'center'; ctx.font = `800 ${w * 0.5}px system-ui, sans-serif`; ctx.fillText(o.texto || 'gPV 15A', 0, 0); ctx.restore();
      return;
    }
    ctx.fillStyle = '#30353b'; rr(ctx, w * 0.14, h * 0.05, w * 0.72, h * 0.27, Math.min(w, h) * 0.05); ctx.fill();                  // hueco de la palanca
    ctx.fillStyle = '#7d848a'; ctx.fillRect(w * 0.3, h * 0.37, w * 0.4, h * 0.025);                                                 // ventanita de estado (el testigo 3D va delante)
    ctx.fillStyle = '#20242a'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const ancho = w / polos;
    ctx.font = `700 ${Math.min(ancho * 0.26, h * 0.075)}px system-ui, sans-serif`; ctx.fillText(marca, w / 2, h * 0.5);
    if (tipo === 'dif') {
      ctx.font = `800 ${Math.min(w * 0.17, h * 0.13)}px system-ui, sans-serif`; ctx.fillText(o.texto || '40A 30mA', w / 2, h * 0.68);
      ctx.fillStyle = '#e1b71f'; rr(ctx, w * 0.1, h * 0.76, w * 0.22, h * 0.13, 2); ctx.fill(); ctx.fillStyle = '#20242a'; ctx.font = `800 ${Math.min(w * 0.14, h * 0.1)}px system-ui, sans-serif`; ctx.fillText('T', w * 0.21, h * 0.865);   // botón de test
      ctx.font = `600 ${Math.min(w * 0.1, h * 0.07)}px system-ui, sans-serif`; ctx.fillText('AC  230V~', w * 0.64, h * 0.865);
    } else {
      ctx.font = `800 ${Math.min(ancho * 0.52, h * 0.19)}px system-ui, sans-serif`; ctx.fillText(o.texto || 'C16', w / 2, h * 0.73);
      ctx.font = `600 ${Math.min(ancho * 0.22, h * 0.062)}px system-ui, sans-serif`; ctx.fillText('230V~ 6kA', w / 2, h * 0.86);
    }
  }

  function crear(THREE) {
    const kit = K.crearKit(THREE), base = Base.crearBase(kit);
    const interior = new THREE.Group(); interior.position.set(C.x, 0, C.z); base.grupo.add(interior);
    const montar = tag => { const a = D.anclaje(D.INTERIOR[tag]); return base.nuevoGrupo(tag, interior, a.pos, a.giro); };
    const MB = (color, extra) => kit.registrar(new THREE.MeshBasicMaterial(Object.assign({ color }, extra || {})));
    const sinRayo = m => { m.raycast = () => {}; return m; };
    const matTex = (tex, extra) => kit.matDinamico(0xffffff, Object.assign({ map: tex.textura, transparent: true, roughness: 0.55, metalness: 0 }, extra || {}));
    /** Plano con textura pintada (null si no hay DOM). `y` = borde inferior; centrado en x. */
    function plano(padre, tex, w, h, pos, rot, extra) {
      if (!tex) return null;
      return sinRayo(kit.malla(new THREE.PlaneGeometry(w, h), matTex(tex, extra), padre, null, pos, rot || [0, 0, 0]));
    }
    const lcds = [];          // pantallas dinámicas: { tex, pintar(datos), clave }
    const regLcd = (tex, f) => { const o = { tex, ultima: null, f }; if (tex) lcds.push(o); return o; };
    function pintarSi(o, clave, datos) { if (!o.tex || o.ultima === clave) return; o.ultima = clave; o.tex.repintar(datos); }

    /* ---------- Aparamenta modular (magnetotérmicos, diferenciales, fusibles, descargadores, toma) ---------- */
    const aparatos = [];      // { tag, tipo, palancas, testigo, mtestigo, o, estado }
    const texModulos = new Map();
    /** Textura del frontal de un módulo (una por aspecto distinto: tipo, color, rótulo y tamaño). */
    function texModulo(o) {
      const clave = [o.tipo || 'int', o.cuerpo, o.texto || '', o.marca || '', o.polos === undefined ? 1 : o.polos, o.w, o.h].join('|');
      if (!texModulos.has(clave)) texModulos.set(clave, kit.pantalla(Math.max(64, Math.round(o.w * 40)), Math.round((o.h - 2.2) * 40), (ctx, w, h) => pintarModulo(ctx, w, h, o)));
      return texModulos.get(clave);
    }
    const Y_TESTIGO = { spd: 0.76, fus: 0.76, dif: 0.59, int: 0.59 };
    function modular(padre, tag, o) {
      const idM = o.id || tag, tipo = o.tipo || 'int';                                                          // `o.id`: pieza sin elemento propio que pertenece al equipo `id`
      let g;
      if (o.id) { g = new THREE.Group(); g.position.set(o.x, o.y, o.z); padre.add(g); } else g = base.nuevoGrupo(tag, padre, [o.x, o.y, o.z]);
      const e = kit.ensamble(), polos = o.polos === undefined ? 1 : o.polos, np = Math.max(1, polos);
      e.caja(o.w, o.h, o.d, o.cuerpo || 0xe3e6e8, [0, o.h / 2, o.d / 2]);
      for (const y of [o.h - 0.5, 0.5]) {                                                                       // tapas de bornes (arriba y abajo) con su tornillo por polo
        e.caja(o.w * 0.96, 1.0, 0.5, 0x7a8187, [0, y, o.d + 0.2]);
        if (tipo !== 'toma') for (let i = 0; i < np; i++) e.add(kit.cil(Math.min(0.32, o.w / np * 0.12), 0.3, 6), 0x2a2e33, [(i - (np - 1) / 2) * o.w / np, y, o.d + 0.5], [Math.PI / 2, 0, 0]);
      }
      if (tipo === 'dif') e.caja(o.w * 0.2, 0.85, 0.35, 0xe1b71f, [-o.w * 0.29, o.h - 1.1 - 0.825 * (o.h - 2.2), o.d + 0.2]);   // botón de test amarillo
      if (tipo === 'toma') e.add(kit.toro(o.w * 0.4, 0.2, Math.PI * 2, 18), 0xe6e6e2, [0, o.h / 2, o.d + 0.1]);
      e.construir(g, idM);
      const tex = texModulo(Object.assign({}, o, { tipo }));
      if (tex) plano(g, tex, o.w * 0.97, o.h - 2.2, [0, o.h / 2, o.d + 0.06], [0, 0, 0], { transparent: false, roughness: 0.4 });
      const palancas = [], matP = kit.mat(o.palanca || 'negro');
      if (tipo !== 'spd' && tipo !== 'toma') for (let i = 0; i < polos; i++) {
        const x = (i - (polos - 1) / 2) * o.w / polos;
        const p = kit.malla(kit.caja(o.w / polos * 0.5, o.h * 0.2, o.d * 0.35), matP, g, idM, [x, o.h * 0.74, o.d * 0.9]); p.castShadow = true; palancas.push(p);
      }
      let mt = null, testigo = null;
      if (o.testigo !== false) {
        mt = MB(tipo === 'spd' ? 0x2fd05a : 0x20252a);
        testigo = kit.malla(new THREE.PlaneGeometry(o.w * (tipo === 'spd' ? 0.7 : 0.4), o.h * (tipo === 'fus' ? 0.1 : 0.06)), mt, g, idM, [0, o.h * Y_TESTIGO[tipo], o.d + 0.14]);
      }
      const a = { tag: idM, tipo: o.tipo || 'int', palancas, testigo, mt, o, estado: null }; aparatos.push(a);
      base.alCambiarEfectos(idM, ef => { a.efectoRojo = ef.has('testigo_rojo'); a.estado = null; });
      return g;
    }
    function aplicarAparato(a, estadoSim) {
      if (a.tipo === 'relleno') return;
      const est = K.proteccionDe(estadoSim, a.tag).estado || (a.tipo === 'spd' ? 'SANO' : 'CERRADO');
      const clave = est + (a.efectoRojo ? '!' : '');
      if (a.estado === clave) return; a.estado = clave;
      const h = a.o.h, malo = est === 'ABIERTO' || est === 'DISPARADO' || est === 'FUNDIDO' || est === 'AGOTADO' || !!a.efectoRojo;
      if (a.tipo === 'spd') { a.mt.color.setHex(est === 'AGOTADO' || a.efectoRojo ? 0xff2d1f : 0x2fd05a); return; }
      for (const p of a.palancas) {
        if (est === 'DISPARADO') p.position.y = h * 0.66; else p.position.y = h * (a.tipo === 'fus' ? (est === 'FUNDIDO' ? 0.9 : 0.74) : (malo ? 0.58 : 0.74));
        p.rotation.x = est === 'DISPARADO' ? 0.35 : malo ? 0.5 : 0;
      }
      if (a.mt) a.mt.color.setHex(est === 'DISPARADO' ? 0xffa21f : est === 'FUNDIDO' ? 0xff2d1f : est === 'ABIERTO' ? 0x39424b : 0x20252a);
    }

    /**
     * Caja de pared con tapa de plástico ahumado (la «Tapa» la quita): cuerpo blanco con tapas gruesas arriba y abajo, bisagra a la izquierda, manecillas a la derecha, junta negra, carriles DIN,
     * prensaestopas de abajo, y reflejos del cielo sobre la tapa. Devuelve { tapa, cuerpo } (cuerpo = fondo de las piezas, desde la pared).
     */
    const tapas = [];
    const texReflejo = kit.pantalla(256, 512, K.pintarReflejoTapa);
    const matReflejo = texReflejo ? kit.registrar(new THREE.MeshBasicMaterial({ map: texReflejo.textura, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5, toneMapped: false })) : null;
    function cajaConTapa(g, tag, ancho, alto, fondo, opc = {}) {
      const e = kit.ensamble(), t = 1.2, cuerpo = fondo - 3, capa = opc.gruesos ? 3.2 : 1.4;
      e.caja(ancho, alto, 1, 'blancoCaja', [0, alto / 2, 0.5]);
      e.caja(ancho, t, cuerpo, 'blancoCaja', [0, alto - t / 2, cuerpo / 2]).caja(ancho, t, cuerpo, 'blancoCaja', [0, t / 2, cuerpo / 2]);
      e.caja(t, alto, cuerpo, 'blancoCaja', [ancho / 2 - t / 2, alto / 2, cuerpo / 2]).caja(t, alto, cuerpo, 'blancoCaja', [-ancho / 2 + t / 2, alto / 2, cuerpo / 2]);
      for (const y of opc.carriles || []) e.caja(ancho - 4, 3.5, 0.8, 'galvanizado', [0, y, 1.4]);
      for (const x of opc.glandulas || []) { e.add(kit.cil(1.0, 2.4, 10), 'negro', [x, -1.2, 3]); e.add(kit.cil(1.35, 1.0, 6), 'blancoCaja', [x, 0.1, 3]); }
      // marco de la tapa: bordes gruesos (blanco) arriba y abajo y laterales finos, más la junta negra interior
      e.caja(ancho, capa, 1.9, 'blancoCaja', [0, alto - capa / 2, cuerpo + 0.95]).caja(ancho, capa, 1.9, 'blancoCaja', [0, capa / 2, cuerpo + 0.95]);
      e.caja(1.2, alto - 2 * capa, 1.9, 'blancoCaja', [ancho / 2 - 0.6, alto / 2, cuerpo + 0.95]).caja(1.2, alto - 2 * capa, 1.9, 'blancoCaja', [-ancho / 2 + 0.6, alto / 2, cuerpo + 0.95]);
      const ia = ancho - 2.4, ih = alto - 2 * capa;
      e.caja(ia, 0.7, 0.5, 'negro', [0, alto - capa - 0.35, cuerpo + 2.15]).caja(ia, 0.7, 0.5, 'negro', [0, capa + 0.35, cuerpo + 2.15]);
      e.caja(0.7, ih, 0.5, 'negro', [ia / 2 - 0.35, alto / 2, cuerpo + 2.15]).caja(0.7, ih, 0.5, 'negro', [-ia / 2 + 0.35, alto / 2, cuerpo + 2.15]);
      for (const f of opc.gruesos ? [0.14, 0.5, 0.86] : [0.25, 0.75]) e.add(kit.cil(0.5, 2.2, 8), 'galvanizado', [-ancho / 2 + 0.55, alto * f, cuerpo + 1.3]);                 // bisagra
      const manec = (opc.gruesos ? [0.82, 0.2] : [0.5]);
      for (const f of manec) {                                                                                  // manecillas de cierre (marco negro con botones blancos)
        const hh = opc.gruesos ? 9 : 3.4, x = ancho / 2 - 1.2;
        e.caja(1.9, hh, 0.5, 'negro', [x, alto * f, cuerpo + 2.3]);
        if (opc.gruesos) { e.caja(1.3, 2.2, 0.6, 'blanco', [x, alto * f + 2.6, cuerpo + 2.6]).caja(1.3, 2.2, 0.6, 'blanco', [x, alto * f - 0.2, cuerpo + 2.6]).caja(1.3, 2.2, 0.6, 'blanco', [x, alto * f - 3.0, cuerpo + 2.6]); }
        else e.caja(1.3, 1.8, 0.6, 'blanco', [x, alto * f, cuerpo + 2.6]);
      }
      e.construir(g, tag);
      const tapa = kit.malla(kit.caja(ancho - 2.4, ih, 1.6), kit.matDinamico(opc.color || 0x20262c, { transparent: true, opacity: opc.opacidad || 0.2, depthWrite: false, roughness: 0.06, envMapIntensity: 0.5 }), g, tag, [0, alto / 2, cuerpo + 1.5]);
      tapa.userData.tapa = true; tapas.push(tapa);
      if (matReflejo) { const r = kit.malla(new THREE.PlaneGeometry(ia - 0.4, ih - 0.4), matReflejo, g, null, [0, alto / 2, cuerpo + 2.35]); r.raycast = () => {}; r.renderOrder = 3; r.userData.tapa = true; tapas.push(r); }
      return { tapa, cuerpo };
    }

    /* ---------- EASun INV-101 ---------- */
    let ledsEasun, lcdEasun;
    {
      const def = D.INTERIOR['INV-101'], g = montar('INV-101'), w = def.ancho, h = def.alto, d = def.fondo, hb = 8.3, e = kit.ensamble();
      e.caja(w, h - hb, d, 0xf5f5f2, [0, hb + (h - hb) / 2, d / 2]).caja(w, hb, d, 'azul', [0, hb / 2, d / 2]);
      e.caja(w * 0.9, 0.4, d * 0.9, 0xe0e0dc, [0, h + 0.1, d / 2]);
      for (const sx of [-1, 1]) e.caja(4.4, 2.6, 1.2, 0xdadad6, [sx * 12, h + 1.3, 0.6]);
      e.construir(g, 'INV-101');
      for (let i = 0; i < 4; i++) kit.malla(kit.cil(0.95, 0.5, 12), kit.mat('negro'), g, 'INV-101', [7.4 - 5.1 + i * 3.4, 29.3, d + 0.2], [Math.PI / 2, 0, 0]);
      for (const x of [-12, -6, 0, 6, 12]) e.add(kit.cil(1.4, 4, 10), 'goma', [x, -1.8, 5]);                    // pasacables inferiores
      e.construir(g, 'INV-101');
      const frente = kit.pantalla(760, 1040, pintarFrenteEasun);
      plano(g, frente, w, h, [0, h / 2, d + 0.05]);
      const rejilla = kit.pantalla(300, 480, pintarRejillaEasun);
      plano(g, rejilla, d * 0.95, 24, [-w / 2 - 0.08, 31, d / 2], [0, -Math.PI / 2, 0], { transparent: false });
      const lcdTex = kit.pantalla(384, 256, pintarLcdEasun);
      lcdEasun = regLcd(lcdTex, pintarLcdEasun);
      const mLcd = lcdTex ? kit.matDinamico(0xffffff, { map: lcdTex.textura, roughness: 0.2, metalness: 0 }) : kit.matDinamico(0x05080c);
      sinRayo(kit.malla(new THREE.PlaneGeometry(12.4, 8.2), mLcd, g, 'INV-101', [7.4, 36.8, d + 0.15]));
      ledsEasun = [0xff5a1f, 0x2fd05a, 0xffb020].map((c, i) => { const m = MB(0x1b232b); sinRayo(kit.malla(new THREE.CircleGeometry(0.42, 10), m, g, 'INV-101', [4.4 + i * 3.4, 33.0, d + 0.18])); return m; });
    }
    /* ---------- COM-101: dongle de comunicaciones del EASun ---------- */
    let ledCom;
    {
      const c = D.INTERIOR['COM-101'].caja, g = base.nuevoGrupo('COM-101', interior, [(c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2, (c.z0 + c.z1) / 2]), e = kit.ensamble();
      e.caja(8.4, 3.4, 3.2, 0x1f2328, [0, 0, 0]).caja(3.6, 2.2, 1.8, 'galvanizado', [4.4, 0, 0]).caja(5, 0.2, 2, 0x384049, [-0.6, 1.75, 0]);
      e.construir(g, 'COM-101');
      ledCom = MB(0x39d98a); sinRayo(kit.malla(new THREE.CircleGeometry(0.4, 8), ledCom, g, 'COM-101', [-2.4, 1.86, 0], [-Math.PI / 2, 0, 0]));
      base.alCambiarEfectos('COM-101', ef => { ledCom.color.setHex(ef.has('led_apagado') ? 0x1d2a25 : 0x39d98a); });
    }

    /* ---------- Caja de continua «HT 8WAY» CB-101 con F-101, F-102, QS-101 y SPD-101 ---------- */
    {
      const def = D.INTERIOR['CB-101'], g = montar('CB-101');
      const { cuerpo } = cajaConTapa(g, 'CB-101', def.ancho, def.alto, def.fondo, { carriles: [11], glandulas: [-9, -6, 3.5, 6.5, 9.5, 12.5], opacidad: 0.16, color: 0xcfd8de });
      const zD = 1.8, yD = 11 - 4.5;
      const etq = kit.pantalla(160, 48, pintarEtiquetaCaja('HT 8WAY'));
      if (etq) sinRayo(kit.malla(new THREE.PlaneGeometry(6.4, 1.9), matTex(etq, { transparent: false }), g, null, [9.6, def.alto - 2.6, cuerpo + 0.5]));
      modular(g, 'F-101', { x: -10.6, y: yD, z: zD, w: 2.2, h: 9, d: 5.2, tipo: 'fus', palanca: 0xd9dde0, cuerpo: 0xdcdfe1 });
      modular(g, 'F-102', { x: -8.2, y: yD, z: zD, w: 2.2, h: 9, d: 5.2, tipo: 'fus', palanca: 0xd9dde0, cuerpo: 0xdcdfe1 });
      modular(g, 'QS-101', { x: -2.8, y: yD, z: zD, w: 7.2, h: 9, d: 5.2, polos: 2, palanca: 0xd63a2f, cuerpo: 0xe2e5e7, texto: 'DC 32A', marca: 'HT' });
      modular(g, 'SPD-101', { x: 5.2, y: yD, z: zD, w: 7.2, h: 9, d: 5.2, tipo: 'spd', cuerpo: 0xdadfe3 });
      modular(g, 'CB-101', { id: 'CB-101', x: 10.6, y: yD, z: zD, w: 1.7, h: 9, d: 5.2, cuerpo: 0xc5c9cc, testigo: false, tipo: 'relleno' });
    }
    /* ---------- QB-101: magnetotérmico de continua 2P sobre carril DIN, y FB-101: portafusible azul ---------- */
    {
      const def = D.INTERIOR['QB-101'], g = montar('QB-101'), e = kit.ensamble();
      e.caja(16, 3.5, 0.8, 'galvanizado', [0, 3.2, 0.4]);
      for (const sx of [-1, 1]) e.add(kit.cil(0.55, 1.3, 8), 'galvanizado', [sx * 6.6, 3.2, 1.1], [Math.PI / 2, 0, 0]);
      e.construir(g, 'QB-101');
      modular(g, 'QB-101', { id: 'QB-101', x: 0, y: -1.0, z: 0.8, w: 7.2, h: 9.6, d: 5.2, polos: 2, palanca: 0x2d6bd0, cuerpo: 0xe6e8ea, texto: 'C63 DC', marca: 'HIMEL' });
      const fb = D.INTERIOR['FB-101'], gf = montar('FB-101'), ef = kit.ensamble();
      ef.caja(6, 13.5, 1.8, 'negro', [0, 6.75, 0.9]).caja(4.6, 10.5, 3, 0x6fb4ee, [0, 6.75, 3.3]).caja(3, 8, 1.2, 'galvanizado', [0, 6.75, 3.3]);
      ef.caja(5.2, 2, 3.4, 0x2a2f35, [0, 12.4, 3.1]).caja(5.2, 2, 3.4, 0x2a2f35, [0, 1.1, 3.1]);
      ef.construir(gf, 'FB-101');
      const matFus = kit.matDinamico(0xc9ced3);
      const fus = kit.malla(kit.caja(1.6, 6, 1.0), matFus, gf, 'FB-101', [0, 6.75, 4.5]);
      const cubierta = kit.malla(kit.caja(4.8, 10.6, 3.1), kit.matDinamico(0x7fc0f0, { transparent: true, opacity: 0.5, depthWrite: false }), gf, 'FB-101', [0, 6.75, 3.3]); void cubierta; void fb;
      aparatos.push({ tag: 'FB-101', tipo: 'fus-simple', palancas: [], testigo: null, mt: null, o: { h: 13 }, estado: null, matFus });
    }
    /* ---------- Batería BAT-101 sobre dos bloques de hormigón ---------- */
    let pantBat;
    {
      const c = D.INTERIOR['BAT-101'].caja, cx = -40, cz = -95, g = base.nuevoGrupo('BAT-101', interior, [cx, 0, cz]), e = kit.ensamble();
      for (const bx of [-20, 20.5]) {
        e.caja(39, 14, 19, 'hormigon', [bx, 7, -2.5]);
        for (const dx of [-8.5, 8.5]) e.caja(12, 7, 0.3, 'hormigonOscuro', [bx + dx, 7, 7.05]);
      }
      e.caja(52, 20, 22, 'negro', [0, 24, 0]).caja(53, 5.4, 23, 0x1d2024, [0, 35.3, 0]);
      e.caja(10, 1.1, 3.2, 'negro', [16, 38.6, 0]).add(kit.cil(0.45, 5, 6), 'negro', [11.2, 38.4, 0]).add(kit.cil(0.45, 5, 6), 'negro', [20.8, 38.4, 0]);
      for (const [x, col] of [[-21, 'rojo'], [-14.5, 'negro']]) { e.add(kit.cil(1.3, 2.4, 10), 'galvanizado', [x, 38.9, -5]); e.add(kit.cil(1.7, 0.8, 10), col, [x, 40.3, -5]); }
      e.caja(8, 5, 0.6, 'negro', [-24.5, 33, 11.6]);                                                           // soporte de bornas lateral
      e.construir(g, 'BAT-101');
      const et = kit.pantalla(768, 220, pintarEtiquetaBateria);
      plano(g, et, 47, 13.4, [0, 21.8, 11.12], [0, 0, 0], { transparent: false });
      const ps = kit.pantalla(256, 120, pintarPantallaBateria);
      pantBat = regLcd(ps, pintarPantallaBateria);
      sinRayo(kit.malla(new THREE.PlaneGeometry(14.5, 6.8), ps ? kit.matDinamico(0xffffff, { map: ps.textura, roughness: 0.25, metalness: 0 }) : kit.matDinamico(0x06090d), g, 'BAT-101', [14.2, 22.6, 11.2]));
      void c;
    }

    /* ---------- ZCS INV-201 ---------- */
    let ledsZcs, lcdZcs;
    {
      const def = D.INTERIOR['INV-201'], g = montar('INV-201'), w = def.ancho, h = def.alto, d = def.fondo, e = kit.ensamble();
      e.caja(w, h, d, 'zcs', [0, h / 2, d / 2]).caja(w - 3, h - 3, 0.5, 0x50545c, [0, h / 2, d + 0.1]);
      for (const [x, y] of [[-w / 2 + 2.5, h - 2.5], [w / 2 - 2.5, h - 2.5], [-w / 2 + 2.5, 2.5], [w / 2 - 2.5, 2.5]]) e.add(kit.cil(0.5, 0.5, 8), 'galvanizado', [x, y, d + 0.5], [Math.PI / 2, 0, 0]);
      for (const [x, col] of [[-14, 'rojo'], [-10, 'negro']]) { e.add(kit.cil(1.0, 4, 8), 'negro', [x, -1.8, 6]); e.add(kit.cil(0.55, 6, 6), col, [x, -6, 6]); }
      for (const [x, col] of [[-5, 'rojo'], [-1, 'negro']]) { e.add(kit.cil(1.0, 4, 8), 'negro', [x, -1.8, 6]); e.add(kit.cil(0.55, 6, 6), col, [x, -6, 6]); }
      e.add(kit.cil(2.2, 6, 12), 'negro', [15, -2.6, 7]).caja(2.4, 4.4, 1.6, 'negro', [5, -1.8, 7]);               // conector de red y módulo Wi-Fi
      for (const [dx, col] of [[-0.8, 0x6b3b1e], [0, 0x1f5fb5], [0.8, 0xc9b52c]]) e.add(kit.cil(0.28, 9, 5), col, [15 + dx, -8.6, 7], [0, 0, dx * 0.12]);   // cables de alterna (marrón, azul y amarillo-verde) saliendo del prensaestopas
      e.construir(g, 'INV-201');
      const frente = kit.pantalla(1024, 840, pintarFrenteZcs);
      plano(g, frente, w, h, [0, h / 2, d + 0.42]);
      const lcdTex = kit.pantalla(512, 288, pintarLcdZcs);
      lcdZcs = regLcd(lcdTex, pintarLcdZcs);
      sinRayo(kit.malla(new THREE.PlaneGeometry(10.2, 5.7), lcdTex ? kit.matDinamico(0xffffff, { map: lcdTex.textura, roughness: 0.25, metalness: 0 }) : kit.matDinamico(0x7d8a76), g, 'INV-201', [-7.6, 11.9, d + 0.55]));
      ledsZcs = [12.6, 11.0, 9.4].map((y) => { const m = MB(0x1c2420); sinRayo(kit.malla(new THREE.CircleGeometry(0.34, 10), m, g, 'INV-201', [-0.2, y, d + 0.58])); return m; });
    }
    /* ---------- Caja auxiliar del campo B (QS-201 y SPD-201) y medidor MED-201 ---------- */
    {
      const def = D.INTERIOR['QS-201'], g = montar('QS-201');
      cajaConTapa(g, 'QS-201', def.ancho, def.alto, def.fondo, { carriles: [8.5], glandulas: [-6, 6], opacidad: 0.2, color: 0xcfd8de });
      modular(g, 'QS-201', { id: 'QS-201', x: -5.2, y: 4, z: 1.8, w: 7.2, h: 9, d: 3.6, polos: 2, palanca: 0xd63a2f, cuerpo: 0xe2e5e7, texto: 'DC 20A', marca: 'HT' });
      modular(g, 'SPD-201', { x: 3.6, y: 4, z: 1.8, w: 7.2, h: 9, d: 3.6, tipo: 'spd', cuerpo: 0xdadfe3 });
      const dm = D.INTERIOR['MED-201'], gm = montar('MED-201'), em = kit.ensamble();
      em.caja(dm.ancho, dm.alto, dm.fondo, 0xe9ebec, [0, dm.alto / 2, dm.fondo / 2]).caja(dm.ancho - 1.4, 3.4, 0.3, 0x121a14, [0, dm.alto - 2.6, dm.fondo + 0.1]).caja(dm.ancho - 2, 1, 0.3, 0xc9cdd1, [0, 2.2, dm.fondo + 0.1]);
      em.construir(gm, 'MED-201');
      sinRayo(kit.malla(new THREE.PlaneGeometry(dm.ancho - 3, 1.6), MB(0xc8e0a0), gm, 'MED-201', [0, dm.alto - 2.6, dm.fondo + 0.3]));
    }
    /* ---------- Cuadro de alterna QA-301, transparente, con su aparamenta ---------- */
    {
      const def = D.INTERIOR['QA-301'], g = montar('QA-301');
      const { cuerpo } = cajaConTapa(g, 'QA-301', def.ancho, def.alto, def.fondo, { gruesos: true, carriles: [45, 29, 13], glandulas: [-9, -3, 3, 9], color: 0x161b20, opacidad: 0.42 });
      for (const y of [8, 28, 48]) kit.malla(kit.caja(1.4, 4.2, 2.2), kit.mat('blanco'), g, 'QA-301', [def.ancho / 2 - 0.2, y, cuerpo + 1.8]);   // cierres de la tapa
      const z = 1.8;
      modular(g, 'QF-301', { x: 3.2, y: 45 - 4.5, z, w: 3.6, h: 9, d: 4.2, cuerpo: 0xe4e6e8, texto: 'C16' });
      modular(g, 'ID-301', { x: -4.6, y: 45 - 4.5, z, w: 7.2, h: 9, d: 4.2, polos: 2, palanca: 0x555b62, cuerpo: 0xe8e5d2, tipo: 'dif', texto: '40A 30mA' });
      modular(g, 'QF-302', { x: -7.4, y: 29 - 4.5, z, w: 3.6, h: 9, d: 4.2, cuerpo: 0xe4e6e8, palanca: 0xe8a21b, texto: 'C10' });
      modular(g, 'QF-303', { x: -3.6, y: 29 - 4.5, z, w: 3.6, h: 9, d: 4.2, cuerpo: 0xe4e6e8, palanca: 0xe8a21b, texto: 'C16' });
      modular(g, 'SPD-301', { x: 3.6, y: 29 - 4.5, z, w: 7.2, h: 9, d: 4.2, tipo: 'spd', cuerpo: 0xdadfe3 });
      modular(g, 'TC-301', { x: 3.4, y: 13 - 4.5, z, w: 6.6, h: 9, d: 4.8, tipo: 'toma', testigo: false, cuerpo: 0xf4f4f0, polos: 0 });
      aparatos.pop();                                                                                           // la toma no tiene estado
      modular(g, 'QA-301', { id: 'QA-301', x: -4.2, y: 13 - 4.5, z, w: 3.6, h: 9, d: 4.2, cuerpo: 0xe4e6e8, testigo: false, tipo: 'relleno', texto: 'C10' });
    }
    /* ---------- Acometida RED-301 (por fuera de la pared oeste), consumo LOAD-301 (pared norte) y cargas protegidas LOAD-302 (carrete) ---------- */
    {
      const gr = base.nuevoGrupo('RED-301', interior, [-C.ancho / 2 - 0.2, 118, -10], -Math.PI / 2), er = kit.ensamble();
      er.caja(24, 40, 13, 0xbfc5c9, [0, 20, 6.5]).caja(22, 38, 0.8, 0xd5dadd, [0, 20, 13.2]).caja(14, 14, 0.8, 0x1d2328, [0, 28, 13.8]);
      for (const x of [-6, 6]) er.add(kit.cil(1.6, 6, 10), 'galvanizado', [x, 42, 6]);
      er.add(kit.cil(1.6, 14, 10), 'goma', [0, -5, 6]);
      er.construir(gr, 'RED-301');
      const pl = kit.pantalla(192, 64, pintarPlacaCaja('ACOMETIDA', 'RED 230 V · 50 Hz'));
      plano(gr, pl, 15, 5, [0, 12, 13.7], [0, 0, 0], { transparent: false });
      const gl = base.nuevoGrupo('LOAD-301', interior, [60, 118, -C.fondo / 2 - 0.2], Math.PI), el = kit.ensamble();
      el.caja(30, 36, 11, 0xd4d8db, [0, 18, 5.5]).caja(26, 32, 0.8, 0xe5e8ea, [0, 18, 11.2]).caja(12, 7, 0.8, 0x262c32, [0, 24, 11.8]);
      for (const x of [-9, 0, 9]) el.add(kit.cil(1.5, 8, 10), 'galvanizado', [x, -2, 5]);
      el.add(kit.cil(1.5, 40, 10), 'galvanizado', [0, 42, 5]);
      el.construir(gl, 'LOAD-301');
      const pl2 = kit.pantalla(192, 64, pintarPlacaCaja('CONSUMO', 'CENTRO · AULAS'));
      plano(gl, pl2, 15, 5, [0, 12, 11.7], [0, 0, 0], { transparent: false });
      const c = D.DECORADO.carrete.caja, gc = base.nuevoGrupo('LOAD-302', interior, [(c.x0 + c.x1) / 2, 0, (c.z0 + c.z1) / 2]), ec = kit.ensamble();
      ec.caja(34, 2.4, 30, 'negro', [0, 1.2, 0]).caja(2, 16, 2, 'negro', [-16, 10, 0]).caja(2, 16, 2, 'negro', [16, 10, 0]);
      ec.add(kit.cil(16, 11, 22), 0x20232a, [0, 20, 0], [0, 0, Math.PI / 2]);
      for (const sx of [-1, 1]) ec.add(kit.cil(17, 0.9, 22), 0xc0392b, [sx * 6.2, 20, 0], [0, 0, Math.PI / 2]);
      ec.add(kit.cil(4, 12.5, 10), 'galvanizado', [0, 20, 0], [0, 0, Math.PI / 2]).caja(4, 1.2, 12, 'negro', [0, 38, 0]);
      ec.add(kit.toro(7, 0.9, Math.PI * 2, 14), 'negro', [0, 4, 10], [Math.PI / 2, 0, 0]);
      ec.construir(gc, 'LOAD-302');
      void c;
    }

    /* ---------- Animación ---------- */
    let acum = 0;
    base.alActualizar((estado, dt) => {
      for (const a of aparatos) {
        if (a.tipo === 'fus-simple') { const est = K.proteccionDe(estado, a.tag).estado; const f = est === 'FUNDIDO'; if (a.estado !== f) { a.estado = f; a.matFus.color.setHex(f ? 0x2a1c14 : 0xc9ced3); } }
        else aplicarAparato(a, estado);
      }
      const e1 = K.inversorDe(estado, 'INV-101'), e2 = K.inversorDe(estado, 'INV-201'), bat = K.bateriaDe(estado);
      const leds1 = e1.leds || {}, apagado1 = (e1.estado || 'APAGADO') === 'APAGADO';
      ledsEasun[0].color.setHex(!apagado1 && leds1.red ? 0x35e06b : 0x1b232b); ledsEasun[1].color.setHex(!apagado1 && leds1.bateria ? 0xffb020 : 0x1b232b); ledsEasun[2].color.setHex(!apagado1 && (leds1.fallo || e1.estado === 'FALLO') ? 0xff3b30 : 0x1b232b);
      const leds2 = e2.leds || {}, apagado2 = (e2.estado || 'APAGADO') === 'APAGADO';
      ledsZcs[0].color.setHex(!apagado2 && leds2.onGrid ? 0x35e06b : 0x1c2420); ledsZcs[1].color.setHex(!apagado2 && leds2.offGrid ? 0xffb020 : 0x1c2420); ledsZcs[2].color.setHex(!apagado2 && (leds2.alarma || e2.estado === 'FALLO') ? 0xff3b30 : 0x1c2420);
      acum += dt;
      if (acum >= 0.2 || acum === dt || dt === 0) {                                                             // las pantallas se repintan como mucho cinco veces por segundo y solo si cambian
        acum = 0;
        const d1 = K.textoEasun(e1, bat), d2 = K.textoZcs(e2);
        pintarSi(lcdEasun, JSON.stringify(d1), d1); pintarSi(lcdZcs, JSON.stringify(d2), d2);
        const dB = { soc: K.limitar(K.num(bat.soc01, 0.8), 0, 1), v: K.num(bat.v, 26), bms: bat.bms || 'OK' };
        pintarSi(pantBat, Math.round(dB.soc * 100) + dB.bms + dB.v.toFixed(1), dB);
      }
    });
    /** «Tapa»: quita o pone las tapas translúcidas de las cajas y del cuadro de alterna. */
    const ponerTapa = v => { for (const t of tapas) t.visible = !!v; };
    function liberar() { kit.liberar(); }
    return { grupo: base.grupo, elementos: base.elementos, actualizar: base.actualizar, finalizar: base.finalizar, liberar, ponerTapa, kit };
  }

  const api = { TAGS, crear, pintarModulo, pintarFrenteEasun, pintarLcdEasun, pintarFrenteZcs, pintarLcdZcs, pintarEtiquetaBateria, pintarPantallaBateria };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else { window.PCT = window.PCT || {}; PCT.fvEquipos = api; }
})();
