# Lamaste E2E: 37 — App plugin settings and secrets (Three-VM)

> Started at `2026-11-02 16:14:50 UTC`


## Pre-flight

✅ `16:14:50` Onboarding is complete  
✅ `16:14:51` Agent test-agent is enrolled on the host  
✅ `16:14:51` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `16:14:51` The agent VM's lamaste-agent has the apphost command  
ℹ️ `16:14:51` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Fixtures, the stand-in Feria and the test secrets

✅ `16:14:51` Fixtures built: @lamalibre/e2e-apphost-cfg-server 1.0.0, 2.0.0 and 3.0.0 (settings v1, v2, v3) with their agent packages  
✅ `16:14:55` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-cfg-server, @lamalibre/e2e-apphost-cfg-agent )  
✅ `16:14:55` The agent VM reaches it at http://10.13.37.1:4874  
✅ `16:14:57` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-02T16:14:57.367Z"})  
✅ `16:14:57` …through its own OIDC client  
✅ `16:14:57` Test secret A: 48 hex characters, made on the host VM in a 0600 file  
✅ `16:14:57` Test secret B, for the CLI  
✅ `16:14:57` Their digests are known; the secrets never leave the host VM  
✅ `16:14:58` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  

## Install and host 1.0.0

✅ `16:15:00` Installed @lamalibre/e2e-apphost-cfg-server@1.0.0 and approved its agent half  
✅ `16:15:11` Hosted on test-agent ()  
✅ `16:15:24` The relay's health of the hosting is up  

## Before anything is configured

✅ `16:15:24` GET /api/plugins/e2e-apphost-cfg/settings answers  
✅ `16:15:24` It lists the manifest's fields  
✅ `16:15:24` …with their types  
✅ `16:15:24` …read live from the agent half  
✅ `16:15:24` …which the relay synced at 2026-11-02T16:15:25.282Z  
✅ `16:15:24` Not configured: apiKey is missing  
✅ `16:15:24` apiKey: { set: false }  
✅ `16:15:24` The other fields show their defaults (region has none)  
✅ `16:15:24` Revision 0  
✅ `16:15:24` The hosting: test-agent, up  
✅ `16:15:25` GET /api/plugins: e2e-apphost-cfg needs configuration (apiKey)  
✅ `16:15:25` GET /api/plugins/e2e-apphost-cfg says the same  
✅ `16:15:25` The agent half: schema 1, revision 0, not configured  
✅ `16:15:25` …and it holds no secret  
✅ `16:15:25` No settings.json or secrets.json yet: hosting takes no settings  

## Values that do not suit their fields are refused

✅ `16:15:25` Four values that do not suit their fields: 400  
✅ `16:15:25` A setting the schema does not know is counted under _: 1 unknown setting  
✅ `16:15:25` …never named: the errors are keyed by the schema's fields and _ alone  
✅ `16:15:25` apiKey in values: Is a secret; send it in secrets  
✅ `16:15:25` retries 987654321: Must be at most 10  
✅ `16:15:25` region: Must be one of the options  
✅ `16:15:25` The answer never repeats e2e-colour-6b1d  
✅ `16:15:25` The answer never repeats e2e-unknown-7f3a  
✅ `16:15:25` The answer never repeats e2e-misplaced-9b2e  
✅ `16:15:25` The answer never repeats 987654321  
✅ `16:15:25` The answer never repeats e2e-region-3f8a  
✅ `16:15:25` A schedule against its pattern passes the panel, which never runs a manifest's pattern, and is refused by the agent half (422)  
✅ `16:15:25` schedule: Does not match the required format  
✅ `16:15:25` …without repeating the value  
✅ `16:15:25` The agent half was asked once — for the pattern  
✅ `16:15:25` …and never for the values the panel refused  
✅ `16:15:26` Nothing changed in the agent half  

## A secret set through the API reaches the agent half alone

✅ `16:15:26` PUT /api/plugins/e2e-apphost-cfg/settings with secret A, from a 0600 file on the host VM: 200  
✅ `16:15:26` Revision 1, configured, nothing missing  
✅ `16:15:26` The answer says when apiKey was set, and nothing else about it  
✅ `16:15:26` GET: apiKey { set: true, setAt: 2026-11-02T16:15:26.711Z }  
✅ `16:15:26` GET: live, configured, region eu  
✅ `16:15:26` The agent half holds secret A: the SHA-256 of what it holds is secret A's  
✅ `16:15:26` …at revision 1, configured, region eu, retries still the default  
✅ `16:15:26` It saw the change (onChange), logged without a value  
✅ `16:15:26` GET /api/plugins: configured  
✅ `16:15:27` Audit: plugin.settings.updated with key names only (secretsSet apiKey, changed region)  

## A stale revision is refused; /admin/settings is not forwarded

✅ `16:15:27` An update edited at revision 0, now 1: 409  
✅ `16:15:27` …revision_mismatch, with the current revision  
✅ `16:15:27` GET /api/e2e-apphost-cfg/settings through the forwarder: 404  
✅ `16:15:27` GET /api/e2e-apphost-cfg/settings/reload through the forwarder: 404  
✅ `16:15:27` GET /api/e2e-apphost-cfg/Settings through the forwarder: 404  
✅ `16:15:28` GET /api/e2e-apphost-cfg/%73ettings through the forwarder: 404  
✅ `16:15:28` PUT /api/e2e-apphost-cfg/settings: 404 — no admin writes around the panel's checks  
✅ `16:15:28` POST /api/e2e-apphost-cfg/settings/reload: 404  
✅ `16:15:28` The agent half saw none of them  
✅ `16:15:28` …and nothing changed  

## lamaste-server plugins configure --secrets-stdin, its arguments sampled

✅ `16:15:29` plugins configure e2e-apphost-cfg --secrets-stdin --set retries=7 --set region=us, secret B on stdin (s
  verbose   boolean  false                         Verbose logging · default false

  Configured
  Read from the agent half
  Hosted on agent test-agent, up since 2026-11-02T16:15:21.895Z (7s ago))  
✅ `16:15:29` Its output holds no secret  
✅ `16:15:29` apiKey was set again (2026-11-02T16:15:29.535Z)  
✅ `16:15:29` …in one update with retries 7 and region us (revision 2)  
✅ `16:15:29` The agent half holds secret B  
✅ `16:15:30` plugins configure e2e-apphost-cfg --clear region (s
  verbose   boolean  false                         Verbose logging · default false

  Configured
  Read from the agent half
  Hosted on agent test-agent, up since 2026-11-02T16:15:21.895Z (8s ago))  
✅ `16:15:30` region is unset again, it has no default (revision 3)  
✅ `16:15:31` --set apiKey=… is refused: a secret is never taken from the command line  
✅ `16:15:31` …the refusal points to --secrets-stdin  
✅ `16:15:31` …without repeating the value  
✅ `16:15:31` …and nothing changed  
✅ `16:15:32` plugins settings e2e-apphost-cfg --json  
✅ `16:15:32` …shows apiKey set  
✅ `16:15:32` …and no secret  
✅ `16:15:32` Every process's arguments were sampled throughout (40 samples)…  
✅ `16:15:32` …while lamaste-server configured the plugin (8 lines)  
✅ `16:15:32` No process had a test secret in its arguments — the CLI's curl included  
✅ `16:15:32` …or in its environment  
✅ `16:15:32` Audit: the CLI's update is recorded like the API's  

## On the agent VM: settings.json and secrets.json

✅ `16:15:32` settings.json: 0600, the account's  
✅ `16:15:32` secrets.json: 0600, the account's  
✅ `16:15:32` secrets.json holds apiKey…  
✅ `16:15:32` …whose value is secret B (by digest)  
✅ `16:15:32` settings.json: revision 3, the values set — retries; region was cleared — and no apiKey  
✅ `16:15:32` …retries recorded with its type: integer 7  
✅ `16:15:33` The secret is in no other file of the data directory, settings.json included  
✅ `16:15:33` …nor in the agent half's config or code  
✅ `16:15:33` …nor in the agent's own state and logs: it never went through the agent's sync  
✅ `16:15:33` …nor in the agent VM's journal  

## Update to 2.0.0: the schema change previewed, a retyped value dropped

✅ `16:15:33` 2.0.0 waits for approval: its agent half changed  
✅ `16:15:33` Preview: retries is retyped, integer to string — its value will be dropped  
✅ `16:15:33` Preview: endpoint becomes required  
✅ `16:15:33` Preview: endpoint added (a string), nothing removed  
✅ `16:15:33` Preview: no secret becomes a plain field  
✅ `16:15:33` GET /api/plugins/e2e-apphost-cfg/hooks shows the same preview  
✅ `16:15:37` The update succeeded ()  
✅ `16:15:37` The hosting is up on 2.0.0  
✅ `16:15:37` GET: the fields of 2.0.0  
✅ `16:15:37` It needs configuration again: endpoint is missing  
✅ `16:15:37` retries is the string "3", 2.0.0's default: the stored 7 was dropped, not converted  
✅ `16:15:37` The secret stays set, as it was  
✅ `16:15:37` GET /api/plugins: needs configuration (endpoint)  
✅ `16:15:38` The agent half: schema 2, revision 3 — the update changed no value an admin set  
✅ `16:15:38` It dropped the retyped value from its store  
✅ `16:15:38` …and kept secret B  
✅ `16:15:38` settings.json on the agent VM: schema 2, no retries  
✅ `16:15:38` endpoint filled in  
✅ `16:15:38` …configured again (revision 4)  

## Unhosting keeps the settings; hosting again brings them back

✅ `16:15:45` Unhosted, the data kept ()  
✅ `16:15:45` settings.json and secrets.json stay in the kept data directory  
✅ `16:15:45` …secret B with them  
✅ `16:15:45` Not hosted: a change is refused (503)  
✅ `16:15:45` …hosting_offline  
✅ `16:15:56` Hosted again ()  
✅ `16:16:12` The hosting is up again  
✅ `16:16:12` Read live: revision 4, configured — the settings came back  
✅ `16:16:12` …the same values, the same secret  
✅ `16:16:12` The agent half holds secret B again  

## The test secrets are nowhere on the relay

✅ `16:16:13` No file under /etc/lamalibre, /var/lib/lamalibre, /opt/lamalibre, /var/log, /tmp or /run holds one  
✅ `16:16:13` …a search that finds what is there (31 files under /etc/lamalibre name the plugin)  
✅ `16:16:13` state.db, dumped, holds none  
✅ `16:16:13` …a dump of 652 lines, plugin_settings in it  
✅ `16:16:13` The host's journal since the spec started holds none (1334 lines)  
✅ `16:16:13` No API answer the spec read holds one (35 answers: settings, plugins, hosting, hooks, operations, audit log, agents, notifications)  
✅ `16:16:13` The relay's cache (plugin_settings): revision 4, configured  
✅ `16:16:13` …which keeps when apiKey was set, a timestamp  
✅ `16:16:13` …and no apiKey among its values  

## Update to 3.0.0: a secret turned plain waits for the admin, auto-approve or not

✅ `16:16:13` Auto-approve is on for e2e-apphost-cfg  
✅ `16:16:14` 3.0.0 is staged and waits for approval, auto-approve on  
✅ `16:16:14` Preview: apiKey turns from a secret into a plain field (secretToPlain)  
✅ `16:16:14` …retyped secret to string  
✅ `16:16:14` It waits for approval because a secret turns plain (approvalRequired: settings.secret-to-plain)  
✅ `16:16:14` Auto-approve withheld: it turns secret settings into plain ones (apiKey) — what is typed into them next is kept on the relay and shown in clear  
✅ `16:16:14` Audit: hooks.auto-approve.withheld, settings.secret-to-plain  
✅ `16:16:14` GET /api/plugins/e2e-apphost-cfg/hooks shows it pending  
✅ `16:16:14` Until it is approved, 2.0.0 stays…  
✅ `16:16:14` …and the agent half holds secret B, schema 2  
✅ `16:16:18` Approved by the admin, the update to 3.0.0 succeeded ()  
✅ `16:16:18` The hosting is up on 3.0.0  
✅ `16:16:19` The agent half, schema 3, dropped the secret: no apiKey secret, no apiKey value — never moved into its settings  
✅ `16:16:19` On the agent VM: settings.json (schema 3) has no apiKey, secrets.json no longer holds it  
✅ `16:16:19` GET settings: apiKey is a plain string field…  
✅ `16:16:19` …without a value  
✅ `16:16:19` …and the plugin needs configuration: apiKey is missing  
✅ `16:16:19` GET /api/plugins: needs configuration (apiKey)  
✅ `16:16:19` The relay's cache: schema 3, no secret, no apiKey value  
✅ `16:16:20` Secret B (and A) is on no relay file, in no state.db row, journal line or answer after the update  

## Uninstalling with purge removes the settings on both sides

✅ `16:16:27` Uninstalled with purge ()  
✅ `16:16:27` GET settings: 404, the plugin is gone  
✅ `16:16:27` No plugin_settings row left on the relay  
✅ `16:16:27` No data directory on the agent VM: settings.json and secrets.json are gone  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `159` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `159` |

ℹ️ `16:16:27` Cleaning up test resources...  
