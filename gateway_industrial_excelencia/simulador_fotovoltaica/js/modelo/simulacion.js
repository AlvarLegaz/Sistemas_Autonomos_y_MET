// Simulación completa de la instalación fotovoltaica de la cubierta (API de ARQUITECTURA.md §3): PCT.fv.crearSimulacion(...)
//
// ORDEN DE INTEGRACIÓN en cada micro-paso (≤ 5 s simulados; un paso mayor se subdivide solo):
//   reloj → sol, cielo y ambiente → plano de cada campo → cadenas (sombras, suciedad, diodos, averías) → topología de protecciones →
//   EASun (MPPT, fuentes, cargador) → batería → ZCS (aislamiento, red, MPPT) → balance de alterna con la red y las cargas →
//   disparos por sobrecorriente → energías → temperatura de la caseta. Después de los micro-pasos se publica `estado` (objeto vivo, mismo objeto siempre).
// Determinista con `semilla` (mismatch de paneles, rachas de nubosidad lenta y rápida, carga y aislamiento).
// ORDEN DE CARGA en el navegador: ver configuracion/constantes.js.
//
// CAMPOS EXTRA del `estado` añadidos en la revisión de ingeniería (el contrato de ARQUITECTURA.md §3 no cambia: solo se AÑADE):
//   campos.A|B.diagnostico = { pEsperadaW, pDisponibleW, pRealW, perdidaW, perdidaPct, cadenas: [ { id, pEsperadaW, pDisponibleW, pRealW, perdidaPct, causa } ] }
//        esperada = lo que daría la planta sana y limpia con la misma luz y temperatura; disponible = lo que pueden dar los paneles tal como están (0 si la cadena
//        está desconectada); real = lo que entrega al inversor. causa: 'NOCHE' | 'SIN_CONEXION' | 'MAXIMO_LOCAL' | 'LIMITADA_POR_INVERSOR' | 'PERDIDA_EN_PANELES' | 'NORMAL'.
//        «Producción» (energia.produccionA/BWh) es la potencia de continua que entra al inversor (ya recortada si el EASun no puede aprovecharla: no vierte).
//   inversores['INV-101'] += { mpptActivo, solDormido, arrancando, limiteCargaA, dormido:false }
//        El EASun no tiene estado «dormido»: lo alimentan red o batería y sigue vivo de noche (solo duerme su MPPT: solDormido). `arrancando` = 8 s de autocomprobación al encenderlo.
//        Estado FALLO también por SOBRECARGA sin red (más de 1,05 × 3 kW durante 10 s: salida cortada, reintento a los 180 s). En derivación en reposo (sin cargas, con red)
//        queda en ESPERA con ≈ 15 W propios que da la red, no la batería.
//   bateria += { socMinUtilPct, energiaUtilWh, vReposoV, limiteCargaA }
//        socMinUtilPct (layout, 10 %) manda ahora: el EASun deja de descargar a ese SoC y no vuelve hasta el 25 % (política completa en bateria.js e inversor_easun.js).
//        vReposoV = tensión sin la sobretensión de carga (27,2 V a plena carga); limiteCargaA = tope de carga del BMS según la temperatura (0 bajo 0 °C).
//   alarmas: código nuevo 'BATERIA_FRIA' (info) cuando el BMS limita la carga por frío. 'EASUN_SOBRECARGA' pasa a significar corte de salida si el estado es FALLO.
//   sim.aislamiento(tagCadena) → { ok, mohm, texto }: el megóhmetro de las cuatro cadenas (con FALLO_AISLAMIENTO_B, STR-201 da décimas de MΩ).
//   INSTRUMENTOS DE MEDIDA (API completa en ../../API_INSTRUMENTOS.md; multímetro, pinza y termografía están en medidas.js):
//     sim.resistencia(a, b) · sim.conductores y sim.corriente(id) · sim.puntosAislamiento y sim.aislamiento('STR-201.+') (exige el seccionador abierto) ·
//     sim.curvaIVReferencia(id, n) y sim.resumenIV(id) · sim.termografia().   Campos nuevos del estado: bateria.celdasV [8] y cadenas[].abiertaFisica.
//     sim.curvaIV es la curva en bornes de la cadena (lo que mide un trazador conectado antes del fusible): un fusible fundido ya no la aplana; un MC4 suelto o un cable cortado, sí.
//   ambiente.ghWm2 sigue siendo la global horizontal; campos.X.gPlanoWm2 la del plano (lo que mediría un piranómetro). La luz que de verdad llega a las células
//   descuenta el modificador del ángulo de incidencia (planoInclinado → gUtil) y no se publica. Nubosidad media de cada mes: PCT.fv.sol.NUBOSIDAD_MEDIA_MES.
(function () {
  const esNode = typeof require !== 'undefined';
  const { CONSTANTES: C, layout, crearRng } = esNode ? require('../configuracion/constantes.js') : window.PCT.fv.constantes;
  const Sol = esNode ? require('./sol.js') : window.PCT.fv.sol;
  const Cadena = esNode ? require('./cadena.js') : window.PCT.fv.cadena;
  const Bateria = esNode ? require('./bateria.js') : window.PCT.fv.bateria;
  const Prot = esNode ? require('./protecciones.js') : window.PCT.fv.protecciones;
  const RC = esNode ? require('./red_cargas.js') : window.PCT.fv.redCargas;
  const Easun = esNode ? require('./inversor_easun.js') : window.PCT.fv.inversorEasun;
  const Zcs = esNode ? require('./inversor_zcs.js') : window.PCT.fv.inversorZcs;
  const Medidas = esNode ? require('./medidas.js') : window.PCT.fv.medidas;
  const Motor = esNode ? require('../averias/motor.js') : window.PCT.fv.motorAverias;

  const limitar = (v, a, b) => Math.max(a, Math.min(b, v));
  const PASO_MAX_S = 5;
  const MODOS_EASUN = layout.INVERSORES['INV-101'].modos;

  const TEXTOS = {
    PROTECCION_DISPARADA: 'Protección disparada', FUSIBLE_FUNDIDO: 'Fusible fundido', SPD_AGOTADO: 'Descargador de sobretensiones agotado', PROTECCION_ABIERTA: 'Protección abierta',
    RED_CAIDA: 'Fallo de red de la acometida',
    EASUN_SIN_BATERIA: 'EASun: batería desconectada (QB-101, FB-101 o BMS abiertos)', EASUN_SOBRETEMP: 'EASun: sobretemperatura, inversor parado', EASUN_BATERIA_BAJA: 'EASun: batería baja, las cargas pasan a red hasta que se recupere',
    EASUN_REDUCIDO_TEMP: 'EASun: temperatura alta, potencia reducida', EASUN_SOBRECARGA: 'EASun: sobrecarga, las cargas protegidas no se alimentan por completo', EASUN_COM_PERDIDA: 'EASun: comunicación Wi-Fi/RS485 perdida',
    ZCS_AISLAMIENTO: 'ZCS: fallo de aislamiento del campo FV, no conecta', ZCS_SIN_RED: 'ZCS: sin red o fuera de rango, desconectado (anti-isla)', ZCS_SOBRETENSION_RED: 'ZCS: tensión de red alta, desconectado',
    ZCS_REDUCCION_TENSION: 'ZCS: tensión de red alta, potencia reducida', ZCS_REDUCIDO_TEMP: 'ZCS: temperatura alta, potencia reducida', ZCS_SOBRETEMP: 'ZCS: sobretemperatura, inversor parado', ZCS_CADENA_ABIERTA: 'ZCS: una entrada MPPT sin tensión (cadena abierta)',
    BMS_CORTE_BAJA: 'BMS: corte por baja tensión de celda (no descarga)', BMS_CORTE_ALTA: 'BMS: corte por alta tensión de celda (no carga)', BMS_CORTE_CORRIENTE: 'BMS: corte por sobrecorriente',
    BATERIA_SOC_BAJO: 'Batería casi descargada', CASETA_CALIENTE: 'Caseta muy caliente: revisar la ventilación',
    BATERIA_FRIA: 'Batería fría: el BMS limita la corriente de carga',
  };
  const SEVERIDAD = { PROTECCION_DISPARADA: 'alarma', FUSIBLE_FUNDIDO: 'alarma', SPD_AGOTADO: 'aviso', PROTECCION_ABIERTA: 'info', RED_CAIDA: 'alarma', EASUN_SIN_BATERIA: 'alarma', EASUN_SOBRETEMP: 'alarma',
    EASUN_BATERIA_BAJA: 'aviso', EASUN_REDUCIDO_TEMP: 'aviso', EASUN_SOBRECARGA: 'aviso', EASUN_COM_PERDIDA: 'aviso', ZCS_AISLAMIENTO: 'alarma', ZCS_SIN_RED: 'aviso', ZCS_SOBRETENSION_RED: 'aviso',
    ZCS_REDUCCION_TENSION: 'aviso', ZCS_REDUCIDO_TEMP: 'aviso', ZCS_SOBRETEMP: 'alarma', ZCS_CADENA_ABIERTA: 'aviso', BMS_CORTE_BAJA: 'alarma', BMS_CORTE_ALTA: 'alarma', BMS_CORTE_CORRIENTE: 'aviso',
    BATERIA_SOC_BAJO: 'info', CASETA_CALIENTE: 'aviso', BATERIA_FRIA: 'info' };
  // Averías cuyo efecto es un estado «de memoria» de una protección: [tag, acción]. Al activarse la dejan así; al rearmarla el alumno, la avería se retira.
  const ESTADO_AVERIA = { FUSIBLE_F101: ['F-101', 'fundir'], SPD_DISPARADO_A: ['SPD-101', 'agotar'], QB_DISPARADO: ['QB-101', 'disparar'], DIFERENCIAL_DISPARADO: ['ID-301', 'disparar'] };

  function crearSimulacion(opciones = {}) {
    const inicio = Object.assign({ semilla: 1, diaAnio: 172, horaSolar: 9, nubosidad: 0.1 }, opciones);
    const motor = Motor.crearMotorAverias();
    const estado = {};
    let S = null, medidasCache = null, mppSucio = true;

    const campoDe = tag => (/^STR-1|^PV-1/.test(tag) ? 'A' : 'B');

    function construir(op) {
      const rng = crearRng(op.semilla);
      const cadenas = {}, referencia = {};
      for (const k of ['A', 'B']) {
        const campo = layout.CAMPOS[k];
        for (const c of campo.cadenas) {
          const desajustes = c.paneles.map(() => 1 + limitar(C.DESAJUSTE_SIGMA * rng.normal(), -0.03, 0.03));
          cadenas[c.id] = Cadena.crearCadena({ id: c.id, esp: campo.panel, tags: c.paneles, desajustes });
          referencia[c.id] = Cadena.crearCadena({ id: c.id, esp: campo.panel, tags: c.paneles, desajustes });    // la misma cadena sana, limpia y sin sombra (para el diagnóstico)
        }
      }
      const bat = Bateria.crearBateria({ socInicial01: 0.6 });
      S = { op, rng, t: 0, dia: op.diaAnio, hora: op.horaSolar, nubOrden: limitar(op.nubosidad, 0, 1), tAmbOrden: null, suciedad: { A: 0, B: 0 }, sombras: {}, ruidoNub: 0, ruidoRapido: 0,
        cadenas, referencia, mppRef: {}, bat, prot: Prot.crearProtecciones(), cargas: RC.crearCargas(rng), red: RC.crearRed(), easun: Easun.crearEasun(), zcs: Zcs.crearZcs(rng),
        tCaseta: 25, energia: { prodA: 0, prodB: 0, consumo: 0 }, res: null, tMpp: -1e9, mpp: {}, tConectorC: 25, histG: [] };
      S.tCaseta = Sol.temperaturaAmbiente(S.dia, S.hora, S.nubOrden) + 2;
      S.easun.tC = S.tCaseta + 5; S.zcs.tC = S.tCaseta + 5; S.bat.tC = S.tCaseta;
      mppSucio = true; medidasCache = null;
    }

    motor.oyente((evento, id) => {
      const e = ESTADO_AVERIA[id]; if (!e || !S) return;
      if (evento === 'activar') S.prot[e[1]](e[0], 'Avería: ' + id);
      else S.prot.rearmar(e[0]);
      mppSucio = true;
    });

    /** ¿Está sombreado el panel por el pretil? Solo con la avería SOMBRA_PARAPETO y con el sol bajo. */
    function sombraPretil(tag, alturaGrados) {
      if (!motor.hay('SOMBRA_PARAPETO') || !C.PRETIL.paneles.includes(tag) || alturaGrados <= 0) return 0;
      return limitar((C.PRETIL.alturaCriticaGrados - alturaGrados) / (C.PRETIL.alturaCriticaGrados - C.PRETIL.alturaPlenaGrados), 0, 1) * C.PRETIL.sombraMax;
    }

    function micro(dt) {
      S.t += dt;
      S.hora += dt / 3600;
      if (S.hora >= 24) { S.hora -= 24; S.dia = (S.dia % 365) + 1; }
      // Cielo
      // Nubosidad variable: una racha lenta (≈ 15 min, bancos de nubes) y otra rápida (≈ 80 s, nubes sueltas que pasan). Con el cielo despejado
      // (n = 0) o cubierto (n = 1) no hay variación; la máxima variación está en n = 0,5. Las aberturas entre nubes dan el realce de borde de nube.
      if (dt > 0) {
        S.ruidoNub = limitar(S.ruidoNub - S.ruidoNub * dt / 900 + 1.2 * Math.sqrt(dt / 900) * S.rng.normal(), -1.5, 1.5);
        S.ruidoRapido = limitar(S.ruidoRapido - S.ruidoRapido * dt / 80 + 1.2 * Math.sqrt(dt / 80) * S.rng.normal(), -1.5, 1.5);
      }
      const n = S.nubOrden, amp = 4 * n * (1 - n), nEf = limitar(n + (0.35 * S.ruidoNub + 0.2 * S.ruidoRapido) * amp, 0, 1);
      const pos = Sol.posicionSolar(S.dia, S.hora);
      const cielo = Sol.conNubosidad(Sol.cieloDespejado(S.dia, pos.sinAltura), nEf, limitar(-S.ruidoRapido / 1.5, 0, 1));
      const tAmb = S.tAmbOrden != null ? S.tAmbOrden : Sol.temperaturaAmbiente(S.dia, S.hora, nEf);
      const suc = { A: motor.hay('SUCIEDAD_ALTA_A') ? 1 - (1 - S.suciedad.A) * (1 - C.SUCIEDAD_AVERIA_A) : S.suciedad.A, B: S.suciedad.B };
      // Cadenas
      const prot = S.prot, abiertaFisica = { 'STR-101': motor.hay('CADENA_ABIERTA_A1'), 'STR-102': false, 'STR-201': motor.hay('CADENA_ABIERTA_B1'), 'STR-202': false };
      const diodos = {};
      if (motor.hay('DIODO_BYPASS_PV104')) diodos['PV-104'] = ['corto', 'ok', 'ok'];
      if (motor.hay('DIODO_BYPASS_ABIERTO_PV203')) diodos['PV-203'] = ['abierto', 'ok', 'ok'];
      const fusible = { 'STR-101': 'F-101', 'STR-102': 'F-102' };
      const planos = {};
      for (const k of ['A', 'B']) {
        const campo = layout.CAMPOS[k];
        const pl = planos[k] = Sol.planoInclinado(pos, cielo, campo.inclinacionGrados, campo.azimutGrados);
        for (const c of campo.cadenas) {
          const cad = S.cadenas[c.id], sombras = {};
          for (const tag of c.paneles) sombras[tag] = 1 - (1 - (S.sombras[tag] || 0)) * (1 - sombraPretil(tag, pos.alturaGrados));
          const rExtra = c.id === 'STR-202' && motor.hay('CONECTOR_RESISTIVO_B2') ? motor.parametro('CONECTOR_RESISTIVO_B2', 'resistenciaOhm', 1) : 0;
          const fusOk = fusible[c.id] ? prot.conduce(fusible[c.id]) : true;
          cad.actualizar({ g: pl.gUtil, gDif: pl.difusaUtil, tAmbC: tAmb, suciedad: suc[k], sombras, diodos, abierta: abiertaFisica[c.id] || !fusOk, resistenciaExtraOhm: rExtra, dt });
        }
      }
      // Red y topología
      const redDisp = S.red.disponible && !motor.hay('RED_CAIDA');
      const vRedNom = motor.hay('SOBRETENSION_RED') ? 253 : S.red.tensionV;
      const vRed = redDisp ? vRedNom : 0, fRed = redDisp ? layout.RED.frecuenciaHz : 0;
      const top = prot.topologia({ redDisponible: redDisp, tensionRedV: vRedNom });
      const redOkEasun = top.redEasun && vRed >= 170 && vRed <= 280;
      const redOkZcs = top.redZcs;
      // EASun
      const conectadas = ids => ids.map(id => S.cadenas[id]).filter(c => top.cadenaConectada[c.id] && !c.abierta);
      const grupoA = conectadas(['STR-101', 'STR-102']);
      const bat = S.bat; bat.desequilibrada = motor.hay('CELDA_DESEQUILIBRADA'); bat.bmsForzado = motor.hay('BMS_CORTE_BATERIA');
      const dem301 = S.cargas.demanda('LOAD-301', S.hora), dem302 = S.cargas.demanda('LOAD-302', S.hora);
      S.cargas.paso(dt);
      const rA = S.easun.paso(dt, { bateria: bat, batConectada: top.bateriaConectada, curvaPv: top.pvAEnInversor && grupoA.length ? Cadena.crearGrupo(grupoA) : null,
        redOk: redOkEasun, demandaCargasW: dem302, cargasCableadas: top.cargas302Cableadas, tCasetaC: S.tCaseta });
      const op = {};                                                  // punto de trabajo de cada cadena: { v, i }
      for (const id of ['STR-101', 'STR-102']) {
        const c = S.cadenas[id];
        if (rA.mpptActivo && grupoA.includes(c)) op[id] = { v: rA.vOperacion, i: Math.min(c.iDeV(rA.vOperacion), 1e3) };
        else op[id] = { v: c.voc(), i: 0 };
      }
      // Batería
      bat.paso(dt, rA.bateriaI, S.tCaseta);
      prot.vigilarCorriente('QB-101', Math.abs(rA.bateriaI), dt);
      // ZCS
      const gB = ['STR-201', 'STR-202'].map(id => { const c = S.cadenas[id]; return top.cadenaConectada[id] && !c.abierta ? Cadena.crearGrupo([c]) : null; });
      const rB = S.zcs.paso(dt, { curvas: gB, redOk: redOkZcs, vRedV: vRed, fRedHz: fRed, fallaAislamiento: motor.hay('FALLO_AISLAMIENTO_B'), tCasetaC: S.tCaseta });
      ['STR-201', 'STR-202'].forEach((id, k) => {
        const c = S.cadenas[id], m = rB.mppt[k];
        op[id] = m.activo && gB[k] ? { v: m.v, i: m.i } : { v: c.voc(), i: 0 };
      });
      // Balance de alterna
      const cons301 = top.cargas301Energizadas ? dem301 : 0, serv302 = rA.cargaP;
      const pRed = top.redEnCuadro ? cons301 + rA.redP - rB.acP : 0;
      const vNodo = vRed || 230;
      prot.vigilarCorriente('QF-301', Math.abs(pRed) / vNodo, dt);
      prot.vigilarCorriente('QF-302', Math.max(rA.redP, rA.cargaP) / 230, dt);
      prot.vigilarCorriente('QF-303', rB.acP / 230, dt);
      // Energías
      const pA = ['STR-101', 'STR-102'].reduce((s, id) => s + op[id].v * op[id].i, 0), pB = ['STR-201', 'STR-202'].reduce((s, id) => s + op[id].v * op[id].i, 0);
      S.energia.prodA += pA * dt / 3600; S.energia.prodB += pB * dt / 3600; S.energia.consumo += (cons301 + serv302) * dt / 3600;
      if (pRed > 0) S.red.energiaImportadaWh += pRed * dt / 3600; else S.red.energiaExportadaWh += -pRed * dt / 3600;
      // Caseta
      const ua = motor.hay('VENTILACION_TAPADA') ? C.CASETA.uaTapadaWK : C.CASETA.uaNormalWK;
      const perdidas = S.easun.perdidaW + S.zcs.perdidaW + rA.bateriaI * rA.bateriaI * bat.r();
      const objetivo = tAmb + 5 * cielo.gh / 1000 + perdidas / ua;
      S.tCaseta += (objetivo - S.tCaseta) * (1 - Math.exp(-dt / C.CASETA.tauS));
      const iCon = op['STR-202'].i;
      // El conector sano va unos 6 °C sobre el ambiente; el malo disipa I²·R y se calienta 0,45 K por vatio (1 Ω con 13 A son 170 W: más de 100 °C, de quemarse).
      S.tConectorC = tAmb + 6 + (motor.hay('CONECTOR_RESISTIVO_B2') ? iCon * iCon * motor.parametro('CONECTOR_RESISTIVO_B2', 'resistenciaOhm', 1) * 0.45 : 0);
      if (dt > 0) {                                                   // historial corto de irradiancia: el trazador I-V pide luz estable
        S.histG.push({ t: S.t, A: planos.A.g, B: planos.B.g });
        while (S.histG.length && S.histG[0].t < S.t - 40) S.histG.shift();
      }
      S.res = { pos, cielo, planos, tAmb, nEf, suc, top, redDisp, vRed, fRed, rA, rB, op, cons301, serv302, pRed, dem301, dem302, abiertaFisica, diodos };
    }

    /** La cadena de referencia (sana, limpia, sin sombra) puesta a la luz y temperatura de ahora. */
    function referenciaAlDia(id) {
      const R = S.res, ref = S.referencia[id], pl = R.planos[campoDe(id)];
      ref.iniciada = false;
      ref.actualizar({ g: pl.gUtil, gDif: pl.difusaUtil, tAmbC: R.tAmb, suciedad: 0, sombras: {}, diodos: {}, abierta: false, resistenciaExtraOhm: 0, dt: 0 });
      return ref;
    }

    function refrescarMpp() {
      if (!mppSucio && S.t - S.tMpp < 30) return;
      const R = S.res;
      for (const id of Object.keys(S.cadenas)) {
        S.mpp[id] = S.cadenas[id].mpp();
        // Referencia sana: la misma cadena sin sombra, suciedad, diodos ni conector malo, con la temperatura de célula ya estabilizada
        S.mppRef[id] = referenciaAlDia(id).mpp();
      }
      S.tMpp = S.t; mppSucio = false;
    }

    /**
     * Diagnóstico didáctico por cadena y campo: potencia que daría la planta sana (esperada), la que pueden dar los paneles tal como están
     * (disponible: sombras, suciedad, diodos, conector; 0 si la cadena está desconectada) y la que entrega de verdad al inversor (real).
     * causa: 'NOCHE' | 'SIN_CONEXION' (fusible, MC4, seccionador) | 'MAXIMO_LOCAL' (sombra parcial: el MPPT está en un pico que no es el global) |
     *        'LIMITADA_POR_INVERSOR' (la cadena podría dar más: batería llena y cargas servidas, tope de 3 kW, inversor sin conectar…) |
     *        'PERDIDA_EN_PANELES' (sombra, suciedad, diodo, conector…) | 'NORMAL'.
     */
    function diagnostico(R, campos) {
      const d = {};
      for (const k of ['A', 'B']) {
        const camp = campos[k];
        const cadenas = camp.cadenas.map(c => {
          const esperada = (S.mppRef[c.id] || { p: 0 }).p, conectada = R.top.cadenaConectada[c.id] && !c.abierta;
          const disponible = conectada ? c.pmpp : 0, real = c.p;
          let causa = 'NORMAL';
          if (esperada < 20) causa = 'NOCHE';
          else if (!conectada) causa = 'SIN_CONEXION';
          else if (real < 0.9 * disponible) causa = c.enMaximoLocal ? 'MAXIMO_LOCAL' : 'LIMITADA_POR_INVERSOR';
          else if (disponible < 0.9 * esperada) causa = 'PERDIDA_EN_PANELES';
          return { id: c.id, pEsperadaW: esperada, pDisponibleW: disponible, pRealW: real, perdidaPct: esperada > 20 ? limitar(100 * (1 - real / esperada), 0, 100) : 0, causa };
        });
        const esp = cadenas.reduce((s, c) => s + c.pEsperadaW, 0), disp = cadenas.reduce((s, c) => s + c.pDisponibleW, 0), real = cadenas.reduce((s, c) => s + c.pRealW, 0);
        d[k] = { pEsperadaW: esp, pDisponibleW: disp, pRealW: real, perdidaW: Math.max(0, esp - real), perdidaPct: esp > 20 ? limitar(100 * (1 - real / esp), 0, 100) : 0, cadenas };
      }
      return d;
    }

    function alarmasActuales(R) {
      const L = [], add = (codigo, tag, texto) => L.push({ codigo, texto: texto || TEXTOS[codigo], tag, severidad: SEVERIDAD[codigo] || 'aviso' });
      for (const tag of S.prot.TODOS) {
        const e = S.prot.estados[tag];
        if (e.estado === 'DISPARADO') add('PROTECCION_DISPARADA', tag, `${tag} disparado${e.causa ? ' · ' + e.causa : ''}`);
        else if (e.estado === 'FUNDIDO') add('FUSIBLE_FUNDIDO', tag, `Fusible ${tag} fundido`);
        else if (e.estado === 'AGOTADO') add('SPD_AGOTADO', tag, `Descargador ${tag} agotado (testigo en rojo)`);
        else if (e.estado === 'ABIERTO') add('PROTECCION_ABIERTA', tag, `${tag} abierto`);
      }
      if (!R.redDisp) add('RED_CAIDA', 'RED-301');
      for (const c of R.rA.alarmas) if (!c.startsWith('EASUN_BMS_')) add(c, 'INV-101');
      for (const c of R.rB.alarmas) add(c, 'INV-201');
      if (motor.hay('COMUNICACION_PERDIDA_EASUN')) add('EASUN_COM_PERDIDA', 'COM-101');
      const mp = R.rB.mppt;
      if ((R.rB.estado === 'OPERANDO' || R.rB.estado === 'REDUCIDO') && (mp[0].v <= 1) !== (mp[1].v <= 1)) add('ZCS_CADENA_ABIERTA', 'INV-201');
      if (S.bat.bms !== 'OK') add('BMS_' + S.bat.bms, 'BAT-101');
      if (S.bat.soc01 < 0.05) add('BATERIA_SOC_BAJO', 'BAT-101');
      if (S.bat.limiteCargaA() < 0.5 * layout.BATERIA.corrienteMaxCargaA) add('BATERIA_FRIA', 'BAT-101');
      if (S.tCaseta > 50) add('CASETA_CALIENTE', 'CAS-001');
      return L;
    }

    /** Tensión de las 8 celdas: la 3 es la más baja y la 6 la más alta (las que vigila el BMS); el resto se reparten lo que queda del pack. */
    function celdasV() {
      const b = S.bat, n = layout.BATERIA.celdas, resto = (b.v - b.vCeldaMin - b.vCeldaMax) / (n - 2);
      const v = Array.from({ length: n }, () => resto); v[2] = b.vCeldaMin; v[5] = b.vCeldaMax;
      return v;
    }

    function publicar() {
      const R = S.res; refrescarMpp();
      const campos = {};
      for (const k of ['A', 'B']) {
        const camp = layout.CAMPOS[k];
        const cadenas = camp.cadenas.map(c => {
          const cad = S.cadenas[c.id], o = R.op[c.id], mp = S.mpp[c.id] || { v: 0, i: 0, p: 0 };
          const abierta = cad.abierta, p = o.v * o.i;
          return { id: c.id, abierta, abiertaFisica: !!R.abiertaFisica[c.id], v: abierta ? cad.voc() : o.v, i: abierta ? 0 : o.i, p: abierta ? 0 : p, voc: cad.voc(), vmpp: mp.v, impp: mp.i, pmpp: mp.p,
            mppEnCurso: mp.p > 1 && !abierta && p >= 0.97 * mp.p, enMaximoLocal: mp.p > 20 && !abierta && o.i > 0 && p < 0.9 * mp.p,
            paneles: cad.detalle(abierta ? 0 : o.i).map(q => ({ tag: q.tag, p: q.p, v: q.v, tempCelulaC: q.tempCelulaC, sombra01: q.sombra01, bypass: q.bypass })) };
        });
        const act = cadenas.filter(c => c.i > 0);
        campos[k] = { gPlanoWm2: R.planos[k].g, p: cadenas.reduce((s, c) => s + c.p, 0), v: act.length ? act.reduce((s, c) => s + c.v, 0) / act.length : Math.max(0, ...cadenas.map(c => c.v)), i: cadenas.reduce((s, c) => s + c.i, 0), cadenas };
      }
      const diag = diagnostico(R, campos);
      for (const k of ['A', 'B']) campos[k].diagnostico = diag[k];
      const a = R.rA, b = R.rB, bat = S.bat;
      const cadA = campos.A, pvA = cadA.p;
      const inv101 = { estado: a.estado, modo: S.easun.modo, pvV: a.pvV, pvI: cadA.i, pvP: pvA, bateriaP: a.bateriaP, redP: a.redP, cargaP: a.cargaP, temperaturaC: a.temperaturaC, eficiencia: a.eficiencia, etapaCarga: a.etapaCarga,
        alarma: a.alarma, leds: a.leds, encendido: S.easun.encendido, fuente: a.fuente, comunicacion: !motor.hay('COMUNICACION_PERDIDA_EASUN'), bateriaAgotada: a.bateriaAgotada, reduccion: a.derate,
        mpptActivo: !!a.mpptActivo, solDormido: !a.mpptActivo, arrancando: !!a.arrancando, limiteCargaA: a.limiteCargaA, dormido: false };
      const inv201 = { estado: b.estado, mppt: b.mppt.map(m => ({ v: m.v, i: m.i, p: m.p, activo: m.activo })), acP: b.acP, acV: b.acV, acF: b.acF, vertidoP: R.top.redEnCuadro ? -R.pRed : 0, temperaturaC: b.temperaturaC,
        eficiencia: b.eficiencia, aislamientoMohm: b.aislamientoMohm, leds: b.leds, alarma: b.alarma, segundosParaConexion: b.segundosParaConexion, encendido: S.zcs.encendido, dormido: !!b.dormido, reduccion: b.derate };
      const kwhProd = S.energia.prodA + S.energia.prodB, auto = Math.max(0, kwhProd - S.red.energiaExportadaWh);
      Object.assign(estado, {
        t: S.t,
        reloj: { diaAnio: S.dia, horaSolar: S.hora, texto: Sol.textoReloj(S.dia, S.hora), esDia: R.pos.esDia },
        sol: { alturaGrados: R.pos.alturaGrados, azimutGrados: R.pos.azimutGrados },
        ambiente: { ghWm2: R.cielo.gh, nubosidad: R.nEf, temperaturaAmbienteC: R.tAmb, suciedad: { A: R.suc.A, B: R.suc.B }, temperaturaCasetaC: S.tCaseta },
        campos,
        inversores: { 'INV-101': inv101, 'INV-201': inv201 },
        bateria: { tag: 'BAT-101', soc01: bat.soc01, v: bat.v, vCeldaMin: bat.vCeldaMin, vCeldaMax: bat.vCeldaMax, i: bat.i, p: bat.v * bat.i, temperaturaC: bat.tC, bms: bat.bms, energiaWh: bat.energiaWh(),
          socMinUtilPct: layout.BATERIA.socMinUtilPct, energiaUtilWh: bat.energiaUtilWh(), vReposoV: bat.ocvReposo(), limiteCargaA: bat.limiteCargaA(), celdasV: celdasV() },
        red: { disponible: R.redDisp, v: R.vRed, f: R.fRed, p: R.pRed, energiaImportadaWh: S.red.energiaImportadaWh, energiaExportadaWh: S.red.energiaExportadaWh },
        cargas: { 'LOAD-301': { w: R.cons301, manual: S.cargas.esManual('LOAD-301'), demandaW: R.dem301, alimentada: R.top.cargas301Energizadas },
          'LOAD-302': { w: R.serv302, manual: S.cargas.esManual('LOAD-302'), demandaW: R.dem302, alimentada: a.alimentada } },
        protecciones: S.prot.estadoPublico(),
        energia: { produccionAWh: S.energia.prodA, produccionBWh: S.energia.prodB, consumoWh: S.energia.consumo, autoconsumoPct: kwhProd > 1 ? limitar(100 * auto / kwhProd, 0, 100) : 0, ahorroEuros: auto / 1000 * C.TARIFA_EUR_KWH },
        alarmas: [], averiasActivas: motor.activas(),
      });
      estado.alarmas = alarmasActuales(R);
      medidasCache = null;
    }

    function avanzar(dtS) {
      let resto = Math.max(0, Number(dtS) || 0);
      if (resto === 0) { micro(0); }
      while (resto > 1e-9) { const d = Math.min(PASO_MAX_S, resto); micro(d); resto -= d; }
      publicar();
    }
    const refrescar = () => { mppSucio = true; micro(0); publicar(); };

    const sim = { estado, motor, ordenes: null };
    sim.paso = dt => { avanzar(dt); return estado; };
    sim.reiniciar = function (opts) {
      motor.limpiar();
      Object.assign(inicio, opts || {});
      construir(inicio);
      for (const k of Object.keys(estado)) delete estado[k];
      refrescar();
      return estado;
    };

    sim.ordenes = {
      reloj: { poner({ diaAnio, horaSolar } = {}) {
        if (Number.isFinite(diaAnio)) S.dia = Sol.diaValido(diaAnio);
        if (Number.isFinite(horaSolar)) S.hora = ((horaSolar % 24) + 24) % 24;
        S.easun.seg.tBarrido = Infinity; for (const q of S.zcs.segs) q.tBarrido = Infinity; S.zcs.tPotCheck = 1e9; S.histG.length = 0;
        refrescar();
      } },
      ambiente: {
        poner({ nubosidad, temperaturaAmbienteC, suciedadA, suciedadB } = {}) {
          if (Number.isFinite(nubosidad)) S.nubOrden = limitar(nubosidad, 0, 1);
          if (temperaturaAmbienteC === null) S.tAmbOrden = null; else if (Number.isFinite(temperaturaAmbienteC)) S.tAmbOrden = temperaturaAmbienteC;
          if (Number.isFinite(suciedadA)) S.suciedad.A = limitar(suciedadA, 0, 1);
          if (Number.isFinite(suciedadB)) S.suciedad.B = limitar(suciedadB, 0, 1);
          refrescar();
        },
        sombra(tag, valor01) { S.sombras[tag] = limitar(Number(valor01) || 0, 0, 1); refrescar(); },
      },
      protecciones: {
        cerrar(tag) { const antes = S.prot.estadoDe(tag); const ok = S.prot.cerrar(tag); if (antes === 'DISPARADO') retirarAveriaDe(tag); refrescar(); return ok; },
        abrir(tag) { const ok = S.prot.abrir(tag); refrescar(); return ok; },
        rearmar(tag) { const ok = S.prot.rearmar(tag); if (ok) retirarAveriaDe(tag); refrescar(); return ok; },
      },
      red: { disponible(v) { S.red.disponible = !!v; refrescar(); }, tension(v) { if (Number.isFinite(v)) S.red.tensionV = limitar(v, 0, 300); refrescar(); } },
      cargas: { poner(tag, w) { S.cargas.poner(tag, w); refrescar(); } },
      inversor: {
        modoEasun(m) { if (MODOS_EASUN.includes(m)) { S.easun.modo = m; refrescar(); } },
        encender(tag, v) { if (tag === 'INV-101') S.easun.encendido = !!v; else if (tag === 'INV-201') S.zcs.encendido = !!v; refrescar(); },
      },
      bateria: { socInicial(pct) {
        if (!Number.isFinite(pct)) return;
        S.bat.soc01 = limitar(pct / 100, 0, 1); S.bat.bms = 'OK'; S.bat.tCorteS = 0; S.bat.pol = 0;
        S.easun.ciclo = 'CC'; S.easun.bateriaAgotada = false; S.easun.vBat = S.bat.ocv();
        refrescar();
      } },
      averias: {
        activar(id, parametros) { const ok = motor.activar(id, parametros); refrescar(); return ok; },
        desactivar(id) { const ok = motor.desactivar(id); refrescar(); return ok; },
        activas: () => motor.activas(),
        limpiar() { motor.limpiar(); refrescar(); },
      },
    };
    function retirarAveriaDe(tag) { for (const [id, e] of Object.entries(ESTADO_AVERIA)) if (e[0] === tag && motor.hay(id)) motor.desactivar(id); }

    /** Ejecuta fn con la cadena tal como la ve un instrumento conectado en sus bornes (antes del fusible): solo está abierta si lo está físicamente. */
    function enBornes(id, fn) {
      const cad = S.cadenas[id], antes = cad.abierta;
      cad.abierta = !!S.res.abiertaFisica[id];
      try { return fn(cad); } finally { cad.abierta = antes; }
    }
    const nPuntos = n => Math.max(4, Math.floor(Number(n) || 60));
    sim.curvaIV = (id, puntos = 60) => (S.cadenas[id] ? enBornes(id, cad => cad.curva(nPuntos(puntos))) : []);
    /** Curva esperada por el datasheet a la irradiancia y temperatura de célula de ahora, sin sombras, suciedad ni averías. */
    sim.curvaIVReferencia = (id, puntos = 60) => (S.cadenas[id] ? referenciaAlDia(id).curva(nPuntos(puntos)) : []);
    /** ¿Ha variado la irradiancia del plano menos de un 3 % en el último medio minuto? */
    function luzEstable(k) {
      const h = S.histG.filter(x => x.t >= S.t - 30).map(x => x[k]).concat([S.res.planos[k].g]);
      const max = Math.max(...h), min = Math.min(...h);
      return max <= 0 || (max - min) / max <= 0.03;
    }
    /**
     * Resumen del trazador de curvas I-V (IEC 62446-1): lo medido en bornes de la cadena frente a lo esperado por el datasheet con la luz y temperatura de ahora.
     * escalones = nº de escalones de la curva (diodos de paso que entran a conducir porque una subcadena da menos corriente que las demás).
     */
    sim.resumenIV = id => {
      const cad = S.cadenas[id];
      if (!cad) return { ok: false, texto: 'Cadena desconocida' };
      const k = campoDe(id), g = S.res.planos[k].g, abierta = !!S.res.abiertaFisica[id], ref = referenciaAlDia(id);
      const esp = ref.mpp(), vocEsperada = ref.voc(), iscEsperada = ref.iDeV(0);
      const m = enBornes(id, c => (abierta ? { voc: 0, isc: 0, mp: { v: 0, i: 0, p: 0 } } : { voc: c.voc(), isc: c.iDeV(0), mp: c.mpp() }));
      // Escalones: niveles distintos de corriente de las subcadenas con el diodo de paso sano (saltos de más del 6 % del máximo)
      let escalones = 0;
      if (!abierta && cad.iscMax > 0) {
        const niveles = [];
        for (const p of cad.paneles) for (let j = 0; j < 3; j++) if (p.diodos[j] === 'ok') niveles.push(p.subs[j].isc);
        niveles.sort((x, y) => y - x);
        for (let j = 1; j < niveles.length; j++) if (niveles[j - 1] - niveles[j] > 0.06 * cad.iscMax) escalones++;
      }
      const pct = (x, r) => (r > 1e-6 ? 100 * (x / r - 1) : 0);
      const ff = (p, v, i) => (v > 1 && i > 0.01 ? p / (v * i) : 0);
      const estable = luzEstable(k), valida = g >= 400 && estable && !abierta;
      const r = { ok: true, voc: m.voc, isc: m.isc, vmpp: m.mp.v, impp: m.mp.i, pmpp: m.mp.p, factorForma: ff(m.mp.p, m.voc, m.isc),
        vocEsperada, iscEsperada, pmppEsperada: esp.p, factorFormaEsperado: ff(esp.p, vocEsperada, iscEsperada),
        desviacionPct: pct(m.mp.p, esp.p), desviacionVocPct: pct(m.voc, vocEsperada), desviacionIscPct: pct(m.isc, iscEsperada), escalones,
        irradianciaWm2: g, temperaturaCelulaC: cad.paneles.reduce((s, p) => s + p.tc, 0) / cad.paneles.length, estable, valida, abierta, texto: '' };
      if (abierta) r.texto = 'Sin curva: la cadena no tiene continuidad (0 V y 0 A en sus bornes)';
      else if (g < 400) r.texto = `Medida no válida: irradiancia de ${g.toFixed(0)} W/m² (la norma pide al menos 400 W/m²)`;
      else if (!estable) r.texto = 'Medida no válida: la irradiancia está cambiando (espera a que se estabilice)';
      else r.texto = `Pmáx ${r.pmpp.toFixed(0)} W frente a ${esp.p.toFixed(0)} W esperados (${r.desviacionPct >= 0 ? '+' : ''}${r.desviacionPct.toFixed(1)} %)${escalones ? ` · ${escalones} escalón${escalones > 1 ? 'es' : ''} por diodos de paso` : ''}`;
      return r;
    };

    function ctxMedidas() {
      const R = S.res;
      return { estado, prot: S.prot, top: R.top, abiertaFisica: R.abiertaFisica, redOk: R.redDisp, vRed: R.vRed, temperaturaConectorC: S.tConectorC, temperaturaCasetaC: S.tCaseta,
        celdasV: estado.bateria.celdasV, rConectorOhm: motor.hay('CONECTOR_RESISTIVO_B2') ? motor.parametro('CONECTOR_RESISTIVO_B2', 'resistenciaOhm', 1) : 0,
        fugaB: motor.hay('FALLO_AISLAMIENTO_B'), diodos: R.diodos, gPlano: { A: R.planos.A.g, B: R.planos.B.g }, tAmb: R.tAmb, ventilacionTapada: motor.hay('VENTILACION_TAPADA') };
    }
    const instrumentos = () => Medidas.crearMedidas(ctxMedidas());
    sim.medir = (a, b) => instrumentos().medir(a, b);
    sim.continuidad = (a, b) => instrumentos().continuidad(a, b);
    sim.potencial = n => instrumentos().potencial(n);
    sim.resistencia = (a, b) => instrumentos().resistencia(a, b);
    sim.corriente = id => instrumentos().corriente(id);
    sim.termografia = () => instrumentos().termografia();
    sim.conductores = Medidas.CONDUCTORES;
    /**
     * Megóhmetro (IEC 62446-1): aislamiento a tierra de un polo de una cadena ('STR-201.+', 'STR-201.-'…) con su seccionador ABIERTO (QS-101 o QS-201).
     * → { ok, mohm, tensionPruebaV, minimoMohm, correcto, texto }. Sano: decenas de MΩ (algo menos con humedad —cielo cubierto, noche— y con los paneles calientes);
     * con FALLO_AISLAMIENTO_B los dos polos de STR-201 bajan a centésimas de MΩ (el ZCS no conecta por debajo de 0,5 MΩ).
     * Forma antigua, sin polo ('STR-201'): los dos polos unidos, valor nominal y sin exigir el seccionador (se conserva por compatibilidad).
     */
    sim.aislamiento = tag => {
      const m = /^(STR-\d+)(?:\.([+-]))?$/.exec(String(tag)), cadena = m && m[1], polo = m && m[2], sano = cadena && C.AISLAMIENTO_CADENA_MOHM[cadena];
      if (!sano) return { ok: false, mohm: 0, texto: 'Punto de medida desconocido' };
      const k = campoDe(cadena), qs = k === 'A' ? 'QS-101' : 'QS-201';
      const tensionPruebaV = k === 'A' ? 250 : 500, minimoMohm = k === 'A' ? 0.5 : 1;       // tabla de IEC 62446-1 según la Voc del campo (< 120 V / 120–500 V)
      const falla = cadena === 'STR-201' && motor.hay('FALLO_AISLAMIENTO_B');
      let mohm;
      if (!polo) mohm = falla ? C.ZCS.aislamientoFalloMohm : sano;
      else {
        if (S.prot.conduce(qs)) return { ok: false, mohm: 0, tensionPruebaV, minimoMohm, correcto: false, texto: `Abre el seccionador antes de medir el aislamiento (${qs})` };
        const R = S.res, humedad = limitar(0.6 * R.nEf + (R.pos.esDia ? 0 : 0.4), 0, 1), tc = S.cadenas[cadena].paneles[0].tc;
        const factor = (1 - 0.45 * humedad) * Math.exp(-0.015 * (tc - 25));
        mohm = falla ? C.ZCS.aislamientoFalloMohm * (polo === '-' ? 1.15 : 1) * (1 - 0.3 * humedad) : sano * (polo === '-' ? 2.2 : 2) * factor;
      }
      const limite = polo ? minimoMohm : C.ZCS.aislamientoMinMohm, correcto = mohm >= limite;
      return { ok: true, mohm, tensionPruebaV, minimoMohm, correcto, texto: `${mohm.toFixed(2)} MΩ a tierra (${correcto ? 'correcto' : 'FALLO: por debajo de ' + limite + ' MΩ'})` };
    };
    sim.puntosAislamiento = Object.keys(C.AISLAMIENTO_CADENA_MOHM).flatMap(id => ['+', '-'].map(polo => ({ id: `${id}.${polo}`, cadena: id, seccionador: campoDe(id) === 'A' ? 'QS-101' : 'QS-201',
      descripcion: `${polo === '+' ? 'Positivo' : 'Negativo'} de la cadena ${id} a tierra` })));
    sim.puntos = Medidas.PUNTOS;
    Object.defineProperty(sim, 'medidas', { get() { if (!medidasCache) medidasCache = Medidas.crearMedidas(ctxMedidas()).medidas(); return medidasCache; }, enumerable: true });

    construir(inicio);
    refrescar();
    return sim;
  }

  const api = { crearSimulacion, TEXTOS_ALARMA: TEXTOS, PASO_MAX_S };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { const P = (window.PCT = window.PCT || {}); const fv = (P.fv = P.fv || {}); fv.simulacion = api; fv.crearSimulacion = crearSimulacion; }
})();
