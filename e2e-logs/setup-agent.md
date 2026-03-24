# setup-agent

> Started at `2026-03-24 08:10:10 UTC` — log level **1**


---

# Portlama E2E — Agent VM Setup


| Key | Value |
|-----|-------|
| **Host IP** | `192.168.2.206` |
| **Test Domain** | `test.portlama.local` |

🔵 `08:10:10` **[1/5] Configuring /etc/hosts...**  
✅ `08:10:10` /etc/hosts configured with test.portlama.local entries  
🔵 `08:10:10` **[2/5] Installing Chisel...**  
ℹ️ `08:10:11` Downloading Chisel v1.11.5...  
<details>
<summary>✅ <code>08:10:11</code> Download Chisel v1.11.5</summary>

```
$ curl -sL -o /tmp/chisel-Pf7oao.gz https://github.com/jpillora/chisel/releases/download/v1.11.5/chisel_1.11.5_linux_arm64.gz

```
</details>

<details>
<summary>✅ <code>08:10:11</code> Extract Chisel archive</summary>

```
$ gunzip -f /tmp/chisel-Pf7oao.gz

```
</details>

✅ `08:10:11` Chisel installed: 1.11.5  
🔵 `08:10:11` **[3/5] Setting up agent P12 certificate...**  
✅ `08:10:11` Agent P12 installed at ~/.portlama/client.p12  
✅ `08:10:11` PEM files extracted to ~/.portlama/  
🔵 `08:10:11` **[4/5] Verifying panel connectivity...**  
✅ `08:10:11` Panel is reachable via agent P12 certificate  
✅ `08:10:11` Panel is reachable via domain: panel.test.portlama.local  
🔵 `08:10:11` **[5/5] Installing Python 3...**  
✅ `08:10:11` Python 3 already installed: Python 3.12.3  

---

# Agent VM Setup Summary


| Key | Value |
|-----|-------|
| **Host IP** | `192.168.2.206` |
| **Test Domain** | `test.portlama.local` |
| **Chisel** | `1.11.5` |
| **Python** | `Python 3.12.3` |
| **Agent P12** | `~/.portlama/client.p12` |
| **Agent PEM Cert** | `~/.portlama/client.crt` |
| **Agent PEM Key** | `~/.portlama/client.key` |
| **Panel reachable** | `yes` |

✅ `08:10:11` The agent VM is ready for E2E tests.  
