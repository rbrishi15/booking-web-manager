import React from 'react';
import {Easing, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Caption} from '@remotion/captions';
import portals from './portals.json';
import data from './timeline.json';

export const CaptionFrame:React.FC<{children:React.ReactNode;absoluteStart:number}>=({children,absoluteStart})=>{
 const frame=useCurrentFrame();const {fps}=useVideoConfig();const local=frame/fps;const t=absoluteStart+local;
 const portal=portals.find(p=>t>=p.start && t<p.end);
 const shot=data.shots.find(s=>t>=s.sequence_start && t<s.sequence_start+s.duration) || data.shots.find(s=>s.sequence_start>t);
 const chapter=data.chapters.find(c=>t>=c.sequence_start && t<c.sequence_start+c.duration);
 const actor=portal?.actor || (shot?.actor.startsWith('HARRISON')?'Harrison':shot?.actor.startsWith('JOSEPH')?'Joseph':'Neoh');
 const custom=Boolean(portal && 'kind' in portal && portal.kind==='plan-change');
 const progress=portal?interpolate(t,custom?[portal.end-.42,portal.end]:[portal.zoomStart,portal.zoomEnd],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.bezier(.62,0,.2,1)}):1;
 const headerOpacity=interpolate(progress,[.8,1],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
 const node=React.isValidElement<{captions?:Caption[]}>(children)?children:null;
 // BasicCaptions pages extend to the next page. Gate them with the actual cue
 // end so a previous sentence cannot linger into a different explanatory card.
 const cue=node?.props.captions?.find(c=>local*1000>=c.startMs && local*1000<c.endMs);
 const fade=cue?Math.min(interpolate(local*1000,[cue.startMs,cue.startMs+180],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),interpolate(local*1000,[cue.endMs-180,cue.endMs],[1,0],{extrapolateLeft:'clamp',extrapolateRight:'clamp'})):0;
 const height=cue&&cue.text.includes('\n')?92:62;
 const environment=chapter?.id==='landing'?'Live app':chapter?.id==='attendance'?'Prepared ended session':chapter?.id==='changes'?(local<(chapter.cues.find(q=>q.id==='changes-09')?.start ?? 54.6)?'Early example · 48 h':'Late example · 10 h'):'Prepared demo';
 return <>
  {chapter?.id!=='ending'&&<div style={{position:'absolute',left:0,top:0,width:1920,height:44,background:'#20252A',opacity:headerOpacity,display:'flex',alignItems:'center',padding:'0 30px',color:'#F5F5F3',gap:10}}>
   <span style={{width:25,height:25,borderRadius:13,display:'inline-flex',alignItems:'center',justifyContent:'center',background:actor==='Harrison'?'#AFC6DE':actor==='Joseph'?'#E7B49A':'#C8D6A8',color:'#273B33',fontSize:14,fontWeight:700}}>{actor[0]}</span>
   <span style={{fontSize:20,fontWeight:500}}>{actor}</span>
   {shot&&shot.playback_rate>1.05&&<span style={{fontSize:15,color:'#D5DBD9',marginLeft:10}}>{shot.playback_rate.toFixed(2)}× entry</span>}
   <span style={{fontSize:17,color:'#C2CBC7',marginLeft:'auto'}}>{environment}</span>
  </div>}
  {cue&&<div data-caption-surface style={{position:'absolute',bottom:0,left:0,width:1920,height,background:'#20252A',opacity:fade,display:'flex',alignItems:'center',justifyContent:'center',padding:'16px 30px'}}><div data-demo-captions="neutral" style={{width:1240,display:'flex',justifyContent:'center',color:'#F5F5F3'}}>{children}</div></div>}
 </>;
};
