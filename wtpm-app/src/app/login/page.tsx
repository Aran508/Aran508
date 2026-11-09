'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, LogIn } from 'lucide-react';
import { fetchJson } from '@/lib/client';

function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetchJson<{ role: string }>('/api/auth/login', { method: 'POST', json: { username: u, password: p } });
      const next = sp.get('next');
      router.replace(next && next.startsWith('/') ? next : r.role === 'operator' ? '/entry' : '/');
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="card p-6 sm:p-8 w-full max-w-[420px]">
      <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
      <p className="text-sm text-muted mt-1 mb-6">Same login on the floor tablet and the office PC.</p>
      <label className="label" htmlFor="u">Username</label>
      <input id="u" className="input input-lg mb-4" autoComplete="username" autoCapitalize="none" value={u} onChange={(e) => setU(e.target.value)} autoFocus required />
      <label className="label" htmlFor="p">Password</label>
      <input id="p" type="password" className="input input-lg" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} required />
      {err && <div className="mt-4 rounded-xl bg-bad-bg text-bad text-sm font-semibold px-4 py-3">{err}</div>}
      <button className="btn btn-lg btn-primary w-full mt-6" disabled={busy}>{busy ? <Loader2 className="animate-spin" size={18} /> : <LogIn size={18} />} Sign in</button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-dvh grid lg:grid-cols-[1.05fr_1fr]">
      <div className="hidden lg:flex flex-col justify-between bg-navy-800 text-white p-12 relative overflow-hidden">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-white grid place-items-center"><svg viewBox="0 0 64 64" className="w-7 h-7"><path d="M12 42 L23 22 L32 35 L41 17 L52 42" fill="none" stroke="#ef5f18" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
          <div className="font-bold text-xl">WTPM OEE</div>
        </div>
        <div className="relative z-10">
          <div className="text-[44px] font-bold leading-[1.05] tracking-tight">From the WTPM note<br />to the dashboard<br /><span className="text-brand-400">in one tap.</span></div>
          <p className="mt-5 text-white/70 max-w-md">Enter production, losses and photos on the floor tablet. OEE, daily, weekly and monthly reports update for everyone instantly.</p>
        </div>
        <div className="grid grid-cols-4 gap-3 relative z-10">
          {['Availability', 'Performance', 'Quality', 'OEE'].map((k, i) => (
            <div key={k} className={`rounded-2xl p-3 ${i === 3 ? 'bg-brand-500' : 'bg-white/10'}`}>
              <div className="text-xs text-white/70">{k}</div>
              <div className="mt-6 h-1.5 rounded-full bg-white/20"><div className="h-full rounded-full bg-white" style={{ width: `${[78, 91, 99, 70][i]}%` }} /></div>
            </div>
          ))}
        </div>
        <div className="absolute -right-24 -bottom-24 w-[420px] h-[420px] rounded-full bg-brand-500/20 blur-3xl" />
      </div>
      <div className="flex items-center justify-center p-4 sm:p-8">
        <Suspense><LoginForm /></Suspense>
      </div>
    </div>
  );
}
