'use client';
import { useState } from 'react';
import { fetchJson, useToast, useMeta } from '@/lib/client';
import { Card, PageHeader } from '@/components/ui';
import { ROLE_LABEL } from '@/lib/roles';
export default function Account() {
  const { meta } = useMeta();
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [rep, setRep] = useState('');
  return (
    <div className="max-w-lg">
      <PageHeader title="My account" sub={meta ? `${meta.user.name} · ${meta.user.username} · ${ROLE_LABEL[meta.user.role]}` : ''} />
      <Card title="Change password">
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); if (next !== rep) return toast('bad', 'New passwords do not match'); try { await fetchJson('/api/auth/password', { method: 'POST', json: { current: cur, next } }); toast('good', 'Password changed'); setCur(''); setNext(''); setRep(''); } catch (err) { toast('bad', (err as Error).message); } }}>
          <div><label className="label">Current password</label><input type="password" className="input input-lg" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></div>
          <div><label className="label">New password</label><input type="password" className="input input-lg" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></div>
          <div><label className="label">Repeat new password</label><input type="password" className="input input-lg" value={rep} onChange={(e) => setRep(e.target.value)} autoComplete="new-password" /></div>
          <button className="btn btn-lg btn-primary w-full">Change password</button>
        </form>
      </Card>
    </div>
  );
}
