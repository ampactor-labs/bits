// An icon-only control. `label` is required by the type, so it is not
// possible to ship a button a screen reader cannot name (audit F40).

import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';

type NativeProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'>;

export interface IconButtonProps extends NativeProps {
  icon: IconName;
  /** Spoken name for the control. Required: an unlabelled icon is a bug. */
  label: string;
  /** Show the label under the icon as well. */
  showLabel?: boolean;
  size?: number;
}

export function IconButton({
  icon,
  label,
  showLabel = false,
  size = 24,
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={['iconbtn', showLabel ? 'iconbtn-labelled' : '', className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      <Icon name={icon} size={size} />
      {showLabel && <span className="iconbtn-text">{label}</span>}
    </button>
  );
}
