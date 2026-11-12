// Textos «Cómo funciona» de los equipos que se pueden abrir por dentro en el 3D (DISEÑADOR). Cada uno responde a cuatro preguntas para alumnos de mantenimiento
// electrónico: qué entra, qué sale, qué señales lo vigilan y qué suele fallar. Valores típicos e ilustrativos (no de una planta concreta).
(function () {
  const COMO_FUNCIONA = {
    'TK-101': 'Entra la leche cruda por XV-101 y sale hacia P-101; un agitador lento la mantiene homogénea. LT-101 (4-20 mA) mide el nivel y los flotadores LSH-101 y LSL-101 avisan de lleno y vacío. Si LT-101 se desconecta o deriva, el PLC lee un nivel falso; si el nivel llega a cero, P-101 se para para no trabajar en seco.',
    'HW-101': 'Dos bancos de resistencias (B1 y B2) calientan el agua del depósito; los conectan los contactores KM-201 y KM-202 desde el PLC. TT-105 mide la temperatura, LSL-301 vigila el nivel bajo y TSH-101 corta si se pasa de temperatura. Averías típicas: contactor pegado (calienta sin orden), resistencia abierta (un banco no calienta) y flotador atascado.',
    'P-101': 'Bomba centrífuga: la leche entra por el centro del rodete (aspiración axial) y las palas la lanzan hacia la voluta, de donde sale por la tobera tangencial. El variador VFD-101 cambia la velocidad con una señal de 0-10 V. Fallos habituales: aire en la aspiración, sello mecánico con fuga, variador sobrecalentado y rodete flojo.',
    'P-102': 'Bomba centrífuga del agua caliente: aspira del depósito HW-101 y la empuja por la sección de calentamiento del intercambiador. La conecta el contactor KM-102, protegido por el magnetotérmico QF-102. Si se para, el calentador debe cortar solo; si el contactor queda pegado, la bomba sigue girando sin orden.',
    'P-103': 'Bomba booster del lado crudo de la regeneración: mantiene la leche cruda a menos presión que la pasteurizada, para que una fuga en una placa nunca contamine el producto limpio. La conecta KM-103 y solo debe trabajar con P-101 en marcha y la FDV en avance. PT-101 y PT-102 vigilan el diferencial. Fallos: contactor pegado (gira sin orden), aire en la aspiración y un transmisor de presión que deriva y da un diferencial falso.',
    'HX-101': 'Placas de acero con canales alternos: por unos pasa la leche y por los vecinos el otro fluido, y el calor cruza la placa sin que se mezclen. La regeneración recupera calor de la leche pasteurizada, el calentamiento usa agua caliente y el enfriamiento agua fría; siempre a contracorriente. TT-101 a TT-104 y PT-101/102 lo vigilan. Fallos: placas sucias (calienta peor), juntas con fuga y placa perforada.',
    'FDV-101': 'Válvula de desvío de tres vías con actuador neumático y muelle. Sin aire o sin tensión el muelle la deja en desvío (seguridad positiva): la leche vuelve al tanque. Solo pasa a avance si TT-103 da 72 °C o más, el tiempo de residencia es suficiente y los lazos están sanos. Los finales de carrera ZS-101 y ZS-102 confirman la posición. Fallos: vástago atascado, aire bajo y final de carrera mal ajustado.',
    'SV-101': 'Electroválvula piloto de 24 V CC: al energizar su bobina el núcleo magnético se mueve y deja pasar el aire comprimido hacia el actuador de la FDV; sin tensión, un muelle lo cierra y la FDV se va a desvío. La manda el PLC (DO). Fallos: bobina abierta (nunca avanza), bobina en corto (calienta y quema el fusible) y núcleo pegado.',
    'FLT-101': 'Colador de aspiración: la leche entra por el tubo y atraviesa la cesta, que retiene trozos y suciedad antes de la bomba. Cuando se atasca cae el caudal de FT-101 y la presión de aspiración. Se limpia a mano; si el caudal baja y la bomba va al máximo, es lo primero que hay que revisar.',
  };

  const TAGS_CON_INTERIOR = Object.keys(COMO_FUNCIONA);
  const textoComoFunciona = tag => COMO_FUNCIONA[tag] || '';

  const api = { COMO_FUNCIONA, TAGS_CON_INTERIOR, textoComoFunciona };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstComoFunciona = api; }
})();
