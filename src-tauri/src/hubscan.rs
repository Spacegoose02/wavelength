//! Finding a Wavelength Hub on the home network without typing its address (src/lib/hubScan.ts, docs/HUB.md
//! "Connecting"). Typing `192.168.1.10:7780` with a TV remote is the hardest part of signing in on a TV, so the app
//! looks first: every address on this device's /24 is tried on the Hub's port, and the ones that take a connection
//! come back for the app to ask `/api/health`, which tells a Hub apart from anything else listening there.
//! Nothing is sent but a TCP handshake, and only to the local network.

use std::net::{Ipv4Addr, SocketAddr, TcpStream, UdpSocket};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

/// This device's address on the home network. Connecting a UDP socket sends nothing; it only picks the route,
/// and with it the address the system would send from.
fn local_v4() -> Option<Ipv4Addr> {
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("192.0.2.1:9").ok()?; // TEST-NET-1: never answered, never sent to
    match sock.local_addr().ok()? {
        SocketAddr::V4(a) if !a.ip().is_loopback() && !a.ip().is_unspecified() => Some(*a.ip()),
        _ => None,
    }
}

/// Only private networks are scanned (10/8, 172.16/12, 192.168/16): a device on a public address isn't at home.
fn is_private(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    a == 10 || (a == 172 && (16..=31).contains(&b)) || (a == 192 && b == 168)
}

/// The addresses on `me`'s /24, this device first (a Hub on the TV box itself), then the rest in order.
fn neighbours(me: Ipv4Addr) -> Vec<Ipv4Addr> {
    let [a, b, c, d] = me.octets();
    let mut out = vec![me];
    out.extend((1..=254u8).filter(|&n| n != d).map(|n| Ipv4Addr::new(a, b, c, n)));
    out
}

fn scan(port: u16, timeout: Duration) -> Vec<String> {
    let Some(me) = local_v4().filter(|ip| is_private(*ip)) else { return vec![] };
    let todo = Arc::new(Mutex::new(neighbours(me).into_iter().rev().collect::<Vec<_>>()));
    let found = Arc::new(Mutex::new(Vec::<(usize, Ipv4Addr)>::new()));
    let total = todo.lock().map(|t| t.len()).unwrap_or(0);
    // 32 at a time: quick (about 8 rounds of the timeout) without a slow TV box opening 254 sockets at once
    let workers: Vec<_> = (0..32)
        .map(|_| {
            let (todo, found) = (todo.clone(), found.clone());
            thread::spawn(move || loop {
                let next = todo.lock().ok().and_then(|mut t| t.pop().map(|ip| (total - t.len() - 1, ip)));
                let Some((order, ip)) = next else { break };
                if TcpStream::connect_timeout(&SocketAddr::from((ip, port)), timeout).is_ok() {
                    if let Ok(mut f) = found.lock() {
                        f.push((order, ip));
                    }
                }
            })
        })
        .collect();
    for w in workers {
        let _ = w.join();
    }
    let mut f = found.lock().map(|f| f.clone()).unwrap_or_default();
    f.sort();
    f.into_iter().map(|(_, ip)| format!("{ip}:{port}")).collect()
}

/// `host:port` of everything on this network that takes a connection on `port` (the Hub's 7780 by default).
#[tauri::command]
pub async fn hub_scan(port: Option<u16>) -> Result<Vec<String>, String> {
    let port = port.unwrap_or(7780);
    tauri::async_runtime::spawn_blocking(move || scan(port, Duration::from_millis(350))).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_home_networks() {
        assert!(is_private(Ipv4Addr::new(192, 168, 1, 20)));
        assert!(is_private(Ipv4Addr::new(10, 0, 0, 5)));
        assert!(is_private(Ipv4Addr::new(172, 20, 0, 1)));
        assert!(!is_private(Ipv4Addr::new(172, 32, 0, 1)));
        assert!(!is_private(Ipv4Addr::new(8, 8, 8, 8)));
    }

    #[test]
    fn this_device_first_then_the_rest() {
        let n = neighbours(Ipv4Addr::new(192, 168, 1, 20));
        assert_eq!(n.len(), 254);
        assert_eq!(n[0], Ipv4Addr::new(192, 168, 1, 20));
        assert_eq!(n[1], Ipv4Addr::new(192, 168, 1, 1));
        assert!(!n[1..].contains(&Ipv4Addr::new(192, 168, 1, 20)));
        assert!(!n.contains(&Ipv4Addr::new(192, 168, 1, 0)) && !n.contains(&Ipv4Addr::new(192, 168, 1, 255)));
    }
}
