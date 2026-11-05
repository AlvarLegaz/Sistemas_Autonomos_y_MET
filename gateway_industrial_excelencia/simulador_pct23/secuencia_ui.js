/* Interfaz de la secuencia automática. Sin red: solo el modelo local y la lógica de secuencia.js. */
(()=>{
  'use strict';
  const modelo=window.PCT23Modelo, Q=window.PCT23Secuencia;
  let estado=modelo.crearEstado();
  const DEMO=document.body.dataset.demo==='1';   // modo demostración: solo se elige la temperatura
  let sec=Q.crearSecuencia(DEMO?Q.configDemostracion(60):undefined);
  let ejecutando=false, velocidad=1;
  const $=id=>document.getElementById(id);
  const todos=s=>Array.from(document.querySelectorAll(s));
  const nf=new Intl.NumberFormat('es-ES',{maximumFractionDigits:0});
  const c1=v=>v.toFixed(1).replace('.',',');
  const tiempo=s=>`${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor(s%3600/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`;
  const hist=[]; let ultimoMuestreo=-1;

  function registrar(msg,t=estado.tiempo){
    const li=document.createElement('li');
    li.textContent=`[${tiempo(t)}] ${msg}`;
    $('sim-log').prepend(li);
    while($('sim-log').children.length>40)$('sim-log').lastElementChild.remove();
  }
  function marcar(id,on){
    const g=$(id);
    if(g)g.querySelectorAll('.valvula,.instr').forEach(e=>e.classList.toggle('on',on));
  }

  /* ---------- configuración ---------- */
  let refTodo=true;   // la referencia sigue al máximo (todo el tanque) mientras no la bajes a mano
  // Modo automático: el tanque que no es el de origen queda vacío por defecto. Al cambiar de origen, el nuevo
  // tanque recibe el llenado del anterior y este se vacía. Después puedes llenar el otro con su deslizador.
  let origenPrevio=null;
  function vaciarNoSeleccionado(cambio){
    const nuevo=$('cfg-origen').value,otro=nuevo==='A'?'B':'A';
    if(cambio&&origenPrevio&&origenPrevio!==nuevo)modelo.ponerLlenado(estado,nuevo,modelo.porcentajeLlenado(estado,origenPrevio));
    modelo.ponerLlenado(estado,otro,0);
    origenPrevio=nuevo;
  }
  // Demostración: el tanque elegido recibe el porcentaje del deslizador y el otro queda vacío.
  function aplicarDeposito(){
    const origen=$('cfg-origen').value;
    modelo.ponerLlenado(estado,origen,Number($('llen-demo').value));
    modelo.ponerLlenado(estado,origen==='A'?'B':'A',0);
  }
  const IDS_CFG = ['modo', 'origen', 'ref', 'caudal', 't1', 't2', 'pot', 'f1'];
  function iniciarSelectorModos(){
    for(const m of Q.MODOS){
      const o=document.createElement('option');o.value=m.id;o.textContent=m.nombre;
      if(m.id===sec.cfg.modoControl)o.selected=true;
      $('cfg-modo').appendChild(o);
    }
  }
  function leerConfig(){
    const cfg=sec.cfg;
    cfg.modoControl=$('cfg-modo').value;
    cfg.origen=$('cfg-origen').value;
    cfg.caudalPct=Number($('cfg-caudal').value);
    cfg.consignaT1=Number($('cfg-t1').value);
    cfg.consignaT2=Number($('cfg-t2').value);
    cfg.potenciaManualPct=Number($('cfg-pot').value);
    cfg.consignaF1=Number($('cfg-f1').value);
    if(DEMO){
      const maxT=Q.t1MaximaDemostracion();
      $('cfg-t1').max=String(maxT);
      const d=Q.configDemostracion($('cfg-t1').value,$('cfg-origen').value);
      $('cfg-caudal').value=String(d.caudalPct);
      Object.assign(cfg,d);
    }
    // Producción de referencia: nunca más de lo que hay en el tanque de origen (y de su capacidad)
    const maxRef=Q.referenciaMaxima(estado,cfg.origen),slRef=$('cfg-ref');
    slRef.min=String(maxRef<50?0:50);slRef.max=String(maxRef);
    if(refTodo||Number(slRef.value)>maxRef)slRef.value=String(maxRef);
    const ref=Math.min(Number(slRef.value),maxRef);
    cfg.volumenObjetivoMl=ref>=maxRef?null:ref;     // en el máximo: producir hasta agotar el tanque
    $('o-ref').textContent=ref>=maxRef?`${ref} ml (todo el tanque)`:`${ref} ml (${Math.round(ref/maxRef*100)} % del tanque)`;
    const m=Q.MODOS.find(x=>x.id===cfg.modoControl);
    $('cfg-modo-desc').textContent=`${m.detalle} (manual, ${m.manual}; consignas y ganancias supuestas)`;
    todos('[data-modos]').forEach(l=>{l.hidden=!l.dataset.modos.split(' ').includes(cfg.modoControl);});
    const t1ss=Q.t1Estacionaria(cfg);
    const mal=t1ss<cfg.consignaT1-1;
    $('cfg-aviso').textContent=mal
      ?`Con esta configuración T1 se estabilizaría en ≈ ${c1(t1ss)} °C, por debajo de ${cfg.consignaT1} °C: saltará la alarma de precalentamiento.`
      :`T1 podrá llegar a ${cfg.consignaT1} °C con esta configuración (el modelo da hasta ≈ ${c1(Q.t1Alcanzable(cfg.modoControl==='multiple'?cfg.consignaF1/modelo.PARAMS.caudalN1MaxMlMin*100:cfg.caudalPct,cfg.potenciaMaxPct))} °C).`;
    $('cfg-aviso').className=mal?'sec-aviso mal':'sec-aviso';
    if(DEMO){
      const ml=Number($('llen-demo').value)/100*modelo.PARAMS.capacidadMl;
      const pocoProducto=ml<cfg.volumenMinimoMl;
      $('cfg-aviso').textContent=`Hasta ${Q.t1MaximaDemostracion()} °C con este modelo. Para ${cfg.consignaT1} °C la planta usará N1 al ${cfg.caudalPct} % (el mayor caudal con el que llega) y producirá ${cfg.volumenObjetivoMl!=null?cfg.volumenObjetivoMl+' ml':'hasta agotar el tanque'} (o hasta que pulses Terminar producción).`
        +(pocoProducto?` Con el tanque ${cfg.origen} tan vacío (${Math.round(ml)} ml) no arrancará: saltará la alarma.`:'');
      if(pocoProducto)$('cfg-aviso').className='sec-aviso mal';
    }
    for(const id of ['t1','t2','pot','f1','caudal'])$(`o-${id}`).textContent=$(`cfg-${id}`).value;
  }
  function bloquearConfig(bloq){
    for(const id of IDS_CFG)$(`cfg-${id}`).disabled=bloq;
  }

  /* ---------- acciones ---------- */
  function drenarEventos(){
    for(const e of sec.eventos.splice(0))registrar(e.mensaje,e.t);
  }
  function iniciar(){
    leerConfig();
    if(Q.iniciar(sec,estado)){ejecutando=true;registrar('Secuencia iniciada');}
    drenarEventos();pintar();
  }
  function reiniciar(){
    estado=modelo.crearEstado();sec=Q.crearSecuencia(DEMO?Q.configDemostracion(Number($('cfg-t1').value),$('cfg-origen').value):undefined);ejecutando=false;
    if(DEMO)aplicarDeposito();else vaciarNoSeleccionado(false);
    hist.length=0;ultimoMuestreo=-1;
    $('sim-log').replaceChildren();registrar('Planta y secuencia reiniciadas');
    leerConfig();pintar();
  }

  /* ---------- representación ---------- */
  const FASES_VISIBLES=Q.ORDEN.concat(['finalizada']);
  function pintar(){
    const o=modelo.observaciones(estado);
    for(const [t,id] of [['T1','v-T1'],['T2','v-T2'],['T3','v-T3'],['T4','v-T4'],['T5','v-T5']])$(id).textContent=`${c1(o[t])} °C`;
    $('v-F1').textContent=`${nf.format(o.F1)} ml/min`;
    $('v-L1').textContent=`${nf.format(o.L1)} mm`;
    for(const v of ['SOL1','SOL2','SOL3','SOL4','SOL5','N1','N2'])marcar(`g-${v}`,estado.salidas[v]);
    todos('.tubo[data-bomba]').forEach(x=>x.classList.toggle('activo',estado.salidas[x.dataset.bomba]));
    todos('[data-ruta]').forEach(x=>x.classList.toggle('activo',estado.salidas.N1&&(x.dataset.ruta==='desvio')===estado.salidas.SOL1));
    todos('[data-solenoide]').forEach(x=>x.classList.toggle('activo',estado.salidas[x.dataset.solenoide]));
    todos('[data-circuito="frio"]').forEach(x=>x.classList.toggle('activo',estado.salidas.SOL3));
    todos('[data-circuito="colector-frio"]').forEach(x=>x.classList.toggle('activo',['SOL3','SOL4','SOL5'].some(id=>estado.salidas[id])));
    for(const [id,vol] of [['A',estado.aMl],['B',estado.bMl]]){
      const alto=136*vol/modelo.PARAMS.capacidadMl;   // 100 % llena hasta arriba
      $(`nivel-${id}`).setAttribute('y',String(208-alto));
      $(`nivel-${id}`).setAttribute('height',String(alto));
    }
    $('c-TERM').classList.toggle('alarma',o.TERM);
    $('c-HL').classList.toggle('alarma',o.HL);
    $('c-LL').classList.toggle('alarma',o.LL);
    $('c-LVLC').classList.remove('alarma');$('c-HLC').classList.remove('alarma');
    if(DEMO){
      const sd=$('llen-demo'),pctO=modelo.porcentajeLlenado(estado,$('cfg-origen').value);
      if(document.activeElement!==sd)sd.value=String(Math.round(pctO));
      $('ollen-demo').textContent=`${Math.round(pctO)} %`;
    }
    for(const d of ['A','B']){
      const sl=$(`llen-${d}`);
      if(!sl)continue;
      const pct=modelo.porcentajeLlenado(estado,d);
      if(document.activeElement!==sl)sl.value=String(Math.round(pct));
      $(`ollen-${d}`).textContent=`${Math.round(pct)} %`;
    }
    const cal=estado.salidas.RES&&estado.consignas.R>0;
    $('c-PWR').classList.toggle('on',cal);
    $('resistencia').style.stroke=cal?'var(--caliente)':'';
    $('v-PWR').textContent=`${estado.salidas.RES?'ON':'OFF'} · ${c1(estado.consignas.R)} %`;

    // Fases
    const idx=FASES_VISIBLES.indexOf(sec.fase);
    todos('#fases li').forEach(li=>{
      const i=FASES_VISIBLES.indexOf(li.dataset.fase);
      li.className=(sec.fase===li.dataset.fase?'actual ':'')+(idx>=0&&i<idx?'hecha ':'')+'';
    });
    $('fase-nombre').textContent=Q.NOMBRES[sec.fase];
    $('fase-motivo').textContent=sec.motivo?`Motivo del cambio de fase: ${sec.motivo}`:'';
    $('fase-nombre').className=`fase-nombre ${sec.fase==='alarma'?'alarma':sec.fase==='finalizada'?'fin':ejecutando?'marcha':''}`;
    $('d-tfase').textContent=tiempo(sec.tFase);
    $('d-ttotal').textContent=tiempo(sec.tTotal);
    $('d-t1').textContent=`${c1(o.T1)} °C (consigna ${sec.cfg.consignaT1})`;
    const t2Cons=sec.cfg.modoControl==='cascada'?sec.consignaT2Activa:(['onoff','T2'].includes(sec.cfg.modoControl)?sec.cfg.consignaT2:null);
    $('d-t2').textContent=`${c1(o.T2)} °C${t2Cons!==null?` (consigna ${c1(t2Cons)})`:''}`;
    $('d-t3').textContent=`${c1(o.T3)} °C`;
    $('d-r').textContent=`${estado.salidas.RES?'ON':'OFF'} · ${c1(estado.consignas.R)} % · ${Math.round(estado.consignas.R*50/100)}/50 ciclos`;
    const producido=['produccion','lavado','parada','finalizada'].includes(sec.fase)?Math.max(0,estado.finalMl-sec.finalInicialMl):0;
    $('d-final').textContent=sec.cfg.volumenObjetivoMl!=null?`${nf.format(producido)} / ${nf.format(sec.cfg.volumenObjetivoMl)} ml de referencia`:`${nf.format(producido)} ml`;
    // contadores de producto: miden mientras circula producto, con SOL1 en salida normal (acabado) o activada (desvío)
    $('v-QF').textContent=`${nf.format(estado.finalMl)} ml`;
    $('v-QD').textContent=`${nf.format(estado.desviadoMl)} ml`;
    $('d-medido').textContent=`acabado ${nf.format(estado.finalMl)} ml · desviado ${nf.format(estado.desviadoMl)} ml · total ${nf.format(estado.finalMl+estado.desviadoMl)} ml`;
    $('d-desv').textContent=`${nf.format(sec.tiempoDesvioS)} s en producción · ${nf.format(estado.desviadoMl)} ml recirculados`;
    $('d-tanque').textContent=`A ${nf.format(estado.aMl)} ml · B ${nf.format(estado.bMl)} ml`;
    $('d-sol1').textContent=estado.salidas.SOL1?'Desviado (recircula al tanque)':'Normal (producto acabado)';

    const caja=$('alarma-caja');
    if(sec.alarma){
      caja.hidden=false;
      $('alarma-causa').textContent=sec.alarma.causa;
      $('alarma-accion').textContent=`Acción correctiva: ${sec.alarma.accion}`;
    }else caja.hidden=true;

    const fin=['reposo','finalizada'].includes(sec.fase);
    const enAlarma=sec.fase==='alarma';
    $('b-iniciar').disabled=!fin;
    $('b-pausa').disabled=fin||enAlarma;
    $('b-pausa').textContent=(ejecutando||fin||enAlarma)?'Ⅱ Pausar':'▶ Reanudar';
    $('b-parar').disabled=fin||enAlarma||sec.fase==='parada';
    $('b-saltar').disabled=!ORDEN_SALTO.includes(sec.fase);
    $('b-terminar').disabled=sec.fase!=='produccion';
    $('b-emergencia').disabled=sec.fase==='reposo';
    $('b-reconocer').disabled=!enAlarma;
    bloquearConfig(!fin);
    for(const d of ['A','B']){const sl=$(`llen-${d}`);if(sl)sl.disabled=!fin;}
    if(DEMO)$('llen-demo').disabled=!fin;

    chip('chip-fase',sec.fase==='alarma'?'error':sec.fase==='finalizada'?'ok':ejecutando?'ok':'aviso',
      `Fase: ${Q.NOMBRES[sec.fase]}${ejecutando||fin||enAlarma?'':' (en pausa)'}`);
    chip('chip-tiempo','ok',`Simulado ${tiempo(estado.tiempo)} · ${velocidad}×`);
    const sinProducto=estado.vacio&&sec.fase!=='lavado';   // en el lavado no se usa producto
    chip('chip-io',estado.temperaturaCorte||sinProducto?'error':'ok',estado.temperaturaCorte?'Corte térmico simulado':sinProducto?'Sin producto en origen':'E/S virtuales');
  }
  const ORDEN_SALTO=Q.ORDEN.slice(0,-1);
  function chip(id,clase,txt){$(id).className=`chip ${clase}`;$(id).lastElementChild.textContent=txt;}

  function grafica(){
    const cv=$('sim-trend'),cx=cv.getContext('2d');
    if(!cx)return;
    const w=cv.width,h=cv.height;cx.clearRect(0,0,w,h);
    const css=getComputedStyle(document.documentElement);
    const texto=css.getPropertyValue('--tenue').trim()||'#6b7380',borde=css.getPropertyValue('--borde').trim()||'#dde1e6';
    const l=48,r=w-17,t=15,b=h-28;
    const y=v=>b-(Math.max(15,Math.min(100,v))-15)/85*(b-t);
    cx.font='12px system-ui,sans-serif';cx.textBaseline='middle';
    for(const g of [20,40,60,80,100]){
      cx.beginPath();cx.moveTo(l,y(g));cx.lineTo(r,y(g));cx.strokeStyle=borde;cx.lineWidth=1;cx.stroke();
      cx.fillStyle=texto;cx.fillText(g+'°',10,y(g));
    }
    // consignas: T1 (gris) y, si el modo la usa, la de T2 (naranja)
    const raya=(v,col)=>{cx.setLineDash([6,5]);cx.beginPath();cx.moveTo(l,y(v));cx.lineTo(r,y(v));cx.strokeStyle=col;cx.lineWidth=1.5;cx.stroke();cx.setLineDash([]);};
    raya(sec.cfg.consignaT1,'#8e8e8e');
    const t2g=sec.cfg.modoControl==='cascada'?sec.consignaT2Activa:(['onoff','T2'].includes(sec.cfg.modoControl)?sec.cfg.consignaT2:null);
    if(t2g!==null)raya(t2g,'#d66d2b');
    if(hist.length<1)return;
    const i0=hist[0].tiempo,i1=hist[hist.length-1].tiempo;
    const x=tt=>l+((tt-i0)/Math.max(1,i1-i0))*(r-l);
    for(const [k,col] of [['T2','#d66d2b'],['T1','#2d80c7'],['T3','#22a2a0']]){
      cx.beginPath();hist.forEach((v,i)=>{if(i===0)cx.moveTo(x(v.tiempo),y(v[k]));else cx.lineTo(x(v.tiempo),y(v[k]));});
      cx.strokeStyle=col;cx.lineWidth=2.5;cx.stroke();
    }
    cx.fillStyle=texto;cx.textBaseline='bottom';cx.fillText(tiempo(i0),l,b+22);
    const tf=tiempo(i1);cx.fillText(tf,r-cx.measureText(tf).width,b+22);
  }
  function muestrear(){
    if(estado.tiempo-ultimoMuestreo<5&&hist.length)return;
    const o=modelo.observaciones(estado);
    hist.push({tiempo:estado.tiempo,T1:o.T1,T2:o.T2,T3:o.T3});
    if(hist.length>300)hist.shift();
    ultimoMuestreo=estado.tiempo;grafica();
  }

  /* ---------- eventos ---------- */
  function configurar(){
    $('cfg-ref').addEventListener('input',()=>{refTodo=Number($('cfg-ref').value)>=Number($('cfg-ref').max);});
    for(const id of IDS_CFG)$(`cfg-${id}`).addEventListener('input',()=>{leerConfig();grafica();});
    for(const d of ['A','B']){
      const sl=$(`llen-${d}`);
      if(!sl)continue;
      sl.addEventListener('input',()=>{modelo.ponerLlenado(estado,d,Number(sl.value));leerConfig();pintar();});
      sl.addEventListener('change',()=>registrar(`Llenado del tanque ${d}: ${sl.value} %`));
    }
    if(DEMO){
      $('llen-demo').addEventListener('input',()=>{aplicarDeposito();leerConfig();pintar();});
      $('llen-demo').addEventListener('change',()=>registrar(`Llenado del tanque ${$('cfg-origen').value}: ${$('llen-demo').value} % (el otro, vacío)`));
      $('cfg-origen').addEventListener('change',()=>{aplicarDeposito();leerConfig();pintar();});
    }
    if(!DEMO)$('cfg-origen').addEventListener('change',()=>{vaciarNoSeleccionado(true);leerConfig();pintar();});
    $('b-iniciar').addEventListener('click',iniciar);
    $('b-pausa').addEventListener('click',()=>{ejecutando=!ejecutando;registrar(ejecutando?'Reanudada':'En pausa');pintar();});
    $('b-parar').addEventListener('click',()=>{Q.ordenarParada(sec,estado);drenarEventos();pintar();});
    $('b-terminar').addEventListener('click',()=>{Q.terminarProduccion(sec,estado);drenarEventos();pintar();});
    $('b-saltar').addEventListener('click',()=>{Q.saltarFase(sec,estado);drenarEventos();pintar();});
    $('b-emergencia').addEventListener('click',()=>{Q.emergencia(sec,estado);ejecutando=true;drenarEventos();pintar();});
    $('b-reconocer').addEventListener('click',()=>{ejecutando=true;Q.reconocer(sec,estado);drenarEventos();pintar();});
    $('b-reset').addEventListener('click',reiniciar);
    $('sim-velocidad').addEventListener('change',e=>{velocidad=Number(e.target.value);pintar();});
  }
  iniciarSelectorModos();
  configurar();
  if(DEMO)aplicarDeposito();else vaciarNoSeleccionado(false);
  leerConfig();
  registrar('Sesión local: no hay conexión con equipos');
  pintar();grafica();

  setInterval(()=>{
    if(!ejecutando||['reposo','finalizada'].includes(sec.fase)&&!estado.salidas.N2)return;
    const total=0.25*velocidad,n=Math.max(1,Math.ceil(total)),dt=total/n;
    for(let i=0;i<n;i++)Q.paso(sec,estado,dt);
    drenarEventos();
    if(sec.fase==='finalizada'&&ejecutando){ejecutando=false;registrar('Secuencia finalizada');}
    pintar();muestrear();
  },250);
  window.secuenciaPCT23={estado:()=>estado,sec:()=>sec,modelo,Q};
})();
