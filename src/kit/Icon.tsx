// One inline SVG sprite for every glyph in the chrome. Emoji render
// differently on every platform and carry no accessible name of their own,
// so they stay inside user content and out of the controls (audit F12, F40).
//
// 24x24 grid, 2px stroke, currentColor. Icons are decorative: the label
// lives on the control (see IconButton).

export type IconName =
  | 'record'
  | 'stop'
  | 'play'
  | 'undo'
  | 'redo'
  | 'plus'
  | 'back'
  | 'more'
  | 'close'
  | 'check'
  | 'warning'
  | 'help'
  | 'trash'
  | 'photo'
  | 'selfie'
  | 'doodle'
  | 'text'
  | 'backdrop'
  | 'mic'
  | 'file'
  | 'sound'
  | 'mouth'
  | 'eyes'
  | 'scissors'
  | 'pin'
  | 'flip'
  | 'layerUp'
  | 'layerDown'
  | 'center'
  | 'duplicate'
  | 'lanes'
  | 'collapse'
  | 'render'
  | 'share'
  | 'save'
  | 'bitfile'
  | 'loop'
  | 'mute'
  | 'trails'
  | 'foley'
  | 'body'
  | 'blind';

/** Path data only; every icon shares the stroke setup below. */
const STROKE: Record<IconName, string> = {
  record: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z',
  stop: 'M7 7h10v10H7z',
  play: 'M8 5.5v13l11-6.5z',
  undo: 'M4 9h10a5 5 0 0 1 0 10h-3M4 9l4-4M4 9l4 4',
  redo: 'M20 9H10a5 5 0 0 0 0 10h3M20 9l-4-4M20 9l-4 4',
  plus: 'M12 5v14M5 12h14',
  back: 'M15 5l-7 7 7 7',
  more: 'M12 6.5h.01M12 12h.01M12 17.5h.01',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 13l4 4 10-10',
  warning: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  help: 'M9 9a3 3 0 1 1 3 3v2M12 18h.01',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5',
  photo: 'M3 6h18v13H3zM3 15l5-4 4 3 3-3 6 5',
  selfie: 'M12 10a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM4 8h3l2-3h6l2 3h3v11H4zM8 5V3',
  doodle: 'M4 18c3-9 6 4 9-3s4 2 7-4M4 20h16',
  text: 'M5 7V5h14v2M12 5v14M9 19h6',
  backdrop: 'M3 5h18v14H3zM3 14l6-5 5 4 3-2 4 3',
  mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3ZM5 11a7 7 0 0 0 14 0M12 18v3',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h6',
  sound: 'M3 12h2l2-5 3 11 3-14 3 11 2-3h3',
  mouth: 'M5 11c3 5 11 5 14 0M5 11c3-3 11-3 14 0',
  eyes: 'M8 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM16 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM8 12h.01M16 12h.01',
  scissors: 'M7 5l10 12M17 5L7 17M6 18a2.5 2.5 0 1 0 0 1M18 18a2.5 2.5 0 1 1 0 1',
  pin: 'M12 3v8M12 11a4 4 0 0 0-4 4h8a4 4 0 0 0-4-4ZM12 15v6',
  flip: 'M12 4v16M8 8L4 12l4 4M16 8l4 4-4 4',
  layerUp: 'M12 4l7 5-7 5-7-5zM5 15l7 5 7-5',
  layerDown: 'M12 20l7-5-7-5-7 5zM5 9l7-5 7 5',
  center: 'M12 4v4M12 16v4M4 12h4M16 12h4M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
  duplicate: 'M9 3h12v12H9zM15 21H3V9h3',
  lanes: 'M12 5l5 5H7zM4 15h16M4 19h16',
  collapse: 'M12 19l-5-5h10zM4 5h16M4 9h16',
  render: 'M3 5h18v14H3zM3 9h18M7 5v14M17 5v14',
  share: 'M12 16V4M12 4L8 8M12 4l4 4M5 14v5h14v-5',
  save: 'M12 4v12M12 16l-4-4M12 16l4-4M5 19h14',
  bitfile: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9',
  loop: 'M7 7h10a4 4 0 0 1 0 8h-1M7 7l3-3M7 7l3 3M17 17H7a4 4 0 0 1 0-8h1M17 17l-3 3M17 17l-3-3',
  mute: 'M4 9h4l5-4v14l-5-4H4zM17 9l4 6M21 9l-4 6',
  trails: 'M4 12h3M9 12h3M14 12h3M19 12h1M6 7h2M11 7h2M16 7h2M6 17h2M11 17h2M16 17h2',
  foley: 'M12 4v6M12 14v6M6 7l3 3M15 14l3 3M4 12h5M15 12h5M6 17l3-3M15 10l3-3',
  body: 'M12 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM12 7v8M12 15l-3 6M12 15l3 6M6 10l6 1 6-1',
  blind: 'M3 4h18v3H3zM6 7v13M10 7v13M14 7v13M18 7v13',
};

/** Icons drawn as filled shapes rather than strokes. */
const FILLED = new Set<IconName>(['record', 'stop', 'play']);

export interface IconProps {
  name: IconName;
  /** Pixel size of the square box. Defaults to 24. */
  size?: number;
  className?: string;
}

export function Icon({ name, size = 24, className }: IconProps) {
  const filled = FILLED.has(name);
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={STROKE[name]}
        stroke={filled ? 'none' : 'currentColor'}
        fill={filled ? 'currentColor' : 'none'}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const ICON_NAMES = Object.keys(STROKE) as IconName[];
