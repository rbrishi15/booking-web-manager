"""Measure the exact Inter Black glyphs used by the app for the dot animation."""
import io,json
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import DecomposingRecordingPen,replayRecording
import uharfbuzz as hb
project=Path(__file__).resolve().parent/'remotion'
font=TTFont(project/'public/fonts/inter-v20-latin.woff2')
if 'fvar' in font:font=instantiateVariableFont(font,{'wght':900},inplace=False)
font.flavor=None;bio=io.BytesIO();font.save(bio)
face=hb.Face(bio.getvalue());shape=hb.Font(face);hb.ot_font_set_funcs(shape);upem=font['head'].unitsPerEm;shape.scale=(upem,upem)
buf=hb.Buffer();buf.add_str('Booking.');buf.guess_segment_properties();hb.shape(shape,buf,{'kern':True})
glyphs=font.getGlyphSet();scale=160/upem;baseline=200;cursor=0;out={}
for info,pos in zip(buf.glyph_infos,buf.glyph_positions):
 name=font.getGlyphName(info.codepoint)
 if info.cluster in [4,7]:
  pen=DecomposingRecordingPen(glyphs);glyphs[name].draw(pen);contours=[];part=[]
  for op in pen.value:
   part.append(op)
   if op[0] in ['closePath','endPath']:
    b=BoundsPen(glyphs);replayRecording(part,b);contours.append(b.bounds);part=[]
  box=max(contours,key=lambda b:b[3]) if info.cluster==4 else (lambda b:b.bounds)(BoundsPen(glyphs))
  if info.cluster==7:
   b=BoundsPen(glyphs);glyphs[name].draw(b);box=b.bounds
  x0,y0,x1,y1=box
  out['iDot' if info.cluster==4 else 'period']={'x':(cursor+pos.x_offset+(x0+x1)/2)*scale,'y':baseline-(pos.y_offset+(y0+y1)/2)*scale,'width':(x1-x0)*scale,'height':(y1-y0)*scale}
 cursor+=pos.x_advance
out.update(fontSize=160,baseline=baseline,width=cursor*scale,upem=upem,source='components/ui/booking-logo.tsx + inter-v20-latin.woff2; weight900; HarfBuzz kern')
(project/'src/wordmark-metrics.json').write_text(json.dumps(out,indent=2)+'\n');print(out)
