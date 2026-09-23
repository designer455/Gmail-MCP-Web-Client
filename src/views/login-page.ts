/**
 * Renders an account connection instruction page for visitors of /login.
 */
export function renderLoginPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect Gmail - Gmail MCP</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(22, 28, 45, 0.9);
      --card-border: #1e293b;
      --accent: #38bdf8;
      --accent-gradient: linear-gradient(135deg, #38bdf8 0%, #818cf8 100%);
      --text: #f8fafc;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: radial-gradient(circle at top, #131d33 0%, var(--bg) 70%);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 1.25rem;
      padding: 2.25rem;
      max-width: 460px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 40px -15px rgba(0,0,0,0.6);
    }
    h1 { font-size: 1.5rem; margin: 0 0 0.75rem; background: var(--accent-gradient); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    p { color: var(--text-muted); font-size: 0.95rem; line-height: 1.5; margin: 0 0 1.5rem; }
    .btn { display: inline-block; background: var(--accent-gradient); color: #041020; font-weight: 600; padding: 0.8rem 1.5rem; border-radius: 0.6rem; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Gmail MCP Account Connection</h1>
    <p>To connect your Gmail account, add this MCP server into ChatGPT or your AI client. When you invoke a tool, you will receive a secure one-time link to authorize your Google account.</p>
    <a href="/" class="btn">View Dashboard</a>
  </div>
</body>
</html>`;
}
