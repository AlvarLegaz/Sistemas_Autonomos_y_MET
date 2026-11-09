(function () {
  const PASOS = [1, 2, 5, 10, 20, 25, 50];
  const MAX_DIVISIONES = 5;

  function marcasEntre(minimo, maximo, paso) {
    const marcas = [];
    for (let v = minimo; v <= maximo + 1e-9; v += paso) marcas.push(v);
    return marcas;
  }

  // Rango vertical que abarca los valores con un margen, redondeado a divisiones limpias.
  function rangoLimpio(valores, margen = 2, tope = { minimo: -Infinity, maximo: Infinity }) {
    const sueltos = valores.filter(Number.isFinite);
    if (!sueltos.length) return null;
    const bajo = Math.max(tope.minimo, Math.min(...sueltos) - margen);
    const alto = Math.min(tope.maximo, Math.max(...sueltos) + margen);
    const paso = PASOS.find(p => (alto - bajo) / p <= MAX_DIVISIONES) || PASOS[PASOS.length - 1];
    let minimo = Math.max(tope.minimo, Math.floor(bajo / paso) * paso);
    let maximo = Math.min(tope.maximo, Math.ceil(alto / paso) * paso);
    if (maximo <= minimo) maximo = minimo + paso;
    return { minimo, maximo, marcas: marcasEntre(minimo, maximo, paso) };
  }

  // Muestras de los últimos `ventanaS` segundos (null = todas). Las muestras llevan `tiempo` en segundos de simulación.
  function recortarVentana(muestras, ventanaS) {
    if (ventanaS == null || !muestras.length) return muestras;
    const desde = muestras[muestras.length - 1].tiempo - ventanaS;
    const primera = muestras.findIndex(m => m.tiempo >= desde);
    return primera < 0 ? muestras : muestras.slice(primera);
  }

  const api = { rangoLimpio, recortarVentana };
  if (typeof module !== 'undefined') module.exports = api; else PCT.escalaGrafica = api;
})();
