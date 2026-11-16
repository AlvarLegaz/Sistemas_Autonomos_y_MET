# Interfaz MQTT del gateway PCT23 (para hacer otro SCADA)

Todo lo que necesita un cliente nuevo para leer la planta y mandarle órdenes **sin tocar el código del gateway**. El sinóptico actual (`pct23.html` + `servidor_web.py`) es un cliente más de esta misma interfaz, y sirve de ejemplo.

Fuentes: `gateway_main_app.py` (MQTT), `runtime.py` (E/S y seguridad), `pct23.html` (tabla `MAPA`), `deploy/instalar.sh` (servicios).

---

## 1. Arquitectura

```
 planta PCT23 ── I2C (PCF8574) + SPI (MCP3008) ── Raspberry Pi
                                                   ├─ gateway-io   (gateway_main_app.py + runtime.py)  ──┐
                                                   ├─ mosquitto    (broker MQTT, puerto 1883)  <──────────┤ MQTT
                                                   └─ gateway-web  (servidor_web.py, Flask, puerto 8080) ─┘
 tu SCADA  ──────────── MQTT ──────────────────────────────────────────────┘
```

- El gateway **lee la planta cada 100 ms y publica su estado completo** en un solo topic.
- El gateway **escucha un solo topic de órdenes** y aplica solo las claves que lleguen.
- Toda la lógica de seguridad vive en el gateway (ver sección 6): se aplica venga la orden de donde venga.

## 2. Conexión

| Dato | Valor |
|---|---|
| Raspberry | `192.168.99.11` (usuario SSH `admin`), nombre `RPI-GEMELO-PCT32.local` |
| Broker MQTT | Mosquitto en la propia Raspberry, **puerto 1883** (`192.168.99.11:1883` desde la red) |
| Autenticación | Ninguna: `allow_anonymous true` (`deploy/mosquitto-gateway.conf`). Solo para red local de pruebas. Para exigir usuario hay que crear un `password_file` y quitar `allow_anonymous` |
| TLS | No |
| Versión de paho | `paho-mqtt >= 2.0` (`CallbackAPIVersion.VERSION2`). Vale cualquier cliente MQTT 3.1.1 |
| Client IDs ya usados | `pct_23_gateway` (gateway) y `pct_23_web` (servidor web). **Usa otro** (por ejemplo `pct_23_scada_nuevo`): dos clientes con el mismo ID se expulsan entre sí |
| Interfaz web actual | `http://192.168.99.11:8080/pct23` (sinóptico) y `/` (canales en bruto) |

Los dos servicios de la Raspberry se conectan al broker en `127.0.0.1:1883` (variable `BROKER` de `instalar.sh`). El valor por defecto del código, `192.168.99.53:1883`, solo se usa si se lanzan a mano sin argumentos.

## 3. Topics

| Topic | Sentido | QoS | Retain | Frecuencia | Contenido |
|---|---|---|---|---|---|
| `pct_23/entradas` | gateway → clientes | 0 | no | **cada 100 ms** | Estado completo: entradas, salidas actuales y diagnóstico (un JSON) |
| `pct_23/salidas` | clientes → gateway | 1 (el gateway se suscribe con 1) | no | cuando haga falta | Órdenes: JSON con **solo** las salidas a cambiar |

Como no hay *retain*, un cliente que se conecta tarde no recibe nada hasta el siguiente mensaje (máximo 100 ms de espera).
Si el gateway deja de publicar (ni siquiera `timestamp` avanza), el SCADA debe tratarlo como **gateway caído**. El servidor web actual lo hace a 1 s sin datos.

### 3.1 `pct_23/entradas` (lo que se lee)

JSON plano. Ejemplo real:

```json
{
  "AnalogIn1_value": 0.232, "AnalogIn2_value": 0.258, "AnalogIn3_value": 0.235, "AnalogIn4_value": 0.232,
  "AnalogIn5_value": 0.003, "AnalogIn6_value": 0.0,   "AnalogIn7_value": 0.0097, "AnalogIn8_value": 0.0,
  "DigitalIn1_value": true, "DigitalIn2_value": false, "DigitalIn3_value": false, "DigitalIn4_value": false,
  "DigitalIn5_value": false, "DigitalIn6_value": false, "DigitalIn7_value": false, "DigitalIn8_value": false,
  "DigitalOut1_value": false, "DigitalOut2_value": false, "DigitalOut3_value": false, "DigitalOut4_value": false,
  "DigitalOut5_value": false, "DigitalOut6_value": false, "DigitalOut7_value": false, "DigitalOut8_value": false,
  "TransistorOut1_value": false, "TransistorOut2_value": false, "TransistorOut3_value": false, "TransistorOut4_value": false,
  "TransistorOut5_value": false, "TransistorOut6_value": false, "TransistorOut7_value": false, "TransistorOut8_value": false,
  "PWMOut1_value": 100.0, "PWMOut2_value": 100.0, "AnalogOut1_value": 100.0,
  "running": true, "io_ok": true, "io_errors": 0, "scan_overruns": 0,
  "pwm_bombas_hz": 400.0, "retraso_potencia_ms": 0.1, "retraso_potencia_max_ms": 1.2, "escrituras_potencia_s": 300.0,
  "calefactor_bloqueado": false, "motivos_bloqueo": [], "paro_emergencia": false,
  "timestamp": 1794409849.08
}
```

Grupos de claves:

| Claves | Tipo | Significado |
|---|---|---|
| `AnalogIn1_value` … `AnalogIn8_value` | float, **voltios** (0–3,3 V) | MCP3008 por SPI, canales CH0…CH7, 10 bits, Vref 3,3 V |
| `DigitalIn1_value` … `DigitalIn8_value` | bool | PCF8574A en `0x38`. `true` = entrada activa (el significado de cada una está en 4b.3) |
| `DigitalOut1_value` … `DigitalOut8_value` | bool | Estado de los 8 relés K1…K8 (PCF8574A `0x39`). `true` = relé excitado |
| `TransistorOut1_value` … `TransistorOut8_value` | bool | Salidas a transistor OUT01…OUT08 del conector J7 (PCF8574A `0x3A`, TBD62783A). **Es la orden de encendido**, no el nivel físico (las bombas y la resistencia se modulan aparte, ver 5) |
| `PWMOut1_value`, `PWMOut2_value` | float 0–100 | Velocidad de las bombas: 1 = N1 (feed), 2 = N2 (heat) |
| `AnalogOut1_value` | float 0–100 | Potencia de la resistencia (%) |
| `running` | bool | Los hilos del gateway están vivos |
| `io_ok`, `io_errors` | bool, int | Falló o no el bus I2C/SPI; `io_errors` es acumulado |
| `scan_overruns`, `pwm_bombas_hz`, `retraso_potencia_*`, `escrituras_potencia_s` | números | Diagnóstico de tiempos del hilo de potencia (opcionales para el SCADA) |
| `calefactor_bloqueado` | bool | La resistencia no puede conducir ahora |
| `motivos_bloqueo` | lista de strings | `termostato_abierto`, `termostato_sin_lectura`, `sonda_t2_fuera_de_rango`, `paro_emergencia` |
| `paro_emergencia` | bool | Paro de emergencia enclavado |
| `timestamp` | float, s Unix | Hora del gateway al publicar |

No se publican `CurrentIn*` ni `RTDIn*` (no hay hardware). Las salidas `DigitalOut`/`TransistorOut` que se leen son **la imagen que el gateway tiene**, no una lectura del chip.

### 3.2 `pct_23/salidas` (lo que se manda)

JSON con **solo las claves a cambiar**; las demás salidas conservan su valor. Se valida todo el mensaje antes de aplicarlo.

```json
{"DigitalOut3_value": true}                          // abre SOL1
{"TransistorOut8_value": true, "PWMOut1_value": 80}  // enciende N1 al 80 %
{"TransistorOut3_value": true, "AnalogOut1_value": 60}  // resistencia al 60 %
{"paro_emergencia": true}                            // paro de emergencia (QoS 1)
{"paro_emergencia": false}                           // rearmar (no enciende nada)
```

- Salidas digitales (`DigitalOut*`, `TransistorOut*`): `true`/`false`; también valen `1`/`0` y `"on"`/`"true"`.
- `PWMOut*`, `AnalogOut1`: número 0–100 (se recorta).
- Una clave desconocida se ignora y queda anotada en el log del gateway. Un JSON que no sea un objeto se descarta.
- **El gateway no responde a las órdenes.** Para saber si se aplicaron (o si las rechazó la seguridad) hay que mirar el siguiente `pct_23/entradas`.

## 4. Variables de la planta (nombres amigables)

Desde esta versión el gateway publica en `pct_23/entradas`, **además** de los canales en bruto, los nombres de la planta con unidades de ingeniería (`senales.py`), y acepta órdenes en `pct_23/salidas` con esos mismos nombres. Los canales en bruto (`AnalogIn1_value`...) siguen funcionando.

| Variable | Tipo | Función | Qué es | Unidad / valores | Canal en bruto |
|---|---|---|---|---|---|
| `T1` | analógica | sensor | Temperatura salida del tubo de residencia | °C | `AnalogIn1_value` (V × 100) |
| `T2` | analógica | sensor | Temperatura agua caliente (heat unit) | °C | `AnalogIn2_value` |
| `T3` | analógica | sensor | Temperatura producto final | °C | `AnalogIn3_value` |
| `T4` | analógica | sensor | Temperatura salida del calentamiento | °C | `AnalogIn4_value` |
| `F1` | analógica | sensor | Caudal del producto | ml/min | `AnalogIn7_value` (V / 3,3 × 1500) |
| `L1` | analógica | sensor | Nivel tanque A (**sin confirmar**) | mm | `AnalogIn5_value` (V / 3,3 × 250) |
| `TERM` | digital | sensor | Termostato heat unit | `true` = cerrado (bien), `false` = sobretemperatura | `DigitalIn1_value` |
| `HLC` | digital | sensor | Nivel alto heat unit | `true` = nivel alto | `DigitalIn2_value` |
| `HL` | digital | sensor | Nivel alto tanque B | `true` = nivel alto | `DigitalIn3_value` |
| `LL` | digital | sensor | Nivel bajo tanque B | lógica negada: `false` = no hay nivel | `DigitalIn4_value` |
| `LVLC` | digital | sensor | Nivel tanque calefactor (supuesto) | `true` = nivel alto | `DigitalIn5_value` |
| `SOL1` | digital | actuador | Electroválvula desvío de producto | `true` = abierta/activa | `DigitalOut3_value` |
| `SOL2` | digital | actuador | Electroválvula depósitos A/B | apagada = tanque A, encendida = tanque B | `DigitalOut4_value` |
| `SOL3` | digital | actuador | Electroválvula agua fría | `true` = abierta | `DigitalOut5_value` |
| `SOL4` | digital | actuador | Electroválvula ramal depósito A | `true` = abierta | `DigitalOut6_value` |
| `SOL5` | digital | actuador | Electroválvula ramal depósito B | `true` = abierta | `DigitalOut7_value` |
| `N1` | digital | actuador | Bomba feed unit: marcha/paro | `true` = marcha | `TransistorOut8_value` |
| `N2` | digital | actuador | Bomba heat unit: marcha/paro | `true` = marcha | `TransistorOut7_value` |
| `RES` | digital | actuador | Resistencia: marcha/paro (hay que renovarla cada ≤ 5 s) | `true` = calentar | `TransistorOut3_value` |
| `N1_sentido`, `N2_sentido` | digital | actuador | Sentido de giro de las bombas | solo `false` (adelante); `true` se rechaza | `TransistorOut6_value`, `TransistorOut5_value` |
| `N1_pct` | analógica | actuador | Velocidad de N1 (PWM) | 0–100 % (mínimo 50 % si está en marcha) | `PWMOut1_value` |
| `N2_pct` | analógica | actuador | Velocidad de N2 (PWM) | 0–100 % (mínimo 50 % si está en marcha) | `PWMOut2_value` |
| `RES_pct` | analógica | actuador | Potencia de la resistencia (ráfagas) | 0–100 % | `AnalogOut1_value` |

Todas se leen en `pct_23/entradas`. Las de tipo **actuador** además se ordenan en `pct_23/salidas`; las de tipo **sensor** son solo de lectura. El paro de emergencia es aparte: `{"paro_emergencia": true|false}`.

Ejemplo de orden con nombres amigables: `{"SOL1": true, "N1": true, "N1_pct": 80}`.

---

## 4b. Asignación de canales en bruto (referencia detallada)

Es la tabla `MAPA` de `pct23.html`. Úsala tal cual.

### 4b.1 Salidas

| Elemento | Canal | Hardware |
|---|---|---|
| SOL1 · desvío de producto | `DigitalOut3_value` | relé K3 |
| SOL2 · depósitos A/B | `DigitalOut4_value` | relé K4. **Lógica a la inversa**: apagado = alimenta el tanque A; encendido = tanque B |
| SOL3 · agua fría | `DigitalOut5_value` | relé K5 |
| SOL4 · ramal depósito A | `DigitalOut6_value` | relé K6 |
| SOL5 · ramal depósito B | `DigitalOut7_value` | relé K7 |
| Bomba N1 (feed unit) encendido / velocidad | `TransistorOut8_value` / `PWMOut1_value` | J7 OUT08 |
| Bomba N2 (heat unit) encendido / velocidad | `TransistorOut7_value` / `PWMOut2_value` | J7 OUT07 |
| Sentido N1 / N2 | `TransistorOut6_value` / `TransistorOut5_value` | J7 OUT06 / OUT05. **Fijo hacia delante, ver 6.3** |
| Resistencia (calefactor) encendido / potencia | `TransistorOut3_value` / `AnalogOut1_value` | J7 OUT03 (pin 4, bit P2 del PCF `0x3A`), 230 V |
| `DigitalOut1/2/8`, `TransistorOut1/2/4` | libres | sin uso en la maqueta |

### 4b.2 Entradas analógicas (voltios → magnitud)

| Señal | Canal | Conversión |
|---|---|---|
| T1 salida del tubo de residencia | `AnalogIn1_value` | `°C = V × 100` (sonda 10 mV/°C, 1,5 V = 150 °C) |
| T2 agua caliente (heat unit) | `AnalogIn2_value` | `°C = V × 100` |
| T3 producto final | `AnalogIn3_value` | `°C = V × 100` |
| T4 salida del calentamiento | `AnalogIn4_value` | `°C = V × 100` |
| T5 | `AnalogIn5_value` | `°C = V × 100` (según la lista de señales de la maqueta; sin usar en el sinóptico) |
| F1 caudal | `AnalogIn7_value` | `ml/min = V / 3,3 × 1500` (calibrado con una prueba de vaciado: factor 1,006) |
| L1 nivel del tanque A | `AnalogIn5_value` (**sin resolver**) | `mm = V / 3,3 × 250`. En la prueba **no midió nivel** (osciló 0–11 mm con 101 mm de agua); falta identificar el canal correcto. No te fíes de L1 |

### 4b.3 Entradas digitales

| Señal | Canal | Significado / alarma |
|---|---|---|
| TERM · termostato de la heat unit (D1) | `DigitalIn1_value` | `true` = cerrado (bien); `false` = **sobretemperatura (el termostato salta a 70 °C)** |
| HLC · nivel alto heat unit (D2) | `DigitalIn2_value` | `true` = nivel alto |
| HL · nivel alto tanque B (D3) | `DigitalIn3_value` | `true` = nivel alto |
| LL · nivel bajo tanque B (D4) | `DigitalIn4_value` | **lógica negada**: `false` = no hay nivel (alarma) |
| LVLC · nivel tanque calefactor (D5) | `DigitalIn5_value` | `true` = nivel alto (asignación supuesta) |

### 4b.4 Datos físicos útiles

- Depósitos cilíndricos: Ø155 mm, 285 mm de alto → **18,87 ml por mm**; capacidad 5000 ml en el modelo (5378 ml geométricos).
- La heat unit se dibuja al 70 % de un depósito (3500 ml); no hay sensor de su volumen.
- Los datos reales de calentamiento a 17 cm de agua en la heat unit: sube ≈ 0,1 °C/s con la resistencia al 100 %, el termostato salta a **70 °C** y T2 sigue subiendo hasta ≈ 77 °C después de cortar; el enfriamiento es muy lento (tau ≈ 8400 s).

## 5. Cómo se generan las señales físicas (importante para el SCADA)

- **Resistencia**: control por ráfagas de 50 ciclos de red (1 s). `AnalogOut1_value` = % de ciclos; con `TransistorOut3_value = true` y 60 % conducen 30 de cada 50 ciclos.
- **Bombas**: PWM por flancos a **400 Hz** desde un hilo propio (`PWM_BOMBAS_HZ`). El `TransistorOut7/8` es la orden de marcha y el `PWMOut2/1` el ciclo de trabajo.
- Por eso el valor `true` de `TransistorOutN_value` no es el nivel físico instantáneo del pin, sino que la salida está ordenada.

## 6. Reglas de seguridad que el SCADA debe respetar

El gateway las aplica siempre; un SCADA nuevo tiene que conocerlas porque **rechazan órdenes sin avisar**.

### 6.1 Resistencia (calefactor)

1. **Enclavamiento del termostato.** La resistencia solo conduce si `DigitalIn1_value` es `true`. Con el termostato abierto se borra la orden de calentar, se rechazan las nuevas y **no se rearma sola**: hay que enfriar y volver a encender a mano.
2. **Sonda T2** fuera de 0,05–1,45 V (5–145 °C), es decir, desconectada, en corto o rota: no se calienta (`sonda_t2_fuera_de_rango`).
3. Sin lectura válida de entradas o con `io_ok = false`: la resistencia no conduce (`termostato_sin_lectura`), pero la orden no se borra.
4. **La orden de calentar caduca a los 15 s** si nadie la renueva (`CADUCIDAD_CALEFACTOR_S`). **Tu SCADA tiene que reenviar `{"TransistorOut3_value": true}` cada ≤ 5 s** mientras quiera calentar (el servidor web actual lo hace cada 5 s). Si cae el SCADA, el broker o la red, la resistencia se apaga sola.
5. Motivo visible: `calefactor_bloqueado` y `motivos_bloqueo` en `pct_23/entradas`.

### 6.2 Paro de emergencia

- `{"paro_emergencia": true}` (QoS 1): apaga **todas** las salidas digitales y de transistor y rechaza cualquier orden de encendido hasta rearmar.
- `{"paro_emergencia": false}`: rearma; **no enciende nada**, hay que volver a ordenarlo todo.
- Está enclavado en el gateway: sobrevive a que el SCADA se cierre. Se pierde si se reinicia `gateway-io`.
- Tu SCADA debe repetir la orden hasta ver `paro_emergencia: true` en las entradas (el servidor web actual la reintenta cada 5 s).

### 6.3 Bombas N1 y N2 (protección del driver)

El driver L298P de las bombas se quemó (1,8 A por bomba a 24 V). Por eso:

- **Sentido solo hacia delante**: cualquier orden de sentido inverso (`TransistorOut5/6_value = true`) se rechaza.
- No se cambia el sentido con la bomba girando ni en los 1,5 s posteriores a pararla.
- Con la bomba en marcha el PWM **no baja del 50 %**: una consigna entre 0 y 50 se sube a 50. `0` deja el motor sin tensión.
- Al encender, la bomba va al 100 % durante 0,3 s (despega el rotor) y luego baja a su consigna.
- Al apagarla (parada normal) el PWM baja a 50 % en 1 s y luego se corta. El paro de emergencia corta en seco.
- **Recomendación: no uses el valor 1 de sentido; deja esos canales sin tocar.**

### 6.4 Resumen de qué se rechaza

| Orden | Resultado |
|---|---|
| Encender cualquier salida en paro de emergencia | rechazada |
| `TransistorOut3_value: true` con termostato abierto, sonda T2 mala o paro | rechazada (y se borra la orden anterior) |
| `TransistorOut5/6_value: true` (sentido inverso) | rechazada |
| Cambiar el sentido con la bomba girando o recién parada | rechazada |
| `PWMOut1/2_value` entre 0 y 50 | se sube a 50 |

## 7. Probar sin SCADA

Desde cualquier PC de la red con `mosquitto-clients`:

```bash
# Ver el estado (JSON cada 100 ms)
mosquitto_sub -h 192.168.99.11 -t pct_23/entradas

# Abrir SOL1
mosquitto_pub -h 192.168.99.11 -t pct_23/salidas -q 1 -m '{"SOL1": true}'

# Paro de emergencia y rearme
mosquitto_pub -h 192.168.99.11 -t pct_23/salidas -q 1 -m '{"paro_emergencia": true}'
mosquitto_pub -h 192.168.99.11 -t pct_23/salidas -q 1 -m '{"paro_emergencia": false}'
```

Cuidado: son órdenes reales sobre la maqueta. No enciendas bombas en seco ni la resistencia sin agua cubriéndola.

Ejemplo mínimo en Python (paho-mqtt 2.x):

```python
import json, paho.mqtt.client as mqtt

def al_mensaje(c, u, msg):
    d = json.loads(msg.payload)
    print("T2 = %.1f °C" % (d["AnalogIn2_value"] * 100), "| termostato cerrado:", d["DigitalIn1_value"])

c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="pct_23_scada_nuevo")
c.on_connect = lambda c, u, f, rc, p: c.subscribe("pct_23/entradas")
c.on_message = al_mensaje
c.connect("192.168.99.11", 1883)
c.loop_forever()
```

## 8. API HTTP del servidor web actual (opcional)

Si el SCADA nuevo prefiere no hablar MQTT directamente, `servidor_web.py` (puerto 8080) ofrece:

| Ruta | Método | Función |
|---|---|---|
| `/api/estado` | GET | Último `pct_23/entradas` + `broker`, `gateway`, `control`, `emergencia_pedida` |
| `/api/eventos` | GET (SSE) | El mismo estado en directo |
| `/api/salidas` | POST JSON | Reenvía el JSON a `pct_23/salidas` y renueva la orden de calentar cada 5 s |
| `/api/emergencia` | POST `{"activo": true/false}` | Paro de emergencia, reintentado hasta confirmarse |
| `/api/control` | POST | Control automático de T1 por cascada (corre en el servidor, no en el navegador): `activo`, `consigna_t1` (20–80 °C), `t2_max` (30–65 °C), `histeresis` (0,5–10 °C), `velocidad_n1` (50–100 %) |

Si el SCADA nuevo se conecta directo a MQTT, **no uses a la vez el control automático del servidor web**: los dos mandarían a las mismas salidas.

## 9. Despliegue

### 9.1 Raspberry (ya desplegada)

```bash
cd ~/Sistemas_Autonomos_y_MET/gateway_industrial_excelencia
git pull
sudo bash deploy/instalar.sh          # idempotente; BROKER=127.0.0.1:1883 por defecto
```

`instalar.sh` hace:

1. Instala `mosquitto`, `mosquitto-clients`, `python3-venv`, `i2c-tools`, `python3-smbus2/spidev/gpiozero/flask/paho-mqtt`.
2. Activa I2C y SPI (reinicio si no estaban) y añade al usuario a los grupos `i2c`, `spi`, `gpio`.
3. Instala `deploy/mosquitto-gateway.conf` en `/etc/mosquitto/conf.d/gateway.conf` y reinicia Mosquitto.
4. Crea el venv con `requirements.txt` (`paho-mqtt>=2.0`, `flask>=3.0`, `smbus2`, `spidev`, `gpiozero`).
5. Crea y activa los servicios `gateway-io` y `gateway-web`:

| Servicio | Orden |
|---|---|
| `gateway-io` | `venv/bin/python gateway_main_app.py 127.0.0.1:1883` |
| `gateway-web` | `venv/bin/python servidor_web.py 127.0.0.1:1883` |

Tras cambiar código Python: `sudo systemctl restart gateway-io gateway-web`. Para cambios solo de HTML/JS basta un `git pull`.
Comprobar: `systemctl is-active mosquitto gateway-io gateway-web` y `curl http://192.168.99.11:8080/api/estado`.

### 9.2 Pantalla táctil de la Raspberry (kiosco)

Chromium a pantalla completa en `http://localhost:8080/pct23`, lanzado por `~/.config/labwc/autostart` y `~/kiosco_pct23.sh` (copias en `deploy/kiosco/`). Si el SCADA nuevo debe verse en esa pantalla, cambia la `URL` de ese script.

### 9.3 Sin hardware

`python3 gateway_main_app.py 127.0.0.1:1883 --simular` arranca el gateway con E/S simulada en un PC (necesita un Mosquitto local).

## 10. Pruebas del repositorio

Desde `gateway_industrial_excelencia` (sin hardware): `python -m unittest test_seguridad_calefactor test_proteccion_bombas test_pwm_bombas test_pi_emulada test_control_t1 test_servidor_control`.

## 11. Pendiente / dudas conocidas

- **L1 (nivel del tanque A)** sin canal fiable (ver 4b.2).
- El MCP4728 (`0x60`) no responde: las `AnalogOut` no tienen hardware propio (solo se usa `AnalogOut1` por software para la potencia).
- `DigitalIn5` (nivel del tanque calefactor) está supuesto.
- El driver de las bombas debe sustituirse por uno de más corriente (por ejemplo Pololu G2 24v13 o Cytron MD10C); mientras tanto, las protecciones por software de 6.3 no sustituyen a un driver en buen estado.
- No hay autenticación MQTT ni TLS: no exponer el broker fuera de la red local.
