// Simulación de DEMOSTRACIÓN de la instalación fotovoltaica: tiene la forma exacta del contrato (ARQUITECTURA.md §3: sim.paso, sim.estado, sim.ordenes, sim.curvaIV…) pero una física
// muy simplificada. Sirve para ver la interfaz y probarla mientras el modelo real (js/modelo/simulacion.js) no está, y como respaldo si faltara. NO es el modelo: el cargador solo
// la usa cuando PCT.fv.crearSimulacion no existe, y la página avisa de que está en demostración.
(function () {
  const enNode = typeof require !== 'undefined';
  const layout = enNode ? require('../layout.js') : PCT.fvLayout;
  const RAD = Math.PI / 180;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const PROTS = ['QS-101', 'QB-101', 'QS-201', 'QF-301', 'ID-301', 'QF-302', 'QF-303'], FUS = ['F-101', 'F-102', 'FB-101'], SPDS = ['SPD-101', 'SPD-201', 'SPD-301'];

  function crearSimulacion({ semilla = 1, diaAnio = 172, horaSolar = 9, nubosidad = 0.1 } = {}) {
    const inicial = { diaAnio, horaSolar, nubosidad };
    let S;
    function nuevo(o) {
      const s = { t: 0, dia: o.diaAnio, hora: o.horaSolar, nub: o.nubosidad, tAmb: null, suc: { A: 0.05, B: 0.05 }, sombra: {}, prot: {}, red: { disp: true, v: 230 }, manual: {}, modo: 'SOLAR_PRIMERO',
        enc: { 'INV-101': true, 'INV-201': true }, soc: 0.8, averias: new Set(), espera: 0, aislamientoOk: false, fase: 'ESPERA_AISLAMIENTO', energia: { A: 0, B: 0, consumo: 0, imp: 0, exp: 0, auto: 0 }, tempInv: { 'INV-101': 30, 'INV-201': 30 }, ult: {} };
      for (const t of PROTS.concat(FUS, SPDS)) s.prot[t] = SPDS.includes(t) ? 'CERRADO' : 'CERRADO';
      return s;
    }
    S = nuevo(inicial);

    const sol = () => {
      const decl = 23.45 * Math.sin(2 * Math.PI * (284 + S.dia) / 365) * RAD, lat = layout.INSTALACION.latitudGrados * RAD, w = 15 * (S.hora - 12) * RAD;
      const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(w);
      const alt = Math.asin(clamp(sinAlt, -1, 1));
      const az = Math.atan2(Math.sin(w), Math.cos(w) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat));
      return { alt, az, sinAlt };
    };
    const tempAmbiente = () => S.tAmb !== null ? S.tAmb : 18 + 9 * Math.sin(2 * Math.PI * (S.dia - 110) / 365) + 5 * Math.sin(2 * Math.PI * (S.hora - 9) / 24);
    const planoG = (c, so, gh) => {
      if (so.sinAlt <= 0.02 || gh <= 0) return 0;
      const t = c.inclinacionGrados * RAD, cosT = so.sinAlt * Math.cos(t) + Math.cos(so.alt) * Math.sin(t) * Math.cos(so.az - c.azimutGrados * RAD);
      return Math.max(0, gh / so.sinAlt * Math.max(0, cosT)) + gh * 0.08;
    };
    const cargaAuto = h => (h >= 8 && h < 15 ? 900 : h >= 15 && h < 21 ? 600 : 250);

    function calcular(dt) {
      const so = sol(), gh = so.sinAlt > 0.02 ? 1000 * Math.pow(so.sinAlt, 1.15) * (1 - 0.75 * Math.pow(S.nub, 2.5)) : 0, ta = tempAmbiente();
      const aver = id => S.averias.has(id);
      const estProt = t => S.prot[t];
      const campos = {};
      for (const id of ['A', 'B']) {
        const c = layout.CAMPOS[id], P = c.panel, g = planoG(c, so, gh) * (1 - S.suc[id]);
        const cadenas = c.cadenas.map(cad => {
          const abierta = (id === 'A' && cad.id === 'STR-101' && aver('CADENA_ABIERTA_A1')) || (cad.id === 'STR-201' && aver('CADENA_ABIERTA_B1')) || estProt('F-' + (cad.id === 'STR-101' ? '101' : cad.id === 'STR-102' ? '102' : 'x')) === 'FUNDIDO' || (id === 'A' && estProt('QS-101') !== 'CERRADO') || (id === 'B' && estProt('QS-201') !== 'CERRADO');
          const paneles = cad.paneles.map(tag => {
            let sombra = clamp(S.sombra[tag] || 0, 0, 1); if (tag === 'PV-205' && aver('SOMBRA_PARAPETO')) sombra = Math.max(sombra, 0.6);
            const tc = ta + (P.noctC - 20) / 800 * g, k = 1 + P.coefPotencia * (tc - 25), by = [false, false, false];
            if (tag === 'PV-104' && aver('DIODO_BYPASS_PV104')) by[0] = true;
            if (sombra > 0.4) by[0] = true;
            const frac = (1 - sombra) * (by.filter(Boolean).length ? 1 - by.filter(Boolean).length / 3 : 1);
            const p = P.wp * g / 1000 * k * frac, v = P.vmp * (0.88 + 0.12 * Math.min(1, g / 600)) * (1 + P.coefVoc * (tc - 25)) * (1 - by.filter(Boolean).length / 3);
            return { tag, p: g > 5 ? p : 0, v: g > 5 ? v : 0, tempCelulaC: tc, sombra01: sombra, bypass: by };
          });
          const v = abierta ? 0 : paneles.reduce((a, q) => a + q.v, 0), p = abierta ? 0 : paneles.reduce((a, q) => a + q.p, 0);
          const voc = cad.paneles.length * P.voc * (1 + P.coefVoc * (ta + 10 - 25));
          return { id: cad.id, abierta, v: abierta ? voc : v, i: abierta || v <= 0 ? 0 : p / v, p, voc, vmpp: v, impp: v > 0 ? p / v : 0, mppEnCurso: !abierta, paneles };
        });
        campos[id] = { gPlanoWm2: g, cadenas, p: cadenas.reduce((a, q) => a + q.p, 0), v: cadenas.reduce((a, q) => Math.max(a, q.v), 0), i: cadenas.reduce((a, q) => a + q.i, 0) };
      }
      return { so, gh, ta, campos };
    }

    function paso(dt) {
      const k = calcular(dt), { so, gh, ta, campos } = k, h = dt / 3600;
      S.t += dt; S.hora += h; while (S.hora >= 24) { S.hora -= 24; S.dia = S.dia % 365 + 1; }
      const redOk = S.red.disp && !S.averias.has('RED_CAIDA') && S.prot['QF-301'] === 'CERRADO' && S.prot['ID-301'] === 'CERRADO';
      // EASun
      const en1 = S.enc['INV-101'], pv1 = en1 && campos.A.v >= 60 && S.prot['QS-101'] === 'CERRADO' ? Math.min(campos.A.p * 0.93, 3000) : 0;
      const batOk = S.prot['QB-101'] === 'CERRADO' && S.prot['FB-101'] === 'CERRADO' && !S.averias.has('BMS_CORTE_BATERIA');
      const l302 = en1 ? (S.manual['LOAD-302'] !== undefined && S.manual['LOAD-302'] !== null ? S.manual['LOAD-302'] : cargaAuto(S.hora)) : 0;
      const vBat = 24 + 3.4 * S.soc;
      let bat = 0, red1 = 0, desdeBat = false;
      const redAp = redOk && S.prot['QF-302'] === 'CERRADO';
      if (en1) {
        const sobra = pv1 - l302;
        if (S.modo === 'RED_PRIMERO' && redAp) { red1 = l302; bat = batOk && S.soc < 0.99 ? Math.min(pv1, 60 * vBat) : 0; }
        else if (sobra >= 0) bat = batOk && S.soc < 0.99 ? Math.min(sobra, 60 * vBat) : 0;
        else if (S.modo !== 'RED_PRIMERO' && batOk && S.soc > 0.12 && (S.modo === 'BATERIA_PRIMERO' || !redAp || vBat > 24.2)) { bat = Math.max(sobra, -100 * vBat); desdeBat = true; if (-sobra > -bat && redAp) red1 = -sobra + bat; }
        else if (redAp) red1 = -sobra;
        if (!redAp && !desdeBat && sobra < 0) bat = 0;
      }
      S.soc = clamp(S.soc + (bat * (bat > 0 ? 0.95 : 1) * h) / 2560, 0, 1);
      const ledBms = batOk ? 'OK' : S.averias.has('BMS_CORTE_BATERIA') ? 'CORTE_BAJA' : 'OK';
      // ZCS
      const c1 = campos.B.cadenas[0], c2 = campos.B.cadenas[1];
      const pvB = (S.enc['INV-201'] ? 1 : 0) * ((c1.v >= 100 ? c1.p : 0) + (c2.v >= 100 ? c2.p : 0)) * 0.96;
      let fase = 'APAGADO', segundos = 0, alarmaZ = '';
      if (S.enc['INV-201']) {
        if (pvB <= 0) { fase = 'ESPERA_AISLAMIENTO'; S.aislamiento = 0; S.espera = 0; }
        else if (S.averias.has('FALLO_AISLAMIENTO_B')) { fase = 'FALLO'; alarmaZ = 'Fallo de aislamiento (ISO)'; }
        else if (!redOk || S.averias.has('SOBRETENSION_RED')) { fase = 'ESPERA_RED'; S.espera = 0; alarmaZ = S.averias.has('SOBRETENSION_RED') ? 'Tensión de red alta' : 'Red fuera de rango'; segundos = 60; }
        else { S.aislamiento = (S.aislamiento || 0) + dt; if (S.aislamiento < 10) fase = 'ESPERA_AISLAMIENTO'; else { S.espera = (S.espera || 0) + dt; if (S.espera < 60) { fase = 'ESPERA_RED'; segundos = 60 - S.espera; } else fase = 'OPERANDO'; } }
      }
      const acZ = fase === 'OPERANDO' ? Math.min(3000, pvB) : 0;
      const l301 = redOk || acZ > 0 ? (S.manual['LOAD-301'] !== undefined && S.manual['LOAD-301'] !== null ? S.manual['LOAD-301'] : 450 + (S.hora >= 8 && S.hora < 15 ? 600 : 0)) : 0;
      const redP = (redOk ? l301 + red1 : 0) - (redOk ? acZ : 0);
      const loadReal = redOk || fase === 'OPERANDO' ? l301 : 0;
      const eg = (S.energia); eg.A += campos.A.p * h; eg.B += campos.B.p * h; eg.consumo += (l301 + l302) * h; eg.imp += Math.max(0, redP) * h; eg.exp += Math.max(0, -redP) * h;
      for (const t of ['INV-101', 'INV-201']) { const pot = t === 'INV-101' ? pv1 : acZ, obj = ta + 8 + 25 * pot / 3000 + (S.averias.has('VENTILACION_TAPADA') ? 28 : 0); S.tempInv[t] += (obj - S.tempInv[t]) * Math.min(1, dt / 600); }
      const prot = {};
      for (const t of PROTS) prot[t] = { estado: S.prot[t], causa: '' };
      for (const t of FUS) prot[t] = { estado: S.prot[t], causa: '' };
      for (const t of SPDS) prot[t] = { estado: S.prot[t], causa: '' };
      const alarmas = [];
      for (const a of layout.AVERIAS) if (S.averias.has(a.id)) alarmas.push({ codigo: a.id, texto: a.titulo, tag: a.tag, severidad: a.id === 'COMUNICACION_PERDIDA_EASUN' ? 'aviso' : 'alarma' });
      for (const [t, v] of Object.entries(S.prot)) if (v === 'DISPARADO' || v === 'FUNDIDO') alarmas.push({ codigo: v, texto: `${t} ${v.toLowerCase()}`, tag: t, severidad: 'alarma' });
      const dia = so.alt > 0.02;
      const estado = {
        t: S.t, reloj: { diaAnio: S.dia, horaSolar: S.hora, texto: '', esDia: dia }, sol: { alturaGrados: so.alt / RAD, azimutGrados: so.az / RAD },
        ambiente: { ghWm2: gh, nubosidad: S.nub, temperaturaAmbienteC: ta, suciedad: { A: S.suc.A, B: S.suc.B } }, campos,
        inversores: {
          'INV-101': { estado: !en1 ? 'APAGADO' : pv1 > 0 || l302 > 0 ? 'OPERANDO' : 'ESPERA', modo: S.modo, pvV: campos.A.v, pvI: campos.A.i, pvP: pv1, bateriaP: bat, redP: red1, cargaP: l302, temperaturaC: S.tempInv['INV-101'], eficiencia: 0.93,
            etapaCarga: bat > 0 ? (S.soc > 0.97 ? 'FLOTACION' : S.soc > 0.9 ? 'ABSORCION' : 'CC') : 'NINGUNA', alarma: '', leds: { red: red1 > 0, bateria: bat > 0, fallo: false } },
          'INV-201': { estado: fase, mppt: [{ v: c1.v, i: c1.i, p: c1.p, activo: pvB > 0 }, { v: c2.v, i: c2.i, p: c2.p, activo: pvB > 0 }], acP: acZ, acV: redOk ? S.red.v : 0, acF: redOk ? 50 : 0, vertidoP: Math.max(0, -redP), temperaturaC: S.tempInv['INV-201'], eficiencia: 0.96,
            aislamientoMohm: S.averias.has('FALLO_AISLAMIENTO_B') ? 0.03 : 12, leds: { onGrid: fase === 'OPERANDO', offGrid: !redOk && pvB > 0, alarma: fase === 'FALLO' }, alarma: alarmaZ, segundosParaConexion: segundos },
        },
        bateria: { tag: 'BAT-101', soc01: S.soc, v: vBat + bat / 2560 * 0.4, vCeldaMin: (vBat) / 8 - 0.01, vCeldaMax: vBat / 8 + 0.01, i: bat / vBat, p: bat, temperaturaC: 24 + Math.abs(bat) / 400, bms: ledBms, energiaWh: S.soc * 2560 },
        red: { disponible: redOk, v: redOk ? (S.averias.has('SOBRETENSION_RED') ? 253 : S.red.v) : 0, f: redOk ? 50 : 0, p: redP, energiaImportadaWh: eg.imp, energiaExportadaWh: eg.exp },
        cargas: { 'LOAD-301': { w: loadReal, manual: S.manual['LOAD-301'] !== undefined && S.manual['LOAD-301'] !== null }, 'LOAD-302': { w: l302, manual: S.manual['LOAD-302'] !== undefined && S.manual['LOAD-302'] !== null, alimentada: en1 } },
        protecciones: prot, energia: { produccionAWh: eg.A, produccionBWh: eg.B, consumoWh: eg.consumo, autoconsumoPct: eg.A + eg.B > 0 ? clamp(1 - eg.exp / (eg.A + eg.B), 0, 1) * 100 : 0, ahorroEuros: (eg.A + eg.B - eg.exp) / 1000 * 0.15 },
        alarmas, averiasActivas: Array.from(S.averias),
      };
      const f = Math.floor(S.hora), m = Math.floor((S.hora - f) * 60);
      estado.reloj.texto = `${S.dia} · ${String(f).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      S.ult = estado; sim.estado = estado;
    }

    const sim = {
      demostracion: true, estado: null,
      paso(dt) { paso(dt > 0 ? dt : 0.01); },
      reiniciar(o) { S = nuevo(Object.assign({}, inicial, o || {})); paso(0.01); },
      ordenes: {
        reloj: { poner({ diaAnio: d, horaSolar: h } = {}) { if (d !== undefined) S.dia = d; if (h !== undefined) S.hora = h; paso(0.01); } },
        ambiente: { poner(o = {}) { if (o.nubosidad !== undefined) S.nub = o.nubosidad; if (o.temperaturaAmbienteC !== undefined) S.tAmb = o.temperaturaAmbienteC; if (o.suciedadA !== undefined) S.suc.A = o.suciedadA; if (o.suciedadB !== undefined) S.suc.B = o.suciedadB; paso(0.01); },
          sombra(tag, v) { S.sombra[tag] = v; paso(0.01); } },
        protecciones: { cerrar(t) { if (S.prot[t] === 'ABIERTO') S.prot[t] = 'CERRADO'; paso(0.01); }, abrir(t) { if (S.prot[t] === 'CERRADO') S.prot[t] = 'ABIERTO'; paso(0.01); },
          rearmar(t) { if (['DISPARADO', 'FUNDIDO', 'AGOTADO'].includes(S.prot[t])) S.prot[t] = FUS.concat(SPDS).includes(t) ? 'CERRADO' : 'ABIERTO'; paso(0.01); } },
        red: { disponible(b) { S.red.disp = !!b; paso(0.01); }, tension(v) { S.red.v = v; paso(0.01); } },
        cargas: { poner(t, w) { S.manual[t] = w; paso(0.01); } },
        inversor: { modoEasun(m) { S.modo = m; paso(0.01); }, encender(t, b) { S.enc[t] = !!b; paso(0.01); } },
        bateria: { socInicial(p) { S.soc = clamp(p / 100, 0, 1); paso(0.01); } },
        averias: {
          activar(id) { S.averias.add(id); const a = layout.AVERIAS.find(x => x.id === id); if (id === 'FUSIBLE_F101') S.prot['F-101'] = 'FUNDIDO'; if (id === 'SPD_DISPARADO_A') S.prot['SPD-101'] = 'AGOTADO'; if (id === 'QB_DISPARADO') S.prot['QB-101'] = 'DISPARADO'; if (id === 'DIFERENCIAL_DISPARADO') S.prot['ID-301'] = 'DISPARADO'; if (id === 'SUCIEDAD_ALTA_A') S.suc.A = 0.3; void a; paso(0.01); },
          desactivar(id) { S.averias.delete(id); if (id === 'SUCIEDAD_ALTA_A') S.suc.A = 0.05; paso(0.01); }, activas: () => Array.from(S.averias), limpiar() { S.averias.clear(); paso(0.01); },
        },
      },
      curvaIV(idCadena, puntos = 60) {
        const cad = [].concat(...['A', 'B'].map(c => sim.estado.campos[c].cadenas)).find(x => x.id === idCadena); if (!cad) return [];
        const campoId = idCadena.startsWith('STR-1') ? 'A' : 'B', P = layout.CAMPOS[campoId].panel, g = sim.estado.campos[campoId].gPlanoWm2;
        const voc = cad.voc, isc = P.isc * g / 1000 * (cad.p > 0 || g > 5 ? 1 : 0), a = voc * 0.045, out = [];
        for (let k = 0; k <= puntos; k++) { const v = voc * k / puntos, i = Math.max(0, isc * (1 - (Math.exp(v / a) - 1) / (Math.exp(voc / a) - 1))); out.push({ v, i: cad.abierta ? 0 : i, p: cad.abierta ? 0 : v * i }); }
        return out;
      },
      medidas: {}, medir() { return 0; },
    };
    paso(0.01);
    return sim;
  }

  const api = { crearSimulacion };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') (window.PCT = window.PCT || {}).fvDemo = api;
})();
