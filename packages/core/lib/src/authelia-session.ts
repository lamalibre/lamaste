/**
 * Authelia's session cookie — its name, how the relay reads it, and the
 * nginx map that keeps it from every backend.
 *
 * Authelia scopes the cookie to the relay's base domain (`session.cookies`
 * in its configuration, `server/authelia.ts`), so a browser sends it to
 * every host under that domain: every tunnel, every agent panel, every
 * plugin's user surface. A backend that received it — any application on
 * any agent, or whatever took a tunnel port on the relay's loopback — could
 * replay it on every authenticated host and every user surface. So:
 *
 * - nginx never passes it to a tunnel or agent backend: every location
 *   proxying to one sends `Cookie: $lamaste_backend_cookie` — the browser's
 *   cookies with every `authelia_session` pair removed, through the
 *   http-level map {@link renderBackendCookieMap} renders (installed by
 *   create-lamaste as {@link BACKEND_COOKIE_MAP_FILE}). The map strips one
 *   pair per round, {@link BACKEND_COOKIE_STRIP_ROUNDS} rounds, and fails
 *   closed: if a pair is still there after the last round, the backend gets
 *   no `Cookie` header at all.
 * - Gatekeeper reads the session from it alone ({@link autheliaSessionCookies}),
 *   refuses a request that carries more than one, and sends Authelia only
 *   `authelia_session=<value>`.
 *
 * A pair is recognised the way Authelia's HTTP stack reads one: pairs are
 * separated by `;`, and a pair whose name — spaces and tabs around it
 * trimmed — is exactly the cookie name (case-sensitive, as cookie names
 * are) is the session cookie, whatever its value. `authelia_session_x`,
 * `xauthelia_session` and `Authelia_Session` are other cookies, and a value
 * that happens to contain `authelia_session=` is part of another pair.
 *
 * Pure; shared by the server subpath (Authelia's configuration), Gatekeeper,
 * the panel's vhost generators and create-lamaste.
 */

/**
 * The name of Authelia's session cookie as the relay configures it
 * (`session.name`). Everything that reads or strips the cookie takes the
 * name from here.
 */
export const AUTHELIA_SESSION_COOKIE = 'authelia_session';

/**
 * The nginx variable every location proxying to a tunnel or agent backend
 * sets `Cookie` from: the request's cookies without Authelia's session
 * cookie (empty — no `Cookie` header at all — when nothing else is left, or
 * when the map could not strip it).
 */
export const BACKEND_COOKIE_VARIABLE = '$lamaste_backend_cookie';

/**
 * Where create-lamaste installs the map: an http-level file that nginx's
 * own `nginx.conf` includes (`/etc/nginx/conf.d/*.conf`), root-owned 0644.
 */
export const BACKEND_COOKIE_MAP_FILE = '/etc/nginx/conf.d/lamalibre-lamaste-backend-cookie.conf';

/**
 * How many session-cookie pairs the map strips before it fails closed. A
 * browser holds one cookie per name, domain and path: Authelia's own, and
 * any a host under the domain planted with another domain or path — four
 * cover more than a browser sends in practice, and a request with more
 * loses its `Cookie` header altogether.
 */
export const BACKEND_COOKIE_STRIP_ROUNDS = 4;

/** A cookie name as the map writes it into a regular expression: a token without metacharacters. */
const COOKIE_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

function assertCookieName(name: string): void {
  if (typeof name !== 'string' || !COOKIE_NAME_RE.test(name)) {
    throw new Error(`Invalid cookie name for the backend cookie map: ${String(name)}`);
  }
}

/** The name of the map variable of strip round `round` (1-based). */
function stripVariable(round: number): string {
  return `$lamaste_cookie_strip_${round}`;
}

/**
 * The http-level nginx configuration that defines
 * {@link BACKEND_COOKIE_VARIABLE}: a chain of `map`s, each removing the
 * first `<name>=…` pair of the cookie string the one before it left, then a
 * last map that answers the empty string — no `Cookie` header — if a pair
 * is still there. Pure; create-lamaste writes it as
 * {@link BACKEND_COOKIE_MAP_FILE}, and the tests evaluate its regular
 * expressions as PCRE would.
 *
 * Each strip round has two regular expressions; nginx tries them in order:
 *
 * 1. the pair is the first one — it and the separator after it go, the rest
 *    stays (`$1`);
 * 2. the pair follows a `;` — everything before that `;` (`$1`) and from the
 *    `;` after the pair (`$2`) stays, so the string is the same cookies with
 *    one pair fewer.
 *
 * The patterns use only what PCRE and JavaScript read alike (anchors,
 * classes, lazy and greedy quantifiers, groups); `\t` is nginx's escape for
 * a tab inside a quoted string, unescaped before PCRE sees it. `.` never
 * meets a line break: nginx refuses CR and LF in a header value.
 *
 * @param cookieName - the cookie to strip (default: Authelia's session cookie)
 */
export function renderBackendCookieMap(cookieName: string = AUTHELIA_SESSION_COOKIE): string {
  assertCookieName(cookieName);
  const pair = `[ \\t]*${cookieName}[ \\t]*=[^;]*`;
  const lines = [
    "# Lamaste: the Cookie header tunnel and agent backends receive — the browser's",
    `# cookies without Authelia's session cookie (${cookieName}), which is scoped to`,
    '# the base domain and must never reach an application. Each map removes one',
    `# ${cookieName} pair; if one is still there after the last, the backend gets no`,
    '# Cookie header at all. Written by create-lamaste; panel-rendered vhosts set',
    `# \`proxy_set_header Cookie ${BACKEND_COOKIE_VARIABLE};\`. Do not edit.`,
  ];
  let source = '$http_cookie';
  for (let round = 1; round <= BACKEND_COOKIE_STRIP_ROUNDS; round += 1) {
    const variable = stripVariable(round);
    lines.push(
      '',
      `map ${source} ${variable} {`,
      `    default ${source};`,
      `    "~^${pair}(?:;[ \\t]*)?(.*)$" $1;`,
      `    "~^(.*?)[ \\t]*;${pair}(.*)$" $1$2;`,
      '}',
    );
    source = variable;
  }
  lines.push(
    '',
    `map ${source} ${BACKEND_COOKIE_VARIABLE} {`,
    `    default ${source};`,
    `    "~(?:^|;)[ \\t]*${cookieName}[ \\t]*=" "";`,
    '}',
    '',
  );
  return lines.join('\n');
}

/**
 * The values of every `<name>=…` pair in a `Cookie` header, in order — the
 * pairs {@link renderBackendCookieMap} strips — each with the spaces and
 * tabs around it trimmed. Several mean the browser holds more than one
 * cookie of that name (another host under the domain can plant one with
 * another path): Gatekeeper refuses such a request rather than guess which
 * one is Authelia's.
 *
 * @param header - the `Cookie` header (several are joined with `; `)
 * @param cookieName - default: Authelia's session cookie
 */
export function autheliaSessionCookies(
  header: string | readonly string[] | undefined,
  cookieName: string = AUTHELIA_SESSION_COOKIE,
): string[] {
  assertCookieName(cookieName);
  if (header === undefined) return [];
  const text = typeof header === 'string' ? header : header.join('; ');
  const values: string[] = [];
  for (const pair of text.split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    if (trimSpaces(pair.slice(0, eq)) !== cookieName) continue;
    values.push(trimSpaces(pair.slice(eq + 1)));
  }
  return values;
}

function trimSpaces(text: string): string {
  return text.replace(/^[ \t]+|[ \t]+$/g, '');
}
