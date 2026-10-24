# Mixes the recorded video with the narration clips (placed at their caption
# times) and the background music, ducked under the voice. Writes an MP4.
import json, subprocess
doc = json.load(open("recordings/timeline.json"))
start = doc["start"]
tl = doc["items"]
args = ["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{start/1000:.2f}", "-i", "recordings/trivela-analyst-demo.webm", "-i", "recordings/music.wav"]
parts = []
for i, x in enumerate(tl):
    args += ["-i", x["file"]]
    parts.append(f"[{i+2}:a]aresample=44100,adelay={max(0, x['t'] - start + 150)}:all=1[n{i}]")
n = len(tl)
f = ";".join(parts) + ";" + "".join(f"[n{i}]" for i in range(n)) + f"amix=inputs={n}:normalize=0,volume=1.6,asplit=2[voice][key]"
f += ";[1:a]aresample=44100,volume=0.22[mus];[mus][key]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[duck]"
f += ";[voice][duck]amix=inputs=2:normalize=0,alimiter=limit=0.95[a]"
args += ["-filter_complex", f, "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", "recordings/trivela-analyst-demo.mp4"]
subprocess.run(args, check=True)
print("mixed recordings/trivela-analyst-demo.mp4")
