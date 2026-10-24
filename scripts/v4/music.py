# Original 120 BPM track for the v4 short. Light intro under the hook,
# groove under landing/board, full drop when the Analyst appears.
import math, random, struct, sys, wave
SR = 22050
TOTAL, GROOVE_AT, DROP_AT = float(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3])
BEAT = 0.5
N = int(SR * TOTAL)
L = [0.0] * N
hz = lambda n: 440 * 2 ** ((n - 69) / 12)
prog = [(57, 60, 64), (53, 57, 60), (48, 52, 55), (55, 59, 62)]  # Am F C G, one chord per bar
random.seed(3)
def add(start, length, fn, gain):
    s = int(start * SR)
    for i in range(int(length * SR)):
        j = s + i
        if j >= N: return
        L[j] += gain * fn(i / SR)
beats = int(TOTAL / BEAT)
for b in range(beats):
    t = b * BEAT
    bar = int(t // 2); chord = prog[bar % 4]
    full = t >= DROP_AT; groove = t >= GROOVE_AT
    # arpeggio sixteenths, always on
    for k in range(2):
        f = hz(chord[(b * 2 + k) % 3] + 12)
        add(t + k * 0.25, 0.22, lambda x, f=f: math.exp(-x * 9) * (math.sin(2 * math.pi * f * x) + 0.4 * math.sin(4 * math.pi * f * x)), 0.07 if full else 0.05)
    if b % 4 == 0:  # pad each bar
        for n in chord:
            f = hz(n)
            add(t, 2.0, lambda x, f=f: min(1, x / 0.3) * min(1, (2 - x) / 0.3) * math.sin(2 * math.pi * f * x), 0.035)
    if groove:
        add(t, 0.3, lambda x: math.exp(-x * 16) * math.sin(2 * math.pi * (50 + 90 * math.exp(-x * 35)) * x), 0.5)  # kick every beat
        f = hz(chord[0] - 24)
        add(t + 0.25, 0.22, lambda x, f=f: math.exp(-x * 6) * math.sin(2 * math.pi * f * x), 0.22)  # off-beat bass
        add(t + 0.25, 0.04, lambda x: math.exp(-x * 90) * (random.random() * 2 - 1), 0.08)  # hat
    if full:
        if b % 2 == 1:  # snare on 2 and 4
            add(t, 0.18, lambda x: math.exp(-x * 22) * ((random.random() * 2 - 1) * 0.8 + 0.4 * math.sin(2 * math.pi * 190 * x)), 0.28)
        if b % 4 == 0:  # lead stab on each bar
            f = hz(chord[2] + 12)
            add(t, 0.35, lambda x, f=f: math.exp(-x * 5) * (1 if math.sin(2 * math.pi * f * x) > 0 else -1), 0.04)
# riser into the drop
add(DROP_AT - 2, 2, lambda x: (x / 2) ** 2 * (random.random() * 2 - 1), 0.12)
peak = max(abs(v) for v in L) or 1
fade = int(SR * 1.5)
with wave.open("recordings/v4-music.wav", "w") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(b"".join(struct.pack("<h", int(30000 * v / peak * min(1, (N - i) / fade))) for i, v in enumerate(L)))
print("music", TOTAL, "s, groove", GROOVE_AT, "drop", DROP_AT)
