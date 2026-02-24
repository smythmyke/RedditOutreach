/**
 * Marketeer Storage Service
 * Adapted from BulkListingPro services/storage.js
 */

const STORAGE_KEYS = {
  USER: 'marketeer_user',
  TOKEN: 'marketeer_token',
  CREDITS: 'marketeer_credits',
  PROJECT: 'ro_project',
  TONE: 'ro_tone',
  HISTORY: 'ro_history',
  PRODUCTS: 'marketeer_products',
  PRODUCT_LIMIT: 'marketeer_product_limit',
  SEARCH_RESULTS: 'marketeer_search_results',
  SEARCH_DISMISSED: 'marketeer_search_dismissed',
  SEARCH_SAVED: 'marketeer_search_saved',
  SEARCH_SETTINGS: 'marketeer_search_settings'
};

class StorageService {
  static getInstance() {
    if (!StorageService.instance) {
      StorageService.instance = new StorageService();
    }
    return StorageService.instance;
  }

  async get(key) {
    const result = await chrome.storage.local.get([key]);
    return result[key];
  }

  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  }

  async remove(key) {
    await chrome.storage.local.remove([key]);
  }

  async getMultiple(keys) {
    return chrome.storage.local.get(keys);
  }

  onChange(callback) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local') {
        callback(changes);
      }
    });
  }
}

StorageService.instance = null;
const storageService = StorageService.getInstance();
