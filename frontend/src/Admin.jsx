import React, { useEffect, useState, useCallback } from 'react';
import { api, assetUrl, getToken, getUser, setSession, clearSession } from './api.js';

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : '');

function useToast() {
  const [toast, setToast] = useState(null);
  const notify = useCallback((type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  }, []);
  const node = toast ? <div className={'toast toast--' + toast.type}>{toast.msg}</div> : null;
  return [notify, node];
}

// ---------- Login gate ----------
function Login({ onAuthed, notify }) {
  const [form, setForm] = useState({ email: '', password: '' });
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { token, user } = await api.login(form);
      setSession(token, user);
      onAuthed();
    } catch (err) { notify('error', err.message); }
    finally { setBusy(false); }
  }
  return (
    <div className="admin-login">
      <div className="modal">
        <h2 className="neon-title">Ball Radar · Admin</h2>
        <form className="form" onSubmit={submit}>
          <label>Email<input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required /></label>
          <label>Password<input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} required /></label>
          <button className="btn btn--primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>Admin accounts only. Sign in with an account whose email is in ADMIN_EMAILS.</p>
      </div>
    </div>
  );
}

// ---------- Dashboard ----------
function Dashboard({ data }) {
  const c = data.counts;
  const max = Math.max(1, ...data.signups.map((s) => s.count));
  const metrics = [
    ['Users', c.users], ['Admins', c.admins], ['Banned', c.banned],
    ['Courts', c.courts], ['Reviews', c.reviews], ['Photos', c.photos],
    ['Open reports', c.openReports],
  ];
  return (
    <div>
      <div className="metric-grid">
        {metrics.map(([label, val]) => (
          <div className="metric" key={label}><b>{val}</b><span>{label}</span></div>
        ))}
      </div>
      <div className="admin-card">
        <h3>Signups (last 14 days)</h3>
        <div className="spark">
          {data.signups.map((s) => (
            <div key={s.day} className="spark__bar" title={`${s.day}: ${s.count}`}>
              <div style={{ height: `${(s.count / max) * 100}%` }} />
              <span>{s.day.slice(-2)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="admin-2col">
        <div className="admin-card">
          <h3>Newest users</h3>
          <ul className="mini-list">
            {data.recentUsers.map((u) => (
              <li key={u.id}>{u.username} <span className="muted">· {u.email}</span> {u.role === 'admin' && <span className="badge-admin">admin</span>}{u.banned && <span className="badge-banned">banned</span>}</li>
            ))}
          </ul>
        </div>
        <div className="admin-card">
          <h3>Newest courts</h3>
          <ul className="mini-list">
            {data.recentCourts.map((c2) => (
              <li key={c2.id}>{c2.indoor ? '🏠' : '🏀'} {c2.name} <span className="muted">· {c2.creator || '—'}</span></li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ---------- generic data tab ----------
function useFetch(fn, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    setLoading(true);
    fn().then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, deps); // eslint-disable-line
  useEffect(() => { reload(); }, [reload]);
  return [data, loading, reload];
}

function Reports({ notify }) {
  const [data, loading, reload] = useFetch(() => api.adminReports('all'));
  async function act(p) { try { await p; reload(); } catch (e) { notify('error', e.message); } }
  if (loading) return <p className="muted">Loading…</p>;
  const rows = data?.reports || [];
  return (
    <table className="admin-table">
      <thead><tr><th>Court</th><th>Type</th><th>Note</th><th>By</th><th>Status</th><th></th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className={r.resolved ? 'is-done' : ''}>
            <td>{r.court_name}</td><td>{r.type}</td><td>{r.note}</td><td>{r.username}</td>
            <td>{r.resolved ? '✅ resolved' : '⚠ open'}</td>
            <td className="row-actions">
              {!r.resolved && <button className="btn btn--ghost btn--sm" onClick={() => act(api.adminResolveReport(r.id))}>Resolve</button>}
              <button className="btn btn--danger btn--sm" onClick={() => act(api.adminDeleteReport(r.id))}>Delete</button>
            </td>
          </tr>
        ))}
        {!rows.length && <tr><td colSpan="6" className="muted">No reports.</td></tr>}
      </tbody>
    </table>
  );
}

function Courts({ notify }) {
  const [q, setQ] = useState('');
  const [data, loading, reload] = useFetch(() => api.adminCourts(q), [q]);
  async function del(id, name) { if (!window.confirm(`Delete court "${name}"?`)) return; try { await api.adminDeleteCourt(id); reload(); } catch (e) { notify('error', e.message); } }
  return (
    <>
      <input className="admin-search" placeholder="Search courts…" value={q} onChange={(e) => setQ(e.target.value)} />
      {loading ? <p className="muted">Loading…</p> : (
        <table className="admin-table">
          <thead><tr><th>Name</th><th>Address</th><th>Type</th><th>★</th><th>Rev</th><th>Pho</th><th>Creator</th><th></th></tr></thead>
          <tbody>
            {(data?.courts || []).map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td><td className="muted">{c.address}</td><td>{c.indoor ? 'Indoor' : 'Outdoor'}</td>
                <td>{c.rating ?? '—'}</td><td>{c.reviews}</td><td>{c.photos}</td><td>{c.creator || '—'}</td>
                <td className="row-actions"><button className="btn btn--danger btn--sm" onClick={() => del(c.id, c.name)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function Reviews({ notify }) {
  const [q, setQ] = useState('');
  const [data, loading, reload] = useFetch(() => api.adminReviews(q), [q]);
  async function del(id) { if (!window.confirm('Delete this review?')) return; try { await api.adminDeleteReview(id); reload(); } catch (e) { notify('error', e.message); } }
  return (
    <>
      <input className="admin-search" placeholder="Search reviews…" value={q} onChange={(e) => setQ(e.target.value)} />
      {loading ? <p className="muted">Loading…</p> : (
        <table className="admin-table">
          <thead><tr><th>Court</th><th>★</th><th>Comment</th><th>By</th><th></th></tr></thead>
          <tbody>
            {(data?.reviews || []).map((r) => (
              <tr key={r.id}>
                <td>{r.court_name}</td><td>{r.rating}</td><td>{r.comment}</td><td>{r.username}</td>
                <td className="row-actions"><button className="btn btn--danger btn--sm" onClick={() => del(r.id)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function Photos({ notify }) {
  const [data, loading, reload] = useFetch(() => api.adminPhotos());
  async function del(id) { if (!window.confirm('Delete this photo?')) return; try { await api.adminDeletePhoto(id); reload(); } catch (e) { notify('error', e.message); } }
  if (loading) return <p className="muted">Loading…</p>;
  return (
    <div className="admin-photos">
      {(data?.photos || []).map((p) => (
        <div key={p.id} className="admin-photo">
          <img src={assetUrl(p.url)} alt="" loading="lazy" />
          <div className="admin-photo__meta">{p.court_name}<span className="muted"> · {p.username}</span></div>
          <button className="photo__del" onClick={() => del(p.id)}>✕</button>
        </div>
      ))}
      {!data?.photos?.length && <p className="muted">No photos.</p>}
    </div>
  );
}

function Users({ notify, meId }) {
  const [q, setQ] = useState('');
  const [data, loading, reload] = useFetch(() => api.adminUsers(q), [q]);
  const run = async (p) => { try { await p; reload(); } catch (e) { notify('error', e.message); } };
  return (
    <>
      <input className="admin-search" placeholder="Search users…" value={q} onChange={(e) => setQ(e.target.value)} />
      {loading ? <p className="muted">Loading…</p> : (
        <table className="admin-table">
          <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Courts</th><th>Rev</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {(data?.users || []).map((u) => (
              <tr key={u.id}>
                <td>{u.username}{u.id === meId && ' (you)'}</td>
                <td className="muted">{u.email}</td>
                <td>{u.role === 'admin' ? <span className="badge-admin">admin</span> : 'user'}</td>
                <td>{u.courts}</td><td>{u.reviews}</td>
                <td>{u.banned ? <span className="badge-banned">banned</span> : u.verified ? 'active' : 'unverified'}</td>
                <td className="row-actions">
                  {u.role === 'admin'
                    ? <button className="btn btn--ghost btn--sm" disabled={u.id === meId} onClick={() => run(api.adminSetRole(u.id, 'user'))}>Demote</button>
                    : <button className="btn btn--ghost btn--sm" onClick={() => run(api.adminSetRole(u.id, 'admin'))}>Make admin</button>}
                  {u.role !== 'admin' && (u.banned
                    ? <button className="btn btn--ghost btn--sm" onClick={() => run(api.adminBan(u.id, false))}>Unban</button>
                    : <button className="btn btn--danger btn--sm" onClick={() => run(api.adminBan(u.id, true))}>Ban</button>)}
                  {u.role !== 'admin' && u.id !== meId &&
                    <button className="btn btn--danger btn--sm" onClick={() => window.confirm(`Delete ${u.username}?`) && run(api.adminDeleteUser(u.id))}>Delete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function Audit() {
  const [data, loading] = useFetch(() => api.adminAudit());
  if (loading) return <p className="muted">Loading…</p>;
  return (
    <table className="admin-table">
      <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
      <tbody>
        {(data?.logs || []).map((l) => (
          <tr key={l.id}>
            <td className="muted">{new Date(l.created_at).toLocaleString()}</td>
            <td>{l.admin_name || '—'}</td><td>{l.action}</td>
            <td>{l.target_type} #{l.target_id}</td><td className="muted">{l.detail}</td>
          </tr>
        ))}
        {!data?.logs?.length && <tr><td colSpan="5" className="muted">No actions yet.</td></tr>}
      </tbody>
    </table>
  );
}

const TABS = ['Dashboard', 'Reports', 'Courts', 'Reviews', 'Photos', 'Users', 'Audit'];

// ---------- Admin shell ----------
export default function Admin() {
  const [notify, toastNode] = useToast();
  const [state, setState] = useState('loading'); // loading | login | denied | ok
  const [overview, setOverview] = useState(null);
  const [tab, setTab] = useState('Dashboard');
  const me = getUser();

  const verify = useCallback(() => {
    if (!getToken()) { setState('login'); return; }
    setState('loading');
    api.adminOverview()
      .then((ov) => { setOverview(ov); setState('ok'); })
      .catch((err) => {
        if (err.status === 401) setState('login');
        else setState('denied');
      });
  }, []);

  useEffect(() => { verify(); }, [verify]);

  useEffect(() => {
    // apply day theme for the admin panel by default
    document.documentElement.setAttribute('data-theme', localStorage.getItem('ballradar_theme') || 'day');
  }, []);

  if (state === 'loading') return <div className="admin-login"><p className="muted">Loading…</p></div>;
  if (state === 'login') return <><Login onAuthed={verify} notify={notify} />{toastNode}</>;
  if (state === 'denied') return (
    <div className="admin-login">
      <div className="modal">
        <h2 className="neon-title">Access denied</h2>
        <p className="muted">This account is not an admin.</p>
        <button className="btn btn--ghost" onClick={() => { clearSession(); setState('login'); }}>Sign in with another account</button>
      </div>
    </div>
  );

  return (
    <div className="admin">
      <header className="admin__top">
        <div className="brand"><span className="brand__mark">◎</span><div><h1>Ball Radar Admin</h1></div></div>
        <div className="spacer" />
        <span className="muted">{me?.username}</span>
        <a className="btn btn--ghost btn--sm" href="/">← Site</a>
        <button className="btn btn--ghost btn--sm" onClick={() => { clearSession(); setState('login'); }}>Log out</button>
      </header>
      <nav className="admin__tabs">
        {TABS.map((t) => (
          <button key={t} className={'admin__tab ' + (tab === t ? 'on' : '')} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>
      <main className="admin__body">
        {tab === 'Dashboard' && overview && <Dashboard data={overview} />}
        {tab === 'Reports' && <Reports notify={notify} />}
        {tab === 'Courts' && <Courts notify={notify} />}
        {tab === 'Reviews' && <Reviews notify={notify} />}
        {tab === 'Photos' && <Photos notify={notify} />}
        {tab === 'Users' && <Users notify={notify} meId={me?.id} />}
        {tab === 'Audit' && <Audit />}
      </main>
      {toastNode}
    </div>
  );
}
