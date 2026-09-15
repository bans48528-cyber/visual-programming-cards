motor_power = 50
for count_0 in range(4):
    for count_1 in range(2):
        _motor.run_for_power_seconds(4, motor_power, 2.5)
        _os.sleep_s(0.1)
        _os.sleep_s(0.001)
    _motor.stop(4)
    _os.sleep_s(0.001)
