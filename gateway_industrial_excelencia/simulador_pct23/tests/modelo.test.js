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
test('SOL2 selecciona B y SOL1 desvía el producto sin vaciar el tanque',()=>{
 const s=m.activarEjemplo(m.crearEstado());s.salidas.SOL1=true;s.salidas.SOL2=true;
 m.avanzar(s,45);assert.equal(s.aMl,1760);assert.equal(s.bMl,1270); // el desvio devuelve el producto al tanque
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
test('T5 (en el calentamiento) queda entre la temperatura ambiente y T4, y vuelve al ambiente en parada',()=>{
 const s=m.activarEjemplo(m.crearEstado());
 assert.equal(m.observaciones(s).T5,m.PARAMS.ambiente);
 m.avanzar(s,300);
 const o=m.observaciones(s);
 assert.ok(o.T5>m.PARAMS.ambiente+5);
 assert.ok(o.T5<o.T4);
 assert.ok(Math.abs(o.T5-(m.PARAMS.ambiente+(o.T4-m.PARAMS.ambiente)/2))<0.01);
 s.salidas.N1=false;m.avanzar(s,3000);
 assert.ok(m.observaciones(s).T5<m.PARAMS.ambiente+1);
});
test('Un depósito agotado detiene el caudal para ese origen',()=>{
 const s=m.activarEjemplo(m.crearEstado());s.aMl=0;
 m.avanzar(s,5);assert.equal(s.caudalProductoMlMin,0);assert.equal(s.vacio,true);
});

test('El llenado de un depósito se fija en porcentaje de la capacidad',()=>{
 const s=m.crearEstado();
 m.ponerLlenado(s,'A',50);assert.equal(s.aMl,2500);assert.equal(m.porcentajeLlenado(s,'A'),50);
 m.ponerLlenado(s,'B',100);assert.equal(s.bMl,m.PARAMS.capacidadMl);
 m.ponerLlenado(s,'B',-5);assert.equal(s.bMl,0);
 m.ponerLlenado(s,'A',250);assert.equal(s.aMl,m.PARAMS.capacidadMl);
});
test('Con el depósito de origen al 0 % la bomba no mueve producto y se marca vacío',()=>{
 const s=m.activarEjemplo(m.crearEstado());m.ponerLlenado(s,'A',0);m.avanzar(s,5);
 assert.equal(s.caudalProductoMlMin,0);assert.equal(s.vacio,true);
});

test('T4 (salida del calentamiento) se adelanta a T1 y ambas suben con el producto en marcha',()=>{
 const s=m.activarEjemplo(m.crearEstado());
 let t4MayorQueT1=0;
 for(let t=0;t<120;t++){m.avanzar(s,1);if(s.t4>s.t1)t4MayorQueT1++;}
 assert.ok(s.t4>s.t1&&s.t1>22,`T4=${s.t4.toFixed(1)} T1=${s.t1.toFixed(1)}`);
 assert.ok(t4MayorQueT1>100);
 assert.ok(s.t4>=s.t3);
});
test('Sin producto circulando T4 vuelve despacio a la temperatura ambiente',()=>{
 const s=m.activarEjemplo(m.crearEstado());m.avanzar(s,300);const caliente=s.t4;
 s.salidas.N1=false;m.avanzar(s,1200);
 assert.ok(caliente>30);assert.ok(s.t4<caliente-5);assert.ok(s.t4>=22);
});

test('Al circular el producto T2 baja: se lleva calor del agua caliente (acoplamiento por caudal)',()=>{
 const sin=m.crearEstado(),con=m.crearEstado();
 for(const s of [sin,con]){s.salidas.N2=true;s.salidas.RES=true;s.consignas.R=20;s.consignas.N1V=100;}
 con.salidas.N1=true;con.salidas.SOL1=true;   // producto recirculando por el intercambiador
 m.avanzar(sin,6000);m.avanzar(con,6000);
 assert.ok(con.aguaCalienteC<sin.aguaCalienteC-2,`sin caudal ${sin.aguaCalienteC.toFixed(1)} con caudal ${con.aguaCalienteC.toFixed(1)}`);
});
test('Al empezar a circular el producto T2 cae respecto a su valor sin caudal',()=>{
 const s=m.crearEstado();
 s.salidas.N2=true;s.salidas.RES=true;s.consignas.R=20;s.consignas.N1V=60;
 m.avanzar(s,6000);const antes=s.aguaCalienteC;
 s.salidas.N1=true;s.salidas.SOL1=true;m.avanzar(s,3000);
 assert.ok(s.aguaCalienteC<antes-1,`antes ${antes.toFixed(1)} despues ${s.aguaCalienteC.toFixed(1)}`);
});

test('Los contadores miden siempre que circula producto: desvío con SOL1 activa y acabado con SOL1 sin activar',()=>{
 const s=m.activarEjemplo(m.crearEstado());
 s.salidas.SOL1=true;m.avanzar(s,60);
 const desv=s.desviadoMl;
 assert.ok(desv>200);assert.equal(s.finalMl,0);
 s.salidas.SOL1=false;m.avanzar(s,60);
 assert.equal(s.desviadoMl,desv);assert.ok(s.finalMl>200);
 s.salidas.N1=false;const f0=s.finalMl;m.avanzar(s,60);
 assert.equal(s.finalMl,f0);assert.equal(s.desviadoMl,desv);
});
