import { AppearanceControl } from "./Appearance";
import React, { useState } from "react";

export default function PasswordRecovery({ api, onBack }) {
  const [resetToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token") || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  async function submit(event) {
    event.preventDefault(); setError(""); setStatus("");
    if (resetToken && password !== confirm) { setError("The passwords must match."); return; }
    setBusy(true);
    try {
      const result = await api(`/api/auth/${resetToken ? "reset-password" : "forgot-password"}`, {
        method: "POST", body: JSON.stringify(resetToken ? { token: resetToken, password } : { email })
      });
      setStatus(result.message);
      if (resetToken) { setDone(true); window.history.replaceState(null, "", "/admin"); }
    } catch (err) { setError(err.error || "Could not complete the request. Please try again."); }
    finally { setBusy(false); }
  }
  return <main className="login-shell"><form className="login-panel" onSubmit={submit}>
    <div className="login-appearance"><AppearanceControl /></div><h1>{resetToken ? "Choose a new password" : "Forgot your password?"}</h1>
    <p>{resetToken ? "Your new password must contain at least 10 characters." : "Enter the email connected to your staff account. We’ll send a reset link that expires in 30 minutes."}</p>
    {!done && (resetToken ? <><label>New password<input type="password" autoComplete="new-password" required minLength={10} maxLength={256} value={password} onChange={event => setPassword(event.target.value)} /></label><label>Confirm password<input type="password" autoComplete="new-password" required value={confirm} onChange={event => setConfirm(event.target.value)} /></label></> : <label>Email<input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>)}
    {error && <p className="form-error" role="alert">{error}</p>}{status && <p role="status">{status}</p>}
    {!done && <button disabled={busy} type="submit">{busy ? "Please wait…" : resetToken ? "Reset password" : "Send reset link"}</button>}
    <button type="button" className="secondary-action" onClick={onBack}>Back to sign in</button>
  </form></main>;
}
