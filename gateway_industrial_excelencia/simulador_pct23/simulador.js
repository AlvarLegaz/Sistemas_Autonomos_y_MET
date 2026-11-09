/* Interfaz local para el SVG de pct23_revision17.html.
   No emplea fetch, EventSource, WebSocket ni ninguna API remota. */
(()=>{
  'use strict';
  const modelo=window.PCT23Modelo;
  // En modo manual la planta arranca con los dos depósitos vacíos; el alumno los llena con los deslizadores o con SOL4/SOL5.
  const estadoInicial=()=>{const s=modelo.crearEstado();s.aMl=0;s.bMl=0;return s;};
  let estado=estadoInicial();
  const $=id=>document.getElementById(id);
  const todos=s=>Array.from(document.querySelectorAll(s));
  const nf=new Intl.NumberFormat('es-ES',{maximumFractionDigits:0});
  const c=v=>v.toFixed(1).replace('.',',');
  const tiempo=s=>`${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor(s%3600/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`;
  const hist=[];
  let ultimoTiempoGrafica=-1;
  let ultimoAviso='';
  function registrar(mensaje){
    const item=document.createElement('li');
    item.textContent=`[${tiempo(estado.tiempo)}] ${mensaje}`;
    $('sim-log').prepend(item);
    while($('sim-log').children.length>16) $('sim-log').lastElementChild.remove();
  }
  const CONSIGNAS={
    R:{nombre:'Potencia de la resistencia',ciclos:50},
    N1V:{nombre:'Velocidad (PWM)'},
    N2V:{nombre:'Velocidad (PWM)'},
  };
  const textoConsigna=(id,v)=>CONSIGNAS[id].ciclos?`${v} % · ${Math.round(v*CONSIGNAS[id].ciclos/100)}/${CONSIGNAS[id].ciclos} ciclos`:`${v} %`;
  function consigna(id,v){
    estado.consignas[id]=Math.max(0,Math.min(100,Number(v)||0));
    $(`r-${id}`).value=String(estado.consignas[id]);
    $(`o-${id}`).textContent=textoConsigna(id,estado.consignas[id]);
  }
  function marcar(id,on){
    const g=$(id);
    if(g) g.querySelectorAll('.valvula,.instr').forEach(e=>e.classList.toggle('on',on));
  }
  // Electroválvulas en los relés K3-K7 y resistencia en J7 OUT03, igual que el sinóptico real.
  const VALVULAS=[
    ['SOL1','SOL1','Desvío de producto · relé K3'],
    ['SOL2','SOL2','Depósitos A/B · relé K4'],
    ['SOL3','SOL3','Agua fría · relé K5'],
    ['SOL4','SOL4','Ramal depósito A · relé K6'],
    ['SOL5','SOL5','Ramal depósito B · relé K7'],
    ['RES','Calefacción','Resistencia heat unit · J7 OUT03'],
  ];
  const canales={
    T1:'v-T1',T2:'v-T2',T3:'v-T3',T4:'v-T4',T5:'v-T5',
    F1:'v-F1',L1:'v-L1',
  };
  function actualizarIndicadores(){
    const o=modelo.observaciones(estado);
    for(const [tipo,id] of Object.entries(canales)){
      const val=o[tipo];
      $(id).textContent=tipo==='F1'? `${nf.format(val)} ml/min`:
        tipo==='L1'? `${nf.format(val)} mm`:`${c(val)} °C`;
    }
    for(const valvula of ['SOL1','SOL2','SOL3','SOL4','SOL5','N1','N2']){
      marcar(`g-${valvula}`,estado.salidas[valvula]);
    }
    marcar('g-V3',estado.v3);
    for(const id of ['N1','N2'])$(`g-${id}`).querySelector('path').classList.toggle('invertida',!!estado.giro[id]); // flecha de la bomba según el sentido de giro
    todos('.tubo[data-bomba]').forEach(x=>x.classList.toggle('activo',estado.salidas[x.dataset.bomba]));
todos('[data-tanque]').forEach(x=>x.classList.toggle('activo',(x.dataset.tanque==='B')===!!estado.salidas.SOL2)); // tanque elegido por SOL2: se ilumina su tubería hasta la válvula
    // SOL1 reparte tras el tubo de residencia: solo se ilumina la rama por la que circula el producto.
    todos('[data-ruta]').forEach(x=>x.classList.toggle('activo',estado.salidas.N1&&(x.dataset.ruta==='desvio')===estado.salidas.SOL1));
    todos('[data-solenoide]').forEach(x=>x.classList.toggle('activo',estado.salidas[x.dataset.solenoide]));
    todos('[data-circuito="frio"]').forEach(x=>x.classList.toggle('activo',estado.salidas.SOL3));
    todos('[data-circuito="colector-frio"]').forEach(x=>x.classList.toggle('activo',
      ['SOL3','SOL4','SOL5'].some(id=>estado.salidas[id])));

    // Sensores y niveles visuales. No se modifican coordenadas de depósitos ni sensores.
    const maxAltura=136;   // interior del depósito dibujado: 100 % llena hasta arriba
    for(const [id,volumen] of [['A',estado.aMl],['B',estado.bMl]]){
      const alto=maxAltura*volumen/modelo.PARAMS.capacidadMl;
      $(`nivel-${id}`).setAttribute('y',String(208-alto));
      $(`nivel-${id}`).setAttribute('height',String(alto));
    }
    $('c-TERM').classList.toggle('alarma',o.TERM);
    $('c-HL').classList.toggle('alarma',o.HL);
    $('c-LL').classList.toggle('alarma',o.LL);
    $('c-LVLC').classList.remove('alarma');
    $('c-HLC').classList.remove('alarma');
    // porcentaje de llenado de los depósitos (se refleja el consumo y el relleno)
    for(const d of ['A','B']){
      const sl=$(`llen-${d}`);
      if(!sl)continue;
      sl.disabled=estado.ejecutando;   // en marcha el nivel ya no se ajusta: solo se vacía o se rellena con el proceso
      const pct=modelo.porcentajeLlenado(estado,d),ml=d==='B'?estado.bMl:estado.aMl;
      if(document.activeElement!==sl)sl.value=String(Math.round(pct));
      $(`ollen-${d}`).textContent=`${Math.round(pct)} %`;
      const det=$(`dllen-${d}`);
      if(det)det.textContent=`${nf.format(ml)} ml de ${modelo.PARAMS.capacidadMl}`+(d==='A'?` · L1 = ${nf.format(pct*2.5)} mm`:` · ${o.HL?'HL activo':o.LL?'LL activo':'entre LL y HL'}`);
    }

    const calefaccion=estado.salidas.RES&&estado.consignas.R>0;
    $('c-PWR').classList.toggle('on',calefaccion);
    $('resistencia').style.stroke=calefaccion?'var(--caliente)':'';
    $('v-PWR').textContent=`${estado.salidas.RES?'ON':'OFF'} · ${textoConsigna('R',estado.consignas.R)}`;
    for(const [id] of VALVULAS){
      const on=!!estado.salidas[id];
      $(`b-${id}`).classList.toggle('on',on);
      $(`b-${id}`).textContent=on?'Desactivar':'Activar';
      const e=$(`t-${id}`).querySelector('.estado-bomba');
      e.className=`estado-bomba ${on?'ok':''}`;
      e.lastElementChild.textContent=id==='RES'?(on?'Calentando':'Apagada'):(on?'Abierta':'Cerrada');
    }
    for(const id of ['N1','N2']){
      const bt=$(`b-${id}`);
      bt.classList.toggle('on',estado.salidas[id]);
      bt.textContent=estado.salidas[id]?'Apagar':'Encender';
      const e=$(`t-${id}`).querySelector('.estado-bomba');
      e.className=`estado-bomba ${estado.salidas[id]?'ok':''}`;
      e.lastElementChild.textContent=estado.salidas[id]?'En marcha':'Parada';
    }
    for(const bt of todos('.btn-sentido')){
      const v=estado.giro[bt.dataset.bomba];
      bt.classList.toggle('sel',v);
      bt.textContent=`Sentido ${+v} · pulsa para invertir`;
    }

    const chip=(id,clase,valor)=>{
      $(id).className=`chip ${clase}`;
      $(id).lastElementChild.textContent=valor;
    };
    chip('chip-broker','ok','Sin MQTT · modo local');
    chip('chip-gateway',estado.ejecutando?'ok':'aviso',estado.ejecutando?`Simulando · ${estado.velocidad}×`:'Simulación en pausa');
    chip('chip-io',estado.temperaturaCorte||estado.vacio?'error':'ok',estado.temperaturaCorte?'Corte térmico simulado':estado.vacio?'Sin producto en origen':'E/S virtuales');
    $('sim-time').textContent=tiempo(estado.tiempo);
    $('sim-flow').textContent=`${nf.format(o.F1)} ml/min`;
    $('sim-heat').textContent=`${c(o.T2)} °C`;
    $('sim-A').textContent=`${nf.format(estado.aMl)} ml`;
    $('sim-B').textContent=`${nf.format(estado.bMl)} ml`;
    $('sim-finished').textContent=`${nf.format(estado.finalMl)} ml`;
    $('sim-diverted').textContent=`${nf.format(estado.desviadoMl)} ml`;
    // contadores de producto: miden mientras circula producto, según SOL1 esté en salida normal o activada (desvío)
    $('v-QF').textContent=`${nf.format(estado.finalMl)} ml`;
    $('v-QD').textContent=`${nf.format(estado.desviadoMl)} ml`;
    $('sim-drain').textContent=`${c(estado.desagueMl/1000)} L`;
    $('sim-play').disabled=estado.ejecutando;
    $('sim-pause').disabled=!estado.ejecutando;
    $('sim-velocidad').value=String(estado.velocidad);
    let aviso='';
    if(estado.temperaturaCorte) aviso='Corte térmico simulado: resistencia desconectada. Se rearma por debajo de 70 °C; después vuelve a conectarla.';
    else if(estado.vacio) aviso='Depósito seleccionado vacío: la bomba N1 no suministra producto.';
    else if(estado.salidas.N1 && estado.giro.N1) aviso='N1 encendida con el sentido de giro invertido (OUT06 = 1). El flujo inverso no se simula.';
    else if(estado.salidas.N1 && estado.consignas.N1V===0) aviso='N1 encendida, pero la consigna de velocidad es 0 %.';
    else if(estado.salidas.N1 && !estado.salidas.N2) aviso='N1 circula sin N2: el producto no recibe calentamiento activo significativo.';
    else if(estado.salidas.N1 && !estado.salidas.SOL3) aviso='Producto circulando sin refrigeración activa (SOL3 cerrada).';
    else if(estado.ejecutando) aviso=`Proceso en marcha. Alimentación desde tanque ${estado.salidas.SOL2?'B':'A'}; salida ${estado.salidas.SOL1?'desviada':'producto final'}.`;
    else aviso='Simulación pausada. Puedes modificar los actuadores y luego reanudar.';
    $('sim-status').textContent=aviso;
    if(aviso!==ultimoAviso&&(estado.temperaturaCorte||estado.vacio)) registrar(aviso);
    ultimoAviso=aviso;
  }
  function pintarGrafica(){
    const canvas=$('sim-trend'),cx=canvas.getContext('2d');
    if(!cx)return;
    const w=canvas.width,h=canvas.height;
    cx.clearRect(0,0,w,h);
    const css=getComputedStyle(document.documentElement);
    const text=css.getPropertyValue('--tenue').trim()||'#6b7380';
    const border=css.getPropertyValue('--borde').trim()||'#dde1e6';
    const left=48,right=w-17,top=15,bottom=h-28;
    const y=v=>bottom-(Math.max(15,Math.min(100,v))-15)/(100-15)*(bottom-top);
    cx.font='12px system-ui,sans-serif';cx.textBaseline='middle';
    for(const t of [20,40,60,80,100]){
      cx.beginPath();cx.moveTo(left,y(t));cx.lineTo(right,y(t));cx.strokeStyle=border;cx.lineWidth=1;cx.stroke();
      cx.fillStyle=text;cx.fillText(t+'°',10,y(t));
    }
    if(hist.length<1)return;
    const inicio=hist[0].tiempo,final=hist[hist.length-1].tiempo;
    const x=t=>left+((t-inicio)/Math.max(1,final-inicio))*(right-left);
    for(const [campo,color] of [['T2','#d66d2b'],['T1','#2d80c7'],['T3','#22a2a0']]){
      cx.beginPath();hist.forEach((v,i)=>{if(i===0)cx.moveTo(x(v.tiempo),y(v[campo]));else cx.lineTo(x(v.tiempo),y(v[campo]));});
      cx.strokeStyle=color;cx.lineWidth=2.5;cx.stroke();
    }
    cx.fillStyle=text;cx.textBaseline='bottom';cx.fillText(tiempo(inicio),left,bottom+22);
    const to=tiempo(final);cx.fillText(to,right-cx.measureText(to).width,bottom+22);
  }
  // el lienzo se dibuja al tamaño con que se ve (así el texto no se deforma) y se redibuja al cambiar de tamaño
  function ajustarLienzo(){
    const cv=$('sim-trend');
    const w=Math.round(cv.clientWidth),h=Math.round(cv.clientHeight);
    if(!w||(cv.width===w&&cv.height===h))return;
    cv.width=w;cv.height=h;pintarGrafica();
  }
  window.addEventListener('resize',ajustarLienzo);
  function muestrear(){
    const t=estado.tiempo;
    if(t-ultimoTiempoGrafica<2 && hist.length)return;
    const o=modelo.observaciones(estado);
    hist.push({tiempo:t,T1:o.T1,T2:o.T2,T3:o.T3});
    if(hist.length>140)hist.shift();
    ultimoTiempoGrafica=t;
    pintarGrafica();
  }
  function actualizar(){actualizarIndicadores();muestrear();}
  function configurarControles(){
    $('g-V3').addEventListener('click',()=>{estado.v3=!estado.v3;registrar(`V3: ${estado.v3?'abierta (vacía el tanque B)':'cerrada'}`);actualizar();});
    for(const id of ['SOL1','SOL2','SOL3','SOL4','SOL5','N1','N2']){
      $(`g-${id}`).addEventListener('click',()=>{
        estado.salidas[id]=!estado.salidas[id];
        registrar(`${id}: ${estado.salidas[id]?'activada':'desactivada'}`);
        actualizar();
      });
    }
    for(const id of ['N1','N2']){
      $(`b-${id}`).addEventListener('click',()=>{
        estado.salidas[id]=!estado.salidas[id];
        registrar(`${id}: ${estado.salidas[id]?'encendida':'apagada'}`);
        actualizar();
      });
    }
    for(const [id,titulo,detalle] of VALVULAS){
      const t=document.createElement('div');
      t.className='tarjeta';t.id=`t-${id}`;
      t.innerHTML=`<h3>${titulo}</h3><small>${detalle}</small>
        <span class="estado-bomba"><i class="punto"></i><span>—</span></span>
        <button class="grande" id="b-${id}">Activar</button>`;
      if(id==='RES')$('tarjetas-bombas').insertBefore(t,$('t-N1')); // entre heat unit y feed unit
      else $('tarjetas-valvulas').appendChild(t);
      $(`b-${id}`).addEventListener('click',()=>{
        estado.salidas[id]=!estado.salidas[id];
        registrar(`${titulo}: ${estado.salidas[id]?(id==='RES'?'encendida':'activada'):(id==='RES'?'apagada':'desactivada')}`);
        actualizar();
      });
    }
    $('cerrar-valvulas').addEventListener('click',()=>{
      for(const [id] of VALVULAS)if(id.startsWith('SOL'))estado.salidas[id]=false;
      registrar('Electroválvulas cerradas');actualizar();
    });
    for(const bt of todos('.btn-sentido')){
      const id=bt.dataset.bomba;
      bt.addEventListener('click',()=>{
        estado.giro[id]=!estado.giro[id];
        registrar(`Sentido de giro ${id}: ${+estado.giro[id]} (${id==='N2'?'OUT05':'OUT06'})`);
        actualizar();
      });
    }
    // Deslizadores: potencia de la resistencia (ráfagas de 50 ciclos) y velocidad PWM de cada bomba.
    for(const id of Object.keys(CONSIGNAS)){
      const fila=document.createElement('div');
      fila.className='consigna';
      fila.innerHTML=`<label for="r-${id}">${CONSIGNAS[id].nombre}</label>
        <div class="fila"><input type="range" id="r-${id}" min="0" max="100" value="${estado.consignas[id]}">
        <output id="o-${id}">${textoConsigna(id,estado.consignas[id])}</output></div>`;
      if(id==='R')$('t-RES').appendChild(fila);else $(`c-${id}`).replaceWith(fila);
      const range=fila.querySelector('input');
      range.addEventListener('input',()=>{consigna(id,range.value);actualizarIndicadores();});
      range.addEventListener('change',()=>registrar(`${CONSIGNAS[id].nombre} (${id}): ${textoConsigna(id,estado.consignas[id])}`));
    }
    $('parar-bombas').addEventListener('click',()=>{
      estado.salidas.N1=estado.salidas.N2=false;estado.giro.N1=estado.giro.N2=false;
      registrar('Bombas detenidas');actualizar();
    });
    const pararTodo=document.createElement('button');pararTodo.textContent='Parar todo';
    pararTodo.id='sim-stop-all';
    pararTodo.addEventListener('click',()=>{
      for(const k of modelo.OUTPUT_IDS)estado.salidas[k]=false;
      estado.giro.N1=estado.giro.N2=false;
      estado.v3=false;
      for(const k of Object.keys(CONSIGNAS))consigna(k,0);
      estado.ejecutando=false; // pausa también el reloj: así se desbloquea el llenado de los tanques y se puede volver a Iniciar
      registrar('Parada general: simulación en pausa; pulsa Iniciar para continuar');actualizar();
    });
    $('controles').appendChild(pararTodo);
    $('sim-play').addEventListener('click',()=>{estado.ejecutando=true;registrar('Simulación iniciada');actualizar();});
    $('sim-pause').addEventListener('click',()=>{estado.ejecutando=false;registrar('Simulación pausada');actualizar();});
    for(const d of ['A','B']){
      const sl=$(`llen-${d}`);
      if(!sl)continue;
      sl.addEventListener('input',()=>{modelo.ponerLlenado(estado,d,Number(sl.value));actualizar();});
      sl.addEventListener('change',()=>registrar(`Llenado del tanque ${d}: ${sl.value} %`));
    }
    $('sim-reset').addEventListener('click',()=>{
      estado=estadoInicial();hist.length=0;ultimoTiempoGrafica=-1;ultimoAviso='';
      for(const k of Object.keys(CONSIGNAS))consigna(k,estado.consignas[k]);
      $('sim-log').replaceChildren();registrar('Simulador reiniciado');actualizar();
    });
    $('sim-velocidad').addEventListener('change',e=>{
      estado.velocidad=Number(e.target.value);registrar(`Velocidad de simulación: ${estado.velocidad}×`);actualizar();
    });
  }
  configurarControles();
  ajustarLienzo();
  registrar('Sesión local cargada: no hay conexión con máquinas');
  actualizar();
  // Tick real fijo; en cada tick avanzan segundos simulados según velocidad elegida.
  setInterval(()=>{
    if(!estado.ejecutando)return;
    modelo.avanzar(estado,0.25*estado.velocidad);
    actualizar();
  },250);
  window.simuladorPCT23={estado:()=>estado,modelo}; // Inspección y pruebas locales.
})();
