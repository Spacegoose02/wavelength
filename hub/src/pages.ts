import { esc } from './http.ts';

/** The few browser pages the Hub serves: first-run setup and approving a device. Styled like the app's Neon skin. */
export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Wavelength Hub</title>
<style>
  :root { color-scheme: dark; --bg:#0d0a1a; --panel:#17122b; --line:#2c2350; --text:#ece8ff; --muted:#a59fc4; --accent:#ff3df2; --accent2:#21e6ff; --bad:#ff5c7a; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:16px; background:radial-gradient(circle at 50% -20%, #2a1550, var(--bg) 60%); color:var(--text); font:16px/1.5 system-ui, sans-serif; }
  main { width:100%; max-width:420px; background:var(--panel); border:1px solid var(--line); border-radius:16px; padding:28px; box-shadow:0 0 40px #ff3df233; }
  h1 { margin:0 0 4px; font-size:22px; } h1 span { color:var(--accent); }
  p { color:var(--muted); margin:8px 0 16px; } p.err { color:var(--bad); }
  label { display:block; font-size:13px; color:var(--muted); margin:12px 0 4px; }
  input { width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--line); background:#0f0b20; color:var(--text); font-size:16px; }
  input.code { font:600 24px/1 ui-monospace, monospace; letter-spacing:.15em; text-align:center; text-transform:uppercase; }
  .row { display:flex; gap:10px; margin-top:20px; } .row > * { flex:1; }
  button, a.btn { display:block; text-align:center; padding:11px 14px; border-radius:10px; border:0; font:600 15px system-ui, sans-serif; cursor:pointer; text-decoration:none; background:linear-gradient(90deg, var(--accent), var(--accent2)); color:#120c24; }
  button.ghost, a.ghost { background:transparent; color:var(--text); border:1px solid var(--line); }
  .or { text-align:center; color:var(--muted); font-size:13px; margin:18px 0 0; }
  .device { padding:12px; border:1px dashed var(--line); border-radius:10px; margin:12px 0; }
</style></head>
<body><main><h1><span>●</span> Wavelength Hub</h1>${body}</main></body></html>`;
}

export const message = (title: string, text: string, error = false) => page(title, `<p class="${error ? 'err' : ''}">${esc(text)}</p>`);

export function setupPage(error = '') {
  return page(
    'Set up',
    `<p>No accounts yet. Create the first admin account.</p>
     ${error ? `<p class="err">${esc(error)}</p>` : ''}
     <form method="post" action="/setup">
       <label>Username</label><input name="username" autocomplete="username" required pattern="[a-zA-Z0-9][a-zA-Z0-9._\\-]{0,31}">
       <label>Display name</label><input name="displayName">
       <label>Password (at least 10 characters)</label><input name="password" type="password" autocomplete="new-password" required minlength="10">
       <div class="row"><button>Create admin</button></div>
     </form>`,
  );
}

/** Enter/confirm a pairing code, then sign in with SSO or a Hub password. */
export function linkPage(o: { code: string; device?: { name: string; platform: string }; sso: boolean; error?: string }) {
  const code = esc(o.code);
  const device = o.device
    ? `<div class="device">Sign in <b>${esc(o.device.name)}</b> (${esc(o.device.platform)})</div>`
    : '<p>Enter the code shown on your device.</p>';
  return page(
    'Sign in a device',
    `${device}
     ${o.error ? `<p class="err">${esc(o.error)}</p>` : ''}
     ${o.sso ? `<form method="get" action="/auth/sso/link"><input class="code" name="code" value="${code}" placeholder="XXXX-XXXX" required>
       <div class="row"><button>Continue with single sign-on</button></div></form>
       <p class="or">or sign in with a Hub password</p>` : ''}
     <form method="post" action="/link">
       ${o.sso ? `<input type="hidden" name="code" value="${code}">` : `<input class="code" name="code" value="${code}" placeholder="XXXX-XXXX" required>`}
       <label>Username</label><input name="username" autocomplete="username" required>
       <label>Password</label><input name="password" type="password" autocomplete="current-password" required>
       <div class="row"><button name="decision" value="approve">Sign in device</button></div>
     </form>`,
  );
}

/** SSO confirmation: the person is already signed in through tinyauth. */
export function ssoConfirmPage(o: { code: string; device: { name: string; platform: string }; who: string; csrf: string }) {
  return page(
    'Sign in a device',
    `<div class="device">Sign in <b>${esc(o.device.name)}</b> (${esc(o.device.platform)}) as <b>${esc(o.who)}</b>?</div>
     <p>Only allow this if you started signing in on that device just now.</p>
     <form method="post" action="/auth/sso/link">
       <input type="hidden" name="code" value="${esc(o.code)}"><input type="hidden" name="csrf" value="${esc(o.csrf)}">
       <div class="row"><button class="ghost" name="decision" value="deny">Deny</button><button name="decision" value="approve">Allow</button></div>
     </form>`,
  );
}
