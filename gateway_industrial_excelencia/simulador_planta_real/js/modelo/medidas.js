// Puntos de medida del multímetro y del osciloscopio virtuales. Función pura medir(instrumento, puntoA, puntoB, modo, estado): lo que se mide
// depende del estado de la planta y de las averías activas, así que el alumno puede diagnosticar de verdad (0 mA, 24 V antes y después del fusible…).
// La interfaz solo dibuja lo que devuelve. Modos del multímetro: 'V' (tensión), 'mA' (corriente EN SERIE), 'ohm', 'continuidad', 'temperatura', 'presion'.
(function () {
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.htstLayout;
  const { CONSTANTES: C } = typeof require !== 'undefined' ? require('../configuracion/constantes.js') : PCT.htstConstantes;
  const calidad = typeof require !== 'undefined' ? require('../plc/calidad_senal.js') : PCT.htstCalidadSenal;

  const TAGS_AI = layout.SENALES.filter(s => s.tipo === 'AI').map(s => s.tag);
  const TAGS_TT = TAGS_AI.filter(t => t.startsWith('TT-'));
  const CONTACTORES = { 'KM-102': 'P-102', 'KM-103': 'P-103', 'KM-201': 'KM-201', 'KM-202': 'KM-202' };   // contactor → salida DO que lo manda

  /** Lista de puntos de medida con su modo natural, para que la interfaz los muestre. */
  const PUNTOS = [];
  const punto = (id, descripcion, modo) => PUNTOS.push({ id, descripcion, modo });
  for (const t of TAGS_AI) { punto(`${t}:LAZO`, `Lazo 4-20 mA de ${t} (en serie)`, 'mA'); punto(`${t}:+`, `Bornas del transmisor ${t}`, 'V'); punto(`QE-001:AI-${t}`, `Entrada del PLC de ${t}`, 'V'); }
  for (const t of TAGS_TT) punto(`${t}:PT100`, `Resistencia de la sonda Pt100 de ${t}`, 'ohm');
  punto('TT-103:BANO', 'TT-103 en baño patrón a 72 °C', 'temperatura');
  for (const t of TAGS_AI) punto(`${t}:MALLA`, `Malla del cable de ${t} a tierra`, 'continuidad');
  punto('F-201:ENTRADA', 'Fusible F-201, lado fuente', 'V'); punto('F-201:SALIDA', 'Fusible F-201, lado instrumentos', 'V'); punto('F-201:FUSIBLE', 'Continuidad del fusible F-201', 'continuidad');
  punto('PS-001:SALIDA', 'Salida de la fuente de 24 V', 'V');
  for (const k of Object.keys(CONTACTORES)) {
    punto(`${k}:BOBINA`, `Tensión en la bobina de ${k}`, 'V'); punto(`${k}:CARGA`, `Tensión en la carga de ${k}`, 'V');
    punto(`${k}:CONTACTOS`, `Resistencia de los contactos de ${k}`, 'ohm'); punto(`${k}:BOBINA-R`, `Resistencia de la bobina de ${k}`, 'ohm');
  }
  punto('SV-101:BORNAS', 'Tensión en el piloto SV-101', 'V'); punto('SV-101:BOBINA', 'Resistencia de la bobina de SV-101', 'ohm');
  punto('FDV-101:ZS-101', 'Final de carrera ZS-101 (avance)', 'continuidad'); punto('FDV-101:ZS-102', 'Final de carrera ZS-102 (desvío)', 'continuidad');
  punto('FRL-101:MANOMETRO', 'Manómetro de la unidad de aire', 'presion'); punto('PSL-201:CONTACTO', 'Contacto del presostato de aire', 'continuidad');
  punto('VFD-101:DISIPADOR', 'Temperatura del disipador del variador', 'temperatura'); punto('VFD-101:VENTILADOR', 'Alimentación del ventilador del variador', 'V');
  punto('TSH-101:CONTACTO', 'Contacto NC del termostato de seguridad', 'continuidad');
  punto('FLT-101:PRESION-ANTES', 'Presión antes del colador', 'presion'); punto('FLT-101:PRESION-DESPUES', 'Presión después del colador', 'presion');

  const hay = (estado, id, tag) => estado.averiasActivas.some(a => a.id === id && (tag == null || a.tags.includes(tag)));
  const param = (estado, id, nombre, normal) => { const a = estado.averiasActivas.find(x => x.id === id); return a && a.parametros ? a.parametros[nombre] : normal; };
  const ES_CERO = 0.01;

  /** Resultado de un valor numérico: valor, unidad y texto (Infinity = circuito abierto, "OL" en el multímetro). */
  function numero(valor, unidad, extra = {}) {
    const texto = valor === Infinity ? 'OL (circuito abierto)' : `${(Math.round(valor * 100) / 100).toString().replace('.', ',')} ${unidad}`;
    return Object.assign({ ok: true, valor, unidad, texto }, extra);
  }
  const incorrecto = (modo, usar) => ({ ok: false, valor: null, unidad: '', texto: `Modo ${modo} no válido en este punto: usa ${usar}` });

  /** Valor de un punto en el modo del multímetro, o null si el punto no existe. */
  function resolverMultimetro(p, modo, estado) {
    const eq = estado.equipos, alim = estado.alimentacion, v24 = alim.v24, DO = estado.salidasPLC.DO || {};
    const es = eq['ES-001'].rearmado;
    const [parte, resto] = p.split(':');

    if (TAGS_AI.includes(parte) && resto === 'LAZO') return modo === 'mA' ? numero(estado.instrumentos[parte] ? estado.instrumentos[parte].mA : 0, 'mA') : incorrecto(modo, 'mA (el multímetro va en serie con el lazo)');
    if (TAGS_AI.includes(parte) && resto === '+') {
      if (modo !== 'V') return incorrecto(modo, 'V');
      const mA = estado.instrumentos[parte] ? estado.instrumentos[parte].mA : 0;
      const sinAlimentacion = !alim.fusibleF201 || hay(estado, 'AV-LAZO-ABIERTO', parte);
      return numero(sinAlimentacion ? 0 : Math.max(0, v24 - 0.25 * mA - 2), 'V');
    }
    if (parte === 'QE-001' && resto && resto.startsWith('AI-')) return modo === 'V' ? numero(alim.fusibleF201 ? v24 : 0, 'V') : incorrecto(modo, 'V');
    if (TAGS_TT.includes(parte) && resto === 'PT100') {
      if (modo !== 'ohm') return incorrecto(modo, 'ohm (con la sonda desconectada)');
      if (hay(estado, 'AV-PT100-ABIERTA', parte)) return numero(Infinity, 'Ω');
      if (hay(estado, 'AV-PT100-CORTO', parte)) return numero(ES_CERO, 'Ω');
      const T = estado.instrumentos[parte] ? estado.instrumentos[parte].valorProceso : 20;
      return numero(100 * (1 + 0.00385 * T), 'Ω');             // Pt100: 100 Ω a 0 °C, +0,385 Ω por °C
    }
    if (p === 'TT-103:BANO') {
      if (modo !== 'temperatura') return incorrecto(modo, 'temperatura');
      const offset = hay(estado, 'AV-DERIVA-TT103') ? param(estado, 'AV-DERIVA-TT103', 'offsetC', 0) : 0;
      return numero(72, '°C', { lecturaTransmisor: 72 + offset, texto: `Patrón: 72,0 °C · el transmisor lee ${(72 + offset).toFixed(1).replace('.', ',')} °C` });
    }
    if (TAGS_AI.includes(parte) && resto === 'MALLA') {
      if (modo !== 'continuidad') return incorrecto(modo, 'continuidad');
      const sinTierra = hay(estado, 'AV-RUIDO-4-20', parte);          // con ruido, la malla está sin conectar a tierra
      return numero(sinTierra ? Infinity : ES_CERO, 'Ω', { continuidad: !sinTierra });
    }
    if (parte === 'F-201') {
      if (resto === 'ENTRADA') return modo === 'V' ? numero(v24, 'V') : incorrecto(modo, 'V');
      if (resto === 'SALIDA') return modo === 'V' ? numero(alim.fusibleF201 ? v24 : 0, 'V') : incorrecto(modo, 'V');
      if (resto === 'FUSIBLE') return modo === 'continuidad' ? numero(alim.fusibleF201 ? ES_CERO : Infinity, 'Ω', { continuidad: alim.fusibleF201 }) : incorrecto(modo, 'continuidad (con la alimentación cortada)');
    }
    if (p === 'PS-001:SALIDA') return modo === 'V' ? numero(v24, 'V') : incorrecto(modo, 'V');
    if (CONTACTORES[parte]) {
      const orden = es && DO[CONTACTORES[parte]] === 1, cerrado = eq[parte].cerrado;
      if (resto === 'BOBINA') return modo === 'V' ? numero(orden ? 24 : 0, 'V') : incorrecto(modo, 'V');
      if (resto === 'CARGA') return modo === 'V' ? numero(cerrado ? C.electrico.tensionPotenciaV : 0, 'V') : incorrecto(modo, 'V');
      if (resto === 'CONTACTOS') return modo === 'ohm' ? numero(cerrado ? ES_CERO : Infinity, 'Ω') : incorrecto(modo, 'ohm (con la potencia cortada)');
      if (resto === 'BOBINA-R') return modo === 'ohm' ? numero(C.electrico.resistenciaBobinaContactorOhm, 'Ω') : incorrecto(modo, 'ohm (con la bobina desconectada)');
    }
    if (parte === 'SV-101') {
      if (resto === 'BORNAS') return modo === 'V' ? numero(es && DO['SV-101'] === 1 ? 24 : 0, 'V') : incorrecto(modo, 'V');
      if (resto === 'BOBINA') return modo === 'ohm' ? numero(eq['SV-101'].bobinaOhm, 'Ω') : incorrecto(modo, 'ohm (con la bobina desconectada)');
    }
    if (parte === 'FDV-101' && (resto === 'ZS-101' || resto === 'ZS-102')) {
      if (modo !== 'continuidad') return incorrecto(modo, 'continuidad');
      const cierra = resto === 'ZS-101' ? eq['FDV-101'].posicion === 'AVANCE' : eq['FDV-101'].posicion === 'DESVIO';
      return numero(cierra ? ES_CERO : Infinity, 'Ω', { continuidad: cierra });
    }
    if (p === 'FRL-101:MANOMETRO') return modo === 'presion' ? numero(eq['FRL-101'].presionBar, 'bar') : incorrecto(modo, 'presion');
    if (p === 'PSL-201:CONTACTO') return modo === 'continuidad' ? numero(eq['PSL-201'].contactoCerrado ? ES_CERO : Infinity, 'Ω', { continuidad: eq['PSL-201'].contactoCerrado }) : incorrecto(modo, 'continuidad');
    if (p === 'VFD-101:DISIPADOR') return modo === 'temperatura' ? numero(eq['P-101'].temperaturaDisipadorC, '°C') : incorrecto(modo, 'temperatura');
    if (p === 'VFD-101:VENTILADOR') return modo === 'V' ? numero(eq['P-101'].ventiladorOK ? 24 : 0, 'V') : incorrecto(modo, 'V');
    if (p === 'TSH-101:CONTACTO') return modo === 'continuidad' ? numero(eq['TSH-101'].abierto ? Infinity : ES_CERO, 'Ω', { continuidad: !eq['TSH-101'].abierto }) : incorrecto(modo, 'continuidad (en frío y sin tensión)');
    if (parte === 'FLT-101') {
      if (modo !== 'presion') return incorrecto(modo, 'presion');
      const antes = 0.4, despues = estado.proceso.caudalLh > 1 ? 0.38 - 0.3 * eq['FLT-101'].obstruccion01 : 0.4;
      if (resto === 'PRESION-ANTES') return numero(antes, 'bar');
      if (resto === 'PRESION-DESPUES') return numero(despues, 'bar');
    }
    return null;
  }

  /** Forma de onda del osciloscopio: 200 muestras. Devuelve { muestras, unidad, dtMs, texto }. */
  function resolverOsciloscopio(p, estado) {
    const N = 200, DT_MS = 0.1, muestras = [];
    const alim = estado.alimentacion, [parte, resto] = p.split(':');
    const t = estado.tiempoS;
    if (p === 'PS-001:SALIDA') {
      const degradada = alim.v24 < 22, rizado = degradada ? 3 : 0.05, base = alim.v24;
      for (let i = 0; i < N; i++) muestras.push(base + rizado / 2 * Math.sin(2 * Math.PI * 100 * (i * DT_MS / 1000)));     // rizado a 100 Hz (rectificación de 50 Hz)
      return { ok: true, muestras, unidad: 'V', dtMs: DT_MS, texto: degradada ? 'Unos 18 V con rizado grande a 100 Hz' : '24 V casi planos con un rizado pequeño' };
    }
    if (TAGS_AI.includes(parte) && resto === 'LAZO') {
      const inst = estado.instrumentos[parte], mA = inst ? inst.mA : 0, ruidoso = hay(estado, 'AV-RUIDO-4-20', parte);
      const amp = ruidoso ? param(estado, 'AV-RUIDO-4-20', 'amplitudMA', 8) : 0.02;
      for (let i = 0; i < N; i++) muestras.push(mA + amp * (0.6 * Math.sin(2 * Math.PI * 4000 * (i * DT_MS / 1000)) + 0.4 * calidad.ruido(7, t + i * 0.001, i)));
      return { ok: true, muestras, unidad: 'mA', dtMs: DT_MS, texto: ruidoso ? 'Picos grandes a la frecuencia del variador' : 'Línea casi recta' };
    }
    if (p === 'SV-101:BORNAS') {
      const v = estado.salidasPLC.DO && estado.salidasPLC.DO['SV-101'] === 1 && estado.equipos['ES-001'].rearmado ? 24 : 0;
      for (let i = 0; i < N; i++) muestras.push(v);
      return { ok: true, muestras, unidad: 'V', dtMs: DT_MS, texto: v ? '24 V continuos' : '0 V' };
    }
    return null;
  }

  /**
   * Mide un punto. instrumento: 'multimetro' o 'osciloscopio'. puntoB (referencia) se admite por compatibilidad: las medidas son respecto a masa (0 V).
   * Devuelve { ok, valor, unidad, texto, ... } (multímetro) o { ok, muestras, unidad, dtMs, texto } (osciloscopio). ok = false si el punto o el modo no valen.
   */
  function medir(instrumento, puntoA, puntoB, modo, estado) {
    const noExiste = { ok: false, valor: null, unidad: '', texto: `Punto de medida desconocido: ${puntoA}` };
    if (instrumento === 'osciloscopio') return resolverOsciloscopio(puntoA, estado) || noExiste;
    if (instrumento !== 'multimetro') return { ok: false, valor: null, unidad: '', texto: `Instrumento desconocido: ${instrumento}` };
    return resolverMultimetro(puntoA, modo, estado) || noExiste;
  }

  const api = { medir, PUNTOS };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstMedidas = api; }
})();
