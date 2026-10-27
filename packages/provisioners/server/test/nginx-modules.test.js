/**
 * The auth portal's vhost needs nginx's sub module (`sub_filter`); an nginx
 * without it refuses every auth vhost. create-lamaste checks `nginx -V`
 * before it changes anything — on a fresh relay once nginx is installed,
 * on a redeploy first — and the parser is held to real `nginx -V` output.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NGINX_SUB_MODULE_FLAG,
  assertNginxSubModule,
  hasSubModule,
  nginxSubModuleMissingError,
  nginxVersionLine,
} from '../src/lib/nginx-modules.js';

/** `nginx -V` of Ubuntu 24.04's nginx package (1.24.0-2ubuntu7), to stderr. */
const UBUNTU_2404 = `nginx version: nginx/1.24.0 (Ubuntu)
built with OpenSSL 3.0.13 30 Jan 2024
TLS SNI support enabled
configure arguments: --with-cc-opt='-g -O2 -fno-omit-frame-pointer -mno-omit-leaf-frame-pointer -ffile-prefix-map=/build/nginx-6AWKKi/nginx-1.24.0=. -flto=auto -ffat-lto-objects -fstack-protector-strong -fstack-clash-protection -Wformat -Werror=format-security -fcf-protection -fdebug-prefix-map=/build/nginx-6AWKKi/nginx-1.24.0=/usr/src/nginx-1.24.0-2ubuntu7 -fPIC -Wdate-time -D_FORTIFY_SOURCE=3' --with-ld-opt='-Wl,-Bsymbolic-functions -flto=auto -ffat-lto-objects -Wl,-z,relro -Wl,-z,now -fPIC' --prefix=/usr/share/nginx --conf-path=/etc/nginx/nginx.conf --http-log-path=/var/log/nginx/access.log --error-log-path=stderr --lock-path=/var/lock/nginx.lock --pid-path=/run/nginx.pid --modules-path=/usr/lib/nginx/modules --http-client-body-temp-path=/var/lib/nginx/body --http-fastcgi-temp-path=/var/lib/nginx/fastcgi --http-proxy-temp-path=/var/lib/nginx/proxy --http-scgi-temp-path=/var/lib/nginx/scgi --http-uwsgi-temp-path=/var/lib/nginx/uwsgi --with-compat --with-debug --with-pcre-jit --with-http_ssl_module --with-http_stub_status_module --with-http_realip_module --with-http_auth_request_module --with-http_v2_module --with-http_dav_module --with-http_slice_module --with-threads --with-http_addition_module --with-http_flv_module --with-http_gunzip_module --with-http_gzip_static_module --with-http_mp4_module --with-http_random_index_module --with-http_secure_link_module --with-http_sub_module --with-mail_ssl_module --with-stream_ssl_module --with-stream_ssl_preread_module --with-stream_realip_module --with-http_geoip_module=dynamic --with-http_image_filter_module=dynamic --with-http_perl_module=dynamic --with-http_xslt_module=dynamic --with-mail=dynamic --with-stream=dynamic --with-stream_geoip_module=dynamic
`;

/** A reduced build (Debian's nginx-light shape): no sub module. */
const LIGHT = `nginx version: nginx/1.22.1
built with OpenSSL 3.0.11 19 Sep 2023 (running with OpenSSL 3.0.15 3 Sep 2024)
TLS SNI support enabled
configure arguments: --with-cc-opt='-g -O2 -ffile-prefix-map=/build/nginx-4zOjrr/nginx-1.22.1=. -fstack-protector-strong -Wformat -Werror=format-security -fPIC -Wdate-time -D_FORTIFY_SOURCE=2' --with-ld-opt='-Wl,-z,relro -Wl,-z,now -fPIC' --prefix=/usr/share/nginx --conf-path=/etc/nginx/nginx.conf --http-log-path=/var/log/nginx/access.log --error-log-path=stderr --lock-path=/var/lock/nginx.lock --pid-path=/run/nginx.pid --modules-path=/usr/lib/nginx/modules --http-client-body-temp-path=/var/lib/nginx/body --http-fastcgi-temp-path=/var/lib/nginx/fastcgi --http-proxy-temp-path=/var/lib/nginx/proxy --http-scgi-temp-path=/var/lib/nginx/scgi --http-uwsgi-temp-path=/var/lib/nginx/uwsgi --with-compat --with-debug --with-pcre-jit --with-http_ssl_module --with-http_stub_status_module --with-http_realip_module --with-http_auth_request_module --with-http_v2_module --with-http_dav_module --with-http_slice_module --with-threads --with-http_gzip_static_module --with-stream=dynamic --with-stream_ssl_module
`;

test('the Ubuntu 24.04 nginx package is built with the sub module', () => {
  assert.equal(hasSubModule(UBUNTU_2404), true);
  assert.equal(nginxVersionLine(UBUNTU_2404), 'nginx version: nginx/1.24.0 (Ubuntu)');
  // stdout empty, the build information on stderr — as execa hands it over.
  assert.equal(hasSubModule(`\n${UBUNTU_2404}`), true);
});

test('a reduced build, a dynamic module, a prefix of the flag and no output are not the module', () => {
  assert.equal(hasSubModule(LIGHT), false);
  assert.equal(
    hasSubModule(UBUNTU_2404.replace('--with-http_sub_module', '--with-http_sub_module=dynamic')),
    false,
  );
  assert.equal(
    hasSubModule(UBUNTU_2404.replace('--with-http_sub_module', '--with-http_sub_module_x')),
    false,
  );
  assert.equal(hasSubModule(''), false);
  assert.equal(hasSubModule('nginx version: nginx/1.24.0\n'), false);
  // The flag must be on the configure line, not anywhere in the output.
  assert.equal(hasSubModule(`${LIGHT}# ${NGINX_SUB_MODULE_FLAG}\n`), false);
});

test('the refusal names the version, the flag and the fix, and says nothing was changed', () => {
  const message = nginxSubModuleMissingError(LIGHT).message;
  assert.match(message, /nginx\/1\.22\.1 at this relay is not built with the HTTP sub module/);
  assert.match(message, /--with-http_sub_module/);
  assert.match(message, /apt-get install nginx/);
  assert.match(message, /Nothing was changed/);
  assert.match(nginxSubModuleMissingError('').message, /^The nginx on this relay/);
});

test('assertNginxSubModule runs `nginx -V` with array arguments and reads stderr', async () => {
  const calls = [];
  const exec = async (file, args, options) => {
    calls.push({ file, args, options });
    return { stdout: '', stderr: UBUNTU_2404, exitCode: 0 };
  };
  assert.equal(await assertNginxSubModule({ exec }), 'nginx version: nginx/1.24.0 (Ubuntu)');
  assert.deepEqual(calls, [{ file: 'nginx', args: ['-V'], options: { reject: false } }]);

  await assert.rejects(
    assertNginxSubModule({ exec: async () => ({ stdout: '', stderr: LIGHT, exitCode: 0 }) }),
    /not built with the HTTP sub module/,
  );
  await assert.rejects(
    assertNginxSubModule({
      exec: async () => {
        throw new Error('spawn nginx ENOENT');
      },
    }),
    /nginx is not installed/,
  );
});
