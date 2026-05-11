# Lamaste E2E: 17 — Identity System (Three-VM)

> Started at `2026-03-30 13:12:59 UTC`


## Pre-flight: verify onboarding is complete


## 1. Identity API — list users (admin cert)

✅ `13:12:59` GET /api/identity/users returns users array  
✅ `13:12:59` Identity users list contains at least one user (count: 2)  
ℹ️ `13:12:59` First user in list: admin  

## 2. Identity API — single user lookup (admin cert)

✅ `13:12:59` GET /api/identity/users/:username returns correct user  
✅ `13:12:59` Single user has displayname field  
✅ `13:12:59` Single user has groups field  
✅ `13:13:00` GET /api/identity/users/:username returns 404 for non-existent user  

## 3. Identity API — list groups (admin cert)

✅ `13:13:00` GET /api/identity/groups returns groups array  
✅ `13:13:00` Identity groups list contains at least one group (count: 1)  

## 4. Identity API — /self returns 400 on mTLS vhost

✅ `13:13:00` GET /api/identity/self returns 400 on mTLS vhost (no Remote-* headers)  

## 5. nginx header stripping — forged Remote-User rejected

✅ `13:13:00` Forged Remote-User header stripped by nginx (still returns 400)  
✅ `13:13:00` Response confirms identity headers not present despite forged header  

## 6. Capability gating — agent without identity:query gets 403

✅ `13:13:01` Agent cert creation returned ok: true  
✅ `13:13:01` Agent cert has a p12 password  
ℹ️ `13:13:01` Created agent cert: identity-agent (capabilities: [tunnels:read])  
✅ `13:13:02` Extracted PEM cert and key from .p12  
✅ `13:13:02` Agent without identity:query rejected with 403 on /identity/users  
✅ `13:13:02` Agent without identity:query rejected with 403 on /identity/groups  

## 7. Capability gating — grant identity:query, verify access

✅ `13:13:02` Capability update to add identity:query returned ok: true  
ℹ️ `13:13:02` Updated agent capabilities: [tunnels:read, identity:query]  
✅ `13:13:02` Agent with identity:query can access /identity/users  
✅ `13:13:02` Agent with identity:query can access /identity/groups  
✅ `13:13:02` Agent sees the same number of users as admin (count: 2)  

## 8. Password hash exclusion verification

✅ `13:13:02` No user in /identity/users response contains a password field  
✅ `13:13:02` No password hash patterns found in raw /identity/users response  
✅ `13:13:02` Single user endpoint does not contain password field  

## 9. Cleanup

ℹ️ `13:13:02` All test sections completed. EXIT trap will handle resource cleanup.  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `23` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `23` |

ℹ️ `13:13:02` Cleaning up test resources...  
