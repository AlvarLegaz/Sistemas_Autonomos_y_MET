'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const m=require('../modelo.js');
test('La simulación inicia detenida y a temperatura ambiente',()=>{
 const s=m.crearEstado();assert.equal(s.tiempo,0);assert.equal(s.aguaCalienteC,22);
 assert.equal(s.salidas.N1,false);assert.equal(s.caudalProductoMlMin,0);
});
test('El ejemplo consume del tanque A, aumenta T2, genera flujo y producto terminado',()=>{
 const s=m.activarEjemplo(m.crearEstado());m.avanzar(s,120);
 assert.ok(s.aMl<1760);assert.equal(s.bMl,1270);assert.ok(s.aguaCalienteC>22);
 assert.ok(s.t1>22);assert.ok(s.caudalProductoMlMin>0);assert.ok(s.finalMl>0);
 assert.ok(s.desagueMl>0);
});
test('SOL2 selecciona B y SOL1 desvía el producto',()=>{
 const s=m.activarEjemplo(m.crearEstado());s.salidas.SOL1=true;s.salidas.SOL2=true;
 m.avanzar(s,45);assert.equal(s.aMl,1760);assert.ok(s.bMl<1270);
 assert.equal(s.finalMl,0);assert.ok(s.desviadoMl>0);
});
test('SOL4 y SOL5 rellenan depósitos sin sobrepasar capacidad',()=>{
 const s=m.crearEstado();s.salidas.SOL4=true;s.salidas.SOL5=true;
 m.avanzar(s,900);assert.equal(s.aMl,m.PARAMS.capacidadMl);
 assert.equal(s.bMl,m.PARAMS.capacidadMl);
});
test('Sin N1 o en sentido inverso no se suministra caudal',()=>{
 const s=m.activarEjemplo(m.crearEstado());s.giro.N1=true;m.avanzar(s,5);
 assert.equal(s.caudalProductoMlMin,0);
 s.giro.N1=false;s.salidas.N1=false;m.avanzar(s,5);assert.equal(s.caudalProductoMlMin,0);
});
test('Sin SOL3 no aumenta el contador de agua fría a desagüe',()=>{
 const s=m.crearEstado();m.avanzar(s,60);assert.equal(s.desagueMl,0);
 s.salidas.SOL3=true;m.avanzar(s,60);assert.ok(s.desagueMl>0);
});
test('T5 queda independiente de las temperaturas de proceso',()=>{
 const s=m.activarEjemplo(m.crearEstado());m.avanzar(s,240);
 assert.equal(m.observaciones(s).T5,m.PARAMS.ambiente);
});
test('Un depósito agotado detiene el caudal para ese origen',()=>{
 const s=m.activarEjemplo(m.crearEstado());s.aMl=0;
 m.avanzar(s,5);assert.equal(s.caudalProductoMlMin,0);assert.equal(s.vacio,true);
});
