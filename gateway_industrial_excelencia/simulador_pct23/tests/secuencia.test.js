'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const m=require('../modelo.js');
const q=require('../secuencia.js');

function correr(sec,s,hasta,maxS=8000){
 const vistas=[sec.fase];
 for(let t=0;t<maxS&&!hasta(sec,s);t++){
  q.paso(sec,s,1);
  if(vistas[vistas.length-1]!==sec.fase)vistas.push(sec.fase);
 }
 return vistas;
}

test('Secuencia completa: arranque, precalentamiento, producción, lavado, parada y fin',()=>{
 const s=m.crearEstado(),sec=q.crearSecuencia();
 assert.equal(q.iniciar(sec,s),true);
 const fases=correr(sec,s,x=>x.fase==='finalizada');
 assert.deepEqual(fases,['arranque','precalentamiento','produccion','lavado','parada','finalizada']);
 assert.ok(s.finalMl>1000,`salieron ${s.finalMl.toFixed(0)} ml`);
 assert.ok(s.aMl<=sec.cfg.volumenAgotadoMl+5);
 assert.equal(sec.alarma,null);
 assert.ok(s.aguaCalienteC<=sec.cfg.enfriarHastaC+1);
 for(const k of m.OUTPUT_IDS)assert.equal(s.salidas[k],false,k);
});

test('Precalentamiento recircula (SOL1 activa): el tanque no baja y no sale producto acabado',()=>{
 const s=m.crearEstado(),sec=q.crearSecuencia();
 q.iniciar(sec,s);
 correr(sec,s,x=>x.fase==='produccion');
 assert.equal(s.finalMl,0);
 assert.equal(s.aMl,1760);
 assert.ok(s.desviadoMl>0);
});

test('En producción T1 se mantiene cerca de la consigna y el producto acabado sale a temperatura',()=>{
 const s=m.crearEstado(),sec=q.crearSecuencia({volumenObjetivoMl:900});
 q.iniciar(sec,s);
 correr(sec,s,x=>x.fase==='produccion');
 let maxDesv=0,fueraDeBanda=0;
 const inicio=sec.tFase;
 for(let t=0;t<400&&sec.fase==='produccion';t++){
  q.paso(sec,s,1);
  if(t>60){maxDesv=Math.max(maxDesv,Math.abs(s.t1-sec.cfg.consignaT1));}
  if(!s.salidas.SOL1&&s.t1<sec.cfg.consignaT1-sec.cfg.toleranciaDesvioC-0.01)fueraDeBanda++;
 }
 assert.ok(maxDesv<4,`T1 se aparta ${maxDesv.toFixed(2)} °C`);
 assert.equal(fueraDeBanda,0);
});

test('Si T1 cae por debajo de la tolerancia, SOL1 desvía y el producto no se cuenta como acabado',()=>{
 const s=m.crearEstado(),sec=q.crearSecuencia();
 q.iniciar(sec,s);
 correr(sec,s,x=>x.fase==='produccion');
 s.t1=sec.cfg.consignaT1-5;
 const antes=s.finalMl;
 q.paso(sec,s,1);
 assert.equal(s.salidas.SOL1,true);
 assert.equal(s.finalMl,antes);
});

test('Con el tanque casi vacío no arranca y deja alarma con acción correctiva',()=>{
 const s=m.crearEstado();s.aMl=50;
 const sec=q.crearSecuencia();
 assert.equal(q.iniciar(sec,s),false);
 assert.equal(sec.fase,'alarma');
 assert.match(sec.alarma.accion,/SOL4/);
});

test('El origen B usa SOL2 y su tanque',()=>{
 const s=m.crearEstado(),sec=q.crearSecuencia({origen:'B',volumenObjetivoMl:300});
 q.iniciar(sec,s);
 correr(sec,s,x=>x.fase==='lavado');
 assert.equal(s.salidas.SOL2,true);
 assert.equal(s.aMl,1760);
 assert.ok(s.bMl<1270);
});

test('Un corte térmico en producción lleva a alarma con calefacción cortada',()=>{
 const s=m.crearEstado(),sec=q.crearSecuencia();
 q.iniciar(sec,s);
 correr(sec,s,x=>x.fase==='produccion');
 s.temperaturaCorte=true;
 q.paso(sec,s,1);
 assert.equal(sec.fase,'alarma');
 assert.equal(s.salidas.RES,false);
 assert.equal(s.consignas.R,0);
});

test('Reconocer una alarma lleva a parada ordenada hasta finalizar',()=>{
 const s=m.crearEstado(),sec=q.crearSecuencia();
 q.iniciar(sec,s);
 correr(sec,s,x=>x.fase==='produccion');
 s.temperaturaCorte=true;q.paso(sec,s,1);s.temperaturaCorte=false;
 q.reconocer(sec,s);
 assert.equal(sec.fase,'parada');
 correr(sec,s,x=>x.fase==='finalizada');
 assert.equal(sec.fase,'finalizada');
});

test('La parada de emergencia apaga todo al instante',()=>{
 const s=m.crearEstado(),sec=q.crearSecuencia();
 q.iniciar(sec,s);
 correr(sec,s,x=>x.fase==='precalentamiento');
 q.emergencia(sec,s);
 for(const k of m.OUTPUT_IDS)assert.equal(s.salidas[k],false,k);
 assert.equal(sec.fase,'alarma');
 q.reconocer(sec,s);
 assert.equal(sec.fase,'reposo');
});

test('Una consigna que el modelo no alcanza acaba en alarma por tiempo de precalentamiento',()=>{
 const s=m.crearEstado(),sec=q.crearSecuencia({consignaT1:60});
 assert.ok(q.t1Alcanzable(50,90)<60);
 q.iniciar(sec,s);
 correr(sec,s,x=>x.fase==='alarma',5000);
 assert.equal(sec.fase,'alarma');
 assert.match(sec.alarma.causa,/no alcanza/);
});

test('Parada ordenada desde producción termina apagando todo',()=>{
 const s=m.crearEstado(),sec=q.crearSecuencia();
 q.iniciar(sec,s);
 correr(sec,s,x=>x.fase==='produccion');
 q.ordenarParada(sec,s);
 correr(sec,s,x=>x.fase==='finalizada');
 for(const k of m.OUTPUT_IDS)assert.equal(s.salidas[k],false,k);
});

function produccion(cfg,seg=300){
 const s=m.crearEstado(),sec=q.crearSecuencia(cfg);
 q.iniciar(sec,s);
 correr(sec,s,x=>x.fase==='produccion');
 const t1=[],t2=[],r=[];
 for(let t=0;t<seg&&sec.fase==='produccion';t++){q.paso(sec,s,1);if(t>60){t1.push(s.t1);t2.push(s.aguaCalienteC);r.push(s.consignas.R);}}
 return {s,sec,t1,t2,r};
}
const rango=a=>[Math.min(...a),Math.max(...a)];

test('Modo manual: el calefactor queda a la potencia elegida y la secuencia termina',()=>{
 const {s,sec,r}=produccion({modoControl:'manual',potenciaManualPct:90,volumenObjetivoMl:900});
 assert.deepEqual(rango(r),[90,90]);
 assert.equal(sec.alarma,null);
 correr(sec,s,x=>x.fase==='finalizada');
 assert.equal(sec.fase,'finalizada');
});

test('Modo manual con poca potencia no llega a temperatura y avisa',()=>{
 const s=m.crearEstado(),sec=q.crearSecuencia({modoControl:'manual',potenciaManualPct:20});
 assert.ok(q.t1Estacionaria(sec.cfg)<sec.cfg.consignaT1);
 q.iniciar(sec,s);
 correr(sec,s,x=>x.fase==='alarma',5000);
 assert.equal(sec.fase,'alarma');
});

test('Modo T2: el agua caliente se mantiene en su consigna',()=>{
 const {t2,sec}=produccion({modoControl:'T2',consignaT2:55});
 const [mn,mx]=rango(t2);
 assert.ok(mn>52&&mx<58,`T2 entre ${mn.toFixed(1)} y ${mx.toFixed(1)}`);
 assert.equal(sec.alarma,null);
});

test('Modo T2: una consigna de agua insuficiente para T1 acaba en alarma',()=>{
 const s=m.crearEstado(),sec=q.crearSecuencia({modoControl:'T2',consignaT2:40});
 assert.ok(q.t1Estacionaria(sec.cfg)<sec.cfg.consignaT1);
 q.iniciar(sec,s);
 correr(sec,s,x=>x.fase==='alarma',5000);
 assert.equal(sec.fase,'alarma');
});

test('Modo cascada: T1 se mantiene en su consigna y T2 no pasa del tope',()=>{
 const {t1,t2,sec}=produccion({modoControl:'cascada'});
 const [a,b]=rango(t1),[,mx2]=rango(t2);
 assert.ok(a>43.5&&b<46.5,`T1 entre ${a.toFixed(2)} y ${b.toFixed(2)}`);
 assert.ok(mx2<=sec.cfg.t2Max+0.5);
});

test('Todos los modos terminan la secuencia completa sin alarma',()=>{
 for(const modoControl of ['manual','onoff','T2','T1','cascada','multiple']){
  const s=m.crearEstado(),sec=q.crearSecuencia({modoControl});
  q.iniciar(sec,s);
  correr(sec,s,x=>x.fase==='finalizada');
  assert.equal(sec.fase,'finalizada',modoControl);
  assert.equal(sec.alarma,null,modoControl);
 }
});

test('Modo todo/nada: T2 oscila dentro de la banda de histéresis alrededor de la consigna',()=>{
 const {t2,sec}=produccion({modoControl:'onoff',consignaT2:55},400);
 const [a,b]=rango(t2);
 assert.ok(a>=55-sec.cfg.histeresisT2C-2&&b<=55+sec.cfg.histeresisT2C+2,`T2 entre ${a.toFixed(1)} y ${b.toFixed(1)}`);
 assert.equal(sec.alarma,null);
});

test('Modo lazos múltiples: F1 sigue su consigna y T1 la suya',()=>{
 const {s,sec,t1}=produccion({modoControl:'multiple',consignaF1:300},300);
 assert.ok(Math.abs(s.caudalProductoMlMin-300)<15,`F1 = ${s.caudalProductoMlMin.toFixed(0)}`);
 const [a,b]=rango(t1);
 assert.ok(a>43&&b<47,`T1 entre ${a.toFixed(2)} y ${b.toFixed(2)}`);
});

test('El catálogo de modos incluye los del manual',()=>{
 assert.deepEqual(q.MODOS.map(x=>x.id),['manual','onoff','T2','T1','cascada','multiple']);
});

test('Sin volumen objetivo la producción termina sola al agotarse el tanque de origen',()=>{
 const s=m.crearEstado(),sec=q.crearSecuencia();
 assert.equal(sec.cfg.volumenObjetivoMl,null);
 q.iniciar(sec,s);
 const fases=correr(sec,s,x=>x.fase==='lavado');
 assert.ok(fases.includes('produccion'));
 assert.ok(s.aMl<=sec.cfg.volumenAgotadoMl+5);
 assert.ok(s.finalMl>1400,`salieron ${s.finalMl.toFixed(0)} ml`);
 assert.equal(sec.alarma,null);
 assert.ok(sec.eventos.some(e=>/agotado/.test(e.mensaje)));
});

test('Terminar la producción a mano (saltar fase) pasa al lavado con el tanque aún con producto',()=>{
 const s=m.crearEstado(),sec=q.crearSecuencia();
 q.iniciar(sec,s);
 correr(sec,s,x=>x.fase==='produccion');
 for(let i=0;i<60;i++)q.paso(sec,s,1);
 q.saltarFase(sec,s);
 assert.equal(sec.fase,'lavado');
 assert.ok(s.aMl>1000);
});

test('Demostración: solo con la temperatura la secuencia completa funciona en todo el rango',()=>{
 const max=q.t1MaximaDemostracion();
 assert.ok(max>=50,`máximo ${max}`);
 for(const T of [35,40,45,max]){
  const cfg=q.configDemostracion(T);
  assert.equal(cfg.consignaT1,T);
  const s=m.crearEstado(),sec=q.crearSecuencia(cfg);
  q.iniciar(sec,s);
  correr(sec,s,x=>x.fase==='produccion');
  const t1=[];
  for(let t=0;t<200&&sec.fase==='produccion';t++){q.paso(sec,s,1);if(t>80)t1.push(s.t1);}
  const [a,b]=rango(t1);
  assert.ok(a>T-2&&b<T+2,`T=${T} (caudal ${cfg.caudalPct} %): T1 entre ${a.toFixed(2)} y ${b.toFixed(2)}`);
  correr(sec,s,x=>x.fase==='finalizada');
  assert.equal(sec.fase,'finalizada',`T=${T}`);
  assert.equal(sec.alarma,null,`T=${T}`);
  assert.ok(s.finalMl>1000,`T=${T}: ${s.finalMl.toFixed(0)} ml`);
  assert.ok(s.aMl<=3,`T=${T}: queda ${s.aMl.toFixed(0)} ml en A`);
 }
});

test('Demostración: una temperatura fuera de rango se recorta al máximo del modelo',()=>{
 assert.equal(q.configDemostracion(95).consignaT1,q.t1MaximaDemostracion());
 assert.equal(q.configDemostracion(10).consignaT1,30);
});

test('Demostración con el tanque B de origen: B lleno, A vacío, y la secuencia termina sin alarma',()=>{
 const cfg=q.configDemostracion(45,'B');
 assert.equal(cfg.origen,'B');
 assert.equal(q.configDemostracion(45).origen,'A');
 const s=m.crearEstado();m.ponerLlenado(s,'B',80);m.ponerLlenado(s,'A',0);
 const sec=q.crearSecuencia(cfg);
 assert.equal(q.iniciar(sec,s),true);
 correr(sec,s,x=>x.fase==='finalizada');
 assert.equal(sec.fase,'finalizada');
 assert.equal(sec.alarma,null);
 assert.equal(s.aMl,0);
 assert.ok(s.bMl<0.8*m.PARAMS.capacidadMl);
 assert.ok(s.finalMl>1800,`salieron ${s.finalMl.toFixed(0)} ml de 1920`);
});

test('Demostración con el tanque de origen casi vacío no arranca y avisa',()=>{
 const s=m.crearEstado();m.ponerLlenado(s,'A',2);m.ponerLlenado(s,'B',0);
 const sec=q.crearSecuencia(q.configDemostracion(60,'A'));
 assert.equal(q.iniciar(sec,s),false);
 assert.equal(sec.fase,'alarma');
});

test('Con T1 oscilando en el límite (todo/nada) SOL1 no abre y cierra en cada pico',()=>{
 const s=m.crearEstado(),sec=q.crearSecuencia({modoControl:'onoff',consignaT2:78,caudalPct:70,consignaT1:60,volumenObjetivoMl:400});
 q.iniciar(sec,s);
 let prev=null,cambios=0;
 for(let t=0;t<4000&&!['lavado','alarma','finalizada'].includes(sec.fase);t++){
  q.paso(sec,s,1);
  if(sec.fase==='produccion'){if(prev!==null&&prev!==s.salidas.SOL1)cambios++;prev=s.salidas.SOL1;}
 }
 assert.ok(cambios<=1,`SOL1 cambió ${cambios} veces`);
});

test('Tras un desvío el producto no vuelve a la salida normal hasta tener T1 en banda 30 s seguidos',()=>{
 const s=m.crearEstado(),sec=q.crearSecuencia();
 q.iniciar(sec,s);
 correr(sec,s,x=>x.fase==='produccion');
 for(let i=0;i<40;i++)q.paso(sec,s,1);          // ya sale normal
 assert.equal(s.salidas.SOL1,false);
 s.t1=sec.cfg.consignaT1-5;q.paso(sec,s,1);       // cae: desvío inmediato
 assert.equal(s.salidas.SOL1,true);
 s.t1=sec.cfg.consignaT1;                         // vuelve a la banda...
 for(let i=0;i<15;i++){s.t1=sec.cfg.consignaT1;q.paso(sec,s,1);}
 assert.equal(s.salidas.SOL1,true,'a los 15 s aún desvía');
 for(let i=0;i<25;i++){s.t1=sec.cfg.consignaT1;q.paso(sec,s,1);}
 assert.equal(s.salidas.SOL1,false,'a los 40 s en banda ya sale normal');
});

test('El agua fría (SOL3) ya está abierta durante el precalentamiento y sigue en producción',()=>{
 const s=m.crearEstado(),sec=q.crearSecuencia();
 q.iniciar(sec,s);
 correr(sec,s,x=>x.fase==='precalentamiento');
 q.paso(sec,s,1);
 assert.equal(s.salidas.SOL3,true);
 assert.equal(s.salidas.SOL1,true);
 correr(sec,s,x=>x.fase==='produccion');
 q.paso(sec,s,1);
 assert.equal(s.salidas.SOL3,true);
});

test('Al abrir SOL1 en producción el producto acabado ya sale refrigerado (T3 cerca de la temperatura ambiente)',()=>{
 const s=m.crearEstado(),sec=q.crearSecuencia();
 q.iniciar(sec,s);
 correr(sec,s,x=>x.fase==='produccion'&&!s.salidas.SOL1,5000);
 for(let i=0;i<200&&s.salidas.SOL1;i++)q.paso(sec,s,1);
 assert.equal(s.salidas.SOL1,false);
 assert.ok(s.t3<s.t1-18,`T3=${s.t3.toFixed(1)} T1=${s.t1.toFixed(1)}`);
});

test('Cada cambio de fase deja anotado su motivo',()=>{
 const s=m.crearEstado(),sec=q.crearSecuencia();
 q.iniciar(sec,s);
 const motivos={};
 for(let t=0;t<8000&&sec.fase!=='finalizada';t++){
  const antes=sec.fase;q.paso(sec,s,1);
  if(sec.fase!==antes)motivos[sec.fase]=sec.motivo;
 }
 assert.match(motivos.precalentamiento,/calefactor/);
 assert.match(motivos.produccion,/T1/);
 assert.match(motivos.lavado,/agotado/);
 assert.match(motivos.parada,/lavado terminado/);
 assert.match(motivos.finalizada,/T2/);
});

test('Terminar la producción a mano anota ese motivo',()=>{
 const s=m.crearEstado(),sec=q.crearSecuencia();
 q.iniciar(sec,s);
 correr(sec,s,x=>x.fase==='produccion');
 q.terminarProduccion(sec,s);
 assert.equal(sec.fase,'lavado');
 assert.match(sec.motivo,/a mano/);
});

test('La producción no se corta antes de tiempo: sigue hasta agotar el tanque y no salta alarma de vacío',()=>{
 for(const origen of ['A','B']){
  const s=m.crearEstado(),sec=q.crearSecuencia({origen});
  const inicial=origen==='A'?s.aMl:s.bMl;
  q.iniciar(sec,s);
  correr(sec,s,x=>x.fase==='lavado');
  assert.equal(sec.alarma,null,origen);
  assert.ok(s.finalMl>inicial-5,`${origen}: salieron ${s.finalMl.toFixed(0)} de ${inicial} ml`);
 }
});

test('El lavado con el tanque de origen agotado no dispara la alarma de tanque vacío',()=>{
 const s=m.crearEstado(),sec=q.crearSecuencia();
 q.iniciar(sec,s);
 correr(sec,s,x=>x.fase==='lavado');
 for(let i=0;i<60;i++)q.paso(sec,s,1);
 assert.equal(sec.fase,'lavado');
 assert.equal(sec.alarma,null);
});

test('La producción de referencia se respeta: la producción termina al alcanzarla y el tanque conserva el resto',()=>{
 const s=m.crearEstado(),sec=q.crearSecuencia({volumenObjetivoMl:500});
 q.iniciar(sec,s);
 correr(sec,s,x=>x.fase==='lavado');
 assert.ok(s.finalMl>=500&&s.finalMl<560,`salieron ${s.finalMl.toFixed(0)} ml`);
 assert.ok(s.aMl>1000,`quedan ${s.aMl.toFixed(0)} ml en A`);
 assert.match(sec.motivo,/referencia alcanzada/);
});

test('La producción de referencia no puede superar el contenido del tanque de origen',()=>{
 const s=m.crearEstado();m.ponerLlenado(s,'A',20);          // 1000 ml
 assert.equal(q.referenciaMaxima(s,'A'),1000);
 assert.equal(q.referenciaMaxima(s,'B'),Math.floor(s.bMl));
 const sec=q.crearSecuencia({volumenObjetivoMl:2000});
 q.iniciar(sec,s);
 assert.equal(sec.cfg.volumenObjetivoMl,1000);
 assert.ok(sec.eventos.some(e=>/limitada a 1000/.test(e.mensaje)));
 m.ponerLlenado(s,'A',100);
 assert.equal(q.referenciaMaxima(s,'A'),m.PARAMS.capacidadMl);
});
