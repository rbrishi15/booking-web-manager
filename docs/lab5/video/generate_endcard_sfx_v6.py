"""Deterministic, original soft foley for the measured Remotion i-dot animation."""
import array,json,math,random,subprocess,wave
from pathlib import Path
SOURCE=Path(__file__).resolve().parent
PROJECT=SOURCE/"remotion"
RATE=48000
samples=[0.0]*int(16*RATE)
rng=random.Random(2006)
events=[]
def add(at,duration,kind,gain):
 start=round(at*RATE);previous=0.0
 for k in range(round(duration*RATE)):
  t=k/RATE;u=t/duration
  if kind=="air":
   noise=rng.uniform(-1,1);high=noise-previous;previous=noise
   value=high*math.sin(math.pi*u)**2*.22
  else:
   attack=1-math.exp(-t*1500)
   pitch=145 if kind=="bounce" else 245
   tone=math.sin(2*math.pi*(pitch*t+65*.017*(1-math.exp(-t/.017))))
   felt=rng.uniform(-1,1)*math.exp(-t*95)*.26
   value=attack*(tone*math.exp(-t*38)*.65+math.sin(2*math.pi*830*t)*math.exp(-t*90)*.13+felt)
  samples[start+k]+=value*gain
 events.append({"local_seconds":at,"duration":duration,"kind":kind,"gain":gain})
add(.15,.65,"air",.035)
add(1.2,.38,"air",.045)
add(2.2,.24,"air",.18)
add(3.2,.19,"bounce",.22)
add(4.4,.16,"bounce",.16)
add(4.9,.13,"settle",.14)
path=PROJECT/"public/audio/endcard-foley-v6.wav"
with wave.open(str(path),"wb") as w:
 w.setnchannels(1);w.setsampwidth(2);w.setframerate(RATE)
 w.writeframes(array.array("h",[round(max(-1,min(1,v))*32767) for v in samples]).tobytes())
subprocess.run(["ffmpeg","-v","error","-y","-i",str(PROJECT/"public/audio/ending-v5.wav"),"-i",str(path),"-filter_complex","[1:a]adelay=15000[sfx];[0:a][sfx]amix=inputs=2:normalize=0:duration=first[a]","-map","[a]","-ar","48000","-ac","1","-c:a","pcm_s16le",str(PROJECT/"public/audio/ending-v6.wav")],check=True)
report={"type":"Original procedural sound effects, no licensed sample assets","rate":RATE,"duration":16,"peak":max(abs(v) for v in samples),"events":events,"ending_chapter_offset":15,"full_video_offset":374.3,"voice_overlap":False}
(SOURCE/"endcard-sfx-v6.json").write_text(json.dumps(report,indent=2)+"\n")
print("Created soft lift-off, two decreasing bounce taps and a final settling tick; peak",report["peak"])
