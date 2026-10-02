const SPORT_IMAGES = new Map([
  ["Badminton", "/images/sports/badminton.jpg"],
  ["Basketball", "/images/sports/basketball.jpg"],
  ["Football", "/images/sports/football.jpg"],
  ["Futsal", "/images/sports/futsal.jpg"],
  ["Tennis", "/images/sports/tennis.jpg"],
  ["Volleyball", "/images/sports/volleyball.jpg"],
]);

/** Decorative local imagery, including a fallback for legacy sport values. */
export function sportImage(sport: string): string {
  return SPORT_IMAGES.get(sport) ?? "/images/sports/tennis.jpg";
}
