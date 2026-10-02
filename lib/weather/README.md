# Singapore weather

The Home server dependency calls `getSingaporeWeather` only after verifying the
account and finding no upcoming bookings. The reader uses the national forecast;
it does not request a location or derive one from profile preferences.

The source is NEA / Meteorological Service Singapore's [24-hour Weather Forecast
on data.gov.sg](https://data.gov.sg/datasets/d_ce2eb1e307bda31993c533285834ef2b/view).
The [public v2 endpoint](https://api-open.data.gov.sg/v2/real-time/api/twenty-four-hr-forecast)
returns the latest forecast when no date is supplied and requires no API key.
The response shape was checked against that endpoint on 1 October 2026.

The reader validates the successful response, forecast text, finite temperature
range, and timestamp offsets. It selects the most recently updated forecast
whose national validity interval contains server time (start inclusive, end
exclusive). Expired, future, malformed, or unsuccessful responses produce an
explicit unavailable state; they never produce sample weather.

The three-second timeout covers both the HTTP response and its JSON body.
Concurrent calls share one request. Valid weather is cached for five minutes
within the server runtime, capped at the forecast's expiry. This cache contains
no identity, profile, or booking data and is independent of Next.js page caching.
Failures are not cached. This module is imported only through Home's server
dependencies; views consume its serialized result through their own types.

The weather card acknowledges NEA / data.gov.sg and links to the [Singapore Open
Data Licence](https://data.gov.sg/open-data-licence), as required by the source's
attribution terms. It labels the information as a forecast and shows its validity
and update times, rather than presenting it as an observed current temperature.
