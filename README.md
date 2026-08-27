# 404 Police

A status dashboard for AI, messaging, streaming, developer, cloud, and consumer
services. Pick the services you care about, see whether they are up, read the
active incidents.

This branch is the **static rewrite**: no server, no build step, no dependencies.
The repository root is the deployed site.

## How it differs from the Node version

The original `404Police` was an Express app (`server.js`) that proxied every status
API server-side and served the frontend from `source/`. That works, but it needs a
host, and the proxy fetched the full catalog on every load.

The static build inverts both decisions:

| | Node original | Static rewrite |
|---|---|---|
| Hosting | needs a Node process | GitHub Pages, or any static host |
| Status fetches | server-side proxy | browser calls each API directly |
| What gets fetched | the whole catalog | only the services on your board |
| Catalog | hard-coded in `server.js` | `services.json`, one cached request |
| Dependencies | Express + npm tree | none |

Removing the proxy has one real cost: the browser can only call endpoints that send
`Access-Control-Allow-Origin`. That is why the catalog carries a `supported` flag and
why this repo ships two tools for checking it (below).

## Running locally

No install step. Serve the directory over HTTP — opening `index.html` as a `file://`
URL will not work, because `fetch('services.json')` is blocked from that origin.

```bash
python3 -m http.server 8100 --bind 127.0.0.1
# then open http://127.0.0.1:8100
```

## Layout

```
index.html          markup, and the Content-Security-Policy meta tag
app.js              dashboard: catalog, board, fetching, rendering
waves.js            animated canvas background
style.css           dashboard styling
add-service.css     add-service modal styling
services.json       the service catalog (data, not endpoints — see below)
tests/              dependency-free static validation (node --test)
tools/
  catalog-health.mjs  command-line catalog + endpoint health check
  cors-check.html     the same probe, from a real browser
.github/workflows/pages.yml  validate, then deploy the root to Pages
```

## The catalog

`services.json` is data. The app never fetches the whole thing — it reads the file
once, then fetches only the services on your board, which lives in `localStorage`
under `404police.board`. Adding a service costs exactly one request.

```json
{ "key": "openai", "name": "OpenAI", "category": "ai",
  "provider": "statuspage", "url": "https://status.openai.com/api/v2/summary.json" }
```

- `provider: "statuspage"` — the Atlassian Statuspage v2 summary API. One parser
  handles all of them.
- `supported: false` — the entry is searchable but cannot be added to a board. These
  are services with a bespoke status format (AWS, Google Cloud, Azure, Slack, Apple,
  Steam, PlayStation, Xbox, Microsoft 365, Meta, Salesforce, Adobe, Heroku, Oracle
  Cloud, IBM Cloud, and two Instatus-hosted pages). Each needs its own adapter in
  `normalise()` before the flag can be flipped. Marking them unsupported is what
  guarantees a board can never contain a card that cannot resolve.

Current counts: 139 entries, 122 Statuspage, 17 awaiting a custom adapter.

`custom:instatus` (Stability AI, Linear) was reclassified from `statuspage` by the
test suite: Instatus serves `/summary.json` rather than `/api/v2/summary.json`, and
its payload carries a bare string at `page.status` instead of the
`{indicator, description}` object `normalise()` expects — so both cards would have
rendered a permanent "Unknown". Instatus is a small adapter and probably the easiest
of the 17 to write.

An unrecognised payload normalises to `unknown`, never to `operational`. Reporting a
service healthy because we could not parse its response is the one failure mode a
status dashboard must not have.

## Checks

Everything runs on stock Node 20. There is no `package.json` and nothing to install.

```bash
node --check app.js && node --check waves.js     # syntax
node -e "JSON.parse(require('fs').readFileSync('services.json','utf8'))"
node --test tests/                                # static validation suite
```

The test suite is offline and deterministic. Beyond catalog shape, it checks the
things that break a static deploy silently: that every asset `index.html` references
exists, that every `getElementById` in `app.js` matches an `id` in the markup, that
the CSP covers every external origin the page actually uses, and that no inline
`<script>` has crept in under a `script-src 'self'` policy.

### Catalog health check

`tools/catalog-health.mjs` is the networked check — the question "would this endpoint
actually work in a browser on Pages?"

```bash
node tools/catalog-health.mjs                   # everything, writes reports/
node tools/catalog-health.mjs --static-only     # no network at all
node tools/catalog-health.mjs --supported-only  # skip the known-unsupported bucket
node tools/catalog-health.mjs --limit 10 --concurrency 4 --timeout 8000
```

Per endpoint it checks HTTP status, then CORS — sending a real `Origin` header,
because without one a CDN has no reason to emit `Access-Control-Allow-Origin` and the
probe would pass on endpoints a browser cannot use — then, for Statuspage providers,
that the payload actually contains the `status.indicator` and `status.description`
fields `app.js` reads.

It is bounded by construction: concurrency clamped to 12, timeout clamped to 30s, one
retry for network errors only. Walking 139 third-party status pages must not look
like an attack to any of them.

Failures are bucketed by intent. A failing **supported** entry is a real problem and
exits 2. A failing **unsupported** entry is expected — that is what the flag means —
and is reported separately without affecting the exit code. If *every* probe fails at
the network stage the run exits 3 and says so, rather than claiming 139 outages when
the truth is that the host has no egress.

Reports land in `reports/` as timestamped JSON. That directory is gitignored: the
output is a point-in-time snapshot of someone else's uptime, not source.

Exit codes: `0` clean · `1` static failure · `2` supported endpoint failure ·
`3` could not run.

One environment caveat: Node's global `fetch` ignores `HTTP_PROXY`/`HTTPS_PROXY`
before Node 24, so on a proxied host every probe fails with `EAI_AGAIN` while `curl`
to the same URL succeeds. The script detects this and says so instead of reporting
phantom outages. On Node 24+ use `NODE_USE_ENV_PROXY=1`; otherwise run it on an
unproxied host or let CI run it.

`tools/cors-check.html` answers the same question from a real browser, which is the
authoritative answer — it is the exact environment the deployed page runs in. Serve
the directory and open `/tools/cors-check.html`.

## Deployment

`.github/workflows/pages.yml` runs on push to `github-pages-static`, or on demand via
`workflow_dispatch`. It validates first (syntax, JSON, `node --test`), then uploads
the repository root with `upload-pages-artifact` and publishes with `deploy-pages`.
The health check runs in CI as `continue-on-error` — a third-party outage should
report, not block a deploy of our own files.

`.nojekyll` is present so Pages serves the tree verbatim instead of running it
through Jekyll.

To enable: repository **Settings → Pages → Source → GitHub Actions**.

## Content Security Policy

GitHub Pages serves static files and cannot set response headers, so the policy
travels in the document as a `<meta http-equiv>` tag.

```
default-src 'none';
script-src  'self';
style-src   'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src    'self' https://fonts.gstatic.com;
img-src     'self' data:;
connect-src 'self' https:;
base-uri    'self';
form-action 'none';
object-src  'none'
```

Three choices worth stating plainly:

- **`connect-src https:`, not an allow-list.** The board is user-extensible; any of
  the 124 supported hosts may be fetched and more can be added without editing
  `index.html`. This is the weakest directive in the policy. It still blocks
  cleartext `http:` and non-HTTP schemes, and `script-src 'self'` means an attacker
  who could exfiltrate through it would already need script execution.
- **`style-src` needs `'unsafe-inline'`**, for the `style="display: none"` attributes
  on the category sections and the Google Fonts stylesheet. `script-src` does not and
  stays locked to `'self'` — `app.js` builds its markup with `innerHTML` from
  escaped values, which CSP does not restrict, and there are no inline `<script>`
  blocks. A test enforces both halves of that.
- **A meta CSP silently ignores `frame-ancestors`, `report-uri`, and `sandbox`.**
  They are deliberately absent rather than listed-and-ineffective. Clickjacking
  protection would need a real header, which means a host that can set one. A test
  fails if any of those three appear.

## Privacy

The dashboard has no backend, no analytics, and no account. Your board lives in
`localStorage` and is never transmitted. But "no backend" is not the same as "no
third-party contact", and there are two exposures worth being explicit about:

**Status APIs.** Because the browser calls each status endpoint directly rather than
going through a proxy, every service on your board sees your IP address, your
`User-Agent`, and a `Referer` identifying the dashboard — roughly every 5 minutes,
for as long as the tab is open. A visitor with 16 default services is making direct
contact with 16 companies' CDNs. The Node original hid this behind its proxy, at the
cost of needing a server. This is the central tradeoff of the static build, and it is
not fixable without reintroducing one.

Auto-refresh pauses when the tab is hidden, which bounds the exposure to time actually
spent looking at the page.

**Google Fonts.** `style.css` opens with an `@import` of Montserrat from
`fonts.googleapis.com`, so loading the page contacts Google and discloses the same
connection metadata. This one *is* avoidable: self-hosting the two or three woff2
files and dropping `fonts.googleapis.com` / `fonts.gstatic.com` from the CSP would
remove the third party entirely and make the page faster. It is worth doing and has
not been done yet.

Neither exposure involves data the dashboard collects — there is nothing to collect.
Both are ordinary connection metadata, disclosed to parties you did not explicitly
choose to contact.

## Credits

Created by Aryan Bhujade.
