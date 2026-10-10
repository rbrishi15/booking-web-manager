/** Session start times are shown in Singapore time, like the rest of the app. */
export const singaporeStart = new Intl.DateTimeFormat("en-SG", {
  timeZone: "Asia/Singapore", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
});
