'use strict';
// Widget 2D «Intercambiador» (esquemático) (js/scada2d/componentes/intercambiador_basico.js): geometría, puertos, estados y textos. Sin navegador.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const W = require('../js/scada2d/componentes/intercambiador_basico.js');

const TAMANOS = [{ ancho: 200, alto: 170 }, { ancho: 300, alto: 230 }, { ancho: 260, alto: 240 }, { ancho: 420, alto: 300 }, { ancho: 220, alto: 420 }];
function todasLasConfiguraciones() {
  const lista = [];
  for (const t of TAMANOS) for (let pasadas = 1; pasadas <= 8; pasadas++) for (const sentidoA of ['derecha', 'izquierda']) for (const flujo of ['contracorriente', 'paralelo'])
    lista.push({ tag: 'T', x: 37, y: 11, pasadas, sentidoA, flujo, ancho: t.ancho, alto: t.alto });
  return lista;
}

test('la configuración se normaliza: valores por defecto, límites y contracorriente por defecto', () => {
  const c = W.normalizar({});
  assert.equal(c.pasadas, 3); assert.equal(c.flujo, 'contracorriente'); assert.equal(c.sentidoA, 'derecha');
  assert.equal(c.circuitoA.fluido, 'leche'); assert.equal(c.circuitoB.fluido, 'agua_caliente');
  assert.equal(W.normalizar({ pasadas: 99 }).pasadas, 8); assert.equal(W.normalizar({ pasadas: 0 }).pasadas, 3); assert.equal(W.normalizar({ pasadas: -3 }).pasadas, 1);
  assert.ok(W.normalizar({ ancho: 10, alto: 10 }).ancho >= 200);
  assert.equal(W.normalizar({ circuitoA: { fluido: 'lava' } }).circuitoA.fluido, 'leche');         // fluido desconocido
  assert.equal(W.normalizar({ flujo: 'raro' }).flujo, 'contracorriente');
  assert.deepEqual(W.sentidos(W.normalizar({})), { A: 'derecha', B: 'izquierda' });
  assert.deepEqual(W.sentidos(W.normalizar({ flujo: 'paralelo' })), { A: 'derecha', B: 'derecha' });
  assert.deepEqual(W.sentidos(W.normalizar({ sentidoA: 'izquierda' })), { A: 'izquierda', B: 'derecha' });
});

test('NO SE CRUZAN: ni entre sí ni consigo mismos, con 1 a 8 vueltas, los dos sentidos, en paralelo o a contracorriente y varios tamaños', () => {
  let probadas = 0;
  for (const cfg of todasLasConfiguraciones()) {
    const A = W.trazado(cfg, 'A'), B = W.trazado(cfg, 'B');
    assert.equal(W.hayCruce(A, B), false, `A y B se cortan: ${JSON.stringify(cfg)}`);
    assert.equal(W.autocruce(A), false, `A se corta a sí mismo: ${JSON.stringify(cfg)}`);
    assert.equal(W.autocruce(B), false, `B se corta a sí mismo: ${JSON.stringify(cfg)}`);
    probadas++;
  }
  assert.equal(probadas, 160);                      // 5 tamaños × 8 vueltas × 2 sentidos × 2 flujos
});

test('la prueba de cruce detecta de verdad un cruce (para que la anterior no sea vacía)', () => {
  const equis1 = [{ x: 0, y: 0 }, { x: 10, y: 10 }], equis2 = [{ x: 0, y: 10 }, { x: 10, y: 0 }];
  assert.equal(W.hayCruce(equis1, equis2), true);
  assert.equal(W.hayCruce([{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 0, y: 5 }, { x: 10, y: 5 }]), false);           // paralelas
  assert.equal(W.hayCruce([{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 10, y: 0 }, { x: 20, y: 0 }]), true);           // se tocan en un extremo
  assert.equal(W.autocruce([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }]), true);           // lazo en forma de 8
});

test('la parte interior va dentro de la caja, los tubos no se pisan (contando su grosor) y cada uno se queda en su franja', () => {
  for (const cfg of todasLasConfiguraciones()) {
    const A = W.trazado(cfg, 'A'), B = W.trazado(cfg, 'B'), g = W.geometria(W.normalizar(cfg));
    assert.ok(W.dentroDeCaja(cfg, W.interior(cfg, A)) && W.dentroDeCaja(cfg, W.interior(cfg, B)), `fuera de la caja: ${JSON.stringify(cfg)}`);
    assert.ok(g.pasadas >= 1 && g.pasadas <= cfg.pasadas);
    assert.ok(W.distanciaMinima(A, B) >= g.tubo + 8, `tubos pegados (${W.distanciaMinima(A, B).toFixed(1)} px, tubo ${g.tubo}): ${JSON.stringify(cfg)}`);
    assert.ok(A.every(p => p.y > g.ymed) && B.every(p => p.y < g.ymed), `un circuito invade la franja del otro: ${JSON.stringify(cfg)}`);
    assert.ok(g.amplitud >= g.tubo, `la onda casi no se ve: ${JSON.stringify(cfg)}`);
    for (const p of [...W.interior(cfg, A), ...W.interior(cfg, B)]) {                // el tubo, con su grosor, no toca el marco
      assert.ok(p.y - g.tubo / 2 >= cfg.y + g.marco && p.y + g.tubo / 2 <= cfg.y + cfg.alto - g.marco, `el tubo toca el marco: ${JSON.stringify(cfg)}`);
    }
  }
});

test('las ramas de una misma onda no se pegan: si no caben, se ponen menos vueltas', () => {
  for (const cfg of todasLasConfiguraciones()) {
    const g = W.geometria(W.normalizar(cfg));
    assert.ok(g.pasadas === 1 || (g.xe - g.xs) / g.pasadas >= Math.max(2.6 * g.tubo, 44), JSON.stringify(cfg));
  }
  assert.ok(W.geometria(W.normalizar({ ancho: 200, alto: 300, pasadas: 8 })).pasadas < 8);            // en una caja estrecha se reducen
});

test('a contracorriente cada circuito entra por un lado y sale por el otro, y el de servicio va al revés que el de producto', () => {
  const cfg = { x: 10, y: 20, ancho: 300, alto: 230 };
  const P = W.puertos(cfg), g = W.geometria(W.normalizar(cfg)), T = W.TUBO_EXTERIOR_PX;
  assert.deepEqual([P.entradaA.lado, P.salidaA.lado, P.entradaB.lado, P.salidaB.lado], ['izquierda', 'derecha', 'derecha', 'izquierda']);
  assert.equal(P.entradaA.x, 10 - T); assert.equal(P.salidaA.x, 310 + T); assert.equal(P.entradaB.x, 310 + T); assert.equal(P.salidaB.x, 10 - T);
  assert.equal(P.entradaA.y, g.yA); assert.equal(P.salidaA.y, g.yA); assert.equal(P.entradaB.y, g.yB); assert.equal(P.salidaB.y, g.yB);
  assert.ok(g.yB < g.yA);                                                           // servicio arriba, producto abajo
  const par = W.puertos(Object.assign({}, cfg, { flujo: 'paralelo' }));
  assert.equal(par.entradaB.lado, 'izquierda'); assert.equal(par.salidaB.lado, 'derecha');
  const vuelta = W.puertos(Object.assign({}, cfg, { sentidoA: 'izquierda' }));
  assert.equal(vuelta.entradaA.lado, 'derecha'); assert.equal(vuelta.entradaB.lado, 'izquierda');
});

test('el trazado de cada circuito empieza en su entrada y acaba en su salida, y la ruta SVG lo recoge', () => {
  const cfg = { x: 0, y: 0, ancho: 300, alto: 230, pasadas: 3 };
  for (const circ of ['A', 'B']) {
    const t = W.trazado(cfg, circ), P = W.puertos(cfg), d = W.ruta(t);
    const ent = P['entrada' + circ], sal = P['salida' + circ];
    assert.deepEqual([t[0].x, t[0].y], [ent.x, ent.y]); assert.deepEqual([t[t.length - 1].x, t[t.length - 1].y], [sal.x, sal.y]);
    assert.match(d, new RegExp('^M' + Math.round(ent.x * 10) / 10 + ' ' + Math.round(ent.y * 10) / 10));
    assert.equal((d.match(/L/g) || []).length, t.length - 1);
  }
});

test('más vueltas = más ondas (hasta lo que cabe)', () => {
  const vueltas = p => W.geometria(W.normalizar({ ancho: 500, alto: 260, pasadas: p })).pasadas;
  assert.ok(vueltas(2) < vueltas(3) && vueltas(3) < vueltas(5));
});

test('nombres (y temperaturas si se piden): fuera de la caja, junto a su puerto y sin pisarse', () => {
  const cfg = { tag: 'X', x: 100, y: 80, ancho: 300, alto: 230, temperaturas: true };
  const etq = W.etiquetas(cfg), P = W.puertos(cfg);
  assert.equal(W.etiquetas({ x: 100, y: 80 }).filter(e => e.tipo === 'temperatura').length, 0);      // por defecto, sin temperaturas
  assert.equal(etq.filter(e => e.tipo === 'temperatura').length, 4); assert.equal(etq.filter(e => e.tipo === 'fluido').length, 2);
  for (const e of etq) assert.ok(e.x < 100 - W.TUBO_EXTERIOR_PX || e.x > 400 + W.TUBO_EXTERIOR_PX, `${e.id} pisa la caja o el tubo`);
  for (const e of etq.filter(e => e.tipo === 'temperatura')) assert.ok(e.y < P[e.id].y);           // la temperatura va encima del tubo, el nombre debajo
  for (const a of etq) for (const b of etq) if (a !== b && a.anclaje === b.anclaje) assert.ok(Math.abs(a.y - b.y) >= 24, `${a.id} y ${b.id} se pisan`);
  const L = W.limites(cfg);
  for (const e of etq) assert.ok(e.anclaje === 'end' ? e.x - 95 >= L.x : e.x + 95 <= L.x + L.ancho, `${e.id} se sale de los límites`);
});

test('el estado sigue la prioridad fuga > fallo de sonda > ensuciado > circulando > parado', () => {
  assert.equal(W.claseEstado({}), 'parado');
  assert.equal(W.claseEstado({ circulaA: true }), 'circulando');
  assert.equal(W.claseEstado({ circulaA: true, obstruccion: 0.29 }), 'circulando');
  assert.equal(W.claseEstado({ circulaA: true, obstruccion: 0.3 }), 'ensuciado');
  assert.equal(W.claseEstado({ obstruccion: 0.9, falloSonda: { salidaB: true } }), 'fallo');
  assert.equal(W.claseEstado({ obstruccion: 0.9, falloSonda: { salidaB: true }, fuga: true }), 'fuga');
  for (const e of ['parado', 'circulando', 'ensuciado', 'fuga', 'fallo']) assert.ok(W.ESTADOS.includes(e));
});

test('las lecturas raras no rompen nada (NaN, texto, fuera de rango, sin datos)', () => {
  const l = W.normalizarLectura({ tEntradaA: NaN, tSalidaA: '60', obstruccion: 5, circulaA: 1, fuga: 'si', falloSonda: { entradaA: 1 } });
  assert.equal(l.tEntradaA, null); assert.equal(l.tSalidaA, null); assert.equal(l.obstruccion, 1); assert.equal(l.circulaA, true); assert.equal(l.fuga, true);
  assert.equal(l.falloSonda.entradaA, true); assert.equal(l.falloSonda.salidaB, false);
  assert.equal(W.normalizarLectura(undefined).obstruccion, 0);
  assert.equal(W.normalizarLectura({ obstruccion: -2 }).obstruccion, 0);
  assert.doesNotThrow(() => W.textoAccesible({}, { tEntradaA: Infinity }));
});

test('textos: temperatura con coma decimal, fallo de lazo, avisos y aria-label con el estado', () => {
  assert.equal(W.textoTemperatura(73.46, false), '73,5 °C'); assert.equal(W.textoTemperatura(4, false), '4,0 °C');
  assert.equal(W.textoTemperatura(null, false), '—'); assert.equal(W.textoTemperatura(73, true), '⚠ FALLO');
  assert.deepEqual(W.avisos({}), []);
  const a = W.avisos({ fuga: true, obstruccion: 0.6, falloSonda: { salidaA: true } });
  assert.equal(a.length, 3); assert.match(a[0], /Fuga/); assert.match(a[1], /60 %/); assert.match(a[2], /sonda/);
  const cfg = { tag: 'HX-9', titulo: 'Calentamiento', circuitoA: { fluido: 'leche', etiqueta: 'Leche fría' }, circuitoB: { fluido: 'agua_caliente' } };
  const t = W.textoAccesible(cfg, { circulaA: true, tEntradaA: 4, tSalidaA: 65, tEntradaB: 80, tSalidaB: 70 });
  assert.match(t, /^HX-9, Calentamiento\./); assert.match(t, /Leche fría entra a 4,0 °C y sale a 65,0 °C\./); assert.match(t, /Agua caliente entra a 80,0 °C/); assert.match(t, /Estado: circulando\.$/);
  assert.match(W.textoAccesible(cfg, { falloSonda: { salidaA: true }, tSalidaA: 65 }), /sale a sin lectura fiable/);
});

// Recorre la especificación (['etiqueta', {atributos}?, ...hijos]) y devuelve todos los nodos.
function nodos(spec, lista = []) {
  lista.push(spec);
  for (const h of spec.slice(spec[1] && typeof spec[1] === 'object' && !Array.isArray(spec[1]) ? 2 : 1)) if (Array.isArray(h)) nodos(h, lista);
  return lista;
}
const attrs = n => (n[1] && typeof n[1] === 'object' && !Array.isArray(n[1]) ? n[1] : {});

test('la especificación del widget: grupo accesible, dos circuitos con su fluido, cuatro temperaturas, ids únicos y avisos reservados', () => {
  const cfg = { tag: 'HX-1', titulo: 'Prueba', temperaturas: true, circuitoA: { fluido: 'leche' }, circuitoB: { fluido: 'agua_fria' } };
  const spec = W.especificacion(cfg, { circulaA: true, tEntradaA: 4, tSalidaA: 10 });
  const a = attrs(spec);
  assert.equal(spec[0], 'g'); assert.equal(a['data-tag'], 'HX-1'); assert.equal(a.role, 'button'); assert.equal(a.tabindex, 0); assert.match(a['aria-label'], /^HX-1, Prueba\./); assert.equal(a['data-estado'], 'circulando');
  const todos = nodos(spec), circuitos = todos.filter(n => n[0] === 'path' && attrs(n)['data-circuito']);
  assert.equal(circuitos.length, 2);
  assert.deepEqual(circuitos.map(n => attrs(n)['data-fluido']).sort(), ['agua_fria', 'leche']);
  assert.deepEqual(circuitos.map(n => attrs(n)['data-circuito']).sort(), ['HX-1-A', 'HX-1-B']);
  assert.equal(todos.filter(n => attrs(n).class === 'ic-temp').length, 4);
  assert.ok(!todos.some(n => ['pattern', 'circle'].includes(n[0])), 'esquemático: sin tramas ni tornillos');
  const ids = todos.map(n => attrs(n).id).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, 'ids repetidos');
  assert.equal(ids.filter(i => /aviso/.test(i)).length, 3);
  assert.ok(todos.some(n => n[0] === 'text' && n[n.length - 1] === 'Prueba'));
  // dos widgets distintos no comparten ids (se pueden poner varios en el mismo esquema)
  assert.equal(nodos(W.especificacion({ tag: 'HX-3' })).filter(n => attrs(n).class === 'ic-temp').length, 0);   // sin sondas, sin temperaturas
  const otros = nodos(W.especificacion({ tag: 'HX-2' })).map(n => attrs(n).id).filter(Boolean);
  assert.equal(otros.filter(i => ids.includes(i)).length, 0);
});

test('la marca de fuga queda en medio, entre las dos franjas, sin pisar los tubos', () => {
  const cfg = { tag: 'F', x: 0, y: 0, ancho: 300, alto: 230 };
  const marca = nodos(W.especificacion(cfg)).find(n => attrs(n).class === 'ic-fuga-marca');
  const m1y = Number(marca[1].d.match(/M(-?[\d.]+) (-?[\d.]+)/)[2]);
  const cy = m1y + 7, g = W.geometria(W.normalizar(cfg));
  assert.ok(Math.abs(cy - g.ymed) < 0.2);
  const A = W.trazado(cfg, 'A'), B = W.trazado(cfg, 'B');
  assert.ok(Math.min(...A.map(p => p.y)) - g.tubo / 2 > cy + 7 && Math.max(...B.map(p => p.y)) + g.tubo / 2 < cy - 7, 'la ✕ pisa un tubo');
});

test('unir bloques en fila: solo salida con entrada, a la misma altura y del mismo fluido', () => {
  const leche = { fluido: 'leche' }, agua = { fluido: 'agua_caliente' }, fria = { fluido: 'agua_fria' };
  const reg = { tag: 'R', x: 0, y: 0, circuitoA: leche, circuitoB: leche }, cal = { tag: 'C', x: 500, y: 0, circuitoA: leche, circuitoB: agua };
  const c = W.conectoresEntreBloques(reg, cal);
  assert.equal(c.length, 1); assert.equal(c[0].desde, 'izq.salidaA'); assert.equal(c[0].hasta, 'der.entradaA');      // el agua del calentamiento no entra en la leche
  const enf = { tag: 'E', x: -500, y: 0, circuitoA: fria, circuitoB: leche };
  const c2 = W.conectoresEntreBloques(enf, reg);
  assert.equal(c2.length, 1); assert.equal(c2[0].desde, 'der.salidaB'); assert.equal(c2[0].hasta, 'izq.entradaB');    // la leche vuelve hacia la izquierda
  assert.equal(c2[0].d, W.ruta([W.puertos(reg).salidaB, W.puertos(enf).entradaB]));
});

test('los límites del widget incluyen el sitio para las temperaturas, los nombres y los avisos', () => {
  const L = W.limites({ x: 100, y: 100, ancho: 300, alto: 230 });
  assert.ok(L.x <= 100 - W.TUBO_EXTERIOR_PX - 90 && L.ancho >= 300 + 2 * (W.TUBO_EXTERIOR_PX + 90) && L.y <= 100 - 30 && L.y + L.alto >= 100 + 230 + 60);
});
