# Portlama E2E: 10 — Shell Lifecycle (Three-VM)

> Started at `2026-03-22 18:28:27 UTC`


## Pre-flight: verify onboarding is complete

✅ `18:28:27` Onboarding is complete  

## 1. Shell config defaults

✅ `18:28:27` Shell disabled by default  
✅ `18:28:27` At least one default policy exists  
✅ `18:28:27` Default policy ID is 'default'  

## 2. Enable shell globally

✅ `18:28:27` Enable shell returned ok: true  
✅ `18:28:27` Shell is now enabled  

## 3. Policy CRUD

✅ `18:28:27` Policy creation returned ok: true  
✅ `18:28:27` Policy has an ID  
ℹ️ `18:28:27` Created policy: e2e-test-policy  
✅ `18:28:27` Created policy found in listing  
✅ `18:28:28` Policy update returned ok: true  
✅ `18:28:28` Policy timeout updated to 600  
✅ `18:28:28` Cannot delete default policy (400)  
✅ `18:28:28` Policy deletion returned ok: true  
✅ `18:28:28` Deleted policy no longer in listing  

## 4. Policy validation

✅ `18:28:28` Empty policy name rejected with 400  
✅ `18:28:28` Invalid CIDR /99 rejected with 400  
✅ `18:28:28` Policy name > 100 chars rejected with 400  

## 5. REST API: enable/disable shell for agent cert

✅ `18:28:29` Agent cert creation returned ok: true  
✅ `18:28:29` Extracted agent PEM cert and key  
✅ `18:28:30` Shell enable for agent returned ok: true  
✅ `18:28:30` shellEnabledUntil is set  
ℹ️ `18:28:30` Shell enabled for agent e2e-shell-agent  
✅ `18:28:30` Agent sees global shell enabled  
✅ `18:28:30` Agent sees own shell enabled  
✅ `18:28:30` Agent-status returns correct label  
✅ `18:28:30` Agent sees shellEnabledUntil  
✅ `18:28:30` Shell disable for agent returned ok: true  
✅ `18:28:30` Agent sees shell disabled after disable  
✅ `18:28:30` Shell enable rejected when globally disabled (400)  

## 6. Install portlama-agent on VMs for integration test

ℹ️ `18:28:30` Packing portlama-agent tarball...  
✅ `18:28:30` portlama-agent tarball packed: /tmp/lamalibre-portlama-agent-1.0.5.tgz  
ℹ️ `18:28:30` Installing portlama-agent on agent VM...  
✅ `18:30:14` portlama-agent installed on agent VM  
✅ `18:30:15` tmux installed on agent VM  
ℹ️ `18:30:15` Installing portlama-agent on host VM...  
✅ `18:30:23` portlama-agent installed on host VM  

## 7. Configure and start shell-server on agent VM

✅ `18:30:23` Agent config written to /root/.portlama/agent.json  
✅ `18:30:23` Shell enabled for test-agent  
ℹ️ `18:30:23` Shell-server started on agent VM (PID: 10787)  
✅ `18:30:25` Shell-server connected to panel relay  

## 8. Full integration: admin connects and executes a command

✅ `18:30:25` Admin P12 created on host VM  
✅ `18:30:25` Test client script written to host VM  
ℹ️ `18:30:25` Session count before integration test: 0  
ℹ️ `18:30:25` Running WebSocket shell test client on host VM...  
ℹ️ `18:30:28` WebSocket test output:  
ℹ️ `18:30:28`   Connecting to: wss://127.0.0.1:9292/api/shell/connect/test-agent  
ℹ️ `18:30:28`   WebSocket connected to panel relay  
ℹ️ `18:30:28`   Received message type: connected  
ℹ️ `18:30:28`   Agent connected, relay active  
ℹ️ `18:30:28`   Received message type: session-started  
ℹ️ `18:30:28`   Session started: e9696878-e0b4-4e41-976b-50b88378c0a6  
ℹ️ `18:30:28`   Received message type: output  
ℹ️ `18:30:28`   Sending test command...  
ℹ️ `18:30:28`   Received message type: output  
ℹ️ `18:30:28`   Received message type: output  
ℹ️ `18:30:28`   SUCCESS: Marker found in shell output  
ℹ️ `18:30:28`   Test passed — shell session completed successfully  
✅ `18:30:28` Full integration: admin connected, executed command, verified output  

## 9. Verify session audit log

✅ `18:30:30` New session entry created in audit log (before: 0, after: 1)  
✅ `18:30:30` Latest session belongs to agent: test-agent  
ℹ️ `18:30:31` Shell-server stopped on agent VM  

## 10. File transfer endpoints (501)

✅ `18:30:31` File download returns 501 (not yet implemented)  
✅ `18:30:31` File upload without path returns 400  

## 11. Input validation

✅ `18:30:31` Non-existent default policy rejected (400)  
✅ `18:30:31` durationMinutes=0 rejected (400)  
✅ `18:30:31` durationMinutes=9999 rejected (400)  
✅ `18:30:31` Shell enable for non-existent agent (404)  
✅ `18:30:31` Invalid label format rejected (400)  

## 12. Cleanup

✅ `18:30:32` Shell disabled after cleanup  
ℹ️ `18:30:32` Shell test cleanup complete  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `48` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `48` |

ℹ️ `18:30:32` Cleaning up shell test resources...  
🔵 `18:30:32` **Running: 11-plugin-lifecycle.sh**  
