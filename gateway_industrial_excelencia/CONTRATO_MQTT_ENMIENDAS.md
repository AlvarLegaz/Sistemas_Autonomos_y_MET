# Enmiendas propuestas al contrato MQTT PCT23 v2.4 preliminar

Documento de trabajo. El contrato original (`contrato-mqtt-pct23-v2.4-preliminar-2026-11-18_JSV.docx`) no se modifica aquí: estas enmiendas son **propuestas pendientes de confirmar con su autor (JSV)** y se implementan primero en el gateway de este repositorio.

## E1. Escala del caudalímetro F1 (decidido)

El contrato deja `f1_ml_min_per_v` en `null` («por calibrar»). Se toma la escala de `PCT23.md` (cableado real):

| Dato | Valor |
|---|---|
| Entrada | `AnalogIn7` (MCP3008, Vref 3,3 V), con divisor desde 5 V |
| Escala | **0–5 V en el conector = 0–1500 mL/min**, es decir **300 mL/min por voltio** |
| `config.f1_ml_min_per_v` por defecto | `300.0` (en lugar de `null`) |
| Conversión | `f1_flow_ml_min = (V_adc × 5 / 3,3) × f1_ml_min_per_v` |

La escala sigue siendo ajustable por `config` si se calibra con una medida de caudal a mano. Hasta que se calibre, el valor es el nominal del cableado, no una medida validada.

## E2. Orden `cmd/emergency_stop` (nueva)

El contrato solo entra en estado seguro por falta de latido (10 s) o pérdida del broker. El gateway actual tiene una orden de paro de emergencia (`paro_emergencia` → `Runtime.paro_emergencia`) que el contrato no recoge. Se añade una orden propia, con el mismo ciclo de orden y ack.

**Topic:** `pct23/{instance_id}/cmd/emergency_stop` (QoS 1, sin retain; sentido → PCT23). Es un comando de servicio: no aparece en `actuators`.

**Payload:**
```json
{ "id": "e001", "ts": "2026-11-24T10:15:02.120Z", "value": true, "source": "scada" }
```

**Comportamiento al aceptarla (solo `value: true`):**
1. Pone los actuadores en la tabla de estado seguro del §7 (resistencia 0, N1 y N2 paradas con velocidad de N1 a 0, SOL1 en desvío, SOL4 y SOL5 cerradas, SOL2 y SOL3 sin cambio).
2. Publica `actuators` con los valores nuevos.
3. Publica `status` con `safe_state: true` y `safe_reason: "emergency_stop"` (campo nuevo; con falta de latido valdría `"watchdog"`).
4. Levanta la alarma `emergency_stop` (`critical`, `reason: "operator_command"`).
5. Responde `ack` con `result: "accepted"`, `applied: true`.

**Salida:** igual que el estado seguro por latido: el SCADA manda `cmd/reset_safe_state` con `value: true`. Al salir, `status` pasa a `safe_state: false` y la alarma `emergency_stop` se apaga (`cleared`). Los actuadores siguen en valores seguros hasta nuevas órdenes.

**Excepciones a las comprobaciones generales (la parada debe poder ejecutarse siempre):**

| Comprobación | Con `emergency_stop` |
|---|---|
| `local_mode` | **No rechaza.** Una parada de seguridad se acepta aunque la consola esté en local |
| `safe_state` | Ya en estado seguro: se acepta y no cambia nada (`applied: true`) |
| `expired` (más de 5 s) | **No rechaza.** Aplicar una parada tardía no es peligroso |
| `duplicate` | Rechaza, como el resto |
| `invalid_value` | `value` distinto de `true` (incluido `false`): para salir se usa `reset_safe_state` |

**Gemelo digital:** propuesta, que se acepte y detenga sus actuadores simulados (el contrato no le exige estado seguro). Si el autor prefiere `not_supported`, el botón de emergencia del SCADA no valdría con gemelos y habría que ocultarlo.

**Relación con el código actual (revisado):** `emergency_stop` entra en el MISMO estado seguro que la falta de latido (tabla del §7: SOL2 y SOL3 quedan sin cambio), implementado en `contrato_pct23.py`. No usa `Runtime.paro_emergencia`, que apaga todas las salidas digitales (incluidas SOL2 y SOL3) y es el paro antiguo del gateway anterior.

**Pruebas que debe tener:**
- Se acepta con `local_mode`, con la orden vieja y en estado seguro.
- `value: false`, un id repetido y un tag mal escrito se rechazan con su motivo.
- Tras la parada, las órdenes de actuadores se rechazan con `safe_state`, y `reset_safe_state` las vuelve a aceptar.
- `status.safe_reason` y la alarma `emergency_stop` aparecen y se apagan.

## Pendiente de confirmar con el autor
- Aceptar E1 (escala de F1) y E2 (`emergency_stop`, `safe_reason` y la alarma `emergency_stop`).
- Qué hace el gemelo con `emergency_stop`.
- Resto de puntos abiertos del análisis (T5 frente a L1, `n2_speed_pct`, `heater_pct` y reloj por NTP).

## E3. Desvíos de seguridad respecto al contrato (decididos por revisión)

Del análisis del revisor independiente. Todos están marcados «DESVÍO» en `contrato_pct23.py` y se pueden desactivar:

| Desvío | Por qué | Opción |
|---|---|---|
| El latido del SCADA es **obligatorio** (el contrato lo da por opcional) | Sin él no hay estado seguro y la maqueta podría quedarse calentando | `--sin-latido` (solo pruebas) |
| Sin nivel en el calefactor se **apagan** resistencia y N2 (el contrato solo rechaza órdenes nuevas) | Una resistencia sin agua se quema | `proteccion_nivel_calefactor` |
| La orden de calentar **caduca a los 15 s** si nadie la renueva (el SCADA la repite cada 5 s) | «Hombre muerto» del control de T1 si cae su proceso mientras el latido sigue llegando | `--caducidad-calefactor 0` |
| La cuenta de los 10 s de latido empieza **al conectar** con el broker, no al arrancar | Si el broker tarda en estar, no entra en estado seguro nada más arrancar | — |
| El termostato abierto **no se rearma solo** (el contrato dice que «rearma la resistencia») | Es el enclavamiento que ya tiene `runtime.py` | — |

## Datos de la maqueta que condicionan el contrato

- `t5_c` y `l1_level_mm` van **`null`** en la tarjeta real: L1 llega por la entrada de T5 y esa entrada no mide el nivel (`PCT23.md:97`). Sin L1 no se puede evaluar el interlock del tanque A vacío (con SOL2 en «B» sí, con el flotador LL).
- `lvl_heat_unit` sale de `DigitalIn5`, que es un **supuesto** (`PCT23.md:29`): conviene confirmarlo antes de fiarse de la protección por nivel del calefactor.
- La resistencia se regula por ráfagas de 50 ciclos: el valor aplicado (`ack.applied`) sale en **pasos del 2 %** y con redondeo a par (45 % → 44 %, 1 % → 0 %).
- Las bombas por debajo del 50 % de PWM suben al 50 % (`applied` lo dice), así que `n1_speed_low` nunca saltará en la tarjeta.
- El contrato supone un reloj con hora real. De momento la planta usa una **hora propia** (`--reloj autonomo`) y el SCADA se ajusta a ella; con NTP se pasa a `--reloj sistema`.

## E4. Hora de la planta: servidor de tiempo propio

El contrato supone un reloj con hora real (NTP) y la Raspberry no tiene RTC. Decisión del usuario: un **módulo de tiempo** genera la hora y la maqueta se la pide **siempre al arrancar** y después cada X segundos.

- `modulo_tiempo.py servidor` es un servidor SNTP (RFC 4330, UDP 123, estrato 1) con hora propia (parte de la del equipo o de `--hora-inicial`). En la Pi corre como servicio `pct23-tiempo` (puerto 123 con `CAP_NET_BIND_SERVICE`), arrancado antes que el gateway y el SCADA.
- **Gateway** (`--reloj servidor`, por defecto): `RelojSincronizado` consulta al arrancar (hasta 10 s de espera, y sigue intentándolo en segundo plano si no lo logra) y cada `--periodo-hora` s (60). El reloj avanza con `time.monotonic()`, así que un salto de la hora del equipo no le afecta.
- **SCADA** (`servidor_web.py`): usa el mismo servidor de tiempo. Si está sincronizado, las órdenes salen con esa hora y ya no hace falta estimarla con `sensors`. Si no, estima el desfase con el `ts` de `sensors` (reloj monotónico; se descarta lo anterior si la planta cambia de hora).
- **`status.time_sync`** (ampliación nuestra): `{"synced": bool, "server": "host:puerto"}`. Solo lleva valores estables para que `status` no se republique en cada ciclo.
- Una parada de emergencia se acepta con cualquier hora, así que el reloj no puede impedirla.
- Para un servidor de tiempo en otra máquina basta cambiar `--servidor-hora` (o `PCT23_SERVIDOR_HORA`).
