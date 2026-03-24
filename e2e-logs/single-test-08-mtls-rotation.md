# Portlama E2E: 08 — mTLS Rotation

> Started at `2026-03-24 09:37:45 UTC`


## Pre-flight: check onboarding is complete


## Current cert fingerprint (before rotation)

ℹ️ `09:37:45` Current cert fingerprint: sha256 Fingerprint=D0:3F:4D:F8:82:52:EE:A3:41:4D:81:85:0B:93:C4:4C:D8:14:C0:20:97:90:88:9A:74:92:39:BE:DF:0E:0B:98  

## Rotate mTLS certificate

✅ `09:37:46` Rotation response contains p12 password  
✅ `09:37:46` Rotation response contains expiry: 2028-03-23T09:37:46.000Z  
ℹ️ `09:37:46` Rotation warning: Your current browser certificate is now invalid. Download and import the new certificate before closing this page.  

## Download rotated certificate

✅ `09:37:46` Downloaded client.p12 (HTTP 200)  
✅ `09:37:46` Downloaded file is a valid PKCS12  
ℹ️ `09:37:46` New cert fingerprint: sha256 Fingerprint=1B:29:89:12:0D:87:4D:C7:2D:C9:C4:09:45:0E:0A:DA:BD:13:56:50:8C:AD:2B:15:1A:4B:C0:85:C7:D4:B0:5F  
✅ `09:37:46` New cert has different fingerprint than old cert  

## Verify API access with current credentials

✅ `09:37:46` API still accessible after rotation  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `6` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `6` |

