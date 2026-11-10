/**
 * Trusted publisher scopes: the shared case table (also read by the
 * desktop's trusted_scopes.rs), the manifest rule, the effective list and
 * the npm userconfig's scope lines.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  BUILTIN_TRUSTED_SCOPE,
  AdditionalTrustedScopesSchema,
  ScopedPackageNameSchema,
  NpmScopeSchema,
  UntrustedScopeError,
  assertManifestPackagesTrusted,
  assertTrustedPackage,
  derivePluginRoute,
  effectiveTrustedScopes,
  isNpmScope,
  isTrustedPackage,
  packageScope,
  AgentHalfPackageNameSchema,
  validateManifest,
} from '../dist/index.js';
import { renderInstallNpmrc } from '../dist/agent/index.js';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/trusted-scopes-cases.json', import.meta.url), 'utf8'),
);

for (const c of fixture.cases) {
  test(`package ${JSON.stringify(c.name)}: scope ${c.scope}, trusted ${c.trusted}`, () => {
    assert.equal(packageScope(c.name), c.scope);
    assert.equal(isTrustedPackage(c.name, fixture.trusted), c.trusted);
    if (c.trusted) {
      assert.doesNotThrow(() => assertTrustedPackage(c.name, fixture.trusted));
    } else {
      assert.throws(
        () => assertTrustedPackage(c.name, fixture.trusted),
        (err) => err instanceof UntrustedScopeError && err.code === 'untrusted_scope',
      );
    }
    // Without the additional scope only @lamalibre packages are trusted.
    assert.equal(
      isTrustedPackage(c.name, effectiveTrustedScopes()),
      c.trusted && c.scope === BUILTIN_TRUSTED_SCOPE,
    );
  });
}

for (const s of fixture.scopes) {
  test(`scope ${JSON.stringify(s.scope)} is ${s.valid ? 'valid' : 'invalid'}`, () => {
    assert.equal(isNpmScope(s.scope), s.valid);
    assert.equal(NpmScopeSchema.safeParse(s.scope).success, s.valid);
  });
}

test('a value that is not a string is never trusted', () => {
  for (const v of [undefined, null, 1, {}, ['@lamalibre/x']]) {
    assert.equal(packageScope(v), null);
    assert.equal(isTrustedPackage(v, ['@lamalibre']), false);
  }
});

test('an empty trusted list trusts nothing', () => {
  assert.equal(isTrustedPackage('@lamalibre/x', []), false);
});

test('the effective list is the built-in scope, then the well-formed additional ones', () => {
  assert.deepEqual(effectiveTrustedScopes(), ['@lamalibre']);
  assert.deepEqual(effectiveTrustedScopes(null), ['@lamalibre']);
  assert.deepEqual(effectiveTrustedScopes(['@example', '@lamalibre', '@Bad', 7, '@example']), [
    '@lamalibre',
    '@example',
  ]);
});

test('the additional list is unique, bounded and never names the built-in scope', () => {
  assert.equal(AdditionalTrustedScopesSchema.safeParse([]).success, true);
  assert.equal(AdditionalTrustedScopesSchema.safeParse(['@example', '@other']).success, true);
  assert.equal(AdditionalTrustedScopesSchema.safeParse(['@example', '@example']).success, false);
  assert.equal(AdditionalTrustedScopesSchema.safeParse(['@lamalibre']).success, false);
  assert.equal(AdditionalTrustedScopesSchema.safeParse(['@example/']).success, false);
  const many = Array.from({ length: 17 }, (_, i) => `@s${i}`);
  assert.equal(AdditionalTrustedScopesSchema.safeParse(many).success, false);
  assert.equal(AdditionalTrustedScopesSchema.safeParse(many.slice(0, 16)).success, true);
});

test('ScopedPackageNameSchema takes a bare scoped name only', () => {
  assert.equal(ScopedPackageNameSchema.safeParse('@example/x').success, true);
  assert.equal(ScopedPackageNameSchema.safeParse('@example/x@1.0.0').success, false);
  assert.equal(ScopedPackageNameSchema.safeParse('x').success, false);
});

test('a manifest names only trusted packages of its own scope', () => {
  const trusted = ['@lamalibre', '@example'];
  assert.doesNotThrow(() =>
    assertManifestPackagesTrusted(
      { packages: { server: '@example/app-server' }, agent: { package: '@example/app-agent' } },
      '@example/app-server',
      trusted,
    ),
  );
  // Another trusted publisher's package: refused.
  assert.throws(
    () =>
      assertManifestPackagesTrusted(
        { packages: {}, agent: { package: '@lamalibre/app-agent' } },
        '@example/app-server',
        trusted,
      ),
    (err) => err instanceof UntrustedScopeError && /its own scope/.test(err.message),
  );
  assert.throws(
    () =>
      assertManifestPackagesTrusted(
        { packages: { server: '@example/app-server' } },
        '@lamalibre/app-server',
        trusted,
      ),
    UntrustedScopeError,
  );
  // An untrusted installed package, whatever it names.
  assert.throws(
    () => assertManifestPackagesTrusted({ packages: {} }, '@other/app', trusted),
    UntrustedScopeError,
  );
  // Trusted elsewhere, not here.
  assert.throws(
    () =>
      assertManifestPackagesTrusted(
        { packages: { server: '@example/app-server' } },
        '@example/app-server',
        ['@lamalibre'],
      ),
    UntrustedScopeError,
  );
});

test('derivePluginRoute strips any well-formed scope, and only a scope', () => {
  assert.equal(derivePluginRoute('@lamalibre/herd-server'), 'herd');
  assert.equal(derivePluginRoute('@example/scoped-app'), 'scoped-app');
  assert.equal(derivePluginRoute('@example/scoped-app-agent'), 'scoped-app');
  assert.equal(derivePluginRoute('herd'), 'herd');
});

test('the manifest schema takes scoped packages of any scope; trust is checked separately', () => {
  const base = { name: 'scoped-app', version: '1.0.0' };
  const parsed = validateManifest({ ...base, packages: { server: '@example/scoped-app' } });
  assert.equal(parsed.packages.server, '@example/scoped-app');
  assert.throws(() => validateManifest({ ...base, packages: { server: 'scoped-app' } }));
  assert.throws(() => validateManifest({ ...base, packages: { server: '@Example/x' } }));
});

test('an agent half package is scoped, lowercase letters, digits and hyphens', () => {
  assert.equal(AgentHalfPackageNameSchema.safeParse('@example/app-agent').success, true);
  assert.equal(AgentHalfPackageNameSchema.safeParse('@lamalibre/app-agent').success, true);
  assert.equal(AgentHalfPackageNameSchema.safeParse('@example/app.agent').success, false);
  assert.equal(AgentHalfPackageNameSchema.safeParse('@lamalibre-/x').success, true);
  assert.equal(AgentHalfPackageNameSchema.safeParse('app-agent').success, false);
});

test('the install userconfig routes every given scope to the registry', () => {
  const text = renderInstallNpmrc({
    registryUrl: 'https://registry.example.test/',
    token: 'feria_abc',
    scopes: ['@lamalibre', '@example'],
  });
  assert.equal(
    text,
    '@lamalibre:registry=https://registry.example.test/\n' +
      '@example:registry=https://registry.example.test/\n' +
      '//registry.example.test/:_authToken=feria_abc\n',
  );
  // The single legacy scope still works.
  assert.equal(
    renderInstallNpmrc({ registryUrl: 'https://r.test/', token: 't', scope: '@lamalibre' }),
    '@lamalibre:registry=https://r.test/\n//r.test/:_authToken=t\n',
  );
  // Default: the built-in scope.
  assert.match(renderInstallNpmrc({ registryUrl: 'https://r.test/', token: 't' }), /^@lamalibre:/);
  for (const bad of ['@Example', '@x\n//evil/:_authToken=y', 'example', '@ex=ample']) {
    assert.throws(() =>
      renderInstallNpmrc({ registryUrl: 'https://r.test/', token: 't', scopes: [bad] }),
    );
  }
});
