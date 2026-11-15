import { useEffect, useState } from 'react';
import type { HubSsoSettings } from '../sources/hub';
import { hubClient } from '../store/hub';

/**
 * Settings → Users → Single sign-on (hub/src/sso.ts, docs/HUB.md "Single sign-on"): turn tinyauth on, set the
 * proxy secret and who's an admin, and copy the proxy config, filled in. Settings the container's environment
 * sets are shown but locked.
 */

const errText = (e: unknown) => String((e as Error)?.message ?? e);
const ENV: Record<string, string> = {
  enabled: 'WAVELENGTH_SSO',
  proxySecret: 'WAVELENGTH_PROXY_SECRET',
  trustedProxies: 'WAVELENGTH_TRUSTED_PROXIES',
  admins: 'WAVELENGTH_ADMINS',
  adminGroup: 'WAVELENGTH_ADMIN_GROUP',
  autoCreate: 'WAVELENGTH_SSO_AUTO_CREATE',
  name: 'WAVELENGTH_SSO_NAME',
};

type Draft = { enabled: boolean; name: string; proxySecret: string; trustedProxies: string; admins: string; adminGroup: string; autoCreate: boolean };
const toDraft = (s: HubSsoSettings): Draft => ({
  enabled: s.enabled || !!s.problem,
  name: s.name,
  proxySecret: s.proxySecret,
  trustedProxies: s.trustedProxies.join(', '),
  admins: s.admins.join(', '),
  adminGroup: s.adminGroup,
  autoCreate: s.autoCreate,
});

export function SsoAdmin() {
  const c = hubClient();
  const [s, setS] = useState<HubSsoSettings>();
  const [publicUrl, setPublicUrl] = useState('');
  const [draft, setDraft] = useState<Draft>();
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [layout, setLayout] = useState<'site' | 'path'>('site');

  const take = (r: { sso: HubSsoSettings; publicUrl: string }) => {
    setS(r.sso);
    setPublicUrl(r.publicUrl);
    setDraft(toDraft(r.sso));
  };
  useEffect(() => {
    c?.ssoSettings().then(take, (e) => setErr(errText(e))); // an older Hub has no settings here
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!c || !s || !draft) return err ? <section><h2>Single sign-on</h2><div className="errors">{err}</div></section> : null;

  const locked = (k: string) => s.locked.includes(k);
  const lockNote = (k: string) => (locked(k) ? <small className="muted"> · set by the container ({ENV[k]})</small> : null);
  const save = async () => {
    setErr('');
    setMsg('');
    const all: Record<string, unknown> = {
      enabled: draft.enabled,
      name: draft.name,
      proxySecret: draft.proxySecret,
      trustedProxies: draft.trustedProxies,
      admins: draft.admins,
      adminGroup: draft.adminGroup,
      autoCreate: draft.autoCreate,
    };
    const patch = Object.fromEntries(Object.entries(all).filter(([k]) => !locked(k)));
    try {
      take(await c.saveSsoSettings(patch as never));
      setMsg('Saved.');
    } catch (e) {
      setErr(errText(e));
    }
  };
  const generate = async () => {
    try {
      const { secret } = await c.newProxySecret();
      setDraft({ ...draft, proxySecret: secret });
      setShowSecret(true);
      setMsg('A new secret is filled in. Save, then paste the proxy config below into your proxy.');
    } catch (e) {
      setErr(errText(e));
    }
  };
  const config = proxyConfig(layout, publicUrl, draft.proxySecret);

  return (
    <section id="sso">
      <h2>Single sign-on</h2>
      <p className="muted small">
        Let people sign in through tinyauth (or another proxy login that sends <code>Remote-User</code>), next to Hub passwords. Every
        device then offers both: <b>Sign in with {draft.name || 'tinyauth'}</b> or a username and password. In a browser, the Hub's own page
        signs in by itself when tinyauth already knows you. Link a tinyauth name to a person under People (SSO), or to a whole family
        under Families → Family sign-ins.
      </p>
      <p className="small">
        Now: <b>{s.enabled ? 'on' : 'off'}</b>{s.problem ? <span className="errors"> · {s.problem}</span> : null}
      </p>
      <div className="editor">
        <label className="check">
          <span className="switch"><input type="checkbox" disabled={locked('enabled')} checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /><span /></span>
          Single sign-on{lockNote('enabled')}
        </label>
        <div className="editor-grid">
          <label>Button name{lockNote('name')}<input disabled={locked('name')} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="tinyauth" maxLength={60} /></label>
          <label>Proxy secret{lockNote('proxySecret')}
            <input type={showSecret ? 'text' : 'password'} disabled={locked('proxySecret')} value={draft.proxySecret} onChange={(e) => setDraft({ ...draft, proxySecret: e.target.value })} autoComplete="off" placeholder="Generate one" />
          </label>
          <div className="row gap span2">
            {!locked('proxySecret') && <button type="button" className="btn small" onClick={() => void generate()}>Generate</button>}
            <button type="button" className="btn small ghost" onClick={() => setShowSecret(!showSecret)}>{showSecret ? 'Hide' : 'Show'}</button>
            <small className="muted">The proxy sends it as <code>X-Wavelength-Proxy-Secret</code>. Without it, anyone who can reach the Hub's port could claim to be anyone.</small>
          </div>
          <label>Trusted proxy addresses (optional){lockNote('trustedProxies')}<input disabled={locked('trustedProxies')} value={draft.trustedProxies} onChange={(e) => setDraft({ ...draft, trustedProxies: e.target.value })} placeholder="172.17.0.1" /></label>
          <label>Always admins (tinyauth names){lockNote('admins')}<input disabled={locked('admins')} value={draft.admins} onChange={(e) => setDraft({ ...draft, admins: e.target.value })} placeholder="alex, sam" /></label>
          <label>Admin group (optional){lockNote('adminGroup')}<input disabled={locked('adminGroup')} value={draft.adminGroup} onChange={(e) => setDraft({ ...draft, adminGroup: e.target.value })} placeholder="wavelength-admins" /></label>
        </div>
        <label className="check">
          <span className="switch"><input type="checkbox" disabled={locked('autoCreate')} checked={draft.autoCreate} onChange={(e) => setDraft({ ...draft, autoCreate: e.target.checked })} /><span /></span>
          Make a profile for anyone tinyauth knows, the first time they sign in{lockNote('autoCreate')}
        </label>
        <p className="muted small">Off: you add people first (People → SSO, or a family sign-in), and strangers are turned away. Made a duplicate by accident? Merge it under People.</p>
        <div className="row gap"><button type="button" className="btn primary" onClick={() => void save()}>Save</button>{msg && <span className="ok">{msg}</span>}</div>
        {err && <div className="errors">{err}</div>}
      </div>

      <div className="editor">
        <h3>Proxy setup</h3>
        <p className="muted small">In Nginx Proxy Manager: your Hub's proxy host → Advanced → Custom Nginx Configuration. Change the Hub's and tinyauth's addresses and your tinyauth domain. docs/HUB.md has the details and other proxies.</p>
        <div className="row gap wrap">
          <button type="button" className={`btn small ${layout === 'site' ? 'primary' : ''}`} onClick={() => setLayout('site')}>Whole site behind tinyauth</button>
          <button type="button" className={`btn small ${layout === 'path' ? 'primary' : ''}`} onClick={() => setLayout('path')}>Only the sign-in page</button>
        </div>
        <p className="muted small">
          {layout === 'site'
            ? 'Like your other apps: the Wavelength page opens only through tinyauth. The apps, share links, invites and password pages skip it, because they sign in their own way.'
            : 'The Wavelength page opens without tinyauth and offers both sign-ins; only /auth/sso/ goes through tinyauth.'}
        </p>
        <pre className="hub-config"><code>{config}</code></pre>
        <button type="button" className="btn small" onClick={() => void navigator.clipboard?.writeText(config).then(() => setMsg('Proxy config copied.'), () => undefined)}>Copy</button>
      </div>
    </section>
  );
}

/** The Nginx Proxy Manager "Advanced" config for either layout. Kept the same as docs/HUB.md. */
export function proxyConfig(layout: 'site' | 'path', publicUrl: string, secret: string) {
  let host = 'hub.example.com';
  try {
    host = new URL(publicUrl).host || host;
  } catch {
    /* keep the example */
  }
  const auth = host.replace(/^[^.]+\./, 'auth.');
  const sso = `    auth_request /tinyauth;
    error_page 401 = @tinyauth_login;
    # who tinyauth signed in, passed to the Hub (these replace anything the browser sent)
    auth_request_set $tinyauth_user   $upstream_http_remote_user;
    auth_request_set $tinyauth_name   $upstream_http_remote_name;
    auth_request_set $tinyauth_email  $upstream_http_remote_email;
    auth_request_set $tinyauth_groups $upstream_http_remote_groups;
    proxy_set_header Remote-User   $tinyauth_user;
    proxy_set_header Remote-Name   $tinyauth_name;
    proxy_set_header Remote-Email  $tinyauth_email;
    proxy_set_header Remote-Groups $tinyauth_groups;
    proxy_set_header X-Wavelength-Proxy-Secret "${secret || 'paste-the-proxy-secret-here'}";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_pass http://192.168.1.10:7780;   # the Hub
`;
  const tail = `
location = /tinyauth {
    internal;
    proxy_pass http://192.168.1.10:3000/api/auth/nginx;   # tinyauth
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $http_host;
    proxy_set_header X-Forwarded-Uri $request_uri;
}

location @tinyauth_login {
    return 302 https://${auth}/login?redirect_uri=$scheme://$http_host$request_uri;
}`;
  if (layout === 'path') return `location /auth/sso/ {\n${sso}}\n${tail}`;
  return `# the Wavelength page and everything not listed below: tinyauth first
location / {
${sso}}

# the apps, share links, invites and password pages sign in their own way: no tinyauth
location ~ ^/(api|auth|nd|s|jam|invite)/|^/(link|setup)$ {
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_pass http://192.168.1.10:7780;   # the Hub
}

# ...except the single sign-on pages, which are tinyauth's
location ^~ /auth/sso/ {
${sso}}
${tail}`;
}
