import { cn } from "@/lib/utils";

/** Figma wordmark: Inter Black, 20px, normal line height and zero tracking. */
export function BookingLogo({ className }: { readonly className?: string }) {
  return (
    <span className={cn("whitespace-nowrap font-sans text-[20px] font-black not-italic leading-[normal] tracking-normal text-black dark:text-foreground", className)}>
      Booking.
    </span>
  );
}
