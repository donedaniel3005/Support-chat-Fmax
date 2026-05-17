import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import supportAiHero from "./assets/support-ai-hero.png";
import "./styles.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
const WIDGET_KEY = import.meta.env.VITE_WIDGET_KEY || "demo_widget_key";
const AUTH_KEY = "support-admin-token";
const CUSTOMER_TICKET_IDS_KEY = `support-customer-ticket-ids:${WIDGET_KEY}`;
const PRODUCT_NAME = "24/7Support";

const socket = io(API_URL);

const statusOptions = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "pending", label: "Pending" },
  { value: "closed", label: "Closed" }
];

const marketingFeatures = [
  {
    title: "Embeddable live chat",
    body: "Drop one script into any website and launch a branded support widget connected to the right project."
  },
  {
    title: "Secure staff dashboard",
    body: "Protect customer conversations with staff login, project isolation, ticket status, and reply workflows."
  },
  {
    title: "AI-assisted replies",
    body: "Draft helpful responses from the conversation context, then let your team review and send."
  },
  {
    title: "Theme control",
    body: "Each client can customize brand name, colors, greeting text, launcher color, and widget feel."
  },
  {
    title: "Automation templates",
    body: "Save reusable support replies and auto-send the first response when a customer opens a ticket."
  },
  {
    title: "Self-host ready",
    body: "Install on a VPS, connect your database, set environment variables, and run it under your own domain."
  }
];

const setupSteps = [
  "Install 24/7Support on your server or local machine.",
  "Create a project for each company, product, or client website.",
  "Copy the widget script and paste it before the closing body tag.",
  "Invite support staff, customize the theme, and start replying."
];

const platformStats = [
  { value: "1 script", label: "to install the widget" },
  { value: "Multi-client", label: "project isolation" },
  { value: "AI drafts", label: "for faster replies" }
];

const fallbackProject = {
  name: "FMAX",
  widgetKey: WIDGET_KEY,
  websiteUrl: "http://localhost:5173",
  aiEnabled: true,
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
  if (!res.ok) throw data;
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

function MarketingHome() {
  const leadFeatures = marketingFeatures.slice(0, 4);

  return (
    <main className="marketing-page">
      <section className="marketing-hero">
        <nav className="marketing-nav" aria-label="Marketing">
          <strong>{PRODUCT_NAME}</strong>
          <div>
            <a href="#features">Features</a>
            <a href="#getting-started">Get started</a>
            <a href="/admin">Admin</a>
          </div>
        </nav>

        <div className="hero-grid">
          <div className="hero-copy">
            <span className="eyebrow">Features first support software</span>
            <h1>{PRODUCT_NAME} helps teams support every client from one place.</h1>
            <p>Launch branded chat widgets, protect admin access, draft faster replies with AI, and give every company its own project, key, theme, and inbox.</p>

            <div className="hero-actions">
              <a className="primary-link" href="/admin">Open admin</a>
              <a className="secondary-link" href="#getting-started">See setup</a>
            </div>

            <div className="lead-feature-grid" aria-label="Top features">
              {leadFeatures.map(feature => (
                <article key={feature.title}>
                  <strong>{feature.title}</strong>
                  <span>{feature.body}</span>
                </article>
              ))}
            </div>

            <div className="hero-code">
              <span>Widget install</span>
              <code>{`<script src="${API_URL}/widget.js" data-key="${WIDGET_KEY}"></script>`}</code>
            </div>
          </div>

          <div className="product-preview" aria-label="Product preview">
            <img src={supportAiHero} alt="AI-powered support dashboard illustration" />
            <div className="image-badge">
              <strong>AI + human support</strong>
              <span>Live chat, project keys, secure admin, and client themes.</span>
            </div>
          </div>
        </div>
      </section>

      <section className="stat-strip" aria-label="Platform highlights">
        {platformStats.map(stat => (
          <div key={stat.label}>
            <strong>{stat.value}</strong>
            <span>{stat.label}</span>
          </div>
        ))}
      </section>

      <section id="features" className="marketing-section">
        <div className="section-heading">
          <span className="eyebrow">Features</span>
          <h2>A complete support stack companies can download and own.</h2>
          <p>Built for agencies, SaaS teams, crypto projects, ecommerce stores, and service companies that want ownership of their customer support stack.</p>
        </div>

        <div className="feature-grid">
          {marketingFeatures.map(feature => (
            <article key={feature.title} className="feature-card">
              <span aria-hidden="true" />
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="getting-started" className="marketing-section setup-section">
        <div className="section-heading">
          <span className="eyebrow">Get started</span>
          <h2>From install to live widget in four steps.</h2>
        </div>

        <div className="setup-list">
          {setupSteps.map((step, index) => (
            <article key={step}>
              <span>{index + 1}</span>
              <p>{step}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-section audience-section">
        <div>
          <span className="eyebrow">Built for operators</span>
          <h2>Own the customer experience instead of renting it.</h2>
        </div>
        <p>24/7Support is designed as software companies can download, deploy, theme, and run themselves. Each project gets its own widget key, settings, conversations, automations, and customer data.</p>
      </section>

      <section className="final-cta">
        <span className="eyebrow">Ready to test it?</span>
        <h2>Open the support bubble or sign in to the admin dashboard.</h2>
        <div className="hero-actions">
          <a className="primary-link" href="/admin">Open admin</a>
          <button type="button" className="secondary-link" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>Back to top</button>
        </div>
      </section>
    </main>
  );
}

function CustomerWidget() {
  const [open, setOpen] = useState(false);
  const [activeWidgetView, setActiveWidgetView] = useState("new-ticket");
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
  const widgetBrandName = PRODUCT_NAME;

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
      saveCustomerTicketIds(tickets.map(ticket => ticket.id));
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

    ticketIds.forEach(ticketId => socket.emit("conversation:join", ticketId));

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

    socket.emit("conversation:join", conversation.id);

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
    if ((!reply.trim() && replyAttachments.length === 0) || !conversation?.id) return;

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
  }

  async function selectCustomerTicket(ticketId) {
    const data = await widgetApi(`/api/conversations/${ticketId}`);
    setConversation(data);
    setMessages(data.messages || []);
    setActiveWidgetView("inbox");
    setCustomerTickets(previousTickets => previousTickets.map(ticket => ticket.id === data.id ? data : ticket));
  }

  return (
    <>
      <MarketingHome />

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
            <div className="support-title-row">
              <span className="support-brand-glyph" aria-hidden="true"><SupportMark /></span>
              <div>
                <strong>{widgetBrandName}</strong>
                <small>{theme.replyTime}</small>
              </div>
            </div>
            <button type="button" aria-label="Close chat" onClick={() => setOpen(false)}>x</button>
          </div>

          <div className="widget-tabs" aria-label="Support widget sections">
            <button type="button" className={activeWidgetView === "new-ticket" ? "active" : ""} onClick={() => setActiveWidgetView("new-ticket")}>
              New Ticket
            </button>
            <button type="button" className={activeWidgetView === "inbox" ? "active" : ""} onClick={() => { setActiveWidgetView("inbox"); setConversation(null); }}>
              Inbox
            </button>
          </div>

          {activeWidgetView === "new-ticket" ? (
            <form className="chat-form" onSubmit={startConversation}>
              <div className="chat-intro">
                <strong>{theme.greeting}</strong>
                <p>Send your details and support will reply in this secure thread.</p>
              </div>

              <label>Name<input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
              <label>Email<input type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label>
              <label>X username<input required placeholder="@yourhandle" value={form.xUsername} onChange={event => setForm({ ...form, xUsername: event.target.value })} /></label>
              <label>Wallet or order reference<input value={form.wallet} onChange={event => setForm({ ...form, wallet: event.target.value })} /></label>
              <label>Screenshot link<input type="url" placeholder="https://..." value={form.screenshotUrl} onChange={event => setForm({ ...form, screenshotUrl: event.target.value })} /></label>
              <AttachmentPicker attachments={ticketAttachments} onChange={setTicketAttachments} label="Attach screenshots" />
              <label>Message<textarea required value={form.firstMessage} onChange={event => setForm({ ...form, firstMessage: event.target.value })} /></label>

              {error && <p className="form-error">{error}</p>}
              <button type="submit" disabled={isSubmitting}>{isSubmitting ? "Opening ticket..." : "Start chat"}</button>
            </form>
          ) : conversation ? (
            <>
              <div className="ticket-summary">
                <button type="button" className="thread-back" onClick={() => setConversation(null)}>Tickets</button>
                <strong>{conversation.status || "open"}</strong>
                <span>{conversation.x_username || normalizeXUsername(form.xUsername)}</span>
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
              <div className="ticket-list-header">
                <strong>Your tickets</strong>
                <span>{isLoadingTickets ? "Loading..." : `${customerTickets.length} saved`}</span>
              </div>

              {customerTickets.map(ticket => (
                <button key={ticket.id} type="button" className="customer-ticket-card" onClick={() => selectCustomerTicket(ticket.id)}>
                  <span className={`ticket-card-status ${ticket.status || "open"}`}>{ticket.status || "open"}</span>
                  <strong>{ticket.x_username || ticket.name || "Support ticket"}</strong>
                  <small>{formatTime(ticket.updated_at || ticket.created_at)}</small>
                  <p>{getTicketPreview(ticket)}</p>
                </button>
              ))}
            </div>
          ) : (
            <div className="inbox-empty">
              <strong>No tickets yet</strong>
              <p>Open a new ticket and replies from support will appear here.</p>
              <button type="button" onClick={() => setActiveWidgetView("new-ticket")}>New Ticket</button>
            </div>
          )}
        </div>
      )}

      <button
        className={`launcher ${open ? "open" : ""}`}
        style={{ background: theme.launcherColor || theme.accentColor }}
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
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("admin12345");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
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

  return (
    <main className="login-shell">
      <form className="login-panel" onSubmit={submit}>
        <span className="eyebrow">Secure admin</span>
        <h1>Sign in to {PRODUCT_NAME}</h1>
        <p>Use your staff account to manage conversations, themes, widget keys, and AI replies.</p>
        <label>Email<input type="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} /></label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" disabled={loading}>{loading ? "Signing in..." : "Sign in"}</button>
      </form>
    </main>
  );
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
  const [automations, setAutomations] = useState([]);
  const [automationStatus, setAutomationStatus] = useState("");
  const [settingsStatus, setSettingsStatus] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [aiDraftStatus, setAiDraftStatus] = useState("");
  const soundContextRef = useRef(null);

  const hydrateSession = useCallback(async activeToken => {
    const data = await api("/api/auth/me", {}, activeToken);
    setSession(data);
    setProject({ ...fallbackProject, ...data.project, theme: { ...fallbackProject.theme, ...data.project.theme } });
    socket.emit("project:join", data.project.id);
  }, []);

  const loadConversations = useCallback(async () => {
    if (!token) return;
    const url = statusFilter ? `/api/conversations?status=${statusFilter}` : "/api/conversations";
    setConversations(await api(url, {}, token));
  }, [statusFilter, token]);

  const loadAutomations = useCallback(async () => {
    if (!token) return;
    setAutomations(await api("/api/automations", {}, token));
  }, [token]);

  const loadConversation = useCallback(async id => {
    setIsLoading(true);
    try {
      const data = await api(`/api/conversations/${id}`, {}, token);
      setSelected(data);
      setSelectedId(id);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    hydrateSession(token).catch(() => {
      localStorage.removeItem(AUTH_KEY);
      setToken("");
    });
  }, [hydrateSession, token]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    loadAutomations();
  }, [loadAutomations]);

  const playPopSound = useCallback((force = false) => {
    if (!force) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      if (!soundContextRef.current) soundContextRef.current = new AudioContext();
      const context = soundContextRef.current;
      const startAt = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(520, startAt);
      oscillator.frequency.exponentialRampToValueAtTime(920, startAt + 0.06);
      gain.gain.setValueAtTime(0.001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.18, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.2);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.22);
    } catch {
      // Browsers can block audio until the admin interacts with the page.
    }
  }, []);

  useEffect(() => {
    const handleNewConversation = conversation => {
      loadConversations();
      playPopSound(true);
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
  }, [loadConversations, loadConversation, playPopSound, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    socket.emit("conversation:join", selectedId);

    const onNewMessage = message => {
      if (message.conversation_id !== selectedId) return;
      setSelected(previousConversation => {
        if (!previousConversation) return previousConversation;
        const alreadyAdded = previousConversation.messages.some(existingMessage => existingMessage.id === message.id);
        return alreadyAdded ? previousConversation : { ...previousConversation, messages: [...previousConversation.messages, message] };
      });
      if (message.sender_type === "user") playPopSound(true);
    };

    socket.on("message:new", onNewMessage);
    return () => {
      socket.emit("conversation:leave", selectedId);
      socket.off("message:new", onNewMessage);
    };
  }, [playPopSound, selectedId]);

  function handleLogin(nextSession) {
    setToken(nextSession.token);
    setSession(nextSession);
    setProject({ ...fallbackProject, ...nextSession.project, theme: { ...fallbackProject.theme, ...nextSession.project.theme } });
    socket.emit("project:join", nextSession.project.id);
  }

  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST", body: "{}" }, token);
    } finally {
      localStorage.removeItem(AUTH_KEY);
      setToken("");
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
    const sent = await sendAgentMessage(reply, replyAttachments);
    if (sent) {
      setReply("");
      setReplyAttachments([]);
    }
  }

  async function updateStatus(status) {
    if (!selectedId) return;
    setSelected(await api(`/api/conversations/${selectedId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    }, token));
  }

  async function runAutomation(template) {
    const sent = await sendAgentMessage(template.body);
    if (sent) setReply("");
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

  async function draftAiReply() {
    if (!selectedId) return;
    setAiDraftStatus("Drafting...");
    try {
      const data = await api(`/api/conversations/${selectedId}/ai-draft`, { method: "POST", body: "{}" }, token);
      setReply(data.draft);
      setAiDraftStatus(data.provider === "openai" ? "Drafted with OpenAI" : "Drafted with local rules");
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

  if (!token || !session) return <LoginScreen onLogin={handleLogin} />;

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span className="brand-glyph">{project.theme?.brandName?.[0] || "S"}</span>
          <div>
            <strong>{project.theme?.brandName || project.name}</strong>
            <small>{session.user?.email}</small>
          </div>
        </div>

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

        <div className="conversation-list">
          {conversations.length === 0 && <p className="empty-list">No tickets in this view.</p>}
          {conversations.map(conversation => (
            <button key={conversation.id} type="button" className={selectedId === conversation.id ? "active convo" : "convo"} onClick={() => loadConversation(conversation.id)}>
              <span className={`status-dot ${conversation.status}`} />
              <strong>{conversation.x_username || conversation.name || "Unknown customer"}</strong>
              <small>{conversation.status} - {formatTime(conversation.updated_at)}</small>
              <p>{conversation.last_message || "No messages yet"}</p>
            </button>
          ))}
        </div>
      </aside>

      <main className="thread-panel">
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
                <p>{selected.email || "No email"} - {selected.wallet || "No wallet or order ref"}</p>
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
                <textarea placeholder="Reply as support..." value={reply} onChange={event => setReply(event.target.value)} />
                <AttachmentPicker attachments={replyAttachments} onChange={setReplyAttachments} label="Add image" />
                {aiDraftStatus && <p className="settings-status">{aiDraftStatus}</p>}
              </div>
              <div className="reply-actions">
                <button type="button" className="secondary-action" onClick={draftAiReply}>AI draft</button>
                <button type="submit">Send reply</button>
              </div>
            </form>
          </>
        )}
      </main>

      <aside className="detail-panel">
        <section>
          <div className="settings-heading-row">
            <h2>Project</h2>
            <button type="button" className="small-button" onClick={logout}>Log out</button>
          </div>

          <div className="detail-list">
            <div><span>Project name</span><strong>{project.name}</strong></div>
            <div><span>Widget key</span><strong>{project.widgetKey}</strong></div>
            <div><span>Install script</span><code>{`<script src="${API_URL}/widget.js" data-key="${project.widgetKey}"></script>`}</code></div>
          </div>
          <button type="button" className="sound-test" onClick={rotateWidgetKey}>Rotate widget key</button>
        </section>

        <section>
          <h2>Customer</h2>
          {selected ? (
            <div className="detail-list">
              <div><span>X username</span><strong>{selected.x_username || "Not provided"}</strong></div>
              <div><span>Email</span><strong>{selected.email || "Not provided"}</strong></div>
              <div><span>Wallet / order</span><strong>{selected.wallet || "Not provided"}</strong></div>
              <div><span>Source page</span><strong>{selected.page_url || "Unknown"}</strong></div>
            </div>
          ) : (
            <p className="muted">Customer details appear after you select a ticket.</p>
          )}
        </section>

        <section>
          <h2>Automations</h2>
          <div className="automation-list">
            {automations.map(template => (
              <button key={template.id} type="button" disabled={!selectedId} onClick={() => runAutomation(template)}>
                <strong>{template.title}{template.autoSend && <em>Auto-send</em>}</strong>
                <span>{template.body}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2>Theme settings</h2>
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

          <label className="toggle-row">
            <input type="checkbox" checked={project.aiEnabled} onChange={event => setProject({ ...project, aiEnabled: event.target.checked })} />
            AI support replies
          </label>

          <button type="button" className="sound-test" onClick={saveProjectSettings}>Save settings</button>
          {settingsStatus && <p className="settings-status">{settingsStatus}</p>}

          <div className="automation-editor">
            <div className="settings-heading-row">
              <h3>Automation templates</h3>
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
  const isAdmin = window.location.pathname.startsWith("/admin");
  return isAdmin ? <AdminInbox /> : <CustomerWidget />;
}

createRoot(document.getElementById("root")).render(<App />);
