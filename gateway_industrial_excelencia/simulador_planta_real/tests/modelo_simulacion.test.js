'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const layout = require('../js/layout.js');
const { crearSimulacion, plantaEnProduccion, codigos } = require('./modelo_ayuda.js');

test('el estado cumple el contrato v1: todos los equipos, los instrumentos y las secciones', () => {
  const sim = crearSimulacion();
  sim.paso(1);
  const e = sim.estado();
  assert.equal(e.version, 1);
  for (const clave of ['tiempoS', 'modo', 'tanque', 'proceso', 'equipos', 'instrumentos', 'salidasPLC', 'alarmas', 'contadores', 'averiasActivas']) assert.ok(clave in e, clave);
  for (const eq of layout.EQUIPOS) assert.ok(e.equipos[eq.tag], `falta el equipo ${eq.tag}`);
  for (const s of layout.SENALES.filter(x => x.tipo === 'AI')) { const i = e.instrumentos[s.tag]; assert.ok(i && 'valorProceso' in i && 'mA' in i && 'valorPLC' in i && 'calidad' in i, s.tag); }
  for (const s of layout.SENALES.filter(x => x.tipo === 'DI')) assert.ok('nivel' in e.instrumentos[s.tag], s.tag);
  for (const clave of ['caudalLh', 'temperaturas', 'presiones', 'tiempoResidenciaS']) assert.ok(clave in e.proceso, clave);
  for (const clave of ['entrada', 'trasRegeneracion', 'trasCalentamiento', 'salidaTubo', 'salidaFinal', 'aguaCaliente']) assert.ok(clave in e.proceso.temperaturas, clave);
  for (const clave of ['marcha', 'velocidadPct', 'caudalLh', 'corrienteA', 'temperaturaDisipadorC', 'fallo']) assert.ok(clave in e.equipos['P-101'], clave);
  for (const clave of ['posicion', 'apertura01', 'aireOK']) assert.ok(clave in e.equipos['FDV-101'], clave);
  assert.deepEqual(Object.keys(sim.senales()).sort(), ['AI', 'AO', 'DI', 'DO']);
  assert.equal(layout.POSICIONES_FDV.includes(e.equipos['FDV-101'].posicion), true);
});

test('la planta parada no hace nada: ambiente, sin caudal y FDV en desvío (seguridad positiva)', () => {
  const sim = crearSimulacion(); sim.paso(60);
  const e = sim.estado();
  assert.equal(e.modo, 'PARADA'); assert.equal(e.proceso.caudalLh, 0); assert.equal(e.equipos['FDV-101'].posicion, 'DESVIO');
  assert.ok(Math.abs(e.proceso.temperaturas.aguaCaliente - 20) < 0.01);
  assert.equal(codigos(sim).length, 0);
});

test('arranque: calienta, pasa a producción y estabiliza TT-103 en torno a la consigna con la FDV en avance', () => {
  const sim = plantaEnProduccion();
  const e = sim.estado(), T = e.proceso.temperaturas;
  assert.equal(e.modo, 'PRODUCCION'); assert.equal(e.equipos['FDV-101'].posicion, 'AVANCE');
  assert.ok(T.salidaTubo >= 72 && T.salidaTubo <= 75.5, `TT-103 ${T.salidaTubo.toFixed(1)}`);
  assert.ok(T.trasRegeneracion > 55 && T.trasRegeneracion < 70, `TT-102 ${T.trasRegeneracion.toFixed(1)}`);       // la regeneración precalienta el crudo
  assert.ok(T.salidaFinal < 8, `TT-104 ${T.salidaFinal.toFixed(1)}`);                                            // y el enfriamiento lo deja cerca de 4-5 °C
  assert.ok(e.proceso.tiempoResidenciaS >= 15);
  assert.ok(e.proceso.pasteurizadoReal);
  assert.ok(e.proceso.presiones.pasteurizadoBar - e.proceso.presiones.crudoBar >= 0.07);
  assert.equal(codigos(sim).length, 0, codigos(sim).join(','));
  assert.ok(e.contadores.energiaKWh > 5);
});

test('en producción se cuenta la leche producida sin producto no conforme', () => {
  const sim = plantaEnProduccion(); const antes = sim.estado().contadores.producidoL;
  sim.paso(300);
  const k = sim.estado().contadores;
  assert.ok(k.producidoL - antes > 150, `${k.producidoL - antes} L en 5 min`);       // unos 2000 L/h ≈ 167 L en 5 min
  assert.equal(k.noConformeL, 0);
});

test('si el agua se enfría en producción baja TT-103, la FDV pasa a desvío y se vuelve a recirculación', () => {
  const sim = plantaEnProduccion();
  sim.ordenes.manual('KM-201', 0); sim.ordenes.manual('KM-202', 0);                 // se fuerzan los dos bancos fuera
  let desvio = false;
  for (let t = 0; t < 900; t += 5) { sim.paso(5); if (sim.estado().equipos['FDV-101'].posicion === 'DESVIO') desvio = true; }
  assert.ok(desvio, 'la FDV debió pasar a desvío');
  assert.ok(sim.estado().contadores.desviadoL > 0);
  assert.equal(sim.estado().contadores.noConformeL, 0);                             // la leche floja se desvió, no salió
});

test('paro de emergencia: todo se para, la FDV queda en desvío y solo se rearma con el pulsador', () => {
  const sim = plantaEnProduccion();
  sim.ordenes.paroEmergencia(true); sim.paso(5);
  let e = sim.estado();
  assert.equal(e.equipos['P-101'].marcha, false); assert.equal(e.equipos['FDV-101'].posicion, 'DESVIO');
  assert.equal(e.plc.paro, true);
  for (const [tag, v] of Object.entries(e.salidasPLC.DO)) assert.equal(v, tag === 'HL-001' ? 1 : 0, tag);
  sim.paso(30); assert.ok(sim.estado().proceso.caudalLh < 5);
  sim.ordenes.paroEmergencia(false); sim.paso(5);
  assert.equal(sim.estado().plc.paro, true);                                        // soltar la seta no arranca nada
  sim.ordenes.pulsador('PB-001'); sim.paso(3);
  assert.equal(sim.estado().plc.paro, false); assert.equal(sim.estado().modo, 'PARADA');
});

test('las señales del PLC salen en mA y coinciden con el proceso', () => {
  const sim = plantaEnProduccion(); const s = sim.senales(), e = sim.estado();
  const mA = (v, min, max) => 4 + 16 * (v - min) / (max - min);
  assert.ok(Math.abs(s.AI['TT-103'].mA - mA(e.proceso.temperaturas.salidaTubo, 0, 100)) < 0.05);
  assert.ok(Math.abs(s.AI['FT-101'].mA - mA(e.proceso.caudalLh, 0, 3000)) < 0.2);
  assert.equal(s.DI['ES-001'], 1); assert.equal(s.DI['ZS-101'], 1); assert.equal(s.DI['ZS-102'], 0); assert.equal(s.DO['SV-101'], 1);
  assert.ok(s.AO['VFD-101'] > 70);
});

test('paso(dt) con dt irregulares suma lo mismo que con pasos de 0,1 s', () => {
  const a = crearSimulacion(), b = crearSimulacion();
  a.ordenes.arrancar(); b.ordenes.arrancar();
  a.paso(60); for (let i = 0; i < 24; i++) b.paso(2.5);
  assert.ok(Math.abs(a.estado().tiempoS - b.estado().tiempoS) < 1e-6);
  assert.ok(Math.abs(a.estado().proceso.temperaturas.aguaCaliente - b.estado().proceso.temperaturas.aguaCaliente) < 1e-9);
});

test('dos simulaciones con la misma semilla dan lo mismo y reiniciar() vuelve al principio', () => {
  const a = crearSimulacion({ semilla: 7 }), b = crearSimulacion({ semilla: 7 });
  for (const s of [a, b]) { s.ordenes.arrancar(); s.paso(300); }
  assert.equal(a.estado().proceso.temperaturas.aguaCaliente, b.estado().proceso.temperaturas.aguaCaliente);
  a.reiniciar();
  assert.equal(a.estado().modo, 'PARADA'); assert.equal(a.estado().tiempoS, 0); assert.ok(Math.abs(a.estado().proceso.temperaturas.aguaCaliente - 20) < 1e-9);
});

test('reiniciar conserva las averías salvo que se pida quitarlas', () => {
  const sim = crearSimulacion();
  sim.averias.inyectar('AV-FILTRO-OBSTRUIDO');
  sim.reiniciar(); assert.equal(sim.averias.activas().length, 1);
  sim.reiniciar({ quitarAverias: true }); assert.equal(sim.averias.activas().length, 0);
});

test('el CIP recorre sus pasos con la FDV en avance, XV-401 abierta y termina parando la planta', () => {
  const sim = crearSimulacion();
  sim.ordenes.modo('CIP'); sim.paso(5);
  assert.equal(sim.estado().modo, 'CIP'); assert.equal(sim.estado().equipos['XV-401'].abierta, true);
  sim.paso(60 + 120 + 60 + 120 + 60 + 10);
  assert.equal(sim.estado().modo, 'PARADA'); assert.equal(sim.estado().equipos['XV-401'].abierta, false);
});

test('el tanque de balance no se vacía en una producción larga', () => {
  const sim = plantaEnProduccion(); sim.paso(1800);
  assert.ok(sim.estado().tanque.nivelPct > 30, `${sim.estado().tanque.nivelPct.toFixed(0)} %`);
  assert.equal(codigos(sim).includes('A200'), false);
});

// Regresión del informe del tester: una consigna no numérica se ignora y no contamina el estado con NaN.
test('las consignas no numéricas se ignoran y el estado sigue siendo finito', () => {
  const sim = crearSimulacion();
  sim.ordenes.arrancar();
  for (const malo of [NaN, 'abc', undefined, Infinity * 0]) { sim.ordenes.consignaCaudalLh(malo); sim.ordenes.consignaTemperaturaC(malo); }
  sim.paso(120);
  const e = sim.estado();
  assert.ok(Number.isFinite(e.tanque.volumenL));
  assert.ok(Number.isFinite(e.tanque.nivelPct));
  assert.ok(Number.isFinite(e.plc.consignaAguaC));
  const hayNoFinitos = obj => Object.values(obj).some(v => (typeof v === 'number' && !Number.isFinite(v)) || (v && typeof v === 'object' && hayNoFinitos(v)));
  assert.equal(hayNoFinitos(e.tanque), false);
});
