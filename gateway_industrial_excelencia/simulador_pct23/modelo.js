/* PCT23 - Modelo DIDÁCTICO, no calibrado ni conectado a equipos físicos.
 * Unidades: segundos, °C, ml, ml/min. Sin dependencias externas. */
(function (root) {
  'use strict';
  const PARAMS = Object.freeze({
    ambiente: 22, capacidadMl: 2400, caudalN1MaxMlMin: 550,
    llenadoMlMin: 260, refrigeracionMlMin: 450,
    tauCalentadorS: 200, tauEnfriamientoS: 360, limiteTermicoC: 91,
  });
  const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
  const OUTPUT_IDS=Object.freeze(['N1','N2','SOL1','SOL2','SOL3','SOL4','SOL5','RES']); // RES: resistencia de calefacción on/off (J7 OUT04), solo indicador
  function crearEstado() {
    return {
      tiempo: 0, ejecutando: false, velocidad: 20,
      salidas: Object.fromEntries(OUTPUT_IDS.map(id=>[id,false])),
      // giro: valor de OUT06 (N1) y OUT05 (N2); 0 = sentido de proceso (supuesto, sin confirmar).
      giro: {N1:false,N2:false}, consignas: {R:0,N1V:60,N2V:60},
      aMl: 1760, bMl: 1270, aguaCalienteC: PARAMS.ambiente,
      t1:PARAMS.ambiente,t3:PARAMS.ambiente,t4:PARAMS.ambiente,t5:PARAMS.ambiente,
      caudalProductoMlMin:0, caudalFrioMlMin:0,
      finalMl:0, desviadoMl:0, desagueMl:0,
      temperaturaCorte:false, vacio:false,
    };
  }
  function activarEjemplo(s) {
    s.salidas.N1=true;
    s.salidas.N2=true;
    s.salidas.SOL3=true;
    s.salidas.SOL2=false; // Alimentación desde A en este modelo.
    s.salidas.SOL1=false; // Salida de producto final.
    s.giro.N1=false;s.giro.N2=false;
    s.salidas.RES=true;
    s.consignas.N1V=60;
    s.consignas.R=75;
    s.consignas.N2V=60;
    return s;
  }
  // Integración Euler suavizada en pasos de hasta 1 segundo para estabilidad.
  function avanzar(s, segundos) {
    let pendientes=clamp(Number(segundos)||0,0,10000);
    while (pendientes>0) {
      const dt=Math.min(1,pendientes);
      avanzarPaso(s,dt);
      pendientes-=dt;
    }
    return s;
  }
  function avanzarPaso(s,dt) {
    s.tiempo+=dt;
    const p=PARAMS;
    const sol=s.salidas;
    // Las dos resistencias de 120 V van en serie (una sola a 230 V), por ráfagas de 50 ciclos: R % = R/100 de los ciclos.
    const r=s.salidas.RES?clamp(s.consignas.R/100,0,1):0;
    const objetivoAgua=p.ambiente+69*r;
    const temperaturaObjetivo=s.temperaturaCorte?p.ambiente:objetivoAgua;
    const tau=s.temperaturaCorte?p.tauEnfriamientoS:(r? p.tauCalentadorS:p.tauEnfriamientoS);
    s.aguaCalienteC+=(temperaturaObjetivo-s.aguaCalienteC)*(1-Math.exp(-dt/tau));
    s.aguaCalienteC=clamp(s.aguaCalienteC,p.ambiente,97);
    // Termostato con histéresis; simulado, no sistema certificado de protección.
    if(s.aguaCalienteC>=p.limiteTermicoC) s.temperaturaCorte=true;
    if(s.temperaturaCorte && s.aguaCalienteC<=p.limiteTermicoC-5) s.temperaturaCorte=false;

    // SOL4 repone A; SOL5 repone B (hipótesis didáctica).
    if(sol.SOL4) s.aMl=clamp(s.aMl+p.llenadoMlMin*dt/60,0,p.capacidadMl);
    if(sol.SOL5) s.bMl=clamp(s.bMl+p.llenadoMlMin*dt/60,0,p.capacidadMl);
    const elegidoB=!!sol.SOL2;
    const volumen=elegidoB?s.bMl:s.aMl;
    const habilitada=sol.N1 && !s.giro.N1 && s.consignas.N1V>0;
    const nominal=habilitada ? p.caudalN1MaxMlMin*clamp(s.consignas.N1V,0,100)/100 : 0;
    const drenado=Math.min(volumen,nominal*dt/60);
    s.caudalProductoMlMin=(habilitada&&dt>0)?drenado/dt*60:0;
    s.vacio=habilitada && volumen<1;
    if(elegidoB) s.bMl=Math.max(0,s.bMl-drenado);
    else s.aMl=Math.max(0,s.aMl-drenado);
    if(sol.SOL1) s.desviadoMl+=drenado;
    else s.finalMl+=drenado;

    // El frío circula si SOL3 está abierta; los ramales SOL4/SOL5 se ilustran por separado.
    s.caudalFrioMlMin=sol.SOL3?p.refrigeracionMlMin:0;
    s.desagueMl+=s.caudalFrioMlMin*dt/60;
    s.t4=p.ambiente; // Mezcla/temperatura de entrada simplificada.
    s.t5=p.ambiente; // Sonda separada de los circuitos en el esquema.
    if (s.caudalProductoMlMin>0) {
      // Ganancia térmica: circulación de N2 + diferencia con agua caliente.
      const factorFlujo=1-0.25*(s.consignas.N1V/100);
      const eficiencia=sol.N2 ? 0.79*factorFlujo : 0.08;
      const objetivoProducto=s.t4+(s.aguaCalienteC-s.t4)*eficiencia;
      s.t1+=(objetivoProducto-s.t1)*(1-Math.exp(-dt/20));
      const recuperacion=0.22*(s.t1-s.t4);
      const enfriamiento=sol.SOL3?0.77:0.09;
      const objetivoSalida=s.t4+(s.t1-s.t4-recuperacion)*(1-enfriamiento);
      s.t3+=(objetivoSalida-s.t3)*(1-Math.exp(-dt/22));
    } else {
      s.t1+=(p.ambiente-s.t1)*(1-Math.exp(-dt/320));
      s.t3+=(p.ambiente-s.t3)*(1-Math.exp(-dt/200));
    }
    s.t1=clamp(s.t1,p.ambiente,100);
    s.t3=clamp(s.t3,p.ambiente,100);
  }
  function observaciones(s) {
    const p=PARAMS;
    return {
      T1:s.t1,T2:s.aguaCalienteC,T3:s.t3,T4:s.t4,T5:s.t5,
      F1:s.caudalProductoMlMin,L1:(s.aMl/p.capacidadMl)*250,
      HL:s.bMl/p.capacidadMl>=0.90,
      LL:s.bMl/p.capacidadMl<=0.15,
      TERM:s.temperaturaCorte,
      LVLC:false,HLC:false,
    };
  }
  const api=Object.freeze({PARAMS,OUTPUT_IDS,crearEstado,activarEjemplo,avanzar,observaciones});
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  root.PCT23Modelo=api;
})(typeof window!=='undefined'?window:globalThis);
