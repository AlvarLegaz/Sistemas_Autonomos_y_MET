'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CONSTANTES_FISICAS: C, SALIDAS } = require('../js/configuracion/constantes_fisicas.js');
const { MODOS_REGULACION } = require('../js/configuracion/constantes_control.js');
const { crearEstado, activarEjemplo, ponerLlenado } = require('../js/modelo/estado_planta.js');
const secuencia = require('../js/control/secuencia.js');
const alarmas = require('../js/control/alarmas.js');
const alcanzabilidad = require('../js/control/alcanzabilidad.js');

function correr(sec, s, hasta, maxS = 8000) {
  const vistas = [sec.fase];
  for (let t = 0; t < maxS && !hasta(sec, s); t++) {
    secuencia.paso(sec, s, 1);
    if (vistas[vistas.length - 1] !== sec.fase) vistas.push(sec.fase);
  }
  return vistas;
}

test('Secuencia completa: arranque, precalentamiento, producción, lavado, parada y fin', () => {
  const s = crearEstado(), sec = secuencia.crearSecuencia();
  assert.equal(secuencia.iniciar(sec, s), true);
  const fases = correr(sec, s, x => x.fase === 'finalizada');
  assert.deepEqual(fases, ['arranque', 'precalentamiento', 'produccion', 'lavado', 'parada', 'finalizada']);
  assert.ok(s.finalMl > 1000, `salieron ${s.finalMl.toFixed(0)} ml`);
  assert.ok(s.depositoAMl <= sec.ajustes.volumenAgotadoMl + 5);
  assert.equal(sec.alarma, null);
  assert.ok(s.aguaCalienteC <= sec.ajustes.enfriarHastaC + 1);
  for (const k of SALIDAS) assert.equal(s.salidas[k], false, k);
});

test('Precalentamiento recircula (SOL1 activa): el tanque no baja y no sale producto acabado', () => {
  const s = crearEstado(), sec = secuencia.crearSecuencia();
  secuencia.iniciar(sec, s);
  correr(sec, s, x => x.fase === 'produccion');
  assert.equal(s.finalMl, 0);
  assert.equal(s.depositoAMl, 1760);
  assert.ok(s.desviadoMl > 0);
});

test('En producción T1 se mantiene cerca de la consigna y el producto acabado sale a temperatura', () => {
  const s = crearEstado(), sec = secuencia.crearSecuencia({ volumenObjetivoMl: 900 });
  secuencia.iniciar(sec, s);
  correr(sec, s, x => x.fase === 'produccion');
  let maxDesv = 0, fueraDeBanda = 0;
  for (let t = 0; t < 400 && sec.fase === 'produccion'; t++) {
    secuencia.paso(sec, s, 1);
    if (t > 60) maxDesv = Math.max(maxDesv, Math.abs(s.t1C - sec.ajustes.consignaT1C));
    if (!s.salidas.SOL1 && s.t1C < sec.ajustes.consignaT1C - sec.ajustes.toleranciaDesvioC - 0.01) fueraDeBanda++;
  }
  assert.ok(maxDesv < 4, `T1 se aparta ${maxDesv.toFixed(2)} °C`);
  assert.equal(fueraDeBanda, 0);
});

test('Si T1 cae por debajo de la tolerancia, SOL1 desvía y el producto no se cuenta como acabado', () => {
  const s = crearEstado(), sec = secuencia.crearSecuencia();
  secuencia.iniciar(sec, s);
  correr(sec, s, x => x.fase === 'produccion');
  s.t1C = sec.ajustes.consignaT1C - 5;
  const antes = s.finalMl;
  secuencia.paso(sec, s, 1);
  assert.equal(s.salidas.SOL1, true);
  assert.equal(s.finalMl, antes);
});

test('Con el tanque casi vacío no arranca y deja alarma con acción correctiva', () => {
  const s = crearEstado(); s.depositoAMl = 50;
  const sec = secuencia.crearSecuencia();
  assert.equal(secuencia.iniciar(sec, s), false);
  assert.equal(sec.fase, 'alarma');
  assert.match(sec.alarma.accion, /SOL4/);
});

test('El origen B usa SOL2 y su tanque', () => {
  const s = crearEstado(), sec = secuencia.crearSecuencia({ origen: 'B', volumenObjetivoMl: 300 });
  secuencia.iniciar(sec, s);
  correr(sec, s, x => x.fase === 'lavado');
  assert.equal(s.salidas.SOL2, true);
  assert.equal(s.depositoAMl, 1760);
  assert.ok(s.depositoBMl < 1270);
});

test('Un corte térmico en producción lleva a alarma con calefacción cortada', () => {
  const s = crearEstado(), sec = secuencia.crearSecuencia();
  secuencia.iniciar(sec, s);
  correr(sec, s, x => x.fase === 'produccion');
  s.temperaturaCorte = true;
  secuencia.paso(sec, s, 1);
  assert.equal(sec.fase, 'alarma');
  assert.equal(s.salidas.RES, false);
  assert.equal(s.consignas.potenciaPct, 0);
});

test('Reconocer una alarma lleva a parada ordenada hasta finalizar', () => {
  const s = crearEstado(), sec = secuencia.crearSecuencia();
  secuencia.iniciar(sec, s);
  correr(sec, s, x => x.fase === 'produccion');
  s.temperaturaCorte = true; secuencia.paso(sec, s, 1); s.temperaturaCorte = false;
  alarmas.reconocer(sec, s);
  assert.equal(sec.fase, 'parada');
  correr(sec, s, x => x.fase === 'finalizada');
  assert.equal(sec.fase, 'finalizada');
});

test('La parada de emergencia apaga todo al instante', () => {
  const s = crearEstado(), sec = secuencia.crearSecuencia();
  secuencia.iniciar(sec, s);
  correr(sec, s, x => x.fase === 'precalentamiento');
  secuencia.emergencia(sec, s);
  for (const k of SALIDAS) assert.equal(s.salidas[k], false, k);
  assert.equal(sec.fase, 'alarma');
  alarmas.reconocer(sec, s);
  assert.equal(sec.fase, 'reposo');
});

test('Una consigna que el modelo no alcanza acaba en alarma por tiempo de precalentamiento', () => {
  const s = crearEstado(), sec = secuencia.crearSecuencia({ consignaT1C: 80 });
  assert.ok(alcanzabilidad.t1Alcanzable(50, 90) < 80);
  secuencia.iniciar(sec, s);
  correr(sec, s, x => x.fase === 'alarma', 3000);
  assert.equal(sec.fase, 'alarma');
  assert.match(sec.alarma.causa, /no alcanza/);
});

test('Parada ordenada desde producción termina apagando todo', () => {
  const s = crearEstado(), sec = secuencia.crearSecuencia();
  secuencia.iniciar(sec, s);
  correr(sec, s, x => x.fase === 'produccion');
  secuencia.ordenarParada(sec, s);
  correr(sec, s, x => x.fase === 'finalizada');
  for (const k of SALIDAS) assert.equal(s.salidas[k], false, k);
});

function produccion(ajustes, seg = 300) {
  const s = crearEstado(), sec = secuencia.crearSecuencia(ajustes);
  secuencia.iniciar(sec, s);
  correr(sec, s, x => x.fase === 'produccion');
  const t1 = [], t2 = [], potencia = [];
  for (let t = 0; t < seg && sec.fase === 'produccion'; t++) {
    secuencia.paso(sec, s, 1);
    if (t > 60) { t1.push(s.t1C); t2.push(s.aguaCalienteC); potencia.push(s.consignas.potenciaPct); }
  }
  return { s, sec, t1, t2, potencia };
}
const rango = a => [Math.min(...a), Math.max(...a)];

test('Modo manual: el calefactor queda a la potencia elegida y la secuencia termina', () => {
  const { s, sec, potencia } = produccion({ modoRegulacion: 'manual', potenciaManualPct: 90, volumenObjetivoMl: 900 });
  assert.deepEqual(rango(potencia), [90, 90]);
  assert.equal(sec.alarma, null);
  correr(sec, s, x => x.fase === 'finalizada');
  assert.equal(sec.fase, 'finalizada');
});

test('Modo manual con poca potencia no llega a temperatura y avisa', () => {
  const s = crearEstado(), sec = secuencia.crearSecuencia({ modoRegulacion: 'manual', potenciaManualPct: 40 });
  assert.ok(alcanzabilidad.t1Estacionaria(sec.ajustes) < sec.ajustes.consignaT1C);
  secuencia.iniciar(sec, s);
  correr(sec, s, x => x.fase === 'alarma', 3000);
  assert.equal(sec.fase, 'alarma');
});

test('Modo T2: el agua caliente se mantiene en su consigna', () => {
  const { t2, sec } = produccion({ modoRegulacion: 'T2', consignaT2C: 80 });
  const [mn, mx] = rango(t2);
  assert.ok(mn > 77 && mx < 83, `T2 entre ${mn.toFixed(1)} y ${mx.toFixed(1)}`);
  assert.equal(sec.alarma, null);
});

test('Modo T2: una consigna de agua insuficiente para T1 acaba en alarma', () => {
  const s = crearEstado(), sec = secuencia.crearSecuencia({ modoRegulacion: 'T2', consignaT2C: 65 });
  assert.ok(alcanzabilidad.t1Estacionaria(sec.ajustes) < sec.ajustes.consignaT1C);
  secuencia.iniciar(sec, s);
  correr(sec, s, x => x.fase === 'alarma', 3000);
  assert.equal(sec.fase, 'alarma');
});

test('Modo cascada: T1 se mantiene en su consigna y T2 no pasa del tope', () => {
  const { t1, t2, sec } = produccion({ modoRegulacion: 'cascada' });
  const [a, b] = rango(t1), [, mx2] = rango(t2);
  assert.ok(a > 58.5 && b < 61.5, `T1 entre ${a.toFixed(2)} y ${b.toFixed(2)}`);
  assert.ok(mx2 <= sec.ajustes.consignaT2MaxC + 0.5);
});

test('Todos los modos terminan la secuencia completa sin alarma', () => {
  for (const modoRegulacion of MODOS_REGULACION.map(modo => modo.id)) {
    const s = crearEstado(), sec = secuencia.crearSecuencia({ modoRegulacion });
    secuencia.iniciar(sec, s);
    correr(sec, s, x => x.fase === 'finalizada');
    assert.equal(sec.fase, 'finalizada', modoRegulacion);
    assert.equal(sec.alarma, null, modoRegulacion);
  }
});

test('Modo todo/nada: T2 oscila dentro de la banda de histéresis alrededor de la consigna', () => {
  const { t2, sec } = produccion({ modoRegulacion: 'onoff', consignaT2C: 80 }, 400);
  const [a, b] = rango(t2);
  assert.ok(a >= 80 - sec.ajustes.histeresisT2C - 2 && b <= 80 + sec.ajustes.histeresisT2C + 2, `T2 entre ${a.toFixed(1)} y ${b.toFixed(1)}`);
  assert.equal(sec.alarma, null);
});

test('Modo lazos múltiples: F1 sigue su consigna y T1 la suya', () => {
  const { s, t1 } = produccion({ modoRegulacion: 'multiple', consignaF1MlMin: 300 }, 300);
  assert.ok(Math.abs(s.caudalProductoMlMin - 300) < 15, `F1 = ${s.caudalProductoMlMin.toFixed(0)}`);
  const [a, b] = rango(t1);
  assert.ok(a > 58 && b < 62, `T1 entre ${a.toFixed(2)} y ${b.toFixed(2)}`);
});

test('El catálogo de modos incluye los del manual', () => {
  assert.deepEqual(MODOS_REGULACION.map(x => x.id), ['manual', 'onoff', 'T2', 'T1', 'cascada', 'multiple']);
});

test('Sin volumen objetivo la producción termina sola al agotarse el tanque de origen', () => {
  const s = crearEstado(), sec = secuencia.crearSecuencia();
  assert.equal(sec.ajustes.volumenObjetivoMl, null);
  secuencia.iniciar(sec, s);
  const fases = correr(sec, s, x => x.fase === 'lavado');
  assert.ok(fases.includes('produccion'));
  assert.ok(s.depositoAMl <= sec.ajustes.volumenAgotadoMl + 5);
  assert.ok(s.finalMl > 1400, `salieron ${s.finalMl.toFixed(0)} ml`);
  assert.equal(sec.alarma, null);
  assert.ok(sec.eventos.some(e => /agotado/.test(e.mensaje)));
});

test('Terminar la producción a mano (saltar fase) pasa al lavado con el tanque aún con producto', () => {
  const s = crearEstado(), sec = secuencia.crearSecuencia();
  secuencia.iniciar(sec, s);
  correr(sec, s, x => x.fase === 'produccion');
  for (let i = 0; i < 60; i++) secuencia.paso(sec, s, 1);
  secuencia.saltarFase(sec, s);
  assert.equal(sec.fase, 'lavado');
  assert.ok(s.depositoAMl > 1000);
});

test('Demostración: solo con la temperatura la secuencia completa funciona en todo el rango', () => {
  const max = alcanzabilidad.t1MaximaDemostracion();
  assert.ok(max >= 60, `máximo ${max}`);
  for (const T of [40, 50, 60, max]) {
    const cfg = alcanzabilidad.configDemostracion(T);
    assert.equal(cfg.consignaT1C, T);
    const s = crearEstado(), sec = secuencia.crearSecuencia(cfg);
    secuencia.iniciar(sec, s);
    correr(sec, s, x => x.fase === 'produccion');
    const t1 = [];
    for (let t = 0; t < 200 && sec.fase === 'produccion'; t++) { secuencia.paso(sec, s, 1); if (t > 80) t1.push(s.t1C); }
    const [a, b] = rango(t1);
    assert.ok(a > T - 2 && b < T + 2, `T=${T} (caudal ${cfg.caudalPct} %): T1 entre ${a.toFixed(2)} y ${b.toFixed(2)}`);
    correr(sec, s, x => x.fase === 'finalizada');
    assert.equal(sec.fase, 'finalizada', `T=${T}`);
    assert.equal(sec.alarma, null, `T=${T}`);
    assert.ok(s.finalMl > 1000, `T=${T}: ${s.finalMl.toFixed(0)} ml`);
    assert.ok(s.depositoAMl <= 3, `T=${T}: queda ${s.depositoAMl.toFixed(0)} ml en A`);
  }
});

test('Demostración: una temperatura fuera de rango se recorta al máximo del modelo', () => {
  assert.equal(alcanzabilidad.configDemostracion(95).consignaT1C, alcanzabilidad.t1MaximaDemostracion());
  assert.equal(alcanzabilidad.configDemostracion(10).consignaT1C, 30);
});

test('Demostración con el tanque B de origen: B lleno, A vacío, y la secuencia termina sin alarma', () => {
  const cfg = alcanzabilidad.configDemostracion(55, 'B');
  assert.equal(cfg.origen, 'B');
  assert.equal(alcanzabilidad.configDemostracion(55).origen, 'A');
  const s = crearEstado(); ponerLlenado(s, 'B', 80); ponerLlenado(s, 'A', 0);
  const sec = secuencia.crearSecuencia(cfg);
  assert.equal(secuencia.iniciar(sec, s), true);
  correr(sec, s, x => x.fase === 'finalizada');
  assert.equal(sec.fase, 'finalizada');
  assert.equal(sec.alarma, null);
  assert.equal(s.depositoAMl, 0);
  assert.ok(s.depositoBMl < 0.8 * C.capacidadDepositoMl);
  assert.ok(s.finalMl > 1800, `salieron ${s.finalMl.toFixed(0)} ml de 1920`);
});

test('Demostración con el tanque de origen casi vacío no arranca y avisa', () => {
  const s = crearEstado(); ponerLlenado(s, 'A', 2); ponerLlenado(s, 'B', 0);
  const sec = secuencia.crearSecuencia(alcanzabilidad.configDemostracion(60, 'A'));
  assert.equal(secuencia.iniciar(sec, s), false);
  assert.equal(sec.fase, 'alarma');
});

test('Con T1 oscilando en el límite (todo/nada) SOL1 no abre y cierra en cada pico', () => {
  const s = crearEstado();
  const sec = secuencia.crearSecuencia({ modoRegulacion: 'onoff', consignaT2C: 78, caudalPct: 70, consignaT1C: 60, volumenObjetivoMl: 400 });
  secuencia.iniciar(sec, s);
  let prev = null, cambios = 0;
  for (let t = 0; t < 4000 && !['lavado', 'alarma', 'finalizada'].includes(sec.fase); t++) {
    secuencia.paso(sec, s, 1);
    if (sec.fase === 'produccion') { if (prev !== null && prev !== s.salidas.SOL1) cambios++; prev = s.salidas.SOL1; }
  }
  assert.ok(cambios <= 1, `SOL1 cambió ${cambios} veces`);
});

test('Tras un desvío el producto no vuelve a la salida normal hasta tener T1 en banda 30 s seguidos', () => {
  const s = crearEstado(), sec = secuencia.crearSecuencia();
  secuencia.iniciar(sec, s);
  correr(sec, s, x => x.fase === 'produccion');
  for (let i = 0; i < 40; i++) secuencia.paso(sec, s, 1);
  assert.equal(s.salidas.SOL1, false);
  s.t1C = sec.ajustes.consignaT1C - 5; secuencia.paso(sec, s, 1);
  assert.equal(s.salidas.SOL1, true);
  for (let i = 0; i < 15; i++) { s.t1C = sec.ajustes.consignaT1C; secuencia.paso(sec, s, 1); }
  assert.equal(s.salidas.SOL1, true, 'a los 15 s aún desvía');
  for (let i = 0; i < 25; i++) { s.t1C = sec.ajustes.consignaT1C; secuencia.paso(sec, s, 1); }
  assert.equal(s.salidas.SOL1, false, 'a los 40 s en banda ya sale normal');
});

test('El agua fría (SOL3) ya está abierta durante el precalentamiento y sigue en producción', () => {
  const s = crearEstado(), sec = secuencia.crearSecuencia();
  secuencia.iniciar(sec, s);
  correr(sec, s, x => x.fase === 'precalentamiento');
  secuencia.paso(sec, s, 1);
  assert.equal(s.salidas.SOL3, true);
  assert.equal(s.salidas.SOL1, true);
  correr(sec, s, x => x.fase === 'produccion');
  secuencia.paso(sec, s, 1);
  assert.equal(s.salidas.SOL3, true);
});

test('Al abrir SOL1 en producción el producto acabado ya sale refrigerado (T3 cerca de la temperatura ambiente)', () => {
  const s = crearEstado(), sec = secuencia.crearSecuencia();
  secuencia.iniciar(sec, s);
  correr(sec, s, x => x.fase === 'produccion' && !s.salidas.SOL1, 1500);
  for (let i = 0; i < 200 && s.salidas.SOL1; i++) secuencia.paso(sec, s, 1);
  assert.equal(s.salidas.SOL1, false);
  assert.ok(s.t3C < s.t1C - 25, `T3=${s.t3C.toFixed(1)} T1=${s.t1C.toFixed(1)}`);
});

test('Cada cambio de fase deja anotado su motivo', () => {
  const s = crearEstado(), sec = secuencia.crearSecuencia();
  secuencia.iniciar(sec, s);
  const motivos = {};
  for (let t = 0; t < 8000 && sec.fase !== 'finalizada'; t++) {
    const antes = sec.fase; secuencia.paso(sec, s, 1);
    if (sec.fase !== antes) motivos[sec.fase] = sec.motivo;
  }
  assert.match(motivos.precalentamiento, /calefactor/);
  assert.match(motivos.produccion, /T1/);
  assert.match(motivos.lavado, /agotado/);
  assert.match(motivos.parada, /lavado terminado/);
  assert.match(motivos.finalizada, /T2/);
});

test('Terminar la producción a mano anota ese motivo', () => {
  const s = crearEstado(), sec = secuencia.crearSecuencia();
  secuencia.iniciar(sec, s);
  correr(sec, s, x => x.fase === 'produccion');
  secuencia.terminarProduccion(sec, s);
  assert.equal(sec.fase, 'lavado');
  assert.match(sec.motivo, /a mano/);
});

test('La producción no se corta antes de tiempo: sigue hasta agotar el tanque y no salta alarma de vacío', () => {
  for (const origen of ['A', 'B']) {
    const s = crearEstado(), sec = secuencia.crearSecuencia({ origen });
    const inicial = origen === 'A' ? s.depositoAMl : s.depositoBMl;
    secuencia.iniciar(sec, s);
    correr(sec, s, x => x.fase === 'lavado');
    assert.equal(sec.alarma, null, origen);
    assert.ok(s.finalMl > inicial - 5, `${origen}: salieron ${s.finalMl.toFixed(0)} de ${inicial} ml`);
  }
});

test('El lavado con el tanque de origen agotado no dispara la alarma de tanque vacío', () => {
  const s = crearEstado(), sec = secuencia.crearSecuencia();
  secuencia.iniciar(sec, s);
  correr(sec, s, x => x.fase === 'lavado');
  for (let i = 0; i < 60; i++) secuencia.paso(sec, s, 1);
  assert.equal(sec.fase, 'lavado');
  assert.equal(sec.alarma, null);
});

test('La producción de referencia se respeta: la producción termina al alcanzarla y el tanque conserva el resto', () => {
  const s = crearEstado(), sec = secuencia.crearSecuencia({ volumenObjetivoMl: 500 });
  secuencia.iniciar(sec, s);
  correr(sec, s, x => x.fase === 'lavado');
  assert.ok(s.finalMl >= 500 && s.finalMl < 560, `salieron ${s.finalMl.toFixed(0)} ml`);
  assert.ok(s.depositoAMl > 1000, `quedan ${s.depositoAMl.toFixed(0)} ml en A`);
  assert.match(sec.motivo, /referencia alcanzada/);
});

test('La producción de referencia no puede superar el contenido del tanque de origen', () => {
  const s = crearEstado(); ponerLlenado(s, 'A', 20);
  assert.equal(secuencia.referenciaMaxima(s, 'A'), 480);
  assert.equal(secuencia.referenciaMaxima(s, 'B'), Math.floor(s.depositoBMl));
  const sec = secuencia.crearSecuencia({ volumenObjetivoMl: 2000 });
  secuencia.iniciar(sec, s);
  assert.equal(sec.ajustes.volumenObjetivoMl, 480);
  assert.ok(sec.eventos.some(e => /limitada a 480/.test(e.mensaje)));
  ponerLlenado(s, 'A', 100);
  assert.equal(secuencia.referenciaMaxima(s, 'A'), C.capacidadDepositoMl);
});
