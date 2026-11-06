import React from 'react';
import {AbsoluteFill,Easing,interpolate,useCurrentFrame,useVideoConfig,staticFile} from 'remotion';
import {Audio} from '@remotion/media';
import metrics from './wordmark-metrics.json';
import data from './timeline.json';
const ease={extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.inOut(Easing.cubic)} as const;
const lift={extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.out(Easing.cubic)} as const;

/** Exact Inter Black glyph metrics; the flying dot resolves into the real glyph. */
export const FancyEndCard:React.FC<{soundEffects?:boolean}>=({soundEffects=true})=>{
 const frame=useCurrentFrame();const {fps}=useVideoConfig();const t=frame/fps;
 const i=metrics.iDot;const period=metrics.period;
 const x=interpolate(t,[2.2,2.65,3.2,3.8,4.4,4.65,4.9],[i.x,i.x+45,i.x+100,i.x+175,period.x,period.x,period.x],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
 const y=interpolate(t,[2.2,2.65,3.2,3.8,4.4,4.65,4.9],[i.y,i.y-67,period.y+10,i.y-35,period.y,period.y-27,period.y],ease);
 const chapter=data.chapters.find(c=>c.id==='ending')!;
 const credit=chapter.cues.find(c=>c.id==='ending-academic-01')!;
 const thanks=chapter.cues.find(c=>c.id==='ending-academic-02')!;
 const endingLocal=t+15;
 const nameActive=endingLocal>=credit.start&&endingLocal<credit.start+1.525;
 const groupActive=endingLocal>=credit.start+1.525&&endingLocal<credit.end;
 const thanksActive=endingLocal>=thanks.start&&endingLocal<thanks.end;
 return <AbsoluteFill data-fancy-end-card style={{background:'#000000',overflow:'hidden'}}>
  {soundEffects&&<Audio name="Dot lift and soft bounce foley" src={staticFile("audio/endcard-foley-v6.wav")} premountFor={fps}/>}
  <div data-end-orb="left" style={{position:'absolute',width:2200,height:2200,borderRadius:'50%',left:-1300,top:-1800,background:'radial-gradient(circle closest-side at 50% 50%,#020202 58%,#111112 84%,#49494B 96%,#E1E1E3 100%)',border:'1px solid #FFFFFF99',opacity:interpolate(t,[0,1.2],[0,1],ease),translate:interpolate(t,[0,1.2],['-20px -16px','0px 0px'],lift)}}/>
  <div data-end-orb="right" style={{position:'absolute',width:2800,height:2800,borderRadius:'50%',left:810,top:560,background:'radial-gradient(circle closest-side at 50% 50%,#020202 58%,#101011 84%,#444446 96%,#DCDCDD 100%)',border:'1px solid #FFFFFF99',opacity:interpolate(t,[.35,1.55],[0,1],ease),translate:interpolate(t,[.35,1.55],['20px 16px','0px 0px'],lift)}}/>
  <svg data-animated-wordmark width={metrics.width+4} height="260" viewBox={`0 0 ${metrics.width+4} 260`} style={{position:'absolute',left:(1920-metrics.width-4)/2,top:260,overflow:'visible',opacity:interpolate(t,[1.2,1.8],[0,1],ease)}}>
   <defs><mask id="booking-dot-mask"><rect width="100%" height="100%" fill="white"/>
    <rect x={i.x-i.width/2-1} y={i.y-i.height/2-1} width={i.width+2} height={i.height+2} fill="black" opacity={interpolate(t,[2.19,2.2,4.9,5.1],[0,1,1,0],{extrapolateLeft:'clamp',extrapolateRight:'clamp'})}/>
    <rect x={period.x-period.width/2-1} y={period.y-period.height/2-1} width={period.width+2} height={period.height+2} fill="black" opacity={interpolate(t,[4.9,5.1],[1,0],ease)}/>
   </mask></defs>
   <text data-booking-logo x="0" y={metrics.baseline} mask="url(#booking-dot-mask)" fill="#FAFAFA" style={{fontFamily:'Inter',fontSize:160,fontWeight:900,fontStyle:'normal',letterSpacing:0,fontKerning:'normal'}}>Booking.</text>
   {t>=2.2&&t<5.1&&<ellipse data-flying-dot cx={x} cy={y} rx={interpolate(t,[2.2,4.9],[i.width/2,period.width/2],lift)} ry={interpolate(t,[2.2,3.16,3.2,3.28,4.37,4.4,4.48,4.9],[i.height/2,15,10,15,15,11,15,period.height/2],{extrapolateLeft:'clamp',extrapolateRight:'clamp'})} fill="#FAFAFA" opacity={interpolate(t,[4.9,5.1],[1,0],ease)}/>}
  </svg>
  <div data-demo-captions={nameActive?'closing-name':undefined} style={{position:'absolute',left:300,top:555,width:1320,textAlign:'center',fontFamily:'Inter',fontSize:40,fontWeight:600,letterSpacing:1,color:'#F5F5F3',opacity:interpolate(t,[5.3,5.7],[0,1],ease),translate:interpolate(t,[5.3,5.7],['0px 9px','0px 0px'],lift)}}>Booking Web Manager</div>
  <div data-demo-captions={groupActive?'closing-credit':undefined} style={{position:'absolute',left:300,top:624,width:1320,textAlign:'center',fontFamily:'Inter',fontSize:30,fontWeight:500,fontStyle:'italic',letterSpacing:2,color:'#F5F5F3',opacity:interpolate(t,[6.9,8.3],[0,1],ease)}}>by SC2006 Group 3.</div>
  <div style={{position:'absolute',left:900,top:707,width:120,height:2,background:'#DDD',opacity:interpolate(t,[8.1,8.7],[0,1],ease)}}/>
  <div data-demo-captions={thanksActive?'closing-thanks':undefined} style={{position:'absolute',left:300,top:762,width:1320,textAlign:'center',fontFamily:'Inter',fontSize:28,fontWeight:500,fontStyle:'italic',letterSpacing:2,color:'#F5F5F3',opacity:interpolate(t,[10.8,11.2],[0,1],ease)}}>Thank you for watching.</div>
 </AbsoluteFill>;
};
