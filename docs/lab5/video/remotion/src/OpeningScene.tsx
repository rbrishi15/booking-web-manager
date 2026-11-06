import React from 'react';
import {AbsoluteFill,Easing,interpolate,Sequence,staticFile,useCurrentFrame,useVideoConfig} from 'remotion';
import {Video} from '@remotion/media';
import {Room} from './DeskScene';
import {PhoneMockup} from './PhoneMockup';
import {BookingLogo} from './BookingLogo';

export const OpeningScene:React.FC=()=>{
 const frame=useCurrentFrame();const {fps}=useVideoConfig();
 const zoom={extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.bezier(.62,0,.2,1)} as const;
 const reveal=interpolate(frame,[9.4*fps,10.3*fps],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.inOut(Easing.cubic)});
 return <AbsoluteFill style={{background:'#F4F0E5'}}>
  <AbsoluteFill style={{opacity:reveal,transformOrigin:'0 0',scale:interpolate(frame,[12*fps,15.97*fps],[1,3],zoom),translate:interpolate(frame,[12*fps,15.97*fps],['0px 0px','-3120px -840px'],zoom)}}>
   <Room actor="Neoh" mood="ready">
    <AbsoluteFill style={{background:'#D8E3C2',alignItems:'center',justifyContent:'center'}}><BookingLogo size={54}/><div style={{fontSize:20,color:'#617553',marginTop:8}}>Make time to play.</div></AbsoluteFill>
    <Sequence from={10*fps} premountFor={fps}><Video src={staticFile('screens/neoh-landing-handle-v6.mp4')} muted premountFor={fps} style={{width:'100%',height:'100%'}}/></Sequence>
   </Room>
  </AbsoluteFill>
  <div style={{position:'absolute',left:115,top:100,color:'#233F32',opacity:reveal*interpolate(frame,[12*fps,12.6*fps],[1,0],{extrapolateLeft:'clamp',extrapolateRight:'clamp'})}}><div style={{fontSize:21,fontWeight:600,letterSpacing:3,color:'#778B5D',marginBottom:15}}>A NEW WAY TO MAKE IT HAPPEN</div><div style={{fontFamily:'Outfit',fontSize:104,fontWeight:600}}>Neoh</div><div style={{fontSize:31,color:'#6B7A60'}}>A firmer plan starts here.</div></div>
  <AbsoluteFill style={{opacity:1-reveal,background:'radial-gradient(ellipse at 75% 105%,#326E8B 0%,#173E4E 30%,#0D242D 60%,#08151A 100%)'}}>
   <svg width="1920" height="1080" style={{position:'absolute',opacity:.25}}><path d="M1110 1020C740 790 1040 650 1510 437C1800 305 1710 199 1540 255" stroke="#89BDD3" strokeWidth="5" fill="none"/></svg>
   <BookingLogo size={36} dark style={{position:'absolute',left:140,top:95}}/>
   <div style={{position:'absolute',left:140,top:260,width:930,translate:interpolate(frame,[0,.8*fps],['0px 20px','0px 0px'],{extrapolateRight:'clamp',easing:Easing.out(Easing.cubic)})}}>
    <div style={{fontSize:21,fontWeight:500,color:'#8EB1BD',letterSpacing:3.6,marginBottom:30}}>THE PLAN, BEFORE THE APP</div>
    <div style={{fontFamily:'Outfit',fontSize:112,fontWeight:500,lineHeight:1.1,letterSpacing:-3,color:'#F3F4E9'}}>Court booked.</div>
    <div style={{fontFamily:'Outfit',fontSize:89,fontWeight:400,lineHeight:1.15,letterSpacing:-2,color:'#B8D1AF',opacity:interpolate(frame,[4.4*fps,4.9*fps],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),translate:interpolate(frame,[4.4*fps,4.9*fps],['0px 18px','0px 0px'],{extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.out(Easing.cubic)})}}>Partner cancelled.</div>
    <div style={{fontSize:34,lineHeight:1.45,color:'#B3C7CB',marginTop:48,opacity:interpolate(frame,[6.6*fps,7.2*fps],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'})}}>Agreed over messages.<br/>No app session. No funds held.</div>
   </div>
   <div style={{position:'absolute',left:1190,top:70,rotate:interpolate(frame,[0,.9*fps],['-4deg','0deg'],{extrapolateRight:'clamp',easing:Easing.out(Easing.cubic)}),translate:interpolate(frame,[0,.9*fps],['0px 24px','0px 0px'],{extrapolateRight:'clamp',easing:Easing.out(Easing.cubic)}),scale:interpolate(frame,[0,.9*fps],[.96,1],{extrapolateRight:'clamp',easing:Easing.out(Easing.cubic)})}}><PhoneMockup/></div>
   <div style={{position:'absolute',left:140,top:151,fontSize:20,color:'#89A8B3'}}>Dramatized off-app chat</div>
  </AbsoluteFill>
 </AbsoluteFill>;
};
