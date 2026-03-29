# setup-agent

> Started at `2026-03-29 09:07:04 UTC` — log level **1**


---

# Portlama E2E — Agent VM Setup


| Key | Value |
|-----|-------|
| **Host IP** | `192.168.2.15` |
| **Test Domain** | `test.portlama.local` |

🔵 `09:07:04` **[1/5] Configuring /etc/hosts...**  
✅ `09:07:04` /etc/hosts configured with test.portlama.local entries  
🔵 `09:07:04` **[2/5] Installing Node.js 20...**  
<details>
<summary>✅ <code>09:07:12</code> Install Node.js 20 via NodeSource</summary>

```
$ bash -c curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
[38;5;79m2026-03-29 12:07:04 - Installing pre-requisites[0m

WARNING: apt does not have a stable CLI interface. Use with caution in scripts.

Hit:1 http://ports.ubuntu.com/ubuntu-ports noble InRelease
Hit:2 http://ports.ubuntu.com/ubuntu-ports noble-updates InRelease
Hit:3 http://ports.ubuntu.com/ubuntu-ports noble-backports InRelease
Hit:4 http://ports.ubuntu.com/ubuntu-ports noble-security InRelease
Reading package lists...
Building dependency tree...
Reading state information...
16 packages can be upgraded. Run 'apt list --upgradable' to see them.

WARNING: apt does not have a stable CLI interface. Use with caution in scripts.

Reading package lists...
Building dependency tree...
Reading state information...
ca-certificates is already the newest version (20240203).
ca-certificates set to manually installed.
curl is already the newest version (8.5.0-2ubuntu10.8).
curl set to manually installed.
gnupg is already the newest version (2.4.4-2ubuntu17.4).
gnupg set to manually installed.
The following NEW packages will be installed:
  apt-transport-https
0 upgraded, 1 newly installed, 0 to remove and 16 not upgraded.
Need to get 3970 B of archives.
After this operation, 36.9 kB of additional disk space will be used.
Get:1 http://ports.ubuntu.com/ubuntu-ports noble-updates/universe arm64 apt-transport-https all 2.8.3 [3970 B]
debconf: unable to initialize frontend: Dialog
debconf: (Dialog frontend will not work on a dumb terminal, an emacs shell buffer, or without a controlling terminal.)
debconf: falling back to frontend: Readline
debconf: unable to initialize frontend: Readline
debconf: (This frontend requires a controlling tty.)
debconf: falling back to frontend: Teletype
dpkg-preconfigure: unable to re-open stdin: 
Fetched 3970 B in 0s (31.5 kB/s)
Selecting previously unselected package apt-transport-https.
(Reading database ... (Reading database ... 5%(Reading database ... 10%(Reading database ... 15%(Reading database ... 20%(Reading database ... 25%(Reading database ... 30%(Reading database ... 35%(Reading database ... 40%(Reading database ... 45%(Reading database ... 50%(Reading database ... 55%(Reading database ... 60%(Reading database ... 65%(Reading database ... 70%(Reading database ... 75%(Reading database ... 80%(Reading database ... 85%(Reading database ... 90%(Reading database ... 95%(Reading database ... 100%(Reading database ... 77711 files and directories currently installed.)
Preparing to unpack .../apt-transport-https_2.8.3_all.deb ...
Unpacking apt-transport-https (2.8.3) ...
Setting up apt-transport-https (2.8.3) ...
debconf: unable to initialize frontend: Dialog
debconf: (Dialog frontend will not work on a dumb terminal, an emacs shell buffer, or without a controlling terminal.)
debconf: falling back to frontend: Readline
debconf: unable to initialize frontend: Readline
debconf: (This frontend requires a controlling tty.)
debconf: falling back to frontend: Teletype

Running kernel seems to be up-to-date.

No services need to be restarted.

No containers need to be restarted.

No user sessions are running outdated binaries.

No VM guests are running outdated hypervisor (qemu) binaries on this host.

WARNING: apt does not have a stable CLI interface. Use with caution in scripts.

Hit:1 http://ports.ubuntu.com/ubuntu-ports noble InRelease
Hit:2 http://ports.ubuntu.com/ubuntu-ports noble-updates InRelease
Hit:3 http://ports.ubuntu.com/ubuntu-ports noble-backports InRelease
Get:4 https://deb.nodesource.com/node_20.x nodistro InRelease [12.1 kB]
Hit:5 http://ports.ubuntu.com/ubuntu-ports noble-security InRelease
Get:6 https://deb.nodesource.com/node_20.x nodistro/main arm64 Packages [13.6 kB]
Fetched 25.8 kB in 0s (66.7 kB/s)
Reading package lists...
Building dependency tree...
Reading state information...
16 packages can be upgraded. Run 'apt list --upgradable' to see them.
[1;34m2026-03-29 12:07:12 - Repository configured successfully.[0m
[38;5;79m2026-03-29 12:07:12 - To install Node.js, run: apt install nodejs -y[0m
[38;5;79m2026-03-29 12:07:12 - You can use N|solid Runtime as a node.js alternative[0m
[1;32m2026-03-29 12:07:12 - To install N|solid Runtime, run: apt install nsolid -y 
[0m
```
</details>

<details>
<summary>✅ <code>09:07:20</code> Install nodejs package</summary>

```
$ apt-get install -y nodejs
Reading package lists...
Building dependency tree...
Reading state information...
The following NEW packages will be installed:
  nodejs
0 upgraded, 1 newly installed, 0 to remove and 16 not upgraded.
Need to get 31.0 MB of archives.
After this operation, 197 MB of additional disk space will be used.
Get:1 https://deb.nodesource.com/node_20.x nodistro/main arm64 nodejs arm64 20.20.0-1nodesource1 [31.0 MB]
debconf: unable to initialize frontend: Dialog
debconf: (Dialog frontend will not work on a dumb terminal, an emacs shell buffer, or without a controlling terminal.)
debconf: falling back to frontend: Readline
debconf: unable to initialize frontend: Readline
debconf: (This frontend requires a controlling tty.)
debconf: falling back to frontend: Teletype
dpkg-preconfigure: unable to re-open stdin: 
Fetched 31.0 MB in 1s (24.3 MB/s)
Selecting previously unselected package nodejs.
(Reading database ... (Reading database ... 5%(Reading database ... 10%(Reading database ... 15%(Reading database ... 20%(Reading database ... 25%(Reading database ... 30%(Reading database ... 35%(Reading database ... 40%(Reading database ... 45%(Reading database ... 50%(Reading database ... 55%(Reading database ... 60%(Reading database ... 65%(Reading database ... 70%(Reading database ... 75%(Reading database ... 80%(Reading database ... 85%(Reading database ... 90%(Reading database ... 95%(Reading database ... 100%(Reading database ... 77715 files and directories currently installed.)
Preparing to unpack .../nodejs_20.20.0-1nodesource1_arm64.deb ...
Unpacking nodejs (20.20.0-1nodesource1) ...
Setting up nodejs (20.20.0-1nodesource1) ...
Processing triggers for man-db (2.12.0-4build2) ...
debconf: unable to initialize frontend: Dialog
debconf: (Dialog frontend will not work on a dumb terminal, an emacs shell buffer, or without a controlling terminal.)
debconf: falling back to frontend: Readline
debconf: unable to initialize frontend: Readline
debconf: (This frontend requires a controlling tty.)
debconf: falling back to frontend: Teletype

Running kernel seems to be up-to-date.

No services need to be restarted.

No containers need to be restarted.

No user sessions are running outdated binaries.

No VM guests are running outdated hypervisor (qemu) binaries on this host.
```
</details>

✅ `09:07:20` Node.js installed: v20.20.0  
🔵 `09:07:20` **[3/5] Installing portlama-agent from tarball...**  
<details>
<summary>✅ <code>09:07:34</code> Install portlama-agent globally</summary>

```
$ npm install -g /tmp/portlama-agent.tgz
npm warn deprecated glob@11.1.0: Old versions of glob are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update. Support for old versions may be purchased (at exorbitant rates) by contacting i@izs.me

added 121 packages in 13s

63 packages are looking for funding
  run `npm fund` for details
npm notice
npm notice New major version of npm available! 10.8.2 -> 11.12.1
npm notice Changelog: https://github.com/npm/cli/releases/tag/v11.12.1
npm notice To update run: npm install -g npm@11.12.1
npm notice
```
</details>

✅ `09:07:34` portlama-agent installed:   
🔵 `09:07:34` **[4/5] Running portlama-agent setup with enrollment token...**  
✅ `09:07:37` portlama-agent setup completed (label: e2e-agent)  
❌ `09:07:37` **systemd service portlama-chisel-e2e-agent is inactive
inactive**  
🔵 `09:07:37` **[5/5] Installing Python 3...**  
✅ `09:07:37` Python 3 already installed: Python 3.12.3  

---

# Agent VM Setup Summary


| Key | Value |
|-----|-------|
| **Host IP** | `192.168.2.15` |
| **Test Domain** | `test.portlama.local` |
| **Node.js** | `v20.20.0` |
| **portlama-agent** | `installed` |
| **systemd service** | `inactive
unknown` |
| **Python** | `Python 3.12.3` |
| **Panel reachable** | `yes (enrolled via token)` |

✅ `09:07:37` The agent VM is ready for E2E tests.  
