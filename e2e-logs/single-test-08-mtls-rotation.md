# Portlama E2E: 08 — mTLS Rotation

> Started at `2026-03-23 12:09:24 UTC`


## Pre-flight: check onboarding is complete


## Current cert fingerprint (before rotation)

ℹ️ `12:09:24` Current cert fingerprint: sha256 Fingerprint=53:F1:8B:0D:9C:55:75:94:57:E5:DD:E4:11:66:E2:74:52:5F:40:B5:0E:40:5B:09:06:75:B2:FF:F4:67:55:DB  

## Rotate mTLS certificate

✅ `12:09:25` Rotation response contains p12 password  
✅ `12:09:25` Rotation response contains expiry: 2028-03-22T12:09:25.000Z  
ℹ️ `12:09:25` Rotation warning: Your current browser certificate is now invalid. Download and import the new certificate before closing this page.  

## Download rotated certificate

✅ `12:09:25` Downloaded client.p12 (HTTP 200)  
✅ `12:09:25` Downloaded file is a valid PKCS12  
ℹ️ `12:09:25` New cert fingerprint: sha256 Fingerprint=35:9B:DF:FF:A3:26:C4:48:39:AF:25:55:BD:C7:79:4E:3A:AB:C8:6B:09:D0:63:08:32:75:D1:9C:EA:DF:90:61  
✅ `12:09:25` New cert has different fingerprint than old cert  

## Verify API access with current credentials

✅ `12:09:25` API still accessible after rotation  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `6` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `6` |

