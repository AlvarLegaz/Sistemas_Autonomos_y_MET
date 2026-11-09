/* PCT23 - Secuencia automática DIDÁCTICA (no calibrada, no conectada a equipos).
 * Gobierna los actuadores del modelo (modelo.js) en cinco fases:
 *   arranque -> precalentamiento -> producción -> lavado -> parada
 * Sin dependencias ni acceso a red. La lógica es independiente de la interfaz. */
(function (root) {
  'use strict';
  const modelo = (typeof module !== 'undefined' && module.exports) ? require('./modelo.js') : root.PCT23Modelo;
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  const FASES = Object.freeze(['reposo', 'arranque', 'precalentamiento', 'produccion', 'lavado', 'parada', 'finalizada', 'alarma']);
  const NOMBRES = Object.freeze({
    reposo: 'Reposo', arranque: 'Arranque', precalentamiento: 'Precalentamiento', produccion: 'Producción',
    lavado: 'Lavado', parada: 'Parada ordenada', finalizada: 'Finalizada', alarma: 'Alarma',
  });
  const ORDEN = ['arranque', 'precalentamiento', 'produccion', 'lavado', 'parada'];

  // Modos de regulación del calefactor: los que cita el manual de la PCT23 (operación manual, ajuste de potencia,
  // conexiones ON/OFF, lazos simples, cascada y lazos múltiples). Las consignas y ganancias son supuestos didácticos.
  const MODOS = Object.freeze([
    { id: 'manual', nombre: 'Manual · potencia fija', detalle: 'El calefactor trabaja a la potencia que eliges, como el ajuste de potencia de la consola. T1 y T2 son resultado.', manual: 'p. 6 y 15' },
    { id: 'onoff', nombre: 'Todo/nada sobre T2', detalle: 'El calefactor se conecta y desconecta (entrada ON/OFF) para mantener T2 alrededor de su consigna, con histéresis.', manual: 'p. 14-15' },
    { id: 'T2', nombre: 'Lazo simple sobre T2', detalle: 'Un lazo (PI, sin término derivativo) ajusta la potencia para mantener la temperatura del agua caliente.', manual: 'p. 6 y 10' },
    { id: 'T1', nombre: 'Lazo simple sobre T1', detalle: 'Un lazo (PI) ajusta la potencia para mantener la temperatura del producto a la salida del tubo de residencia.', manual: 'p. 6 y 10' },
    { id: 'cascada', nombre: 'Cascada T1 → T2', detalle: 'El lazo externo de T1 fija la consigna de T2 y el lazo interno de T2 gobierna la potencia.', manual: 'p. 10' },
    { id: 'multiple', nombre: 'Lazos múltiples · T1 y caudal F1', detalle: 'Un lazo de T1 gobierna el calefactor y otro de F1 gobierna la velocidad de N1.', manual: 'p. 10' },
  ]);

  // Los valores por defecto son supuestos didácticos: el manual no da consignas.
  const CONFIG_BASE = Object.freeze({
    // Modo de regulación del calefactor (todos son supuestos didácticos; el manual solo da un ajuste de potencia):
    //   'manual', 'onoff', 'T2', 'T1', 'cascada', 'multiple': ver MODOS.
    modoControl: 'T1',
    consignaT1: 45,            // °C a la salida del tubo de residencia (en todos los modos: mínima para no desviar)
    consignaT2: 55,            // °C del agua caliente (modo 'T2')
    potenciaManualPct: 90,     // % del calefactor (modo 'manual')
    histeresisT2C: 2,          // banda del modo todo/nada
    consignaF1: 275,           // ml/min (modo 'multiple')
    toleranciaDesvioC: 2,      // se desvía el producto si T1 < consigna - tolerancia
    histeresisC: 0.5,          // vuelve a producto acabado cuando T1 >= consigna - histeresis
    origen: 'A',               // tanque de alimentación
    caudalPct: 50,             // PWM de N1 en proceso (%)
    volumenObjetivoMl: null,   // opcional: producto acabado tras el que termina la producción (por defecto no hay objetivo)
    volumenAgotadoMl: 2,       // la producción sigue hasta que el tanque de origen se agota (≤ este volumen) o el usuario la termina
    estabilizacionS: 30,       // T1 en banda durante este tiempo para pasar a producción
    arranqueS: 5,
    lavadoS: 120,
    potenciaPrecalentamientoPct: 90,
    potenciaMaxPct: 90,        // no se llega al 100 % para no rozar el corte térmico
    enfriarHastaC: 45,         // N2 sigue en la parada hasta que T2 baje de aquí
    tiempoMaxPrecalentamientoS: 3600,
    volumenMinimoMl: 200,      // mínimo en el tanque de origen para arrancar
    kp: 2, ki: 0.01,           // corrección PI sobre la potencia (además de la acción directa)
    kpExterno: 1, kiExterno: 0.002,   // lazo externo de la cascada (T1 -> consigna de T2)
    t2Max: 65,                 // tope de la consigna de T2 (el termostato real salta a 70 °C)
  });

  /** T1 que el modelo da en régimen con esa configuración (para avisar de consignas imposibles). */
  function t1Estacionaria(cfg) {
    const p = modelo.PARAMS;
    const caudalPct = cfg.modoControl === 'multiple' ? clamp(cfg.consignaF1 / p.caudalN1MaxMlMin * 100, 0, 100) : cfg.caudalPct;
    const eficiencia = p.eficienciaIntercambio * (1 - p.reduccionPorCaudal * caudalPct / 100);
    const k = modelo.factorAcoplamiento(true, caudalPct, caudalPct / 100);
    const t2Maximo = Math.min(cfg.t2Max, p.ambiente + p.deltaCalentadorC * cfg.potenciaMaxPct / 100 / (1 + k));
    let t2;
    if (cfg.modoControl === 'manual') t2 = Math.min(cfg.t2Max, p.ambiente + p.deltaCalentadorC * clamp(cfg.potenciaManualPct, 0, cfg.potenciaMaxPct) / 100 / (1 + k));
    else if (cfg.modoControl === 'T2' || cfg.modoControl === 'onoff') t2 = Math.min(cfg.consignaT2, t2Maximo);
    else t2 = t2Maximo;                                     // 'T1', 'cascada' y 'multiple': hasta el tope de potencia
    const t1 = p.ambiente + (t2 - p.ambiente) * eficiencia;
    return (cfg.modoControl === 'T1' || cfg.modoControl === 'cascada' || cfg.modoControl === 'multiple') ? Math.min(t1, cfg.consignaT1) : t1;
  }

  /** T1 máxima que el modelo puede dar con ese caudal y potencia (para avisar de consignas imposibles). */
  function t1Alcanzable(caudalPct, potenciaPct) {
    const p = modelo.PARAMS;
    const k = modelo.factorAcoplamiento(true, caudalPct, caudalPct / 100);
    const agua = Math.min(CONFIG_BASE.t2Max, p.ambiente + p.deltaCalentadorC * clamp(potenciaPct, 0, 100) / 100 / (1 + k));
    const eficiencia = p.eficienciaIntercambio * (1 - p.reduccionPorCaudal * clamp(caudalPct, 0, 100) / 100);
    return p.ambiente + (agua - p.ambiente) * eficiencia;
  }

  // Modo demostración: el usuario solo marca la temperatura de T1. El resto lo decide la secuencia:
  // regulación en cascada, el mayor caudal que permita llegar a esa temperatura y producción hasta agotar el tanque.
  const CAUDALES_DEMO = [50, 45, 40, 35, 30, 25, 20];
  const MARGEN_DEMO = 2;            // °C que debe poder superar el modelo para que la consigna sea alcanzable
  function t1MaximaDemostracion() {
    return Math.floor(t1Alcanzable(CAUDALES_DEMO[CAUDALES_DEMO.length - 1], CONFIG_BASE.potenciaMaxPct) - MARGEN_DEMO);
  }
  function configDemostracion(temperaturaC, origen) {
    const t = clamp(Number(temperaturaC) || 0, 30, t1MaximaDemostracion());
    const caudal = CAUDALES_DEMO.find(c => t1Alcanzable(c, CONFIG_BASE.potenciaMaxPct) >= t + MARGEN_DEMO) || CAUDALES_DEMO[CAUDALES_DEMO.length - 1];
    return { modoControl: 'cascada', origen: origen === 'B' ? 'B' : 'A', consignaT1: t, caudalPct: caudal };
  }

  function crearSecuencia(config) {
    return {
      fase: 'reposo', tFase: 0, tTotal: 0, cfg: Object.assign({}, CONFIG_BASE, config || {}),
      integral: 0, integral2: 0, integralT1: 0, integralF1: 0, enBanda: 0, resOn: true, consignaT2Activa: null, desviando: true, estable: 0, finalInicialMl: 0, tiempoDesvioS: 0,
      alarma: null, motivo: '', eventos: [],
    };
  }

  function evento(sec, estado, mensaje) { sec.eventos.push({ t: estado.tiempo, mensaje }); }

  function apagarTodo(estado) {
    for (const k of modelo.OUTPUT_IDS) estado.salidas[k] = false;
    estado.giro.N1 = false; estado.giro.N2 = false;
  }

  function cambiarFase(sec, estado, fase, motivo) {
    sec.fase = fase; sec.tFase = 0; sec.estable = 0; sec.motivo = motivo || '';
    evento(sec, estado, `Fase: ${NOMBRES[fase]}${motivo ? ' · ' + motivo : ''}`);
  }

  function dispararAlarma(sec, estado, causa, accion) {
    sec.alarma = { causa, accion };
    // Acción de seguridad inmediata: sin calentamiento ni producto; N2 sigue para enfriar el agua.
    estado.salidas.RES = false; estado.consignas.R = 0;
    estado.salidas.N1 = false; estado.salidas.SOL1 = true; estado.salidas.SOL3 = false;
    cambiarFase(sec, estado, 'alarma', causa);
  }

  function volumenOrigen(estado, sec) { return sec.cfg.origen === 'B' ? estado.bMl : estado.aMl; }

  /** Producción de referencia máxima: lo que hay ahora en el tanque de origen (nunca más que su capacidad). */
  function referenciaMaxima(estado, origen) {
    const v = origen === 'B' ? estado.bMl : estado.aMl;
    return Math.floor(Math.min(v, modelo.PARAMS.capacidadMl));
  }

  /** Pone en marcha la secuencia. Devuelve false (y deja un evento) si no se dan las condiciones. */
  function iniciar(sec, estado) {
    if (!['reposo', 'finalizada'].includes(sec.fase)) return false;
    sec.alarma = null; sec.integral = 0; sec.integral2 = 0; sec.integralT1 = 0; sec.integralF1 = 0; sec.enBanda = 0; sec.resOn = true; sec.consignaT2Activa = null; sec.tTotal = 0; sec.tiempoDesvioS = 0; sec.desviando = true;
    if (estado.temperaturaCorte) {
      dispararAlarma(sec, estado, 'Corte térmico activo: no se puede arrancar', 'Esperar a que T2 baje y reconocer la alarma');
      return false;
    }
    if (volumenOrigen(estado, sec) < sec.cfg.volumenMinimoMl) {
      dispararAlarma(sec, estado, `Tanque ${sec.cfg.origen} casi vacío`, `Rellenar el tanque (SOL${sec.cfg.origen === 'A' ? 4 : 5}) o cambiar de origen`);
      return false;
    }
    // La producción de referencia no puede superar lo que hay en el tanque de origen.
    const maxRef = referenciaMaxima(estado, sec.cfg.origen);
    if (sec.cfg.volumenObjetivoMl != null && sec.cfg.volumenObjetivoMl > maxRef) {
      evento(sec, estado, `Producción de referencia limitada a ${maxRef} ml (lo que hay en el tanque ${sec.cfg.origen})`);
      sec.cfg.volumenObjetivoMl = maxRef;
    }
    cambiarFase(sec, estado, 'arranque');
    return true;
  }

  function ordenarParada(sec, estado) {
    if (['arranque', 'precalentamiento', 'produccion', 'lavado'].includes(sec.fase)) cambiarFase(sec, estado, 'parada', 'solicitada');
  }

  function emergencia(sec, estado) {
    apagarTodo(estado); estado.consignas.R = 0;
    sec.alarma = { causa: 'Parada de emergencia', accion: 'Revisar la planta y reconocer la alarma' };
    cambiarFase(sec, estado, 'alarma', 'emergencia');
  }

  /** Reconoce la alarma: si quedaba proceso en marcha pasa a parada ordenada; tras emergencia, a reposo. */
  function reconocer(sec, estado) {
    if (sec.fase !== 'alarma') return;
    const eraEmergencia = sec.alarma && sec.alarma.causa === 'Parada de emergencia';
    sec.alarma = null;
    cambiarFase(sec, estado, eraEmergencia ? 'reposo' : 'parada', 'alarma reconocida');
  }

  /** Termina la producción cuando el usuario lo decide y pasa al lavado. */
  function terminarProduccion(sec, estado) {
    if (sec.fase === 'produccion') cambiarFase(sec, estado, 'lavado', 'producción terminada a mano');
  }

  function saltarFase(sec, estado) {
    const i = ORDEN.indexOf(sec.fase);
    if (i >= 0 && i < ORDEN.length - 1) cambiarFase(sec, estado, ORDEN[i + 1], 'forzado');
  }

  const eficienciaActual = estado => modelo.PARAMS.eficienciaIntercambio * (1 - modelo.PARAMS.reduccionPorCaudal * estado.consignas.N1V / 100);
  // Potencia que mantiene T2 en t2 con el caudal actual: hay que compensar el calor que se lleva el producto.
  const potenciaParaAgua = (t2, estado) => {
    const k = modelo.factorAcoplamiento(true, estado.consignas.N1V, estado.consignas.N1V / 100);
    return (t2 - modelo.PARAMS.ambiente) * (1 + k) / modelo.PARAMS.deltaCalentadorC * 100;
  };

  /** Lazo sobre T2: acción directa (agua necesaria -> potencia) más corrección PI. */
  function lazoT2(sec, estado, dt, consigna) {
    const c = sec.cfg;
    const error = consigna - estado.aguaCalienteC;
    if (Math.abs(error) < 5) sec.integral2 = clamp(sec.integral2 + error * dt, -2000, 2000);   // sin windup lejos de la consigna
    return clamp(potenciaParaAgua(consigna, estado) + c.kp * error + c.ki * sec.integral2, 0, c.potenciaMaxPct);
  }

  /** Lazo sobre T1 (acción directa + PI sobre la potencia). */
  function lazoT1(sec, estado, dt) {
    const p = modelo.PARAMS, c = sec.cfg;
    const aguaNecesaria = p.ambiente + (c.consignaT1 - p.ambiente) / eficienciaActual(estado);
    const error = c.consignaT1 - estado.t1;
    if (Math.abs(error) < 5) sec.integral = clamp(sec.integral + error * dt, -2000, 2000);
    return clamp(potenciaParaAgua(aguaNecesaria, estado) + c.kp * error + c.ki * sec.integral, 0, c.potenciaMaxPct);
  }

  /** Cascada: el lazo externo de T1 da la consigna de T2 y el interno la sigue con la potencia. */
  function lazoCascada(sec, estado, dt) {
    const p = modelo.PARAMS, c = sec.cfg;
    const t2Necesaria = p.ambiente + (c.consignaT1 - p.ambiente) / eficienciaActual(estado);
    const error = c.consignaT1 - estado.t1;
    if (Math.abs(error) < 5) sec.integralT1 = clamp(sec.integralT1 + error * dt, -5000, 5000);
    sec.consignaT2Activa = clamp(t2Necesaria + c.kpExterno * error + c.kiExterno * sec.integralT1, p.ambiente + 5, c.t2Max);
    return lazoT2(sec, estado, dt, sec.consignaT2Activa);
  }

  /** Lazo de caudal: N1 (PWM) para que F1 siga su consigna (acción directa + PI). */
  function lazoCaudal(sec, estado, dt) {
    const p = modelo.PARAMS, c = sec.cfg;
    const error = c.consignaF1 - estado.caudalProductoMlMin;
    if (Math.abs(error) < 100) sec.integralF1 = clamp(sec.integralF1 + error * dt, -5000, 5000);
    const directa = c.consignaF1 / p.caudalN1MaxMlMin * 100;
    return clamp(directa + 0.02 * error + 0.002 * sec.integralF1, 10, 100);
  }

  /** Fija caudal, estado y potencia del calefactor según el modo de regulación elegido. */
  function regular(sec, estado, dt, fase) {
    const c = sec.cfg;
    estado.salidas.N1 = true;
    estado.consignas.N1V = c.modoControl === 'multiple' ? lazoCaudal(sec, estado, dt) : c.caudalPct;
    estado.salidas.RES = true;
    switch (c.modoControl) {
      case 'manual': estado.consignas.R = clamp(c.potenciaManualPct, 0, c.potenciaMaxPct); break;
      case 'onoff':
        // conexión ON/OFF con histéresis: potencia fija al tope y el calefactor se conecta y desconecta
        if (estado.aguaCalienteC <= c.consignaT2 - c.histeresisT2C) sec.resOn = true;
        else if (estado.aguaCalienteC >= c.consignaT2 + c.histeresisT2C) sec.resOn = false;
        estado.consignas.R = c.potenciaMaxPct; estado.salidas.RES = sec.resOn; break;
      case 'T2': estado.consignas.R = lazoT2(sec, estado, dt, c.consignaT2); break;
      case 'cascada': estado.consignas.R = lazoCascada(sec, estado, dt); break;
      default: // 'T1' y 'multiple'
        estado.consignas.R = fase === 'precalentamiento' ? c.potenciaPrecalentamientoPct : lazoT1(sec, estado, dt);
    }
    // Protección: el termostato real salta a 70 °C; el control corta la resistencia al llegar a t2Max y la reconecta 3 °C por debajo.
    if (estado.aguaCalienteC >= c.t2Max) sec.t2Limitada = true; else if (estado.aguaCalienteC <= c.t2Max - 3) sec.t2Limitada = false;
    if (sec.t2Limitada) estado.salidas.RES = false;
  }

  function fijarSalidasComunes(sec, estado) {
    estado.salidas.SOL2 = sec.cfg.origen === 'B';
    estado.salidas.SOL4 = false; estado.salidas.SOL5 = false;
    estado.giro.N1 = false; estado.giro.N2 = false;
    estado.consignas.N2V = 100;
  }

  /** Decide los actuadores de este instante (se llama antes de avanzar el modelo). */
  function controlar(sec, estado, dt) {
    const c = sec.cfg;
    if (['reposo', 'finalizada', 'alarma'].includes(sec.fase)) {
      if (sec.fase === 'alarma') { estado.salidas.RES = false; estado.consignas.R = 0; }
      return;
    }
    // Protecciones comunes a todas las fases con proceso.
    if (sec.fase !== 'parada') {
      if (estado.temperaturaCorte) return dispararAlarma(sec, estado, 'Corte térmico (sobretemperatura del agua caliente)', 'Dejar enfriar T2; reconocer la alarma y repetir el arranque');
      if (estado.vacio && sec.fase !== 'lavado') return dispararAlarma(sec, estado, `Tanque ${c.origen} vacío: N1 sin producto`, `Rellenar el tanque (SOL${c.origen === 'A' ? 4 : 5}) y reconocer la alarma`);
    }
    fijarSalidasComunes(sec, estado);

    switch (sec.fase) {
      case 'arranque':
        estado.salidas.N2 = true; estado.salidas.RES = true;
        estado.consignas.R = c.potenciaPrecalentamientoPct;
        estado.salidas.N1 = false; estado.salidas.SOL1 = true; estado.salidas.SOL3 = false;
        if (sec.tFase >= c.arranqueS) cambiarFase(sec, estado, 'precalentamiento', 'N2 y calefactor en marcha');
        break;
      case 'precalentamiento':
        estado.salidas.N2 = true;
        regular(sec, estado, dt, 'precalentamiento');
        estado.salidas.SOL1 = true;          // producto rechazado: recircula al tanque
        estado.salidas.SOL3 = true;          // el agua fría ya circula: la refrigeración está estable cuando SOL1 deje pasar producto
        sec.estable = estado.t1 >= c.consignaT1 - 1 ? sec.estable + dt : 0;
        if (sec.estable >= c.estabilizacionS) {
          sec.finalInicialMl = estado.finalMl; sec.desviando = true; sec.enBanda = 0;
          if (c.modoControl === 'T1' || c.modoControl === 'multiple') sec.integral = 0;
          cambiarFase(sec, estado, 'produccion', `T1 = ${estado.t1.toFixed(1)} °C`);
        } else if (sec.tFase >= c.tiempoMaxPrecalentamientoS) {
          dispararAlarma(sec, estado, `T1 no alcanza ${c.consignaT1} °C en ${Math.round(c.tiempoMaxPrecalentamientoS / 60)} min`, 'Bajar la consigna o el caudal; el modelo no llega a esa temperatura');
        }
        break;
      case 'produccion': {
        estado.salidas.N2 = true;
        regular(sec, estado, dt, 'produccion');
        estado.salidas.SOL3 = true;
        // SOL1: desvía el producto en cuanto T1 baja de la tolerancia (inmediato, es la parte de seguridad); para volver a
        // la salida normal exige T1 en banda durante estabilizacionS segundos seguidos, y así no abre y cierra en cada pico.
        sec.enBanda = estado.t1 >= c.consignaT1 - c.histeresisC ? sec.enBanda + dt : 0;
        if (estado.t1 < c.consignaT1 - c.toleranciaDesvioC) sec.desviando = true;
        else if (sec.desviando && sec.enBanda >= c.estabilizacionS) sec.desviando = false;
        if (sec.desviando !== estado.salidas.SOL1) {
          evento(sec, estado, sec.desviando ? `Producto desviado (T1 = ${estado.t1.toFixed(1)} °C)` : `Producto a temperatura: salida normal (T1 = ${estado.t1.toFixed(1)} °C)`);
        }
        estado.salidas.SOL1 = sec.desviando;
        if (sec.desviando) sec.tiempoDesvioS += dt;
        const producido = estado.finalMl - sec.finalInicialMl;
        if (c.volumenObjetivoMl != null && producido >= c.volumenObjetivoMl) cambiarFase(sec, estado, 'lavado', `producción de referencia alcanzada: ${Math.round(producido)} ml de producto acabado`);
        else if (volumenOrigen(estado, sec) <= c.volumenAgotadoMl) cambiarFase(sec, estado, 'lavado', `tanque ${c.origen} agotado · ${Math.round(producido)} ml de producto acabado`);
        break;
      }
      case 'lavado':
        // Simplificación: el modelo no tiene otro fluido; se recircula con agua caliente y SOL1 activa.
        estado.salidas.N2 = true; estado.salidas.RES = true; estado.consignas.R = 50;
        estado.salidas.N1 = true; estado.consignas.N1V = 100;
        estado.salidas.SOL1 = true; estado.salidas.SOL3 = false;
        if (sec.tFase >= c.lavadoS) cambiarFase(sec, estado, 'parada', 'lavado terminado');
        break;
      case 'parada':
        estado.salidas.RES = false; estado.consignas.R = 0;
        estado.salidas.N1 = false; estado.salidas.SOL1 = false; estado.salidas.SOL3 = false;
        estado.salidas.N2 = estado.aguaCalienteC > c.enfriarHastaC;   // N2 enfría el calefactor
        if (!estado.salidas.N2) cambiarFase(sec, estado, 'finalizada', `T2 = ${estado.aguaCalienteC.toFixed(1)} °C`);
        break;
    }
  }

  /** Un paso completo: controla, avanza el modelo y cuenta el tiempo. */
  function paso(sec, estado, dt) {
    controlar(sec, estado, dt);
    modelo.avanzar(estado, dt);
    if (!['reposo', 'finalizada', 'alarma'].includes(sec.fase)) { sec.tFase += dt; sec.tTotal += dt; }
  }

  const api = Object.freeze({ configDemostracion, t1MaximaDemostracion, MODOS, FASES, NOMBRES, ORDEN, CONFIG_BASE, crearSecuencia, iniciar, ordenarParada, emergencia,
    reconocer, saltarFase, terminarProduccion, referenciaMaxima, controlar, paso, t1Alcanzable, t1Estacionaria, volumenOrigen });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PCT23Secuencia = api;
})(typeof window !== 'undefined' ? window : globalThis);
