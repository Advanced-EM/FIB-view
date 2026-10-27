"""A cryo lamella for cryo-ET, three ways: gallium, argon and xenon.

Yeast cells frozen in vitreous ice on a grid are milled from both sides at 12° until a slab ~200 nm thick is left.
The same recipe (current stepped down with the thickness) is run with each ion species; compare the damaged layer
on each face, how much of the slab is left undamaged, and the instrument time.
"""
import fibview as fv

fib = fv.connect()
RECIPE = [(1000, 2500), (300, 800), (100, 400), (30, 200)]  # (current pA, target nm)

for ion in ["Ga", "Ar", "Xe"]:
    fib.set(mode="cryo", ion=ion, milling_angle_deg=12, relief_cuts=True, stage_temp_C=-190, anticontaminator=True)
    fib.cryo("reset")
    for _ in range(4):  # sputter coat, cold GIS, milling angle, relief cuts
        fib.cryo("next")
    for current, target in RECIPE:
        fib.cryo("mill", target_nm=target, current_pA=current)
    q = fib.cryo("coat")["quality"]
    print(f"{ion}: {q['t']} nm (t/λ {q['t_lambda']}), damaged {q['damage'][0]:.0f} nm per face, "
          f"{q['intact']} nm undamaged, {q['devit_pct']} % crystalline, {q['time_min']} min: {q['verdict']}")

# what happens if you rush it: straight to 200 nm at 1 nA
fib.cryo("reset")
for _ in range(4):
    fib.cryo("next")
q = fib.cryo("mill", target_nm=200, current_pA=1000)["quality"]
print(f"rushed: {q['devit_pct']} % crystalline, bent: {q['bent']}, lost: {q['lost']} -> {q['verdict']}")
