# v5 post: per-scene punch-ins on the recorded frames (zoompan, clamped to the
# page edges, max 1.8x, eased 0.3 s), concat on the bar grid, caption PNGs
# timed to the narration, voice + ducked 120 BPM music, loudness -14 LUFS.
import json, re, subprocess, sys

FPS = 30
SC = json.load(open("recordings/v5/scenes.json"))
NARR = json.load(open("recordings/v5-narration/manifest.json"))
PAD = 66  # 24 CSS px at 390 -> 1080
HL = {"AI", "MAKE", "UP", "NUMBERS", "TRIVELA", "WALL", "VERIFIED", "WON'T", "GUESS", "PERSONA", "VERIFICATION", "LADDER", "JSON", "ANALYST"}

def zoom_for(z):
    s = min(1.8, 1080 / (z["w"] + 2 * PAD), 1920 / (z["h"] + 2 * PAD))
    return max(1.0, s), z["x"] + z["w"] / 2, z["y"] + z["h"] / 2

def zexpr(scene):
    base = (1.0, 540.0, 960.0)
    wins = []

    for z in scene["zooms"]:
        if z["w"] < 20: continue
        s, cx, cy = zoom_for(z)
        wins.append((z["t0"], z["t1"], s, cx, cy))
    T = f"(in/{FPS})"
    def e(t0, t1):
        a = f"clip(({T}-{t0:.3f})/0.3,0,1)"; b = f"clip(({t1:.3f}-{T})/0.3,0,1)"
        m = f"min({a},{b})"
        return f"({m}*{m}*(3-2*{m}))"
    def mix(idx):
        out = f"{base[idx]}"
        for w in wins:
            out += f"+{e(w[0], w[1])}*({w[2 + idx]}-{base[idx]})"
        return out
    Zx, CX, CY = mix(0), mix(1), mix(2)
    x = f"clip(({CX})-iw/zoom/2,0,iw-iw/zoom)"
    y = f"clip(({CY})-ih/zoom/2,0,ih-ih/zoom)"
    return f"zoompan=z='{Zx}':x='{x}':y='{y}':d=1:s=1080x1920:fps={FPS}"

# 1. scenes -> zoomed clips
offs, acc = [], 0.0
for sc in SC:
    offs.append(acc)
    out = f"recordings/v5/z_{sc['name']}.mp4"
    vf = f"fps={FPS},setpts=PTS-STARTPTS,{zexpr(sc)},setsar=1"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", f"{sc['start']:.3f}", "-t", f"{sc['dur']:.3f}", "-i", sc["file"],
                    "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-an", out], check=True)
    acc += sc["dur"]
TOTAL = acc
with open("recordings/v5/concat.txt", "w") as f:
    for sc in SC: f.write(f"file 'z_{sc['name']}.mp4'\n")
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", "recordings/v5/concat.txt", "-c", "copy", "recordings/v5/joined.mp4"], check=True)

# 2. caption chunks timed across each spoken line
chunks, voice = [], []
for sc, off in zip(SC, offs):
    for ln in sc["lines"]:
        n = NARR[ln["key"]]; start = off + ln["at"]
        voice.append((n["file"], start))
        words = n["text"].split()
        groups, i = [], 0
        while i < len(words):
            k = 2 if len(words) - i == 4 else min(3, len(words) - i)
            groups.append(words[i:i + k]); i += k
        total = sum(len("".join(g)) for g in groups); t = start
        for g in groups:
            d = n["ms"] / 1000 * len("".join(g)) / total
            html = " ".join(f'<span style="color:#3ccf95">{w}</span>' if re.sub(r"[^A-Za-z']", "", w).upper() in HL else w for w in g)
            if sc["name"] == "close": t += d; continue
            chunks.append({"html": html, "t0": round(t, 3), "t1": round(t + d, 3), "y": 330 if sc["name"] == "close" else 1330})
            t += d
json.dump(chunks, open("recordings/v5/chunks.json", "w"), indent=1)
subprocess.run(["node", "scripts/v5/captions.mjs"], check=True)

# 3. overlay captions (baseline area y~1250-1400, clear of Shorts UI)
inputs = ["-i", "recordings/v5/joined.mp4"]
f, last = [], "0:v"
for i, c in enumerate(chunks):
    inputs += ["-i", f"recordings/v5/cap/{i:03d}.png"]
    f.append(f"[{last}][{i + 1}:v]overlay=0:{c['y']}:enable='between(t,{c['t0']},{c['t1']})'[o{i}]")
    last = f"o{i}"
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *inputs, "-filter_complex", ";".join(f), "-map", f"[{last}]",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "recordings/v5/captioned.mp4"], check=True)

# 4. music + voice + loudness
drop = offs[[s["name"] for s in SC].index("analyst")]
subprocess.run(["python3", "scripts/v4/music.py", str(TOTAL + 0.5), "3.0", str(drop)], check=True)
args = ["ffmpeg", "-loglevel", "error", "-y", "-i", "recordings/v5/captioned.mp4", "-i", "recordings/v4-music.wav"]
af = []
for k, (file, at) in enumerate(voice):
    args += ["-i", file]
    af.append(f"[{k + 2}:a]aresample=48000,atempo=1.0,adelay={int(at * 1000) + 60}:all=1[n{k}]")
af.append("".join(f"[n{k}]" for k in range(len(voice))) + f"amix=inputs={len(voice)}:normalize=0,volume=1.5,asplit=2[voice][key]")
af.append("[1:a]aresample=48000,volume=0.5[m]")
af.append("[m][key]sidechaincompress=threshold=0.02:ratio=10:attack=10:release=300[duck]")
af.append(f"[voice][duck]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,volume=2dB,alimiter=limit=0.84:level=false,atrim=duration={TOTAL:.3f}[a]")
args += ["-filter_complex", ";".join(af), "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
         "-pix_fmt", "yuv420p", "-r", str(FPS), "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart",
         "recordings/trivela-analyst-short-v5.mp4"]
subprocess.run(args, check=True)
json.dump({"offsets": dict(zip([s["name"] for s in SC], offs)), "total": TOTAL, "drop": drop}, open("recordings/v5/layout.json", "w"))
print("v5 done", TOTAL, "s; scene offsets", dict(zip([s["name"] for s in SC], offs)))
