import { useEffect, useRef, useState } from 'react';
import { djTurn, finish, lastPlaylist, toolLabel } from '../lib/dj';
import { HubError, type HubDjChat, type HubDjEntry, type HubDjStatus, type HubDjTurn } from '../sources/hub';
import { hubClient } from '../store/hub';
import { useUi } from '../store/ui';
import { useIsKid } from '../lib/kids';
import { Empty, Spinner } from '../components/common';

/**
 * The AI DJ (docs/AI-DJ.md): chat to find music, build playlists, queue songs and find missing albums.
 * The Hub runs the model with the key it keeps; the searching and playing happen here (lib/dj.ts).
 */

const IDEAS = [
  'Make me a 25-song playlist for a road trip',
  'Play something like what I listened to this week',
  'Which Radiohead albums am I missing?',
  'Queue up some chill music for dinner',
];
const KID_IDEAS = ['Play some fun songs to dance to', 'Make me a playlist for the car', 'Play songs like my favorite one'];

const money = (n: number) => (n < 0.01 && n > 0 ? '<$0.01' : `$${n.toFixed(2)}`);

export function DJ() {
  const hub = hubClient();
  const kid = useIsKid();
  const [status, setStatus] = useState<HubDjStatus | null>(null);
  const [chats, setChats] = useState<HubDjChat[]>([]);
  const [chatId, setChatId] = useState<number | null>(null);
  const [entries, setEntries] = useState<HubDjEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [full, setFull] = useState(false);
  const [spent, setSpent] = useState<{ spent: number; limit: number | null } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hub) return;
    hub.djStatus().then((s) => {
      setStatus(s);
      setSpent(s);
      if (s.available) hub.djChats().then((c) => setChats(c.chats)).catch(() => undefined);
    }).catch((e) => setError(String((e as Error).message)));
  }, []);

  useEffect(() => bottom.current?.scrollIntoView({ block: 'end' }), [entries, busy]);

  if (!hub) return <Empty title="AI DJ">Sign in to a Wavelength Hub to use the DJ.</Empty>;
  if (!status) return error ? <Empty title="AI DJ">{error}</Empty> : <Spinner />;
  if (!status.available) return <Empty title="AI DJ isn’t on for you">{status.reason}</Empty>;

  /** Show a turn: the DJ's reply so far replaces the last DJ bubble of this message. */
  const show = (base: HubDjEntry[], t: HubDjTurn, doing?: string) => {
    setEntries([...base, { role: 'assistant', text: t.reply }]);
    setBusy(doing ?? (t.status === 'tools' ? 'Working…' : null));
    setSpent({ spent: t.spent, limit: t.limit });
    setFull(!!t.full);
  };

  const open = async (id: number | null) => {
    setError('');
    setChatId(id);
    setFull(false);
    if (id === null) return setEntries([]);
    try {
      const c = await hub.djChat(id);
      setEntries(c.messages);
      setFull(c.full);
      // left waiting for this app (closed mid-answer): carry on
      if (c.calls?.length) {
        const last = c.messages[c.messages.length - 1];
        const base = last?.role === 'assistant' ? c.messages.slice(0, -1) : c.messages;
        const t = await finish(hub, { chat: c.chat, status: 'tools', reply: last?.role === 'assistant' ? last.text : '', calls: c.calls, spent: spent?.spent ?? 0, limit: spent?.limit ?? null }, (t, d) => show(base, t, d));
        show(base, t);
      }
    } catch (e) {
      setError(String((e as Error).message));
    }
  };

  const send = async (text = draft) => {
    const message = text.trim();
    if (!message || busy) return;
    setError('');
    setDraft('');
    const base = [...entries, { role: 'user' as const, text: message }];
    setEntries(base);
    setBusy('Thinking…');
    try {
      const t = await djTurn(hub, chatId, message, (t, d) => show(base, t, d));
      show(base, t);
      if (chatId !== t.chat.id) {
        setChatId(t.chat.id);
        setChats((cs) => [t.chat, ...cs.filter((c) => c.id !== t.chat.id)]);
      }
    } catch (e) {
      setBusy(null);
      setError(e instanceof HubError ? e.message : `Couldn’t reach the Hub: ${String((e as Error).message)}`);
      // refused before the Hub kept the message (limit reached, not allowed): give the words back
      if (e instanceof HubError && [400, 402, 403, 409].includes(e.status)) {
        setDraft(message);
        setEntries(entries);
      } else if (chatId === null) hub.djChats().then((c) => setChats(c.chats)).catch(() => undefined);
    }
  };

  const remove = async () => {
    if (chatId === null || !confirm('Delete this chat?')) return;
    await hub.djDeleteChat(chatId).catch(() => undefined);
    setChats((cs) => cs.filter((c) => c.id !== chatId));
    open(null);
  };

  const playlistId = chatId !== null ? lastPlaylist.get(chatId) : undefined;

  return (
    <div className="page dj">
      <header className="page-head">
        <h1>AI DJ <small>{status.model}</small></h1>
        <div className="dj-chats">
          <select value={chatId ?? ''} onChange={(e) => open(e.target.value ? Number(e.target.value) : null)} aria-label="Chats">
            <option value="">New chat</option>
            {chats.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
          {chatId !== null && <button className="btn small ghost" onClick={remove}>Delete</button>}
        </div>
      </header>

      <div className="dj-log">
        {!entries.length && (
          <div className="dj-ideas">
            <p className="muted">Ask for a playlist, a mood, something like an artist you love, or the albums you’re missing.</p>
            {(kid ? KID_IDEAS : IDEAS).map((i) => <button key={i} className="btn small" onClick={() => send(i)}>{i}</button>)}
          </div>
        )}
        {entries.map((e, i) => (
          <div key={i} className={`dj-msg ${e.role}`}>
            {e.text && <div className="dj-bubble">{e.text}</div>}
            {e.tools?.length ? <div className="dj-tools muted small">{[...new Set(e.tools.map(toolLabel))].join(' · ')}</div> : null}
          </div>
        ))}
        {busy && <div className="dj-msg assistant"><div className="dj-busy muted small"><Spinner /> {busy}</div></div>}
        {playlistId && !busy && <button className="btn small" onClick={() => useUi.getState().go({ view: 'playlist', id: playlistId })}>Open the playlist</button>}
        {error && <p className="card-err">{error}</p>}
        <div ref={bottom} />
      </div>

      {full ? (
        <p className="muted">This chat is full. <button className="btn small" onClick={() => open(null)}>Start a new chat</button></p>
      ) : (
        <form className="dj-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <textarea rows={2} value={draft} placeholder="Ask the DJ…" onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <button className="btn primary" type="submit" disabled={!!busy || !draft.trim()}>Send</button>
        </form>
      )}
      {spent && (
        <p className="muted small dj-spend">
          This month: {money(spent.spent)}{spent.limit !== null && ` of your ${money(spent.limit)} allowance`}
        </p>
      )}
    </div>
  );
}
