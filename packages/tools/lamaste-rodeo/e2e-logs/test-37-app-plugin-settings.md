# Lamaste E2E: 37 — App plugin settings and secrets (Three-VM)

> Started at `2026-11-10 13:31:03 UTC`


## Pre-flight

✅ `13:31:03` Onboarding is complete  
✅ `13:31:03` Agent test-agent is enrolled on the host  
✅ `13:31:04` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `13:31:04` The agent VM's lamaste-agent has the apphost command  
ℹ️ `13:31:04` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Fixtures, the stand-in Feria and the test secrets

✅ `13:31:05` Fixtures built: @lamalibre/e2e-apphost-cfg-server 1.0.0, 2.0.0 and 3.0.0 (settings v1, v2, v3) with their agent packages  
✅ `13:31:27` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-cfg-server, @lamalibre/e2e-apphost-cfg-agent )  
✅ `13:31:27` The agent VM reaches it at http://10.13.37.1:4874  
✅ `13:31:29` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T13:31:29.008Z"})  
✅ `13:31:29` …through its own OIDC client  
✅ `13:31:29` Test secret A: 48 hex characters, made on the host VM in a 0600 file  
✅ `13:31:29` Test secret B, for the CLI  
✅ `13:31:29` Their digests are known; the secrets never leave the host VM  
✅ `13:31:30` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  

## Install and host 1.0.0

✅ `13:31:35` Installed @lamalibre/e2e-apphost-cfg-server@1.0.0 and approved its agent half  
✅ `13:31:46` Hosted on test-agent ()  
✅ `13:32:06` The relay's health of the hosting is up  

## Before anything is configured

✅ `13:32:06` GET /api/plugins/e2e-apphost-cfg/settings answers  
✅ `13:32:06` It lists the manifest's fields  
✅ `13:32:06` …with their types  
✅ `13:32:06` …read live from the agent half  
✅ `13:32:06` …which the relay synced at 2026-11-10T13:32:06.785Z  
✅ `13:32:06` Not configured: apiKey is missing  
✅ `13:32:06` apiKey: { set: false }  
✅ `13:32:06` The other fields show their defaults (region has none)  
✅ `13:32:06` Revision 0  
✅ `13:32:06` The hosting: test-agent, up  
✅ `13:32:07` GET /api/plugins: e2e-apphost-cfg needs configuration (apiKey)  
✅ `13:32:07` GET /api/plugins/e2e-apphost-cfg says the same  
✅ `13:32:07` The agent half: schema 1, revision 0, not configured  
✅ `13:32:07` …and it holds no secret  
✅ `13:32:07` No settings.json or secrets.json yet: hosting takes no settings  

## Values that do not suit their fields are refused

✅ `13:32:08` Four values that do not suit their fields: 400  
✅ `13:32:08` A setting the schema does not know is counted under _: 1 unknown setting  
✅ `13:32:08` …never named: the errors are keyed by the schema's fields and _ alone  
✅ `13:32:08` apiKey in values: Is a secret; send it in secrets  
✅ `13:32:08` retries 987654321: Must be at most 10  
✅ `13:32:08` region: Must be one of the options  
✅ `13:32:08` The answer never repeats e2e-colour-6b1d  
✅ `13:32:08` The answer never repeats e2e-unknown-7f3a  
✅ `13:32:08` The answer never repeats e2e-misplaced-9b2e  
✅ `13:32:08` The answer never repeats 987654321  
✅ `13:32:08` The answer never repeats e2e-region-3f8a  
✅ `13:32:08` A schedule against its pattern passes the panel, which never runs a manifest's pattern, and is refused by the agent half (422)  
✅ `13:32:08` schedule: Does not match the required format  
✅ `13:32:08` …without repeating the value  
✅ `13:32:08` The agent half was asked once — for the pattern  
✅ `13:32:08` …and never for the values the panel refused  
✅ `13:32:08` Nothing changed in the agent half  

## A secret set through the API reaches the agent half alone

✅ `13:32:09` PUT /api/plugins/e2e-apphost-cfg/settings with secret A, from a 0600 file on the host VM: 200  
✅ `13:32:09` Revision 1, configured, nothing missing  
✅ `13:32:09` The answer says when apiKey was set, and nothing else about it  
✅ `13:32:09` GET: apiKey { set: true, setAt: 2026-11-10T13:32:09.127Z }  
✅ `13:32:09` GET: live, configured, region eu  
✅ `13:32:09` The agent half holds secret A: the SHA-256 of what it holds is secret A's  
✅ `13:32:09` …at revision 1, configured, region eu, retries still the default  
✅ `13:32:09` It saw the change (onChange), logged without a value  
✅ `13:32:09` GET /api/plugins: configured  
✅ `13:32:10` Audit: plugin.settings.updated with key names only (secretsSet apiKey, changed region)  

## A stale revision is refused; /admin/settings is not forwarded

✅ `13:32:10` An update edited at revision 0, now 1: 409  
✅ `13:32:10` …revision_mismatch, with the current revision  
✅ `13:32:11` GET /api/e2e-apphost-cfg/settings through the forwarder: 404  
✅ `13:32:11` GET /api/e2e-apphost-cfg/settings/reload through the forwarder: 404  
✅ `13:32:11` GET /api/e2e-apphost-cfg/Settings through the forwarder: 404  
✅ `13:32:11` GET /api/e2e-apphost-cfg/%73ettings through the forwarder: 404  
✅ `13:32:12` PUT /api/e2e-apphost-cfg/settings: 404 — no admin writes around the panel's checks  
✅ `13:32:12` POST /api/e2e-apphost-cfg/settings/reload: 404  
✅ `13:32:12` The agent half saw none of them  
✅ `13:32:12` …and nothing changed  

## lamaste-server plugins configure --secrets-stdin, its arguments sampled

✅ `13:32:14` plugins configure e2e-apphost-cfg --secrets-stdin --set retries=7 --set region=us, secret B on stdin (s
  verbose   boolean  false                         Verbose logging · default false

  Configured
  Read from the agent half
  Hosted on agent test-agent, up since 2026-11-10T13:32:04.927Z (8s ago))  
✅ `13:32:14` Its output holds no secret  
✅ `13:32:14` apiKey was set again (2026-11-10T13:32:13.741Z)  
✅ `13:32:14` …in one update with retries 7 and region us (revision 2)  
✅ `13:32:14` The agent half holds secret B  
✅ `13:32:15` plugins configure e2e-apphost-cfg --clear region (
  verbose   boolean  false                         Verbose logging · default false

  Configured
  Read from the agent half
  Hosted on agent test-agent, up since 2026-11-10T13:32:04.927Z (10s ago))  
✅ `13:32:15` region is unset again, it has no default (revision 3)  
✅ `13:32:17` --set apiKey=… is refused: a secret is never taken from the command line  
✅ `13:32:17` …the refusal points to --secrets-stdin  
✅ `13:32:17` …without repeating the value  
✅ `13:32:17` …and nothing changed  
✅ `13:32:18` plugins settings e2e-apphost-cfg --json  
✅ `13:32:18` …shows apiKey set  
✅ `13:32:18` …and no secret  
✅ `13:32:18` Every process's arguments were sampled throughout (44 samples)…  
✅ `13:32:18` …while lamaste-server configured the plugin (14 lines)  
✅ `13:32:18` No process had a test secret in its arguments — the CLI's curl included  
✅ `13:32:18` …or in its environment  
✅ `13:32:19` Audit: the CLI's update is recorded like the API's  

## On the agent VM: settings.json and secrets.json

✅ `13:32:19` settings.json: 0600, the account's  
✅ `13:32:19` secrets.json: 0600, the account's  
✅ `13:32:19` secrets.json holds apiKey…  
✅ `13:32:19` …whose value is secret B (by digest)  
✅ `13:32:19` settings.json: revision 3, the values set — retries; region was cleared — and no apiKey  
✅ `13:32:19` …retries recorded with its type: integer 7  
✅ `13:32:19` The secret is in no other file of the data directory, settings.json included  
✅ `13:32:19` …nor in the agent half's config or code  
✅ `13:32:19` …nor in the agent's own state and logs: it never went through the agent's sync  
✅ `13:32:19` …nor in the agent VM's journal  

## Update to 2.0.0: the schema change previewed, a retyped value dropped

✅ `13:32:20` 2.0.0 waits for approval: its agent half changed  
✅ `13:32:20` Preview: retries is retyped, integer to string — its value will be dropped  
✅ `13:32:20` Preview: endpoint becomes required  
✅ `13:32:20` Preview: endpoint added (a string), nothing removed  
✅ `13:32:20` Preview: no secret becomes a plain field  
✅ `13:32:20` GET /api/plugins/e2e-apphost-cfg/hooks shows the same preview  
✅ `13:32:28` The update succeeded ()  
✅ `13:32:28` The hosting is up on 2.0.0  
✅ `13:32:28` GET: the fields of 2.0.0  
✅ `13:32:28` It needs configuration again: endpoint is missing  
✅ `13:32:28` retries is the string "3", 2.0.0's default: the stored 7 was dropped, not converted  
✅ `13:32:28` The secret stays set, as it was  
✅ `13:32:28` GET /api/plugins: needs configuration (endpoint)  
✅ `13:32:28` The agent half: schema 2, revision 3 — the update changed no value an admin set  
✅ `13:32:28` It dropped the retyped value from its store  
✅ `13:32:28` …and kept secret B  
✅ `13:32:29` settings.json on the agent VM: schema 2, no retries  
✅ `13:32:29` endpoint filled in  
✅ `13:32:29` …configured again (revision 4)  

## Unhosting keeps the settings; hosting again brings them back

✅ `13:32:36` Unhosted, the data kept ()  
✅ `13:32:36` settings.json and secrets.json stay in the kept data directory  
✅ `13:32:36` …secret B with them  
✅ `13:32:36` Not hosted: a change is refused (503)  
✅ `13:32:36` …hosting_offline  
✅ `13:32:47` Hosted again ()  
✅ `13:33:07` The hosting is up again  
✅ `13:33:08` Read live: revision 4, configured — the settings came back  
✅ `13:33:08` …the same values, the same secret  
✅ `13:33:08` The agent half holds secret B again  

## The test secrets are nowhere on the relay

✅ `13:33:09` No file under /etc/lamalibre, /var/lib/lamalibre, /opt/lamalibre, /var/log, /tmp or /run holds one  
✅ `13:33:09` …a search that finds what is there (31 files under /etc/lamalibre name the plugin)  
✅ `13:33:09` state.db, dumped, holds none  
✅ `13:33:09` …a dump of 687 lines, plugin_settings in it  
✅ `13:33:09` The host's journal since the spec started holds none (1545 lines)  
✅ `13:33:09` No API answer the spec read holds one (35 answers: settings, plugins, hosting, hooks, operations, audit log, agents, notifications)  
✅ `13:33:09` The relay's cache (plugin_settings): revision 4, configured  
✅ `13:33:09` …which keeps when apiKey was set, a timestamp  
✅ `13:33:09` …and no apiKey among its values  

## Update to 3.0.0: a secret turned plain waits for the admin, auto-approve or not

✅ `13:33:09` Auto-approve is on for e2e-apphost-cfg  
✅ `13:33:10` 3.0.0 is staged and waits for approval, auto-approve on  
✅ `13:33:10` Preview: apiKey turns from a secret into a plain field (secretToPlain)  
✅ `13:33:10` …retyped secret to string  
✅ `13:33:10` It waits for approval because a secret turns plain (approvalRequired: settings.secret-to-plain)  
✅ `13:33:10` Auto-approve withheld: it turns secret settings into plain ones (apiKey) — what is typed into them next is kept on the relay and shown in clear  
✅ `13:33:10` Audit: hooks.auto-approve.withheld, settings.secret-to-plain  
✅ `13:33:10` GET /api/plugins/e2e-apphost-cfg/hooks shows it pending  
✅ `13:33:10` Until it is approved, 2.0.0 stays…  
✅ `13:33:11` …and the agent half holds secret B, schema 2  
✅ `13:33:19` Approved by the admin, the update to 3.0.0 succeeded ()  
✅ `13:33:19` The hosting is up on 3.0.0  
✅ `13:33:19` The agent half, schema 3, dropped the secret: no apiKey secret, no apiKey value — never moved into its settings  
✅ `13:33:19` On the agent VM: settings.json (schema 3) has no apiKey, secrets.json no longer holds it  
✅ `13:33:20` GET settings: apiKey is a plain string field…  
✅ `13:33:20` …without a value  
✅ `13:33:20` …and the plugin needs configuration: apiKey is missing  
✅ `13:33:20` GET /api/plugins: needs configuration (apiKey)  
✅ `13:33:20` The relay's cache: schema 3, no secret, no apiKey value  
✅ `13:33:21` Secret B (and A) is on no relay file, in no state.db row, journal line or answer after the update  

## Uninstalling with purge removes the settings on both sides

✅ `13:33:28` Uninstalled with purge ()  
✅ `13:33:28` GET settings: 404, the plugin is gone  
✅ `13:33:28` No plugin_settings row left on the relay  
✅ `13:33:29` No data directory on the agent VM: settings.json and secrets.json are gone  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `159` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `159` |

ℹ️ `13:33:29` Cleaning up test resources...  
