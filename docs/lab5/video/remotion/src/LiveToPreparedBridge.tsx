import React from 'react';
import {AbsoluteFill,Easing,interpolate,useCurrentFrame,useVideoConfig} from 'remotion';
const ease={extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.inOut(Easing.cubic)} as const;
/** An explicit environment handoff, after the landing scroll has settled. */
export const LiveToPreparedBridge:React.FC=()=>{
 const frame=useCurrentFrame();const {fps}=useVideoConfig();
 return <AbsoluteFill data-environment-bridge style={{background:'#20252A',color:'#F5F5F3',fontFamily:'Inter',justifyContent:'center',paddingLeft:180,opacity:interpolate(frame,[0,.4*fps,1.9*fps,2.2*fps],[0,1,1,0],ease)}}>
  <div style={{display:'flex',alignItems:'center',gap:20,marginBottom:28,opacity:interpolate(frame,[.2*fps,.55*fps],[0,1],ease)}}><span style={{width:55,height:55,borderRadius:30,background:'#C8D6A8',color:'#273B33',display:'flex',alignItems:'center',justifyContent:'center',fontSize:27,fontWeight:600}}>N</span><span style={{fontSize:24,letterSpacing:.4}}>Neoh</span></div>
  <div style={{fontFamily:'Outfit',fontSize:72,fontWeight:500,translate:interpolate(frame,[.2*fps,.65*fps],['0px 14px','0px 0px'],ease)}}>Create a first public session.</div>
  <div style={{fontSize:25,color:'#C2CBC7',marginTop:25}}>Prepared demo account</div>
 </AbsoluteFill>;
};
