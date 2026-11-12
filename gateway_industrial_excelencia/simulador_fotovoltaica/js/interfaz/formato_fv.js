// Formato de las magnitudes del simulador fotovoltaico (decimales con coma, potencias en W o kW, energías en Wh o kWh, reloj solar) y selección de
// colores/estados. Funciones puras: se prueban sin navegador. Las usan el esquema, las gráficas, las fichas y la página.
(function () {
  const num = v => typeof v === 'number' && Number.isFinite(v);
  /** Número con `c` decimales y coma decimal; «—» si no es un número. */
  const dec = (v, c = 1) => (num(v) ? v.toFixed(c).replace('.', ',').replace(/^-0(,0*)?$/, m => m.slice(1)) : '—');

  /** Potencia: menos de 1 kW en vatios enteros («850 W»), a partir de 1 kW en kilovatios con dos decimales («2,41 kW»). */
  function formatoPotencia(w) {
    if (!num(w)) return '—';
    const a = Math.abs(w);
    if (a < 999.5) return `${Math.round(w) === 0 ? 0 : Math.round(w)} W`;
    return `${dec(w / 1000, a >= 9995 ? 1 : 2)} kW`;
  }
  /** Energía: menos de 1 kWh en Wh, si no en kWh con dos decimales (o uno por encima de 100 kWh). */
  function formatoEnergia(wh) {
    if (!num(wh)) return '—';
    const a = Math.abs(wh);
    if (a < 999.5) return `${Math.round(wh)} Wh`;
    return `${dec(wh / 1000, a >= 100000 ? 1 : 2)} kWh`;
  }
  const formatoTension = (v, c = 1) => (num(v) ? `${dec(v, c)} V` : '—');
  const formatoCorriente = (i, c = 2) => (num(i) ? `${dec(i, c)} A` : '—');
  const formatoPorcentaje = (x01, c = 0) => (num(x01) ? `${dec(x01 * 100, c)} %` : '—');
  const formatoTemperatura = (t, c = 0) => (num(t) ? `${dec(t, c)} °C` : '—');

  /** Hora solar decimal (9,5) como «09:30». */
  function formatoHora(horaSolar) {
    if (!num(horaSolar)) return '—';
    const m = Math.round((((horaSolar % 24) + 24) % 24) * 60) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
  const MESES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const NOMBRES_MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  /** Día del año (1–365) de una fecha (mes 1–12). */
  function diaDelAnio(mes, dia) { let n = dia; for (let i = 0; i < mes - 1; i++) n += MESES[i]; return Math.max(1, Math.min(365, n)); }
  /** { mes, dia } (mes 1–12) de un día del año. */
  function fechaDeDiaAnio(diaAnio) {
    let resto = Math.max(1, Math.min(365, Math.round(diaAnio)));
    for (let m = 0; m < 12; m++) { if (resto <= MESES[m]) return { mes: m + 1, dia: resto }; resto -= MESES[m]; }
    return { mes: 12, dia: 31 };
  }
  const textoFecha = diaAnio => { const f = fechaDeDiaAnio(diaAnio); return `${f.dia} ${NOMBRES_MES[f.mes - 1]}`; };
  /** Reloj solar «21 jun · 09:30» (el modelo ya lo da en estado.reloj.texto; esto es el respaldo y la base de las pruebas). */
  const formatoReloj = (diaAnio, horaSolar) => `${textoFecha(diaAnio)} · ${formatoHora(horaSolar)}`;
  /** Valor de `<input type="date">` (año de referencia 2026, no bisiesto) para un día del año, y al revés. */
  const aValorFecha = diaAnio => { const f = fechaDeDiaAnio(diaAnio); return `2026-${String(f.mes).padStart(2, '0')}-${String(f.dia).padStart(2, '0')}`; };
  function deValorFecha(texto) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto || ''); return m ? diaDelAnio(Number(m[2]), Number(m[3])) : null; }

  /** Duración simulada «3 h 05 min» / «45 min» / «30 s». */
  function formatoDuracion(s) {
    if (!num(s)) return '—';
    const t = Math.round(s);
    if (t < 60) return `${t} s`;
    if (t < 3600) return `${Math.floor(t / 60)} min`;
    return `${Math.floor(t / 3600)} h ${String(Math.floor(t / 60) % 60).padStart(2, '0')} min`;
  }

  /** Cuántos pasos de ≤ `maxS` segundos hacen falta para avanzar `dtS` segundos simulados: lista de tamaños (el modelo se integra a pasos de hasta 5 s). */
  function subdividir(dtS, maxS = 5, maxPasos = 2000) {
    if (!(dtS > 0)) return [];
    const n = Math.min(maxPasos, Math.max(1, Math.ceil(dtS / maxS - 1e-9)));
    return Array.from({ length: n }, () => dtS / n);
  }

  /* ---------- colores y estados ---------- */
  const ESTADOS_VISUALES = ['ok', 'aviso', 'alarma', 'parado'];
  const GRAVEDAD = { parado: 0, ok: 1, aviso: 2, alarma: 3 };
  /** El más grave de varios estados visuales. */
  const peor = (...estados) => estados.reduce((a, b) => (GRAVEDAD[b] > GRAVEDAD[a] ? b : a), 'parado');
  const DE_SEVERIDAD = { info: 'ok', aviso: 'aviso', alarma: 'alarma' };
  /** Color simbólico (verde en servicio, ámbar aviso, rojo alarma, gris parado) de un estado visual, para las gráficas (hex legible en claro y oscuro). */
  const COLOR_ESTADO = { ok: '#2f9e6a', aviso: '#e0a33a', alarma: '#e5484d', parado: '#8a949e' };

  const api = { dec, formatoPotencia, formatoEnergia, formatoTension, formatoCorriente, formatoPorcentaje, formatoTemperatura, formatoHora, formatoReloj, textoFecha, diaDelAnio, fechaDeDiaAnio,
    aValorFecha, deValorFecha, formatoDuracion, subdividir, ESTADOS_VISUALES, GRAVEDAD, peor, DE_SEVERIDAD, COLOR_ESTADO, num };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') (window.PCT = window.PCT || {}).fvFormato = api;
})();
