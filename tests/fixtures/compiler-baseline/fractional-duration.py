motor_power = 50
_motor.run_for_power_seconds(4, motor_power, 0.1)
_os.sleep_s(2.5)
_motor.run_for_power_seconds(4, -motor_power, 86400)
