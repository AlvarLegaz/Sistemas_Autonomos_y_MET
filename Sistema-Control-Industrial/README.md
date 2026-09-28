

# Sistema-Control-Industrial: 

## Descripción

Este proyecto implementa un sistema completo de **control y supervisión (SCADA)** para una planta de **3 depósitos interconectados**.

Incluye:

* Control/Simulación de planta industrial
* Comunicación industrial (REST, MQTT, Serial)
* Interfaz SCADA en tiempo real
* Control manual y automático
* Arquitectura modular y escalable

---

## Arquitectura del sistema

```
        ┌──────────────┐
        │   SCADA UI   │
        │ (PySide6)    │
        └──────┬───────┘
               │
       ┌───────▼────────┐
       │  Comunicaciones│
       │ REST / MQTT /  │
       │ SERIAL         │
       └───────┬────────┘
               │
        ┌──────▼───────┐
        │   Servidor   │
        │   (Flask)    │
        └──────┬───────┘
               │
        ┌──────▼───────┐
        │   Planta     │
        │              │
        └──────────────┘
```

---

## Características principales

### SCADA (HMI)

* Visualización de 3 tanques
* Estado de válvulas y bomba
* Panel de control manual
* Modo automático
* Watchdog de comunicación
* Indicadores en tiempo real

Implementado en: `scada_window.py` 

---

### Simulación de planta (Debugeo o simulación)

* Modelo dinámico de niveles
* Flujo entre tanques
* Máquina de estados automática

📄 Implementado en: `planta.py` 

---

### Servidor (API REST)

* `GET /state` → estado de la planta
* `POST /command` → envío de comandos

📄 Implementado en: `server.py` 

---

### Sistema de comunicaciones

Arquitectura desacoplada basada en interfaz común:

📄 Interfaz base: `base.py` 

Soporta:

* REST → `rest_comm.py` 
* MQTT → `mqtt_comm.py` 
* Serial → `serial_comm.py` 

Factory dinámica:

📄 `factory.py` 

---

### Multithreading (SCADA)

Lectura de datos no bloqueante mediante worker:

📄 `worker.py` 

---

## Ejecución del proyecto

### Instalar dependencias

```bash
pip install PySide6 flask requests paho-mqtt
```

---

### Lanzar servidor (planta)

```bash
python server.py
```

Servidor disponible en:

```
http://localhost:5000
```

---

### Lanzar SCADA

```bash
python main.py
```

📄 `main.py` 

---

### Configurar conexión en SCADA

* Tipo: `rest`
* Destino: `127.0.0.1:5000`

---

## Uso

### 🔹 Modo manual

* Activar/desactivar bomba
* Abrir/cerrar válvulas

### 🔹 Modo automático

* Botón **MARCHA**
* El sistema ejecuta una secuencia:

1. Llenado T1
2. Transferencia T1 → T2
3. Transferencia T2 → T3
4. Vaciado T3
5. Repetición

---

## 🧪 Variables del sistema

| Variable         | Descripción     |
| ---------------- | --------------- |
| t1_high / t1_low | Nivel tanque 1  |
| t2_high / t2_low | Nivel tanque 2  |
| t3_high / t3_low | Nivel tanque 3  |
| v1, v2, v3       | Estado válvulas |
| bomba            | Estado bomba    |

---

## Diseño del sistema

### Principios aplicados

* Separación de responsabilidades
* Arquitectura modular
* Patrón Factory
* Programación orientada a interfaces
* Multithreading en UI

---

## Uso educativo

Este proyecto está pensado para:

* Automatización industrial
* PLC + SCADA
* Comunicaciones industriales
* Arquitectura de software industrial

---

## Mejoras futuras

* Control PID de nivel
* Historización de datos
* Alarmas avanzadas
* Autenticación SCADA
* Dockerización

---

## Autor

Proyecto educativo para enseñanza de automatización industrial.

---

## Licencia

MIT
