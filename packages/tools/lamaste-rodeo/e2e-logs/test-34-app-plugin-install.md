# Lamaste E2E: 34 — App plugin installed onto an agent from the panel (Three-VM)

> Started at `2026-11-11 09:15:07 UTC`


## Pre-flight

✅ `09:15:08` Onboarding is complete  
✅ `09:15:08` Agent test-agent is enrolled on the host  
✅ `09:15:08` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `09:15:08` The agent VM's lamaste-agent has the apphost command  
ℹ️ `09:15:08` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Stand-in Feria and the panel's registry credential

✅ `09:15:09` Fixture built: @lamalibre/e2e-apphost-server and its bundled agent package @lamalibre/e2e-apphost-agent 1.0.0  
✅ `09:15:18` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-server, @lamalibre/e2e-apphost-agent )  
✅ `09:15:18` The agent VM reaches it at http://10.13.37.1:4874  
✅ `09:15:19` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-11T09:15:19.726Z"})  
✅ `09:15:19` …through its own OIDC client  
✅ `09:15:19` The stand-in Feria publishes @lamalibre/e2e-apphost-agent@1.0.0 with a sha512 integrity  

## Install: the agent half is pinned and shown for approval

ℹ️ `09:15:20` sqlite3 on the agent VM before: absent  
✅ `09:15:24` Installed @lamalibre/e2e-apphost-server@1.0.0 from the stand-in Feria  
✅ `09:15:24` …an agent-hosted plugin  
✅ `09:15:24` Preview: the agent package Lamaste installs  
✅ `09:15:24` Preview: at the plugin's version  
✅ `09:15:24` Preview: the tarball integrity, pinned from the registry at install  
✅ `09:15:24` Preview: the system package it brings  
✅ `09:15:24` Preview: the service account  
✅ `09:15:24` Preview: the unit  
✅ `09:15:24` Preview: the service entry and its memory limit  
✅ `09:15:24` Its approval is pending  
✅ `09:15:24` GET /plugins/e2e-apphost/hooks shows the same agent half  

## Refused before approval and on an agent that cannot host it

✅ `09:15:24` Hosting an unapproved agent half is refused (409)  
✅ `09:15:24` …hooks_not_approved  
✅ `09:15:25` Approved with the digest the preview showed  
✅ `09:15:25` The relay holds the agent's current host facts  
✅ `09:15:25` Eligibility: test-agent cannot host it yet  
✅ `09:15:25` …the app host helper is not enabled  
✅ `09:15:25` Hosting on it is refused (409)  
✅ `09:15:25` …agent_not_eligible, with the reasons  

## The operator's step: lamaste-agent apphost enable

✅ `09:15:25` The relay signs with key 3001f6cdcb67d5c09ac82d8796bfd9ff  
✅ `09:15:26` apphost enable --user root (3,"node":"22.23.4","sudoers":null,"user":"root","relays":[{"label":"e2e-agent","kid":"3001f6cdcb67d5c09ac82d8796bfd9ff","agent":"test-agent","panelUrl":"https://10.13.37.1:9292","previousKid":null}]})  
✅ `09:15:26` …installed the helper, protocol 3  
✅ `09:15:26` …and no sudoers rule: the agent runs as root  
✅ `09:15:26` …and pinned the relay's key for e2e-agent, with the name the relay knows it by  
✅ `09:15:26` GET /api/agents/me/relay-keys, from the agent: the key the relay signs with  
✅ `09:15:26` apphost status: e2e-agent has that key pinned  
✅ `09:15:26` …in /etc/lamalibre/apphost/relays/e2e-agent.json, root:root 0644  
✅ `09:15:26` apphost status: the helper is installed  
✅ `09:15:26` …the one this lamaste-agent ships  
✅ `09:15:26` …on /usr/bin/node 22.23.4, what the agent halves run on  
✅ `09:15:27` /usr/local/sbin/lamaste-apphost is root:root 0755  
✅ `09:15:27` No /etc/sudoers.d/lamaste-apphost for a root agent  
✅ `09:15:50` The agent's sync reported the helper to the relay  
✅ `09:15:50` Host facts: Linux, systemd  
✅ `09:15:50` Host facts: helper protocol 3  
✅ `09:15:50` Host facts: the helper's Node.js  
✅ `09:15:50` Host facts: the relay key the helper verifies jobs with  
✅ `09:15:50` Host facts: a Debian-family distribution (ubuntu 24.04)  
✅ `09:15:50` Eligibility: test-agent can host it now  

## Refused by the push-install gates; the window opened

✅ `09:15:51` Push-install off: hosting is refused  
✅ `09:15:51` …push_install_refused (Push install is not enabled globally)  
✅ `09:15:51` Push-install on, the agent's window closed: hosting is refused  
✅ `09:15:51` …push_install_refused (Push install access not enabled for agent "test-agent")  
✅ `09:15:52` The agent's window is open, under a policy naming only @lamalibre/e2e-apphost-agent  

## Hosting: nothing more is done on the agent VM

✅ `09:15:52` Hosting on test-agent started (operation 9152832d-dd94-42e1-9778-a89da86491e3)  
✅ `09:17:41` The hosting operation succeeded ()  
✅ `09:17:41` Step: reserve port, secret and capability  
✅ `09:17:41` Step: install the agent half  
✅ `09:17:41` Step: agent install:pre-tunnel  
✅ `09:17:41` Step: grant the tunnel and wait for the agent half  
✅ `09:17:41` Step: agent install:post-tunnel  
✅ `09:17:41` Step: activate  
✅ `09:17:41` The agent half was installed before its first hook ran  
✅ `09:17:41` The hosting is active  
✅ `09:17:41` The relay records agent half 1.0.0 on test-agent  
✅ `09:17:41` Port 21000 assigned from the internal range  
✅ `09:17:42` The push is in the push-install session log  
✅ `09:17:42` Audit: plugin.agent-half.installed, with the pinned integrity  
✅ `09:17:42` The agent's sync ran the app-install job (sync.log)  
✅ `09:17:42` …then the pre-tunnel hook job  
✅ `09:17:42` The installed service answered install:pre-tunnel (its journal)  
✅ `09:17:42` …and install:post-tunnel through the tunnel  

## On the agent VM: account, files, unit, system package

✅ `09:17:42` lamalibre-app-e2e-apphost.service is active and enabled (it starts at boot)  
✅ `09:17:42` It runs as User=lamaste-app-e2e-apphost  
✅ `09:17:42` …and its process is owned by lamaste-app-e2e-apphost  
✅ `09:17:42` The account is not root  
✅ `09:17:42` …a system account without login shell or home  
✅ `09:17:42` /opt/lamalibre/apps/e2e-apphost: root's, 0755  
✅ `09:17:42` current → 1.0.0, the version installed  
✅ `09:17:42` Every file of the code is root's and writable by root only  
✅ `09:17:42` /var/lib/lamalibre/apps/e2e-apphost: 0700, the account's  
✅ `09:17:42` …where the agent half keeps its state  
✅ `09:17:42` /etc/lamalibre/apps/e2e-apphost: 0750 root:lamaste-app-e2e-apphost  
✅ `09:17:42` /etc/lamalibre/apps/e2e-apphost/plugin-config.json: 0600, the account's  
✅ `09:17:42` …for this plugin and its port  
✅ `09:17:42` …holding the secret the agent holds (compared on the VM, never printed)  
✅ `09:17:42` The agent records the agent half it had installed  
✅ `09:17:42` sqlite3 is installed  
✅ `09:17:43` …by apt-get install --no-install-recommends during the hosting (apt history)  

## The unit: as written, and as systemd applies it

✅ `09:17:43` Unit: User=lamaste-app-e2e-apphost  
✅ `09:17:43` Unit: Group=lamaste-app-e2e-apphost  
✅ `09:17:43` Unit: Requires=lamalibre-app-e2e-apphost.socket  
✅ `09:17:43` Unit: After=lamalibre-app-e2e-apphost.socket  
✅ `09:17:43` Unit: Sockets=lamalibre-app-e2e-apphost.socket  
✅ `09:17:43` Unit: ExecStart=/usr/bin/node /opt/lamalibre/apps/e2e-apphost/current/package/dist/agentd.mjs  
✅ `09:17:43` Unit: Environment=LAMASTE_APP_CONFIG=/etc/lamalibre/apps/e2e-apphost/plugin-config.json  
✅ `09:17:43` Unit: Environment=LAMASTE_APP_DATA_DIR=/var/lib/lamalibre/apps/e2e-apphost  
✅ `09:17:43` Unit: WorkingDirectory=/var/lib/lamalibre/apps/e2e-apphost  
✅ `09:17:43` Unit: Restart=always  
✅ `09:17:43` Unit: NoNewPrivileges=yes  
✅ `09:17:43` Unit: ProtectSystem=strict  
✅ `09:17:43` Unit: ReadWritePaths=/var/lib/lamalibre/apps/e2e-apphost  
✅ `09:17:43` Unit: ProtectHome=yes  
✅ `09:17:43` Unit: PrivateTmp=yes  
✅ `09:17:43` Unit: PrivateDevices=yes  
✅ `09:17:43` Unit: ProtectKernelTunables=yes  
✅ `09:17:43` Unit: ProtectKernelModules=yes  
✅ `09:17:43` Unit: ProtectKernelLogs=yes  
✅ `09:17:43` Unit: ProtectControlGroups=yes  
✅ `09:17:43` Unit: ProtectClock=yes  
✅ `09:17:43` Unit: ProtectHostname=yes  
✅ `09:17:43` Unit: RestrictSUIDSGID=yes  
✅ `09:17:43` Unit: RestrictRealtime=yes  
✅ `09:17:43` Unit: RestrictNamespaces=yes  
✅ `09:17:43` Unit: LockPersonality=yes  
✅ `09:17:43` Unit: SystemCallArchitectures=native  
✅ `09:17:43` Unit: CapabilityBoundingSet=  
✅ `09:17:43` Unit: UMask=0077  
✅ `09:17:43` Unit: LimitCORE=0  
✅ `09:17:43` Unit: MemoryMax=256M  
✅ `09:17:43` Unit: WantedBy=multi-user.target  
✅ `09:17:43` The unit names paths, never the secret  
✅ `09:17:43` systemctl show: ProtectSystem=strict  
✅ `09:17:43` systemctl show: ProtectHome=yes  
✅ `09:17:43` systemctl show: NoNewPrivileges=yes  
✅ `09:17:43` systemctl show: PrivateTmp=yes  
✅ `09:17:43` systemctl show: PrivateDevices=yes  
✅ `09:17:43` systemctl show: RestrictSUIDSGID=yes  
✅ `09:17:43` systemctl show: LockPersonality=yes  
✅ `09:17:43` systemctl show: ReadWritePaths=/var/lib/lamalibre/apps/e2e-apphost  
✅ `09:17:43` systemctl show: MemoryMax=268435456  
✅ `09:17:43` systemctl show: CapabilityBoundingSet=  
✅ `09:17:43` systemctl show: UMask=0077  
✅ `09:17:43` systemctl show: Restart=always  
✅ `09:17:43` systemctl show: LimitCORE=0  
✅ `09:17:43` systemctl show: TriggeredBy=lamalibre-app-e2e-apphost.socket  
✅ `09:17:43` systemctl show: Requires= names lamalibre-app-e2e-apphost.socket  
✅ `09:17:43` systemctl show: After= names lamalibre-app-e2e-apphost.socket  
✅ `09:17:43` No lamalibre-app-e2e-apphost.service.d drop-in directory: the unit is all there is  

## The socket unit: systemd holds the port

✅ `09:17:43` /etc/systemd/system/lamalibre-app-e2e-apphost.socket: root:root 0644  
✅ `09:17:43` …its sections: [Unit], [Socket], [Install]  
✅ `09:17:43` …its directives: Description, ListenStream, Accept, NoDelay, Service, WantedBy — nothing else  
✅ `09:17:43` Socket unit: ListenStream=127.0.0.1:21000  
✅ `09:17:43` Socket unit: Accept=no  
✅ `09:17:43` Socket unit: NoDelay=true  
✅ `09:17:43` Socket unit: Service=lamalibre-app-e2e-apphost.service  
✅ `09:17:43` Socket unit: WantedBy=sockets.target  
✅ `09:17:43` …and no secret in it  
✅ `09:17:43` lamalibre-app-e2e-apphost.socket is active (running: its service has it) and enabled  
✅ `09:17:43` systemctl show: Listen=127.0.0.1:21000 (Stream)  
✅ `09:17:43` systemctl show: Accept=no, NoDelay=yes, Triggers=lamalibre-app-e2e-apphost.service  
✅ `09:17:43` ss: one listening socket on port 21000  
✅ `09:17:43` …on 127.0.0.1:21000  
✅ `09:17:43` …held by systemd (pid 1)…  
✅ `09:17:43` …and by the agent half (MainPID 36240), the same socket  
✅ `09:17:43` The agent half's descriptor 3 is that listening socket (inode 106931)  
✅ `09:17:43` lamaste-agent apphost status: unit active, socket active  

## Through the tunnel: the installed version answers

✅ `09:17:44` GET /api/e2e-apphost/ping reaches the service on the agent VM  
✅ `09:17:44` …the installed version, 1.0.0  
✅ `09:17:44` …running as lamaste-app-e2e-apphost  
✅ `09:17:44` …which sees the admin as its caller  
✅ `09:17:44` …listening on systemd's socket, descriptor 3, with LISTEN_* cleared from its environment  
✅ `09:17:44` The admin page's bundle comes from the agent half  
✅ `09:17:44` Sandbox: the service is lamaste-app-e2e-apphost, not root  
✅ `09:17:44` Sandbox: it writes its data directory  
✅ `09:17:44` Sandbox: no write to etc (EROFS)  
✅ `09:17:44` Sandbox: no write to code (EROFS)  
✅ `09:17:44` Sandbox: no write to appsDir (EROFS)  
✅ `09:17:44` Sandbox: no write to configDir (EROFS)  
✅ `09:17:44` Sandbox: no write to usrLocal (EROFS)  
✅ `09:17:44` Sandbox: no write to root (EACCES)  
✅ `09:17:44` Sandbox: no write to home (EACCES)  
✅ `09:17:44` Sandbox: no write to runLock (EROFS)  
✅ `09:17:44` Sandbox: no write to run (EROFS)  
✅ `09:17:44` Sandbox: no write to varCrash (EROFS)  
✅ `09:17:44` Sandbox: /run/lock, writable by every user, is read-only to it (ReadOnlyPaths=/run)  
✅ `09:17:44` Sandbox: it has a /tmp…  
✅ `09:17:44` …of its own (PrivateTmp): nothing appears in the machine's /tmp  
✅ `09:17:44` Sandbox: it has a /var/tmp…  
✅ `09:17:44` …of its own: nothing appears in the machine's /var/tmp  
✅ `09:17:44` Sandbox: its /dev/shm is an empty one it cannot write (TemporaryFileSystem)… (EACCES)  
✅ `09:17:44` …and nothing appears in the machine's /dev/shm  
✅ `09:17:44` Sandbox: no new privileges, no capabilities  
✅ `09:17:44` Sandbox: the agent's own state (its keys) is out of reach (EACCES)  
✅ `09:17:44` Sandbox: /etc/shadow is out of reach (EACCES)  
✅ `09:17:44` Sandbox: it sends UDP (dgram binds a port of its own): holding its TCP port took nothing else from it  

## Feria's record: the panel installed as itself, the agent pulled the package itself

✅ `09:17:44` The packument of @lamalibre/e2e-apphost-server was read  
✅ `09:17:44` …by the panel's own identity, ci:auth.test.lamaste.local/lamaste-server  
✅ `09:17:44` …which also pulled @lamalibre/e2e-apphost-server-1.0.0.tgz, and nobody else did  
✅ `09:17:44` No package was served to a request the stand-in Feria could not attribute  
✅ `09:17:45` The packument of @lamalibre/e2e-apphost-agent was read by the panel as itself: the pin came from the panel's own credential  
✅ `09:17:45` …and by nobody but the panel, the hosting agent and this spec's own read  
✅ `09:17:45` agent:test-agent downloaded @lamalibre/e2e-apphost-agent-1.0.0.tgz  
✅ `09:17:45` …and nobody else did: the relay pinned it from the packument alone  
✅ `09:17:45` Its token: an agent token, read scope  
✅ `09:17:45` …brokered by the panel's OIDC identity  

## Uninstall with purge leaves nothing

✅ `09:17:55` The uninstall operation succeeded ()  
✅ `09:17:55` Step: agent uninstall:pre-teardown  
✅ `09:17:55` Step: remove the tunnel  
✅ `09:17:55` Step: agent uninstall:post-teardown  
✅ `09:17:55` Step: remove the agent half  
✅ `09:17:55` Step: revoke the secret and the capability  
✅ `09:17:55` Step: remove the package  
✅ `09:17:55` The agent half went before the secret it runs with  
✅ `09:17:56` The plugin is gone from the relay  
✅ `09:17:56` Uninstalled: no hosting record (no secret)  
✅ `09:17:56` Uninstalled: no internal tunnel  
✅ `09:17:56` Uninstalled: no plugin:e2e-apphost:host on the agent's certificate  
✅ `09:17:56` Audit: plugin.agent-half.removed, purge  
✅ `09:17:56` No unit on the agent VM  
✅ `09:17:56` No socket unit  
✅ `09:17:56` No drop-in directory  
✅ `09:17:56` Nothing listens on port 21000 any more: the socket let go of it  
✅ `09:17:56` No code, config or data directory  
✅ `09:17:56` No lamaste-app-e2e-apphost account or group  
✅ `09:17:56` The agent's record no longer lists it  
✅ `09:17:56` The agent's own copy of the plugin config is gone  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `217` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `217` |

ℹ️ `09:17:56` Cleaning up test resources...  
