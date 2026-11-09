'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

export interface Option {
  value: string;
  label: string;
  hint?: string;
  group?: string;
  badge?: string;
}

/** Searchable, touch-friendly dropdown: type a few letters ("Rob") instead of scrolling. */
export function Combobox({ value, options, onChange, placeholder = 'Select…', size = 'lg', invalid, allowCustom, customLabel = 'Use', id, autoFocus, emptyText = 'No match' }: {
  value: string;
  options: Option[];
  onChange: (v: string, opt?: Option) => void;
  placeholder?: string;
  size?: 'md' | 'lg';
  invalid?: string | null;
  allowCustom?: boolean;
  customLabel?: string;
  id?: string;
  autoFocus?: boolean;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return options.slice(0, 300);
    const words = s.split(/\s+/);
    return options
      .filter((o) => words.every((w) => `${o.label} ${o.hint ?? ''} ${o.value}`.toLowerCase().includes(w)))
      .sort((a, b) => Number(!a.label.toLowerCase().startsWith(s)) - Number(!b.label.toLowerCase().startsWith(s)))
      .slice(0, 300);
  }, [q, options]);
  useEffect(() => {
    const h = (e: MouseEvent | TouchEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    document.addEventListener('touchstart', h);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('touchstart', h);
    };
  }, []);
  useEffect(() => setHi(0), [q]);
  const pick = (o: Option | string) => {
    if (typeof o === 'string') onChange(o);
    else onChange(o.value, o);
    setOpen(false);
    setQ('');
  };
  const custom = allowCustom && q.trim() && !options.some((o) => o.value.toLowerCase() === q.trim().toLowerCase());
  const h = size === 'lg' ? 'h-14 text-lg' : 'h-10 text-sm';
  let lastGroup: string | undefined;
  return (
    <div ref={box} className="relative">
      <div className={`flex items-center rounded-xl border bg-white ${invalid ? 'border-bad ring-4 ring-bad-bg' : open ? 'border-navy-600 ring-4 ring-navy-100' : 'border-line'}`}>
        <Search size={18} className="ml-3.5 text-muted shrink-0" />
        <input
          ref={input}
          id={id}
          autoFocus={autoFocus}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className={`${h} w-full min-w-0 bg-transparent px-2.5 font-semibold outline-none placeholder:font-normal placeholder:text-[#a9a6b5]`}
          placeholder={selected ? selected.label : value || placeholder}
          value={open ? q : selected?.label ?? value}
          onFocus={() => {
            setOpen(true);
            setQ('');
          }}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi((x) => Math.min(x + 1, filtered.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((x) => Math.max(x - 1, 0)); }
            else if (e.key === 'Enter') {
              e.preventDefault();
              if (filtered[hi]) pick(filtered[hi]);
              else if (custom) pick(q.trim().toUpperCase());
            } else if (e.key === 'Escape') setOpen(false);
          }}
        />
        {value && !open ? (
          <button type="button" className="w-11 h-11 grid place-items-center text-muted" onClick={() => { onChange(''); input.current?.focus(); }} aria-label="Clear"><X size={18} /></button>
        ) : (
          <ChevronDown size={18} className="mr-3.5 text-muted shrink-0" />
        )}
      </div>
      {invalid && <p className="text-bad text-xs font-semibold mt-1">{invalid}</p>}
      {open && (
        <ul id={listId} role="listbox" className="absolute z-50 mt-2 w-full max-h-[min(380px,55vh)] overflow-y-auto rounded-2xl border border-line bg-white shadow-xl p-1.5">
          {filtered.map((o, i) => {
            const header = o.group && o.group !== lastGroup ? o.group : null;
            lastGroup = o.group;
            return (
              <li key={o.group + o.value} role="presentation">
                {header && <div className="px-3 pt-2.5 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted">{header}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => pick(o)}
                  className={`w-full text-left rounded-xl px-3 ${size === 'lg' ? 'py-3' : 'py-2'} flex items-center gap-3 ${i === hi ? 'bg-navy-50' : ''} ${o.value === value ? 'font-bold' : ''}`}
                >
                  <span className="flex-1 min-w-0">
                    <span className="block truncate font-semibold">{o.label}</span>
                    {o.hint && <span className="block truncate text-xs text-muted">{o.hint}</span>}
                  </span>
                  {o.badge && <span className="chip bg-canvas text-muted">{o.badge}</span>}
                </button>
              </li>
            );
          })}
          {custom && (
            <li>
              <button type="button" onClick={() => pick(q.trim().toUpperCase())} className="w-full text-left rounded-xl px-3 py-3 bg-brand-50 text-brand-600 font-semibold">
                {customLabel} “{q.trim().toUpperCase()}”
              </button>
            </li>
          )}
          {!filtered.length && !custom && <li className="px-3 py-4 text-sm text-muted">{emptyText}</li>}
        </ul>
      )}
    </div>
  );
}
