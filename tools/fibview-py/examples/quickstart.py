# Quick start: the same place with both beams.
import fibview as fv

fib = fv.connect()
fib.set(mode="se", specimen="ni", kV=5, tilt_deg=52, fov_um=120)
sem = fib.acquire()
fv.show(sem, "SEM: secondary electrons, polished nickel")

fib.set(mode="fib", ion="Ga", ion_current_pA=25)
ion = fib.acquire()
fv.show(ion, "Ion-induced electrons: channelling contrast")
print(fib.state()["ion"])
