// Simulación de la planta HTST: une las capas (proceso → instrumentos → PLC → actuadores → proceso) y expone PCT.htst.simulacion (ARQUITECTURA.md §4).
// Paso fijo interno de 0,1 s. El estado es un solo objeto (js/modelo/estado.js); la interfaz y el 3D solo lo leen.
(function () {
  const esNode = typeof require !== 'undefined';
  const layout = esNode ? require('../layout.js') : PCT.htstLayout;
  const { CONSTANTES: C } = esNode ? require('../configuracion/constantes.js') : PCT.htstConstantes;
  const { crearEstado } = esNode ? require('./estado.js') : PCT.htstEstado;
  const termica = esNode ? require('./fisica_termica.js') : PCT.htstFisicaTermica;
  const hidraulica = esNode ? require('./fisica_hidraulica.js') : PCT.htstFisicaHidraulica;
  const instrumentos = esNode ? require('./instrumentos.js') : PCT.htstInstrumentos;
  const plc = esNode ? require('../plc/programa.js') : PCT.htstPrograma;
  const { crearMotorAverias, CATALOGO } = esNode ? require('../averias/motor.js') : PCT.htstAverias;
  const medidas = esNode ? require('./medidas.js') : PCT.htstMedidas;
  const { limitar } = termica;
  const P = C.proceso;
  const LLENO_PCT = 99;                                   // un depósito se da por lleno a partir de aquí (el rebosadero empieza en el 100 %)
  const CONTROLES = ['off', 'histeresis', 'pid'];
  const RANGOS_CONTROL = { consignaC: [20, 85], bandaC: [0.5, 20], kp: [0, 100], ki: [0, 5], kd: [0, 500] };
  const BANDA_INTEGRAL_C = 8, VENTANA_BANCOS_S = 30;

  /** `valvulasManuales`: las electroválvulas XV-* no las gobierna el PLC (ni reposición de niveles ni agua fría): solo se abren y cierran a mano con `ordenes.manual`. */
  function crearSimulacion({ semilla = 1, valvulasManuales = false } = {}) {
    const motor = crearMotorAverias(CATALOGO, { semilla });
    const memoriaNueva = () => Object.assign(plc.crearMemoria(), { valvulasManuales: !!valvulasManuales });
    let estado = crearEstado(), mem = memoriaNueva(), salidas = plc.salidasApagadas();
    let ord, pbRestoS = 0, pulsoTSH = false, restoDt = 0, registroAI = {}, modoAnterior = 'PARADA';
    const ordenesVacias = () => ({ arrancar: false, parar: false, modo: null, pulsadores: [], manual: {}, consignaTT103C: null, consignaCaudalLh: null });
    ord = ordenesVacias();

    /** Un paso de 0,1 s de toda la planta. */
    function tick(dt) {
      const eq = estado.equipos, T = estado.proceso.temperaturas, DO = salidas.DO, AO = salidas.AO;
      estado.tiempoS += dt; motor.reloj(estado.tiempoS);
      const alim = motor.alimentacion(estado); estado.alimentacion = alim;
      motor.alCalcularProceso(estado);
      eq['F-001'].fundido = !alim.fusibleF201; eq['PS-001'].tensionV = alim.v24; eq['PS-001'].ok = alim.v24 >= 22;

      // ---- 1. Actuadores: lo que ordena el PLC pasa por las averías de actuador y por el paro de emergencia (relé de seguridad) ----
      const es = eq['ES-001'].rearmado;
      const cierra = (tag, orden) => motor.alAccionarSalida(tag, es && orden ? 1 : 0) === 1;
      const armado = eq['QF-201'].armado;
      eq['KM-203'].cerrado = cierra('KM-203', DO['P-201']);
      eq['KM-201'].cerrado = cierra('KM-201', DO['KM-201']); eq['KM-202'].cerrado = cierra('KM-202', DO['KM-202']);
      eq['SV-101'].energizada = cierra('SV-101', DO['SV-101']);
      eq['SV-101'].bobinaOhm = motor.hay('AV-BOBINA-ABIERTA') ? Infinity : C.electrico.resistenciaBobinaSV101Ohm;
      eq['XV-301'].abierta = es && DO['XV-301'] === 1; eq['XV-401'].abierta = es && DO['XV-401'] === 1;
      for (const v of ['XV-101', 'XV-102', 'XV-201', 'XV-202']) eq[v].abierta = es && DO[v] === 1;
      eq['P-201'].marcha = eq['KM-203'].cerrado && armado;
      const hw = eq['HW-201'];
      hw.banco1 = eq['KM-201'].cerrado && armado; hw.banco2 = eq['KM-202'].cerrado && armado;
      hw.potenciaKW = ((hw.banco1 ? 1 : 0) + (hw.banco2 ? 1 : 0)) * C.aguaCaliente.bancoKW;
      const p101 = eq['P-101'];
      p101.marcha = es && DO['P-101'] === 1 && !p101.fallo; p101.velocidadPct = AO['VFD-101'];
      // Neumática y FDV (seguridad positiva: sin tensión o sin aire el muelle la lleva a desvío)
      const fdv = eq['FDV-101'], aireOK = eq['FRL-501'].presionBar >= P.aireMinimoBar;
      eq['PSL-501'].contactoCerrado = aireOK; fdv.aireOK = aireOK;
      fdv.apertura01 = hidraulica.pasoFDV(fdv.apertura01, { objetivo01: eq['SV-101'].energizada && aireOK ? 1 : 0, dt, aireOK, atascadaEnAvance: fdv.atascada });
      fdv.posicion = hidraulica.posicionFDV(fdv.apertura01);
      eq['P-201'].corrienteA = eq['P-201'].marcha ? C.p102.corrienteNominalA : 0;

      // ---- 2. Proceso ----
      const flt = eq['FLT-101'];
      const caudalObj = hidraulica.caudalObjetivo({ marcha: p101.marcha, velocidadPct: p101.velocidadPct, obstruccion01: flt.obstruccion01, nivelPct: estado.tanque.nivelPct });
      p101.caudalLh = caudalObj === 0 && p101.caudalLh < 0.5 ? 0 : termica.acercar(p101.caudalLh, caudalObj, dt, C.p101.tauCaudalS);
      const caudal = p101.caudalLh;
      p101.corrienteA = p101.marcha ? C.p101.corrienteNominalA * (0.3 + 0.7 * p101.velocidadPct / 100) * (1 - 0.3 * flt.obstruccion01) : 0;
      p101.temperaturaDisipadorC = termica.pasoDisipadorVariador(p101.temperaturaDisipadorC, { corrienteA: p101.corrienteA, ventiladorOK: p101.ventiladorOK, dt });
      if (p101.temperaturaDisipadorC >= C.variador.disparoC) p101.fallo = true;
      else if (p101.fallo && p101.temperaturaDisipadorC < C.variador.disparoC - 20) p101.fallo = false;
      eq['VFD-101'].fallo = p101.fallo;

      // En recirculación de agua la FDV está en desvío (el agua vuelve al tanque), pero el circuito de recirculación pasa por el lado pasteurizado de la regeneración:
      // el calentamiento y el diferencial se calculan como en avance. Solo con la FDV en desvío en otro modo (fallo, manual, parada) no llega producto caliente a la regeneración.
      const hayAvance = fdv.apertura01 >= 0.5 || (estado.modo === 'RECIRCULACION_AGUA' && !!eq['P-101'].marcha);
      const obj = termica.objetivosProducto({ entradaC: estado.tanque.temperaturaC, aguaC: T.aguaCaliente, salidaTuboC: T.salidaTubo, caudalLh: caudal, hayAvance, aguaFria: eq['XV-301'].abierta });
      const tau = caudal > 1 ? C.intercambiador.tauSeccionS : 120;
      T.entrada = estado.tanque.temperaturaC;
      T.trasRegeneracion = termica.acercar(T.trasRegeneracion, obj.t102, dt, tau);
      T.trasCalentamiento = termica.acercar(T.trasCalentamiento, obj.tCalentamiento, dt, tau);
      const tRes = hidraulica.tiempoResidenciaS(caudal);
      T.salidaTubo = termica.acercar(T.salidaTubo, T.trasCalentamiento, dt, Number.isFinite(tRes) ? limitar(tRes, 2, 60) : 120);   // el tubo retrasa la temperatura
      T.trasRegeneracionPas = termica.acercar(T.trasRegeneracionPas, obj.tTrasRegeneracionPas, dt, tau);   // TT-106: entrada al enfriamiento
      T.salidaFinal = termica.acercar(T.salidaFinal, obj.t104, dt, tau);
      // Sin agua en el depósito P-201 no tiene qué mover y no hay intercambio con la leche
      const perdidaLecheKW = eq['P-201'].marcha && caudal > 1 && hw.nivelPct > C.aguaCaliente.nivelBajoPct ? termica.potenciaALeche(caudal, T.trasRegeneracion, T.trasCalentamiento) : 0;
      const mezcla = termica.pasoNivelAguaCaliente(hw.volumenL, T.aguaCaliente, { llenando: eq['XV-201'].abierta, vaciando: eq['XV-202'].abierta, dt });
      hw.volumenL = mezcla.volumenL; hw.nivelPct = hw.volumenL / C.aguaCaliente.capacidadL * 100;
      T.aguaCaliente = termica.pasoAguaCaliente(mezcla.temperaturaC, { potenciaKW: hw.potenciaKW, perdidaLecheKW, dt, volumenL: hw.volumenL });
      estado.aguaCaliente.volumenL = hw.volumenL; estado.aguaCaliente.nivelPct = hw.nivelPct; estado.aguaCaliente.temperaturaC = T.aguaCaliente;
      eq['LSL-201'].contactoCerrado = hw.nivelPct > C.aguaCaliente.nivelBajoPct;
      hw.temperaturaC = T.aguaCaliente;
      const tsh = eq['TSH-201'];
      tsh.disparado = termica.pasoTermostato(tsh.disparado, T.aguaCaliente, pulsoTSH); pulsoTSH = false;
      tsh.abierto = tsh.disparado || tsh.falsoContacto;
      estado.proceso.presiones = hidraulica.presiones({ caudalLh: caudal, hayAvance, fuga01: eq['HX-101'].fugaPlaca01, obstruccion01: flt.obstruccion01 });
      estado.proceso.caudalLh = caudal; estado.proceso.tiempoResidenciaS = tRes; eq['HT-101'].tiempoResidenciaS = tRes;
      estado.proceso.pasteurizadoReal = caudal > 1 && T.salidaTubo >= P.temperaturaPasteurizacionC && tRes >= P.tiempoResidenciaMinS;
      eq['HX-101'].regeneracion.tempC = T.trasRegeneracion; eq['HX-101'].calentamiento.tempC = T.trasCalentamiento; eq['HX-101'].enfriamiento.tempC = T.salidaFinal;

      // Tanque de balance: sale lo que bombea P-101, entra la reposición y el desvío (la leche desviada vuelve al tanque)
      // XV-101 llena (la manda el PLC en automático y el operador en manual), XV-102 vacía; el tanque tiene rebosadero
      const tk = eq['TK-101'];
      tk.reponiendo = eq['XV-101'].abierta;
      const retorno = fdv.apertura01 < 0.5 ? caudal : 0;
      const entradaLh = (eq['XV-101'].abierta ? C.tanque.llenadoXV101Lh : 0) + retorno;
      tk.desbordando = tk.volumenL >= C.tanque.capacidadL - 1e-6 && entradaLh > caudal + (eq['XV-102'].abierta ? C.tanque.vaciadoXV102Lh : 0);
      tk.volumenL = hidraulica.pasoTanque(tk.volumenL, { entradaLh, salidaLh: caudal + (eq['XV-102'].abierta ? C.tanque.vaciadoXV102Lh : 0), dt });
      tk.nivelPct = tk.volumenL / C.tanque.capacidadL * 100;
      estado.tanque.volumenL = tk.volumenL; estado.tanque.nivelPct = tk.nivelPct;

      // Contadores
      const k = estado.contadores, litros = caudal * dt / 3600;
      if (fdv.posicion === 'AVANCE' && (estado.modo === 'PRODUCCION' || estado.modo === 'MANUAL')) {
        k.producidoL += litros;
        // En manual la leche también se cuenta, y es NO CONFORME si pasa por la FDV sin cumplir las condiciones (72 °C, 15 s, diferencial, aire, lazos sanos)
        if (!estado.proceso.pasteurizadoReal || (estado.modo === 'MANUAL' && !(estado.plc && estado.plc.cumpleCondiciones))) k.noConformeL += litros;
      }
      if (fdv.apertura01 < 0.5) k.desviadoL += litros;
      k.energiaKWh += hw.potenciaKW * dt / 3600;

      // ---- 3. Instrumentos → entradas del PLC ----
      pbRestoS = Math.max(0, pbRestoS - dt);
      const entradas = instrumentos.leerEntradas(estado, estado.tiempoS, motor, alim, pbRestoS > 0);
      registroAI = entradas.registroAI;
      estado.instrumentos = {};
      for (const [tag, r] of Object.entries(registroAI)) estado.instrumentos[tag] = r;
      for (const [tag, nivel] of Object.entries(entradas.DI)) estado.instrumentos[tag] = { nivel };
      eq['PB-001'].pulsado = pbRestoS > 0;

      // ---- 3b. Automatismos del operador (llenado y control de temperatura): en cada paso fijo, no al ritmo de la interfaz (R6) ----
      automatismos(dt);

      // ---- 4. Programa del PLC ----
      const ordenes = { arrancar: ord.arrancar, parar: ord.parar, modo: ord.modo, pulsadores: ord.pulsadores.slice(), manual: Object.assign({}, ord.manual),
        consignaTT103C: ord.consignaTT103C, consignaCaudalLh: ord.consignaCaudalLh };
      ord.arrancar = false; ord.parar = false; ord.modo = null; ord.pulsadores = [];
      const res = plc.ejecutarPLC({ AI: entradas.AI, DI: entradas.DI }, mem, ordenes, dt);
      salidas = { DO: res.DO, AO: res.AO };
      estado.salidasPLC = { DO: Object.assign({}, res.DO), AO: Object.assign({}, res.AO) };
      if (modoAnterior === 'MANUAL' && res.modo !== 'MANUAL') {            // al volver a automático el PLC recupera el mando
        ord.manual = {}; ponerControl({ modo: 'off' }, false);
        if (estado.operador.llenado.activo) { estado.operador.llenado.activo = false; estado.operador.llenado.final = 'cancelado'; }   // el llenado también se cancela
      }
      modoAnterior = res.modo;
      estado.modo = res.modo; estado.alarmas = res.alarmas; estado.averiasActivas = motor.activas();
      eq['HL-001'].encendida = res.DO['HL-001'] === 1;
      estado.plc = { paro: res.paro, motivosParo: res.motivosParo, consignaAguaC: res.consignaAguaC, cip: res.cip, cumpleCondiciones: res.cumpleCondiciones };
    }

    /**
     * Automatismos del operador, en cada paso de 0,1 s (antes los hacía la interfaz cada 250 ms y dependían de la velocidad: R6 del contrato).
     *   Llenado: abre XV-101 y XV-201 (órdenes manuales) hasta que cada depósito está lleno (TK-101 ≥ 99 %, HW-201 con LSH-201) y la cierra; con paro de seguridad
     *     cierra las dos y lo da por terminado.
     *   Control de temperatura (solo en MANUAL): histéresis o PID sobre TT-201 que manda P-201 y los dos bancos KM-201/KM-202 como lo haría un operador. Las
     *     protecciones del PLC siguen cortando por encima. Sin lectura válida de TT-201, bancos apagados.
     */
    function automatismos(dt) {
      const op = estado.operador, I = estado.instrumentos || {};
      if (op.llenado.activo) {
        const aguaLlena = I['LSH-201'] && typeof I['LSH-201'].nivel === 'number' ? I['LSH-201'].nivel === 1 : estado.aguaCaliente.nivelPct >= LLENO_PCT;
        const paro = !!(estado.plc && estado.plc.paro);
        let pendientes = 0;
        for (const [tag, lleno] of [['XV-101', estado.tanque.nivelPct >= LLENO_PCT], ['XV-201', aguaLlena]]) {
          if (lleno || paro) ord.manual[tag] = 0; else { ord.manual[tag] = 1; pendientes++; }
        }
        if (!pendientes) { op.llenado.activo = false; op.llenado.final = paro ? 'paro' : 'lleno'; }
      }
      const c = op.control;
      if (c.modo === 'off' || estado.modo !== 'MANUAL') return;
      const tt = I['TT-201'];
      if (!tt || typeof tt.valorPLC !== 'number' || (tt.calidad && tt.calidad !== 'OK')) {
        ord.manual['KM-201'] = 0; ord.manual['KM-202'] = 0; c.salidaPct = 0; c.sinLectura = true; return;
      }
      c.sinLectura = false;
      const T = tt.valorPLC;
      let b1, b2;
      if (c.modo === 'histeresis') {
        c.encendido = T <= c.consignaC - c.bandaC / 2 ? true : T >= c.consignaC + c.bandaC / 2 ? false : !!c.encendido;
        b1 = b2 = c.encendido; c.salidaPct = b1 ? 100 : 0;
      } else {
        // PID con anti-windup por integración condicional y separación de la integral (solo integra con |error| < 8 °C); derivada sobre el error
        const error = c.consignaC - T, p = c.kp * error, d = c.ultimoError === null ? 0 : c.kd * (error - c.ultimoError) / dt;
        const u0 = p + c.integral + d, saturada = (u0 >= 100 && error > 0) || (u0 <= 0 && error < 0);
        if (Math.abs(error) < BANDA_INTEGRAL_C && !saturada) c.integral = limitar(c.integral + c.ki * error * dt, 0, 100);
        c.ultimoError = error;
        c.salidaPct = limitar(p + c.integral + d, 0, 100);
        // Reparto en dos bancos de 30 kW por modulación de tiempo en ventanas de 30 s: hasta el 50 % solo el banco 1; por encima, el 1 fijo y el 2 a ciclo
        const fase = ((estado.tiempoS % VENTANA_BANCOS_S) + VENTANA_BANCOS_S) % VENTANA_BANCOS_S / VENTANA_BANCOS_S;
        b1 = fase < (c.salidaPct >= 50 ? 1 : c.salidaPct / 50); b2 = fase < (c.salidaPct <= 50 ? 0 : (c.salidaPct - 50) / 50);
      }
      ord.manual['P-201'] = 1; ord.manual['KM-201'] = b1 ? 1 : 0; ord.manual['KM-202'] = b2 ? 1 : 0;
    }
    /** Cambia el control de temperatura (vuelve a empezar: PID sin memoria). Con 'off' apaga los dos bancos si `apagarBancos`. */
    function ponerControl(cfg, apagarBancos) {
      const c = estado.operador.control;
      if (CONTROLES.includes(cfg.modo)) c.modo = cfg.modo;
      for (const [k, [min, max]] of Object.entries(RANGOS_CONTROL)) if (Number.isFinite(cfg[k])) c[k] = limitar(cfg[k], min, max);
      c.encendido = false; c.salidaPct = 0; c.integral = 0; c.ultimoError = null; c.sinLectura = false;
      if (c.modo === 'off' && apagarBancos) { ord.manual['KM-201'] = 0; ord.manual['KM-202'] = 0; }
    }

    /** Avanza el tiempo simulado dtS segundos (se trocea en pasos de 0,1 s). */
    function paso(dtS) {
      restoDt += Math.max(0, Math.min(Number(dtS) || 0, 3600));
      while (restoDt >= C.PASO_S - 1e-9) { tick(C.PASO_S); restoDt -= C.PASO_S; }
    }

    const ordenes = {
      arrancar() { ord.arrancar = true; },
      parar() { ord.parar = true; },
      consignaTemperaturaC(c) { if (Number.isFinite(Number(c))) ord.consignaTT103C = limitar(Number(c), 60, 85); },   // un valor no numérico se ignora
      consignaCaudalLh(q) { if (Number.isFinite(Number(q))) ord.consignaCaudalLh = limitar(Number(q), 0, P.caudalMaximoLh); },
      modo(m) { if (layout.MODOS.includes(m)) ord.modo = m; },
      pulsador(tag) {
        if (tag === 'PB-001') { pbRestoS = 1; ord.pulsadores.push('PB-001'); }
        else if (tag === 'TSH-201') pulsoTSH = true;                      // rearme manual del termostato (solo si el agua ya bajó de 80 °C)
      },
      manual(tag, valor) { if (valor === null || valor === undefined) delete ord.manual[tag]; else ord.manual[tag] = valor; },
      paroEmergencia(activo) { estado.equipos['ES-001'].rearmado = !activo; },
      /** Fija el nivel (0-100 %) de un depósito: 'tanque' (TK-101) o 'aguaCaliente' (HW-201). Sirve de nivel inicial y también para corregirlo con la planta en marcha. */
      nivelDeposito(cual, pct) {
        if (pct === null || pct === '' || !Number.isFinite(Number(pct))) return;
        const n = limitar(Number(pct), 0, 100);
        if (cual === 'tanque') { const tk = estado.equipos['TK-101']; tk.volumenL = C.tanque.capacidadL * n / 100; tk.nivelPct = n; tk.desbordando = false; estado.tanque.volumenL = tk.volumenL; estado.tanque.nivelPct = n; }
        else if (cual === 'aguaCaliente') {
          const hw = estado.equipos['HW-201']; hw.volumenL = C.aguaCaliente.capacidadL * n / 100; hw.nivelPct = n;
          estado.aguaCaliente.volumenL = hw.volumenL; estado.aguaCaliente.nivelPct = n; estado.equipos['LSL-201'].contactoCerrado = n > C.aguaCaliente.nivelBajoPct;
        }
      },
      /**
       * Control de temperatura del agua en MANUAL (lo ejecuta el modelo en cada paso): { modo: 'off'|'histeresis'|'pid', consignaC (20-85), bandaC (0,5-20, histéresis),
       * kp (0-100), ki (0-5), kd (0-500) }; lo que falte se conserva. Cada orden reinicia el controlador. Con 'off' apaga los bancos.
       */
      controlTemperatura(cfg) { ponerControl(cfg || {}, true); },
      /** Llenado de los dos depósitos: true abre XV-101 y XV-201 hasta que estén llenos (y las cierra); false lo cancela y las cierra. */
      llenarDepositos(activo) {
        const l = estado.operador.llenado;
        if (activo) { l.activo = true; l.final = ''; }
        else { if (l.activo) l.final = 'cancelado'; l.activo = false; ord.manual['XV-101'] = 0; ord.manual['XV-201'] = 0; }
      },
    };

    const senales = () => {
      const AI = {}, DI = {};
      for (const tag of Object.keys(registroAI)) AI[tag] = { mA: registroAI[tag].mA, valor: registroAI[tag].valorPLC, calidad: registroAI[tag].calidad };
      for (const tag of instrumentos.TAGS_DI) DI[tag] = estado.instrumentos[tag] ? estado.instrumentos[tag].nivel : 0;
      return { AI, DI, DO: Object.assign({}, salidas.DO), AO: Object.assign({}, salidas.AO) };
    };

    /** Vuelve la planta a su estado inicial (las averías inyectadas se conservan salvo que se pida quitarlas). */
    function reiniciar({ quitarAverias = false } = {}) {
      estado = crearEstado(); mem = memoriaNueva(); salidas = plc.salidasApagadas(); ord = ordenesVacias(); restoDt = 0; pbRestoS = 0; pulsoTSH = false; registroAI = {}; modoAnterior = 'PARADA';
      if (quitarAverias) for (const a of motor.activas()) motor.quitar(a.instancia);
      motor.reloj(0);
    }

    const sim = { estado: () => estado, paso, ordenes, senales, alarmas: () => estado.alarmas, averias: motor, reiniciar,
      // Al medir se ven siempre las averías de ahora mismo (aunque se hayan inyectado hace un instante, antes del siguiente paso)
      medidas: { medir: (instrumento, puntoA, puntoB, modo) => medidas.medir(instrumento, puntoA, puntoB, modo, Object.assign({}, estado, { averiasActivas: motor.activas() })), puntos: medidas.PUNTOS } };
    // Acceso del adaptador del contrato (contrato_htst.js), no enumerable: un paso fijo exacto, sin el acumulador propio de paso().
    Object.defineProperty(sim, '_contrato', { enumerable: false, value: { tick: () => tick(C.PASO_S) } });
    return sim;
  }

  const api = { crearSimulacion };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htst = PCT.htst || {}; PCT.htst.simulacion = api; PCT.htst.crearSimulacion = crearSimulacion; PCT.htstSimulacion = api; }
})();
