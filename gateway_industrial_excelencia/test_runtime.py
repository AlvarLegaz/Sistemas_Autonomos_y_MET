from runtime import Runtime


runtime = Runtime()

print("Comandos:")
print("  arrancar")
print("  parar")
print("  pwm <0..100>")
print("  read_ai")
print("  read_di")
print("  read_current")
print("  read_rtd")
print("  write_ao <v1> <v2> <v3> <v4> <v5> <v6> <v7> <v8>")
print("  write_pwm <v1> <v2> <v3> <v4> <v5> <v6> <v7> <v8>")
print("  write_do <v1> <v2> <v3> <v4> <v5> <v6> <v7> <v8>")
print("  salir")

while True:
    cmd = input("> ").strip().lower()
    parts = cmd.split()

    if not parts:
        continue

    if parts[0] == "arrancar":
        runtime.start()

    elif parts[0] == "parar":
        runtime.stop()

    elif parts[0] == "pwm":
        if len(parts) != 2:
            print("Uso: pwm <0..100>")
            continue

        runtime.set_pwm(parts[1])

    elif parts[0] == "read_ai":
        print(runtime.readAnalogInput())

    elif parts[0] == "read_di":
        print(runtime.readDigitalInput())

    elif parts[0] == "read_current":
        print(runtime.readCurrentInput())

    elif parts[0] == "read_rtd":
        print(runtime.readRTDInput())

    elif parts[0] == "write_ao":
        if len(parts) != 9:
            print("Uso: write_ao <v1> <v2> <v3> <v4> <v5> <v6> <v7> <v8>")
            continue

        runtime.writeAnalogOutput(
            parts[1], parts[2], parts[3], parts[4],
            parts[5], parts[6], parts[7], parts[8]
        )

    elif parts[0] == "write_pwm":
        if len(parts) != 9:
            print("Uso: write_pwm <v1> <v2> <v3> <v4> <v5> <v6> <v7> <v8>")
            continue

        runtime.writePWMOutput(
            parts[1], parts[2], parts[3], parts[4],
            parts[5], parts[6], parts[7], parts[8]
        )

    elif parts[0] == "write_do":
        if len(parts) != 9:
            print("Uso: write_do <v1> <v2> <v3> <v4> <v5> <v6> <v7> <v8>")
            continue

        runtime.writeDigitalOutput(
            int(parts[1]), int(parts[2]), int(parts[3]), int(parts[4]),
            int(parts[5]), int(parts[6]), int(parts[7]), int(parts[8])
        )

    elif parts[0] == "salir":
        runtime.stop()
        break

    else:
        print("Comando no reconocido")