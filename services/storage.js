/**
 * RedditOutreach Storage Service
 * Adapted from BulkListingPro services/storage.js
 */

const STORAGE_KEYS = {
  USER: 'redditoutreach_user',
  TOKEN: 'redditoutreach_token',
  CREDITS: 'redditoutreach_credits',
  PROJECT: 'ro_project',
  TONE: 'ro_tone',
  HISTORY: 'ro_history'
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
