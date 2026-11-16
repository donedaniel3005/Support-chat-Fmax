import { useCallback, useEffect, useRef, useState } from "react";

export function useInboxReliability({ api, socket, token, projectId, onSync }) {
  const [connection, setConnection] = useState("Connecting…");
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem("support-sounds") !== "off");
  const [soundStatus, setSoundStatus] = useState("Click Enable & test sound before taking chats.");
  const [desktopStatus, setDesktopStatus] = useState("");
  const audio = useRef(null);
  const sync = useRef(onSync); sync.current = onSync;
  const sound = useRef(soundEnabled); sound.current = soundEnabled;
  const desktop = useRef(false);
  const play = useCallback(async (test = false) => {
    if (!test && !sound.current) return;
    try {
      if (!audio.current && !test) { setSoundStatus("Enable sound to hear incoming messages."); return; }
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) { setSoundStatus("Audio is not supported by this browser."); return; }
      if (!audio.current) audio.current = new Context();
      if (audio.current.state === "suspended") await audio.current.resume();
      if (audio.current.state !== "running") { setSoundStatus("Sound is blocked. Click Enable & test sound."); return; }
      const context = audio.current;
      const oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.frequency.setValueAtTime(660, context.currentTime);
      oscillator.frequency.setValueAtTime(880, context.currentTime + 0.12);
      gain.gain.setValueAtTime(0.15, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.4);
      oscillator.start(); oscillator.stop(context.currentTime + 0.4);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      setSoundStatus("Sound ready. Keep this inbox open and the tab unmuted.");
    } catch { setSoundStatus("Sound could not start. Check browser and system audio settings."); }
  }, []);
  const enableSound = () => { setSoundEnabled(true); sound.current = true; localStorage.setItem("support-sounds", "on"); void play(true); };
  const muteSound = () => { setSoundEnabled(false); localStorage.setItem("support-sounds", "off"); setSoundStatus("Sound muted."); };
  async function enableDesktop() {
    if (!("Notification" in window)) { setDesktopStatus("Desktop notifications aren’t supported here."); return; }
    try {
      const permission = await Notification.requestPermission();
      desktop.current = permission === "granted";
      setDesktopStatus(desktop.current ? "Desktop alerts enabled while this inbox is open." : "Notifications blocked. You can change this in your browser’s site settings.");
    } catch { setDesktopStatus("Could not enable desktop notifications."); }
  }
  useEffect(() => {
    if (!token || !projectId) return;
    let stopped = false, inFlight = false, cursor;
    const seen = new Set();
    const notify = message => {
      if (message.sender_type !== "user" || seen.has(message.id)) return;
      seen.add(message.id);
      if (seen.size > 2000) seen.delete(seen.values().next().value);
      void play();
      if (document.hidden && desktop.current && "Notification" in window && Notification.permission === "granted") {
        const notice = new Notification("New support message", { body: "A customer is waiting in your support inbox.", tag: message.conversation_id });
        notice.onclick = () => { window.focus(); notice.close(); };
      }
    };
    async function refresh() {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        let more;
        do {
          const data = await api(`/api/inbox/activity${cursor === undefined ? "" : `?after=${cursor}`}`, {}, token);
          if (stopped) return;
          if (cursor !== undefined) data.messages.forEach(notify);
          document.title = data.unread ? `(${data.unread}) Support inbox` : "Support inbox";
          cursor = data.cursor; more = data.more;
        } while (more && !stopped);
        setConnection(socket.connected ? "Live" : "Connected via automatic refresh");
        await sync.current();
      } catch (err) { if (!stopped) setConnection(err.error?.includes("login") ? "Session expired. Sign in again." : "Offline — retrying automatically"); }
      finally { inFlight = false; }
    }
    const join = () => {
      socket.emit("project:join", { projectId, token }, ack => {
        if (stopped) return;
        if (ack?.error) setConnection("Session expired. Sign in again."); else void refresh();
      });
    };
    const message = value => { notify(value); void refresh(); };
    const disconnected = () => { if (!stopped) setConnection("Reconnecting — automatic refresh active"); };
    const visible = () => { if (!document.hidden) void refresh(); };
    socket.on("connect", join); socket.on("disconnect", disconnected); socket.on("inbox:message", message);
    window.addEventListener("online", refresh); window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", visible);
    if (socket.connected) join();
    void refresh();
    const timer = setInterval(refresh, 8000);
    return () => {
      stopped = true; clearInterval(timer); document.title = "24/7Support";
      socket.off("connect", join); socket.off("disconnect", disconnected); socket.off("inbox:message", message);
      socket.emit("project:leave", projectId);
      window.removeEventListener("online", refresh); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", visible);
    };
  }, [api, socket, token, projectId, play]);
  useEffect(() => () => { void audio.current?.close(); }, []);
  return { connection, soundEnabled, soundStatus, desktopStatus, enableSound, muteSound, enableDesktop };
}
