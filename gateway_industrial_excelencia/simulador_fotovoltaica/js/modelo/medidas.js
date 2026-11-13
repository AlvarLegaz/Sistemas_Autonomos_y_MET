// Puntos de medida e INSTRUMENTOS virtuales (multímetro, pinza amperimétrica y cámara termográfica; el megóhmetro y el trazador I-V están en
// simulacion.js porque necesitan las cadenas). La API completa, con ejemplos, está en ../../API_INSTRUMENTOS.md.
//
// Cosas distintas:
//  1) sim.medidas: números sueltos «etiqueta.magnitud» (STR-101.v, BAT-101.i, INV-201.mppt1.v, RED-301.v …) para las burbujas y las lecturas.
//  2) MULTÍMETRO. sim.medir(a, b): TENSIÓN entre dos NODOS (puntas del polímetro) → { ok, valor, vdc, vac, tipo: 'DC'|'AC'|'sin_referencia'|'desconocido', texto }.
//     Los nodos están en «grupos» que comparten referencia; entre grupos distintos no hay referencia común y la lectura es 0 («sin_referencia»),
//     salvo TIERRA, que sirve de referencia a los grupos de continua: un campo aislado y sano flota centrado (+Voc/2 y −Voc/2); con el fallo de
//     aislamiento el punto de la fuga queda a 0 V de tierra (así se localiza el panel de la fuga).
//     sim.resistencia(a, b): ÓHMETRO / CONTINUIDAD → { ok, ohm (Infinity = «OL»), abierto, continuidad (pita: < 50 Ω), conTension, voltios, texto }.
//     NO mide con tensión: ok:false + conTension:true si hay más de 1 V entre las puntas, si por el tramo pasa corriente (en carga) o si es alterna con tensión.
//     sim.continuidad(a, b): ¿hay camino eléctrico? (booleano topológico de siempre, sin las reglas del instrumento).
//  3) PINZA. sim.conductores → [ { id, descripcion, grupo, desde, hasta, tipo, equipo } ] y sim.corriente(id) → { ok, valor (A), tipo: 'DC'|'AC', texto }.
//     Continua con signo (positivo en el sentido desde → hasta; batería: positivo = carga); alterna, eficaz ≥ 0.
//  4) CÁMARA TERMOGRÁFICA. sim.termografia() → { ambienteC, casetaC, irradianciaWm2: {A, B}, elementos: [ { tag, tipo, tempC, deltaC, nota, equipo, zona } ] }.
//     Paneles (y sus 3 subcadenas PV-xxx.s1..s3), conectores MC4 de cada cadena (STR-xxx.mc4.k), fusibles, bornas, seccionadores, descargadores, magnetotérmicos,
//     diferencial, bornes de batería, inversores, toma, aire de la caseta y rejilla. Calentamiento = I²·R de la corriente que pasa; de noche, todo a su ambiente.
//
// NODOS (nombre → grupo). Todo dispositivo de dos bornes en serie usa «.1» (lado de la fuente) y «.2» (lado de la carga):
//   Campo A (grupo A_DC):  STR-101.+  STR-101.-  STR-102.+  STR-102.-  F-101.1 F-101.2  F-102.1 F-102.2  CB-101.bus+ CB-101.bus-  QS-101.1 QS-101.2  INV-101.pv+ INV-101.pv-
//                          PV-101.+ PV-101.- … PV-106.+ PV-106.-   (bornes de cada panel)
//   Batería (grupo BAT):   BAT-101.+  BAT-101.-  FB-101.1 FB-101.2  QB-101.1 QB-101.2  INV-101.bat+  INV-101.bat-
//                          BAT-101.c0 … BAT-101.c8   (tomas de equilibrado: la celda k está entre c{k} y c{k-1})
//   Campo B (grupo B_DC):  STR-201.+  STR-201.-  STR-202.+  STR-202.-  QS-201.1 QS-201.2 (polos de STR-201)  QS-201.3 QS-201.4 (polos de STR-202)
//                          INV-201.mppt1+  INV-201.mppt1-  INV-201.mppt2+  INV-201.mppt2-   PV-201.+ PV-201.- … PV-208.+ PV-208.-
//   Alterna (grupo AC):    RED-301.L  QF-301.1 QF-301.2  ID-301.1 ID-301.2  QF-302.1 QF-302.2  QF-303.1 QF-303.2  INV-101.ac.L  INV-101.salida.L  INV-201.ac.L
//                          LOAD-301.L  LOAD-302.L  TC-301.L  N  TIERRA
//   Señalización de los descargadores (grupos SPD-101, SPD-201, SPD-301):  SPD-x.11  SPD-x.12  (contacto cerrado con el cartucho sano, abierto si está agotado)
//   Comunicaciones del EASun (grupo COM):  COM-101.5V  COM-101.GND  COM-101.A  COM-101.B  (RS485: A–B ≈ 2,3 V con el bus vivo; ≈ 0 V si el módulo no comunica)
// DENTRO DE UNA CADENA:  STR-x.- ─MC4(0)─ PV-1.-  [panel]  PV-1.+ ─MC4(1)─ PV-2.- … PV-n.+ ─MC4(n) y cable de bajada─ STR-x.+ ─(aquí se abre con CADENA_ABIERTA)─ caja.
//   El conector MC4 resistivo de CONECTOR_RESISTIVO_B2 es el MC4(2) de STR-202 (entre PV-206.+ y PV-207.-); la fuga de FALLO_AISLAMIENTO_B está en PV-203.+ / PV-204.-.
(function () {
  const layout = typeof require !== 'undefined' ? require('../layout.js') : window.PCT.fvLayout;

  const R_MC4_OHM = 0.004;                       // un conector MC4 sano (dentro de los 0,12 Ω de la cadena)
  const CONECTOR_MALO = { cadena: 'STR-202', k: 2 };          // MC4(2): entre el 2.º y el 3.er panel
  const FUGA = { cadena: 'STR-201', nodo: 'PV-203.+' };       // punto de la fuga a tierra del campo B
  const CADENAS = layout.CAMPOS.A.cadenas.map(c => ({ id: c.id, campo: 'A', grupo: 'A_DC', paneles: c.paneles }))
    .concat(layout.CAMPOS.B.cadenas.map(c => ({ id: c.id, campo: 'B', grupo: 'B_DC', paneles: c.paneles })));
  const CELDAS = layout.BATERIA.celdas;

  const PUNTOS = [];
  const equipoDe = id => (id === 'N' || id === 'TIERRA' ? 'QA-301' : id.split('.')[0]);
  const nodo = (id, grupo, descripcion) => PUNTOS.push({ id, grupo, descripcion, equipo: equipoDe(id) });
  for (const s of ['101', '102']) {
    nodo(`STR-${s}.+`, 'A_DC', `Positivo de la cadena STR-${s}`); nodo(`STR-${s}.-`, 'A_DC', `Negativo de la cadena STR-${s}`);
  }
  for (const f of ['101', '102']) { nodo(`F-${f}.1`, 'A_DC', `Fusible F-${f}, lado cadena`); nodo(`F-${f}.2`, 'A_DC', `Fusible F-${f}, lado barra`); }
  nodo('CB-101.bus+', 'A_DC', 'Barra positiva de la caja CB-101'); nodo('CB-101.bus-', 'A_DC', 'Barra negativa de la caja CB-101');
  nodo('QS-101.1', 'A_DC', 'Seccionador QS-101, lado caja'); nodo('QS-101.2', 'A_DC', 'Seccionador QS-101, lado inversor');
  nodo('INV-101.pv+', 'A_DC', 'Entrada PV+ del EASun'); nodo('INV-101.pv-', 'A_DC', 'Entrada PV- del EASun');
  nodo('BAT-101.+', 'BAT', 'Borne positivo de la batería'); nodo('BAT-101.-', 'BAT', 'Borne negativo de la batería');
  nodo('FB-101.1', 'BAT', 'Portafusible FB-101, lado batería'); nodo('FB-101.2', 'BAT', 'Portafusible FB-101, lado QB-101');
  nodo('QB-101.1', 'BAT', 'Magnetotérmico QB-101, lado batería'); nodo('QB-101.2', 'BAT', 'Magnetotérmico QB-101, lado inversor');
  nodo('INV-101.bat+', 'BAT', 'Entrada de batería + del EASun'); nodo('INV-101.bat-', 'BAT', 'Entrada de batería - del EASun');
  for (const s of ['201', '202']) { nodo(`STR-${s}.+`, 'B_DC', `Positivo de la cadena STR-${s}`); nodo(`STR-${s}.-`, 'B_DC', `Negativo de la cadena STR-${s}`); }
  nodo('QS-201.1', 'B_DC', 'Seccionador QS-201 polo de STR-201, lado cadena'); nodo('QS-201.2', 'B_DC', 'Seccionador QS-201 polo de STR-201, lado inversor');
  nodo('QS-201.3', 'B_DC', 'Seccionador QS-201 polo de STR-202, lado cadena'); nodo('QS-201.4', 'B_DC', 'Seccionador QS-201 polo de STR-202, lado inversor');
  for (const m of ['1', '2']) { nodo(`INV-201.mppt${m}+`, 'B_DC', `Entrada MPPT${m} + del ZCS`); nodo(`INV-201.mppt${m}-`, 'B_DC', `Entrada MPPT${m} - del ZCS`); }
  nodo('RED-301.L', 'AC', 'Fase de la acometida'); nodo('N', 'AC', 'Neutro'); nodo('TIERRA', 'AC', 'Tierra de protección');
  for (const q of ['QF-301', 'ID-301', 'QF-302', 'QF-303']) { nodo(`${q}.1`, 'AC', `${q}, lado red`); nodo(`${q}.2`, 'AC', `${q}, lado carga`); }
  nodo('INV-101.ac.L', 'AC', 'Entrada de red del EASun'); nodo('INV-201.ac.L', 'AC', 'Salida de alterna del ZCS');
  nodo('LOAD-301.L', 'AC', 'Fase de LOAD-301'); nodo('LOAD-302.L', 'AC', 'Fase de LOAD-302 (salida del EASun)'); nodo('TC-301.L', 'AC', 'Fase de la toma schuko');
  // Añadidos para los instrumentos (los de arriba no cambian)
  nodo('INV-101.salida.L', 'AC', 'Salida de alterna del EASun (hacia las cargas protegidas)');
  for (const c of CADENAS) for (const tag of c.paneles) { nodo(`${tag}.+`, c.grupo, `Borne positivo del panel ${tag}`); nodo(`${tag}.-`, c.grupo, `Borne negativo del panel ${tag}`); }
  for (let k = 0; k <= CELDAS; k++) nodo(`BAT-101.c${k}`, 'BAT', k === 0 ? 'Toma de equilibrado 0 (negativo de la celda 1)' : `Toma de equilibrado ${k} (positivo de la celda ${k})`);
  for (const s of ['SPD-101', 'SPD-201', 'SPD-301']) { nodo(`${s}.11`, s, `Contacto de señalización de ${s}, borne 11`); nodo(`${s}.12`, s, `Contacto de señalización de ${s}, borne 12`); }
  nodo('COM-101.5V', 'COM', 'Alimentación de 5 V del módulo de comunicaciones'); nodo('COM-101.GND', 'COM', 'Masa del módulo de comunicaciones');
  nodo('COM-101.A', 'COM', 'Línea A del RS485'); nodo('COM-101.B', 'COM', 'Línea B del RS485');
  const GRUPO = Object.fromEntries(PUNTOS.map(p => [p.id, p.grupo]));
  const ES_DC = { A_DC: true, B_DC: true, BAT: true };

  // Conductores donde se puede cerrar la pinza
  const CONDUCTORES = [];
  const hilo = (id, grupo, tipo, desde, hasta, descripcion, equipo) => CONDUCTORES.push({ id, descripcion, grupo, desde, hasta, tipo, equipo: equipo || id.split('.')[0] });
  for (const c of CADENAS) {
    const destino = c.campo === 'A' ? 'CB-101' : 'QS-201';
    hilo(`${c.id}.+`, c.grupo, 'DC', c.id, destino, `Cable positivo (rojo) de la cadena ${c.id}`);
    hilo(`${c.id}.-`, c.grupo, 'DC', c.id, destino, `Cable negativo (negro) de la cadena ${c.id}`);
  }
  hilo('CB-101.salida+', 'A_DC', 'DC', 'CB-101', 'INV-101', 'Salida positiva de la caja CB-101 hacia la entrada PV del EASun');
  hilo('CB-101.salida-', 'A_DC', 'DC', 'CB-101', 'INV-101', 'Salida negativa de la caja CB-101 hacia la entrada PV del EASun');
  hilo('BAT-101.cable+', 'BAT', 'DC', 'INV-101', 'BAT-101', 'Cable positivo de la batería (positivo = carga)');
  hilo('BAT-101.cable-', 'BAT', 'DC', 'INV-101', 'BAT-101', 'Cable negativo de la batería');
  for (const m of ['1', '2']) {
    hilo(`INV-201.mppt${m}+`, 'B_DC', 'DC', 'QS-201', 'INV-201', `Entrada positiva MPPT${m} del ZCS`);
    hilo(`INV-201.mppt${m}-`, 'B_DC', 'DC', 'QS-201', 'INV-201', `Entrada negativa MPPT${m} del ZCS`);
  }
  hilo('RED-301.L', 'AC', 'AC', 'RED-301', 'QF-301', 'Fase de la acometida de red');
  hilo('RED-301.N', 'AC', 'AC', 'RED-301', 'QF-301', 'Neutro de la acometida de red');
  hilo('ID-301.L+N', 'AC', 'AC', 'ID-301', 'QA-301', 'Fase y neutro juntos a la salida del diferencial (corriente diferencial o de fuga)');
  hilo('QF-302.L', 'AC', 'AC', 'QF-302', 'INV-101', 'Línea de entrada de red del EASun');
  hilo('INV-101.salida.L', 'AC', 'AC', 'INV-101', 'LOAD-302', 'Salida de alterna del EASun');
  hilo('LOAD-302.L', 'AC', 'AC', 'INV-101', 'LOAD-302', 'Línea de las cargas protegidas');
  hilo('QF-303.L', 'AC', 'AC', 'INV-201', 'QF-303', 'Línea de alterna del ZCS (vertido)');
  hilo('LOAD-301.L', 'AC', 'AC', 'QA-301', 'LOAD-301', 'Línea del consumo del centro');
  hilo('TC-301.L', 'AC', 'AC', 'QA-301', 'TC-301', 'Línea de la toma de corriente de la caseta');
  hilo('PE.CB-101', 'PE', 'DC', 'CB-101', 'TIERRA', 'Conductor de protección (amarillo-verde) del campo A', 'CB-101');
  hilo('PE.QS-201', 'PE', 'DC', 'QS-201', 'TIERRA', 'Conductor de protección (amarillo-verde) del campo B', 'QS-201');
  hilo('PE.QA-301', 'PE', 'AC', 'QA-301', 'TIERRA', 'Conductor de protección del cuadro de alterna', 'QA-301');
  const CONDUCTOR = Object.fromEntries(CONDUCTORES.map(c => [c.id, c]));

  const mediana = lista => { if (!lista.length) return 0; const o = lista.slice().sort((x, y) => x - y), m = o.length >> 1; return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2; };
  const limitar = (v, a, b) => Math.max(a, Math.min(b, v));
  /** Número pseudoaleatorio fijo 0–1 a partir de un texto (para las manchas de suciedad: siempre las mismas). */
  const azar = texto => { let h = 2166136261; for (let k = 0; k < texto.length; k++) { h ^= texto.charCodeAt(k); h = Math.imul(h, 16777619); } return ((h >>> 0) % 1000) / 1000; };
  const textoA = (a, tipo) => (Math.abs(a) < 1 ? `${(a * 1000).toFixed(Math.abs(a) < 0.1 ? 1 : 0)} mA` : `${a.toFixed(2)} A`) + (tipo === 'AC' ? ' alterna' : ' continua');

  /**
   * ctx: { estado, prot, top, abiertaFisica: {id: bool}, redOk, vRed, temperaturaCasetaC,
   *        y para los instrumentos (opcionales): celdasV [8], rConectorOhm, fugaB (bool), diodos {tagPanel: [..]}, gPlano {A, B}, tAmb, ventilacionTapada }
   * Devuelve { potencial, continuidad, medir, resistencia, corriente, termografia, medidas }.
   */
  function crearMedidas(ctx) {
    const E = ctx.estado, P = ctx.prot;
    const cond = tag => P.conduce(tag);
    const cad = id => { for (const c of E.campos.A.cadenas.concat(E.campos.B.cadenas)) if (c.id === id) return c; return null; };
    const vCad = id => { const c = cad(id); return c ? c.v : 0; };
    const iCad = id => { const c = cad(id); return c && !c.abierta ? c.i : 0; };
    const vInvA = E.inversores['INV-101'], vInvB = E.inversores['INV-201'];
    const rMalo = ctx.rConectorOhm || 0;
    const rMc4 = (idCadena, k) => R_MC4_OHM + (idCadena === CONECTOR_MALO.cadena && k === CONECTOR_MALO.k ? rMalo : 0);

    // Tensión de la barra de A: la del MPPT si QS-101 cierra; si no, la mayor tensión en vacío de las cadenas conectadas por fusible
    const vocConectadas = ['STR-101', 'STR-102'].filter((id, k) => cond(k ? 'F-102' : 'F-101') && !ctx.abiertaFisica[id]).map(vCad);
    const barraA = cond('QS-101') ? vInvA.pvV : (vocConectadas.length ? Math.max(...vocConectadas) : 0);
    const vBat = E.bateria.v;
    const vRed = ctx.redOk ? ctx.vRed : 0;
    const vAcNodo = (nombre, ...cortes) => (cortes.every(cond) ? vRed : 0);
    const mpptV = k => (cond('QS-201') && !ctx.abiertaFisica[k ? 'STR-202' : 'STR-201'] ? vInvB.mppt[k].v : 0);
    const easunVivo = vInvA.estado !== 'APAGADO';
    const salidaEasun = () => (E.cargas['LOAD-302'].alimentada ? 230 : (!cond('QF-302') && easunVivo && vInvA.estado !== 'FALLO' && !vInvA.arrancando ? 230 : 0));
    const nodoPot = {
      'STR-101.+': () => vCad('STR-101'), 'STR-101.-': () => 0, 'STR-102.+': () => vCad('STR-102'), 'STR-102.-': () => 0,
      // Lado de la caja del fusible: con la cadena cortada (MC4 suelto) no le llega su tensión; solo la de la barra si el fusible conduce
      'F-101.1': () => (ctx.abiertaFisica['STR-101'] ? (cond('F-101') ? barraA : 0) : vCad('STR-101')), 'F-101.2': () => barraA,
      'F-102.1': () => (ctx.abiertaFisica['STR-102'] ? (cond('F-102') ? barraA : 0) : vCad('STR-102')), 'F-102.2': () => barraA,
      'CB-101.bus+': () => barraA, 'CB-101.bus-': () => 0, 'QS-101.1': () => barraA, 'QS-101.2': () => (cond('QS-101') ? barraA : 0),
      'INV-101.pv+': () => (cond('QS-101') ? barraA : 0), 'INV-101.pv-': () => 0,
      'BAT-101.+': () => vBat, 'BAT-101.-': () => 0, 'FB-101.1': () => vBat, 'FB-101.2': () => (cond('FB-101') ? vBat : 0),
      'QB-101.1': () => (cond('FB-101') ? vBat : 0), 'QB-101.2': () => (cond('FB-101') && cond('QB-101') ? vBat : 0),
      'INV-101.bat+': () => (cond('FB-101') && cond('QB-101') ? vBat : 0), 'INV-101.bat-': () => 0,
      'STR-201.+': () => vCad('STR-201'), 'STR-201.-': () => 0, 'STR-202.+': () => vCad('STR-202'), 'STR-202.-': () => 0,
      'QS-201.1': () => (ctx.abiertaFisica['STR-201'] ? 0 : vCad('STR-201')), 'QS-201.2': () => mpptV(0),
      'QS-201.3': () => (ctx.abiertaFisica['STR-202'] ? 0 : vCad('STR-202')), 'QS-201.4': () => mpptV(1),
      'INV-201.mppt1+': () => mpptV(0), 'INV-201.mppt1-': () => 0, 'INV-201.mppt2+': () => mpptV(1), 'INV-201.mppt2-': () => 0,
      'RED-301.L': () => vRed, 'N': () => 0, 'TIERRA': () => 0,
      'QF-301.1': () => vRed, 'QF-301.2': () => vAcNodo('', 'QF-301'),
      'ID-301.1': () => vAcNodo('', 'QF-301'), 'ID-301.2': () => vAcNodo('', 'QF-301', 'ID-301'),
      'QF-302.1': () => vAcNodo('', 'QF-301', 'ID-301'), 'QF-302.2': () => vAcNodo('', 'QF-301', 'ID-301', 'QF-302'),
      'QF-303.1': () => vAcNodo('', 'QF-301', 'ID-301'), 'QF-303.2': () => vAcNodo('', 'QF-301', 'ID-301', 'QF-303'),
      'INV-101.ac.L': () => vAcNodo('', 'QF-301', 'ID-301', 'QF-302'), 'INV-201.ac.L': () => vAcNodo('', 'QF-301', 'ID-301', 'QF-303'),
      'LOAD-301.L': () => vAcNodo('', 'QF-301', 'ID-301'), 'TC-301.L': () => vAcNodo('', 'QF-301', 'ID-301'),
      'LOAD-302.L': () => (E.cargas['LOAD-302'].alimentada ? 230 : 0),
      'INV-101.salida.L': salidaEasun,
      'COM-101.GND': () => 0, 'COM-101.5V': () => (easunVivo ? 5.02 : 0),
      'COM-101.A': () => (easunVivo ? (vInvA.comunicacion === false ? 2.52 : 3.65) : 0), 'COM-101.B': () => (easunVivo ? (vInvA.comunicacion === false ? 2.48 : 1.35) : 0),
    };
    for (const s of ['SPD-101', 'SPD-201', 'SPD-301']) { nodoPot[`${s}.11`] = () => 0; nodoPot[`${s}.12`] = () => 0; }
    // Bornes de los paneles: tensiones acumuladas desde el negativo de la cadena, con la caída de cada conector MC4
    const potPanel = {};
    for (const c of CADENAS) {
      const e = cad(c.id); if (!e) continue;
      const i = e.abierta ? 0 : e.i; let v = 0;
      e.paneles.forEach((p, k) => { v -= i * rMc4(c.id, k); potPanel[`${p.tag}.-`] = v; v += p.v; potPanel[`${p.tag}.+`] = v; });
    }
    for (const id of Object.keys(potPanel)) nodoPot[id] = () => potPanel[id];
    // Tomas de equilibrado de la batería
    const celdas = ctx.celdasV || E.bateria.celdasV || Array.from({ length: CELDAS }, () => vBat / CELDAS);
    { let v = 0; nodoPot['BAT-101.c0'] = () => 0; celdas.forEach((vc, k) => { v += vc; const acum = v; nodoPot[`BAT-101.c${k + 1}`] = () => acum; }); }
    const potencial = n => (nodoPot[n] ? nodoPot[n]() : null);

    /** Potencial de la tierra visto desde un grupo de continua (la referencia del grupo es su negativo). */
    function tierraDe(grupo) {
      if (grupo === 'BAT') return vBat / 2;
      if (grupo === 'A_DC') return Math.max(vCad('STR-101'), vCad('STR-102'), barraA) / 2;
      if (ctx.fugaB) return potencial(FUGA.nodo) || 0;                 // la fuga «ata» ese punto a tierra
      return Math.max(vCad('STR-201'), vCad('STR-202')) / 2;
    }

    // Grafo de continuidad: [a, b, condición, resistencia Ω, corriente que pasa (A)]
    const siempre = () => true;
    const iBat = () => Math.abs(E.bateria.i), iPvA = () => Math.abs(vInvA.pvI || 0);
    const aristas = [
      ['STR-101.+', 'F-101.1', () => !ctx.abiertaFisica['STR-101'], 0.01, () => iCad('STR-101')], ['F-101.1', 'F-101.2', () => cond('F-101'), 0.03, () => iCad('STR-101')], ['F-101.2', 'CB-101.bus+', siempre, 0.005, () => iCad('STR-101')],
      ['STR-102.+', 'F-102.1', () => !ctx.abiertaFisica['STR-102'], 0.01, () => iCad('STR-102')], ['F-102.1', 'F-102.2', () => cond('F-102'), 0.03, () => iCad('STR-102')], ['F-102.2', 'CB-101.bus+', siempre, 0.005, () => iCad('STR-102')],
      ['CB-101.bus+', 'QS-101.1', siempre, 0.005, iPvA], ['QS-101.1', 'QS-101.2', () => cond('QS-101'), 0.01, iPvA], ['QS-101.2', 'INV-101.pv+', siempre, 0.02, iPvA],
      ['BAT-101.+', 'FB-101.1', siempre, 0.002, iBat], ['FB-101.1', 'FB-101.2', () => cond('FB-101'), 0.003, iBat], ['FB-101.2', 'QB-101.1', siempre, 0.002, iBat], ['QB-101.1', 'QB-101.2', () => cond('QB-101'), 0.003, iBat], ['QB-101.2', 'INV-101.bat+', siempre, 0.002, iBat],
      ['STR-201.+', 'QS-201.1', () => !ctx.abiertaFisica['STR-201'], 0.01, () => iCad('STR-201')], ['QS-201.1', 'QS-201.2', () => cond('QS-201'), 0.01, () => iCad('STR-201')], ['QS-201.2', 'INV-201.mppt1+', siempre, 0.01, () => iCad('STR-201')],
      ['STR-202.+', 'QS-201.3', () => !ctx.abiertaFisica['STR-202'], 0.01, () => iCad('STR-202')], ['QS-201.3', 'QS-201.4', () => cond('QS-201'), 0.01, () => iCad('STR-202')], ['QS-201.4', 'INV-201.mppt2+', siempre, 0.01, () => iCad('STR-202')],
      ['RED-301.L', 'QF-301.1', siempre, 0.05], ['QF-301.1', 'QF-301.2', () => cond('QF-301'), 0.01], ['QF-301.2', 'ID-301.1', siempre, 0.005], ['ID-301.1', 'ID-301.2', () => cond('ID-301'), 0.01],
      ['ID-301.2', 'QF-302.1', siempre, 0.005], ['ID-301.2', 'QF-303.1', siempre, 0.005], ['ID-301.2', 'LOAD-301.L', siempre, 0.05], ['ID-301.2', 'TC-301.L', siempre, 0.03],
      ['QF-302.1', 'QF-302.2', () => cond('QF-302'), 0.01], ['QF-302.2', 'INV-101.ac.L', siempre, 0.02], ['QF-303.1', 'QF-303.2', () => cond('QF-303'), 0.01], ['QF-303.2', 'INV-201.ac.L', siempre, 0.02],
      ['TIERRA', 'N', () => false, 0],
      // Añadidas para los instrumentos
      ['INV-101.salida.L', 'LOAD-302.L', () => cond('QF-302'), 0.03],
      ['STR-101.-', 'CB-101.bus-', siempre, 0.015, () => iCad('STR-101')], ['STR-102.-', 'CB-101.bus-', siempre, 0.015, () => iCad('STR-102')], ['CB-101.bus-', 'INV-101.pv-', siempre, 0.02, iPvA],
      ['BAT-101.-', 'INV-101.bat-', siempre, 0.004, iBat], ['BAT-101.c0', 'BAT-101.-', siempre, 0.01, iBat],
      ['STR-201.-', 'INV-201.mppt1-', siempre, 0.03, () => iCad('STR-201')], ['STR-202.-', 'INV-201.mppt2-', siempre, 0.03, () => iCad('STR-202')],
      ['COM-101.GND', 'INV-101.bat-', () => false, 0],
    ];
    for (const s of ['SPD-101', 'SPD-201', 'SPD-301']) aristas.push([`${s}.11`, `${s}.12`, () => cond(s), 0.1]);
    for (const c of CADENAS) {
      const n = c.paneles.length, i = () => iCad(c.id);
      aristas.push([`${c.id}.-`, `${c.paneles[0]}.-`, siempre, rMc4(c.id, 0), i]);
      for (let k = 1; k < n; k++) aristas.push([`${c.paneles[k - 1]}.+`, `${c.paneles[k]}.-`, siempre, rMc4(c.id, k), i]);
      aristas.push([`${c.paneles[n - 1]}.+`, `${c.id}.+`, siempre, 0.12 - n * R_MC4_OHM, i]);
    }
    function continuidad(a, b) {
      if (!(a in GRUPO) || !(b in GRUPO)) return false;
      if (a === b) return true;
      const vistos = new Set([a]), cola = [a];
      while (cola.length) {
        const x = cola.shift();
        for (const [p, q, ok] of aristas) {
          const y = p === x ? q : q === x ? p : null;
          if (y && !vistos.has(y) && ok()) { if (y === b) return true; vistos.add(y); cola.push(y); }
        }
      }
      return false;
    }
    /** Camino de menor resistencia entre dos nodos: { ohm, corriente (la mayor de los tramos) } o null si no lo hay. */
    function camino(a, b) {
      const mejor = new Map([[a, { ohm: 0, corriente: 0 }]]);
      for (let cambio = true, vueltas = 0; cambio && vueltas < 200; vueltas++) {
        cambio = false;
        for (const [p, q, ok, ohm, corr] of aristas) {
          if (!ok()) continue;
          for (const [x, y] of [[p, q], [q, p]]) {
            const dx = mejor.get(x); if (!dx) continue;
            const nuevo = dx.ohm + (ohm || 0), dy = mejor.get(y);
            if (!dy || nuevo < dy.ohm - 1e-12) { mejor.set(y, { ohm: nuevo, corriente: Math.max(dx.corriente, corr ? Math.abs(corr()) : 0) }); cambio = true; }
          }
        }
      }
      return mejor.get(b) || null;
    }

    function medir(a, b) {
      const ga = GRUPO[a], gb = GRUPO[b];
      if (!ga || !gb) return { ok: false, valor: 0, vdc: 0, vac: 0, tipo: 'desconocido', texto: 'Punto de medida desconocido' };
      let d;
      if (ga === gb) d = potencial(a) - potencial(b);
      else if (b === 'TIERRA' && ES_DC[ga]) d = potencial(a) - tierraDe(ga);
      else if (a === 'TIERRA' && ES_DC[gb]) d = tierraDe(gb) - potencial(b);
      else return { ok: true, valor: 0, vdc: 0, vac: 0, tipo: 'sin_referencia', texto: 'Sin referencia común entre esos dos puntos' };
      if (ga === 'AC' && gb === 'AC') return { ok: true, valor: Math.abs(d), vdc: 0, vac: Math.abs(d), tipo: 'AC', texto: `${Math.abs(d).toFixed(1)} V alterna` };
      const fino = /^BAT-101\.c\d$/.test(a) || /^BAT-101\.c\d$/.test(b) || Math.abs(d) < 2;
      return { ok: true, valor: d, vdc: d, vac: 0, tipo: 'DC', texto: `${d.toFixed(fino ? 3 : 2)} V continua` };
    }

    /** Óhmetro / continuidad con las reglas de un multímetro de verdad: no mide con tensión ni en carga. */
    function resistencia(a, b) {
      const ga = GRUPO[a], gb = GRUPO[b], no = (extra, texto) => Object.assign({ ok: false, ohm: null, abierto: false, continuidad: false, conTension: false, voltios: 0, texto }, extra);
      if (!ga || !gb) return no({}, 'Punto de medida desconocido');
      if (a === b) return { ok: true, ohm: 0, abierto: false, continuidad: true, conTension: false, voltios: 0, texto: '0.00 Ω · las dos puntas están en el mismo punto' };
      if (ga === gb) {
        const va = potencial(a), vb = potencial(b), dv = Math.abs(va - vb);
        if (dv > 1) return no({ conTension: true, voltios: dv }, `Hay ${dv.toFixed(1)} V entre las puntas: no se puede medir continuidad con tensión. Mide tensión, o deja el circuito sin tensión antes.`);
        if (ga === 'AC' && Math.max(Math.abs(va), Math.abs(vb)) > 50) {
          return no({ conTension: true, voltios: Math.max(Math.abs(va), Math.abs(vb)) }, 'El circuito de alterna tiene tensión: no se puede medir continuidad con tensión. Abre el interruptor de aguas arriba (QF-301) y comprueba que no hay tensión.');
        }
      }
      const c = ga === gb ? camino(a, b) : null;
      if (c && c.corriente > 0.05) {
        const abre = ga === 'A_DC' ? ' Abre el seccionador QS-101.' : ga === 'B_DC' ? ' Abre el seccionador QS-201.' : ga === 'BAT' ? ' Abre QB-101 o deja el inversor sin carga.' : '';
        return no({ conTension: true, voltios: 0 }, `El circuito está en carga (pasan ${c.corriente.toFixed(1)} A): no se puede medir continuidad con tensión.${abre}`);
      }
      if (!c) return { ok: true, ohm: Infinity, abierto: true, continuidad: false, conTension: false, voltios: 0, texto: 'OL · circuito abierto (no hay continuidad)' };
      return { ok: true, ohm: c.ohm, abierto: false, continuidad: c.ohm < 50, conTension: false, voltios: 0, texto: `${c.ohm.toFixed(2)} Ω · hay continuidad` };
    }

    // ---------------------------------------------------------------- pinza amperimétrica
    const red = E.red, vLinea = red.v > 50 ? red.v : 230;
    const iDe = w => Math.abs(w) / vLinea;
    const fugaAc = () => (ctx.top && ctx.top.redEnCuadro ? 0.0008 + (vInvB.acP > 5 ? 0.0025 : 0) + (ctx.top.redEasun ? 0.0005 : 0) : 0);
    const vMaxB = () => Math.max(vCad('STR-201'), vCad('STR-202'));
    const valorConductor = {
      'CB-101.salida+': () => vInvA.pvI || 0, 'CB-101.salida-': () => -(vInvA.pvI || 0),
      'BAT-101.cable+': () => E.bateria.i, 'BAT-101.cable-': () => -E.bateria.i,
      'INV-201.mppt1+': () => iCad('STR-201'), 'INV-201.mppt1-': () => -iCad('STR-201'), 'INV-201.mppt2+': () => iCad('STR-202'), 'INV-201.mppt2-': () => -iCad('STR-202'),
      'RED-301.L': () => iDe(red.p), 'RED-301.N': () => iDe(red.p),
      'ID-301.L+N': fugaAc, 'PE.QA-301': fugaAc,
      'QF-302.L': () => iDe(vInvA.redP), 'INV-101.salida.L': () => E.cargas['LOAD-302'].w / 230, 'LOAD-302.L': () => E.cargas['LOAD-302'].w / 230,
      'QF-303.L': () => (vInvB.acP > 0 ? vInvB.acP / Math.max(vInvB.acV, 100) : 0),
      'LOAD-301.L': () => iDe(E.cargas['LOAD-301'].w), 'TC-301.L': () => 0,
      // Fuga a tierra de los campos: tensión del campo sobre su resistencia de aislamiento (µA en sano; cerca de 1 mA con el fallo de aislamiento)
      'PE.CB-101': () => Math.max(vCad('STR-101'), vCad('STR-102')) / 2 / 19e6,
      'PE.QS-201': () => (ctx.fugaB ? vMaxB() / 2 / 1e5 : vMaxB() / 2 / 12e6),
    };
    for (const c of CADENAS) { valorConductor[`${c.id}.+`] = () => iCad(c.id); valorConductor[`${c.id}.-`] = () => -iCad(c.id); }
    function corriente(id) {
      const c = CONDUCTOR[id];
      if (!c || !valorConductor[id]) return { ok: false, valor: 0, tipo: 'desconocido', texto: 'Conductor desconocido' };
      let valor = Number(valorConductor[id]()) || 0;
      if (c.tipo === 'AC') valor = Math.abs(valor);
      let extra = '';
      if (id === 'RED-301.L' && valor > 0.05) extra = red.p >= 0 ? ' (importando de la red)' : ' (vertiendo a la red)';
      if (id === 'BAT-101.cable+' && Math.abs(valor) > 0.05) extra = valor > 0 ? ' (cargando)' : ' (descargando)';
      return { ok: true, valor, tipo: c.tipo, texto: textoA(valor, c.tipo) + extra };
    }

    // ---------------------------------------------------------------- cámara termográfica
    function temperaturaConector(idCadena, k, tAmb, g) {
      const i = iCad(idCadena), malo = idCadena === CONECTOR_MALO.cadena && k === CONECTOR_MALO.k ? rMalo : 0;
      // El conector al sol va unos grados sobre el ambiente; el sano disipa décimas de vatio y el malo I²·R (1 Ω con 13 A son 170 W: más de 100 °C, de quemarse)
      return tAmb + 6 * limitar(g / 1000, 0, 1.2) + i * i * (R_MC4_OHM * 8 + malo * 0.45);
    }
    function termografia() {
      const tAmb = Number.isFinite(ctx.tAmb) ? ctx.tAmb : E.ambiente.temperaturaAmbienteC, tCas = ctx.temperaturaCasetaC;
      const elementos = [], gPlano = ctx.gPlano || { A: E.campos.A.gPlanoWm2, B: E.campos.B.gPlanoWm2 }, diodos = ctx.diodos || {};
      const add = (tag, tipo, tempC, ref, nota, equipo, zona) => elementos.push({ tag, tipo, tempC, deltaC: tempC - ref, nota: nota || '', equipo: equipo || tag, zona });
      for (const k of ['A', 'B']) {
        const g = gPlano[k] || 0, esp = layout.CAMPOS[k].panel, suc = (E.ambiente.suciedad || {})[k] || 0, sol = limitar(g / 1000, 0, 1.3);
        const paneles = [], subs = [], conectores = [];
        for (const c of E.campos[k].cadenas) {
          const i = c.abierta ? 0 : c.i;
          for (const p of c.paneles) {
            const d = diodos[p.tag] || ['ok', 'ok', 'ok'];
            // Un panel al que no se le saca potencia va unos grados más caliente (toda la luz se queda en calor)
            const fraccion = limitar(p.p / Math.max(1, esp.wp * g / 1000), 0, 1), base = p.tempCelulaC + 4 * sol * (1 - fraccion);
            const inversa = d.includes('abierto') && p.sombra01 > 0.02;
            const ts = [0, 1, 2].map(j => {
              const sk = limitar(p.sombra01 * 3 - j, 0, 1);
              let t = base - 0.6 * Math.max(0, p.tempCelulaC - tAmb) * sk, nota = sk > 0.5 ? 'subcadena en sombra' : '';
              if (d[j] === 'corto') { t += 7 * sol; nota = 'subcadena en cortocircuito por su diodo de paso (más caliente que las otras dos)'; }
              else if (d[j] === 'abierto' && sk > 0.02) {
                if (i > 0.2) { t = base + 28 * sol; nota = 'PUNTO CALIENTE: célula sombreada en inversa (el diodo de paso no conduce)'; }
              } else if (sk > 0.02 && p.bypass[j] && i > 0.2) nota = 'subcadena en sombra, puenteada por su diodo de paso';
              if (suc > 0.1 && sol > 0.05) { t += suc * 14 * sol * (azar(`${p.tag}.${j}`) - 0.35); if (!nota) nota = 'manchas irregulares: suciedad'; }
              return { t, nota };
            });
            if (inversa && i > 0.2) for (const s of ts) if (!/PUNTO/.test(s.nota)) s.t -= 9;      // el calor del punto caliente está sobre todo en su subcadena, no repartido por el panel
            const tPanel = (ts[0].t + ts[1].t + ts[2].t) / 3;
            let nota = '';
            if (ts.some(s => /PUNTO/.test(s.nota))) nota = 'punto caliente en una subcadena';
            else if (d.includes('corto')) nota = 'un tercio del panel más caliente';
            else if (suc > 0.1 && sol > 0.05) nota = 'manchas irregulares: suciedad';
            else if (p.sombra01 > 0.05) nota = 'parte del panel en sombra';
            else if (sol > 0.2 && i < 0.05) nota = 'sin corriente: algo más caliente que un panel que produce';
            paneles.push({ tag: p.tag, t: tPanel, nota });
            ts.forEach((s, j) => subs.push({ tag: `${p.tag}.s${j + 1}`, t: s.t, nota: s.nota, equipo: p.tag }));
          }
          const n = c.paneles.length;
          for (let j = 0; j <= n; j++) {
            const t = temperaturaConector(c.id, j, tAmb, g), malo = c.id === CONECTOR_MALO.cadena && j === CONECTOR_MALO.k && rMalo > 0 && i > 0.5;
            const entre = j === 0 ? `extremo negativo, en ${c.paneles[0]}` : j === n ? `extremo positivo, en ${c.paneles[n - 1]}` : `entre ${c.paneles[j - 1]} y ${c.paneles[j]}`;
            conectores.push({ tag: `${c.id}.mc4.${j}`, t, nota: malo ? `PUNTO CALIENTE: conector MC4 con mala conexión (${entre})` : '', equipo: c.id, entre });
          }
        }
        const mp = mediana(paneles.map(x => x.t)), ms = mediana(subs.map(x => x.t)), mc = mediana(conectores.map(x => x.t));
        for (const x of paneles) add(x.tag, 'panel', x.t, mp, x.nota, x.tag, 'cubierta');
        for (const x of subs) add(x.tag, 'subcadena', x.t, ms, x.nota, x.equipo, 'cubierta');
        for (const x of conectores) add(x.tag, 'conector', x.t, mc, x.nota, x.equipo, 'cubierta');
      }
      // Aparamenta de la caseta: aire de la caseta más el calentamiento por la corriente que pasa (I²·R)
      const i1 = iCad('STR-101'), i2 = iCad('STR-102'), iA = Math.abs(vInvA.pvI || 0), ib = Math.abs(E.bateria.i), b1 = iCad('STR-201'), b2 = iCad('STR-202');
      const iRed = iDe(red.p), iEas = Math.max(iDe(vInvA.redP), E.cargas['LOAD-302'].w / 230), iZcs = valorConductor['QF-303.L']();
      const dia = (gPlano.A || 0) > 150;
      const caseta = (tag, tipo, subida, nota) => add(tag, tipo, tCas + subida, tCas, nota, tag, 'caseta');
      const estadoDe = tag => P.estadoDe(tag);
      caseta('F-101', 'fusible', 0.12 * i1 * i1, estadoDe('F-101') !== 'CERRADO' ? 'frío: no pasa corriente' : (dia && i1 < 0.05 && i2 > 1 ? 'frío: no pasa corriente (su vecino sí lleva)' : ''));
      caseta('F-102', 'fusible', 0.12 * i2 * i2, estadoDe('F-102') !== 'CERRADO' ? 'frío: no pasa corriente' : (dia && i2 < 0.05 && i1 > 1 ? 'frío: no pasa corriente (su vecino sí lleva)' : ''));
      caseta('CB-101', 'caja', 0.02 * iA * iA, '');
      caseta('QS-101', 'seccionador', 0.015 * iA * iA, '');
      caseta('SPD-101', 'descargador', 0.3, estadoDe('SPD-101') === 'AGOTADO' ? 'testigo en rojo (la cámara no lo distingue: está frío)' : '');
      caseta('QS-201', 'seccionador', 0.015 * (b1 * b1 + b2 * b2), '');
      caseta('SPD-201', 'descargador', 0.3, '');
      caseta('FB-101', 'fusible', 0.005 * ib * ib, ib > 80 ? 'caliente: mucha corriente de batería' : '');
      caseta('QB-101', 'magnetotermico', 0.004 * ib * ib, estadoDe('QB-101') !== 'CERRADO' ? 'frío: abierto' : '');
      add('BAT-101', 'bateria', E.bateria.temperaturaC + 0.002 * ib * ib, tCas, '', 'BAT-101', 'caseta');
      const notaInv = t => (t > 75 ? 'muy caliente: reduce potencia' : t > 62 ? 'caliente' : '');
      add('INV-101', 'inversor', vInvA.temperaturaC, tCas, notaInv(vInvA.temperaturaC), 'INV-101', 'caseta');
      add('INV-201', 'inversor', vInvB.temperaturaC, tCas, notaInv(vInvB.temperaturaC), 'INV-201', 'caseta');
      caseta('QF-301', 'magnetotermico', 0.02 * iRed * iRed, '');
      caseta('ID-301', 'diferencial', 0.015 * iRed * iRed, '');
      caseta('QF-302', 'magnetotermico', 0.03 * iEas * iEas, '');
      caseta('QF-303', 'magnetotermico', 0.03 * iZcs * iZcs, '');
      caseta('SPD-301', 'descargador', 0.3, '');
      caseta('TC-301', 'toma', 0, '');
      const dCas = tCas - tAmb;
      add('CAS-001', 'caseta', tCas, tAmb, dCas > 18 ? 'aire interior muy caliente: revisar la ventilación' : '', 'CAS-001', 'caseta');
      // Por la rejilla sale el aire caliente de dentro; tapada, está a la temperatura de fuera
      add('CAS-001.rejilla', 'rejilla', ctx.ventilacionTapada ? tAmb + 1 : tCas - 0.5, tCas, ctx.ventilacionTapada ? 'fría: no sale aire caliente (rejilla tapada)' : '', 'CAS-001', 'caseta');
      for (const e of elementos) { if (!e.nota && e.zona === 'caseta' && e.deltaC > 25) e.nota = 'caliente'; }
      return { ambienteC: tAmb, casetaC: tCas, irradianciaWm2: { A: gPlano.A || 0, B: gPlano.B || 0 }, elementos };
    }

    /** Números sueltos para las burbujas y lecturas. */
    function medidas() {
      const m = {};
      for (const c of E.campos.A.cadenas.concat(E.campos.B.cadenas)) {
        m[`${c.id}.v`] = c.v; m[`${c.id}.i`] = c.i; m[`${c.id}.p`] = c.p; m[`${c.id}.voc`] = c.voc;
        for (const p of c.paneles) { m[`${p.tag}.v`] = p.v; m[`${p.tag}.t`] = p.tempCelulaC; m[`${p.tag}.p`] = p.p; }
      }
      m['STR-202.conectorC'] = temperaturaConector(CONECTOR_MALO.cadena, CONECTOR_MALO.k, Number.isFinite(ctx.tAmb) ? ctx.tAmb : E.ambiente.temperaturaAmbienteC, (ctx.gPlano || { B: E.campos.B.gPlanoWm2 }).B || 0);
      m['CB-101.v'] = barraA; m['CB-101.i'] = vInvA.pvI;
      m['INV-101.pvV'] = vInvA.pvV; m['INV-101.pvI'] = vInvA.pvI; m['INV-101.pvP'] = vInvA.pvP; m['INV-101.cargaP'] = vInvA.cargaP; m['INV-101.redP'] = vInvA.redP; m['INV-101.t'] = vInvA.temperaturaC;
      m['INV-201.mppt1.v'] = vInvB.mppt[0].v; m['INV-201.mppt1.i'] = vInvB.mppt[0].i; m['INV-201.mppt1.p'] = vInvB.mppt[0].p;
      m['INV-201.mppt2.v'] = vInvB.mppt[1].v; m['INV-201.mppt2.i'] = vInvB.mppt[1].i; m['INV-201.mppt2.p'] = vInvB.mppt[1].p;
      m['INV-201.acP'] = vInvB.acP; m['INV-201.acV'] = vInvB.acV; m['INV-201.t'] = vInvB.temperaturaC; m['INV-201.aislamientoMohm'] = vInvB.aislamientoMohm;
      m['BAT-101.v'] = vBat; m['BAT-101.i'] = E.bateria.i; m['BAT-101.p'] = E.bateria.p; m['BAT-101.soc'] = E.bateria.soc01 * 100; m['BAT-101.t'] = E.bateria.temperaturaC;
      m['BAT-101.vCeldaMin'] = E.bateria.vCeldaMin; m['BAT-101.vCeldaMax'] = E.bateria.vCeldaMax;
      m['RED-301.v'] = E.red.v; m['RED-301.f'] = E.red.f; m['MED-201.p'] = E.red.p; m['MED-201.vertidoP'] = vInvB.vertidoP;
      m['LOAD-301.p'] = E.cargas['LOAD-301'].w; m['LOAD-302.p'] = E.cargas['LOAD-302'].w;
      m['CAS-001.t'] = ctx.temperaturaCasetaC; m['AMB.g'] = E.ambiente.ghWm2; m['AMB.t'] = E.ambiente.temperaturaAmbienteC;
      return m;
    }
    return { potencial, continuidad, medir, resistencia, corriente, termografia, medidas };
  }

  const api = { PUNTOS, GRUPO, CONDUCTORES, CONECTOR_MALO, FUGA, crearMedidas };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { const P = (window.PCT = window.PCT || {}); (P.fv = P.fv || {}).medidas = api; }
})();
