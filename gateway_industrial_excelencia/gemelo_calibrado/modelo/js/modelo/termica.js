(function () {
  const constantesFisicas = typeof require !== 'undefined' ? require('../configuracion/constantes_fisicas.js') : PCT.constantesFisicas;
  const matematicas = typeof require !== 'undefined' ? require('../utilidades/matematicas.js') : PCT.matematicas;
  const constantes = constantesFisicas.CONSTANTES_FISICAS;

  // Modelo térmico ajustado con datos reales de la maqueta (ver gemelo_calibrado/README.md). Lo que se aprendió de la prueba:
  //  - El agua caliente no es un solo volumen: el circuito del calefactor (calentadorC, lo que llega al intercambiador) va
  //    bastante por delante del depósito donde está T2. Por eso T4 sale MÁS caliente que T2, y T2 sigue subiendo tras apagar la resistencia.
  //  - El producto quieto y el depósito se enfrían mucho más despacio de lo que suponía el modelo anterior.
  //  - T3 solo se calienta cuando el producto va a salida normal (no en desvío).
  //  - T5 no está en el camino del producto en caliente: se queda a temperatura ambiente.

  /** Fracción de calor que el producto en marcha le quita al agua caliente. fraccionCaudal: 0..1 del caudal máximo de N1. */
  function factorAcoplamiento(n2Encendida, n1vPct, fraccionCaudal) {
    const factorEficiencia = n2Encendida ? factorFlujo(n1vPct) : 0.08 / constantes.eficienciaIntercambio;
    return constantes.acoplamientoCaudal * matematicas.limitar(fraccionCaudal, 0, 1) * factorEficiencia;
  }

  /** Parte de la eficiencia de intercambio que queda con ese caudal (%). */
  function factorFlujo(caudalPct) {
    return 1 - constantes.reduccionPorCaudal * caudalPct / 100;
  }

  /** Eficiencia del intercambio con el producto circulando a ese caudal (%). */
  function eficienciaPorCaudal(caudalPct) {
    return constantes.eficienciaIntercambio * factorFlujo(caudalPct);
  }

  /** Acoplamiento en régimen con ese caudal (%): el mismo que usan los lazos de regulación. */
  function acoplamientoConCaudal(caudalPct) {
    return factorAcoplamiento(true, caudalPct, caudalPct / 100);
  }

  /** Pérdidas en régimen del circuito caliente a través del depósito, como fracción equivalente de acoplamiento. */
  function perdidasEnRegimen() {
    return constantes.constanteCalentadorS / (constantes.perdidasDepositoS * constantes.relacionCapacidades);
  }

  /** Temperatura del agua caliente en régimen con esa potencia (%) y ese acoplamiento (en régimen T2 y el circuito se igualan). */
  function aguaConPotencia(potenciaPct, acoplamiento) {
    return constantes.temperaturaAmbienteC + constantes.subidaCalentadorC * potenciaPct / 100 / (1 + acoplamiento + perdidasEnRegimen());
  }

  /** Potencia (%) que mantiene el agua caliente en t2C con ese acoplamiento (inversa de aguaConPotencia). */
  function potenciaParaAgua(t2C, acoplamiento) {
    return (t2C - constantes.temperaturaAmbienteC) * (1 + acoplamiento + perdidasEnRegimen()) / constantes.subidaCalentadorC * 100;
  }

  /** Temperatura del producto tras el intercambio con el agua (entrada por defecto: ambiente). */
  function productoConAgua(aguaC, eficiencia, entradaC = constantes.temperaturaAmbienteC) {
    return entradaC + (aguaC - entradaC) * eficiencia;
  }

  /** Agua caliente necesaria para que el producto salga a t1C (inversa de productoConAgua). */
  function aguaParaProducto(t1C, eficiencia) {
    const ambiente = constantes.temperaturaAmbienteC;
    return ambiente + (t1C - ambiente) / eficiencia;
  }

  function avanzarAguaCaliente(estado, segundosPaso) {
    const ambiente = constantes.temperaturaAmbienteC;
    if (estado.calentadorC === undefined) estado.calentadorC = estado.aguaCalienteC;
    // Las dos resistencias de 120 V van en serie (una sola a 230 V), por ráfagas de 50 ciclos: R % = R/100 de los ciclos.
    const fraccionPotencia = estado.salidas.RES ? matematicas.limitar(estado.consignas.potenciaPct / 100, 0, 1) : 0;
    const acoplamiento = factorAcoplamiento(estado.salidas.N2, estado.consignas.velocidadN1Pct, estado.caudalProductoMlMin / constantes.caudalMaxN1MlMin);
    const mezcla = 1 / (estado.salidas.N2 ? constantes.mezclaConN2S : constantes.mezclaSinN2S);
    // Integración en subpasos cortos: la mezcla entre los dos nodos es rápida frente a un paso de 1 s.
    const subpasos = Math.max(1, Math.ceil(segundosPaso));
    const h = segundosPaso / subpasos;
    for (let i = 0; i < subpasos; i++) {
      const tc = estado.calentadorC, tw = estado.aguaCalienteC;
      const dtc = (ambiente + constantes.subidaCalentadorC * fraccionPotencia - tc - acoplamiento * (tc - ambiente)) / constantes.constanteCalentadorS
        - mezcla * (tc - tw);
      const dtw = mezcla * constantes.relacionCapacidades * (tc - tw) - (tw - ambiente) / constantes.perdidasDepositoS;
      estado.calentadorC = matematicas.limitar(tc + dtc * h, ambiente, 97);
      estado.aguaCalienteC = matematicas.limitar(tw + dtw * h, ambiente, 97);
    }
  }

  // Termostato con histéresis sobre el circuito del calefactor (es lo más caliente); simulado, no sistema certificado de protección.
  function revisarTermostato(estado) {
    const caliente = Math.max(estado.calentadorC ?? estado.aguaCalienteC, estado.aguaCalienteC);
    if (!estado.temperaturaCorte && caliente >= constantes.limiteTermicoC - constantes.margenDisparoC) {
      estado.temperaturaCorte = true;
      estado.salidas.RES = false;
    }
    if (estado.temperaturaCorte && caliente <= constantes.temperaturaRearmeC) estado.temperaturaCorte = false;
  }

  function avanzarProductoCirculando(estado, segundosPaso, entrada) {
    const sol = estado.salidas;
    const agua = estado.calentadorC ?? estado.aguaCalienteC;
    const eficiencia = sol.N2 ? eficienciaPorCaudal(estado.consignas.velocidadN1Pct) : 0.08;
    // T4 es el producto que sale de la sección de calentamiento; T1 llega después por el tubo de residencia (pierde algo de calor).
    estado.t4C = matematicas.acercarExponencial(estado.t4C, productoConAgua(agua, eficiencia, entrada), segundosPaso, constantes.constanteT4S);
    estado.t1C = matematicas.acercarExponencial(estado.t1C, entrada + (estado.t4C - entrada) * constantes.retencionT1, segundosPaso, constantes.constanteT1S);
    // En el simulador SOL1 activa = desvío: el producto vuelve al tanque y no pasa por T3, que se va enfriando.
    if (sol.SOL1) {
      estado.t3C = matematicas.acercarExponencial(estado.t3C, entrada, segundosPaso, constantes.constanteParadoT3S);
    } else {
      const frio = sol.SOL3 ? (1 - 0.77) / (1 - 0.09) : 1;      // el agua fría (SOL3) baja T3 en la misma proporción que en el modelo anterior
      const objetivo = entrada + (estado.t1C - entrada) * constantes.recuperacionT3 * frio;
      estado.t3C = matematicas.acercarExponencial(estado.t3C, objetivo, segundosPaso, constantes.constanteT3S);
    }
  }

  // Producto quieto en el intercambiador (sin caudal) con el agua caliente circulando (N2): se calienta por contacto con las placas.
  const EFICIENCIA_PARADO = 0.85;            // el producto quieto llega casi a la temperatura del agua (hay mucho tiempo de contacto)
  const CONSTANTE_PARADO_S = 70;             // segundos que tarda en acercarse a ese objetivo
  const ACOPLAMIENTO_TUBO_PARADO = 0.5;      // el tubo de residencia (sin fuente de calor propia) solo recibe la mitad por conducción desde la salida de calentamiento
  const CONSTANTE_TUBO_PARADO_S = 300;

  function enfriarProductoParado(estado, segundosPaso) {
    const ambiente = constantes.temperaturaAmbienteC;
    if (estado.salidas.N2) {
      // Sin datos reales de este caso (en la prueba N1 y N2 se pararon a la vez): se mantiene el comportamiento anterior.
      const agua = estado.calentadorC ?? estado.aguaCalienteC;
      estado.t4C = matematicas.acercarExponencial(estado.t4C, productoConAgua(agua, EFICIENCIA_PARADO, ambiente), segundosPaso, CONSTANTE_PARADO_S);
      estado.t1C = matematicas.acercarExponencial(estado.t1C, ambiente + (estado.t4C - ambiente) * ACOPLAMIENTO_TUBO_PARADO, segundosPaso, CONSTANTE_TUBO_PARADO_S);
    } else {
      estado.t1C = matematicas.acercarExponencial(estado.t1C, ambiente, segundosPaso, constantes.constanteParadoT1S);
      estado.t4C = matematicas.acercarExponencial(estado.t4C, ambiente, segundosPaso, constantes.constanteParadoT4S);
    }
    estado.t3C = matematicas.acercarExponencial(estado.t3C, ambiente, segundosPaso, constantes.constanteParadoT3S);
  }

  function avanzarTemperaturasProducto(estado, segundosPaso) {
    const ambiente = constantes.temperaturaAmbienteC;
    if (estado.caudalProductoMlMin > 0) avanzarProductoCirculando(estado, segundosPaso, ambiente);
    else enfriarProductoParado(estado, segundosPaso);
    estado.t4C = matematicas.limitar(estado.t4C, ambiente, 100);
    // T5: en la maqueta real no sigue al producto caliente (se quedó a temperatura ambiente durante toda la prueba).
    estado.t5C = matematicas.acercarExponencial(estado.t5C, ambiente, segundosPaso, 600);
    estado.t1C = matematicas.limitar(estado.t1C, ambiente, 100);
    estado.t3C = matematicas.limitar(estado.t3C, ambiente, 100);
  }

  const api = { factorAcoplamiento, eficienciaPorCaudal, acoplamientoConCaudal, aguaConPotencia, potenciaParaAgua,
    productoConAgua, aguaParaProducto, avanzarAguaCaliente, revisarTermostato, avanzarTemperaturasProducto };
  if (typeof module !== 'undefined') module.exports = api; else PCT.termica = api;
})();
