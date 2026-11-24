import { useEffect, useState, type FormEvent } from 'react';
import type { HubAdminUser, HubFamily, HubFamilyDownloads, HubFamilyLogin, HubFamilyMember, HubSharedKey, HubSharedKeyName } from '../sources/hub';
import { hubClient, useHub } from '../store/hub';
import { KidRulesSection } from './HubSettings';

/**
 * Families (docs/HUB.md "Families"). `FamiliesAdmin` is part of Settings → Users, for the Hub admin only.
 * `FamilyTab` is Settings → My family, only for a family's managers, and only with what the admin let that
 * family do. Nobody else sees family settings; the Hub refuses their calls too.
 */

const errText = (e: unknown) => String((e as Error)?.message ?? e);
const POWERS: { key: 'canRegister' | 'ownKeys' | 'kidControls' | 'approveRequests'; label: string; hint: string }[] = [
  { key: 'canRegister', label: 'Can register people', hint: 'Its managers add members and kids, and make invite links, into this family' },
  { key: 'ownKeys', label: 'Own keys', hint: 'Its managers set the family’s own shared keys, which win over the Hub’s' },
  { key: 'kidControls', label: 'Kid controls', hint: 'Its managers set bedtimes, daily limits and a grown-up PIN for its kids' },
  { key: 'approveRequests', label: 'Approve requests', hint: 'Its managers approve or turn down music requests from people in this family (you still can too)' },
];
/** What a family's people may get (hub/src/roles.ts `FamilyDownloads`). Admins and kids keep their own rules. */
const DOWNLOADS: { value: HubFamilyDownloads; label: string; hint: string }[] = [
  { value: 'person', label: 'Each person’s own setting', hint: 'Grown-ups with Autodownload get music straight away; everyone else requests' },
  { value: 'auto', label: 'Download straight away', hint: 'Every grown-up in this family gets music without asking; kids still request' },
  { value: 'request', label: 'Request only', hint: 'Everyone in this family requests and waits for approval, even with Autodownload' },
  { value: 'off', label: 'Off', hint: 'Nobody in this family can request or download music' },
];

/** Settings → Users → Families: make families, put people in them, pick managers, and decide what each may do. */
export function FamiliesAdmin({ users, onChange }: { users: HubAdminUser[]; onChange(): void }) {
  const c = hubClient();
  const [families, setFamilies] = useState<HubFamily[]>([]);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const load = () => c?.families().then((r) => setFamilies(r.families), (e) => setErr(errText(e)));
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!c) return null;
  const run = async (f: () => Promise<unknown>, people = false) => {
    try {
      await f();
      setErr('');
      await load();
      if (people) onChange();
    } catch (e) {
      setErr(errText(e));
    }
  };

  const members = (familyId: number) => users.filter((u) => u.familyId === familyId);
  const noFamily = users.filter((u) => !u.familyId || !families.some((f) => f.id === u.familyId));
  // One person, inside their family's card (or under No family): move them, make them a manager, clear their PIN.
  const personRow = (u: HubAdminUser) => (
    <div key={u.id} className="source-row">
      <div className="hub-avatar">{u.displayName.slice(0, 1).toUpperCase()}</div>
      <div className="track-main">
        <div className="track-title">{u.displayName}</div>
        <div className="track-sub">@{u.username}{u.role === 'kid' ? ' · kid' : ''}{u.hasSwitchPin ? ' · has a switching PIN' : ''}</div>
      </div>
      {u.familyId && u.role !== 'kid' && (
        <label className="check" title="Runs this family, with what you switched on for it">
          <span className="switch"><input type="checkbox" checked={!!u.familyManager} onChange={(e) => run(() => c.setUserFamily(u.id, u.familyId!, e.target.checked), true)} /><span /></span>
          <small>Manager</small>
        </label>
      )}
      {/* Moving someone to another family drops them as a manager: the admin picks the new family's managers. */}
      <select aria-label={`Move ${u.displayName} to`} title="Move to another family" value={u.familyId ?? ''} onChange={(e) => run(() => c.setUserFamily(u.id, e.target.value ? Number(e.target.value) : null, false), true)}>
        {families.map((f) => <option key={f.id} value={f.id}>{u.familyId === f.id ? f.name : `Move to ${f.name}`}</option>)}
        <option value="">{u.familyId ? 'Take out of family' : 'No family'}</option>
      </select>
      {u.hasSwitchPin && <button className="btn small ghost" onClick={() => confirm(`Take ${u.displayName}'s switching PIN off? They can set a new one.`) && run(() => c.clearSwitchPin(u.id), true)}>Clear PIN</button>}
    </div>
  );

  return (
    <section id="families">
      <h2>Families</h2>
      <p className="muted small">
        For a Hub shared by more than one household. Put everyone in a family: the people in it switch to each other on a shared
        device (Settings → Account → Switching PIN), a family can have its own shared keys, and a Hub server can be kept to some
        families. A <b>manager</b> runs their own family, but only with what you switch on for it. Only you see these settings.
      </p>
      {err && <div className="errors">{err}</div>}
      {families.map((f) => (
        <div key={f.id} className="editor">
          <div className="row gap wrap">
            <h3 style={{ margin: 0, flex: 1 }}>{f.name} <span className="muted small">· {f.people} {f.people === 1 ? 'person' : 'people'}{f.maxPeople ? ` of ${f.maxPeople}` : ''}</span></h3>
            <button className="btn small" onClick={() => {
              const n = prompt('Family name:', f.name);
              if (n?.trim()) run(() => c.updateFamily(f.id, { name: n.trim() }));
            }}>Rename</button>
            <button className="btn small" onClick={() => {
              const n = prompt('The most people this family can have (empty for no limit):', f.maxPeople ? String(f.maxPeople) : '');
              if (n !== null) run(() => c.updateFamily(f.id, { maxPeople: n.trim() ? Number(n) : null }));
            }}>Most people</button>
            {f.kidControls && <button className="btn small" title="The grown-up PIN this family's kids use, instead of the Hub's" onClick={() => {
              const pin = prompt(`Grown-up PIN for ${f.name}'s kids (4 to 8 digits; empty to use the Hub's):`);
              if (pin !== null) run(() => c.setKidPin(pin.trim() || null, f.id));
            }}>Grown-up PIN</button>}
            <button className="btn small ghost" onClick={() => confirm(`Delete ${f.name}? Its people stay, without a family, and its keys go.`) && run(() => c.deleteFamily(f.id), true)}>Delete</button>
          </div>
          <div className="family-members">
            {members(f.id).length ? members(f.id).map(personRow) : <p className="muted small" style={{ margin: 0 }}>Nobody in this family yet.</p>}
            {users.some((u) => u.familyId !== f.id) && (
              <select aria-label={`Add someone to ${f.name}`} className="family-add" value="" onChange={(e) => e.target.value && run(() => c.setUserFamily(Number(e.target.value), f.id, false), true)}>
                <option value="">+ Add someone…</option>
                {users.filter((u) => u.familyId !== f.id).map((u) => (
                  <option key={u.id} value={u.id}>{u.displayName}{u.familyId ? ` (from ${families.find((x) => x.id === u.familyId)?.name ?? 'another family'})` : ''}</option>
                ))}
              </select>
            )}
          </div>
          <FamilyLogins family={f} />
          <label className="row gap family-downloads" title={DOWNLOADS.find((d) => d.value === (f.downloads ?? 'person'))?.hint}>
            <small>Getting music</small>
            <select value={f.downloads ?? 'person'} onChange={(e) => run(() => c.updateFamily(f.id, { downloads: e.target.value as HubFamilyDownloads }), true)}>
              {DOWNLOADS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
            <small className="muted">{DOWNLOADS.find((d) => d.value === (f.downloads ?? 'person'))?.hint}</small>
          </label>
          <div className="row gap wrap">
            {POWERS.map((p) => (
              <label key={p.key} className="check" title={p.hint}>
                <span className="switch"><input type="checkbox" checked={!!f[p.key]} onChange={(e) => run(() => c.updateFamily(f.id, { [p.key]: e.target.checked }))} /><span /></span>
                <small>{p.label}</small>
              </label>
            ))}
          </div>
        </div>
      ))}
      <form className="row gap" onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) run(async () => { await c.createFamily({ name: name.trim() }); setName(''); });
      }}>
        <input placeholder="New family, e.g. The Smiths" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        <button className="btn" disabled={!name.trim()}>Add family</button>
      </form>

      {families.length > 0 && noFamily.length > 0 && (
        <div className="editor">
          <h3 style={{ margin: 0 }}>No family <span className="muted small">· {noFamily.length} {noFamily.length === 1 ? 'person' : 'people'}</span></h3>
          <p className="muted small" style={{ margin: 0 }}>Pick a family for each of them, or add them from a family above.</p>
          <div className="family-members">{noFamily.map(personRow)}</div>
        </div>
      )}

      <SharedKeys families={families} />
    </section>
  );
}

/**
 * Family sign-ins (hub/src/familyLogins.ts): a username and password and/or a tinyauth name for the whole family.
 * Signing in with one asks "Who's listening?" and the person picks their profile (with its PIN, if it has one).
 */
function FamilyLogins({ family }: { family: HubFamily }) {
  const c = hubClient();
  const [logins, setLogins] = useState<HubFamilyLogin[]>([]);
  const [draft, setDraft] = useState({ username: '', password: '', ssoSubject: '' });
  const [err, setErr] = useState('');
  const load = () => c?.familyLogins().then((r) => setLogins(r.logins.filter((l) => l.familyId === family.id)), (e) => setErr(errText(e)));
  useEffect(() => {
    load();
  }, [family.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!c) return null;
  const run = async (f: () => Promise<unknown>) => {
    try {
      await f();
      setErr('');
      await load();
    } catch (e) {
      setErr(errText(e));
    }
  };
  return (
    <details className="family-logins">
      <summary className="small">Family sign-ins{logins.length ? ` (${logins.length})` : ''}</summary>
      <p className="muted small">
        One sign-in for the whole family. After signing in with it, Wavelength asks who's listening and the person picks their profile.
        Profiles with a switching PIN ask for it; admin profiles can only be picked once they have one. A profile's own sign-in
        (its password or tinyauth name, under People) still goes straight into that profile.
      </p>
      {logins.map((l) => (
        <div key={l.id} className="source-row">
          <div className="track-main">
            <div className="track-title">{l.username ? `@${l.username}` : 'Single sign-on only'}</div>
            <div className="track-sub">{l.ssoSubject ? `SSO ${l.ssoSubject}` : 'no single sign-on'}{l.username ? (l.hasPassword ? ' · password set' : ' · no password') : ''}</div>
          </div>
          {l.username && <button className="btn small" onClick={() => {
            const password = prompt('New password for this family sign-in (at least 10 characters). Devices using it go back to signing in:');
            if (password) run(() => c.updateFamilyLogin(l.id, { password }));
          }}>Set password</button>}
          <button className="btn small" onClick={() => {
            const sso = prompt('tinyauth username for this family sign-in (empty for none):', l.ssoSubject ?? '');
            if (sso !== null) run(() => c.updateFamilyLogin(l.id, { ssoSubject: sso.trim() || null }));
          }}>SSO</button>
          <button className="btn small ghost" title="Devices that haven't stayed signed in to a profile have to sign in again" onClick={() => run(() => c.updateFamilyLogin(l.id, { signOutEverywhere: true }))}>Sign out devices</button>
          <button className="btn small ghost" onClick={() => confirm('Delete this family sign-in? Profiles already picked on devices stay signed in.') && run(() => c.deleteFamilyLogin(l.id))}>Delete</button>
        </div>
      ))}
      <form className="editor-grid" onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          await c.createFamilyLogin({ familyId: family.id, ...(draft.username.trim() && { username: draft.username.trim(), password: draft.password }), ...(draft.ssoSubject.trim() && { ssoSubject: draft.ssoSubject.trim() }) });
          setDraft({ username: '', password: '', ssoSubject: '' });
        });
      }}>
        <label>Username<input value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} placeholder="e.g. smiths" autoComplete="off" /></label>
        <label>Password (at least 10 characters)<input type="password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} autoComplete="new-password" required={!!draft.username.trim()} minLength={10} /></label>
        <label>tinyauth username (optional)<input value={draft.ssoSubject} onChange={(e) => setDraft({ ...draft, ssoSubject: e.target.value })} autoComplete="off" /></label>
        <div className="row gap"><button className="btn small" disabled={!draft.username.trim() && !draft.ssoSubject.trim()}>Add family sign-in</button></div>
      </form>
      {err && <div className="errors">{err}</div>}
    </details>
  );
}

/** Settings → Users → Shared keys: the whole Hub's, and each family's own, which wins for that family. */
function SharedKeys({ families }: { families: HubFamily[] }) {
  const c = hubClient();
  const [familyId, setFamilyId] = useState(0);
  const [keys, setKeys] = useState<HubSharedKey[]>([]);
  const [env, setEnv] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState('');
  useEffect(() => {
    c?.sharedKeys(familyId).then((r) => { setKeys(r.keys); setEnv(r.env); setErr(''); }, (e) => setErr(errText(e)));
  }, [familyId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!c) return null;
  const save = (values: Partial<Record<HubSharedKeyName, string | null>>) =>
    c.saveSharedKeys(familyId, values).then((r) => { setKeys(r.keys); setErr(''); }, (e) => setErr(errText(e)));

  return (
    <div id="shared-keys">
      <h3>Shared keys</h3>
      <p className="muted small">
        Keys the Hub keeps for everyone, so nobody types them into a device. A family's own key wins for the people in that family.
        Secret keys never leave the Hub; the Discord application ID is sent to devices and wins over one typed there.
      </p>
      <label>For
        <select value={familyId} onChange={(e) => setFamilyId(Number(e.target.value))}>
          <option value={0}>The whole Hub</option>
          {families.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </label>
      {err && <div className="errors">{err}</div>}
      <KeyRows keys={keys} wholeHub={familyId === 0} env={env} save={save} />
    </div>
  );
}

function KeyRows({ keys, wholeHub, env = {}, save }: { keys: HubSharedKey[]; wholeHub: boolean; env?: Record<string, boolean>; save(v: Partial<Record<HubSharedKeyName, string | null>>): Promise<unknown> }) {
  const [drafts, setDrafts] = useState<Partial<Record<HubSharedKeyName, string>>>({});
  return (
    <>
      {keys.map((k) => {
        const elsewhere = wholeHub && k.hubWide !== 'here';
        return (
          <form key={k.name} className="source-row" onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            await save({ [k.name]: drafts[k.name] ?? '' });
            setDrafts({ ...drafts, [k.name]: '' });
          }}>
            <div className="track-main">
              <div className="track-title">{k.label}</div>
              <div className="track-sub">
                {elsewhere
                  ? `Set for the whole Hub under Settings → ${k.hubWide === 'dj' ? 'AI DJ' : 'Features'}`
                  : k.set ? `Saved ${k.hint ?? ''}` : env[k.name] ? 'Not saved here: the Hub’s environment variable is used' : wholeHub ? 'Not set' : 'Not set: the whole Hub’s is used'}
              </div>
            </div>
            {!elsewhere && <>
              <input type={k.secret ? 'password' : 'text'} autoComplete="off" value={drafts[k.name] ?? ''} placeholder={k.set ? 'Type a new one to replace it' : 'Paste it here'}
                onChange={(e) => setDrafts({ ...drafts, [k.name]: e.target.value })} />
              <button className="btn small" disabled={!drafts[k.name]?.trim()}>Save</button>
              {k.set && <button type="button" className="btn small ghost" onClick={() => save({ [k.name]: null })}>Remove</button>}
            </>}
          </form>
        );
      })}
    </>
  );
}

/** Settings → My family: a manager runs their own family, with what the Hub admin switched on for it. */
export function FamilyTab() {
  const c = hubClient();
  const [data, setData] = useState<{ family: HubFamily; people: HubFamilyMember[]; keys?: HubSharedKey[] }>();
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState({ username: '', displayName: '', role: 'member' as 'member' | 'kid', password: '' });
  const [invite, setInvite] = useState<string>();
  const load = () => c?.myFamilyAdmin().then(setData, (e) => setErr(errText(e)));
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!c) return null;
  const run = async (f: () => Promise<unknown>) => {
    try {
      await f();
      setErr('');
      await load();
    } catch (e) {
      setErr(errText(e));
    }
  };
  if (!data) return err ? <div className="errors">{err}</div> : null;
  const { family: f } = data;

  return (
    <>
      <section>
        <h2>{f.name}</h2>
        <p className="muted small">You manage this family. {[
          f.canRegister && 'You can add people',
          f.kidControls && 'look after its kids',
          f.ownKeys && 'set its own keys',
          f.approveRequests && 'approve its music requests (in the Inbox)',
        ].filter(Boolean).join(', ') || 'Your Hub admin hasn’t switched anything on for it yet'}.</p>
        {err && <div className="errors">{err}</div>}
        {data.people.map((p) => (
          <div key={p.id} className={`source-row ${p.disabled ? 'off' : ''}`}>
            <div className="hub-avatar">{p.displayName.slice(0, 1).toUpperCase()}</div>
            <div className="track-main">
              <div className="track-title">{p.displayName}{p.familyManager ? <span className="muted small"> · manager</span> : null}</div>
              <div className="track-sub">@{p.username} · {p.role === 'kid' ? 'Kid' : p.role === 'admin' ? 'Admin' : 'Member'} · {p.devices} device{p.devices === 1 ? '' : 's'}</div>
            </div>
            {f.canRegister && p.role !== 'admin' && !p.familyManager && <>
              <select aria-label="Role" value={p.role} onChange={(e) => run(() => c.updateFamilyMember(p.id, { role: e.target.value as 'member' | 'kid' }))}>
                <option value="member">Member</option>
                <option value="kid">Kid</option>
              </select>
              <button className="btn small" onClick={() => {
                const password = prompt(`New Hub password for ${p.displayName} (at least 10 characters):`);
                if (password) run(() => c.updateFamilyMember(p.id, { password }));
              }}>Set password</button>
              <button className="btn small ghost" onClick={() => run(() => c.updateFamilyMember(p.id, { disabled: !p.disabled }))}>{p.disabled ? 'Turn on' : 'Turn off'}</button>
            </>}
            {f.kidControls && p.role === 'kid' && p.guardians && (
              <details className="hub-guardians">
                <summary className="btn small" title="Their requests and weekly report go to these grown-ups, who can also switch to them on a shared device without a PIN">Parents{p.guardians.length ? ` (${p.guardians.length})` : ''}</summary>
                <div className="hub-guardians-list">
                  {data.people.filter((g) => g.role !== 'kid').map((g) => (
                    <label key={g.id} className="check">
                      <input type="checkbox" checked={p.guardians!.includes(g.id)}
                        onChange={(e) => run(() => c.setFamilyGuardians(p.id, e.target.checked ? [...p.guardians!, g.id] : p.guardians!.filter((x) => x !== g.id)))} />
                      <small>{g.displayName}</small>
                    </label>
                  ))}
                </div>
              </details>
            )}
          </div>
        ))}
        {f.canRegister && (
          <form className="editor" onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await c.addFamilyMember({ ...adding, displayName: adding.displayName || undefined });
              setAdding({ username: '', displayName: '', role: 'member', password: '' });
            });
          }}>
            <h3>Add someone to {f.name}</h3>
            <div className="editor-grid">
              <label>Username<input value={adding.username} onChange={(e) => setAdding({ ...adding, username: e.target.value })} required /></label>
              <label>Display name<input value={adding.displayName} onChange={(e) => setAdding({ ...adding, displayName: e.target.value })} /></label>
              <label>Role
                <select value={adding.role} onChange={(e) => setAdding({ ...adding, role: e.target.value as 'member' | 'kid' })}>
                  <option value="member">Member</option>
                  <option value="kid">Kid</option>
                </select>
              </label>
              <label>Hub password (at least 10 characters)<input type="password" minLength={10} value={adding.password} onChange={(e) => setAdding({ ...adding, password: e.target.value })} required autoComplete="new-password" /></label>
            </div>
            <div className="row gap">
              <button className="btn primary">Add</button>
              <button type="button" className="btn" onClick={() => run(async () => setInvite((await c.createInvite({ role: adding.role })).url))}>Make an invite link instead</button>
            </div>
            {invite && (
              <div className="row gap wrap">
                <input style={{ flex: 1, minWidth: 240 }} readOnly value={invite} onFocus={(e) => e.target.select()} aria-label="Invite link" />
                <button type="button" className="btn small" onClick={() => navigator.clipboard?.writeText(invite).catch(() => undefined)}>Copy</button>
              </div>
            )}
          </form>
        )}
      </section>
      {f.kidControls && <KidRulesSection family={f.name} />}
      {f.ownKeys && data.keys && (
        <section>
          <h2>{f.name}'s keys</h2>
          <p className="muted small">Keys your family uses instead of the whole Hub's. Leave one empty to use the Hub's.</p>
          <KeyRows keys={data.keys} wholeHub={false} save={(values) => c.saveFamilyKeys(values).then((r) => setData({ ...data, keys: r.keys }), (e) => setErr(errText(e)))} />
        </section>
      )}
    </>
  );
}

/** In a Hub server's "Who can use it": keep it to some families. Shown only when the Hub has families. */
export function ServiceFamilies({ serviceId, chosen, onSaved }: { serviceId: number; chosen: number[]; onSaved(ids: number[]): void }) {
  const c = hubClient();
  const admin = useHub((s) => s.permissions.includes('users.manage'));
  const [families, setFamilies] = useState<HubFamily[]>([]);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (admin) c?.families().then((r) => setFamilies(r.families), () => undefined);
  }, [admin]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!c || !families.length) return null;
  const toggle = (id: number, on: boolean) => {
    const ids = on ? [...chosen, id] : chosen.filter((x) => x !== id);
    c.setServiceFamilies(serviceId, ids).then((r) => { onSaved(r.service.families ?? []); setErr(''); }, (e) => setErr(errText(e)));
  };
  return (
    <div>
      <p className="small"><b>Families</b> {chosen.length ? '' : <span className="muted">(none ticked: every family)</span>}</p>
      <div className="row gap wrap">
        {families.map((f) => (
          <label key={f.id} className="check">
            <input type="checkbox" checked={chosen.includes(f.id)} onChange={(e) => toggle(f.id, e.target.checked)} />
            <small>{f.name}</small>
          </label>
        ))}
      </div>
      {err && <div className="errors">{err}</div>}
    </div>
  );
}
