// Datos del visor 3D de los depósitos: medidas, captadores y conexiones. Sin DOM ni Three.js.
// Alturas en cm desde el fondo interior; el ángulo es alrededor del eje (0° = hacia la cámara inicial, positivo hacia la derecha).
(function () {
  // Ø 155 mm × 285 mm (dato del usuario, PCT23.md): se aplica a los tres depósitos. 25 cm es la altura útil que mide L1 (0-250 mm).
  const GEOMETRIA = { diametroCm: 15.5, alturaCm: 28.5, alturaUtilCm: 25.0, paredCm: 0.4 };

  const NOTA_POSICION = 'La posición dentro del depósito es orientativa: no está documentada en la maqueta.';

  const MODELOS = {
    TANKA: {
      titulo: 'Tanque de alimentación A',
      resumen: 'Tanque de producto. Se llena con SOL4 y alimenta a la bomba N1 a través de SOL2 (en reposo).',
      captadores: [
        { id: 'L1', ayuda: 'L1', nombre: 'L1 · sensor de nivel', tipo: 'sonda_nivel', alturaCm: 1.0, radioCm: 4.5, anguloGrados: 40,
          senal: 'AnalogIn5 · 0 a 3,3 V ≙ 0 a 250 mm (supuesto)',
          queMide: 'Altura del líquido en el tanque, de 0 a 250 mm. El anillo naranja de la sonda marca la lectura.',
          uso: 'Da el volumen que queda en A y detecta el tanque vacío. Con SOL2 en reposo es la referencia para saber cuánto producto se puede procesar.',
          nota: 'No está confirmado si es un sensor de presión hidrostática o de otro tipo: aquí se dibuja como sonda vertical. ' + NOTA_POSICION },
      ],
      conexiones: [
        { id: 'SOL4', ayuda: 'SOL4', nombre: 'SOL4 · entrada de llenado', tipo: 'entrada', alturaCm: 26.5, anguloGrados: -60, detalle: 'Llena el tanque desde la red cuando SOL4 está abierta.' },
        { id: 'SALIDA_A', ayuda: 'SOL2', nombre: 'Salida a SOL2 y N1', tipo: 'salida', alturaCm: 1.6, anguloGrados: 90, detalle: 'Por aquí aspira la bomba N1 cuando SOL2 está en reposo.' },
      ],
    },
    TANKB: {
      titulo: 'Tanque de alimentación B',
      resumen: 'Tanque de producto con dos flotadores de nivel. Se llena con SOL5 y alimenta a N1 cuando SOL2 está activa.',
      captadores: [
        { id: 'HL', ayuda: 'HL', nombre: 'HL · flotador de nivel alto', tipo: 'flotador', alturaCm: 20.0, radioCm: 4.8, anguloGrados: -35,
          senal: 'DigitalIn3 · cerrado = nivel alto alcanzado',
          queMide: 'Se activa cuando el líquido llega a unos 20 cm (80 % de la altura útil).',
          uso: 'Avisa de tanque lleno: sirve para cortar el llenado por SOL5 y evitar el rebose.', nota: NOTA_POSICION },
        { id: 'LL', ayuda: 'LL', nombre: 'LL · flotador de nivel bajo', tipo: 'flotador', alturaCm: 5.0, radioCm: 4.8, anguloGrados: 35,
          senal: 'DigitalIn4 · lógica negada: en alarma cuando NO hay líquido',
          queMide: 'Se desactiva cuando el líquido baja de unos 5 cm (20 %).',
          uso: 'Avisa de tanque casi vacío y protege a la bomba N1 de trabajar en seco.', nota: NOTA_POSICION },
      ],
      conexiones: [
        { id: 'SOL5', ayuda: 'SOL5', nombre: 'SOL5 · entrada de llenado', tipo: 'entrada', alturaCm: 26.5, anguloGrados: -60, detalle: 'Llena el tanque desde la red cuando SOL5 está abierta.' },
        { id: 'SALIDA_B', ayuda: 'SOL2', nombre: 'Salida a SOL2 y N1', tipo: 'salida', alturaCm: 1.6, anguloGrados: 90, detalle: 'Por aquí aspira la bomba N1 cuando SOL2 está activa.' },
        { id: 'V3', ayuda: 'V3', nombre: 'V3 · desagüe manual', tipo: 'salida', alturaCm: 0.8, anguloGrados: -90, detalle: 'Válvula manual de vaciado del tanque B.' },
      ],
    },
    HEAT: {
      titulo: 'Heat unit · depósito de agua caliente',
      resumen: 'Depósito de agua caliente con la resistencia de calefacción. La bomba N2 hace circular el agua por el intercambiador.',
      captadores: [
        { id: 'RES', ayuda: 'RES', nombre: 'Resistencia de calefacción', tipo: 'resistencia', alturaCm: 2.0, radioCm: 0, anguloGrados: 0,
          senal: 'TransistorOut3 (ON/OFF) + AnalogOut1 (potencia por ráfagas de 50 ciclos)',
          queMide: 'No mide: calienta el agua. 230 V (dos de 120 V en serie). Brilla más cuanta más potencia reciba.',
          uso: 'Es el actuador del control de temperatura: la regulación ajusta su ON/OFF o su potencia para llevar T2 y T1 a su consigna.',
          nota: 'Debe estar siempre sumergida: por eso el interruptor de nivel LVL queda por encima. ' + NOTA_POSICION },
        { id: 'T2', ayuda: 'T2', nombre: 'T2 · sonda de temperatura del agua', tipo: 'sonda_temp', alturaCm: 12.0, radioCm: 3.0, anguloGrados: 150,
          senal: 'AnalogIn2 · 10 mV/°C (1,5 V ≙ 150 °C)',
          queMide: 'Temperatura del agua caliente. La punta cambia de azul a rojo con la temperatura.',
          uso: 'Es la variable del lazo interno del control. Si la sonda falla (0 V o más de 1,45 V), el gateway no deja calentar.', nota: NOTA_POSICION },
        { id: 'TERM', ayuda: 'TERM', nombre: 'STAT · termostato de seguridad', tipo: 'termostato', alturaCm: 14.0, radioCm: 7.75, anguloGrados: -110,
          senal: 'DigitalIn1 · cerrado = normal, abierto = sobretemperatura (70 °C)',
          queMide: 'Se abre a 70 °C. Verde = cerrado (normal); rojo = abierto (disparado).',
          uso: 'Última protección: con el termostato abierto la resistencia no puede conducir y no se rearma sola.', nota: NOTA_POSICION },
        { id: 'LVL', ayuda: 'LVL', nombre: 'LVL · interruptor de nivel', tipo: 'flotador', alturaCm: 10.5, radioCm: 5.2, anguloGrados: 60,
          senal: 'DigitalIn5 (el significado exacto está por confirmar)',
          queMide: 'Comprueba que el agua cubre la resistencia.', uso: 'Si el nivel es bajo, la protección corta el calefactor.', nota: NOTA_POSICION },
        { id: 'HLC', ayuda: 'HLC', nombre: 'HL · nivel alto del depósito caliente', tipo: 'flotador', alturaCm: 22.0, radioCm: 5.2, anguloGrados: -60,
          senal: 'DigitalIn2', queMide: 'Se activa si el agua llega a unos 22 cm.', uso: 'Evita el rebose del depósito caliente.', nota: NOTA_POSICION },
      ],
      conexiones: [
        { id: 'N2_SALIDA', ayuda: 'N2', nombre: 'Salida a la bomba N2', tipo: 'salida', alturaCm: 1.8, anguloGrados: 90, detalle: 'El agua caliente sale hacia N2 y la sección de calentamiento del intercambiador.' },
        { id: 'N2_RETORNO', ayuda: 'N2', nombre: 'Retorno del intercambiador', tipo: 'entrada', alturaCm: 26.0, anguloGrados: -70, detalle: 'El agua ya enfriada vuelve al depósito.' },
      ],
    },
    // Intercambiador de placas: la geometría es ilustrativa (el manual no da medidas); lo que sí es real es el orden de las tres secciones.
    EXCH: {
      escena: 'intercambiador',
      titulo: 'Intercambiador de placas',
      resumen: 'Tres secciones en un mismo paquete de placas: regeneración (el producto caliente precalienta al que entra), calentamiento (agua caliente de N2) y enfriamiento (agua fría de SOL3). El producto y el agua circulan por canales alternos, separados por las placas.',
      captadores: [
        { id: 'SEC_REGEN', ayuda: 'REGEN', nombre: 'Regeneración', tipo: 'seccion', senal: 'Sin sensor propio: se usa T4 como referencia',
          queMide: 'Recuperación de calor: el producto que entra se precalienta con el que ya pasó el tubo de residencia.', uso: 'Ahorra energía: la sección de calentamiento parte de un producto ya templado.', nota: 'La geometría y el número de placas son ilustrativos.' },
        { id: 'SEC_CALENT', ayuda: 'CALENT', nombre: 'Calentamiento', tipo: 'seccion', senal: 'Agua: T2 · producto: T5 (a mitad de la sección)',
          queMide: 'Aquí el agua caliente de N2 sube el producto hasta la temperatura de proceso.', uso: 'Es la etapa que el control de temperatura gobierna (N2, potencia, consigna de T2).', nota: 'La geometría y el número de placas son ilustrativos.' },
        { id: 'SEC_ENFRIA', ayuda: 'ENFRIA', nombre: 'Enfriamiento', tipo: 'seccion', senal: 'SOL3 (relé K5) · producto de salida: T3',
          queMide: 'El agua fría de SOL3 enfría el producto antes de la salida.', uso: 'Con SOL3 cerrada casi no enfría.', nota: 'La geometría y el número de placas son ilustrativos.' },
        { id: 'T5', ayuda: 'T5', nombre: 'T5 · sonda del calentamiento', tipo: 'sonda_placas', seccion: 'SEC_CALENT',
          senal: 'AnalogIn (según conector)', queMide: 'Temperatura del producto a mitad de la sección de calentamiento.', uso: 'Sube por delante de T1 y vuelve a ambiente con la planta parada.', nota: 'Posición supuesta, como en el simulador.' },
        { id: 'T3', ayuda: 'T3', nombre: 'T3 · producto a la salida', tipo: 'sonda_placas', seccion: 'SEC_ENFRIA',
          senal: 'AnalogIn (según conector)', queMide: 'Temperatura del producto ya enfriado, antes de salir.', uso: 'Comprueba que el enfriamiento funciona (SOL3 abierta).', nota: 'Posición supuesta.' },
      ],
      conexiones: [
        { id: 'PROD_ENTRADA', ayuda: 'N1', nombre: 'Entrada de producto (de N1)', tipo: 'entrada', detalle: 'El producto llega impulsado por la bomba N1 desde el tanque A o B.' },
        { id: 'PROD_SALIDA', ayuda: 'FINAL', nombre: 'Salida de producto acabado', tipo: 'salida', detalle: 'El producto ya tratado y enfriado sale hacia SOL1 y la salida.' },
        { id: 'AGUA_CAL_ENTRADA', ayuda: 'N2', nombre: 'Agua caliente (de N2)', tipo: 'entrada', detalle: 'Llega desde el depósito de la heat unit, impulsada por N2.' },
        { id: 'AGUA_CAL_SALIDA', ayuda: 'N2', nombre: 'Retorno de agua caliente', tipo: 'salida', detalle: 'El agua, ya algo enfriada, vuelve al depósito de la heat unit.' },
        { id: 'AGUA_FRIA_ENTRADA', ayuda: 'SOL3', nombre: 'Agua fría (SOL3)', tipo: 'entrada', detalle: 'Agua de la red que abre SOL3.' },
        { id: 'AGUA_FRIA_SALIDA', ayuda: 'SOL3', nombre: 'Agua fría a desagüe', tipo: 'salida', detalle: 'El agua de refrigeración se envía a desagüe (el simulador la cuenta).' },
      ],
    },
    // Bombas peristálticas N1 y N2: la geometría es ilustrativa (modelo genérico de bomba de rodillos).
    BOMBA_N1: {
      escena: 'bomba', bomba: 'N1',
      titulo: 'Bomba N1 · alimentación (feed unit)',
      resumen: 'Bomba peristáltica que mueve el producto del tanque al intercambiador. Los rodillos comprimen un tubo flexible y empujan el fluido.',
      captadores: [
        { id: 'ROTOR', ayuda: 'N1', nombre: 'Rotor con rodillos', tipo: 'rotor', senal: 'J7 OUT08 (marcha) · OUT06 (sentido) · PWMOut1 (velocidad)',
          queMide: 'No mide: es el actuador. Los rodillos aplastan el tubo flexible y empujan el producto por delante de ellos.',
          uso: 'Su velocidad fija el caudal. Parada, la bomba hace de cierre: los rodillos pellizcan el tubo y el fluido no pasa.', nota: 'Si N1 gira en sentido inverso, el modelo no mueve producto.' },
        { id: 'TUBO', ayuda: 'N1', nombre: 'Tubo flexible', tipo: 'tubo', senal: 'Sin señal',
          queMide: 'Es la única pieza que toca el fluido: el rotor lo comprime desde fuera, así que el fluido no se contamina con la bomba.', uso: 'Se desgasta con el uso y es lo primero que se cambia en una bomba peristáltica.', nota: 'Geometría ilustrativa: no hay medidas documentadas.' },
      ],
      conexiones: [
        { id: 'ASPIRACION', ayuda: 'N1', nombre: 'Aspiración', tipo: 'entrada', detalle: 'Por aquí entra el fluido cuando la bomba gira en sentido normal.' },
        { id: 'IMPULSION', ayuda: 'N1', nombre: 'Impulsión', tipo: 'salida', detalle: 'Por aquí sale el fluido hacia el intercambiador. Si el sentido de giro se invierte, el flujo va al revés.' },
      ],
    },
    BOMBA_N2: {
      escena: 'bomba', bomba: 'N2',
      titulo: 'Bomba N2 · agua caliente (heat unit)',
      resumen: 'Bomba peristáltica que hace circular el agua caliente de la heat unit por la sección de calentamiento del intercambiador.',
      captadores: [
        { id: 'ROTOR', ayuda: 'N2', nombre: 'Rotor con rodillos', tipo: 'rotor', senal: 'J7 OUT07 (marcha) · OUT05 (sentido) · PWMOut2 (velocidad)',
          queMide: 'No mide: es el actuador. Los rodillos aplastan el tubo flexible y empujan el agua caliente por delante de ellos.',
          uso: 'Su velocidad fija el caudal. Parada, la bomba hace de cierre: los rodillos pellizcan el tubo y el fluido no pasa.', nota: 'Sin N2 el producto casi no se calienta.' },
        { id: 'TUBO', ayuda: 'N2', nombre: 'Tubo flexible', tipo: 'tubo', senal: 'Sin señal',
          queMide: 'Es la única pieza que toca el fluido: el rotor lo comprime desde fuera, así que el fluido no se contamina con la bomba.', uso: 'Se desgasta con el uso y es lo primero que se cambia en una bomba peristáltica.', nota: 'Geometría ilustrativa: no hay medidas documentadas.' },
      ],
      conexiones: [
        { id: 'ASPIRACION', ayuda: 'N2', nombre: 'Aspiración', tipo: 'entrada', detalle: 'Por aquí entra el fluido cuando la bomba gira en sentido normal.' },
        { id: 'IMPULSION', ayuda: 'N2', nombre: 'Impulsión', tipo: 'salida', detalle: 'Por aquí sale el fluido hacia el intercambiador. Si el sentido de giro se invierte, el flujo va al revés.' },
      ],
    },
    // Planta completa: los elementos salen de la propia escena (planta3d/), no de esta lista.
    PLANTA: {
      escena: 'planta', titulo: 'Planta PCT23 completa',
      resumen: 'La planta entera sobre una mesa, con la disposición del diagrama del manual (las distancias son ilustrativas). Todo sigue el estado del simulador: niveles, bombas, válvulas, temperaturas y flujo en las tuberías. Pulsa cualquier pieza para ver qué es.',
      captadores: [], conexiones: [],
    },
  };

  const api = { GEOMETRIA, MODELOS };
  if (typeof module !== 'undefined') module.exports = api; else PCT.visor3dEspecificaciones = api;
})();
