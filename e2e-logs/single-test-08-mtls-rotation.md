# Portlama E2E: 08 — mTLS Rotation

> Started at `2026-03-19 12:17:29 UTC`


## Pre-flight: check onboarding is complete


## Current cert fingerprint (before rotation)

ℹ️ `12:17:29` Current cert fingerprint: sha256 Fingerprint=C3:31:85:68:10:5E:6C:59:E9:EA:D4:A8:54:F1:23:74:CB:F1:41:70:D0:D2:18:36:D3:2C:66:F4:7F:A4:5A:1A  

## Rotate mTLS certificate

✅ `12:17:30` Rotation response contains p12 password  
✅ `12:17:30` Rotation response contains expiry: 2028-03-18T12:17:30.000Z  
ℹ️ `12:17:30` Rotation warning: Your current browser certificate is now invalid. Download and import the new certificate before closing this page.  

## Download rotated certificate

✅ `12:17:30` Downloaded client.p12 (HTTP 200)  
✅ `12:17:30` Downloaded file is a valid PKCS12  
ℹ️ `12:17:30` New cert fingerprint: sha256 Fingerprint=8C:D3:A6:75:EF:89:B6:7A:7D:AF:8E:05:88:FF:8D:59:D5:98:9E:18:60:12:E6:46:6C:78:E1:4A:71:8E:AB:82  
✅ `12:17:30` New cert has different fingerprint than old cert  

## Verify API access with current credentials

✅ `12:17:30` API still accessible after rotation  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `6` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `6` |

