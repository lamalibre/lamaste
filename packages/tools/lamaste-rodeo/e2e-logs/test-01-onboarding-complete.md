# Lamaste E2E: 01 — Onboarding Complete Verification (Three-VM)

> Started at `2026-11-10 12:54:04 UTC`


## Onboarding status

✅ `12:54:04` Onboarding status is COMPLETED  
✅ `12:54:04` Domain is set in onboarding status: test.lamaste.local  

## Core services running

✅ `12:54:04` Service nginx is active  
✅ `12:54:04` Service chisel is active  
✅ `12:54:04` Service authelia is active  
✅ `12:54:05` Service lamalibre-lamaste-serverd is active  

## Self-signed certificates exist

✅ `12:54:05` Certificate exists: /etc/lamalibre/lamaste/pki/ca.crt  
✅ `12:54:05` Certificate exists: /etc/lamalibre/lamaste/pki/ca.key  
✅ `12:54:05` Certificate exists: /etc/lamalibre/lamaste/pki/client.crt  
✅ `12:54:05` Certificate exists: /etc/lamalibre/lamaste/pki/client.key  
✅ `12:54:05` Certificate exists: /etc/lamalibre/lamaste/pki/self-signed.pem  
✅ `12:54:05` Certificate exists: /etc/lamalibre/lamaste/pki/self-signed-key.pem  

## Panel accessible via domain (mTLS)

✅ `12:54:06` Panel accessible via https://panel.test.lamaste.local (HTTP 200)  

## DNS resolution

✅ `12:54:21` DNS resolves test.lamaste.local to 10.13.37.1 (from host VM)  

## Agent VM connectivity

✅ `12:54:22` Agent VM can reach host VM at 10.13.37.1:9292 (HTTP 400)  

## Visitor VM connectivity

✅ `12:54:22` Visitor VM can reach host VM at 10.13.37.1:9292 (HTTP 400)  
✅ `12:54:22` Visitor VM can reach Authelia at auth.test.lamaste.local (HTTP 200)  

## Chisel server hardening

✅ `12:54:22` Server chisel (/usr/local/bin/chisel) is the pinned release 1.12.0  
✅ `12:54:23` Chisel authfile is 0640 lamaste:lamaste-chisel  
✅ `12:54:23` chisel.service runs as User=nobody  
✅ `12:54:23` chisel.service runs as Group=lamaste-chisel  
✅ `12:54:23` The lamaste user is a member of lamaste-chisel  
✅ `12:54:23` lamalibre-lamaste-serverd has SupplementaryGroups=lamaste-chisel  
✅ `12:54:23` No chisel fail-closed marker (startup reconciliation succeeded)  
✅ `12:54:24` chisel.service is enabled  

## Sudoers: certbot and certificate reads via root-owned wrappers

✅ `12:54:24` sudoers allows the lamaste-certbot wrapper  
✅ `12:54:24` sudoers allows the lamaste-cert-info wrapper  
✅ `12:54:24` sudoers has no direct certbot rule  
✅ `12:54:24` sudoers has no rule reaching into /etc/letsencrypt  
✅ `12:54:24` /usr/local/sbin/lamaste-certbot is root-owned 0755  
✅ `12:54:24` /usr/local/sbin/lamaste-cert-info is root-owned 0755  
✅ `12:54:24` lamaste cannot run /usr/bin/certbot through sudo  
✅ `12:54:24` lamaste-certbot rejects extra arguments (exit 2)  
✅ `12:54:24` lamaste-cert-info rejects a traversing lineage name (exit 2)  
✅ `12:54:25` lamaste-cert-info reads the tunnel certificate's expiry  

## Privilege boundary: the panel user cannot become root

✅ `12:54:25` sudoers has no wildcard rule  
✅ `12:54:25` sudoers allows the lamaste-priv helper  
✅ `12:54:25` /usr/local/sbin/lamaste-priv is root-owned 0755  
✅ `12:54:25` Retired wrappers lamaste-sign-csr / lamaste-pki-rename are gone  
✅ `12:54:25` Everything under /opt/lamalibre/lamaste is root-owned  
✅ `12:54:25` lamaste cannot write into the install directory  
✅ `12:54:26` /var/www/lamaste is lamaste:www-data 2750  
✅ `12:54:26` /etc/authelia is lamaste:lamaste-authelia 2770  
✅ `12:54:26` Authelia runs as lamaste-authelia, not root  
✅ `12:54:26` The running Authelia process belongs to lamaste-authelia  
✅ `12:54:26` chisel-server.key is lamaste:lamaste-chisel 0640  
✅ `12:54:26` chisel and Authelia units are root-owned  
✅ `12:54:27` lamaste-priv refuses a vhost with access_log (exit 2)  
✅ `12:54:27` …for that directive, not for its name  
✅ `12:54:27` The refused vhost was not written  
✅ `12:54:27` The former mv wildcard rule is gone  

## Port 80 redirects every host to HTTPS

✅ `12:54:27` http://10.13.37.1/a?b=1 with Host foo.example answers 301  
✅ `12:54:27` 301 Location is https://foo.example/a?b=1  
✅ `12:54:27` http://panel.test.lamaste.local/x answers 301 to HTTPS  
✅ `12:54:27` nginx site lamalibre-lamaste-http-redirect is enabled  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `55` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `55` |

