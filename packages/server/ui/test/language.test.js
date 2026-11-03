/**
 * A domain's page language in the panel's words: the choices, the select's
 * values, the state of the rendering, the relay's Authelia against the pin,
 * a refused change.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PAGE_LANGUAGES, PAGE_LANGUAGE_NAMES } from '@lamalibre/lamaste/page-messages';
import {
  LANGUAGE_UNSET_LABEL,
  autheliaVersionNote,
  explainLanguageRefusal,
  languageChoiceOf,
  languageChoices,
  languageName,
  languageOfChoice,
  renderingStateText,
} from '../src/admin/lib/language.js';

test('the choices: not set first, then every page language by its own name', () => {
  const choices = languageChoices();
  assert.deepEqual(choices[0], { value: '', label: LANGUAGE_UNSET_LABEL });
  assert.deepEqual(
    choices.slice(1),
    PAGE_LANGUAGES.map((l) => ({ value: l, label: PAGE_LANGUAGE_NAMES[l] })),
  );
  assert.deepEqual(
    choices.map((c) => c.label),
    [LANGUAGE_UNSET_LABEL, 'English', 'Türkçe'],
  );
});

test('a language and the select’s value, both ways; anything else is "not set"', () => {
  assert.equal(languageChoiceOf('tr'), 'tr');
  assert.equal(languageChoiceOf(null), '');
  assert.equal(languageChoiceOf('tr-TR'), '');
  assert.equal(languageOfChoice('en'), 'en');
  assert.equal(languageOfChoice(''), null);
  assert.equal(languageOfChoice('de'), null);
  assert.equal(languageName('tr'), 'Türkçe');
  assert.equal(languageName(null), 'not set');
});

test('the rendering’s state in words', () => {
  const rendering = (over) => ({
    rendered: { v: 1 },
    current: true,
    renderFailing: false,
    vhostPending: false,
    ...over,
  });
  assert.equal(renderingStateText({ status: 'active', rendering: null }), null);
  assert.equal(renderingStateText({ status: 'active' }), null);
  assert.deepEqual(renderingStateText({ status: 'active', rendering: rendering({}) }), {
    tone: 'ok',
    text: 'Rendered and served.',
  });
  assert.equal(
    renderingStateText({ status: 'pending', rendering: rendering({}) }).text,
    'Rendered; served once the domain is active.',
  );
  assert.equal(
    renderingStateText({ status: 'active', rendering: rendering({ current: false }) }).tone,
    'pending',
  );
  assert.equal(
    renderingStateText({ status: 'active', rendering: rendering({ rendered: null }) }).tone,
    'pending',
  );
  assert.match(
    renderingStateText({ status: 'active', rendering: rendering({ vhostPending: true }) }).text,
    /nginx configuration waits/,
  );
  // A failure outranks everything: visitors see the pages as they were.
  assert.equal(
    renderingStateText({
      status: 'active',
      rendering: rendering({ renderFailing: true, current: false }),
    }).tone,
    'failing',
  );
});

test('the relay’s Authelia: a note only when it runs another release than the pin', () => {
  assert.equal(autheliaVersionNote(null), null);
  assert.equal(autheliaVersionNote({ running: null, pinned: '4.39.28' }), null);
  assert.equal(autheliaVersionNote({ running: '4.39.28', pinned: '4.39.28' }), null);
  assert.match(
    autheliaVersionNote({ running: '4.40.1', pinned: '4.39.28' }),
    /^Authelia 4\.40\.1 runs on this relay; Lamaste is tested with 4\.39\.28\./,
  );
});

test('a refused language change in words', () => {
  const refused = Object.assign(new Error('The language is one of en, tr, or null'), {
    code: 'invalid_language',
  });
  assert.equal(
    explainLanguageRefusal(refused),
    'The language is one of en, tr, or null — choose one of the listed languages or "not set".',
  );
  const unknown = Object.assign(new Error("Domain 'x.test' not found"), {
    code: 'domain_not_found',
  });
  assert.equal(explainLanguageRefusal(unknown), "Domain 'x.test' not found");
});
