# Lamaste E2E: 01 — Onboarding Complete Verification (Three-VM)

> Started at `2026-11-10 20:16:14 UTC`


## Onboarding status

✅ `20:16:14` Onboarding status is COMPLETED  
✅ `20:16:14` Domain is set in onboarding status: test.lamaste.local  

## Core services running

✅ `20:16:15` Service nginx is active  
✅ `20:16:15` Service chisel is active  
✅ `20:16:15` Service authelia is active  
✅ `20:16:15` Service lamalibre-lamaste-serverd is active  

## Self-signed certificates exist

✅ `20:16:15` Certificate exists: /etc/lamalibre/lamaste/pki/ca.crt  
✅ `20:16:15` Certificate exists: /etc/lamalibre/lamaste/pki/ca.key  
✅ `20:16:15` Certificate exists: /etc/lamalibre/lamaste/pki/client.crt  
✅ `20:16:15` Certificate exists: /etc/lamalibre/lamaste/pki/client.key  
✅ `20:16:16` Certificate exists: /etc/lamalibre/lamaste/pki/self-signed.pem  
✅ `20:16:16` Certificate exists: /etc/lamalibre/lamaste/pki/self-signed-key.pem  

## Panel accessible via domain (mTLS)

✅ `20:16:16` Panel accessible via https://panel.test.lamaste.local (HTTP 200)  

## DNS resolution

✅ `20:16:31` DNS resolves test.lamaste.local to 10.13.37.1 (from host VM)  

## Agent VM connectivity

✅ `20:16:32` Agent VM can reach host VM at 10.13.37.1:9292 (HTTP 400)  

## Visitor VM connectivity

✅ `20:16:32` Visitor VM can reach host VM at 10.13.37.1:9292 (HTTP 400)  
✅ `20:16:32` Visitor VM can reach Authelia at auth.test.lamaste.local (HTTP 200)  

## Chisel server hardening

✅ `20:16:32` Server chisel (/usr/local/bin/chisel) is the pinned release 1.12.0  
✅ `20:16:32` Chisel authfile is 0640 lamaste:lamaste-chisel  
✅ `20:16:32` chisel.service runs as User=nobody  
✅ `20:16:33` chisel.service runs as Group=lamaste-chisel  
✅ `20:16:33` The lamaste user is a member of lamaste-chisel  
✅ `20:16:33` lamalibre-lamaste-serverd has SupplementaryGroups=lamaste-chisel  
✅ `20:16:33` No chisel fail-closed marker (startup reconciliation succeeded)  
✅ `20:16:33` chisel.service is enabled  

## Sudoers: certbot and certificate reads via root-owned wrappers

✅ `20:16:33` sudoers allows the lamaste-certbot wrapper  
✅ `20:16:33` sudoers allows the lamaste-cert-info wrapper  
✅ `20:16:33` sudoers has no direct certbot rule  
✅ `20:16:33` sudoers has no rule reaching into /etc/letsencrypt  
✅ `20:16:33` /usr/local/sbin/lamaste-certbot is root-owned 0755  
✅ `20:16:34` /usr/local/sbin/lamaste-cert-info is root-owned 0755  
✅ `20:16:34` lamaste cannot run /usr/bin/certbot through sudo  
✅ `20:16:34` lamaste-certbot rejects extra arguments (exit 2)  
✅ `20:16:34` lamaste-cert-info rejects a traversing lineage name (exit 2)  
✅ `20:16:34` lamaste-cert-info reads the tunnel certificate's expiry  

## Privilege boundary: the panel user cannot become root

✅ `20:16:34` sudoers has no wildcard rule  
✅ `20:16:34` sudoers allows the lamaste-priv helper  
✅ `20:16:34` /usr/local/sbin/lamaste-priv is root-owned 0755  
✅ `20:16:34` Retired wrappers lamaste-sign-csr / lamaste-pki-rename are gone  
✅ `20:16:35` Everything under /opt/lamalibre/lamaste is root-owned  
✅ `20:16:35` lamaste cannot write into the install directory  
✅ `20:16:35` /var/www/lamaste is lamaste:www-data 2750  
✅ `20:16:35` /etc/authelia is lamaste:lamaste-authelia 2770  
✅ `20:16:35` Authelia runs as lamaste-authelia, not root  
✅ `20:16:35` The running Authelia process belongs to lamaste-authelia  
✅ `20:16:35` chisel-server.key is lamaste:lamaste-chisel 0640  
✅ `20:16:36` chisel and Authelia units are root-owned  
✅ `20:16:36` lamaste-priv refuses a vhost with access_log (exit 2)  
✅ `20:16:36` …for that directive, not for its name  
✅ `20:16:36` The refused vhost was not written  
✅ `20:16:36` The former mv wildcard rule is gone  

## Port 80 redirects every host to HTTPS

✅ `20:16:36` http://10.13.37.1/a?b=1 with Host foo.example answers 301  
✅ `20:16:36` 301 Location is https://foo.example/a?b=1  
✅ `20:16:36` http://panel.test.lamaste.local/x answers 301 to HTTPS  
✅ `20:16:36` nginx site lamalibre-lamaste-http-redirect is enabled  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `55` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `55` |

