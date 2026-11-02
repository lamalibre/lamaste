# Lamaste E2E: 01 — Onboarding Complete Verification (Three-VM)

> Started at `2026-11-02 15:40:18 UTC`


## Onboarding status

✅ `15:40:19` Onboarding status is COMPLETED  
✅ `15:40:19` Domain is set in onboarding status: test.lamaste.local  

## Core services running

✅ `15:40:19` Service nginx is active  
✅ `15:40:19` Service chisel is active  
✅ `15:40:19` Service authelia is active  
✅ `15:40:19` Service lamalibre-lamaste-serverd is active  

## Self-signed certificates exist

✅ `15:40:19` Certificate exists: /etc/lamalibre/lamaste/pki/ca.crt  
✅ `15:40:19` Certificate exists: /etc/lamalibre/lamaste/pki/ca.key  
✅ `15:40:19` Certificate exists: /etc/lamalibre/lamaste/pki/client.crt  
✅ `15:40:19` Certificate exists: /etc/lamalibre/lamaste/pki/client.key  
✅ `15:40:19` Certificate exists: /etc/lamalibre/lamaste/pki/self-signed.pem  
✅ `15:40:20` Certificate exists: /etc/lamalibre/lamaste/pki/self-signed-key.pem  

## Panel accessible via domain (mTLS)

✅ `15:40:20` Panel accessible via https://panel.test.lamaste.local (HTTP 200)  

## DNS resolution

✅ `15:40:35` DNS resolves test.lamaste.local to 10.13.37.1 (from host VM)  

## Agent VM connectivity

✅ `15:40:36` Agent VM can reach host VM at 10.13.37.1:9292 (HTTP 400)  

## Visitor VM connectivity

✅ `15:40:36` Visitor VM can reach host VM at 10.13.37.1:9292 (HTTP 400)  
✅ `15:40:36` Visitor VM can reach Authelia at auth.test.lamaste.local (HTTP 200)  

## Chisel server hardening

✅ `15:40:36` Server chisel (/usr/local/bin/chisel) is the pinned release 1.12.0  
✅ `15:40:36` Chisel authfile is 0640 lamaste:lamaste-chisel  
✅ `15:40:36` chisel.service runs as User=nobody  
✅ `15:40:36` chisel.service runs as Group=lamaste-chisel  
✅ `15:40:36` The lamaste user is a member of lamaste-chisel  
✅ `15:40:36` lamalibre-lamaste-serverd has SupplementaryGroups=lamaste-chisel  
✅ `15:40:37` No chisel fail-closed marker (startup reconciliation succeeded)  
✅ `15:40:37` chisel.service is enabled  

## Sudoers: certbot and certificate reads via root-owned wrappers

✅ `15:40:37` sudoers allows the lamaste-certbot wrapper  
✅ `15:40:37` sudoers allows the lamaste-cert-info wrapper  
✅ `15:40:37` sudoers has no direct certbot rule  
✅ `15:40:37` sudoers has no rule reaching into /etc/letsencrypt  
✅ `15:40:37` /usr/local/sbin/lamaste-certbot is root-owned 0755  
✅ `15:40:37` /usr/local/sbin/lamaste-cert-info is root-owned 0755  
✅ `15:40:37` lamaste cannot run /usr/bin/certbot through sudo  
✅ `15:40:37` lamaste-certbot rejects extra arguments (exit 2)  
✅ `15:40:37` lamaste-cert-info rejects a traversing lineage name (exit 2)  
✅ `15:40:37` lamaste-cert-info reads the tunnel certificate's expiry  

## Privilege boundary: the panel user cannot become root

✅ `15:40:38` sudoers has no wildcard rule  
✅ `15:40:38` sudoers allows the lamaste-priv helper  
✅ `15:40:38` /usr/local/sbin/lamaste-priv is root-owned 0755  
✅ `15:40:38` Retired wrappers lamaste-sign-csr / lamaste-pki-rename are gone  
✅ `15:40:38` Everything under /opt/lamalibre/lamaste is root-owned  
✅ `15:40:38` lamaste cannot write into the install directory  
✅ `15:40:38` /var/www/lamaste is lamaste:www-data 2750  
✅ `15:40:38` /etc/authelia is lamaste:lamaste-authelia 2770  
✅ `15:40:38` Authelia runs as lamaste-authelia, not root  
✅ `15:40:38` The running Authelia process belongs to lamaste-authelia  
✅ `15:40:39` chisel-server.key is lamaste:lamaste-chisel 0640  
✅ `15:40:39` chisel and Authelia units are root-owned  
✅ `15:40:39` lamaste-priv refuses a vhost with access_log (exit 2)  
✅ `15:40:39` …for that directive, not for its name  
✅ `15:40:39` The refused vhost was not written  
✅ `15:40:39` The former mv wildcard rule is gone  

## Port 80 redirects every host to HTTPS

✅ `15:40:39` http://10.13.37.1/a?b=1 with Host foo.example answers 301  
✅ `15:40:39` 301 Location is https://foo.example/a?b=1  
✅ `15:40:39` http://panel.test.lamaste.local/x answers 301 to HTTPS  
✅ `15:40:39` nginx site lamalibre-lamaste-http-redirect is enabled  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `55` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `55` |

