import type { ReactNode } from "react";

import type { DisplayInfo } from "../desktopApi";
import { IconClose, IconMinimize } from "./icons";

export function IconButton({
  children,
  onClick,
  title,
  variant,
}: {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  variant?: "on" | "active" | "close";
}) {
  const modifier = variant ? ` icon-btn--${variant}` : "";
  return (
    <button className={`icon-btn${modifier}`} onClick={onClick} title={title} type="button">
      {children}
    </button>
  );
}

export function TitleBar({
  title,
  left,
  right,
  onMinimize,
  onClose,
}: {
  title: string;
  left?: ReactNode;
  right?: ReactNode;
  onMinimize?: () => void;
  onClose: () => void;
}) {
  return (
    <div className="titlebar">
      <div className="titlebar__side titlebar__side--left">{left}</div>
      <div className="titlebar__drag">{title}</div>
      <div className="titlebar__side titlebar__side--right">
        {right}
        {onMinimize && (
          <IconButton onClick={onMinimize} title="Minimize">
            <IconMinimize />
          </IconButton>
        )}
        <IconButton onClick={onClose} title="Close" variant="close">
          <IconClose />
        </IconButton>
      </div>
    </div>
  );
}

export function Card({
  title,
  control,
  children,
  disabled,
}: {
  title: string;
  control?: ReactNode;
  children?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <section className="card">
      <div className="card__head">
        <span className="card__title">{title}</span>
        <span className="card__spacer" />
        {control}
      </div>
      {children && <div className={`card__body${disabled ? " card__body--off" : ""}`}>{children}</div>}
    </section>
  );
}

export function Toggle({
  value,
  onChange,
  green,
  labels = ["OFF", "ON"],
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  green?: boolean;
  labels?: [string, string];
}) {
  const onClass = green ? "toggle__side toggle__side--on-green" : "toggle__side toggle__side--on";
  return (
    <div className="toggle">
      <button
        type="button"
        className={value ? "toggle__side" : "toggle__side toggle__side--on"}
        onClick={() => onChange(false)}
      >
        {labels[0]}
      </button>
      <button type="button" className={value ? onClass : "toggle__side"} onClick={() => onChange(true)}>
        {labels[1]}
      </button>
    </div>
  );
}

export interface SegmentOption<T> {
  value: T;
  label: string;
  title?: string;
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  wide,
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (next: T) => void;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "seg seg--wide" : "seg"}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          title={option.title ?? option.label}
          className={option.value === value ? "seg__item seg__item--on" : "seg__item"}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function StatusDot({ state }: { state: "ok" | "warn" | "off" }) {
  return <span className={`dot dot--${state}`} />;
}

/** Clickable map of the real monitor layout, labeled Left / Center / Right. */
export function MonitorPicker({
  displays,
  value,
  onChange,
  compact,
}: {
  displays: DisplayInfo[];
  value: number;
  onChange: (id: number) => void;
  compact?: boolean;
}) {
  if (displays.length === 0) return null;

  const minX = Math.min(...displays.map((d) => d.bounds.x));
  const minY = Math.min(...displays.map((d) => d.bounds.y));
  const worldW = Math.max(1, Math.max(...displays.map((d) => d.bounds.x + d.bounds.width)) - minX);
  const worldH = Math.max(1, Math.max(...displays.map((d) => d.bounds.y + d.bounds.height)) - minY);

  const maxW = compact ? 238 : 320;
  const maxH = compact ? 70 : 96;
  const scale = Math.min(maxW / worldW, maxH / worldH);
  const mapW = Math.max(132, Math.round(worldW * scale));
  const mapH = Math.max(compact ? 46 : 56, Math.round(worldH * scale));
  const showRes = !compact && mapH >= 62;

  return (
    <div className={`mon-map-wrap${compact ? " mon-map-wrap--compact" : ""}`}>
      <div className="mon-map" style={{ width: mapW, height: mapH }}>
        {displays.map((display) => {
          const selected = display.id === value;
          return (
            <button
              key={display.id}
              type="button"
              className={selected ? "mon-map__item mon-map__item--on" : "mon-map__item"}
              style={{
                left: `calc(${((display.bounds.x - minX) / worldW) * 100}% + 2px)`,
                top: `calc(${((display.bounds.y - minY) / worldH) * 100}% + 2px)`,
                width: `calc(${(display.bounds.width / worldW) * 100}% - 4px)`,
                height: `calc(${(display.bounds.height / worldH) * 100}% - 4px)`,
              }}
              title={display.label}
              onClick={() => onChange(display.id)}
            >
              <span className="mon-map__name">{display.shortLabel}</span>
              {showRes && (
                <span className="mon-map__res">
                  {display.bounds.width}×{display.bounds.height}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Button({
  children,
  onClick,
  icon,
  variant,
  block,
  large,
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  icon?: ReactNode;
  variant?: "primary" | "danger";
  block?: boolean;
  large?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const classes = ["btn"];
  if (variant) classes.push(`btn--${variant}`);
  if (block) classes.push("btn--block");
  if (large) classes.push("btn--lg");
  return (
    <button type={type} className={classes.join(" ")} onClick={onClick} disabled={disabled}>
      {icon}
      {children}
    </button>
  );
}
