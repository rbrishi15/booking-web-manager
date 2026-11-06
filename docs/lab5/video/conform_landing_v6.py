"""Preserve one real browser take; ease only scroll timing, never cut page positions."""
import json,subprocess
from pathlib import Path
SOURCE=Path(__file__).resolve().parent
ROOT=SOURCE.parents[2]
OUT=ROOT/"output/lab5-video"
PROJECT=SOURCE/"remotion"
FOLDER=OUT/"rerecord-v6"
plan=json.loads((FOLDER/"selected-take-manifest.json").read_text())
raw=FOLDER/plan["capture"]
segments=[]
for i,r in enumerate(plan["retimed_contiguous_source_ranges"]):
 dest=FOLDER/f"conform-{i}.mp4";segments.append(dest)
 duration=r["output_frames"]/30
 speed=(r["out_frame"]-r["in_frame"])/r["output_frames"]
 filters=f"fps=30,trim=start_frame={r['in_frame']}:end_frame={r['out_frame']},setpts=(PTS-STARTPTS)/{speed},crop=2920:1504:0:174,scale=1860:914:force_original_aspect_ratio=decrease"
 if r["type"]=="scroll":
  filters+=",minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:me=epzs:mb_size=16:search_param=256:vsbmc=1:scd=none"
 filters+=",fps=30,tpad=stop_mode=clone:stop_duration=0.25,pad=1920:1080:(ow-iw)/2:59:color=0x151A1E,format=yuv420p"
 subprocess.run(["ffmpeg","-v","error","-y","-threads","2","-i",str(raw),"-vf",filters,"-frames:v",str(r["output_frames"]),"-an","-c:v","libx264","-crf","10","-preset","fast","-threads","2",str(dest)],check=True)
 print("Conformed",i,r["type"],r["output_frames"],flush=True)
listing=FOLDER/"conformed.ffconcat";listing.write_text("ffconcat version 1.0\n"+"".join(f"file '{p.resolve()}'\n" for p in segments))
full=PROJECT/"public/screens/landing-full-v6.mp4"
subprocess.run(["ffmpeg","-v","error","-y","-f","concat","-safe","0","-i",str(listing),"-c","copy","-movflags","+faststart",str(full)],check=True)
for name,start,count in [("neoh-landing-handle-v6",0,180),("landing-v6",180,720)]:
 subprocess.run(["ffmpeg","-v","error","-y","-i",str(full),"-vf",f"trim=start_frame={start}:end_frame={start+count},setpts=PTS-STARTPTS","-frames:v",str(count),"-an","-c:v","libx264","-crf","10","-preset","fast","-threads","2","-movflags","+faststart",str(PROJECT/"public/screens"/(name+".mp4"))],check=True)
print("Built one continuous30-second tour;6s opening handle and24s landing.")
