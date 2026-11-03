/**
 * A domain's page language in the panel's words (page-language-design.md):
 * the choices the Domains page offers, the state of the domain's rendering,
 * the relay's Authelia against the pin, a refused change. Pure: nothing
 * here calls the panel.
 */

import {
  PAGE_LANGUAGES,
  PAGE_LANGUAGE_NAMES,
  isPageLanguage,
} from '@lamalibre/lamaste/page-messages';
import { errorMessage, refusalOf } from './errorMessage.js';
import { explainDomainRefusal } from './domains.js';

/** What "not set" means, as the select offers it. */
export const LANGUAGE_UNSET_LABEL = 'Not set — English pages, sign-in follows the browser';

/**
 * The select's choices: not set (value '') first, then each page language
 * by its own name.
 *
 * @returns {Array<{ value: string, label: string }>}
 */
export function languageChoices() {
  return [
    { value: '', label: LANGUAGE_UNSET_LABEL },
    ...PAGE_LANGUAGES.map((language) => ({
      value: language,
      label: PAGE_LANGUAGE_NAMES[language],
    })),
  ];
}

/** The select's value of a domain's language: '' for none. */
export function languageChoiceOf(language) {
  return isPageLanguage(language) ? language : '';
}

/** The language a choice stands for: null for '' (not set). */
export function languageOfChoice(value) {
  return isPageLanguage(value) ? value : null;
}

/** A language's name, or the "not set" words. */
export function languageName(language) {
  return isPageLanguage(language) ? PAGE_LANGUAGE_NAMES[language] : 'not set';
}

/**
 * The state of a domain's sign-in rendering, in words — null when the
 * domain has neither a brand nor a language (nothing to render).
 *
 * @param {{ status: string, rendering?: { rendered: object | null, current: boolean, renderFailing: boolean, vhostPending: boolean } | null }} domain
 * @returns {{ tone: 'ok' | 'pending' | 'failing', text: string } | null}
 */
export function renderingStateText(domain) {
  const rendering = domain?.rendering;
  if (!rendering) return null;
  if (rendering.renderFailing) {
    return {
      tone: 'failing',
      text: 'The last rendering failed: visitors see the pages as they were. The panel retries every minute.',
    };
  }
  if (!rendering.current || rendering.rendered === null) {
    return { tone: 'pending', text: 'Rendering — the pages follow within a minute.' };
  }
  if (domain.status === 'active' && rendering.vhostPending) {
    return {
      tone: 'pending',
      text: 'Rendered; the sign-in’s nginx configuration waits for a retry (within a minute).',
    };
  }
  return {
    tone: 'ok',
    text:
      domain.status === 'active'
        ? 'Rendered and served.'
        : 'Rendered; served once the domain is active.',
  };
}

/**
 * The relay's Authelia when it is not the release Lamaste pins — what that
 * means for the domains' sign-in pages — or null when it is (or unknown).
 *
 * @param {{ running: string | null, pinned: string } | null | undefined} authelia
 * @returns {string | null}
 */
export function autheliaVersionNote(authelia) {
  if (!authelia?.running || authelia.running === authelia.pinned) return null;
  return `Authelia ${authelia.running} runs on this relay; Lamaste is tested with ${authelia.pinned}. On a domain with a language or a brand, some sign-in texts may show in English or in the browser’s language until Lamaste’s pin catches up.`;
}

/** A refused language change in words; every other refusal as a domain's. */
export function explainLanguageRefusal(err) {
  if (refusalOf(err).code === 'invalid_language') {
    return `${errorMessage(err)} — choose one of the listed languages or "not set".`;
  }
  return explainDomainRefusal(err);
}
