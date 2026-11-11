/**
 * A stand-in for Authelia's per-user storage, as `lib/authelia.js` reaches
 * it through `lamaste-priv authelia-user`: whose second factors (TOTP,
 * WebAuthn) it holds and which usernames it holds an OpenID Connect opaque
 * identifier for, and each user's TOTP code of the moment (`totp`:
 * username → `{ code, step }`; a user missing has no TOTP configuration).
 * Records every call; `failPurge` / `failCheck` / `failVerify` play a
 * helper that fails. Put it behind the panel with
 * `setAutheliaForTests({ ..., userStorage: fake.storage })`.
 */

export function createFakeAutheliaStorage() {
  const state = {
    /** Usernames with a TOTP configuration or WebAuthn credentials. */
    factors: new Set(),
    /** Usernames Authelia holds an opaque identifier for. */
    identifiers: new Set(),
    /** username → the code that is right now and its time step. */
    totp: new Map(),
    purged: [],
    checked: [],
    verified: [],
    failPurge: false,
    failCheck: false,
    failVerify: false,
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
      async verifyTotp(username, code) {
        if (state.failVerify) throw new Error('lamaste-priv exited with status 1');
        state.verified.push(username);
        const current = state.totp.get(username);
        if (!current) return { ok: false, reason: 'none' };
        return current.code === code
          ? { ok: true, step: current.step }
          : { ok: false, reason: 'wrong' };
      },
    },
    reset() {
      state.factors.clear();
      state.identifiers.clear();
      state.purged.length = 0;
      state.checked.length = 0;
      state.verified.length = 0;
      state.totp.clear();
      state.failPurge = false;
      state.failCheck = false;
      state.failVerify = false;
    },
  };
}
