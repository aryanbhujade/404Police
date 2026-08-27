#!/usr/bin/env node
//
// 404 Police — catalog health check.
//
// Answers one question: which catalog entries would actually work in a browser on
// GitHub Pages? tools/cors-check.html answers it from a real browser; this answers
// it from CI and the command line, so a broken endpoint is caught before deploy.
//
// Two classes of check, kept separate on purpose:
//
//   static   — JSON shape, duplicate keys, HTTPS-only URLs, defaults resolvable.
//              No network. A failure here is a bug in services.json and is fatal.
//   endpoint — HTTP status, CORS headers, Statuspage payload shape. Network.
//              A failure here may be the service having a bad day, so it exits 2
//              rather than 1 and never blocks on `supported: false` entries.
//
// Entries marked `supported: false` are the deliberately unsupported custom
// adapters (AWS, Slack, Apple, ...). They are probed for information only and their
// failures are reported in a separate bucket that cannot fail the run — the whole
// point of the flag is that we already know they need a per-provider parser.
//
// Usage:
//   node tools/catalog-health.mjs                  full run, writes reports/
//   node tools/catalog-health.mjs --static-only    no network at all
//   node tools/catalog-health.mjs --limit 10       probe first 10 endpoints
//   node tools/catalog-health.mjs --supported-only skip the unsupported bucket
//   node tools/catalog-health.mjs --concurrency 4 --timeout 8000
//
// Exit codes: 0 clean · 1 static failure · 2 supported endpoint failure(s)
//             3 could not run (bad args, unreadable catalog, network unreachable)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.join(ROOT, 'services.json');
const REPORT_DIR = path.join(ROOT, 'reports');

// The Origin we claim when probing. A Statuspage CDN echoes or wildcards this;
// anything that does not is unusable from a browser regardless of HTTP status.
const PROBE_ORIGIN = 'https://aryanbhujade.github.io';

const KNOWN_CATEGORIES = new Set(['ai', 'messaging', 'streaming', 'developer', 'cloud', 'other']);

// Bounds, all overridable. Defaults are deliberately gentle: this walks 139 third
// party status pages and must not look like an attack to any of them.
const DEFAULTS = {
    concurrency: 6,
    timeout: 10000,
    limit: 0,          // 0 = no limit
    retries: 1,        // one retry, only for network-level errors
    staticOnly: false,
    supportedOnly: false,
    json: true
};

function parseArgs(argv) {
    const opts = { ...DEFAULTS };
    const numeric = { '--concurrency': 'concurrency', '--timeout': 'timeout', '--limit': 'limit', '--retries': 'retries' };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--static-only') { opts.staticOnly = true; continue; }
        if (arg === '--supported-only') { opts.supportedOnly = true; continue; }
        if (arg === '--no-json') { opts.json = false; continue; }
        if (arg === '--help' || arg === '-h') { opts.help = true; continue; }
        if (numeric[arg]) {
            const value = Number(argv[++i]);
            if (!Number.isFinite(value) || value < 0) fail(`--${numeric[arg]} needs a non-negative number`);
            opts[numeric[arg]] = value;
            continue;
        }
        fail(`unknown argument: ${arg}`);
    }
    // Clamp rather than trust: a typo'd --concurrency 500 would hammer real services.
    opts.concurrency = Math.min(Math.max(Math.trunc(opts.concurrency) || 1, 1), 12);
    opts.timeout = Math.min(Math.max(Math.trunc(opts.timeout) || 1000, 1000), 30000);
    opts.retries = Math.min(Math.trunc(opts.retries), 3);
    return opts;
}

function fail(message) {
    console.error(`catalog-health: ${message}`);
    process.exit(3);
}

// ---- static checks --------------------------------------------------------

function checkStatic(catalog) {
    const problems = [];
    const note = (key, message) => problems.push({ key, message });

    if (typeof catalog !== 'object' || catalog === null || Array.isArray(catalog)) {
        note('<root>', 'catalog is not a JSON object');
        return problems;
    }
    if (typeof catalog.version !== 'number') note('<root>', 'version must be a number');
    if (!Array.isArray(catalog.defaults)) note('<root>', 'defaults must be an array');
    if (!Array.isArray(catalog.services)) {
        note('<root>', 'services must be an array');
        return problems;
    }

    const seen = new Map();
    catalog.services.forEach((service, index) => {
        const where = service && service.key ? service.key : `services[${index}]`;
        if (typeof service !== 'object' || service === null) {
            note(where, 'entry is not an object');
            return;
        }
        for (const field of ['key', 'name', 'category', 'provider', 'url']) {
            if (typeof service[field] !== 'string' || !service[field].trim()) {
                note(where, `missing or empty string field: ${field}`);
            }
        }
        if (typeof service.key === 'string') {
            if (seen.has(service.key)) {
                note(service.key, `duplicate key (also at services[${seen.get(service.key)}])`);
            } else {
                seen.set(service.key, index);
            }
            if (!/^[a-z0-9][a-z0-9-]*$/.test(service.key)) {
                note(service.key, 'key should be lowercase kebab-case');
            }
        }
        if (typeof service.category === 'string' && !KNOWN_CATEGORIES.has(service.category)) {
            // The app buckets anything unrecognised into "other", so this is a
            // silent mis-file rather than a crash — worth catching here.
            note(where, `category "${service.category}" has no grid in index.html`);
        }
        if (typeof service.url === 'string') {
            let parsed = null;
            try { parsed = new URL(service.url); } catch { note(where, `unparseable url: ${service.url}`); }
            if (parsed && parsed.protocol !== 'https:') {
                note(where, `url must be https, got ${parsed.protocol}`);
            }
        }
        if ('supported' in service && typeof service.supported !== 'boolean') {
            note(where, 'supported must be a boolean when present');
        }
    });

    if (Array.isArray(catalog.defaults)) {
        catalog.defaults.forEach(key => {
            const index = seen.get(key);
            if (index === undefined) {
                note(key, 'default board key is not in the catalog');
            } else if (catalog.services[index].supported === false) {
                // The app filters unsupported entries out before building the board,
                // so this would silently shrink the default board.
                note(key, 'default board key is marked supported: false');
            }
        });
        const dupes = catalog.defaults.filter((k, i) => catalog.defaults.indexOf(k) !== i);
        dupes.forEach(k => note(k, 'duplicate key in defaults'));
    }

    return problems;
}

// ---- endpoint checks ------------------------------------------------------

function classifyCors(headerValue) {
    if (!headerValue) return { ok: false, detail: 'no access-control-allow-origin header' };
    if (headerValue === '*') return { ok: true, detail: 'wildcard' };
    if (headerValue === PROBE_ORIGIN) return { ok: true, detail: 'origin echoed' };
    return { ok: false, detail: `access-control-allow-origin: ${headerValue}` };
}

function checkStatuspageShape(payload) {
    const problems = [];
    if (typeof payload !== 'object' || payload === null) return ['payload is not a JSON object'];
    const status = payload.status;
    if (typeof status !== 'object' || status === null) {
        problems.push('missing status object');
    } else {
        // app.js normalise() reads exactly these two and falls back to "unknown".
        if (typeof status.indicator !== 'string') problems.push('status.indicator is not a string');
        if (typeof status.description !== 'string') problems.push('status.description is not a string');
    }
    if (payload.incidents !== undefined && !Array.isArray(payload.incidents)) problems.push('incidents is not an array');
    if (payload.components !== undefined && !Array.isArray(payload.components)) problems.push('components is not an array');
    return problems;
}

async function probe(service, opts) {
    const result = {
        key: service.key,
        name: service.name,
        provider: service.provider,
        url: service.url,
        supported: service.supported !== false,
        ok: false,
        stage: null,      // where it stopped: network | http | cors | payload | shape
        http_status: null,
        cors: null,
        detail: null,
        ms: null
    };

    for (let attempt = 0; attempt <= opts.retries; attempt++) {
        const started = Date.now();
        try {
            const response = await fetch(service.url, {
                method: 'GET',
                redirect: 'follow',
                headers: {
                    // The header that makes this a CORS request. Without it the CDN
                    // has no reason to emit access-control-allow-origin and the probe
                    // would pass on endpoints a browser cannot actually use.
                    Origin: PROBE_ORIGIN,
                    Accept: 'application/json',
                    'User-Agent': '404police-catalog-health/1.0 (+https://github.com/aryanbhujade/404Police)'
                },
                signal: AbortSignal.timeout(opts.timeout)
            });
            result.ms = Date.now() - started;
            result.http_status = response.status;

            const cors = classifyCors(response.headers.get('access-control-allow-origin'));
            result.cors = cors.detail;

            if (!response.ok) {
                result.stage = 'http';
                result.detail = `HTTP ${response.status}`;
                return result;
            }
            if (!cors.ok) {
                result.stage = 'cors';
                result.detail = cors.detail;
                return result;
            }

            let payload;
            try {
                payload = await response.json();
            } catch (error) {
                result.stage = 'payload';
                result.detail = `response is not JSON: ${error.message}`;
                return result;
            }

            if (service.provider === 'statuspage') {
                const shape = checkStatuspageShape(payload);
                if (shape.length) {
                    result.stage = 'shape';
                    result.detail = shape.join('; ');
                    return result;
                }
                result.detail = `${payload.status.indicator} / ${payload.status.description}`;
            } else {
                result.detail = 'reachable; payload shape not checked (custom provider)';
            }

            result.ok = true;
            return result;
        } catch (error) {
            result.ms = Date.now() - started;
            result.stage = 'network';
            const cause = error.cause && error.cause.code ? ` (${error.cause.code})` : '';
            result.detail = `${error.name}: ${error.message}${cause}`;
            if (attempt === opts.retries) return result;
        }
    }
    return result;
}

// Bounded worker pool. Same shape as app.js's pooledMap and for the same reason:
// 139 simultaneous requests to third-party CDNs is abuse, not a health check.
async function pooledMap(items, worker, limit) {
    const queue = items.map((item, index) => ({ item, index }));
    const results = new Array(items.length);
    const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
        while (queue.length) {
            const { item, index } = queue.shift();
            results[index] = await worker(item);
        }
    });
    await Promise.all(runners);
    return results;
}

// ---- reporting ------------------------------------------------------------

function pad(value, width) {
    return String(value).padEnd(width);
}

function summarise(results) {
    const supported = results.filter(r => r.supported);
    const unsupported = results.filter(r => !r.supported);
    return {
        supported_total: supported.length,
        supported_ok: supported.filter(r => r.ok).length,
        supported_failed: supported.filter(r => !r.ok).length,
        unsupported_total: unsupported.length,
        unsupported_ok: unsupported.filter(r => r.ok).length,
        by_stage: results.reduce((acc, r) => {
            if (!r.ok && r.stage) acc[r.stage] = (acc[r.stage] || 0) + 1;
            return acc;
        }, {})
    };
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        console.log(await readFile(fileURLToPath(import.meta.url), 'utf8')
            .then(src => src.split('\n').filter(l => l.startsWith('//')).join('\n')));
        return;
    }

    let catalog;
    try {
        catalog = JSON.parse(await readFile(CATALOG, 'utf8'));
    } catch (error) {
        fail(`cannot read ${path.relative(ROOT, CATALOG)}: ${error.message}`);
    }

    console.log('404 Police — catalog health check');
    console.log(`catalog: ${path.relative(ROOT, CATALOG)}`);

    const staticProblems = checkStatic(catalog);
    console.log(`\nstatic checks: ${staticProblems.length ? `${staticProblems.length} problem(s)` : 'clean'}`);
    staticProblems.forEach(p => console.log(`  ✗ ${pad(p.key, 20)} ${p.message}`));

    if (opts.staticOnly) {
        process.exit(staticProblems.length ? 1 : 0);
    }
    if (staticProblems.length) {
        // Probing a malformed catalog produces noise on top of a known bug.
        console.error('\nrefusing to probe endpoints while static checks fail');
        process.exit(1);
    }

    let services = catalog.services.filter(s => !opts.supportedOnly || s.supported !== false);
    if (opts.limit) services = services.slice(0, opts.limit);

    console.log(`\nprobing ${services.length} endpoint(s) — concurrency ${opts.concurrency}, timeout ${opts.timeout}ms, origin ${PROBE_ORIGIN}`);
    const startedAt = new Date();
    const results = await pooledMap(services, service => probe(service, opts), opts.concurrency);
    const elapsed = Date.now() - startedAt.getTime();

    const summary = summarise(results);
    const supportedFailures = results.filter(r => r.supported && !r.ok);
    const unsupportedResults = results.filter(r => !r.supported);

    if (supportedFailures.length) {
        console.log(`\nsupported entries that failed (${supportedFailures.length}):`);
        supportedFailures.forEach(r => console.log(`  ✗ ${pad(r.key, 20)} ${pad(r.stage, 8)} ${r.detail}`));
    }
    if (unsupportedResults.length) {
        console.log(`\nunsupported custom adapters (${unsupportedResults.length}) — informational, never fatal:`);
        unsupportedResults.forEach(r => console.log(`  ${r.ok ? '·' : '·'} ${pad(r.key, 20)} ${pad(r.stage || 'ok', 8)} ${r.detail}`));
    }

    // If nothing at all resolved, the machine is offline or egress-filtered. Saying
    // "139 services are down" in that case would be a lie.
    const networkStage = results.filter(r => r.stage === 'network').length;
    const networkBlocked = results.length > 0 && networkStage === results.length;

    console.log('\nsummary');
    console.log(`  supported:   ${summary.supported_ok}/${summary.supported_total} ok`);
    console.log(`  unsupported: ${summary.unsupported_ok}/${summary.unsupported_total} ok (expected to fail)`);
    console.log(`  failures by stage: ${JSON.stringify(summary.by_stage)}`);
    console.log(`  elapsed: ${(elapsed / 1000).toFixed(1)}s`);
    if (networkBlocked) {
        console.log('\n  NOTE: every probe failed at the network stage. This host cannot reach');
        console.log('  the status APIs (offline or egress-filtered) — these are not service');
        console.log('  outages. Re-run somewhere with open egress, or use tools/cors-check.html.');

        // A proxied host is the most common cause and the least obvious: Node's
        // global fetch ignores HTTP_PROXY before v24, so curl succeeds where this
        // script fails, which looks like a bug in the script.
        const proxy = process.env.HTTPS_PROXY || process.env.https_proxy
            || process.env.HTTP_PROXY || process.env.http_proxy;
        if (proxy) {
            const major = Number(process.versions.node.split('.')[0]);
            console.log(`\n  A proxy is configured (${proxy.replace(/\/\/.*@/, '//<redacted>@')}) but Node's`);
            console.log(`  global fetch does not use it on ${process.version}.`);
            console.log(major >= 24
                ? '  Re-run with NODE_USE_ENV_PROXY=1.'
                : '  Node 24+ supports NODE_USE_ENV_PROXY=1; on this version there is no');
            if (major < 24) console.log('  dependency-free way to honour it. Run on an unproxied host or in CI.');
        }
    }

    if (opts.json) {
        await mkdir(REPORT_DIR, { recursive: true });
        const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
        const file = path.join(REPORT_DIR, `catalog-health-${stamp}.json`);
        await writeFile(file, JSON.stringify({
            generated_at: startedAt.toISOString(),
            elapsed_ms: elapsed,
            options: opts,
            probe_origin: PROBE_ORIGIN,
            network_blocked: networkBlocked,
            static_problems: staticProblems,
            summary,
            results
        }, null, 2) + '\n');
        console.log(`\nreport: ${path.relative(ROOT, file)} (gitignored)`);
    }

    if (networkBlocked) process.exit(3);
    process.exit(supportedFailures.length ? 2 : 0);
}

main().catch(error => fail(error.stack || error.message));
