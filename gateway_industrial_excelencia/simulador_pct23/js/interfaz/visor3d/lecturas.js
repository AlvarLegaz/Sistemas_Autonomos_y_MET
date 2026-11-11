// Lecturas del visor 3D: a partir del estado de la planta, qué ve cada captador y a qué altura está el líquido. Sin DOM.
(function () {
  const especificaciones = typeof require !== 'undefined' ? require('./especificaciones.js') : PCT.visor3dEspecificaciones;
  const constantes = typeof require !== 'undefined' ? require('../../configuracion/constantes_fisicas.js') : PCT.constantesFisicas;
  const { GEOMETRIA, MODELOS } = especificaciones;
  const FISICA = constantes.CONSTANTES_FISICAS;
  const DENSIDAD_AGUA = 1000;   // kg/m³
  const GRAVEDAD = 9.81;        // m/s²

  const limitar = (valor, minimo, maximo) => Math.max(minimo, Math.min(maximo, valor));
  const decimal = valor => valor.toFixed(1).replace('.', ',');

  // Fracción de la altura útil que ocupa el líquido (0 a 1). La heat unit se simula siempre al llenado fijo de la constante.
  function fraccionDeLlenado(clave, estado) {
    if (clave === 'TANKA') return estado.depositoAMl / FISICA.capacidadDepositoMl;
    if (clave === 'TANKB') return estado.depositoBMl / FISICA.capacidadDepositoMl;
    return FISICA.llenadoUnidadCalentamientoPct / 100;
  }

  const LECTORES = {
    L1: (o) => ({ valor: o.L1, texto: `${Math.round(o.L1)} mm`, marcaCm: o.L1 / 10 }),
    HL: (o) => ({ activo: o.HL, texto: o.HL ? 'Nivel alto detectado' : 'Por debajo del nivel alto' }),
    LL: (o) => ({ activo: !o.LL, texto: o.LL ? 'Nivel bajo: casi vacío' : 'Con líquido sobre el nivel bajo' }),
    T2: (o) => ({ valor: o.T2, texto: `${decimal(o.T2)} °C` }),
    TERM: (o) => ({ activo: !o.TERM, alarma: o.TERM, texto: o.TERM ? 'ABIERTO: sobretemperatura' : 'Cerrado: normal' }),
    SEC_REGEN: (o, e) => ({ activo: e.caudalProductoMlMin > 0, tempC: o.T4, texto: e.caudalProductoMlMin > 0 ? `Producto circulando · T4 ${decimal(o.T4)} °C` : 'Sin circulación de producto' }),
    SEC_CALENT: (o, e) => ({ activo: !!e.salidas.N2 && e.consignas.velocidadN2Pct > 0, tempC: o.T2, texto: e.salidas.N2 ? `Agua a ${decimal(o.T2)} °C · T5 ${decimal(o.T5)} °C` : `N2 parada · agua a ${decimal(o.T2)} °C` }),
    SEC_ENFRIA: (o, e) => ({ activo: !!e.salidas.SOL3, tempC: o.T3, texto: e.salidas.SOL3 ? `SOL3 abierta · salida a ${decimal(o.T3)} °C` : `SOL3 cerrada · salida a ${decimal(o.T3)} °C` }),
    T5: (o) => ({ valor: o.T5, texto: `${decimal(o.T5)} °C` }),
    T3: (o) => ({ valor: o.T3, texto: `${decimal(o.T3)} °C` }),
    RES: (o, e) => ({ activo: !!e.salidas.RES, potencia: e.consignas.potenciaPct,
      texto: e.salidas.RES ? `ON · ${decimal(e.consignas.potenciaPct)} % (${Math.round(e.consignas.potenciaPct / 2)}/50 ciclos)` : 'OFF' }),
  };

  // Interruptores de nivel que el modelo no simula: se deducen de la altura del líquido frente a la suya.
  function lecturaPorAltura(captador, alturaLiquidoCm) {
    const conLiquido = alturaLiquidoCm >= captador.alturaCm;
    return { activo: conLiquido, texto: conLiquido ? 'Cubierto por el líquido' : 'Por encima del líquido' };
  }

  /** clave: 'TANKA', 'TANKB' o 'HEAT'; estado: estado de la planta; observaciones: PCT.planta.observaciones(estado). */
  function lecturasModelo(clave, estado, observaciones) {
    const modelo = MODELOS[clave];
    if (modelo.escena === 'planta') return { fraccion: 0, alturaLiquidoCm: 0, volumenMl: 0, presionFondoPa: 0, temperaturaAguaC: null, sensores: {} };
    if (modelo.escena === 'bomba') {
      const b = modelo.bomba, activa = !!estado.salidas[b], pct = estado.consignas['velocidad' + b + 'Pct'], inversa = !!estado.giro[b];
      const caudal = b === 'N1' ? ` · caudal ${Math.round(estado.caudalProductoMlMin)} ml/min` : '';
      const texto = !activa ? 'Parada' : `ON · ${decimal(pct)} %${inversa ? ' · giro INVERSO (no mueve fluido)' : caudal}`;
      return { fraccion: 0, alturaLiquidoCm: 0, volumenMl: 0, presionFondoPa: 0, temperaturaAguaC: null, sensores: {
        ROTOR: { activo: activa, velocidadPct: activa ? pct : 0, inversa, texto },
        TUBO: { activo: activa && !inversa, texto: !activa ? 'Sin flujo' : inversa ? 'Flujo invertido: el modelo no mueve producto' : 'Fluido en movimiento' },
      } };
    }
    if (modelo.escena === 'intercambiador') {
      const sensores = {};
      for (const captador of modelo.captadores) sensores[captador.id] = LECTORES[captador.id](observaciones, estado);
      return { fraccion: 0, alturaLiquidoCm: 0, volumenMl: 0, presionFondoPa: 0, temperaturaAguaC: null, sensores };
    }
    const fraccion = limitar(fraccionDeLlenado(clave, estado), 0, 1);
    const alturaLiquidoCm = fraccion * GEOMETRIA.alturaUtilCm;
    const sensores = {};
    for (const captador of modelo.captadores) {
      const lector = LECTORES[captador.id];
      sensores[captador.id] = lector ? lector(observaciones, estado) : lecturaPorAltura(captador, alturaLiquidoCm);
    }
    return {
      fraccion, alturaLiquidoCm,
      volumenMl: fraccion * FISICA.capacidadDepositoMl,
      presionFondoPa: DENSIDAD_AGUA * GRAVEDAD * alturaLiquidoCm / 100,
      temperaturaAguaC: clave === 'HEAT' ? observaciones.T2 : null,
      sensores,
    };
  }

  const api = { lecturasModelo, fraccionDeLlenado };
  if (typeof module !== 'undefined') module.exports = api; else PCT.visor3dLecturas = api;
})();
