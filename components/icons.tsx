/** A small, consistent icon set: 16px, 1.5px stroke, currentColor. Decorative unless labeled. */
import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 16, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false" {...props}>
      {children}
    </svg>
  );
}

export const IconCheck = (p: IconProps) => <Icon {...p}><path d="M3.5 8.5l3 3 6-7" /></Icon>;
export const IconX = (p: IconProps) => <Icon {...p}><path d="M4 4l8 8M12 4l-8 8" /></Icon>;
export const IconPause = (p: IconProps) => <Icon {...p}><path d="M6 4v8M10 4v8" /></Icon>;
export const IconDots = (p: IconProps) => <Icon {...p}><path d="M4 8h.01M8 8h.01M12 8h.01" strokeWidth={2.2} /></Icon>;
export const IconBan = (p: IconProps) => <Icon {...p}><circle cx="8" cy="8" r="5.5" /><path d="M4.2 11.8l7.6-7.6" /></Icon>;
export const IconClock = (p: IconProps) => <Icon {...p}><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3l2 1.5" /></Icon>;
export const IconAlert = (p: IconProps) => <Icon {...p}><path d="M8 2.5l6 10.5H2L8 2.5z" /><path d="M8 6.5v3M8 11.2h.01" /></Icon>;
export const IconInfo = (p: IconProps) => <Icon {...p}><circle cx="8" cy="8" r="5.5" /><path d="M8 7.5v3M8 5.3h.01" /></Icon>;
export const IconSend = (p: IconProps) => <Icon {...p}><path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" /></Icon>;
export const IconDownload = (p: IconProps) => <Icon {...p}><path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10" /></Icon>;
export const IconChevron = (p: IconProps) => <Icon {...p}><path d="M6 4l4 4-4 4" /></Icon>;
export const IconExternal = (p: IconProps) => <Icon {...p}><path d="M9.5 3H13v3.5M13 3L7.5 8.5M11 9.5V13H3V5h3.5" /></Icon>;
export const IconUser = (p: IconProps) => <Icon {...p}><circle cx="8" cy="5.5" r="2.5" /><path d="M3 13.5c.8-2.4 2.7-3.5 5-3.5s4.2 1.1 5 3.5" /></Icon>;
export const IconSearch = (p: IconProps) => <Icon {...p}><circle cx="7" cy="7" r="4.25" /><path d="M10.2 10.2L13.5 13.5" /></Icon>;
export const IconLayers = (p: IconProps) => <Icon {...p}><path d="M8 2.5l5.5 3L8 8.5l-5.5-3L8 2.5z" /><path d="M2.5 8.5L8 11.5l5.5-3M2.5 11L8 14l5.5-3" /></Icon>;
export const IconFileText = (p: IconProps) => <Icon {...p}><path d="M9.5 2H4.5v12h7V4L9.5 2z" /><path d="M6.5 7.5h3M6.5 10h3" /></Icon>;
export const IconCalendar = (p: IconProps) => <Icon {...p}><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></Icon>;
export const IconTable = (p: IconProps) => <Icon {...p}><rect x="2.5" y="3" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M2.5 10h11M6.5 6.5V13" /></Icon>;
export const IconNote = (p: IconProps) => <Icon {...p}><path d="M3 3.5h10M3 6.5h10M3 9.5h6" /></Icon>;
export const IconTerminal = (p: IconProps) => <Icon {...p}><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M4.5 6.5L6.5 8l-2 1.5M8.5 10h3" /></Icon>;

/** The brand mark: a desk tray with a check. Drawn on an ink square. */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-md bg-ink text-ink-fg" style={{ width: size, height: size }}>
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.5 9.5h3l1 1.5h3l1-1.5h3" />
        <path d="M2.5 9.5V13h11V9.5" />
        <path d="M5.5 5l2 2 3.5-4" />
      </svg>
    </span>
  );
}

export function FileIcon({ kind, size }: { kind: string; size?: number }) {
  return kind === "ics" ? <IconCalendar size={size} /> : kind === "csv" ? <IconTable size={size} /> : <IconFileText size={size} />;
}
