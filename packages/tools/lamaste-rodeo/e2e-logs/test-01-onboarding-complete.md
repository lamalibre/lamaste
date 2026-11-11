# Lamaste E2E: 01 — Onboarding Complete Verification (Three-VM)

> Started at `2026-11-11 08:52:15 UTC`


## Onboarding status

✅ `08:52:15` Onboarding status is COMPLETED  
✅ `08:52:15` Domain is set in onboarding status: test.lamaste.local  

## Core services running

✅ `08:52:15` Service nginx is active  
✅ `08:52:15` Service chisel is active  
✅ `08:52:15` Service authelia is active  
✅ `08:52:15` Service lamalibre-lamaste-serverd is active  

## Self-signed certificates exist

✅ `08:52:16` Certificate exists: /etc/lamalibre/lamaste/pki/ca.crt  
✅ `08:52:16` Certificate exists: /etc/lamalibre/lamaste/pki/ca.key  
✅ `08:52:16` Certificate exists: /etc/lamalibre/lamaste/pki/client.crt  
✅ `08:52:16` Certificate exists: /etc/lamalibre/lamaste/pki/client.key  
✅ `08:52:16` Certificate exists: /etc/lamalibre/lamaste/pki/self-signed.pem  
✅ `08:52:16` Certificate exists: /etc/lamalibre/lamaste/pki/self-signed-key.pem  

## Panel accessible via domain (mTLS)

✅ `08:52:16` Panel accessible via https://panel.test.lamaste.local (HTTP 200)  

## DNS resolution

✅ `08:52:32` DNS resolves test.lamaste.local to 10.13.37.1 (from host VM)  

## Agent VM connectivity

✅ `08:52:32` Agent VM can reach host VM at 10.13.37.1:9292 (HTTP 400)  

## Visitor VM connectivity

✅ `08:52:32` Visitor VM can reach host VM at 10.13.37.1:9292 (HTTP 400)  
✅ `08:52:33` Visitor VM can reach Authelia at auth.test.lamaste.local (HTTP 200)  

## Chisel server hardening

✅ `08:52:33` Server chisel (/usr/local/bin/chisel) is the pinned release 1.12.0  
✅ `08:52:33` Chisel authfile is 0640 lamaste:lamaste-chisel  
✅ `08:52:33` chisel.service runs as User=nobody  
✅ `08:52:33` chisel.service runs as Group=lamaste-chisel  
✅ `08:52:33` The lamaste user is a member of lamaste-chisel  
✅ `08:52:33` lamalibre-lamaste-serverd has SupplementaryGroups=lamaste-chisel  
✅ `08:52:33` No chisel fail-closed marker (startup reconciliation succeeded)  
✅ `08:52:34` chisel.service is enabled  

## Sudoers: certbot and certificate reads via root-owned wrappers

✅ `08:52:34` sudoers allows the lamaste-certbot wrapper  
✅ `08:52:34` sudoers allows the lamaste-cert-info wrapper  
✅ `08:52:34` sudoers has no direct certbot rule  
✅ `08:52:34` sudoers has no rule reaching into /etc/letsencrypt  
✅ `08:52:34` /usr/local/sbin/lamaste-certbot is root-owned 0755  
✅ `08:52:34` /usr/local/sbin/lamaste-cert-info is root-owned 0755  
✅ `08:52:34` lamaste cannot run /usr/bin/certbot through sudo  
✅ `08:52:34` lamaste-certbot rejects extra arguments (exit 2)  
✅ `08:52:34` lamaste-cert-info rejects a traversing lineage name (exit 2)  
✅ `08:52:34` lamaste-cert-info reads the tunnel certificate's expiry  

## Privilege boundary: the panel user cannot become root

✅ `08:52:35` sudoers has no wildcard rule  
✅ `08:52:35` sudoers allows the lamaste-priv helper  
✅ `08:52:35` /usr/local/sbin/lamaste-priv is root-owned 0755  
✅ `08:52:35` Retired wrappers lamaste-sign-csr / lamaste-pki-rename are gone  
✅ `08:52:35` Everything under /opt/lamalibre/lamaste is root-owned  
✅ `08:52:35` lamaste cannot write into the install directory  
✅ `08:52:35` /var/www/lamaste is lamaste:www-data 2750  
✅ `08:52:35` /etc/authelia is lamaste:lamaste-authelia 2770  
✅ `08:52:36` Authelia runs as lamaste-authelia, not root  
✅ `08:52:36` The running Authelia process belongs to lamaste-authelia  
✅ `08:52:36` chisel-server.key is lamaste:lamaste-chisel 0640  
✅ `08:52:36` chisel and Authelia units are root-owned  
✅ `08:52:36` lamaste-priv refuses a vhost with access_log (exit 2)  
✅ `08:52:36` …for that directive, not for its name  
✅ `08:52:36` The refused vhost was not written  
✅ `08:52:36` The former mv wildcard rule is gone  

## Port 80 redirects every host to HTTPS

✅ `08:52:36` http://10.13.37.1/a?b=1 with Host foo.example answers 301  
✅ `08:52:36` 301 Location is https://foo.example/a?b=1  
✅ `08:52:37` http://panel.test.lamaste.local/x answers 301 to HTTPS  
✅ `08:52:37` nginx site lamalibre-lamaste-http-redirect is enabled  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `55` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `55` |

