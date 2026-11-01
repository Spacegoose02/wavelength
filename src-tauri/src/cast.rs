//! Cast: play on speakers and TVs on the home network, from the desktop and Android apps (src/lib/cast.ts).
//!
//! - **Chromecast / Google Cast** (Chromecast, Google/Nest speakers and displays, Android TVs, many soundbars):
//!   found by mDNS (`_googlecast._tcp`), driven over the Cast v2 protocol (`castv2` below) with Google's Default
//!   Media Receiver, which plays a stream URL itself.
//! - **DLNA / UPnP renderers** (many AV receivers, smart TVs, Sonos, Bluesound, Kodi, …): found by SSDP, driven
//!   with AVTransport SOAP calls (SetAVTransportURI, Play, Pause, Seek, GetPositionInfo) and RenderingControl
//!   for the volume.
//!
//! Either way the speaker fetches the song from the same URL the app would play, so it must be one the speaker
//! can reach (a LAN address or a public one, not `localhost`), and a downloaded file can't be cast.

use std::collections::HashMap;
use std::net::UdpSocket;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri_plugin_http::reqwest;

const DEFAULT_DESTINATION: &str = "receiver-0";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CastTarget {
    /// "chromecast" or "dlna"
    pub kind: String,
    pub id: String,
    pub name: String,
    /// Chromecast: host and port
    pub host: Option<String>,
    pub port: Option<u16>,
    /// DLNA: AVTransport and RenderingControl control URLs
    pub control: Option<String>,
    pub rendering: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CastMeta {
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub cover: Option<String>,
    pub content_type: Option<String>,
    pub duration: Option<f64>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CastStatus {
    /// "playing", "paused", "buffering", "idle", "ended", "error"
    pub state: String,
    pub position: f64,
    pub duration: f64,
    pub volume: Option<f64>,
}

// ---------------------------------------------------------------- discovery

fn chromecasts(wait: Duration) -> Vec<CastTarget> {
    let Ok(mdns) = mdns_sd::ServiceDaemon::new() else { return vec![] };
    let Ok(rx) = mdns.browse("_googlecast._tcp.local.") else { return vec![] };
    let end = Instant::now() + wait;
    let mut out: HashMap<String, CastTarget> = HashMap::new();
    while let Some(left) = end.checked_duration_since(Instant::now()) {
        match rx.recv_timeout(left) {
            Ok(mdns_sd::ServiceEvent::ServiceResolved(info)) => {
                let Some(addr) = info.get_addresses_v4().into_iter().next().map(|a| a.to_string()) else { continue };
                let id = info.get_property_val_str("id").unwrap_or(info.get_fullname()).to_string();
                let name = info.get_property_val_str("fn").unwrap_or("Chromecast").to_string();
                out.insert(id.clone(), CastTarget { kind: "chromecast".into(), id, name, host: Some(addr), port: Some(info.get_port()), control: None, rendering: None });
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }
    let _ = mdns.shutdown();
    out.into_values().collect()
}

/// SSDP M-SEARCH for media renderers: the LOCATION of each one's description.
fn ssdp(wait: Duration) -> Vec<String> {
    let Ok(sock) = UdpSocket::bind("0.0.0.0:0") else { return vec![] };
    let _ = sock.set_read_timeout(Some(Duration::from_millis(250)));
    let msg = "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n";
    for _ in 0..2 {
        let _ = sock.send_to(msg.as_bytes(), "239.255.255.250:1900");
    }
    let end = Instant::now() + wait;
    let mut found = vec![];
    let mut buf = [0u8; 4096];
    while Instant::now() < end {
        if let Ok((n, _)) = sock.recv_from(&mut buf) {
            let text = String::from_utf8_lossy(&buf[..n]);
            for line in text.lines() {
                if let Some((k, v)) = line.split_once(':') {
                    if k.trim().eq_ignore_ascii_case("location") {
                        let v = v.trim().to_string();
                        if !found.contains(&v) {
                            found.push(v);
                        }
                    }
                }
            }
        }
    }
    found
}

/// The text inside the first `<tag>…</tag>` (any namespace prefix) after `from`.
fn tag<'a>(xml: &'a str, name: &str, from: usize) -> Option<(&'a str, usize)> {
    let mut i = from;
    while let Some(p) = xml[i..].find('<') {
        let start = i + p + 1;
        let end = start + xml[start..].find('>')?;
        let head = &xml[start..end];
        let bare = head.split_whitespace().next().unwrap_or("");
        let bare = bare.rsplit(':').next().unwrap_or(bare);
        if bare == name && !head.ends_with('/') {
            let body = end + 1;
            let close = body + xml[body..].find("</")?;
            return Some((xml[body..close].trim(), close));
        }
        i = end;
    }
    None
}

fn unescape(s: &str) -> String {
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

/// Join a control path from a device description onto its base URL.
fn join_url(base: &str, path: &str) -> String {
    if path.starts_with("http://") || path.starts_with("https://") {
        return path.to_string();
    }
    let origin = match base.find("://").and_then(|i| base[i + 3..].find('/').map(|j| i + 3 + j)) {
        Some(end) => &base[..end],
        None => base,
    };
    if path.starts_with('/') { format!("{origin}{path}") } else { format!("{origin}/{path}") }
}

/// A renderer's name and control URLs, from its description XML.
pub fn parse_description(location: &str, xml: &str) -> Option<CastTarget> {
    let name = tag(xml, "friendlyName", 0).map(|(v, _)| unescape(v)).unwrap_or_else(|| "Speaker".into());
    let udn = tag(xml, "UDN", 0).map(|(v, _)| v.to_string()).unwrap_or_else(|| location.to_string());
    let base = tag(xml, "URLBase", 0).map(|(v, _)| v.to_string()).unwrap_or_else(|| location.to_string());
    let mut control = None;
    let mut rendering = None;
    let mut at = 0;
    while let Some((ty, after)) = tag(xml, "serviceType", at) {
        at = after;
        let url = tag(xml, "controlURL", after).map(|(v, _)| join_url(&base, v));
        if ty.contains(":AVTransport:") && control.is_none() {
            control = url;
        } else if ty.contains(":RenderingControl:") && rendering.is_none() {
            rendering = url;
        }
    }
    Some(CastTarget { kind: "dlna".into(), id: udn, name, host: None, port: None, control: Some(control?), rendering })
}

async fn renderers(wait: Duration) -> Vec<CastTarget> {
    let locations = tauri::async_runtime::spawn_blocking(move || ssdp(wait)).await.unwrap_or_default();
    let client = reqwest::Client::builder().timeout(Duration::from_secs(3)).build().unwrap();
    let mut out: Vec<CastTarget> = vec![];
    for loc in locations {
        let Ok(r) = client.get(&loc).send().await else { continue };
        let Ok(xml) = r.text().await else { continue };
        if let Some(t) = parse_description(&loc, &xml) {
            if !out.iter().any(|x| x.id == t.id) {
                out.push(t);
            }
        }
    }
    out
}

/// Look for speakers for `seconds` (2–10).
#[tauri::command]
pub async fn cast_discover(seconds: Option<u64>) -> Result<Vec<CastTarget>, String> {
    let wait = Duration::from_secs(seconds.unwrap_or(4).clamp(2, 10));
    let cc = tauri::async_runtime::spawn_blocking(move || chromecasts(wait));
    let mut list = renderers(wait).await;
    // Chromecast speakers often answer SSDP too; keep the Cast entry, which works better
    let mut cc = cc.await.unwrap_or_default();
    list.retain(|d| !cc.iter().any(|c| c.name == d.name));
    cc.append(&mut list);
    cc.sort_by_key(|a| a.name.to_lowercase());
    Ok(cc)
}

// ---------------------------------------------------------------- Chromecast

/// A tiny Cast v2 client: TLS to port 8009, messages framed as a 4-byte length and a protobuf `CastMessage`
/// carrying a JSON payload. Only what playing a stream needs.
mod castv2 {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::sync::Arc;
    use std::time::Duration;

    use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
    use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
    use rustls::{ClientConfig, ClientConnection, DigitallySignedStruct, SignatureScheme, StreamOwned};
    use serde_json::{json, Value};

    pub const NS_CONNECTION: &str = "urn:x-cast:com.google.cast.tp.connection";
    pub const NS_HEARTBEAT: &str = "urn:x-cast:com.google.cast.tp.heartbeat";
    pub const NS_RECEIVER: &str = "urn:x-cast:com.google.cast.receiver";
    pub const NS_MEDIA: &str = "urn:x-cast:com.google.cast.media";
    const SENDER: &str = "sender-0";

    /// Cast devices use self-signed certificates: every sender accepts them (the network is the trust boundary).
    #[derive(Debug)]
    struct AnyCert(Arc<rustls::crypto::CryptoProvider>);
    impl ServerCertVerifier for AnyCert {
        fn verify_server_cert(&self, _: &CertificateDer<'_>, _: &[CertificateDer<'_>], _: &ServerName<'_>, _: &[u8], _: UnixTime) -> Result<ServerCertVerified, rustls::Error> {
            Ok(ServerCertVerified::assertion())
        }
        fn verify_tls12_signature(&self, m: &[u8], c: &CertificateDer<'_>, d: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
            rustls::crypto::verify_tls12_signature(m, c, d, &self.0.signature_verification_algorithms)
        }
        fn verify_tls13_signature(&self, m: &[u8], c: &CertificateDer<'_>, d: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
            rustls::crypto::verify_tls13_signature(m, c, d, &self.0.signature_verification_algorithms)
        }
        fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
            self.0.signature_verification_algorithms.supported_schemes()
        }
    }

    fn varint(mut v: u64, out: &mut Vec<u8>) {
        loop {
            let b = (v & 0x7f) as u8;
            v >>= 7;
            if v == 0 {
                out.push(b);
                break;
            }
            out.push(b | 0x80);
        }
    }

    /// protobuf CastMessage: 1 protocol_version=0, 2 source_id, 3 destination_id, 4 namespace, 5 payload_type=0 (string), 6 payload_utf8
    pub fn encode(src: &str, dst: &str, ns: &str, payload: &str) -> Vec<u8> {
        let mut m = vec![0x08, 0x00];
        for (field, s) in [(2u8, src), (3, dst), (4, ns)] {
            m.push(field << 3 | 2);
            varint(s.len() as u64, &mut m);
            m.extend_from_slice(s.as_bytes());
        }
        m.extend_from_slice(&[0x28, 0x00, 0x32]);
        varint(payload.len() as u64, &mut m);
        m.extend_from_slice(payload.as_bytes());
        let mut framed = (m.len() as u32).to_be_bytes().to_vec();
        framed.extend(m);
        framed
    }

    /// (namespace, payload) from a CastMessage body.
    pub fn decode(b: &[u8]) -> Option<(String, String)> {
        let (mut i, mut ns, mut payload) = (0usize, String::new(), String::new());
        let read_varint = |b: &[u8], i: &mut usize| -> Option<u64> {
            let (mut v, mut shift) = (0u64, 0);
            loop {
                let x = *b.get(*i)?;
                *i += 1;
                v |= ((x & 0x7f) as u64) << shift;
                if x & 0x80 == 0 {
                    return Some(v);
                }
                shift += 7;
            }
        };
        while i < b.len() {
            let key = read_varint(b, &mut i)?;
            let (field, wire) = (key >> 3, key & 7);
            match wire {
                0 => {
                    read_varint(b, &mut i)?;
                }
                2 => {
                    let n = read_varint(b, &mut i)? as usize;
                    let s = b.get(i..i + n)?;
                    i += n;
                    match field {
                        4 => ns = String::from_utf8_lossy(s).into(),
                        6 => payload = String::from_utf8_lossy(s).into(),
                        _ => {}
                    }
                }
                _ => return None,
            }
        }
        Some((ns, payload))
    }

    pub struct Client {
        tls: StreamOwned<ClientConnection, TcpStream>,
        next: u64,
    }

    impl Client {
        pub fn connect(host: &str, port: u16) -> Result<Client, String> {
            let provider = Arc::new(rustls::crypto::ring::default_provider());
            let config = ClientConfig::builder_with_provider(provider.clone())
                .with_safe_default_protocol_versions()
                .map_err(|e| e.to_string())?
                .dangerous()
                .with_custom_certificate_verifier(Arc::new(AnyCert(provider)))
                .with_no_client_auth();
            let name = ServerName::try_from(host.to_string()).map_err(|e| e.to_string())?;
            let conn = ClientConnection::new(Arc::new(config), name).map_err(|e| e.to_string())?;
            let tcp = TcpStream::connect_timeout(&format!("{host}:{port}").parse().map_err(|e| format!("{e}"))?, Duration::from_secs(5)).map_err(|e| e.to_string())?;
            tcp.set_read_timeout(Some(Duration::from_secs(5))).map_err(|e| e.to_string())?;
            let mut c = Client { tls: StreamOwned::new(conn, tcp), next: 1 };
            c.send("receiver-0", NS_CONNECTION, json!({ "type": "CONNECT" }))?;
            Ok(c)
        }

        pub fn send(&mut self, dst: &str, ns: &str, v: Value) -> Result<(), String> {
            self.tls.write_all(&encode(SENDER, dst, ns, &v.to_string())).map_err(|e| e.to_string())?;
            self.tls.flush().map_err(|e| e.to_string())
        }

        fn read(&mut self) -> Result<(String, Value), String> {
            let mut len = [0u8; 4];
            self.tls.read_exact(&mut len).map_err(|e| e.to_string())?;
            let n = u32::from_be_bytes(len) as usize;
            if n > 1 << 20 {
                return Err("message too big".into());
            }
            let mut b = vec![0u8; n];
            self.tls.read_exact(&mut b).map_err(|e| e.to_string())?;
            let (ns, p) = decode(&b).ok_or("bad message")?;
            Ok((ns, serde_json::from_str(&p).unwrap_or(Value::Null)))
        }

        /// Send a request and wait for the answer with the same requestId (answering pings meanwhile).
        pub fn request(&mut self, dst: &str, ns: &str, mut v: Value) -> Result<Value, String> {
            let id = self.next;
            self.next += 1;
            v["requestId"] = json!(id);
            self.send(dst, ns, v)?;
            for _ in 0..50 {
                let (ns, m) = self.read()?;
                if ns == NS_HEARTBEAT && m["type"] == "PING" {
                    self.send("receiver-0", NS_HEARTBEAT, json!({ "type": "PONG" }))?;
                    continue;
                }
                if m["requestId"] == json!(id) {
                    if matches!(m["type"].as_str(), Some("LOAD_FAILED" | "LOAD_CANCELLED" | "INVALID_REQUEST" | "LAUNCH_ERROR")) {
                        return Err(format!("the speaker said {}", m["type"].as_str().unwrap_or("no")));
                    }
                    return Ok(m);
                }
            }
            Err("the speaker didn't answer".into())
        }
    }
}

struct CcSession {
    client: castv2::Client,
    id: String,
    transport: String,
    session: String,
    media: Option<i64>,
}

static CC: Mutex<Option<CcSession>> = Mutex::new(None);

/// Google's Default Media Receiver.
const DEFAULT_RECEIVER: &str = "CC1AD845";

fn cc_session(t: &CastTarget) -> Result<std::sync::MutexGuard<'static, Option<CcSession>>, String> {
    let mut g = CC.lock().map_err(|e| e.to_string())?;
    if let Some(s) = g.as_mut().filter(|s| s.id == t.id) {
        if s.client.request(DEFAULT_DESTINATION, castv2::NS_RECEIVER, serde_json::json!({ "type": "GET_STATUS" })).is_ok() {
            return Ok(g);
        }
    }
    *g = None;
    let host = t.host.clone().ok_or("no address")?;
    let mut client = castv2::Client::connect(&host, t.port.unwrap_or(8009)).map_err(|e| format!("couldn't connect: {e}"))?;
    let st = client.request(DEFAULT_DESTINATION, castv2::NS_RECEIVER, serde_json::json!({ "type": "LAUNCH", "appId": DEFAULT_RECEIVER })).map_err(|e| format!("couldn't start the player: {e}"))?;
    let app = st["status"]["applications"].as_array().and_then(|a| a.iter().find(|x| x["appId"] == DEFAULT_RECEIVER)).cloned().ok_or("the player didn't start")?;
    let transport = app["transportId"].as_str().unwrap_or_default().to_string();
    let session = app["sessionId"].as_str().unwrap_or_default().to_string();
    client.send(&transport, castv2::NS_CONNECTION, serde_json::json!({ "type": "CONNECT" }))?;
    *g = Some(CcSession { client, id: t.id.clone(), transport, session, media: None });
    Ok(g)
}

fn cc_load(t: &CastTarget, url: &str, meta: &CastMeta, start: f64) -> Result<(), String> {
    let mut g = cc_session(t)?;
    let s = g.as_mut().ok_or("not connected")?;
    let images: Vec<_> = meta.cover.iter().filter(|c| c.starts_with("http")).map(|c| serde_json::json!({ "url": c })).collect();
    let load = serde_json::json!({
        "type": "LOAD",
        "sessionId": s.session,
        "autoplay": true,
        "currentTime": start,
        "media": {
            "contentId": url,
            "streamType": "BUFFERED",
            "contentType": meta.content_type.clone().unwrap_or_else(|| "audio/mpeg".into()),
            "duration": meta.duration,
            "metadata": { "metadataType": 3, "title": meta.title, "artist": meta.artist, "albumName": meta.album, "images": images },
        },
    });
    let transport = s.transport.clone();
    let st = s.client.request(&transport, castv2::NS_MEDIA, load).map_err(|e| format!("the speaker couldn't play it: {e}"))?;
    s.media = st["status"][0]["mediaSessionId"].as_i64();
    Ok(())
}

fn cc_command(cmd: &str, value: Option<f64>) -> Result<(), String> {
    let mut g = CC.lock().map_err(|e| e.to_string())?;
    let s = g.as_mut().ok_or("not connected")?;
    let (transport, media, session) = (s.transport.clone(), s.media, s.session.clone());
    match (cmd, media) {
        ("volume", _) => s.client.request(DEFAULT_DESTINATION, castv2::NS_RECEIVER, serde_json::json!({ "type": "SET_VOLUME", "volume": { "level": value.unwrap_or(0.5).clamp(0.0, 1.0) } })).map(|_| ()),
        ("play", Some(m)) => s.client.request(&transport, castv2::NS_MEDIA, serde_json::json!({ "type": "PLAY", "mediaSessionId": m })).map(|_| ()),
        ("pause", Some(m)) => s.client.request(&transport, castv2::NS_MEDIA, serde_json::json!({ "type": "PAUSE", "mediaSessionId": m })).map(|_| ()),
        ("seek", Some(m)) => s.client.request(&transport, castv2::NS_MEDIA, serde_json::json!({ "type": "SEEK", "mediaSessionId": m, "currentTime": value.unwrap_or(0.0) })).map(|_| ()),
        ("stop", _) => s.client.request(DEFAULT_DESTINATION, castv2::NS_RECEIVER, serde_json::json!({ "type": "STOP", "sessionId": session })).map(|_| ()),
        _ => Ok(()),
    }
}

fn cc_status() -> Result<CastStatus, String> {
    let mut g = CC.lock().map_err(|e| e.to_string())?;
    let s = g.as_mut().ok_or("not connected")?;
    let transport = s.transport.clone();
    let r = s.client.request(DEFAULT_DESTINATION, castv2::NS_RECEIVER, serde_json::json!({ "type": "GET_STATUS" }))?;
    let volume = r["status"]["volume"]["level"].as_f64();
    let m = s.client.request(&transport, castv2::NS_MEDIA, serde_json::json!({ "type": "GET_STATUS" }))?;
    let e = &m["status"][0];
    if e.is_null() {
        return Ok(CastStatus { state: "ended".into(), volume, ..Default::default() });
    }
    if let Some(id) = e["mediaSessionId"].as_i64() {
        s.media = Some(id);
    }
    let state = match e["playerState"].as_str().unwrap_or("IDLE") {
        "PLAYING" => "playing",
        "BUFFERING" => "buffering",
        "PAUSED" => "paused",
        _ => match e["idleReason"].as_str() {
            Some("FINISHED") => "ended",
            Some("ERROR") => "error",
            _ => "idle",
        },
    };
    Ok(CastStatus { state: state.into(), position: e["currentTime"].as_f64().unwrap_or(0.0), duration: e["media"]["duration"].as_f64().unwrap_or(0.0), volume })
}

// ---------------------------------------------------------------- DLNA

async fn soap(url: &str, service: &str, action: &str, args: &[(&str, String)]) -> Result<String, String> {
    let body: String = args.iter().map(|(k, v)| format!("<{k}>{}</{k}>", escape(v))).collect();
    let envelope = format!(
        r#"<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:{action} xmlns:u="urn:schemas-upnp-org:service:{service}:1">{body}</u:{action}></s:Body></s:Envelope>"#
    );
    let r = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap()
        .post(url)
        .header("Content-Type", "text/xml; charset=\"utf-8\"")
        .header("SOAPACTION", format!("\"urn:schemas-upnp-org:service:{service}:1#{action}\""))
        .body(envelope)
        .send()
        .await
        .map_err(|e| format!("the speaker didn't answer: {e}"))?;
    let ok = r.status().is_success();
    let text = r.text().await.unwrap_or_default();
    if !ok {
        let why = tag(&text, "errorDescription", 0).map(|(v, _)| v.to_string()).unwrap_or_else(|| "error".into());
        return Err(format!("{action}: {why}"));
    }
    Ok(text)
}

fn hms(t: f64) -> String {
    let t = t.max(0.0) as u64;
    format!("{}:{:02}:{:02}", t / 3600, (t / 60) % 60, t % 60)
}

fn secs(s: &str) -> f64 {
    let parts: Vec<f64> = s.split(':').map(|p| p.parse::<f64>().unwrap_or(0.0)).collect();
    parts.iter().fold(0.0, |a, p| a * 60.0 + p)
}

/// DIDL-Lite metadata, so the speaker's display shows the song.
pub fn didl(url: &str, m: &CastMeta) -> String {
    let ct = m.content_type.clone().unwrap_or_else(|| "audio/mpeg".into());
    let art = m.cover.as_deref().filter(|c| c.starts_with("http")).map(|c| format!("<upnp:albumArtURI>{}</upnp:albumArtURI>", escape(c))).unwrap_or_default();
    format!(
        r#"<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="0" parentID="-1" restricted="1"><dc:title>{}</dc:title><upnp:artist>{}</upnp:artist><upnp:album>{}</upnp:album>{art}<upnp:class>object.item.audioItem.musicTrack</upnp:class><res protocolInfo="http-get:*:{ct}:*">{}</res></item></DIDL-Lite>"#,
        escape(&m.title),
        escape(m.artist.as_deref().unwrap_or("")),
        escape(m.album.as_deref().unwrap_or("")),
        escape(url)
    )
}

async fn dlna_load(t: &CastTarget, url: &str, meta: &CastMeta, start: f64) -> Result<(), String> {
    let c = t.control.as_deref().ok_or("no control URL")?;
    let _ = soap(c, "AVTransport", "Stop", &[("InstanceID", "0".into())]).await;
    soap(c, "AVTransport", "SetAVTransportURI", &[("InstanceID", "0".into()), ("CurrentURI", url.into()), ("CurrentURIMetaData", didl(url, meta))]).await?;
    soap(c, "AVTransport", "Play", &[("InstanceID", "0".into()), ("Speed", "1".into())]).await?;
    if start > 1.0 {
        let _ = soap(c, "AVTransport", "Seek", &[("InstanceID", "0".into()), ("Unit", "REL_TIME".into()), ("Target", hms(start))]).await;
    }
    Ok(())
}

async fn dlna_command(t: &CastTarget, cmd: &str, value: Option<f64>) -> Result<(), String> {
    let c = t.control.as_deref().ok_or("no control URL")?;
    let id = ("InstanceID", "0".to_string());
    match cmd {
        "play" => soap(c, "AVTransport", "Play", &[id, ("Speed", "1".into())]).await.map(|_| ()),
        "pause" => soap(c, "AVTransport", "Pause", &[id]).await.map(|_| ()),
        "stop" => soap(c, "AVTransport", "Stop", &[id]).await.map(|_| ()),
        "seek" => soap(c, "AVTransport", "Seek", &[id, ("Unit", "REL_TIME".into()), ("Target", hms(value.unwrap_or(0.0)))]).await.map(|_| ()),
        "volume" => match &t.rendering {
            Some(r) => soap(r, "RenderingControl", "SetVolume", &[id, ("Channel", "Master".into()), ("DesiredVolume", format!("{}", (value.unwrap_or(0.5) * 100.0).round() as u32))]).await.map(|_| ()),
            None => Ok(()),
        },
        _ => Ok(()),
    }
}

async fn dlna_status(t: &CastTarget) -> Result<CastStatus, String> {
    let c = t.control.as_deref().ok_or("no control URL")?;
    let id = || ("InstanceID", "0".to_string());
    let info = soap(c, "AVTransport", "GetTransportInfo", &[id()]).await?;
    let pos = soap(c, "AVTransport", "GetPositionInfo", &[id()]).await.unwrap_or_default();
    let state = match tag(&info, "CurrentTransportState", 0).map(|(v, _)| v).unwrap_or("") {
        "PLAYING" => "playing",
        "PAUSED_PLAYBACK" | "PAUSED_RECORDING" => "paused",
        "TRANSITIONING" => "buffering",
        "STOPPED" => "ended",
        _ => "idle",
    };
    let volume = match &t.rendering {
        Some(r) => soap(r, "RenderingControl", "GetVolume", &[id(), ("Channel", "Master".into())]).await.ok().and_then(|x| tag(&x, "CurrentVolume", 0).and_then(|(v, _)| v.parse::<f64>().ok())).map(|v| v / 100.0),
        None => None,
    };
    Ok(CastStatus {
        state: state.into(),
        position: tag(&pos, "RelTime", 0).map(|(v, _)| secs(v)).unwrap_or(0.0),
        duration: tag(&pos, "TrackDuration", 0).map(|(v, _)| secs(v)).unwrap_or(0.0),
        volume,
    })
}

// ---------------------------------------------------------------- commands

#[tauri::command]
pub async fn cast_load(target: CastTarget, url: String, meta: CastMeta, start: Option<f64>) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Only songs streamed from a server can be cast, not downloaded ones".into());
    }
    let start = start.unwrap_or(0.0);
    if target.kind == "chromecast" {
        tauri::async_runtime::spawn_blocking(move || cc_load(&target, &url, &meta, start)).await.map_err(|e| e.to_string())?
    } else {
        dlna_load(&target, &url, &meta, start).await
    }
}

/// `play`, `pause`, `stop`, `seek` (value: seconds) or `volume` (value: 0..1).
#[tauri::command]
pub async fn cast_command(target: CastTarget, cmd: String, value: Option<f64>) -> Result<(), String> {
    if target.kind == "chromecast" {
        tauri::async_runtime::spawn_blocking(move || cc_command(&cmd, value)).await.map_err(|e| e.to_string())?
    } else {
        dlna_command(&target, &cmd, value).await
    }
}

#[tauri::command]
pub async fn cast_status(target: CastTarget) -> Result<CastStatus, String> {
    if target.kind == "chromecast" {
        tauri::async_runtime::spawn_blocking(cc_status).await.map_err(|e| e.to_string())?
    } else {
        dlna_status(&target).await
    }
}

/// Stop and let go of the speaker.
#[tauri::command]
pub async fn cast_disconnect(target: CastTarget) -> Result<(), String> {
    let _ = cast_command(target.clone(), "stop".into(), None).await;
    if target.kind == "chromecast" {
        if let Ok(mut g) = CC.lock() {
            *g = None;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn description() {
        let xml = r#"<?xml version="1.0"?><root><URLBase>http://192.168.1.20:1400/</URLBase><device><friendlyName>Living Room &amp; Kitchen</friendlyName><UDN>uuid:RINCON_1</UDN>
          <serviceList><service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>/MediaRenderer/RenderingControl/Control</controlURL></service>
          <service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>/MediaRenderer/AVTransport/Control</controlURL></service></serviceList></device></root>"#;
        let t = parse_description("http://192.168.1.20:1400/xml/device_description.xml", xml).unwrap();
        assert_eq!(t.name, "Living Room & Kitchen");
        assert_eq!(t.id, "uuid:RINCON_1");
        assert_eq!(t.control.as_deref(), Some("http://192.168.1.20:1400/MediaRenderer/AVTransport/Control"));
        assert_eq!(t.rendering.as_deref(), Some("http://192.168.1.20:1400/MediaRenderer/RenderingControl/Control"));
        assert!(parse_description("http://x/", "<root><friendlyName>No transport</friendlyName></root>").is_none());
    }

    #[test]
    fn cast_messages() {
        let b = castv2::encode("sender-0", "receiver-0", castv2::NS_RECEIVER, r#"{"type":"GET_STATUS"}"#);
        assert_eq!(u32::from_be_bytes([b[0], b[1], b[2], b[3]]) as usize, b.len() - 4);
        let (ns, p) = castv2::decode(&b[4..]).unwrap();
        assert_eq!(ns, castv2::NS_RECEIVER);
        assert_eq!(p, r#"{"type":"GET_STATUS"}"#);
    }

    #[test]
    fn times_and_didl() {
        assert_eq!(hms(3725.4), "1:02:05");
        assert_eq!(secs("0:03:20"), 200.0);
        let d = didl("http://nd/rest/stream?id=1&u=a", &CastMeta { title: "A & B".into(), ..Default::default() });
        assert!(d.contains("A &amp; B") && d.contains("id=1&amp;u=a"));
    }
}
