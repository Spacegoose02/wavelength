import { describe, expect, it, vi } from 'vitest';
import { type MenuEntry, menuGuard, movedTooFar } from '../lib/contextMenu';

// the critters' rig loads the audio player, which wants a browser's Audio
vi.hoisted(() => {
  (globalThis as Record<string, unknown>).Audio = function Audio() {
    return new Proxy({}, { get: () => () => {} });
  };
});
import { sceneMenu, type SceneMenuActions, type SceneMenuState } from '../components/SceneMenu';
import { ACTS } from '../components/critters/Critter';
import { SPECIES } from '../components/critters/species';
import { SKINS } from '../store/settings';

describe('menuGuard', () => {
  it('opens once for a long-press and the contextmenu event that follows it', () => {
    const ok = menuGuard(700);
    expect(ok(1000, false)).toBe(true);
    expect(ok(1300, true)).toBe(false);
    expect(ok(1800, true)).toBe(true);
  });
  it('opens again straight away once the menu is closed', () => {
    const ok = menuGuard(700);
    expect(ok(1000, false)).toBe(true);
    expect(ok(1200, false)).toBe(true);
  });
});

describe('movedTooFar', () => {
  it('lets a finger wobble but counts a drag as a scroll', () => {
    expect(movedTooFar({ x: 0, y: 0 }, { x: 4, y: 5 })).toBe(false);
    expect(movedTooFar({ x: 0, y: 0 }, { x: 0, y: 14 })).toBe(true);
  });
});

describe('scene menu', () => {
  // components/Scenes.tsx's list, which can't load here (it pulls in the audio player)
  const SCENES = [{ id: 'art', label: 'Artwork' }, { id: 'stars', label: 'Starfield' }, { id: 'raccoon', label: 'Critters' }] as const satisfies { id: SceneMenuState['npScene']; label: string }[];
  const state: SceneMenuState = { npScene: 'stars', critter: 'raccoon', act: 'dj', critterLook: 'boy', skin: 'neon', seasonal: true, randomDaily: true };
  const actions = () => {
    const a = {
      setNpScene: vi.fn(), setCritter: vi.fn(), setAct: vi.fn(), setCritterLook: vi.fn(), setSkin: vi.fn(), setThemeMode: vi.fn(), settings: vi.fn(), hint: vi.fn(),
    } satisfies SceneMenuActions;
    return a;
  };
  const find = (items: MenuEntry[], label: string) => {
    const it = items.find((x) => x.label === label);
    if (!it) throw new Error(`no ${label}`);
    return it;
  };

  it('lists every scene, critter, act and theme', () => {
    const m = sceneMenu(state, actions(), [...SCENES]);
    expect(find(m, 'Scene').items).toHaveLength(SCENES.length);
    expect(find(m, 'Critter').items).toHaveLength(SPECIES.length);
    expect(find(m, 'Act').items).toHaveLength(ACTS.length);
    const skins = find(m, 'Theme').items!.flatMap((g) => g.items ?? []);
    expect(skins).toHaveLength(SKINS.length);
    expect(find(m, 'Scene').items!.find((x) => x.checked)?.label).toBe('Starfield');
  });

  it('picking a critter or an act switches to the critter scene', () => {
    const a = actions();
    const m = sceneMenu(state, a, [...SCENES]);
    // not on the critter scene yet: no critter is ticked
    expect(find(m, 'Critter').items!.some((x) => x.checked)).toBe(false);
    find(m, 'Critter').items!.find((x) => x.label === 'Shark')!.onSelect!();
    expect(a.setCritter).toHaveBeenCalledWith('shark');
    expect(a.setAct).toHaveBeenCalledWith('dj');
    expect(a.setNpScene).toHaveBeenCalledWith('raccoon');
    expect(a.hint).toHaveBeenCalledWith('DJ shark');
  });

  it('picking a theme by hand turns Random daily off', () => {
    const a = actions();
    const m = sceneMenu(state, a, [...SCENES]);
    const classic = find(m, 'Theme').items!.find((x) => x.label === 'Classic')!;
    expect(classic.note).toBe('Neon synth (default)');
    classic.items!.find((x) => x.label.startsWith('Midnight'))!.onSelect!();
    expect(a.setSkin).toHaveBeenCalledWith('plexamp');
    expect(a.setThemeMode).toHaveBeenCalledWith({ randomDaily: false });
  });

  it('offers the mouth tuner only on the critter scene, and only when it is on', () => {
    expect(sceneMenu(state, { ...actions(), tune: vi.fn() }, [...SCENES]).some((x) => x.label === 'Tune mouth')).toBe(false);
    expect(sceneMenu({ ...state, npScene: 'raccoon' }, actions(), [...SCENES]).some((x) => x.label === 'Tune mouth')).toBe(false);
    expect(sceneMenu({ ...state, npScene: 'raccoon' }, { ...actions(), tune: vi.fn() }, [...SCENES]).some((x) => x.label === 'Tune mouth')).toBe(true);
  });
});
