# Simulador de la instalación fotovoltaica

Simulador web de una instalación solar real: la de la cubierta del CIFP Politécnico de Cartagena. Forma en **mantenimiento electrónico**: el alumno ve el esquema unifilar, el cableado y una escena 3D, mide con instrumentos virtuales y diagnostica las averías que activa el profesor.

Las especificaciones de los equipos son supuestos hechos a partir de fotos de la instalación. Están agrupadas en `js/layout.js` para que el profesor las corrija.

## Qué simula

- **Sol y ambiente:** posición solar, irradiancia de cielo despejado, nubosidad, temperatura, suciedad y sombras por panel.
- **Dos campos de paneles:** campo A (6 paneles policristalinos, 2 cadenas de 3) y campo B (8 monocristalinos, 2 cadenas de 4), con curvas I-V y P-V, diodos de paso y desajuste entre paneles.
- **Inversor híbrido EASun** con batería LiFePO4 de 25,6 V y 100 Ah: MPPT, cargador, prioridad de fuente y protecciones del BMS.
- **Inversor ZCS Azzurro** conectado a red: dos MPPT, comprobación de aislamiento, espera de reconexión y anti-isla.
- **Red, cargas y protecciones:** magnetotérmicos, diferenciales, fusibles y descargadores. Un elemento abierto corta lo que cuelga de él, resuelto por topología.
- **Averías** cuyos efectos salen de la física y no de valores fijos en la interfaz.

El modelo es determinista con semilla.

## Probarlo en local

Hace falta Python 3. Se sirve desde la carpeta superior, con las mismas rutas que en el aula, porque reutiliza código del simulador de la maqueta:

```bash
cd gateway_industrial_excelencia
python simulador_fotovoltaica/servir_local.py            # http://localhost:8091/fotovoltaica/
python simulador_fotovoltaica/servir_local.py 8091 0.0.0.0   # también desde el móvil, en la misma red
```

Abrir `index.html` con doble clic no funciona, porque las páginas cargan `/simulador/js/...` con rutas absolutas. El servidor no tiene contraseña: abre `0.0.0.0` solo mientras lo necesites.

## Tests

Con Node.js 18 o superior, desde esta carpeta:

```bash
node --test
```

Cubren el sol, los paneles, los inversores, la batería, las averías, los diagramas y la interfaz.

## Despliegue

Es contenido estático. En la plataforma Minaya lo sirve un contenedor de solo lectura detrás del login, en `/fotovoltaica/` (servicio `sim-fotovoltaica` del repo `minaya-plataforma`), que monta esta carpeta como `/sim`. Con cualquier otro servidor estático, mantén estas rutas:

- `/fotovoltaica/` apunta a esta carpeta.
- `/simulador/` apunta a `../simulador_pct23` (código compartido).
- `/comun/` apunta a `../comun` (identidad visual y núcleo común).

## Estructura

```
index.html, unifilar.html, cableado.html, visor3d.html   páginas
js/layout.js       el contrato: equipos, circuitos, especificaciones y averías
js/modelo/         sol, paneles, inversores, batería y simulación
js/averias/        catálogo, efectos y diagnóstico
js/scada2d/        esquema unifilar y de cableado
js/visor3d_fv/     escena 3D (three.js)
js/interfaz/       paneles, instrumentos y retos
tests/             pruebas de Node
```

La API del modelo, con las órdenes que acepta y el estado que publica, está en `ARQUITECTURA.md` y `API_INSTRUMENTOS.md`.

## Licencia

Software propietario, todos los derechos reservados. Ver `LICENSE` en la raíz del repositorio.
