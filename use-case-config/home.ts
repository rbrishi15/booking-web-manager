import { HomeUnavailableError, type HomeDependencies } from "@/app/home/dependencies";
import { readSessionServerSettings } from "@/app/sessions/server-environment";
import { createPostgresPoolProvider } from "@/lib/database/postgres-pool";
import type { SqlExecutor } from "@/lib/money/sql";
import { PostgresUpcomingBookingsReader } from "@/lib/sessions/postgres-upcoming-bookings-reader";
import { getSingaporeWeather } from "@/lib/weather/singapore-weather";
import { ListUpcomingBookings } from "@/use-cases/sessions/ListUpcomingBookings";

/** Only server pages with a verified active identity acquire this capability. */
export function createHomeDependencies(): HomeDependencies {
  const settings = readSessionServerSettings();
  if (settings === undefined) return {
    upcomingBookings: { list: async () => { throw new HomeUnavailableError(); } },
    weather: getSingaporeWeather,
  };
  const getPool = createPostgresPoolProvider(settings.databaseUrl);
  const sql: SqlExecutor = {
    query: async (statement, values) => (await getPool().query(statement, values ? [...values] : undefined)).rows,
  };
  return {
    upcomingBookings: new ListUpcomingBookings({ reader: new PostgresUpcomingBookingsReader(sql), clock: { now: () => new Date() } }),
    weather: getSingaporeWeather,
  };
}
