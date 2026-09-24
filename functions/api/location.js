// Cloudflare derives these fields from the visitor's network address.
// Never cache this response or include the address itself in the payload.
export function onRequestGet({ request }) {
  const cf = request.cf || {};
  const latitude = Number(cf.latitude);
  const longitude = Number(cf.longitude);
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

  if (typeof cf.city !== "string" || !cf.city.trim() || cf.latitude == null || cf.longitude == null ||
      !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
      !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
      typeof cf.timezone !== "string" || !cf.timezone) {
    return new Response(null, { status: 204, headers });
  }

  return new Response(JSON.stringify({
    name: cf.city,
    admin1: cf.region || "",
    country_code: cf.country || "",
    latitude,
    longitude,
    timezone: cf.timezone
  }), { headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}
