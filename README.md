# Should I Bike?

Three-day ride outlook for Miramar, Wellington. The dashboard follows the original card layout: best overall, best backup, weakest option, three day cards with morning and afternoon slots, and a final call. It shows live conditions and a simple rating based on wind, gusts, rain probability, predicted rain and thunderstorms.

## Run locally

Open `index.html` in a browser. No build step or dependencies are needed. The browser must be able to reach the Open-Meteo forecast API.

## Deploy to Cloudflare Pages

Connect this GitHub repository to Cloudflare Pages. Set the production branch to `main`, choose no framework preset, leave the build command blank, and use `.` as the build output directory. The site will publish after the pull request is merged into `main`.

The deployed site uses Cloudflare Access. Keep the production `pages.dev` address and preview addresses covered by separate Access applications. The GitHub repository is public, so do not commit private data or API keys.

If the live site shows an older version after a merge, open the Pages project's Deployments tab and compare the Production deployment commit with GitHub `main`. Retrying an old deployment republishes that old commit. Check Settings > Builds for the connected repository, production branch and automatic deployments, then check the Cloudflare Workers and Pages GitHub app's repository access before triggering a fresh commit on `main`.

## Forecast logic

- Data comes from Open-Meteo at approximately 41.317° S, 174.817° E, using `Pacific/Auckland` time.
- Morning covers 06:00–11:00 and afternoon covers 12:00–17:00. Passed hours are not rated. After 17:00, the dashboard shows the next three days.
- Each window displays the maximum hourly wind, gust and rain probability, the sum of predicted hourly rain, and average temperature.
- Favourable means wind below 20 km/h, gusts below 35 km/h, rain chance below 30%, and rain below 0.4 mm.
- Avoid exposed routes means wind at least 30 km/h, gusts at least 50 km/h, rain chance at least 60%, rain at least 1.5 mm, or forecast thunder. Other windows are marked Use caution.
- These thresholds are personal planning heuristics, not official safety limits. Route notes compare broad exposure and are not navigation instructions.
- The page never shows a ride rating when required forecast inputs are missing. It displays `/inco` and states what is missing.

Forecast data is from [Open-Meteo](https://open-meteo.com/) under CC BY 4.0. The free API is intended for non-commercial use.
