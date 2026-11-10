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
