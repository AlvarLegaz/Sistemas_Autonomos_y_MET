// Formato de potencias, energías, reloj solar y fechas; subdivisión de pasos de la simulación; selección de estados visuales.
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../js/interfaz/formato_fv.js');

test('potencias: vatios por debajo de 1 kW y kilovatios con coma decimal por encima', () => {
  assert.equal(F.formatoPotencia(0), '0 W');
  assert.equal(F.formatoPotencia(850.4), '850 W');
  assert.equal(F.formatoPotencia(2410), '2,41 kW');
  assert.equal(F.formatoPotencia(-1234), '-1,23 kW');
  assert.equal(F.formatoPotencia(999.7), '1,00 kW');
  assert.equal(F.formatoPotencia(12500), '12,5 kW');
  assert.equal(F.formatoPotencia(NaN), '—');
  assert.equal(F.formatoPotencia(undefined), '—');
});

test('energías: Wh por debajo de 1 kWh y kWh con dos decimales por encima', () => {
  assert.equal(F.formatoEnergia(420), '420 Wh');
  assert.equal(F.formatoEnergia(2560), '2,56 kWh');
  assert.equal(F.formatoEnergia(123456), '123,5 kWh');
  assert.equal(F.formatoEnergia(null), '—');
});

test('tensión, corriente, porcentaje y temperatura llevan su unidad y coma decimal', () => {
  assert.equal(F.formatoTension(26.74), '26,7 V');
  assert.equal(F.formatoCorriente(7.826), '7,83 A');
  assert.equal(F.formatoPorcentaje(0.853), '85 %');
  assert.equal(F.formatoTemperatura(41.6), '42 °C');
  assert.equal(F.dec(-0.04, 1), '0,0');
});

test('reloj solar: hora decimal a hh:mm y «21 jun · 09:30»', () => {
  assert.equal(F.formatoHora(9.5), '09:30');
  assert.equal(F.formatoHora(0), '00:00');
  assert.equal(F.formatoHora(23.999), '00:00');
  assert.equal(F.formatoHora(13.25), '13:15');
  assert.equal(F.formatoReloj(172, 9.5), '21 jun · 09:30');
  assert.equal(F.formatoReloj(355, 18), '21 dic · 18:00');
});

test('fechas: día del año y valor de <input type="date"> son inversos', () => {
  assert.equal(F.diaDelAnio(6, 21), 172);
  assert.equal(F.diaDelAnio(12, 21), 355);
  assert.deepEqual(F.fechaDeDiaAnio(1), { mes: 1, dia: 1 });
  assert.deepEqual(F.fechaDeDiaAnio(365), { mes: 12, dia: 31 });
  for (let d = 1; d <= 365; d += 17) assert.equal(F.deValorFecha(F.aValorFecha(d)), d);
  assert.equal(F.deValorFecha('nada'), null);
});

test('subdivisión: pasos de a lo sumo 5 s que suman el tiempo pedido', () => {
  assert.deepEqual(F.subdividir(0), []);
  assert.deepEqual(F.subdividir(0.25), [0.25]);
  const p = F.subdividir(900);                      // ×3600 durante 250 ms
  assert.equal(p.length, 180);
  assert.ok(p.every(x => x <= 5 + 1e-9));
  assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 900) < 1e-6);
  assert.equal(F.subdividir(150).length, 30);      // ×600
  assert.equal(F.subdividir(1e9, 5, 100).length, 100);   // con tope de pasos
});

test('duración y gravedad de los estados', () => {
  assert.equal(F.formatoDuracion(30), '30 s');
  assert.equal(F.formatoDuracion(600), '10 min');
  assert.equal(F.formatoDuracion(11100), '3 h 05 min');
  assert.equal(F.peor('ok', 'aviso'), 'aviso');
  assert.equal(F.peor('parado', 'ok', 'alarma', 'aviso'), 'alarma');
  assert.equal(F.peor('parado', 'ok'), 'ok');
});
