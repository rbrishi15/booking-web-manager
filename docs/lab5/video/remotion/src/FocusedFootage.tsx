import React from 'react';
import {AbsoluteFill, Easing, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {Video} from '@remotion/media';
const ease={extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.inOut(Easing.cubic)} as const;

/** Recorded action at 1x, with a restrained push toward its native status/result. */
export const AttendancePicture:React.FC=()=>{
 const frame=useCurrentFrame();const {fps}=useVideoConfig();
 return <AbsoluteFill style={{overflow:'hidden'}}><Video name="Attendance saved, then payout readiness" src={staticFile('screens/21-v4.mp4')} muted objectFit="contain" premountFor={fps} style={{width:'100%',height:'100%',transformOrigin:'1160px 690px',scale:interpolate(frame,[17*fps,18.5*fps,23*fps,24.5*fps,29.5*fps,32*fps],[1,1.22,1.22,1.38,1.38,1],ease)}}/></AbsoluteFill>;
};

export const PendingInvitationsPicture:React.FC=()=>{
 const frame=useCurrentFrame();const {fps}=useVideoConfig();
 return <AbsoluteFill style={{overflow:'hidden'}}><Video name="Pending invitations in the recorded app" src={staticFile('screens/24-v4.mp4')} muted objectFit="contain" premountFor={fps} style={{width:'100%',height:'100%',transformOrigin:'1800px 860px',scale:interpolate(frame,[2.6*fps,3.1*fps,5*fps,5.6*fps],[1,1.12,1.12,1],ease)}}/></AbsoluteFill>;
};

export const AcceptedMembershipPicture:React.FC<{src:string}>=({src})=>{
 const frame=useCurrentFrame();const {fps}=useVideoConfig();
 return <AbsoluteFill style={{overflow:'hidden'}}><Video name="Invitation accepted and membership updated" src={staticFile(src)} muted objectFit="contain" premountFor={fps} style={{width:'100%',height:'100%',transformOrigin:'1090px 610px',scale:interpolate(frame,[1.5*fps,1.95*fps,4.8*fps,6.5*fps],[1,1.24,1.24,1],ease)}}/></AbsoluteFill>;
};
