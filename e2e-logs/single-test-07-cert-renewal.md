# Portlama E2E: 07 — Certificate Renewal

> Started at `2026-03-28 16:08:29 UTC`


## Pre-flight: check onboarding is complete


## List certificates

✅ `16:08:29` GET /api/certs returns 6 certificates  
✅ `16:08:29` Certificate has a type field  
✅ `16:08:29` Certificate has a domain field  
✅ `16:08:29` Certificate has an expiresAt field  
✅ `16:08:29` Certificate has numeric daysUntilExpiry: 89  

## Force renew certificate

⏭️ `16:08:29` Certificate renewal requires real Let's Encrypt — skipping  

## Renew nonexistent certificate

⏭️ `16:08:29` Certbot test requires real infrastructure — skipping  

## Auto-renew timer status

✅ `16:08:29` Certbot auto-renew timer is active  
✅ `16:08:29` Auto-renew has a next run time  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `7` |
| **Failed** | `0` |
| **Skipped** | `2` |
| **Total** | `9` |

