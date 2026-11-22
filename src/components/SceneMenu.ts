import type { MenuEntry } from '../lib/contextMenu';
import { type Act, type CritterLook, type NpScene, type Skin, type Species, SKIN_GROUPS, SKINS } from '../store/settings';
import { ACTS, critterLabel } from './critters/Critter';
import { SPECIES } from './critters/species';

/** The bits of settings the scene menu shows (store/settings.ts). */
export interface SceneMenuState {
  npScene: NpScene;
  critter: Species;
  act: Act;
  critterLook: CritterLook;
  skin: Skin;
  seasonal: boolean;
  randomDaily: boolean;
}

export interface SceneMenuActions {
  setNpScene(s: NpScene): void;
  setCritter(c: Species): void;
  setAct(a: Act): void;
  setCritterLook(l: CritterLook): void;
  setSkin(s: Skin): void;
  setThemeMode(m: { seasonal?: boolean; randomDaily?: boolean }): void;
  /** opens the mouth tuner; left out when it's switched off */
  tune?: () => void;
  /** Settings → Themes & critters */
  settings(): void;
  /** a short label over the stage after a pick */
  hint?(label: string): void;
}

/**
 * What right-clicking (or long-pressing) the Now Playing scene offers (components/Scenes.tsx): the visualizer, the
 * critter, its act, boy or girl, and the app's theme. Picking a critter or an act also switches to the critter scene.
 */
export function sceneMenu(s: SceneMenuState, a: SceneMenuActions, scenes: { id: NpScene; label: string }[]): MenuEntry[] {
  const critters = s.npScene === 'raccoon';
  const toCritters = (critter: Species, act: Act) => {
    a.setCritter(critter);
    a.setAct(act);
    a.setNpScene('raccoon');
    a.hint?.(critterLabel(critter, act));
  };
  const sceneLabel = (id: NpScene) => scenes.find((x) => x.id === id)?.label ?? 'Artwork';
  const skinLabel = (id: Skin) => SKINS.find((x) => x.id === id)?.label ?? id;
  const pickSkin = (id: Skin) => {
    a.setSkin(id);
    // picking a theme by hand means "show me this one": daily shuffle would hide it
    if (s.randomDaily) a.setThemeMode({ randomDaily: false });
  };
  return [
    {
      label: 'Scene',
      note: sceneLabel(s.npScene),
      items: scenes.map((x) => ({
        label: x.label,
        checked: s.npScene === x.id,
        onSelect: () => {
          a.setNpScene(x.id);
          a.hint?.(x.id === 'raccoon' ? critterLabel(s.critter, s.act) : x.label);
        },
      })),
    },
    {
      label: 'Critter',
      items: SPECIES.map((x) => ({ label: x.label, checked: critters && s.critter === x.id, onSelect: () => toCritters(x.id, s.act) })),
    },
    {
      label: 'Act',
      items: ACTS.map((x) => ({ label: x.label, hint: x.blurb, checked: critters && s.act === x.id, onSelect: () => toCritters(s.critter, x.id) })),
    },
    {
      label: 'Boy or girl',
      items: (['boy', 'girl'] as const).map((l) => ({ label: l === 'boy' ? 'Boy' : 'Girl', checked: s.critterLook === l, onSelect: () => a.setCritterLook(l) })),
    },
    {
      label: 'Theme',
      note: s.randomDaily ? 'Random daily' : undefined,
      items: [
        { label: 'Holiday themes in season', hint: 'Switches to the holiday theme in the weeks around each holiday', checked: s.seasonal, onSelect: () => a.setThemeMode({ seasonal: !s.seasonal }) },
        { label: 'A different theme every day', checked: s.randomDaily, onSelect: () => a.setThemeMode({ randomDaily: !s.randomDaily }) },
        ...SKIN_GROUPS.map((g, i) => {
          const list = SKINS.filter((x) => x.group === g);
          const mine = list.some((x) => x.id === s.skin);
          return {
            label: g,
            sep: i === 0,
            note: mine ? skinLabel(s.skin) : undefined,
            items: list.map((x) => ({ label: x.label, checked: s.skin === x.id, onSelect: () => pickSkin(x.id) })),
          };
        }),
      ],
    },
    ...(a.tune && critters ? [{ label: 'Tune mouth', sep: true, onSelect: a.tune }] : []),
    { label: 'Theme and critter settings…', sep: !(a.tune && critters), onSelect: a.settings },
  ];
}
