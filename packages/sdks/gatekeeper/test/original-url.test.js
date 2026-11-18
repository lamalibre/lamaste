/**
 * What of nginx's original URL Authelia is told: up to the first `?` or
 * `#`, cut from the raw string — never re-encoded. Runs against the build.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { autheliaTargetUrl, encodeRawComponent, isAnchoredOn } =
  await import('../dist/lib/original-url.js');

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

test('a URL is anchored on its host: then nothing, a path or a query — whatever bytes follow', () => {
  for (const url of [
    'https://a.example.com',
    'https://a.example.com/',
    'https://A.Example.com/x',
    'https://a.example.com?q',
    'https://a.example.com/Ã©#raw',
  ]) {
    assert.equal(isAnchoredOn(url, 'a.example.com'), true, url);
  }
  for (const url of [
    'https://a.example.com.evil.test/',
    'https://a.example.com:8443/',
    'https://a.example.com@evil.test/',
    'https://a.example.com#x',
    'http://a.example.com/',
    'https://b.example.com/',
  ]) {
    assert.equal(isAnchoredOn(url, 'a.example.com'), false, url);
  }
});

test('the redirect encodes each byte once, as encodeURIComponent does for ASCII', () => {
  const ascii = "https://a.example.com/p?a=1&b=x y#f!*'()~-_.";
  assert.equal(encodeRawComponent(ascii), encodeURIComponent(ascii));
  const utf8AsLatin1 = Buffer.from('é', 'utf8').toString('latin1');
  assert.equal(encodeRawComponent(utf8AsLatin1), '%C3%A9');
});
