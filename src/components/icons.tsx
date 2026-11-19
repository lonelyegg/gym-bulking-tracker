// Small line-icon set (24×24, 2px strokes) so the UI doesn't depend on emoji for chrome.
import type { JSX } from 'preact';

type P = { size?: number; class?: string };
const base = (size = 22, cls = '', children: JSX.Element | JSX.Element[]) => (
  <svg class={`icon ${cls}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{children}</svg>
);

export const IconHome = ({ size, class: c }: P) => base(size, c, [<path d="M3 10.5 12 3l9 7.5" />, <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />]);
export const IconCalendar = ({ size, class: c }: P) => base(size, c, [<rect x="3" y="4.5" width="18" height="17" rx="3" />, <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />]);
export const IconDumbbell = ({ size, class: c }: P) => base(size, c, [<path d="M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11" />]);
export const IconGear = ({ size, class: c }: P) => base(size, c, [<circle cx="12" cy="12" r="3" />, <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />]);
export const IconChevron = ({ size = 18, class: c }: P) => base(size, c, <path d="m9 6 6 6-6 6" />);
export const IconChevronLeft = ({ size = 18, class: c }: P) => base(size, c, <path d="m15 6-6 6 6 6" />);
export const IconFlame = ({ size, class: c }: P) => base(size, c, <path d="M12 22c4 0 7-2.7 7-6.8 0-3.6-2.4-5.9-4.2-8.2-.4 1.9-1.4 3-2.6 3.6C12.6 7.4 11.3 4.5 8.6 2c.2 3.3-1.6 5.3-2.9 7.2A8.3 8.3 0 0 0 5 15.2C5 19.3 8 22 12 22z" />);
export const IconTrophy = ({ size, class: c }: P) => base(size, c, [<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z" />, <path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" />]);
export const IconTrend = ({ size, class: c }: P) => base(size, c, [<path d="m3 17 6-6 4 4 8-8" />, <path d="M15 7h6v6" />]);
export const IconTimer = ({ size, class: c }: P) => base(size, c, [<circle cx="12" cy="13" r="8" />, <path d="M12 9v4l2.5 2.5M9 2h6" />]);
export const IconPlay = ({ size = 18, class: c }: P) => (
  <svg class={`icon ${c ?? ''}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.4-6.5a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5z" fill="currentColor" /></svg>
);
export const IconSwap = ({ size = 18, class: c }: P) => base(size, c, [<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />]);
export const IconFood = ({ size, class: c }: P) => base(size, c, [<path d="M7 2v8a2 2 0 0 0 2 2v10M11 2v8a2 2 0 0 1-2 2M9 2v5" />, <path d="M17 22V2c-2.2 1.2-3.5 3.6-3.5 6.5V13H17" />]);
export const IconScale = ({ size, class: c }: P) => base(size, c, [<rect x="3" y="3" width="18" height="18" rx="5" />, <path d="M8.5 9.5a5 5 0 0 1 7 0M12 12l1.5-2.5" />]);
export const IconPlus = ({ size = 18, class: c }: P) => base(size, c, <path d="M12 5v14M5 12h14" />);
