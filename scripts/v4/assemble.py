# Cuts each scene from its page-load-free start, joins them on the bar grid,
# places every narration line at its spoken time, ducks the music under it.
import json, subprocess
sc = json.load(open("recordings/v4/scenes.json"))
args = ["ffmpeg", "-y", "-loglevel", "error"]
for s in sc: args += ["-i", s["file"]]
args += ["-i", "recordings/v4-music.wav"]
mus = len(sc)
f, acc, voice = [], 0.0, []
for i, s in enumerate(sc):
    f.append(f"[{i}:v]trim=start={s['start']/1000:.3f}:duration={s['dur']/1000:.3f},setpts=PTS-STARTPTS,fps=30,format=yuv420p[v{i}]")
    for ln in s["lines"]:
        voice.append((ln["file"], acc + ln["at"] / 1000))
    acc += s["dur"] / 1000
f.append("".join(f"[v{i}]" for i in range(len(sc))) + f"concat=n={len(sc)}:v=1:a=0[v]")
for k, (file, at) in enumerate(voice):
    args += ["-i", file]
    f.append(f"[{mus + 1 + k}:a]aresample=44100,adelay={int(at * 1000) + 80}:all=1[n{k}]")
f.append("".join(f"[n{k}]" for k in range(len(voice))) + f"amix=inputs={len(voice)}:normalize=0,volume=1.7,asplit=2[voice][key]")
f.append(f"[{mus}:a]aresample=44100,volume=0.42[m]")
f.append("[m][key]sidechaincompress=threshold=0.035:ratio=6:attack=15:release=350[duck]")
f.append(f"[voice][duck]amix=inputs=2:normalize=0,alimiter=limit=0.95,atrim=duration={acc:.3f}[a]")
args += ["-filter_complex", ";".join(f), "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "19",
         "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "recordings/trivela-analyst-short-v4.mp4"]
subprocess.run(args, check=True)
print("wrote recordings/trivela-analyst-short-v4.mp4", round(acc, 1), "s")
