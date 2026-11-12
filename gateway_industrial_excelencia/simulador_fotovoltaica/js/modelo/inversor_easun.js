// Inversor híbrido EASun (INV-101): un MPPT (60–145 V), cargador de batería por etapas, salida de alterna a las cargas protegidas LOAD-302 y entrada de red.
//
// PRIORIDAD DE FUENTE PARA LAS CARGAS (modo), como en un híbrido de esa gama (Axpert/«ISolar»):
//   SOLAR_PRIMERO   (como «SUB»): las cargas van con el sol mientras alcance; si no alcanza, pasan TODAS a la red (el sol carga la batería).
//                   Sin red, el déficit lo cubre la batería. La batería solo la descarga el inversor si no hay red.
//   RED_PRIMERO     (como «UTI»): las cargas van con la red si hay; el sol solo carga la batería. Sin red, sol + batería.
//   BATERIA_PRIMERO (como «SBU»): las cargas van con sol y batería; pasa a red cuando la batería llega al SoC mínimo útil (10 %) o a 21 V
//                   y hasta que se recupera (ver política), y la red la carga a ≤ 20 A mientras tanto.
//   Sin cargas pedidas y con red, el EASun queda en derivación (bypass) y no toca la batería; el sol sigue cargándola.
// POLÍTICA DE BATERÍA (coherente con bateria.js): el inversor deja de descargarla («bateriaAgotada») cuando se da CUALQUIERA de: SoC ≤ SoC mínimo útil
//   (layout BATERIA.socMinUtilPct, 10 %; el EASun lo conoce porque el BMS se lo comunica por RS485/CAN), tensión ≤ tensionCorteBajaV (21,0 V: el corte
//   duro propio del inversor, casi vacío) o BMS en CORTE_BAJA. Vuelve a descargar con HISTÉRESIS solo cuando el SoC llega a socRearmePct (25 %) y la
//   tensión pasa de tensionRearmeV (25,0 V). Mientras está agotada y hay red, la red carga la batería (cargaRedMaxA = 20 A); sin red, las cargas se quedan sin tensión.
//   La corriente de carga respeta el límite del BMS por temperatura (bateria.limiteCargaA: 0 bajo 0 °C).
// ETAPAS DE CARGA: CC (corriente constante, ≤ 60 A) → ABSORCION (28,4 V constantes, la corriente decae) → FLOTACION (27,2 V) tras 60 s con menos de 5 A;
// vuelve a CC si la tensión de reposo baja de 26,4 V durante 30 s.
// TEMPERATURA: sube con las pérdidas y con la caseta; por encima de 75 °C reduce la potencia (hasta 25 % a 95 °C); sobre 95 °C se para (FALLO) hasta bajar de 75 °C.
// SOBRECARGA de la salida: con red, si las cargas pasan de la capacidad del inversor pasan a la derivación (hasta 16 A); sin red, por encima de 1,05 × 3 kW
//   durante 10 s la salida se corta (FALLO, código 07) y reintenta a los 180 s; entre la capacidad (reducida por temperatura) y ese 5 % sirve solo lo que puede (REDUCIDO).
// ARRANQUE: al encenderlo con el interruptor hace una autocomprobación de 8 s (ESPERA, sin salida) y luego pasa a lo que corresponda (con red, a la derivación o al inversor
//   según el modo; sin red, al inversor con batería). Sin batería (QB-101/FB-101 abiertos, BMS abierto o avería) el EASun da FALLO: no usa el sol y solo pasa la red a las cargas si la hay.
// DE NOCHE: el EASun NUNCA «duerme» (no hay estado «dormido», a diferencia del ZCS): lo alimentan la red o la batería, así que sigue vivo con sus LEDs; solo se duerme su
//   MPPT (`mpptActivo = false`, `solDormido = true`). Con cargas pasa a OPERANDO (derivación o inversor); sin cargas y con red queda en ESPERA con unos 15 W de consumo propio.
(function () {
  const { CONSTANTES: C, layout } = typeof require !== 'undefined' ? require('../configuracion/constantes.js') : window.PCT.fv.constantes;
  const Seg = typeof require !== 'undefined' ? require('./seguidor.js') : window.PCT.fv.seguidor;
  const SPEC = layout.INVERSORES['INV-101'], E = C.EASUN;
  const limitar = (v, a, b) => Math.max(a, Math.min(b, v));
  const ESTANDAR_W = 20;                                      // consumo propio del EASun funcionando como inversor (lado continua)
  const ESTANDAR_RED_W = 15;                                  // consumo propio en derivación (lo da la red, no la batería)
  const POTENCIA_BYPASS_W = 3680;                             // 16 A a 230 V

  function crearEasun() {
    const ef = Seg.crearEficiencia({ pn: SPEC.potenciaAcW, a: 0.009, b: 0.025, c: 0.05625 });   // ηmax ≈ 93 % al 40 % de carga
    const seg = Seg.crearSeguidor({ vMin: SPEC.mpptVmin, vMax: SPEC.mpptVmax, iMax: SPEC.iMpptMax, barridoS: C.SEGUIDOR.barridoEasunS });
    const s = { encendido: true, modo: 'SOLAR_PRIMERO', seg, ef };
    const inicial = () => Object.assign(s, { tC: 30, falloTermico: false, bateriaAgotada: false, ciclo: 'CC', tAbs: 0, tRebulk: 0, fuente: 'INVERSOR', perdidaW: 0, vBat: 25.5, salida: null,
      arranqueS: 0, falloSobrecarga: false, tSobre: 0, tReinicioS: 0, estabaEncendido: true });
    inicial();
    s.reiniciar = function () { inicial(); s.encendido = true; s.modo = 'SOLAR_PRIMERO'; seg.reiniciar(); };

    /**
     * ent: { bateria, batConectada, curvaPv (grupo de cadenas o null), redOk, demandaCargasW, cargasCableadas, tCasetaC }
     * Devuelve las potencias del paso y la tensión de trabajo del MPPT (vOperacion); la corriente de la batería se aplica fuera con bateria.paso.
     */
    s.paso = function (dt, ent) {
      const bat = ent.bateria, o = bat.ocv(), r = bat.r();
      s.tC += (ent.tCasetaC + E.rThCw * s.perdidaW - s.tC) * (1 - Math.exp(-dt / E.tauTermicaS));
      if (s.tC >= E.tempFalloC) s.falloTermico = true; else if (s.falloTermico && s.tC < E.tempRearmeC) s.falloTermico = false;
      const reduccion = s.tC <= E.tempReduceC ? 1 : limitar(1 - (s.tC - E.tempReduceC) / (E.tempFalloC - E.tempReduceC) * 0.75, 0.25, 1);
      const alarmas = [];

      const sal = {
        estado: 'APAGADO', modo: s.modo, pvV: 0, pvI: 0, pvP: 0, vOperacion: 0, bateriaP: 0, bateriaI: 0, redP: 0, cargaP: 0, cargaDemandaW: ent.cargasCableadas ? ent.demandaCargasW : 0,
        alimentada: false, temperaturaC: s.tC, eficiencia: 0, etapaCarga: 'NINGUNA', alarma: '', alarmas, fuente: 'NINGUNA', leds: { red: false, bateria: false, fallo: false },
        derate: reduccion, bateriaAgotada: s.bateriaAgotada, ciclo: s.ciclo, mpptActivo: false, arrancando: false, limiteCargaA: bat.limiteCargaA(),
      };
      if (!s.encendido) {
        seg.reiniciar(); s.perdidaW = 0; s.fuente = 'NINGUNA'; s.estabaEncendido = false;
        sal.pvV = ent.curvaPv ? ent.curvaPv.voc() : 0; sal.vOperacion = sal.pvV; sal.fuente = 'NINGUNA';
        return (s.salida = sal);
      }
      if (!s.estabaEncendido) { s.estabaEncendido = true; s.arranqueS = E.arranqueS; s.falloSobrecarga = false; s.tSobre = 0; }
      if (s.arranqueS > 0) {                                      // autocomprobación al encender: sin salida ni MPPT
        s.arranqueS -= dt; seg.reiniciar(); s.perdidaW = 5; s.fuente = 'NINGUNA';
        sal.estado = 'ESPERA'; sal.arrancando = true; sal.pvV = ent.curvaPv ? ent.curvaPv.voc() : 0; sal.vOperacion = sal.pvV;
        sal.leds = { red: !!ent.redOk, bateria: !!ent.batConectada, fallo: false };
        return (s.salida = sal);
      }

      const batOk = !!ent.batConectada, gridOk = !!ent.redOk;
      if (batOk) {
        const socPct = bat.soc01 * 100;
        if (s.vBat <= SPEC.tensionCorteBajaV || bat.bms === 'CORTE_BAJA' || socPct <= layout.BATERIA.socMinUtilPct) s.bateriaAgotada = true;
        else if (s.vBat >= SPEC.tensionRearmeV && bat.bms === 'OK' && socPct >= E.socRearmePct) s.bateriaAgotada = false;
      }
      if (s.falloSobrecarga) { s.tReinicioS -= dt; if (s.tReinicioS <= 0) { s.falloSobrecarga = false; s.tSobre = 0; } }
      const permiteDesc = batOk && bat.permiteDescarga() && !s.bateriaAgotada;
      const permiteCarga = batOk && bat.permiteCarga();
      const disponible = batOk && !s.falloTermico;
      const capInv = SPEC.potenciaAcW * reduccion;
      let Pl = ent.cargasCableadas ? Math.max(0, ent.demandaCargasW) : 0;

      let fuente = 'NINGUNA', pvPunto = { v: ent.curvaPv ? ent.curvaPv.voc() : 0, i: 0, p: 0, activo: false };
      let pvUsadoDc = 0, pvUsadoBus = 0, cargaServidaAc = 0, redCargaAc = 0, redCargaBat = 0, netoBat = 0, cargaFaltaW = 0, vOperacion = pvPunto.v;
      let estadoCC = 'NINGUNA';

      if (!disponible) {
        seg.paso(dt, null);
        fuente = gridOk && Pl > 0 ? 'RED' : 'NINGUNA';
        if (fuente === 'RED') { cargaServidaAc = Math.min(Pl, POTENCIA_BYPASS_W); redCargaAc = cargaServidaAc / E.etaBypass; }
        cargaFaltaW = Pl - cargaServidaAc;
        sal.pvV = pvPunto.v; vOperacion = pvPunto.v;
      } else {
        // 1) Sol: seguimiento del máximo
        pvPunto = seg.paso(dt, ent.curvaPv || null);
        const pvBusDisp = pvPunto.p * C.SEGUIDOR.eficiencia * E.etaDcdc;
        // 2) Etapas de carga
        const vAbs = SPEC.tensionAbsorcionV, vFlo = SPEC.tensionFlotacionV;
        if (s.ciclo === 'CC' && (vAbs - o) / r < SPEC.cargaMaxA) s.ciclo = 'ABSORCION';
        else if (s.ciclo === 'ABSORCION') {
          if ((vAbs - o) / r >= SPEC.cargaMaxA + 5) s.ciclo = 'CC';
          if ((vAbs - o) / r < E.absorcionFinA) s.tAbs += dt; else s.tAbs = 0;
          if (s.tAbs >= 60) { s.ciclo = 'FLOTACION'; s.tAbs = 0; s.tRebulk = 0; }
        } else if (s.ciclo === 'FLOTACION') {
          if (o < 26.4) s.tRebulk += dt; else s.tRebulk = 0;
          if (s.tRebulk >= 30) { s.ciclo = 'CC'; s.tRebulk = 0; }
        }
        const vSp = s.ciclo === 'FLOTACION' ? vFlo : vAbs;
        const iEtapa = permiteCarga ? Math.min(SPEC.cargaMaxA, bat.limiteCargaA(), Math.max(0, (vSp - o) / r)) : 0;
        const pCargaMax = iEtapa > 0 ? (o + iEtapa * r) * iEtapa : 0;
        const iDesc = layout.BATERIA.corrienteMaxDescargaA;
        const pDescMax = permiteDesc ? Math.max(0, iDesc * (o - iDesc * r)) : 0;
        // 3) Fuente de las cargas
        const standby = ESTANDAR_W;
        const dcDeCarga = pl => (pl > 0 ? ef.entrada(Math.min(pl, capInv)) : 0);
        const dcCarga0 = dcDeCarga(Pl);
        if (!gridOk) fuente = 'INVERSOR';
        else if (Pl <= 0) fuente = 'RED';                                   // sin cargas y con red: derivación en reposo, la batería no se toca
        else if (s.modo === 'RED_PRIMERO') fuente = 'RED';
        else if (s.modo === 'SOLAR_PRIMERO') fuente = (Pl <= capInv && pvBusDisp >= (s.fuente === 'INVERSOR' ? 0.95 : 1.1) * (dcCarga0 + standby)) ? 'INVERSOR' : 'RED';
        else fuente = (s.bateriaAgotada || !permiteDesc || Pl > capInv) ? 'RED' : 'INVERSOR';
        // 4) Balance
        const calcular = fte => {
          const plServ = fte === 'RED' ? Math.min(Pl, POTENCIA_BYPASS_W) : (s.falloSobrecarga ? 0 : Math.min(Pl, capInv));
          const dcCarga = (fte === 'RED' ? 0 : dcDeCarga(plServ) + standby);
          const alPv = Math.min(pvBusDisp, dcCarga), deficit = dcCarga - alPv, deBat = Math.min(deficit, pDescMax), falta = deficit - deBat;
          const aBat = Math.min(pvBusDisp - alPv, pCargaMax);
          const serv = fte === 'RED' ? plServ : ef.salida(Math.max(0, dcCarga - falta - standby));
          return { serv, redAc: fte === 'RED' ? plServ / E.etaBypass + ESTANDAR_RED_W : 0, usadoBus: alPv + aBat, neto: aBat - deBat, falta: Pl - serv };
        };
        let q = calcular(fuente);
        if (fuente === 'INVERSOR' && gridOk && Pl > 0 && q.falta > 0.03 * Pl) { fuente = 'RED'; q = calcular('RED'); }
        s.fuente = fuente;
        // Sobrecarga sin alternativa de red: por encima de 1,05 × la potencia nominal durante 10 s corta la salida
        if (fuente === 'INVERSOR' && Pl > 1.05 * SPEC.potenciaAcW) s.tSobre += dt; else s.tSobre = Math.max(0, s.tSobre - dt);
        if (s.tSobre >= 10 && !s.falloSobrecarga) { s.falloSobrecarga = true; s.tReinicioS = 180; }
        cargaServidaAc = q.serv; redCargaAc = q.redAc; pvUsadoBus = q.usadoBus; netoBat = q.neto; cargaFaltaW = Math.max(0, q.falta);
        // 5) Carga desde la red cuando la batería se agotó
        if (gridOk && s.bateriaAgotada && permiteCarga) {
          const vt = Math.max(o, 20);
          const extra = Math.max(0, Math.min(E.cargaRedMaxA * vt, pCargaMax - Math.max(0, netoBat)));
          redCargaBat = extra; netoBat += extra;
        }
        // 6) Recorte del sol si la batería y las cargas no lo admiten
        pvUsadoDc = pvUsadoBus / (E.etaDcdc * C.SEGUIDOR.eficiencia);
        pvUsadoDc = Math.min(pvUsadoDc, pvPunto.p);
        if (pvPunto.activo && pvUsadoDc < pvPunto.p * 0.999 && ent.curvaPv) {
          const rec = seg.recortar(ent.curvaPv, pvUsadoDc);
          vOperacion = rec.v; pvUsadoDc = rec.p;
        } else vOperacion = pvPunto.v;
        if (!pvPunto.activo) pvUsadoDc = 0;
        estadoCC = s.ciclo;
        sal.mpptActivo = pvPunto.activo;
      }

      // Batería: corriente por potencia en terminales
      const iBat = disponible ? bat.iDePotencia(netoBat) : 0;
      const vBatNueva = bat.vTerm(iBat);
      s.vBat = disponible ? vBatNueva : o;
      sal.bateriaP = disponible ? vBatNueva * iBat : 0; sal.bateriaI = iBat;
      const hayCarga = iBat > 0.3;
      sal.etapaCarga = hayCarga ? s.ciclo : (s.ciclo === 'FLOTACION' && (pvUsadoDc > 20 || redCargaBat > 0) && disponible ? 'FLOTACION' : 'NINGUNA');
      sal.pvP = pvUsadoDc; sal.pvV = pvPunto.activo ? vOperacion : (pvPunto.v || 0); sal.vOperacion = vOperacion; sal.pvI = vOperacion > 1 ? pvUsadoDc / vOperacion : 0;
      sal.cargaP = cargaServidaAc; sal.redP = redCargaAc + redCargaBat / 0.95;
      sal.fuente = fuente;
      sal.alimentada = !ent.cargasCableadas ? false : (Pl <= 0 ? (disponible || gridOk) : cargaServidaAc > 0.5);
      sal.bateriaAgotada = s.bateriaAgotada; sal.ciclo = s.ciclo;

      // Pérdidas para la temperatura
      const entradaDc = disponible ? ef.entrada(fuente === 'INVERSOR' ? cargaServidaAc : 0) : 0;
      s.perdidaW = disponible ? (fuente === 'RED' ? ESTANDAR_RED_W : ESTANDAR_W) + (pvUsadoDc - pvUsadoBus) + (entradaDc - cargaServidaAc) + redCargaAc * 0.005 + redCargaBat * 0.05 : 5;
      s.perdidaW = Math.max(5, s.perdidaW);

      // Estado, alarma y LEDs
      const sobrecarga = Pl > 0 && fuente === 'INVERSOR' && (Pl > capInv || cargaFaltaW > 0.03 * Pl);
      if (!batOk) alarmas.push('EASUN_SIN_BATERIA');
      if (s.falloTermico) alarmas.push('EASUN_SOBRETEMP');
      if (disponible && s.bateriaAgotada) alarmas.push('EASUN_BATERIA_BAJA');
      if (disponible && reduccion < 0.999) alarmas.push('EASUN_REDUCIDO_TEMP');
      if (disponible && sobrecarga) alarmas.push('EASUN_SOBRECARGA');
      if (batOk && bat.bms !== 'OK') alarmas.push('EASUN_BMS_' + bat.bms);
      const cortada = disponible && s.falloSobrecarga && fuente === 'INVERSOR';
      const textos = { EASUN_SIN_BATERIA: 'Batería desconectada (QB-101, FB-101 o BMS abiertos)', EASUN_SOBRETEMP: 'Sobretemperatura: inversor parado',
        EASUN_BATERIA_BAJA: `Batería baja (SoC ≤ ${layout.BATERIA.socMinUtilPct} % o < ${SPEC.tensionCorteBajaV} V): carga en red hasta el ${E.socRearmePct} %`,
        EASUN_REDUCIDO_TEMP: 'Temperatura alta: potencia reducida',
        EASUN_SOBRECARGA: cortada ? 'Sobrecarga: salida cortada, reintenta en unos minutos' : 'Sobrecarga: las cargas protegidas no se alimentan por completo' };
      sal.alarma = alarmas.length ? (textos[alarmas[0]] || ('BMS: ' + bat.bms)) : '';
      if (!batOk || s.falloTermico || cortada) sal.estado = 'FALLO';
      else if (reduccion < 0.999 || sobrecarga) sal.estado = 'REDUCIDO';
      else if (pvUsadoDc > 5 || cargaServidaAc > 5 || Math.abs(sal.bateriaP) > 5 || redCargaAc - (fuente === 'RED' ? ESTANDAR_RED_W : 0) > 5 || redCargaBat > 5) sal.estado = 'OPERANDO';
      else sal.estado = 'ESPERA';
      const entrada = sal.pvP + sal.redP + Math.max(0, -sal.bateriaP), salida = sal.cargaP + Math.max(0, sal.bateriaP);
      sal.eficiencia = entrada > 20 ? limitar(salida / entrada, 0, 1) : 0;
      sal.leds = { red: gridOk, bateria: batOk, fallo: sal.estado === 'FALLO' };
      sal.temperaturaC = s.tC; sal.derate = reduccion;
      return (s.salida = sal);
    };
    return s;
  }

  const api = { crearEasun, ESTANDAR_W };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { const P = (window.PCT = window.PCT || {}); (P.fv = P.fv || {}).inversorEasun = api; }
})();
