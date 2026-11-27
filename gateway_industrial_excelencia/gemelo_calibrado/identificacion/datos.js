// Carga el CSV del sinóptico (separador ';', decimales con coma) y lo deja en filas numéricas, remuestreado a 1 s.
const fs = require('fs');

function cargar(ruta) {
  const lineas = fs.readFileSync(ruta, 'utf8').trim().split(/\r?\n/);
  const cab = lineas[0].split(';');
  const filas = lineas.slice(1).map(l => {
    const v = l.split(';');
    const f = {};
    cab.forEach((c, i) => { f[c] = c === 'hora' ? v[i] : Number(String(v[i]).replace(',', '.')); });
    return f;
  });
  // Remuestreo a 1 s: en los huecos se mantiene la última fila (las entradas no cambian dentro de un hueco).
  const fin = filas[filas.length - 1].tiempo_s;
  const serie = [];
  let j = 0;
  for (let t = 0; t <= fin; t++) {
    while (j + 1 < filas.length && filas[j + 1].tiempo_s <= t) j++;
    serie.push({ ...filas[j], t, medida: filas[j].tiempo_s === t });
  }
  return serie;
}

module.exports = { cargar };
