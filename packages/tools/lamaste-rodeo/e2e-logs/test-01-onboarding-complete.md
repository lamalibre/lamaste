# Lamaste E2E: 01 — Onboarding Complete Verification (Three-VM)

> Started at `2026-10-13 11:39:04 UTC`


## Onboarding status

✅ `11:39:04` Onboarding status is COMPLETED  
✅ `11:39:04` Domain is set in onboarding status: test.lamaste.local  

## Core services running

✅ `11:39:04` Service nginx is active  
✅ `11:39:04` Service chisel is active  
✅ `11:39:05` Service authelia is active  
✅ `11:39:05` Service lamalibre-lamaste-serverd is active  

## Self-signed certificates exist

✅ `11:39:05` Certificate exists: /etc/lamalibre/lamaste/pki/ca.crt  
✅ `11:39:05` Certificate exists: /etc/lamalibre/lamaste/pki/ca.key  
✅ `11:39:05` Certificate exists: /etc/lamalibre/lamaste/pki/client.crt  
✅ `11:39:05` Certificate exists: /etc/lamalibre/lamaste/pki/client.key  
✅ `11:39:05` Certificate exists: /etc/lamalibre/lamaste/pki/self-signed.pem  
✅ `11:39:05` Certificate exists: /etc/lamalibre/lamaste/pki/self-signed-key.pem  

## Panel accessible via domain (mTLS)

✅ `11:39:05` Panel accessible via https://panel.test.lamaste.local (HTTP 200)  

## DNS resolution

✅ `11:39:21` DNS resolves test.lamaste.local to 10.13.37.1 (from host VM)  

## Agent VM connectivity

✅ `11:39:21` Agent VM can reach host VM at 10.13.37.1:9292 (HTTP 400)  

## Visitor VM connectivity

✅ `11:39:21` Visitor VM can reach host VM at 10.13.37.1:9292 (HTTP 400)  
✅ `11:39:21` Visitor VM can reach Authelia at auth.test.lamaste.local (HTTP 200)  

## Chisel server hardening

✅ `11:39:22` Server chisel (/usr/local/bin/chisel) is the pinned release 1.12.0  
✅ `11:39:22` Chisel authfile is 0640 lamaste:lamaste-chisel  
✅ `11:39:22` chisel.service runs as User=nobody  
✅ `11:39:22` chisel.service runs as Group=lamaste-chisel  
✅ `11:39:22` The lamaste user is a member of lamaste-chisel  
✅ `11:39:22` lamalibre-lamaste-serverd has SupplementaryGroups=lamaste-chisel  
✅ `11:39:22` No chisel fail-closed marker (startup reconciliation succeeded)  
✅ `11:39:22` chisel.service is enabled  

## Sudoers: certbot and certificate reads via root-owned wrappers

✅ `11:39:22` sudoers allows the lamaste-certbot wrapper  
✅ `11:39:22` sudoers allows the lamaste-cert-info wrapper  
✅ `11:39:22` sudoers has no direct certbot rule  
✅ `11:39:22` sudoers has no rule reaching into /etc/letsencrypt  
✅ `11:39:22` /usr/local/sbin/lamaste-certbot is root-owned 0755  
✅ `11:39:22` /usr/local/sbin/lamaste-cert-info is root-owned 0755  
✅ `11:39:23` lamaste cannot run /usr/bin/certbot through sudo  
✅ `11:39:23` lamaste-certbot rejects extra arguments (exit 2)  
✅ `11:39:23` lamaste-cert-info rejects a traversing lineage name (exit 2)  
✅ `11:39:23` lamaste-cert-info reads the tunnel certificate's expiry  

## Privilege boundary: the panel user cannot become root

✅ `11:39:23` sudoers has no wildcard rule  
✅ `11:39:23` sudoers allows the lamaste-priv helper  
✅ `11:39:23` /usr/local/sbin/lamaste-priv is root-owned 0755  
✅ `11:39:23` Retired wrappers lamaste-sign-csr / lamaste-pki-rename are gone  
✅ `11:39:23` Everything under /opt/lamalibre/lamaste is root-owned  
✅ `11:39:23` lamaste cannot write into the install directory  
✅ `11:39:23` /var/www/lamaste is lamaste:www-data 2750  
✅ `11:39:24` /etc/authelia is lamaste:lamaste-authelia 2770  
✅ `11:39:24` Authelia runs as lamaste-authelia, not root  
✅ `11:39:24` The running Authelia process belongs to lamaste-authelia  
✅ `11:39:24` chisel-server.key is lamaste:lamaste-chisel 0640  
✅ `11:39:24` chisel and Authelia units are root-owned  
✅ `11:39:24` lamaste-priv refuses a vhost with access_log (exit 2)  
✅ `11:39:24` The refused vhost was not written  
✅ `11:39:24` The former mv wildcard rule is gone  

## Port 80 redirects every host to HTTPS

✅ `11:39:24` http://10.13.37.1/a?b=1 with Host foo.example answers 301  
✅ `11:39:24` 301 Location is https://foo.example/a?b=1  
✅ `11:39:24` http://panel.test.lamaste.local/x answers 301 to HTTPS  
✅ `11:39:24` nginx site lamalibre-lamaste-http-redirect is enabled  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `54` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `54` |

