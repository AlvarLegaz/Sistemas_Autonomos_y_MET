from runtime import Runtime


AYUDA = """Comandos:
  arrancar
  parar
  pwm <0..100>
  read_ai
  read_di
  diag
  write_ao <v1> <v2> <v3> <v4> <v5> <v6> <v7> <v8>
  write_pwm <v1> <v2> <v3> <v4> <v5> <v6> <v7> <v8>
  write_do <v1> <v2> <v3> <v4> <v5> <v6> <v7> <v8>
  salir"""

ESCRITURAS = {"write_ao": "writeAnalogOutput", "write_pwm": "writePWMOutput",
              "write_do": "writeDigitalOutput"}


runtime = Runtime()
print(AYUDA)

try:
    while True:
        parts = input("> ").strip().lower().split()
        if not parts:
            continue
        cmd, args = parts[0], parts[1:]

        try:
            if cmd == "arrancar":
                runtime.start()
            elif cmd == "parar":
                runtime.stop()
            elif cmd == "pwm" and len(args) == 1:
                runtime.set_pwm(args[0])
            elif cmd == "read_ai":
                print(runtime.readAnalogInput())
            elif cmd == "read_di":
                print(runtime.readDigitalInput())
            elif cmd == "diag":
                print(runtime.diagnostico())
            elif cmd in ESCRITURAS and len(args) == 8:
                getattr(runtime, ESCRITURAS[cmd])(*args)
            elif cmd == "salir":
                break
            else:
                print("Comando no reconocido o numero de valores incorrecto")
                print(AYUDA)
        except ValueError as e:
            print(f"Valor no valido: {e}")
        except OSError as e:
            print(f"Error de hardware: {e}")
except (KeyboardInterrupt, EOFError):
    print()
finally:
    if runtime.running:
        runtime.stop()
