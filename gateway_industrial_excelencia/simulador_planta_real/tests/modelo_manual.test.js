'use strict';
// Modo MANUAL y llenados en la simulación completa: niveles reales, inercia del agua, producto no conforme y averías en manual.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { crearSimulacion, plantaEnProduccion } = require('./modelo_ayuda.js');
const { CONSTANTES: C } = require('../js/configuracion/constantes.js');
const layout = require('../js/layout.js');

const sim0 = () => { const s = crearSimulacion(); s.ordenes.modo('MANUAL'); s.paso(1); return s; };
const manual = (s, tags) => { for (const [t, v] of Object.entries(tags)) s.ordenes.manual(t, v); };

test('el estado inicial tiene los equipos nuevos, el nivel del agua caliente y el modo MANUAL es seleccionable', () => {
  const e = crearSimulacion().estado();
  for (const tag of ['XV-101', 'XV-102', 'XV-302', 'XV-303']) assert.equal(e.equipos[tag].abierta, false, tag);
  assert.equal(e.aguaCaliente.nivelPct, 100); assert.equal(e.aguaCaliente.volumenL, C.aguaCaliente.capacidadL);
  assert.equal(e.equipos['HW-101'].nivelPct, 100); assert.equal(e.equipos['LSL-301'].contactoCerrado, true);
  const s = sim0(); assert.equal(s.estado().modo, 'MANUAL');
  assert.ok(s.estado().alarmas.some(a => a.codigo === 'M100'));
});

test('el tanque de balance se llena con XV-101 y se vacía con XV-102; en MANUAL no se repone solo', () => {
  const s = sim0(); const v0 = s.estado().tanque.volumenL;
  s.paso(60); assert.ok(Math.abs(s.estado().tanque.volumenL - v0) < 0.01, 'sin órdenes el nivel no cambia');
  manual(s, { 'XV-101': 1 }); s.paso(30);
  const lleno = s.estado().tanque.volumenL;
  assert.ok(lleno > v0 + 20, `${lleno} > ${v0}`);                              // 2600 L/h = 21,7 L en 30 s
  assert.equal(s.estado().equipos['XV-101'].abierta, true);
  manual(s, { 'XV-101': 0, 'XV-102': 1 }); s.paso(30);
  assert.ok(s.estado().tanque.volumenL < lleno - 15);
  s.paso(300); assert.equal(s.estado().tanque.volumenL, 0); assert.equal(s.estado().tanque.nivelPct, 0);
  assert.equal(s.senales().DI['LSL-101'], 0);
});

test('el tanque de balance tiene rebosadero: con XV-101 abierta no pasa del 100 % y se marca desbordando', () => {
  const s = sim0(); manual(s, { 'XV-101': 1 }); s.paso(600);
  assert.equal(s.estado().tanque.nivelPct, 100); assert.equal(s.estado().equipos['TK-101'].desbordando, true);
  assert.equal(s.senales().DI['LSH-101'], 1);
});

test('en automático el PLC repone el tanque con XV-101 como antes (bajar el nivel y esperar)', () => {
  const s = crearSimulacion(); s.paso(300);
  assert.ok(s.estado().tanque.nivelPct >= C.tanque.reponerHastaPct - 1, `${s.estado().tanque.nivelPct}`);
  assert.equal(s.estado().equipos['XV-101'].abierta, false, 'al llegar al 95 % cierra');
});

test('el depósito de agua caliente: XV-303 lo vacía, LSL-301 abre su contacto y se corta el calentador; XV-302 lo llena y baja la temperatura', () => {
  const s = sim0(); manual(s, { 'P-102': 1, 'KM-201': 1, 'KM-202': 1 }); s.paso(120);
  assert.ok(s.estado().equipos['HW-101'].banco1, 'el calentador funciona con agua');
  manual(s, { 'XV-303': 1 }); s.paso(60);
  const e = s.estado();
  assert.ok(e.aguaCaliente.nivelPct < 90, `${e.aguaCaliente.nivelPct}`);                       // 1800 L/h = 30 L/min sobre 150 L
  s.paso(200);
  assert.ok(s.estado().aguaCaliente.nivelPct < C.aguaCaliente.nivelBajoPct);
  assert.equal(s.senales().DI['LSL-301'], 0);
  assert.equal(s.estado().equipos['HW-101'].banco1, false, 'sin nivel el PLC corta el calentador aunque el operador lo pida');
  assert.ok(s.estado().alarmas.some(a => a.codigo === 'A230'));
  manual(s, { 'KM-201': 0, 'KM-202': 0 }); s.paso(1);                                       // los bancos pedidos recalentarían el poco agua que queda
  const tAntesDeLlenar = s.estado().proceso.temperaturas.aguaCaliente;
  manual(s, { 'XV-303': 0, 'XV-302': 1 }); s.paso(120);       // si los bancos siguieran pedidos, al recuperar el nivel el calentador volvería a conectar
  assert.ok(s.estado().aguaCaliente.nivelPct > 40);
  assert.ok(s.estado().proceso.temperaturas.aguaCaliente < tAntesDeLlenar - 3, 'el agua de red entra fría y enfría el depósito');
  s.paso(300); assert.equal(s.estado().aguaCaliente.nivelPct, 100);                          // rebosadero
});

test('con menos agua el depósito se calienta más deprisa (menos inercia)', () => {
  const calentar = (vaciarSegundos) => {
    const s = sim0();
    if (vaciarSegundos) { manual(s, { 'XV-303': 1 }); s.paso(vaciarSegundos); manual(s, { 'XV-303': 0 }); }
    manual(s, { 'P-102': 1 });                                                           // sin calentador aún
    const t0 = s.estado().proceso.temperaturas.aguaCaliente;
    manual(s, { 'KM-201': 1, 'KM-202': 1 }); s.paso(30);
    return { subida: s.estado().proceso.temperaturas.aguaCaliente - t0, nivel: s.estado().aguaCaliente.nivelPct };
  };
  const lleno = calentar(0), medio = calentar(90);
  assert.ok(medio.nivel < 80 && medio.nivel > C.aguaCaliente.nivelBajoPct, `nivel ${medio.nivel}`);
  assert.ok(medio.subida > lleno.subida * 1.2, `${medio.subida} vs ${lleno.subida}`);
});

// Receta manual realista: primero se calienta el agua sola (con leche fría circulando los bancos de 60 kW no alcanzan), luego se arranca la leche con la FDV en desvío
// y cuando TT-103 supera los 72 °C se pasa la FDV a avance.
function calentarAguaSola(s, segundos = 900) { manual(s, { 'P-102': 1, 'KM-201': 1, 'KM-202': 1 }); s.paso(segundos); }
const arrancarLeche = (s, velocidad = 40) => manual(s, { 'P-101': 1, 'VFD-101': velocidad, 'XV-101': 1 });     // XV-101 abierta: en manual nadie repone el tanque

test('MANUAL: el operador pone la planta en marcha a mano (agua, calentador, P-101) y circula leche con la FDV en desvío', () => {
  const s = sim0(); calentarAguaSola(s);
  assert.ok(s.estado().proceso.temperaturas.aguaCaliente > 80, `${s.estado().proceso.temperaturas.aguaCaliente}`);
  assert.equal(s.estado().proceso.caudalLh, 0);
  arrancarLeche(s); s.paso(300);
  const e = s.estado();
  assert.equal(e.modo, 'MANUAL');
  assert.ok(Math.abs(e.proceso.caudalLh - 1000) < 50, `${e.proceso.caudalLh}`);                // 40 % de 2500 L/h
  assert.ok(e.proceso.temperaturas.salidaTubo > 60, `${e.proceso.temperaturas.salidaTubo}`);
  assert.equal(e.equipos['FDV-101'].posicion, 'DESVIO', 'la FDV no se gobierna sola');
  assert.equal(e.contadores.producidoL, 0, 'por el desvío no se produce');
});

test('MANUAL: producto por la FDV sin condiciones cuenta como NO CONFORME; con 72 °C y 15 s cuenta como conforme', () => {
  const s = sim0();
  manual(s, { 'P-102': 1, 'SV-101': 1 }); arrancarLeche(s, 80);                         // sin calentar: leche fría por la FDV
  s.paso(60);
  assert.ok(s.estado().contadores.noConformeL > 10, `${s.estado().contadores.noConformeL}`);
  assert.ok(s.estado().alarmas.some(a => a.codigo === 'A220'));
  // Caliente: conforme una vez que se cumplen las condiciones
  const b = sim0(); calentarAguaSola(b); arrancarLeche(b); b.paso(300);
  manual(b, { 'SV-101': 1 }); b.paso(90);                                                // la transición (TT-103 sube de 65 a 72 °C) sí cuenta como no conforme
  assert.ok(b.estado().proceso.pasteurizadoReal);
  const n0 = b.estado().contadores.noConformeL, p0 = b.estado().contadores.producidoL; b.paso(120);
  assert.ok(b.estado().contadores.producidoL - p0 > 30);
  assert.ok(b.estado().contadores.noConformeL - n0 < 0.5, 'conforme una vez en condiciones');
  assert.ok(!b.estado().alarmas.some(a => a.codigo === 'A220'));
});

test('MANUAL: cambiar a automático suelta las órdenes y el PLC recupera el mando; volver a MANUAL parte de lo que hacía', () => {
  const s = sim0(); manual(s, { 'P-102': 1, 'P-101': 1, 'VFD-101': 40 }); s.paso(20);
  s.ordenes.modo('RECIRCULACION_AGUA'); s.paso(5);
  assert.equal(s.estado().modo, 'RECIRCULACION_AGUA');
  assert.equal(s.estado().salidasPLC.AO['VFD-101'], 100 * C.proceso.caudalNominalLh / C.p101.caudalMaximoLh);   // consigna automática, no los 40 % manuales
  s.ordenes.modo('MANUAL'); s.paso(5);
  assert.equal(s.estado().modo, 'MANUAL');
  assert.equal(s.estado().salidasPLC.DO['P-101'], 1, 'transferencia sin saltos');
  assert.equal(s.estado().salidasPLC.AO['VFD-101'], 100 * C.proceso.caudalNominalLh / C.p101.caudalMaximoLh);
});

test('MANUAL: parar vuelve a PARADA y suelta las órdenes manuales', () => {
  const s = sim0(); manual(s, { 'P-102': 1, 'P-101': 1, 'VFD-101': 60 }); s.paso(30);
  assert.ok(s.estado().proceso.caudalLh > 100);
  s.ordenes.parar(); s.paso(60);
  assert.equal(s.estado().modo, 'PARADA');
  assert.ok(s.estado().proceso.caudalLh < 1);
  assert.equal(s.estado().salidasPLC.DO['P-102'], 0);
});

test('MANUAL: las averías siguen afectando igual (fusible F-201 fundido: 0 V y la planta se para)', () => {
  const s = sim0(); manual(s, { 'P-102': 1, 'P-101': 1, 'VFD-101': 60 }); s.paso(30);
  assert.ok(s.estado().proceso.caudalLh > 100);
  s.averias.inyectar('AV-FUSIBLE-F201'); s.paso(10);
  assert.equal(s.medidas.medir('multimetro', 'F-201:SALIDA', null, 'V').valor, 0);
  assert.equal(s.estado().plc.paro, true);
  assert.equal(s.estado().equipos['P-101'].marcha, false);
});

test('MANUAL: el paro de emergencia apaga todo (también las válvulas de llenado) hasta rearmar', () => {
  const s = sim0(); manual(s, { 'XV-101': 1, 'XV-302': 1, 'P-102': 1 }); s.paso(5);
  assert.equal(s.estado().equipos['XV-101'].abierta, true);
  s.ordenes.paroEmergencia(true); s.paso(2);
  for (const v of ['XV-101', 'XV-102', 'XV-302', 'XV-303']) assert.equal(s.estado().equipos[v].abierta, false, v);
  assert.equal(s.estado().equipos['P-102'].marcha, false);
});

test('los puntos de medida de las válvulas nuevas y del flotador LSL-301 existen y se miden', () => {
  const s = sim0(); manual(s, { 'XV-302': 1 }); s.paso(2);
  const ids = s.medidas.puntos.map(p => p.id);
  for (const id of ['XV-101:BORNAS', 'XV-102:BORNAS', 'XV-302:BORNAS', 'XV-303:BORNAS', 'XV-302:BOBINA', 'XV-301:BORNAS', 'LSL-301:CONTACTO']) assert.ok(ids.includes(id), id);
  assert.equal(s.medidas.medir('multimetro', 'XV-302:BORNAS', null, 'V').valor, 24);
  assert.equal(s.medidas.medir('multimetro', 'XV-303:BORNAS', null, 'V').valor, 0);
  assert.equal(s.medidas.medir('multimetro', 'XV-302:BOBINA', null, 'ohm').valor, C.electrico.resistenciaBobinaXVOhm);
  assert.equal(s.medidas.medir('multimetro', 'LSL-301:CONTACTO', null, 'continuidad').continuidad, true);
  manual(s, { 'XV-302': 0, 'XV-303': 1 }); s.paso(300);
  assert.equal(s.medidas.medir('multimetro', 'LSL-301:CONTACTO', null, 'continuidad').continuidad, false);
});

test('la producción automática sigue funcionando con los nuevos niveles (regresión)', () => {
  const s = plantaEnProduccion();
  assert.equal(s.estado().modo, 'PRODUCCION'); assert.equal(s.estado().equipos['FDV-101'].posicion, 'AVANCE');
  assert.ok(s.estado().aguaCaliente.nivelPct > 99);
  assert.equal(s.estado().contadores.noConformeL, 0);
});

test('los equipos y señales nuevos están en el layout con canal, tipo y posición', () => {
  for (const tag of ['XV-101', 'XV-102', 'XV-302', 'XV-303', 'LSL-301']) { assert.ok(layout.equipo(tag), tag); assert.ok(layout.posicion(tag), `posición ${tag}`); assert.ok(layout.senal(tag).length, `señal ${tag}`); }
  for (const tag of ['XV-101', 'XV-102', 'XV-302', 'XV-303']) assert.equal(layout.senal(tag)[0].tipo, 'DO');
  assert.equal(layout.senal('LSL-301')[0].tipo, 'DI');
  const canales = layout.SENALES.map(s => s.canal); assert.equal(new Set(canales).size, canales.length, 'canales repetidos');
});
