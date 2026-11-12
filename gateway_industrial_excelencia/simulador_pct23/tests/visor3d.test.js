'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { GEOMETRIA, MODELOS } = require('../js/interfaz/visor3d/especificaciones.js');
const { lecturasModelo } = require('../js/interfaz/visor3d/lecturas.js');
const { posicionOrbita, desplazarObjetivo } = require('../js/interfaz/visor3d/controles_orbita.js');
const { ELEMENTOS } = require('../js/interfaz/ayuda_textos.js');
const estadoPlanta = require('../js/modelo/estado_planta.js');
const planta = require('../js/modelo/planta.js');

const lecturas = (clave, ajustar = () => {}) => {
  const estado = estadoPlanta.crearEstado();
  ajustar(estado);
  return lecturasModelo(clave, estado, planta.observaciones(estado));
};
const TIPOS = ['sonda_nivel', 'flotador', 'sonda_temp', 'termostato', 'resistencia'];

test('cada modelo tiene ids únicos y captadores dentro del depósito', () => {
  const radio = GEOMETRIA.diametroCm / 2;
  for (const [clave, modelo] of Object.entries(MODELOS)) {
    const ids = [...modelo.captadores, ...modelo.conexiones].map(e => e.id);
    assert.equal(new Set(ids).size, ids.length, `${clave}: ids repetidos`);
    if (modelo.escena) continue;   // el intercambiador no es un depósito: sin alturas ni radios
    for (const c of modelo.captadores) {
      assert.ok(TIPOS.includes(c.tipo), `${c.id}: tipo desconocido ${c.tipo}`);
      assert.ok(c.alturaCm >= 0 && c.alturaCm <= GEOMETRIA.alturaCm, `${c.id}: altura fuera del depósito`);
      assert.ok(c.radioCm <= radio, `${c.id}: fuera del radio del depósito`);
      for (const campo of ['nombre', 'senal', 'queMide', 'uso']) assert.ok(c[campo], `${c.id}: falta ${campo}`);
    }
    for (const c of modelo.conexiones) {
      assert.ok(['entrada', 'salida'].includes(c.tipo));
      assert.ok(c.alturaCm >= 0 && c.alturaCm <= GEOMETRIA.alturaCm, `${c.id}: altura fuera del depósito`);
    }
  }
});

test('la resistencia queda por debajo del interruptor de nivel que la protege', () => {
  const heat = MODELOS.HEAT.captadores;
  const resistencia = heat.find(c => c.id === 'RES'), nivel = heat.find(c => c.id === 'LVL');
  assert.ok(nivel.alturaCm > resistencia.alturaCm + 7, 'LVL debe quedar sobre la espira de la resistencia');
});

test('todo lo que abre el visor desde la ayuda existe y apunta a un captador real', () => {
  for (const [clave, elemento] of Object.entries(ELEMENTOS)) {
    if (!elemento.modelo3d) continue;
    const modelo = MODELOS[elemento.modelo3d];
    assert.ok(modelo, `${clave}: modelo ${elemento.modelo3d} inexistente`);
    if (elemento.foco3d) assert.ok(modelo.captadores.some(c => c.id === elemento.foco3d), `${clave}: foco ${elemento.foco3d} inexistente`);
  }
  for (const modelo of Object.values(MODELOS)) {
    for (const e of [...modelo.captadores, ...modelo.conexiones]) assert.ok(ELEMENTOS[e.ayuda], `${e.id}: ayuda ${e.ayuda} inexistente`);
  }
});

test('tanque A: el líquido y L1 cuentan la misma altura', () => {
  const l = lecturas('TANKA', e => { e.depositoAMl = 1250; });          // 25 % de 5000 ml
  assert.ok(Math.abs(l.fraccion - 0.25) < 1e-9);
  assert.ok(Math.abs(l.alturaLiquidoCm - 6.25) < 1e-9);
  assert.ok(Math.abs(l.sensores.L1.marcaCm - l.alturaLiquidoCm) < 1e-9);
  assert.equal(l.volumenMl, 1250);
  assert.ok(Math.abs(l.presionFondoPa - 1000 * 9.81 * 0.0625) < 1e-6);
});

test('tanque B: los flotadores siguen al nivel (HL arriba, LL con lógica negada)', () => {
  const lleno = lecturas('TANKB', e => { e.depositoBMl = 4500; });       // 90 %
  assert.equal(lleno.sensores.HL.activo, true);
  assert.equal(lleno.sensores.LL.activo, true);                          // hay líquido sobre el bajo
  const medio = lecturas('TANKB', e => { e.depositoBMl = 2500; });
  assert.equal(medio.sensores.HL.activo, false);
  assert.equal(medio.sensores.LL.activo, true);
  const vacio = lecturas('TANKB', e => { e.depositoBMl = 300; });        // 6 %
  assert.equal(vacio.sensores.HL.activo, false);
  assert.equal(vacio.sensores.LL.activo, false);
  assert.match(vacio.sensores.LL.texto, /casi vacío/);
});

test('heat unit: resistencia, T2 y termostato reflejan el estado de la planta', () => {
  const apagada = lecturas('HEAT');
  assert.equal(apagada.sensores.RES.activo, false);
  assert.equal(apagada.sensores.TERM.alarma, false);
  assert.ok(Math.abs(apagada.fraccion - 0.7) < 1e-9);
  assert.equal(apagada.sensores.LVL.activo, true);                       // la resistencia está cubierta
  assert.equal(apagada.sensores.HLC.activo, false);                      // 17,5 cm no llega a 22 cm
  const caliente = lecturas('HEAT', e => { e.salidas.RES = true; e.consignas.potenciaPct = 60; e.aguaCalienteC = 55; });
  assert.equal(caliente.sensores.RES.activo, true);
  assert.equal(caliente.sensores.RES.potencia, 60);
  assert.match(caliente.sensores.RES.texto, /ON · 60,0 %/);
  assert.equal(caliente.sensores.T2.texto, '55,0 °C');
  assert.equal(caliente.temperaturaAguaC, 55);
  const disparado = lecturas('HEAT', e => { e.temperaturaCorte = true; });
  assert.equal(disparado.sensores.TERM.alarma, true);
  assert.equal(disparado.sensores.TERM.activo, false);
});

test('intercambiador: cada sección y sonda lee su temperatura y SOL3 manda en el enfriamiento', () => {
  const parado = lecturas('EXCH');
  assert.equal(parado.sensores.SEC_ENFRIA.activo, false);
  assert.equal(parado.sensores.SEC_REGEN.activo, false);
  const marcha = lecturas('EXCH', e => { estadoPlanta.activarEjemplo(e); e.caudalProductoMlMin = 120; e.aguaCalienteC = 60; e.t3C = 30; e.t5C = 45; });
  assert.equal(marcha.sensores.SEC_ENFRIA.activo, true);
  assert.equal(marcha.sensores.SEC_CALENT.tempC, 60);
  assert.equal(marcha.sensores.T3.texto, '30,0 °C');
  assert.equal(marcha.sensores.T5.valor, 45);
});

test('bombas: parada, en marcha y con el giro invertido', () => {
  assert.equal(lecturas('BOMBA_N1').sensores.ROTOR.activo, false);
  const marcha = lecturas('BOMBA_N2', e => { e.salidas.N2 = true; e.consignas.velocidadN2Pct = 40; });
  assert.equal(marcha.sensores.ROTOR.velocidadPct, 40);
  assert.equal(marcha.sensores.TUBO.activo, true);
  const inversa = lecturas('BOMBA_N1', e => { e.salidas.N1 = true; e.giro.N1 = true; });
  assert.equal(inversa.sensores.ROTOR.inversa, true);
  assert.equal(inversa.sensores.TUBO.activo, false);
  assert.match(inversa.sensores.ROTOR.texto, /INVERSO/);
});

test('el llenado se limita entre 0 y 100 %', () => {
  assert.equal(lecturas('TANKA', e => { e.depositoAMl = -50; }).fraccion, 0);
  assert.equal(lecturas('TANKA', e => { e.depositoAMl = 99999; }).fraccion, 1);
});

test('la órbita de la cámara: de frente, desde arriba y a distancia constante', () => {
  const objetivo = { x: 0, y: 5, z: 0 };
  const frente = posicionOrbita(0, 0, 10, objetivo);
  assert.deepEqual([frente.x, frente.y, frente.z].map(v => Math.round(v * 1e9) / 1e9), [0, 5, 10]);
  const arriba = posicionOrbita(0, Math.PI / 2, 10, objetivo);
  assert.ok(Math.abs(arriba.y - 15) < 1e-9 && Math.abs(arriba.z) < 1e-9);
  const lado = posicionOrbita(Math.PI / 2, 0, 10, objetivo);
  assert.ok(Math.abs(lado.x - 10) < 1e-9 && Math.abs(lado.z) < 1e-9);
  for (const [az, el] of [[0.3, 0.2], [2, -0.7], [-1, 1.2]]) {
    const p = posicionOrbita(az, el, 42, objetivo);
    assert.ok(Math.abs(Math.hypot(p.x - objetivo.x, p.y - objetivo.y, p.z - objetivo.z) - 42) < 1e-9);
  }
});

test('planta: T2 y la resistencia llevan su lectura para la etiqueta', () => {
  const l = lecturas('PLANTA', e => { e.aguaCalienteC = 61.5; e.salidas.RES = true; e.consignas.potenciaPct = 40; });
  assert.equal(l.sensores.T2.texto, '61,5 °C');
  assert.match(l.sensores.RES.texto, /ON · 40,0 %/);
});

test('desplazar la cámara: de frente, arrastrar a la derecha lleva el objetivo a la izquierda y arrastrar hacia abajo lo sube', () => {
  const vista = { azimut: 0, elevacion: 0, distancia: 100, objetivo: { x: 0, y: 0, z: 0 } };
  desplazarObjetivo(vista, 100, 0, 600);
  assert.ok(vista.objetivo.x < 0 && Math.abs(vista.objetivo.y) < 1e-9 && Math.abs(vista.objetivo.z) < 1e-9);
  const antes = vista.objetivo.x;
  desplazarObjetivo(vista, 0, 100, 600);
  assert.equal(vista.objetivo.x, antes);
  assert.ok(vista.objetivo.y > 0);
});

test('desplazar la cámara: el movimiento es del tamaño de la pantalla (más lejos, más cm por píxel) y no cambia la distancia ni el giro', () => {
  const cerca = { azimut: 0.7, elevacion: 0.3, distancia: 100, objetivo: { x: 0, y: 0, z: 0 } };
  const lejos = { azimut: 0.7, elevacion: 0.3, distancia: 300, objetivo: { x: 0, y: 0, z: 0 } };
  desplazarObjetivo(cerca, 50, 20, 600); desplazarObjetivo(lejos, 50, 20, 600);
  const paso = v => Math.hypot(v.objetivo.x, v.objetivo.y, v.objetivo.z);
  assert.ok(Math.abs(paso(lejos) / paso(cerca) - 3) < 1e-9);
  assert.equal(cerca.distancia, 100); assert.equal(cerca.azimut, 0.7); assert.equal(cerca.elevacion, 0.3);
  // un píxel arrastrado a lo largo de la pantalla mueve exactamente alto_visible / alto_lienzo
  const v = { azimut: 1.1, elevacion: 0.5, distancia: 200, objetivo: { x: 5, y: 6, z: 7 } };
  desplazarObjetivo(v, 30, 40, 800);
  const d = Math.hypot(v.objetivo.x - 5, v.objetivo.y - 6, v.objetivo.z - 7);
  assert.ok(Math.abs(d - Math.hypot(30, 40) * 2 * 200 * Math.tan(19 * Math.PI / 180) / 800) < 1e-9);
});

test('desplazar la cámara: el objetivo no se pierde más allá del límite', () => {
  const vista = { azimut: 0, elevacion: 0, distancia: 500, objetivo: { x: 0, y: 0, z: 0 } };
  for (let i = 0; i < 400; i++) desplazarObjetivo(vista, -500, 500, 600);
  for (const c of ['x', 'y', 'z']) assert.ok(Math.abs(vista.objetivo[c]) <= 1500);
});
