//! Bit-perfect playback on Windows: the app decodes the song itself (symphonia) and plays it through WASAPI in
//! exclusive mode, at the file's own sample rate and bit depth, so Windows' mixer never resamples or touches
//! it. The web page drives it like a cast speaker (lib/hifi.ts → engine.setRemote): load, play, pause, seek,
//! volume, and a status it polls. Other apps can't play sound while it has the device; that's what exclusive
//! means. Below 100% volume the samples are scaled, which is no longer bit-perfect (the setting says so).

use std::collections::VecDeque;
use std::io::{Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Condvar, Mutex};

use serde::Serialize;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
use symphonia::core::io::{MediaSource, MediaSourceStream};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::Time;
use tauri_plugin_http::reqwest;

// ---------------------------------------------------------------- the download, readable while it arrives

#[derive(Default)]
struct Bytes {
    data: Vec<u8>,
    total: Option<u64>,
    done: bool,
    error: Option<String>,
}

/// The song as it downloads. Reads past what has arrived wait for it.
#[derive(Clone)]
struct Download(Arc<(Mutex<Bytes>, Condvar)>);

impl Download {
    fn new() -> Self {
        Download(Arc::new((Mutex::new(Bytes::default()), Condvar::new())))
    }
    fn update(&self, f: impl FnOnce(&mut Bytes)) {
        let (m, cv) = &*self.0;
        if let Ok(mut b) = m.lock() {
            f(&mut b);
        }
        cv.notify_all();
    }
}

struct Reader {
    dl: Download,
    pos: u64,
}

impl Read for Reader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let (m, cv) = &*self.dl.0;
        let mut b = m.lock().map_err(|_| std::io::Error::other("poisoned"))?;
        loop {
            let have = b.data.len() as u64;
            if self.pos < have {
                let n = ((have - self.pos) as usize).min(buf.len());
                buf[..n].copy_from_slice(&b.data[self.pos as usize..self.pos as usize + n]);
                self.pos += n as u64;
                return Ok(n);
            }
            if let Some(e) = &b.error {
                return Err(std::io::Error::other(e.clone()));
            }
            if b.done {
                return Ok(0);
            }
            b = cv.wait(b).map_err(|_| std::io::Error::other("poisoned"))?;
        }
    }
}

impl Seek for Reader {
    fn seek(&mut self, to: SeekFrom) -> std::io::Result<u64> {
        let len = {
            let (m, cv) = &*self.dl.0;
            let mut b = m.lock().map_err(|_| std::io::Error::other("poisoned"))?;
            // seeking from the end needs the length: wait for it (the header, or the whole file)
            while matches!(to, SeekFrom::End(_)) && b.total.is_none() && !b.done && b.error.is_none() {
                b = cv.wait(b).map_err(|_| std::io::Error::other("poisoned"))?;
            }
            b.total.unwrap_or(b.data.len() as u64)
        };
        let p = match to {
            SeekFrom::Start(p) => p as i64,
            SeekFrom::Current(d) => self.pos as i64 + d,
            SeekFrom::End(d) => len as i64 + d,
        };
        if p < 0 {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "before the start"));
        }
        self.pos = p as u64;
        Ok(self.pos)
    }
}

impl MediaSource for Reader {
    fn is_seekable(&self) -> bool {
        true
    }
    fn byte_len(&self) -> Option<u64> {
        self.dl.0 .0.lock().ok().and_then(|b| b.total)
    }
}

// ---------------------------------------------------------------- output

/// Where decoded samples go. `samples` are interleaved, full-scale i32 (a 16-bit sample is shifted up 16).
pub trait Output {
    fn write(&mut self, samples: &[i32], volume: f32) -> Result<(), String>;
    /// Play out what's buffered (the song ended).
    fn drain(&mut self) -> Result<(), String>;
    fn pause(&mut self);
    fn resume(&mut self) -> Result<(), String>;
    /// Drop what's buffered (a seek or a new song).
    fn flush(&mut self);
    /// Frames the device has been given since the last flush.
    fn frames_out(&self) -> u64;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Format {
    pub rate: u32,
    pub channels: usize,
    pub bits: u32,
}

/// Pure: full-scale i32 → the device's container (`bits` 16, 24 or 32), little-endian, with volume when < 1.
/// At full volume the top bits pass through untouched: a 16-bit file into a 16-bit device is bit-for-bit.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub fn pack(samples: &[i32], bits: u32, volume: f32, out: &mut Vec<u8>) {
    let scale = volume < 0.999;
    for &s in samples {
        let s = if scale { (s as f64 * volume.max(0.0) as f64) as i32 } else { s };
        match bits {
            16 => out.extend_from_slice(&((s >> 16) as i16).to_le_bytes()),
            24 => out.extend_from_slice(&(s >> 8).to_le_bytes()[..3]),
            _ => out.extend_from_slice(&s.to_le_bytes()),
        }
    }
}

#[cfg(windows)]
mod wasapi_out {
    use super::{pack, Format, Output};
    use std::collections::VecDeque;
    use wasapi::*;

    pub struct Exclusive {
        client: AudioClient,
        render: AudioRenderClient,
        event: Handle,
        block: usize,
        buffer_frames: usize,
        bits: u32,
        queue: VecDeque<u8>,
        started: bool,
        frames: u64,
        scratch: Vec<u8>,
    }

    pub fn open(f: Format) -> Result<Exclusive, String> {
        let _ = initialize_mta();
        let device = get_default_device(&Direction::Render).map_err(|e| format!("No sound device: {e}"))?;
        // the file's own depth first; 24-bit audio may need a 32-bit container; 16-bit files can go into 24 or 32 too
        let tries: Vec<(usize, usize)> = match f.bits {
            16 => vec![(16, 16), (24, 24), (32, 24), (32, 32)],
            24 => vec![(24, 24), (32, 24), (32, 32)],
            _ => vec![(32, 32), (32, 24), (24, 24)],
        };
        let mut chosen = None;
        for (container, valid) in tries {
            let client = device.get_iaudioclient().map_err(|e| e.to_string())?;
            let want = WaveFormat::new(container, valid, &SampleType::Int, f.rate as usize, f.channels, None);
            if let Ok(fmt) = client.is_supported_exclusive_with_quirks(&want) {
                chosen = Some((fmt, container as u32));
                break;
            }
        }
        let (fmt, container) = chosen.ok_or_else(|| format!("Your sound device can't play {} Hz / {}-bit in exclusive mode", f.rate, f.bits))?;
        let mut client = device.get_iaudioclient().map_err(|e| e.to_string())?;
        let (_, min) = client.get_device_period().map_err(|e| e.to_string())?;
        // a longer period than the minimum: fewer wake-ups, no clicks on a busy PC
        let period = client.calculate_aligned_period_near((min * 4).max(100_000), Some(128), &fmt).map_err(|e| e.to_string())?;
        let mode = StreamMode::EventsExclusive { period_hns: period };
        if let Err(e) = client.initialize_client(&fmt, &Direction::Render, &mode) {
            // AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED: try again with the size the device asks for
            let frames = client.get_buffer_size().map_err(|_| e.to_string())?;
            let aligned = calculate_period_100ns(frames as i64, f.rate as i64);
            client = device.get_iaudioclient().map_err(|e| e.to_string())?;
            client
                .initialize_client(&fmt, &Direction::Render, &StreamMode::EventsExclusive { period_hns: aligned })
                .map_err(|e| format!("Couldn't take the sound device for exclusive playback ({e}). Another app may have it, or Windows' “Allow applications to take exclusive control” is off"))?;
        }
        let event = client.set_get_eventhandle().map_err(|e| e.to_string())?;
        let render = client.get_audiorenderclient().map_err(|e| e.to_string())?;
        let buffer_frames = client.get_buffer_size().map_err(|e| e.to_string())? as usize;
        Ok(Exclusive {
            client,
            render,
            event,
            block: fmt.get_blockalign() as usize,
            buffer_frames,
            bits: container,
            queue: VecDeque::new(),
            started: false,
            frames: 0,
            scratch: Vec::new(),
        })
    }

    impl Exclusive {
        /// Hand the device one buffer from the queue (silence-padded when `pad`).
        fn push_one(&mut self, pad: bool) -> Result<bool, String> {
            let need = self.buffer_frames * self.block;
            if self.queue.len() < need {
                if !pad || self.queue.is_empty() {
                    return Ok(false);
                }
                self.queue.resize(need, 0);
            }
            if self.started {
                self.event.wait_for_event(2000).map_err(|_| "The sound device stopped answering".to_string())?;
            }
            self.render.write_to_device_from_deque(self.buffer_frames, &mut self.queue, None).map_err(|e| e.to_string())?;
            self.frames += self.buffer_frames as u64;
            if !self.started {
                self.client.start_stream().map_err(|e| e.to_string())?;
                self.started = true;
            }
            Ok(true)
        }
    }

    impl Output for Exclusive {
        fn write(&mut self, samples: &[i32], volume: f32) -> Result<(), String> {
            self.scratch.clear();
            pack(samples, self.bits, volume, &mut self.scratch);
            self.queue.extend(self.scratch.iter());
            while self.push_one(false)? {}
            Ok(())
        }
        fn drain(&mut self) -> Result<(), String> {
            self.push_one(true)?;
            if self.started {
                let _ = self.event.wait_for_event(2000);
            }
            Ok(())
        }
        fn pause(&mut self) {
            if self.started {
                let _ = self.client.stop_stream();
            }
        }
        fn resume(&mut self) -> Result<(), String> {
            if self.started {
                self.client.start_stream().map_err(|e| e.to_string())?;
            }
            Ok(())
        }
        fn flush(&mut self) {
            if self.started {
                let _ = self.client.stop_stream();
                let _ = self.client.reset_stream();
                self.started = false;
            }
            self.queue.clear();
            self.frames = 0;
        }
        fn frames_out(&self) -> u64 {
            self.frames
        }
    }

    impl Drop for Exclusive {
        fn drop(&mut self) {
            let _ = self.client.stop_stream();
        }
    }
}

type Opener = dyn Fn(Format) -> Result<Box<dyn Output>, String> + Send;

#[allow(unreachable_code, unused_variables)]
fn open_device(f: Format) -> Result<Box<dyn Output>, String> {
    #[cfg(windows)]
    return wasapi_out::open(f).map(|o| Box::new(o) as Box<dyn Output>);
    Err("Bit-perfect output is only in the Windows app".into())
}

// ---------------------------------------------------------------- the player thread

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HifiStatus {
    /// "idle", "buffering", "playing", "paused", "ended", "error"
    pub state: String,
    pub position: f64,
    pub duration: f64,
    /// "44100 Hz · 16-bit", once playing
    pub format: Option<String>,
    pub error: Option<String>,
}

enum Cmd {
    Load { dl: Download, start: f64, hint: Option<String> },
    Play,
    Pause,
    Seek(f64),
    Volume(f32),
    Stop,
}

struct Song {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn symphonia::core::codecs::Decoder>,
    track: u32,
    fmt: Format,
    /// where the device's frame count starts from, seconds
    base: f64,
}

fn open_song(dl: Download, hint: Option<String>) -> Result<(Song, f64), String> {
    let mss = MediaSourceStream::new(Box::new(Reader { dl, pos: 0 }), Default::default());
    let mut h = Hint::new();
    if let Some(ext) = hint.as_deref() {
        h.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(&h, mss, &FormatOptions { enable_gapless: true, ..Default::default() }, &MetadataOptions::default())
        .map_err(|e| format!("Can't read this song for bit-perfect playback ({e})"))?;
    let format = probed.format;
    let track = format.tracks().iter().find(|t| t.codec_params.codec != CODEC_TYPE_NULL).ok_or("No audio in this file")?;
    let p = &track.codec_params;
    let decoder = symphonia::default::get_codecs().make(p, &DecoderOptions::default()).map_err(|e| format!("Can't decode this song ({e})"))?;
    let rate = p.sample_rate.ok_or("Unknown sample rate")?;
    let channels = p.channels.map(|c| c.count()).unwrap_or(2);
    // lossy formats have no bit depth: give the device its best
    let bits = match p.bits_per_sample.unwrap_or(32) {
        0..=16 => 16,
        17..=24 => 24,
        _ => 32,
    };
    let duration = match (p.n_frames, p.time_base) {
        (Some(n), Some(tb)) => {
            let t = tb.calc_time(n);
            t.seconds as f64 + t.frac
        }
        (Some(n), None) => n as f64 / rate as f64,
        _ => 0.0,
    };
    let id = track.id;
    Ok((Song { format, decoder, track: id, fmt: Format { rate, channels, bits }, base: 0.0 }, duration))
}

struct Player {
    status: Arc<Mutex<HifiStatus>>,
    opener: Box<Opener>,
}

impl Player {
    fn set(&self, f: impl FnOnce(&mut HifiStatus)) {
        if let Ok(mut s) = self.status.lock() {
            f(&mut s);
        }
    }

    fn fail(&self, e: String) {
        self.set(|s| {
            s.state = "error".into();
            s.error = Some(e);
        });
    }

    fn run(self, rx: Receiver<Cmd>) {
        let mut song: Option<Song> = None;
        let mut out: Option<(Format, Box<dyn Output>)> = None;
        let mut playing = false;
        let mut volume = 1.0f32;
        let mut pending: VecDeque<Cmd> = VecDeque::new();
        loop {
            // wait for something to do while paused or idle; otherwise just look
            let cmd = if let Some(c) = pending.pop_front() {
                Some(c)
            } else if playing && song.is_some() {
                rx.try_recv().ok()
            } else {
                match rx.recv() {
                    Ok(c) => Some(c),
                    Err(_) => return,
                }
            };
            if let Some(cmd) = cmd {
                match cmd {
                    Cmd::Load { dl, start, hint } => {
                        if let Some((_, o)) = out.as_mut() {
                            o.flush();
                        }
                        song = None;
                        self.set(|s| *s = HifiStatus { state: "buffering".into(), position: start, ..Default::default() });
                        match open_song(dl, hint) {
                            Ok((mut s, duration)) => {
                                if start > 0.5 {
                                    let _ = s.format.seek(SeekMode::Accurate, SeekTo::Time { time: Time::from(start), track_id: Some(s.track) });
                                    s.decoder.reset();
                                    s.base = start;
                                }
                                // the same format as the last song: keep the device (no click, no gap)
                                if out.as_ref().is_some_and(|(f, _)| *f != s.fmt) {
                                    out = None;
                                }
                                if out.is_none() {
                                    match (self.opener)(s.fmt) {
                                        Ok(o) => out = Some((s.fmt, o)),
                                        Err(e) => {
                                            self.fail(e);
                                            continue;
                                        }
                                    }
                                }
                                let f = s.fmt;
                                self.set(|st| {
                                    st.duration = duration;
                                    st.format = Some(format!("{} Hz · {}-bit{}", f.rate, f.bits, if f.channels != 2 { format!(" · {} ch", f.channels) } else { String::new() }));
                                    st.state = "playing".into();
                                });
                                song = Some(s);
                                playing = true;
                            }
                            Err(e) => self.fail(e),
                        }
                    }
                    Cmd::Play => {
                        if song.is_some() && !playing {
                            playing = true;
                            if let Some((_, o)) = out.as_mut() {
                                if let Err(e) = o.resume() {
                                    self.fail(e);
                                }
                            }
                            self.set(|s| s.state = "playing".into());
                        }
                    }
                    Cmd::Pause => {
                        if playing {
                            playing = false;
                            if let Some((_, o)) = out.as_mut() {
                                o.pause();
                            }
                            self.set(|s| s.state = "paused".into());
                        }
                    }
                    Cmd::Seek(t) => {
                        if let Some(s) = song.as_mut() {
                            if let Some((_, o)) = out.as_mut() {
                                o.flush();
                            }
                            let at = s
                                .format
                                .seek(SeekMode::Accurate, SeekTo::Time { time: Time::from(t.max(0.0)), track_id: Some(s.track) })
                                .map(|r| r.actual_ts as f64 / s.fmt.rate as f64)
                                .unwrap_or(t);
                            s.decoder.reset();
                            s.base = at;
                            self.set(|st| st.position = at);
                            if !playing {
                                // stays paused; resume() after a flush starts afresh
                            }
                        }
                    }
                    Cmd::Volume(v) => volume = v.clamp(0.0, 1.0),
                    Cmd::Stop => {
                        song = None;
                        out = None;
                        playing = false;
                        self.set(|s| *s = HifiStatus { state: "idle".into(), ..Default::default() });
                    }
                }
                continue;
            }

            // decode and play one packet
            let (Some(s), Some((_, o))) = (song.as_mut(), out.as_mut()) else {
                playing = false;
                continue;
            };
            let packet = match s.format.next_packet() {
                Ok(p) => p,
                Err(SymError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                    let _ = o.drain();
                    playing = false;
                    song = None;
                    self.set(|st| st.state = "ended".into());
                    continue;
                }
                Err(SymError::ResetRequired) => {
                    s.decoder.reset();
                    continue;
                }
                Err(e) => {
                    playing = false;
                    song = None;
                    self.fail(format!("Playback stopped: {e}"));
                    continue;
                }
            };
            if packet.track_id() != s.track {
                continue;
            }
            match s.decoder.decode(&packet) {
                Ok(buf) => {
                    let mut sb = SampleBuffer::<i32>::new(buf.capacity() as u64, *buf.spec());
                    sb.copy_interleaved_ref(buf);
                    if let Err(e) = o.write(sb.samples(), volume) {
                        playing = false;
                        song = None;
                        out = None;
                        self.fail(e);
                        continue;
                    }
                    let pos = s.base + o.frames_out() as f64 / s.fmt.rate as f64;
                    self.set(|st| st.position = pos);
                }
                Err(SymError::DecodeError(_)) => continue, // a damaged frame: skip it
                Err(e) => {
                    playing = false;
                    song = None;
                    self.fail(format!("Playback stopped: {e}"));
                }
            }
            // a command that came in while writing (pause, seek) goes first next time round
            if let Ok(c) = rx.try_recv() {
                pending.push_back(c);
            }
        }
    }
}

struct PlayerHandle {
    tx: Sender<Cmd>,
    status: Arc<Mutex<HifiStatus>>,
}

static PLAYER: Mutex<Option<PlayerHandle>> = Mutex::new(None);
static LOADS: AtomicU64 = AtomicU64::new(0);

fn spawn(opener: Box<Opener>) -> PlayerHandle {
    let (tx, rx) = channel();
    let status = Arc::new(Mutex::new(HifiStatus { state: "idle".into(), ..Default::default() }));
    let p = Player { status: status.clone(), opener };
    std::thread::Builder::new().name("hifi".into()).spawn(move || p.run(rx)).expect("hifi thread");
    PlayerHandle { tx, status }
}

fn with_player<T>(f: impl FnOnce(&PlayerHandle) -> T) -> Result<T, String> {
    let mut g = PLAYER.lock().map_err(|_| "busy")?;
    if g.is_none() {
        *g = Some(spawn(Box::new(open_device)));
    }
    Ok(f(g.as_ref().unwrap()))
}

fn ext_of(url: &str) -> Option<String> {
    let path = url.split(['?', '#']).next()?;
    let ext = path.rsplit('/').next()?.rsplit_once('.')?.1.to_ascii_lowercase();
    (ext.len() <= 5).then_some(ext)
}

/// Whether bit-perfect output can work here (the Windows app).
#[tauri::command]
pub fn hifi_available() -> bool {
    cfg!(windows)
}

#[tauri::command]
pub async fn hifi_load(url: String, start: Option<f64>) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Only songs from a server can play bit-perfect".into());
    }
    let dl = Download::new();
    let n = LOADS.fetch_add(1, Ordering::SeqCst) + 1;
    let fill = dl.clone();
    let target = url.clone();
    tauri::async_runtime::spawn(async move {
        let res = match reqwest::get(&target).await.and_then(|r| r.error_for_status()) {
            Ok(r) => r,
            Err(e) => return fill.update(|b| b.error = Some(format!("Couldn't fetch the song ({e})"))),
        };
        let total = res.content_length();
        fill.update(|b| b.total = total);
        let mut res = res;
        loop {
            // a newer song started: stop fetching this one
            if LOADS.load(Ordering::SeqCst) != n {
                return fill.update(|b| b.error = Some("cancelled".into()));
            }
            match res.chunk().await {
                Ok(Some(c)) => fill.update(|b| b.data.extend_from_slice(&c)),
                Ok(None) => return fill.update(|b| b.done = true),
                Err(e) => return fill.update(|b| b.error = Some(format!("The download broke off ({e})"))),
            }
        }
    });
    with_player(|p| p.tx.send(Cmd::Load { dl, start: start.unwrap_or(0.0), hint: ext_of(&url) }).map_err(|e| e.to_string()))?
}

/// `play`, `pause`, `seek` (value: seconds), `volume` (value: 0..1) or `stop`.
#[tauri::command]
pub fn hifi_command(cmd: String, value: Option<f64>) -> Result<(), String> {
    let c = match cmd.as_str() {
        "play" => Cmd::Play,
        "pause" => Cmd::Pause,
        "seek" => Cmd::Seek(value.unwrap_or(0.0)),
        "volume" => Cmd::Volume(value.unwrap_or(1.0) as f32),
        "stop" => Cmd::Stop,
        _ => return Err(format!("Unknown command {cmd}")),
    };
    with_player(|p| p.tx.send(c).map_err(|e| e.to_string()))?
}

#[tauri::command]
pub fn hifi_status() -> Result<HifiStatus, String> {
    with_player(|p| p.status.lock().map(|s| s.clone()).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packing_is_bit_exact_at_full_volume() {
        let mut out = vec![];
        pack(&[0x1234_0000, -0x0001_0000], 16, 1.0, &mut out);
        assert_eq!(out, vec![0x34, 0x12, 0xff, 0xff]);
        out.clear();
        pack(&[0x1234_5600], 24, 1.0, &mut out);
        assert_eq!(out, vec![0x56, 0x34, 0x12]);
        out.clear();
        pack(&[0x1000_0000], 16, 0.5, &mut out);
        assert_eq!(out, vec![0x00, 0x08]);
    }

    fn wav16(samples: &[i16], rate: u32) -> Vec<u8> {
        let data: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
        let mut w = vec![];
        w.extend_from_slice(b"RIFF");
        w.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
        w.extend_from_slice(b"WAVEfmt ");
        w.extend_from_slice(&16u32.to_le_bytes());
        w.extend_from_slice(&1u16.to_le_bytes());
        w.extend_from_slice(&2u16.to_le_bytes());
        w.extend_from_slice(&rate.to_le_bytes());
        w.extend_from_slice(&(rate * 4).to_le_bytes());
        w.extend_from_slice(&4u16.to_le_bytes());
        w.extend_from_slice(&16u16.to_le_bytes());
        w.extend_from_slice(b"data");
        w.extend_from_slice(&(data.len() as u32).to_le_bytes());
        w.extend_from_slice(&data);
        w
    }

    struct Capture(Arc<Mutex<(Vec<u8>, u64, bool)>>);
    impl Output for Capture {
        fn write(&mut self, s: &[i32], v: f32) -> Result<(), String> {
            let mut g = self.0.lock().unwrap();
            pack(s, 16, v, &mut g.0);
            g.1 += (s.len() / 2) as u64;
            Ok(())
        }
        fn drain(&mut self) -> Result<(), String> {
            self.0.lock().unwrap().2 = true;
            Ok(())
        }
        fn pause(&mut self) {}
        fn resume(&mut self) -> Result<(), String> {
            Ok(())
        }
        fn flush(&mut self) {
            self.0.lock().unwrap().1 = 0;
        }
        fn frames_out(&self) -> u64 {
            self.0.lock().unwrap().1
        }
    }

    #[test]
    fn a_16_bit_file_comes_out_bit_for_bit() {
        let samples: Vec<i16> = (0..44_100 * 2).map(|i| ((i * 7919) % 65_536 - 32_768) as i16).collect();
        let wav = wav16(&samples, 44_100);
        let got = Arc::new(Mutex::new((Vec::new(), 0u64, false)));
        let seen_fmt = Arc::new(Mutex::new(None));
        let (g2, f2) = (got.clone(), seen_fmt.clone());
        let h = spawn(Box::new(move |f| {
            *f2.lock().unwrap() = Some(f);
            Ok(Box::new(Capture(g2.clone())) as Box<dyn Output>)
        }));
        let dl = Download::new();
        let half = wav.len() / 2;
        dl.update(|b| {
            b.total = Some(wav.len() as u64);
            b.data.extend_from_slice(&wav[..half]);
        });
        h.tx.send(Cmd::Load { dl: dl.clone(), start: 0.0, hint: Some("wav".into()) }).unwrap();
        // the rest arrives while it plays
        std::thread::sleep(std::time::Duration::from_millis(50));
        dl.update(|b| {
            b.data.extend_from_slice(&wav[half..]);
            b.done = true;
        });
        for _ in 0..200 {
            if h.status.lock().unwrap().state == "ended" {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let st = h.status.lock().unwrap().clone();
        assert_eq!(st.state, "ended");
        assert!((st.duration - 1.0).abs() < 0.01, "duration {}", st.duration);
        assert_eq!(st.format.as_deref(), Some("44100 Hz · 16-bit"));
        assert_eq!(*seen_fmt.lock().unwrap(), Some(Format { rate: 44_100, channels: 2, bits: 16 }));
        let g = got.lock().unwrap();
        assert!(g.2, "drained at the end");
        let expect: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
        assert_eq!(g.0.len(), expect.len());
        assert!(g.0 == expect, "bit-perfect");
    }

    #[test]
    fn extension_hint() {
        assert_eq!(ext_of("https://x/music/a.FLAC?u=1").as_deref(), Some("flac"));
        assert_eq!(ext_of("https://x/rest/stream?id=1"), None);
    }
}
