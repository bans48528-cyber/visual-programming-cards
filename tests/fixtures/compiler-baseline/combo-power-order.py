combo_power = 50
_motor.pair(4, 5, 1)
_motor.mov_set_stop_module(1)
combo_power = 75
_motor.pair(4, 5, 2)
_motor.mov_dir_power_seconds("advance", combo_power, 3.5)
_motor.mov_stop()
