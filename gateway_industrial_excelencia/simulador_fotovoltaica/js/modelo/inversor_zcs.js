// Inversor ZCS Azzurro (INV-201): dos MPPT independientes (una cadena cada uno, 90–450 V, arranque a 100 V, 13 A), autoconsumo con vertido.
//
// SECUENCIA DE ARRANQUE (máquina de estados): sin luz suficiente está «dormido» (estado APAGADO, LEDs apagados) →
//   ESPERA_AISLAMIENTO: mide el aislamiento del campo FV a tierra durante 30 s; si es < 0,5 MΩ → FALLO (LED de alarma) y reintenta cada 60 s.
//   → ESPERA_RED: red válida (195,5–253 V, 47,5–51,5 Hz) de forma continua durante tiempoReconexionS (60 s; el contador se reinicia si la red falla).
//   → OPERANDO (LED On-Grid). Si la red cae o sale de rango se desconecta en el acto (ANTI-ISLA) y vuelve a ESPERA_RED (LEDs Off-Grid y Alarma).
// REDUCCIÓN POR TENSIÓN DE RED: entre 245 y 253 V baja la potencia linealmente hasta 0 (REDUCIDO); a 253 V o más desconecta y no reconecta hasta bajar de 250 V.
// La tensión en bornes sube con la potencia inyectada (impedancia de red 0,3 Ω), lo que puede provocar la reducción con la red ya alta.
// TEMPERATURA: reduce potencia desde 70 °C (hasta 25 % a 90 °C) y se para sobre 90 °C. LÍMITE de 3 kW de salida (REDUCIDO si recorta).
(function () {
  const { CONSTANTES: C, layout } = typeof require !== 'undefined' ? require('../configuracion/constantes.js') : window.PCT.fv.constantes;
  const Seg = typeof require !== 'undefined' ? require('./seguidor.js') : window.PCT.fv.seguidor;
  const SPEC = layout.INVERSORES['INV-201'], Z = C.ZCS;
  const limitar = (v, a, b) => Math.max(a, Math.min(b, v));

  function crearZcs(rng) {
    const ef = Seg.crearEficiencia({ pn: SPEC.potenciaAcW, a: 0.0036, b: 0.012, c: 0.0225 });     // ηmax ≈ 97 % al 40 % de carga
    const segs = SPEC.mppt.map(m => Seg.crearSeguidor({ vMin: m.vMin, vMax: m.vMax, iMax: m.iMax, barridoS: C.SEGUIDOR.barridoZcsS }));
    const s = { encendido: true, segs, ef };
    const inicial = () => Object.assign(s, { fase: 'DORMIDO', tFase: 0, tPotCheck: 1e9, pPot: 0, aislMohm: Z.aislamientoSanoMohm, tC: 30, falloTermico: false, sobreLatch: false,
      tBaja: 0, acP: 0, acV: layout.RED.tensionV, perdidaW: 0, salida: null });
    inicial();
    s.reiniciar = function () { inicial(); s.encendido = true; for (const q of segs) q.reiniciar(); };

    /** ent: { curvas: [grupo|null, grupo|null], redOk, vRedV, fRedHz, fallaAislamiento, tCasetaC, consumoLocalW } */
    s.paso = function (dt, ent) {
      const alarmas = [];
      s.tC += (ent.tCasetaC + Z.rThCw * s.perdidaW - s.tC) * (1 - Math.exp(-dt / Z.tauTermicaS));
      if (s.tC >= Z.tempFalloC) s.falloTermico = true; else if (s.falloTermico && s.tC < Z.tempReduceC) s.falloTermico = false;
      const reduccionT = s.tC <= Z.tempReduceC ? 1 : limitar(1 - (s.tC - Z.tempReduceC) / (Z.tempFalloC - Z.tempReduceC) * 0.75, 0.25, 1);

      const curvas = ent.curvas.map(c => (c && c.voc() > 1 ? c : null));
      const vdcMax = Math.max(0, ...curvas.map(c => (c ? c.voc() : 0)));
      const vArr = SPEC.mppt[0].vArranque;
      // Red válida con histéresis de sobretensión
      const vRed = ent.vRedV, f = ent.fRedHz;
      if (vRed >= Z.redTripMaxV) s.sobreLatch = true; else if (vRed < Z.redReconectaV) s.sobreLatch = false;
      const redValida = !!ent.redOk && vRed > Z.redTripMinV && !s.sobreLatch && f >= Z.fMin && f <= Z.fMax;

      const sal = { estado: 'APAGADO', mppt: [0, 1].map(() => ({ v: 0, i: 0, p: 0, activo: false })), acP: 0, acV: ent.redOk ? vRed : 0, acF: ent.redOk ? f : 0, vertidoP: 0, temperaturaC: s.tC,
        eficiencia: 0, aislamientoMohm: s.aislMohm, leds: { onGrid: false, offGrid: false, alarma: false }, alarma: '', alarmas, segundosParaConexion: 0, pdc: 0, dormido: false, derate: reduccionT };
      sal.mppt.forEach((m, k) => { m.v = curvas[k] ? curvas[k].voc() : 0; });

      if (!s.encendido) {
        s.fase = 'DORMIDO'; s.tFase = 0; s.acP = 0; s.perdidaW = 0; for (const q of segs) q.reiniciar();
        return (s.salida = sal);
      }
      if (s.falloTermico) { alarmas.push('ZCS_SOBRETEMP'); sal.estado = 'FALLO'; sal.alarma = 'Sobretemperatura: inversor parado'; sal.leds.alarma = true; s.fase = 'DORMIDO'; s.acP = 0; s.perdidaW = 5; for (const q of segs) q.reiniciar(); return (s.salida = sal); }

      // Potencia disponible (solo cuando hace falta decidir el arranque; el barrido es caro)
      const hayTension = vdcMax >= vArr;
      if (s.fase === 'DORMIDO' || s.fase === 'FALLO') {
        s.tPotCheck += dt;
        if (hayTension && s.tPotCheck >= 30) {
          s.tPotCheck = 0;
          s.pPot = curvas.reduce((suma, c, k) => { if (!c) return suma; const b = segs[k].barrido(c); return suma + (b ? b.p : 0); }, 0);
        }
        if (!hayTension) s.pPot = 0;
      }
      const luz = hayTension && (s.fase === 'DORMIDO' || s.fase === 'FALLO' ? s.pPot >= 20 : true);

      if (s.fase === 'DORMIDO') {
        if (luz) { s.fase = 'AISLAMIENTO'; s.tFase = 0; }
      } else if (s.fase === 'FALLO') {
        s.tFase += dt;
        if (!hayTension) { s.fase = 'DORMIDO'; s.tFase = 0; }
        else if (s.tFase >= Z.reintentoAislamientoS) { s.fase = 'AISLAMIENTO'; s.tFase = 0; }
      }
      if (s.fase === 'AISLAMIENTO') {
        if (!hayTension) { s.fase = 'DORMIDO'; s.tFase = 0; }
        else {
          s.tFase += dt;
          if (s.tFase >= Z.tiempoAislamientoS) {
            s.aislMohm = ent.fallaAislamiento ? Z.aislamientoFalloMohm * (0.9 + 0.2 * rng.uniforme()) : Z.aislamientoSanoMohm * (0.9 + 0.2 * rng.uniforme());
            if (s.aislMohm < Z.aislamientoMinMohm) { s.fase = 'FALLO'; s.tFase = 0; } else { s.fase = 'ESPERA_RED'; s.tFase = 0; }
          }
        }
      }
      if (s.fase === 'ESPERA_RED') {
        if (!hayTension) { s.fase = 'DORMIDO'; s.tFase = 0; }
        else if (redValida) { s.tFase += dt; if (s.tFase >= SPEC.tiempoReconexionS) { s.fase = 'OPERANDO'; s.tFase = 0; s.tBaja = 0; } }
        else s.tFase = 0;
      }

      let pdc = 0, factorV = 1;
      if (s.fase === 'OPERANDO') {
        if (ent.fallaAislamiento) {                               // la vigilancia de corriente residual también dispara en marcha
          s.aislMohm = Z.aislamientoFalloMohm * (0.9 + 0.2 * rng.uniforme()); s.fase = 'FALLO'; s.tFase = 0; s.acP = 0; for (const q of segs) q.reiniciar();
        } else if (!redValida) { s.fase = 'ESPERA_RED'; s.tFase = 0; s.acP = 0; }
        else {
          // tensión en bornes: red + subida por la inyección anterior
          const vBornes = vRed + (s.acP / Math.max(vRed, 100)) * Z.zRedOhm;
          factorV = limitar(1 - (vBornes - Z.redReduceDesdeV) / (Z.redTripMaxV - Z.redReduceDesdeV), 0, 1);
          const puntos = curvas.map((c, k) => (c ? segs[k].paso(dt, c) : (segs[k].paso(dt, null), { v: 0, i: 0, p: 0, activo: false })));
          const pEff = C.SEGUIDOR.eficiencia;
          pdc = puntos.reduce((a, p) => a + p.p, 0) * pEff;
          const pacLibre = ef.salida(pdc), pacMax = Math.min(SPEC.potenciaAcW, SPEC.potenciaAcW * reduccionT, SPEC.potenciaAcW * factorV);
          let factor = pacLibre > pacMax ? pacMax / Math.max(pacLibre, 1e-9) : 1;
          const vals = puntos.map((p, k) => {
            if (factor < 0.999 && p.activo && curvas[k]) { const rec = segs[k].recortar(curvas[k], p.p * factor); return { ...p, v: rec.v, i: rec.i, p: rec.p }; }
            return p;
          });
          pdc = vals.reduce((a, p) => a + p.p, 0) * pEff;
          sal.mppt = vals.map(p => ({ v: p.v, i: p.i, p: p.p, activo: !!p.activo }));
          s.acP = Math.min(ef.salida(pdc), pacMax);
          if (s.acP < Z.pMinAcW) { s.tBaja += dt; if (s.tBaja >= 120) { s.fase = 'DORMIDO'; s.tFase = 0; s.acP = 0; for (const q of segs) q.reiniciar(); } } else s.tBaja = 0;
          sal.limitado = factor < 0.999;
        }
      } else { s.acP = 0; if (s.fase !== 'OPERANDO') for (const q of segs) if (q.activo) q.reiniciar(); }

      // Salidas
      sal.pdc = pdc; sal.acP = s.acP; sal.eficiencia = pdc > 20 && s.acP > 0 ? limitar(s.acP / pdc, 0, 1) : 0;
      s.acV = ent.redOk ? vRed + (s.acP / Math.max(vRed, 100)) * Z.zRedOhm : 0;
      sal.acV = s.acV; sal.acF = ent.redOk ? f : 0;
      s.perdidaW = s.fase === 'OPERANDO' ? 5 + Math.max(0, pdc - s.acP) : 3;
      sal.temperaturaC = s.tC; sal.aislamientoMohm = s.aislMohm;
      const dcPresente = hayTension || s.fase !== 'DORMIDO';

      switch (s.fase) {
        case 'DORMIDO': sal.estado = 'APAGADO'; sal.dormido = true; break;
        case 'AISLAMIENTO': sal.estado = 'ESPERA_AISLAMIENTO'; sal.segundosParaConexion = Math.max(0, Z.tiempoAislamientoS - s.tFase) + SPEC.tiempoReconexionS; break;
        case 'ESPERA_RED': sal.estado = 'ESPERA_RED'; sal.segundosParaConexion = redValida ? Math.max(0, SPEC.tiempoReconexionS - s.tFase) : SPEC.tiempoReconexionS; break;
        case 'FALLO': sal.estado = 'FALLO'; sal.segundosParaConexion = Math.max(0, Z.reintentoAislamientoS - s.tFase); break;
        default: sal.estado = (factorV < 0.999 || reduccionT < 0.999 || sal.limitado) ? 'REDUCIDO' : 'OPERANDO';
      }
      if (s.fase === 'FALLO') { alarmas.push('ZCS_AISLAMIENTO'); sal.alarma = `Fallo de aislamiento del campo FV (${s.aislMohm.toFixed(2)} MΩ < ${Z.aislamientoMinMohm} MΩ)`; }
      if (s.fase === 'ESPERA_RED' && !redValida) {
        if (s.sobreLatch) { alarmas.push('ZCS_SOBRETENSION_RED'); sal.alarma = `Tensión de red alta (${vRed.toFixed(0)} V): desconectado`; }
        else { alarmas.push('ZCS_SIN_RED'); sal.alarma = 'Sin red o fuera de rango: desconectado (anti-isla)'; }
      }
      if (s.fase === 'OPERANDO' && factorV < 0.999) { alarmas.push('ZCS_REDUCCION_TENSION'); sal.alarma = 'Tensión de red alta: potencia reducida'; }
      if (s.fase === 'OPERANDO' && reduccionT < 0.999) { alarmas.push('ZCS_REDUCIDO_TEMP'); sal.alarma = 'Temperatura alta: potencia reducida'; }
      const falloRed = s.fase === 'ESPERA_RED' && !redValida && dcPresente;
      sal.leds = { onGrid: s.fase === 'OPERANDO', offGrid: falloRed, alarma: s.fase === 'FALLO' || falloRed };
      return (s.salida = sal);
    };
    return s;
  }

  const api = { crearZcs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { const P = (window.PCT = window.PCT || {}); (P.fv = P.fv || {}).inversorZcs = api; }
})();
