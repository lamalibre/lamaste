/**
 * A stand-in for Authelia's per-user storage, as `lib/authelia.js` reaches
 * it through `lamaste-priv authelia-user`: whose second factors (TOTP,
 * WebAuthn) it holds and which usernames it holds an OpenID Connect opaque
 * identifier for. Records every call; `failPurge` / `failCheck` play a
 * helper that fails. Put it behind the panel with
 * `setAutheliaForTests({ ..., userStorage: fake.storage })`.
 */

export function createFakeAutheliaStorage() {
  const state = {
    /** Usernames with a TOTP configuration or WebAuthn credentials. */
    factors: new Set(),
    /** Usernames Authelia holds an opaque identifier for. */
    identifiers: new Set(),
    purged: [],
    checked: [],
    failPurge: false,
    failCheck: false,
  };
  return {
    state,
    storage: {
      async purgeSecondFactors(username) {
        if (state.failPurge)
          throw new Error('authelia storage user totp delete exited with status 1');
        state.purged.push(username);
        state.factors.delete(username);
      },
      async holdsOidcIdentifier(username) {
        if (state.failCheck) {
          throw new Error('authelia storage user identifiers export exited with status 1');
        }
        state.checked.push(username);
        return state.identifiers.has(username);
      },
    },
    reset() {
      state.factors.clear();
      state.identifiers.clear();
      state.purged.length = 0;
      state.checked.length = 0;
      state.failPurge = false;
      state.failCheck = false;
    },
  };
}
