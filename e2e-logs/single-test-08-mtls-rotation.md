# Portlama E2E: 08 — mTLS Rotation

> Started at `2026-03-16 17:21:46 UTC`


## Pre-flight: check onboarding is complete


## Current cert fingerprint (before rotation)

ℹ️ `17:21:46` Current cert fingerprint: sha256 Fingerprint=AC:0C:7A:0B:C0:04:8D:E8:D9:B9:88:D4:6E:C4:04:20:36:33:D9:B4:FB:42:87:BF:03:F0:BF:1D:6B:79:79:DD  

## Rotate mTLS certificate

✅ `17:21:47` Rotation response contains p12 password  
✅ `17:21:47` Rotation response contains expiry: 2028-03-15T17:21:47.000Z  
ℹ️ `17:21:47` Rotation warning: Your current browser certificate is now invalid. Download and import the new certificate before closing this page.  

## Download rotated certificate

✅ `17:21:47` Downloaded client.p12 (HTTP 200)  
✅ `17:21:47` Downloaded file is a valid PKCS12  
ℹ️ `17:21:47` New cert fingerprint: sha256 Fingerprint=04:58:2D:E2:74:F3:5A:B6:E1:05:D3:1B:BB:F2:EB:B6:C1:5D:F0:CB:8F:BA:BF:0E:4C:13:C5:C0:7B:F6:C9:FB  
✅ `17:21:47` New cert has different fingerprint than old cert  

## Verify API access with current credentials

✅ `17:21:47` API still accessible after rotation  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `6` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `6` |

