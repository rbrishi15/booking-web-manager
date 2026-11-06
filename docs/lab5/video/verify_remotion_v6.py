"""Validate the actual V6 export, not editor screenshots. Python3 + Pillow + FFmpeg."""
import array,hashlib,json,math,re,subprocess
from pathlib import Path
from PIL import Image,ImageChops,ImageDraw,ImageStat
SOURCE=Path(__file__).resolve().parent
OUT=SOURCE.parents[2]/"output/lab5-video"
PROJECT=SOURCE/"remotion"
VIDEO=OUT/"booking-web-manager-lab5-remotion-v6.mp4"
QA=OUT/"remotion-v6-qa";QA.mkdir(exist_ok=True)
data=json.loads(VIDEO.with_suffix(".timeline.json").read_text())
probe=json.loads(subprocess.check_output(["ffprobe","-v","error","-show_streams","-show_format","-of","json",str(VIDEO)]))
v=next(s for s in probe["streams"] if s["codec_type"]=="video");a=next(s for s in probe["streams"] if s["codec_type"]=="audio")
assert (v["codec_name"],v["width"],v["height"],v["r_frame_rate"])==("h264",1920,1080,"30/1")
assert int(v["nb_frames"])==round(data["duration"]*30)==11709
assert abs(float(probe["format"]["duration"])-390.3)<.034 and float(probe["format"]["duration"])<420
assert 8_000_000<=int(v["bit_rate"])<=12_000_000
assert a["codec_name"]=="aac" and a["sample_rate"]=="48000"
phrases=[{**q,"global_start":c["sequence_start"]+q["start"]} for c in data["chapters"] for q in c["cues"]]
pages=[{**q,"chapter":c["id"],"global_start":c["sequence_start"]+q["startMs"]/1000,"global_end":c["sequence_start"]+q["endMs"]/1000,"on_card":c["id"]=="ending" and q["startMs"]>=20500} for c in data["chapters"] for q in c["captions"]]
assert len(phrases)==62 and len(pages)==65
blocks=VIDEO.with_suffix(".srt").read_text().strip().split("\n\n");assert len(blocks)==len(pages)
def sec(text):
 h,m,s,ms=map(int,re.split("[:,]",text));return h*3600+m*60+s+ms/1000
last=0
for n,(page,block) in enumerate(zip(pages,blocks)):
 lines=block.splitlines();start,end=map(sec,lines[1].split(" --> "))
 assert int(lines[0])==n+1 and abs(start-page["global_start"])<.00051 and abs(end-page["global_end"])<.00051
 assert start>=last-.00001 and len(lines[2:])<=2 and " ".join(lines[2:])==page["text"].replace("\n"," ")
 last=end

def pcm(path):
 raw=subprocess.check_output(["ffmpeg","-v","error","-i",str(path),"-vn","-ar","48000","-ac","1","-f","f32le","-"])
 result=array.array("f");result.frombytes(raw);return result
encoded_pcm=pcm(VIDEO);alignment=[]
for q in phrases:
 expected=pcm(OUT/q["audio"]);at=round(q["global_start"]*48000);sound=encoded_pcm[at:at+len(expected)]
 score=sum(x*y for x,y in zip(expected,sound))/math.sqrt(sum(x*x for x in expected)*sum(y*y for y in sound))
 assert score>.94,(q["id"],score)
 alignment.append({"id":q["id"],"correlation":score})
print("62 complete spoken phrases align, including the SC2006 academic credit and thanks.",flush=True)

samples=[]
for n,page in enumerate(pages):
 if page["on_card"]:continue
 for label,t in [("onset",page["global_start"]+.2),("middle",(page["global_start"]+page["global_end"])/2),("tail",page["global_end"]-.2)]:
  samples.append({"page":n+1,"label":label,"frame":round(t*30)})
frames=sorted({s["frame"] for s in samples})
def selection(items):
 if len(items)==1:return f"eq(n,{items[0]})"
 mid=len(items)//2;return f"({selection(items[:mid])}+{selection(items[mid:])})"
subprocess.run(["ffmpeg","-v","error","-y","-threads","2","-i",str(VIDEO),"-vf",f"select='{selection(frames)}',crop=1920:100:0:980","-fps_mode","vfr","-threads","1",str(QA/"caption-%03d.png")],check=True)
paths={f:QA/f"caption-{n+1:03d}.png" for n,f in enumerate(frames)}
for sample in samples:
 hist=Image.open(paths[sample["frame"]]).convert("L").histogram();light=sum(hist[180:]);dark=sum(hist[:100])
 assert light>200 and dark>10000,(sample,light,dark)
midpoints=[s for s in samples if s["label"]=="middle"]
for start in range(0,len(midpoints),12):
 group=midpoints[start:start+12];sheet=Image.new("RGB",(1920,len(group)*122),"#20252A");draw=ImageDraw.Draw(sheet)
 for row,sample in enumerate(group):
  draw.text((10,row*122+2),f"Page{sample['page']} frame{sample['frame']}",fill="white")
  sheet.paste(Image.open(paths[sample["frame"]]).convert("RGB"),(0,row*122+20))
 sheet.save(QA/f"caption-sheet-{start//12+1}.jpg",quality=95)
print("186 encoded neutral-caption samples have visible text contrast.",flush=True)

def frame(path,t,name,crop=None):
 target=QA/name;args=["ffmpeg","-v","error","-y","-ss",str(t),"-i",str(path),"-frames:v","1"]
 if crop:args.extend(["-vf",crop])
 subprocess.run(args+[str(target)],check=True)
 return Image.open(target).convert("RGB")
endpoints=[]
for p in data["pov_handoffs"]:
 if p.get("opening"):continue
 shot=next(s for s in data["shots"] if s["index"]==p["index"])
 at=p["end"]+1/30;source_time=(at-shot["sequence_start"])*shot["playback_rate"]
 actual=frame(VIDEO,at,f"return-{p['index']}-{p.get('animation','desk')}.png","crop=1860:882:30:59")
 expected=frame(PROJECT/"public"/shot["render_file"],source_time,f"source-{p['index']}-{p.get('animation','desk')}.png","crop=1860:882:30:59")
 error=sum(ImageStat.Stat(ImageChops.difference(actual,expected)).mean)/3
 assert error<5,(p,error)
 endpoints.append({"actor":p["actor"],"kind":p.get("animation","desktop"),"time":at,"source_time":source_time,"mean_pixel_error":error})
assert len(endpoints)==14
# Neutral subtitle surfaces must be absent in actual encoded silent gaps.
gaps=[]
for left,right in zip(pages,pages[1:]):
 if right["global_start"]-left["global_end"]>.12:
  at=(left["global_end"]+right["global_start"])/2
  strip=frame(VIDEO,at,f"gap-{len(gaps):02d}.png","crop=240:20:0:1040")
  mean=ImageStat.Stat(strip).mean;distance=sum(abs(x-y) for x,y in zip(mean,[32,37,42]))/3
  if 38.1<=at<40.3:
   bottom=frame(VIDEO,at,"bridge-empty-caption-zone.png","crop=1920:92:0:988")
   assert sum(bottom.convert("L").histogram()[180:])<10
  else:assert distance>5,(at,mean)
  gaps.append({"time":at,"distance_from_caption_surface":distance})
assert len(gaps)==46
# The moving i-dot is absent at its original position in flight, then both real
# font glyph dots are restored. These inspect the encoded video, not the editor.
card_start=data["chapters"][-1]["sequence_start"]+15
metrics=json.loads((PROJECT/"src/wordmark-metrics.json").read_text());left=(1920-metrics["width"]-4)/2
flying=frame(VIDEO,card_start+80/30,"dot-in-flight.png")
settled=frame(VIDEO,card_start+5.2,"dot-settled.png")
def luma(image,x,y):
 crop=image.crop((round(x)-2,round(y)-2,round(x)+3,round(y)+3)).convert("L")
 return ImageStat.Stat(crop).mean[0]
i=metrics["iDot"];period=metrics["period"]
assert luma(flying,left+i["x"],260+i["y"])<50
assert luma(settled,left+i["x"],260+i["y"])>220
assert luma(settled,left+period["x"],260+period["y"])>220
# The fictional payoff progresses from one visible player to three; the actual
# encoded shot must visibly change from the empty-court setup to the selfie.
social_start=data["chapters"][-1]["sequence_start"]
alone=frame(VIDEO,social_start+2,"social-alone.png")
group=frame(VIDEO,social_start+12,"social-group-selfie.png")
assert sum(ImageStat.Stat(ImageChops.difference(alone,group)).mean)/3>15
# The full opening survives beyond the reported3.2-second preview cutoff.
opening=frame(VIDEO,119/30,"opening-after-cutoff.png")
assert sum(ImageStat.Stat(opening.crop((0,70,1920,960))).var)>1000
closing=frame(VIDEO,data["duration"]-1,"final-academic-credit.png")
layout=json.loads((QA/"studio-caption-layout.json").read_text());assert layout["all_text_matches"] and layout["lingering_caption_pages"]==0
with open(QA/"decode.log","wb") as log:subprocess.run(["ffmpeg","-v","error","-threads","2","-i",str(VIDEO),"-f","null","-"],stdout=log,stderr=log,check=True)
assert (QA/"decode.log").stat().st_size==0
report={"status":"passed","duration":float(probe["format"]["duration"]),"resolution":[1920,1080],"fps":30,"video_frames":int(v["nb_frames"]),"video_bitrate_bps":int(v["bit_rate"]),"codec":"H.264/AAC","narration_phrases":62,"caption_pages":65,"neutral_encoded_caption_samples":len(samples),"speech_alignment":alignment,"minimum_speech_correlation":min(x["correlation"] for x in alignment),"studio_text_style_gap_and_semantic_audit":layout,"ui_return_checks":endpoints,"encoded_silent_gap_checks":gaps,"i_dot_animation":"in-flight source dot removed; original i-dot and real full-stop glyph restored at landing","opening_cutoff_check":"full scene visible at frame119, after prior96-frame preview cutoff","final_credit":"Booking Web Manager by SC2006 Group3; Thank you for watching","full_decode":"passed","continuous_human_listening_review":"not_performed","sha256":hashlib.sha256(VIDEO.read_bytes()).hexdigest()}
ranges=data["landing_rerecord"]["retimed_contiguous_source_ranges"]
assert sum(r["output_frames"] for r in ranges)==900
assert all(a["out_frame"]==b["in_frame"] for a,b in zip(ranges,ranges[1:]))
old_frame=frame(VIDEO,479/30,"opening-landing-before.png","crop=1760:850:80:70")
new_frame=frame(VIDEO,480/30,"opening-landing-after.png","crop=1760:850:80:70")
opening_landing_error=sum(ImageStat.Stat(ImageChops.difference(old_frame,new_frame)).mean)/3
assert opening_landing_error<3,opening_landing_error
report["opening_to_landing_mean_pixel_difference"]=opening_landing_error
report["selected_landing_source_ranges_contiguous"]=True
report["assembly_provenance"]=json.loads((QA/"assembly-provenance.json").read_text())
# The original foley occupies a voice-free interval before the academic line.
effects=pcm(PROJECT/"public/audio/endcard-foley-v6.wav")
at=round(374.3*48000);limit=round(5.35*48000)
expected=effects[:limit];sound=encoded_pcm[at:at+limit]
foley_score=sum(x*y for x,y in zip(expected,sound))/math.sqrt(sum(x*x for x in expected)*sum(y*y for y in sound))
assert foley_score>.7,foley_score
report["closing_foley_correlation"]=foley_score
report["closing_foley_timed_events"]=data["sound_effects"]["events"]
report["landing_capture"]=data["landing_rerecord"]
VIDEO.with_suffix(".verification.json").write_text(json.dumps(report,indent=2)+"\n")
print(f"PASS: {data['duration']}s; {int(v['bit_rate'])/1e6:.3f}Mbps;62 aligned phrases;65 caption pages;46 clear gaps;14 full UI returns.",flush=True)
