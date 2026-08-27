// Catalog invariants. These run with no network, so they are safe in CI and in a
// sandbox. Anything needing a real endpoint belongs in tools/catalog-health.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(path.join(ROOT, 'services.json'), 'utf8'));

const CATEGORIES = new Set(['ai', 'messaging', 'streaming', 'developer', 'cloud', 'other']);

test('services.json has the expected top-level shape', () => {
    assert.equal(typeof catalog.version, 'number');
    assert.ok(Array.isArray(catalog.defaults));
    assert.ok(Array.isArray(catalog.services));
    assert.ok(catalog.services.length > 0);
});

test('every service has the fields app.js reads', () => {
    for (const service of catalog.services) {
        for (const field of ['key', 'name', 'category', 'provider', 'url']) {
            assert.equal(typeof service[field], 'string', `${service.key}: ${field}`);
            assert.ok(service[field].trim(), `${service.key}: ${field} is empty`);
        }
        if ('supported' in service) {
            assert.equal(typeof service.supported, 'boolean', `${service.key}: supported`);
        }
    }
});

test('declared service icons are local SVG assets that exist', () => {
    for (const service of catalog.services.filter(service => service.icon)) {
        assert.match(service.icon, /^assets\/logos\/[a-z0-9-]+\.svg$/, `${service.key}: unsafe icon path`);
        const iconPath = path.join(ROOT, service.icon);
        const icon = readFileSync(iconPath, 'utf8');
        assert.match(icon, /<svg\b/, `${service.key}: icon is not SVG markup`);
    }
});

test('every default service has an icon', () => {
    const byKey = new Map(catalog.services.map(service => [service.key, service]));
    const missing = catalog.defaults.filter(key => !byKey.get(key)?.icon);
    assert.deepEqual(missing, []);
});

test('service keys are unique', () => {
    const seen = new Set();
    const duplicates = [];
    for (const service of catalog.services) {
        if (seen.has(service.key)) duplicates.push(service.key);
        seen.add(service.key);
    }
    assert.deepEqual(duplicates, [], `duplicate keys: ${duplicates.join(', ')}`);
});

test('service keys are lowercase kebab-case', () => {
    const bad = catalog.services.map(s => s.key).filter(k => !/^[a-z0-9][a-z0-9-]*$/.test(k));
    assert.deepEqual(bad, []);
});

test('every url is https', () => {
    const bad = catalog.services
        .filter(s => { try { return new URL(s.url).protocol !== 'https:'; } catch { return true; } })
        .map(s => `${s.key} -> ${s.url}`);
    assert.deepEqual(bad, [], `non-https or unparseable: ${bad.join(', ')}`);
});

test('every category has a grid in index.html', () => {
    const bad = catalog.services.filter(s => !CATEGORIES.has(s.category)).map(s => `${s.key}:${s.category}`);
    assert.deepEqual(bad, []);
});

test('default board keys all exist and are supported', () => {
    const byKey = new Map(catalog.services.map(s => [s.key, s]));
    for (const key of catalog.defaults) {
        const service = byKey.get(key);
        assert.ok(service, `default "${key}" is not in the catalog`);
        assert.notEqual(service.supported, false, `default "${key}" is marked unsupported`);
    }
});

test('defaults contain no duplicates', () => {
    assert.equal(new Set(catalog.defaults).size, catalog.defaults.length);
});

test('unsupported entries declare a custom provider', () => {
    // A supported:false entry exists precisely because "statuspage" cannot parse it.
    for (const service of catalog.services.filter(s => s.supported === false)) {
        assert.ok(
            service.provider.startsWith('custom:'),
            `${service.key} is unsupported but provider is "${service.provider}"`
        );
    }
});

test('statuspage entries point at a v2 summary endpoint', () => {
    const bad = catalog.services
        .filter(s => s.provider === 'statuspage')
        .filter(s => !s.url.endsWith('/api/v2/summary.json'))
        .map(s => `${s.key} -> ${s.url}`);
    assert.deepEqual(bad, [], `statuspage entries with an unexpected path: ${bad.join(', ')}`);
});
