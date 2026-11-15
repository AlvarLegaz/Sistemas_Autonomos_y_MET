# Simulador de la planta real de pasteurización HTST

Simulador web de una planta industrial de pasteurización de leche (HTST, alta temperatura y poco tiempo). Sirve para formar en **mantenimiento electrónico**: el alumno ve la planta en un SCADA 2D y en 3D, y el profesor provoca averías electrónicas que el alumno diagnostica con un multímetro y un osciloscopio virtuales.

Es distinto del gemelo de la maqueta (`../simulador_pct23`): aquí hay una planta completa con unos 45 equipos (tanque de balance, bomba con variador, intercambiador de placas, tubo de residencia, válvula de desvío neumática, agua caliente y fría, CIP, aire comprimido, armario y PLC).

## Qué incluye

- Un **PLC simulado** con su programa (arranque, producción, desvío, paro de seguridad, CIP básico y alarmas) y su mapa de entradas y salidas (4-20 mA, 0-10 V, 24 V CC).
- Un **motor de averías** electrónicas (sensores, lazos, alimentación, actuadores, potencia, neumática, comunicaciones) y algunas de proceso.
- **SCADA 2D** y **planta 3D** con las mismas lecturas, y una ventana aparte para verlos a la vez.
- Herramientas del alumno: multímetro, osciloscopio, hoja de diagnóstico y hoja de calibración de lazos.
- **Panel del profesor** para elegir las averías.

Todos los valores numéricos (72 °C durante 15 s, 0,07 bar de diferencial, rangos de instrumentos) son ilustrativos y no sustituyen a la normativa que aplique en cada centro.

## Probarlo en local

Hace falta Python 3. La planta reutiliza código compartido del simulador de la maqueta, así que se sirve desde la carpeta superior, con las mismas rutas que en el aula:

```bash
cd gateway_industrial_excelencia
python simulador_planta_real/servir_local.py            # http://localhost:8091/planta-real/
python simulador_planta_real/servir_local.py 8091 0.0.0.0   # también desde el móvil, en la misma red
```

Abrir `index.html` con doble clic **no funciona**, porque las páginas cargan `/simulador/js/...` con rutas absolutas. El servidor no tiene contraseña, así que abre `0.0.0.0` solo mientras lo necesites.

## Tests

Con Node.js 18 o superior, desde esta carpeta:

```bash
node --test
```

Cubren la física, el PLC, las averías, los instrumentos y la interfaz.

## Despliegue

Es contenido estático. En la plataforma Minaya lo sirve un contenedor de solo lectura detrás del login, en `/planta-real/` (servicio `sim-planta` del repo `minaya-plataforma`), que monta esta carpeta como `/sim`. Con cualquier otro servidor estático, mantén estas rutas:

- `/planta-real/` apunta a esta carpeta.
- `/simulador/` apunta a `../simulador_pct23` (código compartido).
- `/comun/` apunta a `../comun` (identidad visual y núcleo común).

## Estructura

```
index.html, completo.html, componentes.html, fuerza.html, mando.html, visor3d.html   páginas
js/layout.js       el contrato: equipos, posiciones y señales (no se cambia sin revisarlo)
js/modelo/         física del proceso
js/plc/            programa y mapa de E/S del PLC
js/averias/        catálogo y motor de averías
js/scada2d/        esquema 2D
js/visor3d_htst/   planta 3D (three.js)
js/interfaz/       paneles, instrumentos y hojas
modelos/           punto de entrada para modelos 3D propios (ver su LEEME.md)
tests/             pruebas de Node
```

El diseño completo, con el proceso, la lista de equipos y las reglas de cada capa, está en `ARQUITECTURA.md`.

## Licencia

Software propietario, todos los derechos reservados. Ver `LICENSE` en la raíz del repositorio.
