// Línea base: el modelo ACTUAL del simulador (termica.js + hidraulica.js) alimentado con las entradas del CSV real.
// Uso: node linea_base.js <csv> <carpeta simulador_pct23>
const path = require('path');
const { cargar } = require('./datos.js');
const [csv, sim] = process.argv.slice(2);
const planta = require(path.join(sim, 'js/modelo/planta.js'));
const estadoPlanta = require(path.join(sim, 'js/modelo/estado_planta.js'));

const serie = cargar(csv);
const e = estadoPlanta.crearEstado();
e.depositoAMl = 5000;                                   // el tanque no se vacía en la prueba real
const sal = ['T1', 'T2', 'T3', 'T4', 'T5'];
const err = Object.fromEntries(sal.map(s => [s, []]));
const traza = [];
for (const f of serie) {
  if (f.t > 0) planta.avanzarPaso(e, 1);
  e.salidas.RES = !!f.RES; e.salidas.N1 = !!f.N1; e.salidas.N2 = !!f.N2; e.salidas.SOL3 = !!f.SOL3;
  e.salidas.SOL1 = !f.SOL1;                             // POLARIDAD: en la maqueta SOL1 activa = salida normal; en el simulador activa = desvío
  e.consignas.potenciaPct = f.potencia_RES_pct; e.consignas.velocidadN1Pct = f.velocidad_N1_pct;
  const o = planta.observaciones(e);
  if (f.medida) for (const s of sal) err[s].push(o[s] - f[`${s}_C`]);
  if (f.t % 120 === 0) traza.push(`${String(f.t).padStart(5)}  ` + sal.map(s => `${s} ${f[`${s}_C`].toFixed(1)}/${o[s].toFixed(1)}`).join('  '));
}
const rmse = a => Math.sqrt(a.reduce((x, y) => x + y * y, 0) / a.length);
console.log('t(s)   real/modelo');
console.log(traza.join('\n'));
console.log('RMSE (°C):', sal.map(s => `${s}=${rmse(err[s]).toFixed(2)}`).join('  '));
