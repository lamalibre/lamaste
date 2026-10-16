//! How the desktop app verifies the panels it talks to.
//!
//! A panel is reached at a host name — its domain, `https://panel.<domain>`,
//! with a publicly trusted (Let's Encrypt) certificate, which curl verifies
//! the normal way — or at its IP address, `https://<ip>:9292`: nginx's IP
//! vhost, whose certificate create-lamaste made self-signed for the server.
//! No CA vouches for that one, so the app pins its public key: the base64
//! SHA-256 of its SubjectPublicKeyInfo, curl's `--pinnedpubkey sha256//…`
//! form, the same pin agents keep (`panelServerPubkeySha256`). It comes from
//! the server itself where the app set the server up (cloud provisioning
//! reads the certificate over the SSH session it installs with; a local
//! install gets it from the installer), and otherwise from the first
//! connection (trust on first use, `fetch_pin`). It is stored with the
//! server, shown on its card, and only an explicit re-pin replaces it.
//!
//! curl is given the pin and `-k`: curl cannot chain-verify a self-signed
//! certificate, so `-k` waives the CA and host-name checks, which have
//! nothing to check here — the pin is still enforced, and a server with
//! another key fails before curl sends a byte of the request (no body, no
//! 2FA cookie). Nothing falls back to `-k` without a pin: an IP panel
//! without one is refused (`tls_args`), except for the reachability probe of
//! a panel not registered yet, which sends nothing (`probe_args`).

use std::io::Write;
use std::net::{IpAddr, SocketAddr, TcpStream};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine as _;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::CryptoProvider;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, SignatureScheme};
use sha2::{Digest, Sha256};

/// How long fetching a panel's key may take (connect, then the handshake).
const FETCH_TIMEOUT: Duration = Duration::from_secs(10);

/// What a panel URL's host is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PanelHost {
    /// A host name: the certificate is verified against the system's CAs.
    Name,
    /// An IP address: the panel's self-signed certificate, verified by pin.
    Ip(IpAddr),
}

/// The host of an `https://` panel URL, and its port.
pub(crate) fn panel_host(url: &str) -> Result<(PanelHost, u16), String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| format!("Invalid panel URL: {}", url))?;
    if parsed.scheme() != "https" {
        return Err("Panel URL must use HTTPS scheme".to_string());
    }
    let port = parsed.port_or_known_default().unwrap_or(443);
    // The parser normalises an address (`0x7f.1` is `127.0.0.1`) and keeps
    // an IPv6 one in brackets.
    let host = parsed
        .host_str()
        .filter(|h| !h.is_empty())
        .ok_or("Panel URL has no hostname")?;
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    Ok(match bare.parse::<IpAddr>() {
        Ok(ip) => (PanelHost::Ip(ip), port),
        Err(_) => (PanelHost::Name, port),
    })
}

/// Whether a panel at `url` is verified by a pinned key (an IP address)
/// rather than by its CA.
pub(crate) fn needs_pin(url: &str) -> Result<bool, String> {
    Ok(matches!(panel_host(url)?.0, PanelHost::Ip(_)))
}

/// A pin is the base64 (standard alphabet, padded) SHA-256 of a public key.
pub(crate) fn validate_pin(pin: &str) -> Result<(), String> {
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(pin)
        .map_err(|_| "A panel key pin must be base64".to_string())?;
    if decoded.len() != 32 || pin.len() != 44 {
        return Err("A panel key pin must be a base64 SHA-256 digest".to_string());
    }
    Ok(())
}

/// How a pin is shown to the user — curl's form, as `lamaste-agent` and
/// `lamaste-server panel-pin` print it.
pub(crate) fn display_pin(pin: &str) -> String {
    format!("sha256//{}", pin)
}

/// curl's arguments verifying the panel at `url`: none for a host name (the
/// system's CAs and the name check), the pin for an IP address. An IP
/// panel without a pin is refused — never `-k` alone.
pub(crate) fn tls_args(url: &str, pin: Option<&str>) -> Result<Vec<String>, String> {
    match panel_host(url)?.0 {
        PanelHost::Name => Ok(Vec::new()),
        PanelHost::Ip(_) => {
            let pin = pin.ok_or_else(|| {
                format!(
                    "No TLS key is pinned for the panel at {}, so it cannot be verified",
                    url
                )
            })?;
            validate_pin(pin)?;
            Ok(vec![
                // The pin replaces the CA check a self-signed certificate
                // cannot pass; curl enforces it with -k too.
                "-k".to_string(),
                "--pinnedpubkey".to_string(),
                display_pin(pin),
            ])
        }
    }
}

/// curl's arguments for the reachability probe of a panel the app has not
/// registered yet (no pin exists): `GET /api/health` with no client
/// certificate, cookie or body, whose answer is only shown as "reachable".
/// An IP panel's certificate is not verified for it. Anything that carries
/// a credential uses `tls_args`.
pub(crate) fn probe_args(url: &str) -> Result<Vec<String>, String> {
    match panel_host(url)?.0 {
        PanelHost::Name => Ok(Vec::new()),
        PanelHost::Ip(_) => Ok(vec!["-k".to_string()]),
    }
}

/// The error for a panel request curl could not complete: a different key
/// than the pinned one, or an untrusted certificate, said in the app's
/// terms; anything else as curl reported it.
pub(crate) fn curl_error(what: &str, url: &str, output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stderr = stderr.trim();
    match output.status.code() {
        // CURLE_SSL_PINNEDPUBKEYNOTMATCH
        Some(90) => format!(
            "{}: the panel at {} presented a different TLS key than the one pinned for this \
             server, so nothing was sent. If the server was reinstalled or its certificate \
             replaced, re-pin its key under Servers; otherwise something is intercepting the \
             connection.",
            what, url
        ),
        // CURLE_PEER_FAILED_VERIFICATION
        Some(60) if matches!(panel_host(url).map(|h| h.0), Ok(PanelHost::Name)) => format!(
            "{}: the certificate of {} is not trusted by this machine ({}). A panel's domain \
             uses a publicly trusted certificate; for its IP address use https://<ip>:9292.",
            what, url, stderr
        ),
        _ => format!("{}: {}", what, stderr),
    }
}

/// Records the certificate a server presents, and accepts it only once the
/// server proves it holds the certificate's key (its handshake signature,
/// checked with the provider's algorithms) — trust on first use.
#[derive(Debug)]
struct CaptureLeaf {
    provider: Arc<CryptoProvider>,
    leaf: Mutex<Option<Vec<u8>>>,
}

impl ServerCertVerifier for CaptureLeaf {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        *self.leaf.lock().unwrap_or_else(|e| e.into_inner()) = Some(end_entity.to_vec());
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

/// The pin of a DER certificate: base64 SHA-256 of its SubjectPublicKeyInfo.
pub(crate) fn pin_of_certificate(der: &[u8]) -> Result<String, String> {
    let cert = CertificateDer::from(der);
    let parsed = rustls::server::ParsedCertificate::try_from(&cert)
        .map_err(|e| format!("The panel's certificate could not be read: {}", e))?;
    let spki = parsed.subject_public_key_info();
    Ok(base64::engine::general_purpose::STANDARD.encode(Sha256::digest(spki.as_ref())))
}

/// The pin of the first certificate in a PEM file.
pub(crate) fn pin_of_pem(pem: &[u8]) -> Result<String, String> {
    let der = rustls_pemfile::certs(&mut &pem[..])
        .next()
        .ok_or("No certificate in the panel's certificate file")?
        .map_err(|e| format!("The panel's certificate file could not be read: {}", e))?;
    pin_of_certificate(der.as_ref())
}

/// Connect to the IP panel at `url` and return the pin of the certificate it
/// presents, without sending it anything but the TLS handshake (no client
/// certificate, no request). This is the trust-on-first-use step: whatever
/// answers now is what later connections must match.
pub(crate) fn fetch_pin(url: &str) -> Result<String, String> {
    let (host, port) = panel_host(url)?;
    let PanelHost::Ip(ip) = host else {
        return Err(format!(
            "{} is verified by its certificate authority; there is no key to pin",
            url
        ));
    };
    let unreachable = |e: &dyn std::fmt::Display| {
        format!("Could not reach the panel at {} to read its TLS key: {}", url, e)
    };

    let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
    let verifier = Arc::new(CaptureLeaf {
        provider: provider.clone(),
        leaf: Mutex::new(None),
    });
    let config = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| unreachable(&e))?
        .dangerous()
        .with_custom_certificate_verifier(verifier.clone())
        .with_no_client_auth();
    let mut conn = rustls::ClientConnection::new(Arc::new(config), ServerName::from(ip))
        .map_err(|e| unreachable(&e))?;

    let mut sock = TcpStream::connect_timeout(&SocketAddr::new(ip, port), FETCH_TIMEOUT)
        .map_err(|e| unreachable(&e))?;
    sock.set_read_timeout(Some(FETCH_TIMEOUT))
        .map_err(|e| unreachable(&e))?;
    sock.set_write_timeout(Some(FETCH_TIMEOUT))
        .map_err(|e| unreachable(&e))?;
    while conn.is_handshaking() {
        conn.complete_io(&mut sock).map_err(|e| unreachable(&e))?;
    }
    // Only a completed handshake counts: the server proved it holds the key.
    conn.send_close_notify();
    let _ = conn.write_tls(&mut sock);
    let _ = sock.flush();

    let leaf = verifier
        .leaf
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
        .ok_or_else(|| format!("The panel at {} presented no certificate", url))?;
    pin_of_certificate(&leaf)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::Read;
    use std::process::Command;

    const PIN: &str = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";

    #[test]
    fn hosts_are_names_or_ip_addresses() {
        assert_eq!(
            panel_host("https://panel.example.com").unwrap(),
            (PanelHost::Name, 443)
        );
        assert_eq!(
            panel_host("https://203.0.113.7:9292").unwrap(),
            (PanelHost::Ip("203.0.113.7".parse().unwrap()), 9292)
        );
        assert_eq!(
            panel_host("https://[2001:db8::1]:9292/").unwrap(),
            (PanelHost::Ip("2001:db8::1".parse().unwrap()), 9292)
        );
        assert!(panel_host("http://203.0.113.7:9292").is_err());
        assert!(panel_host("not a url").is_err());
        assert!(needs_pin("https://203.0.113.7:9292").unwrap());
        assert!(!needs_pin("https://panel.example.com").unwrap());
    }

    #[test]
    fn a_name_is_verified_by_its_ca_and_an_ip_by_its_pin() {
        assert!(tls_args("https://panel.example.com", None).unwrap().is_empty());
        // A pin stored for a domain panel is not used: its certificate
        // renews with a new key, and the CA check covers it.
        assert!(tls_args("https://panel.example.com", Some(PIN)).unwrap().is_empty());
        assert_eq!(
            tls_args("https://203.0.113.7:9292", Some(PIN)).unwrap(),
            vec![
                "-k".to_string(),
                "--pinnedpubkey".to_string(),
                format!("sha256//{}", PIN)
            ]
        );
    }

    #[test]
    fn an_ip_panel_without_a_pin_is_refused_never_insecure() {
        let err = tls_args("https://203.0.113.7:9292", None).unwrap_err();
        assert!(err.contains("No TLS key is pinned"), "{}", err);
        for bad in ["", "abc", "sha256//47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=", "AAAA"] {
            assert!(tls_args("https://203.0.113.7:9292", Some(bad)).is_err(), "{}", bad);
        }
        assert!(validate_pin(PIN).is_ok());
        // Only the unregistered-panel probe goes without, for an IP.
        assert_eq!(probe_args("https://203.0.113.7:9292").unwrap(), vec!["-k"]);
        assert!(probe_args("https://panel.example.com").unwrap().is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn a_key_mismatch_is_explained() {
        use std::os::unix::process::ExitStatusExt;
        let output = |code: i32, stderr: &str| std::process::Output {
            status: std::process::ExitStatus::from_raw(code << 8),
            stdout: Vec::new(),
            stderr: stderr.as_bytes().to_vec(),
        };
        let mismatch = curl_error(
            "Request failed",
            "https://203.0.113.7:9292",
            &output(90, "curl: (90) SSL: public key does not match pinned public key"),
        );
        assert!(mismatch.starts_with("Request failed: the panel at https://203.0.113.7:9292 presented a different TLS key"), "{}", mismatch);
        assert!(mismatch.contains("re-pin"), "{}", mismatch);
        let untrusted = curl_error(
            "Request failed",
            "https://panel.example.com",
            &output(60, "curl: (60) SSL certificate problem: self signed certificate"),
        );
        assert!(untrusted.contains("is not trusted by this machine"), "{}", untrusted);
        assert_eq!(
            curl_error("Request failed", "https://203.0.113.7:9292", &output(7, "curl: (7) Failed to connect\n")),
            "Request failed: curl: (7) Failed to connect"
        );
    }

    // -----------------------------------------------------------------
    // Against a real TLS server
    // -----------------------------------------------------------------

    /// A self-signed certificate and key (PEM files), made with `openssl`.
    pub(crate) fn self_signed(dir: &std::path::Path, name: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let key = dir.join(format!("{}.key", name));
        let cert = dir.join(format!("{}.pem", name));
        let status = Command::new("openssl")
            .args(["req", "-x509", "-nodes", "-days", "2", "-newkey", "rsa:2048", "-keyout"])
            .arg(&key)
            .arg("-out")
            .arg(&cert)
            .args(["-subj", "/CN=127.0.0.1/O=Lamaste", "-addext", "subjectAltName=IP:127.0.0.1"])
            .output()
            .expect("openssl runs");
        assert!(status.status.success(), "{}", String::from_utf8_lossy(&status.stderr));
        (cert, key)
    }

    /// The pin of a PEM certificate as openssl computes it — independent of
    /// the code under test.
    pub(crate) fn openssl_pin(cert: &std::path::Path) -> String {
        let out = Command::new("sh")
            .arg("-c")
            .arg(
                "openssl x509 -pubkey -noout -in \"$1\" | openssl pkey -pubin -outform der \
                 | openssl dgst -sha256 -binary | openssl base64 -A",
            )
            .arg("sh")
            .arg(cert)
            .output()
            .expect("openssl runs");
        assert!(out.status.success());
        String::from_utf8(out.stdout).unwrap().trim().to_string()
    }

    /// A TLS server on loopback answering each request with `{"ok":true}`;
    /// the handle yields the number of HTTP requests that reached it.
    fn tls_server(
        cert: &std::path::Path,
        key: &std::path::Path,
        connections: usize,
    ) -> (String, std::thread::JoinHandle<usize>) {
        let certs: Vec<CertificateDer<'static>> = rustls_pemfile::certs(&mut std::io::BufReader::new(
            std::fs::File::open(cert).unwrap(),
        ))
        .collect::<Result<_, _>>()
        .unwrap();
        let key = rustls_pemfile::private_key(&mut std::io::BufReader::new(
            std::fs::File::open(key).unwrap(),
        ))
        .unwrap()
        .unwrap();
        let config = Arc::new(
            rustls::ServerConfig::builder_with_provider(Arc::new(
                rustls::crypto::aws_lc_rs::default_provider(),
            ))
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(certs, key)
            .unwrap(),
        );
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("https://{}", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            let mut requests = 0;
            for _ in 0..connections {
                let (mut sock, _) = listener.accept().unwrap();
                sock.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
                let mut conn = rustls::ServerConnection::new(config.clone()).unwrap();
                let mut tls = rustls::Stream::new(&mut conn, &mut sock);
                let mut buf = [0u8; 4096];
                match tls.read(&mut buf) {
                    Ok(n) if n > 0 => {
                        requests += 1;
                        let _ = tls.write_all(
                            b"HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{\"ok\":true}",
                        );
                        let _ = tls.flush();
                    }
                    _ => {}
                }
            }
            requests
        });
        (url, handle)
    }

    /// A TLS server on loopback (certificate `cert`, key `key`) that reads one
    /// whole request — head and `Content-Length` body — and answers it with
    /// `response`; returns its base URL, and the handle yields the request's
    /// head and body.
    pub(crate) fn tls_one_request_server(
        cert: &std::path::Path,
        key: &std::path::Path,
        response: &'static str,
    ) -> (String, std::thread::JoinHandle<(String, String)>) {
        let certs: Vec<CertificateDer<'static>> = rustls_pemfile::certs(&mut std::io::BufReader::new(
            std::fs::File::open(cert).unwrap(),
        ))
        .collect::<Result<_, _>>()
        .unwrap();
        let key = rustls_pemfile::private_key(&mut std::io::BufReader::new(
            std::fs::File::open(key).unwrap(),
        ))
        .unwrap()
        .unwrap();
        let config = Arc::new(
            rustls::ServerConfig::builder_with_provider(Arc::new(
                rustls::crypto::aws_lc_rs::default_provider(),
            ))
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(certs, key)
            .unwrap(),
        );
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("https://{}", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            sock.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
            let mut conn = rustls::ServerConnection::new(config).unwrap();
            let mut tls = rustls::Stream::new(&mut conn, &mut sock);
            let mut received = Vec::new();
            let mut buf = [0u8; 4096];
            // The head first, then as much body as it announces.
            let head_end = loop {
                let n = tls.read(&mut buf).unwrap();
                assert!(n > 0, "the request ended before its head did");
                received.extend_from_slice(&buf[..n]);
                if let Some(at) = received.windows(4).position(|w| w == b"\r\n\r\n") {
                    break at + 4;
                }
            };
            let head = String::from_utf8_lossy(&received[..head_end]).to_string();
            let length = head
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    if name.eq_ignore_ascii_case("content-length") {
                        value.trim().parse::<usize>().ok()
                    } else {
                        None
                    }
                })
                .unwrap_or(0);
            while received.len() < head_end + length {
                let n = tls.read(&mut buf).unwrap();
                assert!(n > 0, "the request ended before its body did");
                received.extend_from_slice(&buf[..n]);
            }
            let body = String::from_utf8_lossy(&received[head_end..head_end + length]).to_string();
            tls.write_all(response.as_bytes()).unwrap();
            tls.flush().unwrap();
            (head, body)
        });
        (url, handle)
    }

    pub(crate) fn temp_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "lamaste-desktop-tls-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir(&dir).unwrap();
        dir
    }

    #[test]
    fn a_pem_certificate_has_the_pin_openssl_computes() {
        let dir = temp_dir();
        let (cert, _) = self_signed(&dir, "panel");
        assert_eq!(
            pin_of_pem(&std::fs::read(&cert).unwrap()).unwrap(),
            openssl_pin(&cert)
        );
        assert!(pin_of_pem(b"not a certificate").is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn first_use_reads_the_key_the_panel_proves_it_holds() {
        let dir = temp_dir();
        let (cert, key) = self_signed(&dir, "panel");
        let (url, server) = tls_server(&cert, &key, 1);
        let pin = fetch_pin(&url).unwrap();
        assert_eq!(pin, openssl_pin(&cert), "the pin is curl's sha256// form");
        assert_eq!(server.join().unwrap(), 0, "fetching the key sends no request");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn curl_reaches_the_pinned_panel_and_sends_nothing_to_another_key() {
        let dir = temp_dir();
        let (cert, key) = self_signed(&dir, "panel");
        let (other_cert, _) = self_signed(&dir, "other");
        let pin = openssl_pin(&cert);
        let (url, server) = tls_server(&cert, &key, 2);

        let mut args = vec!["-s".to_string(), "--max-time".to_string(), "10".to_string()];
        args.extend(tls_args(&url, Some(&pin)).unwrap());
        args.push(format!("{}/api/health", url));
        let ok = Command::new("curl").args(&args).output().unwrap();
        assert!(ok.status.success(), "{}", String::from_utf8_lossy(&ok.stderr));
        assert_eq!(String::from_utf8_lossy(&ok.stdout), "{\"ok\":true}");

        let other_pin = openssl_pin(&other_cert);
        let mut args = vec!["-s".to_string(), "--max-time".to_string(), "10".to_string()];
        args.extend(tls_args(&url, Some(&other_pin)).unwrap());
        args.push(format!("{}/api/health", url));
        let refused = Command::new("curl").args(&args).output().unwrap();
        assert_eq!(refused.status.code(), Some(90));
        let message = curl_error("Request failed", &url, &refused);
        assert!(message.contains("presented a different TLS key"), "{}", message);

        assert_eq!(server.join().unwrap(), 1, "only the pinned connection made a request");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
