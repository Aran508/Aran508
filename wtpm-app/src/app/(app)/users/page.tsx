'use client';
import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { useApi, fetchJson, useToast, useMeta } from '@/lib/client';
import { Card, Loading, PageHeader, Modal, Badge, Notice } from '@/components/ui';
import { ROLE_LABEL, PERMISSION_MATRIX, type Role } from '@/lib/roles';
import { fmtDateTime } from '@/lib/format';

interface U { id: number; username: string; full_name: string; role: Role; active: boolean; last_login_at: string | null; entries: number }

export default function Users() {
  const toast = useToast();
  const { meta } = useMeta();
  const { data, loading, reload } = useApi<U[]>('/api/users');
  const [edit, setEdit] = useState<(Partial<U> & { password?: string }) | null>(null);
  const save = async () => {
    if (!edit) return;
    try {
      if (edit.id) await fetchJson(`/api/users/${edit.id}`, { method: 'PUT', json: { full_name: edit.full_name, role: edit.role, active: edit.active, password: edit.password || undefined } });
      else await fetchJson('/api/users', { method: 'POST', json: edit });
      toast('good', 'User saved'); setEdit(null); reload();
    } catch (e) { toast('bad', (e as Error).message); }
  };
  const perms = ['entry.create', 'entry.edit_own', 'entry.edit_any', 'entry.verify', 'entry.delete', 'entry.override_times', 'reports.view', 'records.view_all', 'master.edit', 'users.manage', 'audit.view', 'import.run'];
  return (
    <div>
      <PageHeader title="User Management" sub="One login per person — the same account works on the tablet and the PC"><button className="btn btn-md btn-primary" onClick={() => setEdit({ role: 'operator', active: true })}><Plus size={16} /> Add user</button></PageHeader>
      <Card pad={false}>
        {loading && !data ? <Loading /> : (
          <div className="overflow-x-auto"><table className="table-x"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th className="num">Records entered</th><th>Last login</th><th>Status</th><th /></tr></thead>
            <tbody>{data?.map((u) => <tr key={u.id}><td className="font-semibold">{u.full_name}</td><td className="font-mono">{u.username}</td><td><Badge tone={u.role === 'admin' ? 'brand' : u.role === 'operator' ? 'plain' : 'navy'}>{ROLE_LABEL[u.role]}</Badge></td><td className="num">{u.entries}</td><td>{fmtDateTime(u.last_login_at)}</td><td>{u.active ? <Badge tone="good">Active</Badge> : <Badge tone="bad">Disabled</Badge>}</td><td><button className="w-9 h-9 rounded-full hover:bg-canvas grid place-items-center" onClick={() => setEdit({ ...u })} aria-label="Edit"><Pencil size={15} /></button></td></tr>)}</tbody></table></div>
        )}
      </Card>
      <Card className="mt-4" title="Role permissions" pad={false}>
        <div className="overflow-x-auto"><table className="table-x"><thead><tr><th>Permission</th>{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <th key={r} className="!text-center">{ROLE_LABEL[r]}</th>)}</tr></thead>
          <tbody>{perms.map((p) => <tr key={p}><td className="font-mono text-xs">{p}</td>{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <td key={r} className="text-center">{PERMISSION_MATRIX[r].includes(p as never) ? '✓' : ''}</td>)}</tr>)}</tbody></table></div>
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${edit.full_name}` : 'Add user'} footer={<><button className="btn btn-lg btn-ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-lg btn-primary" onClick={save}>Save</button></>}>
        {edit && <div className="space-y-3">
          <div><label className="label">Full name</label><input className="input input-md" value={edit.full_name ?? ''} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} /></div>
          {!edit.id && <div><label className="label">Username</label><input className="input input-md" autoCapitalize="none" value={edit.username ?? ''} onChange={(e) => setEdit({ ...edit, username: e.target.value })} /></div>}
          <div><label className="label">Role</label><select className="input input-md" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as Role })}>{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div>
          <div><label className="label">{edit.id ? 'New password (leave empty to keep)' : 'Password'}</label><input type="password" className="input input-md" value={edit.password ?? ''} onChange={(e) => setEdit({ ...edit, password: e.target.value })} placeholder="at least 8 characters with letters and numbers" /></div>
          {edit.id && edit.id !== meta?.user.uid && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.active ?? true} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active (unticking logs the user out everywhere)</label>}
          <Notice tone="info">Changing role, password or status signs the user out of all devices.</Notice>
        </div>}
      </Modal>
    </div>
  );
}
