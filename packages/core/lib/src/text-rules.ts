/**
 * Character rules for text a person reads — browser-safe, no imports.
 */

/**
 * Whether `text` has a C0 or C1 control character (DEL included) or a
 * bidirectional mark, embedding, override or isolate (U+061C, U+200E/F,
 * U+202A–U+202E, U+2066–U+2069) — characters that can make a label read
 * as something it is not. Checked by code unit, which covers them all
 * (none is a surrogate).
 */
export function hasControlCharacters(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (
      c <= 0x1f ||
      (c >= 0x7f && c <= 0x9f) ||
      c === 0x061c ||
      c === 0x200e ||
      c === 0x200f ||
      (c >= 0x202a && c <= 0x202e) ||
      (c >= 0x2066 && c <= 0x2069)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Dots a browser or a mail client takes for `.` in a host name (ideographic
 * and fullwidth full stops).
 */
const DOT_LIKE_RE = /[。．｡]/g;

/**
 * What makes a name read as a link or a host name: a scheme (`://`),
 * `www.`, or a label directly followed by a dot and a top-level-domain-like
 * run of letters (`example.com`, `mail.example.co.uk`) that no further
 * label character follows. The source, with flags `iu`, is what Lamaste's
 * pages test a typed name with ({@link DISPLAY_NAME_LINK_PATTERN}).
 */
export const DISPLAY_NAME_LINK_PATTERN = String.raw`:\/\/|www\.|[\p{L}\p{N}-]\.\p{L}{2,63}(?![\p{L}\p{N}_-])`;

const DISPLAY_NAME_LINK_RE = new RegExp(DISPLAY_NAME_LINK_PATTERN, 'iu');

/**
 * Whether a display name looks like a URL or a host name — refused where a
 * person names themself or someone else (an invitation, its acceptance):
 * Lamaste's mails and pages show that name to other people ("Ayşe invited
 * you"), and a name such as `pay-here.example` would read as an address to
 * visit. Fullwidth and ideographic dots count as dots. A name with a dot
 * before a space (`J. Smith`) is not refused.
 */
export function looksLikeLinkOrHostname(text: string): boolean {
  return DISPLAY_NAME_LINK_RE.test(text.replace(DOT_LIKE_RE, '.'));
}
