// Dashboard HTML/CSS/JS renderer for AnymeX Announcements Studio
// Complete dark glassmorphic UI with PBKDF2 Master Owner Auth, Staff Management, and Markdown Editor
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
      background: rgba(14, 16, 26, 0.85);
      backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--border-subtle);
      padding: 14px 28px;
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

    .header-right {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .user-profile-badge {
      display: flex;
      align-items: center;
      gap: 10px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border-subtle);
      padding: 5px 12px 5px 6px;
      border-radius: 24px;
    }

    .user-avatar {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: linear-gradient(135deg, #f59e0b, #ef4444);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 700;
      color: white;
      overflow: hidden;
    }

    .user-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .user-name-text {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .role-badge {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 2px 8px;
      border-radius: 12px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .role-owner {
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.2), rgba(217, 119, 6, 0.3));
      border: 1px solid rgba(245, 158, 11, 0.5);
      color: #fbbf24;
    }

    .role-super_admin {
      background: linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(99, 102, 241, 0.3));
      border: 1px solid rgba(139, 92, 246, 0.5);
      color: #c084fc;
    }

    .role-admin {
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(37, 99, 235, 0.3));
      border: 1px solid rgba(59, 130, 246, 0.5);
      color: #60a5fa;
    }

    .role-moderator {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(5, 150, 105, 0.3));
      border: 1px solid rgba(16, 185, 129, 0.5);
      color: #34d399;
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
      text-decoration: none;
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
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }

    .btn-danger:hover {
      background: rgba(239, 68, 68, 0.25);
    }

    .btn-success {
      background: linear-gradient(135deg, #10b981, #059669);
      color: white;
    }

    .btn-gold {
      background: linear-gradient(135deg, #f59e0b, #d97706);
      color: white;
      box-shadow: 0 4px 14px rgba(245, 158, 11, 0.3);
    }

    .btn-sm {
      padding: 5px 10px;
      font-size: 12px;
      border-radius: 8px;
    }

    main {
      flex: 1;
      max-width: 1480px;
      width: 100%;
      margin: 0 auto;
      padding: 24px;
      display: grid;
      grid-template-columns: 1.15fr 1fr;
      gap: 24px;
    }

    @media (max-width: 1024px) {
      main {
        grid-template-columns: 1fr;
      }
    }

    .panel {
      background: var(--bg-surface);
      backdrop-filter: blur(16px);
      border: 1px solid var(--border-subtle);
      border-radius: 16px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
    }

    .panel-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border-subtle);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(255, 255, 255, 0.02);
    }

    .panel-title {
      font-family: 'Outfit', sans-serif;
      font-size: 16px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .panel-body {
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      flex: 1;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .form-label {
      font-size: 12.5px;
      font-weight: 600;
      color: var(--text-secondary);
      display: flex;
      justify-content: space-between;
    }

    .form-control {
      background: rgba(14, 16, 26, 0.7);
      border: 1px solid var(--border-subtle);
      border-radius: 10px;
      padding: 10px 14px;
      color: var(--text-primary);
      font-family: inherit;
      font-size: 14px;
      transition: all 0.2s ease;
      outline: none;
      width: 100%;
    }

    .form-control:focus {
      border-color: var(--border-focus);
      box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.15);
      background: rgba(18, 20, 32, 0.9);
    }

    textarea.form-control {
      resize: vertical;
      min-height: 180px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13.5px;
      line-height: 1.6;
    }

    .categories-bar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .category-pill {
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border-subtle);
      color: var(--text-secondary);
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .category-pill.active {
      background: rgba(139, 92, 246, 0.2);
      border-color: var(--primary);
      color: #d8b4fe;
      box-shadow: 0 2px 10px var(--primary-glow);
    }

    .editor-toolbar {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      padding: 8px 12px;
      background: rgba(14, 16, 26, 0.6);
      border: 1px solid var(--border-subtle);
      border-radius: 10px;
      align-items: center;
    }

    .tool-btn {
      background: transparent;
      border: none;
      color: var(--text-secondary);
      padding: 5px 8px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-family: inherit;
      font-weight: 600;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .tool-btn:hover {
      background: rgba(255, 255, 255, 0.08);
      color: var(--text-primary);
    }

    .tool-divider {
      width: 1px;
      height: 18px;
      background: var(--border-subtle);
      margin: 0 2px;
    }

    /* Preview Card */
    .preview-card {
      background: #131520;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .preview-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }

    .preview-category-tag {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      padding: 3px 10px;
      border-radius: 20px;
      background: rgba(139, 92, 246, 0.2);
      border: 1px solid var(--primary);
      color: #c084fc;
    }

    .preview-title {
      font-size: 18px;
      font-weight: 700;
      color: #ffffff;
      line-height: 1.3;
      font-family: 'Outfit', sans-serif;
    }

    .preview-meta {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 12px;
      color: var(--text-muted);
    }

    .preview-content {
      font-size: 14px;
      line-height: 1.7;
      color: #e2e8f0;
      overflow-wrap: break-word;
      border-top: 1px solid var(--border-subtle);
      padding-top: 14px;
    }

    .preview-content h1, .preview-content h2, .preview-content h3 {
      color: #fff;
      margin-top: 16px;
      margin-bottom: 8px;
      font-family: 'Outfit', sans-serif;
    }

    .preview-content p {
      margin-bottom: 12px;
    }

    .preview-content img {
      max-width: 100%;
      border-radius: 10px;
      margin: 10px 0;
      border: 1px solid var(--border-subtle);
    }

    .preview-content a {
      color: #818cf8;
      text-decoration: underline;
    }

    .preview-content blockquote {
      border-left: 3px solid var(--primary);
      padding-left: 12px;
      margin: 10px 0;
      color: var(--text-secondary);
      font-style: italic;
    }

    .preview-content code {
      background: rgba(255, 255, 255, 0.08);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
    }

    .preview-content pre {
      background: rgba(0, 0, 0, 0.4);
      padding: 12px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 10px 0;
    }

    .preview-content pre code {
      background: transparent;
      padding: 0;
    }

    .spoiler {
      background: #232736;
      color: #232736;
      padding: 2px 6px;
      border-radius: 4px;
      cursor: pointer;
      user-select: none;
      transition: all 0.2s ease;
    }

    .spoiler.revealed {
      background: rgba(255, 255, 255, 0.1);
      color: #f8fafc;
    }

    /* Modal Styling */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(8px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 20px;
    }

    .modal-overlay.active {
      display: flex;
    }

    .modal-card {
      background: #141726;
      border: 1px solid var(--border-subtle);
      border-radius: 18px;
      max-width: 580px;
      width: 100%;
      overflow: hidden;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
      animation: modalFadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .modal-card.modal-lg {
      max-width: 820px;
    }

    @keyframes modalFadeIn {
      from { opacity: 0; transform: scale(0.96) translateY(10px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }

    .modal-header {
      padding: 18px 24px;
      border-bottom: 1px solid var(--border-subtle);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(255, 255, 255, 0.02);
    }

    .modal-title {
      font-family: 'Outfit', sans-serif;
      font-size: 18px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .modal-body {
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      max-height: 75vh;
      overflow-y: auto;
    }

    .modal-footer {
      padding: 16px 24px;
      border-top: 1px solid var(--border-subtle);
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      background: rgba(0, 0, 0, 0.2);
    }

    .close-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      font-size: 20px;
      cursor: pointer;
      line-height: 1;
    }

    .close-btn:hover {
      color: var(--text-primary);
    }

    /* History Cards */
    .history-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
      max-height: 380px;
      overflow-y: auto;
      padding-right: 4px;
    }

    .history-card {
      background: rgba(14, 16, 26, 0.6);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      transition: all 0.2s ease;
    }

    .history-card:hover {
      border-color: rgba(255, 255, 255, 0.2);
      background: rgba(20, 23, 38, 0.8);
    }

    /* Staff Table */
    .staff-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    .staff-table th {
      text-align: left;
      padding: 10px 14px;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border-subtle);
      font-size: 11.5px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .staff-table td {
      padding: 12px 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      vertical-align: middle;
    }

    .staff-table tr:hover td {
      background: rgba(255, 255, 255, 0.02);
    }

    /* Password Generator Box */
    .pass-gen-box {
      background: rgba(139, 92, 246, 0.08);
      border: 1px solid rgba(139, 92, 246, 0.25);
      border-radius: 10px;
      padding: 12px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .pass-code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 14px;
      color: #c084fc;
      font-weight: 600;
      letter-spacing: 0.5px;
    }
  </style>
</head>
<body>

  <!-- Top Header Navigation -->
  <header>
    <div class="logo-group">
      <div class="logo-badge">📢</div>
      <div>
        <div class="brand-title">AnymeX Studio</div>
        <div class="brand-sub">Announcement Broadcast & Staff Center</div>
      </div>
    </div>

    <div class="header-right">
      <button class="btn btn-secondary btn-sm" id="manageStaffBtn" style="display:none;" onclick="openStaffModal()">
        👥 Staff Management
      </button>

      <div class="user-profile-badge" id="userProfileBadge" style="display:none;">
        <div class="user-avatar" id="headerAvatar">S</div>
        <div class="user-name-text" id="headerUsername">Sheby</div>
        <span class="role-badge role-owner" id="headerRoleBadge">👑 OWNER</span>
        <button class="btn btn-secondary btn-sm" style="padding:3px 8px; margin-left:4px;" onclick="handleLogout()" title="Log out">
          🚪
        </button>
      </div>

      <button class="btn btn-primary btn-sm" id="loginBtnHeader" onclick="openLoginModal()">
        🔐 Log In
      </button>
    </div>
  </header>

  <!-- Main Content Grid -->
  <main>
    <!-- Left Composer Panel -->
    <section class="panel">
      <div class="panel-header">
        <div class="panel-title">✏️ Announcement Composer</div>
        <button class="btn btn-secondary btn-sm" onclick="resetForm()">Clear</button>
      </div>

      <div class="panel-body">
        <!-- Target Category -->
        <div class="form-group">
          <label class="form-label">Announcement Category</label>
          <div class="categories-bar">
            <div class="category-pill active" onclick="setCategory(this, 'general')">📢 General</div>
            <div class="category-pill" onclick="setCategory(this, 'update')">🚀 Update</div>
            <div class="category-pill" onclick="setCategory(this, 'feature')">✨ Feature</div>
            <div class="category-pill" onclick="setCategory(this, 'bugfix')">🔧 Bug Fix</div>
            <div class="category-pill" onclick="setCategory(this, 'maintenance')">🛠️ Maintenance</div>
            <div class="category-pill" onclick="setCategory(this, 'warning')">⚠️ Alert</div>
          </div>
        </div>

        <!-- Title -->
        <div class="form-group">
          <label class="form-label">Announcement Title</label>
          <input type="text" id="annTitle" class="form-control" placeholder="e.g., AnymeX v2.4.0 is now live!" oninput="updatePreview()" maxlength="200">
        </div>

        <!-- Short Description / Notification Text -->
        <div class="form-group">
          <label class="form-label">
            <span>Summary / Push Notification Preview</span>
            <span style="font-size:11px; color:var(--text-muted)">Max 500 chars</span>
          </label>
          <input type="text" id="annShortDesc" class="form-control" placeholder="Short description displayed on lock screen and cards..." oninput="updatePreview()" maxlength="500">
        </div>

        <!-- Markdown Formatting Toolbar -->
        <div class="form-group">
          <label class="form-label">Markdown Content</label>
          <div class="editor-toolbar">
            <button type="button" class="tool-btn" onclick="insertSyntax('**', '**')" title="Bold"><b>B</b></button>
            <button type="button" class="tool-btn" onclick="insertSyntax('*', '*')" title="Italic"><i>I</i></button>
            <button type="button" class="tool-btn" onclick="insertSyntax('~~', '~~')" title="Strikethrough"><s>S</s></button>
            <button type="button" class="tool-btn" onclick="insertHeading()" title="Heading">H2</button>
            <div class="tool-divider"></div>
            <button type="button" class="tool-btn" onclick="insertSyntax('- ', '')" title="Bullet List">• List</button>
            <button type="button" class="tool-btn" onclick="insertSyntax('> ', '')" title="Quote">❞ Quote</button>
            <button type="button" class="tool-btn" onclick="insertSyntax('||', '||')" title="Spoiler">👁️ Spoiler</button>
            <button type="button" class="tool-btn" onclick="insertCodeBlock()" title="Code Block">&lt;/&gt; Code</button>
            <div class="tool-divider"></div>
            <button type="button" class="tool-btn" onclick="openLinkModal()" title="Insert Link">🔗 Link</button>
            <button type="button" class="tool-btn" onclick="openMediaModal('image')" title="Insert Image">🖼️ Image</button>
            <button type="button" class="tool-btn" onclick="openMediaModal('gif')" title="Insert Anime GIF">🎬 Anime GIF</button>
          </div>
          <textarea id="annContent" class="form-control" placeholder="Write your full announcement markdown here... You can use headings, lists, spoilers (||text||), images, GIFs, and links!" oninput="updatePreview()"></textarea>
        </div>

        <!-- Pin & Broadcast Options -->
        <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 14px; background:rgba(255,255,255,0.02); border-radius:10px; border:1px solid var(--border-subtle);">
          <label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:500; cursor:pointer;">
            <input type="checkbox" id="pinAnnouncementCheck">
            📌 Pin to top of announcements list
          </label>
          <label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:500; cursor:pointer;">
            <input type="checkbox" id="sendPushCheck" checked>
            🔔 Send FCM Push Notification to all users
          </label>
        </div>

        <button id="broadcastBtn" class="btn btn-primary" style="padding:14px; font-size:15px; justify-content:center; margin-top:4px;" onclick="confirmBroadcast()">
          🚀 Broadcast Announcement Now
        </button>
      </div>
    </section>

    <!-- Right Live Preview & History Panel -->
    <div style="display:flex; flex-direction:column; gap:24px;">
      <!-- Live Mobile App Preview -->
      <section class="panel">
        <div class="panel-header">
          <div class="panel-title">📱 Live In-App Preview</div>
          <span style="font-size:11.5px; color:var(--text-muted)">Real-time mobile view</span>
        </div>

        <div class="panel-body">
          <div class="preview-card">
            <div class="preview-header">
              <span class="preview-category-tag" id="previewTag">GENERAL</span>
              <span style="font-size:11.5px; color:var(--text-muted);">Just now</span>
            </div>
            <div class="preview-title" id="previewTitle">AnymeX Announcement Title</div>
            <div class="preview-meta">
              <span id="previewAuthor">👤 Sheby (Owner)</span>
              <span>•</span>
              <span>AnymeX Official</span>
            </div>
            <div class="preview-content" id="previewBody">
              Your formatted message, images, and GIFs will appear here in real time...
            </div>
          </div>

          <!-- Notification Banner Preview -->
          <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border-subtle); border-radius:12px; padding:12px 14px; display:flex; gap:12px; align-items:center;">
            <div style="font-size:24px;">🔔</div>
            <div style="flex:1;">
              <div style="font-size:11px; color:var(--text-muted); font-weight:600; text-transform:uppercase;">Lock Screen Push Notification</div>
              <div id="notifTitlePreview" style="font-size:13px; font-weight:700; color:#fff;">AnymeX Announcement</div>
              <div id="notifBodyPreview" style="font-size:12px; color:var(--text-secondary);">Notification preview summary...</div>
            </div>
          </div>
        </div>
      </section>

      <!-- Broadcast History -->
      <section class="panel">
        <div class="panel-header">
          <div class="panel-title">📜 Broadcast History</div>
          <button class="btn btn-secondary btn-sm" onclick="loadHistory()">🔄 Refresh</button>
        </div>

        <div class="panel-body">
          <div class="history-grid" id="historyGrid">
            <div style="color:var(--text-muted); font-size:13px;">Loading history...</div>
          </div>
        </div>
      </section>
    </div>
  </main>

  <!-- Modal 1: Master Owner First-Time Setup -->
  <div class="modal-overlay" id="setupModal">
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title">👑 Welcome Sheby! Master Owner Setup</div>
      </div>
      <div class="modal-body">
        <p style="font-size:13.5px; color:var(--text-secondary); line-height:1.5;">
          No master account has been initialized yet. Set up your Master Owner account now to unlock the Announcement Studio and manage staff. Your password is securely salted and hashed using NIST PBKDF2 (100,000 iterations).
        </p>

        <div class="form-group">
          <label class="form-label">Master Username</label>
          <input type="text" id="setupUsername" class="form-control" value="Sheby" readonly style="opacity:0.85;">
        </div>

        <div class="form-group">
          <label class="form-label">Master Display Name</label>
          <input type="text" id="setupDisplayName" class="form-control" value="Sheby">
        </div>

        <div class="form-group">
          <label class="form-label">Linked AniList User ID</label>
          <input type="text" id="setupLinkedId" class="form-control" value="5724017">
          <span style="font-size:11px; color:var(--text-muted);">Links to your AniList profile and automatically grants Owner role in AnymeX comment system.</span>
        </div>

        <div class="form-group">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <label class="form-label" style="margin-bottom:0;">Set Strong Password</label>
            <button type="button" class="btn btn-secondary btn-sm" onclick="generateSetupPassword()">🎲 Generate Strong Password</button>
          </div>
          <input type="password" id="setupPassword" class="form-control" placeholder="Enter at least 8 characters..." style="margin-top:6px;">
        </div>

        <div class="pass-gen-box" id="passGenBox" style="display:none;">
          <div>
            <div style="font-size:11px; color:var(--text-muted);">Generated Password:</div>
            <div class="pass-code" id="genPasswordDisplay">...</div>
          </div>
          <button type="button" class="btn btn-primary btn-sm" onclick="copyGenPassword()">📋 Copy</button>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-gold" id="submitSetupBtn" onclick="submitMasterSetup()" style="width:100%; justify-content:center; padding:12px;">
          🚀 Initialize Master Account
        </button>
      </div>
    </div>
  </div>

  <!-- Modal 2: Regular Staff Login -->
  <div class="modal-overlay" id="loginModal">
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title">🔐 Studio Staff Login</div>
        <button class="close-btn" onclick="closeLoginModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Username</label>
          <input type="text" id="loginUsername" class="form-control" placeholder="e.g., Sheby" autofocus>
        </div>
        <div class="form-group">
          <label class="form-label">Password</label>
          <input type="password" id="loginPassword" class="form-control" placeholder="Enter your password" onkeydown="if(event.key==='Enter') submitLogin()">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeLoginModal()">Cancel</button>
        <button class="btn btn-primary" id="submitLoginBtn" onclick="submitLogin()">Log In</button>
      </div>
    </div>
  </div>

  <!-- Modal 3: Staff Management Panel -->
  <div class="modal-overlay" id="staffModal">
    <div class="modal-card modal-lg">
      <div class="modal-header">
        <div class="modal-title">👥 Staff & Team Management</div>
        <button class="close-btn" onclick="closeStaffModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="font-size:13px; color:var(--text-secondary);">Manage moderators and administrators who can access this studio and AnymeX.</div>
          <button class="btn btn-primary btn-sm" onclick="openAddStaffForm()">➕ Add Staff Member</button>
        </div>

        <!-- Add Staff Inline Form -->
        <div id="addStaffForm" style="display:none; background:rgba(255,255,255,0.03); border:1px solid var(--border-focus); border-radius:12px; padding:16px; margin-top:8px;">
          <div style="font-weight:700; font-size:14px; margin-bottom:12px;">Create New Staff Account</div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div class="form-group">
              <label class="form-label">Username (for login)</label>
              <input type="text" id="newStaffUsername" class="form-control" placeholder="e.g. mod_alex">
            </div>
            <div class="form-group">
              <label class="form-label">Role</label>
              <select id="newStaffRole" class="form-control">
                <option value="moderator">Moderator (Can create drafts)</option>
                <option value="admin">Admin (Can broadcast announcements)</option>
                <option value="super_admin">Super Admin (Can manage staff)</option>
              </select>
            </div>
            <div class="form-group">
              <div style="display:flex; justify-content:space-between;">
                <label class="form-label">Password</label>
                <a href="#" onclick="generateStaffPassword(); return false;" style="font-size:11px; color:#c084fc;">🎲 Generate</a>
              </div>
              <input type="text" id="newStaffPassword" class="form-control" placeholder="At least 6 characters">
            </div>
            <div class="form-group">
              <label class="form-label">Display Name</label>
              <input type="text" id="newStaffDisplayName" class="form-control" placeholder="e.g. Alex">
            </div>
            <div class="form-group">
              <label class="form-label">Link Provider (Optional)</label>
              <select id="newStaffClientType" class="form-control">
                <option value="anilist">AniList</option>
                <option value="myanimelist">MyAnimeList</option>
                <option value="simkl">Simkl</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Linked User ID (Optional)</label>
              <input type="text" id="newStaffLinkedId" class="form-control" placeholder="e.g. 5724017">
            </div>
          </div>
          <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:14px;">
            <button class="btn btn-secondary btn-sm" onclick="closeAddStaffForm()">Cancel</button>
            <button class="btn btn-success btn-sm" onclick="submitCreateStaff()">Save Staff Member</button>
          </div>
        </div>

        <!-- Staff Table List -->
        <div style="overflow-x:auto; margin-top:8px;">
          <table class="staff-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Linked Account</th>
                <th>Created</th>
                <th style="text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody id="staffTableBody">
              <tr><td colspan="5" style="text-align:center; color:var(--text-muted);">Loading team members...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeStaffModal()">Close</button>
      </div>
    </div>
  </div>

  <!-- Modal 4: Media (Image/GIF) -->
  <div class="modal-overlay" id="mediaModal">
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title" id="mediaModalTitle">🖼️ Insert Media</div>
        <button class="close-btn" onclick="closeMediaModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Image or GIF URL</label>
          <input type="url" id="mediaUrlInput" class="form-control" placeholder="https://example.com/banner.gif" oninput="testMediaPreview()">
        </div>
        <div class="form-group">
          <label class="form-label">Alt / Caption Text</label>
          <input type="text" id="mediaAltInput" class="form-control" placeholder="e.g., Update Banner">
        </div>
        <!-- Quick Anime GIFs -->
        <div id="mediaQuickGifs" style="display:none; flex-direction:column; gap:8px;">
          <label class="form-label">Quick Anime GIFs</label>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="setQuickGif('https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif', 'Excited Anime')">🎉 Celebration</button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="setQuickGif('https://media.giphy.com/media/11ISw6Cx80Vs54942x/giphy.gif', 'Anime Hype')">🔥 Hype</button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="setQuickGif('https://media.giphy.com/media/xT9IgzoKnwFNmISR8I/giphy.gif', 'Notice')">📢 Notice</button>
          </div>
        </div>
        <div id="mediaPreviewArea" style="display:none; text-align:center;">
          <img id="mediaPreviewImg" src="" style="max-height:160px; border-radius:8px; border:1px solid var(--border-subtle);">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeMediaModal()">Cancel</button>
        <button class="btn btn-primary" onclick="confirmInsertMedia()">Insert into Markdown</button>
      </div>
    </div>
  </div>

  <!-- Modal 5: Insert Link -->
  <div class="modal-overlay" id="linkModal">
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title">🔗 Insert Hyperlink</div>
        <button class="close-btn" onclick="closeLinkModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Link Text</label>
          <input type="text" id="linkTextInput" class="form-control" placeholder="e.g., Download Update">
        </div>
        <div class="form-group">
          <label class="form-label">Destination URL</label>
          <input type="url" id="linkUrlInput" class="form-control" placeholder="https://github.com/Shebyyy/AnymeX/releases">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeLinkModal()">Cancel</button>
        <button class="btn btn-primary" onclick="confirmInsertLink()">Insert Link</button>
      </div>
    </div>
  </div>

  <script>
    let currentCategory = 'general';
    let currentMediaType = 'image';
    let currentUser = null;

    // Password generator helper
    function generateSecureString(len = 16) {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*';
      const arr = new Uint8Array(len);
      window.crypto.getRandomValues(arr);
      return Array.from(arr).map(x => chars[x % chars.length]).join('');
    }

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

      if (currentUser) {
        document.getElementById('previewAuthor').innerText = '👤 ' + (currentUser.display_name || currentUser.username) + ' (' + currentUser.role.toUpperCase() + ')';
      }

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

    // Markdown Toolbar Helpers
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

    // Modals
    function openLoginModal() {
      document.getElementById('loginModal').classList.add('active');
    }

    function closeLoginModal() {
      document.getElementById('loginModal').classList.remove('active');
    }

    function openSetupModal() {
      document.getElementById('setupModal').classList.add('active');
    }

    function closeSetupModal() {
      document.getElementById('setupModal').classList.remove('active');
    }

    function generateSetupPassword() {
      const pass = generateSecureString(16);
      document.getElementById('setupPassword').value = pass;
      document.getElementById('genPasswordDisplay').innerText = pass;
      document.getElementById('passGenBox').style.display = 'flex';
    }

    function copyGenPassword() {
      const text = document.getElementById('genPasswordDisplay').innerText;
      navigator.clipboard.writeText(text).then(() => {
        alert('Password copied to clipboard! Keep it safe.');
      });
    }

    // Auth API
    async function checkAuthStatus() {
      const token = localStorage.getItem('anymex_session_token');
      try {
        const headers = {};
        if (token) headers['Authorization'] = 'Bearer ' + token;

        const res = await fetch('/functions/v1/announcements/auth/status', { headers });
        const data = await res.json();

        if (data.needs_setup) {
          openSetupModal();
          return;
        }

        if (data.authenticated && data.user) {
          currentUser = data.user;
          updateHeaderUserUI(data.user);
        } else {
          // Show login modal
          currentUser = null;
          updateHeaderGuestUI();
          if (!token) {
            setTimeout(openLoginModal, 500);
          }
        }
      } catch (err) {
        console.error('Failed to check auth status:', err);
      }
    }

    function updateHeaderUserUI(user) {
      document.getElementById('userProfileBadge').style.display = 'flex';
      document.getElementById('loginBtnHeader').style.display = 'none';

      document.getElementById('headerUsername').innerText = user.display_name || user.username;
      document.getElementById('headerAvatar').innerText = (user.display_name || user.username).charAt(0).toUpperCase();

      const roleBadge = document.getElementById('headerRoleBadge');
      roleBadge.className = 'role-badge role-' + user.role;
      const roleIcons = { owner: '👑', super_admin: '⚡', admin: '🛡️', moderator: '🎯' };
      roleBadge.innerText = (roleIcons[user.role] || '') + ' ' + user.role.toUpperCase().replace('_', ' ');

      if (user.role === 'owner' || user.role === 'super_admin') {
        document.getElementById('manageStaffBtn').style.display = 'inline-flex';
      } else {
        document.getElementById('manageStaffBtn').style.display = 'none';
      }

      updatePreview();
    }

    function updateHeaderGuestUI() {
      document.getElementById('userProfileBadge').style.display = 'none';
      document.getElementById('loginBtnHeader').style.display = 'inline-flex';
      document.getElementById('manageStaffBtn').style.display = 'none';
    }

    async function submitMasterSetup() {
      const username = document.getElementById('setupUsername').value.trim();
      const displayName = document.getElementById('setupDisplayName').value.trim();
      const linkedId = document.getElementById('setupLinkedId').value.trim();
      const password = document.getElementById('setupPassword').value;

      if (!password || password.length < 6) {
        alert('Password must be at least 6 characters long.');
        return;
      }

      const btn = document.getElementById('submitSetupBtn');
      btn.disabled = true;
      btn.innerText = 'Initializing...';

      try {
        const res = await fetch('/functions/v1/announcements/auth/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: username || 'Sheby',
            display_name: displayName || 'Sheby',
            linked_user_id: linkedId || '5724017',
            linked_client_type: 'anilist',
            password: password
          })
        });

        const data = await res.json();
        if (!res.ok || data.error) {
          alert('Setup failed: ' + (data.error || res.statusText));
        } else {
          localStorage.setItem('anymex_session_token', data.token);
          currentUser = data.user;
          updateHeaderUserUI(data.user);
          closeSetupModal();
          alert('🎉 Master Owner account initialized successfully! Welcome, Sheby.');
          loadHistory();
        }
      } catch (err) {
        alert('Network error during setup: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerText = '🚀 Initialize Master Account';
      }
    }

    async function submitLogin() {
      const username = document.getElementById('loginUsername').value.trim();
      const password = document.getElementById('loginPassword').value;

      if (!username || !password) {
        alert('Please enter your username and password.');
        return;
      }

      const btn = document.getElementById('submitLoginBtn');
      btn.disabled = true;
      btn.innerText = 'Logging in...';

      try {
        const res = await fetch('/functions/v1/announcements/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });

        const data = await res.json();
        if (!res.ok || data.error) {
          alert('Login failed: ' + (data.error || 'Invalid credentials'));
        } else {
          localStorage.setItem('anymex_session_token', data.token);
          currentUser = data.user;
          updateHeaderUserUI(data.user);
          closeLoginModal();
          loadHistory();
        }
      } catch (err) {
        alert('Network error during login: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerText = 'Log In';
      }
    }

    async function handleLogout() {
      if (!confirm('Are you sure you want to log out?')) return;
      const token = localStorage.getItem('anymex_session_token');
      try {
        if (token) {
          await fetch('/functions/v1/announcements/auth/logout', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token }
          });
        }
      } catch (_) {}

      localStorage.removeItem('anymex_session_token');
      currentUser = null;
      updateHeaderGuestUI();
      openLoginModal();
    }

    // Staff Management API
    function openStaffModal() {
      document.getElementById('staffModal').classList.add('active');
      loadStaffList();
    }

    function closeStaffModal() {
      document.getElementById('staffModal').classList.remove('active');
    }

    function openAddStaffForm() {
      document.getElementById('addStaffForm').style.display = 'block';
    }

    function closeAddStaffForm() {
      document.getElementById('addStaffForm').style.display = 'none';
      document.getElementById('newStaffUsername').value = '';
      document.getElementById('newStaffPassword').value = '';
      document.getElementById('newStaffDisplayName').value = '';
      document.getElementById('newStaffLinkedId').value = '';
    }

    function generateStaffPassword() {
      const pass = generateSecureString(12);
      document.getElementById('newStaffPassword').value = pass;
    }

    async function loadStaffList() {
      const token = localStorage.getItem('anymex_session_token');
      const tbody = document.getElementById('staffTableBody');
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">Loading staff members...</td></tr>';

      try {
        const res = await fetch('/functions/v1/announcements/staff', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await res.json();

        if (!res.ok || !data.staff) {
          tbody.innerHTML = '<tr><td colspan="5" style="color:var(--danger); text-align:center;">Failed to load staff: ' + (data.error || '') + '</td></tr>';
          return;
        }

        const roleBadges = {
          owner: '<span class="role-badge role-owner">👑 OWNER</span>',
          super_admin: '<span class="role-badge role-super_admin">⚡ SUPER ADMIN</span>',
          admin: '<span class="role-badge role-admin">🛡️ ADMIN</span>',
          moderator: '<span class="role-badge role-moderator">🎯 MOD</span>'
        };

        tbody.innerHTML = data.staff.map(member => {
          const linkedText = member.linked_user_id ? (member.linked_client_type || 'anilist') + ': ' + member.linked_user_id : '<span style="color:var(--text-muted)">None</span>';
          const createdStr = member.created_at ? new Date(member.created_at).toLocaleDateString() : '-';
          const isOwner = member.role === 'owner';

          return '<tr>' +
            '<td>' +
              '<div style="font-weight:600; color:#fff;">' + (member.display_name || member.username) + '</div>' +
              '<div style="font-size:11px; color:var(--text-muted);">@' + member.username + '</div>' +
            '</td>' +
            '<td>' + (roleBadges[member.role] || member.role) + '</td>' +
            '<td>' + linkedText + '</td>' +
            '<td style="color:var(--text-muted); font-size:12px;">' + createdStr + '</td>' +
            '<td style="text-align:right;">' +
              (isOwner ? '<span style="font-size:11px; color:var(--text-muted)">Master</span>' : '<button class="btn btn-danger btn-sm" onclick="deleteStaffMember(' + member.id + ', \\'' + member.username + '\\')">🗑️ Remove</button>') +
            '</td>' +
          '</tr>';
        }).join('');

      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="5" style="color:var(--danger); text-align:center;">Error loading staff.</td></tr>';
      }
    }

    async function submitCreateStaff() {
      const username = document.getElementById('newStaffUsername').value.trim();
      const role = document.getElementById('newStaffRole').value;
      const password = document.getElementById('newStaffPassword').value;
      const displayName = document.getElementById('newStaffDisplayName').value.trim();
      const clientType = document.getElementById('newStaffClientType').value;
      const linkedId = document.getElementById('newStaffLinkedId').value.trim();

      if (!username || !password) {
        alert('Please provide username and password.');
        return;
      }

      const token = localStorage.getItem('anymex_session_token');
      try {
        const res = await fetch('/functions/v1/announcements/staff', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          body: JSON.stringify({
            username,
            role,
            password,
            display_name: displayName || username,
            linked_client_type: clientType,
            linked_user_id: linkedId || undefined
          })
        });

        const data = await res.json();
        if (!res.ok || data.error) {
          alert('Failed to add staff member: ' + (data.error || res.statusText));
        } else {
          alert('Staff member @' + username + ' added successfully!');
          closeAddStaffForm();
          loadStaffList();
        }
      } catch (err) {
        alert('Error adding staff member: ' + err.message);
      }
    }

    async function deleteStaffMember(id, username) {
      if (!confirm('Are you sure you want to remove staff member @' + username + '?')) return;
      const token = localStorage.getItem('anymex_session_token');

      try {
        const res = await fetch('/functions/v1/announcements/staff/' + id, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await res.json();

        if (!res.ok || data.error) {
          alert('Failed to remove staff: ' + (data.error || res.statusText));
        } else {
          alert('Staff member removed.');
          loadStaffList();
        }
      } catch (err) {
        alert('Error removing staff: ' + err.message);
      }
    }

    // Media & Link Modals
    function openMediaModal(type) {
      currentMediaType = type;
      document.getElementById('mediaModalTitle').innerText = type === 'gif' ? '🎬 Insert Anime GIF' : '🖼️ Insert Image';
      document.getElementById('mediaQuickGifs').style.display = type === 'gif' ? 'flex' : 'none';
      document.getElementById('mediaUrlInput').value = '';
      document.getElementById('mediaAltInput').value = type === 'gif' ? 'Anime GIF' : 'Image';
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
      const token = localStorage.getItem('anymex_session_token');
      if (!token) {
        alert('You must be logged in to broadcast announcements.');
        openLoginModal();
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

      const confirmMsg = '🚀 Broadcast this announcement?\\n\\n' +
        '• Title: ' + title + '\\n' +
        '• Category: ' + currentCategory.toUpperCase() + '\\n' +
        '• Push Notification: ' + (sendPush ? 'YES (Broadcasting to active devices)' : 'NO');

      if (!confirm(confirmMsg)) return;

      const btn = document.getElementById('broadcastBtn');
      btn.disabled = true;
      btn.innerText = 'Broadcasting...';

      try {
        const response = await fetch('/functions/v1/announcements', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          body: JSON.stringify({
            app_id: 'anymex',
            title: title,
            short_description: shortDesc,
            full_content: content,
            category: currentCategory,
            pinned: isPinned,
            priority: 1,
            publish: true
          })
        });

        const data = await response.json();

        if (!response.ok || data.error) {
          alert('Error broadcasting: ' + (data.error || response.statusText));
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
      grid.innerHTML = '<div style="color:var(--text-muted); font-size:13px; grid-column:1/-1;">Loading announcements...</div>';

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
      const token = localStorage.getItem('anymex_session_token');
      if (!token) {
        alert('You must be logged in to delete announcements.');
        openLoginModal();
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
            'Authorization': 'Bearer ' + token
          }
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

    // Initial on-load
    window.addEventListener('DOMContentLoaded', () => {
      checkAuthStatus();
      updatePreview();
      loadHistory();
    });
  </script>
</body>
</html>`;
}
