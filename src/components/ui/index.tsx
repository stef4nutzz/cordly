'use client';

import Image from 'next/image';
import {
  Check,
  ChevronDown,
  X,
} from 'lucide-react';
import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';

const controlClass =
  'rounded-control border border-cordly-border bg-cordly-elevated px-3 py-2 text-sm text-cordly-text outline-none transition focus-visible:ring-2 focus-visible:ring-cordly';

export function Popover({
  trigger,
  children,
  className = '',
  align = 'start',
}: {
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div className="relative inline-flex" ref={root}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </button>
      {open && (
        <div
          className={`absolute top-full z-40 mt-2 min-w-48 rounded-card border border-cordly-border bg-cordly-elevated p-2 ${align === 'end' ? 'right-0' : 'left-0'} ${className}`}
          role="dialog"
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function Menu({ children, label }: { children: ReactNode; label?: string }) {
  const menuRef = useRef<HTMLDivElement>(null);

  function navigate(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>(
        '[role="menuitem"]:not([aria-disabled="true"])',
      ) ?? [],
    ).filter((item) => !item.hasAttribute('disabled'));
    if (items.length === 0) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (currentIndex + 1 + items.length) % items.length
            : (currentIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      onKeyDown={navigate}
      className="min-w-48 rounded-card border border-cordly-border bg-cordly-elevated p-1"
    >
      {children}
    </div>
  );
}

export function MenuItem({
  icon,
  children,
  danger = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      {...props}
      type={props.type ?? 'button'}
      role="menuitem"
      className={`flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm transition hover:bg-cordly-hover focus-visible:bg-cordly-hover ${
        danger ? 'text-cordly-danger' : 'text-cordly-text'
      } ${props.className ?? ''}`}
    >
      {icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>}
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  className = '',
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.querySelector<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
    )?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab' && dialog.current) {
        const focusable = Array.from(
          dialog.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]',
          ),
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      previous?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : title}
        className={`max-h-[calc(100dvh-32px)] w-full overflow-auto rounded-modal border border-cordly-border bg-cordly-surface ${className}`}
      >
        <div className="flex items-center justify-between border-b border-cordly-border px-5 py-4">
          <h2 id={labelledBy} className="text-base font-semibold text-cordly-text">{title}</h2>
          <button
            type="button"
            aria-label={`Close ${title}`}
            onClick={onClose}
            className="rounded p-1 text-cordly-secondary hover:bg-cordly-hover hover:text-cordly-text"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Tabs({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ id: string; label: string; disabled?: boolean }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex gap-1 border-b border-cordly-border" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          disabled={tab.disabled}
          onClick={() => onChange(tab.id)}
          className={`border-b-2 px-3 py-2 text-sm transition ${
            value === tab.id
              ? 'border-cordly-accent text-cordly-text'
              : 'border-transparent text-cordly-secondary hover:text-cordly-text'
          } disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function FormField({
  label,
  htmlFor,
  hint,
  error,
  children,
  className = '',
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-cordly-text">{label}</label>
      {children}
      {error ? (
        <p className="text-xs text-cordly-danger" role="alert">{error}</p>
      ) : hint ? (
        <p className="text-xs text-cordly-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-card text-left disabled:opacity-50"
    >
      <span>
        <span className="block text-sm font-medium text-cordly-text">{label}</span>
        {description && <span className="mt-1 block text-xs text-cordly-secondary">{description}</span>}
      </span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-cordly-accent' : 'bg-cordly-active'}`}>
        <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </span>
    </button>
  );
}

export function Select({
  className = '',
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block">
      <select {...props} className={`${controlClass} w-full appearance-none pr-9 ${className}`}>
        {children}
      </select>
      <ChevronDown aria-hidden="true" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-cordly-secondary" />
    </span>
  );
}

export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  formatValue = (current) => String(current),
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'min' | 'max' | 'step'> & {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  formatValue?: (value: number) => string;
}) {
  return (
    <label className="block space-y-2 text-sm text-cordly-text">
      <span className="flex justify-between gap-4">
        <span>{label}</span><span className="text-cordly-secondary">{formatValue(value)}</span>
      </span>
      <input
        {...props}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-cordly-accent"
      />
    </label>
  );
}

export function ColorInput({
  label,
  value,
  onChange,
  className = '',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const [error, setError] = useState('');
  const [pickerColor, setPickerColor] = useState('#000000');
  const eyeDropperSupported =
    typeof window !== 'undefined' &&
    'EyeDropper' in window;

  async function pickColor() {
    interface EyeDropperResult {
      sRGBHex: string;
    }
    interface EyeDropperInstance {
      open: () => Promise<EyeDropperResult>;
    }
    const eyeDropperWindow = window as Window & {
      EyeDropper?: new () => EyeDropperInstance;
    };
    if (!eyeDropperWindow.EyeDropper) return;
    try {
      const result = await new eyeDropperWindow.EyeDropper().open();
      onChange(result.sRGBHex.toUpperCase());
      setPickerColor(result.sRGBHex);
      setError('');
    } catch (pickerError) {
      if (pickerError instanceof Error && pickerError.name !== 'AbortError') {
        setError('The color picker could not be opened.');
      }
    }
  }

  return (
    <div className={`space-y-1.5 ${className}`}>
      <label className="block text-sm font-medium text-cordly-text">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} swatch`}
          value={/^#[\da-f]{6}$/i.test(value) ? value : pickerColor}
          onChange={(event) => {
            setPickerColor(event.target.value);
            onChange(event.target.value.toUpperCase());
            setError('');
          }}
          className="h-10 w-12 cursor-pointer rounded-control border border-cordly-border bg-cordly-elevated p-1"
        />
        <input
          type="text"
          aria-label={`${label} hex value`}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setError(/^#[\da-f]{6}$/i.test(event.target.value) ? '' : 'Enter a hex color such as #4F46E5.');
          }}
          className={`${controlClass} min-w-0 flex-1 font-mono uppercase`}
          placeholder="#4F46E5"
        />
        {eyeDropperSupported && (
          <button type="button" onClick={() => void pickColor()} className="rounded-control border border-cordly-border px-3 py-2 text-xs text-cordly-secondary hover:bg-cordly-hover">
            Pick
          </button>
        )}
      </div>
      {error && <p role="alert" className="text-xs text-cordly-danger">{error}</p>}
    </div>
  );
}

export function Avatar({
  src,
  name,
  size = 40,
  status,
  className = '',
}: {
  src?: string | null;
  name: string;
  size?: number;
  status?: 'online' | 'idle' | 'dnd' | 'offline';
  className?: string;
}) {
  const statusClasses = {
    online: 'bg-status-online',
    idle: 'bg-status-idle',
    dnd: 'bg-status-dnd',
    offline: 'bg-status-offline',
  } as const;
  const style = { width: size, height: size } satisfies CSSProperties;
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-visible rounded-full bg-cordly-active text-sm font-semibold text-cordly-text ${className}`}
      style={style}
    >
      {src ? (
        <Image src={src} alt="" fill sizes={`${size}px`} unoptimized className="rounded-full object-cover" />
      ) : (
        name.trim().slice(0, 2).toUpperCase()
      )}
      {status && (
        <span
          aria-label={status.replace('dnd', 'do not disturb')}
          className={`absolute -bottom-0.5 -right-0.5 rounded-full border-[3px] border-cordly-bg ${statusClasses[status]}`}
          style={{ width: Math.max(size * 0.3, 12), height: Math.max(size * 0.3, 12) }}
        />
      )}
    </span>
  );
}

export function Tooltip({
  content,
  children,
}: {
  content: string;
  children: ReactNode;
}) {
  const child = Children.only(children);
  if (!isValidElement(child)) return child;
  const childProps = child.props as HTMLAttributes<HTMLElement>;
  return cloneElement(child as ReactElement<HTMLAttributes<HTMLElement>>, {
    ...childProps,
    title: content,
    'aria-label': childProps['aria-label'] ?? content,
  });
}

export function Toast({
  message,
  variant = 'info',
  onDismiss,
}: {
  message: string;
  variant?: 'info' | 'success' | 'warning' | 'error';
  onDismiss?: () => void;
}) {
  const role = variant === 'error' || variant === 'warning' ? 'alert' : 'status';
  const color =
    variant === 'error'
      ? 'text-cordly-danger'
      : variant === 'success'
        ? 'text-cordly-success'
        : variant === 'warning'
          ? 'text-cordly-warning'
          : 'text-cordly-text';
  return (
    <div role={role} className={`flex items-center gap-3 rounded-card border border-cordly-border bg-cordly-elevated px-4 py-3 text-sm ${color}`}>
      <span className="min-w-0 flex-1">{message}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss notification" className="rounded p-1 text-cordly-secondary hover:bg-cordly-hover">
          <X aria-hidden="true" size={16} />
        </button>
      )}
    </div>
  );
}

export function VirtualList<T>({
  items,
  itemHeight,
  height,
  renderItem,
  overscan = 5,
  getKey,
  className = '',
}: {
  items: readonly T[];
  itemHeight: number;
  height: number;
  renderItem: (item: T, index: number) => ReactNode;
  overscan?: number;
  getKey: (item: T, index: number) => string;
  className?: string;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const visibleCount = Math.ceil(height / itemHeight) + overscan * 2;
  const end = Math.min(items.length, start + visibleCount);
  return (
    <div
      className={`overflow-y-auto ${className}`}
      style={{ height }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div style={{ height: items.length * itemHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${start * itemHeight}px)` }}>
          {items.slice(start, end).map((item, offset) => {
            const index = start + offset;
            return <div key={getKey(item, index)} style={{ height: itemHeight }}>{renderItem(item, index)}</div>;
          })}
        </div>
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className = '',
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex min-h-40 flex-col items-center justify-center px-6 py-10 text-center ${className}`}>
      {icon && <div className="mb-3 text-cordly-secondary">{icon}</div>}
      <h2 className="text-sm font-semibold text-cordly-text">{title}</h2>
      {description && <p className="mt-1 max-w-md text-sm text-cordly-secondary">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      aria-hidden="true"
      className={`animate-pulse rounded bg-cordly-hover ${className}`}
    />
  );
}

export function Checkmark({ checked }: { checked: boolean }) {
  return checked ? <Check aria-hidden="true" size={14} /> : null;
}

export const uiControlClass = controlClass;
