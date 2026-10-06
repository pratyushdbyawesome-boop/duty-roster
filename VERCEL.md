# Deploying to Vercel (with the Online Availability Collection feature)

This project is one Vercel deployment serving three things together:

- **`index.html`** — the admin tool (the one you already use: week setup, WhatsApp paste, roster generation, and now a new "6 · Online Availability Collection" section)
- **`login.html`** — a separate page you send to announcers, where they log in and mark their own availability
- **`/api`** — the backend both pages talk to, backed by Upstash Redis

## One-time setup

1. **Push this project to a GitHub repo.**
2. **Import it in Vercel** (New Project → pick the repo). Leave build settings on default.
3. **Add a Redis database**: Project → **Storage** tab → create/connect an **Upstash Redis** database (listed under Vercel's Marketplace database providers). This automatically sets `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` for you.
4. **Add your admin PIN**: Settings → Environment Variables → add `SYNC_PIN` with a password only you know. This one PIN protects every admin action (managing accounts, opening a new availability window, unlocking someone, fetching results) — there's nothing to configure per-feature.
5. **Redeploy** once after adding the PIN, so it takes effect.
6. You'll get a URL like `https://your-project.vercel.app`.

## Using it week to week

**In the admin tool** (`index.html`, opened via your Vercel URL — this feature needs the hosted version, not a local file), scroll to **"6 · Online Availability Collection"**:

1. Enter your Vercel URL and admin PIN, click **Connect**.
2. Under **Announcer accounts**, add one account per announcer: pick a username and password for each and share those with them however you normally would (WhatsApp, in person, etc.). You only need to do this once — accounts carry over week to week.
3. Under **Availability request**, pick the week's start date (a Sunday) and a submission deadline, then **Open new window**. This is what resets everyone back to blank/unlocked for the new week — nothing from a previous week carries over or gets mixed in.
4. Send announcers the link to `login.html` on your deployed URL (e.g. `https://your-project.vercel.app/login.html`). They log in with the username/password you gave them, tick the sabhas they're free for each day, and tap **Lock my availability** when done. Once locked, they can't change it themselves — only you can, from the **Submission status** table's "Unlock" button.
5. Check the **Submission status** table any time to see who's locked in and who hasn't.
6. When you're ready, click **⬇ Fetch locked-in availability into table above** — this pulls everyone who has locked in into the same announcer table the WhatsApp-paste method fills, ready to generate the roster exactly as before. Only locked submissions are pulled in; anyone who hasn't locked yet is simply skipped (not fetched as blank), so you never accidentally import an unfinished answer.

The WhatsApp paste box and the online collection are two independent ways to fill the same table — use either one, or mix both in the same week if some people prefer WhatsApp and others prefer logging in.

## Notes

- Passwords are stored hashed (never in plain text), but this is still a small internal tool, not a high-security system — use PINs/passwords that are reasonable for an internal team, not reused from anything sensitive.
- Fetching always asks the server for the current state fresh — there's no stale caching of who's locked in, so what you see when you click Fetch is always accurate at that moment.
- Opening a new window doesn't delete old answers, it just starts a new round — last week's submissions are simply no longer the "current" ones being looked at.
