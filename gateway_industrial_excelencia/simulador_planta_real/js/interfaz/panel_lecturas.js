// Lecturas de los instrumentos en SOLO LECTURA (nivel 2 «Operar»): una tabla con el valor que ve el PLC de cada instrumento y el estado de las protecciones.
// Es lo que el operador mira en el SCADA. El multímetro, el osciloscopio y las hojas son del nivel 3. La parte pura (filas) se prueba con node:test.
(function () {
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.htstLayout;
  const esquema = typeof require !== 'undefined' ? require('../scada2d/esquema_htst.js') : PCT.htstEsquema;

  // Protecciones y contactos que un operador debe poder consultar (todo/nada): [tag, estado de estadoEquipo() que es el BUENO, texto si está bien, texto si no, informativo]; «informativo»: el otro estado es normal (p. ej. el tanque se llena a propósito hasta el nivel alto) y no es alarma
  const DIGITALES = [['TSH-201', 'normal', 'Normal', 'Disparado'], ['LSL-101', 'activado', 'Hay leche', 'Sin leche'], ['LSH-101', 'desactivado', 'Nivel alto no alcanzado', 'Nivel alto alcanzado', true],
    ['LSL-201', 'activado', 'Hay agua', 'Nivel bajo'], ['PSL-501', 'activado', 'Aire suficiente', 'Aire bajo'], ['ES-001', 'normal', 'Rearmada', 'Pulsada']];
  const nombreDe = tag => ((layout.EQUIPOS || []).find(e => e.tag === tag) || {}).nombre || tag;

  /** Filas de la tabla: [{ tag, nombre, valor, estado, alarma }], primero los analógicos y luego las protecciones. */
  function filasLecturas(estado) {
    const filas = [];
    for (const s of layout.SENALES.filter(x => x.tipo === 'AI')) {
      const alarma = esquema.alarmaInstrumento(estado, s.tag);
      filas.push({ tag: s.tag, nombre: nombreDe(s.tag), valor: esquema.textoInstrumento(estado, s.tag), estado: alarma ? 'Fallo del lazo' : 'Normal', alarma });
    }
    for (const [tag, bueno, textoBien, textoMal, informativo] of DIGITALES) {
      const otro = esquema.estadoEquipo(estado, tag) !== bueno, malo = otro && !informativo;
      filas.push({ tag, nombre: nombreDe(tag), valor: otro ? textoMal : textoBien, estado: malo ? 'Atención' : 'Normal', alarma: malo });
    }
    return filas;
  }

  /** Tabla de solo lectura dentro de `contenedor`; actualizar(estado) solo toca las celdas que cambian. */
  function crearPanelLecturas(contenedor) {
    contenedor.innerHTML = '<h2>Lecturas de los instrumentos</h2><p class="nota-lecturas">Lo que ve el PLC. Multímetro y osciloscopio: nivel 3.</p>' +
      '<table class="tabla-lecturas"><thead><tr><th scope="col">Instrumento</th><th scope="col">Valor</th><th scope="col">Estado</th></tr></thead><tbody></tbody></table>';
    const cuerpo = contenedor.querySelector('tbody'), celdas = new Map();
    return {
      actualizar(estado) {
        for (const f of filasLecturas(estado)) {
          let c = celdas.get(f.tag);
          if (!c) {
            const tr = document.createElement('tr');
            tr.innerHTML = `<th scope="row"><b></b><small></small></th><td class="valor"></td><td class="estado"></td>`;
            tr.querySelector('b').textContent = f.tag; tr.querySelector('small').textContent = f.nombre;
            cuerpo.appendChild(tr); c = { tr, valor: tr.querySelector('.valor'), estado: tr.querySelector('.estado') }; celdas.set(f.tag, c);
          }
          if (c.valor.textContent !== f.valor) c.valor.textContent = f.valor;
          const texto = `${f.alarma ? '⚠ ' : '✔ '}${f.estado}`; if (c.estado.textContent !== texto) c.estado.textContent = texto;
          c.tr.classList.toggle('alarma', f.alarma);
        }
      },
    };
  }

  const api = { DIGITALES, filasLecturas, crearPanelLecturas };
  if (typeof module !== 'undefined') module.exports = api; else PCT.htstPanelLecturas = api;
})();
