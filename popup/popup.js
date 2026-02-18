/**
 * RedditOutreach Popup Script
 * Adapted from BulkListingPro popup/popup.js
 */

document.addEventListener('DOMContentLoaded', async () => {
  const loggedInEl = document.getElementById('logged-in');
  const loggedOutEl = document.getElementById('logged-out');
  const creditCount = document.getElementById('credit-count');
  const userName = document.getElementById('user-name');
  const userEmail = document.getElementById('user-email');
  const userAvatar = document.getElementById('user-avatar');
  const signInBtn = document.getElementById('sign-in');
  const signOutBtn = document.getElementById('sign-out');
  const buyCreditsBtn = document.getElementById('buy-credits');
  const versionEl = document.getElementById('version');

  // Show version
  const manifest = chrome.runtime.getManifest();
  versionEl.textContent = 'v' + manifest.version;

  // Check auth status via background
  let authStatus;
  try {
    authStatus = await chrome.runtime.sendMessage({ type: 'CHECK_AUTH' });
  } catch (error) {
    // Fallback to direct storage read
    const stored = await chrome.storage.local.get(['redditoutreach_user', 'redditoutreach_token', 'redditoutreach_credits']);
    authStatus = {
      authenticated: !!(stored.redditoutreach_user && stored.redditoutreach_token),
      user: stored.redditoutreach_user,
      credits: stored.redditoutreach_credits
    };
  }

  if (authStatus && authStatus.authenticated) {
    showLoggedIn(authStatus.user, authStatus.credits);
  } else {
    showLoggedOut();
  }

  function showLoggedIn(user, credits) {
    loggedInEl.classList.remove('hidden');
    loggedOutEl.classList.add('hidden');

    if (user) {
      userName.textContent = user.name || '';
      userEmail.textContent = user.email || '';
      if (user.picture) {
        userAvatar.src = user.picture;
      }
    }

    if (credits && credits.available !== undefined) {
      creditCount.textContent = credits.available;
    }

    // Fetch fresh credits
    chrome.runtime.sendMessage({ type: 'CHECK_CREDITS' }).then(resp => {
      if (resp && resp.success && resp.credits) {
        creditCount.textContent = resp.credits.available;
      }
    }).catch(() => {});
  }

  function showLoggedOut() {
    loggedInEl.classList.add('hidden');
    loggedOutEl.classList.remove('hidden');
  }

  // Sign in
  signInBtn.addEventListener('click', async () => {
    signInBtn.disabled = true;
    signInBtn.textContent = 'Signing in...';
    try {
      const result = await chrome.runtime.sendMessage({ type: 'SIGN_IN' });
      if (result && result.success) {
        showLoggedIn(result.user, result.credits);
      } else {
        signInBtn.textContent = 'Sign in failed — retry';
        signInBtn.disabled = false;
      }
    } catch (err) {
      signInBtn.textContent = 'Sign in failed — retry';
      signInBtn.disabled = false;
    }
  });

  // Sign out
  signOutBtn.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'SIGN_OUT' });
    showLoggedOut();
  });

  // Buy credits
  buyCreditsBtn.addEventListener('click', async () => {
    const result = await chrome.runtime.sendMessage({ type: 'BUY_CREDITS' });
    if (result && result.checkoutUrl) {
      chrome.tabs.create({ url: result.checkoutUrl });
      window.close();
    }
  });

  // Footer links
  document.getElementById('privacy-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('docs/privacy-policy.html') });
    window.close();
  });

  document.getElementById('terms-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('docs/terms-of-service.html') });
    window.close();
  });
});
