'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CONSTANTES_FISICAS: C } = require('../js/configuracion/constantes_fisicas.js');
const estadoPlanta = require('../js/modelo/estado_planta.js');
const planta = require('../js/modelo/planta.js');

const { crearEstado, activarEjemplo, ponerLlenado, porcentajeLlenado } = estadoPlanta;
const { avanzar, observaciones } = planta;

test('La simulación inicia detenida y a temperatura ambiente', () => {
  const s = crearEstado();
  assert.equal(s.tiempo, 0); assert.equal(s.aguaCalienteC, 22);
  assert.equal(s.salidas.N1, false); assert.equal(s.caudalProductoMlMin, 0);
});

test('El ejemplo consume del tanque A, aumenta T2, genera flujo y producto terminado', () => {
  const s = activarEjemplo(crearEstado()); avanzar(s, 120);
  assert.ok(s.depositoAMl < 1760); assert.equal(s.depositoBMl, 1270); assert.ok(s.aguaCalienteC > 22);
  assert.ok(s.t1C > 22); assert.ok(s.caudalProductoMlMin > 0); assert.ok(s.finalMl > 0);
  assert.ok(s.desagueMl > 0);
});

test('SOL2 selecciona B y SOL1 desvía el producto sin vaciar el tanque', () => {
  const s = activarEjemplo(crearEstado()); s.salidas.SOL1 = true; s.salidas.SOL2 = true;
  avanzar(s, 45); assert.equal(s.depositoAMl, 1760); assert.equal(s.depositoBMl, 1270);
  assert.equal(s.finalMl, 0); assert.ok(s.desviadoMl > 0);
});

test('SOL4 y SOL5 rellenan depósitos sin sobrepasar capacidad', () => {
  const s = crearEstado(); s.salidas.SOL4 = true; s.salidas.SOL5 = true;
  avanzar(s, 900); assert.equal(s.depositoAMl, C.capacidadDepositoMl);
  assert.equal(s.depositoBMl, C.capacidadDepositoMl);
});

test('Sin N1 o en sentido inverso no se suministra caudal', () => {
  const s = activarEjemplo(crearEstado()); s.giro.N1 = true; avanzar(s, 5);
  assert.equal(s.caudalProductoMlMin, 0);
  s.giro.N1 = false; s.salidas.N1 = false; avanzar(s, 5); assert.equal(s.caudalProductoMlMin, 0);
});

test('Sin SOL3 no aumenta el contador de agua fría a desagüe', () => {
  const s = crearEstado(); avanzar(s, 60); assert.equal(s.desagueMl, 0);
  s.salidas.SOL3 = true; avanzar(s, 60); assert.ok(s.desagueMl > 0);
});

test('T5 (en el calentamiento) queda entre la temperatura ambiente y T4, y vuelve al ambiente en parada', () => {
  const s = activarEjemplo(crearEstado());
  assert.equal(observaciones(s).T5, C.temperaturaAmbienteC);
  avanzar(s, 120);
  const o = observaciones(s);
  assert.ok(o.T5 > C.temperaturaAmbienteC + 5);
  assert.ok(o.T5 < o.T4);
  assert.ok(Math.abs(o.T5 - (C.temperaturaAmbienteC + (o.T4 - C.temperaturaAmbienteC) / 2)) < 0.01);
  s.salidas.N1 = false; avanzar(s, 3000);
  assert.ok(observaciones(s).T5 < C.temperaturaAmbienteC + 1);
});

test('Un depósito agotado detiene el caudal para ese origen', () => {
  const s = activarEjemplo(crearEstado()); s.depositoAMl = 0;
  avanzar(s, 5); assert.equal(s.caudalProductoMlMin, 0); assert.equal(s.vacio, true);
});

test('El llenado de un depósito se fija en porcentaje de la capacidad', () => {
  const s = crearEstado();
  ponerLlenado(s, 'A', 50); assert.equal(s.depositoAMl, 1200); assert.equal(porcentajeLlenado(s, 'A'), 50);
  ponerLlenado(s, 'B', 100); assert.equal(s.depositoBMl, C.capacidadDepositoMl);
  ponerLlenado(s, 'B', -5); assert.equal(s.depositoBMl, 0);
  ponerLlenado(s, 'A', 250); assert.equal(s.depositoAMl, C.capacidadDepositoMl);
});

test('Con el depósito de origen al 0 % la bomba no mueve producto y se marca vacío', () => {
  const s = activarEjemplo(crearEstado()); ponerLlenado(s, 'A', 0); avanzar(s, 5);
  assert.equal(s.caudalProductoMlMin, 0); assert.equal(s.vacio, true);
});

test('T4 (salida del calentamiento) se adelanta a T1 y ambas suben con el producto en marcha', () => {
  const s = activarEjemplo(crearEstado());
  let t4MayorQueT1 = 0;
  for (let t = 0; t < 120; t++) { avanzar(s, 1); if (s.t4C > s.t1C) t4MayorQueT1++; }
  assert.ok(s.t4C > s.t1C && s.t1C > 22, `T4=${s.t4C.toFixed(1)} T1=${s.t1C.toFixed(1)}`);
  assert.ok(t4MayorQueT1 > 100);
  assert.ok(s.t4C >= s.t3C);
});

test('Sin producto circulando T4 vuelve despacio a la temperatura ambiente', () => {
  const s = activarEjemplo(crearEstado()); avanzar(s, 300); const caliente = s.t4C;
  s.salidas.N1 = false; avanzar(s, 1200);
  assert.ok(caliente > 40); assert.ok(s.t4C < caliente - 5); assert.ok(s.t4C >= 22);
});

test('Al circular el producto T2 baja: se lleva calor del agua caliente (acoplamiento por caudal)', () => {
  const sin = crearEstado(), con = crearEstado();
  for (const s of [sin, con]) { s.salidas.N2 = true; s.salidas.RES = true; s.consignas.potenciaPct = 90; s.consignas.velocidadN1Pct = 100; }
  con.salidas.N1 = true; con.salidas.SOL1 = true;
  avanzar(sin, 1500); avanzar(con, 1500);
  assert.ok(con.aguaCalienteC < sin.aguaCalienteC - 4, `sin caudal ${sin.aguaCalienteC.toFixed(1)} con caudal ${con.aguaCalienteC.toFixed(1)}`);
});

test('Al empezar a circular el producto T2 cae respecto a su valor sin caudal', () => {
  const s = crearEstado();
  s.salidas.N2 = true; s.salidas.RES = true; s.consignas.potenciaPct = 90; s.consignas.velocidadN1Pct = 60;
  avanzar(s, 600); const antes = s.aguaCalienteC;
  s.salidas.N1 = true; s.salidas.SOL1 = true; avanzar(s, 600);
  assert.ok(s.aguaCalienteC < antes - 1, `antes ${antes.toFixed(1)} despues ${s.aguaCalienteC.toFixed(1)}`);
});

test('Los contadores miden siempre que circula producto: desvío con SOL1 activa y acabado con SOL1 sin activar', () => {
  const s = activarEjemplo(crearEstado());
  s.salidas.SOL1 = true; avanzar(s, 60);
  const desv = s.desviadoMl;
  assert.ok(desv > 200); assert.equal(s.finalMl, 0);
  s.salidas.SOL1 = false; avanzar(s, 60);
  assert.equal(s.desviadoMl, desv); assert.ok(s.finalMl > 200);
  s.salidas.N1 = false; const f0 = s.finalMl; avanzar(s, 60);
  assert.equal(s.finalMl, f0); assert.equal(s.desviadoMl, desv);
});
