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
    // Step 1: Get Google OAuth token via chrome.identity
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(token);
      });
    });

    // Step 2: Get user profile from Google
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!userInfoResponse.ok) {
      throw new Error('Failed to get user info from Google');
    }

    const userInfo = await userInfoResponse.json();

    // Step 3: Register/authenticate with backend
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
      throw new Error('Failed to authenticate with backend');
    }

    const authData = await authResponse.json();

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
