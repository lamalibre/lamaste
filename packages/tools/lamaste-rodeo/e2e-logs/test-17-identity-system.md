# Lamaste E2E: 17 — Identity System (Three-VM)

> Started at `2026-11-02 15:51:37 UTC`


## Pre-flight: verify onboarding is complete


## 1. Identity API — list users (admin cert)

✅ `15:51:37` GET /api/identity/users returns users array  
✅ `15:51:37` Identity users list contains at least one user (count: 2)  
ℹ️ `15:51:37` First user in list: admin  

## 2. Identity API — single user lookup (admin cert)

✅ `15:51:37` GET /api/identity/users/:username returns correct user  
✅ `15:51:37` Single user has displayname field  
✅ `15:51:37` Single user has groups field  
✅ `15:51:37` GET /api/identity/users/:username returns 404 for non-existent user  

## 3. Identity API — list groups (admin cert)

✅ `15:51:37` GET /api/identity/groups returns groups array  
✅ `15:51:37` Identity groups list contains at least one group (count: 1)  

## 4. Identity API — /self returns 400 on mTLS vhost

✅ `15:51:38` GET /api/identity/self returns 400 on mTLS vhost (no Remote-* headers)  

## 5. nginx header stripping — forged Remote-User rejected

✅ `15:51:38` Forged Remote-User header stripped by nginx (still returns 400)  
✅ `15:51:38` Response confirms identity headers not present despite forged header  

## 6. Capability gating — agent without identity:query gets 403

✅ `15:51:39` Agent cert creation returned ok: true  
✅ `15:51:39` Agent cert has a p12 password  
ℹ️ `15:51:39` Created agent cert: identity-agent (capabilities: [tunnels:read])  
✅ `15:51:40` Extracted PEM cert and key from .p12  
✅ `15:51:40` Agent without identity:query rejected with 403 on /identity/users  
✅ `15:51:40` Agent without identity:query rejected with 403 on /identity/groups  

## 7. Capability gating — grant identity:query, verify access

✅ `15:51:40` Capability update to add identity:query returned ok: true  
ℹ️ `15:51:40` Updated agent capabilities: [tunnels:read, identity:query]  
✅ `15:51:40` Agent with identity:query can access /identity/users  
✅ `15:51:40` Agent with identity:query can access /identity/groups  
✅ `15:51:40` Agent sees the same number of users as admin (count: 2)  

## 8. Password hash exclusion verification

✅ `15:51:40` No user in /identity/users response contains a password field  
✅ `15:51:40` No password hash patterns found in raw /identity/users response  
✅ `15:51:40` Single user endpoint does not contain password field  

## 9. Cleanup

ℹ️ `15:51:40` All test sections completed. EXIT trap will handle resource cleanup.  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `23` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `23` |

ℹ️ `15:51:40` Cleaning up test resources...  
