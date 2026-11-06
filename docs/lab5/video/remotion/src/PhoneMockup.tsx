import React from 'react';
import {Easing, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

const Message:React.FC<{at:number;sent?:boolean;children:React.ReactNode}>=({at,sent,children})=>{
 const frame=useCurrentFrame();const {fps}=useVideoConfig();
 return <div style={{display:'flex',justifyContent:sent?'flex-end':'flex-start',marginBottom:15,opacity:interpolate(frame,[at*fps,(at+.35)*fps],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),translate:interpolate(frame,[at*fps,(at+.4)*fps],['0px 15px','0px 0px'],{extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.out(Easing.cubic)})}}><div style={{maxWidth:295,padding:'13px 17px',fontSize:23,lineHeight:1.23,letterSpacing:-.35,color:sent?'#fff':'#141416',background:sent?'#087FF5':'#E9E9EB',borderRadius:24,borderBottomRightRadius:sent?7:24,borderBottomLeftRadius:sent?24:7}}>{children}</div></div>;
};

export const PhoneMockup:React.FC=()=>{
 const f=useCurrentFrame();const {fps}=useVideoConfig();
 return <div style={{position:'relative',width:420,height:870,borderRadius:66,padding:10,background:'linear-gradient(120deg,#C8C8C4,#5C6260 26%,#E8E6DE 54%,#686E6E)',boxShadow:'0 40px 80px #0008,0 2px 0 #ffffff90 inset',fontFamily:'Inter'}}>
  <div style={{position:'absolute',left:-4,top:175,width:5,height:48,borderRadius:4,background:'#8B9190'}}/><div style={{position:'absolute',left:-4,top:242,width:5,height:76,borderRadius:4,background:'#8B9190'}}/><div style={{position:'absolute',left:-4,top:334,width:5,height:76,borderRadius:4,background:'#8B9190'}}/><div style={{position:'absolute',right:-4,top:270,width:5,height:104,borderRadius:4,background:'#8B9190'}}/>
  <div style={{position:'relative',width:'100%',height:'100%',borderRadius:57,overflow:'hidden',background:'#fff',border:'5px solid #111515'}}>
   <div style={{position:'absolute',top:19,left:30,fontSize:20,fontWeight:600,color:'#111'}}>9:41</div>
   <div style={{position:'absolute',top:12,left:139,width:112,height:31,borderRadius:22,background:'#000'}}/>
   <svg width="73" height="23" viewBox="0 0 73 23" style={{position:'absolute',right:24,top:23}}><path d="M2 16V13M8 16V10M14 16V7M20 16V4" stroke="#15191A" strokeWidth="3"/><path d="M29 7Q37 0 45 7M32 10Q37 5 42 10M35 13Q37 11 39 13" fill="none" stroke="#15191A" strokeWidth="2.2"/><rect x="52" y="4" width="17" height="11" rx="3" fill="none" stroke="#15191A" strokeWidth="1.6"/><rect x="54" y="6" width="12" height="7" rx="1" fill="#15191A"/><path d="M71 8V12" stroke="#15191A" strokeWidth="2"/></svg>
   <div style={{position:'absolute',top:67,left:0,right:0,height:105,background:'#FBFBFD',borderBottom:'1px solid #ECECF0'}}>
    <div style={{position:'absolute',left:14,top:25,display:'flex',alignItems:'center',gap:3,color:'#087FF5',fontSize:19}}><svg width="12" height="24"><path d="M10 3L2 12 10 21" stroke="currentColor" strokeWidth="2.5" fill="none"/></svg>Messages</div>
    <div style={{position:'absolute',left:169,top:0,width:51,height:51,borderRadius:28,background:'linear-gradient(#A8ADB8,#858C99)',display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontSize:25}}>F</div>
    <div style={{position:'absolute',top:60,left:156,fontSize:17,color:'#121416',display:'flex',alignItems:'center',gap:6}}>Friend <span style={{color:'#A1A4AA',fontSize:20}}>›</span></div>
    <svg width="24" height="24" viewBox="0 0 24 24" style={{position:'absolute',right:23,top:25}}><path d="M8 4Q4 4 5 10Q8 19 16 20Q21 21 21 17L16 13 13 15Q10 13 9 10L11 8Z" fill="none" stroke="#087FF5" strokeWidth="1.7"/></svg>
   </div>
   <div style={{position:'absolute',top:192,left:18,right:18}}>
    <div style={{fontSize:14,color:'#979BA3',textAlign:'center',marginBottom:24}}>Today 9:41 AM</div>
    <Message at={.55} sent>Court booked for Sunday, 6 pm. Tennis?</Message>
    <Message at={1.7}>I’m in!</Message>
    <Message at={2.7} sent>Great, see you there.</Message>
    <div style={{fontSize:12,color:'#979BA3',textAlign:'right',marginTop:-7,marginBottom:19,opacity:interpolate(f,[3.0*fps,3.3*fps],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'})}}>Delivered</div>
    {f>=3.4*fps&&f<4.4*fps&&<div style={{width:76,height:42,borderRadius:24,background:'#E9E9EB',display:'flex',gap:7,alignItems:'center',justifyContent:'center'}}>{[0,1,2].map(n=><div key={n} style={{width:10,height:10,borderRadius:5,background:'#9A9AA0',opacity:.35+.65*(.5+.5*Math.sin(f/4-n))}}/>)}</div>}
    <Message at={4.4}>Sorry Neoh, I can’t make it.</Message>
   </div>
   <div style={{position:'absolute',bottom:35,left:17,right:17,display:'flex',gap:12,alignItems:'center'}}>
    <div style={{width:30,height:30,borderRadius:18,background:'#F2F3F5',fontSize:26,color:'#777E8C',display:'flex',alignItems:'center',justifyContent:'center'}}>+</div>
    <div style={{height:42,border:'1px solid #D2D3D7',borderRadius:24,flex:1,display:'flex',alignItems:'center',padding:'0 15px',fontSize:18,color:'#B8BBC2'}}>iMessage<svg width="18" height="24" style={{marginLeft:'auto'}}><rect x="7" y="2" width="6" height="12" rx="3" fill="none" stroke="#A5ABB5" strokeWidth="1.5"/><path d="M4 9V12Q4 19 10 19Q16 19 16 12V9M10 19V23" fill="none" stroke="#A5ABB5" strokeWidth="1.5"/></svg></div>
   </div>
   <div style={{position:'absolute',bottom:10,left:121,width:148,height:5,borderRadius:6,background:'#141516'}}/>
  </div>
 </div>;
};
