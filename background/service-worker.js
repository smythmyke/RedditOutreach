importScripts('../config.js');
importScripts('../services/auth.js');
importScripts('../services/storage.js');
importScripts('../services/credits.js');

// --- Auth token helper ---

async function getAuthToken() {
  const result = await chrome.storage.local.get(['marketeer_token', 'authToken']);
  return result.marketeer_token || result.authToken || null;
}

function getExtensionHeaders() {
  return {
    'X-Extension-Id': chrome.runtime.id || 'unknown',
    'X-Extension-Version': chrome.runtime.getManifest().version,
    'X-Extension-Name': 'Marketeer'
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
            marketeer_token: newToken,
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
      marketeer_installed: Date.now(),
      ro_project: 'none'
    });
    // Open welcome tab on first install
    chrome.tabs.create({
      url: chrome.runtime.getURL('docs/welcome.html')
    });
  }
});

// --- Detect Stripe purchase redirect ---

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && changeInfo.url.includes('ro_purchase=success')) {
    // User returned from Stripe checkout — refresh credit balance
    creditsService.invalidateCache();
    creditsService.getBalance(true).catch(() => {});
    // Notify any open popups/panels
    chrome.runtime.sendMessage({ type: 'CREDITS_UPDATED' }).catch(() => {});
  }
});

// --- Message handler ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only accept messages from this extension
  if (sender.id !== chrome.runtime.id) return;

  switch (message.type) {
    case 'GENERATE_ALL':
      handleGenerateAll(message.postData, message.projectId, message.product, message.subredditRules, message.replyTo)
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

    case 'GENERATE_POST':
      handleGeneratePost(message)
        .then(responses => sendResponse({ responses }))
        .catch(err => sendResponse({ error: err.message }));
      return true;

    case 'GENERATE_PRODUCT_META':
      handleGenerateProductMeta(message.name, message.link, message.features)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ error: err.message }));
      return true;

    case 'USE_PRODUCT_CREDIT':
      handleUseProductCredit()
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'EXPAND_PRODUCT_LIMIT':
      handleExpandProductLimit()
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'GENERATE_SEARCH_QUERIES':
      handleGenerateSearchQueries(message.products)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ error: err.message }));
      return true;

    case 'EXECUTE_SEARCH':
      handleExecuteSearch(message.queries, message.settings)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ error: err.message }));
      return true;

    case 'SUGGEST_CONCEPTS':
      handleSuggestConcepts(message.name, message.features, message.keywords)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ error: err.message }));
      return true;

    case 'GENERATE_ALL_FACEBOOK':
      handleGenerateAllFacebook(message.postData, message.projectId, message.product)
        .then(responses => sendResponse({ responses }))
        .catch(err => sendResponse({ error: err.message }));
      return true;

    case 'SET_AUTO_SEARCH':
      if (message.enabled && message.intervalMinutes) {
        chrome.alarms.create('marketeer_auto_search', {
          periodInMinutes: Math.max(message.intervalMinutes, 30)
        });
      } else {
        chrome.alarms.clear('marketeer_auto_search');
      }
      sendResponse({ success: true });
      return true;
  }
});

// --- Generation with credit deduction ---

const CREDITS_PER_GENERATION = 1;

async function handleGenerateAll(postData, projectId, product, subredditRules, replyTo) {
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

  // Build payload
  const payload = {
    subreddit: truncate(postData.subreddit, 100),
    title: truncate(postData.title, 500),
    body: truncate(postData.body || '', 5000),
    comments: truncate(postData.comments || '', 5000),
    tones: CONFIG.TONES,
    projectId: projectId || 'none',
    subredditRules: truncate(subredditRules || '', 3000)
  };

  // Send user-defined product context if provided
  if (product && product.name) {
    payload.product = {
      name: truncate(product.name, 100),
      link: truncate(product.link, 500),
      features: truncate(product.features, 2000),
      benefits: truncate(product.benefits, 1000),
      scenarios: truncate(product.scenarios, 1000)
    };
  }

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

async function handleGenerateAllFacebook(postData, projectId, product) {
  const token = await getAuthToken();
  if (!token) {
    throw new Error('Sign in required to generate comments');
  }

  const creditResult = await creditsService.useCredits(CREDITS_PER_GENERATION, 'facebook_generate');
  if (!creditResult.success) {
    if (creditResult.error === 'insufficient_credits') {
      throw new Error(`Insufficient credits (${creditResult.creditsRemaining} remaining). Purchase more to continue.`);
    }
    if (creditResult.error === 'not_authenticated') {
      throw new Error('Session expired — please sign in again');
    }
    throw new Error('Failed to verify credits. Please try again.');
  }

  function truncate(str, max) {
    return typeof str === 'string' ? str.slice(0, max) : '';
  }

  const payload = {
    groupName: truncate(postData.groupName, 200),
    postAuthor: truncate(postData.postAuthor, 100),
    postText: truncate(postData.postText, 5000),
    comments: truncate(postData.comments || '', 5000),
    tones: CONFIG.TONES,
    projectId: projectId || 'none'
  };

  if (product && product.name) {
    payload.product = {
      name: truncate(product.name, 100),
      link: truncate(product.link, 500),
      features: truncate(product.features, 2000),
      benefits: truncate(product.benefits, 1000),
      scenarios: truncate(product.scenarios, 1000)
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await apiFetch('/api/v1/facebook-generate', {
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

async function handleGeneratePost({ subreddit, projectId, product, postStyle, postType, subredditRules }) {
  console.log('[Marketeer] handleGeneratePost called:', { subreddit, projectId, postStyle, postType, hasProduct: !!product });

  const token = await getAuthToken();
  if (!token) {
    console.error('[Marketeer] handleGeneratePost: no auth token');
    throw new Error('Sign in required to generate posts');
  }
  console.log('[Marketeer] handleGeneratePost: auth token present');

  const creditResult = await creditsService.useCredits(CREDITS_PER_GENERATION, 'reddit_generate_post');
  if (!creditResult.success) {
    if (creditResult.error === 'insufficient_credits') {
      throw new Error(`Insufficient credits (${creditResult.creditsRemaining} remaining). Purchase more to continue.`);
    }
    if (creditResult.error === 'not_authenticated') {
      throw new Error('Session expired — please sign in again');
    }
    throw new Error('Failed to verify credits. Please try again.');
  }

  function truncate(str, max) {
    return typeof str === 'string' ? str.slice(0, max) : '';
  }

  const payload = {
    subreddit: truncate(subreddit, 100),
    tones: CONFIG.TONES,
    postStyle: postStyle || 'question',
    postType: postType || 'text',
    projectId: projectId || 'none',
    subredditRules: truncate(subredditRules || '', 3000)
  };

  if (product && product.name) {
    payload.product = {
      name: truncate(product.name, 100),
      link: truncate(product.link, 500),
      features: truncate(product.features, 2000),
      benefits: truncate(product.benefits, 1000),
      scenarios: truncate(product.scenarios, 1000)
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    console.log('[Marketeer] handleGeneratePost: calling API...', JSON.stringify(payload).length, 'bytes');
    const res = await apiFetch('/api/v1/reddit-generate-post', {
      method: 'POST',
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    console.log('[Marketeer] handleGeneratePost: response status', res.status);

    if (!res.ok) {
      const errBody = await res.text();
      console.error('[Marketeer] handleGeneratePost: API error', res.status, errBody.slice(0, 500));
      if (res.status === 401) throw new Error('Session expired — please sign in again');
      if (res.status === 402) throw new Error('Insufficient credits — purchase more to continue');
      if (res.status === 429) throw new Error('Rate limit exceeded — wait a moment');
      if (res.status === 503) throw new Error('AI service unavailable');
      throw new Error('Failed to generate post. Please try again.');
    }

    const data = await res.json();
    if (!data.responses) throw new Error('Empty response from API');
    console.log('[Marketeer] handleGeneratePost: success, tones:', Object.keys(data.responses));
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

async function handleGenerateProductMeta(name, link, features) {
  console.log('[Marketeer] generateProductMeta called:', { name, link: link?.slice(0, 50), featuresLen: features?.length });

  const token = await getAuthToken();
  if (!token) {
    console.error('[Marketeer] generateProductMeta: no auth token');
    throw new Error('Sign in required');
  }
  console.log('[Marketeer] generateProductMeta: auth token present');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const payload = { name, link, features };
    console.log('[Marketeer] generateProductMeta: calling API...');
    const res = await apiFetch('/api/v1/reddit/generate-product-meta', {
      method: 'POST',
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    console.log('[Marketeer] generateProductMeta: response status', res.status);

    if (!res.ok) {
      const errBody = await res.text();
      console.error('[Marketeer] generateProductMeta: API error', res.status, errBody.slice(0, 500));
      if (res.status === 401) throw new Error('Session expired — please sign in again');
      if (res.status === 429) throw new Error('Too many requests — wait a moment');
      if (res.status === 503) throw new Error('AI service unavailable');
      throw new Error('Failed to generate product metadata (' + res.status + '): ' + errBody.slice(0, 200));
    }

    const data = await res.json();
    console.log('[Marketeer] generateProductMeta: success', { benefits: !!data.benefits, subreddits: data.subreddits?.length });
    return data;
  } catch (err) {
    console.error('[Marketeer] generateProductMeta: caught error', err.message || err);
    if (err.name === 'AbortError') {
      throw new Error('Request timed out — please try again');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// --- Product credit handlers ---

async function handleUseProductCredit() {
  const result = await creditsService.useCredits(1, 'product_create');
  if (!result.success) {
    return {
      success: false,
      error: result.error,
      creditsRemaining: result.creditsRemaining || 0
    };
  }
  return { success: true, creditsRemaining: result.creditsRemaining };
}

async function handleExpandProductLimit() {
  // Deduct 5 credits
  const result = await creditsService.useCredits(5, 'product_limit_expand');
  if (!result.success) {
    if (result.error === 'insufficient_credits') {
      return { success: false, error: 'Not enough credits (need 5)', creditsRemaining: result.creditsRemaining || 0 };
    }
    return { success: false, error: result.error || 'Failed to deduct credits' };
  }

  // Increase limit by 20
  const stored = await chrome.storage.local.get(['marketeer_product_limit']);
  const currentLimit = stored.marketeer_product_limit || 20;
  const newLimit = currentLimit + 20;
  await chrome.storage.local.set({ marketeer_product_limit: newLimit });

  return { success: true, newLimit, creditsRemaining: result.creditsRemaining };
}

// --- Search mode handlers ---

async function handleGenerateSearchQueries(products) {
  const token = await getAuthToken();
  if (!token) throw new Error('Sign in required');

  const payload = {
    products: (products || []).slice(0, 20).map(p => ({
      id: p.id,
      name: (p.name || '').slice(0, 100),
      features: (p.features || '').slice(0, 500),
      keywords: (p.keywords || []).slice(0, 10),
      concepts: (p.concepts || []).slice(0, 10),
      subreddits: (p.subreddits || []).slice(0, 10)
    }))
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await apiFetch('/api/v1/reddit/generate-search-queries', {
      method: 'POST',
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!res.ok) {
      const errBody = await res.text();
      if (res.status === 401) throw new Error('Session expired — please sign in again');
      if (res.status === 429) throw new Error('Too many requests — wait a moment');
      throw new Error('Failed to generate search queries (' + res.status + ')');
    }

    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out');
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function handleExecuteSearch(queries, settings) {
  if (!queries || !queries.length) return { results: [] };

  const defaults = CONFIG.SEARCH_DEFAULTS;
  const timeRange = (settings && settings.timeRange) || defaults.timeRange;
  const sortBy = (settings && settings.sortBy) || defaults.sortBy;
  const maxResults = Math.min((settings && settings.maxResults) || defaults.maxResults, 50);
  const limitPerQuery = Math.min(Math.ceil(maxResults / queries.length), 25);

  const seen = new Set();
  const allResults = [];

  for (let i = 0; i < Math.min(queries.length, CONFIG.MAX_SEARCH_QUERIES); i++) {
    const q = queries[i];
    let url;

    if (q.subreddit) {
      url = `https://www.reddit.com/r/${encodeURIComponent(q.subreddit)}/search.json?q=${encodeURIComponent(q.query)}&restrict_sr=on&sort=${sortBy}&t=${timeRange}&limit=${limitPerQuery}`;
    } else {
      url = `https://www.reddit.com/search.json?q=${encodeURIComponent(q.query)}&sort=${sortBy}&t=${timeRange}&limit=${limitPerQuery}`;
    }

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Marketeer/1.0' }
      });

      if (!res.ok) {
        console.warn('[Marketeer Search] Query failed:', res.status, q.query);
        continue;
      }

      const data = await res.json();
      const posts = (data.data && data.data.children) || [];

      for (const child of posts) {
        const post = child.data;
        if (!post || seen.has(post.id)) continue;
        seen.add(post.id);

        allResults.push({
          id: post.id,
          title: post.title || '',
          selftext: (post.selftext || '').slice(0, 500),
          subreddit: post.subreddit || '',
          author: post.author || '',
          score: post.score || 0,
          numComments: post.num_comments || 0,
          permalink: post.permalink || '',
          createdUtc: post.created_utc || 0,
          productId: q.productId || ''
        });
      }
    } catch (err) {
      console.warn('[Marketeer Search] Fetch error for query:', q.query, err.message);
    }

    // Rate limiting: 600ms between requests
    if (i < queries.length - 1) {
      await new Promise(r => setTimeout(r, 600));
    }
  }

  return { results: allResults.slice(0, maxResults * 2) };
}

async function handleSuggestConcepts(name, features, keywords) {
  const token = await getAuthToken();
  if (!token) throw new Error('Sign in required');

  const payload = {
    name: (name || '').slice(0, 100),
    features: (features || '').slice(0, 2000),
    keywords: (keywords || []).slice(0, 20)
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await apiFetch('/api/v1/reddit/suggest-concepts', {
      method: 'POST',
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!res.ok) {
      const errBody = await res.text();
      if (res.status === 401) throw new Error('Session expired — please sign in again');
      if (res.status === 429) throw new Error('Too many requests — wait a moment');
      throw new Error('Failed to suggest concepts (' + res.status + ')');
    }

    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out');
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// --- Auto-search alarm ---

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'marketeer_auto_search') return;

  try {
    const token = await getAuthToken();
    if (!token) return;

    const stored = await chrome.storage.local.get(['marketeer_products', 'marketeer_search_settings']);
    const products = (stored.marketeer_products || []).filter(p =>
      (p.concepts && p.concepts.length) || (p.keywords && p.keywords.length)
    );
    if (!products.length) return;

    const queryResult = await handleGenerateSearchQueries(products);
    if (!queryResult.queries || !queryResult.queries.length) return;

    const settings = stored.marketeer_search_settings || {};
    const searchResult = await handleExecuteSearch(queryResult.queries, settings);

    if (searchResult.results && searchResult.results.length) {
      await chrome.storage.local.set({
        marketeer_search_results: {
          results: searchResult.results,
          timestamp: Date.now()
        }
      });

      chrome.action.setBadgeText({ text: String(searchResult.results.length) });
      chrome.action.setBadgeBackgroundColor({ color: '#f56040' });
    }
  } catch (err) {
    console.warn('[Marketeer] Auto-search alarm error:', err.message);
  }
});
