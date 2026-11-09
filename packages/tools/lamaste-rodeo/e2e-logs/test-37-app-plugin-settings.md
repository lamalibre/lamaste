# Lamaste E2E: 37 — App plugin settings and secrets (Three-VM)

> Started at `2026-11-09 13:08:02 UTC`


## Pre-flight

✅ `13:08:02` Onboarding is complete  
✅ `13:08:02` Agent test-agent is enrolled on the host  
✅ `13:08:02` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `13:08:03` The agent VM's lamaste-agent has the apphost command  
ℹ️ `13:08:03` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Fixtures, the stand-in Feria and the test secrets

✅ `13:08:03` Fixtures built: @lamalibre/e2e-apphost-cfg-server 1.0.0, 2.0.0 and 3.0.0 (settings v1, v2, v3) with their agent packages  
✅ `13:08:24` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-cfg-server, @lamalibre/e2e-apphost-cfg-agent )  
✅ `13:08:25` The agent VM reaches it at http://10.13.37.1:4874  
✅ `13:08:26` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-09T13:08:26.217Z"})  
✅ `13:08:26` …through its own OIDC client  
✅ `13:08:26` Test secret A: 48 hex characters, made on the host VM in a 0600 file  
✅ `13:08:26` Test secret B, for the CLI  
✅ `13:08:26` Their digests are known; the secrets never leave the host VM  
✅ `13:08:27` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  

## Install and host 1.0.0

✅ `13:08:32` Installed @lamalibre/e2e-apphost-cfg-server@1.0.0 and approved its agent half  
✅ `13:08:42` Hosted on test-agent ()  
✅ `13:09:01` The relay's health of the hosting is up  

## Before anything is configured

✅ `13:09:02` GET /api/plugins/e2e-apphost-cfg/settings answers  
✅ `13:09:02` It lists the manifest's fields  
✅ `13:09:02` …with their types  
✅ `13:09:02` …read live from the agent half  
✅ `13:09:02` …which the relay synced at 2026-11-09T13:09:02.144Z  
✅ `13:09:02` Not configured: apiKey is missing  
✅ `13:09:02` apiKey: { set: false }  
✅ `13:09:02` The other fields show their defaults (region has none)  
✅ `13:09:02` Revision 0  
✅ `13:09:02` The hosting: test-agent, up  
✅ `13:09:02` GET /api/plugins: e2e-apphost-cfg needs configuration (apiKey)  
✅ `13:09:02` GET /api/plugins/e2e-apphost-cfg says the same  
✅ `13:09:02` The agent half: schema 1, revision 0, not configured  
✅ `13:09:02` …and it holds no secret  
✅ `13:09:02` No settings.json or secrets.json yet: hosting takes no settings  

## Values that do not suit their fields are refused

✅ `13:09:02` Four values that do not suit their fields: 400  
✅ `13:09:02` A setting the schema does not know is counted under _: 1 unknown setting  
✅ `13:09:02` …never named: the errors are keyed by the schema's fields and _ alone  
✅ `13:09:03` apiKey in values: Is a secret; send it in secrets  
✅ `13:09:03` retries 987654321: Must be at most 10  
✅ `13:09:03` region: Must be one of the options  
✅ `13:09:03` The answer never repeats e2e-colour-6b1d  
✅ `13:09:03` The answer never repeats e2e-unknown-7f3a  
✅ `13:09:03` The answer never repeats e2e-misplaced-9b2e  
✅ `13:09:03` The answer never repeats 987654321  
✅ `13:09:03` The answer never repeats e2e-region-3f8a  
✅ `13:09:03` A schedule against its pattern passes the panel, which never runs a manifest's pattern, and is refused by the agent half (422)  
✅ `13:09:03` schedule: Does not match the required format  
✅ `13:09:03` …without repeating the value  
✅ `13:09:03` The agent half was asked once — for the pattern  
✅ `13:09:03` …and never for the values the panel refused  
✅ `13:09:03` Nothing changed in the agent half  

## A secret set through the API reaches the agent half alone

✅ `13:09:03` PUT /api/plugins/e2e-apphost-cfg/settings with secret A, from a 0600 file on the host VM: 200  
✅ `13:09:03` Revision 1, configured, nothing missing  
✅ `13:09:03` The answer says when apiKey was set, and nothing else about it  
✅ `13:09:03` GET: apiKey { set: true, setAt: 2026-11-09T13:09:03.847Z }  
✅ `13:09:03` GET: live, configured, region eu  
✅ `13:09:04` The agent half holds secret A: the SHA-256 of what it holds is secret A's  
✅ `13:09:04` …at revision 1, configured, region eu, retries still the default  
✅ `13:09:04` It saw the change (onChange), logged without a value  
✅ `13:09:04` GET /api/plugins: configured  
✅ `13:09:04` Audit: plugin.settings.updated with key names only (secretsSet apiKey, changed region)  

## A stale revision is refused; /admin/settings is not forwarded

✅ `13:09:04` An update edited at revision 0, now 1: 409  
✅ `13:09:04` …revision_mismatch, with the current revision  
✅ `13:09:05` GET /api/e2e-apphost-cfg/settings through the forwarder: 404  
✅ `13:09:05` GET /api/e2e-apphost-cfg/settings/reload through the forwarder: 404  
✅ `13:09:05` GET /api/e2e-apphost-cfg/Settings through the forwarder: 404  
✅ `13:09:05` GET /api/e2e-apphost-cfg/%73ettings through the forwarder: 404  
✅ `13:09:05` PUT /api/e2e-apphost-cfg/settings: 404 — no admin writes around the panel's checks  
✅ `13:09:05` POST /api/e2e-apphost-cfg/settings/reload: 404  
✅ `13:09:05` The agent half saw none of them  
✅ `13:09:06` …and nothing changed  

## lamaste-server plugins configure --secrets-stdin, its arguments sampled

✅ `13:09:07` plugins configure e2e-apphost-cfg --secrets-stdin --set retries=7 --set region=us, secret B on stdin (s
  verbose   boolean  false                         Verbose logging · default false

  Configured
  Read from the agent half
  Hosted on agent test-agent, up since 2026-11-09T13:08:59.945Z (6s ago))  
✅ `13:09:07` Its output holds no secret  
✅ `13:09:07` apiKey was set again (2026-11-09T13:09:06.819Z)  
✅ `13:09:07` …in one update with retries 7 and region us (revision 2)  
✅ `13:09:07` The agent half holds secret B  
✅ `13:09:08` plugins configure e2e-apphost-cfg --clear region (s
  verbose   boolean  false                         Verbose logging · default false

  Configured
  Read from the agent half
  Hosted on agent test-agent, up since 2026-11-09T13:08:59.945Z (8s ago))  
✅ `13:09:08` region is unset again, it has no default (revision 3)  
✅ `13:09:09` --set apiKey=… is refused: a secret is never taken from the command line  
✅ `13:09:09` …the refusal points to --secrets-stdin  
✅ `13:09:09` …without repeating the value  
✅ `13:09:09` …and nothing changed  
✅ `13:09:10` plugins settings e2e-apphost-cfg --json  
✅ `13:09:10` …shows apiKey set  
✅ `13:09:10` …and no secret  
✅ `13:09:10` Every process's arguments were sampled throughout (41 samples)…  
✅ `13:09:10` …while lamaste-server configured the plugin (10 lines)  
✅ `13:09:10` No process had a test secret in its arguments — the CLI's curl included  
✅ `13:09:10` …or in its environment  
✅ `13:09:10` Audit: the CLI's update is recorded like the API's  

## On the agent VM: settings.json and secrets.json

✅ `13:09:10` settings.json: 0600, the account's  
✅ `13:09:10` secrets.json: 0600, the account's  
✅ `13:09:10` secrets.json holds apiKey…  
✅ `13:09:10` …whose value is secret B (by digest)  
✅ `13:09:10` settings.json: revision 3, the values set — retries; region was cleared — and no apiKey  
✅ `13:09:10` …retries recorded with its type: integer 7  
✅ `13:09:10` The secret is in no other file of the data directory, settings.json included  
✅ `13:09:10` …nor in the agent half's config or code  
✅ `13:09:10` …nor in the agent's own state and logs: it never went through the agent's sync  
✅ `13:09:10` …nor in the agent VM's journal  

## Update to 2.0.0: the schema change previewed, a retyped value dropped

✅ `13:09:11` 2.0.0 waits for approval: its agent half changed  
✅ `13:09:11` Preview: retries is retyped, integer to string — its value will be dropped  
✅ `13:09:11` Preview: endpoint becomes required  
✅ `13:09:11` Preview: endpoint added (a string), nothing removed  
✅ `13:09:11` Preview: no secret becomes a plain field  
✅ `13:09:11` GET /api/plugins/e2e-apphost-cfg/hooks shows the same preview  
✅ `13:09:18` The update succeeded ()  
✅ `13:09:18` The hosting is up on 2.0.0  
✅ `13:09:18` GET: the fields of 2.0.0  
✅ `13:09:18` It needs configuration again: endpoint is missing  
✅ `13:09:18` retries is the string "3", 2.0.0's default: the stored 7 was dropped, not converted  
✅ `13:09:18` The secret stays set, as it was  
✅ `13:09:18` GET /api/plugins: needs configuration (endpoint)  
✅ `13:09:19` The agent half: schema 2, revision 3 — the update changed no value an admin set  
✅ `13:09:19` It dropped the retyped value from its store  
✅ `13:09:19` …and kept secret B  
✅ `13:09:19` settings.json on the agent VM: schema 2, no retries  
✅ `13:09:19` endpoint filled in  
✅ `13:09:19` …configured again (revision 4)  

## Unhosting keeps the settings; hosting again brings them back

✅ `13:09:26` Unhosted, the data kept ()  
✅ `13:09:26` settings.json and secrets.json stay in the kept data directory  
✅ `13:09:26` …secret B with them  
✅ `13:09:26` Not hosted: a change is refused (503)  
✅ `13:09:26` …hosting_offline  
✅ `13:09:36` Hosted again ()  
✅ `13:09:52` The hosting is up again  
✅ `13:09:52` Read live: revision 4, configured — the settings came back  
✅ `13:09:52` …the same values, the same secret  
✅ `13:09:53` The agent half holds secret B again  

## The test secrets are nowhere on the relay

✅ `13:09:53` No file under /etc/lamalibre, /var/lib/lamalibre, /opt/lamalibre, /var/log, /tmp or /run holds one  
✅ `13:09:53` …a search that finds what is there (31 files under /etc/lamalibre name the plugin)  
✅ `13:09:53` state.db, dumped, holds none  
✅ `13:09:53` …a dump of 653 lines, plugin_settings in it  
✅ `13:09:53` The host's journal since the spec started holds none (1533 lines)  
✅ `13:09:53` No API answer the spec read holds one (35 answers: settings, plugins, hosting, hooks, operations, audit log, agents, notifications)  
✅ `13:09:53` The relay's cache (plugin_settings): revision 4, configured  
✅ `13:09:53` …which keeps when apiKey was set, a timestamp  
✅ `13:09:53` …and no apiKey among its values  

## Update to 3.0.0: a secret turned plain waits for the admin, auto-approve or not

✅ `13:09:53` Auto-approve is on for e2e-apphost-cfg  
✅ `13:09:54` 3.0.0 is staged and waits for approval, auto-approve on  
✅ `13:09:54` Preview: apiKey turns from a secret into a plain field (secretToPlain)  
✅ `13:09:54` …retyped secret to string  
✅ `13:09:54` It waits for approval because a secret turns plain (approvalRequired: settings.secret-to-plain)  
✅ `13:09:54` Auto-approve withheld: it turns secret settings into plain ones (apiKey) — what is typed into them next is kept on the relay and shown in clear  
✅ `13:09:54` Audit: hooks.auto-approve.withheld, settings.secret-to-plain  
✅ `13:09:54` GET /api/plugins/e2e-apphost-cfg/hooks shows it pending  
✅ `13:09:54` Until it is approved, 2.0.0 stays…  
✅ `13:09:54` …and the agent half holds secret B, schema 2  
✅ `13:10:02` Approved by the admin, the update to 3.0.0 succeeded ()  
✅ `13:10:02` The hosting is up on 3.0.0  
✅ `13:10:02` The agent half, schema 3, dropped the secret: no apiKey secret, no apiKey value — never moved into its settings  
✅ `13:10:02` On the agent VM: settings.json (schema 3) has no apiKey, secrets.json no longer holds it  
✅ `13:10:02` GET settings: apiKey is a plain string field…  
✅ `13:10:02` …without a value  
✅ `13:10:02` …and the plugin needs configuration: apiKey is missing  
✅ `13:10:02` GET /api/plugins: needs configuration (apiKey)  
✅ `13:10:03` The relay's cache: schema 3, no secret, no apiKey value  
✅ `13:10:03` Secret B (and A) is on no relay file, in no state.db row, journal line or answer after the update  

## Uninstalling with purge removes the settings on both sides

✅ `13:10:10` Uninstalled with purge ()  
✅ `13:10:10` GET settings: 404, the plugin is gone  
✅ `13:10:11` No plugin_settings row left on the relay  
✅ `13:10:11` No data directory on the agent VM: settings.json and secrets.json are gone  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `159` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `159` |

ℹ️ `13:10:11` Cleaning up test resources...  
