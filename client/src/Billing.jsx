import { AppearanceControl } from "./Appearance";
import React, { useEffect, useState } from 'react';
const tiers = ['starter', 'growth', 'partner'];
export function WorkspaceBilling({ api, token, project }) {
  const [options, setOptions] = useState(null), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { api('/api/billing/options').then(setOptions).catch(() => setStatus('Could not load payment options.')); }, [api]);
  async function checkout(plan) {
    setBusy(true); setStatus('Opening secure checkout…');
    try { const data = await api('/api/billing/checkout', { method: 'POST', body: JSON.stringify({ plan }) }, token); window.location.assign(data.url); }
    catch (err) { setStatus(err.error || 'Could not open checkout.'); setBusy(false); }
  }
  async function requestReview() {
    setBusy(true);
    try { await api('/api/billing/requests', { method: 'POST', body: JSON.stringify({ plan: 'starter', companyName: project.name, contactEmail: project.contactEmail || 'account@example.com', websiteUrl: project.websiteUrl, notes: 'Payment assistance requested from workspace.' }) }, token); setStatus('Support has received your request.'); }
    catch (err) { setStatus(err.error || 'Could not request help.'); }
    finally { setBusy(false); }
  }
  return <section className="workspace-billing"><h2>Your plan</h2><p className="muted">You’re on <strong>{project.plan}</strong>. Choose a plan to continue to secure Whop checkout.</p>{tiers.map(plan => <button className="small-button" type="button" key={plan} disabled={busy || !options?.plans?.[plan]} onClick={() => checkout(plan)}>Choose {plan}</button>)}
    {options && !Object.values(options.plans).some(Boolean) && <p className="muted">Online payments are being set up. Contact support for a plan upgrade.</p>}
    {new URLSearchParams(window.location.search).has('checkout') && <p role="status">We’re checking your payment. Your plan updates after payment is confirmed.</p>}
    <button className="small-button" type="button" disabled={busy} onClick={requestReview}>Get payment help</button>
    {status && <p role="status">{status}</p>}
  </section>;
}
export function OwnerConsole({ api, token, session }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [status, setStatus] = useState('');
  const [form, setForm] = useState({ id: '', plan: 'starter', status: 'owner_approved', note: '' });
  async function load() { try { setData(await api('/api/owner/billing', {}, token)); } catch (err) { setError(err.error || 'Could not load owner area.'); } }
  useEffect(() => { if (session.user?.isOwner) void load(); }, [token, session.user?.isOwner]);
  if (!session.user?.isOwner) return <main className="owner-console"><h1>Private owner area</h1><p>Your account does not have access.</p><a href="/admin">Return to your inbox</a></main>;
  async function apply(event) {
    event.preventDefault(); setStatus('Saving…');
    try { await api(`/api/owner/workspaces/${form.id}/billing`, { method: 'PATCH', body: JSON.stringify(form) }, token); setStatus('Manual update saved with an audit record.'); await load(); }
    catch (err) { setStatus(err.error || 'Could not update workspace.'); }
  }
  return <main className="owner-console"><header><div><span className="eyebrow">Private operations</span><h1>Owner workspace</h1><p>Payments, customer access, and recovery tools.</p></div><div className="owner-header-actions"><AppearanceControl /><a href="/admin">Back to inbox →</a></div></header>
    {error && <p role="alert">{error}</p>}{data && <>
      <section className="owner-summary"><strong>Whop {data.whop.environment}</strong><span>{data.whop.configured ? 'Configuration present' : 'Credentials and plan configuration required'}</span><button type="button" onClick={load}>Refresh</button></section>
      <section><h2>Manual access adjustment</h2><p>Verify the payment in Whop before granting access. Record a reference or reason.</p><form onSubmit={apply}>
        <label>Workspace<select required value={form.id} onChange={event => setForm({ ...form, id: event.target.value })}><option value="">Select workspace</option>{data.workspaces.map(item => <option key={item.id} value={item.id}>{item.name} · {item.plan}</option>)}</select></label>
        <label>Plan<select value={form.plan} onChange={event => setForm({ ...form, plan: event.target.value })}>{['free', ...tiers].map(plan => <option key={plan}>{plan}</option>)}</select></label>
        <label>Access<select value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}><option value="owner_approved">Active</option><option value="paused">Paused</option></select></label>
        <label>Payment reference or reason<input required maxLength={500} value={form.note} onChange={event => setForm({ ...form, note: event.target.value })} /></label><button type="submit">Save manual update</button></form>{status && <p role="status">{status}</p>}</section>
      <section><h2>Payment events</h2>{data.events.length === 0 && <p>No payment events received yet.</p>}{data.events.map(item => <article className="owner-event" key={item.id}><strong>{item.type}</strong><span>{item.status} · {item.attempts} attempts</span>{item.error && <p>{item.error}</p>}{item.status !== 'complete' && <button type="button" onClick={async () => { try { await api(`/api/owner/billing/events/${item.id}/retry`, { method: 'POST', body: '{}' }, token); await load(); } catch (err) { setStatus(err.error || 'Retry failed.'); } }}>Retry processing</button>}</article>)}</section>
      <section><h2>Recent manual changes</h2>{data.audit.map(item => <p key={item.id}>{item.created_at} · {item.actor} · {item.action}</p>)}</section>
    </>}
  </main>;
}
