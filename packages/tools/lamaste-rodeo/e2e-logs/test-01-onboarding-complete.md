# Lamaste E2E: 01 — Onboarding Complete Verification (Three-VM)

> Started at `2026-11-03 09:20:31 UTC`


## Onboarding status

✅ `09:20:31` Onboarding status is COMPLETED  
✅ `09:20:31` Domain is set in onboarding status: test.lamaste.local  

## Core services running

✅ `09:20:31` Service nginx is active  
✅ `09:20:31` Service chisel is active  
✅ `09:20:32` Service authelia is active  
✅ `09:20:32` Service lamalibre-lamaste-serverd is active  

## Self-signed certificates exist

✅ `09:20:32` Certificate exists: /etc/lamalibre/lamaste/pki/ca.crt  
✅ `09:20:32` Certificate exists: /etc/lamalibre/lamaste/pki/ca.key  
✅ `09:20:32` Certificate exists: /etc/lamalibre/lamaste/pki/client.crt  
✅ `09:20:32` Certificate exists: /etc/lamalibre/lamaste/pki/client.key  
✅ `09:20:32` Certificate exists: /etc/lamalibre/lamaste/pki/self-signed.pem  
✅ `09:20:32` Certificate exists: /etc/lamalibre/lamaste/pki/self-signed-key.pem  

## Panel accessible via domain (mTLS)

✅ `09:20:32` Panel accessible via https://panel.test.lamaste.local (HTTP 200)  

## DNS resolution

✅ `09:20:48` DNS resolves test.lamaste.local to 10.13.37.1 (from host VM)  

## Agent VM connectivity

✅ `09:20:48` Agent VM can reach host VM at 10.13.37.1:9292 (HTTP 400)  

## Visitor VM connectivity

✅ `09:20:48` Visitor VM can reach host VM at 10.13.37.1:9292 (HTTP 400)  
✅ `09:20:48` Visitor VM can reach Authelia at auth.test.lamaste.local (HTTP 200)  

## Chisel server hardening

✅ `09:20:48` Server chisel (/usr/local/bin/chisel) is the pinned release 1.12.0  
✅ `09:20:49` Chisel authfile is 0640 lamaste:lamaste-chisel  
✅ `09:20:49` chisel.service runs as User=nobody  
✅ `09:20:49` chisel.service runs as Group=lamaste-chisel  
✅ `09:20:49` The lamaste user is a member of lamaste-chisel  
✅ `09:20:49` lamalibre-lamaste-serverd has SupplementaryGroups=lamaste-chisel  
✅ `09:20:49` No chisel fail-closed marker (startup reconciliation succeeded)  
✅ `09:20:49` chisel.service is enabled  

## Sudoers: certbot and certificate reads via root-owned wrappers

✅ `09:20:49` sudoers allows the lamaste-certbot wrapper  
✅ `09:20:49` sudoers allows the lamaste-cert-info wrapper  
✅ `09:20:49` sudoers has no direct certbot rule  
✅ `09:20:49` sudoers has no rule reaching into /etc/letsencrypt  
✅ `09:20:49` /usr/local/sbin/lamaste-certbot is root-owned 0755  
✅ `09:20:49` /usr/local/sbin/lamaste-cert-info is root-owned 0755  
✅ `09:20:50` lamaste cannot run /usr/bin/certbot through sudo  
✅ `09:20:50` lamaste-certbot rejects extra arguments (exit 2)  
✅ `09:20:50` lamaste-cert-info rejects a traversing lineage name (exit 2)  
✅ `09:20:50` lamaste-cert-info reads the tunnel certificate's expiry  

## Privilege boundary: the panel user cannot become root

✅ `09:20:50` sudoers has no wildcard rule  
✅ `09:20:50` sudoers allows the lamaste-priv helper  
✅ `09:20:50` /usr/local/sbin/lamaste-priv is root-owned 0755  
✅ `09:20:50` Retired wrappers lamaste-sign-csr / lamaste-pki-rename are gone  
✅ `09:20:50` Everything under /opt/lamalibre/lamaste is root-owned  
✅ `09:20:51` lamaste cannot write into the install directory  
✅ `09:20:51` /var/www/lamaste is lamaste:www-data 2750  
✅ `09:20:51` /etc/authelia is lamaste:lamaste-authelia 2770  
✅ `09:20:51` Authelia runs as lamaste-authelia, not root  
✅ `09:20:51` The running Authelia process belongs to lamaste-authelia  
✅ `09:20:51` chisel-server.key is lamaste:lamaste-chisel 0640  
✅ `09:20:51` chisel and Authelia units are root-owned  
✅ `09:20:51` lamaste-priv refuses a vhost with access_log (exit 2)  
✅ `09:20:51` …for that directive, not for its name  
✅ `09:20:51` The refused vhost was not written  
✅ `09:20:51` The former mv wildcard rule is gone  

## Port 80 redirects every host to HTTPS

✅ `09:20:51` http://10.13.37.1/a?b=1 with Host foo.example answers 301  
✅ `09:20:51` 301 Location is https://foo.example/a?b=1  
✅ `09:20:52` http://panel.test.lamaste.local/x answers 301 to HTTPS  
✅ `09:20:52` nginx site lamalibre-lamaste-http-redirect is enabled  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `55` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `55` |

