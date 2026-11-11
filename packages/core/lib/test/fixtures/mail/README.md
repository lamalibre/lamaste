Test certificates for `test/mail.test.js` (the `caPem` check of an `smtp`
transport): `ca.pem`, a self-signed CA (`CA:TRUE`), and `leaf.pem`, a
server certificate it signed (`CA:FALSE`). Their keys were thrown away;
nothing trusts them. Made with openssl (P-256, 100 years).
