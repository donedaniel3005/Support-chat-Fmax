import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import "./styles.css";
import { AppearanceProvider, AppearanceControl } from "./Appearance";
import { readableText } from "./appearance-model.mjs";
import MarketingPage from "./MarketingPage";
import { OwnerConsole, WorkspaceBilling } from "./Billing";
import Integrations from "./Integrations";
import PasswordRecovery from "./PasswordRecovery";
import { useInboxReliability } from "./useInboxReliability";

const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? window.location.origin : "http://localhost:4000");
let WIDGET_KEY = import.meta.env.VITE_WIDGET_KEY || "demo_widget_key";
const AUTH_KEY = "support-admin-token";
let CUSTOMER_TICKET_IDS_KEY = `support-customer-ticket-ids:${WIDGET_KEY}`;
const PRODUCT_NAME = "24/7Support";
const CONTACT_EMAIL = "danielkariuki3005@gmail.com";

const socket = io(API_URL);

const statusOptions = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "pending", label: "Pending" },
  { value: "closed", label: "Closed" }
];

const fallbackProject = {
  name: "FMAX",
  widgetKey: WIDGET_KEY,
  websiteUrl: "http://localhost:5173",
  aiEnabled: true,
  plan: "free",
  billingStatus: "owner_approved",
  theme: {
    brandName: PRODUCT_NAME,
    accentColor: "#14b8a6",
    launcherColor: "#0f172a",
    panelColor: "#0b1220",
    textColor: "#f8fafc",
    greeting: "Hi, how can we help?",
    replyTime: "We typically reply in a few hours",
    position: "right"
  }
};

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function api(path, options = {}, token = "") {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token),
      ...(options.headers || {})
    }
  });
  const data = await res.json();
  if (!res.ok) throw { ...data, status: res.status };
  return data;
}

async function widgetApi(path, options = {}) {
  return api(path, {
    ...options,
    headers: {
      "X-Widget-Key": WIDGET_KEY,
      ...(options.headers || {})
    }
  });
}

function normalizeXUsername(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function formatTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function loadCustomerTicketIds() {
  try {
    const stored = localStorage.getItem(CUSTOMER_TICKET_IDS_KEY);
    const ids = stored ? JSON.parse(stored) : [];
    return Array.isArray(ids) ? ids.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveCustomerTicketIds(ids) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  localStorage.setItem(CUSTOMER_TICKET_IDS_KEY, JSON.stringify(uniqueIds));
  return uniqueIds;
}

function rememberCustomerTicket(id) {
  return saveCustomerTicketIds([id, ...loadCustomerTicketIds()]);
}

function getTicketPreview(ticket) {
  const latestMessage = ticket.messages?.[ticket.messages.length - 1];
  return ticket.last_message || latestMessage?.body || (latestMessage?.attachments?.length ? "Image attachment" : "No messages yet");
}

function getRelativeTicketTime(value) {
  if (!value) return "";
  const timestamp = new Date(value).getTime();
  const difference = Math.max(0, Date.now() - timestamp);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const year = 365 * day;

  if (difference >= year) return `${Math.floor(difference / year)}y`;
  if (difference >= day) return `${Math.floor(difference / day)}d`;
  if (difference >= hour) return `${Math.floor(difference / hour)}h`;
  if (difference >= minute) return `${Math.floor(difference / minute)}m`;
  return "now";
}

function WidgetNavIcon({ type }) {
  if (type === "home") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 10.5 12 4l8 6.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-8Z" />
        <path d="M9 20v-6h6v6" />
      </svg>
    );
  }

  if (type === "messages") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 5h14v10H9l-4 4V5Z" />
        <path d="M8 9h8M8 12h5" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 7h14v4a2 2 0 0 0 0 4v4H5v-4a2 2 0 0 0 0-4V7Z" />
      <path d="M9 9h6M9 15h6" />
    </svg>
  );
}

function TicketAvatar({ ticket, brandName }) {
  const isCustomer = ticket.name && ticket.name !== brandName;

  return (
    <span className={isCustomer ? "ticket-avatar customer" : "ticket-avatar brand"} aria-hidden="true">
      {isCustomer ? (ticket.name?.[0] || "C").toUpperCase() : <SupportMark />}
    </span>
  );
}

function readImageAttachments(fileList) {
  const files = Array.from(fileList || []).filter(file => file.type.startsWith("image/")).slice(0, 4);

  return Promise.all(files.map(file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      id: `${file.name}-${file.lastModified}-${file.size}`,
      name: file.name,
      type: file.type,
      dataUrl: reader.result
    });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  })));
}

function MessageAttachments({ attachments = [] }) {
  if (!attachments.length) return null;

  return (
    <div className="message-attachments">
      {attachments.map(attachment => (
        <a key={attachment.id || attachment.dataUrl} href={attachment.dataUrl} target="_blank" rel="noreferrer">
          <img src={attachment.dataUrl} alt={attachment.name || "Attached image"} />
          <span>{attachment.name || "Attached image"}</span>
        </a>
      ))}
    </div>
  );
}

function AttachmentPicker({ attachments, onChange, label = "Attach images" }) {
  async function handleFiles(event) {
    const nextAttachments = await readImageAttachments(event.target.files);
    onChange([...attachments, ...nextAttachments].slice(0, 4));
    event.target.value = "";
  }

  return (
    <div className="attachment-picker">
      <label className="attachment-input">
        {label}
        <input type="file" accept="image/*" multiple onChange={handleFiles} />
      </label>

      {attachments.length > 0 && (
        <div className="attachment-list">
          {attachments.map(attachment => (
            <span key={attachment.id} className="attachment-chip">
              {attachment.name}
              <button
                type="button"
                aria-label={`Remove ${attachment.name}`}
                onClick={() => onChange(attachments.filter(existing => existing.id !== attachment.id))}
              >
                x
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function LauncherIcon({ open }) {
  if (open) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 7l10 10M17 7L7 17" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12a7 7 0 0 1 14 0v3.5a2.5 2.5 0 0 1-2.5 2.5H14" />
      <path d="M5 12v3a2 2 0 0 0 2 2h1v-6H7a2 2 0 0 0-2 2" />
      <path d="M19 12v3a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2" />
      <path d="M10 18h4" />
      <path d="M9 7.8a5.2 5.2 0 0 1 6 0" />
    </svg>
  );
}

function SupportMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12a7 7 0 0 1 14 0v3.5a2.5 2.5 0 0 1-2.5 2.5H14" />
      <path d="M5 12v3a2 2 0 0 0 2 2h1v-6H7a2 2 0 0 0-2 2" />
      <path d="M19 12v3a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2" />
      <path d="M10 18h4" />
    </svg>
  );
}

function CustomerWidget() {
  const [open, setOpen] = useState(false);
  const [activeWidgetView, setActiveWidgetView] = useState("inbox");
  const [project, setProject] = useState(fallbackProject);
  const [conversation, setConversation] = useState(null);
  const [customerTickets, setCustomerTickets] = useState([]);
  const [messages, setMessages] = useState([]);
  const [form, setForm] = useState({
    name: "",
    email: "",
    wallet: "",
    xUsername: "",
    screenshotUrl: "",
    firstMessage: ""
  });
  const [reply, setReply] = useState("");
  const [ticketAttachments, setTicketAttachments] = useState([]);
  const [replyAttachments, setReplyAttachments] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingTickets, setIsLoadingTickets] = useState(false);
  const [error, setError] = useState("");

  const theme = project.theme || fallbackProject.theme;
  const widgetBrandName = theme.brandName || PRODUCT_NAME;

  const loadCustomerTickets = useCallback(async () => {
    const ids = loadCustomerTicketIds();
    if (ids.length === 0) {
      setCustomerTickets([]);
      return;
    }

    setIsLoadingTickets(true);

    try {
      const results = await Promise.all(ids.map(async id => {
        try {
          return await widgetApi(`/api/conversations/${id}`);
        } catch {
          return null;
        }
      }));

      const tickets = results
        .filter(Boolean)
        .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));

      setCustomerTickets(tickets);
      // Preserve saved ticket IDs during temporary network failures.
    } finally {
      setIsLoadingTickets(false);
    }
  }, []);

  useEffect(() => {
    widgetApi(`/api/widget/config?widgetKey=${encodeURIComponent(WIDGET_KEY)}`)
      .then(data => setProject({ ...fallbackProject, ...data, theme: { ...fallbackProject.theme, ...data.theme } }))
      .catch(() => setProject(fallbackProject));
    loadCustomerTickets();
  }, [loadCustomerTickets]);

  useEffect(() => {
    if (!open) return;
    loadCustomerTickets();
  }, [loadCustomerTickets, open]);

  useEffect(() => {
    const ticketIds = customerTickets.map(ticket => ticket.id);
    if (ticketIds.length === 0) return;

    ticketIds.forEach(ticketId => socket.emit("conversation:join", { conversationId: ticketId, widgetKey: WIDGET_KEY }));

    const onCustomerTicketMessage = message => {
      if (!ticketIds.includes(message.conversation_id)) return;

      setCustomerTickets(previousTickets => previousTickets
        .map(ticket => {
          if (ticket.id !== message.conversation_id) return ticket;
          const alreadyAdded = ticket.messages?.some(existingMessage => existingMessage.id === message.id);
          return {
            ...ticket,
            updated_at: message.created_at,
            messages: alreadyAdded ? ticket.messages : [...(ticket.messages || []), message]
          };
        })
        .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at)));
    };

    socket.on("message:new", onCustomerTicketMessage);

    return () => {
      socket.off("message:new", onCustomerTicketMessage);
      ticketIds.forEach(ticketId => socket.emit("conversation:leave", ticketId));
    };
  }, [customerTickets]);

  useEffect(() => {
    if (!conversation?.id) return;

    socket.emit("conversation:join", { conversationId: conversation.id, widgetKey: WIDGET_KEY });

    const onNewMessage = message => {
      if (message.conversation_id !== conversation.id) return;
      setMessages(previousMessages => {
        const alreadyAdded = previousMessages.some(existingMessage => existingMessage.id === message.id);
        return alreadyAdded ? previousMessages : [...previousMessages, message];
      });
    };

    socket.on("message:new", onNewMessage);

    return () => {
      socket.emit("conversation:leave", conversation.id);
      socket.off("message:new", onNewMessage);
    };
  }, [conversation?.id]);

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    async function catchUp() {
      await loadCustomerTickets();
      if (conversation?.id) {
        try { const latest = await widgetApi(`/api/conversations/${conversation.id}`); if (!stopped) { setMessages(latest.messages || []); setConversation(latest); } } catch { /* Keep the last confirmed messages and retry automatically. */ }
      }
    }
    const rejoin = () => { if (conversation?.id) socket.emit("conversation:join", { conversationId: conversation.id, widgetKey: WIDGET_KEY }); void catchUp(); };
    socket.on("connect", rejoin); window.addEventListener("online", rejoin); window.addEventListener("focus", catchUp);
    const timer = setInterval(catchUp, 8000);
    return () => { stopped = true; clearInterval(timer); socket.off("connect", rejoin); window.removeEventListener("online", rejoin); window.removeEventListener("focus", catchUp); };
  }, [open, conversation?.id, loadCustomerTickets]);

  async function startConversation(event) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const data = await widgetApi("/api/conversations", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          xUsername: normalizeXUsername(form.xUsername),
          attachments: ticketAttachments,
          pageUrl: window.location.href,
          userAgent: navigator.userAgent,
          widgetKey: WIDGET_KEY
        })
      });

      rememberCustomerTicket(data.id);
      setConversation(data);
      setMessages(data.messages || []);
      setCustomerTickets(previousTickets => [data, ...previousTickets.filter(ticket => ticket.id !== data.id)]);
      setForm(previousForm => ({ ...previousForm, firstMessage: "" }));
      setTicketAttachments([]);
      setActiveWidgetView("inbox");
    } catch (err) {
      setError(err.error || "Could not start the ticket. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function sendReply(event) {
    event.preventDefault();
    if ((!reply.trim() && replyAttachments.length === 0) || !conversation?.id || isSubmitting) return;
    setIsSubmitting(true); setError("");
    try {

    const data = await widgetApi(`/api/conversations/${conversation.id}/messages`, {
      method: "POST",
      body: JSON.stringify({
        senderType: "user",
        senderName: form.name || "Customer",
        body: reply,
        attachments: replyAttachments,
        widgetKey: WIDGET_KEY
      })
    });

    setMessages(previousMessages => previousMessages.some(message => message.id === data.id) ? previousMessages : [...previousMessages, data]);
    setReply("");
    setReplyAttachments([]);
    } catch (err) { setError(err.error || "Could not send. Your draft is saved; please try again."); }
    finally { setIsSubmitting(false); }
  }

  async function selectCustomerTicket(ticketId) {
    const data = await widgetApi(`/api/conversations/${ticketId}`);
    setConversation(data);
    setMessages(data.messages || []);
    setActiveWidgetView("inbox");
    setCustomerTickets(previousTickets => previousTickets.map(ticket => ticket.id === data.id ? data : ticket));
  }

  function openWidgetView(view) {
    setActiveWidgetView(view);
    if (view !== "inbox") setConversation(null);
  }

  return (
    <>
      <MarketingPage />

      {open && (
        <div
          className="chatbox support-widget"
          role="dialog"
          aria-label="Support chat"
          style={{
            "--brand-accent": theme.accentColor,
            "--widget-panel": theme.panelColor,
            "--widget-text": theme.textColor
          }}
        >
          <div className="chat-header">
            {conversation && activeWidgetView === "inbox" ? (
              <button type="button" className="thread-back icon-back" aria-label="Back to messages" onClick={() => setConversation(null)}>‹</button>
            ) : <span className="header-spacer" aria-hidden="true" />}
            <strong>{conversation && activeWidgetView === "inbox" ? "Conversation" : activeWidgetView === "new-ticket" ? "New message" : activeWidgetView === "home" ? "Home" : "Messages"}</strong>
            <button type="button" aria-label="Close chat" onClick={() => setOpen(false)}>x</button>
          </div>

          <div className="widget-body">
          {activeWidgetView === "home" ? (
            <div className="widget-home">
              <span className="support-brand-glyph" aria-hidden="true"><SupportMark /></span>
              <h2>{theme.greeting}</h2>
              <p>{theme.replyTime}. Start a message or reopen one of your saved support threads.</p>
              <button type="button" onClick={() => openWidgetView("new-ticket")}>Send us a message</button>
            </div>
          ) : activeWidgetView === "new-ticket" ? (
            <form className="chat-form" onSubmit={startConversation}>
              <div className="chat-intro">
                <strong>{theme.greeting}</strong>
                <p>Send your details and support will reply in this secure thread.</p>
              </div>

              <label>Name<input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
              <label>Email<input type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label>
              <label>X username<input required placeholder="@yourhandle" value={form.xUsername} onChange={event => setForm({ ...form, xUsername: event.target.value })} /></label>
              <label>Wallet<input value={form.wallet} onChange={event => setForm({ ...form, wallet: event.target.value })} /></label>
              <label>Screenshot link<input type="url" placeholder="https://..." value={form.screenshotUrl} onChange={event => setForm({ ...form, screenshotUrl: event.target.value })} /></label>
              <AttachmentPicker attachments={ticketAttachments} onChange={setTicketAttachments} label="Attach screenshots" />
              <label>Message<textarea required value={form.firstMessage} onChange={event => setForm({ ...form, firstMessage: event.target.value })} /></label>

              {error && <p className="form-error">{error}</p>}
              <button type="submit" disabled={isSubmitting}>{isSubmitting ? "Opening ticket..." : "Start chat"}</button>
            </form>
          ) : conversation ? (
            <>
              <div className="ticket-summary">
                <TicketAvatar ticket={conversation} brandName={widgetBrandName} />
                <div>
                  <strong>{conversation.x_username || conversation.name || widgetBrandName}</strong>
                  <span>{conversation.status || "open"}</span>
                </div>
              </div>

              <div className="messages">
                {messages.map(message => (
                  <div key={message.id} className={`bubble ${message.sender_type}`}>
                    <span>{message.sender_name}</span>
                    {message.body && <p>{message.body}</p>}
                    <MessageAttachments attachments={message.attachments} />
                  </div>
                ))}
              </div>

              <form className="reply-row reply-composer" onSubmit={sendReply}>
                <div className="composer-stack">
                  <input placeholder="Type a reply..." value={reply} onChange={event => setReply(event.target.value)} />
                  <AttachmentPicker attachments={replyAttachments} onChange={setReplyAttachments} label="Add image" />
                </div>
                <button type="submit">Send</button>
              </form>
            </>
          ) : customerTickets.length > 0 || isLoadingTickets ? (
            <div className="customer-ticket-list">
              {isLoadingTickets && <p className="loading-line">Loading messages...</p>}

              {customerTickets.map(ticket => (
                <button key={ticket.id} type="button" className="customer-ticket-card" onClick={() => selectCustomerTicket(ticket.id)}>
                  <TicketAvatar ticket={ticket} brandName={widgetBrandName} />
                  <span className="ticket-row-time">{getRelativeTicketTime(ticket.updated_at || ticket.created_at)}</span>
                  <span className="ticket-row-copy">
                    <strong>{ticket.x_username || ticket.name || widgetBrandName}</strong>
                    <p>{getTicketPreview(ticket)}</p>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="inbox-empty">
              <strong>No messages yet</strong>
              <p>Open a new ticket and replies from support will appear here.</p>
            </div>
          )}
          </div>

          {!conversation && activeWidgetView === "inbox" && (
            <button type="button" className="widget-floating-cta" onClick={() => openWidgetView("new-ticket")}>
              Send us a message <span aria-hidden="true">▶</span>
            </button>
          )}

          <nav className="widget-bottom-nav" aria-label="Support widget navigation">
            <button type="button" className={activeWidgetView === "home" ? "active" : ""} onClick={() => openWidgetView("home")}>
              <WidgetNavIcon type="home" />
              <span>Home</span>
            </button>
            <button type="button" className={activeWidgetView === "inbox" ? "active" : ""} onClick={() => openWidgetView("inbox")}>
              <WidgetNavIcon type="messages" />
              <span>Messages</span>
            </button>
            <button type="button" className={activeWidgetView === "new-ticket" ? "active" : ""} onClick={() => openWidgetView("new-ticket")}>
              <WidgetNavIcon type="tickets" />
              <span>Tickets</span>
            </button>
          </nav>
        </div>
      )}

      <button
        className={`launcher ${open ? "open" : ""}`}
        style={{ background: theme.launcherColor || theme.accentColor, color: readableText(theme.launcherColor || theme.accentColor) }}
        type="button"
        aria-label={open ? "Close support" : "Open support"}
        onClick={() => setOpen(previousOpen => !previousOpen)}
      >
        <LauncherIcon open={open} />
        {!open && <span>Let's chat</span>}
      </button>
    </>
  );
}

function LoginScreen({ onLogin }) {
  const [recovery, setRecovery] = useState(window.location.pathname === "/admin/reset-password");
  const [register, setRegister] = useState(new URLSearchParams(window.location.search).get("create") === "1");
  const [workspaceName, setWorkspaceName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (register) await api("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password, name: workspaceName }) });
      const session = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      localStorage.setItem(AUTH_KEY, session.token);
      onLogin(session);
    } catch (err) {
      setError(err.error || "Could not sign in.");
    } finally {
      setLoading(false);
    }
  }

  if (recovery) return <PasswordRecovery api={api} onBack={() => { window.history.replaceState(null, "", "/admin"); setRecovery(false); }} />;
  return (
    <main className="login-shell">
      <form className="login-panel" onSubmit={submit}>
        <div className="login-appearance"><AppearanceControl /></div>
        <div className="login-brand-row">
          <span className="brand-glyph">S</span>
          <div>
            <strong>{PRODUCT_NAME}</strong>
            <small>Admin workspace</small>
          </div>
        </div>
        <span className="eyebrow">Secure team sign-in</span>
        <h1>{register ? "Create your workspace" : `Sign in to ${PRODUCT_NAME}`}</h1>
        <p>{register ? "Start on the free plan, customize your widget, and send your first test message." : "Use your staff account, or create a free workspace to get started."}</p>
        {register && <label>Workspace name<input required maxLength={120} value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} /></label>}
        <label>Email<input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label>Password<input type="password" autoComplete={register ? "new-password" : "current-password"} minLength={register ? 10 : undefined} maxLength={256} required value={password} onChange={event => setPassword(event.target.value)} /></label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" disabled={loading}>{loading ? "Please wait..." : register ? "Create workspace" : "Sign in"}</button>
        <button type="button" className="secondary-action" onClick={() => { setRegister(!register); setError(""); }}>{register ? "Already have an account? Sign in" : "Create a free workspace"}</button>
        {!register && <button type="button" className="secondary-action" onClick={() => setRecovery(true)}>Forgot password?</button>}
        <p className="login-help">Need access or free-tier approval? Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
      </form>
    </main>
  );
}

const themePresets = [
  { name: "Teal", accentColor: "#0f766e", launcherColor: "#0f766e", panelColor: "#0b1220", textColor: "#f8fafc" },
  { name: "Green", accentColor: "#15803d", launcherColor: "#166534", panelColor: "#052e16", textColor: "#f0fdf4" },
  { name: "Blue", accentColor: "#1d4ed8", launcherColor: "#1e40af", panelColor: "#0c1c38", textColor: "#eff6ff" },
  { name: "Purple", accentColor: "#7e22ce", launcherColor: "#6b21a8", panelColor: "#251036", textColor: "#faf5ff" },
  { name: "Rose", accentColor: "#be123c", launcherColor: "#9f1239", panelColor: "#30101d", textColor: "#fff1f2" }
];
function ThemeChooser({ theme, onChange }) {
  const [customName, setCustomName] = useState("");
  const customs = theme.customPresets || [];
  const apply = preset => onChange({ ...preset, customPresets: customs });
  return <div className="theme-chooser"><p>Pick a preset, or adjust the colors below and save your own. Save settings to apply it to your workspace.</p><div className="theme-swatches">{[...themePresets, ...customs].map(preset => <button key={preset.name} type="button" onClick={() => apply(preset)} style={{ borderColor: preset.accentColor }}><span style={{ background: preset.accentColor }} />{preset.name}</button>)}</div>
    <label className="settings-field">Custom theme name<input value={customName} maxLength={32} onChange={event => setCustomName(event.target.value)} placeholder="e.g. Alphabot green" /></label>
    <button type="button" className="small-button" disabled={!customName.trim() || customs.length >= 8} onClick={() => { const preset = { name: customName.trim(), ...Object.fromEntries(["accentColor", "launcherColor", "panelColor", "textColor"].map(key => [key, theme[key]])) }; onChange({ customPresets: [...customs.filter(item => item.name !== preset.name), preset] }); setCustomName(""); }}>Save colors as custom theme</button>
    {customs.map(preset => <button key={preset.name} type="button" className="small-button" onClick={() => onChange({ customPresets: customs.filter(item => item.name !== preset.name) })}>Remove {preset.name}</button>)}
    <div className="theme-live-preview" style={{ background: theme.panelColor, color: theme.textColor }}><strong>{theme.brandName}</strong><p>{theme.greeting}</p><span style={{ background: theme.accentColor, color: readableText(theme.accentColor) }}>Your support reply</span></div>
  </div>;
}

function WorkspaceSetup({ project, token, onProject, onClose }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(() => ({ ...project, theme: { ...project.theme } }));
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [verified, setVerified] = useState(false);
  const code = `<script src="${API_URL}/widget.js" data-key="${project.widgetKey}"></script>`;
  const steps = ["Workspace", "Customize", "Install", "Test"];
  async function save(event) {
    event.preventDefault(); setBusy(true); setStatus("");
    try {
      const saved = await api("/api/projects/current", { method: "PUT", body: JSON.stringify(draft) }, token);
      onProject(saved); setStep(current => current + 1);
    } catch (err) { setStatus(err.error || "Could not save setup."); }
    finally { setBusy(false); }
  }
  async function check() {
    setBusy(true);
    try {
      const tickets = await api("/api/conversations", {}, token);
      const test = tickets.find(ticket => ticket.page_url?.includes("/widget-demo"));
      setVerified(Boolean(test));
      setStatus(test ? "Test message received in your inbox. You’re ready to reply." : "No test message yet. Open Chat below and send one, then check again.");
    } catch (err) { setStatus(err.error || "Could not check messages."); }
    finally { setBusy(false); }
  }
  return <section className="workspace-setup" aria-label="Workspace setup">
    <div className="settings-heading-row"><h2>Get your support inbox ready</h2><button type="button" className="small-button" onClick={onClose}>Do this later</button></div>
    <ol className="setup-progress">{steps.map((label, index) => <li key={label} aria-current={index === step ? "step" : undefined}><button type="button" onClick={() => { setStep(index); setStatus(""); }}>{index + 1}. {label}</button></li>)}</ol>
    {step < 2 ? <form onSubmit={save}>
      {step === 0 ? <><p>Set the name and website for this workspace.</p><label>Workspace name<input required maxLength={120} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label><label>Website URL<input type="url" required placeholder="https://your-company.com" value={draft.websiteUrl || ""} onChange={event => setDraft({ ...draft, websiteUrl: event.target.value })} /></label></> : <><p>Make the widget feel like part of your website.</p><label>Brand name<input required maxLength={80} value={draft.theme.brandName} onChange={event => setDraft({ ...draft, theme: { ...draft.theme, brandName: event.target.value } })} /></label><label>Greeting<input required maxLength={140} value={draft.theme.greeting} onChange={event => setDraft({ ...draft, theme: { ...draft.theme, greeting: event.target.value } })} /></label><label>Accent color<input type="color" value={draft.theme.accentColor} onChange={event => setDraft({ ...draft, theme: { ...draft.theme, accentColor: event.target.value } })} /></label><label>Position<select value={draft.theme.position} onChange={event => setDraft({ ...draft, theme: { ...draft.theme, position: event.target.value } })}><option value="right">Right</option><option value="left">Left</option></select></label><div className="setup-preview" style={{ borderColor: draft.theme.accentColor }}><strong>{draft.theme.brandName}</strong><p>{draft.theme.greeting}</p></div></>}
      <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save and continue"}</button>
    </form> : step === 2 ? <><p>Paste this before the closing body tag on your website.</p><pre><code>{code}</code></pre><div className="setup-actions"><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(code); setCopied(true); } catch { setStatus("Select and copy the script above."); } }}>{copied ? "Copied" : "Copy install code"}</button><button type="button" onClick={() => { setStep(3); setStatus(""); }}>Continue to test</button></div></> : <><p>Send a message through your actual widget on the test page below.</p><iframe title="Test your support widget" src={`${API_URL}/widget-demo?key=${encodeURIComponent(project.widgetKey)}`} /><div className="setup-actions"><button type="button" disabled={busy} onClick={check}>Check for test message</button>{verified && <button type="button" onClick={onClose}>Finish setup and open inbox</button>}</div></>}
    {status && <p role="status">{status}</p>}
  </section>;
}

function AdminInbox() {
  const [token, setToken] = useState(() => localStorage.getItem(AUTH_KEY) || "");
  const [session, setSession] = useState(null);
  const [project, setProject] = useState(fallbackProject);
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [reply, setReply] = useState("");
  const [replyAttachments, setReplyAttachments] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [inboxError, setInboxError] = useState("");
  const [showSetup, setShowSetup] = useState(false);
  const [workspaceView, setWorkspaceView] = useState("inbox");
  const [settingsTab, setSettingsTab] = useState("appearance");
  const [automations, setAutomations] = useState([]);
  const [staffUsers, setStaffUsers] = useState([]);
  const [staffForm, setStaffForm] = useState({ email: "", password: "", role: "agent" });
  const [staffStatus, setStaffStatus] = useState("");
  const [automationStatus, setAutomationStatus] = useState("");
  const [settingsStatus, setSettingsStatus] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [aiDraftStatus, setAiDraftStatus] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const selectedRequestRef = useRef(0);
  const selectedIdRef = useRef(null);
  const inboxRequestRef = useRef(0);

  const hydrateSession = useCallback(async activeToken => {
    const data = await api("/api/auth/me", {}, activeToken);
    setSession(data);
    setProject({ ...fallbackProject, ...data.project, theme: { ...fallbackProject.theme, ...data.project.theme } });
    socket.emit("project:join", { projectId: data.project.id, token: activeToken });
  }, []);

  const loadConversations = useCallback(async () => {
    if (!token) return;
    const request = ++inboxRequestRef.current;
    try {
      const data = await api(`/api/conversations?${new URLSearchParams({ status: statusFilter, q: searchQuery })}`, {}, token);
      if (request !== inboxRequestRef.current) return;
      setConversations(data);
      setInboxError("");
    } catch (err) { if (request === inboxRequestRef.current) setInboxError(err.error || "Could not load inbox."); }
  }, [statusFilter, searchQuery, token]);

  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!token || !session) return;
    const join = () => {
      socket.emit("project:join", { projectId: session.project.id, token });
      if (selectedId) socket.emit("conversation:join", { conversationId: selectedId, token });
    };
    join();
    socket.on("connect", join);
    return () => socket.off("connect", join);
  }, [token, session, selectedId]);

  const loadAutomations = useCallback(async () => {
    if (!token) return;
    setAutomations(await api("/api/automations", {}, token));
  }, [token]);

  const loadStaffUsers = useCallback(async () => {
    if (!token) return;
    setStaffUsers(await api("/api/staff", {}, token));
  }, [token]);

  const loadConversation = useCallback(async (id, background = false) => {
    const request = ++selectedRequestRef.current;
    selectedIdRef.current = id;
    if (!background) { setIsLoading(true); setSelectedId(id); setSelected(null); setReply(""); setReplyAttachments([]); }
    try {
      const data = await api(`/api/conversations/${id}`, {}, token);
      if (request !== selectedRequestRef.current || selectedIdRef.current !== id) return;
      setSelected(data); setSelectedId(id);
      if (workspaceView === "inbox" && !document.hidden && document.hasFocus()) await api(`/api/conversations/${id}/read`, { method: "POST", body: "{}" }, token);
    } catch (err) { setInboxError(err.error || "Could not load ticket."); }
    finally { if (request === selectedRequestRef.current) setIsLoading(false); }
  }, [token, workspaceView]);

  const reliability = useInboxReliability({ api, socket, token, projectId: session?.project?.id, onSync: async () => {
    if (selectedIdRef.current) await loadConversation(selectedIdRef.current, true);
    await loadConversations();
  } });

  useEffect(() => {
    if (!token) return;
    let stopped = false, timer;
    async function restore() {
      try { await hydrateSession(token); }
      catch (err) {
        if (stopped) return;
        if (err.status === 401) { localStorage.removeItem(AUTH_KEY); setToken(""); setSession(null); }
        else { setInboxError("Connection interrupted. Restoring your workspace automatically…"); timer = setTimeout(restore, 3000); }
      }
    }
    void restore();
    return () => { stopped = true; clearTimeout(timer); };
  }, [hydrateSession, token]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    loadAutomations();
  }, [loadAutomations]);

  useEffect(() => {
    loadStaffUsers();
  }, [loadStaffUsers]);

  useEffect(() => {
    const handleNewConversation = conversation => {
      loadConversations();
      if (!selectedId) loadConversation(conversation.id);
    };

    const handleUpdatedConversation = conversation => {
      loadConversations();
      if (conversation?.id === selectedId) setSelected(conversation);
    };

    socket.on("conversation:new", handleNewConversation);
    socket.on("conversation:updated", handleUpdatedConversation);

    return () => {
      socket.off("conversation:new", handleNewConversation);
      socket.off("conversation:updated", handleUpdatedConversation);
    };
  }, [loadConversations, loadConversation, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    socket.emit("conversation:join", { conversationId: selectedId, token });

    const onNewMessage = message => {
      if (message.conversation_id !== selectedId) return;
      setSelected(previousConversation => {
        if (!previousConversation) return previousConversation;
        const alreadyAdded = previousConversation.messages.some(existingMessage => existingMessage.id === message.id);
        return alreadyAdded ? previousConversation : { ...previousConversation, messages: [...previousConversation.messages, message] };
      });
    };

    socket.on("message:new", onNewMessage);
    return () => {
      socket.emit("conversation:leave", selectedId);
      socket.off("message:new", onNewMessage);
    };
  }, [selectedId, token]);

  function handleLogin(nextSession) {
    setToken(nextSession.token);
    setSession(nextSession);
    setProject({ ...fallbackProject, ...nextSession.project, theme: { ...fallbackProject.theme, ...nextSession.project.theme } });
    socket.emit("project:join", { projectId: nextSession.project.id, token: nextSession.token });
  }

  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST", body: "{}" }, token);
    } finally {
      socket.disconnect();
      socket.connect();
      localStorage.removeItem(AUTH_KEY);
      setToken("");
      setSelected(null);
      setSelectedId(null);
      setConversations([]);
      setSession(null);
    }
  }

  async function sendAgentMessage(body, attachments = []) {
    if ((!body.trim() && attachments.length === 0) || !selectedId) return false;

    await api(`/api/conversations/${selectedId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        senderType: "agent",
        senderName: project.theme?.brandName || "Support",
        body,
        attachments
      })
    }, token);

    return true;
  }

  async function sendAgentReply(event) {
    event.preventDefault();
    if (sendingReply) return;
    setSendingReply(true);
    try {
      const sent = await sendAgentMessage(reply, replyAttachments);
      if (sent) {
        setReply("");
        setReplyAttachments([]);
        await loadConversation(selectedId);
        await loadConversations();
      }
    } catch (err) { setInboxError(err.error || "Could not send reply. Your draft is preserved; try again."); }
    finally { setSendingReply(false); }
  }

  async function updateStatus(status) {
    if (!selectedId) return;
    try {
      setSelected(await api(`/api/conversations/${selectedId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      }, token));
      await loadConversations();
    } catch (err) { setInboxError(err.error || "Could not change status."); }
  }

  async function runAutomation(template) {
    setReply(current => current ? `${current}\n\n${template.body}` : template.body);
  }

  function updateAutomation(id, updates) {
    setAutomations(currentAutomations => currentAutomations.map(template => (
      template.id === id ? { ...template, ...updates } : template
    )));
    setAutomationStatus("");
  }

  async function saveAutomations() {
    setAutomationStatus("Saving...");
    try {
      const data = await api("/api/automations", {
        method: "PUT",
        body: JSON.stringify({ automations })
      }, token);
      setAutomations(data);
      setAutomationStatus("Saved");
    } catch (err) {
      setAutomationStatus(err.error || "Could not save automations.");
    }
  }

  async function saveProjectSettings() {
    setSettingsStatus("Saving...");
    try {
      const data = await api("/api/projects/current", {
        method: "PUT",
        body: JSON.stringify(project)
      }, token);
      setProject({ ...fallbackProject, ...data, theme: { ...fallbackProject.theme, ...data.theme } });
      setSettingsStatus("Saved");
    } catch (err) {
      setSettingsStatus(err.error || "Could not save settings.");
    }
  }

  async function rotateWidgetKey() {
    const data = await api("/api/projects/current/rotate-key", { method: "POST", body: "{}" }, token);
    setProject({ ...fallbackProject, ...data, theme: { ...fallbackProject.theme, ...data.theme } });
  }

  async function addStaffUser(event) {
    event.preventDefault();
    setStaffStatus("Adding...");
    try {
      const data = await api("/api/staff", {
        method: "POST",
        body: JSON.stringify(staffForm)
      }, token);
      setStaffUsers(data);
      setStaffForm({ email: "", password: "", role: "agent" });
      setStaffStatus("Teammate added. Share the temporary password privately.");
    } catch (err) {
      setStaffStatus(err.error || "Could not add teammate.");
    }
  }

  async function removeStaffUser(userId) {
    setStaffStatus("Removing...");
    try {
      await api(`/api/staff/${userId}`, { method: "DELETE" }, token);
      await loadStaffUsers();
      setStaffStatus("Teammate removed.");
    } catch (err) {
      setStaffStatus(err.error || "Could not remove teammate.");
    }
  }

  async function draftAiReply() {
    if (!selectedId) return;
    setAiDraftStatus("Drafting...");
    try {
      const data = await api(`/api/conversations/${selectedId}/ai-draft`, { method: "POST", body: "{}" }, token);
      setReply(data.draft);
      setAiDraftStatus(`Drafted with ${data.provider}. Review before sending.`);
    } catch (err) {
      setAiDraftStatus(err.error || "Could not draft reply.");
    }
  }

  function updateTheme(updates) {
    setProject(current => ({ ...current, theme: { ...current.theme, ...updates } }));
    setSettingsStatus("");
  }

  const stats = useMemo(() => ({
    total: conversations.length,
    open: conversations.filter(conversation => conversation.status === "open").length,
    pending: conversations.filter(conversation => conversation.status === "pending").length,
    closed: conversations.filter(conversation => conversation.status === "closed").length
  }), [conversations]);

  if (token && !session) return <main className="login-shell"><div className="login-panel"><h1>Opening your workspace</h1><p role="status">{inboxError || "Restoring your secure session…"}</p><button type="button" className="secondary-action" onClick={() => { localStorage.removeItem(AUTH_KEY); setToken(""); }}>Back to sign in</button></div></main>;
  if (!token) return <LoginScreen onLogin={handleLogin} />;
  if (window.location.pathname.startsWith("/owner")) return <OwnerConsole api={api} token={token} session={session} />;

  return (
    <div className={`admin-shell ${workspaceView === "settings" ? "settings-mode" : ""}`} data-view={workspaceView} data-settings-tab={settingsTab} style={{ "--cyan": project.theme.accentColor, "--brand-accent": project.theme.accentColor, "--workspace-panel": project.theme.panelColor }}>
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span className="brand-glyph">{project.theme?.brandName?.[0] || "S"}</span>
          <div>
            <strong>{project.theme?.brandName || project.name}</strong>
            <small>{session.user?.email}</small>
          </div>
        </div>

        <div className="workspace-appearance"><span>Appearance</span><AppearanceControl /></div>
        <nav className="workspace-navigation" aria-label="Workspace"><button type="button" className={workspaceView === "inbox" ? "active" : ""} onClick={() => setWorkspaceView("inbox")}>Inbox</button><button type="button" className={workspaceView === "settings" ? "active" : ""} onClick={() => setWorkspaceView("settings")}>Settings</button></nav>
        <section className="notification-controls" aria-label="Inbox connection and notifications">
          <strong role="status">{reliability.connection}</strong>
          <button type="button" onClick={reliability.enableSound}>Enable &amp; test sound</button>
          <small role="status">{reliability.soundStatus}</small>
          <details className="notification-options"><summary>Notification options</summary>
            {reliability.soundEnabled && <button type="button" onClick={reliability.muteSound}>Mute sound</button>}
            <button type="button" onClick={reliability.enableDesktop}>Enable desktop alerts</button>
            {reliability.desktopStatus && <small role="status">{reliability.desktopStatus}</small>}
          </details>
        </section>
        <div className="metric-grid">
          <div><span>{stats.total}</span><small>Total</small></div>
          <div><span>{stats.open}</span><small>Open</small></div>
          <div><span>{stats.pending}</span><small>Pending</small></div>
        </div>

        <div className="filter-tabs" role="tablist" aria-label="Conversation filters">
          {statusOptions.map(option => (
            <button key={option.value} type="button" className={statusFilter === option.value ? "active" : ""} onClick={() => setStatusFilter(option.value)}>
              {option.label}
            </button>
          ))}
        </div>

        <label className="inbox-search">Search inbox<input type="search" placeholder="Name, email, or message…" value={search} onChange={event => setSearch(event.target.value)} /></label>
        {inboxError && <p role="alert" className="form-error">{inboxError}</p>}
        <button className="small-button" type="button" onClick={() => { setWorkspaceView("inbox"); setShowSetup(true); }}>Workspace setup</button>
        <div className="conversation-list">
          {conversations.length === 0 && <p className="empty-list">No tickets in this view.</p>}
          {conversations.map(conversation => (
            <button key={conversation.id} type="button" className={selectedId === conversation.id ? "active convo" : "convo"} onClick={() => loadConversation(conversation.id)}>
              <span className={`status-dot ${conversation.status}`} />
              <strong>{conversation.x_username || conversation.name || "Unknown customer"}{conversation.unread_count > 0 && <span className="unread-badge" aria-label={`${conversation.unread_count} unread messages`}>{conversation.unread_count}</span>}</strong>
              <small>{conversation.status} - {formatTime(conversation.updated_at)}</small>
              <p>{conversation.last_message || "No messages yet"}</p>
            </button>
          ))}
        </div>
      </aside>

      <main className="thread-panel">
        {(showSetup || !localStorage.getItem(`setup-done:${project.id}`)) && <WorkspaceSetup project={project} token={token} onProject={setProject} onClose={() => { localStorage.setItem(`setup-done:${project.id}`, "1"); setShowSetup(false); loadConversations(); }} />}

        {!selected ? (
          <div className="empty-thread">
            <span className="live-dot" />
            <h1>Support inbox</h1>
            <p>Select a ticket to reply, run automations, and manage customer details.</p>
          </div>
        ) : (
          <>
            <header className="thread-header">
              <div>
                <span className={`thread-status ${selected.status}`}>{selected.status}</span>
                <h1>{selected.x_username || selected.name || "Customer"}</h1>
                <p>{selected.email || "No email"} - {selected.wallet || "No wallet"}</p>
              </div>

              <div className="status-buttons" aria-label="Ticket status">
                <button type="button" className={selected.status === "open" ? "active" : ""} onClick={() => updateStatus("open")}>Open</button>
                <button type="button" className={selected.status === "pending" ? "active" : ""} onClick={() => updateStatus("pending")}>Pending</button>
                <button type="button" className={selected.status === "closed" ? "active" : ""} onClick={() => updateStatus("closed")}>Close</button>
              </div>
            </header>

            <div className="messages admin-messages">
              {isLoading && <p className="loading-line">Loading ticket...</p>}
              {selected.messages.map(message => (
                <div key={message.id} className={`bubble ${message.sender_type}`}>
                  <span>{message.sender_name} - {formatTime(message.created_at)}{message.aiGenerated ? " - AI" : ""}</span>
                  {message.body && <p>{message.body}</p>}
                  <MessageAttachments attachments={message.attachments} />
                </div>
              ))}
            </div>

            <form className="agent-reply reply-composer" onSubmit={sendAgentReply}>
              <div className="composer-stack">
                <textarea aria-label="Reply as support" placeholder="Reply as support... Type / for saved replies" value={reply} onChange={event => setReply(event.target.value)} onKeyDown={event => {
                  if (event.key === "Escape" && reply.startsWith("/")) { event.preventDefault(); setReply(""); }
                  if ((event.key === "Tab" || event.key === "Enter") && /^\/[^\n]*$/.test(reply)) {
                    const match = automations.find(item => !item.autoSend && item.title.toLowerCase().includes(reply.slice(1).toLowerCase()));
                    if (match) { event.preventDefault(); setReply(match.body); }
                  }
                }} />
                {/^\/[^\n]*$/.test(reply) && <div className="slash-replies" aria-label="Matching saved replies"><small>Choose a reply to insert. Enter or Tab picks the first match.</small>{automations.filter(item => !item.autoSend && item.title.toLowerCase().includes(reply.slice(1).toLowerCase())).map(item => <button type="button" key={item.id} onClick={() => setReply(item.body)}>{item.title}</button>)}</div>}
                <label className="saved-reply-picker">Insert saved reply<select value="" onChange={event => { const template = automations.find(item => item.id === event.target.value); if (template) runAutomation(template); }}><option value="">Choose a reply…</option>{automations.filter(item => !item.autoSend).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
                <AttachmentPicker attachments={replyAttachments} onChange={setReplyAttachments} label="Add image" />
                {aiDraftStatus && <p className="settings-status">{aiDraftStatus}</p>}
              </div>
              <div className="reply-actions">
                <button type="button" className="secondary-action" onClick={draftAiReply}>AI draft</button>
                <button type="submit" disabled={sendingReply || (!reply.trim() && replyAttachments.length === 0)}>{sendingReply ? "Sending…" : "Send reply"}</button>
              </div>
            </form>
          </>
        )}
      </main>

      <aside className="detail-panel">
        {workspaceView === "settings" && <div className="settings-page-header"><span className="eyebrow">YOUR WORKSPACE</span><h1>Make yourself at home.</h1><p>A few thoughtful details make all the difference.</p><nav aria-label="Settings sections">{[["appearance", "Appearance"], ["workspace", "Workspace"], ["team", "Team"], ["billing", "Billing"], ["replies", "Saved replies"], ["integrations", "Integrations"]].map(([value, label]) => <button type="button" key={value} className={settingsTab === value ? "active" : ""} onClick={() => setSettingsTab(value)}>{label}</button>)}</nav></div>}
        {workspaceView === "settings" && settingsTab === "integrations" && <Integrations api={api} token={token} />}
        <section data-settings="workspace">
          <div className="settings-heading-row">
            <h2>Workspace</h2>
            <button type="button" className="small-button" onClick={logout}>Log out</button>
          </div>

          {session.user?.isOwner && <a className="owner-area-link" href="/owner">Private owner area ↗</a>}
          <div className="detail-list">
            <div><span>Workspace name</span><strong>{project.name}</strong></div>
            <div><span>Plan</span><strong>{project.plan}</strong></div>
            <div><span>Widget key</span><strong>{project.widgetKey}</strong></div>
            <div><span>Install script</span><code>{`<script src="${API_URL}/widget.js" data-key="${project.widgetKey}"></script>`}</code></div>
          </div>
          <button type="button" className="sound-test" onClick={rotateWidgetKey}>Rotate widget key</button>
        </section>

        <WorkspaceBilling api={api} token={token} project={{ ...project, contactEmail: session.user.email }} />

        <section data-settings="team">
          <h2>Team access</h2>
          <p className="muted">Add teammates to this workspace. Share their temporary password privately; they can use email recovery to choose a new one.</p>
          <form className="staff-form" onSubmit={addStaffUser}>
            <label className="settings-field">Email<input type="email" required value={staffForm.email} onChange={event => setStaffForm({ ...staffForm, email: event.target.value })} /></label>
            <label className="settings-field">Temporary password<input type="password" required minLength="10" value={staffForm.password} onChange={event => setStaffForm({ ...staffForm, password: event.target.value })} /></label>
            <label className="settings-field">Role
              <select value={staffForm.role} onChange={event => setStaffForm({ ...staffForm, role: event.target.value })}>
                <option value="agent">Agent</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <button type="submit" className="sound-test">Add teammate</button>
          </form>
          <div className="staff-list">
            {staffUsers.map(user => (
              <div key={user.id}>
                <span>
                  <strong>{user.email}</strong>
                  <small>{user.role}</small>
                </span>
                {user.id !== session.user?.id && <button type="button" className="small-button danger" onClick={() => removeStaffUser(user.id)}>Remove</button>}
              </div>
            ))}
          </div>
          {staffStatus && <p className="settings-status">{staffStatus}</p>}
        </section>

        <section className="ticket-context">
          <h2>Customer</h2>
          {selected ? (
            <div className="detail-list">
              <div><span>X username</span><strong>{selected.x_username || "Not provided"}</strong></div>
              <div><span>Email</span><strong>{selected.email || "Not provided"}</strong></div>
              <div><span>Wallet</span><strong>{selected.wallet || "Not provided"}</strong></div>
              <div><span>Source page</span><strong>{selected.page_url || "Unknown"}</strong></div>
            </div>
          ) : (
            <p className="muted">Customer details appear after you select a ticket.</p>
          )}
        </section>

        <section className="ticket-context">
          <h2>Saved replies</h2><p className="muted">Insert a reply, review it, then send.</p>
          <div className="automation-list">
            {automations.filter(template => !template.autoSend).map(template => (
              <button key={template.id} type="button" disabled={!selectedId} onClick={() => runAutomation(template)}>
                <strong>{template.title}{template.autoSend && <em>Auto-send</em>}</strong>
                <span>{template.body}</span>
              </button>
            ))}
          </div>
        </section>

        <section data-settings="appearance">
          <h2>Appearance</h2>
          <ThemeChooser theme={project.theme} onChange={updateTheme} />
          <label className="settings-field">Brand name<input value={project.theme.brandName} onChange={event => updateTheme({ brandName: event.target.value })} /></label>
          <label className="settings-field">Website URL<input value={project.websiteUrl || ""} onChange={event => setProject({ ...project, websiteUrl: event.target.value })} /></label>
          <label className="settings-field">Greeting<input value={project.theme.greeting} onChange={event => updateTheme({ greeting: event.target.value })} /></label>
          <label className="settings-field">Reply time<input value={project.theme.replyTime} onChange={event => updateTheme({ replyTime: event.target.value })} /></label>

          <div className="theme-grid">
            <label>Accent<input type="color" value={project.theme.accentColor} onChange={event => updateTheme({ accentColor: event.target.value })} /></label>
            <label>Launcher<input type="color" value={project.theme.launcherColor} onChange={event => updateTheme({ launcherColor: event.target.value })} /></label>
            <label>Panel<input type="color" value={project.theme.panelColor} onChange={event => updateTheme({ panelColor: event.target.value })} /></label>
            <label>Text<input type="color" value={project.theme.textColor} onChange={event => updateTheme({ textColor: event.target.value })} /></label>
          </div>

          <button type="button" className="sound-test" onClick={saveProjectSettings}>Save settings</button>
          {settingsStatus && <p className="settings-status">{settingsStatus}</p>}

        </section>
        <section data-settings="replies">
          <div className="automation-editor">
            <div className="settings-heading-row">
              <h3>Saved replies &amp; automations</h3>
              <button type="button" className="small-button" onClick={() => setAutomations(current => [...current, { id: `custom-${Date.now()}`, title: "New automation", body: "Write the message agents can send here.", autoSend: false }])}>Add</button>
            </div>

            {automations.map(template => (
              <div key={template.id} className="automation-card">
                <label>Title<input value={template.title} onChange={event => updateAutomation(template.id, { title: event.target.value })} /></label>
                <label>Message<textarea value={template.body} onChange={event => updateAutomation(template.id, { body: event.target.value })} /></label>
                <div className="automation-card-actions">
                  <label className="toggle-row">
                    <input type="checkbox" checked={template.autoSend} onChange={event => updateAutomation(template.id, { autoSend: event.target.checked })} />
                    Send when ticket opens
                  </label>
                  {automations.length > 1 && <button type="button" className="small-button danger" onClick={() => setAutomations(current => current.filter(item => item.id !== template.id))}>Remove</button>}
                </div>
              </div>
            ))}

            <button type="button" className="sound-test" onClick={saveAutomations}>Save automations</button>
            {automationStatus && <p className="settings-status">{automationStatus}</p>}
          </div>
        </section>
      </aside>
    </div>
  );
}

function App() {
  if (window.location.pathname === "/admin/reset-password") return <PasswordRecovery api={api} onBack={() => window.location.assign("/admin")} />;
  const isAdmin = window.location.pathname.startsWith("/admin") || window.location.pathname.startsWith("/owner");
  return isAdmin ? <AdminInbox /> : <CustomerWidget />;
}

async function mountApp() {
  const root = createRoot(document.getElementById("root"));
  if (!window.location.pathname.startsWith("/admin") && !window.location.pathname.startsWith("/owner") && !import.meta.env.VITE_WIDGET_KEY) {
    root.render(<AppearanceProvider><MarketingPage /></AppearanceProvider>);
    try {
      const support = await api("/api/public/widget");
      WIDGET_KEY = support.widgetKey;
      CUSTOMER_TICKET_IDS_KEY = `support-customer-ticket-ids:${WIDGET_KEY}`;
    } catch { root.render(<AppearanceProvider><MarketingPage /></AppearanceProvider>); return; }
  }
  root.render(<AppearanceProvider><App /></AppearanceProvider>);
}
void mountApp();
