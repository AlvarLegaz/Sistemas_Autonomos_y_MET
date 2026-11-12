// Puntos de medida para el multímetro virtual.
//
// Dos cosas distintas:
//  1) sim.medidas: números sueltos «etiqueta.magnitud» (STR-101.v, BAT-101.i, INV-201.mppt1.v, RED-301.v …) para las burbujas y las lecturas.
//  2) sim.medir(a, b): TENSIÓN entre dos NODOS del circuito (puntas del polímetro) y sim.continuidad(a, b): ¿hay camino eléctrico entre dos nodos?
//     (para medir fusibles, seccionadores, cables…). Los nodos están en «grupos» que comparten referencia; entre grupos distintos no hay referencia
//     común y la lectura es 0 («sin referencia»).
//
// NODOS (nombre → grupo). Todo dispositivo de dos bornes en serie usa «.1» (lado de la fuente) y «.2» (lado de la carga):
//   Campo A (grupo A_DC):  STR-101.+  STR-101.-  STR-102.+  STR-102.-  F-101.1 F-101.2  F-102.1 F-102.2  CB-101.bus+ CB-101.bus-  QS-101.1 QS-101.2  INV-101.pv+ INV-101.pv-
//   Batería (grupo BAT):   BAT-101.+  BAT-101.-  FB-101.1 FB-101.2  QB-101.1 QB-101.2  INV-101.bat+  INV-101.bat-
//   Campo B (grupo B_DC):  STR-201.+  STR-201.-  STR-202.+  STR-202.-  QS-201.1 QS-201.2 (polos de STR-201)  QS-201.3 QS-201.4 (polos de STR-202)
//                          INV-201.mppt1+  INV-201.mppt1-  INV-201.mppt2+  INV-201.mppt2-
//   Alterna (grupo AC):    RED-301.L  QF-301.1 QF-301.2  ID-301.1 ID-301.2  QF-302.1 QF-302.2  QF-303.1 QF-303.2  INV-101.ac.L  INV-201.ac.L
//                          LOAD-301.L  LOAD-302.L  TC-301.L  N  TIERRA
(function () {
  const PUNTOS = [];
  const nodo = (id, grupo, descripcion) => PUNTOS.push({ id, grupo, descripcion });
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
  const GRUPO = Object.fromEntries(PUNTOS.map(p => [p.id, p.grupo]));

  /**
   * ctx: { estado, prot, top, abiertaFisica: {id: bool}, redOk, vRed, tensionesCadena: {id: V en el lado de la cadena}, hay(id) }
   * Devuelve { potencial(nodo) → V, continuidad(a, b) → bool, medir(a, b), medidas() }.
   */
  function crearMedidas(ctx) {
    const E = ctx.estado, P = ctx.prot, T = ctx.top;
    const cond = tag => P.conduce(tag);
    const cad = id => { for (const c of E.campos.A.cadenas.concat(E.campos.B.cadenas)) if (c.id === id) return c; return null; };
    const vCad = id => { const c = cad(id); return c ? c.v : 0; };
    const vInvA = E.inversores['INV-101'], vInvB = E.inversores['INV-201'];

    // Tensión de la barra de A: la del MPPT si QS-101 cierra; si no, la mayor tensión en vacío de las cadenas conectadas por fusible
    const vocConectadas = ['STR-101', 'STR-102'].filter((id, k) => cond(k ? 'F-102' : 'F-101') && !ctx.abiertaFisica[id]).map(vCad);
    const barraA = cond('QS-101') ? vInvA.pvV : (vocConectadas.length ? Math.max(...vocConectadas) : 0);
    const vBat = E.bateria.v;
    const vRed = ctx.redOk ? ctx.vRed : 0;
    const vAcNodo = (nombre, ...cortes) => (cortes.every(cond) ? vRed : 0);
    const nodoPot = {
      'STR-101.+': () => vCad('STR-101'), 'STR-101.-': () => 0, 'STR-102.+': () => vCad('STR-102'), 'STR-102.-': () => 0,
      'F-101.1': () => (ctx.abiertaFisica['STR-101'] ? 0 : vCad('STR-101')), 'F-101.2': () => barraA, 'F-102.1': () => (ctx.abiertaFisica['STR-102'] ? 0 : vCad('STR-102')), 'F-102.2': () => barraA,
      'CB-101.bus+': () => barraA, 'CB-101.bus-': () => 0, 'QS-101.1': () => barraA, 'QS-101.2': () => (cond('QS-101') ? barraA : 0),
      'INV-101.pv+': () => (cond('QS-101') ? barraA : 0), 'INV-101.pv-': () => 0,
      'BAT-101.+': () => vBat, 'BAT-101.-': () => 0, 'FB-101.1': () => vBat, 'FB-101.2': () => (cond('FB-101') ? vBat : 0),
      'QB-101.1': () => (cond('FB-101') ? vBat : 0), 'QB-101.2': () => (cond('FB-101') && cond('QB-101') ? vBat : 0),
      'INV-101.bat+': () => (cond('FB-101') && cond('QB-101') ? vBat : 0), 'INV-101.bat-': () => 0,
      'STR-201.+': () => vCad('STR-201'), 'STR-201.-': () => 0, 'STR-202.+': () => vCad('STR-202'), 'STR-202.-': () => 0,
      'QS-201.1': () => vCad('STR-201'), 'QS-201.2': () => (cond('QS-201') && !ctx.abiertaFisica['STR-201'] ? vInvB.mppt[0].v : 0),
      'QS-201.3': () => vCad('STR-202'), 'QS-201.4': () => (cond('QS-201') && !ctx.abiertaFisica['STR-202'] ? vInvB.mppt[1].v : 0),
      'INV-201.mppt1+': () => (cond('QS-201') && !ctx.abiertaFisica['STR-201'] ? vInvB.mppt[0].v : 0), 'INV-201.mppt1-': () => 0,
      'INV-201.mppt2+': () => (cond('QS-201') && !ctx.abiertaFisica['STR-202'] ? vInvB.mppt[1].v : 0), 'INV-201.mppt2-': () => 0,
      'RED-301.L': () => vRed, 'N': () => 0, 'TIERRA': () => 0,
      'QF-301.1': () => vRed, 'QF-301.2': () => vAcNodo('', 'QF-301'),
      'ID-301.1': () => vAcNodo('', 'QF-301'), 'ID-301.2': () => vAcNodo('', 'QF-301', 'ID-301'),
      'QF-302.1': () => vAcNodo('', 'QF-301', 'ID-301'), 'QF-302.2': () => vAcNodo('', 'QF-301', 'ID-301', 'QF-302'),
      'QF-303.1': () => vAcNodo('', 'QF-301', 'ID-301'), 'QF-303.2': () => vAcNodo('', 'QF-301', 'ID-301', 'QF-303'),
      'INV-101.ac.L': () => vAcNodo('', 'QF-301', 'ID-301', 'QF-302'), 'INV-201.ac.L': () => vAcNodo('', 'QF-301', 'ID-301', 'QF-303'),
      'LOAD-301.L': () => vAcNodo('', 'QF-301', 'ID-301'), 'TC-301.L': () => vAcNodo('', 'QF-301', 'ID-301'),
      'LOAD-302.L': () => (E.cargas['LOAD-302'].alimentada ? 230 : 0),
    };
    const potencial = n => (nodoPot[n] ? nodoPot[n]() : null);

    // Grafo de continuidad: [a, b, condición]
    const siempre = () => true;
    const aristas = [
      ['STR-101.+', 'F-101.1', () => !ctx.abiertaFisica['STR-101']], ['F-101.1', 'F-101.2', () => cond('F-101')], ['F-101.2', 'CB-101.bus+', siempre],
      ['STR-102.+', 'F-102.1', () => !ctx.abiertaFisica['STR-102']], ['F-102.1', 'F-102.2', () => cond('F-102')], ['F-102.2', 'CB-101.bus+', siempre],
      ['CB-101.bus+', 'QS-101.1', siempre], ['QS-101.1', 'QS-101.2', () => cond('QS-101')], ['QS-101.2', 'INV-101.pv+', siempre],
      ['BAT-101.+', 'FB-101.1', siempre], ['FB-101.1', 'FB-101.2', () => cond('FB-101')], ['FB-101.2', 'QB-101.1', siempre], ['QB-101.1', 'QB-101.2', () => cond('QB-101')], ['QB-101.2', 'INV-101.bat+', siempre],
      ['STR-201.+', 'QS-201.1', () => !ctx.abiertaFisica['STR-201']], ['QS-201.1', 'QS-201.2', () => cond('QS-201')], ['QS-201.2', 'INV-201.mppt1+', siempre],
      ['STR-202.+', 'QS-201.3', () => !ctx.abiertaFisica['STR-202']], ['QS-201.3', 'QS-201.4', () => cond('QS-201')], ['QS-201.4', 'INV-201.mppt2+', siempre],
      ['RED-301.L', 'QF-301.1', siempre], ['QF-301.1', 'QF-301.2', () => cond('QF-301')], ['QF-301.2', 'ID-301.1', siempre], ['ID-301.1', 'ID-301.2', () => cond('ID-301')],
      ['ID-301.2', 'QF-302.1', siempre], ['ID-301.2', 'QF-303.1', siempre], ['ID-301.2', 'LOAD-301.L', siempre], ['ID-301.2', 'TC-301.L', siempre],
      ['QF-302.1', 'QF-302.2', () => cond('QF-302')], ['QF-302.2', 'INV-101.ac.L', siempre], ['QF-303.1', 'QF-303.2', () => cond('QF-303')], ['QF-303.2', 'INV-201.ac.L', siempre],
      ['TIERRA', 'N', () => false],
    ];
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

    function medir(a, b) {
      const ga = GRUPO[a], gb = GRUPO[b];
      if (!ga || !gb) return { ok: false, valor: 0, vdc: 0, vac: 0, tipo: 'desconocido', texto: 'Punto de medida desconocido' };
      if (ga !== gb) return { ok: true, valor: 0, vdc: 0, vac: 0, tipo: 'sin_referencia', texto: 'Sin referencia común entre esos dos puntos' };
      const d = potencial(a) - potencial(b);
      if (ga === 'AC') return { ok: true, valor: Math.abs(d), vdc: 0, vac: Math.abs(d), tipo: 'AC', texto: `${Math.abs(d).toFixed(1)} V alterna` };
      return { ok: true, valor: d, vdc: d, vac: 0, tipo: 'DC', texto: `${d.toFixed(2)} V continua` };
    }

    /** Números sueltos para las burbujas y lecturas. */
    function medidas() {
      const m = {};
      for (const c of E.campos.A.cadenas.concat(E.campos.B.cadenas)) {
        m[`${c.id}.v`] = c.v; m[`${c.id}.i`] = c.i; m[`${c.id}.p`] = c.p; m[`${c.id}.voc`] = c.voc;
        for (const p of c.paneles) { m[`${p.tag}.v`] = p.v; m[`${p.tag}.t`] = p.tempCelulaC; m[`${p.tag}.p`] = p.p; }
      }
      m['STR-202.conectorC'] = ctx.temperaturaConectorC;
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
    return { potencial, continuidad, medir, medidas };
  }

  const api = { PUNTOS, GRUPO, crearMedidas };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { const P = (window.PCT = window.PCT || {}); (P.fv = P.fv || {}).medidas = api; }
})();
