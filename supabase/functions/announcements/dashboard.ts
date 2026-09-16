// Dashboard HTML/CSS/JS renderer for AnymeX Announcements Studio
export function renderAnnouncementDashboard(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AnymeX Announcement Studio</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/dompurify/dist/purify.min.js"></script>
  <style>
    :root {
      --bg-primary: #090a10;
      --bg-surface: rgba(18, 20, 32, 0.75);
      --bg-surface-elevated: rgba(26, 29, 46, 0.85);
      --border-subtle: rgba(255, 255, 255, 0.08);
      --border-focus: rgba(139, 92, 246, 0.5);
      --primary: #8b5cf6;
      --primary-hover: #7c3aed;
      --primary-glow: rgba(139, 92, 246, 0.35);
      --accent: #6366f1;
      --success: #10b981;
      --danger: #ef4444;
      --warning: #f59e0b;
      --text-primary: #f8fafc;
      --text-secondary: #94a3b8;
      --text-muted: #64748b;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg-primary);
      background-image: 
        radial-gradient(circle at 15% 15%, rgba(99, 102, 241, 0.12) 0%, transparent 40%),
        radial-gradient(circle at 85% 85%, rgba(139, 92, 246, 0.12) 0%, transparent 40%);
      background-attachment: fixed;
      color: var(--text-primary);
      font-family: 'Inter', sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    header {
      background: rgba(14, 16, 26, 0.8);
      backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--border-subtle);
      padding: 16px 28px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .logo-group {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .logo-badge {
      width: 38px;
      height: 38px;
      border-radius: 10px;
      background: linear-gradient(135deg, var(--primary), var(--accent));
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      box-shadow: 0 4px 14px var(--primary-glow);
    }

    .brand-title {
      font-family: 'Outfit', sans-serif;
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }

    .brand-sub {
      font-size: 12px;
      color: var(--text-muted);
      font-weight: 500;
    }

    .auth-status {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border-subtle);
    }

    .status-pill.online {
      background: rgba(16, 185, 129, 0.12);
      border-color: rgba(16, 185, 129, 0.3);
      color: #34d399;
    }

    .status-pill.offline {
      background: rgba(239, 68, 68, 0.12);
      border-color: rgba(239, 68, 68, 0.3);
      color: #f87171;
    }

    .btn {
      padding: 8px 16px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s ease;
      border: none;
      outline: none;
    }

    .btn-primary {
      background: linear-gradient(135deg, var(--primary), var(--accent));
      color: white;
      box-shadow: 0 4px 14px var(--primary-glow);
    }

    .btn-primary:hover {
      opacity: 0.95;
      transform: translateY(-1px);
      box-shadow: 0 6px 20px var(--primary-glow);
    }

    .btn-secondary {
      background: var(--bg-surface-elevated);
      color: var(--text-primary);
      border: 1px solid var(--border-subtle);
    }

    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.1);
    }

    .btn-danger {
      background: rgba(239, 68, 68, 0.15);
      color: #fca5a5;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }

    .btn-danger:hover {
      background: rgba(239, 68, 68, 0.25);
    }

    .main-container {
      max-width: 1440px;
      width: 100%;
      margin: 0 auto;
      padding: 24px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      flex: 1;
    }

    @media (max-width: 1024px) {
      .main-container {
        grid-template-columns: 1fr;
      }
    }

    .card {
      background: var(--bg-surface);
      backdrop-filter: blur(20px);
      border: 1px solid var(--border-subtle);
      border-radius: 18px;
      padding: 22px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--border-subtle);
    }

    .card-title {
      font-family: 'Outfit', sans-serif;
      font-size: 17px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 7px;
    }

    .form-label {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-secondary);
      display: flex;
      justify-content: space-between;
    }

    .input-text, select, textarea {
      width: 100%;
      background: rgba(10, 12, 20, 0.7);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      padding: 11px 14px;
      color: var(--text-primary);
      font-family: 'Inter', sans-serif;
      font-size: 14px;
      outline: none;
      transition: all 0.2s ease;
    }

    .input-text:focus, select:focus, textarea:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.2);
    }

    textarea {
      resize: vertical;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      line-height: 1.5;
      min-height: 240px;
    }

    .category-pills {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .category-pill {
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border-subtle);
      color: var(--text-secondary);
      transition: all 0.2s ease;
    }

    .category-pill.active {
      background: var(--primary);
      color: white;
      border-color: var(--primary);
      box-shadow: 0 2px 10px var(--primary-glow);
    }

    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 8px;
      background: rgba(10, 12, 20, 0.5);
      border: 1px solid var(--border-subtle);
      border-radius: 12px 12px 0 0;
      border-bottom: none;
    }

    .tool-btn {
      padding: 6px 10px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid transparent;
      color: var(--text-secondary);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: all 0.15s ease;
    }

    .tool-btn:hover {
      background: rgba(255, 255, 255, 0.12);
      color: var(--text-primary);
    }

    .editor-wrapper textarea {
      border-radius: 0 0 12px 12px;
    }

    /* Live Preview Styling */
    .preview-container {
      flex: 1;
      overflow-y: auto;
      background: rgba(10, 12, 20, 0.7);
      border: 1px solid var(--border-subtle);
      border-radius: 14px;
      padding: 20px;
      min-height: 400px;
    }

    .preview-header-meta {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
    }

    .preview-category-tag {
      padding: 3px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      background: var(--primary);
      color: white;
      letter-spacing: 0.5px;
    }

    .preview-date {
      font-size: 12px;
      color: var(--text-muted);
    }

    .preview-title {
      font-family: 'Outfit', sans-serif;
      font-size: 22px;
      font-weight: 700;
      color: var(--text-primary);
      margin-bottom: 14px;
      line-height: 1.3;
    }

    .markdown-body {
      font-size: 14.5px;
      line-height: 1.65;
      color: #cbd5e1;
    }

    .markdown-body h1 { font-size: 1.6em; margin: 18px 0 10px; color: #fff; font-family: 'Outfit', sans-serif; }
    .markdown-body h2 { font-size: 1.3em; margin: 16px 0 8px; color: #fff; font-family: 'Outfit', sans-serif; }
    .markdown-body h3 { font-size: 1.1em; margin: 14px 0 6px; color: #fff; }
    .markdown-body p { margin-bottom: 12px; }
    .markdown-body a { color: #a78bfa; text-decoration: underline; word-break: break-all; }
    .markdown-body strong { color: #fff; font-weight: 700; }
    .markdown-body em { color: #e2e8f0; }
    .markdown-body blockquote {
      border-left: 3px solid var(--primary);
      padding-left: 14px;
      margin: 12px 0;
      color: #94a3b8;
      font-style: italic;
      background: rgba(139, 92, 246, 0.05);
      border-radius: 0 8px 8px 0;
      padding-top: 6px;
      padding-bottom: 6px;
    }
    .markdown-body ul, .markdown-body ol { margin: 10px 0 12px 22px; }
    .markdown-body li { margin-bottom: 4px; }
    .markdown-body code {
      background: rgba(255, 255, 255, 0.08);
      color: #f472b6;
      padding: 2px 6px;
      border-radius: 6px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12.5px;
    }
    .markdown-body pre {
      background: #030712;
      border: 1px solid var(--border-subtle);
      border-radius: 10px;
      padding: 14px;
      margin: 12px 0;
      overflow-x: auto;
    }
    .markdown-body pre code {
      background: transparent;
      padding: 0;
      color: #e2e8f0;
    }
    .markdown-body img {
      max-width: 100%;
      height: auto;
      border-radius: 12px;
      margin: 12px 0;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
      border: 1px solid var(--border-subtle);
      display: block;
    }
    .markdown-body hr {
      border: none;
      height: 1px;
      background: var(--border-subtle);
      margin: 18px 0;
    }

    .spoiler {
      background: #1e293b;
      color: #1e293b;
      padding: 2px 6px;
      border-radius: 4px;
      cursor: pointer;
      user-select: none;
      transition: all 0.2s ease;
    }
    .spoiler.revealed {
      background: rgba(255, 255, 255, 0.1);
      color: var(--text-primary);
      user-select: text;
    }

    /* Notification Simulation */
    .notif-preview {
      background: #1e1b4b;
      border: 1px solid rgba(139, 92, 246, 0.4);
      border-radius: 14px;
      padding: 14px 16px;
      display: flex;
      gap: 12px;
      align-items: flex-start;
      margin-top: 14px;
    }

    .notif-icon {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: linear-gradient(135deg, var(--primary), var(--accent));
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      flex-shrink: 0;
    }

    .notif-content {
      flex: 1;
      min-width: 0;
    }

    .notif-header {
      font-size: 11px;
      color: #c4b5fd;
      font-weight: 600;
      margin-bottom: 2px;
      display: flex;
      justify-content: space-between;
    }

    .notif-title {
      font-size: 13.5px;
      font-weight: 700;
      color: #fff;
      margin-bottom: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .notif-body {
      font-size: 12px;
      color: #cbd5e1;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    /* Modal Styling */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(8px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 200;
      padding: 16px;
    }

    .modal-overlay.active {
      display: flex;
    }

    .modal-box {
      background: #111320;
      border: 1px solid var(--border-subtle);
      border-radius: 18px;
      padding: 24px;
      max-width: 480px;
      width: 100%;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .modal-title {
      font-family: 'Outfit', sans-serif;
      font-size: 18px;
      font-weight: 700;
    }

    /* History table */
    .history-section {
      max-width: 1440px;
      width: 100%;
      margin: 0 auto 40px;
      padding: 0 24px;
    }

    .history-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 16px;
      margin-top: 14px;
    }

    .history-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 14px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 12px;
      transition: border-color 0.2s;
    }

    .history-card:hover {
      border-color: rgba(139, 92, 246, 0.3);
    }
  </style>
</head>
<body>

  <!-- Top Navigation -->
  <header>
    <div class="logo-group">
      <div class="logo-badge">📢</div>
      <div>
        <div class="brand-title">AnymeX Announcement Studio</div>
        <div class="brand-sub">Broadcast System Push Notifications & Feed Updates</div>
      </div>
    </div>
    <div class="auth-status">
      <span id="authStatusPill" class="status-pill offline">
        <span id="authDot">🔴</span> <span id="authStatusText">Admin Key Required</span>
      </span>
      <button class="btn btn-secondary" onclick="openAuthModal()">🔑 Change Key</button>
    </div>
  </header>

  <!-- Main Work Area -->
  <main class="main-container">

    <!-- Composer Section -->
    <section class="card">
      <div class="card-header">
        <div class="card-title">✍️ Announcement Composer</div>
        <button class="btn btn-secondary" onclick="resetForm()">↺ Reset</button>
      </div>

      <!-- Title Input -->
      <div class="form-group">
        <label class="form-label" for="annTitle">Title <span style="color:var(--danger)">*</span></label>
        <input type="text" id="annTitle" class="input-text" placeholder="e.g. AnymeX v2.5.0 Released! 🚀" oninput="updatePreview()">
      </div>

      <!-- Category Selector -->
      <div class="form-group">
        <label class="form-label">Category</label>
        <div class="category-pills">
          <button type="button" class="category-pill active" onclick="setCategory(this, 'update')">🚀 Update</button>
          <button type="button" class="category-pill" onclick="setCategory(this, 'feature')">✨ Feature</button>
          <button type="button" class="category-pill" onclick="setCategory(this, 'notice')">📢 Notice</button>
          <button type="button" class="category-pill" onclick="setCategory(this, 'maintenance')">🛠️ Maintenance</button>
          <button type="button" class="category-pill" onclick="setCategory(this, 'alert')">⚠️ Alert</button>
          <button type="button" class="category-pill" onclick="setCategory(this, 'event')">🎉 Event</button>
        </div>
      </div>

      <!-- Notification Summary -->
      <div class="form-group">
        <label class="form-label" for="annShortDesc">
          Notification Subtitle
          <span style="font-size:11px;color:var(--text-muted)">(Shown in device notification bar)</span>
        </label>
        <input type="text" id="annShortDesc" class="input-text" placeholder="Short preview text for phone notification" oninput="updatePreview()">
      </div>

      <!-- Content Editor with Toolbar -->
      <div class="form-group">
        <label class="form-label">Message Content (Markdown Supported)</label>
        <div class="editor-wrapper">
          <div class="toolbar">
            <button type="button" class="tool-btn" onclick="insertSyntax('**', '**')"><b>B</b></button>
            <button type="button" class="tool-btn" onclick="insertSyntax('*', '*')"><i>I</i></button>
            <button type="button" class="tool-btn" onclick="insertSyntax('~~', '~~')"><s>S</s></button>
            <button type="button" class="tool-btn" onclick="insertHeading()">H2</button>
            <button type="button" class="tool-btn" onclick="insertSyntax('||', '||')">|| Spoiler ||</button>
            <button type="button" class="tool-btn" onclick="insertSyntax('> ', '')">❝ Quote</button>
            <button type="button" class="tool-btn" onclick="insertCodeBlock()">&lt;/&gt; Code</button>
            <button type="button" class="tool-btn" onclick="openMediaModal('image')">🖼️ Image</button>
            <button type="button" class="tool-btn" onclick="openMediaModal('gif')">🎬 GIF</button>
            <button type="button" class="tool-btn" onclick="openLinkModal()">🔗 Link</button>
            <button type="button" class="tool-btn" onclick="insertSyntax('\\n---\\n', '')">― Divider</button>
            <button type="button" class="tool-btn" onclick="insertSyntax('- ', '')">• Bullet</button>
          </div>
          <textarea id="annContent" placeholder="Write announcement details here... Markdown, images, GIFs, and links will render live on the right side!" oninput="updatePreview()"></textarea>
        </div>
      </div>

      <!-- Notification & Broadcast Controls -->
      <div style="background: rgba(255,255,255,0.03); border:1px solid var(--border-subtle); border-radius:12px; padding:14px; display:flex; flex-direction:column; gap:10px;">
        <label style="display:flex; align-items:center; gap:10px; cursor:pointer;">
          <input type="checkbox" id="sendPushCheck" checked style="width:18px; height:18px; accent-color:var(--primary)">
          <div>
            <div style="font-weight:600; font-size:13.5px">⚡ Broadcast Instant Push Notification</div>
            <div style="font-size:11.5px; color:var(--text-muted)">Sends high-priority system push notification to all active devices</div>
          </div>
        </label>
        <label style="display:flex; align-items:center; gap:10px; cursor:pointer;">
          <input type="checkbox" id="pinAnnouncementCheck" style="width:18px; height:18px; accent-color:var(--primary)">
          <div>
            <div style="font-weight:600; font-size:13.5px">📌 Pin to Top of Announcements Feed</div>
          </div>
        </label>
      </div>

      <!-- Action Button -->
      <button id="broadcastBtn" class="btn btn-primary" style="padding:14px; font-size:15px; justify-content:center;" onclick="confirmBroadcast()">
        🚀 Broadcast Announcement Now
      </button>
    </section>

    <!-- Real-time Live Preview Section -->
    <section class="card">
      <div class="card-header">
        <div class="card-title">📱 Live Preview (In-App & Device)</div>
        <span style="font-size:12px; color:var(--text-muted)">Updates automatically</span>
      </div>

      <!-- Full Announcement Card Preview -->
      <div class="preview-container">
        <div class="preview-header-meta">
          <span id="previewTag" class="preview-category-tag">UPDATE</span>
          <span class="preview-date">Just now • Administrator</span>
        </div>
        <h1 id="previewTitle" class="preview-title">AnymeX Announcement Title</h1>
        <div id="previewBody" class="markdown-body">
          <p>Your formatted message, images, and GIFs will appear here in real time...</p>
        </div>
      </div>

      <!-- Lock Screen Notification Simulation -->
      <div>
        <div style="font-size:12px; font-weight:700; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px">
          Device Push Notification Preview
        </div>
        <div class="notif-preview">
          <div class="notif-icon">📢</div>
          <div class="notif-content">
            <div class="notif-header">
              <span>AnymeX</span>
              <span>now</span>
            </div>
            <div id="notifTitlePreview" class="notif-title">AnymeX Announcement Title</div>
            <div id="notifBodyPreview" class="notif-body">Notification preview summary...</div>
          </div>
        </div>
      </div>
    </section>

  </main>

  <!-- Announcements History Section -->
  <section class="history-section">
    <div class="card">
      <div class="card-header">
        <div class="card-title">📜 Past Announcements</div>
        <button class="btn btn-secondary" onclick="loadHistory()">🔄 Refresh List</button>
      </div>
      <div id="historyGrid" class="history-grid">
        <div style="color:var(--text-muted); font-size:13px; grid-column:1/-1;">Loading past announcements...</div>
      </div>
    </div>
  </section>

  <!-- Auth Modal -->
  <div id="authModal" class="modal-overlay">
    <div class="modal-box">
      <div class="modal-title">🔐 Enter Admin Key</div>
      <p style="font-size:13px; color:var(--text-secondary)">
        Enter your <b>SUPABASE_SERVICE_ROLE_KEY</b> or <b>ADMIN_SECRET</b> to authorize broadcasting announcements.
      </p>
      <input type="password" id="adminKeyInput" class="input-text" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...">
      <div style="display:flex; justify-content:flex-end; gap:10px;">
        <button class="btn btn-secondary" onclick="closeAuthModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveAdminKey()">Save & Authenticate</button>
      </div>
    </div>
  </div>

  <!-- Media Insert Modal (Image / GIF) -->
  <div id="mediaModal" class="modal-overlay">
    <div class="modal-box">
      <div id="mediaModalTitle" class="modal-title">🖼️ Insert Image</div>
      <div class="form-group">
        <label class="form-label" for="mediaUrlInput">Media URL (Direct JPG, PNG, WebP, GIF)</label>
        <input type="url" id="mediaUrlInput" class="input-text" placeholder="https://example.com/banner.jpg" oninput="testMediaPreview()">
      </div>
      <div class="form-group">
        <label class="form-label" for="mediaAltInput">Alt Description (Optional)</label>
        <input type="text" id="mediaAltInput" class="input-text" placeholder="Banner image">
      </div>
      <div id="mediaQuickGifs" style="display:none; flex-direction:column; gap:6px;">
        <span style="font-size:11.5px; color:var(--text-muted); font-weight:600;">Quick Presets:</span>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button type="button" class="btn btn-secondary" style="font-size:11px; padding:4px 8px" onclick="setQuickGif('https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif', 'Hype!')">🎉 Hype</button>
          <button type="button" class="btn btn-secondary" style="font-size:11px; padding:4px 8px" onclick="setQuickGif('https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif', 'Applaud')">👏 Applaud</button>
          <button type="button" class="btn btn-secondary" style="font-size:11px; padding:4px 8px" onclick="setQuickGif('https://media.giphy.com/media/26n6WywJyh39n1pBu/giphy.gif', 'Important Notice')">⚠️ Notice</button>
          <button type="button" class="btn btn-secondary" style="font-size:11px; padding:4px 8px" onclick="setQuickGif('https://media.giphy.com/media/d2lcHJTG5Tscg/giphy.gif', 'Maintenance')">🛠️ Maintenance</button>
        </div>
      </div>
      <div id="mediaPreviewArea" style="max-height:160px; overflow:hidden; border-radius:10px; display:none; border:1px solid var(--border-subtle); text-align:center;">
        <img id="mediaPreviewImg" src="" style="max-height:160px; max-width:100%; border-radius:10px;">
      </div>
      <div style="display:flex; justify-content:flex-end; gap:10px;">
        <button class="btn btn-secondary" onclick="closeMediaModal()">Cancel</button>
        <button class="btn btn-primary" onclick="confirmInsertMedia()">Insert into Content</button>
      </div>
    </div>
  </div>

  <!-- Link Insert Modal -->
  <div id="linkModal" class="modal-overlay">
    <div class="modal-box">
      <div class="modal-title">🔗 Insert Link</div>
      <div class="form-group">
        <label class="form-label" for="linkTextInput">Display Text</label>
        <input type="text" id="linkTextInput" class="input-text" placeholder="Click here or Discord Server">
      </div>
      <div class="form-group">
        <label class="form-label" for="linkUrlInput">Destination URL</label>
        <input type="url" id="linkUrlInput" class="input-text" placeholder="https://discord.gg/anymex">
      </div>
      <div style="display:flex; justify-content:flex-end; gap:10px;">
        <button class="btn btn-secondary" onclick="closeLinkModal()">Cancel</button>
        <button class="btn btn-primary" onclick="confirmInsertLink()">Insert Link</button>
      </div>
    </div>
  </div>

  <!-- Logic & Scripts -->
  <script>
    let currentCategory = 'update';
    let currentMediaType = 'image';

    // Initialize marked with custom renderer
    const renderer = new marked.Renderer();
    const originalLink = renderer.link.bind(renderer);
    renderer.link = (href, title, text) => {
      const html = originalLink(href, title, text);
      return html.replace('<a ', '<a target="_blank" rel="noopener noreferrer" ');
    };
    marked.setOptions({
      renderer: renderer,
      breaks: true,
      gfm: true
    });

    // Custom spoiler parser (||spoiler||)
    function parseSpoilers(text) {
      return text.replace(/\\|\\|([\\s\\S]+?)\\|\\|/g, '<span class="spoiler" onclick="this.classList.toggle(\\'revealed\\')">$1</span>');
    }

    function setCategory(el, cat) {
      document.querySelectorAll('.category-pill').forEach(p => p.classList.remove('active'));
      el.classList.add('active');
      currentCategory = cat;
      updatePreview();
    }

    function updatePreview() {
      const title = document.getElementById('annTitle').value.trim() || 'AnymeX Announcement Title';
      const shortDesc = document.getElementById('annShortDesc').value.trim() || 'Notification preview summary...';
      const rawContent = document.getElementById('annContent').value.trim() || 'Your formatted message, images, and GIFs will appear here in real time...';

      document.getElementById('previewTitle').innerText = title;
      document.getElementById('previewTag').innerText = currentCategory.toUpperCase();
      document.getElementById('notifTitlePreview').innerText = title;
      document.getElementById('notifBodyPreview').innerText = shortDesc || title;

      // Parse markdown + spoilers
      try {
        const parsedMd = marked.parse(rawContent);
        const withSpoilers = parseSpoilers(parsedMd);
        const cleanHtml = DOMPurify.sanitize(withSpoilers, {
          ADD_TAGS: ['span', 'img', 'iframe'],
          ADD_ATTR: ['target', 'rel', 'class', 'onclick', 'width', 'height']
        });
        document.getElementById('previewBody').innerHTML = cleanHtml;
      } catch (err) {
        document.getElementById('previewBody').innerHTML = '<p>' + rawContent + '</p>';
      }
    }

    // Toolbar Helpers
    function insertSyntax(before, after) {
      const textarea = document.getElementById('annContent');
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selectedText = textarea.value.substring(start, end);
      const replacement = before + selectedText + after;
      textarea.value = textarea.value.substring(0, start) + replacement + textarea.value.substring(end);
      textarea.focus();
      textarea.selectionStart = start + before.length;
      textarea.selectionEnd = end + before.length;
      updatePreview();
    }

    function insertHeading() {
      insertSyntax('## ', '');
    }

    function insertCodeBlock() {
      const fence = String.fromCharCode(96, 96, 96);
      insertSyntax(fence + '\\n', '\\n' + fence);
    }

    // Modal Helpers
    function openAuthModal() {
      document.getElementById('adminKeyInput').value = localStorage.getItem('anymex_admin_key') || '';
      document.getElementById('authModal').classList.add('active');
    }

    function closeAuthModal() {
      document.getElementById('authModal').classList.remove('active');
    }

    function saveAdminKey() {
      const key = document.getElementById('adminKeyInput').value.trim();
      if (!key) {
        alert('Please enter a valid admin key.');
        return;
      }
      localStorage.setItem('anymex_admin_key', key);
      closeAuthModal();
      checkAuth();
      loadHistory();
    }

    function checkAuth() {
      const key = localStorage.getItem('anymex_admin_key');
      const statusPill = document.getElementById('authStatusPill');
      const statusText = document.getElementById('authStatusText');
      const dot = document.getElementById('authDot');

      if (key && key.length > 10) {
        statusPill.className = 'status-pill online';
        statusText.innerText = 'Admin Key Saved';
        dot.innerText = '🟢';
      } else {
        statusPill.className = 'status-pill offline';
        statusText.innerText = 'Admin Key Required';
        dot.innerText = '🔴';
      }
    }

    function openMediaModal(type) {
      currentMediaType = type;
      document.getElementById('mediaModalTitle').innerText = type === 'gif' ? '🎬 Insert GIF' : '🖼️ Insert Image';
      document.getElementById('mediaQuickGifs').style.display = type === 'gif' ? 'flex' : 'none';
      document.getElementById('mediaUrlInput').value = '';
      document.getElementById('mediaAltInput').value = type === 'gif' ? 'GIF' : 'Image';
      document.getElementById('mediaPreviewArea').style.display = 'none';
      document.getElementById('mediaModal').classList.add('active');
    }

    function closeMediaModal() {
      document.getElementById('mediaModal').classList.remove('active');
    }

    function testMediaPreview() {
      const url = document.getElementById('mediaUrlInput').value.trim();
      const previewArea = document.getElementById('mediaPreviewArea');
      const previewImg = document.getElementById('mediaPreviewImg');
      if (url.startsWith('http://') || url.startsWith('https://')) {
        previewImg.src = url;
        previewArea.style.display = 'block';
      } else {
        previewArea.style.display = 'none';
      }
    }

    function setQuickGif(url, alt) {
      document.getElementById('mediaUrlInput').value = url;
      document.getElementById('mediaAltInput').value = alt;
      testMediaPreview();
    }

    function confirmInsertMedia() {
      const url = document.getElementById('mediaUrlInput').value.trim();
      const alt = document.getElementById('mediaAltInput').value.trim() || 'Media';
      if (!url) {
        alert('Please enter a valid image or GIF URL.');
        return;
      }
      insertSyntax('![' + alt + '](' + url + ')', '');
      closeMediaModal();
    }

    function openLinkModal() {
      const textarea = document.getElementById('annContent');
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selected = textarea.value.substring(start, end);
      document.getElementById('linkTextInput').value = selected || '';
      document.getElementById('linkUrlInput').value = '';
      document.getElementById('linkModal').classList.add('active');
    }

    function closeLinkModal() {
      document.getElementById('linkModal').classList.remove('active');
    }

    function confirmInsertLink() {
      const text = document.getElementById('linkTextInput').value.trim() || 'Link';
      const url = document.getElementById('linkUrlInput').value.trim();
      if (!url) {
        alert('Please enter a destination URL.');
        return;
      }
      insertSyntax('[' + text + '](' + url + ')', '');
      closeLinkModal();
    }

    function resetForm() {
      if (!confirm('Are you sure you want to clear the composer?')) return;
      document.getElementById('annTitle').value = '';
      document.getElementById('annShortDesc').value = '';
      document.getElementById('annContent').value = '';
      updatePreview();
    }

    // Broadcast Announcement Action
    async function confirmBroadcast() {
      const key = localStorage.getItem('anymex_admin_key');
      if (!key) {
        alert('You must provide your Admin Key first.');
        openAuthModal();
        return;
      }

      const title = document.getElementById('annTitle').value.trim();
      const content = document.getElementById('annContent').value.trim();
      const shortDesc = document.getElementById('annShortDesc').value.trim() || title;
      const sendPush = document.getElementById('sendPushCheck').checked;
      const isPinned = document.getElementById('pinAnnouncementCheck').checked;

      if (!title || !content) {
        alert('Please fill out both the Title and the Content.');
        return;
      }

      const confirmMsg = '🚀 Are you sure you want to broadcast this announcement?\\n\\n' +
        '• Title: ' + title + '\\n' +
        '• Category: ' + currentCategory.toUpperCase() + '\\n' +
        '• Push Notification: ' + (sendPush ? 'YES (Will notify all active devices)' : 'NO');

      if (!confirm(confirmMsg)) return;

      const btn = document.getElementById('broadcastBtn');
      btn.disabled = true;
      btn.innerText = 'Broadcasting...';

      try {
        const response = await fetch('/functions/v1/announcements', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-key': key
          },
          body: JSON.stringify({
            app_id: 'anymex',
            title: title,
            short_description: shortDesc,
            full_content: content,
            category: currentCategory,
            pinned: isPinned,
            priority: 1,
            publish: true,
            admin_key: key
          })
        });

        const data = await response.json();

        if (!response.ok || data.error) {
          alert('Error broadcasting announcement: ' + (data.error || response.statusText));
        } else {
          alert('🎉 Announcement broadcasted successfully! ID: ' + (data.announcement?.id || 'Published'));
          resetForm();
          loadHistory();
        }
      } catch (err) {
        alert('Failed to broadcast: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerText = '🚀 Broadcast Announcement Now';
      }
    }

    // Load History
    async function loadHistory() {
      const grid = document.getElementById('historyGrid');
      grid.innerHTML = '<div style="color:var(--text-muted); font-size:13px; grid-column:1/-1;">Loading past announcements...</div>';

      try {
        const response = await fetch('/functions/v1/announcements?app_id=anymex&limit=30');
        const data = await response.json();

        if (!response.ok || !data.announcements) {
          grid.innerHTML = '<div style="color:var(--danger); font-size:13px; grid-column:1/-1;">Failed to load announcements: ' + (data.error || '') + '</div>';
          return;
        }

        if (data.announcements.length === 0) {
          grid.innerHTML = '<div style="color:var(--text-muted); font-size:13px; grid-column:1/-1;">No announcements published yet.</div>';
          return;
        }

        grid.innerHTML = data.announcements.map(ann => {
          const dateStr = ann.published_at ? new Date(ann.published_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Draft';
          const cat = (ann.category || 'general').toUpperCase();

          return '<div class="history-card">' +
            '<div>' +
              '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px">' +
                '<span class="preview-category-tag" style="font-size:9.5px; padding:2px 8px">' + cat + '</span>' +
                '<span style="font-size:11px; color:var(--text-muted)">' + dateStr + '</span>' +
              '</div>' +
              '<div style="font-size:14.5px; font-weight:700; color:#fff; margin-bottom:4px">' + (ann.title || '') + '</div>' +
              '<div style="font-size:12px; color:var(--text-secondary); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">' + (ann.short_description || '') + '</div>' +
            '</div>' +
            '<div style="display:flex; justify-content:space-between; align-items:center; padding-top:8px; border-top:1px solid var(--border-subtle)">' +
              '<span style="font-size:11.5px; color:var(--text-muted)">👁️ ' + (ann.view_count || 0) + ' views</span>' +
              '<button class="btn btn-danger" style="font-size:11px; padding:4px 10px" onclick="deleteAnnouncement(' + ann.id + ')">🗑️ Delete</button>' +
            '</div>' +
          '</div>';
        }).join('');

      } catch (err) {
        grid.innerHTML = '<div style="color:var(--danger); font-size:13px; grid-column:1/-1;">Network error loading history.</div>';
      }
    }

    async function deleteAnnouncement(id) {
      const key = localStorage.getItem('anymex_admin_key');
      if (!key) {
        alert('You must provide your Admin Key to delete announcements.');
        openAuthModal();
        return;
      }

      if (!confirm('Are you sure you want to delete announcement #' + id + '? This cannot be undone.')) {
        return;
      }

      try {
        const response = await fetch('/functions/v1/announcements/' + id, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-key': key
          },
          body: JSON.stringify({ admin_key: key })
        });

        const data = await response.json();
        if (!response.ok || data.error) {
          alert('Failed to delete: ' + (data.error || response.statusText));
        } else {
          alert('Announcement deleted.');
          loadHistory();
        }
      } catch (err) {
        alert('Delete failed: ' + err.message);
      }
    }

    // Initial on-load checks
    window.addEventListener('DOMContentLoaded', () => {
      checkAuth();
      updatePreview();
      loadHistory();
      if (!localStorage.getItem('anymex_admin_key')) {
        setTimeout(openAuthModal, 800);
      }
    });
  </script>
</body>
</html>`;
}
