import React from 'react';
import {AbsoluteFill,CanvasImage,Sequence,staticFile,useVideoConfig} from 'remotion';
import {Audio,Video} from '@remotion/media';
import {BasicCaptions} from './basic-captions';
import {OpeningScene} from './OpeningScene';
import {DeskPortal} from './DeskScene';
import {PlanChangeIntro,PlanChangeTransition} from './PlanChangeScenes';
import {AttendancePicture,PendingInvitationsPicture,AcceptedMembershipPicture} from './FocusedFootage';
import {LiveToPreparedBridge} from './LiveToPreparedBridge';
import {EndingScene} from './EndingScene';
import {CaptionFrame} from './VideoChrome';
export const HookChapter:React.FC=()=>{const {fps}=useVideoConfig();return <AbsoluteFill>
 <OpeningScene/>
 <Audio name="Michael narration" src={staticFile("audio/hook-v5.wav")} premountFor={fps}/>
 <CaptionFrame absoluteStart={0}><BasicCaptions name="English captions" premountFor={fps} width={1240} style={{width:1240}} combineTokensWithinMilliseconds={0} captions={[
  {
    "text": "Neoh has booked a tennis court.",
    "startMs": 300,
    "endMs": 2985,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "His friend agreed off-app, then cancelled.",
    "startMs": 3100,
    "endMs": 6460,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "They never joined a session or committed any funds.",
    "startMs": 6600,
    "endMs": 10685,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "Now Neoh needs players, and a firmer commitment.",
    "startMs": 10800,
    "endMs": 14835,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  }
]}/></CaptionFrame>
 </AbsoluteFill>;};
export const LandingChapter:React.FC=()=>{const {fps}=useVideoConfig();return <AbsoluteFill>
 <Video name="Fresh continuous landing tour" src={staticFile("screens/landing-v6.mp4")} muted objectFit="contain" premountFor={fps} style={{position:"absolute",width:"100%",height:"100%"}}/>
 <Audio name="Michael narration" src={staticFile("audio/landing-v5.wav")} premountFor={fps}/>
 <CaptionFrame absoluteStart={16}><BasicCaptions name="English captions" premountFor={fps} width={1240} style={{width:1240}} combineTokensWithinMilliseconds={0} captions={[
  {
    "text": "New to Booking Web Manager, Neoh starts at the landing page.",
    "startMs": 400,
    "endMs": 5260,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "The animated court catches his eye, and he explores the sports\non offer.",
    "startMs": 6200,
    "endMs": 11610,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "The page explains how to find games, check details, and share a\ncourt.",
    "startMs": 11700,
    "endMs": 17010,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "He already has a venue. Now he needs people to play with.",
    "startMs": 17200,
    "endMs": 21710,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  }
]}/></CaptionFrame>
 </AbsoluteFill>;};
export const CreateChapter:React.FC=()=>{const {fps}=useVideoConfig();return <AbsoluteFill>
 <Video name="create UI 5" src={staticFile("screens/05.mp4")} from={0*fps} durationInFrames={16.2*fps} playbackRate={2.25} muted objectFit="contain" premountFor={fps} style={{position:"absolute",width:"100%",height:"100%"}}/>
 <Video name="create UI 6" src={staticFile("screens/06.mp4")} from={7.2*fps} durationInFrames={10.1*fps} playbackRate={2.2444444444444445} muted objectFit="contain" premountFor={fps} style={{position:"absolute",width:"100%",height:"100%"}}/>
 <Video name="create UI 7" src={staticFile("screens/07.mp4")} from={11.7*fps} durationInFrames={18.7*fps} playbackRate={2.2530120481927707} muted objectFit="contain" premountFor={fps} style={{position:"absolute",width:"100%",height:"100%"}}/>
 <Video name="create UI 8" src={staticFile("screens/08.mp4")} from={20.0*fps} durationInFrames={5*fps} playbackRate={1.0} muted objectFit="contain" premountFor={fps} style={{position:"absolute",width:"100%",height:"100%"}}/>
 <Audio name="Michael narration" src={staticFile("audio/create-v5.wav")} premountFor={fps}/>
 <CaptionFrame absoluteStart={40.0}><BasicCaptions name="English captions" premountFor={fps} width={1240} style={{width:1240}} combineTokensWithinMilliseconds={0} captions={[
  {
    "text": "Neoh creates his first public tennis session for Sunday, six to\neight.",
    "startMs": 300,
    "endMs": 5660,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "He enters Kallang Tennis Hub and the thirty-dollar venue cost.",
    "startMs": 7300,
    "endMs": 12285,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "Three places include Neoh. Each guest contributes ten dollars.",
    "startMs": 15300,
    "endMs": 20260,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "He saves the session. Now two places are open.",
    "startMs": 20300,
    "endMs": 24485,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  }
]}/></CaptionFrame>
 </AbsoluteFill>;};
export const HarrisonChapter:React.FC=()=>{const {fps}=useVideoConfig();return <AbsoluteFill>
 <Video name="harrison UI 9" src={staticFile("screens/09.mp4")} from={0*fps} durationInFrames={5.2*fps} playbackRate={1.0} muted objectFit="contain" premountFor={fps} style={{position:"absolute",width:"100%",height:"100%"}}/>
 <Video name="harrison UI 10" src={staticFile("screens/10.mp4")} from={5.2*fps} durationInFrames={33.5*fps} playbackRate={1.0} muted objectFit="contain" premountFor={fps} style={{position:"absolute",width:"100%",height:"100%"}}/>
 <Video name="harrison UI 11" src={staticFile("screens/11.mp4")} from={38.7*fps} durationInFrames={10*fps} playbackRate={1.0} muted objectFit="contain" premountFor={fps} style={{position:"absolute",width:"100%",height:"100%"}}/>
 <Video name="harrison UI 12" src={staticFile("screens/12.mp4")} from={48.7*fps} durationInFrames={13.5*fps} playbackRate={1.0} muted objectFit="contain" premountFor={fps} style={{position:"absolute",width:"100%",height:"100%"}}/>
 <Sequence name="Harrison transition" from={0*fps} durationInFrames={126} premountFor={fps}><DeskPortal actor="Harrison" src="screens/09.mp4" posterDuration={0} duration={4.2} hold={1.2} detail="Finding a weekend game."/></Sequence>
 <Audio name="Michael narration" src={staticFile("audio/harrison-v5.wav")} premountFor={fps}/>
 <CaptionFrame absoluteStart={65.0}><BasicCaptions name="English captions" premountFor={fps} width={1240} style={{width:1240}} combineTokensWithinMilliseconds={0} captions={[
  {
    "text": "Meet Harrison. He wants a game that fits his weekend.",
    "startMs": 300,
    "endMs": 4760,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "Harrison uses a prepared demo account with a funded wallet.",
    "startMs": 4800,
    "endMs": 9635,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "Harrison narrows Discover to tennis in the Central region.",
    "startMs": 10300,
    "endMs": 15210,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "Neoh's Sunday session gives him the venue, time and price up\nfront.",
    "startMs": 16600,
    "endMs": 21735,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "He reviews the booking before choosing to join.",
    "startMs": 22000,
    "endMs": 25810,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "The confirmation explains that ten dollars will be held from his\nwallet.",
    "startMs": 26000,
    "endMs": 31310,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "He confirms, and his place is secured.",
    "startMs": 34500,
    "endMs": 37735,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "Harrison can see both his place and his contribution, without\nchasing a chat.",
    "startMs": 43000,
    "endMs": 48910,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "In Wallet, his available balance falls from twenty dollars to\nten.",
    "startMs": 49000,
    "endMs": 54260,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "The other ten dollars is held for this session.",
    "startMs": 54400,
    "endMs": 58360,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "It has not been paid to Neoh yet.",
    "startMs": 58500,
    "endMs": 61585,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  }
]}/></CaptionFrame>
 </AbsoluteFill>;};
export const JosephChapter:React.FC=()=>{const {fps}=useVideoConfig();return <AbsoluteFill>
 <Video name="joseph UI 13" src={staticFile("screens/13.mp4")} from={3.1*fps} durationInFrames={16*fps} playbackRate={1.0} muted objectFit="contain" premountFor={fps} style={{position:"absolute",width:"100%",height:"100%"}}/>
 <Video name="joseph UI 14" src={staticFile("screens/14.mp4")} from={22.4*fps} durationInFrames={23*fps} playbackRate={1.0} muted objectFit="contain" premountFor={fps} style={{position:"absolute",width:"100%",height:"100%"}}/>
 <Sequence name="Joseph transition" from={0*fps} durationInFrames={108} premountFor={fps}><DeskPortal actor="Joseph" src="screens/13.mp4" poster="posters/13.jpg" posterDuration={3.1} duration={3.6} hold={1.2} detail="Finding a game that fits."/></Sequence>
 <Sequence name="Neoh transition" from={19.1*fps} durationInFrames={108} premountFor={fps}><DeskPortal actor="Neoh" src="screens/14.mp4" poster="posters/14.jpg" posterDuration={3.3} duration={3.6} hold={1.2} detail="Three committed players. One plan."/></Sequence>
 <Audio name="Michael narration" src={staticFile("audio/joseph-v5.wav")} premountFor={fps}/>
 <CaptionFrame absoluteStart={127.2}><BasicCaptions name="English captions" premountFor={fps} width={1240} style={{width:1240}} combineTokensWithinMilliseconds={0} captions={[
  {
    "text": "Joseph discovers the same public session from his own account.",
    "startMs": 400,
    "endMs": 5085,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "He checks the details and confirms his ten-dollar share too.",
    "startMs": 9100,
    "endMs": 13710,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "Back in Neoh's Booking Room, all three places are now accounted\nfor.",
    "startMs": 19500,
    "endMs": 24710,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "Neoh, Harrison and Joseph can rotate through their tennis\npractice.",
    "startMs": 28400,
    "endMs": 33510,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "The court no longer goes to waste.",
    "startMs": 33800,
    "endMs": 36885,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "And the participant list gives Neoh one clear view of who is\nplaying.",
    "startMs": 37400,
    "endMs": 42635,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  }
]}/></CaptionFrame>
 </AbsoluteFill>;};
export const ChangesChapter:React.FC=()=>{const {fps}=useVideoConfig();return <AbsoluteFill>
 <CanvasImage name="Recorded screen context" src={staticFile("posters/15.jpg")} from={0*fps} durationInFrames={3*fps} premountFor={fps} style={{position:"absolute",width:"100%",height:"100%"}}/>
 <CanvasImage name="Recorded screen context" src={staticFile("posters/16.jpg")} from={23*fps} durationInFrames={3*fps} premountFor={fps} style={{position:"absolute",width:"100%",height:"100%"}}/>
 <CanvasImage name="Recorded screen context" src={staticFile("posters/17.jpg")} from={45*fps} durationInFrames={3*fps} premountFor={fps} style={{position:"absolute",width:"100%",height:"100%"}}/>
 <CanvasImage name="Recorded screen context" src={staticFile("posters/18.jpg")} from={54*fps} durationInFrames={3*fps} premountFor={fps} style={{position:"absolute",width:"100%",height:"100%"}}/>
 <CanvasImage name="Recorded screen context" src={staticFile("posters/19.jpg")} from={81.8*fps} durationInFrames={3*fps} premountFor={fps} style={{position:"absolute",width:"100%",height:"100%"}}/>
 <CanvasImage name="Recorded screen context" src={staticFile("posters/20.jpg")} from={95.3*fps} durationInFrames={3*fps} premountFor={fps} style={{position:"absolute",width:"100%",height:"100%"}}/>
 <Video name="changes UI 15" src={staticFile("screens/15.mp4")} from={3.0*fps} durationInFrames={20*fps} playbackRate={1.0} muted objectFit="contain" premountFor={fps} style={{position:"absolute",width:"100%",height:"100%"}}/>
 <Video name="changes UI 16" src={staticFile("screens/16-v4.mp4")} from={26.0*fps} durationInFrames={19*fps} playbackRate={1.0} muted objectFit="contain" premountFor={fps} style={{position:"absolute",width:"100%",height:"100%"}}/>
 <Video name="changes UI 17" src={staticFile("screens/17.mp4")} from={48.0*fps} durationInFrames={6*fps} playbackRate={1.0} muted objectFit="contain" premountFor={fps} style={{position:"absolute",width:"100%",height:"100%"}}/>
 <Video name="changes UI 18" src={staticFile("screens/18.mp4")} from={57.0*fps} durationInFrames={24.8*fps} playbackRate={1.0} muted objectFit="contain" premountFor={fps} style={{position:"absolute",width:"100%",height:"100%"}}/>
 <Video name="changes UI 19" src={staticFile("screens/19.mp4")} from={84.8*fps} durationInFrames={10.5*fps} playbackRate={1.0} muted objectFit="contain" premountFor={fps} style={{position:"absolute",width:"100%",height:"100%"}}/>
 <Video name="changes UI 20" src={staticFile("screens/20.mp4")} from={98.3*fps} durationInFrames={8.5*fps} playbackRate={1.0} muted objectFit="contain" premountFor={fps} style={{position:"absolute",width:"100%",height:"100%"}}/>
 <Sequence name="intro transition" from={0*fps} durationInFrames={299} premountFor={fps}><PlanChangeIntro/></Sequence>
 <Sequence name="early transition" from={23.6*fps} durationInFrames={96} premountFor={fps}><PlanChangeTransition kind="early" duration={3.2}/></Sequence>
 <Sequence name="early-refund transition" from={36*fps} durationInFrames={174} premountFor={fps}><PlanChangeTransition kind="early-refund" duration={5.8}/></Sequence>
 <Sequence name="queue transition" from={45.6*fps} durationInFrames={133} premountFor={fps}><PlanChangeTransition kind="queue" duration={4.433333333333334}/></Sequence>
 <Sequence name="late transition" from={61.6*fps} durationInFrames={129} premountFor={fps}><PlanChangeTransition kind="late" duration={4.3}/></Sequence>
 <Sequence name="accept transition" from={85.1*fps} durationInFrames={148} premountFor={fps}><PlanChangeTransition kind="accept" duration={4.933333333333334}/></Sequence>
 <Sequence name="refund transition" from={96.3*fps} durationInFrames={188} premountFor={fps}><PlanChangeTransition kind="refund" duration={6.266666666666667}/></Sequence>
 <Audio name="Michael narration" src={staticFile("audio/changes-v5.wav")} premountFor={fps}/>
 <CaptionFrame absoluteStart={172.6}><BasicCaptions name="English captions" premountFor={fps} width={1240} style={{width:1240}} combineTokensWithinMilliseconds={0} captions={[
  {
    "text": "But what happens if somebody's plans change again?",
    "startMs": 300,
    "endMs": 3985,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "These next examples use separate sessions, leaving our main game\nintact.",
    "startMs": 4150,
    "endMs": 9935,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "First, a two-person session is full when Joseph discovers it.",
    "startMs": 10000,
    "endMs": 14910,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "He joins the waitlist. No money is held while he waits.",
    "startMs": 17700,
    "endMs": 22310,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "With more than thirty hours left, Harrison decides to withdraw.",
    "startMs": 23600,
    "endMs": 28710,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "The app shows his full refund before he confirms.",
    "startMs": 31500,
    "endMs": 35385,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "His ten dollars returns to his wallet,",
    "startMs": 36000,
    "endMs": 39100,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "and he opens the place to the waitlist.",
    "startMs": 39100,
    "endMs": 41860,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "The next eligible player can take the opening in queue order.",
    "startMs": 45600,
    "endMs": 50135,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "Now consider a different session, starting later today.",
    "startMs": 54600,
    "endMs": 58885,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "Harrison is withdrawing late, so his share stays held.",
    "startMs": 61600,
    "endMs": 65960,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "He finds Joseph by user ID and invites him as a named\nreplacement.",
    "startMs": 66000,
    "endMs": 71935,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "Sending an invitation alone does not earn Harrison a refund.",
    "startMs": 72100,
    "endMs": 77260,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "Joseph must accept and cover the place before the session\nstarts.",
    "startMs": 85100,
    "endMs": 90210,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "Only then is Harrison refunded.",
    "startMs": 96300,
    "endMs": 99012,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "Without a replacement, his share goes to the booker.",
    "startMs": 99012,
    "endMs": 102610,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  }
]}/></CaptionFrame>
 </AbsoluteFill>;};
export const AttendanceChapter:React.FC=()=>{const {fps}=useVideoConfig();return <AbsoluteFill>
 <Sequence name="Focused recorded UI" from={3.0*fps} durationInFrames={33*fps} premountFor={fps}><AttendancePicture/></Sequence>
 <Sequence name="Neoh transition" from={0*fps} durationInFrames={96} premountFor={fps}><DeskPortal actor="Neoh" src="screens/21.mp4" poster="posters/21.jpg" posterDuration={3} duration={3.2} hold={1.2} detail="After the game: attendance."/></Sequence>
 <Audio name="Michael narration" src={staticFile("audio/attendance-v5.wav")} premountFor={fps}/>
 <CaptionFrame absoluteStart={279.4}><BasicCaptions name="English captions" premountFor={fps} width={1240} style={{width:1240}} combineTokensWithinMilliseconds={0} captions={[
  {
    "text": "After tennis, Neoh closes the loop by confirming attendance.",
    "startMs": 350,
    "endMs": 5310,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "This is a prepared ended-session example, so we can show the\nnext stage.",
    "startMs": 5400,
    "endMs": 10910,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "He reviews Harrison and Joseph, marks them as attended, and\nsaves.",
    "startMs": 11000,
    "endMs": 16160,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "Attendance verification and withdrawing earnings are separate\nactions.",
    "startMs": 16200,
    "endMs": 21435,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "Once everyone is verified, the session is ready to withdraw.",
    "startMs": 21500,
    "endMs": 26460,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "The two guest shares total twenty dollars.",
    "startMs": 26500,
    "endMs": 29810,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "This demonstration stops at readiness; it does not make a bank\ntransfer.",
    "startMs": 30000,
    "endMs": 35585,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  }
]}/></CaptionFrame>
 </AbsoluteFill>;};
export const GroupCreateChapter:React.FC=()=>{const {fps}=useVideoConfig();return <AbsoluteFill>
 <Video name="group_create UI 22" src={staticFile("screens/22.mp4")} from={0*fps} durationInFrames={1.3*fps} playbackRate={1} muted objectFit="contain" premountFor={fps} style={{position:"absolute",width:"100%",height:"100%"}}/>
 <Video name="group_create UI 23" src={staticFile("screens/23-v4.mp4")} from={1.3*fps} durationInFrames={14*fps} playbackRate={1} muted objectFit="contain" premountFor={fps} style={{position:"absolute",width:"100%",height:"100%"}}/>
 <Sequence name="Focused recorded UI" from={15.3*fps} durationInFrames={5.6*fps} premountFor={fps}><PendingInvitationsPicture/></Sequence>
 <Audio name="Michael narration" src={staticFile("audio/group_create-v5.wav")} premountFor={fps}/>
 <CaptionFrame absoluteStart={315.4}><BasicCaptions name="English captions" premountFor={fps} width={1240} style={{width:1240}} combineTokensWithinMilliseconds={0} captions={[
  {
    "text": "One good game gives Neoh a reason to organise another.",
    "startMs": 400,
    "endMs": 5110,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "He creates a regular group for their Sunday tennis sessions.",
    "startMs": 5200,
    "endMs": 9635,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "He finds Harrison and Joseph by their user IDs and invites them.",
    "startMs": 9800,
    "endMs": 15110,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "An invitation is not membership. The player chooses whether to\njoin.",
    "startMs": 15200,
    "endMs": 20635,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  }
]}/></CaptionFrame>
 </AbsoluteFill>;};
export const GroupAcceptChapter:React.FC=()=>{const {fps}=useVideoConfig();return <AbsoluteFill>
 <Sequence name="Focused recorded UI" from={3*fps} durationInFrames={3.5*fps} premountFor={fps}><AcceptedMembershipPicture src="screens/25.mp4"/></Sequence>
 <Sequence name="Focused recorded UI" from={9.5*fps} durationInFrames={6.5*fps} premountFor={fps}><AcceptedMembershipPicture src="screens/26.mp4"/></Sequence>
 <Sequence name="Harrison transition" from={0*fps} durationInFrames={96} premountFor={fps}><DeskPortal actor="Harrison" src="screens/25.mp4" poster="posters/25.jpg" posterDuration={3} duration={3.2} hold={1.2} detail="An invitation for next Sunday."/></Sequence>
 <Sequence name="Joseph transition" from={6.5*fps} durationInFrames={96} premountFor={fps}><DeskPortal actor="Joseph" src="screens/26.mp4" poster="posters/26.jpg" posterDuration={3} duration={3.2} hold={1.2} detail="Joining the regular group."/></Sequence>
 <Audio name="Michael narration" src={staticFile("audio/group_accept-v5.wav")} premountFor={fps}/>
 <CaptionFrame absoluteStart={336.3}><BasicCaptions name="English captions" premountFor={fps} width={1240} style={{width:1240}} combineTokensWithinMilliseconds={0} captions={[
  {
    "text": "Each player accepts from their own account before becoming a\nmember.",
    "startMs": 400,
    "endMs": 5385,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "Now their group is ready for the next invitation.",
    "startMs": 11900,
    "endMs": 15860,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  }
]}/></CaptionFrame>
 </AbsoluteFill>;};
export const GroupOwnerChapter:React.FC=()=>{const {fps}=useVideoConfig();return <AbsoluteFill>
 <Video name="group_owner UI 27" src={staticFile("screens/27.mp4")} from={3.0*fps} durationInFrames={4*fps} playbackRate={1.0} muted objectFit="contain" premountFor={fps} style={{position:"absolute",width:"100%",height:"100%"}}/>
 <Sequence name="Neoh transition" from={0*fps} durationInFrames={96} premountFor={fps}><DeskPortal actor="Neoh" src="screens/27.mp4" poster="posters/27.jpg" posterDuration={3} duration={3.2} hold={1.2} detail="Ready for the next game."/></Sequence>
 <Audio name="Michael narration" src={staticFile("audio/group_owner-v5.wav")} premountFor={fps}/>
 <CaptionFrame absoluteStart={352.3}><BasicCaptions name="English captions" premountFor={fps} width={1240} style={{width:1240}} combineTokensWithinMilliseconds={0} captions={[
  {
    "text": "Neoh can organise another session with people he already knows.",
    "startMs": 1400,
    "endMs": 6485,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  }
]}/></CaptionFrame>
 </AbsoluteFill>;};
export const EndingChapter:React.FC=()=>{const {fps}=useVideoConfig();return <AbsoluteFill>
 <EndingScene/>
 <Audio name="Michael narration" src={staticFile("audio/ending-v6.wav")} premountFor={fps}/>
 <CaptionFrame absoluteStart={359.3}><BasicCaptions name="English captions" premountFor={fps} width={1240} style={{width:1240}} combineTokensWithinMilliseconds={0} captions={[
  {
    "text": "Neoh started with a court, but no one to play with.",
    "startMs": 400,
    "endMs": 4535,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "Through Booking Web Manager, he found Harrison and Joseph.",
    "startMs": 4900,
    "endMs": 9360,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  },
  {
    "text": "One cancelled plan became a game, and a reason to meet again.",
    "startMs": 9600,
    "endMs": 14785,
    "timestampMs": null,
    "confidence": null,
    "pageBreakAfter": true
  }
]}/></CaptionFrame>
 </AbsoluteFill>;};
export const BookingDemo:React.FC=()=>{const {fps}=useVideoConfig();return <AbsoluteFill style={{background:"#151A1E"}}>
 <Sequence name="hook" from={0*fps} durationInFrames={480} premountFor={fps}><HookChapter/></Sequence>
 <Sequence name="landing" from={16*fps} durationInFrames={720} premountFor={fps}><LandingChapter/></Sequence>
 <Sequence name="create" from={40.0*fps} durationInFrames={750} premountFor={fps}><CreateChapter/></Sequence>
 <Sequence name="harrison" from={65.0*fps} durationInFrames={1866} premountFor={fps}><HarrisonChapter/></Sequence>
 <Sequence name="joseph" from={127.2*fps} durationInFrames={1362} premountFor={fps}><JosephChapter/></Sequence>
 <Sequence name="changes" from={172.6*fps} durationInFrames={3204} premountFor={fps}><ChangesChapter/></Sequence>
 <Sequence name="attendance" from={279.4*fps} durationInFrames={1080} premountFor={fps}><AttendanceChapter/></Sequence>
 <Sequence name="group_create" from={315.4*fps} durationInFrames={627} premountFor={fps}><GroupCreateChapter/></Sequence>
 <Sequence name="group_accept" from={336.3*fps} durationInFrames={480} premountFor={fps}><GroupAcceptChapter/></Sequence>
 <Sequence name="group_owner" from={352.3*fps} durationInFrames={210} premountFor={fps}><GroupOwnerChapter/></Sequence>
 <Sequence name="ending" from={359.3*fps} durationInFrames={930} premountFor={fps}><EndingChapter/></Sequence>
 <Sequence name="Live-to-prepared handoff" from={38.1*fps} durationInFrames={2.2*fps} premountFor={fps}><LiveToPreparedBridge/></Sequence>
</AbsoluteFill>;};
