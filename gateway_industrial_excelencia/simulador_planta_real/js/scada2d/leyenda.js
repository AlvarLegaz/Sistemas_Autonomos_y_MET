// Leyenda del esquema 2D: qué significa cada color de tubería y cada LED del armario.
(function () {
  const ELEMENTOS = [
    { clave: 'producto', texto: 'Leche circulando', variable: '--producto', tipo: 'linea' },
    { clave: 'caliente', texto: 'Agua caliente', variable: '--caliente', tipo: 'linea' },
    { clave: 'frio', texto: 'Agua fría', variable: '--agua', tipo: 'linea' },
    { clave: 'parado', texto: 'Tubería sin flujo', variable: '--tubo', tipo: 'linea' },
    { clave: 'ok', texto: 'LED verde: bien / en marcha', variable: '--ok', tipo: 'punto' },
    { clave: 'alarma', texto: 'LED rojo: fallo o alarma', variable: '--error', tipo: 'punto' },
  ];

  /** Dibuja la leyenda en `contenedor` (usa las variables de color del CSS, así sigue el tema claro u oscuro). */
  function crearLeyenda(contenedor) {
    contenedor.innerHTML = '<ul class="leyenda-htst">' + ELEMENTOS.map(e =>
      `<li><span class="ley-${e.tipo}" style="--c:var(${e.variable})" aria-hidden="true"></span>${e.texto}</li>`).join('') + '</ul>' +
      '<p class="leyenda-nota">Seguridad positiva: sin tensión o sin aire, la FDV-101 queda en <b>desvío</b>.</p>';
  }

  const api = { ELEMENTOS, crearLeyenda };
  if (typeof module !== 'undefined') module.exports = api; else PCT.htstLeyenda = api;
})();
