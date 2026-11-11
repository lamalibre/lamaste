/**
 * A secret's input: an uncontrolled, masked text input — never a password
 * input, which browsers offer to save in their password managers
 * (`autocomplete="new-password"` only stops autofill) — that is never
 * prefilled, keeps no form history (`autocomplete="off"`, no name) and
 * cannot be copied out. Its value never enters React state: the form reads
 * it through the ref once when it submits, then empties it.
 */

import { forwardRef } from 'react';
import { secretMaskSupported } from '../lib/pluginSettings.js';

/**
 * Whether this browser masks a secret's text input (`-webkit-text-security`;
 * every current browser — Firefox since 114). Read once: it does not change.
 */
export const SECRET_MASKED = secretMaskSupported(typeof CSS === 'undefined' ? undefined : CSS);

/** A secret's text never leaves its input by the clipboard, as a password input's does not. */
function refuseClipboard(e) {
  e.preventDefault();
}

export const SecretTextInput = forwardRef(function SecretTextInput({ className, ...props }, ref) {
  return (
    <input
      {...props}
      ref={ref}
      type="text"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      onCopy={refuseClipboard}
      onCut={refuseClipboard}
      data-1p-ignore
      data-lpignore="true"
      data-bwignore="true"
      data-form-type="other"
      className={`${className ?? ''} [-webkit-text-security:disc]`}
    />
  );
});

/** Said under a secret's input where the browser cannot mask it. */
export function SecretMaskNote() {
  if (SECRET_MASKED) return null;
  return (
    <p className="text-xs text-yellow-400/90">
      This browser cannot mask the value: it shows as you type it. Use a current browser to keep it
      out of sight.
    </p>
  );
}

/** Read a secret input's value once and empty it; '' when there is no input. */
export function takeSecret(ref) {
  const input = ref.current;
  if (!input) return '';
  const value = input.value;
  input.value = '';
  return value;
}
