// Sol, cielo y ambiente: posición solar, irradiancia de cielo despejado (tipo Meinel con masa de aire), efecto de la nubosidad,
// irradiancia sobre el plano inclinado de cada campo (directa + difusa isótropa + albedo) y temperatura ambiente de Cartagena.
(function () {
  const { layout, CONSTANTES: C } = typeof require !== 'undefined' ? require('../configuracion/constantes.js') : window.PCT.fv.constantes;
  const RAD = Math.PI / 180;
  const DIAS_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const limitar = (v, a, b) => Math.max(a, Math.min(b, v));
  const dosCifras = n => String(n).padStart(2, '0');
  const LAT = layout.INSTALACION.latitudGrados;

  function diaValido(dia) { return ((Math.round(dia) - 1) % 365 + 365) % 365 + 1; }
  function fechaDeDia(dia) {
    let d = diaValido(dia), m = 0;
    while (d > DIAS_MES[m]) { d -= DIAS_MES[m]; m++; }
    return { mes: m, dia: d };
  }
  function textoReloj(dia, hora) {
    const f = fechaDeDia(dia), h = ((hora % 24) + 24) % 24, hh = Math.floor(h), mm = Math.floor((h - hh) * 60 + 1e-9);
    return `${f.dia} ${MESES[f.mes]} · ${dosCifras(hh)}:${dosCifras(mm)}`;
  }

  /** Declinación solar (grados) en el día del año n (Cooper). */
  const declinacionGrados = n => 23.45 * Math.sin(2 * Math.PI * (284 + n) / 365);

  /** Posición del sol. Azimut medido desde el sur, positivo hacia el oeste (como CAMPOS). */
  function posicionSolar(dia, horaSolar, latGrados = LAT) {
    const dec = declinacionGrados(diaValido(dia)) * RAD, lat = latGrados * RAD, w = 15 * (horaSolar - 12) * RAD;
    const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(w);
    const alt = Math.asin(limitar(sinAlt, -1, 1)), cosAlt = Math.cos(alt);
    let az = 0;
    if (cosAlt > 1e-6) {
      const cosAz = limitar((sinAlt * Math.sin(lat) - Math.sin(dec)) / (cosAlt * Math.cos(lat)), -1, 1);
      az = Math.acos(cosAz); if (w < 0) az = -az;
    }
    return { alturaGrados: alt / RAD, azimutGrados: az / RAD, sinAltura: sinAlt, esDia: sinAlt > 0.0087 /* > 0,5° */, declinacionGrados: dec / RAD };
  }

  /**
   * Irradiancia de cielo despejado sobre el horizontal: directa normal, difusa horizontal y global horizontal (W/m²).
   * Meinel con masa de aire de Kasten-Young y aire limpio de la costa de Cartagena: a mediodía de junio da ≈ 990 W/m² en
   * horizontal y ≈ 1 000-1 020 W/m² sobre el plano de 28° (un día despejado de verano en el sureste).
   */
  function cieloDespejado(dia, sinAlt) {
    if (sinAlt <= 0.0087) return { gbn: 0, gdh: 0, gh: 0, sinAlt: 0 };
    const e0 = 1 + 0.033 * Math.cos(2 * Math.PI * diaValido(dia) / 365);
    const altDeg = Math.asin(sinAlt) / RAD;
    const masa = 1 / (sinAlt + 0.50572 * Math.pow(altDeg + 6.07995, -1.6364));        // Kasten-Young
    const gbn = 1.015 * 1361 * e0 * Math.pow(0.7, Math.pow(masa, 0.678));              // Meinel
    const gdh = (0.095 + 0.04 * (1 - sinAlt)) * gbn * sinAlt + 15 * sinAlt;
    return { gbn, gdh, gh: gbn * sinAlt + gdh, sinAlt };
  }

  /**
   * Efecto de la nubosidad n (0–1; con 1 el cielo está cubierto). La global horizontal baja con kc = 1 − 0,72·n² (n = 0,3 → −6 %;
   * n = 0,5 → −18 %; n = 0,7 → −35 %; n = 1 → −72 %, todo difusa); la directa baja más deprisa ((1 − n)^1,2) y la difusa recoge la diferencia.
   * `realce` (0–1, por defecto 0) es el efecto borde de nube: con cielo parcialmente cubierto y sol directo entre nubes, los bordes brillantes
   * de las nubes suman hasta un 20 % de la global despejada en difusa, de modo que la global puede superar a la de cielo despejado
   * (picos reales de 1 100-1 200 W/m² sobre el plano; nunca más).
   */
  function conNubosidad(cielo, nub, realce = 0) {
    const n = limitar(nub, 0, 1);
    const kc = 1 - 0.72 * n * n;
    const gbn = cielo.gbn * Math.pow(1 - n, 1.2);
    const gdh = Math.max(cielo.gdh * (1 - n), cielo.gh * kc - gbn * cielo.sinAlt) + 0.2 * cielo.gh * limitar(realce, 0, 1) * 4 * n * (1 - n);
    return { gbn, gdh, gh: gbn * cielo.sinAlt + gdh, sinAlt: cielo.sinAlt };
  }

  /** Factor de transmisión del vidrio (modificador del ángulo de incidencia, ASHRAE con b0 = 0,05): 1 con el sol de frente, 0,95 a 60°, 0,76 a 80°. */
  const factorIncidencia = cosInc => (cosInc <= 0.05 ? 0 : limitar(1 - 0.05 * (1 / cosInc - 1), 0, 1));

  /**
   * Irradiancia sobre un plano (inclinación y azimut en grados, azimut 0 = sur). `pos` viene de posicionSolar.
   * `g` es lo que mediría un piranómetro en el plano; `gUtil` es lo que de verdad atraviesa el vidrio (la directa con el modificador del
   * ángulo de incidencia y un 3 % menos en difusa y reflejada): es la que mueve las células. `difusaUtil` = difusa + reflejada útiles.
   */
  function planoInclinado(pos, cielo, inclinacionGrados, azimutGrados, albedo = C.ALBEDO) {
    if (!pos.esDia || cielo.gh <= 0) return { g: 0, gUtil: 0, difusaUtil: 0, directa: 0, difusa: 0, reflejada: 0, cosIncidencia: 0 };
    const alt = pos.alturaGrados * RAD, az = pos.azimutGrados * RAD, b = inclinacionGrados * RAD, g = azimutGrados * RAD;
    const sx = Math.cos(alt) * Math.sin(az), sy = Math.cos(alt) * Math.cos(az), sz = Math.sin(alt);       // x oeste, y sur, z arriba
    const nx = Math.sin(b) * Math.sin(g), ny = Math.sin(b) * Math.cos(g), nz = Math.cos(b);
    const cosInc = Math.max(0, sx * nx + sy * ny + sz * nz);
    const directa = cielo.gbn * cosInc;
    const difusa = cielo.gdh * (1 + Math.cos(b)) / 2;
    const reflejada = cielo.gh * albedo * (1 - Math.cos(b)) / 2;
    const difusaUtil = 0.97 * (difusa + reflejada);
    return { g: directa + difusa + reflejada, gUtil: directa * factorIncidencia(cosInc) + difusaUtil, difusaUtil, directa, difusa, reflejada, cosIncidencia: cosInc };
  }

  /** Temperatura ambiente de Cartagena: media 18,5 °C, ±7,5 °C estacional (máx. a finales de julio) y ±4,5 °C diaria (máx. 15 h, mín. 5 h). */
  function temperaturaAmbiente(dia, horaSolar, nub = 0) {
    const est = 7.5 * Math.cos(2 * Math.PI * (diaValido(dia) - 205) / 365);
    const dia24 = 4.5 * (1 - 0.5 * limitar(nub, 0, 1)) * Math.cos(2 * Math.PI * (horaSolar - 15) / 24);
    return 18.5 + est + dia24 - 1.5 * limitar(nub, 0, 1);
  }

  /** Nubosidad media (0–1) de cada mes en Cartagena (referencia para elegir un «cielo medio» y para la prueba de balance anual). */
  const NUBOSIDAD_MEDIA_MES = [0.26, 0.30, 0.28, 0.34, 0.32, 0.22, 0.12, 0.20, 0.26, 0.29, 0.27, 0.26];

  const api = { declinacionGrados, posicionSolar, cieloDespejado, conNubosidad, planoInclinado, factorIncidencia, temperaturaAmbiente, textoReloj, fechaDeDia, diaValido, MESES, NUBOSIDAD_MEDIA_MES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { const P = (window.PCT = window.PCT || {}); (P.fv = P.fv || {}).sol = api; }
})();
