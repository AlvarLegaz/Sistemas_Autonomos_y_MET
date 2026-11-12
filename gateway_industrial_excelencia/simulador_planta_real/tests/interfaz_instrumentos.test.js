'use strict';
// Pruebas de la interfaz de la planta real: puntos de medida, multímetro y osciloscopio virtuales (lógica pura, con el modelo real cuando hace falta).
const assert = require('node:assert/strict');
const { test } = require('node:test');
const layout = require('../js/layout.js');
const puntos = require('../js/interfaz/puntos_medida.js');
const mm = require('../js/interfaz/multimetro.js');
const osc = require('../js/interfaz/osciloscopio.js');
const { crearSimulacion } = require('../js/modelo/simulacion.js');

const simConAveria = (id, parametros) => { const sim = crearSimulacion({ semilla: 1 }); if (id) assert.ok(sim.averias.inyectar(id, parametros)); sim.paso(1); return sim; };

test('los puntos de medida derivados del contrato tienen id único, equipo existente y modo', () => {
  const lista = puntos.puntosDeMedida(layout);
  assert.equal(new Set(lista.map(p => p.id)).size, lista.length);
  for (const p of lista) { assert.ok(layout.equipo(p.equipo), `${p.id}: equipo ${p.equipo} inexistente`); assert.ok(['V', 'mA', 'ohm', 'temperatura', 'presion'].includes(p.modo), p.id); }
  assert.ok(lista.some(p => p.id === 'F-001:SALIDA') && lista.some(p => p.id === 'TT-103:PT100'));
});

test('con el modelo cargado los puntos son los suyos (sim.medidas.puntos) y cada uno tiene modo natural', () => {
  const sim = crearSimulacion({ semilla: 1 });
  const lista = puntos.puntosDisponibles(sim);
  assert.equal(lista.length, sim.medidas.puntos.length);
  const fusible = lista.find(p => p.id === 'F-001:FUSIBLE');
  assert.equal(fusible.modo, 'continuidad');
  assert.equal(fusible.equipo, 'F-001');
  assert.equal(puntos.puntosDeEquipo('F-001', lista).length, 3);
});

test('el multímetro formatea con unidades y OL en circuito abierto', () => {
  assert.equal(mm.formatear('V', 24), '24,00 V');
  assert.equal(mm.formatear('V', 0.612), '612 mV');
  assert.equal(mm.formatear('mA', 12.04), '12,04 mA');
  assert.equal(mm.formatear('ohm', 107.9), '107,9 Ω');
  assert.equal(mm.formatear('ohm', 4700), '4,70 kΩ');
  assert.equal(mm.formatear('ohm', Infinity), 'OL');
  assert.equal(mm.formatear('V', null), 'OL');
  assert.equal(mm.formatear('temperatura', 72), '72,0 °C');
});

test('interpretarMedida entiende la forma del modelo y las medidas no válidas', () => {
  assert.deepEqual(mm.interpretarMedida({ ok: true, valor: 24, texto: '24 V' }), { ok: true, valor: 24, texto: '24 V', continuidad: false });
  assert.equal(mm.interpretarMedida({ ok: false, texto: 'Modo V no válido' }).ok, false);
  assert.equal(mm.interpretarMedida(null).ok, false);
  assert.equal(mm.interpretarMedida(5).valor, 5);
});

test('avisos de seguridad: ohmios sin tensión, mA en serie, punto con otra función natural', () => {
  assert.match(mm.avisosDeUso('ohm', { modo: 'ohm' }).join(' '), /SIN tensión/);
  assert.match(mm.avisosDeUso('mA', { modo: 'mA' }).join(' '), /EN SERIE/);
  assert.match(mm.avisosDeUso('V', { modo: 'ohm' }).join(' '), /normalmente/);
  assert.match(mm.avisosDeUso('V', null).join(' '), /Elige/);
});

test('multímetro con el modelo real: el fusible fundido se diagnostica midiendo antes y después', () => {
  const sana = simConAveria(null), averiada = simConAveria('AV-FUSIBLE-F201');
  const lee = (sim, punto, modo) => mm.leerMultimetro(sim, { modo, punto });
  assert.equal(lee(sana, 'F-001:SALIDA', 'V').texto, '24,00 V');
  assert.equal(lee(averiada, 'F-001:ENTRADA', 'V').texto, '24,00 V');           // antes del fusible hay tensión...
  assert.equal(lee(averiada, 'F-001:SALIDA', 'V').valor, 0);                    // ...y después no
  assert.equal(lee(averiada, 'F-001:FUSIBLE', 'continuidad').texto, 'OL');
  assert.equal(lee(averiada, 'F-001:FUSIBLE', 'continuidad').continuidad, false);
  assert.equal(lee(sana, 'F-001:FUSIBLE', 'continuidad').continuidad, true);
});

test('multímetro: una función equivocada da ERR con la pista del modelo, y sin modelo avisa', () => {
  const sim = simConAveria(null);
  const r = mm.leerMultimetro(sim, { modo: 'ohm', punto: 'F-001:SALIDA' });
  assert.equal(r.texto, 'ERR');
  assert.match(r.aviso, /usa V/);
  assert.match(mm.leerMultimetro(null, { modo: 'V', punto: 'x' }).aviso, /no está cargado/);
});

test('la Pt100 abierta se ve en ohmios (OL) y la sana da unos 100 Ω a 0 °C', () => {
  const abierta = simConAveria('AV-PT100-ABIERTA', { tag: 'TT-102' });
  assert.equal(mm.leerMultimetro(abierta, { modo: 'ohm', punto: 'TT-102:PT100' }).texto, 'OL');
  const sana = mm.leerMultimetro(simConAveria(null), { modo: 'ohm', punto: 'TT-102:PT100' });
  assert.ok(sana.valor > 100 && sana.valor < 120, String(sana.valor));
});

test('osciloscopio: onda continua con rizado, medidas de la onda y escalas', () => {
  const m = osc.muestrearOnda({ tipo: 'cc', nivel: 24, rizado: 1 }, 0.005, 400, 3);
  const med = osc.medidasDeOnda(m, 0.005);
  assert.ok(Math.abs(med.media - 24) < 0.1);
  assert.ok(med.picoAPico > 0.8 && med.picoAPico < 1.1, String(med.picoAPico));
  assert.ok(Math.abs(med.frecuenciaHz - 100) < 15, String(med.frecuenciaHz));
  const cc = osc.escalaVertical(m, 'CC'), ca = osc.escalaVertical(osc.sinContinua(m), 'CA');
  assert.ok(ca.vPorDiv < cc.vPorDiv);                          // en CA se amplía la variación
  assert.ok(Math.abs(ca.centro) < 1e-9);
});

test('osciloscopio: el ruido es repetible con la misma semilla y distinto con otra', () => {
  const a = osc.muestrearOnda({ tipo: 'cc', nivel: 12, ruidoRms: 0.5 }, 0.001, 50, 5), b = osc.muestrearOnda({ tipo: 'cc', nivel: 12, ruidoRms: 0.5 }, 0.001, 50, 5), c = osc.muestrearOnda({ tipo: 'cc', nivel: 12, ruidoRms: 0.5 }, 0.001, 50, 6);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('osciloscopio: PWM y números bonitos', () => {
  const pwm = osc.muestrearOnda({ tipo: 'pwm', amplitud: 10, frecuenciaHz: 1000, duty: 0.25 }, 0.0001, 400, 1);
  const altos = pwm.filter(v => v > 5).length / pwm.length;
  assert.ok(Math.abs(altos - 0.25) < 0.03, String(altos));
  assert.equal(osc.numeroBonito(0.7), 1); assert.equal(osc.numeroBonito(1.3), 2); assert.equal(osc.numeroBonito(3), 5); assert.equal(osc.numeroBonito(6), 10);
  assert.equal(osc.formatoSI(0.05, 'V'), '50,0 mV'); assert.equal(osc.formatoSI(24, 'V'), '24,0 V');
  assert.equal(osc.formatoSI(0.01, 'mA'), '10,0 µA'); assert.equal(osc.formatoSI(12, 'mA'), '12,0 mA');       // nunca «mmA»
});

test('osciloscopio con el modelo real: interpreta la onda (dtMs) y solo ofrece los puntos que tienen onda', () => {
  const sim = simConAveria('AV-RUIDO-4-20', { tag: 'FT-101' });
  const bruto = sim.medidas.medir('osciloscopio', 'FT-101:LAZO', null, 'onda');
  const onda = osc.interpretarOnda(bruto);
  assert.equal(onda.muestras.length, 200);
  assert.ok(Math.abs(onda.intervaloS - 0.0001) < 1e-9);
  const ruidosa = osc.medidasDeOnda(onda.muestras, 0.005).picoAPico;
  const sana = osc.medidasDeOnda(osc.interpretarOnda(simConAveria(null).medidas.medir('osciloscopio', 'FT-101:LAZO', null, 'onda')).muestras, 0.005).picoAPico;
  assert.ok(ruidosa > 10 * sana, `${ruidosa} frente a ${sana}`);                 // el ruido del variador se nota
  const conOnda = osc.puntosConOnda(sim, puntos.puntosDisponibles(sim));
  assert.ok(conOnda.length >= 3 && conOnda.length < puntos.puntosDisponibles(sim).length);
  assert.ok(conOnda.some(p => p.id === 'PS-001:SALIDA'));
});

test('osciloscopio: una medida no válida del modelo no dibuja una onda inventada', () => {
  assert.equal(osc.interpretarOnda({ ok: false, texto: 'Sin onda' }).vacio, true);
  assert.equal(osc.interpretarOnda(null).vacio, true);
});
