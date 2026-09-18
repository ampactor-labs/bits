// Small shared controls: a named three-state segmented control, a progress
// ring, a mic level meter, and a labelled slider.
//
// Wires used to be tap-to-cycle with one or two dots for a level, which
// gave no clue it was a three-state control (audit F31). Segmented names
// the states.

export interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}

export function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          className={`segment${o.value === value ? ' on' : ''}`}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export interface ProgressRingProps {
  /** 0 to 1, or null for an indeterminate spinner. */
  value: number | null;
  label: string;
  size?: number;
}

export function ProgressRing({ value, label, size = 28 }: ProgressRingProps) {
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  const determinate = value !== null && Number.isFinite(value);
  return (
    <svg
      className={`ring${determinate ? '' : ' ring-spin'}`}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
    >
      <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--line)" strokeWidth={3} fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke="var(--accent)"
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={determinate ? c * (1 - Math.min(1, Math.max(0, value))) : c * 0.75}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

export interface MeterProps {
  /** 0 to 1. */
  level: number;
  label: string;
}

/** Mic level. A silent mic looks identical to a working one without it. */
export function Meter({ level, label }: MeterProps) {
  const pct = Math.round(Math.min(1, Math.max(0, level)) * 100);
  return (
    <div
      className="meter"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <div className="meter-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  format,
  onChange,
  onCommit,
}: SliderProps) {
  return (
    <label className="slider">
      <span className="slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={() => onCommit?.(value)}
        onKeyUp={() => onCommit?.(value)}
      />
      <span className="slider-value">{format ? format(value) : value.toFixed(2)}</span>
    </label>
  );
}
