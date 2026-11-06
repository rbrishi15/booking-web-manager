import React from 'react';

/** Mirrors components/ui/booking-logo.tsx: Inter Black, exact casing, no tracking. */
export const BookingLogo:React.FC<{size?:number;dark?:boolean;style?:React.CSSProperties}>=({size=32,dark=false,style})=><span data-booking-logo style={{fontFamily:'Inter',fontWeight:900,fontStyle:'normal',textTransform:'none',whiteSpace:'nowrap',letterSpacing:0,fontSize:size,lineHeight:'normal',color:dark?'#FAFAFA':'#000000',...style}}>Booking.</span>;
