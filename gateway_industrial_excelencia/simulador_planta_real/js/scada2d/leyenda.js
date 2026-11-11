// Leyenda del esquema 2D, pegada al dibujo: va DENTRO del propio SVG (en el hueco libre de abajo a la derecha), así siempre se ve junto a lo que explica y a la
// misma escala. Los estados se distinguen por FORMA además de por color (anillo vacío = apagado, relleno = activo, relleno con ✕ = fallo), para que se lean
// también en gris, con daltonismo o en un proyector.
(function () {
  const lin = (clase) => (x, y) => [['path', { class: `tubo ${clase}`.trim(), d: `M${x} ${y + 9} H${x + 26}` }]];
  const bomba = (clase) => (x, y) => [['circle', { class: `instr bomba ${clase}`.trim(), cx: x + 13, cy: y + 9, r: 8 }], ['path', { class: 'bomba-flecha', d: `M${x + 10} ${y + 4} L${x + 18} ${y + 9} L${x + 10} ${y + 14} Z` }]];
  const valvula = (clase) => (x, y) => [['path', { class: `valvula ${clase}`.trim(), d: `M${x + 1} ${y + 2} L${x + 13} ${y + 9} L${x + 1} ${y + 16} Z M${x + 25} ${y + 2} L${x + 13} ${y + 9} L${x + 25} ${y + 16} Z` }]];
  const led = (clase) => (x, y) => [['circle', { class: `instr ${clase}`.trim(), cx: x + 13, cy: y + 9, r: 7 }]];
  const ledFallo = (x, y) => [['g', { class: 'led fallo' }, ['circle', { class: 'instr alarma', cx: x + 13, cy: y + 9, r: 7 }],
    ['path', { class: 'led-x', d: `M${x + 10} ${y + 6} L${x + 16} ${y + 12} M${x + 16} ${y + 6} L${x + 10} ${y + 12}` }]]];
  const lazo = (x, y) => [['circle', { class: 'instr alarma', cx: x + 13, cy: y + 9, r: 8 }]];

  const ELEMENTOS = [
    { clave: 'producto', texto: 'Leche circulando', tipo: 'linea', forma: lin('activo') },
    { clave: 'caliente', texto: 'Agua caliente', tipo: 'linea', forma: lin('caliente activo') },
    { clave: 'frio', texto: 'Agua fría', tipo: 'linea', forma: lin('frio activo') },
    { clave: 'parado', texto: 'Tubería sin flujo', tipo: 'linea', forma: lin('') },
    { clave: 'bomba_parada', texto: 'Bomba parada', tipo: 'simbolo', forma: bomba('') },
    { clave: 'bomba_marcha', texto: 'Bomba en marcha', tipo: 'simbolo', forma: bomba('bomba-producto on') },
    { clave: 'valvula_cerrada', texto: 'Válvula cerrada', tipo: 'simbolo', forma: valvula('') },
    { clave: 'valvula_abierta', texto: 'Válvula abierta', tipo: 'simbolo', forma: valvula('fl-producto on') },
    { clave: 'led_apagado', texto: 'LED apagado', tipo: 'simbolo', forma: led('') },
    { clave: 'led_activo', texto: 'LED activo', tipo: 'simbolo', forma: led('on') },
    { clave: 'led_fallo', texto: 'LED en fallo (✕)', tipo: 'simbolo', forma: ledFallo },
    { clave: 'lazo', texto: 'Fallo de lazo 4-20 mA', tipo: 'simbolo', forma: lazo },
  ];

  /** Especificación SVG de la leyenda (dos columnas) con su esquina superior izquierda en (x0, y0). Se incrusta en el esquema. */
  function leyendaSvg(x0 = 660, y0 = 512) {
    const hijos = [['text', { x: x0, y: y0, class: 'ht-zona', style: 'text-anchor:start' }, 'LEYENDA']];
    ELEMENTOS.forEach((e, i) => {
      const x = x0 + Math.floor(i / 6) * 220, y = y0 + 12 + (i % 6) * 20;
      hijos.push(...e.forma(x, y), ['text', { x: x + 34, y: y + 13, class: 'ht-tag', style: 'text-anchor:start' }, e.texto]);
    });
    return [['g', { id: 'leyenda-esquema', 'aria-hidden': 'true' }, ...hijos]];
  }

  /** Nota bajo el esquema (la leyenda en sí va dibujada dentro del esquema). */
  function crearLeyenda(contenedor) {
    contenedor.innerHTML = '<p class="leyenda-nota">Seguridad positiva: sin tensión o sin aire, la FDV-101 queda en <b>desvío</b>. Pulsa (o tabula y pulsa Intro) cualquier equipo para ver su ficha.</p>';
  }

  const api = { ELEMENTOS, leyendaSvg, crearLeyenda };
  if (typeof module !== 'undefined') module.exports = api; else PCT.htstLeyenda = api;
})();
