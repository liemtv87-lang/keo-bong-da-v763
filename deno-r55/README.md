# KQ247 R55 — independent hosting candidate

Target: Deno Deploy (new organization, Free plan). Use this branch only; do not merge into main or change running football/lottery/Vietlott/SEO URLs until migration passes.

Separate infrastructure: own Deno app, own Deno KV, cron. Never connect to Supabase, Neon, Render, Floot or existing Netlify sources.

Conditions before go-live:
1. Create a separate Deno Deploy app from this GitHub branch.
2. Provision and attach a dedicated Deno KV database.
3. Configure a legal independent odds feed via environment variables. Do not generate or invent AH/OU prices.
4. 11:00 VN kickoff, midday 10-minute checks, periodic refresh; lock a single real daily snapshot.
5. Only one strongest AH or OU bet per match; validate source, market, league, country, timestamp.
6. Preserve existing customer codes, devices and expirations with a verified private migration, then gate all client APIs.
7. Test main and customer links. Change public links and bots ONLY when all tests pass.

Free-tier reference: https://deno.com/deploy/pricing
Current platform docs: https://docs.deno.com/deploy/
