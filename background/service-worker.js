importScripts('../config.js');
importScripts('../services/auth.js');
importScripts('../services/storage.js');

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
            chrome.storage.local.get(['redditoutreach_credits'], (data) => {
              sendResponse({ ...result, credits: data.redditoutreach_credits || null });
            });
          } else {
            sendResponse(result);
          }
        })
        .catch(() => sendResponse({ authenticated: false, user: null }));
      return true;

    case 'SIGN_IN':
      authService.signIn()
        .then(user => {
          // Fetch initial credits after sign-in
          fetchCredits().then(credits => {
            sendResponse({ success: true, user, credits });
          }).catch(() => {
            sendResponse({ success: true, user, credits: null });
          });
        })
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'SIGN_OUT':
      authService.signOut()
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'CHECK_CREDITS':
      fetchCredits()
        .then(credits => sendResponse({ success: true, credits }))
        .catch(() => sendResponse({ success: false, credits: null }));
      return true;

    case 'BUY_CREDITS':
      handleBuyCredits()
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ error: err.message }));
      return true;
  }
});

// --- Credits ---

async function fetchCredits() {
  const headers = await getApiHeaders();
  const res = await fetch(CONFIG.API_URL + '/api/user/credits', { headers });

  if (!res.ok) {
    // Fall back to cached credits
    const cached = await chrome.storage.local.get(['redditoutreach_credits']);
    return cached.redditoutreach_credits || { available: 0 };
  }

  const data = await res.json();
  await chrome.storage.local.set({ redditoutreach_credits: data });
  return data;
}

async function handleBuyCredits() {
  const headers = await getApiHeaders();

  // Get available packs
  const packsRes = await fetch(CONFIG.API_URL + '/api/stripe/credit-packs', { headers });
  const packs = packsRes.ok ? await packsRes.json() : null;

  // Default to first pack if available, or a standard pack ID
  const packId = (packs && packs.length > 0) ? packs[0].id : 'standard';

  const res = await fetch(CONFIG.API_URL + '/api/stripe/create-credit-checkout', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      packId,
      successUrl: 'https://business-search-api-815700675676.us-central1.run.app/api/v1/health',
      cancelUrl: 'https://www.reddit.com'
    })
  });

  if (!res.ok) throw new Error('Failed to create checkout session');
  return await res.json();
}

// --- Generation ---

async function handleGenerateAll(postData, projectId, subredditRules, replyTo) {
  // Check auth first
  const token = await getAuthToken();
  if (!token) {
    throw new Error('Sign in required to generate comments');
  }

  const payload = {
    subreddit: postData.subreddit,
    title: postData.title,
    body: postData.body || '',
    comments: postData.comments || '',
    tones: CONFIG.TONES,
    projectId: projectId || 'none',
    subredditRules: subredditRules || ''
  };

  // Include reply context if replying to a specific comment
  if (replyTo) {
    payload.replyTo = replyTo;
  }

  const headers = await getApiHeaders();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(CONFIG.API_URL + '/api/v1/reddit-generate', {
      method: 'POST',
      headers,
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
