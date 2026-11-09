# Lamaste E2E: 17 — Identity System (Three-VM)

> Started at `2026-11-09 12:43:23 UTC`


## Pre-flight: verify onboarding is complete


## 1. Identity API — list users (admin cert)

✅ `12:43:23` GET /api/identity/users returns users array  
✅ `12:43:23` Identity users list contains at least one user (count: 2)  
ℹ️ `12:43:23` First user in list: admin  

## 2. Identity API — single user lookup (admin cert)

✅ `12:43:23` GET /api/identity/users/:username returns correct user  
✅ `12:43:23` Single user has displayname field  
✅ `12:43:23` Single user has groups field  
✅ `12:43:23` GET /api/identity/users/:username returns 404 for non-existent user  

## 3. Identity API — list groups (admin cert)

✅ `12:43:23` GET /api/identity/groups returns groups array  
✅ `12:43:23` Identity groups list contains at least one group (count: 1)  

## 4. Identity API — /self returns 400 on mTLS vhost

✅ `12:43:23` GET /api/identity/self returns 400 on mTLS vhost (no Remote-* headers)  

## 5. nginx header stripping — forged Remote-User rejected

✅ `12:43:23` Forged Remote-User header stripped by nginx (still returns 400)  
✅ `12:43:24` Response confirms identity headers not present despite forged header  

## 6. Capability gating — agent without identity:query gets 403

✅ `12:43:25` Agent cert creation returned ok: true  
✅ `12:43:25` Agent cert has a p12 password  
ℹ️ `12:43:25` Created agent cert: identity-agent (capabilities: [tunnels:read])  
✅ `12:43:26` Extracted PEM cert and key from .p12  
✅ `12:43:26` Agent without identity:query rejected with 403 on /identity/users  
✅ `12:43:26` Agent without identity:query rejected with 403 on /identity/groups  

## 7. Capability gating — grant identity:query, verify access

✅ `12:43:26` Capability update to add identity:query returned ok: true  
ℹ️ `12:43:26` Updated agent capabilities: [tunnels:read, identity:query]  
✅ `12:43:26` Agent with identity:query can access /identity/users  
✅ `12:43:26` Agent with identity:query can access /identity/groups  
✅ `12:43:26` Agent sees the same number of users as admin (count: 2)  

## 8. Password hash exclusion verification

✅ `12:43:26` No user in /identity/users response contains a password field  
✅ `12:43:26` No password hash patterns found in raw /identity/users response  
✅ `12:43:26` Single user endpoint does not contain password field  

## 9. Cleanup

ℹ️ `12:43:26` All test sections completed. EXIT trap will handle resource cleanup.  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `23` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `23` |

ℹ️ `12:43:26` Cleaning up test resources...  
