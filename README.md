# Should I Bike?

Planned: a dashboard showing whether conditions are suitable for cycling.

## Run locally

Open `index.html` in a browser. No build step or dependencies are needed.

## Deploy to Cloudflare Pages

Connect this GitHub repository to Cloudflare Pages. Set the production branch to `main`, choose no framework preset, leave the build command blank, and use `.` as the build output directory. The site will publish after the pull request is merged into `main`.

If the site should be private, configure Cloudflare Access for the published domain and verify access in a private browser window before sharing the URL.

## Next steps

- Connect a current weather and wind data source for the next three days.
- Define ride thresholds and compare morning and afternoon conditions.
- Add route-specific guidance based on wind direction and exposure.
Shows a dashboard if its good to bike or not
