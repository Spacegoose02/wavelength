import { esc } from './http.ts';

/**
 * The Guest Jam page (routes/together.ts): opened from the host's guest link on any phone, no app or account.
 * Shows what's playing and up next, and searches the library to add songs. Plain HTML and a little script, so it
 * works in any browser; it only ever talks to /api/jam/<code>.
 */
export function jamPage(p: { name: string; host: string } | null): string {
  const head = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${p ? `${esc(p.name)} · ` : ''}Wavelength Jam</title>
<style>
  :root { color-scheme: dark; --bg:#0d0a1a; --panel:#17122b; --line:#2c2350; --text:#ece8ff; --muted:#a59fc4; --accent:#ff3df2; --accent2:#21e6ff; --bad:#ff5c7a; --ok:#5cffb0; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; background:radial-gradient(circle at 50% -20%, #2a1550, var(--bg) 60%); color:var(--text); font:16px/1.45 system-ui, sans-serif; }
  main { max-width:520px; margin:0 auto; padding:20px 16px 60px; }
  h1 { margin:0; font-size:22px; } h1 span { color:var(--accent); }
  .muted { color:var(--muted); font-size:14px; margin:4px 0 0; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:14px; margin-top:16px; }
  .label { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.08em; }
  .now { font-weight:600; font-size:18px; margin-top:4px; }
  ol { margin:6px 0 0; padding-left:22px; color:var(--muted); font-size:14px; }
  input { width:100%; padding:11px 12px; border-radius:10px; border:1px solid var(--line); background:#0f0b20; color:var(--text); font-size:16px; }
  ul { list-style:none; margin:10px 0 0; padding:0; }
  li { display:flex; align-items:center; gap:10px; padding:8px 0; border-top:1px solid var(--line); }
  li div { flex:1; min-width:0; } li b, li small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; } li small { color:var(--muted); }
  button { padding:8px 14px; border-radius:10px; border:0; font:600 14px system-ui, sans-serif; cursor:pointer; background:linear-gradient(90deg, var(--accent), var(--accent2)); color:#120c24; }
  button:disabled { opacity:.5; }
  #msg { min-height:20px; margin-top:10px; font-size:14px; } #msg.bad { color:var(--bad); } #msg.ok { color:var(--ok); }
</style></head><body><main>`;
  if (!p) return `${head}<h1><span>●</span> Wavelength Jam</h1><p class="muted">This Jam has ended. Ask the host for a new link.</p></main></body></html>`;
  return `${head}
<h1><span>●</span> ${esc(p.name)}</h1>
<p class="muted">${esc(p.host)} is playing the music. Add songs and they join the queue.</p>
<div class="card"><div class="label">Now playing</div><div class="now" id="now">…</div><div class="label" style="margin-top:12px">Up next</div><ol id="next"></ol></div>
<div class="card">
  <label class="label" for="who">Your name</label>
  <input id="who" maxlength="30" autocomplete="nickname" placeholder="So the host knows who picked it">
  <label class="label" for="q" style="display:block;margin-top:12px">Add a song</label>
  <input id="q" type="search" placeholder="Search songs or artists" autocomplete="off">
  <div id="msg" role="status"></div>
  <ul id="results"></ul>
</div>
<script>
(() => {
  const base = location.pathname.replace(/^\\/jam\\//, '/api/jam/');
  const $ = (id) => document.getElementById(id);
  const who = $('who'), q = $('q'), msg = $('msg');
  try { who.value = localStorage.getItem('jam.name') || ''; } catch {}
  who.addEventListener('change', () => { try { localStorage.setItem('jam.name', who.value.trim()); } catch {} });
  const say = (t, kind) => { msg.textContent = t; msg.className = kind || ''; };
  const line = (s) => s.title + (s.artist ? ' · ' + s.artist : '');
  let canAdd = true;
  async function refresh() {
    try {
      const r = await fetch(base);
      if (r.status === 404) { document.querySelector('main').innerHTML = '<h1><span>●</span> Wavelength Jam</h1><p class="muted">This Jam has ended. Thanks for joining!</p>'; return; }
      const s = await r.json();
      canAdd = s.guestsAdd;
      $('now').textContent = s.now ? line(s.now) + (s.playing ? '' : ' (paused)') : 'Nothing yet';
      const next = $('next'); next.textContent = '';
      for (const t of s.next) { const li = document.createElement('li'); li.style.cssText = 'display:list-item;border:0;padding:2px 0'; li.textContent = line(t); next.append(li); }
      if (!s.next.length) next.innerHTML = '<li style="display:list-item;border:0;padding:2px 0">Nothing queued</li>';
      if (!canAdd) say('The host is choosing the songs right now.');
    } catch {}
    setTimeout(refresh, 5000);
  }
  let timer, seq = 0;
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); });
  async function search() {
    const text = q.value.trim(), mine = ++seq, list = $('results');
    if (text.length < 2) { list.textContent = ''; return; }
    const r = await fetch(base + '/search?q=' + encodeURIComponent(text)).then((x) => x.json()).catch(() => ({ songs: [] }));
    if (mine !== seq) return;
    list.textContent = '';
    if (!r.songs.length) { say('Nothing found. Try another spelling or the artist.'); return; }
    say('');
    for (const s of r.songs) {
      const li = document.createElement('li'), d = document.createElement('div'), b = document.createElement('b'), sm = document.createElement('small'), btn = document.createElement('button');
      b.textContent = s.title; sm.textContent = [s.artist, s.album].filter(Boolean).join(' · ');
      btn.textContent = 'Add'; btn.type = 'button';
      btn.onclick = () => add(s, btn);
      d.append(b, sm); li.append(d, btn); list.append(li);
    }
  }
  async function add(s, btn) {
    const name = who.value.trim();
    if (!name) { say('Type your name first, so the host knows who picked it.', 'bad'); who.focus(); return; }
    try { localStorage.setItem('jam.name', name); } catch {}
    btn.disabled = true;
    const r = await fetch(base + '/add', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: s.id, name }) }).catch(() => null);
    const body = r ? await r.json().catch(() => ({})) : {};
    if (r && r.ok) { btn.textContent = 'Added'; say('Added ' + s.title + '. It joins the queue in a moment.', 'ok'); setTimeout(refresh, 1500); }
    else { btn.disabled = false; say(r && r.status === 429 ? 'That’s a lot of songs! Wait a few minutes before adding more.' : (body.error || 'Couldn’t add it. Try again.'), 'bad'); }
  }
  refresh();
})();
</script></main></body></html>`;
}
