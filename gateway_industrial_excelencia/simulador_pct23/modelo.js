/* PCT23 - Modelo DIDÁCTICO, no calibrado ni conectado a equipos físicos.
 * Unidades: segundos, °C, ml, ml/min. Sin dependencias externas. */
(function (root) {
  'use strict';
  const PARAMS = Object.freeze({
    ambiente: 22, capacidadMl: 2400, caudalN1MaxMlMin: 550,
    llenadoMlMin: 260, refrigeracionMlMin: 450, vaciadoMlMin: 600, // vaciadoMlMin: V3 abierta (didáctico)
    tauCalentadorS: 200, tauEnfriamientoS: 360, limiteTermicoC: 91, margenDisparoC: 0.05, rearmeC: 70, tauCorteS: 900, // tras el disparo: rearme por debajo de rearmeC y enfriamiento lento (tauCorteS). margenDisparoC: con la resistencia al 100 % T2 tiende a 91,0 sin llegar, y así salta al mostrar 91,0
    deltaCalentadorC: 69,        // subida del agua caliente con el calefactor al 100 %
    eficienciaIntercambio: 0.79, // fraccion del salto agua-producto que se transfiere
    reduccionPorCaudal: 0.25,    // perdida de eficiencia al subir N1 al 100 %
    acoplamientoCaudal: 0.15,    // calor que el producto en circulacion le quita al agua caliente (T2 baja al aumentar el caudal)
  });
  const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
  const OUTPUT_IDS=Object.freeze(['N1','N2','SOL1','SOL2','SOL3','SOL4','SOL5','RES']); // RES: resistencia de calefacción on/off (J7 OUT03), solo indicador
  function crearEstado() {
    return {
      tiempo: 0, ejecutando: false, velocidad: 1,
      salidas: Object.fromEntries(OUTPUT_IDS.map(id=>[id,false])),
      // giro: valor de OUT06 (N1) y OUT05 (N2); 0 = sentido de proceso (supuesto, sin confirmar).
      v3: false, // válvula manual de vaciado del tanque B
      giro: {N1:false,N2:false}, consignas: {R:100,N1V:100,N2V:100},
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
  /** Fraccion de calor que el producto en marcha le quita al agua caliente. fraccionCaudal: 0..1 del caudal maximo de N1. */
  function factorAcoplamiento(n2Encendida,n1vPct,fraccionCaudal) {
    const eficiencia=n2Encendida?(1-PARAMS.reduccionPorCaudal*n1vPct/100):0.08/PARAMS.eficienciaIntercambio;
    return PARAMS.acoplamientoCaudal*clamp(fraccionCaudal,0,1)*eficiencia;
  }
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
    const objetivoAgua=p.ambiente+p.deltaCalentadorC*r;
    const temperaturaObjetivo=s.temperaturaCorte?p.ambiente:objetivoAgua;
    const tau=s.temperaturaCorte?p.tauCorteS:(r? p.tauCalentadorS:p.tauEnfriamientoS);
    // El producto que circula por el intercambiador le quita calor al agua caliente: con caudal el equilibrio de T2 baja
    // y T2 se mueve algo mas deprisa. k es la fraccion de ese efecto (paso anterior: caudal ya calculado).
    const k=factorAcoplamiento(s.salidas.N2,s.consignas.N1V,s.caudalProductoMlMin/p.caudalN1MaxMlMin);
    const objetivoEfectivo=p.ambiente+(temperaturaObjetivo-p.ambiente)/(1+k);
    s.aguaCalienteC+=(objetivoEfectivo-s.aguaCalienteC)*(1-Math.exp(-dt*(1+k)/tau));
    s.aguaCalienteC=clamp(s.aguaCalienteC,p.ambiente,97);
    // Termostato con histéresis; simulado, no sistema certificado de protección.
    if(!s.temperaturaCorte && s.aguaCalienteC>=p.limiteTermicoC-p.margenDisparoC){s.temperaturaCorte=true;s.salidas.RES=false;} // el termostato desconecta la resistencia
    if(s.temperaturaCorte && s.aguaCalienteC<=p.rearmeC) s.temperaturaCorte=false; // rearmado: la resistencia sigue desconectada hasta que se vuelva a conectar

    // SOL4 repone A; SOL5 repone B (hipótesis didáctica).
    if(sol.SOL4) s.aMl=clamp(s.aMl+p.llenadoMlMin*dt/60,0,p.capacidadMl);
    if(sol.SOL5) s.bMl=clamp(s.bMl+p.llenadoMlMin*dt/60,0,p.capacidadMl);
    if(s.v3) s.bMl=Math.max(0,s.bMl-p.vaciadoMlMin*dt/60); // V3 abierta vacía el tanque B
    const elegidoB=!!sol.SOL2;
    const volumen=elegidoB?s.bMl:s.aMl;
    const habilitada=sol.N1 && !s.giro.N1 && s.consignas.N1V>0;
    const nominal=habilitada ? p.caudalN1MaxMlMin*clamp(s.consignas.N1V,0,100)/100 : 0;
    const drenado=Math.min(volumen,nominal*dt/60);
    s.caudalProductoMlMin=(habilitada&&dt>0)?drenado/dt*60:0;
    s.vacio=habilitada && volumen<1;
    // Con SOL1 activa el producto rechazado vuelve al tanque de alimentacion (manual PCT23): el
    // volumen recirculado se cuenta aparte y el tanque no baja. Con SOL1 normal sale como producto acabado.
    if(sol.SOL1) s.desviadoMl+=drenado;
    else{
      if(elegidoB) s.bMl=Math.max(0,s.bMl-drenado);
      else s.aMl=Math.max(0,s.aMl-drenado);
      s.finalMl+=drenado;
    }

    // El frío circula si SOL3 está abierta; los ramales SOL4/SOL5 se ilustran por separado.
    s.caudalFrioMlMin=sol.SOL3?p.refrigeracionMlMin:0;
    s.desagueMl+=s.caudalFrioMlMin*dt/60;
    const entrada=p.ambiente; // el producto entra desde el tanque a temperatura ambiente
    if (s.caudalProductoMlMin>0) {
      // Ganancia térmica: circulación de N2 + diferencia con agua caliente.
      const factorFlujo=1-p.reduccionPorCaudal*(s.consignas.N1V/100);
      const eficiencia=sol.N2 ? p.eficienciaIntercambio*factorFlujo : 0.08;
      const objetivoProducto=entrada+(s.aguaCalienteC-entrada)*eficiencia;
      // T4 es el producto que sale de la sección de calentamiento (antes del filtro, F1 y el tubo de residencia):
      // se adelanta a T1, que llega con el retraso del tubo de residencia.
      s.t4+=(objetivoProducto-s.t4)*(1-Math.exp(-dt/8));
      s.t1+=(objetivoProducto-s.t1)*(1-Math.exp(-dt/20));
      const recuperacion=0.22*(s.t1-entrada);
      const enfriamiento=sol.SOL3?0.77:0.09;
      const objetivoSalida=entrada+(s.t1-entrada-recuperacion)*(1-enfriamiento);
      s.t3+=(objetivoSalida-s.t3)*(1-Math.exp(-dt/22));
    } else {
      s.t1+=(p.ambiente-s.t1)*(1-Math.exp(-dt/320));
      s.t3+=(p.ambiente-s.t3)*(1-Math.exp(-dt/200));
      s.t4+=(p.ambiente-s.t4)*(1-Math.exp(-dt/320));
    }
    s.t4=clamp(s.t4,p.ambiente,100);
    // T5 está conectada a la sección de calentamiento: producto a mitad de camino entre la entrada y T4 (supuesto)
    s.t5=p.ambiente+(s.t4-p.ambiente)*0.5;
    s.t1=clamp(s.t1,p.ambiente,100);
    s.t3=clamp(s.t3,p.ambiente,100);
  }
  function observaciones(s) {
    const p=PARAMS;
    return {
      T1:s.t1,T2:s.aguaCalienteC,T3:s.t3,T4:s.t4,T5:s.t5,
      F1:s.caudalProductoMlMin,L1:(s.aMl/p.capacidadMl)*250,
      HL:s.bMl/p.capacidadMl>=0.80,
      LL:s.bMl/p.capacidadMl<=0.20,
      TERM:s.temperaturaCorte,
      LVLC:false,HLC:false,
    };
  }
  /** Fija el llenado de un depósito (A o B) como porcentaje de su capacidad. */
  function ponerLlenado(s, deposito, porcentaje) {
    const ml = clamp(Number(porcentaje) || 0, 0, 100) / 100 * PARAMS.capacidadMl;
    if (deposito === 'B') s.bMl = ml; else s.aMl = ml;
    return s;
  }
  function porcentajeLlenado(s, deposito) {
    return (deposito === 'B' ? s.bMl : s.aMl) / PARAMS.capacidadMl * 100;
  }
  const api=Object.freeze({PARAMS,OUTPUT_IDS,crearEstado,activarEjemplo,avanzar,observaciones,ponerLlenado,porcentajeLlenado,factorAcoplamiento});
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  root.PCT23Modelo=api;
})(typeof window!=='undefined'?window:globalThis);
