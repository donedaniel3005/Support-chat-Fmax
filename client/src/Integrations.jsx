import React, { useEffect, useState } from 'react';

export default function Integrations({ api, token }) {
  const [config, setConfig] = useState(null);
  const [key, setKey] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/api/projects/current/ai', {}, token).then(setConfig).catch(e => setStatus(e.error || 'Could not load integrations.')); }, [token]);
  async function save(event) {
    event.preventDefault(); setBusy(true); setStatus('');
    try {
      setConfig(await api('/api/projects/current/ai', { method: 'PUT', body: JSON.stringify({ provider: config.provider, model: config.model, enabled: config.enabled, ...(key ? { apiKey: key } : {}) }) }, token));
      setKey(''); setStatus('Saved. Drafts use your team’s provider account.');
    } catch (e) { setStatus(e.error || 'Could not save.'); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    setBusy(true);
    try { setConfig(await api('/api/projects/current/ai', { method: 'DELETE' }, token)); setKey(''); setStatus('Disconnected and stored key removed.'); }
    catch (e) { setStatus(e.error || 'Could not disconnect.'); }
    finally { setBusy(false); }
  }
  return <section data-settings="integrations" className="team-integrations">
    <h2>Your AI, your choice.</h2>
    <p>Optional AI drafts use your team’s own account. Available on Growth and Partner plans. Your provider bills your team for usage.</p>
    <p>When an agent requests a draft, the latest 12 message texts are sent to your selected provider. Agents review drafts before sending. Keys are encrypted on the server and never returned to the browser.</p>
    {config && <form onSubmit={save}>
      {!config.storageReady && <p role="status">The server operator needs to enable secure integration storage before keys can be saved.</p>}
      <label>Provider<select value={config.provider} onChange={e => { setConfig({ ...config, provider: e.target.value, model: '', configured: false, enabled: false }); setKey(''); }}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="gemini">Google Gemini</option></select></label>
      <label>Model ID<input required value={config.model} maxLength={120} placeholder="Enter a model ID available in your provider account" onChange={e => setConfig({ ...config, model: e.target.value })} /></label>
      <label>API key {config.configured && '(saved — leave blank to keep)'}<input type="password" autoComplete="new-password" value={key} onChange={e => setKey(e.target.value)} placeholder="Your team’s API key" /></label>
      <label className="toggle-row"><input type="checkbox" checked={config.enabled} onChange={e => setConfig({ ...config, enabled: e.target.checked })} />Enable AI drafts for this workspace</label>
      <button disabled={busy || !config.storageReady}>{busy ? 'Saving…' : 'Save AI settings'}</button>
      {config.configured && <button type="button" className="secondary-action" disabled={busy} onClick={disconnect}>Disconnect provider</button>}
    </form>}
    {status && <p role="status">{status}</p>}
    <Webhooks api={api} token={token} />
  </section>;
}

function Webhooks({ api, token }) {
  const [data, setData] = useState({ webhooks: [], deliveries: [] });
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState(['conversation.created', 'message.created']);
  const [secret, setSecret] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api('/api/projects/current/webhooks', {}, token).then(setData).catch(e => setStatus(e.error || 'Could not load webhooks.'));
  useEffect(() => { load(); }, [token]);
  async function add(e) {
    e.preventDefault(); setBusy(true); setStatus('');
    try { const result = await api('/api/projects/current/webhooks', { method: 'POST', body: JSON.stringify({ url, events }) }, token); setSecret(result.secret); setUrl(''); await load(); }
    catch (e) { setStatus(e.error || 'Could not add webhook.'); }
    finally { setBusy(false); }
  }
  async function remove(id) {
    setBusy(true);
    try { await api(`/api/projects/current/webhooks/${id}`, { method: 'DELETE' }, token); await load(); }
    catch (e) { setStatus(e.error || 'Could not remove webhook.'); }
    finally { setBusy(false); }
  }
  return <div className="webhook-settings"><h2>Connect your workflow.</h2><p>Send support events to your team's endpoint. Use a public HTTPS endpoint with IPv4 support. Deliveries retry up to six times; your receiver should deduplicate event IDs.</p>
    <form onSubmit={add}><label>Webhook URL<input required type="url" value={url} placeholder="https://your-service.example/support-events" onChange={e => setUrl(e.target.value)} /></label>
    <fieldset><legend>Events</legend>{['conversation.created', 'conversation.updated', 'message.created'].map(name => <label className="toggle-row" key={name}><input type="checkbox" checked={events.includes(name)} onChange={e => setEvents(e.target.checked ? [...events, name] : events.filter(item => item !== name))} />{name}</label>)}</fieldset>
    <button disabled={busy || !events.length}>Add webhook</button></form>
    {secret && <div role="status"><p>Copy this signing secret now. It is shown once.</p><code style={{ overflowWrap: 'anywhere' }}>{secret}</code><button type="button" className="secondary-action" onClick={() => setSecret('')}>Dismiss secret</button></div>}
    <p>Verify X-Support-Signature using HMAC-SHA256(secret, timestamp + "." + raw request body). The signature starts with v1=. Reject stale X-Support-Timestamp values and deduplicate X-Support-Event-Id.</p>
    {data.webhooks.map(hook => <div key={hook.id}><p style={{ overflowWrap: 'anywhere' }}>{hook.url}</p><small>{hook.events.join(', ')}</small><button type="button" className="secondary-action" disabled={busy} onClick={() => remove(hook.id)}>Remove</button></div>)}
    <h3>Recent deliveries</h3><button type="button" className="secondary-action" onClick={load}>Refresh deliveries</button>
    {data.deliveries.length ? <ul>{data.deliveries.map(d => <li key={d.id}>{d.state}  /  {d.attempts} attempts  /  {new Date(d.created_at).toLocaleString()}</li>)}</ul> : <p>No deliveries yet.</p>}
    {status && <p role="status">{status}</p>}
  </div>;
}
