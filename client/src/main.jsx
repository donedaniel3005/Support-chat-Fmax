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
const CONTACT_EMAIL = "danielkariuki3005@gmail.com";

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
  {
    title: "Download the project",
    body: "Clone the GitHub repo or download the ZIP, then open the project folder on your machine or server.",
    code: "git clone https://github.com/donedaniel3005/Support-chat-Fmax.git",
    link: "https://github.com/donedaniel3005/Support-chat-Fmax"
  },
  {
    title: "Install and build",
    body: "Install the backend and frontend packages, then create a production build.",
    code: "cd Support-chat-Fmax\nnpm run install:all\nnpm run build"
  },
  {
    title: "Create your environment file",
    body: "Copy the example env file, set your admin login, and add your live frontend URL.",
    code: "cp .env.example .env\nADMIN_EMAIL=you@company.com\nADMIN_PASSWORD=use-a-strong-password"
  },
  {
    title: "Start the support server",
    body: "Run the Node server locally, on a VPS, or on a backend host like Render or Railway.",
    code: "npm start"
  },
  {
    title: "Install the widget on a website",
    body: "Copy the widget script from Admin and paste it before the closing body tag on the client website.",
    code: `<script src="${API_URL}/widget.js" data-key="${WIDGET_KEY}"></script>`
  },
  {
    title: "Customize and invite staff",
    body: "Open Admin, set the theme, update automations, rotate widget keys when needed, and start replying."
  }
];

const platformStats = [
  { value: "1 script", label: "to install the widget" },
  { value: "Multi-client", label: "project isolation" },
  { value: "AI drafts", label: "for faster replies" }
];

const pricingPlans = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    cadence: "while testing",
    description: "For small teams validating the widget before launch.",
    features: ["1 website", "1 staff seat", "50 conversations/month", "Automated request review"]
  },
  {
    id: "starter",
    name: "Starter",
    price: "$9",
    cadence: "per month",
    description: "Affordable live support for a solo operator or small business.",
    features: ["1 website", "3 staff seats", "500 conversations/month", "Widget customization"]
  },
  {
    id: "growth",
    name: "Growth",
    price: "$19",
    cadence: "per month",
    description: "For teams with steady customer volume and shared inbox needs.",
    features: ["3 websites", "8 staff seats", "2,000 conversations/month", "AI drafts and automations"]
  },
  {
    id: "partner",
    name: "Partner",
    price: "$39",
    cadence: "per month",
    description: "For agencies or operators managing multiple client sites.",
    features: ["10 websites", "20 staff seats", "10,000 conversations/month", "Priority setup support"]
  }
];

const billingStatuses = [
  { value: "owner_approved", label: "Owner approved" },
  { value: "pending_approval", label: "Pending approval" },
  { value: "paused", label: "Paused" }
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

function MarketingHome() {
  const leadFeatures = marketingFeatures.slice(0, 4);
  const [selectedPlan, setSelectedPlan] = useState("starter");
  const [planRequest, setPlanRequest] = useState({
    companyName: "",
    contactEmail: "",
    websiteUrl: "",
    notes: ""
  });
  const [planRequestStatus, setPlanRequestStatus] = useState("");

  async function submitPlanRequest(event) {
    event.preventDefault();
    setPlanRequestStatus("Submitting request...");

    try {
      await api("/api/billing/requests", {
        method: "POST",
        body: JSON.stringify({ ...planRequest, plan: selectedPlan })
      });
      setPlanRequest({ companyName: "", contactEmail: "", websiteUrl: "", notes: "" });
      setPlanRequestStatus("Request sent. The team will review it from the admin workspace.");
    } catch (err) {
      setPlanRequestStatus(err.error || "Could not send plan request.");
    }
  }

  return (
    <main className="marketing-page">
      <section className="marketing-hero">
        <nav className="marketing-nav" aria-label="Marketing">
          <strong>{PRODUCT_NAME}</strong>
          <div>
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
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
              <a className="secondary-link" href="#pricing">See pricing</a>
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

      <section id="pricing" className="marketing-section pricing-section">
        <div className="section-heading">
          <span className="eyebrow">Pricing</span>
          <h2>Affordable plans that can start free while clients test.</h2>
          <p>Pick a plan and submit a request. The team reviews requests in the admin workspace and the backend automatically enforces each plan's limits.</p>
        </div>

        <div className="pricing-grid">
          {pricingPlans.map(plan => (
            <article key={plan.id} className={plan.id === "starter" ? "pricing-card highlighted" : "pricing-card"}>
              <div>
                <h3>{plan.name}</h3>
                <p>{plan.description}</p>
              </div>
              <div className="price-row">
                <strong>{plan.price}</strong>
                <span>{plan.cadence}</span>
              </div>
              <ul>
                {plan.features.map(feature => <li key={feature}>{feature}</li>)}
              </ul>
              <button type="button" onClick={() => setSelectedPlan(plan.id)}>Request {plan.name}</button>
            </article>
          ))}
        </div>

        <form className="plan-request-form" onSubmit={submitPlanRequest}>
          <div>
            <span className="eyebrow">Plan request</span>
            <h3>Request {pricingPlans.find(plan => plan.id === selectedPlan)?.name || "a plan"}</h3>
            <p>Requests go straight into the admin review queue. The team can approve, reject, or follow up by email.</p>
          </div>

          <label>Plan
            <select value={selectedPlan} onChange={event => setSelectedPlan(event.target.value)}>
              {pricingPlans.map(plan => <option key={plan.id} value={plan.id}>{plan.name} - {plan.price}</option>)}
            </select>
          </label>
          <label>Company or project name
            <input required value={planRequest.companyName} onChange={event => setPlanRequest({ ...planRequest, companyName: event.target.value })} />
          </label>
          <label>Email
            <input type="email" required value={planRequest.contactEmail} onChange={event => setPlanRequest({ ...planRequest, contactEmail: event.target.value })} />
          </label>
          <label>Website
            <input type="url" placeholder="https://example.com" value={planRequest.websiteUrl} onChange={event => setPlanRequest({ ...planRequest, websiteUrl: event.target.value })} />
          </label>
          <label>Notes
            <textarea placeholder="Tell us what you need help supporting." value={planRequest.notes} onChange={event => setPlanRequest({ ...planRequest, notes: event.target.value })} />
          </label>
          <button type="submit">Send request</button>
          {planRequestStatus && <p className="pricing-note">{planRequestStatus}</p>}
        </form>

        <p className="pricing-note">Clients can also email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> for setup, upgrades, or billing questions.</p>
      </section>

      <section id="getting-started" className="marketing-section setup-section">
        <div className="section-heading">
          <span className="eyebrow">Get started</span>
          <h2>From download to live widget, step by step.</h2>
          <p>Install 24/7Support yourself, deploy the backend, then paste one widget script into any company website.</p>
          <div className="setup-actions">
            <a className="primary-link" href="https://github.com/donedaniel3005/Support-chat-Fmax" target="_blank" rel="noreferrer">Download from GitHub</a>
            <a className="secondary-link" href="/admin">Open admin</a>
          </div>
        </div>

        <div className="setup-list">
          {setupSteps.map((step, index) => (
            <article key={step.title}>
              <span>{index + 1}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
                {step.code && <code>{step.code}</code>}
                {step.link && <a href={step.link} target="_blank" rel="noreferrer">Open repository</a>}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-section audience-section">
        <div>
          <span className="eyebrow">Team access</span>
          <h2>Intercom-style admin access starts with invited teammates.</h2>
        </div>
        <p>In tools like Intercom, the company owner signs up, then invites teammates by email and assigns roles. This MVP now supports that core flow from Admin: add approved staff emails, give them a temporary password, and remove access when needed.</p>
      </section>

      <section className="final-cta">
        <span className="eyebrow">Ready to test it?</span>
        <h2>Open the support bubble, request a plan, or sign in to the admin dashboard.</h2>
        <div className="hero-actions">
          <a className="primary-link" href="/admin">Open admin</a>
          <a className="secondary-link" href={`mailto:${CONTACT_EMAIL}`}>Email creator</a>
          <button type="button" className="secondary-link" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>Back to top</button>
        </div>
      </section>
    </main>
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

  function openWidgetView(view) {
    setActiveWidgetView(view);
    if (view !== "inbox") setConversation(null);
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
        <div className="login-brand-row">
          <span className="brand-glyph">S</span>
          <div>
            <strong>{PRODUCT_NAME}</strong>
            <small>Admin workspace</small>
          </div>
        </div>
        <span className="eyebrow">Secure team sign-in</span>
        <h1>Sign in to {PRODUCT_NAME}</h1>
        <p>Use an approved staff account. Account owners add teammates by email from Admin, similar to Intercom-style workspace invites.</p>
        <label>Email<input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" disabled={loading}>{loading ? "Signing in..." : "Sign in"}</button>
        <p className="login-help">Need access or free-tier approval? Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
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
  const [staffUsers, setStaffUsers] = useState([]);
  const [staffForm, setStaffForm] = useState({ email: "", password: "", role: "agent" });
  const [staffStatus, setStaffStatus] = useState("");
  const [planRequests, setPlanRequests] = useState([]);
  const [planRequestAdminStatus, setPlanRequestAdminStatus] = useState("");
  const [billingStatus, setBillingStatus] = useState("");
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

  const loadStaffUsers = useCallback(async () => {
    if (!token) return;
    setStaffUsers(await api("/api/staff", {}, token));
  }, [token]);

  const loadPlanRequests = useCallback(async () => {
    if (!token || !session?.user?.isOwner) return;
    setPlanRequests(await api("/api/billing/requests?status=pending", {}, token));
  }, [session?.user?.isOwner, token]);

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

  useEffect(() => {
    loadStaffUsers();
  }, [loadStaffUsers]);

  useEffect(() => {
    loadPlanRequests();
  }, [loadPlanRequests]);

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

  async function saveBilling(nextProject = project) {
    setBillingStatus("Saving...");
    try {
      const data = await api("/api/projects/current/billing", {
        method: "PATCH",
        body: JSON.stringify({
          plan: nextProject.plan,
          billingStatus: nextProject.billingStatus
        })
      }, token);
      setProject({ ...fallbackProject, ...data, theme: { ...fallbackProject.theme, ...data.theme } });
      setBillingStatus("Saved");
    } catch (err) {
      setBillingStatus(err.error || "Could not save billing.");
    }
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

  async function reviewPlanRequest(requestId, action) {
    setPlanRequestAdminStatus(action === "approve" ? "Approving request..." : "Rejecting request...");
    try {
      await api(`/api/billing/requests/${requestId}`, {
        method: "PATCH",
        body: JSON.stringify({ action })
      }, token);
      await loadPlanRequests();
      if (action === "approve") {
        const data = await api("/api/projects/current", {}, token);
        setProject({ ...fallbackProject, ...data, theme: { ...fallbackProject.theme, ...data.theme } });
      }
      setPlanRequestAdminStatus(action === "approve" ? "Request approved and plan updated." : "Request rejected.");
    } catch (err) {
      setPlanRequestAdminStatus(err.error || "Could not review request.");
    }
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

  function updateProjectPlan(updates) {
    setProject(current => ({ ...current, ...updates }));
    setBillingStatus("");
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
            <div><span>Plan</span><strong>{project.plan} - {String(project.billingStatus || "").replace("_", " ")}</strong></div>
            <div><span>Widget key</span><strong>{project.widgetKey}</strong></div>
            <div><span>Install script</span><code>{`<script src="${API_URL}/widget.js" data-key="${project.widgetKey}"></script>`}</code></div>
          </div>
          <button type="button" className="sound-test" onClick={rotateWidgetKey}>Rotate widget key</button>
        </section>

        <section>
          <h2>Plan approval</h2>
          <p className="muted">Review incoming pricing requests here. Approved requests update the active workspace plan and unlock the backend limits for that tier.</p>
          <label className="settings-field">Plan
            <select value={project.plan || "free"} onChange={event => updateProjectPlan({ plan: event.target.value })}>
              {pricingPlans.map(plan => <option key={plan.id} value={plan.id}>{plan.name} - {plan.price}</option>)}
            </select>
          </label>
          <label className="settings-field">Access status
            <select value={project.billingStatus || "owner_approved"} onChange={event => updateProjectPlan({ billingStatus: event.target.value })}>
              {billingStatuses.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}
            </select>
          </label>
          <button type="button" className="sound-test" disabled={!session.user?.isOwner} onClick={() => saveBilling()}>Approve plan</button>
          {!session.user?.isOwner && <p className="settings-status">Only the owner account can approve billing changes.</p>}
          {billingStatus && <p className="settings-status">{billingStatus}</p>}

          {session.user?.isOwner && (
            <div className="request-review-list">
              <div className="settings-heading-row">
                <h3>Pending requests</h3>
                <button type="button" className="small-button" onClick={loadPlanRequests}>Refresh</button>
              </div>
              {planRequests.length === 0 && <p className="muted">No pending requests.</p>}
              {planRequests.map(request => (
                <article key={request.id}>
                  <div>
                    <strong>{request.companyName}</strong>
                    <span>{request.planName} - {request.contactEmail}</span>
                    {request.websiteUrl && <a href={request.websiteUrl} target="_blank" rel="noreferrer">{request.websiteUrl}</a>}
                    {request.notes && <p>{request.notes}</p>}
                  </div>
                  <div>
                    <button type="button" className="small-button" onClick={() => reviewPlanRequest(request.id, "approve")}>Approve</button>
                    <button type="button" className="small-button danger" onClick={() => reviewPlanRequest(request.id, "reject")}>Reject</button>
                  </div>
                </article>
              ))}
              {planRequestAdminStatus && <p className="settings-status">{planRequestAdminStatus}</p>}
            </div>
          )}
        </section>

        <section>
          <h2>Team access</h2>
          <p className="muted">Owners usually invite teammates by email. For this MVP, add their email with a temporary password.</p>
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

        <section>
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
