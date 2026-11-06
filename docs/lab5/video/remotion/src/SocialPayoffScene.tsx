import React from 'react';
import {AbsoluteFill,Easing,interpolate,useCurrentFrame,useVideoConfig} from 'remotion';
import {BookingLogo} from './BookingLogo';
import type {Actor} from './DeskScene';

const ease={extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.bezier(.22,1,.36,1)} as const;
const smooth={extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.inOut(Easing.cubic)} as const;
const colors={
 Neoh:{shirt:'#54765C',dark:'#354E3E',skin:'#D8A980',shade:'#BD8965',hair:'#29382F'},
 Harrison:{shirt:'#6588B0',dark:'#365675',skin:'#DAB28E',shade:'#BD8D69',hair:'#43342C'},
 Joseph:{shirt:'#CA795D',dark:'#8E4E3C',skin:'#BD8B68',shade:'#9F6E50',hair:'#2D2C29'},
};

/** A fictional tennis-day illustration, using the same identities as the desks. */
const TennisPlayer:React.FC<{actor:Actor;x:number;t:number;arrival:number;selfie?:boolean}>=({actor,x,t,arrival,selfie=false})=>{
 const p=colors[actor];
 const settled=Math.min(t,9.55);
 const walk=interpolate(t,[arrival,arrival+1.1],[1,0],ease);
 const steps=Math.sin((t-arrival)*19)*walk;
 const grin=interpolate(t,[3.8,5.1],[0,1],smooth);
 const blink=(Math.floor(settled*30)+({Neoh:12,Harrison:46,Joseph:70}[actor]))%113<4;
 const lean=interpolate(t,[8.3,9.3],[0,actor==='Neoh'?6:actor==='Joseph'?-7:0],ease);
 const wave=actor==='Harrison'?interpolate(t,[4.3,4.7,5.1,5.5,5.9,6.4],[0,1,.65,1,.65,0],smooth):0;
 const lift=selfie?interpolate(t,[8.2,9.1],[0,1],ease):0;
 return <g data-social-player={actor} transform={`translate(${x} ${520-Math.abs(steps)*9}) rotate(${lean} 0 -30)`}>
  <ellipse cx="3" cy="285" rx="106" ry="19" fill="#213D3328"/>
  <g transform={`rotate(${steps*7} -43 150)`}><path d="M-67 113L-9 119-29 268-76 268Z" fill="#33483F"/><path d="M-76 256H-30L-18 282Q-59 294-94 280Z" fill="#F7F2E4"/><path d="M-87 281H-19" stroke="#B7BAAE" strokeWidth="5"/></g>
  <g transform={`rotate(${-steps*7} 43 150)`}><path d="M10 119L66 113 77 268H30Z" fill="#3D554B"/><path d="M31 256H78L98 279Q63 295 22 282Z" fill="#F7F2E4"/><path d="M24 282H93" stroke="#B7BAAE" strokeWidth="5"/></g>
  <path d="M-82-60Q-38-91 1-87 41-91 82-60L87 119Q0 146-87 119Z" fill={p.shirt}/>
  <path d="M-82-60L-55-75-55 127-87 119Z" fill={p.dark} opacity=".3"/>
  <path d="M-84 104Q0 125 87 104V132H-87Z" fill={p.dark}/>
  <path d="M3-77V-23" stroke="#F6F1DD55" strokeWidth="4"/><path d="M2-78L-21-59-38-80M2-78L25-59 39-80" fill="none" stroke={p.dark} strokeWidth="4"/>
  <g transform={`rotate(${lift*96+wave*112} -75 -40)`}>
   <path d="M-77-43Q-111 6-104 63L-120 120" fill="none" stroke={p.shirt} strokeWidth="34" strokeLinecap="round"/>
   <path d="M-120 119L-127 145" stroke={p.skin} strokeWidth="26" strokeLinecap="round"/>
   <path d="M-121 142L-125 158" stroke={p.shade} strokeWidth="2"/>
   {selfie&&<g style={{opacity:lift}} transform="translate(-129 140) rotate(-95)"><rect x="-21" y="-52" width="43" height="76" rx="9" fill="#192A26" stroke="#536A5D" strokeWidth="3"/><rect x="-15" y="-46" width="26" height="23" rx="5" fill="#41574B"/><circle cx="-7" cy="-38" r="5" fill="#111D18"/><circle cx="5" cy="-30" r="5" fill="#111D18"/></g>}
  </g>
  <g transform={`rotate(${-steps*8} 75 -40)`}>
   <path d="M77-43Q111 10 106 72L118 128" fill="none" stroke={p.shirt} strokeWidth="34" strokeLinecap="round"/>
   <path d="M118 127L121 152" stroke={p.skin} strokeWidth="26" strokeLinecap="round"/>
   {!selfie&&<g transform="translate(123 145) rotate(-18)"><path d="M0 0V76" stroke="#334E43" strokeWidth="12" strokeLinecap="round"/><ellipse cx="0" cy="121" rx="42" ry="56" fill="#D6DFBE88" stroke={p.dark} strokeWidth="7"/><path d="M-22 77V164M0 67V176M22 77V164M-36 98H36M-41 121H41M-36 144H36" stroke="#F0EDDC" strokeWidth="2"/></g>}
  </g>
  <rect x="-24" y="-121" width="48" height="48" rx="19" fill={p.shade}/>
  <g transform={`rotate(${interpolate(t,[0,3.8,5.2],[9,9,0],smooth)} 0 -140)`}>
   <ellipse cx="-53" cy="-167" rx="13" ry="19" fill={p.skin}/><ellipse cx="53" cy="-167" rx="13" ry="19" fill={p.skin}/>
   <path d="M-56-200Q-59-251 1-251 61-251 56-200L49-145Q34-114 0-113-36-115-49-145Z" fill={p.skin}/>
   <path d="M-55-200L-43-147Q-24-122 0-113-34-114-49-145Z" fill={p.shade} opacity=".4"/>
   {actor==='Harrison'?<g fill={p.hair}><path d="M-58-187Q-77-239-32-257 34-280 61-226L57-193 33-221 8-205-24-224-47-187Z"/><circle cx="-41" cy="-245" r="20"/><circle cx="-12" cy="-259" r="22"/><circle cx="20" cy="-256" r="23"/><circle cx="46" cy="-238" r="19"/></g>:<path d={actor==='Neoh'?'M-57-182Q-77-231-38-258 23-286 60-230L57-191 40-216 13-204-14-215-47-191-47-173Z':'M-57-181Q-79-234-38-258 17-283 59-238L63-205 39-214 18-206-12-221-45-188-47-170Z'} fill={p.hair}/>}
   <path d="M-35-191Q-23-197-12-192M13-192Q27-198 37-191" fill="none" stroke={p.hair} strokeWidth="5" strokeLinecap="round"/>
   {blink?<path d="M-31-178H-16M18-178H33" stroke="#26382E" strokeWidth="4" strokeLinecap="round"/>:<g><ellipse cx="-24" cy="-178" rx="10" ry="7" fill="#FFF8EB"/><ellipse cx="25" cy="-178" rx="10" ry="7" fill="#FFF8EB"/><circle cx="-22" cy="-177" r="4.5" fill="#26382E"/><circle cx="23" cy="-177" r="4.5" fill="#26382E"/></g>}
   {actor==='Joseph'&&<g fill="none" stroke="#35483C" strokeWidth="3.5"><rect x="-43" y="-193" width="38" height="29" rx="11"/><rect x="7" y="-193" width="38" height="29" rx="11"/><path d="M-5-181H7M-43-181H-55M45-181H56"/></g>}
   <path d="M0-176L-5-158H5" fill="none" stroke={p.shade} strokeWidth="3" strokeLinecap="round"/>
   <path d={`M-17-141Q0 ${-146+grin*24} 18-142`} fill={grin>.7?'#FFF6E8':'none'} stroke="#865842" strokeWidth="3.5" strokeLinecap="round"/>
   <ellipse cx="-39" cy="-155" rx="9" ry="4" fill="#CF876C" opacity={grin*.35}/><ellipse cx="39" cy="-155" rx="9" ry="4" fill="#CF876C" opacity={grin*.35}/>
  </g>
 </g>;
};

export const SocialPayoffScene:React.FC=()=>{
 const frame=useCurrentFrame();const {fps}=useVideoConfig();const t=frame/fps;
 const photo=interpolate(t,[9.2,10.8],[0,1],ease);
 const zoom=interpolate(t,[8.2,9.5],[1,1.38],smooth);
 const nx=interpolate(t,[3.8,5.2,7.8,8.7],[940,750,750,760],ease);
 const hx=interpolate(t,[4.25,5.6,7.8,8.7],[2040,1080,1080,985],ease);
 const jx=interpolate(t,[5.8,7.2,7.8,8.7],[2180,1400,1400,1210],ease);
 return <AbsoluteFill data-social-payoff style={{background:'#F6F3EB',overflow:'hidden',fontFamily:'Inter',color:'#1B2A22'}}>
  <BookingLogo size={35} style={{position:'absolute',left:112,top:65}}/>
  <div style={{position:'absolute',right:112,top:77,fontSize:18,letterSpacing:1.3,color:'#777B70'}}>STORY ILLUSTRATION</div>
  <div style={{position:'absolute',left:112,top:140,fontFamily:'Outfit',fontSize:58,fontWeight:500,opacity:interpolate(t,[0,.6,4.2,4.7],[0,1,1,0],smooth),translate:interpolate(t,[0,.6],['0px 14px','0px 0px'],ease)}}>One court. No one to play with.</div>
  <div style={{position:'absolute',left:112,top:140,fontFamily:'Outfit',fontSize:58,fontWeight:500,opacity:interpolate(t,[4.7,5.3],[0,1],smooth),translate:interpolate(t,[4.7,5.3],['0px 14px','0px 0px'],ease)}}>A shared game. A new connection.</div>
  <div data-selfie-frame style={{position:'absolute',left:90,top:245,width:1740,height:650,background:'#FFFDF7',borderRadius:30,overflow:'hidden',boxShadow:`0 ${10+photo*20}px ${25+photo*30}px #243E2D${photo>.2?'24':'10'}`,scale:interpolate(t,[9.2,10.8],[1,.86],ease),rotate:interpolate(t,[9.2,10.8],['0deg','-2deg'],ease),translate:interpolate(t,[9.2,10.8],['0px 0px','0px -8px'],ease),border:`${photo*16}px solid #FFFDF7`,boxSizing:'border-box'}}>
   <svg width="100%" height="100%" viewBox="0 0 1920 860" preserveAspectRatio="xMidYMid slice" style={{position:'absolute',inset:0}}>
    <defs>
     <linearGradient id="social-sky" x2="0" y2="1"><stop stopColor="#E5ECD9"/><stop offset="1" stopColor="#F9F3DF"/></linearGradient>
     <linearGradient id="social-court" x2="0" y2="1"><stop stopColor="#A2B89A"/><stop offset="1" stopColor="#688C74"/></linearGradient>
     <pattern id="social-fence" width="34" height="34" patternUnits="userSpaceOnUse"><path d="M17 0L34 17 17 34 0 17Z" fill="none" stroke="#688474" strokeWidth="1.4" opacity=".25"/></pattern>
    </defs>
    <g transform={`translate(${960-960*zoom} ${420-420*zoom}) scale(${zoom})`}>
     <rect width="1920" height="860" fill="url(#social-sky)"/>
     <circle cx="1520" cy="140" r="90" fill="#FFF8DE"/>
     <path d="M0 300Q150 210 330 300 450 182 620 293 815 196 980 286 1210 202 1400 295 1600 189 1800 282L1920 240V480H0Z" fill="#BBCDAE"/>
     <path d="M0 365Q180 274 345 361 580 263 795 369 1050 284 1280 367 1560 263 1920 357V510H0Z" fill="#8FAB8C"/>
     <rect x="0" y="290" width="1920" height="255" fill="url(#social-fence)"/><path d="M0 290H1920M0 530H1920M220 290V530M640 290V530M1060 290V530M1480 290V530M1900 290V530" stroke="#658370" strokeWidth="5" opacity=".55"/>
     <path d="M0 530H1920V860H0Z" fill="#ADBD9F"/>
     <path d="M140 530H1780L2060 860H-140Z" fill="url(#social-court)"/>
     <path d="M140 530H1780L2060 860M140 530L-140 860M350 530L140 860M1570 530L1780 860M45 665H1880M960 530V860" fill="none" stroke="#F5F1D8" strokeWidth="5"/>
     <path d="M0 542H1920" stroke="#F2EDD6" strokeWidth="9"/>
     <TennisPlayer actor="Neoh" x={nx} t={t} arrival={-1} selfie/>
     {t>=4.25&&<TennisPlayer actor="Harrison" x={hx} t={t} arrival={4.25}/>}
     {t>=5.8&&<TennisPlayer actor="Joseph" x={jx} t={t} arrival={5.8}/>}
     <g opacity={interpolate(t,[7.4,7.8,8.2,8.6],[0,1,1,0],smooth)}>
      <path d="M800 218Q1000 130 1200 218" fill="none" stroke="#F9F4DA" strokeWidth="3" strokeDasharray="9 12"/>
      <circle cx="800" cy="218" r="8" fill="#FAF5DD"/><circle cx="1000" cy="175" r="8" fill="#FAF5DD"/><circle cx="1200" cy="218" r="8" fill="#FAF5DD"/>
     </g>
    </g>
    <g opacity={interpolate(t,[8.6,8.9,9.25,9.5],[0,1,1,0],smooth)} fill="none" stroke="#FFFEF3" strokeWidth="5" strokeLinecap="round"><path d="M460 200V155H505M1415 155H1460V200M460 625V670H505M1415 670H1460V625"/><circle cx="960" cy="410" r="17" strokeWidth="2"/></g>
   </svg>
   <div style={{position:'absolute',inset:0,background:'#FFFFFF',opacity:interpolate(t,[9.45,9.52,9.76],[0,.9,0],{extrapolateLeft:'clamp',extrapolateRight:'clamp'})}}/>
   <div style={{position:'absolute',left:0,bottom:0,width:'100%',height:78,background:'#FFFDF7',display:'flex',alignItems:'center',justifyContent:'center',fontSize:26,fontWeight:500,letterSpacing:.6,opacity:interpolate(t,[9.8,10.4],[0,1],smooth)}}>Neoh · Harrison · Joseph</div>
  </div>
  <div style={{position:'absolute',left:0,top:913,width:'100%',textAlign:'center',fontFamily:'Outfit',fontSize:30,fontWeight:500,color:'#425A48',opacity:interpolate(t,[10.6,11.4],[0,1],smooth),translate:interpolate(t,[10.6,11.4],['0px 10px','0px 0px'],ease)}}>A game today. A group for next time.</div>
 </AbsoluteFill>;
};
