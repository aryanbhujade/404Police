// Static-site validation: the checks that catch a broken GitHub Pages deploy
// without a browser. Deliberately regex-based over the raw source — pulling in a
// DOM parser would mean a node_modules, and this build has no dependencies at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(path.join(ROOT, file), 'utf8');

const html = read('index.html');
const appJs = read('app.js');

test('every file index.html references exists on disk', () => {
    const refs = [
        ...html.matchAll(/<link[^>]+href="([^"]+)"/g),
        ...html.matchAll(/<script[^>]+src="([^"]+)"/g)
    ].map(m => m[1]).filter(href => !href.startsWith('http') && !href.startsWith('//'));

    assert.ok(refs.length >= 4, `expected local asset references, found ${refs.length}`);
    for (const ref of refs) {
        assert.ok(existsSync(path.join(ROOT, ref)), `index.html references missing file: ${ref}`);
    }
});

test('every getElementById in app.js resolves to an id in index.html', () => {
    // The single highest-value static check for this app: app.js caches ~20 element
    // handles at construction, and a typo'd id throws only at runtime, on load.
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
    const wanted = [...appJs.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map(m => m[1]);
    assert.ok(wanted.length > 10, 'expected app.js to look up many element ids');
    const missing = [...new Set(wanted)].filter(id => !ids.has(id));
    assert.deepEqual(missing, [], `ids used by app.js but absent from index.html: ${missing.join(', ')}`);
});

test('index.html declares a Content-Security-Policy meta tag', () => {
    const match = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([\s\S]*?)"\s*>/);
    assert.ok(match, 'no CSP meta tag found');
    const policy = match[1];
    for (const directive of [
        'default-src', 'script-src', 'style-src', 'font-src',
        'img-src', 'connect-src', 'base-uri', 'form-action', 'object-src'
    ]) {
        assert.ok(new RegExp(`(^|;)\\s*${directive}\\s`).test(policy), `CSP is missing ${directive}`);
    }
});

test('CSP does not allow inline or eval scripts', () => {
    const policy = html.match(/http-equiv="Content-Security-Policy"\s+content="([\s\S]*?)"\s*>/)[1];
    const scriptSrc = policy.match(/script-src([^;]*)/)[1];
    assert.ok(!scriptSrc.includes('unsafe-inline'), "script-src must not allow 'unsafe-inline'");
    assert.ok(!scriptSrc.includes('unsafe-eval'), "script-src must not allow 'unsafe-eval'");
});

test('CSP directives that a meta tag cannot enforce are not claimed', () => {
    // frame-ancestors, report-uri and sandbox are ignored in meta CSP. Listing them
    // would read as protection that is not actually there.
    const policy = html.match(/http-equiv="Content-Security-Policy"\s+content="([\s\S]*?)"\s*>/)[1];
    for (const ignored of ['frame-ancestors', 'report-uri', 'sandbox']) {
        assert.ok(!policy.includes(ignored), `${ignored} is ignored in a meta CSP; drop it or use a header`);
    }
});

test('index.html has no inline script blocks', () => {
    // script-src 'self' would block them, so one appearing is a silent breakage.
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
        .filter(m => m[1].trim());
    assert.equal(inline.length, 0, 'inline <script> found; CSP script-src is \'self\'');
});

test('external origins used by the page are allowed by the CSP', () => {
    const policy = html.match(/http-equiv="Content-Security-Policy"\s+content="([\s\S]*?)"\s*>/)[1];
    const css = read('style.css') + read('add-service.css');
    const origins = new Set(
        [...css.matchAll(/https:\/\/([a-z0-9.-]+)/gi), ...html.matchAll(/https:\/\/([a-z0-9.-]+)/gi)]
            .map(m => m[1])
    );
    for (const origin of origins) {
        // github.com appears only in comments/URLs, not as a fetched subresource.
        if (origin.endsWith('github.com') || origin.endsWith('github.io')) continue;
        assert.ok(policy.includes(origin), `${origin} is fetched but not present in the CSP`);
    }
});

test('no .keep placeholder remains', () => {
    assert.ok(!existsSync(path.join(ROOT, '.keep')), '.keep should have been removed');
});

test('.nojekyll exists so Pages serves the tree verbatim', () => {
    assert.ok(existsSync(path.join(ROOT, '.nojekyll')));
});

test('reports/ is gitignored so health-check output is never committed', () => {
    const ignore = read('.gitignore');
    assert.ok(/^reports\/?$/m.test(ignore), '.gitignore must contain a reports/ rule');
});

test('app.js fetches the catalog by relative path', () => {
    // An absolute path breaks on a project Pages site served from /404Police/.
    const match = appJs.match(/const CATALOG_URL\s*=\s*'([^']+)'/);
    assert.ok(match, 'CATALOG_URL not found');
    assert.ok(!match[1].startsWith('/'), 'CATALOG_URL must be relative for project Pages');
});
