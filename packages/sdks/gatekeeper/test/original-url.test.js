/**
 * What of nginx's original URL Authelia is told: up to the first `?` or
 * `#`, cut from the raw string — never re-encoded. Runs against the build.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { autheliaTargetUrl } = await import('../dist/lib/original-url.js');

test('Authelia is told the URL without its query or fragment, byte for byte', () => {
  for (const [given, expected] of [
    ['https://a.example.com/reports?year=2026', 'https://a.example.com/reports'],
    ['https://a.example.com/p?q=1#f', 'https://a.example.com/p'],
    ['https://a.example.com/p#f?q', 'https://a.example.com/p'],
    ['https://a.example.com?q=1', 'https://a.example.com'],
    ['https://a.example.com/%7Euser/%2e%2e/x', 'https://a.example.com/%7Euser/%2e%2e/x'],
    ['https://a.example.com/', 'https://a.example.com/'],
    ['https://a.example.com/a?', 'https://a.example.com/a'],
  ]) {
    assert.equal(autheliaTargetUrl(given), expected, given);
  }
});
