import { Qr } from '../components/Qr';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { syncNow } from '../lib/hubSync';
import { loadHubServices } from '../lib/hubServices';
import { recheckLibrary, runExplicitCheck, stopExplicitCheck, useExplicitCheck } from '../lib/explicitCheck';
import { isTauri } from '../lib/http';
import { flagVersionLabel, loadFlags, removeFlag, useFlags, useRatings } from '../lib/kids';
import { today } from '../lib/kidTime';
import { notifyAllowed, notifySupported } from '../lib/notify';
import { isAndroid } from '../lib/platform';
import { ProfileSwitcher } from '../components/ProfileSwitcher';
import { FamiliesAdmin, ServiceFamilies } from './Families';
import { SwitchPinSetting } from '../components/WhosListening';
import { HubClient, HubError, type HubPush, type HubPublicLink, type HubSession, type HubAccess as Access, type HubAdminService, type HubAdminUser, type HubAuditEntry, type HubAppLogin, type HubDevice, type HubHealth, type HubInvite, type HubPairing, type HubRole, type HubScrobbleAccount, type KidRules } from '../sources/hub';
import { hubClient, sameFamily, thisDevice, useHub } from '../store/hub';
import { useFeature } from '../lib/features';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';

/** Settings → Account (sign in to a Wavelength Hub) and Settings → Users (Hub admins). See docs/HUB.md. */

const ROLE_LABELS: Record<HubRole, string> = { admin: 'Admin', member: 'Member', kid: 'Kid' };
const errText = (e: unknown) => String((e as Error)?.message ?? e);
const when = (t?: number | null) => (t ? new Date(t).toLocaleString() : 'never');

/** Shows a pairing code and waits for it to be approved in a browser. */
function Pairing({ client, onDone, take }: { client: HubClient; onDone(): void; take?: (s: HubSession) => void }) {
  const signedIn = useHub((s) => s.signedIn);
  const takeRef = useRef(take);
  takeRef.current = take;
  const [p, setP] = useState<HubPairing>();
  const [err, setErr] = useState('');
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    (async () => {
      try {
        const pairing = await client.startPairing(thisDevice());
        if (!alive.current) return;
        setP(pairing);
        const poll = async () => {
          try {
            const s = await client.pollPairing(pairing.deviceCode);
            if (!alive.current) return;
            if (s) {
              (takeRef.current ?? signedIn)(s);
              onDone();
            } else timer = setTimeout(poll, pairing.interval * 1000);
          } catch (e) {
            if (!alive.current) return;
            if (e instanceof HubError) setErr(e.message);
            else timer = setTimeout(poll, pairing.interval * 2000); // offline for a moment: keep waiting
          }
        };
        timer = setTimeout(poll, pairing.interval * 1000);
      } catch (e) {
        setErr(errText(e));
      }
    })();
    return () => {
      alive.current = false;
      clearTimeout(timer);
    };
  }, [client, signedIn, onDone]);

  if (err) return <div className="errors">{err}</div>;
  if (!p) return <p className="muted">Getting a code…</p>;
  return (
    <div className="hub-pair">
      <Qr text={p.verificationUrlComplete} />
      <div>
        <p>Scan the code with your phone, or open <b>{p.verificationUrl}</b> in any browser and enter:</p>
        <div className="hub-code">{p.userCode}</div>
        <p className="muted small">Sign in there with single sign-on or your Hub password, then allow this device. The code works for {Math.round(p.expiresIn / 60)} minutes.</p>
      </div>
    </div>
  );
}

/** Signing in; with `adding`, a second person on this device (ProfileSwitcher) and `onCancel` to go back. */
export function SignedOut({ adding, onCancel }: { adding?: boolean; onCancel?: () => void } = {}) {
  const { url, setUrl, signedIn: first, addProfile } = useHub();
  const [err, setErr] = useState('');
  const me = useHub((s) => s.user);
  // someone added to this device has to be in the same family: switching never crosses families
  const signedIn = adding ? (s: HubSession) => {
    if (!sameFamily(me, s.user)) {
      void new HubClient(url, s.token).logout().catch(() => undefined);
      setErr(`${s.user.displayName} is in another family, so they can't be added to this device's profiles.`);
      return;
    }
    addProfile(s);
    onCancel?.();
  } : first;
  const [draft, setDraft] = useState(url);
  const [health, setHealth] = useState<HubHealth>();
  const [mode, setMode] = useState<'code' | 'password' | 'invite' | null>(null);
  const [form, setForm] = useState({ username: '', password: '', displayName: '' });
  const [invite, setInvite] = useState('');
  /** The Hub asked for a two-step code after the password. */
  const [needOtp, setNeedOtp] = useState(false);
  const [otp, setOtp] = useState('');
  const client = useMemo(() => new HubClient(url), [url]);

  const connect = async (e?: FormEvent) => {
    e?.preventDefault();
    setErr('');
    setHealth(undefined);
    setMode(null);
    // an invite link pasted as the address: connect to its Hub and fill the invite in
    const inv = /^(.*?)\/invite\/([\w-]+)/.exec(draft.trim());
    const address = inv ? inv[1] : draft;
    try {
      const h = await new HubClient(address).health();
      if (h.ok !== true) throw new Error("That address answered, but it isn't a Wavelength Hub");
      setUrl(address.trim().replace(/\/+$/, ''));
      if (inv) {
        setDraft(inv[1]);
        setInvite(inv[2]);
        setMode('invite');
      }
      setHealth(h);
    } catch (e) {
      setErr(`Couldn't reach a Hub there: ${errText(e)}`);
    }
  };
  useEffect(() => {
    if (url) connect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      signedIn(
        health?.setupNeeded ? await client.setup({ ...form, ...thisDevice() })
        : mode === 'invite' ? await client.acceptInvite({ ...form, code: invite.trim(), ...thisDevice() })
        : await client.login({ ...form, ...(otp.trim() && { otp: otp.trim() }), ...thisDevice() }),
      );
    } catch (e) {
      if (e instanceof HubError && e.twoFactor) setNeedOtp(true);
      setErr(errText(e));
    }
  };

  return (
    <section>
      <h2>{adding ? 'Add someone to this device' : 'Wavelength Hub'}</h2>
      {adding && <button className="btn small ghost" onClick={onCancel}>← Back</button>}
      <p className="muted small">
        A Hub gives everyone in the house their own profile: their own settings on every device, and admin-only controls that
        really are admin-only. It's optional; without one Wavelength works as before. Downloaded music always plays, signed in or not.
      </p>
      <form className="editor" onSubmit={connect}>
        <div className="editor-grid">
          <label className="span2">Hub address<input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="https://hub.example.com" required /></label>
        </div>
        <div className="row gap"><button className="btn">Connect</button>{health && <span className="ok">✓ Wavelength Hub {health.version}</span>}</div>
      </form>
      {err && <div className="errors">{err}</div>}

      {health?.setupNeeded && (
        <form className="editor" onSubmit={submit}>
          <h3>Set up this Hub</h3>
          <p className="muted small">It has no accounts yet. Create the first admin account (you).</p>
          <div className="editor-grid">
            <label>Username<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></label>
            <label>Display name<input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></label>
            <label className="span2">Password (at least 10 characters)<input type="password" minLength={10} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required autoComplete="new-password" /></label>
          </div>
          <div className="row gap"><button className="btn primary">Create admin and sign in</button></div>
        </form>
      )}

      {health && !health.setupNeeded && (
        <div className="editor">
          <div className="row gap wrap">
            <button className={`btn ${mode === 'code' ? 'primary' : ''}`} onClick={() => setMode('code')}>Sign in with a code{health.sso ? ' (single sign-on)' : ''}</button>
            <button className={`btn ${mode === 'password' ? 'primary' : ''}`} onClick={() => setMode('password')}>Sign in with a password</button>
            <button className={`btn ${mode === 'invite' ? 'primary' : ''}`} onClick={() => setMode('invite')}>I have an invite</button>
          </div>
          {mode === 'code' && <Pairing client={client} onDone={() => setMode(null)} take={adding ? signedIn : undefined} />}
          {mode === 'password' && (
            <form onSubmit={submit}>
              <div className="editor-grid">
                <label>Username<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required autoComplete="username" /></label>
                <label>Password<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required autoComplete="current-password" /></label>
                {needOtp && <label className="span2">Code from your authenticator app (or a recovery code)<input value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" autoComplete="one-time-code" autoFocus required /></label>}
              </div>
              <div className="row gap" style={{ marginTop: 12 }}><button className="btn primary">Sign in</button></div>
            </form>
          )}
          {mode === 'invite' && (
            <form onSubmit={submit}>
              <p className="muted small">Paste the invite link you were sent, then pick your username and password.</p>
              <div className="editor-grid">
                <label className="span2">Invite link<input value={invite} onChange={(e) => setInvite(e.target.value)} required placeholder={`${url}/invite/…`} /></label>
                <label>Your name<input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></label>
                <label>Username<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required autoComplete="username" /></label>
                <label className="span2">Password (at least 10 characters)<input type="password" minLength={10} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required autoComplete="new-password" /></label>
              </div>
              <div className="row gap" style={{ marginTop: 12 }}><button className="btn primary">Make my account</button></div>
            </form>
          )}
        </div>
      )}
    </section>
  );
}

/** Whether this device shows up under Devices on the person's others (lib/remote.ts). */
function RemoteSetting() {
  const on = useSettings((s) => s.remoteControl);
  return (
    <div className="editor">
      <h3>Devices</h3>
      <p className="muted small">
        The Devices button by the volume shows your other devices that are open: see what they're playing, control them, or move
        playback between them ("Continue there", "Play here"). Only your own devices can see each other.
      </p>
      <label className="check">
        <span className="switch"><input type="checkbox" checked={on} onChange={(e) => useSettings.getState().setRemoteControl(e.target.checked)} /><span /></span>
        Let my other devices see and control this one
      </label>
      <ShareListeningSetting />
    </div>
  );
}

/** House activity (lib/houseActivity.ts): the sidebar's "Listening now" for the others. */
function ShareListeningSetting() {
  const v = useSettings((s) => s.shareListening);
  const kid = useHub((s) => s.user?.role === 'kid');
  const on = v ?? !kid;
  return (
    <>
      <label className="check">
        <span className="switch"><input type="checkbox" checked={on} onChange={(e) => useSettings.getState().setShareListening(e.target.checked)} /><span /></span>
        Show the house what I'm playing
      </label>
      <p className="muted small">
        {kid
          ? 'Your grown-ups see the song you’re playing under “Listening now” in their sidebar. Nobody else does.'
          : 'People in the house see the song you’re playing under “Listening now” in their sidebar (the song’s name, never what you played before).'}
      </p>
    </>
  );
}

/** Home Assistant (docs/HOME-ASSISTANT.md): a token of its own, shown once, revoked from the devices list. */
function HomeAssistantSetting() {
  const [made, setMade] = useState<{ token: string; url: string }>();
  const [err, setErr] = useState('');
  const connect = async () => {
    setErr('');
    try {
      setMade(await hubClient()!.connectHomeAssistant());
    } catch (e) {
      setErr(errText(e));
    }
  };
  return (
    <div className="editor">
      <h3>Home Assistant</h3>
      <p className="muted small">
        Show what your devices are playing in Home Assistant and control them from it: pause the music when the doorbell rings, turn it down at
        bedtime, or put play/pause on a dashboard. Make a token, then paste it into Home Assistant (the guide in docs/HOME-ASSISTANT.md has the
        setup to copy). Remove it any time under your devices, where it shows as "Home Assistant".
      </p>
      {made ? (
        <>
          <p className="small">Hub address: <code>{made.url}</code></p>
          <p className="small">Token (shown only now):</p>
          <code className="ha-token">{made.token}</code>
          <div className="row gap">
            <button type="button" className="btn small" onClick={() => void navigator.clipboard?.writeText(made.token).catch(() => undefined)}>Copy token</button>
          </div>
        </>
      ) : (
        <button type="button" className="btn small" onClick={() => void connect()}>Make a Home Assistant token</button>
      )}
      {err && <div className="errors">{err}</div>}
    </div>
  );
}

/** System notifications for Inbox news (lib/notify.ts). */
function NotifySetting() {
  const on = useSettings((s) => s.notifications);
  const approver = useHub((s) => s.permissions.includes('requests.approve'));
  const [msg, setMsg] = useState('');
  if (!notifySupported()) return null;
  const toggle = async (v: boolean) => {
    setMsg('');
    useSettings.getState().setNotifications(v);
    if (v && !(await notifyAllowed(true).catch(() => false))) {
      setMsg(isTauri ? 'Notifications are turned off for Wavelength in your system settings.' : 'Your browser blocks notifications from this page. Allow them in the site settings.');
    }
  };
  return (
    <div className="editor">
      <h3>Notifications</h3>
      <p className="muted small">
        When Wavelength isn't in front: a request that's ready or was turned down, something shared with you
        {approver ? ', and new requests waiting for you' : ''}.
        {isTauri && isAndroid ? ' On Android they come while the app is open or playing in the background.' : ''}
      </p>
      <label className="check">
        <span className="switch"><input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} /><span /></span>
        Notify me on this device
      </label>
      {msg && <p className="small">{msg}</p>}
      <PushSetting />
    </div>
  );
}

/** Push through ntfy (hub/src/push.ts): news on the phone while Wavelength is closed. */
function PushSetting() {
  const [p, setP] = useState<HubPush | null>();
  const [msg, setMsg] = useState('');
  const c = hubClient()!;
  useEffect(() => {
    c.push().then(setP, () => setP(null)); // an older Hub has no push
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p) return null;
  const run = async (f: () => Promise<unknown>, done = '') => {
    setMsg('…');
    try {
      await f();
      setMsg(done);
    } catch (e) {
      setMsg(errText(e));
    }
  };
  return (
    <>
      <h4>When Wavelength is closed</h4>
      {!p.available ? (
        <p className="muted small">Your Hub can send these through the free ntfy app, so they arrive while Wavelength is closed. An admin turns it on under Settings → Server → Push notifications.</p>
      ) : !p.topic ? (
        <>
          <p className="muted small">Get them through the free <b>ntfy</b> app (Android, iPhone, desktop), even while Wavelength is closed. Your Hub sends them to {new URL(p.server!).host}.</p>
          <button className="btn small" onClick={() => run(async () => setP(await c.pushOn()))}>Turn on</button>
        </>
      ) : (
        <>
          <p className="muted small">
            Install <b>ntfy</b>, then scan this or tap <b>Subscribe in ntfy</b> on the phone. Keep the topic to yourself: whoever
            knows it can read your notifications{p.server?.includes('ntfy.sh') ? ' on ntfy.sh' : ''}.
          </p>
          <div className="hub-pair">
            <Qr text={p.subscribeUrl!} />
            <div>
              <p className="small">Server <b className="selectable">{p.server}</b><br />Topic <b className="selectable">{p.topic}</b></p>
              <div className="row gap wrap">
                <a className="btn small primary" href={p.subscribeUrl!} onClick={(e) => {
                  // the Android app's WebView doesn't follow ntfy:// links itself
                  const native = window.WavelengthNative;
                  if (!native?.openNtfy) return;
                  e.preventDefault();
                  if (!native.openNtfy(p.subscribeUrl!)) setMsg('Install ntfy from Google Play or F-Droid first, then tap this again.');
                }}>Subscribe in ntfy</a>
                <button className="btn small" onClick={() => run(() => c.pushTest(), '✓ Sent. It should be on your phone now.')}>Send a test</button>
                <button className="btn small ghost" title="A new topic: anyone subscribed to the old one stops getting them" onClick={() => run(async () => setP(await c.pushOn()), '✓ New topic. Subscribe to it again in ntfy.')}>New topic</button>
                <button className="btn small ghost" onClick={() => run(async () => setP(await c.pushOff()))}>Turn off</button>
              </div>
            </div>
          </div>
        </>
      )}
      {msg && <p className="small">{msg}</p>}
    </>
  );
}

/** Link a tinyauth identity to this account: a one-time link opened in a browser where tinyauth signs you in. */
function SsoLink() {
  const { user, refresh } = useHub();
  const [link, setLink] = useState<string>();
  const [msg, setMsg] = useState('');
  if (!user) return null;
  const c = hubClient()!;
  return (
    <div className="editor">
      <h3>Single sign-on</h3>
      {user.ssoSubject ? (
        <div className="row gap wrap">
          <span>Linked to tinyauth user <b>{user.ssoSubject}</b>.</span>
          {user.hasPassword && (
            <button className="btn small ghost" onClick={async () => {
              if (!confirm('Unlink single sign-on? You will sign in with your Hub password only.')) return;
              try {
                await c.unlinkSso();
                await refresh();
              } catch (e) {
                setMsg(errText(e));
              }
            }}>Unlink</button>
          )}
        </div>
      ) : link ? (
        <div className="hub-pair">
          <Qr text={link} />
          <div>
            <p>Open this link in a browser where you can sign in to tinyauth (scan it with your phone, or copy it):</p>
            <input readOnly value={link} onFocus={(e) => e.target.select()} style={{ width: '100%' }} />
            <p className="muted small">After you press Link there, come back and press Done. The link works once, for 10 minutes.</p>
            <div className="row gap">
              <button className="btn" onClick={() => navigator.clipboard?.writeText(link)}>Copy link</button>
              <button className="btn primary" onClick={async () => {
                await refresh();
                setLink(undefined);
              }}>Done</button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <p className="muted small">Link your tinyauth account so you can sign in to Wavelength with single sign-on instead of your Hub password.</p>
          <div className="row gap">
            <button className="btn" onClick={async () => {
              setMsg('');
              try {
                setLink((await c.ssoLink()).url);
              } catch (e) {
                setMsg(errText(e));
              }
            }}>Link single sign-on</button>
          </div>
        </>
      )}
      {msg && <div className="errors">{msg}</div>}
    </div>
  );
}

/**
 * Scrobbling (hub/src/scrobble.ts): the Hub sends every song you play to ListenBrainz and, when the Hub has a
 * Last.fm API account, Last.fm. Older Hubs have no such route, so this hides itself there.
 */
function ScrobbleSetting() {
  const [state, setState] = useState<{ accounts: HubScrobbleAccount[]; lastfmAvailable: boolean } | null>();
  const [lb, setLb] = useState('');
  const [fm, setFm] = useState({ username: '', password: '' });
  const [msg, setMsg] = useState('');
  const c = hubClient()!;
  const load = () => c.scrobbleAccounts().then(setState, (e) => setState(e instanceof HubError && e.status === 404 ? null : undefined));
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!state) return null;

  const run = async (f: () => Promise<unknown>, done: string) => {
    setMsg('…');
    try {
      await f();
      await load();
      setMsg(done);
    } catch (e) {
      setMsg(errText(e));
    }
  };
  const account = (service: HubScrobbleAccount['service']) => state.accounts.find((a) => a.service === service);
  const row = (a: HubScrobbleAccount, label: string) => (
    <div className="source-row">
      <div className="track-main">
        <div className="track-title">{label} · {a.username}</div>
        <div className="track-sub">{a.error ? <span className="error-text">{a.error}</span> : `Sending your plays since ${new Date(a.connectedAt).toLocaleDateString()}`}</div>
      </div>
      <button className="btn small ghost" onClick={() => run(() => c.disconnectScrobble(a.service), `✓ ${label} disconnected`)}>Disconnect</button>
    </div>
  );
  const listenbrainz = account('listenbrainz');
  const lastfm = account('lastfm');

  return (
    <div className="editor">
      <h3>Scrobbling</h3>
      <p className="muted small">Your Hub sends each song you play (not radio, podcasts or books) to these, about once a minute. Plays made offline are sent when this device next reaches the Hub.</p>
      {listenbrainz ? row(listenbrainz, 'ListenBrainz') : (
        <form className="row gap" onSubmit={(e) => { e.preventDefault(); void run(() => c.connectListenBrainz(lb.trim()).then(() => setLb('')), '✓ ListenBrainz connected'); }}>
          <input type="password" placeholder="ListenBrainz user token" value={lb} onChange={(e) => setLb(e.target.value)} autoComplete="off" />
          <button className="btn small" disabled={!lb.trim()}>Connect ListenBrainz</button>
          <a className="link small" href="https://listenbrainz.org/settings/" target="_blank" rel="noreferrer">Get your token</a>
        </form>
      )}
      {lastfm ? row(lastfm, 'Last.fm') : state.lastfmAvailable ? (
        <form className="row gap" onSubmit={(e) => { e.preventDefault(); void run(() => c.connectLastfm(fm.username.trim(), fm.password).then(() => setFm({ username: '', password: '' })), '✓ Last.fm connected'); }}>
          <input placeholder="Last.fm username" value={fm.username} onChange={(e) => setFm({ ...fm, username: e.target.value })} autoComplete="off" />
          <input type="password" placeholder="Password" value={fm.password} onChange={(e) => setFm({ ...fm, password: e.target.value })} autoComplete="off" />
          <button className="btn small" disabled={!fm.username.trim() || !fm.password}>Connect Last.fm</button>
        </form>
      ) : <p className="muted small">Last.fm: your Hub admin needs to add a Last.fm API account first (docs/HUB.md).</p>}
      {lastfm || state.lastfmAvailable ? <p className="muted small">The Hub logs in to Last.fm once and keeps only the session it gets back, never your password.</p> : null}
      {msg && <span className="muted small">{msg}</span>}
    </div>
  );
}

/**
 * Two-step sign-in (hub/src/totp.ts): a 6-digit code from an authenticator app after the password, for
 * password sign-ins. Recommended for admins, whose account can change everything.
 */
function TwoFactorSetting({ admin }: { admin: boolean }) {
  const c = hubClient()!;
  const [state, setState] = useState<{ enabled: boolean; recoveryLeft: number } | null>();
  const [step, setStep] = useState<'idle' | 'password' | 'scan' | 'codes' | 'off'>('idle');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<{ secret: string; uri: string }>();
  const [codes, setCodes] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  const load = () => c.twoFactor().then(setState, (e) => setState(e instanceof HubError && e.status === 404 ? null : undefined));
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!state) return null;

  const run = async (f: () => Promise<void>) => {
    setMsg('');
    try {
      await f();
    } catch (e) {
      setMsg(errText(e));
    }
  };
  const reset = () => {
    setStep('idle');
    setPassword('');
    setCode('');
    setSetup(undefined);
  };

  return (
    <div className="editor">
      <h3>Two-step sign-in</h3>
      {state.enabled ? (
        <p className="muted small">On. Signing in with your password also needs a code from your authenticator app. {state.recoveryLeft} recovery code{state.recoveryLeft === 1 ? '' : 's'} left.</p>
      ) : (
        <p className="muted small">After your password, also ask for a 6-digit code from an app on your phone (Google Authenticator, 1Password, Aegis…), so a leaked password alone can't get in.{admin ? ' Recommended for admins.' : ''} Signing in with single sign-on isn't affected.</p>
      )}
      {msg && <div className="errors">{msg}</div>}

      {step === 'idle' && (
        <div className="row gap">
          {state.enabled ? <button className="btn ghost" onClick={() => setStep('off')}>Turn off</button> : <button className="btn" onClick={() => setStep('password')}>Turn on</button>}
        </div>
      )}

      {step === 'password' && (
        <form className="row gap" onSubmit={(e) => { e.preventDefault(); void run(async () => { setSetup(await c.twoFactorSetup(password)); setPassword(''); setStep('scan'); }); }}>
          <input type="password" placeholder="Your Hub password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          <button className="btn">Continue</button>
          <button type="button" className="btn ghost" onClick={reset}>Cancel</button>
        </form>
      )}

      {step === 'scan' && setup && (
        <form onSubmit={(e) => { e.preventDefault(); void run(async () => { setCodes((await c.twoFactorEnable(code)).recoveryCodes); setStep('codes'); await load(); }); }}>
          <p className="small">Scan this with your authenticator app, or type the key into it. Then enter the code it shows.</p>
          <Qr text={setup.uri} />
          <p className="small"><code className="selectable">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code></p>
          <div className="row gap">
            <input placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" required />
            <button className="btn primary">Turn on</button>
            <button type="button" className="btn ghost" onClick={reset}>Cancel</button>
          </div>
        </form>
      )}

      {step === 'codes' && (
        <div>
          <p className="small"><b>Two-step sign-in is on.</b> Keep these recovery codes somewhere safe (a password manager or on paper). Each one works once instead of a code, if you lose your phone. They won't be shown again.</p>
          <pre className="recovery-codes selectable">{codes.join('\n')}</pre>
          <div className="row gap">
            <button className="btn" onClick={() => void navigator.clipboard?.writeText(codes.join('\n'))}>Copy</button>
            <button className="btn primary" onClick={() => { setCodes([]); reset(); }}>I've saved them</button>
          </div>
        </div>
      )}

      {step === 'off' && (
        <form className="row gap wrap" onSubmit={(e) => { e.preventDefault(); void run(async () => { await c.twoFactorOff(password, code); reset(); await load(); }); }}>
          <input type="password" placeholder="Your Hub password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          <input placeholder="Code or recovery code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" required />
          <button className="btn">Turn off</button>
          <button type="button" className="btn ghost" onClick={reset}>Cancel</button>
        </form>
      )}
    </div>
  );
}

function SignedIn() {
  const { url, user, permissions, offline, lastSeen, signOut, refresh } = useHub();
  const [adding, setAdding] = useState(false);
  const [devices, setDevices] = useState<(HubDevice & { current: boolean })[]>([]);
  const [msg, setMsg] = useState('');
  const [pw, setPw] = useState({ current: '', next: '' });
  const c = hubClient()!;
  const loadDevices = () => c.myDevices().then((r) => setDevices(r.devices), () => undefined);
  useEffect(() => {
    refresh();
    loadDevices();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!user) return null;
  if (adding) return <SignedOut adding onCancel={() => setAdding(false)} />;

  return (
    <section>
      <h2>Wavelength Hub</h2>
      <div className="source-row">
        <div className="hub-avatar">{user.displayName.slice(0, 1).toUpperCase()}</div>
        <div className="track-main">
          <div className="track-title">{user.displayName} <span className="chip">{ROLE_LABELS[user.role]}</span></div>
          <div className="track-sub">@{user.username} · {url} · {offline ? `can't reach the Hub (last contact ${when(lastSeen)})` : 'connected'}</div>
        </div>
        <button className="btn small ghost" onClick={() => confirm('Sign out of the Hub on this device?') && signOut()}>Sign out</button>
      </div>

      <SwitchPinSetting />
      <ProfileSwitcher onAdd={() => setAdding(true)} />

      <div className="editor">
        <h3>Settings sync</h3>
        <p className="muted small">Your theme, equalizer, Now Playing scene, radio stations and Discover chart picks follow you to every device you sign in on. Plex, Audiobookshelf, SUB/WAVE, your own Navidrome login and download logins kept on the Hub arrive too (Settings → Sources and Downloads).</p>
        <div className="row gap">
          <button className="btn" onClick={async () => {
            setMsg('Syncing…');
            try {
              await syncNow();
              setMsg(useHub.getState().offline ? "Can't reach the Hub right now; changes will sync when it's back." : '✓ Synced');
            } catch (e) {
              setMsg(errText(e));
            }
          }}>Sync now</button>
          {msg && <span className="muted">{msg}</span>}
        </div>
      </div>

      <RemoteSetting />
      {user.role !== 'kid' && <HomeAssistantSetting />}
      <NotifySetting />
      <ScrobbleSetting />

      <PublicLinks />
      <AppLogins url={url} />

      <SsoLink />
      {user.hasPassword && <TwoFactorSetting admin={user.role === 'admin'} />}

      {user.hasPassword && (
        <form className="editor" onSubmit={async (e) => {
          e.preventDefault();
          try {
            await c.changePassword(pw.current, pw.next);
            setPw({ current: '', next: '' });
            setMsg('✓ Password changed');
          } catch (e) {
            setMsg(errText(e));
          }
        }}>
          <h3>Hub password</h3>
          <div className="editor-grid">
            <label>Current password<input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required autoComplete="current-password" /></label>
            <label>New password (at least 10 characters)<input type="password" minLength={10} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required autoComplete="new-password" /></label>
          </div>
          <div className="row gap"><button className="btn">Change password</button></div>
        </form>
      )}

      <h3>Your devices</h3>
      {devices.filter((d) => d.platform !== 'subsonic-app').map((d) => (
        <div key={d.id} className="source-row">
          <div className="track-main">
            <div className="track-title">{d.name}{d.current ? <span className="muted small"> · this device</span> : null}</div>
            <div className="track-sub">{d.platform} · last seen {when(d.lastSeenAt)}</div>
          </div>
          {!d.current && <button className="btn small ghost" onClick={async () => {
            await c.signOutMyDevice(d.id);
            loadDevices();
          }}>Sign out</button>}
        </div>
      ))}
      {permissions.includes('users.manage') && <p className="muted small">You're an admin: manage people in the Users tab.</p>}
    </section>
  );
}

/**
 * Logins for other music apps (hub/src/routes/services.ts app-logins): SUB/WAVE, Symfonium, Feishin and the like sign
 * in to the Hub's Subsonic address with these, so they keep working with Navidrome off.
 */
function AppLogins({ url }: { url: string }) {
  const c = hubClient();
  const [st, setSt] = useState<{ available: boolean; logins: HubAppLogin[] }>();
  const [name, setName] = useState('');
  const [shown, setShown] = useState<number>();
  const [msg, setMsg] = useState('');
  const [loadErr, setLoadErr] = useState('');
  const load = () => c?.appLogins().then((r) => { setSt(r); setLoadErr(''); }).catch((e) => setLoadErr(errText(e)));
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const base = url.replace(/\/+$/, '');
  const intro = (
    <>
      <h3>Other music apps</h3>
      <p className="muted small">
        SUB/WAVE, Symfonium, Feishin and other Subsonic apps can play your library from the Hub. Make a login for each
        app, then put the address, username and password in it (for SUB/WAVE: NAVIDROME_URL, NAVIDROME_USER and
        NAVIDROME_PASSWORD). Remove one to sign that app out.
      </p>
    </>
  );
  // Shown even when logins can't be made, with the reason, so the section is easy to find.
  if (!st?.available) {
    return (
      <div className="editor">
        {intro}
        <p className="small">
          {loadErr
            ? `Couldn't ask the Hub for app logins: ${loadErr}. An older Hub doesn't have them; update it.`
            : st
              ? 'Not available yet: turn Navidrome off, or turn on “Send everyone through the Hub”, in Settings → Server → Music catalog.'
              : 'Loading…'}
        </p>
      </div>
    );
  }
  return (
    <div className="editor">
      {intro}
      {st.logins.map((l) => (
        <div key={l.id} className="source-row">
          <div className="track-main">
            <div className="track-title">{l.name}</div>
            <div className="track-sub">
              Address <code>{base}</code> · Username <code>{l.username}</code> · Password{' '}
              {shown === l.id ? <code>{l.password}</code> : <button className="btn small ghost" onClick={() => setShown(l.id)}>Show</button>}
            </div>
          </div>
          <button className="btn small ghost" onClick={async () => {
            if (!confirm(`Remove the login for ${l.name}? That app stops working until it gets a new one.`)) return;
            await c!.signOutMyDevice(l.id);
            load();
          }}>Remove</button>
        </div>
      ))}
      <form className="row gap" onSubmit={async (e) => {
        e.preventDefault();
        setMsg('');
        try {
          const r = await c!.addAppLogin(name);
          setName('');
          setShown(r.login.id);
          load();
        } catch (err) {
          setMsg(errText(err));
        }
      }}>
        <input placeholder="App name, like SUB/WAVE" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required />
        <button className="btn">Add login</button>
        {msg && <span className="errors small">{msg}</span>}
      </form>
    </div>
  );
}

/** Your public share links (ShareButton → Anyone with the link): who's opened them, and take them down. */
function PublicLinks() {
  const on = useFeature('publicShares');
  const [links, setLinks] = useState<HubPublicLink[]>();
  const c = hubClient();
  const load = () => c?.publicLinks().then((r) => setLinks(r.links)).catch(() => setLinks([]));
  useEffect(() => {
    if (on) load();
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!on || !links?.length) return null;
  return (
    <div className="editor">
      <h3>Your public links</h3>
      <p className="muted small">Pages anyone with the link can open (song names only, never the music itself). They work for people who can reach this Hub's address.</p>
      {links.map((l) => {
        const gone = l.expiresAt !== null && l.expiresAt < Date.now();
        return (
          <div key={l.token} className="source-row">
            <div className="track-main">
              <div className="track-title">{l.title}</div>
              <div className="track-sub">{l.kind}{l.songs ? ` · ${l.songs} songs` : ''} · opened {l.views} time{l.views === 1 ? '' : 's'} · {gone ? 'expired' : l.expiresAt ? `until ${new Date(l.expiresAt).toLocaleDateString()}` : 'no end date'}</div>
            </div>
            {l.url && !gone && <button className="btn small" onClick={() => navigator.clipboard?.writeText(l.url!).catch(() => undefined)}>Copy</button>}
            <button className="btn small ghost" onClick={async () => { await c?.deletePublicLink(l.token); load(); }}>Take down</button>
          </div>
        );
      })}
    </div>
  );
}

export function AccountTab() {
  const signedIn = useHub((s) => !!s.token);
  return signedIn ? <SignedIn /> : <SignedOut />;
}

const EMPTY_USER = { username: '', displayName: '', role: 'member' as HubRole, password: '', ssoSubject: '' };

/** Settings → Users: only shown to Hub admins, and the Hub refuses every call here from anyone else. */
export function UsersTab() {
  const me = useHub((s) => s.user);
  const canAudit = useHub((s) => s.permissions.includes('audit.view'));
  const [users, setUsers] = useState<HubAdminUser[]>([]);
  const [devices, setDevices] = useState<(HubDevice & { displayName?: string })[]>([]);
  const [audit, setAudit] = useState<HubAuditEntry[]>([]);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(EMPTY_USER);
  const c = hubClient();

  const load = async () => {
    if (!c) return;
    try {
      const [u, d] = await Promise.all([c.users(), c.devices()]);
      setUsers(u.users);
      setDevices(d.devices);
      if (canAudit) setAudit((await c.audit(50)).entries);
      setErr('');
    } catch (e) {
      setErr(errText(e));
    }
  };
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (f: () => Promise<unknown>) => {
    try {
      await f();
      await load();
    } catch (e) {
      setErr(errText(e));
    }
  };
  if (!c) return null;

  return (
    <>
      <section>
        <h2>People</h2>
        <p className="muted small">Roles: <b>Admin</b> can do everything. <b>Member</b> listens and requests music; turn on <b>Autodownload</b> to let them download without your approval. <b>Kid</b> gets the kid-safe view and can never autodownload. Give a kid <b>Parents</b> and their requests and weekly listening report go to those grown-ups too, who can approve them from their Inbox.</p>
        {err && <div className="errors">{err}</div>}
        {users.map((u) => (
          <div key={u.id} className={`source-row ${u.disabled ? 'off' : ''}`}>
            <div className="hub-avatar">{u.displayName.slice(0, 1).toUpperCase()}</div>
            <div className="track-main">
              <div className="track-title">{u.displayName}{u.id === me?.id ? <span className="muted small"> · you</span> : null}</div>
              <div className="track-sub">
                @{u.username}{u.ssoSubject ? ` · SSO ${u.ssoSubject}` : ''}{u.hasPassword ? '' : ' · no password'}{u.twoFactor ? ' · 2-step' : u.role === 'admin' && u.hasPassword && u.twoFactor === false ? ' · no 2-step sign-in' : ''} · {u.devices} device{u.devices === 1 ? '' : 's'} · last seen {when(u.lastSeenAt)}
              </div>
            </div>
            <select value={u.role} onChange={(e) => run(() => c.updateUser(u.id, { role: e.target.value as HubRole }))} aria-label="Role">
              {(Object.keys(ROLE_LABELS) as HubRole[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
            {u.role === 'member' && (
              <label className="check" title="Download without approval">
                <span className="switch"><input type="checkbox" checked={u.autodownload} onChange={(e) => run(() => c.updateUser(u.id, { autodownload: e.target.checked }))} /><span /></span>
                <small>Autodownload</small>
              </label>
            )}
            <button className="btn small" onClick={() => {
              const password = prompt(`New Hub password for ${u.displayName} (at least 10 characters):`);
              if (password) run(() => c.updateUser(u.id, { password }));
            }}>Set password</button>
            <button className="btn small" onClick={() => {
              const ssoSubject = prompt(`tinyauth username for ${u.displayName} (empty to unlink):`, u.ssoSubject ?? '');
              if (ssoSubject !== null) run(() => c.updateUser(u.id, { ssoSubject: ssoSubject.trim() || null }));
            }}>SSO</button>
            {u.twoFactor && <button className="btn small" title={`${u.displayName} uses two-step sign-in. Turn it off if they lost their phone`} onClick={() => {
              if (confirm(`Turn off two-step sign-in for ${u.displayName}? They'll sign in with just their password until they turn it on again.`)) run(() => c.resetTwoFactor(u.id));
            }}>Reset 2-step</button>}
            {u.role === 'kid' && u.guardians && (
              <details className="hub-guardians">
                <summary className="btn small" title="Their requests go to these grown-ups too, and their weekly report">Parents{u.guardians.length ? ` (${u.guardians.length})` : ''}</summary>
                <div className="hub-guardians-list">
                  {users.filter((g) => g.role !== 'kid').map((g) => (
                    <label key={g.id} className="check">
                      <input type="checkbox" checked={u.guardians!.includes(g.id)}
                        onChange={(e) => run(() => c.setGuardians(u.id, e.target.checked ? [...u.guardians!, g.id] : u.guardians!.filter((x) => x !== g.id)))} />
                      <small>{g.displayName}</small>
                    </label>
                  ))}
                </div>
              </details>
            )}
            <button className="btn small ghost" onClick={() => run(() => c.updateUser(u.id, { disabled: !u.disabled }))}>{u.disabled ? 'Turn on' : 'Turn off'}</button>
            {u.id !== me?.id && <button className="btn small ghost" onClick={() => confirm(`Delete ${u.displayName}? Their synced settings go too.`) && run(() => c.deleteUser(u.id))}>Delete</button>}
          </div>
        ))}

        <form className="editor" onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await c.createUser({ username: adding.username, displayName: adding.displayName || undefined, role: adding.role, password: adding.password || undefined, ssoSubject: adding.ssoSubject || undefined });
            setAdding(EMPTY_USER);
          });
        }}>
          <h3>Add someone</h3>
          <div className="editor-grid">
            <label>Username<input value={adding.username} onChange={(e) => setAdding({ ...adding, username: e.target.value })} required /></label>
            <label>Display name<input value={adding.displayName} onChange={(e) => setAdding({ ...adding, displayName: e.target.value })} /></label>
            <label>Role
              <select value={adding.role} onChange={(e) => setAdding({ ...adding, role: e.target.value as HubRole })}>
                {(Object.keys(ROLE_LABELS) as HubRole[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </label>
            <label>tinyauth username (optional)<input value={adding.ssoSubject} onChange={(e) => setAdding({ ...adding, ssoSubject: e.target.value })} /></label>
            <label className="span2">Hub password (optional if they use single sign-on; at least 10 characters)<input type="password" value={adding.password} onChange={(e) => setAdding({ ...adding, password: e.target.value })} autoComplete="new-password" /></label>
          </div>
          <div className="row gap"><button className="btn primary">Add</button></div>
        </form>
      </section>

      <FamiliesAdmin users={users} onChange={load} />

      <Invites onUsed={load} />

      <section>
        <h2>Signed-in devices</h2>
        {devices.map((d) => (
          <div key={d.id} className="source-row">
            <div className="track-main">
              <div className="track-title">{d.name} <span className="muted small">· {d.displayName}</span></div>
              <div className="track-sub">{d.platform} · signed in {when(d.createdAt)} · last seen {when(d.lastSeenAt)}</div>
            </div>
            <button className="btn small ghost" onClick={() => confirm(`Sign out ${d.name} (${d.displayName})?`) && run(() => c.signOutDevice(d.id))}>Sign out</button>
          </div>
        ))}
      </section>

      <KidRulesSection />

      <KidSafeList />

      {canAudit && (
        <section>
          <h2>Activity</h2>
          <div className="hub-audit">
            {audit.map((a) => (
              <div key={a.id}><span className="muted">{when(a.at)}</span> <b>{a.actor ?? '—'}</b> {a.action.replace(/[._]/g, ' ')} {a.target ?? ''}</div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/** Invite links: pick a role, send the link, and they choose their own username and password. */
function Invites({ onUsed }: { onUsed(): void }) {
  const c = hubClient();
  const [list, setList] = useState<HubInvite[]>([]);
  const [made, setMade] = useState<string>();
  const [form, setForm] = useState({ role: 'member' as HubRole, displayName: '', autodownload: false, days: 7 });
  const [err, setErr] = useState('');
  const load = () => c?.invites().then((r) => setList(r.invites)).catch((e) => setErr(errText(e)));
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!c) return null;

  const make = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await c.createInvite({ ...form, displayName: form.displayName || undefined });
      setMade(r.url);
      setErr('');
      load();
    } catch (e) {
      setErr(errText(e));
    }
  };
  const open = list.filter((i) => !i.usedAt);
  const used = list.filter((i) => i.usedAt);

  return (
    <section>
      <h2>Invite someone</h2>
      <p className="muted small">
        Make a link and send it however you like. They open it, pick their own username and password, and get the role you chose.
        Each link works once. In the app they can paste it under Settings → Account → I have an invite.
      </p>
      {err && <div className="errors">{err}</div>}
      <form className="editor" onSubmit={make}>
        <div className="editor-grid">
          <label>Role
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as HubRole })}>
              {(Object.keys(ROLE_LABELS) as HubRole[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </label>
          <label>Their name (optional)<input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></label>
          <label>Link works for
            <select value={form.days} onChange={(e) => setForm({ ...form, days: Number(e.target.value) })}>
              {[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} day{d === 1 ? '' : 's'}</option>)}
            </select>
          </label>
          {form.role === 'member' && (
            <label className="check">
              <span className="switch"><input type="checkbox" checked={form.autodownload} onChange={(e) => setForm({ ...form, autodownload: e.target.checked })} /><span /></span>
              <small>Autodownload</small>
            </label>
          )}
        </div>
        <div className="row gap"><button className="btn primary">Make invite link</button></div>
      </form>
      {made && (
        <div className="editor invite-made">
          <p className="small">Send this link. It's only shown now.</p>
          <div className="row gap wrap">
            <input style={{ flex: 1, minWidth: 240 }} readOnly value={made} onFocus={(e) => e.target.select()} aria-label="Invite link" />
            <button className="btn small" onClick={() => navigator.clipboard?.writeText(made).catch(() => undefined)}>Copy</button>
            <button className="btn small ghost" onClick={() => setMade(undefined)}>Done</button>
          </div>
          <Qr text={made} />
        </div>
      )}
      {open.map((i) => (
        <div key={i.id} className="source-row">
          <div className="track-main">
            <div className="track-title">{i.displayName || 'Invite'} <span className="muted small">· {ROLE_LABELS[i.role]}{i.autodownload ? ', Autodownload' : ''}</span></div>
            <div className="track-sub">made by {i.createdBy ?? '—'} {when(i.createdAt)} · works until {when(i.expiresAt)}</div>
          </div>
          <button className="btn small ghost" onClick={() => c.cancelInvite(i.id).then(load, (e) => setErr(errText(e)))}>Cancel</button>
        </div>
      ))}
      {used.length > 0 && (
        <p className="muted small">
          Joined: {used.map((i) => `${i.usedBy ?? 'someone'} (${ROLE_LABELS[i.role]}, ${new Date(i.usedAt!).toLocaleDateString()})`).join(', ')}
          {' '}<button className="btn small ghost" onClick={() => { load(); onUsed(); }}>Refresh</button>
        </p>
      )}
    </section>
  );
}

/**
 * Kid profiles: the grown-up PIN, and each kid's bedtime and daily listening limit. `family`: a family manager's
 * view (Settings → My family), which the Hub keeps to their family's kids and their family's own PIN.
 */
export function KidRulesSection({ family }: { family?: string } = {}) {
  const admin = useHub((s) => s.permissions.includes('users.manage'));
  const can = admin || !!family;
  const [data, setData] = useState<{ pinSet: boolean; kids: { userId: number; displayName: string; rules: KidRules; usedSeconds: number }[] }>();
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const c = hubClient();
  const load = () => c?.adminKids(today()).then(setData).catch((e) => setErr(errText(e)));
  useEffect(() => {
    if (can) load();
  }, [can]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!can || !c) return null;

  const save = async (userId: number, rules: Partial<KidRules>) => {
    setErr('');
    try {
      await c.setKidRules(userId, rules);
      setMsg('Saved');
      window.setTimeout(() => setMsg(''), 1500);
      load();
    } catch (e) {
      setErr(errText(e));
    }
  };

  return (
    <section>
      <h2>{family ? `${family}'s kids` : 'Kid profiles'}</h2>
      <p className="muted small">
        Kids get a simpler menu and only kid-safe music. Music stops at bedtime and when today's time is up, on all their
        devices. The <b>grown-up PIN</b> unlocks 30 more minutes, and is needed to sign out of a kid profile.
      </p>
      {err && <div className="errors">{err}</div>}
      <div className="source-row">
        <div className="track-main">
          <div className="track-title">Grown-up PIN{family ? ` for ${family}` : ''}</div>
          <div className="track-sub">{data?.pinSet ? 'Set' : 'Not set: kids can’t be unlocked or signed out until you set one'}</div>
        </div>
        <button className="btn small" onClick={async () => {
          const pin = prompt('New grown-up PIN (4 to 8 digits):');
          if (!pin) return;
          try {
            await c.setKidPin(pin.trim());
            load();
          } catch (e) {
            setErr(errText(e));
          }
        }}>{data?.pinSet ? 'Change' : 'Set PIN'}</button>
        {data?.pinSet && <button className="btn small ghost" onClick={() => confirm('Remove the grown-up PIN?') && c.setKidPin(null).then(load).catch((e) => setErr(errText(e)))}>Remove</button>}
      </div>
      {data && !data.kids.length && <p className="muted">No kid profiles yet. Add someone with the <b>Kid</b> role{family ? ' above' : ' below'}.</p>}
      {data?.kids.map((k) => (
        <form key={k.userId} className="source-row kid-rules" onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const minutes = Number(f.get('minutes'));
          save(k.userId, {
            bedtimeFrom: String(f.get('from') || '') || null,
            bedtimeTo: String(f.get('to') || '') || null,
            dailyMinutes: minutes > 0 ? minutes : null,
          });
        }}>
          <div className="track-main">
            <div className="track-title">{k.displayName}</div>
            <div className="track-sub">{Math.round(k.usedSeconds / 60)} min today{k.rules.dailyMinutes ? ` of ${k.rules.dailyMinutes}` : ''}</div>
          </div>
          <label className="small">Bedtime <input type="time" name="from" defaultValue={k.rules.bedtimeFrom ?? ''} /></label>
          <label className="small">until <input type="time" name="to" defaultValue={k.rules.bedtimeTo ?? ''} /></label>
          <label className="small">Minutes a day <input type="number" name="minutes" min={0} max={1440} placeholder="no limit" defaultValue={k.rules.dailyMinutes ?? ''} style={{ width: 90 }} /></label>
          <button className="btn small">{msg || 'Save'}</button>
        </form>
      ))}
    </section>
  );
}

/** Kid-safe flags: what admins hid from kids, or let through although it's explicit. */
function KidSafeList() {
  const can = useHub((s) => s.permissions.includes('library.edit'));
  const flags = useFlags((s) => s.flags);
  useEffect(() => {
    if (can) loadFlags();
  }, [can]);
  if (!can) return null;
  const KIND = { track: 'Song', album: 'Album', artist: 'Artist' } as const;
  return (
    <section>
      <h2>Kid-safe music</h2>
      <p className="muted small">
        Kid profiles never see music marked explicit (from your files' tags or Deezer), or anything listed here as
        <b> Hidden</b>. <b>OK for kids</b> lets something explicit through. Use the <b>Kids</b> button on any song,
        album or artist to add to this list. A song or album is marked for the version you were looking at: the
        clean version and the explicit one are separate.
      </p>
      <LibraryCheck />
      {!flags.length && <p className="muted">Nothing flagged yet.</p>}
      {flags.map((f) => (
        <div key={f.id} className="source-row">
          <div className="track-main">
            <div className="track-title">{f.title || f.artist}</div>
            <div className="track-sub">{KIND[f.kind]}{f.title ? ` · ${f.artist}` : ''}{flagVersionLabel(f) ? ` · ${flagVersionLabel(f)}` : ''}{f.setBy ? ` · by ${f.setBy}` : ''}</div>
          </div>
          <span className={`small ${f.verdict === 'block' ? 'kid-blocked' : 'ok'}`}>{f.verdict === 'block' ? 'Hidden from kids' : 'OK for kids'}</span>
          <button className="btn small ghost" onClick={() => removeFlag(f.id).catch((e) => alert(errText(e)))}>Remove</button>
        </div>
      ))}
    </section>
  );
}

/**
 * Library check: look every album up on Deezer and keep on the Hub which albums and songs are explicit (for
 * files without the tag, and Plex). The files aren't changed.
 */
function LibraryCheck() {
  const check = useExplicitCheck();
  const ratings = useRatings((s) => s.ratings);
  const albums = ratings.filter((r) => r.kind === 'album');
  const explicit = albums.filter((r) => r.rating === 'explicit');
  const withClean = explicit.filter((r) => r.cleanLink).length;
  const unknown = albums.filter((r) => r.rating === 'unknown').length;
  const go = (f: () => Promise<void>) => f().catch((e) => useExplicitCheck.setState({ error: errText(e) }));
  return (
    <div className="editor">
      <h3>Library check</h3>
      <p className="muted small">
        Looks each album up on Deezer to find which albums and songs are explicit, and whether Deezer has a clean
        version. Your files aren't changed. Albums already checked are skipped, so you can stop and carry on later.
      </p>
      {albums.length > 0 && (
        <p className="small">
          Checked {albums.length} album{albums.length === 1 ? '' : 's'}: {explicit.length} explicit
          {withClean ? ` (${withClean} with a clean version on Deezer)` : ''}{unknown ? `, ${unknown} not found on Deezer` : ''}.
        </p>
      )}
      {withClean > 0 && (
        <p className="small">
          <button className="link small" onClick={() => useUi.getState().go({ view: 'inbox', tab: 'clean' })}>See the clean versions →</button>{' '}
          <span className="muted">Preview and download them from Inbox → Clean versions.</span>
        </p>
      )}
      {check.running && (
        <>
          <div className="progress"><i style={{ width: `${check.total ? Math.round((check.done / check.total) * 100) : 0}%` }} /></div>
          <p className="small">Checking {check.done} of {check.total} · {check.explicit} explicit so far</p>
        </>
      )}
      {!check.running && check.total > 0 && check.done < check.total && !check.error && <p className="small">Stopped after {check.done} of {check.total}.</p>}
      {check.error && <div className="errors">{check.error}</div>}
      <div className="row">
        {check.running
          ? <button className="btn" onClick={stopExplicitCheck}>Stop</button>
          : <button className="btn primary" onClick={() => go(runExplicitCheck)}>{albums.length ? 'Check new albums' : 'Check my library'}</button>}
        {!check.running && albums.length > 0 && (
          <button className="btn ghost" onClick={() => confirm('Forget the results and check every album again?') && go(recheckLibrary)}>Check everything again</button>
        )}
      </div>
    </div>
  );
}

const ACCESS_LABELS: Record<Access, string> = { everyone: 'Everyone', admins: 'Admins only', chosen: 'People I choose' };

/**
 * Who may use a server kept on the Hub, and personal logins (their own Plex token or Audiobookshelf key,
 * so their progress and history are their own). Shown under the server in Settings → Sources while an
 * admin edits it.
 */
export function HubAccess({ serviceId, kind }: { serviceId: number; kind: string }) {
  const [svc, setSvc] = useState<HubAdminService>();
  const [users, setUsers] = useState<HubAdminUser[]>([]);
  const [err, setErr] = useState('');
  const c = hubClient();
  const ownable = kind === 'plex' || kind === 'audiobookshelf';

  const run = async (f: () => Promise<{ service: HubAdminService } | void>) => {
    try {
      const r = await f();
      if (r) setSvc(r.service);
      setErr('');
      await loadHubServices();
    } catch (e) {
      setErr(errText(e));
    }
  };
  useEffect(() => {
    if (!c) return;
    Promise.all([c.adminServices(), c.users()])
      .then(([s, u]) => {
        setSvc(s.services.find((x) => x.id === serviceId));
        setUsers(u.users);
      })
      .catch((e) => setErr(errText(e)));
  }, [serviceId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!c || !svc) return err ? <div className="errors">{err}</div> : null;

  return (
    <div className="editor">
      <h3>Who can use it</h3>
      {err && <div className="errors">{err}</div>}
      {svc.unreadable && <div className="errors">The Hub can't read the saved login (its secret key changed). Enter it again and save.</div>}
      <label>Access
        <select value={svc.access} onChange={(e) => run(() => c.updateService(svc.id, { access: e.target.value as Access }))}>
          {(Object.keys(ACCESS_LABELS) as Access[]).map((a) => <option key={a} value={a}>{ACCESS_LABELS[a]}</option>)}
        </select>
      </label>
      {(svc.access === 'chosen' || ownable) && users.map((u) => {
        const entry = svc.users.find((x) => x.userId === u.id);
        const own = !!entry?.secretsSet.length;
        return (
          <div key={u.id} className="source-row">
            <div className="hub-avatar">{u.displayName.slice(0, 1).toUpperCase()}</div>
            <div className="track-main">
              <div className="track-title">{u.displayName}</div>
              <div className="track-sub">{ROLE_LABELS[u.role]}{own ? ' · own login' : ''}{entry?.unreadable ? ' · login unreadable, set it again' : ''}</div>
            </div>
            {svc.access === 'chosen' && u.role !== 'admin' && (
              <label className="check">
                <span className="switch"><input type="checkbox" checked={!!entry} onChange={(e) => run(() => (e.target.checked ? c.setServiceUser(svc.id, u.id) : c.removeServiceUser(svc.id, u.id)))} /><span /></span>
                <small>Can use</small>
              </label>
            )}
            {ownable && (
              <button className="btn small" onClick={() => {
                const token = prompt(`${u.displayName}'s own ${kind === 'plex' ? 'Plex token' : 'Audiobookshelf API key'} (empty to use the shared one):`);
                if (token !== null) run(() => c.setServiceUser(svc.id, u.id, { token: token.trim() || null }));
              }}>Own login</button>
            )}
          </div>
        );
      })}
      <ServiceFamilies serviceId={svc.id} chosen={svc.families ?? []} onSaved={(families) => setSvc({ ...svc, families })} />
      <p className="muted small">Admins can always use every server. With an own login, that person gets it instead of the shared one{svc.access === 'chosen' ? ', and setting one also lets them use the server' : ''}.</p>
    </div>
  );
}
