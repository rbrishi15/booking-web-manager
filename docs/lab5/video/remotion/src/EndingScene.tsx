import React from 'react';
import {AbsoluteFill,Easing,interpolate,Sequence,useCurrentFrame,useVideoConfig} from 'remotion';
import {FancyEndCard} from './FancyEndCard';
import {SocialPayoffScene} from './SocialPayoffScene';
const fade={extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.inOut(Easing.cubic)} as const;
export const EndingScene:React.FC=()=>{
 const frame=useCurrentFrame();const {fps}=useVideoConfig();
 return <AbsoluteFill style={{background:'#000000'}}>
  <Sequence name="From alone to a tennis group" from={0*fps} durationInFrames={15.6*fps} premountFor={fps}>
   <AbsoluteFill style={{opacity:interpolate(frame,[0,.45*fps],[0,1],fade)}}><SocialPayoffScene/></AbsoluteFill>
  </Sequence>
  <Sequence name="Animated academic end card" from={15*fps} durationInFrames={16*fps} premountFor={fps}>
   <AbsoluteFill style={{opacity:interpolate(frame,[15*fps,15.6*fps],[0,1],fade)}}><FancyEndCard soundEffects={false}/></AbsoluteFill>
  </Sequence>
 </AbsoluteFill>;
};
