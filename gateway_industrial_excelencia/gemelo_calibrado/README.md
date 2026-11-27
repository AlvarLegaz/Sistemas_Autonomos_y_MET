# Gemelo digital PCT23+ calibrado con la maqueta real

Esta carpeta contiene el **ajuste del modelo térmico del gemelo digital** (`simulador_pct23`) usando una ejecución real de la maqueta. Está aparte: **el simulador por defecto no cambia** y sus 125 tests siguen pasando. El modelo ajustado se puede probar sin tocarlo.

```
gemelo_calibrado/
├── datos/            ejecución real exportada desde el sinóptico (CSV, 27/11/2026)
├── identificacion/   scripts de identificación y comparación (Node.js, sin dependencias)
│   ├── datos.js          carga el CSV y lo remuestrea a 1 s
│   ├── linea_base.js     ejecuta un simulador con las entradas reales y calcula el error
│   ├── ajustar.js        ajuste libre de 19 parámetros (Nelder-Mead)
│   ├── ajustar_fijo.js   ajuste final, con los parámetros no identificables fijados
│   ├── parametros.json   resultado del ajuste
│   └── probar_modelo.js  compara el simulador original con el modelo ajustado
└── modelo/js/        archivos del simulador con el modelo ajustado (sustituyen a los de simulador_pct23/js)
```

## Cómo reproducirlo

```bash
cd gateway_industrial_excelencia/gemelo_calibrado/identificacion
node probar_modelo.js                       # error del simulador original y del ajustado
node ajustar_fijo.js ../datos/sinoptico_pct23_2026-11-27-12-47-50.csv parametros.json   # rehace el ajuste
```

Para usar el modelo ajustado en el simulador, copia `modelo/js/` sobre `simulador_pct23/js/`. Antes de hacerlo por defecto, ten en cuenta lo explicado en [Pendiente](#pendiente).

## La ejecución usada

Son unos 39 minutos de la maqueta (`datos/sinoptico_pct23_2026-11-27-12-47-50.csv`, una fila por segundo, con algunos huecos):

| Tiempo | Qué pasa |
|---|---|
| 0 s | Resistencia al 100 %, N1 al 75 % y N2 en marcha. Producto en desvío. |
| 423 s | SOL1 se activa: el producto va a salida normal. |
| 452 s | Se apaga la resistencia. |
| 900 s | Se paran las bombas y la planta se enfría sola hasta el final. |

## Técnicas usadas

1. **Error de simulación con las entradas reales.** Al modelo se le aplican, segundo a segundo, exactamente las mismas órdenes que tuvo la maqueta: RES y su potencia, N1 y su velocidad, N2, SOL1 y SOL3. Las cinco temperaturas que predice se comparan con las medidas. El modelo nunca se "corrige" con la medida durante la simulación, por eso es una prueba exigente: un gemelo tiene que acertar solo, a partir de las mismas órdenes.
2. **Modelo de parámetros concentrados.** Cada parte de la planta es un nodo térmico de primer orden: una temperatura que se acerca a un objetivo con una constante de tiempo τ, es decir `dT/dt = (objetivo − T)/τ`. Es el mismo tipo de modelo que ya usaba el simulador, de modo que el resultado se puede integrar en él.
3. **Mínimos cuadrados con Nelder-Mead.** Se minimiza el error cuadrático medio ponderado de T1–T5. T2 pesa más porque es la que usan la seguridad y el control; T5 pesa menos. Nelder-Mead no necesita derivadas, lo que viene bien porque el modelo tiene conmutaciones (bombas, válvulas). Las constantes de tiempo se buscan en escala logarítmica, ya que pueden ir de segundos a horas. El método se reinicia 8 veces desde el mejor punto para no quedarse en un mínimo local.
4. **Identificabilidad.** En el ajuste libre (`ajustar.js`) varios parámetros terminaban en sus límites. Eso indica que esta prueba no los puede distinguir. Por ejemplo, durante el calentamiento solo se ve la pendiente inicial, que es *subida / τ*, y no cada factor por separado. Las pérdidas del depósito tampoco se pueden medir, porque en 25 minutos T2 bajó menos de 1 °C. En `ajustar_fijo.js` esos parámetros se fijan a valores físicamente razonables y se ajusta el resto.

## Resultado

Error RMSE (°C) frente a la maqueta real:

| | T1 | T2 | T3 | T4 | T5 |
|---|---|---|---|---|---|
| Simulador original | 6,8 | 10,4 | 6,2 | 8,6 | 7,3 |
| Ajuste (script, ambiente ajustado a 23,5 °C) | 0,7 | 1,1 | 0,6 | 1,0 | 0,3 |
| Modelo ajustado dentro del simulador (ambiente fijo de 22 °C) | 1,2 | 1,3 | 1,2 | 1,2 | 1,3 |

Parámetros finales: `identificacion/parametros.json` y `modelo/js/configuracion/constantes_fisicas.js`.

## Qué ha cambiado en el modelo (y por qué lo dicen los datos)

- **El agua caliente son dos nodos.** El primero es el *circuito del calefactor* (`calentadorC`, lo que llega al intercambiador). El segundo es el *depósito*, donde está T2. Se intercambian calor con una constante de unos 9 minutos con N2 en marcha, y casi nada con N2 parada. Así se explica que **T4 salga 8–10 °C más caliente que T2** y que **T2 siga subiendo después de apagar la resistencia**. Con un solo nodo ambas cosas son imposibles.
- **El calentamiento es más lento.** La pendiente inicial es de unos 0,14 °C/s con la resistencia al 100 %.
- **El producto no enfría de forma medible el agua caliente** (acoplamiento ≈ 0). La eficiencia del intercambio con N2 en marcha es ≈ 0,985.
- **T1 = ambiente + 0,954·(T4 − ambiente).** El tubo de residencia pierde poco calor; T4 responde con τ ≈ 140 s y T1 con τ ≈ 33 s.
- **T3 solo se calienta con el producto en salida normal** y llega al 27 % de la subida de T1. En desvío, el producto no pasa por T3.
- **El producto parado se enfría mucho más despacio:** τ ≈ 990 s (T4), 710 s (T1) y 450 s (T3).
- **T5 no sigue al producto caliente:** se mantuvo a temperatura ambiente durante toda la prueba.
- **El termostato simulado vigila lo más caliente:** el máximo del circuito del calefactor y T2.

## Hallazgos sobre la maqueta

- ⚠️ **T2 no es el punto más caliente.** El agua que llega al intercambiador va unos 10 °C por encima de T2. Una consigna de T2 a 60 °C puede significar unos 70 °C en el circuito, que es el límite del termostato. Hay que tenerlo en cuenta en las consignas y en la lógica de seguridad.
- **SOL1 tiene la polaridad invertida entre el simulador y la maqueta.** En el simulador SOL1 activa = desvío; en la maqueta SOL1 activa = salida normal. Los scripts hacen la traducción (`linea_base.js`).
- **Caudal:** F1 mide unos 250 ml/min con N1 al 75 %, y el simulador da unos 410 ml/min. No se ha cambiado `caudalMaxN1MlMin` porque no está confirmada la calibración de F1.
- **Ambiente:** el ajuste da 23,5 °C, mientras que el simulador usa 22 °C fijo y la maqueta arrancó hacia 20 °C.

## Pendiente

- **Validar con otra ejecución distinta:** otra potencia, otra velocidad de N1, con SOL3 (agua fría) abierta y con N2 en marcha y N1 parada. Así se comprueba que el modelo no solo reproduce esta prueba, y se pueden identificar los parámetros fijados (subida, pérdidas, efecto del caudal) y el caso "producto quieto con N2 en marcha", que no aparece en estos datos.
- **Hacerlo el modelo por defecto del simulador.** Con el modelo ajustado, 17 de los 125 tests del simulador fallan:
  - unos comprueban supuestos que los datos desmienten (T5 a media subida, el producto enfriando T2, la inercia del termostato);
  - la mayoría son de los modos automáticos y de la secuencia, cuyos lazos están afinados para una planta más rápida.

  Antes de cambiarlo hay que reajustar esos lazos o añadirlo como perfil opcional "maqueta real".
- **Revisar `DISENO.md` del simulador** al integrarlo: describe las constantes del modelo antiguo.
