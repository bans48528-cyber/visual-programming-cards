while not (_ultrasion.cmp_value(0, ">", 100)):
    _os.sleep_s(0.001)
while not (_color.cmp_lux(0, "==", 0)):
    _os.sleep_s(0.001)
_motor.stop(4)
