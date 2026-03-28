# Portlama E2E: 08 — mTLS Rotation

> Started at `2026-03-28 16:08:29 UTC`


## Pre-flight: check onboarding is complete


## Current cert fingerprint (before rotation)

ℹ️ `16:08:29` Current cert fingerprint: sha256 Fingerprint=54:57:04:6B:0C:4A:66:EF:B4:48:F1:79:69:BE:85:20:79:DF:6B:3F:84:CE:33:93:49:6D:67:AE:AD:EE:C8:02  

## Rotate mTLS certificate

✅ `16:08:30` Rotation response contains p12 password  
✅ `16:08:30` Rotation response contains expiry: 2028-03-27T16:08:30.000Z  
ℹ️ `16:08:30` Rotation warning: Your current browser certificate is now invalid. Download and import the new certificate before closing this page.  

## Download rotated certificate

✅ `16:08:30` Downloaded client.p12 (HTTP 200)  
✅ `16:08:30` Downloaded file is a valid PKCS12  
ℹ️ `16:08:30` New cert fingerprint: sha256 Fingerprint=11:D3:1B:DE:D2:38:16:F0:7D:C0:DC:C2:9E:82:27:E4:90:CF:F4:D8:49:73:A3:0B:2D:7E:75:2D:02:27:8C:9B  
✅ `16:08:30` New cert has different fingerprint than old cert  

## Verify API access with current credentials

✅ `16:08:30` API still accessible after rotation  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `6` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `6` |

