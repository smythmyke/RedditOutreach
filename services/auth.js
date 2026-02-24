/**
 * Marketeer Auth Service
 * Adapted from BulkListingPro services/auth.js
 * Google OAuth 3-step flow: chrome.identity → Google userinfo → backend session
 */

const AUTH_API_BASE = 'https://business-search-api-815700675676.us-central1.run.app';
const AUTH_STORAGE_PREFIX = 'marketeer_';

class AuthService {
  constructor() {
    this.user = null;
    this.listeners = [];
  }

  static getInstance() {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  onAuthChange(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  notifyListeners(user) {
    this.listeners.forEach(callback => callback(user));
  }

  async signIn() {
    console.log('[Marketeer Auth] signIn() started');

    // Step 1: Get Google OAuth token via chrome.identity
    console.log('[Marketeer Auth] Step 1: Getting Google OAuth token...');
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError) {
          console.error('[Marketeer Auth] chrome.identity.getAuthToken error:', chrome.runtime.lastError.message);
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        console.log('[Marketeer Auth] Got OAuth token:', token ? 'yes (' + token.slice(0, 10) + '...)' : 'null');
        resolve(token);
      });
    });

    // Step 2: Get user profile from Google
    console.log('[Marketeer Auth] Step 2: Fetching Google user info...');
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!userInfoResponse.ok) {
      console.error('[Marketeer Auth] Google userinfo failed:', userInfoResponse.status);
      throw new Error(`Failed to get user info from Google (${userInfoResponse.status})`);
    }

    const userInfo = await userInfoResponse.json();
    console.log('[Marketeer Auth] Got user info:', userInfo.email);

    // Step 3: Register/authenticate with backend
    console.log('[Marketeer Auth] Step 3: Authenticating with backend...');
    const authResponse = await fetch(`${AUTH_API_BASE}/api/auth/google`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Extension-Id': chrome.runtime.id,
        'X-Extension-Name': 'Marketeer'
      },
      body: JSON.stringify({
        googleToken: token,
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture
      })
    });

    if (!authResponse.ok) {
      const errText = await authResponse.text().catch(() => '');
      console.error('[Marketeer Auth] Backend auth failed:', authResponse.status, errText);
      throw new Error(`Failed to authenticate with backend (${authResponse.status}): ${errText}`);
    }

    const authData = await authResponse.json();
    console.log('[Marketeer Auth] Backend auth success, token:', authData.token ? 'yes' : 'no');

    this.user = {
      email: userInfo.email,
      name: userInfo.name,
      picture: userInfo.picture,
      isAdmin: authData.isAdmin || false
    };

    await chrome.storage.local.set({
      [AUTH_STORAGE_PREFIX + 'token']: authData.token || token,
      [AUTH_STORAGE_PREFIX + 'user']: this.user,
      authToken: authData.token || token
    });

    this.notifyListeners(this.user);
    return this.user;
  }

  async signOut() {
    const result = await chrome.storage.local.get([AUTH_STORAGE_PREFIX + 'token']);
    const token = result[AUTH_STORAGE_PREFIX + 'token'];

    if (token) {
      await new Promise((resolve) => {
        chrome.identity.removeCachedAuthToken({ token }, resolve);
      });
    }

    await chrome.storage.local.remove([
      AUTH_STORAGE_PREFIX + 'token',
      AUTH_STORAGE_PREFIX + 'user',
      AUTH_STORAGE_PREFIX + 'credits',
      'authToken'
    ]);

    this.user = null;
    this.notifyListeners(null);
  }

  async checkAuth() {
    const result = await chrome.storage.local.get([
      AUTH_STORAGE_PREFIX + 'user',
      AUTH_STORAGE_PREFIX + 'token'
    ]);

    if (result[AUTH_STORAGE_PREFIX + 'user'] && result[AUTH_STORAGE_PREFIX + 'token']) {
      this.user = result[AUTH_STORAGE_PREFIX + 'user'];
      return { authenticated: true, user: this.user };
    }

    return { authenticated: false, user: null };
  }

  getUser() {
    return this.user;
  }
}

AuthService.instance = null;
const authService = AuthService.getInstance();
