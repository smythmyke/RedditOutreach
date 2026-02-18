importScripts('../config.js');
importScripts('../services/auth.js');
importScripts('../services/storage.js');
importScripts('../services/credits.js');

// --- Auth token helper ---

async function getAuthToken() {
  const result = await chrome.storage.local.get(['redditoutreach_token', 'authToken']);
  return result.redditoutreach_token || result.authToken || null;
}

function getExtensionHeaders() {
  return {
    'X-Extension-Id': chrome.runtime.id || 'unknown',
    'X-Extension-Version': chrome.runtime.getManifest().version,
    'X-Extension-Name': 'RedditOutreach'
  };
}

async function getApiHeaders() {
  const headers = {
    'Content-Type': 'application/json',
    ...getExtensionHeaders()
  };

  const token = await getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

// --- API fetch with 401 retry ---

async function apiFetch(endpoint, options = {}) {
  const headers = await getApiHeaders();
  const mergedOptions = { ...options, headers: { ...headers, ...options.headers } };

  const response = await fetch(CONFIG.API_URL + endpoint, mergedOptions);

  // Auto-retry on 401 with silent token refresh
  if (response.status === 401) {
    try {
      const token = await new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: false }, (token) => {
          if (chrome.runtime.lastError || !token) {
            reject(new Error('Token refresh failed'));
            return;
          }
          resolve(token);
        });
      });

      // Re-register with backend
      const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (userInfoRes.ok) {
        const userInfo = await userInfoRes.json();
        const authRes = await fetch(CONFIG.API_URL + '/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getExtensionHeaders() },
          body: JSON.stringify({ googleToken: token, email: userInfo.email, name: userInfo.name, picture: userInfo.picture })
        });
        if (authRes.ok) {
          const authData = await authRes.json();
          const newToken = authData.token || token;
          await chrome.storage.local.set({
            redditoutreach_token: newToken,
            authToken: newToken
          });
          mergedOptions.headers['Authorization'] = `Bearer ${newToken}`;
          return fetch(CONFIG.API_URL + endpoint, mergedOptions);
        }
      }
    } catch (refreshErr) {
      // Refresh failed — throw session expired
    }
    throw new Error('Session expired — please sign in again');
  }

  return response;
}

// --- Install handler (onboarding) ---

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({
      redditoutreach_installed: Date.now(),
      ro_project: 'none'
    });
    // Open welcome tab on first install
    chrome.tabs.create({
      url: chrome.runtime.getURL('docs/welcome.html')
    });
  }
});

// --- Message handler ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only accept messages from this extension
  if (sender.id !== chrome.runtime.id) return;

  switch (message.type) {
    case 'GENERATE_ALL':
      handleGenerateAll(message.postData, message.projectId, message.subredditRules, message.replyTo)
        .then(responses => sendResponse({ responses }))
        .catch(err => sendResponse({ error: err.message }));
      return true;

    case 'CHECK_AUTH':
      authService.checkAuth()
        .then(result => {
          if (result.authenticated) {
            creditsService.getBalance()
              .then(credits => sendResponse({ ...result, credits }))
              .catch(() => sendResponse({ ...result, credits: null }));
          } else {
            sendResponse(result);
          }
        })
        .catch(() => sendResponse({ authenticated: false, user: null }));
      return true;

    case 'SIGN_IN':
      authService.signIn()
        .then(user => {
          creditsService.getBalance(true).then(credits => {
            sendResponse({ success: true, user, credits });
          }).catch(() => {
            sendResponse({ success: true, user, credits: null });
          });
        })
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'SIGN_OUT':
      authService.signOut()
        .then(() => {
          creditsService.invalidateCache();
          sendResponse({ success: true });
        })
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'CHECK_CREDITS':
      creditsService.getBalance(true)
        .then(credits => sendResponse({ success: true, credits }))
        .catch(() => sendResponse({ success: false, credits: null }));
      return true;

    case 'BUY_CREDITS':
      creditsService.createCheckoutSession(message.packId || 'standard')
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ error: err.message }));
      return true;
  }
});

// --- Generation with credit deduction ---

const CREDITS_PER_GENERATION = 1;

async function handleGenerateAll(postData, projectId, subredditRules, replyTo) {
  // Check auth
  const token = await getAuthToken();
  if (!token) {
    throw new Error('Sign in required to generate comments');
  }

  // Deduct credits before generation
  const creditResult = await creditsService.useCredits(CREDITS_PER_GENERATION, 'reddit_generate');
  if (!creditResult.success) {
    if (creditResult.error === 'insufficient_credits') {
      throw new Error(`Insufficient credits (${creditResult.creditsRemaining} remaining). Purchase more to continue.`);
    }
    if (creditResult.error === 'not_authenticated') {
      throw new Error('Session expired — please sign in again');
    }
    throw new Error('Failed to verify credits. Please try again.');
  }

  // Truncate fields to prevent oversized payloads
  function truncate(str, max) {
    return typeof str === 'string' ? str.slice(0, max) : '';
  }

  const safeProject = CONFIG.PROJECTS.some(p => p.id === projectId) ? projectId : 'none';

  // Build payload
  const payload = {
    subreddit: truncate(postData.subreddit, 100),
    title: truncate(postData.title, 500),
    body: truncate(postData.body || '', 5000),
    comments: truncate(postData.comments || '', 5000),
    tones: CONFIG.TONES,
    projectId: safeProject,
    subredditRules: truncate(subredditRules || '', 3000)
  };

  if (replyTo) {
    payload.replyTo = {
      author: truncate(replyTo.author, 100),
      text: truncate(replyTo.text, 3000)
    };
  }

  // Call API with timeout and retry
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await apiFetch('/api/v1/reddit-generate', {
      method: 'POST',
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!res.ok) {
      const errBody = await res.text();
      if (res.status === 401) throw new Error('Session expired — please sign in again');
      if (res.status === 402) throw new Error('Insufficient credits — purchase more to continue');
      if (res.status === 429) throw new Error('Rate limit exceeded — wait a moment');
      if (res.status === 503) throw new Error('AI service unavailable');
      console.error(`API error (${res.status}):`, errBody.slice(0, 500));
      throw new Error('Failed to generate response. Please try again.');
    }

    const data = await res.json();
    if (!data.responses) throw new Error('Empty response from API');
    return data.responses;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Request timed out — please try again');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
