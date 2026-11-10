# Lamaste E2E: 01 — Onboarding Complete Verification (Three-VM)

> Started at `2026-11-10 08:50:36 UTC`


## Onboarding status

✅ `08:50:37` Onboarding status is COMPLETED  
✅ `08:50:37` Domain is set in onboarding status: test.lamaste.local  

## Core services running

✅ `08:50:37` Service nginx is active  
✅ `08:50:37` Service chisel is active  
✅ `08:50:37` Service authelia is active  
✅ `08:50:37` Service lamalibre-lamaste-serverd is active  

## Self-signed certificates exist

✅ `08:50:37` Certificate exists: /etc/lamalibre/lamaste/pki/ca.crt  
✅ `08:50:38` Certificate exists: /etc/lamalibre/lamaste/pki/ca.key  
✅ `08:50:38` Certificate exists: /etc/lamalibre/lamaste/pki/client.crt  
✅ `08:50:38` Certificate exists: /etc/lamalibre/lamaste/pki/client.key  
✅ `08:50:38` Certificate exists: /etc/lamalibre/lamaste/pki/self-signed.pem  
✅ `08:50:38` Certificate exists: /etc/lamalibre/lamaste/pki/self-signed-key.pem  

## Panel accessible via domain (mTLS)

✅ `08:50:38` Panel accessible via https://panel.test.lamaste.local (HTTP 200)  

## DNS resolution

✅ `08:50:54` DNS resolves test.lamaste.local to 10.13.37.1 (from host VM)  

## Agent VM connectivity

✅ `08:50:54` Agent VM can reach host VM at 10.13.37.1:9292 (HTTP 400)  

## Visitor VM connectivity

✅ `08:50:54` Visitor VM can reach host VM at 10.13.37.1:9292 (HTTP 400)  
✅ `08:50:55` Visitor VM can reach Authelia at auth.test.lamaste.local (HTTP 200)  

## Chisel server hardening

✅ `08:50:55` Server chisel (/usr/local/bin/chisel) is the pinned release 1.12.0  
✅ `08:50:55` Chisel authfile is 0640 lamaste:lamaste-chisel  
✅ `08:50:55` chisel.service runs as User=nobody  
✅ `08:50:55` chisel.service runs as Group=lamaste-chisel  
✅ `08:50:55` The lamaste user is a member of lamaste-chisel  
✅ `08:50:55` lamalibre-lamaste-serverd has SupplementaryGroups=lamaste-chisel  
✅ `08:50:55` No chisel fail-closed marker (startup reconciliation succeeded)  
✅ `08:50:56` chisel.service is enabled  

## Sudoers: certbot and certificate reads via root-owned wrappers

✅ `08:50:56` sudoers allows the lamaste-certbot wrapper  
✅ `08:50:56` sudoers allows the lamaste-cert-info wrapper  
✅ `08:50:56` sudoers has no direct certbot rule  
✅ `08:50:56` sudoers has no rule reaching into /etc/letsencrypt  
✅ `08:50:56` /usr/local/sbin/lamaste-certbot is root-owned 0755  
✅ `08:50:56` /usr/local/sbin/lamaste-cert-info is root-owned 0755  
✅ `08:50:56` lamaste cannot run /usr/bin/certbot through sudo  
✅ `08:50:56` lamaste-certbot rejects extra arguments (exit 2)  
✅ `08:50:56` lamaste-cert-info rejects a traversing lineage name (exit 2)  
✅ `08:50:57` lamaste-cert-info reads the tunnel certificate's expiry  

## Privilege boundary: the panel user cannot become root

✅ `08:50:57` sudoers has no wildcard rule  
✅ `08:50:57` sudoers allows the lamaste-priv helper  
✅ `08:50:57` /usr/local/sbin/lamaste-priv is root-owned 0755  
✅ `08:50:57` Retired wrappers lamaste-sign-csr / lamaste-pki-rename are gone  
✅ `08:50:57` Everything under /opt/lamalibre/lamaste is root-owned  
✅ `08:50:57` lamaste cannot write into the install directory  
✅ `08:50:57` /var/www/lamaste is lamaste:www-data 2750  
✅ `08:50:58` /etc/authelia is lamaste:lamaste-authelia 2770  
✅ `08:50:58` Authelia runs as lamaste-authelia, not root  
✅ `08:50:58` The running Authelia process belongs to lamaste-authelia  
✅ `08:50:58` chisel-server.key is lamaste:lamaste-chisel 0640  
✅ `08:50:58` chisel and Authelia units are root-owned  
✅ `08:50:58` lamaste-priv refuses a vhost with access_log (exit 2)  
✅ `08:50:58` …for that directive, not for its name  
✅ `08:50:58` The refused vhost was not written  
✅ `08:50:58` The former mv wildcard rule is gone  

## Port 80 redirects every host to HTTPS

✅ `08:50:59` http://10.13.37.1/a?b=1 with Host foo.example answers 301  
✅ `08:50:59` 301 Location is https://foo.example/a?b=1  
✅ `08:50:59` http://panel.test.lamaste.local/x answers 301 to HTTPS  
✅ `08:50:59` nginx site lamalibre-lamaste-http-redirect is enabled  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `55` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `55` |

