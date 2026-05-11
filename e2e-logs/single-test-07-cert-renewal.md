# Lamaste E2E: 07 — Certificate Renewal

> Started at `2026-03-30 13:06:45 UTC`


## Pre-flight: check onboarding is complete


## List certificates

✅ `13:06:45` GET /api/certs returns 6 certificates  
✅ `13:06:45` Certificate has a type field  
✅ `13:06:45` Certificate has a domain field  
✅ `13:06:45` Certificate has an expiresAt field  
✅ `13:06:45` Certificate has numeric daysUntilExpiry: 89  

## Force renew certificate

⏭️ `13:06:45` Certificate renewal requires real Let's Encrypt — skipping  

## Renew nonexistent certificate

⏭️ `13:06:45` Certbot test requires real infrastructure — skipping  

## Auto-renew timer status

✅ `13:06:45` Certbot auto-renew timer is active  
✅ `13:06:45` Auto-renew has a next run time  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `7` |
| **Failed** | `0` |
| **Skipped** | `2` |
| **Total** | `9` |

