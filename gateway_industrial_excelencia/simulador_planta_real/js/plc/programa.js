// Programa del PLC de la planta HTST: modos (parada, manual, recirculación de agua, producción, CIP), control del calentamiento en cascada, FDV de seguridad
// positiva, regeneración, paro de seguridad con enclavamiento y alarmas. Es una función pura: recibe lo que el PLC ve y devuelve lo que ordena.
// El PLC NO se fía de un valor con el lazo en fallo (ABIERTO/CORTO): por eso un fallo de TT-103 o de FT-101 siempre manda la FDV a desvío.
// Simplificación del modelo: no distingue agua de leche en la línea; "recirculación" es el modo previo a producir, con la FDV en avance.
(function () {
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.htstLayout;
  const { CONSTANTES: C } = typeof require !== 'undefined' ? require('../configuracion/constantes.js') : PCT.htstConstantes;
  const calidad = typeof require !== 'undefined' ? require('./calidad_senal.js') : PCT.htstCalidadSenal;
  const alarmasMod = typeof require !== 'undefined' ? require('./alarmas.js') : PCT.htstAlarmas;
  const P = C.proceso, K = C.plc;
  const { lazoSano } = calidad;
  const limitar = (v, min, max) => Math.max(min, Math.min(max, v));

  const DO_TAGS = ['P-101', 'P-102', 'KM-201', 'KM-202', 'SV-101', 'XV-301', 'XV-401', 'HL-001', 'XV-101', 'XV-102', 'XV-302', 'XV-303'];
  // Salidas que el operador puede mandar en modo MANUAL (todas menos la baliza, que es del PLC) y la analógica del variador
  const DO_MANUALES = DO_TAGS.filter(t => t !== 'HL-001');
  const CONTACTORES = { 'P-102': 'KM-102', 'KM-201': 'KM-201', 'KM-202': 'KM-202' };   // salida DO → entrada DI del contacto auxiliar

  const salidasApagadas = () => ({ DO: Object.fromEntries(DO_TAGS.map(t => [t, 0])), AO: { 'VFD-101': 0 } });

  /** Memoria del PLC (lo que recuerda de un ciclo al siguiente). */
  function crearMemoria() {
    return {
      modo: 'PARADA', produccionSolicitada: false, paro: false, motivosParo: [],
      trimAguaC: 0, avanceLegal: false, tDesvioProduccionS: 0, tEstableS: 0,
      banco1: false, banco2: false, xv301: false,
      xv101: false, xv302: false, tLlenaAguaS: 0,                  // reposición automática de niveles (con histéresis y temporizador)
      manualCmd: salidasApagadas(),                                // órdenes del operador en modo MANUAL (se parte de las salidas que había: transferencia sin saltos)
      discrepancia: {}, fdvFallo: false, cip: { paso: 0, tPasoS: 0 }, alarmas: [], vueltaARecirculacionS: 0,
      ultimas: salidasApagadas(), tS: 0,
    };
  }

  const acumular = (mem, clave, malo, dt) => { mem.discrepancia[clave] = malo ? (mem.discrepancia[clave] || 0) + dt : 0; return mem.discrepancia[clave] >= K.toleranciaDiscrepanciaS; };

  /** Aplica las órdenes del operador (arrancar, parar, cambiar de modo). */
  function aplicarOrdenes(mem, ord) {
    if (ord.parar) { mem.modo = 'PARADA'; mem.produccionSolicitada = false; mem.cip = { paso: 0, tPasoS: 0 }; }
    if (ord.arrancar && !mem.paro) { mem.modo = 'RECIRCULACION_AGUA'; mem.produccionSolicitada = true; mem.tEstableS = 0; }
    if (ord.modo && !mem.paro && layout.MODOS.includes(ord.modo)) {
      const venia = mem.modo;
      mem.modo = ord.modo; mem.tEstableS = 0; mem.tDesvioProduccionS = 0;
      mem.produccionSolicitada = ord.modo === 'PRODUCCION';
      if (ord.modo === 'CIP') mem.cip = { paso: 0, tPasoS: 0 };
      // Transferencia sin saltos: al pasar a MANUAL cada actuador conserva lo que estaba haciendo
      if (ord.modo === 'MANUAL' && venia !== 'MANUAL') mem.manualCmd = { DO: Object.assign({}, mem.ultimas.DO), AO: Object.assign({}, mem.ultimas.AO) };
    }
  }

  /** Anota en la memoria las órdenes manuales del operador: tag de salida digital (0/1, true/false) o 'VFD-101' (0-100 %). */
  function anotarManual(mem, manual) {
    for (const [tag, valor] of Object.entries(manual || {})) {
      if (tag === 'VFD-101') mem.manualCmd.AO['VFD-101'] = limitar(Number(valor) || 0, 0, 100);
      else if (DO_MANUALES.includes(tag)) mem.manualCmd.DO[tag] = valor ? 1 : 0;
    }
  }

  /**
   * Un ciclo del programa.
   *   entradas: { AI: { tag: { valor, mA, calidad } }, DI: { tag: 0|1 } }
   *   ordenes:  { arrancar, parar, modo, consignaTT103C, consignaCaudalLh, pulsadores: [tag], manual: { tag: valor } }
   * Devuelve { DO, AO, alarmas, modo, paro, motivosParo, consignaAguaC, cip }.
   */
  function ejecutarPLC(entradas, mem, ordenes, dt) {
    const AI = entradas.AI, DI = entradas.DI, ord = ordenes || {};
    mem.tS += dt;

    // 1. Discrepancias entre la orden y la realimentación
    const ult = mem.ultimas;
    const ordenAvance = ult.DO['SV-101'] === 1;
    const fdvMal = acumular(mem, 'FDV', ordenAvance ? DI['ZS-101'] !== 1 : DI['ZS-102'] !== 1, dt);
    const rearme = DI['PB-001'] === 1 || (ord.pulsadores || []).includes('PB-001');
    if (fdvMal) mem.fdvFallo = true;                              // el fallo de la FDV se enclava (si no, desaparecería al pasar la orden a desvío)
    else if (rearme) mem.fdvFallo = false;                        // y solo se borra al rearmar con la válvula ya siguiendo la orden
    const contactores = {};
    for (const [salida, aux] of Object.entries(CONTACTORES)) contactores[aux] = acumular(mem, aux, (ult.DO[salida] === 1) !== (DI[aux] === 1), dt);

    // 2. Paro de seguridad con enclavamiento: se rearma con el pulsador, y solo si ya no hay motivo
    const motivos = [];
    if (DI['ES-001'] === 0) motivos.push('ES-001');
    if (DI['TSH-101'] === 0) motivos.push('TSH-101');
    if (DI['PS-001'] === 0) motivos.push('PS-001');
    if (DI['VFD-101'] === 1) motivos.push('VFD-101');
    if (DI['QF-102'] === 0) motivos.push('QF-102');
    if (mem.fdvFallo) motivos.push('FDV-101');
    // En MANUAL solo el paro de emergencia y la pérdida de los 24 V paran toda la planta: el resto (termostato, variador, nivel…) son cortes locales de cada equipo
    if ((ord.modo || mem.modo) === 'MANUAL') for (let i = motivos.length - 1; i >= 0; i--) if (motivos[i] !== 'ES-001' && motivos[i] !== 'PS-001') motivos.splice(i, 1);
    mem.motivosParo = motivos;
    if (motivos.length) mem.paro = true;
    else if (mem.paro && rearme) { mem.paro = false; mem.modo = 'PARADA'; mem.produccionSolicitada = false; mem.trimAguaC = 0; }
    aplicarOrdenes(mem, ord);

    // 3. Lo que el PLC sabe de la producción
    const tt103 = AI['TT-103'], ft101 = AI['FT-101'], tt104 = AI['TT-104'], tt105 = AI['TT-105'], pt101 = AI['PT-101'], pt102 = AI['PT-102'];
    const aire = DI['PSL-201'] === 1;
    const lazosLegalesSanos = lazoSano(tt103.calidad) && lazoSano(ft101.calidad) && lazoSano(pt101.calidad) && lazoSano(pt102.calidad);
    const tRes = ft101.valor > 50 ? P.volumenTuboResidenciaL / (ft101.valor / 3600) : Infinity;
    const dp = pt102.valor - pt101.valor;
    const dpOK = lazoSano(pt101.calidad) && lazoSano(pt102.calidad) && dp >= P.diferencialMinimoRegeneracionBar;
    const tempOK = lazoSano(tt103.calidad) && tt103.valor >= P.temperaturaPasteurizacionC + (mem.avanceLegal ? K.margenMantenerC : K.margenAvanceC);
    const cumple = lazosLegalesSanos && tempOK && tRes >= P.tiempoResidenciaMinS && dpOK && aire;
    mem.avanceLegal = cumple;

    // 4. Modos y transiciones
    let vueltaARecirculacion = false;
    if (!mem.paro) {
      if (mem.modo === 'RECIRCULACION_AGUA') {
        mem.tEstableS = mem.produccionSolicitada && cumple ? mem.tEstableS + dt : 0;
        if (mem.tEstableS >= K.estabilidadProduccionS) { mem.modo = 'PRODUCCION'; mem.tDesvioProduccionS = 0; }
      } else if (mem.modo === 'PRODUCCION') {
        mem.tDesvioProduccionS = cumple ? 0 : mem.tDesvioProduccionS + dt;
        if (mem.tDesvioProduccionS >= K.retornoRecirculacionS) { mem.modo = 'RECIRCULACION_AGUA'; mem.tEstableS = 0; mem.vueltaARecirculacionS = 30; }
      }
      if (mem.vueltaARecirculacionS > 0) { vueltaARecirculacion = true; mem.vueltaARecirculacionS = Math.max(0, mem.vueltaARecirculacionS - dt); }
    }
    const activo = !mem.paro && mem.modo !== 'PARADA';
    const enCIP = mem.modo === 'CIP' && activo;

    // 5. CIP por tiempos
    let aguaCIP = null;
    if (enCIP) {
      mem.cip.tPasoS += dt;
      const paso = C.cip.pasos[mem.cip.paso];
      if (paso && mem.cip.tPasoS >= paso.duracionS) { mem.cip.paso++; mem.cip.tPasoS = 0; }
      if (mem.cip.paso >= C.cip.pasos.length) { mem.modo = 'PARADA'; mem.cip = { paso: 0, tPasoS: 0 }; }
      else aguaCIP = C.cip.pasos[mem.cip.paso].aguaC;
    }
    const activoFinal = !mem.paro && mem.modo !== 'PARADA';

    // 6. Consigna del agua: cascada con TT-103 (en CIP, la del paso)
    const consignaTT103 = ord.consignaTT103C != null ? ord.consignaTT103C : P.consignaTT103C;
    let consignaAguaC = K.consignaAguaBaseC;
    if (aguaCIP != null) consignaAguaC = aguaCIP;
    else if (activoFinal && lazoSano(tt103.calidad) && tt103.valor > 0) {
      const err = consignaTT103 - tt103.valor;
      if (Math.abs(err) < 5) mem.trimAguaC = limitar(mem.trimAguaC + K.kiTrim * err * dt, K.trimMinC, K.trimMaxC);   // sin integrar lejos de la consigna (antiwindup)
      consignaAguaC = limitar(K.consignaAguaBaseC + mem.trimAguaC + K.kpTrim * err, 65, 86);
    }

    // 7. Salidas
    const sal = salidasApagadas();
    const enManual = mem.modo === 'MANUAL' && !mem.paro;
    if (activoFinal && !enManual) {
      const conAgua = !mem.paro && lazoSano(tt105.calidad) && DI['TSH-101'] === 1 && DI['QF-102'] === 1 && DI['KM-102'] === 1 && DI['LSL-301'] !== 0 && tt105.valor < K.limiteAguaC;
      sal.DO['P-102'] = 1;
      sal.DO['P-101'] = (enCIP || DI['LSL-101'] === 1) ? 1 : 0;
      const caudalOrden = ord.consignaCaudalLh != null ? ord.consignaCaudalLh : P.caudalNominalLh;
      sal.AO['VFD-101'] = enCIP ? 60 : limitar(caudalOrden / C.p101.caudalMaximoLh * 100, C.p101.velocidadMinimaPct, 100);
      mem.banco1 = conAgua && (tt105.valor < consignaAguaC - K.banco1.encenderPorDebajoC || (mem.banco1 && tt105.valor <= consignaAguaC + K.banco1.apagarPorEncimaC));
      mem.banco2 = conAgua && (tt105.valor < consignaAguaC - K.banco2.encenderPorDebajoC || (mem.banco2 && tt105.valor <= consignaAguaC + K.banco2.apagarPorEncimaC));
      sal.DO['KM-201'] = mem.banco1 ? 1 : 0;
      sal.DO['KM-202'] = mem.banco2 ? 1 : 0;
      // FDV: en producción solo avanza si se cumplen todas las condiciones (72 °C, 15 s, ΔP, aire y lazos sanos); en recirculación de agua SIEMPRE en desvío
      // (el agua vuelve al tanque de balance: nada sale por la salida de producto mientras no se esté produciendo, y menos a menos de 72 °C); en CIP, con aire
      const avance = mem.modo === 'PRODUCCION' ? cumple : (mem.modo === 'CIP' ? aire : false);
      sal.DO['SV-101'] = avance ? 1 : 0;
      // Agua fría: si TT-104 no es fiable, se abre (enfriar es lo seguro)
      // El agua fría se enciende al arrancar y sigue abierta mientras la planta funciona en recirculación o en producción (en CIP se cierra en la línea siguiente).
      mem.xv301 = !mem.valvulasManuales;                                    // con las electroválvulas a mano no la abre el PLC (el operador la acciona)
      sal.DO['XV-301'] = enCIP ? 0 : (mem.xv301 ? 1 : 0);
      sal.DO['XV-401'] = enCIP ? 1 : 0;
    } else {
      mem.banco1 = mem.banco2 = false; mem.xv301 = false;
    }
    // Reposición automática de niveles (todos los modos menos MANUAL, y mientras no haya paro de emergencia). Con `valvulasManuales` no hay reposición: llena el operador.
    if (!mem.paro && mem.modo !== 'MANUAL' && !mem.valvulasManuales) {
      const lt = AI['LT-101'];
      if (lt && lazoSano(lt.calidad)) mem.xv101 = lt.valor < C.tanque.reponerDesdePct ? true : (lt.valor >= C.tanque.reponerHastaPct ? false : mem.xv101);
      else mem.xv101 = DI['LSH-101'] !== 1;                         // sin transmisor de nivel se llena hasta el flotador de nivel alto
      if (DI['LSL-301'] === 0) { mem.xv302 = true; mem.tLlenaAguaS = 0; }
      else if (mem.xv302) { mem.tLlenaAguaS += dt; if (mem.tLlenaAguaS >= K.llenadoAguaExtraS) { mem.xv302 = false; mem.tLlenaAguaS = 0; } }
      sal.DO['XV-101'] = mem.xv101 ? 1 : 0;
      sal.DO['XV-302'] = mem.xv302 ? 1 : 0;
    } else if (mem.modo !== 'MANUAL') { mem.xv101 = false; mem.xv302 = false; }

    // 8. Mando manual
    const manual = ord.manual || {};
    if (enManual) {
      // MODO MANUAL: lo que manda el operador es lo que sale; el PLC no automatiza nada y solo mantiene las protecciones cableadas
      anotarManual(mem, manual);
      for (const tag of DO_MANUALES) sal.DO[tag] = mem.manualCmd.DO[tag] ? 1 : 0;
      sal.AO['VFD-101'] = mem.manualCmd.AO['VFD-101'];
      const calentarSeguro = DI['TSH-101'] === 1 && DI['QF-102'] === 1 && DI['KM-102'] === 1 && sal.DO['P-102'] === 1 && DI['LSL-301'] !== 0 && lazoSano(tt105.calidad) && tt105.valor < K.limiteAguaC;
      if (!calentarSeguro) { sal.DO['KM-201'] = 0; sal.DO['KM-202'] = 0; }        // termostato abierto, sin nivel, sin P-102 o agua demasiado caliente: el calentador se corta
      if (!aire) sal.DO['SV-101'] = 0;                                            // sin aire la FDV va a desvío (además del muelle)
      if (DI['LSL-101'] !== 1 || DI['VFD-101'] === 1) sal.DO['P-101'] = 0;        // marcha en seco (tanque vacío) o variador en fallo
    } else if (!mem.paro) {
      // Modos automáticos: un forzado desde el SCADA nunca salta los enclavamientos de seguridad
      for (const [tag, valor] of Object.entries(manual)) {
        if (tag === 'VFD-101') sal.AO['VFD-101'] = limitar(Number(valor) || 0, 0, 100);
        else if (tag in sal.DO && tag !== 'HL-001') sal.DO[tag] = valor ? 1 : 0;
      }
      const calentarSeguro = DI['TSH-101'] === 1 && DI['QF-102'] === 1 && DI['KM-102'] === 1 && sal.DO['P-102'] === 1 && DI['LSL-301'] !== 0 && lazoSano(tt105.calidad) && tt105.valor < K.limiteAguaC;
      if (!calentarSeguro) { sal.DO['KM-201'] = 0; sal.DO['KM-202'] = 0; }
      if (!aire) sal.DO['SV-101'] = 0;
      if (DI['VFD-101'] === 1) sal.DO['P-101'] = 0;
    }

    // 9. Alarmas y baliza
    const alarmas = alarmasMod.fusionarAlarmas(mem.alarmas, alarmasMod.evaluarAlarmas({
      AI, DI, discrepancia: { fdv: mem.fdvFallo, contactores },
      modoManual: mem.modo === 'MANUAL',
      manualFdvSinCondiciones: enManual && sal.DO['SV-101'] === 1 && !cumple,
      dpBajo: DI['P-101'] === 1 && lazoSano(pt101.calidad) && lazoSano(pt102.calidad) && dp < P.diferencialMinimoRegeneracionBar,
      vueltaARecirculacion,
    }), mem.tS);
    mem.alarmas = alarmas;
    sal.DO['HL-001'] = (alarmas.some(a => a.nivel !== 'estado') || mem.paro) ? 1 : 0;       // el aviso de «modo manual» no enciende la baliza

    mem.ultimas = { DO: Object.assign({}, sal.DO), AO: Object.assign({}, sal.AO) };
    return { DO: sal.DO, AO: sal.AO, alarmas, modo: mem.modo, paro: mem.paro, motivosParo: motivos.slice(), consignaAguaC,
      cip: { paso: mem.cip.paso, nombre: (C.cip.pasos[mem.cip.paso] || {}).nombre || null, tPasoS: mem.cip.tPasoS }, tiempoResidenciaS: tRes, diferencialBar: dp, cumpleCondiciones: cumple };
  }

  const api = { DO_TAGS, DO_MANUALES, CONTACTORES, crearMemoria, ejecutarPLC, salidasApagadas };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstPrograma = api; }
})();
