import { useState } from 'react';
import { FAMILY_NAMES, stationLabel } from '../lib/stationLabel';
import { findStationLogo } from '../sources/radio';
import type { Station } from '../sources/types';
import { EditDialog } from './EditDialog';

/** What Edit station changes: every field, as the station should be after saving ('' clears a field). */
export interface StationEdit {
  name: string;
  streamUrl: string;
  homepage: string;
  logo: string;
  genre: string;
}

/** Genres the field suggests: ones that put a station in each "By genre" group (lib/stationLabel.ts). */
const GENRES = ['Pop', 'Top 40', 'Hits', '80s', '90s', 'Oldies', 'Rock', 'Alternative', 'Indie', 'Metal', 'Dance', 'EDM', 'House', 'Hip-Hop', 'R&B', 'Country', 'Jazz', 'Soul', 'Blues', 'Chill', 'Lounge', 'Lo-fi', 'Classical', 'Latin', 'Reggae', 'K-pop', 'News', 'Talk', 'Sports'];

const isLink = (v: string) => /^https?:\/\/\S+$/i.test(v);

/**
 * Radio → Edit station: change a station after adding it. Its name, stream link, genre, home page and logo picture.
 * `everyone` says the change is for everyone on the server (Your stations) rather than this device (Favorites).
 * `fields` turns off what the server can't keep: a Navidrome without the Hub keeps no logo or genre.
 */
export function EditStation({ station, everyone, fields = { logo: true, genre: true }, onSave, onClose }: {
  station: Station;
  everyone: boolean;
  fields?: { logo: boolean; genre: boolean };
  onSave: (s: StationEdit) => Promise<void> | void;
  onClose: () => void;
}) {
  const start: StationEdit = {
    name: station.name,
    streamUrl: station.streamUrl,
    homepage: station.homepage ?? '',
    logo: station.favicon ?? '',
    genre: station.genre ?? '',
  };
  const [d, setD] = useState(start);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [logoFailed, setLogoFailed] = useState(false);
  const set = (k: keyof StationEdit, v: string) => {
    setD((x) => ({ ...x, [k]: v }));
    setMsg('');
    if (k === 'logo') setLogoFailed(false);
  };
  const t = (k: keyof StationEdit) => d[k].trim();
  const dirty = (Object.keys(start) as (keyof StationEdit)[]).some((k) => t(k) !== start[k].trim());
  const problem = !t('name') ? 'A station needs a name.'
    : !isLink(t('streamUrl')) ? 'The stream link must start with http:// or https://.'
    : t('homepage') && !isLink(t('homepage')) ? 'The home page must be an http(s) link.'
    : t('logo') && !isLink(t('logo')) ? 'The logo must be an http(s) link to a picture.'
    : '';
  // how its card reads with these changes
  const label = stationLabel({ name: t('name') || station.name, tags: station.tags, genre: fields.genre ? t('genre') : station.genre });

  const save = async () => {
    if (problem) return setMsg(problem);
    setBusy(true);
    setMsg('Saving…');
    try {
      await onSave({ name: t('name'), streamUrl: t('streamUrl'), homepage: t('homepage'), logo: t('logo'), genre: t('genre').split(/\s*[,/|]\s*/).filter(Boolean).join(', ') });
      onClose();
    } catch (e) {
      setMsg(`Couldn't save it: ${(e as Error).message ?? e}${everyone ? '. Only admins can change stations for everyone.' : ''}`);
      setBusy(false);
    }
  };

  const findLogo = async () => {
    setBusy(true);
    setMsg('Looking in the radio directory…');
    const logo = await findStationLogo({ name: t('name') || station.name, streamUrl: t('streamUrl') || station.streamUrl }).catch(() => undefined);
    setBusy(false);
    if (logo) {
      set('logo', logo);
      setMsg('Found one. Save to keep it.');
    } else setMsg('No logo found in the radio directory. Paste a picture link instead.');
  };

  return (
    <EditDialog
      className="narrow"
      title={`Edit ${station.name}`}
      tabs={[['station', 'Station']] as const}
      tab="station"
      onTab={() => undefined}
      busy={busy}
      onClose={onClose}
      footer={<>
        <span className="small edit-dialog-msg" role="status">{msg || (everyone ? 'Changes show for everyone on the server.' : 'Changes are kept on this device.')}</span>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={busy || !dirty}>Save changes</button>
      </>}
    >
      <div className="edit-fields">
        <div className="span2 station-edit-preview">
          <span className={`station-art fam-${label.family}`} aria-hidden>
            {t('logo') && fields.logo && !logoFailed ? <img src={t('logo')} alt="" onError={() => setLogoFailed(true)} /> : <span className="station-mark">{label.mark}</span>}
          </span>
          <span>
            <b>{label.title}</b>
            <small className="muted">{[...label.genres.slice(0, 3), label.place].filter(Boolean).join(' · ') || 'No genre'} · in {FAMILY_NAMES[label.family]}</small>
          </span>
        </div>
        <label className="span2">Name
          <input value={d.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </label>
        <label className="span2">Stream link
          <input value={d.streamUrl} inputMode="url" placeholder="https://…" onChange={(e) => set('streamUrl', e.target.value)} />
        </label>
        {fields.genre ? (
          <label className="span2">Genre
            <input list="station-genres" value={d.genre} placeholder="Rock, Indie (empty goes by the name)" onChange={(e) => set('genre', e.target.value)} />
            <datalist id="station-genres">{GENRES.map((g) => <option key={g} value={g} />)}</datalist>
          </label>
        ) : (
          <p className="span2 edit-hint"><span>This server keeps no genre. Put it in brackets after the name, like “KEXP (Indie/Rock)”, and the card picks it up.</span></p>
        )}
        <label className="span2">Home page
          <input value={d.homepage} inputMode="url" placeholder="https://… (optional)" onChange={(e) => set('homepage', e.target.value)} />
        </label>
        {fields.logo && (
          <div className="span2 edit-field">
            <span className="edit-field-label">Logo picture link</span>
            <span className="row gap">
              <input className="grow" value={d.logo} inputMode="url" placeholder="https://… (empty for a tile in its genre colour)" onChange={(e) => set('logo', e.target.value)} />
              <button type="button" className="btn small ghost" disabled={busy} onClick={findLogo}>Find logo</button>
            </span>
            {logoFailed && <small className="danger">That picture didn't load. Check the link.</small>}
          </div>
        )}
      </div>
    </EditDialog>
  );
}
