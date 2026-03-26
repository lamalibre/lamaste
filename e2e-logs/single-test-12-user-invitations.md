# Portlama E2E: 12 — User Invitations

> Started at `2026-03-26 10:46:50 UTC`


## Pre-flight: check onboarding is complete


## Create invitation

✅ `10:46:50` Invitation creation returned ok: true  
✅ `10:46:50` Invitation username matches  
✅ `10:46:50` Invitation email matches  
✅ `10:46:50` Invitation token is valid 64-char hex  
✅ `10:46:50` Invitation ID is present  
✅ `10:46:50` Invitation createdAt is present  
✅ `10:46:50` Invitation expiresAt is present  

## List invitations

✅ `10:46:50` Invitation appears in GET /api/invitations  
✅ `10:46:50` Token is not exposed in invitation list  
✅ `10:46:50` Invitation status is pending  

## Duplicate invitation

✅ `10:46:50` Duplicate invitation for same username rejected (HTTP 409)  

## Validation: invalid input

✅ `10:46:50` Incomplete invitation data rejected (HTTP 400)  
✅ `10:46:50` Invalid email rejected (HTTP 400)  

## Get invitation details (public endpoint)

✅ `10:46:50` Public invite details show username  
✅ `10:46:50` Public invite details show email  
✅ `10:46:50` Public invite details show expiresAt  

## Invalid token

✅ `10:46:50` Accept with invalid token returns 404  
✅ `10:46:50` Malformed token rejected (HTTP 400)  

## Accept invitation (public endpoint)

✅ `10:46:53` Invitation acceptance returned ok: true  
✅ `10:46:53` Accepted username matches  

## Verify invited user exists

✅ `10:46:53` Invited user appears in GET /api/users  
✅ `10:46:53` Invited user email matches  

## Invitation marked as accepted

✅ `10:46:53` Invitation status changed to accepted  

## Used token rejection

✅ `10:46:53` Reusing accepted token returns 410 Gone  
✅ `10:46:53` GET on used token returns 410 Gone  

## Accept with short password

✅ `10:46:53` Short password rejected on invite accept (HTTP 400)  

## Cleanup: delete invited user

✅ `10:46:55` Invited user deletion returned ok: true  
✅ `10:46:55` Invited user no longer in list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `28` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `28` |

