"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function SecretDropHome() {
  const FRESH_DROP_WINDOW_MS = 10 * 60 * 1000;
  const [activeTab, setActiveTab] = useState("to_agent");
  const [secretText, setSecretText] = useState("");
  const [burnAfterReading, setBurnAfterReading] = useState(false);
  const [files, setFiles] = useState([]);
  const [fileList, setFileList] = useState([]);

  const [status, setStatus] = useState({ type: "idle", text: "" });
  const [copiedPathName, setCopiedPathName] = useState("");
  const [deletingName, setDeletingName] = useState("");
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState({
    open: false,
    loading: false,
    name: "",
    text: "",
    truncated: false,
    error: "",
    mode: "text",
    url: "",
    downloadUrl: "",
    showRaw: false,
  });
  const [busy, setBusy] = useState({ loading: false, uploading: false });
  const [isGlobalDragging, setIsGlobalDragging] = useState(false);
  const dragCounter = useRef(0);
  const uploadInputRef = useRef(null);
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const displayDropDir = process.env.NEXT_PUBLIC_AGENT_DROP_DIR || process.env.NEXT_PUBLIC_DROP_DIR || "AGENT_DROP_DIR";
  const apiBase = `${basePath}/api/drop`;

  const fileCountLabel = useMemo(() => {
    if (!fileList.length) return "No local files selected";
    return `${fileList.length} file(s) ready`;
  }, [fileList.length]);

  const visibleFiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return files;
    return files.filter((item) => item.name.toLowerCase().includes(q));
  }, [files, query]);

  const agentFiles = useMemo(() => visibleFiles.filter(f => f.folder === "agent_drops"), [visibleFiles]);
  const userFiles = useMemo(() => visibleFiles.filter(f => f.folder === "user_drops"), [visibleFiles]);

  async function loadFiles(silent = false) {
    if (!silent) setBusy((state) => ({ ...state, loading: true }));
    try {
      const response = await fetch(`${apiBase}`, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) {
        if (!silent) setStatus({ type: "error", text: `Could not load drop listing (${response.status})` });
        setFiles([]);
        return;
      }
      const data = await response.json();

      // Only update if the length or content fundamentally changed to avoid endless react re-renders
      setFiles((prev) => JSON.stringify(prev) !== JSON.stringify(data.files) ? (data.files || []) : prev);
    } catch (_err) {
      if (!silent) setStatus({ type: "error", text: "Network problem while refreshing drops." });
    } finally {
      if (!silent) setBusy((state) => ({ ...state, loading: false }));
    }
  }

  useEffect(() => {
    loadFiles();
    const interval = setInterval(() => {
      loadFiles(true);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let lastScrollY = window.scrollY;
    let scrollWind = 0;
    let targetScrollWind = 0;
    let animationFrameId;
    let startTime = Date.now();

    // Initial gentle draft when the page first loads
    targetScrollWind = -15;

    const tick = () => {
      const time = (Date.now() - startTime) / 1000;

      // Decay scroll wind smoothly back to 0
      scrollWind += (targetScrollWind - scrollWind) * 0.15;
      targetScrollWind *= 0.88;

      // Ambient wind: subtle fluttering (mostly active at rest)
      const restingFactor = Math.max(0, 1 - (Math.abs(scrollWind) / 10));

      // Generate 4 independent, out-of-sync wind forces for variety
      const aw1 = (Math.sin(time * 3.5) + Math.sin(time * 2.1 + 1) * 0.5) * 3 * restingFactor;
      const aw2 = (Math.sin(time * 2.8 + 2) + Math.sin(time * 3.4) * 0.5) * 3 * restingFactor;
      const aw3 = (Math.sin(time * 4.1 + 4) + Math.sin(time * 1.8) * 0.5) * 3 * restingFactor;
      const aw4 = (Math.sin(time * 3.1 + 5) + Math.sin(time * 2.5) * 0.5) * 3 * restingFactor;

      const turbulence = (Math.random() * 2 - 1) * 1.5 * restingFactor;

      let tw1 = aw1 + scrollWind + turbulence;
      let tw2 = aw2 + scrollWind + turbulence;
      let tw3 = aw3 + scrollWind + turbulence;
      let tw4 = aw4 + scrollWind + turbulence;

      if (tw1 < 0) tw1 = 0;
      if (tw2 < 0) tw2 = 0;
      if (tw3 < 0) tw3 = 0;
      if (tw4 < 0) tw4 = 0;

      document.documentElement.style.setProperty('--scroll-wind-1', tw1.toFixed(2));
      document.documentElement.style.setProperty('--scroll-wind-2', tw2.toFixed(2));
      document.documentElement.style.setProperty('--scroll-wind-3', tw3.toFixed(2));
      document.documentElement.style.setProperty('--scroll-wind-4', tw4.toFixed(2));

      animationFrameId = requestAnimationFrame(tick);
    };

    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      const delta = currentScrollY - lastScrollY;

      // Scrolling UP (delta is negative) creates an updraft that catches the bottom edge
      targetScrollWind -= delta * 0.7;

      // Allow it to flip up very high (almost horizontal) if scrolling fast
      if (targetScrollWind > 85) targetScrollWind = 85;

      // When scrolling DOWN (delta is positive), wind presses it flat against the box
      if (targetScrollWind < 0) targetScrollWind = 0;

      lastScrollY = currentScrollY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    animationFrameId = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, []);

  useEffect(() => {
    const handleDragEnter = (e) => {
      e.preventDefault();
      dragCounter.current += 1;
      if (dragCounter.current === 1) setIsGlobalDragging(true);
    };
    const handleDragLeave = (e) => {
      e.preventDefault();
      dragCounter.current -= 1;
      if (dragCounter.current === 0) setIsGlobalDragging(false);
    };
    const handleDragOver = (e) => e.preventDefault();
    const handleDrop = (e) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsGlobalDragging(false);
      const dropped = Array.from(e.dataTransfer?.files || []);
      if (dropped.length > 0) normalizeFiles(dropped);
    };

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("drop", handleDrop);

    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("drop", handleDrop);
    };
  }, [fileList]);

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus({ type: "idle", text: "" });

    if (!secretText.trim() && !fileList.length) {
      setStatus({ type: "error", text: "Add notes or choose at least one file." });
      return;
    }

    setBusy((state) => ({ ...state, uploading: true }));
    const formData = new FormData();
    if (secretText.trim()) formData.append("secret", secretText.trim());
    formData.append("burn_after_reading", burnAfterReading ? "true" : "false");

    fileList.forEach((entry) => formData.append("secret_file", entry));

    try {
      const response = await fetch(apiBase, {
        method: "POST",
        headers: { "x-agent-drop-actor": "human-web" },
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) {
        setStatus({ type: "error", text: payload?.error || "Upload failed." });
      } else {
        setStatus({ type: "success", text: payload.message || "Drop updated successfully." });
        setSecretText("");
        setFileList([]);
        setBurnAfterReading(false);
        if (uploadInputRef.current) uploadInputRef.current.value = "";
        await loadFiles();
      }
    } catch (_err) {
      setStatus({ type: "error", text: "Network error while saving your drop." });
    } finally {
      setBusy((state) => ({ ...state, uploading: false }));
    }
  }

  function normalizeFiles(incomingFiles) {
    const next = [...fileList];
    incomingFiles.forEach((file) => {
      const duplicate = next.some((existing) => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified);
      if (!duplicate) next.push(file);
    });
    setFileList(next);
  }

  function onFileChange(event) {
    const selected = Array.from(event.target.files || []);
    normalizeFiles(selected);
    event.target.value = "";
  }

  function handleCopyPath(name, folder) {
    const fullPath = `${displayDropDir}/${folder}/${name}`;
    navigator.clipboard?.writeText(fullPath).catch(() => {});
    setCopiedPathName(name);
    window.setTimeout(() => setCopiedPathName(""), 1600);
  }

  function fileUrl(entry, params = {}) {
    const search = new URLSearchParams({ folder: entry.folder, ...params });
    return `${apiBase}/${encodeURIComponent(entry.name)}?${search.toString()}`;
  }

  async function markViewed(entry) {
    if (entry.status === "new" || entry.status === "unread") {
      try {
        await fetch(fileUrl(entry), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: entry.folder === "agent_drops" ? "viewed" : "read" }),
        });
        loadFiles(true);
      } catch (_e) {}
    }
  }

  async function handleDelete(entry) {
    const key = `${entry.folder}/${entry.name}`;
    setDeletingName(key);
    try {
      const response = await fetch(fileUrl(entry), {
        method: "DELETE",
        headers: { "x-agent-drop-actor": "human-web" },
      });
      const payload = await response.json();
      if (!response.ok) setStatus({ type: "error", text: payload?.error || "Delete failed." });
      else {
        setStatus({ type: "success", text: `Deleted ${entry.name}.` });
        await loadFiles();
      }
    } catch (_error) {
      setStatus({ type: "error", text: "Network error while deleting file." });
    } finally {
      setDeletingName("");
    }
  }

  async function handleNukeVault() {
    const ok = window.confirm("Are you sure you want to permanently delete ALL files in the vault?");
    if (!ok) return;
    setBusy((state) => ({ ...state, loading: true }));
    for (const f of files) {
      await fetch(fileUrl(f), { method: "DELETE" });
    }
    await loadFiles();
    setStatus({ type: "success", text: "Vault completely nuked."});
  }

  function detectPreviewMode(name, previewableText) {
    const ext = (name.split(".").pop() || "").toLowerCase();
    if (ext === "md") return "markdown";
    if (ext === "html") return "html";
    if (previewableText) return "text";
    if (["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext)) return "image";
    if (["mp4", "webm", "mov", "m4v"].includes(ext)) return "video";
    if (["mp3", "wav", "ogg", "m4a"].includes(ext)) return "audio";
    if (ext === "pdf") return "pdf";
    return "unsupported";
  }

  function getFileIcon(name) {
    const ext = (name.split(".").pop() || "").toLowerCase();
    if (["js", "ts", "jsx", "tsx", "py", "json", "html", "css", "md", "sh", "yaml", "yml"].includes(ext)) return { class: "code", svg: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width: '20px', height: '20px'}}><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>) };
    if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext)) return { class: "img", svg: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width: '20px', height: '20px'}}><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>) };
    if (ext === "pdf" || ext === "burn") return { class: "pdf", svg: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width: '20px', height: '20px'}}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>) };
    return { class: "doc", svg: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width: '20px', height: '20px'}}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>) };
  }

  async function handlePreview(entry) {
    markViewed(entry);
    const name = entry?.name || "";
    const mode = detectPreviewMode(name, !!entry?.previewableText);
    const inlineUrl = fileUrl(entry, { inline: "1" });
    const downloadUrl = fileUrl(entry);

    if (!["text", "markdown", "html", "image", "pdf", "video", "audio"].includes(mode)) {
      setPreview({ open: true, loading: false, name, text: "", truncated: false, error: "No inline viewer for this file type. Use Download.", mode, url: inlineUrl, downloadUrl, showRaw: false });
      return;
    }
    if (["image", "pdf", "video", "audio"].includes(mode)) {
      setPreview({ open: true, loading: false, name, text: "", truncated: false, error: "", mode, url: inlineUrl, downloadUrl, showRaw: false });
      return;
    }

    setPreview({ open: true, loading: true, name, text: "", truncated: false, error: "", mode, url: inlineUrl, downloadUrl, showRaw: false });
    try {
      const response = await fetch(fileUrl(entry, { view: "1" }), { headers: { accept: "application/json" } });
      const payload = await response.json();
      if (!response.ok) {
        setPreview({ open: true, loading: false, name, text: "", truncated: false, error: payload?.error || "Preview failed.", mode: "text", url: inlineUrl, downloadUrl, showRaw: false });
        return;
      }
      setPreview({ open: true, loading: false, name, text: payload?.text || "", truncated: !!payload?.truncated, error: "", mode, url: inlineUrl, downloadUrl, showRaw: false });
    } catch (_error) {
      setPreview({ open: true, loading: false, name, text: "", truncated: false, error: "Network error while loading preview.", mode: "text", url: inlineUrl, downloadUrl, showRaw: false });
    }
  }

  function closePreview() { setPreview({ open: false, loading: false, name: "", text: "", truncated: false, error: "", mode: "text", url: "", downloadUrl: "", showRaw: false }); }

  function formatBytes(value) {
    if (!Number.isFinite(value) || value <= 0) return "";
    const units = ["B", "KB", "MB", "GB"];
    let size = value, unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) { size /= 1024; unitIndex++; }
    return `${size >= 10 || unitIndex === 0 ? Math.round(size) : size.toFixed(1)} ${units[unitIndex]}`;
  }

  function formatDate(raw) {
    if (!raw) return "";
    const asDate = new Date(raw);
    if (Number.isNaN(asDate.getTime())) return "";
    return asDate.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function getEntryTime(entry) {
    return entry.droppedAt || entry.modifiedAt || entry.updatedAt || entry.createdAt || null;
  }

  function formatRelativeDropDate(raw) {
    if (!raw) return "";
    const asDate = new Date(raw);
    if (Number.isNaN(asDate.getTime())) return "";

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfTarget = new Date(asDate.getFullYear(), asDate.getMonth(), asDate.getDate());
    const dayDiff = Math.round((startOfToday - startOfTarget) / 86400000);
    const timeLabel = asDate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

    if (dayDiff === 0) return `Today at ${timeLabel}`;
    if (dayDiff === 1) return `Yesterday at ${timeLabel}`;
    return asDate.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function getGroupLabel(entry) {
    const raw = getEntryTime(entry);
    if (!raw) return "Past Drops";
    const asDate = new Date(raw);
    if (Number.isNaN(asDate.getTime())) return "Past Drops";

    const now = new Date();
    const ageMs = now.getTime() - asDate.getTime();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfTarget = new Date(asDate.getFullYear(), asDate.getMonth(), asDate.getDate());
    const dayDiff = Math.round((startOfToday - startOfTarget) / 86400000);

    if (ageMs >= 0 && ageMs <= FRESH_DROP_WINDOW_MS) return "Just Dropped";
    if (dayDiff <= 0) return "Today";
    if (dayDiff === 1) return "Yesterday";
    return "Past Drops";
  }

  function groupEntries(entries) {
    const groups = [
      { label: "Just Dropped", items: [] },
      { label: "Today", items: [] },
      { label: "Yesterday", items: [] },
      { label: "Past Drops", items: [] },
    ];

    entries.forEach((entry) => {
      const label = getGroupLabel(entry);
      const group = groups.find((item) => item.label === label);
      if (group) group.items.push(entry);
    });

    return groups.filter((group) => group.items.length > 0);
  }

  function getAgentProvenance(entry) {
    if (entry.folder !== "agent_drops") return null;

    const label = entry.agentName || (entry.source === "agent" ? "Agent" : "");
    const droppedAt = formatRelativeDropDate(getEntryTime(entry));

    if (!label && !droppedAt) return null;
    return { label, droppedAt };
  }

  function isFreshDrop(entry) {
    const raw = getEntryTime(entry);
    if (!raw) return false;
    const asDate = new Date(raw);
    if (Number.isNaN(asDate.getTime())) return false;
    const ageMs = Date.now() - asDate.getTime();
    return ageMs >= 0 && ageMs <= FRESH_DROP_WINDOW_MS;
  }

  const renderFileCard = (entry, isUser) => {
    const icon = getFileIcon(entry.name);
    const metaLabel = formatDate(getEntryTime(entry));
    const provenance = getAgentProvenance(entry);
    const freshDrop = isFreshDrop(entry);
    return (
      <article className="file-card" key={`${entry.folder}/${entry.name}`}>
        {freshDrop ? <div className="file-ribbon">NEW</div> : null}
        {copiedPathName === entry.name ? <div className="copy-feedback">Path Copied!</div> : null}
        <div className="file-card-header">
            <div className={`file-icon ${icon.class}`}>{icon.svg}</div>
            <div className="file-card-header-text" style={{overflow: "hidden", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px"}}>
              {entry.status === "new" && !freshDrop && <span className="badge badge-new">Not Opened</span>}
              {entry.status === "unread" && <span className="badge badge-sent">Unread</span>}
              {entry.status === "read" && <span className="badge badge-renamed">✓ Read</span>}
              {entry.status === "viewed" && <span className="badge badge-renamed">Viewed</span>}
              <p className="filename" title={entry.name}>{entry.name}</p>
            </div>
        </div>
        <div className="file-card-body">
          <p className="filemeta">
            {formatBytes(entry.sizeBytes || entry.size || 0) || "file"}
            {!provenance && metaLabel ? ` · ${metaLabel}` : ""}
          </p>
          {provenance ? (
            <div className="file-provenance" aria-label={`Dropped by ${provenance.label || "Agent"} ${provenance.droppedAt || ""}`.trim()}>
              {provenance.label ? <span className="file-provenance-chip">{provenance.label}</span> : null}
              {provenance.droppedAt ? <span className="file-provenance-time">{provenance.droppedAt}</span> : null}
            </div>
          ) : null}
        </div>
        <div className="file-card-actions">
          <a className="btn" href={fileUrl(entry)} onClick={() => markViewed(entry)}>Download</a>
          <button type="button" className="ghost" onClick={() => handlePreview(entry)}>View</button>
          {isUser && <button type="button" className="ghost" style={{gridColumn: "span 2"}} onClick={() => handleCopyPath(entry.name, entry.folder)}>Copy Terminal Path</button>}
          <button type="button" className="danger" style={{gridColumn: isUser ? "span 2" : "span 1"}} disabled={deletingName === `${entry.folder}/${entry.name}`} onClick={() => handleDelete(entry)}>
            {deletingName === `${entry.folder}/${entry.name}` ? "..." : "Delete"}
          </button>
        </div>
      </article>
    );
  };

  const renderGroupedFiles = (entries, isUser) => (
    <div className="drop-groups">
      {groupEntries(entries).map((group) => (
        <div className="drop-group" key={group.label}>
          <div className="drop-group-heading">
            <span className="drop-group-title">{group.label}</span>
            <span className="drop-group-rule" aria-hidden="true"></span>
          </div>
          <div className="file-grid">{group.items.map((entry) => renderFileCard(entry, isUser))}</div>
        </div>
      ))}
    </div>
  );

  return (
    <main>
      {process.env.NODE_ENV === 'development' && (
        <div className="dev-banner">
          DEVELOPMENT MODE
        </div>
      )}
      <div className="shell">
        <header className="panel mast stagger-1">
          <div className="hero">
            <h1 className="hero-title"><span className="hero-title-main">Agent</span><span className="hero-title-cut">Drop</span></h1>
            <p className="subtext">Secure two-way handoff for terminal agents.</p>
          </div>
          <div className="mast-controls mobile-only">
            <div className="tabbar">
              <button type="button" className={`tab-btn ${activeTab === "to_agent" ? "tab-btn-active" : ""}`} onClick={() => setActiveTab("to_agent")}>Send</button>
              <button type="button" className={`tab-btn ${activeTab === "from_agent" ? "tab-btn-active" : ""}`} onClick={() => setActiveTab("from_agent")}>Receive</button>
            </div>
          </div>
          <div className="inline-actions desktop-only">
             <button type="button" className="ghost" onClick={() => loadFiles()} disabled={busy.loading}>{busy.loading ? "Syncing..." : "Refresh"}</button>
             <button type="button" className="danger" onClick={handleNukeVault}>Nuke Vault</button>
          </div>
        </header>

        {status.text && <div className={`stagger-2 alert ${status.type === "error" ? "alert" : "success"}`}>{status.text}</div>}

        <div className={`dual-pane ${activeTab === "to_agent" ? "show-to_agent" : "show-from_agent"}`}>

          <section className={`panel flow stagger-2 to-agent-pane ${isGlobalDragging ? "pane-drag-active" : ""}`}>
            <div className="section-head">
              <h2>Send to Agent</h2>
              <div className="mobile-only">
                <button type="button" className="ghost" onClick={() => loadFiles()} disabled={busy.loading}>{busy.loading ? "..." : "Refresh"}</button>
              </div>
            </div>
            <form onSubmit={handleSubmit} className="flow-stack">
              <section className="step-block files-step">
                <div className="step-head"><h3>Dropzone</h3></div>
                <div className="send-grid">
                  <div className="upload-toolbar">
                    <div className="action-row">
                      <button className="primary-alt" type="button" onClick={() => uploadInputRef.current?.click()}>Browse files</button>
                      {fileList.length > 0 && <button type="button" className="ghost" onClick={() => { setFileList([]); if (uploadInputRef.current) uploadInputRef.current.value = ""; }}>Clear</button>}
                    </div>
                  </div>
                  {isGlobalDragging ? <p className="file-drop-hint">Drop files anywhere to queue</p> : (!fileList.length && <p className="file-drop-hint">Drag & drop files onto this page</p>)}
                  <input id="secret_files" ref={uploadInputRef} type="file" multiple onChange={onFileChange} hidden />
                  {fileList.length > 0 && (
                    <div className="chip-list">
                      {fileList.map((entry) => <span className="chip" key={`${entry.name}-${entry.size}-${entry.lastModified}`}>{entry.name}</span>)}
                    </div>
                  )}
                </div>
              </section>

              <section className="step-block">
                <div className="step-head" style={{justifyContent: 'space-between', borderBottom: 'none'}}>
                  <h3>Secure Note</h3>
                  <label className="burn-label">
                    <input type="checkbox" checked={burnAfterReading} onChange={(e) => setBurnAfterReading(e.target.checked)} />
                    Burn After Reading
                  </label>
                </div>
                <div className="notes-block">
                  <textarea id="secret_text" value={secretText} onChange={(event) => setSecretText(event.target.value)} placeholder="> Type API keys or passwords here..." autoComplete="off" spellCheck={false} />
                </div>
              </section>

              <button className="primary send-cta" type="submit" disabled={busy.uploading || (!secretText.trim() && !fileList.length)}>
                <span className="send-cta-text">{busy.uploading ? "Sending..." : "Send to Agent"}</span>
              </button>
            </form>
          </section>

          <div className="from-agent-pane" style={{display: 'grid', gap: '24px'}}>
             <section className="panel flow stagger-3 agent-deliveries">
                <div className="section-head">
                  <h2 className="agent-title">Deliveries from Agent</h2>
                  <div className="mobile-only">
                    <button type="button" className="ghost" onClick={() => loadFiles()} disabled={busy.loading}>{busy.loading ? "..." : "Refresh"}</button>
                  </div>
                </div>
                {!agentFiles.length ? (
                  <div className="empty agent-empty">No deliveries yet.<br/>Agent outputs will appear here.</div>
                ) : (
                  renderGroupedFiles(agentFiles, false)
                )}
             </section>

             <section className="panel flow stagger-3 user-outbox">
                <div className="section-head"><h2>Uploaded by You</h2></div>
                <input className="search-input" type="text" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter vault..." style={{width: '100%'}} />
                {!userFiles.length ? (
                  <div className="empty">Your outbox is empty.</div>
                ) : (
                  renderGroupedFiles(userFiles, true)
                )}
                <div className="mobile-only" style={{marginTop: '12px'}}>
                  <button type="button" className="danger" style={{width: '100%'}} onClick={handleNukeVault}>Nuke Vault</button>
                </div>
             </section>
          </div>
        </div>

        {preview.open && (
          <div className="modal-backdrop" onClick={closePreview}>
            <div className="modal" onClick={(event) => event.stopPropagation()}>
              <div className="section-head">
                <h3>File Preview</h3>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {["markdown", "html"].includes(preview.mode) && (
                    <button type="button" className="ghost" onClick={() => setPreview(p => ({ ...p, showRaw: !p.showRaw }))}>
                      {preview.showRaw ? "Show Formatted" : "Show Raw Code"}
                    </button>
                  )}
                  <button type="button" className="ghost" onClick={closePreview}>Close</button>
                </div>
              </div>
              <p className="filename">{preview.name}</p>
              {preview.loading && <p className="meta-note">Loading preview...</p>}
              {preview.error && <div className="alert">{preview.error}</div>}
              {!preview.loading && !preview.error && (preview.mode === "text" || preview.showRaw) && (
                <><pre className="preview-text">{preview.text || "(empty file)"}</pre>{preview.truncated && <p className="meta-note">Preview truncated for performance/safety.</p>}</>
              )}
              {!preview.loading && !preview.error && preview.mode === "markdown" && !preview.showRaw && (
                <div className="preview-markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{preview.text || "(empty file)"}</ReactMarkdown>
                  {preview.truncated && <p className="meta-note">Preview truncated for performance/safety.</p>}
                </div>
              )}
              {!preview.loading && !preview.error && preview.mode === "html" && !preview.showRaw && (
                <div className="preview-html">
                  <iframe title="HTML Preview" srcDoc={preview.text} sandbox="" style={{ width: "100%", height: "60vh", border: "2px solid #8f7959", borderRadius: "6px", background: "white" }} />
                </div>
              )}
              {!preview.loading && !preview.error && preview.mode === "image" && <img className="preview-media-image" src={preview.url} alt={preview.name} />}
              {!preview.loading && !preview.error && preview.mode === "pdf" && (
                <div style={{ height: "60vh", width: "100%", borderRadius: "6px", overflow: "hidden", border: "2px solid #8f7959", background: "#fcf8ef" }}>
                  <iframe title={`Preview ${preview.name}`} src={preview.url} style={{ height: "100%", width: "100%", border: 0, background: "white" }} />
                </div>
              )}
              {!preview.loading && !preview.error && preview.mode === "video" && <video className="preview-media-player" controls src={preview.url} />}
              {!preview.loading && !preview.error && preview.mode === "audio" && <audio className="preview-media-player" controls src={preview.url} />}
              <a className="primary" style={{textAlign: "center", display: "block"}} href={preview.downloadUrl}>Download Full File</a>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
