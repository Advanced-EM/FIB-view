# Test automation: focus the ion beam with as few frames as possible (each frame sputters the sample).
import numpy as np
import fibview as fv

fib = fv.connect()
task = fib.challenge("fib-focus-stig", seed=7)
print(task["task"])


def sharpness():
    img = fib.acquire(steps=2)["ion_image"]
    gy, gx = np.gradient(img.astype(float))
    return float(np.mean(np.hypot(gx, gy)) / (img.mean() or 1))


def search(key, lo, hi, n=7):
    best = None
    for v in np.linspace(lo, hi, n):
        fib.set(**{key: float(v)})
        s = sharpness()
        if best is None or s > best[1]:
            best = (v, s)
    fib.set(**{key: float(best[0])})
    return best


# coarse focus, then the stigmator, then fine focus (astigmatism shifts the best focus)
f, _ = search("ion_focus_um", -100, 100, n=9)
a, _ = search("ion_stig", -60, 60, n=9)
search("ion_stig", a - 10, a + 10)
f, _ = search("ion_focus_um", f - 25, f + 25)
search("ion_focus_um", f - 6, f + 6, n=5)
print("score:", fib.score())
print("truth:", fib.reveal())
fib.end_challenge()
