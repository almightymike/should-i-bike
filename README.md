# Should I Bike?

Three-day ride outlook. The dashboard opens with Miramar, Wellington, and lets you select other locations from suggestions while typing. It remembers the last selection in this browser. The page follows the original card layout: best overall, best backup, weakest option, three day cards with morning and afternoon slots, and a final call. It shows live conditions and a simple rating based on wind, gusts, rain probability, predicted rain and thunderstorms.

## Run locally

Open `index.html` in a browser. No build step or dependencies are needed. The browser must be able to reach the Open-Meteo forecast and geocoding APIs.

## Deploy to Cloudflare Pages

Connect this GitHub repository to Cloudflare Pages. Set the production branch to `main`, choose no framework preset, leave the build command blank, and use `.` as the build output directory. The site will publish after the pull request is merged into `main`.

The deployed site uses Cloudflare Access. Keep the production `pages.dev` address and preview addresses covered by separate Access applications. The GitHub repository is public, so do not commit private data or API keys.

If the live site shows an older version after a merge, open the Pages project's Deployments tab and compare the Production deployment commit with GitHub `main`. Retrying an old deployment republishes that old commit. Check Settings > Builds for the connected repository, production branch and automatic deployments, then check the Cloudflare Workers and Pages GitHub app's repository access before triggering a fresh commit on `main`.

## Forecast logic

- Default data comes from Open-Meteo at approximately 41.317° S, 174.817° E. Other locations come from Open-Meteo's GeoNames-based geocoding search. Each forecast uses local time at the chosen location. Suggestions appear after three typed characters; keyboard arrows and Enter also select a result.
- Morning covers 06:00–11:00 and afternoon covers 12:00–17:00. Passed hours are not rated. After 17:00, the dashboard shows the next three days.
- Each window displays the maximum hourly wind, gust and rain probability, the sum of predicted hourly rain, and average temperature.
- Favourable means wind below 20 km/h, gusts below 35 km/h, rain chance below 30%, and rain below 0.4 mm.
- Avoid exposed routes means wind at least 30 km/h, gusts at least 50 km/h, rain chance at least 60%, rain at least 1.5 mm, or forecast thunder. Other windows are marked Use caution.
- Scores split those ratings into five planning bands: 5/5 when wind is below 15 km/h, gusts below 25 km/h, rain chance below 15%, and rain below 0.1 mm; otherwise Favourable is 4/5. Use caution is 3/5 when wind is below 25 km/h, gusts below 42 km/h, rain chance below 45%, and rain below 0.8 mm; otherwise it is 2/5. Avoid is always 1/5.
- Best and backup are the two highest-scoring complete upcoming windows above 1/5. Within a score band, the lower combined wind, gust and rain burden wins. Weakest is the lowest ranked complete window. If all windows are 1/5, the page recommends no ride.
- These thresholds are personal planning heuristics, not official safety limits. Route notes compare broad exposure and are not navigation instructions.
- Miramar has specific broad route examples. Other locations receive generic route exposure notes because the forecast API does not know local cycling roads.
- The page never shows a ride rating when required forecast inputs are missing. It displays `/inco` and states what is missing.

Forecast data is from [Open-Meteo](https://open-meteo.com/) under CC BY 4.0. The free API is intended for non-commercial use.
