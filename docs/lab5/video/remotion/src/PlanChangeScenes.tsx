import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {BookingLogo} from './BookingLogo';

const ink = '#233E35';
const green = '#47755C';
const blue = '#6585A3';
const clay = '#AF795A';
const motion = {extrapolateLeft:'clamp', extrapolateRight:'clamp', easing:Easing.bezier(.2,.7,.2,1)} as const;

const Check:React.FC<{color?:string}>=({color=green})=><svg width="42" height="42" viewBox="0 0 42 42"><circle cx="21" cy="21" r="20" fill={color}/><path d="M11 21L18 28 31 14" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const Lock:React.FC<{color?:string}>=({color=green})=><svg width="60" height="66" viewBox="0 0 60 66"><path d="M17 29V19a13 13 0 0126 0v10" fill="none" stroke={color} strokeWidth="5"/><rect x="7" y="27" width="46" height="35" rx="10" fill={color}/><circle cx="30" cy="42" r="4" fill="#fff"/><path d="M30 43v8" stroke="#fff" strokeWidth="3"/></svg>;

const Clock:React.FC<{hours:string;color:string;at?:number}>=({hours,color,at=0})=>{
 const f=useCurrentFrame();const {fps}=useVideoConfig();
 return <div style={{position:'relative',width:248,height:248}}>
  <svg width="248" height="248" viewBox="0 0 248 248" style={{display:'block'}}>
   <circle cx="124" cy="124" r="112" fill="#fff" stroke={color} strokeWidth="3" opacity=".45"/>
   <circle cx="124" cy="124" r="101" fill="none" stroke={color} strokeWidth="8" strokeDasharray="635" strokeDashoffset={interpolate(f,[at*fps,(at+1.5)*fps],[635,95],motion)} strokeLinecap="round" style={{rotate:'-90deg',transformOrigin:'124px 124px'}}/>
   <path d="M124 40V49M124 199V208M40 124H49M199 124H208" stroke={color} strokeWidth="3"/>
   <g style={{rotate:interpolate(f,[at*fps,(at+1.4)*fps],['-70deg','30deg'],motion),transformOrigin:'124px 124px'}}><path d="M124 124V67" stroke={color} strokeWidth="6" strokeLinecap="round"/></g>
   <path d="M124 124L155 141" stroke={color} strokeWidth="6" strokeLinecap="round"/><circle cx="124" cy="124" r="7" fill={color}/>
  </svg>
  <div style={{position:'absolute',left:65,right:65,top:156,textAlign:'center',fontFamily:'Outfit',fontSize:33,fontWeight:500,color}}>{hours}</div>
 </div>;
};

const Person:React.FC<{name:string;color:string;selected?:boolean}>=({name,color,selected})=><div style={{display:'flex',alignItems:'center',gap:20}}><div style={{width:76,height:76,borderRadius:38,background:color,color:'#fff',fontFamily:'Outfit',fontSize:34,display:'flex',alignItems:'center',justifyContent:'center'}}>{name[0]}</div><div style={{fontSize:31,fontWeight:500}}>{name}</div>{selected&&<div style={{marginLeft:'auto'}}><Check/></div>}</div>;

const Coin:React.FC=()=> <div style={{width:132,height:132,borderRadius:66,background:'#E8C673',border:'6px solid #F4DA91',boxShadow:'0 12px 24px #72614215',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Outfit',fontSize:34,fontWeight:600,color:'#614D2B'}}>S$10</div>;

const Shell:React.FC<{duration:number;children:React.ReactNode}>=({duration,children})=>{
 const f=useCurrentFrame();const {fps}=useVideoConfig();
 return <AbsoluteFill data-plan-change-animation style={{background:'#F3F1E8',color:ink,overflow:'hidden',opacity:interpolate(f,[(duration-.42)*fps,duration*fps],[1,0],motion)}}>
  <svg width="1920" height="1080" style={{position:'absolute',opacity:.32}}><circle cx="1660" cy="185" r="390" fill="#DFE8D5"/><circle cx="55" cy="1100" r="470" fill="#E2E8DF"/><path d="M0 930H1920M1775 0V1080" stroke="#C9D2C4" strokeWidth="2"/></svg>
  <BookingLogo size={32} style={{position:'absolute',left:126,top:86}}/>
  {children}
 </AbsoluteFill>;
};

export const PlanChangeIntro:React.FC=()=>{
 const f=useCurrentFrame();const {fps}=useVideoConfig();
 return <Shell duration={9.95}>
  <div style={{position:'absolute',left:128,top:179,fontSize:20,fontWeight:600,letterSpacing:3.5,color:green}}>WHEN PLANS CHANGE</div>
  <div style={{position:'absolute',left:122,top:218,fontFamily:'Outfit',fontSize:100,fontWeight:500,letterSpacing:-2,translate:interpolate(f,[0,.6*fps],['0px 22px','0px 0px'],motion)}}>A clear way forward.</div>
  <div style={{position:'absolute',left:128,top:354,fontSize:32,color:'#687C6D',opacity:interpolate(f,[4.1*fps,4.6*fps],[0,1],motion)}}>Two separate examples. Our main game stays on.</div>
  <div style={{position:'absolute',right:130,top:100,display:'flex',alignItems:'center',gap:13,padding:'15px 24px',borderRadius:30,background:'#E4ECDD',opacity:interpolate(f,[4.1*fps,4.6*fps],[0,1],motion)}}><Check/><span style={{fontSize:25}}>Main game confirmed</span></div>
  <div style={{position:'absolute',left:126,top:454,width:800,height:385,borderRadius:30,background:'#fff',border:'2px solid #C5D6C4',boxShadow:'0 18px 45px #2A4E3510',opacity:interpolate(f,[.4*fps,.9*fps],[0,1],motion),translate:interpolate(f,[.4*fps,.8*fps],['-90px 45px','0px 0px'],motion),rotate:interpolate(f,[.4*fps,.8*fps],['-4deg','0deg'],motion)}}>
   <div style={{position:'absolute',left:38,top:36,fontSize:20,fontWeight:600,letterSpacing:2.4,color:green}}>EXAMPLE 01 · EARLY</div>
   <div style={{position:'absolute',left:36,top:93,fontFamily:'Outfit',fontSize:72,fontWeight:500}}>48 hours</div><div style={{position:'absolute',left:40,top:185,fontSize:29,color:'#718174'}}>before the session</div>
   <div style={{position:'absolute',left:40,top:285,display:'flex',alignItems:'center',gap:14,fontSize:27,color:green}}><span style={{height:10,width:10,borderRadius:5,background:green}}/>Refund + waitlist opening</div>
   <div style={{position:'absolute',right:29,top:71}}><Clock hours="48h" color={green} at={.8}/></div>
  </div>
  <div style={{position:'absolute',left:968,top:454,width:826,height:385,borderRadius:30,background:'#fff',border:'2px solid #DDCABC',boxShadow:'0 18px 45px #694B3510',opacity:interpolate(f,[1.1*fps,1.6*fps],[0,1],motion),translate:interpolate(f,[.85*fps,1.25*fps],['90px 45px','0px 0px'],motion),rotate:interpolate(f,[.85*fps,1.25*fps],['4deg','0deg'],motion)}}>
   <div style={{position:'absolute',left:38,top:36,fontSize:20,fontWeight:600,letterSpacing:2.4,color:clay}}>EXAMPLE 02 · LATE</div>
   <div style={{position:'absolute',left:36,top:93,fontFamily:'Outfit',fontSize:72,fontWeight:500}}>10 hours</div><div style={{position:'absolute',left:40,top:185,fontSize:29,color:'#89796C'}}>before the session</div>
   <div style={{position:'absolute',left:40,top:285,display:'flex',alignItems:'center',gap:14,fontSize:27,color:clay}}><span style={{height:10,width:10,borderRadius:5,background:clay}}/>A replacement must accept</div>
   <div style={{position:'absolute',right:29,top:71}}><Clock hours="10h" color={clay} at={1.5}/></div>
  </div>
  <div style={{position:'absolute',left:130,top:887,fontSize:22,color:'#7C897C'}}>Illustrated policy examples · Actual app demonstration follows</div>
 </Shell>;
};

type ChangeKind='early'|'early-refund'|'queue'|'late'|'accept'|'refund';
export const PlanChangeTransition:React.FC<{kind:ChangeKind;duration?:number}>=({kind,duration=3.2})=>{
 const f=useCurrentFrame();const {fps}=useVideoConfig();const t=f/fps;
 const actor=kind==='queue'||kind==='accept'?'Joseph':'Harrison';
 const late=kind==='late'||kind==='accept'||kind==='refund';const color=late?clay:green;
 const alternative=kind==='refund'&&t>=2.7125;
 const titles={early:'An early change of plan.','early-refund':'His share returns.',queue:'Next in the queue.',late:'The share stays held.',accept:'Joseph must accept.',refund:alternative?'Without a replacement…':'Acceptance unlocks the refund.'};
 const lines={early:'48 hours before the session','early-refund':'Harrison’s contribution, back in his wallet',queue:'The next eligible player can take the opening',late:'10 hours before the session',accept:'Accept the invitation and cover the place',refund:alternative?'The original share goes to the booker.':'Joseph accepted and covered the place.'};
 return <Shell duration={duration}>
  <div style={{position:'absolute',left:128,top:174,display:'flex',alignItems:'center',gap:14,fontSize:23,fontWeight:500,color}}><span style={{width:45,height:45,borderRadius:24,background:actor==='Harrison'?blue:clay,color:'#fff',display:'flex',alignItems:'center',justifyContent:'center'}}>{actor[0]}</span>{actor} · {late?'LATE EXAMPLE':'EARLY EXAMPLE'}</div>
  <div style={{position:'absolute',left:123,top:253,fontFamily:'Outfit',fontSize:kind==='refund'?76:88,fontWeight:500,letterSpacing:-1.6,opacity:interpolate(f,[0,.2*fps],[0,1],motion),translate:interpolate(f,[0,.2*fps],['0px 14px','0px 0px'],motion)}}>{titles[kind]}</div>
  <div style={{position:'absolute',left:130,top:371,fontSize:31,color:'#708071',opacity:interpolate(f,[.15*fps,.35*fps],[0,1],motion)}}>{lines[kind]}</div>
  <AbsoluteFill style={{opacity:interpolate(f,[.2*fps,.6*fps],[0,1],motion),translate:interpolate(f,[.2*fps,.6*fps],['0px 14px','0px 0px'],motion)}}>
  {kind==='early'&&<><div style={{position:'absolute',left:270,top:488}}><Clock hours="48h" color={green} at={.2}/></div><div style={{position:'absolute',left:850,top:510,width:750,padding:'30px 40px',borderRadius:27,background:'#fff',border:'2px solid #CFDAC9'}}><Person name="Harrison" color={blue}/><div style={{fontSize:30,color:green,marginTop:28}}>Decides to withdraw</div></div></>}
  {kind==='early-refund'&&<>
   <div style={{position:'absolute',left:220,top:508,padding:'26px 32px',borderRadius:24,background:'#E7ECDF',display:'flex',alignItems:'center',gap:23}}><Lock/><div style={{fontSize:26}}>Held contribution<div style={{fontFamily:'Outfit',fontSize:47}}>S$10</div></div></div>
   <div data-status-stage="early-money-moves" style={{position:'absolute',left:800,top:530,opacity:interpolate(f,[1.425*fps,1.6*fps],[0,1],motion),translate:interpolate(f,[1.425*fps,1.825*fps],['0px 0px','170px 0px'],motion)}}><Coin/></div>
   <div data-status-stage="early-refunded" style={{position:'absolute',left:1290,top:500,width:420,padding:'30px 34px',borderRadius:28,background:'#DFEACF',opacity:interpolate(f,[1.825*fps,2.1*fps],[0,1],motion)}}><div style={{fontSize:22,color:green}}>HARRISON’S WALLET</div><div style={{fontFamily:'Outfit',fontSize:49,marginTop:18}}>S$10 returned</div></div>
   <div data-status-stage="waitlist-opens" style={{position:'absolute',left:1290,top:728,fontSize:28,color:green,opacity:interpolate(f,[3.3375*fps,3.7375*fps],[0,1],motion)}}>A place opens to the waitlist.</div>
  </>}
  {kind==='queue'&&<>
   <div style={{position:'absolute',left:180,top:498,width:600,padding:'30px 36px',borderRadius:27,background:'#fff',border:'2px solid #CFDAC9'}}><div style={{fontSize:20,color:green,letterSpacing:2,marginBottom:24}}>WAITLIST · NEXT ELIGIBLE</div><Person name="Joseph" color={clay}/></div>
   <div style={{position:'absolute',left:925,top:553,fontSize:70,color:green,translate:interpolate(f,[.6*fps,1*fps],['-20px 0px','25px 0px'],motion)}}>→</div>
   <div data-status-stage="queue-opening" style={{position:'absolute',left:1200,top:500,width:510,padding:'35px 38px',borderRadius:27,background:'#DFEACF',opacity:interpolate(f,[1*fps,1.4*fps],[0,1],motion)}}><div style={{fontSize:22,color:green,letterSpacing:2}}>A PLACE OPENS</div><div style={{fontFamily:'Outfit',fontSize:55,marginTop:20}}>Next in line</div><div style={{fontSize:26,marginTop:15,color:'#64755D'}}>Queue order stays clear</div></div>
  </>}
  {kind==='late'&&<>
   <div style={{position:'absolute',left:260,top:488}}><Clock hours="10h" color={clay} at={.2}/></div>
   <div data-status-stage="late-held" style={{position:'absolute',left:830,top:497,width:800,padding:'35px 40px',borderRadius:26,background:'#EEE2D5',display:'flex',alignItems:'center',gap:30}}><Lock color={clay}/><div><div style={{fontSize:30,color:'#826C58'}}>Contribution remains held</div><div style={{fontFamily:'Outfit',fontSize:61,marginTop:10}}>S$10</div></div></div>
  </>}
  {kind==='accept'&&<>
   <div style={{position:'absolute',left:260,top:485,width:660,padding:'32px 38px',borderRadius:28,background:'#fff',border:'2px solid #D4D9C9'}}><div style={{fontSize:21,color:clay,letterSpacing:2,marginBottom:25}}>NAMED REPLACEMENT</div><Person name="Joseph" color={clay}/><div data-status-stage="accept-required" style={{height:50,marginTop:26,fontSize:28,color:green,opacity:interpolate(f,[1.225*fps,1.625*fps],[0,1],motion)}}>Accept invitation <span style={{marginLeft:18}}>✓</span></div></div>
   <div data-status-stage="replacement-share" style={{position:'absolute',left:1090,top:520,display:'flex',gap:25,alignItems:'center',opacity:interpolate(f,[2.1875*fps,2.5875*fps],[0,1],motion)}}><Lock/><div style={{fontSize:30}}>Joseph covers the place<div style={{fontFamily:'Outfit',fontSize:46,marginTop:10}}>S$10 held</div></div></div>
  </>}
  {kind==='refund'&&<>
   {!alternative&&<><div style={{position:'absolute',left:230,top:510,width:430,padding:'35px 40px',borderRadius:26,background:'#fff',border:'2px solid #D4DFCE'}}><div style={{display:'flex',gap:20,alignItems:'center'}}><Check/><div style={{fontSize:29}}>Joseph accepted</div></div><div style={{fontSize:26,color:'#718173',marginTop:23}}>Replacement contribution held</div></div>
   <div data-status-stage="late-refund-moves" style={{position:'absolute',left:800,top:543,opacity:interpolate(f,[1.625*fps,1.8*fps],[0,1],motion),translate:interpolate(f,[1.625*fps,2.025*fps],['0px 0px','260px 0px'],motion)}}><Coin/></div>
   <div data-status-stage="late-refunded" style={{position:'absolute',left:1260,top:490,width:470,height:240,borderRadius:28,background:'#E0EACF',border:'3px solid #BCCDAA',padding:'32px 38px',opacity:interpolate(f,[2.025*fps,2.225*fps],[0,1],motion)}}><div style={{fontSize:22,color:green,letterSpacing:2}}>HARRISON’S WALLET</div><div style={{fontFamily:'Outfit',fontSize:52,marginTop:20,whiteSpace:'nowrap'}}>S$10 refunded</div><div style={{fontSize:25,color:green,marginTop:14}}>Available again</div></div></>}
   {alternative&&<div data-status-stage="no-replacement" style={{opacity:interpolate(f,[2.7125*fps,3.1125*fps],[0,1],motion)}}><div style={{position:'absolute',left:230,top:510,width:560,padding:'35px 40px',borderRadius:26,background:'#EEE2D5',display:'flex',alignItems:'center',gap:24}}><Lock color={clay}/><div style={{fontSize:28}}>No accepted replacement</div></div><div style={{position:'absolute',left:920,top:542,opacity:interpolate(f,[4.5625*fps,4.7*fps],[0,1],motion),translate:interpolate(f,[4.5625*fps,4.9625*fps],['0px 0px','155px 0px'],motion)}}><Coin/></div><div style={{position:'absolute',left:1330,top:500,width:380,padding:'32px 36px',borderRadius:26,background:'#fff',border:'2px solid #DCCDBB'}}><div style={{fontSize:23,color:clay}}>CONDITIONAL OUTCOME</div><div style={{fontFamily:'Outfit',fontSize:49,marginTop:22}}>Share to booker</div></div></div>}
  </>}
  </AbsoluteFill>
  <div style={{position:'absolute',left:130,top:864,fontSize:22,color:'#7C897C'}}>Illustrated rule · Prepared app example</div>
 </Shell>;
};
