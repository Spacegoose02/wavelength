import type { SVGProps } from 'react';

const make = (d: string, fill = false) =>
  function Icon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg viewBox="0 0 24 24" width="1em" height="1em" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'}
        strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
        <path d={d} />
      </svg>
    );
  };

export const IconPlay = make('M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z', true);
export const IconPause = make('M6 4h4v16H6zM14 4h4v16h-4z', true);
export const IconNext = make('M5 4.5v15a1 1 0 0 0 1.5.86L16 14.5V19a1 1 0 0 0 2 0V5a1 1 0 0 0-2 0v4.5L6.5 3.64A1 1 0 0 0 5 4.5z', true);
export const IconPrev = make('M19 4.5v15a1 1 0 0 1-1.5.86L8 14.5V19a1 1 0 0 1-2 0V5a1 1 0 0 1 2 0v4.5l9.5-5.86A1 1 0 0 1 19 4.5z', true);
export const IconShuffle = make('M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5');
export const IconRepeat = make('M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3');
export const IconHome = make('M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z');
export const IconAlbum = make('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z');
export const IconArtist = make('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0');
export const IconSearch = make('M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3');
export const IconRadio = make('M4.9 19.1a10 10 0 0 1 0-14.2M19.1 4.9a10 10 0 0 1 0 14.2M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z');
export const IconBook = make('M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5');
export const IconDownload = make('M12 3v12M7 10l5 5 5-5M5 21h14');
export const IconSettings = make('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z');
export const IconQueue = make('M3 6h13M3 12h13M3 18h9M17 15v6l4-3z');
export const IconVolume = make('M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14');
export const IconBack = make('M15 18l-6-6 6-6');
export const IconChevronDown = make('M6 9l6 6 6-6');
export const IconPlus = make('M12 5v14M5 12h14');
export const IconHeart = make('M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z');
export const IconX = make('M18 6 6 18M6 6l12 12');
export const IconHistory = make('M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 3');
export const IconPodcast = make('M12 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM11 17h2l.5 5h-3zM7.5 15.5a6 6 0 1 1 9 0M4.6 18.4a10 10 0 1 1 14.8 0');
export const IconPlaylist = make('M3 6h12M3 12h12M3 18h7M17 18a2 2 0 1 0 4 0V8l-4 1');
export const IconWave = make('M2 12h2l2-6 3 12 3-15 3 15 3-9 2 3h2');
export const IconCompass = make('M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM16.2 7.8l-2.1 6.3-6.3 2.1 2.1-6.3z');
export const IconSparkle = make('M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z');
export const IconLibrary = make('M4 4v16M9 4v16M14 5l5 14.5');
export const IconMore = make('M5 12h.01M12 12h.01M19 12h.01');
export const IconRefresh = make('M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6');
export const IconShare = make('M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4');
export const IconInbox = make('M22 12h-6l-2 3h-4l-2-3H2M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z');
export const IconCast = make('M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6M2 20h.01');
export const IconParty = make('M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M16 3.13a4 4 0 0 1 0 7.75M22 21v-1a6 6 0 0 0-4-5.65');
