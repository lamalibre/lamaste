# Lamaste E2E: 01 — Onboarding Complete Verification (Three-VM)

> Started at `2026-10-25 17:14:30 UTC`


## Onboarding status

✅ `17:14:31` Onboarding status is COMPLETED  
✅ `17:14:31` Domain is set in onboarding status: test.lamaste.local  

## Core services running

✅ `17:14:31` Service nginx is active  
✅ `17:14:31` Service chisel is active  
✅ `17:14:31` Service authelia is active  
✅ `17:14:31` Service lamalibre-lamaste-serverd is active  

## Self-signed certificates exist

✅ `17:14:31` Certificate exists: /etc/lamalibre/lamaste/pki/ca.crt  
✅ `17:14:31` Certificate exists: /etc/lamalibre/lamaste/pki/ca.key  
✅ `17:14:31` Certificate exists: /etc/lamalibre/lamaste/pki/client.crt  
✅ `17:14:31` Certificate exists: /etc/lamalibre/lamaste/pki/client.key  
✅ `17:14:32` Certificate exists: /etc/lamalibre/lamaste/pki/self-signed.pem  
✅ `17:14:32` Certificate exists: /etc/lamalibre/lamaste/pki/self-signed-key.pem  

## Panel accessible via domain (mTLS)

✅ `17:14:32` Panel accessible via https://panel.test.lamaste.local (HTTP 200)  

## DNS resolution

✅ `17:14:47` DNS resolves test.lamaste.local to 10.13.37.1 (from host VM)  

## Agent VM connectivity

✅ `17:14:47` Agent VM can reach host VM at 10.13.37.1:9292 (HTTP 400)  

## Visitor VM connectivity

✅ `17:14:48` Visitor VM can reach host VM at 10.13.37.1:9292 (HTTP 400)  
✅ `17:14:48` Visitor VM can reach Authelia at auth.test.lamaste.local (HTTP 200)  

## Chisel server hardening

✅ `17:14:48` Server chisel (/usr/local/bin/chisel) is the pinned release 1.12.0  
✅ `17:14:48` Chisel authfile is 0640 lamaste:lamaste-chisel  
✅ `17:14:48` chisel.service runs as User=nobody  
✅ `17:14:48` chisel.service runs as Group=lamaste-chisel  
✅ `17:14:48` The lamaste user is a member of lamaste-chisel  
✅ `17:14:48` lamalibre-lamaste-serverd has SupplementaryGroups=lamaste-chisel  
✅ `17:14:48` No chisel fail-closed marker (startup reconciliation succeeded)  
✅ `17:14:48` chisel.service is enabled  

## Sudoers: certbot and certificate reads via root-owned wrappers

✅ `17:14:49` sudoers allows the lamaste-certbot wrapper  
✅ `17:14:49` sudoers allows the lamaste-cert-info wrapper  
✅ `17:14:49` sudoers has no direct certbot rule  
✅ `17:14:49` sudoers has no rule reaching into /etc/letsencrypt  
✅ `17:14:49` /usr/local/sbin/lamaste-certbot is root-owned 0755  
✅ `17:14:49` /usr/local/sbin/lamaste-cert-info is root-owned 0755  
✅ `17:14:49` lamaste cannot run /usr/bin/certbot through sudo  
✅ `17:14:49` lamaste-certbot rejects extra arguments (exit 2)  
✅ `17:14:49` lamaste-cert-info rejects a traversing lineage name (exit 2)  
✅ `17:14:49` lamaste-cert-info reads the tunnel certificate's expiry  

## Privilege boundary: the panel user cannot become root

✅ `17:14:49` sudoers has no wildcard rule  
✅ `17:14:49` sudoers allows the lamaste-priv helper  
✅ `17:14:49` /usr/local/sbin/lamaste-priv is root-owned 0755  
✅ `17:14:49` Retired wrappers lamaste-sign-csr / lamaste-pki-rename are gone  
✅ `17:14:49` Everything under /opt/lamalibre/lamaste is root-owned  
✅ `17:14:50` lamaste cannot write into the install directory  
✅ `17:14:50` /var/www/lamaste is lamaste:www-data 2750  
✅ `17:14:50` /etc/authelia is lamaste:lamaste-authelia 2770  
✅ `17:14:50` Authelia runs as lamaste-authelia, not root  
✅ `17:14:50` The running Authelia process belongs to lamaste-authelia  
✅ `17:14:50` chisel-server.key is lamaste:lamaste-chisel 0640  
✅ `17:14:50` chisel and Authelia units are root-owned  
✅ `17:14:50` lamaste-priv refuses a vhost with access_log (exit 2)  
✅ `17:14:50` …for that directive, not for its name  
✅ `17:14:50` The refused vhost was not written  
✅ `17:14:51` The former mv wildcard rule is gone  

## Port 80 redirects every host to HTTPS

✅ `17:14:51` http://10.13.37.1/a?b=1 with Host foo.example answers 301  
✅ `17:14:51` 301 Location is https://foo.example/a?b=1  
✅ `17:14:51` http://panel.test.lamaste.local/x answers 301 to HTTPS  
✅ `17:14:51` nginx site lamalibre-lamaste-http-redirect is enabled  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `55` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `55` |

