Test certificates for `test/mail-transports.test.js`'s SMTP sink: `ca.pem`, a
self-signed CA (`CA:TRUE`) whose key was thrown away, and `server.pem` /
`server.key`, a server certificate for `localhost` and `127.0.0.1` it signed,
with its key — test-only, trusted by nothing but a transport given `ca.pem`
as its `caPem`. Made with openssl (P-256, 100 years).
