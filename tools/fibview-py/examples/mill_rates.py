# Milling rate: the same box, asked to reach 2 µm in silicon, with five ion species into the microchip.
import fibview as fv

fib = fv.connect()
fib.set(specimen="chip", mode="mill")
print(f"{'ion':4} {'depth µm':>9} {'yield µm³/nC':>13} {'time s':>8}")
for k, ion in enumerate(["Ga", "Xe", "Ar", "N", "O"]):
    fib.set(ion=ion, ion_current_pA=4000)
    r = fib.mill(shape="rect", w=6, h=6, depth=2, x=-24 + 12 * k, y=0)
    print(f"{ion:4} {r['maxDepth']:9.2f} {r['Yv']:13.3f} {r['time_s']:8.1f}")
