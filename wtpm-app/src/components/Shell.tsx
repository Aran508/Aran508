'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard, ClipboardPen, Table2, Factory, CalendarDays, CalendarRange, CalendarCheck2, TrendingDown, Database,
  Users, History, LifeBuoy, LogOut, Menu, Radio, KeyRound, Plus,
} from 'lucide-react';
import { LiveProvider, MetaProvider, ToastProvider, useLive, useMeta, fetchJson } from '@/lib/client';
import { ROLE_LABEL } from '@/lib/roles';

const NAV: { href: string; label: string; icon: React.ElementType; perm?: string; group: string }[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, group: 'Overview' },
  { href: '/entry', label: 'WTPM Quick Entry', icon: ClipboardPen, perm: 'entry.create', group: 'Data collection' },
  { href: '/records', label: 'Production Records', icon: Table2, group: 'Data collection' },
  { href: '/machines', label: 'Machine Performance', icon: Factory, perm: 'reports.view', group: 'Reports' },
  { href: '/reports/daily', label: 'Daily Reports', icon: CalendarDays, perm: 'reports.view', group: 'Reports' },
  { href: '/reports/weekly', label: 'Weekly Reports', icon: CalendarRange, perm: 'reports.view', group: 'Reports' },
  { href: '/reports/monthly', label: 'Monthly Reports', icon: CalendarCheck2, perm: 'reports.view', group: 'Reports' },
  { href: '/losses', label: 'Loss Analysis', icon: TrendingDown, perm: 'reports.view', group: 'Reports' },
  { href: '/master', label: 'Master Data', icon: Database, group: 'Administration' },
  { href: '/users', label: 'User Management', icon: Users, perm: 'users.manage', group: 'Administration' },
  { href: '/audit', label: 'Audit History', icon: History, perm: 'audit.view', group: 'Administration' },
  { href: '/help', label: 'Help / User Guide', icon: LifeBuoy, group: 'Administration' },
];

function LiveDot() {
  const { status } = useLive();
  const map = { live: ['bg-good', 'Live'], connecting: ['bg-alert', 'Connecting'], offline: ['bg-bad', 'Reconnecting'] } as const;
  const [c, t] = map[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted" title="Screens update automatically when anyone saves data">
      <span className={`relative w-2 h-2 rounded-full ${c}`}>{status === 'live' && <span className={`absolute inset-0 rounded-full ${c} animate-ping opacity-60`} />}</span>
      <Radio size={13} /> {t}
    </span>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  const { meta } = useMeta();
  const router = useRouter();
  const items = NAV.filter((n) => !n.perm || meta?.permissions.includes(n.perm));
  let last = '';
  const logout = async () => {
    await fetchJson('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
  };
  return (
    <div className="h-full flex flex-col bg-navy-800 text-white">
      <div className="px-5 pt-5 pb-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-white grid place-items-center">
          <svg viewBox="0 0 64 64" className="w-6 h-6"><path d="M12 42 L23 22 L32 35 L41 17 L52 42" fill="none" stroke="#ef5f18" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <div className="leading-tight">
          <div className="font-bold text-[17px] tracking-tight">WTPM OEE</div>
          <div className="text-[11.5px] text-white/60">{String(meta?.settings.plant_name ?? 'C1 Plant')}</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-3">
        {items.map((n) => {
          const header = n.group !== last ? n.group : null;
          last = n.group;
          const active = n.href === '/' ? path === '/' : path.startsWith(n.href);
          const Icon = n.icon;
          return (
            <div key={n.href}>
              {header && <div className="px-3 pt-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40">{header}</div>}
              <Link
                href={n.href}
                onClick={onNavigate}
                className={`flex items-center gap-3 rounded-full px-3.5 h-11 text-[14px] font-medium transition ${active ? 'bg-white text-navy-800 font-semibold' : 'text-white/80 hover:bg-white/10'}`}
              >
                <Icon size={18} className={active ? 'text-brand-500' : ''} />
                <span className="truncate">{n.label}</span>
              </Link>
            </div>
          );
        })}
      </nav>
      {meta?.permissions.includes('entry.create') && (
        <div className="mx-3 mb-3 rounded-2xl bg-brand-500 p-3.5">
          <div className="text-[13px] font-semibold">On the production floor?</div>
          <div className="text-xs text-white/85 mt-0.5">Open Quick Entry on the tablet and save each WTPM note directly.</div>
          <Link href="/entry" onClick={onNavigate} className="mt-2.5 flex items-center justify-center gap-1.5 h-10 rounded-full bg-white text-ink text-sm font-semibold">
            <Plus size={16} /> New WTPM entry
          </Link>
        </div>
      )}
      <div className="mx-3 mb-4 rounded-2xl bg-white/8 border border-white/10 p-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-white/15 grid place-items-center text-sm font-bold">{meta?.user.name.split(' ').map((s) => s[0]).slice(0, 2).join('')}</div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-sm font-semibold truncate">{meta?.user.name}</div>
          <div className="text-[11.5px] text-white/60 truncate">{meta && ROLE_LABEL[meta.user.role]}</div>
        </div>
        <Link href="/account" onClick={onNavigate} className="w-9 h-9 grid place-items-center rounded-full hover:bg-white/10" title="Change password"><KeyRound size={16} /></Link>
        <button onClick={logout} className="w-9 h-9 grid place-items-center rounded-full hover:bg-white/10" title="Log out" aria-label="Log out"><LogOut size={16} /></button>
      </div>
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  const current = NAV.find((n) => (n.href === '/' ? path === '/' : path.startsWith(n.href)));
  return (
    <div className="min-h-dvh lg:pl-[264px]">
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-[264px] z-30">
        <Sidebar />
      </aside>
      {open && (
        <div className="lg:hidden fixed inset-0 z-[80] flex">
          <div className="w-[284px] max-w-[85vw] h-full shadow-2xl"><Sidebar onNavigate={() => setOpen(false)} /></div>
          <button className="flex-1 bg-navy-950/40" aria-label="Close menu" onClick={() => setOpen(false)} />
        </div>
      )}
      <header className="lg:hidden sticky top-0 z-40 bg-navy-800 text-white h-14 px-2 flex items-center gap-2 no-print">
        <button className="w-11 h-11 grid place-items-center rounded-full active:bg-white/10" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={22} /></button>
        <div className="font-bold truncate flex-1">{current?.label ?? 'WTPM OEE'}</div>
        <div className="[&_*]:!text-white/80 pr-2"><LiveDot /></div>
      </header>
      <div className="hidden lg:flex justify-end px-8 pt-4 no-print"><LiveDot /></div>
      <main className="px-3 sm:px-5 lg:px-8 py-4 lg:pt-1 lg:pb-10 max-w-[1680px]">{children}</main>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <LiveProvider>
        <MetaProvider>
          <Frame>{children}</Frame>
        </MetaProvider>
      </LiveProvider>
    </ToastProvider>
  );
}
