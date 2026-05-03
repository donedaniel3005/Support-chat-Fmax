import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import "./styles.css";

const API_URL = (import.meta.env.VITE_API_URL || "import.meta.env.VITE_API_URL").replace(/\/$/, "");
const socket = io(API_URL);

const statusOptions = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "pending", label: "Pending" },
  { value: "closed", label: "Closed" }
];

const fallbackAutomations = [
  {
    id: "welcome",
    title: "Welcome auto-reply",
    body: "Thanks for reaching out. We typically reply in a few hours. Please share any more info or relevant screenshots that can help us assist you better.",
    autoSend: true
  },
  {
    id: "details",
    title: "Request info",
    body: "Thanks for reaching out. Please share your X username, the package or order you selected, and the exact issue you are seeing so we can check it quickly.",
    autoSend: false
  },
  {
    id: "screenshot",
    title: "Ask for screenshots",
    body: "Could you send a relevant screenshot or screen recording of what you are seeing? Please hide any private keys, seed phrases, or sensitive payment details before sharing.",
    autoSend: false
  },
  {
    id: "payment",
    title: "Payment check",
    body: "Please share your payment transaction hash or USDC transfer reference, plus the wallet you paid from, so we can match it to your order.",
    autoSend: false
  },
  {
    id: "eta",
    title: "Set ETA",
    body: "We are checking this now. If everything matches, we will update you with the next step and timing shortly.",
    autoSend: false
  }
];

const defaultSettings = {
  agentName: "FMAX Support",
  soundEnabled: true,
  autoOpenNew: false
};

const CUSTOMER_TICKET_IDS_KEY = "support-customer-ticket-ids";

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

function loadAdminSettings() {
  try {
    const stored = localStorage.getItem("support-admin-settings");
    return stored ? { ...defaultSettings, ...JSON.parse(stored) } : defaultSettings;
  } catch {
    return defaultSettings;
  }
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

function CustomerWidget() {
  const [open, setOpen] = useState(false);
  const [activeWidgetView, setActiveWidgetView] = useState("new-ticket");
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

  const loadCustomerTickets = useCallback(async () => {
    const ids = loadCustomerTicketIds();
    if (ids.length === 0) {
      setCustomerTickets([]);
      return;
    }

    setIsLoadingTickets(true);

    try {
      const results = await Promise.all(ids.map(async id => {
        const res = await fetch(`${API_URL}/api/conversations/${id}`);
        return res.ok ? res.json() : null;
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
      const res = await fetch(`${API_URL}/api/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          xUsername: normalizeXUsername(form.xUsername),
          attachments: ticketAttachments,
          pageUrl: window.location.href,
          userAgent: navigator.userAgent
        })
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Could not start the ticket. Please try again.");
        return;
      }

      rememberCustomerTicket(data.id);
      setConversation(data);
      setMessages(data.messages || []);
      setCustomerTickets(previousTickets => {
        const withoutDuplicate = previousTickets.filter(ticket => ticket.id !== data.id);
        return [data, ...withoutDuplicate];
      });
      setForm(previousForm => ({ ...previousForm, firstMessage: "" }));
      setTicketAttachments([]);
      setActiveWidgetView("inbox");
    } catch {
      setError("Could not reach support right now. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function sendReply(event) {
    event.preventDefault();
    if ((!reply.trim() && replyAttachments.length === 0) || !conversation?.id) return;

    const res = await fetch(`${API_URL}/api/conversations/${conversation.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        senderType: "user",
        senderName: form.name || "Customer",
        body: reply,
        attachments: replyAttachments
      })
    });

    if (res.ok) {
      setReply("");
      setReplyAttachments([]);
    }
  }

  async function selectCustomerTicket(ticketId) {
    const res = await fetch(`${API_URL}/api/conversations/${ticketId}`);
    if (!res.ok) return;

    const data = await res.json();
    setConversation(data);
    setMessages(data.messages || []);
    setActiveWidgetView("inbox");
    setCustomerTickets(previousTickets => previousTickets.map(ticket => (
      ticket.id === data.id ? data : ticket
    )));
  }

  return (
    <>
      <div className="site-shell">
        <div className="widget-preview-mark">
          <span className="brand-glyph">F</span>
          <strong>FMAX Support</strong>
        </div>
      </div>

      {open && (
        <div className="chatbox support-widget" role="dialog" aria-label="Support chat">
          <div className="chat-header">
            <div className="support-title-row">
              <span className="brand-glyph support-brand-glyph" aria-hidden="true">F</span>
              <div>
                <strong>FMAX Support</strong>
                <small>We typically reply in a few hours</small>
              </div>
            </div>
            <button type="button" aria-label="Close chat" onClick={() => setOpen(false)}>x</button>
          </div>

          <div className="widget-tabs" aria-label="Support widget sections">
            <button
              type="button"
              className={activeWidgetView === "new-ticket" ? "active" : ""}
              onClick={() => setActiveWidgetView("new-ticket")}
            >
              New Ticket
            </button>
            <button
              type="button"
              className={activeWidgetView === "inbox" ? "active" : ""}
              onClick={() => {
                setActiveWidgetView("inbox");
                setConversation(null);
              }}
            >
              Inbox
            </button>
          </div>

          {activeWidgetView === "new-ticket" ? (
            <form className="chat-form" onSubmit={startConversation}>
              <div className="chat-intro">
                <strong>Open a ticket</strong>
                <p>Share the X username and anything useful so support can match your order fast.</p>
              </div>

              <label>
                Name
                <input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} />
              </label>

              <label>
                Email
                <input type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} />
              </label>

              <label>
                X username
                <input required placeholder="@yourhandle" value={form.xUsername} onChange={event => setForm({ ...form, xUsername: event.target.value })} />
              </label>

              <label>
                Wallet or order reference
                <input value={form.wallet} onChange={event => setForm({ ...form, wallet: event.target.value })} />
              </label>

              <label>
                Screenshot link
                <input type="url" placeholder="https://..." value={form.screenshotUrl} onChange={event => setForm({ ...form, screenshotUrl: event.target.value })} />
              </label>

              <AttachmentPicker attachments={ticketAttachments} onChange={setTicketAttachments} label="Attach screenshots" />

              <label>
                Message
                <textarea required value={form.firstMessage} onChange={event => setForm({ ...form, firstMessage: event.target.value })} />
              </label>

              {error && <p className="form-error">{error}</p>}

              <button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Opening ticket..." : "Start chat"}
              </button>
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

              {customerTickets.map(ticket => {
                const ticketStatus = ticket.status || "open";

                return (
                  <button key={ticket.id} type="button" className="customer-ticket-card" onClick={() => selectCustomerTicket(ticket.id)}>
                    <span className={`ticket-card-status ${ticketStatus}`}>{ticketStatus}</span>
                    <strong>{ticket.x_username || ticket.name || "Support ticket"}</strong>
                    <small>{formatTime(ticket.updated_at || ticket.created_at)}</small>
                    <p>{getTicketPreview(ticket)}</p>
                  </button>
                );
              })}
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

      <button className={`launcher ${open ? "open" : ""}`} type="button" aria-label={open ? "Close support" : "Open support"} onClick={() => setOpen(previousOpen => !previousOpen)}>
        <span aria-hidden="true" />
      </button>
    </>
  );
}

function AdminInbox() {
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [reply, setReply] = useState("");
  const [replyAttachments, setReplyAttachments] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [settings, setSettings] = useState(loadAdminSettings);
  const [automations, setAutomations] = useState([]);
  const [automationStatus, setAutomationStatus] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const soundContextRef = useRef(null);

  const playPopSound = useCallback((force = false) => {
    if (!force && !settings.soundEnabled) return;

    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;

      if (!soundContextRef.current) {
        soundContextRef.current = new AudioContext();
      }

      const context = soundContextRef.current;
      if (context.state === "suspended") {
        context.resume().catch(() => {});
      }

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
      // Some browsers require a user gesture before audio can play.
    }
  }, [settings.soundEnabled]);

  const loadConversations = useCallback(async () => {
    const url = statusFilter ? `${API_URL}/api/conversations?status=${statusFilter}` : `${API_URL}/api/conversations`;
    const res = await fetch(url);
    setConversations(await res.json());
  }, [statusFilter]);

  const loadAutomations = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/automations`);
      const data = await res.json();
      setAutomations(data.length ? data : fallbackAutomations);
    } catch {
      setAutomations(fallbackAutomations);
    }
  }, []);

  const loadConversation = useCallback(async id => {
    setIsLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/conversations/${id}`);
      const data = await res.json();
      setSelected(data);
      setSelectedId(id);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("support-admin-settings", JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    loadAutomations();
  }, [loadAutomations]);

  useEffect(() => {
    const handleNewConversation = conversation => {
      loadConversations();
      playPopSound();

      if (settings.autoOpenNew && !selectedId) {
        loadConversation(conversation.id);
      }
    };

    const handleUpdatedConversation = conversation => {
      loadConversations();

      if (conversation?.id === selectedId) {
        setSelected(conversation);
      }
    };

    socket.on("conversation:new", handleNewConversation);
    socket.on("conversation:updated", handleUpdatedConversation);

    return () => {
      socket.off("conversation:new", handleNewConversation);
      socket.off("conversation:updated", handleUpdatedConversation);
    };
  }, [loadConversations, loadConversation, playPopSound, selectedId, settings.autoOpenNew]);

  useEffect(() => {
    if (!selectedId) return;

    socket.emit("conversation:join", selectedId);

    return () => {
      socket.emit("conversation:leave", selectedId);
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;

    const onNewMessage = message => {
      if (message.conversation_id !== selectedId) return;

      setSelected(previousConversation => {
        if (!previousConversation) return previousConversation;
        const alreadyAdded = previousConversation.messages.some(existingMessage => existingMessage.id === message.id);
        if (alreadyAdded) return previousConversation;
        return { ...previousConversation, messages: [...previousConversation.messages, message] };
      });

      if (message.sender_type === "user") {
        playPopSound();
      }
    };

    socket.on("message:new", onNewMessage);

    return () => socket.off("message:new", onNewMessage);
  }, [playPopSound, selectedId]);

  async function sendAgentMessage(body, attachments = []) {
    if ((!body.trim() && attachments.length === 0) || !selectedId) return false;

    const res = await fetch(`${API_URL}/api/conversations/${selectedId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        senderType: "agent",
        senderName: settings.agentName.trim() || defaultSettings.agentName,
        body,
        attachments
      })
    });

    return res.ok;
  }

  async function sendAgentReply(event) {
    event.preventDefault();
    const sent = await sendAgentMessage(reply, replyAttachments);
    if (sent) {
      setReply("");
      setReplyAttachments([]);
    }
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

  function addAutomation() {
    setAutomations(currentAutomations => [
      ...currentAutomations,
      {
        id: `custom-${Date.now()}`,
        title: "New automation",
        body: "Write the message agents can send here.",
        autoSend: false
      }
    ]);
    setAutomationStatus("");
  }

  async function saveAutomations() {
    setAutomationStatus("Saving...");

    const res = await fetch(`${API_URL}/api/automations`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ automations })
    });

    const data = await res.json();

    if (!res.ok) {
      setAutomationStatus(data.error || "Could not save automations.");
      return;
    }

    setAutomations(data);
    setAutomationStatus("Saved");
  }

  async function updateStatus(status) {
    if (!selectedId) return;

    const res = await fetch(`${API_URL}/api/conversations/${selectedId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });

    const data = await res.json();
    setSelected(data);
  }

  const stats = useMemo(() => ({
    total: conversations.length,
    open: conversations.filter(conversation => conversation.status === "open").length,
    pending: conversations.filter(conversation => conversation.status === "pending").length,
    closed: conversations.filter(conversation => conversation.status === "closed").length
  }), [conversations]);

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span className="brand-glyph">F</span>
          <div>
            <strong>FMAX Support</strong>
            <small>Agent console</small>
          </div>
        </div>

        <div className="metric-grid">
          <div>
            <span>{stats.total}</span>
            <small>Total</small>
          </div>
          <div>
            <span>{stats.open}</span>
            <small>Open</small>
          </div>
          <div>
            <span>{stats.pending}</span>
            <small>Pending</small>
          </div>
        </div>

        <div className="filter-tabs" role="tablist" aria-label="Conversation filters">
          {statusOptions.map(option => (
            <button
              key={option.value}
              type="button"
              className={statusFilter === option.value ? "active" : ""}
              onClick={() => setStatusFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="conversation-list">
          {conversations.length === 0 && <p className="empty-list">No tickets in this view.</p>}

          {conversations.map(conversation => (
            <button
              key={conversation.id}
              type="button"
              className={selectedId === conversation.id ? "active convo" : "convo"}
              onClick={() => loadConversation(conversation.id)}
            >
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
                  <span>{message.sender_name} - {formatTime(message.created_at)}</span>
                  {message.body && <p>{message.body}</p>}
                  <MessageAttachments attachments={message.attachments} />
                </div>
              ))}
            </div>

            <form className="agent-reply reply-composer" onSubmit={sendAgentReply}>
              <div className="composer-stack">
                <textarea placeholder="Reply as support..." value={reply} onChange={event => setReply(event.target.value)} />
                <AttachmentPicker attachments={replyAttachments} onChange={setReplyAttachments} label="Add image" />
              </div>
              <button type="submit">Send reply</button>
            </form>
          </>
        )}
      </main>

      <aside className="detail-panel">
        <section>
          <h2>Customer</h2>

          {selected ? (
            <div className="detail-list">
              <div>
                <span>X username</span>
                <strong>{selected.x_username || "Not provided"}</strong>
              </div>
              <div>
                <span>Email</span>
                <strong>{selected.email || "Not provided"}</strong>
              </div>
              <div>
                <span>Wallet / order</span>
                <strong>{selected.wallet || "Not provided"}</strong>
              </div>
              <div>
                <span>Source page</span>
                <strong>{selected.page_url || "Unknown"}</strong>
              </div>
              <div>
                <span>Screenshot</span>
                {selected.screenshot_url ? (
                  <a href={selected.screenshot_url} target="_blank" rel="noreferrer">Open link</a>
                ) : (
                  <strong>Not provided</strong>
                )}
              </div>
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
                <strong>
                  {template.title}
                  {template.autoSend && <em>Auto-send</em>}
                </strong>
                <span>{template.body}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2>Settings</h2>

          <label className="settings-field">
            Agent name
            <input value={settings.agentName} onChange={event => setSettings({ ...settings, agentName: event.target.value })} />
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.soundEnabled}
              onChange={event => {
                setSettings({ ...settings, soundEnabled: event.target.checked });
                if (event.target.checked) playPopSound(true);
              }}
            />
            Pop sound
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.autoOpenNew}
              onChange={event => setSettings({ ...settings, autoOpenNew: event.target.checked })}
            />
            Auto-open first new ticket
          </label>

          <button type="button" className="sound-test" onClick={() => playPopSound(true)}>Test sound</button>

          <div className="automation-editor">
            <div className="settings-heading-row">
              <h3>Automation templates</h3>
              <button type="button" className="small-button" onClick={addAutomation}>Add</button>
            </div>

            {automations.map(template => (
              <div key={template.id} className="automation-card">
                <label>
                  Title
                  <input value={template.title} onChange={event => updateAutomation(template.id, { title: event.target.value })} />
                </label>

                <label>
                  Message
                  <textarea value={template.body} onChange={event => updateAutomation(template.id, { body: event.target.value })} />
                </label>

                <div className="automation-card-actions">
                  <label className="toggle-row">
                    <input
                      type="checkbox"
                      checked={template.autoSend}
                      onChange={event => updateAutomation(template.id, { autoSend: event.target.checked })}
                    />
                    Send when ticket opens
                  </label>

                  {automations.length > 1 && (
                    <button
                      type="button"
                      className="small-button danger"
                      onClick={() => setAutomations(currentAutomations => currentAutomations.filter(current => current.id !== template.id))}
                    >
                      Remove
                    </button>
                  )}
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
