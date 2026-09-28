def get_comm(comm_type, **kwargs):

    if comm_type == "rest":
        from .rest_comm import RestComm
        return RestComm(kwargs.get("url"))

    elif comm_type == "mqtt":
        from .mqtt_comm import MQTTComm
        return MQTTComm(kwargs.get("broker"))

    elif comm_type == "serial":
        from .serial_comm import SerialComm
        return SerialComm(kwargs.get("port"))

    else:
        raise ValueError("Tipo de comunicación no soportado")