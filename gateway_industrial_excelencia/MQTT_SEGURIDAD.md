# Seguridad del MQTT de la maqueta PCT23

Cómo queda protegido el broker para el contrato MQTT PCT23 v2.4. Archivos: `deploy/mosquitto-gateway.conf`, `deploy/mosquitto_acl.conf`, `deploy/crear_usuarios_mqtt.sh` y `deploy/generar_certificado_mqtt.sh`. Lo que se ha supuesto va marcado «SUPUESTO».

## 1. ¿Hace falta un CRC o un hash por mensaje?

**No, en esta versión.** Son dos problemas distintos:

- **Que el mensaje llegue sin corromperse.** MQTT va sobre TCP, que ya comprueba cada segmento con su suma de verificación y reenvía lo dañado. Un CRC propio no añade nada. Un mensaje roto no llega: o llega entero, o no llega (en ese caso, el QoS 1 de las órdenes lo reenvía).
- **Que nadie lo falsifique, lo lea ni lo repita.** Eso no lo da TCP. Se resuelve con las capas de abajo: usuario y permisos, TLS, y el `id` único con la caducidad de 5 s del contrato.

## 2. Qué cubre cada capa

| Capa | Qué evita | Dónde está | Estado |
|---|---|---|---|
| **Usuario y contraseña** | Que entre un cliente desconocido (antes el broker aceptaba conexiones anónimas) | `allow_anonymous false` + `pct23_passwd` | Activa |
| **ACL por usuario** | Que un cliente publique o lea lo que no le toca (por ejemplo, que el panel de solo lectura mande un `heater_pct`, o que el SCADA falsee un `ack`) | `mosquitto_acl.conf` | Activa |
| **TLS** | Que alguien en la red lea o altere el tráfico, y que un broker falso se haga pasar por el real | Listener 8883 | Preparado, **desactivado**: el contrato dice «sin TLS en la red del laboratorio» y que se podrá activar sin cambiar nada |
| **`id` único + caducidad de 5 s** (contrato §6.2) | Que se repita una orden antigua capturada (`duplicate`, `expired`) | La tarjeta | Depende de que la hora de la planta sea fiable. Con una hora desajustada, o todas las órdenes caducan, o una vieja parece reciente |
| **Latido del SCADA** (contrato §7) | Que la maqueta siga calentando si cae el SCADA o el broker | La tarjeta | Se recomienda obligatorio en la maqueta real |

Limitaciones que conviene conocer:
- Sin TLS, la contraseña MQTT viaja en claro por la red del laboratorio (MQTT 3.1.1 la envía en el CONNECT). Quien capture tráfico la ve. Por eso se usan contraseñas distintas por cliente y largas, y se activa TLS en cuanto la red deje de ser de confianza.
- Las ACL de Mosquitto se evalúan en el broker: protegen contra clientes autorizados que se portan mal, no contra quien tenga el broker.
- No hay revocación por mensaje: para echar a un cliente se borra su usuario del `password_file` y se recarga el broker.

### Firma HMAC por mensaje (opcional, fuera de esta versión)
Merecería la pena **solo** si el broker no fuera de confianza (broker central compartido o gestionado por terceros) o si hiciera falta demostrar que una orden la emitió el SCADA y no otro cliente con credenciales. Esquema propuesto, solo para `cmd/*`:

- Campo nuevo `sig` en la orden: `HMAC-SHA256(clave_compartida, id|ts|tag|value)` en hexadecimal (`value` en su JSON canónico, sin espacios).
- La tarjeta verifica la firma antes de las demás comprobaciones y rechaza con `invalid_value` (o un motivo nuevo `bad_signature`, que habría que pedir al autor del contrato).
- Una clave por instancia, guardada fuera del repositorio.
- Sigue dependiendo del `id` único y de la hora para evitar repeticiones: la firma solo prueba el origen y que no se alteró.

## 3. Topología: dónde está el broker

**Decisión actual:** ahora el broker Mosquitto, el gateway y el SCADA van **todos en la misma Raspberry Pi**; más adelante el broker y el SCADA estarán en **otra máquina** (por desarrollar). El contrato (§2) ya habla de un único broker en el servidor.

- **Fase actual (todo en la Pi):** el broker escucha **solo en `127.0.0.1:1883`**. Nada del broker queda expuesto a la red del laboratorio; el único servicio hacia la red es el SCADA web (puerto 8080). TLS no hace falta en el bucle local, pero los usuarios y las ACL siguen activos (defensa en profundidad, y para que el paso a remoto sea un cambio de dirección y no de seguridad). `deploy/instalar.sh` instala y habilita Mosquitto en la propia Pi con esta configuración.
- **Fase futura (broker y SCADA en otra máquina):** broker central con listener **8883 con TLS**; la tarjeta se conecta por red. Ver «Paso de local a remoto».

| Opción | Cómo es | Ventajas | Riesgos |
|---|---|---|---|
| **A. Broker central** | La tarjeta se conecta por red al broker del servidor | Es lo que dice el contrato; un punto único para gestionar usuarios, ACL y TLS | Un corte de red o del servidor hace que la tarjeta pierda el broker. Con el latido obligatorio, **entra en estado seguro** (para la maqueta) y no sale sola: hace falta `cmd/reset_safe_state` desde el SCADA. Cualquier fallo de red del laboratorio detiene prácticas |
| **B. Broker local + puente (`bridge`)** | La Pi tiene su Mosquitto y lo conecta con el central con un `connection` de tipo bridge (los topics `pct23/real-01/#` se espejan) | La tarjeta sigue hablando con un broker siempre disponible; un corte del central no la afecta mientras el SCADA local siga vivo | El latido sigue viniendo del SCADA: si este está al otro lado del puente, un corte del puente también pasa a estado seguro. Hay que poner ACL y usuarios en **los dos** brokers y vigilar que no haya bucles ni mensajes retained duplicados. Más configuración |

En la fase actual no hay ninguna de las dos: broker local y todo en la Pi. La configuración de usuarios y ACL de este repositorio vale para A y para B.

Ejemplo mínimo de puente (en el broker local, `/etc/mosquitto/conf.d/puente.conf`; **no se instala por defecto**):
```
connection pct23-central
address servidor.laboratorio:8883
bridge_cafile /etc/mosquitto/certs/mqtt.crt
remote_username puente-real-01
topic pct23/real-01/# both 1
```
El usuario `puente-real-01` tendría que existir en el broker central con permisos sobre `pct23/real-01/#`.

## 3 bis. Paso de local a remoto (broker y SCADA en otra máquina)

**Qué cambia:** la tarjeta (gateway) sigue en la Pi pero deja de tener el broker en su propia máquina. Todo lo demás (topics, claves, usuarios y ACL) **no cambia**.

**Orden seguro** (se puede parar y volver atrás en cualquier paso):

1. **Preparar el broker nuevo** (otra máquina) con la misma carpeta `deploy/`: `sudo bash deploy/instalar.sh` solo en lo del broker, o a mano: copiar `mosquitto-gateway.conf` y `mosquitto_acl.conf`, y `deploy/crear_usuarios_mqtt.sh` para crear los usuarios con **contraseñas nuevas** (no reutilizar las de la Pi).
2. **Certificado y puerto:** en el broker nuevo, `sudo bash deploy/generar_certificado_mqtt.sh <IP-o-nombre-del-broker>` (la IP o el nombre con el que se conectarán tiene que estar en el certificado), descomentar el listener **8883** de `mosquitto-gateway.conf`, abrir el 8883 en el cortafuegos y **cambiar el listener 1883 a `127.0.0.1`** (o comentarlo) para que solo se escuche con TLS.
3. **Probar el broker nuevo antes de mover nada**, con los ejemplos de la sección 5 (`--cafile mqtt.crt -p 8883`): anónimo rechazado, cada usuario con sus permisos.
4. **Hora:** comprobar que la Pi y el servidor tienen hora fiable (NTP; en red cerrada, un servidor NTP local). Las órdenes caducan a los 5 s y la tarjeta compara con su hora.
5. **Copiar `mqtt.crt` (solo el certificado) a la Pi** y a cada cliente, y cambiar su configuración: dirección del broker (`BROKER=ip-del-servidor:8883`), certificado como CA, usuario y contraseña en `/etc/pct23/mqtt-gateway.env`.
6. **Mover primero el SCADA** (en el servidor) y **después la tarjeta**: así, mientras se cambia la tarjeta, el SCADA ya está donde va a estar. Pasar la tarjeta con la maqueta **en reposo** (resistencia y bombas apagadas).
7. **Reiniciar `gateway-io` en la Pi** y comprobar en el broker nuevo que llega su `status` (`online`), `sensors` cada segundo y `actuators`. Mandar una orden de prueba (ejemplo 3 de la sección 5) y ver su `ack`.
8. **Apagar el broker de la Pi** (`sudo systemctl disable --now mosquitto`) cuando todo funcione, para que ningún cliente se conecte por error al antiguo. Si algo falla, bastará con volver a poner `BROKER=127.0.0.1:1883` y arrancarlo.

**Consecuencia importante:** con el broker en otra máquina, **un corte de red o del servidor deja a la tarjeta sin broker**. Con el latido obligatorio (recomendado en la maqueta real), la tarjeta entra en **estado seguro** (resistencia a 0, bombas paradas, SOL1 a desvío) y no sale sola: hace falta que vuelva el latido y que el SCADA mande `cmd/reset_safe_state`. Es lo deseado para la seguridad, pero hay que avisar de que un fallo de red detiene la práctica. La alternativa del **puente** (opción B de la sección 3, broker local en la Pi + `bridge` al central) evita que la tarjeta dependa de la red para hablar con su broker, pero el latido sigue viniendo del SCADA remoto: si se corta el puente, también entraría en estado seguro.

## 4. Clientes, usuarios y permisos

Los permisos exactos están en `deploy/mosquitto_acl.conf`. Resumen (instancia `real-01` / `twin-001`):

| Usuario | Publica | Lee |
|---|---|---|
| `gateway-real-01` (la tarjeta) | `pct23/real-01/` `sensors`, `actuators`, `status` (incluye su LWT), `alarms`, `cmd/+/ack` | `cmd/#`, `scada/heartbeat`, `params`, `config` |
| `twin-001` (gemelo) | `pct23/twin-001/` `sensors`, `actuators`, `status`, `alarms`, `model`, `cmd/+/ack` | `cmd/#`, `params` |
| `scada` (servidor web) | `pct23/+/` `cmd/+` (órdenes, **no** `ack`), `scada/heartbeat`, `params`, `config` | `pct23/#` |
| `lector` | nada | `pct23/#` |
| Plantas nuevas | Si su usuario se llama igual que su `instance_id` (`real-02`), las líneas `pattern` ya le dan los permisos de una planta | ídem |

Todo lo que no aparece está denegado. Durante la transición, las líneas `pct_23/...` del ACL permiten también el MQTT simple antiguo; hay que borrarlas cuando todos los clientes usen el contrato v2.4, y mientras tanto debe haber **una sola** vía de órdenes activa.

## 5. Instalar y probar

Instalación (en la Pi):
```bash
sudo bash deploy/instalar.sh        # crea los usuarios con contraseñas aleatorias y las muestra UNA vez: guárdalas
```
Para cambiar o añadir usuarios: `sudo bash deploy/crear_usuarios_mqtt.sh --anadir mi-usuario` y `sudo systemctl restart mosquitto`.

Pruebas con `mosquitto_pub` y `mosquitto_sub` (sustituye `CLAVE_*` por las reales; las contraseñas se pasan como argumento solo para esta prueba manual, en el servicio van en un fichero de entorno):

```bash
# 1. El acceso anónimo debe FALLAR (Connection Refused: not authorised)
mosquitto_sub -h 127.0.0.1 -t 'pct23/#' -C 1 -W 3

# 2. El SCADA ve lo que publica la planta
mosquitto_sub -h 127.0.0.1 -u scada -P CLAVE_SCADA -t 'pct23/real-01/#' -v

# 3. El SCADA manda una orden con id y hora (debe llegar a la tarjeta y esta responder en cmd/heater_pct/ack)
mosquitto_pub -h 127.0.0.1 -u scada -P CLAVE_SCADA -q 1 -t 'pct23/real-01/cmd/heater_pct' \
  -m "{\"id\":\"p001\",\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",\"value\":30,\"source\":\"prueba\"}"

# 4. Intento PROHIBIDO: el lector no puede mandar órdenes (el broker descarta el mensaje en silencio; la tarjeta no recibe nada)
mosquitto_pub -h 127.0.0.1 -u lector -P CLAVE_LECTOR -q 1 -t 'pct23/real-01/cmd/heater_pct' \
  -m '{"id":"p002","ts":"2026-11-24T10:00:00.000Z","value":100}'

# 5. Intento PROHIBIDO: el SCADA no puede falsear un ack
mosquitto_pub -h 127.0.0.1 -u scada -P CLAVE_SCADA -q 1 -t 'pct23/real-01/cmd/heater_pct/ack' \
  -m '{"id":"p003","result":"accepted","applied":100}'
```
En los casos 4 y 5, SUPUESTO (comportamiento habitual de Mosquitto 2.x con MQTT 3.1.1, sin verificar aquí): el broker descarta el PUBLISH sin avisar al cliente (con QoS 1 puede devolver igualmente el PUBACK); la denegación solo se ve en el registro del broker y porque el mensaje no llega a nadie. La comprobación correcta es suscribirse con `gateway-real-01` o con `lector` a `pct23/real-01/cmd/heater_pct` y comprobar que **no** llega.

Con TLS activado (puerto 8883), añade en cada cliente `--cafile mqtt.crt -p 8883` y conecta usando un nombre o IP que esté en el certificado:
```bash
mosquitto_sub -h 192.168.99.53 -p 8883 --cafile mqtt.crt -u scada -P CLAVE_SCADA -t 'pct23/#' -v
```

**Estado de la verificación:** la configuración, los scripts y las ACL se han revisado a mano y con un comprobador de ACL en Python contra los topics del contrato, y el script del certificado se ha ejecutado. **Las pruebas de arriba contra un Mosquitto real NO están ejecutadas** (en el equipo de desarrollo no hay Mosquitto instalado): hay que pasarlas en la Pi o en un equipo con Mosquitto antes de fiarse de este documento.
