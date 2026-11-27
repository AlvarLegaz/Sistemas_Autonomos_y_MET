// Identificación del gemelo térmico de la PCT23 con una ejecución real (CSV del sinóptico).
// Modelo de parámetros concentrados (nodos térmicos de 1er orden) simulado con las MISMAS entradas que tuvo la maqueta;
// los parámetros se ajustan por mínimos cuadrados (Nelder-Mead) sobre el error de simulación de T1..T5.
// Uso: node ajustar.js <csv> [salida.json]
const fs = require('fs');
const { cargar } = require('./datos.js');
const [csv, salidaJson] = process.argv.slice(2);
const serie = cargar(csv);

// Parámetros: nombre, valor inicial, mínimo, máximo. Las constantes de tiempo se buscan en escala logarítmica.
const P = [
  ['ambienteC', 20.5, 15, 26],
  ['subidaC', 150, 30, 400],          // subida del nodo caliente con el calefactor al 100 % (régimen sin pérdidas internas)
  ['tauCalentadorS', 1500, 100, 20000],  // constante del nodo caliente (calefactor + agua del circuito de N2)
  ['mezclaS', 600, 30, 20000],        // intercambio nodo caliente <-> depósito (donde está T2), con N2 en marcha
  ['mezclaParadaS', 3000, 100, 50000], // ese intercambio con N2 parada (solo convección)
  ['relacionMasas', 0.5, 0.05, 5],    // C_caliente / C_deposito: cuánto mueve el mismo calor a T2
  ['perdidasDepositoS', 15000, 1000, 200000], // pérdidas del depósito (T2) al ambiente
  ['acoplamiento', 0.15, 0, 2],       // calor que el producto quita al nodo caliente (por unidad de caudal relativo)
  ['eficiencia', 0.8, 0.2, 1.0],      // T4 = amb + eficiencia·(Tcaliente - amb)
  ['tauT4S', 30, 2, 600],
  ['retencionT1', 0.95, 0.5, 1.05],   // T1 = amb + retencion·(T4 - amb)
  ['tauT1S', 40, 2, 900],
  ['recuperacionT3', 0.35, 0, 1],     // T3 = amb + recuperacion·(T1 - amb) con SOL1 a salida normal y sin frío
  ['tauT3S', 150, 5, 2000],
  ['tauParadoT4S', 1200, 100, 6000],  // producto quieto (bombas paradas) enfriándose
  ['tauParadoT1S', 900, 100, 6000],
  ['tauParadoT3S', 900, 100, 6000],
  ['gananciaT5', 0.05, 0, 1],         // T5 = amb + ganancia·(T2 - amb)
  ['tauT5S', 2000, 50, 50000],
];
const ESCALA_LOG = n => n.endsWith('S');

function simular(p, registrar) {
  const a = p.ambienteC;
  const f0 = serie[0];
  let th = f0.T2_C, tw = f0.T2_C, t4 = f0.T4_C, t1 = f0.T1_C, t3 = f0.T3_C, t5 = f0.T5_C;
  let err = 0, n = 0;
  const pesos = { T1: 1, T2: 1.5, T3: 0.7, T4: 1, T5: 0.4 };
  const lag = (x, obj, tau) => x + (obj - x) * (1 - Math.exp(-1 / tau));
  for (const f of serie) {
    if (f.t > 0) {
      const pot = f.RES ? f.potencia_RES_pct / 100 : 0;
      const circula = f.N1 && f.velocidad_N1_pct > 0;
      const fr = circula ? f.velocidad_N1_pct / 100 : 0;
      const qcal = f.N2 && circula ? p.acoplamiento * fr : 0;
      const mez = 1 / (f.N2 ? p.mezclaS : p.mezclaParadaS);
      // Nodo caliente: calefactor, intercambio con el depósito y calor cedido al producto.
      const dth = (a + p.subidaC * pot - th) / p.tauCalentadorS - mez * (th - tw) - qcal * (th - a) / p.tauCalentadorS * 10;
      const dtw = mez * p.relacionMasas * (th - tw) - (tw - a) / p.perdidasDepositoS;
      th += dth; tw += dtw;
      if (circula) {
        const ef = f.N2 ? p.eficiencia : 0.08;
        t4 = lag(t4, a + ef * (th - a), p.tauT4S);
        t1 = lag(t1, a + p.retencionT1 * (t4 - a), p.tauT1S);
        const normal = !!f.SOL1;                      // maqueta: SOL1 activa = salida normal (pasa por regeneración/enfriamiento hacia T3)
        const frio = f.SOL3 ? (1 - 0.77) / (1 - 0.09) : 1;
        t3 = lag(t3, normal ? a + p.recuperacionT3 * frio * (t1 - a) : a, normal ? p.tauT3S : p.tauParadoT3S);
      } else {
        t4 = lag(t4, a, p.tauParadoT4S);
        t1 = lag(t1, a, p.tauParadoT1S);
        t3 = lag(t3, a, p.tauParadoT3S);
      }
      t5 = lag(t5, a + p.gananciaT5 * (tw - a), p.tauT5S);
    }
    if (f.medida) {
      const r = { T1: t1, T2: tw, T3: t3, T4: t4, T5: t5 };
      for (const s in pesos) { const d = r[s] - f[`${s}_C`]; err += pesos[s] * d * d; }
      n++;
      if (registrar) registrar(f, r, th);
    }
  }
  return err / n;
}

// ---- Nelder-Mead sobre parámetros normalizados (log para constantes de tiempo), con límites por recorte ----
const aX = v => P.map(([nm], i) => (ESCALA_LOG(nm) ? Math.log(v[i]) : v[i]));
const deX = x => Object.fromEntries(P.map(([nm, , lo, hi], i) => [nm, Math.min(hi, Math.max(lo, ESCALA_LOG(nm) ? Math.exp(x[i]) : x[i]))]));
const coste = x => simular(deX(x));

function nelderMead(f, x0, paso, iter) {
  const n = x0.length;
  let s = [x0, ...x0.map((_, i) => x0.map((v, j) => v + (i === j ? paso[i] : 0)))].map(x => ({ x, f: f(x) }));
  for (let k = 0; k < iter; k++) {
    s.sort((u, v) => u.f - v.f);
    const c = s[0].x.map((_, j) => s.slice(0, n).reduce((t, p) => t + p.x[j], 0) / n);
    const peor = s[n];
    const pto = t => c.map((v, j) => v + t * (peor.x[j] - v));
    const r = { x: pto(-1) }; r.f = f(r.x);
    if (r.f < s[0].f) { const e = { x: pto(-2) }; e.f = f(e.x); s[n] = e.f < r.f ? e : r; }
    else if (r.f < s[n - 1].f) s[n] = r;
    else { const co = { x: pto(0.5) }; co.f = f(co.x);
      if (co.f < peor.f) s[n] = co; else s = s.map((p, i) => (i === 0 ? p : { x: p.x.map((v, j) => s[0].x[j] + 0.5 * (v - s[0].x[j])), f: NaN })).map(p => (isNaN(p.f) ? { x: p.x, f: f(p.x) } : p)); }
  }
  s.sort((u, v) => u.f - v.f);
  return s[0];
}

let x = aX(P.map(p => p[1]));
const paso = P.map(([nm, v]) => (ESCALA_LOG(nm) ? 0.7 : Math.max(0.1, Math.abs(v) * 0.3)));
let mejor = { x, f: coste(x) };
console.log('coste inicial', mejor.f.toFixed(3));
for (let ronda = 0; ronda < 8; ronda++) {           // reinicios: Nelder-Mead se atasca en mínimos locales con tantos parámetros
  const r = nelderMead(coste, mejor.x, paso, 3000);
  if (r.f < mejor.f) mejor = r;
  console.log(`ronda ${ronda}: coste ${mejor.f.toFixed(4)}`);
}
const p = deX(mejor.x);
const errores = { T1: [], T2: [], T3: [], T4: [], T5: [] };
const filas = [];
simular(p, (f, r, th) => {
  for (const s in errores) errores[s].push(r[s] - f[`${s}_C`]);
  if (f.t % 120 === 0) filas.push(`${String(f.t).padStart(5)}  ` + Object.keys(errores).map(s => `${s} ${f[`${s}_C`].toFixed(1)}/${r[s].toFixed(1)}`).join('  ') + `  Tcal ${th.toFixed(1)}`);
});
const rmse = a => Math.sqrt(a.reduce((u, v) => u + v * v, 0) / a.length);
console.log('t(s)   real/modelo ajustado');
console.log(filas.join('\n'));
console.log('RMSE (°C):', Object.keys(errores).map(s => `${s}=${rmse(errores[s]).toFixed(2)}`).join('  '));
console.log(JSON.stringify(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, +v.toPrecision(4)])), null, 1));
if (salidaJson) fs.writeFileSync(salidaJson, JSON.stringify(p, null, 1));
