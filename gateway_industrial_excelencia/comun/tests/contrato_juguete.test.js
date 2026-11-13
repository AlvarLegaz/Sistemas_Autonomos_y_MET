'use strict';
// La prueba de contrato genérica contra la simulación de juguete: TODO debe pasar en verde. Y, para saber que las pruebas muerden,
// la misma prueba contra versiones del juguete rotas a propósito debe ponerse en rojo en el criterio que rompen.
const assert = require('node:assert/strict');
const { describe, test } = require('node:test');
const { probarContrato, comprobar, criterios } = require('./contrato.js');
const { crearSimulacion, crearFabrica } = require('./sim_juguete.js');

probarContrato('juguete', crearSimulacion, { id: 'planta_real' });

describe('la prueba de contrato detecta…', () => {
  const casos = [
    ['paso_variable', 'C7', 'un modelo que depende del troceo del tiempo'],
    ['estado_mutable', 'C11', 'un estado() sin congelar'],
    ['medir_cambia', 'C32', 'un medir que consume azar'],
    ['recorta_valores', 'C16', 'valores fuera de rango recortados en silencio'],
    ['paso_doble', 'C6', 'un paso fijo que no es fijo (avanzar(1) da pasos de doble duración)'],
    ['paso_doble', 'C7', 'un paso fijo que no es fijo (el troceo cambia el resultado)'],
    ['quitar_codigo_malo', 'C35', 'averias.quitar con el motivo equivocado para una instancia bien formada no activa'],
  ];
  for (const [fallo, codigo, texto] of casos) {
    test(`la prueba de contrato detecta ${texto} (${codigo}, fallo '${fallo}')`, async () => {
      await assert.doesNotReject(() => comprobar(codigo, crearSimulacion), `${codigo} debe pasar con el juguete sano`);
      await assert.rejects(() => comprobar(codigo, crearFabrica({ fallo })), assert.AssertionError, `${codigo} no detecta el fallo '${fallo}'`);
    });
  }

  test('la prueba de contrato tiene un criterio por cada C1–C37', () => {
    assert.deepStrictEqual(criterios.map(c => c.codigo), Array.from({ length: 37 }, (_, i) => 'C' + (i + 1)));
  });
});
