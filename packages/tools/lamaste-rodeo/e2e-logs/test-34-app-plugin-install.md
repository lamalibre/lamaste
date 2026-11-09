# Lamaste E2E: 34 — App plugin installed onto an agent from the panel (Three-VM)

> Started at `2026-11-09 12:53:43 UTC`


## Pre-flight

✅ `12:53:43` Onboarding is complete  
✅ `12:53:43` Agent test-agent is enrolled on the host  
✅ `12:53:43` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `12:53:43` The agent VM's lamaste-agent has the apphost command  
ℹ️ `12:53:43` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Stand-in Feria and the panel's registry credential

✅ `12:53:44` Fixture built: @lamalibre/e2e-apphost-server and its bundled agent package @lamalibre/e2e-apphost-agent 1.0.0  
✅ `12:53:52` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-server, @lamalibre/e2e-apphost-agent )  
✅ `12:53:52` The agent VM reaches it at http://10.13.37.1:4874  
✅ `12:53:53` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-09T12:53:54.050Z"})  
✅ `12:53:53` …through its own OIDC client  
✅ `12:53:54` The stand-in Feria publishes @lamalibre/e2e-apphost-agent@1.0.0 with a sha512 integrity  

## Install: the agent half is pinned and shown for approval

ℹ️ `12:53:54` sqlite3 on the agent VM before: absent  
✅ `12:53:58` Installed @lamalibre/e2e-apphost-server@1.0.0 from the stand-in Feria  
✅ `12:53:58` …an agent-hosted plugin  
✅ `12:53:58` Preview: the agent package Lamaste installs  
✅ `12:53:58` Preview: at the plugin's version  
✅ `12:53:58` Preview: the tarball integrity, pinned from the registry at install  
✅ `12:53:58` Preview: the system package it brings  
✅ `12:53:58` Preview: the service account  
✅ `12:53:58` Preview: the unit  
✅ `12:53:58` Preview: the service entry and its memory limit  
✅ `12:53:58` Its approval is pending  
✅ `12:53:58` GET /plugins/e2e-apphost/hooks shows the same agent half  

## Refused before approval and on an agent that cannot host it

✅ `12:53:58` Hosting an unapproved agent half is refused (409)  
✅ `12:53:58` …hooks_not_approved  
✅ `12:53:59` Approved with the digest the preview showed  
✅ `12:53:59` The relay holds the agent's current host facts  
✅ `12:53:59` Eligibility: test-agent cannot host it yet  
✅ `12:53:59` …the app host helper is not enabled  
✅ `12:53:59` Hosting on it is refused (409)  
✅ `12:53:59` …agent_not_eligible, with the reasons  

## The operator's step: lamaste-agent apphost enable

✅ `12:53:59` The relay signs with key 22c5e51c32485ef4886bbfabda64e315  
✅ `12:53:59` apphost enable --user root (2,"node":"22.23.4","sudoers":null,"user":"root","relays":[{"label":"e2e-agent","kid":"22c5e51c32485ef4886bbfabda64e315","agent":"test-agent","panelUrl":"https://10.13.37.1:9292","previousKid":null}]})  
✅ `12:53:59` …installed the helper, protocol 2  
✅ `12:53:59` …and no sudoers rule: the agent runs as root  
✅ `12:54:00` …and pinned the relay's key for e2e-agent, with the name the relay knows it by  
✅ `12:54:00` GET /api/agents/me/relay-keys, from the agent: the key the relay signs with  
✅ `12:54:00` apphost status: e2e-agent has that key pinned  
✅ `12:54:00` …in /etc/lamalibre/apphost/relays/e2e-agent.json, root:root 0644  
✅ `12:54:00` apphost status: the helper is installed  
✅ `12:54:00` …the one this lamaste-agent ships  
✅ `12:54:00` …on /usr/bin/node 22.23.4, what the agent halves run on  
✅ `12:54:00` /usr/local/sbin/lamaste-apphost is root:root 0755  
✅ `12:54:00` No /etc/sudoers.d/lamaste-apphost for a root agent  
✅ `12:54:26` The agent's sync reported the helper to the relay  
✅ `12:54:26` Host facts: Linux, systemd  
✅ `12:54:26` Host facts: helper protocol 2  
✅ `12:54:26` Host facts: the helper's Node.js  
✅ `12:54:26` Host facts: the relay key the helper verifies jobs with  
✅ `12:54:26` Host facts: a Debian-family distribution (ubuntu 24.04)  
✅ `12:54:26` Eligibility: test-agent can host it now  

## Refused by the push-install gates; the window opened

✅ `12:54:27` Push-install off: hosting is refused  
✅ `12:54:27` …push_install_refused (Push install is not enabled globally)  
✅ `12:54:27` Push-install on, the agent's window closed: hosting is refused  
✅ `12:54:27` …push_install_refused (Push install access not enabled for agent "test-agent")  
✅ `12:54:27` The agent's window is open, under a policy naming only @lamalibre/e2e-apphost-agent  

## Hosting: nothing more is done on the agent VM

✅ `12:54:28` Hosting on test-agent started (operation 8e1dd868-da87-4165-8881-f4aa7bfc6a4e)  
✅ `12:56:17` The hosting operation succeeded ()  
✅ `12:56:17` Step: reserve port, secret and capability  
✅ `12:56:17` Step: install the agent half  
✅ `12:56:17` Step: agent install:pre-tunnel  
✅ `12:56:17` Step: grant the tunnel and wait for the agent half  
✅ `12:56:17` Step: agent install:post-tunnel  
✅ `12:56:17` Step: activate  
✅ `12:56:17` The agent half was installed before its first hook ran  
✅ `12:56:17` The hosting is active  
✅ `12:56:17` The relay records agent half 1.0.0 on test-agent  
✅ `12:56:17` Port 21000 assigned from the internal range  
✅ `12:56:17` The push is in the push-install session log  
✅ `12:56:18` Audit: plugin.agent-half.installed, with the pinned integrity  
✅ `12:56:18` The agent's sync ran the app-install job (sync.log)  
✅ `12:56:18` …then the pre-tunnel hook job  
✅ `12:56:18` The installed service answered install:pre-tunnel (its journal)  
✅ `12:56:18` …and install:post-tunnel through the tunnel  

## On the agent VM: account, files, unit, system package

✅ `12:56:18` lamalibre-app-e2e-apphost.service is active and enabled (it starts at boot)  
✅ `12:56:18` It runs as User=lamaste-app-e2e-apphost  
✅ `12:56:18` …and its process is owned by lamaste-app-e2e-apphost  
✅ `12:56:18` The account is not root  
✅ `12:56:18` …a system account without login shell or home  
✅ `12:56:18` /opt/lamalibre/apps/e2e-apphost: root's, 0755  
✅ `12:56:18` current → 1.0.0, the version installed  
✅ `12:56:18` Every file of the code is root's and writable by root only  
✅ `12:56:18` /var/lib/lamalibre/apps/e2e-apphost: 0700, the account's  
✅ `12:56:18` …where the agent half keeps its state  
✅ `12:56:18` /etc/lamalibre/apps/e2e-apphost: 0750 root:lamaste-app-e2e-apphost  
✅ `12:56:18` /etc/lamalibre/apps/e2e-apphost/plugin-config.json: 0600, the account's  
✅ `12:56:18` …for this plugin and its port  
✅ `12:56:18` …holding the secret the agent holds (compared on the VM, never printed)  
✅ `12:56:18` The agent records the agent half it had installed  
✅ `12:56:18` sqlite3 is installed  
✅ `12:56:18` …by apt-get install --no-install-recommends during the hosting (apt history)  

## The unit: as written, and as systemd applies it

✅ `12:56:18` Unit: User=lamaste-app-e2e-apphost  
✅ `12:56:18` Unit: Group=lamaste-app-e2e-apphost  
✅ `12:56:18` Unit: Requires=lamalibre-app-e2e-apphost.socket  
✅ `12:56:18` Unit: After=lamalibre-app-e2e-apphost.socket  
✅ `12:56:18` Unit: Sockets=lamalibre-app-e2e-apphost.socket  
✅ `12:56:18` Unit: ExecStart=/usr/bin/node /opt/lamalibre/apps/e2e-apphost/current/package/dist/agentd.mjs  
✅ `12:56:18` Unit: Environment=LAMASTE_APP_CONFIG=/etc/lamalibre/apps/e2e-apphost/plugin-config.json  
✅ `12:56:18` Unit: Environment=LAMASTE_APP_DATA_DIR=/var/lib/lamalibre/apps/e2e-apphost  
✅ `12:56:18` Unit: WorkingDirectory=/var/lib/lamalibre/apps/e2e-apphost  
✅ `12:56:18` Unit: Restart=always  
✅ `12:56:18` Unit: NoNewPrivileges=yes  
✅ `12:56:18` Unit: ProtectSystem=strict  
✅ `12:56:18` Unit: ReadWritePaths=/var/lib/lamalibre/apps/e2e-apphost  
✅ `12:56:18` Unit: ProtectHome=yes  
✅ `12:56:18` Unit: PrivateTmp=yes  
✅ `12:56:18` Unit: PrivateDevices=yes  
✅ `12:56:18` Unit: ProtectKernelTunables=yes  
✅ `12:56:18` Unit: ProtectKernelModules=yes  
✅ `12:56:18` Unit: ProtectKernelLogs=yes  
✅ `12:56:18` Unit: ProtectControlGroups=yes  
✅ `12:56:18` Unit: ProtectClock=yes  
✅ `12:56:18` Unit: ProtectHostname=yes  
✅ `12:56:18` Unit: RestrictSUIDSGID=yes  
✅ `12:56:18` Unit: RestrictRealtime=yes  
✅ `12:56:18` Unit: RestrictNamespaces=yes  
✅ `12:56:18` Unit: LockPersonality=yes  
✅ `12:56:18` Unit: SystemCallArchitectures=native  
✅ `12:56:18` Unit: CapabilityBoundingSet=  
✅ `12:56:18` Unit: UMask=0077  
✅ `12:56:18` Unit: LimitCORE=0  
✅ `12:56:18` Unit: MemoryMax=256M  
✅ `12:56:18` Unit: WantedBy=multi-user.target  
✅ `12:56:18` The unit names paths, never the secret  
✅ `12:56:18` systemctl show: ProtectSystem=strict  
✅ `12:56:18` systemctl show: ProtectHome=yes  
✅ `12:56:18` systemctl show: NoNewPrivileges=yes  
✅ `12:56:18` systemctl show: PrivateTmp=yes  
✅ `12:56:18` systemctl show: PrivateDevices=yes  
✅ `12:56:18` systemctl show: RestrictSUIDSGID=yes  
✅ `12:56:18` systemctl show: LockPersonality=yes  
✅ `12:56:18` systemctl show: ReadWritePaths=/var/lib/lamalibre/apps/e2e-apphost  
✅ `12:56:18` systemctl show: MemoryMax=268435456  
✅ `12:56:18` systemctl show: CapabilityBoundingSet=  
✅ `12:56:18` systemctl show: UMask=0077  
✅ `12:56:18` systemctl show: Restart=always  
✅ `12:56:18` systemctl show: LimitCORE=0  
✅ `12:56:18` systemctl show: TriggeredBy=lamalibre-app-e2e-apphost.socket  
✅ `12:56:18` systemctl show: Requires= names lamalibre-app-e2e-apphost.socket  
✅ `12:56:18` systemctl show: After= names lamalibre-app-e2e-apphost.socket  
✅ `12:56:18` No lamalibre-app-e2e-apphost.service.d drop-in directory: the unit is all there is  

## The socket unit: systemd holds the port

✅ `12:56:18` /etc/systemd/system/lamalibre-app-e2e-apphost.socket: root:root 0644  
✅ `12:56:18` …its sections: [Unit], [Socket], [Install]  
✅ `12:56:18` …its directives: Description, ListenStream, Accept, NoDelay, Service, WantedBy — nothing else  
✅ `12:56:18` Socket unit: ListenStream=127.0.0.1:21000  
✅ `12:56:18` Socket unit: Accept=no  
✅ `12:56:18` Socket unit: NoDelay=true  
✅ `12:56:18` Socket unit: Service=lamalibre-app-e2e-apphost.service  
✅ `12:56:18` Socket unit: WantedBy=sockets.target  
✅ `12:56:19` …and no secret in it  
✅ `12:56:19` lamalibre-app-e2e-apphost.socket is active (running: its service has it) and enabled  
✅ `12:56:19` systemctl show: Listen=127.0.0.1:21000 (Stream)  
✅ `12:56:19` systemctl show: Accept=no, NoDelay=yes, Triggers=lamalibre-app-e2e-apphost.service  
✅ `12:56:19` ss: one listening socket on port 21000  
✅ `12:56:19` …on 127.0.0.1:21000  
✅ `12:56:19` …held by systemd (pid 1)…  
✅ `12:56:19` …and by the agent half (MainPID 36373), the same socket  
✅ `12:56:19` The agent half's descriptor 3 is that listening socket (inode 107000)  
✅ `12:56:19` lamaste-agent apphost status: unit active, socket active  

## Through the tunnel: the installed version answers

✅ `12:56:19` GET /api/e2e-apphost/ping reaches the service on the agent VM  
✅ `12:56:19` …the installed version, 1.0.0  
✅ `12:56:19` …running as lamaste-app-e2e-apphost  
✅ `12:56:19` …which sees the admin as its caller  
✅ `12:56:19` …listening on systemd's socket, descriptor 3, with LISTEN_* cleared from its environment  
✅ `12:56:19` The admin page's bundle comes from the agent half  
✅ `12:56:19` Sandbox: the service is lamaste-app-e2e-apphost, not root  
✅ `12:56:19` Sandbox: it writes its data directory  
✅ `12:56:19` Sandbox: no write to etc (EROFS)  
✅ `12:56:19` Sandbox: no write to code (EROFS)  
✅ `12:56:19` Sandbox: no write to appsDir (EROFS)  
✅ `12:56:19` Sandbox: no write to configDir (EROFS)  
✅ `12:56:19` Sandbox: no write to usrLocal (EROFS)  
✅ `12:56:19` Sandbox: no write to root (EACCES)  
✅ `12:56:19` Sandbox: no write to home (EACCES)  
✅ `12:56:19` Sandbox: no write to runLock (EROFS)  
✅ `12:56:19` Sandbox: no write to run (EROFS)  
✅ `12:56:19` Sandbox: no write to varCrash (EROFS)  
✅ `12:56:19` Sandbox: /run/lock, writable by every user, is read-only to it (ReadOnlyPaths=/run)  
✅ `12:56:19` Sandbox: it has a /tmp…  
✅ `12:56:19` …of its own (PrivateTmp): nothing appears in the machine's /tmp  
✅ `12:56:19` Sandbox: it has a /var/tmp…  
✅ `12:56:19` …of its own: nothing appears in the machine's /var/tmp  
✅ `12:56:19` Sandbox: its /dev/shm is an empty one it cannot write (TemporaryFileSystem)… (EACCES)  
✅ `12:56:19` …and nothing appears in the machine's /dev/shm  
✅ `12:56:19` Sandbox: no new privileges, no capabilities  
✅ `12:56:19` Sandbox: the agent's own state (its keys) is out of reach (EACCES)  
✅ `12:56:19` Sandbox: /etc/shadow is out of reach (EACCES)  
✅ `12:56:19` Sandbox: it sends UDP (dgram binds a port of its own): holding its TCP port took nothing else from it  

## Feria's record: the panel installed as itself, the agent pulled the package itself

✅ `12:56:20` The packument of @lamalibre/e2e-apphost-server was read  
✅ `12:56:20` …by the panel's own identity, ci:auth.test.lamaste.local/lamaste-server  
✅ `12:56:20` …which also pulled @lamalibre/e2e-apphost-server-1.0.0.tgz, and nobody else did  
✅ `12:56:20` No package was served to a request the stand-in Feria could not attribute  
✅ `12:56:20` The packument of @lamalibre/e2e-apphost-agent was read by the panel as itself: the pin came from the panel's own credential  
✅ `12:56:20` …and by nobody but the panel, the hosting agent and this spec's own read  
✅ `12:56:20` agent:test-agent downloaded @lamalibre/e2e-apphost-agent-1.0.0.tgz  
✅ `12:56:20` …and nobody else did: the relay pinned it from the packument alone  
✅ `12:56:20` Its token: an agent token, read scope  
✅ `12:56:20` …brokered by the panel's OIDC identity  

## Uninstall with purge leaves nothing

✅ `12:56:27` The uninstall operation succeeded ()  
✅ `12:56:27` Step: agent uninstall:pre-teardown  
✅ `12:56:27` Step: remove the tunnel  
✅ `12:56:27` Step: agent uninstall:post-teardown  
✅ `12:56:27` Step: remove the agent half  
✅ `12:56:27` Step: revoke the secret and the capability  
✅ `12:56:27` Step: remove the package  
✅ `12:56:27` The agent half went before the secret it runs with  
✅ `12:56:27` The plugin is gone from the relay  
✅ `12:56:27` Uninstalled: no hosting record (no secret)  
✅ `12:56:27` Uninstalled: no internal tunnel  
✅ `12:56:27` Uninstalled: no plugin:e2e-apphost:host on the agent's certificate  
✅ `12:56:27` Audit: plugin.agent-half.removed, purge  
✅ `12:56:27` No unit on the agent VM  
✅ `12:56:27` No socket unit  
✅ `12:56:27` No drop-in directory  
✅ `12:56:27` Nothing listens on port 21000 any more: the socket let go of it  
✅ `12:56:27` No code, config or data directory  
✅ `12:56:27` No lamaste-app-e2e-apphost account or group  
✅ `12:56:27` The agent's record no longer lists it  
✅ `12:56:28` The agent's own copy of the plugin config is gone  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `217` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `217` |

ℹ️ `12:56:28` Cleaning up test resources...  
