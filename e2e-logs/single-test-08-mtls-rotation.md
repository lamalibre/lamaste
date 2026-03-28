# Portlama E2E: 08 — mTLS Rotation

> Started at `2026-03-28 22:38:51 UTC`


## Pre-flight: check onboarding is complete


## Current cert fingerprint (before rotation)

ℹ️ `22:38:52` Current cert fingerprint: sha256 Fingerprint=86:76:FD:FC:3B:EE:D8:E5:6F:E1:06:C3:D6:03:4F:07:5D:9A:D6:88:B1:41:CC:1B:BB:AC:6D:95:DA:7B:F4:7B  

## Rotate mTLS certificate

✅ `22:38:53` Rotation response contains p12 password  
✅ `22:38:53` Rotation response contains expiry: 2028-03-27T22:38:53.000Z  
ℹ️ `22:38:53` Rotation warning: Your current browser certificate is now invalid. Download and import the new certificate before closing this page.  

## Download rotated certificate

✅ `22:38:53` Downloaded client.p12 (HTTP 200)  
✅ `22:38:53` Downloaded file is a valid PKCS12  
ℹ️ `22:38:53` New cert fingerprint: sha256 Fingerprint=34:7E:2C:E5:1B:C7:F5:3D:24:A3:8D:5D:93:09:4D:84:8F:9E:2E:BA:62:D6:27:90:3E:A9:BE:5E:54:3B:95:AA  
✅ `22:38:53` New cert has different fingerprint than old cert  

## Verify API access with current credentials

✅ `22:38:53` API still accessible after rotation  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `6` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `6` |

