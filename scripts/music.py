# Generates an original, royalty-free lo-fi loop (Am - F - C - G) as WAV.
import math, struct, wave, random
SR, BPM, SECS = 22050, 84, 110
beat = 60 / BPM
chords = [(57, 60, 64), (53, 57, 60), (48, 52, 55), (55, 59, 62)]  # MIDI notes
hz = lambda n: 440 * 2 ** ((n - 69) / 12)
N = SR * SECS
buf = [0.0] * N
bar = 4 * beat
random.seed(7)
for b in range(int(SECS / bar) + 1):
    root = chords[b % 4]
    start = int(b * bar * SR)
    # warm pad: each chord tone plus a soft octave below, slow swell
    for note in root + (root[0] - 12,):
        f = hz(note)
        for i in range(int(bar * SR)):
            j = start + i
            if j >= N: break
            t = i / SR
            env = min(1, t / 0.6) * min(1, (bar - t) / 0.4)
            buf[j] += 0.06 * env * (math.sin(2 * math.pi * f * t) + 0.3 * math.sin(4 * math.pi * f * t))
    # gentle plucked arpeggio, eighth notes
    for k in range(8):
        note = root[k % 3] + 12
        f = hz(note)
        s0 = start + int(k * beat / 2 * SR)
        for i in range(int(0.45 * SR)):
            j = s0 + i
            if j >= N: break
            t = i / SR
            buf[j] += 0.05 * math.exp(-t * 7) * math.sin(2 * math.pi * f * t)
    # soft kick on beats 1 and 3, hat on the off-beats
    for k in (0, 2):
        s0 = start + int(k * beat * SR)
        for i in range(int(0.25 * SR)):
            j = s0 + i
            if j >= N: break
            t = i / SR
            buf[j] += 0.18 * math.exp(-t * 18) * math.sin(2 * math.pi * (55 + 60 * math.exp(-t * 30)) * t)
    for k in range(4):
        s0 = start + int((k + 0.5) * beat * SR)
        for i in range(int(0.05 * SR)):
            j = s0 + i
            if j >= N: break
            buf[j] += 0.015 * math.exp(-i / SR * 80) * (random.random() * 2 - 1)
peak = max(abs(x) for x in buf) or 1
fade = SR * 3
with wave.open("recordings/music.wav", "w") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(b"".join(struct.pack("<h", int(32767 * 0.9 * x / peak * min(1, (N - i) / fade, i / SR / 1.5 if i < SR * 1.5 else 1))) for i, x in enumerate(buf)))
print("music.wav", SECS, "s")
