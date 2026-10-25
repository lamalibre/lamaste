# Lamaste E2E: 01 — Onboarding Complete Verification (Three-VM)

> Started at `2026-10-25 18:26:52 UTC`


## Onboarding status

✅ `18:26:52` Onboarding status is COMPLETED  
✅ `18:26:52` Domain is set in onboarding status: test.lamaste.local  

## Core services running

✅ `18:26:53` Service nginx is active  
✅ `18:26:53` Service chisel is active  
✅ `18:26:53` Service authelia is active  
✅ `18:26:53` Service lamalibre-lamaste-serverd is active  

## Self-signed certificates exist

✅ `18:26:53` Certificate exists: /etc/lamalibre/lamaste/pki/ca.crt  
✅ `18:26:53` Certificate exists: /etc/lamalibre/lamaste/pki/ca.key  
✅ `18:26:53` Certificate exists: /etc/lamalibre/lamaste/pki/client.crt  
✅ `18:26:53` Certificate exists: /etc/lamalibre/lamaste/pki/client.key  
✅ `18:26:53` Certificate exists: /etc/lamalibre/lamaste/pki/self-signed.pem  
✅ `18:26:53` Certificate exists: /etc/lamalibre/lamaste/pki/self-signed-key.pem  

## Panel accessible via domain (mTLS)

✅ `18:26:53` Panel accessible via https://panel.test.lamaste.local (HTTP 200)  

## DNS resolution

✅ `18:27:09` DNS resolves test.lamaste.local to 10.13.37.1 (from host VM)  

## Agent VM connectivity

✅ `18:27:09` Agent VM can reach host VM at 10.13.37.1:9292 (HTTP 400)  

## Visitor VM connectivity

✅ `18:27:09` Visitor VM can reach host VM at 10.13.37.1:9292 (HTTP 400)  
✅ `18:27:09` Visitor VM can reach Authelia at auth.test.lamaste.local (HTTP 200)  

## Chisel server hardening

✅ `18:27:09` Server chisel (/usr/local/bin/chisel) is the pinned release 1.12.0  
✅ `18:27:10` Chisel authfile is 0640 lamaste:lamaste-chisel  
✅ `18:27:10` chisel.service runs as User=nobody  
✅ `18:27:10` chisel.service runs as Group=lamaste-chisel  
✅ `18:27:10` The lamaste user is a member of lamaste-chisel  
✅ `18:27:10` lamalibre-lamaste-serverd has SupplementaryGroups=lamaste-chisel  
✅ `18:27:10` No chisel fail-closed marker (startup reconciliation succeeded)  
✅ `18:27:10` chisel.service is enabled  

## Sudoers: certbot and certificate reads via root-owned wrappers

✅ `18:27:10` sudoers allows the lamaste-certbot wrapper  
✅ `18:27:10` sudoers allows the lamaste-cert-info wrapper  
✅ `18:27:10` sudoers has no direct certbot rule  
✅ `18:27:10` sudoers has no rule reaching into /etc/letsencrypt  
✅ `18:27:10` /usr/local/sbin/lamaste-certbot is root-owned 0755  
✅ `18:27:10` /usr/local/sbin/lamaste-cert-info is root-owned 0755  
✅ `18:27:10` lamaste cannot run /usr/bin/certbot through sudo  
✅ `18:27:11` lamaste-certbot rejects extra arguments (exit 2)  
✅ `18:27:11` lamaste-cert-info rejects a traversing lineage name (exit 2)  
✅ `18:27:11` lamaste-cert-info reads the tunnel certificate's expiry  

## Privilege boundary: the panel user cannot become root

✅ `18:27:11` sudoers has no wildcard rule  
✅ `18:27:11` sudoers allows the lamaste-priv helper  
✅ `18:27:11` /usr/local/sbin/lamaste-priv is root-owned 0755  
✅ `18:27:11` Retired wrappers lamaste-sign-csr / lamaste-pki-rename are gone  
✅ `18:27:11` Everything under /opt/lamalibre/lamaste is root-owned  
✅ `18:27:11` lamaste cannot write into the install directory  
✅ `18:27:12` /var/www/lamaste is lamaste:www-data 2750  
✅ `18:27:12` /etc/authelia is lamaste:lamaste-authelia 2770  
✅ `18:27:12` Authelia runs as lamaste-authelia, not root  
✅ `18:27:12` The running Authelia process belongs to lamaste-authelia  
✅ `18:27:12` chisel-server.key is lamaste:lamaste-chisel 0640  
✅ `18:27:12` chisel and Authelia units are root-owned  
✅ `18:27:12` lamaste-priv refuses a vhost with access_log (exit 2)  
✅ `18:27:12` …for that directive, not for its name  
✅ `18:27:12` The refused vhost was not written  
✅ `18:27:13` The former mv wildcard rule is gone  

## Port 80 redirects every host to HTTPS

✅ `18:27:13` http://10.13.37.1/a?b=1 with Host foo.example answers 301  
✅ `18:27:13` 301 Location is https://foo.example/a?b=1  
✅ `18:27:13` http://panel.test.lamaste.local/x answers 301 to HTTPS  
✅ `18:27:13` nginx site lamalibre-lamaste-http-redirect is enabled  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `55` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `55` |

