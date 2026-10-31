import { useEffect, useState } from 'react';
import type { HubDjAdmin, HubDjPrice, HubDjSettings } from '../sources/hub';
import { hubClient } from '../store/hub';

/**
 * Settings → AI DJ (admins): everything about the DJ is kept on the Hub (hub/src/dj/settings.ts). The API key
 * goes to the Hub once and is never sent back to any device; this page only sees its last four characters.
 * See docs/AI-DJ.md.
 */

const errText = (e: unknown) => String((e as Error)?.message ?? e);
const money = (n: number) => (n > 0 && n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`);
const EFFORT_HELP: Record<string, string> = {
  low: 'Quickest and cheapest; fine for simple asks.',
  medium: 'A good balance (recommended).',
  high: 'Thinks harder about picks; costs more.',
  xhigh: 'Thinks a lot; slower and costs more.',
  max: 'Most thorough; slowest and most expensive.',
};
const ROLE: Record<string, string> = { admin: 'Admin', member: 'Member', kid: 'Kid' };

/** '' means no limit. */
const limitValue = (v: string): number | null => (v.trim() === '' ? null : Number(v));

export function DjAdminTab() {
  const c = hubClient();
  const [data, setData] = useState<HubDjAdmin | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [key, setKey] = useState('');
  const [custom, setCustom] = useState(false);

  const load = async () => {
    if (!c) return;
    try {
      const d = await c.djAdmin();
      setData(d);
      setCustom(!d.models.some((m) => m.id === d.settings.model));
      setErr('');
    } catch (e) {
      setErr(errText(e));
    }
  };
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (b: Partial<HubDjSettings> & { apiKey?: string }, done = '') => {
    if (!c) return;
    try {
      setData(await c.saveDjAdmin(b));
      setErr('');
      setNote(done);
    } catch (e) {
      setErr(errText(e));
    }
  };
  const access = async (userId: number, b: { enabled?: boolean; monthlyLimit?: number | null }) => {
    if (!c) return;
    try {
      await c.setDjAccess(userId, b);
      await load();
    } catch (e) {
      setErr(errText(e));
    }
  };

  if (!c) return null;
  if (!data) return err ? <div className="errors">{err}</div> : null;
  const s = data.settings;
  const known = data.models.find((m) => m.id === s.model);
  const price: HubDjPrice = s.prices[s.model] ?? known?.price ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const setPrice = (k: keyof HubDjPrice, v: string) => save({ prices: { ...s.prices, [s.model]: { ...price, [k]: Number(v) || 0 } } });
  const grownUps = data.users.filter((u) => u.role !== 'kid' && !u.disabled && !u.enabled);

  return (
    <>
      <section>
        <h2>AI DJ</h2>
        <p className="muted small">
          A chat in the app that finds music in your library, builds and saves playlists, queues songs, recommends music and
          finds missing albums to request. It runs on the Hub with your AI provider’s API key, which never leaves the Hub.
          You pay the provider for what it uses; the Hub keeps count and stops at the limits you set.
        </p>
        {err && <div className="errors">{err}</div>}
        {note && <p className="ok small">{note}</p>}
        <label className="check">
          <span className="switch"><input type="checkbox" checked={s.enabled} onChange={(e) => save({ enabled: e.target.checked })} /><span /></span>
          <span>Turn on the AI DJ for this Hub <small className="muted">(then turn it on for each person below)</small></span>
        </label>
      </section>

      <section>
        <h2>Provider and key</h2>
        <div className="editor">
          <div className="editor-grid">
            <label>Provider
              <select value={s.provider} onChange={(e) => save({ provider: e.target.value })}>
                {data.providers.map((p) => <option key={p} value={p}>{p === 'anthropic' ? 'Anthropic (Claude)' : p}</option>)}
              </select>
            </label>
            <label>API key {data.key.set && <small className="muted">saved{data.key.hint ? ` (${data.key.hint})` : ''}</small>}
              <input type="password" value={key} autoComplete="off" placeholder={data.key.set ? 'Paste a new key to replace it' : 'sk-ant-…'} onChange={(e) => setKey(e.target.value)} />
            </label>
          </div>
          {data.key.unreadable && <div className="errors">The saved key can’t be read (the Hub’s secret key changed). Paste it again.</div>}
          <div className="row gap">
            <button className="btn" disabled={!key.trim()} onClick={async () => { await save({ apiKey: key.trim() }, 'Key saved on the Hub.'); setKey(''); }}>Save key</button>
            {data.key.set && <button className="btn ghost" onClick={() => confirm('Remove the API key? The DJ stops working until you add one.') && save({ apiKey: '' }, 'Key removed.')}>Remove key</button>}
            {data.key.set && <button className="btn small" onClick={async () => {
              try {
                setNote((await c.testDj()).message);
                setErr('');
              } catch (e) {
                setErr(errText(e));
              }
            }}>Test</button>}
          </div>
          <p className="muted small">Get a key at console.anthropic.com → API keys. Set a spending limit there too, as a backstop to the limits here.</p>
        </div>
      </section>

      <section>
        <h2>Model</h2>
        <div className="editor">
          <div className="editor-grid">
            <label>Model
              <select value={custom ? '' : s.model} onChange={(e) => {
                if (!e.target.value) return setCustom(true);
                setCustom(false);
                save({ model: e.target.value });
              }}>
                {data.models.map((m) => <option key={m.id} value={m.id}>{m.label}{m.id === data.defaultModel ? ' (default)' : ''}</option>)}
                <option value="">Other model id…</option>
              </select>
            </label>
            <label>How hard it thinks
              <select value={s.effort} onChange={(e) => save({ effort: e.target.value as HubDjSettings['effort'] })}>
                {data.efforts.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
            {custom && <label className="span2">Model id<input defaultValue={s.model} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== s.model && save({ model: e.target.value.trim() })} placeholder="claude-…" /></label>}
          </div>
          <p className="muted small">{known?.blurb ?? 'A model this page doesn’t know: enter its prices below so costs are counted.'} {EFFORT_HELP[s.effort]}</p>
          <h3>Prices for {known?.label ?? s.model} <small className="muted">(US$ per million tokens)</small></h3>
          <div className="editor-grid dj-prices">
            {(['input', 'output', 'cacheRead', 'cacheWrite'] as const).map((k) => (
              <label key={`${s.model}-${k}`}>{{ input: 'Input', output: 'Output', cacheRead: 'Cache read', cacheWrite: 'Cache write' }[k]}
                <input type="number" min={0} step="0.01" defaultValue={price[k]} onBlur={(e) => Number(e.target.value) !== price[k] && setPrice(k, e.target.value)} />
              </label>
            ))}
          </div>
          {s.prices[s.model] && known && <button className="btn small ghost" onClick={() => { const { [s.model]: _drop, ...rest } = s.prices; save({ prices: rest }); }}>Back to list prices</button>}
          <details>
            <summary className="muted small">Advanced</summary>
            <label className="check">
              <span className="switch"><input type="checkbox" checked={s.fallback} onChange={(e) => save({ fallback: e.target.checked })} /><span /></span>
              <span>When the model declines an answer, let Anthropic try another model <small className="muted">(Opus 5.5 and Sonnet 5.5)</small></span>
            </label>
            <div className="editor-grid">
              <label className="span2">API address <small className="muted">(empty = the provider’s own; for a gateway or proxy)</small>
                <input defaultValue={s.baseUrl} placeholder="https://api.anthropic.com" onBlur={(e) => e.target.value.trim() !== s.baseUrl && save({ baseUrl: e.target.value.trim() })} />
              </label>
            </div>
          </details>
        </div>
      </section>

      <section>
        <h2>Spending</h2>
        <p>This month: <b>{money(data.month.spent)}</b>{s.householdLimit !== null && <> of the household’s {money(s.householdLimit)}</>} <span className="muted small">· all time {money(data.allTime)}</span></p>
        {data.month.byModel.length > 0 && (
          <p className="muted small">{data.month.byModel.map((m) => `${m.model}: ${money(m.cost)} (${m.calls} calls, ${Math.round(m.inputTokens / 1000)}k in / ${Math.round(m.outputTokens / 1000)}k out)`).join(' · ')}</p>
        )}
        <div className="editor">
          <div className="editor-grid">
            <label>Household limit per month (US$)
              <input type="number" min={0} step="0.5" defaultValue={s.householdLimit ?? ''} placeholder="No limit"
                onBlur={(e) => limitValue(e.target.value) !== s.householdLimit && save({ householdLimit: limitValue(e.target.value) })} />
            </label>
            <label>Limit for each person, when you turn them on (US$)
              <input type="number" min={0} step="0.5" defaultValue={s.defaultUserLimit ?? ''} placeholder="No limit"
                onBlur={(e) => limitValue(e.target.value) !== s.defaultUserLimit && save({ defaultUserLimit: limitValue(e.target.value) })} />
            </label>
          </div>
          <p className="muted small">Costs are estimates from the prices above. Limits reset on the 1st of each month.</p>
        </div>
      </section>

      <section>
        <h2>Who can use it</h2>
        <p className="muted small">Off for everyone until you turn it on. Kids stay off unless you turn them on; for them the DJ sticks to family-friendly music, and their download requests go to a parent.</p>
        {grownUps.length > 0 && <button className="btn small" onClick={async () => { for (const u of grownUps) await access(u.id, { enabled: true }); }}>Turn on for all grown-ups</button>}
        {data.users.map((u) => (
          <div key={u.id} className={`source-row ${u.disabled ? 'off' : ''}`}>
            <div className="hub-avatar">{u.displayName.slice(0, 1).toUpperCase()}</div>
            <div className="track-main">
              <div className="track-title">{u.displayName} <span className="muted small">· {ROLE[u.role]}</span></div>
              <div className="track-sub">This month {money(u.spent)}{u.monthlyLimit !== null ? ` of ${money(u.monthlyLimit)}` : ''} · {u.calls} call{u.calls === 1 ? '' : 's'}</div>
            </div>
            <label className="dj-limit" title="Monthly limit in US$ (empty = no limit)">
              <small className="muted">Limit $</small>
              <input type="number" min={0} step="0.5" defaultValue={u.monthlyLimit ?? ''} placeholder="none"
                onBlur={(e) => limitValue(e.target.value) !== u.monthlyLimit && access(u.id, { monthlyLimit: limitValue(e.target.value) })} />
            </label>
            <label className="check">
              <span className="switch"><input type="checkbox" checked={u.enabled} onChange={(e) => access(u.id, { enabled: e.target.checked })} /><span /></span>
              <small>{u.enabled ? 'On' : 'Off'}</small>
            </label>
          </div>
        ))}
      </section>
    </>
  );
}
