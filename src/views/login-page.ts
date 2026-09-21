export interface LoginPageOptions {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

/**
 * Renders the public browser authentication page.
 * Bridges Supabase Auth with Google OAuth initiation in memory without
 * ever placing the Supabase JWT in URLs, query parameters, redirects, or history.
 */
export function renderLoginPage(options: LoginPageOptions): string {
  const safeSupabaseUrl = JSON.stringify(options.supabaseUrl);
  const safeSupabaseKey = JSON.stringify(options.supabasePublishableKey);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign In - Gmail MCP Account Connection</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(22, 28, 45, 0.9);
      --card-border: #1e293b;
      --accent: #38bdf8;
      --accent-gradient: linear-gradient(135deg, #38bdf8 0%, #818cf8 100%);
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --error-bg: rgba(239, 68, 68, 0.15);
      --error-border: rgba(239, 68, 68, 0.35);
      --error-text: #fca5a5;
      --input-bg: rgba(15, 23, 42, 0.7);
      --input-border: #334155;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: radial-gradient(circle at top, #131d33 0%, var(--bg) 70%);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem 1rem;
    }
    .container {
      max-width: 440px;
      width: 100%;
    }
    .header {
      text-align: center;
      margin-bottom: 2rem;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.35rem 0.85rem;
      border-radius: 9999px;
      background: rgba(56, 189, 248, 0.1);
      border: 1px solid rgba(56, 189, 248, 0.25);
      color: var(--accent);
      font-size: 0.82rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      margin-bottom: 1rem;
    }
    h1 {
      font-size: 1.85rem;
      font-weight: 700;
      margin: 0 0 0.5rem;
      background: var(--accent-gradient);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .subtitle {
      color: var(--text-muted);
      font-size: 0.95rem;
      line-height: 1.5;
      margin: 0;
    }
    .card {
      background: var(--card-bg);
      backdrop-filter: blur(16px);
      border: 1px solid var(--card-border);
      border-radius: 1rem;
      padding: 2rem;
      box-shadow: 0 15px 35px -5px rgba(0, 0, 0, 0.6);
    }
    .form-group {
      margin-bottom: 1.25rem;
    }
    label {
      display: block;
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
    }
    input {
      width: 100%;
      padding: 0.75rem 1rem;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      border-radius: 0.5rem;
      color: var(--text);
      font-size: 0.95rem;
      font-family: inherit;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.2);
    }
    .btn {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      background: var(--accent-gradient);
      color: #041020;
      font-weight: 600;
      padding: 0.85rem 1.5rem;
      border-radius: 0.5rem;
      font-size: 1rem;
      cursor: pointer;
      border: none;
      transition: opacity 0.2s, transform 0.1s;
      margin-top: 1.5rem;
    }
    .btn:hover:not(:disabled) {
      opacity: 0.92;
      transform: translateY(-1px);
    }
    .btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .status-box {
      margin-bottom: 1.25rem;
      padding: 0.85rem 1rem;
      border-radius: 0.5rem;
      font-size: 0.9rem;
      line-height: 1.4;
    }
    .status-box.error {
      background: var(--error-bg);
      border: 1px solid var(--error-border);
      color: var(--error-text);
    }
    .status-box.hidden {
      display: none;
    }
    .footer-links {
      text-align: center;
      margin-top: 1.5rem;
      font-size: 0.85rem;
      color: var(--text-muted);
    }
    .footer-links a {
      color: var(--accent);
      text-decoration: none;
    }
    .footer-links a:hover {
      text-decoration: underline;
    }
    .spinner {
      width: 18px;
      height: 18px;
      border: 2px solid rgba(4, 16, 32, 0.3);
      border-top-color: #041020;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      display: inline-block;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="badge">Google OAuth Bridge</div>
      <h1>Connect Gmail Account</h1>
      <p class="subtitle">Sign in with your Supabase account to link your Gmail mailbox for MCP AI assistant tools.</p>
    </div>

    <div class="card">
      <div id="status-message" class="status-box hidden"></div>

      <form id="login-form">
        <div class="form-group">
          <label for="email">Email Address</label>
          <input type="email" id="email" required autocomplete="email" placeholder="you@example.com" autofocus />
        </div>

        <div class="form-group">
          <label for="password">Password</label>
          <input type="password" id="password" required autocomplete="current-password" placeholder="••••••••" />
        </div>

        <button type="submit" id="submit-btn" class="btn">
          <span id="btn-text">Sign In & Connect Gmail →</span>
        </button>
      </form>
    </div>

    <div class="footer-links">
      <a href="/">← Return to Dashboard</a>
    </div>
  </div>

  <script>
    (function() {
      const supabaseUrl = ${safeSupabaseUrl};
      const supabaseKey = ${safeSupabaseKey};

      const form = document.getElementById('login-form');
      const submitBtn = document.getElementById('submit-btn');
      const btnText = document.getElementById('btn-text');
      const statusBox = document.getElementById('status-message');

      function showError(message) {
        statusBox.textContent = message;
        statusBox.className = 'status-box error';
        submitBtn.disabled = false;
        btnText.textContent = 'Sign In & Connect Gmail →';
      }

      function setLoading(text) {
        submitBtn.disabled = true;
        btnText.innerHTML = '<span class="spinner"></span> ' + text;
        statusBox.className = 'status-box hidden';
      }

      if (!supabaseUrl || !supabaseKey) {
        showError('Supabase configuration is incomplete. Please ensure SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are set.');
        submitBtn.disabled = true;
        return;
      }

      const supabase = window.supabase.createClient(supabaseUrl, supabaseKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      });

      form.addEventListener('submit', async function(e) {
        e.preventDefault();

        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;

        if (!email || !password) {
          showError('Please enter both email and password.');
          return;
        }

        setLoading('Authenticating with Supabase...');

        try {
          // 1. Authenticate with Supabase Auth
          const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
          });

          if (error || !data || !data.session || !data.session.access_token) {
            showError(error && error.message ? error.message : 'Invalid credentials. Please try again.');
            return;
          }

          const accessToken = data.session.access_token;
          setLoading('Initiating Google OAuth...');

          // 2. Request Google OAuth authorization URL from protected endpoint
          // Access token is transmitted ONLY in the Authorization header, NEVER in URLs or query strings.
          const res = await fetch('/auth/login', {
            method: 'GET',
            headers: {
              'Authorization': 'Bearer ' + accessToken,
              'Accept': 'application/json'
            }
          });

          if (!res.ok) {
            const errData = await res.json().catch(function() { return {}; });
            showError(errData.message || 'Failed to initiate Google OAuth (' + res.status + ')');
            return;
          }

          const result = await res.json();
          if (!result.url) {
            showError('Invalid response received from authentication server.');
            return;
          }

          setLoading('Redirecting to Google...');

          // 3. Navigate browser to Google OAuth consent URL
          // Access token is NEVER attached to the redirect URL or window history.
          window.location.href = result.url;

        } catch (err) {
          showError(err && err.message ? err.message : 'A network error occurred. Please try again.');
        }
      });
    })();
  </script>
</body>
</html>`;
}
