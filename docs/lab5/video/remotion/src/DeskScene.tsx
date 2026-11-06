import React from 'react';
import {AbsoluteFill, CanvasImage, Easing, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {Video} from '@remotion/media';

export type Actor = 'Neoh' | 'Harrison' | 'Joseph';
const palette = {
  Neoh: {shirt:'#54765C', dark:'#354E3E', skin:'#D8A980', shade:'#BD8965', hair:'#29382F', accent:'#708F57'},
  Harrison: {shirt:'#6588B0', dark:'#365675', skin:'#DAB28E', shade:'#BD8D69', hair:'#43342C', accent:'#6286AD'},
  Joseph: {shirt:'#CA795D', dark:'#8E4E3C', skin:'#BD8B68', shade:'#9F6E50', hair:'#2D2C29', accent:'#C87659'},
};

export const Character: React.FC<{actor:Actor; mood?:'thinking'|'ready'}> = ({actor,mood='ready'}) => {
  const f=useCurrentFrame(); const p=palette[actor];
  const blink = (f+({Neoh:12,Harrison:46,Joseph:70}[actor]))%113<5;
  const nod=Math.sin(f/43)*1.1;
  return <g>
    <rect x="637" y="600" width="196" height="274" rx="40" fill="#C2C9B4"/>
    <path d="M733 849V965M733 958L650 1005M733 958L808 1005" stroke="#465B4B" strokeWidth="16" strokeLinecap="round"/>
    <path d="M667 793Q755 780 829 800L865 857Q858 891 837 920L828 974H773L783 901 755 859 728 977H670L694 875Q650 849 667 793Z" fill="#344D43"/>
    <path d="M670 974H728L736 1001Q700 1015 654 1002Z" fill="#F9F3DF"/>
    <path d="M773 973H828L852 998Q813 1014 769 1002Z" fill="#F9F3DF"/>
    <path d="M660 566Q719 534 788 543Q839 548 864 591L885 791Q767 843 643 791Z" fill={p.shirt}/>
    <path d="M660 566Q685 552 707 552L714 793Q673 800 643 791Z" fill={p.dark} opacity=".23"/>
    <rect x="715" y="490" width="59" height="73" rx="22" fill={p.shade}/>
    <path d="M708 543Q743 575 782 545" fill="none" stroke={p.dark} strokeWidth="10"/>
    <g style={{rotate:`${nod}deg`,transformOrigin:'744px 494px'}}>
      <path d="M684 392Q682 350 731 346Q782 344 803 382L809 424 827 444 809 454 804 492Q791 518 750 518L707 494Z" fill={p.skin}/>
      <path d="M691 398Q690 441 707 479L734 509 712 491 685 449Z" fill={p.shade} opacity=".5"/>
      <ellipse cx="701" cy="438" rx="18" ry="23" fill={p.skin}/>
      <path d="M699 432Q710 428 708 446" stroke={p.shade} strokeWidth="4" fill="none"/>
      {actor==='Harrison' ? <g fill={p.hair}>
        <path d="M682 415Q653 355 702 337Q772 317 805 368L792 393 767 375 732 389 714 423Z"/>
        <circle cx="692" cy="350" r="23"/><circle cx="723" cy="335" r="24"/><circle cx="753" cy="338" r="24"/><circle cx="781" cy="350" r="21"/>
      </g> : <path d={actor==='Neoh'?'M682 416Q653 355 701 337Q773 320 806 369L784 393 765 367Q732 403 709 405L708 435 692 423Z':'M682 419Q657 364 694 341Q747 316 791 350L810 384 782 398 764 374 714 405 708 441Z'} fill={p.hair}/>}
      <path d="M770 403Q783 397 796 402" stroke={p.hair} strokeWidth="5" strokeLinecap="round" fill="none"/>
      {blink ? <path d="M775 421H794" stroke="#29382F" strokeWidth="4" strokeLinecap="round"/> : <>
        <ellipse cx="786" cy="421" rx="9" ry="6" fill="#FFF8EB"/>
        <circle cx="790" cy="421" r="4.5" fill="#26382E"/>
      </>}
      {actor==='Joseph' && <g fill="none" stroke="#40483C" strokeWidth="4"><ellipse cx="785" cy="423" rx="21" ry="17"/><path d="M765 419L713 411M805 423L814 426"/></g>}
      <path d={mood==='thinking'?'M783 478Q792 471 801 477':'M782 470Q791 478 802 470'} fill="none" stroke="#8D5C45" strokeWidth="4" strokeLinecap="round"/>
      <path d="M802 448L810 451" stroke={p.shade} strokeWidth="3" strokeLinecap="round"/>
    </g>
    <path d="M828 588Q856 657 929 700L1085 734" fill="none" stroke={p.dark} strokeWidth="50" strokeLinecap="round"/>
    <path d="M819 588Q848 648 935 690L1088 726" fill="none" stroke={p.shirt} strokeWidth="44" strokeLinecap="round"/>
    <path d="M1069 722L1101 733" stroke="#EEE9D8" strokeWidth="30" strokeLinecap="round"/>
    <g style={{translate:`0px ${Math.sin(f/9)*2}px`}}>
      <path d="M1100 734Q1132 714 1153 735L1173 744 1167 756 1111 752Z" fill={p.skin}/>
      <path d="M1140 742L1167 746" stroke={p.shade} strokeWidth="3" strokeLinecap="round"/>
    </g>
    <path d="M675 597Q669 690 755 732L894 755" fill="none" stroke={p.shirt} strokeWidth="50" strokeLinecap="round"/>
    <path d="M888 752Q916 733 947 750L965 765 954 777 899 775Z" fill={p.skin}/>
  </g>;
};

export const Room: React.FC<{actor:Actor; children?:React.ReactNode; mood?:'thinking'|'ready'}> = ({actor,children,mood}) => {
  const f=useCurrentFrame();const color=palette[actor];
  return <AbsoluteFill style={{background:'#F4F0E5',overflow:'hidden'}}>
    <svg width="1920" height="1080" style={{position:'absolute'}}>
      <path d="M0 850Q650 775 1920 846V1080H0Z" fill="#E9E4D6"/>
      <circle cx="1560" cy="210" r="250" fill="#E4E9D4" opacity=".65"/>
      <rect x="108" y="307" width="314" height="333" rx="155" fill="#D1DDC0"/>
      <path d="M125 486Q259 405 408 479V622H125Z" fill="#91A97C"/>
      <path d="M145 578L387 506 406 600 169 623Z" fill="#D8B68B"/>
      <path d="M164 580L375 519M171 597L380 536M270 548L283 590" stroke="#F8F2DF" strokeWidth="3"/>
      <path d="M118 467H412M266 325V630" stroke="#F8F5EB" strokeWidth="12"/>
      <rect x="108" y="307" width="314" height="333" rx="155" fill="none" stroke="#DAD9C7" strokeWidth="16"/>
      <path d="M181 247Q253 212 332 251" stroke="#C2CAB2" strokeWidth="5" fill="none"/>
      <rect x="1646" y="145" width="161" height="193" rx="7" fill="#E5DCC9"/>
      <rect x="1659" y="158" width="135" height="166" fill="#FFF9EC"/>
      <circle cx="1726" cy="231" r="45" fill={color.accent}/>
      <path d="M1693 213Q1726 248 1758 210M1690 247Q1726 213 1764 248" fill="none" stroke="#E9EFCB" strokeWidth="3"/>
      <ellipse cx="1150" cy="944" rx="598" ry="72" fill="#D4D7C6" opacity=".5"/>
      <path d="M587 765L565 1040M1727 765L1763 1040" stroke="#B79169" strokeWidth="30"/>
      <path d="M588 786H1726" stroke="#C4A17A" strokeWidth="24"/>
      <path d="M1320 659V737" stroke="#314B43" strokeWidth="30"/>
      <path d="M1245 741Q1328 716 1411 741Z" fill="#314B43"/>
      <rect x="520" y="748" width="1296" height="30" rx="15" fill="#DAB58B"/>
      <path d="M548 758H1790" stroke="#EAD0AE" strokeWidth="4"/>
      <path d="M1059 710H1336L1375 740H1037Z" fill="#C4CEC4"/>
      <path d="M1069 721H1330M1064 730H1343M1102 716L1095 735M1144 716L1140 736M1189 716L1187 736M1234 716L1234 736M1275 716L1280 737" stroke="#EFF2E8" strokeWidth="3"/>
      <ellipse cx="1459" cy="729" rx="31" ry="17" fill="#B4C1B2"/><path d="M1458 714V726" stroke="#E7EBDF" strokeWidth="3"/>
      <rect x="1584" y="671" width="54" height="70" rx="12" fill="#F8F3E6"/><path d="M1638 682Q1671 682 1661 709Q1657 720 1639 718" fill="none" stroke="#F8F3E6" strokeWidth="10"/>
      <path d={`M1603 655Q${1594+Math.sin(f/26)*6} 634 1608 615M1620 655Q${1633+Math.sin(f/29)*6} 633 1616 612`} stroke="#C0C5B2" strokeWidth="3" fill="none" opacity=".7"/>
      <path d="M1765 730L1755 646H1830L1818 730Z" fill="#CA8C68"/>
      <path d="M1793 652V541M1793 613L1758 580M1793 585L1825 553" stroke="#658359" strokeWidth="6" fill="none"/>
      <ellipse cx="1753" cy="573" rx="16" ry="35" fill="#8CA06B" transform="rotate(-35 1753 573)"/>
      <ellipse cx="1825" cy="547" rx="15" ry="35" fill="#6D8B59" transform="rotate(28 1825 547)"/>
      <ellipse cx="1794" cy="538" rx="18" ry="31" fill="#7E9B62"/>
      <g transform="rotate(-17 467 807)"><ellipse cx="467" cy="758" rx="57" ry="76" fill="none" stroke="#607A53" strokeWidth="12"/><path d="M467 835V971" stroke="#49644A" strokeWidth="18"/><path d="M430 716L504 801M415 743L505 781M432 704V812M453 689V826M477 687V829M500 707V810" stroke="#B7C6A2" strokeWidth="2"/></g>
      <circle cx="409" cy="979" r="23" fill="#B5C56E"/><path d="M392 966Q417 976 414 1000M394 994Q397 970 426 965" stroke="#EAF0C8" strokeWidth="2" fill="none"/>
    </svg>
    <div style={{position:'absolute',left:1022,top:262,width:676,height:414,background:'#314B43',borderRadius:24,boxShadow:'0 18px 32px #233C2D20'}}/>
    <div style={{position:'absolute',left:1040,top:280,width:640,height:360,overflow:'hidden',borderRadius:8,background:'#0B211C'}}>{children}</div>
    <div style={{position:'absolute',left:1334,top:654,width:10,height:5,borderRadius:10,background:'#96B583'}}/>
    <svg width="1920" height="1080" style={{position:'absolute',pointerEvents:'none'}}><g transform="translate(160 0)"><Character actor={actor} mood={mood}/></g></svg>
  </AbsoluteFill>;
};

export const DeskPortal: React.FC<{actor:Actor; src:string; poster?:string; posterDuration?:number; duration?:number; hold?:number; detail?:string}> = ({actor,src,poster,posterDuration=0,duration=1,hold=.12,detail}) => {
  const frame=useCurrentFrame();const {fps}=useVideoConfig();
  const opts={extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.bezier(.62,0,.2,1)} as const;
  return <AbsoluteFill style={{background:'#F4F0E5',overflow:'hidden'}}>
    <AbsoluteFill style={{transformOrigin:'0 0',scale:interpolate(frame,[hold*fps,(duration-.03)*fps],[1,3],opts),translate:interpolate(frame,[hold*fps,(duration-.03)*fps],['0px 0px','-3120px -840px'],opts)}}>
      <Room actor={actor}>
        {poster && <CanvasImage src={staticFile(poster)} style={{width:'100%',height:'100%'}}/>}
        <Sequence from={posterDuration*fps} premountFor={fps}>
          <Video src={staticFile(src)} muted objectFit="contain" premountFor={fps} style={{width:'100%',height:'100%'}}/>
        </Sequence>
      </Room>
    </AbsoluteFill>
    <div style={{position:'absolute',left:115,top:96,opacity:interpolate(frame,[hold*fps,(hold+.35)*fps],[1,0],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),translate:interpolate(frame,[0,.4*fps],['0px 14px','0px 0px'],{extrapolateRight:'clamp',easing:Easing.out(Easing.cubic)})}}>
      <div style={{fontSize:22,fontWeight:600,letterSpacing:3.4,color:palette[actor].accent,marginBottom:15}}>A GAME, THREE PERSPECTIVES</div>
      <div style={{fontFamily:'Outfit',fontSize:104,fontWeight:600,color:'#233F32',lineHeight:1}}>{actor}</div>
      <div style={{fontSize:31,color:'#63735D',marginTop:18}}>{detail || 'A plan worth showing up for.'}</div>
    </div>
  </AbsoluteFill>;
};
