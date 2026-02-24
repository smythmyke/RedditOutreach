const CONFIG = {
  API_URL: 'https://business-search-api-815700675676.us-central1.run.app',

  TONES: ['friendly', 'casual', 'professional', 'comical', 'short'],

  TONE_LABELS: {
    friendly: 'Friendly',
    casual: 'Casual',
    professional: 'Professional',
    comical: 'Comical',
    short: 'Short'
  },

  // Keywords in subreddit rules that indicate no promotion allowed
  PROMO_BLOCK_KEYWORDS: [
    'no self-promotion', 'no promotion', 'no advertising',
    'no spam', 'no affiliate', 'no marketing',
    'self-promotion is not allowed', 'promotional posts will be removed',
    'no links to your own', 'no plugging'
  ],

  // Keywords in Facebook group rules that indicate no promotion allowed
  FB_PROMO_BLOCK_KEYWORDS: [
    'no self-promotion', 'no promotion', 'no advertising',
    'no spam', 'no affiliate', 'no marketing', 'no selling',
    'no links', 'no business promotion'
  ],

  DETECT_THRESHOLD: 10, // Minimum score to auto-select a product

  // Search mode
  SEARCH_DEFAULTS: { timeRange: 'week', sortBy: 'new', maxResults: 20 },
  MAX_CONCEPTS: 20,
  MAX_SEARCH_QUERIES: 10,

  // Post generation
  POST_STYLES: ['question', 'discussion', 'story'],
  POST_STYLE_LABELS: {
    question: 'Question',
    discussion: 'Discussion',
    story: 'Story'
  },
  POST_TYPES: ['text', 'link'],
  POST_TYPE_LABELS: {
    text: 'Text',
    link: 'Link'
  }
};
