// Dashboard HTML/CSS/JS renderer for AnymeX Announcements Studio
// Complete dark glassmorphic UI with zero emojis, SVG icons, Account Settings, and Delivery/Reader Analytics
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
      --bg-primary: #07080d;
      --bg-surface: rgba(15, 17, 26, 0.78);
      --bg-surface-elevated: rgba(22, 26, 40, 0.9);
      --border-subtle: rgba(255, 255, 255, 0.08);
      --border-hover: rgba(255, 255, 255, 0.16);
      --border-focus: rgba(139, 92, 246, 0.55);
      --primary: #8b5cf6;
      --primary-hover: #7c3aed;
      --primary-glow: rgba(139, 92, 246, 0.35);
      --accent: #6366f1;
      --success: #10b981;
      --danger: #ef4444;
      --warning: #f59e0b;
      --info: #0ea5e9;
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
        radial-gradient(circle at 12% 10%, rgba(99, 102, 241, 0.12) 0%, transparent 45%),
        radial-gradient(circle at 88% 90%, rgba(139, 92, 246, 0.12) 0%, transparent 45%),
        radial-gradient(circle at 50% 50%, rgba(14, 165, 233, 0.04) 0%, transparent 60%);
      background-attachment: fixed;
      color: var(--text-primary);
      font-family: 'Inter', sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* SVG Icon utility */
    .icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      vertical-align: middle;
      flex-shrink: 0;
    }
    .icon svg {
      width: 100%;
      height: 100%;
    }

    /* Top Navigation Header */
    header {
      background: rgba(11, 13, 20, 0.88);
      backdrop-filter: blur(20px);
      border-bottom: 1px solid var(--border-subtle);
      padding: 12px 28px;
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
      user-select: none;
    }

    .logo-badge {
      width: 38px;
      height: 38px;
      border-radius: 11px;
      background: linear-gradient(135deg, var(--primary), var(--accent));
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 16px var(--primary-glow);
      color: #ffffff;
    }

    .brand-title {
      font-family: 'Outfit', sans-serif;
      font-size: 19px;
      font-weight: 700;
      letter-spacing: -0.4px;
      line-height: 1.2;
    }

    .brand-sub {
      font-size: 11.5px;
      color: var(--text-muted);
      font-weight: 500;
      letter-spacing: 0.2px;
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .user-profile-badge {
      display: flex;
      align-items: center;
      gap: 10px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border-subtle);
      padding: 4px 12px 4px 5px;
      border-radius: 30px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .user-profile-badge:hover {
      background: rgba(255, 255, 255, 0.08);
      border-color: var(--border-hover);
    }

    .user-avatar {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--primary), var(--accent));
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 700;
      color: white;
      overflow: hidden;
      flex-shrink: 0;
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
      letter-spacing: 0.6px;
      padding: 2px 8px;
      border-radius: 12px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .role-owner {
      background: rgba(245, 158, 11, 0.15);
      border: 1px solid rgba(245, 158, 11, 0.4);
      color: #fbbf24;
    }

    .role-super_admin {
      background: rgba(139, 92, 246, 0.18);
      border: 1px solid rgba(139, 92, 246, 0.45);
      color: #c084fc;
    }

    .role-admin {
      background: rgba(59, 130, 246, 0.15);
      border: 1px solid rgba(59, 130, 246, 0.4);
      color: #60a5fa;
    }

    .role-moderator {
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.4);
      color: #34d399;
    }

    /* Buttons */
    .btn {
      padding: 8px 14px;
      border-radius: 9px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      transition: all 0.18s ease;
      border: 1px solid transparent;
      outline: none;
      text-decoration: none;
      font-family: inherit;
    }

    .btn-primary {
      background: linear-gradient(135deg, var(--primary), var(--accent));
      color: #ffffff;
      box-shadow: 0 4px 14px var(--primary-glow);
    }

    .btn-primary:hover:not(:disabled) {
      opacity: 0.95;
      transform: translateY(-1px);
      box-shadow: 0 6px 20px var(--primary-glow);
    }

    .btn-secondary {
      background: var(--bg-surface-elevated);
      color: var(--text-primary);
      border-color: var(--border-subtle);
    }

    .btn-secondary:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.08);
      border-color: var(--border-hover);
    }

    .btn-danger {
      background: rgba(239, 68, 68, 0.12);
      color: #f87171;
      border-color: rgba(239, 68, 68, 0.28);
    }

    .btn-danger:hover:not(:disabled) {
      background: rgba(239, 68, 68, 0.22);
      border-color: rgba(239, 68, 68, 0.45);
    }

    .btn-success {
      background: linear-gradient(135deg, #10b981, #059669);
      color: white;
    }

    .btn-success:hover:not(:disabled) {
      opacity: 0.95;
      transform: translateY(-1px);
    }

    .btn-gold {
      background: linear-gradient(135deg, #f59e0b, #d97706);
      color: white;
      box-shadow: 0 4px 14px rgba(245, 158, 11, 0.25);
    }

    .btn-sm {
      padding: 5px 10px;
      font-size: 12px;
      border-radius: 7px;
    }

    .btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
      transform: none !important;
    }

    /* Main Grid Layout */
    main {
      flex: 1;
      max-width: 1540px;
      width: 100%;
      margin: 0 auto;
      padding: 22px;
      display: grid;
      grid-template-columns: 1.15fr 1fr;
      gap: 22px;
    }

    @media (max-width: 1100px) {
      main {
        grid-template-columns: 1fr;
      }
    }

    .panel {
      background: var(--bg-surface);
      backdrop-filter: blur(18px);
      border: 1px solid var(--border-subtle);
      border-radius: 16px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
    }

    .panel-header {
      padding: 14px 20px;
      border-bottom: 1px solid var(--border-subtle);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(255, 255, 255, 0.015);
    }

    .panel-title {
      font-family: 'Outfit', sans-serif;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -0.2px;
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

    /* Form Elements */
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .form-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .form-control {
      background: rgba(11, 13, 20, 0.7);
      border: 1px solid var(--border-subtle);
      border-radius: 9px;
      padding: 10px 13px;
      color: var(--text-primary);
      font-family: inherit;
      font-size: 13.5px;
      transition: all 0.18s ease;
      outline: none;
      width: 100%;
    }

    .form-control:focus {
      border-color: var(--border-focus);
      box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.16);
      background: rgba(16, 19, 30, 0.9);
    }

    textarea.form-control {
      resize: vertical;
      min-height: 180px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      line-height: 1.6;
    }

    /* Categories Bar */
    .categories-bar {
      display: flex;
      gap: 7px;
      flex-wrap: wrap;
    }

    .category-pill {
      padding: 6px 13px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border-subtle);
      color: var(--text-secondary);
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      user-select: none;
    }

    .category-pill:hover {
      background: rgba(255, 255, 255, 0.07);
      color: var(--text-primary);
    }

    .category-pill.active {
      background: rgba(139, 92, 246, 0.18);
      border-color: var(--primary);
      color: #d8b4fe;
      box-shadow: 0 2px 10px var(--primary-glow);
    }

    /* Markdown Editor Toolbar */
    .editor-toolbar {
      display: flex;
      gap: 5px;
      flex-wrap: wrap;
      padding: 7px 10px;
      background: rgba(11, 13, 20, 0.65);
      border: 1px solid var(--border-subtle);
      border-radius: 9px;
      align-items: center;
    }

    .tool-btn {
      background: transparent;
      border: none;
      color: var(--text-secondary);
      padding: 5px 8px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12.5px;
      font-family: inherit;
      font-weight: 600;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }

    .tool-btn:hover {
      background: rgba(255, 255, 255, 0.09);
      color: var(--text-primary);
    }

    .tool-divider {
      width: 1px;
      height: 16px;
      background: var(--border-subtle);
      margin: 0 3px;
    }

    /* Preview Card */
    .preview-card {
      background: #10121d;
      border: 1px solid rgba(255, 255, 255, 0.09);
      border-radius: 14px;
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .preview-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
    }

    .preview-category-tag {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.7px;
      text-transform: uppercase;
      padding: 3px 9px;
      border-radius: 16px;
      background: rgba(139, 92, 246, 0.18);
      border: 1px solid var(--primary);
      color: #c084fc;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .preview-title {
      font-size: 17px;
      font-weight: 700;
      color: #ffffff;
      line-height: 1.35;
      font-family: 'Outfit', sans-serif;
    }

    .preview-meta {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 12px;
      color: var(--text-muted);
    }

    .preview-content {
      font-size: 13.5px;
      line-height: 1.65;
      color: #e2e8f0;
      overflow-wrap: break-word;
      border-top: 1px solid var(--border-subtle);
      padding-top: 14px;
    }

    .preview-content h1, .preview-content h2, .preview-content h3 {
      color: #ffffff;
      margin-top: 14px;
      margin-bottom: 6px;
      font-family: 'Outfit', sans-serif;
    }

    .preview-content p {
      margin-bottom: 10px;
    }

    .preview-content img {
      max-width: 100%;
      border-radius: 9px;
      margin: 8px 0;
      border: 1px solid var(--border-subtle);
    }

    .preview-content a {
      color: #818cf8;
      text-decoration: underline;
    }

    .preview-content blockquote {
      border-left: 3px solid var(--primary);
      padding-left: 12px;
      margin: 8px 0;
      color: var(--text-secondary);
      font-style: italic;
    }

    .preview-content code {
      background: rgba(255, 255, 255, 0.08);
      padding: 2px 5px;
      border-radius: 4px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
    }

    .preview-content pre {
      background: rgba(0, 0, 0, 0.45);
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
      background: #1e2233;
      color: #1e2233;
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

    /* Modals */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.78);
      backdrop-filter: blur(10px);
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
      background: #111422;
      border: 1px solid var(--border-subtle);
      border-radius: 18px;
      max-width: 580px;
      width: 100%;
      overflow: hidden;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
      animation: modalFadeIn 0.22s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .modal-card.modal-lg {
      max-width: 860px;
    }

    @keyframes modalFadeIn {
      from { opacity: 0; transform: scale(0.96) translateY(8px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }

    .modal-header {
      padding: 16px 22px;
      border-bottom: 1px solid var(--border-subtle);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(255, 255, 255, 0.015);
    }

    .modal-title {
      font-family: 'Outfit', sans-serif;
      font-size: 17px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .modal-body {
      padding: 22px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      max-height: 76vh;
      overflow-y: auto;
    }

    .modal-footer {
      padding: 14px 22px;
      border-top: 1px solid var(--border-subtle);
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      background: rgba(0, 0, 0, 0.25);
    }

    .close-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 4px;
      border-radius: 6px;
      transition: all 0.15s ease;
    }

    .close-btn:hover {
      color: var(--text-primary);
      background: rgba(255, 255, 255, 0.08);
    }

    /* History & Search Bar */
    .history-controls {
      display: flex;
      gap: 10px;
      align-items: center;
      margin-bottom: 4px;
    }

    .search-input-wrap {
      position: relative;
      flex: 1;
    }

    .search-input-wrap .search-icon {
      position: absolute;
      left: 11px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-muted);
      pointer-events: none;
    }

    .search-input-wrap input {
      padding-left: 34px;
    }

    .history-filter-tabs {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      padding-bottom: 4px;
    }

    .filter-tab {
      font-size: 11px;
      padding: 4px 10px;
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border-subtle);
      color: var(--text-secondary);
      cursor: pointer;
      font-weight: 600;
      white-space: nowrap;
      transition: all 0.15s ease;
    }

    .filter-tab.active {
      background: rgba(139, 92, 246, 0.2);
      border-color: var(--primary);
      color: #c084fc;
    }

    .history-grid {
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-height: 480px;
      overflow-y: auto;
      padding-right: 3px;
    }

    .history-card {
      background: rgba(14, 17, 27, 0.65);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      padding: 13px 15px;
      display: flex;
      flex-direction: column;
      gap: 9px;
      transition: all 0.18s ease;
    }

    .history-card:hover {
      border-color: rgba(255, 255, 255, 0.18);
      background: rgba(19, 23, 38, 0.85);
    }

    .history-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }

    .history-card-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 8px;
      border-top: 1px solid var(--border-subtle);
      font-size: 11.5px;
      color: var(--text-muted);
    }

    .stat-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11.5px;
      color: var(--text-secondary);
    }

    /* Staff Table */
    .staff-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    .staff-table th {
      text-align: left;
      padding: 9px 12px;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border-subtle);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.6px;
    }

    .staff-table td {
      padding: 11px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.035);
      vertical-align: middle;
    }

    .staff-table tr:hover td {
      background: rgba(255, 255, 255, 0.02);
    }

    /* Password Generator Box */
    .pass-gen-box {
      background: rgba(139, 92, 246, 0.08);
      border: 1px solid rgba(139, 92, 246, 0.25);
      border-radius: 9px;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .pass-code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13.5px;
      color: #c084fc;
      word-break: break-all;
    }

    /* Analytics Dashboard Styling */
    .metrics-summary-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
    }

    @media (max-width: 640px) {
      .metrics-summary-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    .metric-card {
      background: rgba(255, 255, 255, 0.025);
      border: 1px solid var(--border-subtle);
      border-radius: 10px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .metric-card-label {
      font-size: 11px;
      color: var(--text-muted);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .metric-card-val {
      font-size: 20px;
      font-weight: 700;
      color: #ffffff;
      font-family: 'Outfit', sans-serif;
    }

    .readers-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 260px;
      overflow-y: auto;
      padding-right: 4px;
    }

    .reader-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 9px 12px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--border-subtle);
      border-radius: 9px;
      transition: all 0.15s ease;
    }

    .reader-row:hover {
      background: rgba(255, 255, 255, 0.04);
      border-color: var(--border-hover);
    }

    .reader-info {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .reader-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 700;
      color: #fff;
      overflow: hidden;
    }

    .reader-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .empty-state {
      text-align: center;
      padding: 32px 20px;
      color: var(--text-muted);
      font-size: 13px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }

    /* Toast Notification */
    #toastContainer {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .toast {
      background: #181c2d;
      border: 1px solid var(--border-subtle);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
      border-radius: 10px;
      padding: 11px 16px;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 10px;
      color: #ffffff;
      animation: toastIn 0.22s ease-out;
    }

    .toast-success { border-color: rgba(16, 185, 129, 0.5); }
    .toast-error { border-color: rgba(239, 68, 68, 0.5); }
    .toast-info { border-color: rgba(99, 102, 241, 0.5); }

    @keyframes toastIn {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
</head>
<body>

  <!-- Top Navigation Header -->
  <header>
    <div class="logo-group">
      <div class="logo-badge" title="AnymeX Studio">
        <span class="icon" style="width:20px; height:20px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/>
            <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/>
            <circle cx="12" cy="12" r="2.2" fill="currentColor"/>
            <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/>
            <path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1"/>
          </svg>
        </span>
      </div>
      <div>
        <div class="brand-title">AnymeX Studio</div>
        <div class="brand-sub">Announcement Broadcast & Staff Center</div>
      </div>
    </div>

    <div class="header-right">
      <button class="btn btn-secondary btn-sm" id="manageStaffBtn" style="display:none;" onclick="openStaffModal()">
        <span class="icon" style="width:14px; height:14px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </span>
        Staff Team
      </button>

      <div class="user-profile-badge" id="userProfileBadge" style="display:none;" onclick="openAccountModal()" title="Account Settings & Security">
        <div class="user-avatar" id="headerAvatar">S</div>
        <div class="user-name-text" id="headerUsername">Sheby</div>
        <span class="role-badge role-owner" id="headerRoleBadge">OWNER</span>
        <button class="btn btn-secondary btn-sm" style="padding:3px 7px; margin-left:4px;" onclick="event.stopPropagation(); handleLogout()" title="Log out">
          <span class="icon" style="width:13px; height:13px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </span>
        </button>
      </div>

      <button class="btn btn-primary btn-sm" id="loginBtnHeader" onclick="openLoginModal()">
        <span class="icon" style="width:14px; height:14px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
            <polyline points="10 17 15 12 10 7"/>
            <line x1="15" y1="12" x2="3" y2="12"/>
          </svg>
        </span>
        Log In
      </button>
    </div>
  </header>

  <!-- Main Content Grid -->
  <main>
    <!-- Left Composer Panel -->
    <section class="panel">
      <div class="panel-header">
        <div class="panel-title">
          <span class="icon" style="width:16px; height:16px; color:var(--primary);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
          </span>
          Announcement Composer
        </div>
        <button class="btn btn-secondary btn-sm" onclick="resetForm()">Clear</button>
      </div>

      <div class="panel-body">
        <!-- Target Category -->
        <div class="form-group">
          <label class="form-label">Category</label>
          <div class="categories-bar">
            <div class="category-pill active" onclick="setCategory(this, 'general')">
              <span class="icon" style="width:13px; height:13px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><circle cx="12" cy="12" r="2"/><path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1"/></svg></span>
              General
            </div>
            <div class="category-pill" onclick="setCategory(this, 'update')">
              <span class="icon" style="width:13px; height:13px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg></span>
              Update
            </div>
            <div class="category-pill" onclick="setCategory(this, 'feature')">
              <span class="icon" style="width:13px; height:13px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg></span>
              Feature
            </div>
            <div class="category-pill" onclick="setCategory(this, 'bugfix')">
              <span class="icon" style="width:13px; height:13px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></span>
              Bug Fix
            </div>
            <div class="category-pill" onclick="setCategory(this, 'maintenance')">
              <span class="icon" style="width:13px; height:13px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span>
              Maintenance
            </div>
            <div class="category-pill" onclick="setCategory(this, 'warning')">
              <span class="icon" style="width:13px; height:13px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
              Alert
            </div>
          </div>
        </div>

        <!-- Title -->
        <div class="form-group">
          <label class="form-label">Announcement Title</label>
          <input type="text" id="annTitle" class="form-control" placeholder="e.g., AnymeX v2.4.0 is now live" oninput="updatePreview()" maxlength="200">
        </div>

        <!-- Short Description / Notification Text -->
        <div class="form-group">
          <label class="form-label">
            <span>Summary & Push Notification Text</span>
            <span style="font-size:11px; color:var(--text-muted)">Max 500 characters</span>
          </label>
          <input type="text" id="annShortDesc" class="form-control" placeholder="Short summary displayed on lock screen and card headers..." oninput="updatePreview()" maxlength="500">
        </div>

        <!-- Markdown Formatting Toolbar -->
        <div class="form-group">
          <label class="form-label">Markdown Content</label>
          <div class="editor-toolbar">
            <button type="button" class="tool-btn" onclick="insertSyntax('**', '**')" title="Bold">
              <span class="icon" style="width:13px; height:13px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 12a4 4 0 0 0 0-8H6v8"/><path d="M15 20a4 4 0 0 0 0-8H6v8Z"/></svg></span>
              Bold
            </button>
            <button type="button" class="tool-btn" onclick="insertSyntax('*', '*')" title="Italic">
              <span class="icon" style="width:13px; height:13px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg></span>
              Italic
            </button>
            <button type="button" class="tool-btn" onclick="insertSyntax('~~', '~~')" title="Strikethrough">
              <span class="icon" style="width:13px; height:13px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/></svg></span>
              Strike
            </button>
            <button type="button" class="tool-btn" onclick="insertHeading()" title="Heading">
              <span class="icon" style="width:13px; height:13px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12h12"/><path d="M6 4v16"/><path d="M18 4v16"/></svg></span>
              H2
            </button>
            <div class="tool-divider"></div>
            <button type="button" class="tool-btn" onclick="insertSyntax('- ', '')" title="Bullet List">
              <span class="icon" style="width:13px; height:13px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></span>
              List
            </button>
            <button type="button" class="tool-btn" onclick="insertSyntax('> ', '')" title="Quote">
              <span class="icon" style="width:13px; height:13px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/></svg></span>
              Quote
            </button>
            <button type="button" class="tool-btn" onclick="insertSyntax('||', '||')" title="Spoiler">
              <span class="icon" style="width:13px; height:13px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg></span>
              Spoiler
            </button>
            <button type="button" class="tool-btn" onclick="insertCodeBlock()" title="Code Block">
              <span class="icon" style="width:13px; height:13px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></span>
              Code
            </button>
            <div class="tool-divider"></div>
            <button type="button" class="tool-btn" onclick="openLinkModal()" title="Insert Link">
              <span class="icon" style="width:13px; height:13px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></span>
              Link
            </button>
            <button type="button" class="tool-btn" onclick="openMediaModal('image')" title="Insert Image">
              <span class="icon" style="width:13px; height:13px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></span>
              Image
            </button>
            <button type="button" class="tool-btn" onclick="openMediaModal('gif')" title="Insert Anime GIF">
              <span class="icon" style="width:13px; height:13px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="20" x="2" y="2" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg></span>
              GIF
            </button>
          </div>
          <textarea id="annContent" class="form-control" placeholder="Write full announcement markdown here... Supports headings, lists, spoilers (||text||), media images, GIFs, and hyperlinks" oninput="updatePreview()"></textarea>
        </div>

        <!-- Pin & Broadcast Options -->
        <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 14px; background:rgba(255,255,255,0.02); border-radius:9px; border:1px solid var(--border-subtle);">
          <label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:500; cursor:pointer;">
            <input type="checkbox" id="pinAnnouncementCheck">
            <span class="icon" style="width:13px; height:13px; color:var(--text-secondary);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg></span>
            Pin to top of list
          </label>
          <label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:500; cursor:pointer;">
            <input type="checkbox" id="sendPushCheck" checked>
            <span class="icon" style="width:13px; height:13px; color:var(--text-secondary);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg></span>
            Send FCM Push Notification
          </label>
        </div>

        <button id="broadcastBtn" class="btn btn-primary" style="padding:13px; font-size:14px; justify-content:center; margin-top:2px;" onclick="confirmBroadcast()">
          <span class="icon" style="width:16px; height:16px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></span>
          Broadcast Announcement
        </button>
      </div>
    </section>

    <!-- Right Live Preview & History Column -->
    <div style="display:flex; flex-direction:column; gap:22px;">
      <!-- Live Mobile App Preview -->
      <section class="panel">
        <div class="panel-header">
          <div class="panel-title">
            <span class="icon" style="width:16px; height:16px; color:var(--accent);">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="14" height="20" x="5" y="2" rx="2" ry="2"/>
                <line x1="12" y1="18" x2="12.01" y2="18"/>
              </svg>
            </span>
            Live In-App Preview
          </div>
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
              <span id="previewAuthor" style="display:inline-flex; align-items:center; gap:5px;">
                <span class="icon" style="width:13px; height:13px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
                Sheby (Owner)
              </span>
              <span>•</span>
              <span>AnymeX Official</span>
            </div>
            <div class="preview-content" id="previewBody">
              Formatted markdown content, media images, and GIFs will appear here in real time...
            </div>
          </div>

          <!-- Notification Banner Preview -->
          <div style="background:rgba(255,255,255,0.02); border:1px solid var(--border-subtle); border-radius:11px; padding:12px 14px; display:flex; gap:12px; align-items:center;">
            <div style="width:36px; height:36px; border-radius:9px; background:rgba(139,92,246,0.15); display:flex; align-items:center; justify-content:center; color:var(--primary); flex-shrink:0;">
              <span class="icon" style="width:18px; height:18px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg></span>
            </div>
            <div style="flex:1;">
              <div style="font-size:10.5px; color:var(--text-muted); font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">Push Notification Preview</div>
              <div id="notifTitlePreview" style="font-size:13px; font-weight:700; color:#fff;">AnymeX Announcement</div>
              <div id="notifBodyPreview" style="font-size:12px; color:var(--text-secondary); line-height:1.4;">Notification preview summary...</div>
            </div>
          </div>
        </div>
      </section>

      <!-- Broadcast History & Analytics List -->
      <section class="panel">
        <div class="panel-header">
          <div class="panel-title">
            <span class="icon" style="width:16px; height:16px; color:#c084fc;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </span>
            Broadcast History
          </div>
          <button class="btn btn-secondary btn-sm" onclick="loadHistory()">
            <span class="icon" style="width:13px; height:13px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg></span>
            Refresh
          </button>
        </div>

        <div class="panel-body">
          <div class="history-controls">
            <div class="search-input-wrap">
              <span class="search-icon icon" style="width:14px; height:14px;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              </span>
              <input type="text" id="historySearchInput" class="form-control" placeholder="Search announcements..." oninput="filterHistoryCards()">
            </div>
          </div>

          <div class="history-filter-tabs">
            <div class="filter-tab active" onclick="setHistoryFilter(this, 'all')">All</div>
            <div class="filter-tab" onclick="setHistoryFilter(this, 'general')">General</div>
            <div class="filter-tab" onclick="setHistoryFilter(this, 'update')">Update</div>
            <div class="filter-tab" onclick="setHistoryFilter(this, 'feature')">Feature</div>
            <div class="filter-tab" onclick="setHistoryFilter(this, 'bugfix')">Bug Fix</div>
            <div class="filter-tab" onclick="setHistoryFilter(this, 'maintenance')">Maintenance</div>
            <div class="filter-tab" onclick="setHistoryFilter(this, 'warning')">Alert</div>
          </div>

          <div class="history-grid" id="historyGrid">
            <div style="color:var(--text-muted); font-size:13px; text-align:center; padding:20px;">Loading announcements...</div>
          </div>
        </div>
      </section>
    </div>
  </main>

  <!-- Modal 1: Master Owner Setup -->
  <div class="modal-overlay" id="setupModal">
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title">
          <span class="icon" style="width:18px; height:18px; color:#fbbf24;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/></svg></span>
          Initialize Master Owner Account
        </div>
      </div>
      <div class="modal-body">
        <p style="font-size:13px; color:var(--text-secondary); line-height:1.5;">
          No master account has been initialized yet. Set up your Master Owner credentials now. Your password is encrypted with NIST PBKDF2-SHA256 (100,000 rounds).
        </p>

        <div class="form-group">
          <label class="form-label">Master Username</label>
          <input type="text" id="setupUsername" class="form-control" value="Sheby" readonly style="opacity:0.85;">
        </div>

        <div class="form-group">
          <label class="form-label">Display Name</label>
          <input type="text" id="setupDisplayName" class="form-control" value="Sheby">
        </div>

        <div class="form-group">
          <label class="form-label">Linked AniList User ID</label>
          <input type="text" id="setupLinkedId" class="form-control" value="5724017">
          <span style="font-size:11px; color:var(--text-muted);">Links your profile and binds permissions automatically.</span>
        </div>

        <div class="form-group">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <label class="form-label" style="margin-bottom:0;">Set Strong Password</label>
            <button type="button" class="btn btn-secondary btn-sm" onclick="generateSetupPassword()">
              <span class="icon" style="width:12px; height:12px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="8" cy="8" r="1.5"/><circle cx="16" cy="16" r="1.5"/><circle cx="16" cy="8" r="1.5"/><circle cx="8" cy="16" r="1.5"/></svg></span>
              Generate
            </button>
          </div>
          <input type="password" id="setupPassword" class="form-control" placeholder="Enter at least 8 characters..." style="margin-top:5px;">
        </div>

        <div class="pass-gen-box" id="passGenBox" style="display:none;">
          <div>
            <div style="font-size:11px; color:var(--text-muted);">Generated Password:</div>
            <div class="pass-code" id="genPasswordDisplay">...</div>
          </div>
          <button type="button" class="btn btn-primary btn-sm" onclick="copyGenPassword()">Copy</button>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-gold" id="submitSetupBtn" onclick="submitMasterSetup()" style="width:100%; justify-content:center; padding:11px;">
          Initialize Master Account
        </button>
      </div>
    </div>
  </div>

  <!-- Modal 2: Regular Staff Login -->
  <div class="modal-overlay" id="loginModal">
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title">
          <span class="icon" style="width:18px; height:18px; color:var(--primary);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>
          Staff Authentication
        </div>
        <button class="close-btn" onclick="closeLoginModal()">
          <span class="icon" style="width:16px; height:16px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>
        </button>
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

  <!-- Modal 3: Account Settings & Password Management -->
  <div class="modal-overlay" id="accountModal">
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title">
          <span class="icon" style="width:18px; height:18px; color:var(--primary);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span>
          Account Settings & Security
        </div>
        <button class="close-btn" onclick="closeAccountModal()">
          <span class="icon" style="width:16px; height:16px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>
        </button>
      </div>
      <div class="modal-body">
        <!-- Profile Details Section -->
        <div style="background:rgba(255,255,255,0.02); border:1px solid var(--border-subtle); border-radius:12px; padding:16px;">
          <div style="font-size:13px; font-weight:700; color:#fff; margin-bottom:12px; display:flex; align-items:center; gap:6px;">
            <span class="icon" style="width:14px; height:14px; color:var(--accent);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
            Profile Information
          </div>
          <div style="display:flex; gap:14px; align-items:center; margin-bottom:14px;">
            <div class="user-avatar" id="accountAvatarPreview" style="width:48px; height:48px; font-size:18px;">S</div>
            <div style="flex:1;">
              <div id="accountUsernameDisplay" style="font-weight:700; font-size:15px; color:#fff;">Sheby</div>
              <div id="accountRoleDisplay" style="font-size:11.5px; color:var(--text-muted);">Role: Owner</div>
            </div>
          </div>
          <div class="form-group" style="margin-bottom:10px;">
            <label class="form-label">Display Name</label>
            <input type="text" id="accDisplayName" class="form-control" placeholder="e.g. Sheby">
          </div>
          <div class="form-group" style="margin-bottom:12px;">
            <label class="form-label">Avatar URL (Optional)</label>
            <input type="url" id="accAvatarUrl" class="form-control" placeholder="https://example.com/avatar.jpg" oninput="testAccountAvatarPreview()">
          </div>
          <button class="btn btn-secondary btn-sm" onclick="submitUpdateProfile()" style="align-self:flex-start;">
            Save Profile Details
          </button>
        </div>

        <!-- Change Password Section -->
        <div style="background:rgba(255,255,255,0.02); border:1px solid var(--border-subtle); border-radius:12px; padding:16px;">
          <div style="font-size:13px; font-weight:700; color:#fff; margin-bottom:12px; display:flex; align-items:center; gap:6px;">
            <span class="icon" style="width:14px; height:14px; color:var(--warning);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>
            Change Password
          </div>
          <div class="form-group" style="margin-bottom:10px;">
            <label class="form-label">Current Password</label>
            <input type="password" id="accCurrentPass" class="form-control" placeholder="Enter current password">
          </div>
          <div class="form-group" style="margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <label class="form-label" style="margin-bottom:0;">New Password</label>
              <a href="#" onclick="generateAccPassword(); return false;" style="font-size:11px; color:#c084fc; text-decoration:none;">Generate</a>
            </div>
            <input type="password" id="accNewPass" class="form-control" placeholder="At least 6 characters" style="margin-top:4px;">
          </div>
          <div class="form-group" style="margin-bottom:14px;">
            <label class="form-label">Confirm New Password</label>
            <input type="password" id="accConfirmPass" class="form-control" placeholder="Repeat new password">
          </div>
          <button class="btn btn-primary btn-sm" onclick="submitChangePassword()">
            Update Password
          </button>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeAccountModal()">Close</button>
      </div>
    </div>
  </div>

  <!-- Modal 4: Readers & Delivery Analytics Modal -->
  <div class="modal-overlay" id="analyticsModal">
    <div class="modal-card modal-lg">
      <div class="modal-header">
        <div class="modal-title">
          <span class="icon" style="width:18px; height:18px; color:var(--accent);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg></span>
          <span id="analyticsModalTitle">Announcement Analytics & Readers</span>
        </div>
        <button class="close-btn" onclick="closeAnalyticsModal()">
          <span class="icon" style="width:16px; height:16px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>
        </button>
      </div>
      <div class="modal-body">
        <!-- Push Delivery & Engagement Metrics -->
        <div>
          <div style="font-size:12px; font-weight:700; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.6px; margin-bottom:8px;">
            FCM Push Delivery & Engagement
          </div>
          <div class="metrics-summary-grid">
            <div class="metric-card">
              <div class="metric-card-label">
                <span class="icon" style="width:12px; height:12px; color:var(--info);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></span>
                Pushed
              </div>
              <div class="metric-card-val" id="metricPushed">0</div>
            </div>
            <div class="metric-card">
              <div class="metric-card-label">
                <span class="icon" style="width:12px; height:12px; color:var(--success);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>
                Delivered
              </div>
              <div class="metric-card-val" id="metricDelivered">0</div>
            </div>
            <div class="metric-card">
              <div class="metric-card-label">
                <span class="icon" style="width:12px; height:12px; color:var(--accent);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg></span>
                Total Views
              </div>
              <div class="metric-card-val" id="metricViews">0</div>
            </div>
            <div class="metric-card">
              <div class="metric-card-label">
                <span class="icon" style="width:12px; height:12px; color:#c084fc;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg></span>
                Confirmed Reads
              </div>
              <div class="metric-card-val" id="metricReads">0</div>
            </div>
          </div>
        </div>

        <!-- Confirmed Readers List -->
        <div style="margin-top:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <div style="font-size:12px; font-weight:700; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.6px;">
              Confirmed Readers (<span id="readersCountLabel">0</span>)
            </div>
            <div class="search-input-wrap" style="max-width:220px;">
              <span class="search-icon icon" style="width:13px; height:13px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></span>
              <input type="text" id="readersSearchInput" class="form-control" style="padding-top:5px; padding-bottom:5px; font-size:12px;" placeholder="Filter readers..." oninput="filterReadersList()">
            </div>
          </div>

          <div class="readers-list" id="readersListContainer">
            <div class="empty-state">Loading readers...</div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeAnalyticsModal()">Close</button>
      </div>
    </div>
  </div>

  <!-- Modal 5: Staff Team Management Panel -->
  <div class="modal-overlay" id="staffModal">
    <div class="modal-card modal-lg">
      <div class="modal-header">
        <div class="modal-title">
          <span class="icon" style="width:18px; height:18px; color:var(--primary);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
          Staff & Team Management
        </div>
        <button class="close-btn" onclick="closeStaffModal()">
          <span class="icon" style="width:16px; height:16px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>
        </button>
      </div>
      <div class="modal-body">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="font-size:13px; color:var(--text-secondary);">Manage moderators and administrators who have access to this studio.</div>
          <button class="btn btn-primary btn-sm" onclick="openAddStaffForm()">
            <span class="icon" style="width:13px; height:13px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></span>
            Add Staff Member
          </button>
        </div>

        <!-- Add Staff Form -->
        <div id="addStaffForm" style="display:none; background:rgba(255,255,255,0.025); border:1px solid var(--border-focus); border-radius:12px; padding:16px; margin-top:8px;">
          <div style="font-weight:700; font-size:13.5px; margin-bottom:12px; color:#fff;">Create New Staff Account</div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div class="form-group">
              <label class="form-label">Username</label>
              <input type="text" id="newStaffUsername" class="form-control" placeholder="e.g. mod_alex">
            </div>
            <div class="form-group">
              <label class="form-label">Role</label>
              <select id="newStaffRole" class="form-control">
                <option value="moderator">Moderator</option>
                <option value="admin">Admin</option>
                <option value="super_admin">Super Admin</option>
              </select>
            </div>
            <div class="form-group">
              <div style="display:flex; justify-content:space-between;">
                <label class="form-label">Password</label>
                <a href="#" onclick="generateStaffPassword(); return false;" style="font-size:11px; color:#c084fc; text-decoration:none;">Generate</a>
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
            <button class="btn btn-success btn-sm" onclick="submitCreateStaff()">Save Member</button>
          </div>
        </div>

        <!-- Staff Table -->
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

  <!-- Modal 6: Media (Image/GIF) Modal -->
  <div class="modal-overlay" id="mediaModal">
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title" id="mediaModalTitle">
          <span class="icon" style="width:18px; height:18px; color:var(--primary);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></span>
          Insert Media
        </div>
        <button class="close-btn" onclick="closeMediaModal()">
          <span class="icon" style="width:16px; height:16px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Image or GIF URL</label>
          <input type="url" id="mediaUrlInput" class="form-control" placeholder="https://example.com/banner.gif" oninput="testMediaPreview()">
        </div>
        <div class="form-group">
          <label class="form-label">Caption / Alt Text</label>
          <input type="text" id="mediaAltInput" class="form-control" placeholder="e.g., Update Banner">
        </div>
        <div id="mediaPreviewArea" style="display:none; text-align:center; margin-top:8px;">
          <img id="mediaPreviewImg" src="" style="max-height:160px; border-radius:8px; border:1px solid var(--border-subtle);">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeMediaModal()">Cancel</button>
        <button class="btn btn-primary" onclick="confirmInsertMedia()">Insert Media</button>
      </div>
    </div>
  </div>

  <!-- Modal 7: Insert Link Modal -->
  <div class="modal-overlay" id="linkModal">
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title">
          <span class="icon" style="width:18px; height:18px; color:var(--primary);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></span>
          Insert Hyperlink
        </div>
        <button class="close-btn" onclick="closeLinkModal()">
          <span class="icon" style="width:16px; height:16px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Link Text</label>
          <input type="text" id="linkTextInput" class="form-control" placeholder="e.g., Download Update">
        </div>
        <div class="form-group">
          <label class="form-label">Destination URL</label>
          <input type="url" id="linkUrlInput" class="form-control" placeholder="https://github.com/RyanYuuki/AnymeX/releases">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeLinkModal()">Cancel</button>
        <button class="btn btn-primary" onclick="confirmInsertLink()">Insert Link</button>
      </div>
    </div>
  </div>

  <!-- Toast Notification Container -->
  <div id="toastContainer"></div>

  <script>
    let currentCategory = 'general';
    let currentMediaType = 'image';
    let currentUser = null;
    let allAnnouncements = [];
    let currentFilter = 'all';
    let currentAnalyticsReaders = [];

    // Helper Toast
    function showToast(message, type = 'info') {
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = 'toast toast-' + type;
      toast.innerText = message;
      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.2s ease';
        setTimeout(() => toast.remove(), 200);
      }, 3500);
    }

    // Secure string generator
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
      const rawContent = document.getElementById('annContent').value.trim() || 'Formatted markdown content, media images, and GIFs will appear here in real time...';

      document.getElementById('previewTitle').innerText = title;
      document.getElementById('previewTag').innerText = currentCategory.toUpperCase();
      document.getElementById('notifTitlePreview').innerText = title;
      document.getElementById('notifBodyPreview').innerText = shortDesc || title;

      if (currentUser) {
        document.getElementById('previewAuthor').innerHTML = '<span class="icon" style="width:13px; height:13px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span> ' + (currentUser.display_name || currentUser.username) + ' (' + currentUser.role.toUpperCase() + ')';
      }

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

    // Modal Control
    function openLoginModal() { document.getElementById('loginModal').classList.add('active'); }
    function closeLoginModal() { document.getElementById('loginModal').classList.remove('active'); }
    function openSetupModal() { document.getElementById('setupModal').classList.add('active'); }
    function closeSetupModal() { document.getElementById('setupModal').classList.remove('active'); }
    function openStaffModal() { document.getElementById('staffModal').classList.add('active'); loadStaffList(); }
    function closeStaffModal() { document.getElementById('staffModal').classList.remove('active'); }

    // Account Modal
    function openAccountModal() {
      if (!currentUser) return;
      document.getElementById('accountUsernameDisplay').innerText = '@' + currentUser.username;
      document.getElementById('accountRoleDisplay').innerText = 'Role: ' + currentUser.role.toUpperCase();
      document.getElementById('accDisplayName').value = currentUser.display_name || currentUser.username;
      document.getElementById('accAvatarUrl').value = currentUser.avatar_url || '';
      testAccountAvatarPreview();
      document.getElementById('accountModal').classList.add('active');
    }

    function closeAccountModal() {
      document.getElementById('accountModal').classList.remove('active');
      document.getElementById('accCurrentPass').value = '';
      document.getElementById('accNewPass').value = '';
      document.getElementById('accConfirmPass').value = '';
    }

    function testAccountAvatarPreview() {
      const url = document.getElementById('accAvatarUrl').value.trim();
      const preview = document.getElementById('accountAvatarPreview');
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        preview.innerHTML = '<img src="' + url + '" alt="Avatar" onerror="this.onerror=null; this.parentElement.innerText=\\'' + (currentUser?.username?.charAt(0).toUpperCase() || 'S') + '\\';">';
      } else {
        preview.innerHTML = currentUser?.username?.charAt(0).toUpperCase() || 'S';
      }
    }

    function generateAccPassword() {
      const pass = generateSecureString(14);
      document.getElementById('accNewPass').value = pass;
      document.getElementById('accConfirmPass').value = pass;
      navigator.clipboard.writeText(pass);
      showToast('New password generated and copied to clipboard!', 'info');
    }

    async function submitUpdateProfile() {
      const token = localStorage.getItem('anymex_session_token');
      if (!token) return;

      const displayName = document.getElementById('accDisplayName').value.trim();
      const avatarUrl = document.getElementById('accAvatarUrl').value.trim();

      try {
        const res = await fetch('/functions/v1/announcements/auth/profile', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          body: JSON.stringify({ display_name: displayName, avatar_url: avatarUrl })
        });

        const data = await res.json();
        if (!res.ok || data.error) {
          showToast(data.error || 'Failed to update profile', 'error');
        } else {
          currentUser.display_name = data.user.display_name;
          currentUser.avatar_url = data.user.avatar_url;
          updateHeaderUserUI(currentUser);
          showToast('Profile updated successfully!', 'success');
        }
      } catch (err) {
        showToast('Error updating profile: ' + err.message, 'error');
      }
    }

    async function submitChangePassword() {
      const token = localStorage.getItem('anymex_session_token');
      if (!token) return;

      const current_password = document.getElementById('accCurrentPass').value;
      const new_password = document.getElementById('accNewPass').value;
      const confirm_password = document.getElementById('accConfirmPass').value;

      if (!current_password || !new_password) {
        showToast('Please enter both current and new passwords.', 'error');
        return;
      }
      if (new_password !== confirm_password) {
        showToast('New passwords do not match.', 'error');
        return;
      }
      if (new_password.length < 6) {
        showToast('Password must be at least 6 characters.', 'error');
        return;
      }

      try {
        const res = await fetch('/functions/v1/announcements/auth/change-password', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          body: JSON.stringify({ current_password, new_password })
        });

        const data = await res.json();
        if (!res.ok || data.error) {
          showToast(data.error || 'Failed to change password', 'error');
        } else {
          showToast('Password changed successfully!', 'success');
          document.getElementById('accCurrentPass').value = '';
          document.getElementById('accNewPass').value = '';
          document.getElementById('accConfirmPass').value = '';
        }
      } catch (err) {
        showToast('Error changing password: ' + err.message, 'error');
      }
    }

    // Analytics Modal
    async function openAnalyticsModal(announcementId, announcementTitle) {
      const token = localStorage.getItem('anymex_session_token');
      if (!token) {
        showToast('Please log in to view analytics.', 'error');
        openLoginModal();
        return;
      }

      document.getElementById('analyticsModalTitle').innerText = 'Analytics: ' + (announcementTitle || ('#' + announcementId));
      document.getElementById('metricPushed').innerText = '...';
      document.getElementById('metricDelivered').innerText = '...';
      document.getElementById('metricViews').innerText = '...';
      document.getElementById('metricReads').innerText = '...';
      document.getElementById('readersCountLabel').innerText = '0';
      document.getElementById('readersListContainer').innerHTML = '<div class="empty-state">Loading delivery analytics & confirmed readers...</div>';
      document.getElementById('analyticsModal').classList.add('active');

      try {
        const res = await fetch('/functions/v1/announcements/' + announcementId + '/analytics', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await res.json();

        if (!res.ok || !data.analytics) {
          document.getElementById('readersListContainer').innerHTML = '<div class="empty-state" style="color:var(--danger)">' + (data.error || 'Failed to load analytics') + '</div>';
          return;
        }

        const a = data.analytics;
        document.getElementById('metricPushed').innerText = a.push_stats?.queued || 0;
        document.getElementById('metricDelivered').innerText = a.push_stats?.delivered || a.push_stats?.sent || 0;
        document.getElementById('metricViews').innerText = a.view_count || 0;
        document.getElementById('metricReads').innerText = a.total_reads || 0;
        document.getElementById('readersCountLabel').innerText = (a.readers || []).length;

        currentAnalyticsReaders = a.readers || [];
        renderReadersList(currentAnalyticsReaders);

      } catch (err) {
        document.getElementById('readersListContainer').innerHTML = '<div class="empty-state" style="color:var(--danger)">Error loading analytics: ' + err.message + '</div>';
      }
    }

    function renderReadersList(readers) {
      const container = document.getElementById('readersListContainer');
      if (!readers || readers.length === 0) {
        container.innerHTML = '<div class="empty-state">No users have marked this announcement as read yet. Readers appear here when users view this announcement in the AnymeX app.</div>';
        return;
      }

      container.innerHTML = readers.map(r => {
        const initial = (r.username || 'U').charAt(0).toUpperCase();
        const avatarHtml = r.avatar 
          ? '<img src="' + r.avatar + '" alt="' + r.username + '" onerror="this.onerror=null; this.parentElement.innerText=\\'' + initial + '\\';">'
          : initial;
        
        const dateStr = r.read_at ? new Date(r.read_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Recently';
        const clientBadge = r.client_type ? '<span style="font-size:10px; padding:1px 6px; border-radius:10px; background:rgba(255,255,255,0.06); color:var(--text-muted);">' + r.client_type.toUpperCase() + '</span>' : '';

        return '<div class="reader-row">' +
          '<div class="reader-info">' +
            '<div class="reader-avatar">' + avatarHtml + '</div>' +
            '<div>' +
              '<div style="font-weight:600; font-size:13px; color:#fff; display:flex; align-items:center; gap:6px;">' +
                (r.username || 'User') +
                clientBadge +
              '</div>' +
              '<div style="font-size:11px; color:var(--text-muted);">ID: ' + r.user_id + '</div>' +
            '</div>' +
          '</div>' +
          '<div style="font-size:11.5px; color:var(--text-secondary);">' + dateStr + '</div>' +
        '</div>';
      }).join('');
    }

    function filterReadersList() {
      const q = document.getElementById('readersSearchInput').value.trim().toLowerCase();
      if (!q) {
        renderReadersList(currentAnalyticsReaders);
        return;
      }
      const filtered = currentAnalyticsReaders.filter(r => 
        (r.username && r.username.toLowerCase().includes(q)) ||
        (r.user_id && String(r.user_id).toLowerCase().includes(q))
      );
      renderReadersList(filtered);
    }

    function closeAnalyticsModal() {
      document.getElementById('analyticsModal').classList.remove('active');
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
        showToast('Password copied to clipboard!', 'info');
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
          currentUser = null;
          updateHeaderGuestUI();
          if (!token) {
            setTimeout(openLoginModal, 400);
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
      
      const avatarEl = document.getElementById('headerAvatar');
      if (user.avatar_url) {
        avatarEl.innerHTML = '<img src="' + user.avatar_url + '" alt="Avatar" onerror="this.onerror=null; this.parentElement.innerText=\\'' + (user.username.charAt(0).toUpperCase()) + '\\';">';
      } else {
        avatarEl.innerText = (user.display_name || user.username).charAt(0).toUpperCase();
      }

      const roleBadge = document.getElementById('headerRoleBadge');
      roleBadge.className = 'role-badge role-' + user.role;
      roleBadge.innerText = user.role.toUpperCase().replace('_', ' ');

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
        showToast('Password must be at least 6 characters long.', 'error');
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
          showToast('Setup failed: ' + (data.error || res.statusText), 'error');
        } else {
          localStorage.setItem('anymex_session_token', data.token);
          currentUser = data.user;
          updateHeaderUserUI(data.user);
          closeSetupModal();
          showToast('Master Owner account initialized successfully! Welcome, Sheby.', 'success');
          loadHistory();
        }
      } catch (err) {
        showToast('Network error during setup: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerText = 'Initialize Master Account';
      }
    }

    async function submitLogin() {
      const username = document.getElementById('loginUsername').value.trim();
      const password = document.getElementById('loginPassword').value;

      if (!username || !password) {
        showToast('Please enter your username and password.', 'error');
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
          showToast(data.error || 'Invalid credentials', 'error');
        } else {
          localStorage.setItem('anymex_session_token', data.token);
          currentUser = data.user;
          updateHeaderUserUI(data.user);
          closeLoginModal();
          showToast('Authenticated as @' + data.user.username, 'success');
          loadHistory();
        }
      } catch (err) {
        showToast('Network error during login: ' + err.message, 'error');
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

    // Staff Management
    function openAddStaffForm() { document.getElementById('addStaffForm').style.display = 'block'; }
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

        tbody.innerHTML = data.staff.map(member => {
          const linkedText = member.linked_user_id ? (member.linked_client_type || 'anilist') + ': ' + member.linked_user_id : '<span style="color:var(--text-muted)">None</span>';
          const createdStr = member.created_at ? new Date(member.created_at).toLocaleDateString() : '-';
          const isOwner = member.role === 'owner';

          return '<tr>' +
            '<td>' +
              '<div style="font-weight:600; color:#fff;">' + (member.display_name || member.username) + '</div>' +
              '<div style="font-size:11px; color:var(--text-muted);">@' + member.username + '</div>' +
            '</td>' +
            '<td><span class="role-badge role-' + member.role + '">' + member.role.toUpperCase().replace('_', ' ') + '</span></td>' +
            '<td>' + linkedText + '</td>' +
            '<td style="color:var(--text-muted); font-size:12px;">' + createdStr + '</td>' +
            '<td style="text-align:right;">' +
              (isOwner ? '<span style="font-size:11px; color:var(--text-muted)">Master</span>' : '<button class="btn btn-danger btn-sm" onclick="deleteStaffMember(' + member.id + ', \\'' + member.username + '\\')">Remove</button>') +
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
        showToast('Please provide username and password.', 'error');
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
          showToast(data.error || 'Failed to add staff member', 'error');
        } else {
          showToast('Staff member @' + username + ' added successfully!', 'success');
          closeAddStaffForm();
          loadStaffList();
        }
      } catch (err) {
        showToast('Error adding staff: ' + err.message, 'error');
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
          showToast(data.error || 'Failed to remove staff', 'error');
        } else {
          showToast('Staff member removed.', 'info');
          loadStaffList();
        }
      } catch (err) {
        showToast('Error removing staff: ' + err.message, 'error');
      }
    }

    // Media & Link Modals
    function openMediaModal(type) {
      currentMediaType = type;
      document.getElementById('mediaModalTitle').innerHTML = '<span class="icon" style="width:18px; height:18px; color:var(--primary);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></span> Insert ' + (type === 'gif' ? 'Anime GIF' : 'Image');
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

    function confirmInsertMedia() {
      const url = document.getElementById('mediaUrlInput').value.trim();
      const alt = document.getElementById('mediaAltInput').value.trim() || 'Media';
      if (!url) {
        showToast('Please enter a valid image or GIF URL.', 'error');
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
        showToast('Please enter a destination URL.', 'error');
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
        showToast('You must be logged in to broadcast announcements.', 'error');
        openLoginModal();
        return;
      }

      const title = document.getElementById('annTitle').value.trim();
      const content = document.getElementById('annContent').value.trim();
      const shortDesc = document.getElementById('annShortDesc').value.trim() || title;
      const sendPush = document.getElementById('sendPushCheck').checked;
      const isPinned = document.getElementById('pinAnnouncementCheck').checked;

      if (!title || !content) {
        showToast('Please fill out both the Title and the Content.', 'error');
        return;
      }

      const confirmMsg = 'Broadcast this announcement?\\n\\n' +
        'Title: ' + title + '\\n' +
        'Category: ' + currentCategory.toUpperCase() + '\\n' +
        'Push Notification: ' + (sendPush ? 'YES (Broadcasting to active devices)' : 'NO');

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
          showToast('Error broadcasting: ' + (data.error || response.statusText), 'error');
        } else {
          showToast('Announcement broadcasted successfully!', 'success');
          resetForm();
          loadHistory();
        }
      } catch (err) {
        showToast('Failed to broadcast: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerText = 'Broadcast Announcement';
      }
    }

    // Load History & Filter
    async function loadHistory() {
      const grid = document.getElementById('historyGrid');
      grid.innerHTML = '<div style="color:var(--text-muted); font-size:13px; text-align:center; padding:20px;">Loading announcements...</div>';

      try {
        const response = await fetch('/functions/v1/announcements?app_id=anymex&limit=50');
        const data = await response.json();

        if (!response.ok || !data.announcements) {
          grid.innerHTML = '<div style="color:var(--danger); font-size:13px; text-align:center; padding:20px;">Failed to load announcements: ' + (data.error || '') + '</div>';
          return;
        }

        allAnnouncements = data.announcements;
        filterHistoryCards();

      } catch (err) {
        grid.innerHTML = '<div style="color:var(--danger); font-size:13px; text-align:center; padding:20px;">Network error loading history.</div>';
      }
    }

    function setHistoryFilter(el, filter) {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      el.classList.add('active');
      currentFilter = filter;
      filterHistoryCards();
    }

    function filterHistoryCards() {
      const q = document.getElementById('historySearchInput').value.trim().toLowerCase();
      let list = allAnnouncements;

      if (currentFilter !== 'all') {
        list = list.filter(a => (a.category || 'general').toLowerCase() === currentFilter.toLowerCase());
      }

      if (q) {
        list = list.filter(a => 
          (a.title && a.title.toLowerCase().includes(q)) ||
          (a.short_description && a.short_description.toLowerCase().includes(q))
        );
      }

      renderHistoryCards(list);
    }

    function renderHistoryCards(list) {
      const grid = document.getElementById('historyGrid');
      if (list.length === 0) {
        grid.innerHTML = '<div style="color:var(--text-muted); font-size:13px; text-align:center; padding:24px;">No announcements found matching criteria.</div>';
        return;
      }

      grid.innerHTML = list.map(ann => {
        const dateStr = ann.published_at ? new Date(ann.published_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Draft';
        const cat = (ann.category || 'general').toUpperCase();
        const isPinned = ann.pinned === true;

        const safeTitle = (ann.title || '').replace(/'/g, "\\\\'");

        return '<div class="history-card">' +
          '<div class="history-card-header">' +
            '<div style="display:flex; align-items:center; gap:6px;">' +
              '<span class="preview-category-tag" style="font-size:9.5px; padding:2px 7px;">' + cat + '</span>' +
              (isPinned ? '<span style="font-size:10px; padding:1px 6px; border-radius:10px; background:rgba(245,158,11,0.15); border:1px solid rgba(245,158,11,0.3); color:#fbbf24;">PINNED</span>' : '') +
            '</div>' +
            '<span style="font-size:11px; color:var(--text-muted);">' + dateStr + '</span>' +
          '</div>' +
          '<div>' +
            '<div style="font-size:14px; font-weight:700; color:#fff; margin-bottom:3px;">' + (ann.title || '') + '</div>' +
            '<div style="font-size:12px; color:var(--text-secondary); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; line-height:1.45;">' + (ann.short_description || '') + '</div>' +
          '</div>' +
          '<div class="history-card-footer">' +
            '<div style="display:flex; gap:12px; align-items:center;">' +
              '<span class="stat-pill" title="Total Views">' +
                '<span class="icon" style="width:12px; height:12px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg></span> ' +
                (ann.view_count || 0) +
              '</span>' +
              '<button class="btn btn-secondary btn-sm" style="font-size:11px; padding:2px 8px;" onclick="openAnalyticsModal(' + ann.id + ', \\'' + safeTitle + '\\')">' +
                '<span class="icon" style="width:11px; height:11px; color:var(--accent);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg></span> ' +
                'Analytics' +
              '</button>' +
            '</div>' +
            '<button class="btn btn-danger btn-sm" style="font-size:11px; padding:2px 8px;" onclick="deleteAnnouncement(' + ann.id + ')">' +
              '<span class="icon" style="width:11px; height:11px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></span> ' +
              'Delete' +
            '</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    async function deleteAnnouncement(id) {
      const token = localStorage.getItem('anymex_session_token');
      if (!token) {
        showToast('You must be logged in to delete announcements.', 'error');
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
          showToast(data.error || 'Failed to delete', 'error');
        } else {
          showToast('Announcement #' + id + ' deleted.', 'info');
          loadHistory();
        }
      } catch (err) {
        showToast('Delete failed: ' + err.message, 'error');
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
