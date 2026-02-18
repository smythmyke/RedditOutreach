/**
 * RedditOutreach Credits Service
 * Adapted from BulkListingPro services/credits.js
 * Manages credit balance, Stripe checkout, and credit deduction
 */

const CREDITS_STORAGE_KEY = 'redditoutreach_credits';
const CREDITS_API_BASE = 'https://business-search-api-815700675676.us-central1.run.app';

class CreditsService {
  constructor() {
    this.cachedBalance = null;
    this.cacheTimestamp = 0;
    this.CACHE_DURATION = 30000; // 30s cache
    this.listeners = [];
  }

  static getInstance() {
    if (!CreditsService.instance) {
      CreditsService.instance = new CreditsService();
    }
    return CreditsService.instance;
  }

  onBalanceChange(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  notifyListeners(balance) {
    this.listeners.forEach(callback => callback(balance));
  }

  async getBalance(forceRefresh = false) {
    if (!forceRefresh && this.cachedBalance && Date.now() - this.cacheTimestamp < this.CACHE_DURATION) {
      return this.cachedBalance;
    }

    try {
      const headers = await getApiHeaders();
      const response = await fetch(`${CREDITS_API_BASE}/api/user/credits`, { headers });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Not authenticated');
        }
        throw new Error('Failed to fetch credits');
      }

      const data = await response.json();
      this.cachedBalance = data;
      this.cacheTimestamp = Date.now();

      await chrome.storage.local.set({ [CREDITS_STORAGE_KEY]: data });
      this.notifyListeners(data);

      return data;
    } catch (error) {
      // Fall back to cached value in storage
      const stored = await chrome.storage.local.get([CREDITS_STORAGE_KEY]);
      return stored[CREDITS_STORAGE_KEY] || { available: 0, used: 0, purchased: 0, monthlyAllocation: 0 };
    }
  }

  async getCreditPacks() {
    try {
      const response = await fetch(`${CREDITS_API_BASE}/api/stripe/credit-packs`);
      if (!response.ok) throw new Error('Failed to fetch credit packs');
      const data = await response.json();
      return data.packs || data;
    } catch (error) {
      // Hardcoded fallback packs
      return [
        { id: 'starter', name: 'Starter Pack', credits: 50, price: 199, priceFormatted: '$1.99', badge: null },
        { id: 'standard', name: 'Standard Pack', credits: 150, price: 499, priceFormatted: '$4.99', badge: 'popular' },
        { id: 'pro', name: 'Pro Pack', credits: 400, price: 1199, priceFormatted: '$11.99', badge: null },
        { id: 'power', name: 'Power Pack', credits: 1000, price: 2499, priceFormatted: '$24.99', badge: 'best_value' }
      ];
    }
  }

  async createCheckoutSession(packId) {
    const headers = await getApiHeaders();
    const response = await fetch(`${CREDITS_API_BASE}/api/stripe/create-credit-checkout`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        packId,
        successUrl: 'https://www.reddit.com/?ro_purchase=success',
        cancelUrl: 'https://www.reddit.com/?ro_purchase=canceled'
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to create checkout session');
    }

    return response.json();
  }

  async useCredits(amount, feature) {
    try {
      const headers = await getApiHeaders();
      const response = await fetch(`${CREDITS_API_BASE}/api/user/credits/use`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ amount, feature })
      });

      if (!response.ok) {
        if (response.status === 402) {
          const data = await response.json().catch(() => ({}));
          return {
            success: false,
            creditsRemaining: data.creditsAvailable || 0,
            error: 'insufficient_credits'
          };
        }
        if (response.status === 401) {
          return { success: false, error: 'not_authenticated' };
        }
        return { success: false, error: 'api_error' };
      }

      const data = await response.json();

      // Invalidate cache
      this.cachedBalance = null;
      this.cacheTimestamp = 0;

      // Update local storage
      const result = await chrome.storage.local.get([CREDITS_STORAGE_KEY]);
      const currentCredits = result[CREDITS_STORAGE_KEY] || { available: 0, used: 0 };
      const updatedCredits = {
        ...currentCredits,
        available: data.creditsRemaining,
        used: (currentCredits.used || 0) + (data.creditsUsed || amount)
      };

      await chrome.storage.local.set({ [CREDITS_STORAGE_KEY]: updatedCredits });
      this.notifyListeners(updatedCredits);

      return { success: true, creditsRemaining: data.creditsRemaining };
    } catch (error) {
      return { success: false, error: 'network_error' };
    }
  }

  invalidateCache() {
    this.cachedBalance = null;
    this.cacheTimestamp = 0;
  }
}

CreditsService.instance = null;
const creditsService = CreditsService.getInstance();
