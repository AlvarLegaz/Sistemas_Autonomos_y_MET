# Sistemas_Autonomos_y_MET
Proyectos de sistemas autónomos y mantenimiento electrónico

## Proyectos

| Proyecto | Descripción |
| --- | --- |
| [Rover_Oruga_MK1](Rover_Oruga_MK1) | Rover de orugas didáctico controlado por radio (Flysky i6 + receptor FS-IA6) con driver L298N. Incluye el firmware de telemetría para ESP32-CAM (streaming MJPEG, GPS, IMU MPU9250, BMP280 y servidor web de configuración) y un detector de pelota por color con OpenCV sobre el vídeo del rover. |
| [Rover_Diferencial_MK2](Rover_Diferencial_MK2) | Rover diferencial autónomo sobre Raspberry Pi (L298N, IMU por I2C, GPS por UART y cámara), con interfaz web para manejarlo desde el PC o el móvil. Contiene el software del rover (`rover/`) y su gemelo digital (`rover_sim/`), que simula el mundo para desarrollar sin hardware. |
| [Rover_Submarino_MK3](Rover_Submarino_MK3) | Simulador de un submarino con cuatro propulsores, sensor de profundidad y ecosonda. Mantiene la profundidad y el cabeceo con dos PID, se maneja desde el navegador o con mando, y trae un modo de entrenamiento con aros, corriente y visor 3D (Three.js). |
| [Sistema-Control-Industrial](Sistema-Control-Industrial) | SCADA para una planta simulada de 3 depósitos interconectados: interfaz en tiempo real con PySide6, servidor Flask, comunicaciones REST, MQTT y serie, y control manual y automático. |
| [gateway_industrial_excelencia](gateway_industrial_excelencia) | Pasarela de E/S industrial sobre Raspberry Pi: runtime cíclico (tick de 125 µs y escaneo de 100 ms), PWM por software, entradas y salidas digitales con PCF8574, entradas analógicas con MCP3008 y publicación de entradas/salidas por MQTT. |

## Licencia y copyright

© 2026 Álvar Legaz Aparicio. **Todos los derechos reservados.** No se concede ninguna licencia: queda prohibida la copia, distribución, publicación, alojamiento para terceros, modificación y uso comercial sin autorización previa y por escrito del autor. El material de terceros (three.js, hojas de datos de fabricantes, nombre y logo del CIFP Politécnico Cartagena, Armfield PCT23) queda excluido y pertenece a sus titulares. Detalle completo en [LICENSE](LICENSE).
