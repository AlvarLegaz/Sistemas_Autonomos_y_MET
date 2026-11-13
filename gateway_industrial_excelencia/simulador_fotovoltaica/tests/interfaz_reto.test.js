// Modo Diagnóstico (lógica pura): clave del reto, qué se oculta, medidas clave, corrección parcial con distractores, nota con desglose, maniobras peligrosas y envío al aula.
const test = require('node:test');
const assert = require('node:assert/strict');
const layout = require('../js/layout.js');
const R = require('../js/interfaz/reto_fv.js');
const P = require('../js/interfaz/pagina_simple.js');
const E = require('../js/scada2d/esquema_fv.js');
const A = require('../js/interfaz/ayuda_fv.js');
const PD = require('../js/interfaz/panel_diagnostico.js');
const K = require('../js/interfaz/cuaderno_fv.js');
const catalogo = require('../js/averias/catalogo.js');
const { crearSimulacion } = require('../js/modelo/simulacion.js');

const sim = (o = {}) => { const s = crearSimulacion(Object.assign({ semilla: 1, diaAnio: 172, horaSolar: 12, nubosidad: 0 }, o)); for (let k = 0; k < 40; k++) s.paso(5); return s; };
const marcha = (s, seg = 60) => { for (let t = 0; t < seg; t += 5) s.paso(5); return s.estado; };

test('clave del reto: base64 del id de avería; una clave rara o de una avería que no existe se descarta', () => {
  for (const a of layout.AVERIAS) assert.equal(R.descodificarClave(R.codificarClave(a.id)), a.id);
  assert.equal(R.descodificarClave('RlVTSUJMRV9GMTAx'), 'FUSIBLE_F101');
  assert.equal(R.descodificarClave(' RlVTSUJMRV9GMTAx\n'), 'FUSIBLE_F101');
  for (const mala of ['', null, undefined, 42, '%%%', R.codificarClave('NO_EXISTE'), 'FUSIBLE_F101']) assert.equal(R.descodificarClave(mala), null);
});

test('respuesta del aula: reto del profesor, sin reto, o respuesta inválida', () => {
  assert.deepEqual(R.leerReto({ reto: { id: 12, clave: R.codificarClave('RED_CAIDA'), titulo: 'Reto 3', pistas: false } }), { id: 12, averia: 'RED_CAIDA', titulo: 'Reto 3', pistas: false });
  assert.equal(R.leerReto({ reto: { id: 1, clave: R.codificarClave('QB_DISPARADO') } }).pistas, true);
  for (const r of [{ reto: null }, {}, null, { reto: { id: 1, clave: 'xx' } }, { reto: 'x' }]) assert.equal(R.leerReto(r), null);
});

test('reto libre: id vacío y una avería del contrato; con el azar en los extremos no se sale de la lista', () => {
  for (const x of [0, 0.5, 0.999999, 1]) { const r = R.retoLibre(() => x); assert.equal(r.id, ''); assert.ok(layout.AVERIAS.some(a => a.id === r.averia)); assert.equal(r.pistas, true); }
  assert.equal(R.retoLibre(() => 0).averia, layout.AVERIAS[0].id);
});

test('la lista de averías de la hoja sale barajada (misma semilla, mismo orden) y con las 18', () => {
  const a = R.barajar(layout.AVERIAS, 7), b = R.barajar(layout.AVERIAS, 7), c = R.barajar(layout.AVERIAS, 8);
  assert.deepEqual(a, b); assert.notDeepEqual(a.map(x => x.id), c.map(x => x.id)); assert.notDeepEqual(a.map(x => x.id), layout.AVERIAS.map(x => x.id));
  assert.deepEqual(a.map(x => x.id).sort(), layout.AVERIAS.map(x => x.id).sort()); assert.equal(a.length, 18);
});

test('qué se oculta: en Diagnóstico, todas las ayudas que delatarían la avería; al revelar y en los demás modos, ninguna', () => {
  const d = R.ocultacion('diagnostico');
  for (const k of ['panelAverias', 'tarjetaDiagnostico', 'alarmas', 'burbujas', 'lecturas', 'graficas', 'estadoFicha', 'coloresEstado', 'sustituir']) assert.equal(d[k], true, k);
  for (const m of ['normal', 'revision']) assert.ok(Object.values(R.ocultacion(m)).every(v => v === false), m);
  assert.ok(Object.values(R.ocultacion('diagnostico', true)).every(v => v === false));
});

test('sinóptico en Diagnóstico: sin colores de alarma (salvo testigos y LED propios), sin textos que nombren la causa y sin burbujas', () => {
  const s = sim(); for (const id of ['FUSIBLE_F101', 'FALLO_AISLAMIENTO_B', 'SPD_DISPARADO_A', 'BMS_CORTE_BATERIA', 'RED_CAIDA']) s.ordenes.averias.activar(id);
  const e = marcha(s, 120);
  assert.equal(E.estadoVisual(e, 'F-101'), 'alarma'); assert.equal(E.estadoVisualOculto(e, 'F-101'), 'parado');
  for (const tag of ['INV-201', 'BAT-101', 'RED-301', 'STR-101', 'PV-101', 'LOAD-301']) assert.equal(E.estadoVisualOculto(e, tag), 'parado', tag);
  assert.equal(E.estadoVisualOculto(e, 'SPD-101'), 'alarma', 'el testigo del descargador se ve en la realidad');
  const T = E.textosEquiposOcultos(e), claro = E.textosEquipos(e);
  assert.match(claro['t-INV-201-alarma'] + claro['t-INV-201-alarma2'], /red|aislamiento/i);
  for (const [id, t] of Object.entries(T)) assert.doesNotMatch(t, /aislamiento|anti-isla|sin red|SIN RED|CORTE|fundido|BMS/i, id);
  assert.equal(T['t-INV-201-alarma'], '⚠ ALARMA'); assert.equal(T['t-BAT-101-bms'], ''); assert.equal(T['t-RED-301-estado'], 'acometida');
  assert.equal(T['t-INV-101-l1'], claro['t-INV-101-l1'], 'la pantalla propia del inversor sigue');
  assert.match(A.TEXTO_OCULTO, /midiendo/);
});

test('clics en Diagnóstico: se maniobra (abrir, cerrar, apagar, sombrear) pero no se sustituye ni se ve la curva, y el aviso no delata el estado', () => {
  const s = sim(); s.ordenes.averias.activar('FUSIBLE_F101'); const e = marcha(s, 20);
  assert.equal(P.decidirClic('QS-101', e, 'diagnostico').accion, 'abrir'); assert.equal(P.decidirClic('INV-201', e, 'diagnostico').accion, 'apagar'); assert.equal(P.decidirClic('PV-203', e, 'diagnostico').tipo, 'sombra');
  const roto = P.decidirClic('F-101', e, 'diagnostico'), sano = P.decidirClic('F-102', e, 'diagnostico');
  assert.equal(roto.tipo, 'aviso'); assert.equal(roto.texto.replace('F-101', 'F-102'), sano.texto);
  assert.equal(P.decidirClic('SPD-101', e, 'diagnostico').tipo, 'aviso'); assert.equal(P.decidirClic('RED-301', e, 'diagnostico').tipo, 'aviso');
  assert.match(P.decidirClic('STR-101', e, 'diagnostico').texto, /trazador/);
  assert.equal(P.decidirClic('F-101', e, 'revision').accion, 'rearmar');
  const t = P.textoEstado(e, true, 'diagnostico'); assert.match(t, /Diagnóstico/); assert.doesNotMatch(t, /alarma:|F-101|FV \d/);
});

test('firma de diagnóstico: las 18 averías tienen síntoma, tres pistas y explicación; sin catálogo se compone una mínima', () => {
  for (const a of layout.AVERIAS) {
    const f = R.firmaDe(a.id, catalogo);
    assert.ok(f.explicacion.length > 20, a.id); assert.equal(f.pistas.length, 3, a.id); for (const p of f.pistas) assert.ok(typeof p === 'string' && p.length > 5, a.id);
    assert.ok(Array.isArray(f.medidasClave) && Array.isArray(f.distractores), a.id);
    for (const d of f.distractores) assert.ok(layout.AVERIAS.some(x => x.id === d) && d !== a.id, `${a.id} → ${d}`);
    for (const c of f.medidasClave) { assert.ok(['multimetro', 'pinza', 'megohmetro', 'trazadorIV', 'termografia'].includes(c.instrumento), `${a.id}: ${c.instrumento}`); assert.ok(R.idsDeClave(c).length >= 1, a.id); }
  }
  const m = R.firmaDe('FUSIBLE_F101', null); assert.equal(m.pistas.length, 3); assert.deepEqual(m.medidasClave, []); assert.ok(m.explicacion);
});

test('condiciones del reto: dicen fecha, hora, cielo, batería, modo y cargas, pero nunca las sombras ni la avería', () => {
  const t = R.textoEscenario({ diaAnio: 172, horaSolar: 23, nubosidad: 0, socInicialPct: 70, esperaS: 120, modoEasun: 'BATERIA_PRIMERO', cargas: { 'LOAD-302': 500 }, sombras: { 'PV-203': 0.3 } });
  assert.equal(t, '21 jun · 23:00 solar, de noche · despejado · batería 70 % · EASun: batería primero · LOAD-302: 500 W');
  assert.doesNotMatch(t, /PV-203|sombra/); assert.match(R.textoEscenario({ horaSolar: 11, esperaS: 2400 }), /40 min/); assert.equal(R.textoEscenario(null), '');
  for (const a of layout.AVERIAS) { const x = R.textoEscenario(R.firmaDe(a.id, catalogo).escenario); assert.doesNotMatch(x, new RegExp(a.tag.replace('-', '\\-') + '(?!: \\d+ W)'), a.id); assert.doesNotMatch(x, /sombra|aver/i, a.id); }
});

test('el escenario de cada avería se aplica y la avería se manifiesta sin romper la simulación (las 18)', () => {
  for (const a of layout.AVERIAS) {
    const s = crearSimulacion({ semilla: 1 }), f = R.firmaDe(a.id, catalogo);
    if (catalogo.prepararEscenario && f.escenario) catalogo.prepararEscenario(s, f);
    assert.ok(s.ordenes.averias.activar(a.id) !== false, a.id); for (let t = 0; t < 120; t += 5) s.paso(5);
    assert.ok(Number.isFinite(s.estado.campos.A.p) && Number.isFinite(s.estado.campos.B.p), a.id);
    if (f.escenario) assert.ok(Math.abs(s.estado.reloj.horaSolar - f.escenario.horaSolar) < 0.2, a.id);
  }
});

test('medidas clave: exacta (sin importar el orden de las puntas), equivalente (mismo equipo), y no cuentan las de otro modo, otro instrumento, peligrosas o no válidas', () => {
  const clave = { instrumento: 'multimetro', modo: 'resistencia', puntos: ['F-101.1', 'F-101.2'], texto: 'OL en el fusible' };
  const m = (o) => Object.assign({ instrumento: 'multimetro', modo: 'OHM', puntos: ['F-101.2', 'F-101.1'], valida: true }, o);
  assert.equal(R.claveHecha(clave, [m()]), 'exacta');
  assert.equal(R.claveHecha(clave, [m({ modo: 'VDC' })]), '');
  assert.equal(R.claveHecha(clave, [m({ peligro: true })]), ''); assert.equal(R.claveHecha(clave, [m({ valida: false })]), '');
  assert.equal(R.claveHecha(clave, [m({ instrumento: 'pinza' })]), ''); assert.equal(R.claveHecha(clave, [m({ puntos: ['F-102.1', 'F-102.2'] })]), '');
  assert.equal(R.claveHecha({ instrumento: 'megohmetro', tag: 'STR-201.+' }, [{ instrumento: 'megohmetro', puntos: ['STR-201.-'] }]), 'equivalente');
  assert.equal(R.claveHecha({ instrumento: 'pinza', conductor: 'STR-101.+' }, [{ instrumento: 'pinza', modo: 'DC', puntos: ['STR-101.+'] }]), 'exacta');
  assert.equal(R.claveHecha({ instrumento: 'termografia', tag: 'STR-202.mc4.2' }, [{ instrumento: 'termografia', puntos: ['STR-202.mc4.3'] }]), 'equivalente');
  assert.equal(R.claveHecha({ instrumento: 'termografia', tag: 'STR-202.mc4.2' }, [{ instrumento: 'termografia', puntos: ['PV-205.s1'] }]), '');
  assert.equal(R.claveHecha({ instrumento: 'trazadorIV', tag: 'STR-102' }, [{ instrumento: 'trazadorIV', puntos: ['STR-102'] }]), 'exacta');
  const rep = R.medidasClaveHechas([clave, { instrumento: 'pinza', conductor: 'STR-101.+' }], [m()]);
  assert.deepEqual(rep.map(x => x.hecha), [true, false]); assert.equal(rep[0].texto, 'OL en el fusible'); assert.match(rep[1].texto, /pinza: STR-101\.\+/);
});

test('medidas clave con el cuaderno de verdad: el alumno que mide el fusible y la corriente de la cadena las tiene hechas', () => {
  const f = R.firmaDe('FUSIBLE_F101', catalogo), c = K.crearCuaderno();
  if (!f.medidasClave.length) return;      // el catálogo todavía no trae la firma
  assert.ok(R.medidasClaveHechas(f.medidasClave, c.lista()).every(x => !x.hecha));
  c.anadir({ instrumento: 'multimetro', modo: 'VDC', puntos: ['F-101.1', 'F-101.2'], texto: '21 V', valor: 21 });
  c.anadir({ instrumento: 'pinza', modo: 'DC', puntos: ['STR-101.+'], texto: '0 A', valor: 0 });
  const hechas = R.medidasClaveHechas(f.medidasClave, c.lista()).filter(x => x.hecha).length;
  assert.ok(hechas >= 2 && hechas < f.medidasClave.length);
});

test('corrección: acierto total, parcial por el elemento, parcial por una avería distractora, y nulo', () => {
  const d = ['CADENA_ABIERTA_A1', 'SUCIEDAD_ALTA_A'];
  assert.deepEqual(R.corregir({ real: 'FUSIBLE_F101', averiaRespuesta: 'FUSIBLE_F101', elementoRespuesta: 'F-101', distractores: d }), { acierto: 1, averiaOk: true, elementoOk: true, distractor: false });
  assert.equal(R.corregir({ real: 'FUSIBLE_F101', averiaRespuesta: 'FUSIBLE_F101', elementoRespuesta: 'F-102', distractores: d }).acierto, 1, 'la avería manda; el elemento solo suma su punto');
  assert.deepEqual(R.corregir({ real: 'FUSIBLE_F101', averiaRespuesta: 'RED_CAIDA', elementoRespuesta: 'F-101', distractores: d }), { acierto: 0.5, averiaOk: false, elementoOk: true, distractor: false });
  assert.deepEqual(R.corregir({ real: 'FUSIBLE_F101', averiaRespuesta: 'CADENA_ABIERTA_A1', elementoRespuesta: 'STR-101', distractores: d }), { acierto: 0.5, averiaOk: false, elementoOk: false, distractor: true });
  assert.equal(R.corregir({ real: 'FUSIBLE_F101', averiaRespuesta: 'RED_CAIDA', elementoRespuesta: 'RED-301', distractores: d }).acierto, 0);
  assert.equal(R.corregir({ real: 'FUSIBLE_F101', averiaRespuesta: '', elementoRespuesta: '' }).acierto, 0);
  assert.equal(R.corregir({ real: 'SUCIEDAD_ALTA_A', averiaRespuesta: 'RED_CAIDA', elementoRespuesta: 'PV-105' }).elementoOk, true, 'la suciedad afecta a todo el campo A');
  assert.equal(R.corregir({ real: 'SOMBRA_PARAPETO', averiaRespuesta: 'x', elementoRespuesta: 'PV-206' }).elementoOk, true);
  for (const a of layout.AVERIAS) assert.ok(R.elementosValidos(a.id).includes(a.tag));
});

test('nota: diagnóstico perfecto = 10; cada pista, maniobra peligrosa e intento anterior resta; nunca baja de 0 ni pasa de 10', () => {
  const ok = { acierto: 1, averiaOk: true, elementoOk: true, distractor: false };
  const base = { correccion: ok, clavesHechas: 4, clavesTotal: 4, medidas: 6, pistas: 0, peligros: 0, segundos: 300, intento: 1, sintoma: 'el campo A da la mitad', reparacion: 'cambiar el fusible', evidencias: 2 };
  const n = R.calcularNota(base); assert.equal(n.nota, 10); assert.deepEqual(n.desglose.map(f => f.concepto), ['Avería', 'Elemento averiado', 'Medidas clave', 'Hoja completa', 'Tiempo']);
  assert.equal(n.desglose.reduce((t, f) => t + f.max, 0), 10, 'los máximos suman 10');
  assert.equal(R.calcularNota(Object.assign({}, base, { pistas: 2 })).nota, 8);
  assert.equal(R.calcularNota(Object.assign({}, base, { peligros: 1 })).nota, 9); assert.equal(R.calcularNota(Object.assign({}, base, { peligros: 5 })).nota, 8, 'las maniobras peligrosas restan como mucho 2');
  assert.equal(R.calcularNota(Object.assign({}, base, { intento: 3 })).nota, 8);
  assert.equal(R.calcularNota(Object.assign({}, base, { pistas: 9 })).nota, 7, 'como mucho tres pistas');
  const peor = R.calcularNota({ correccion: { averiaOk: false, elementoOk: false, distractor: false }, pistas: 3, peligros: 4, intento: 5, segundos: 9999 }); assert.equal(peor.nota, 0);
  for (const r of [n, peor]) assert.ok(r.nota >= 0 && r.nota <= 10 && Math.round(r.nota * 10) === r.nota * 10);
});

test('nota: sin acertar no se aprueba aunque se mida todo; el acierto parcial puntúa a medias; medidas clave, hoja y tiempo son proporcionales', () => {
  const mal = { averiaOk: false, elementoOk: false, distractor: false }, base = { clavesHechas: 4, clavesTotal: 4, segundos: 100, sintoma: 'síntoma largo', reparacion: 'reparación larga', evidencias: 1 };
  assert.equal(R.calcularNota(Object.assign({ correccion: mal }, base)).nota, 4);
  assert.equal(R.calcularNota(Object.assign({ correccion: { averiaOk: false, elementoOk: true, distractor: true } }, base)).nota, 7.5);
  assert.equal(R.calcularNota(Object.assign({ correccion: { averiaOk: false, elementoOk: false, distractor: true } }, base)).nota, 6.5);
  const ok = { averiaOk: true, elementoOk: true, distractor: false };
  assert.equal(R.calcularNota(Object.assign({}, base, { correccion: ok, clavesHechas: 2 })).nota, 8.8);
  assert.equal(R.calcularNota(Object.assign({}, base, { correccion: ok, clavesHechas: 0, sintoma: '', reparacion: '', evidencias: 0 })).nota, 4, 'acertar sin ninguna medida clave no pasa de 4');
  const sinMedir = R.calcularNota(Object.assign({}, base, { correccion: ok, clavesHechas: 0 }));
  assert.equal(sinMedir.nota, 4); assert.equal(sinMedir.desglose[sinMedir.desglose.length - 1].concepto, 'Sin medidas que lo demuestren');
  assert.equal(R.calcularNota(Object.assign({}, base, { correccion: ok, clavesHechas: 1 })).nota, 8.1, 'con una medida clave ya no hay tope');
  assert.equal(R.calcularNota(Object.assign({}, base, { correccion: ok, clavesHechas: 0, pistas: 3, intento: 2 })).nota, 3.5, 'por debajo del tope no se toca');
  assert.equal(R.calcularNota(Object.assign({}, base, { correccion: ok, segundos: 1200 })).nota, 9.5); assert.equal(R.calcularNota(Object.assign({}, base, { correccion: ok, segundos: 4000 })).nota, 9);
  assert.equal(R.calcularNota({ correccion: ok, clavesTotal: 0, medidas: 3, segundos: 0, sintoma: 'síntoma largo', reparacion: 'reparación larga', evidencias: 1 }).nota, 10, 'sin medidas clave en el catálogo cuentan hasta tres medidas');
  const d = R.calcularNota(Object.assign({}, base, { correccion: ok, pistas: 1, peligros: 1, intento: 2 })).desglose;
  assert.deepEqual(d.slice(-3).map(f => [f.concepto, f.puntos]), [['Pistas usadas', -1], ['Maniobras peligrosas', -1], ['Intentos anteriores', -1]]);
});

test('maniobra peligrosa: abrir un seccionador de continua con carga; sin corriente, de noche o con otra protección no lo es', () => {
  const s = sim(), e = s.estado, abrir = tag => P.decidirClic(tag, s.estado, 'diagnostico');
  assert.match(R.peligroManiobra(abrir('QS-101'), e), /MANIOBRA PELIGROSA.*QS-101.*A de continua/); assert.match(R.peligroManiobra(abrir('QS-201'), e), /QS-201/);
  assert.equal(R.peligroManiobra(abrir('QF-303'), e), ''); assert.equal(R.peligroManiobra(abrir('QB-101'), e), ''); assert.equal(R.peligroManiobra(abrir('INV-201'), e), '');
  s.ordenes.inversor.encender('INV-201', false); marcha(s, 30);
  assert.equal(R.peligroManiobra(abrir('QS-201'), s.estado), '', 'con el inversor apagado no pasa corriente: se puede abrir');
  const noche = crearSimulacion({ horaSolar: 2 }); noche.paso(5); assert.equal(R.peligroManiobra(P.decidirClic('QS-101', noche.estado, 'diagnostico'), noche.estado), '');
  assert.equal(R.peligroManiobra({ tipo: 'orden', tag: 'QS-101', accion: 'cerrar' }, e), ''); assert.equal(R.peligroManiobra(null, e), '');
});

test('envío al aula: campos del contrato, acierto 0 / 0.5 / 1, nota con un decimal y cuerpo urlencoded', () => {
  const r = { csrf: 'tok+/=', reto: 12, averiaReal: 'FUSIBLE_F101', averiaRespuesta: 'CADENA_ABIERTA_A1', elementoRespuesta: 'F-101', acierto: 0.5, nota: 6.25, pistas: 2, medidas: 7, segundos: 431.6, detalle: '{"sintoma":"á & b"}' };
  const c = R.camposEnvio(r);
  assert.deepEqual(Object.keys(c), ['csrf', 'reto', 'sim', 'averia_real', 'averia_respuesta', 'elemento_respuesta', 'acierto', 'nota', 'pistas', 'medidas', 'segundos', 'detalle']);
  assert.deepEqual([c.reto, c.sim, c.acierto, c.nota, c.pistas, c.medidas, c.segundos], ['12', 'fotovoltaica', '0.5', '6.3', '2', '7', '432']);
  const cuerpo = R.codificarEnvio(r), leido = Object.fromEntries(new URLSearchParams(cuerpo));
  assert.deepEqual(leido, c); assert.match(cuerpo, /csrf=tok%2B%2F%3D/); assert.doesNotMatch(cuerpo, /[ á]/);
  const libre = R.camposEnvio({ reto: '', acierto: 1, nota: 10, pistas: 7, medidas: -3 });
  assert.deepEqual([libre.reto, libre.acierto, libre.nota, libre.pistas, libre.medidas, libre.segundos, libre.detalle], ['', '1', '10.0', '3', '0', '0', '{}']);
  assert.equal(R.camposEnvio({ acierto: 'x', nota: NaN }).acierto, '0'); assert.equal(R.camposEnvio({ nota: 99 }).nota, '10.0');
});

test('detalle del envío: JSON con síntoma, reparación, medidas marcadas, intento, peligros y título; nunca pasa de 4000 caracteres', () => {
  const d = JSON.parse(R.detalleJson({ sintoma: 'no produce', reparacion: 'cambiar', evidencias: ['12:03 · Multímetro V⎓ · F-101.1 ↔ F-101.2 · 21,6 V⎓'], intento: 2, peligros: 1, titulo: 'Reto 3' }));
  assert.deepEqual(Object.keys(d), ['sintoma', 'reparacion', 'medidas', 'intento', 'peligros', 'titulo']); assert.equal(d.medidas.length, 1); assert.equal(d.intento, 2);
  const largo = R.detalleJson({ sintoma: '"ñ\n'.repeat(3000), reparacion: 'y'.repeat(9000), evidencias: Array.from({ length: 80 }, () => '"z'.repeat(400)) });
  assert.ok(largo.length <= R.MAX_DETALLE); const p = JSON.parse(largo); assert.ok(p.sintoma.length > 0 && Array.isArray(p.medidas));
});

test('respuesta del aula al envío: guardado, 204, 400 con su error, sesión caducada, sin conexión y local: siempre un texto para el alumno', () => {
  assert.equal(PD.textoEnvio(200, { guardado: true }).ok, true);
  for (const [estado, cuerpo, patron] of [[204, null, /no es de alumno/], [400, { guardado: false, error: 'avería no válida' }, /avería no válida/], [400, null, /No se pudo guardar/], [401, null, /caducado/], [0, null, /sin conexión/], [500, null, /No se pudo guardar/], ['local', null, /local/], [200, { guardado: false }, /No se pudo guardar/]]) {
    const t = PD.textoEnvio(estado, cuerpo); assert.equal(t.ok, false, String(estado)); assert.match(t.texto, patron); assert.match(t.texto, /guardado en este equipo/);
  }
});

test('resultados de la sesión en el almacén local: los más recientes primero, como mucho 30, y un almacén roto no rompe nada', () => {
  const datos = {}, almacen = { getItem: k => (k in datos ? datos[k] : null), setItem: (k, v) => { datos[k] = v; } };
  assert.deepEqual(R.leerResultados(almacen), []);
  for (let k = 1; k <= 35; k++) assert.ok(R.guardarResultado(almacen, { nota: k, titulo: 't' + k }));
  const L = R.leerResultados(almacen); assert.equal(L.length, 30); assert.equal(L[0].nota, 35); assert.equal(L[29].nota, 6);
  datos[R.CLAVE_ALMACEN] = '{roto'; assert.deepEqual(R.leerResultados(almacen), []);
  assert.deepEqual(R.leerResultados(null), []); assert.equal(R.guardarResultado({ getItem: () => null, setItem: () => { throw new Error('lleno'); } }, {}), false);
});
