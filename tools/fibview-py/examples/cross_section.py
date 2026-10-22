# Mill a cross-section into the chip and image the face with the SEM at 52°.
import fibview as fv

fib = fv.connect()
fib.set(specimen="chip", mode="mill", ion="Ga", tilt_deg=52, fov_um=34)
fib.deposit("Pt", x=6, y=7.2, w=16, h=1.8, thickness=1.2)
fib.set(ion_current_pA=9000)
print(fib.mill(shape="rcs", x=6, y=1.9, w=16, h=10, depth=8))
fib.set(ion_current_pA=800)
print(fib.mill(shape="ccs", x=6, y=6.2, w=15.5, h=1.2, depth=8))
fib.set(fov_um=16)
a = fib.acquire()
fv.show(a["sem_image"], "SEM at 52°: the cross-section face")
fv.show(a["ion_image"], "Ion view: the trench from above")
