# Should I Bike?

Three-day ride outlook. On first visit, Cloudflare estimates the visitor's city from their IP address without a device-location permission prompt. If no estimate is available, the dashboard uses Miramar, Wellington. A manually selected location takes priority on later visits to the same browser. The page follows the original card layout: best overall, best backup, weakest option, three day cards with morning, afternoon and night slots, and a final call. It shows live conditions and a simple rating based on wind, gusts, rain probability, predicted rain and thunderstorms.

## Run locally

Open `index.html` in a browser. No build step or dependencies are needed. The browser must be able to reach the Open-Meteo forecast and geocoding APIs.

## Deploy to Cloudflare Pages

Connect this GitHub repository to Cloudflare Pages. Set the production branch to `main`, choose no framework preset, use `exit 0` as the build command, and use `.` as the build output directory. The site will publish after the pull request is merged into `main`. The build command is recommended by Cloudflare for static sites using Pages Functions.

The `/api/location` Pages Function reads Cloudflare's approximate IP location and returns only a city, region, country code, coordinates and timezone with `Cache-Control: private, no-store`. It does not return the IP address. `_routes.json` limits Function invocations to that route. If it returns no usable coordinates, the page uses Miramar. Test the endpoint on the deployed domain: `/api/location` should return a small JSON object or an empty 204 response, rather than 404. Approximate IP location can be wrong for VPN and mobile-network users. Manual location search is always available; **Use approximate location** clears a saved manual choice and detects again.

The deployed site uses Cloudflare Access. Keep the production `pages.dev` address and preview addresses covered by separate Access applications. The GitHub repository is public, so do not commit private data or API keys.

If the live site shows an older version after a merge, open the Pages project's Deployments tab and compare the Production deployment commit with GitHub `main`. Retrying an old deployment republishes that old commit. Check Settings > Builds for the connected repository, production branch and automatic deployments, then check the Cloudflare Workers and Pages GitHub app's repository access before triggering a fresh commit on `main`.

## Forecast logic

- Miramar fallback data comes from Open-Meteo at approximately 41.317° S, 174.817° E. Search locations come from Open-Meteo's GeoNames-based geocoding service. Each forecast uses local time at the chosen location. Suggestions appear after three typed characters; keyboard arrows and Enter also select a result.
- Morning covers 05:00–11:59, afternoon 12:00–17:59, and night 18:00–23:59. Passed hours are not rated. After 22:00, no two full hours remain in the current day, so the dashboard shows the next three days.
- Forecast day cards show the rating and conditions for the full morning, afternoon or night window without a departure time. Best overall and Best backup cards show the highest-scoring two-hour ride-out stretches, their exact time ranges, and temperature, wind, gusts, rain chance and rain total for those two hours. Both hours must be at least 12°C, the rider's minimum comfort temperature. The Weakest option shows the poorest two-hour stretch for comparison, not a departure recommendation.
- Each window displays the maximum hourly wind, gust and rain probability, the sum of predicted hourly rain, and average temperature.
- Favourable means wind below 20 km/h, gusts below 35 km/h, rain chance below 30%, and rain below 0.4 mm.
- Avoid exposed routes means wind at least 30 km/h, gusts at least 50 km/h, rain chance at least 60%, rain at least 1.5 mm, or forecast thunder. Other windows are marked Use caution.
- Scores split those ratings into five planning bands: 5/5 when wind is below 15 km/h, gusts below 25 km/h, rain chance below 15%, and rain below 0.1 mm; otherwise Favourable is 4/5. Use caution is 3/5 when wind is below 25 km/h, gusts below 42 km/h, rain chance below 45%, and rain below 0.8 mm; otherwise it is 2/5. Avoid is always 1/5.
- Best and backup are chosen from the highest-scoring suitable two-hour stretches in different complete upcoming windows. Within a score band, the lower combined wind, gust and rain burden wins. A good two-hour stretch may appear inside a lower-rated full window because conditions change during the window. Weakest is the lowest-ranked two-hour stretch across complete windows. If no two-hour stretch meets the weather and temperature limits, the page recommends no ride.
- These thresholds are personal planning heuristics, not official safety limits. Route notes compare broad exposure and are not navigation instructions.
- Miramar and Wellington city have broad local route examples. For other locations, notes use wind direction and the rating to suggest a sensible loop strategy. The forecast API does not know local roads, so it does not name unverified routes elsewhere.
- The page never shows a ride rating when required forecast inputs are missing. It displays `/inco` and states what is missing.

Forecast data is from [Open-Meteo](https://open-meteo.com/) under CC BY 4.0. The free API is intended for non-commercial use.
