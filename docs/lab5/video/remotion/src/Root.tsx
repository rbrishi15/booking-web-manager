import React from 'react';
import {Composition,Folder,staticFile,delayRender,continueRender,cancelRender} from 'remotion';
import {loadFont} from '@remotion/fonts';
import {DeskPortal} from './DeskScene';
import {PlanChangeIntro,PlanChangeTransition} from './PlanChangeScenes';
import {LiveToPreparedBridge} from './LiveToPreparedBridge';
import {SocialPayoffScene} from './SocialPayoffScene';
import {FancyEndCard} from './FancyEndCard';
import {BookingDemo,HookChapter,LandingChapter,CreateChapter,HarrisonChapter,JosephChapter,ChangesChapter,AttendanceChapter,GroupCreateChapter,GroupAcceptChapter,GroupOwnerChapter,EndingChapter} from './Chapters';
import './style.css';
const fonts=delayRender('Local brand fonts');
Promise.all([loadFont({family:'Inter',url:staticFile('fonts/inter-v20-latin.woff2'),weight:'100 900'}),loadFont({family:'Outfit',url:staticFile('fonts/outfit-latin-variable.woff2'),weight:'100 900'})]).then(()=>continueRender(fonts)).catch(cancelRender);
export const RemotionRoot:React.FC=()=> <>
 <Composition id="BookingDemo" component={BookingDemo} durationInFrames={11709} fps={30} width={1920} height={1080}/>
 <Folder name="Chapters">
 <Composition id="hook" component={HookChapter} durationInFrames={480} fps={30} width={1920} height={1080}/>
 <Composition id="landing" component={LandingChapter} durationInFrames={720} fps={30} width={1920} height={1080}/>
 <Composition id="create" component={CreateChapter} durationInFrames={750} fps={30} width={1920} height={1080}/>
 <Composition id="harrison" component={HarrisonChapter} durationInFrames={1866} fps={30} width={1920} height={1080}/>
 <Composition id="joseph" component={JosephChapter} durationInFrames={1362} fps={30} width={1920} height={1080}/>
 <Composition id="changes" component={ChangesChapter} durationInFrames={3204} fps={30} width={1920} height={1080}/>
 <Composition id="attendance" component={AttendanceChapter} durationInFrames={1080} fps={30} width={1920} height={1080}/>
 <Composition id="group-create" component={GroupCreateChapter} durationInFrames={627} fps={30} width={1920} height={1080}/>
 <Composition id="group-accept" component={GroupAcceptChapter} durationInFrames={480} fps={30} width={1920} height={1080}/>
 <Composition id="group-owner" component={GroupOwnerChapter} durationInFrames={210} fps={30} width={1920} height={1080}/>
 <Composition id="ending" component={EndingChapter} durationInFrames={930} fps={30} width={1920} height={1080}/>
 </Folder>
 <Composition id="LiveToPreparedTransition" component={LiveToPreparedBridge} durationInFrames={66} fps={30} width={1920} height={1080}/>
 <Composition id="SocialPayoff" component={SocialPayoffScene} durationInFrames={450} fps={30} width={1920} height={1080}/>
 <Composition id="AcademicEndCard" component={FancyEndCard} durationInFrames={480} fps={30} width={1920} height={1080}/>
 <Folder name="Plan-changes">
 <Composition id="PlanChangeIntro" component={PlanChangeIntro} durationInFrames={299} fps={30} width={1920} height={1080}/>
 <Composition id="EarlyRefund" component={PlanChangeTransition} durationInFrames={96} fps={30} width={1920} height={1080} defaultProps={{kind:"early"}}/>
 <Composition id="WaitlistOpening" component={PlanChangeTransition} durationInFrames={96} fps={30} width={1920} height={1080} defaultProps={{kind:"queue"}}/>
 <Composition id="LateReplacement" component={PlanChangeTransition} durationInFrames={96} fps={30} width={1920} height={1080} defaultProps={{kind:"late"}}/>
 <Composition id="ReplacementAcceptance" component={PlanChangeTransition} durationInFrames={96} fps={30} width={1920} height={1080} defaultProps={{kind:"accept"}}/>
 <Composition id="RefundAfterAcceptance" component={PlanChangeTransition} durationInFrames={96} fps={30} width={1920} height={1080} defaultProps={{kind:"refund"}}/>
 </Folder>
 <Folder name="Players">
 <Composition id="HarrisonDesk" component={DeskPortal} durationInFrames={126} fps={30} width={1920} height={1080} defaultProps={{actor:"Harrison",src:"screens/09.mp4",poster:"posters/09.jpg",posterDuration:0,duration:4.2,hold:1.2,detail:"A game worth showing up for."}}/>
 <Composition id="JosephDesk" component={DeskPortal} durationInFrames={108} fps={30} width={1920} height={1080} defaultProps={{actor:"Joseph",src:"screens/13.mp4",poster:"posters/13.jpg",posterDuration:3.1,duration:3.6,hold:1.2,detail:"A game worth showing up for."}}/>
 <Composition id="NeohDesk" component={DeskPortal} durationInFrames={108} fps={30} width={1920} height={1080} defaultProps={{actor:"Neoh",src:"screens/14.mp4",poster:"posters/14.jpg",posterDuration:3.3,duration:3.6,hold:1.2,detail:"A game worth showing up for."}}/>
 </Folder>
</>;
