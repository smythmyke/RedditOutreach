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

  PROJECTS: [
    { id: 'bulklistingpro', name: 'BulkListingPro' },
    { id: 'govtoolspro', name: 'GovToolsPro' },
    { id: 'patentsearch', name: 'Patent Search Generator' },
    { id: 'none', name: 'No Product' }
  ],

  // Keywords in subreddit rules that indicate no promotion allowed
  PROMO_BLOCK_KEYWORDS: [
    'no self-promotion', 'no promotion', 'no advertising',
    'no spam', 'no affiliate', 'no marketing',
    'self-promotion is not allowed', 'promotional posts will be removed',
    'no links to your own', 'no plugging'
  ],

  // --- Auto-detect scoring weights ---
  DETECT_WEIGHTS: {
    subreddit: 100,
    phrase: 50,
    high: 10,
    medium: 3
  },
  DETECT_THRESHOLD: 10, // Minimum score to auto-select

  // --- Project keyword libraries ---
  PROJECT_KEYWORDS: {
    bulklistingpro: {
      subreddits: [
        'etsy', 'etsysellers', 'ebay', 'ebaysellers', 'poshmark',
        'mercari', 'depop', 'facebookmarketplace', 'amazonhandmade',
        'flipping', 'reselling', 'reseller', 'sellercircle',
        'mercariselleradvice', 'grailed', 'vintageclothing',
        'sneakermarket', 'thrifting', 'thriftstorehauls',
        'handmade', 'crafts', 'artisangifts', 'printondemand',
        'ecommerce', 'dropship', 'sidehustle'
      ],
      high: [
        'cross-listing', 'crosslisting', 'cross-list', 'crosslist',
        'bulk listing', 'bulk list', 'multi-platform selling',
        'multi-channel selling', 'multichannel selling', 'listing tool',
        'inventory sync', 'delist', 'delisting', 'relist', 'relisting',
        'listing template', 'sku management', 'poshmark share',
        'poshmark closet', 'closet sharing', 'mercari listing',
        'depop listing', 'etsy listing', 'ebay listing',
        'marketplace listing', 'crosslister', 'cross-lister',
        'product listing', 'etsy shop', 'ebay store', 'poshmark seller',
        'mercari seller', 'depop seller', 'etsy seller', 'ebay seller',
        'list across platforms', 'sell across platforms',
        'sell on multiple platforms', 'cross-posted'
      ],
      medium: [
        'reselling', 'reseller', 'flipping', 'thrift', 'thrifting',
        'sourcing', 'inventory', 'shipping', 'seller fees',
        'marketplace fees', 'commission fees', 'price drop',
        'offer accepted', 'bundle', 'bundling', 'closet', 'storefront',
        'listing photos', 'sell online', 'side hustle', 'consignment',
        'wholesale', 'arbitrage', 'retail arbitrage', 'online arbitrage',
        'vintage seller', 'handmade seller', 'craft seller',
        'product photos', 'flat lay', 'sales tax'
      ],
      phrases: [
        'cross list to', 'cross listing tool', 'crosslisting app',
        'list on multiple platforms', 'listing across platforms',
        'sell on etsy and ebay', 'sell on poshmark and mercari',
        'sell on multiple marketplaces', 'inventory sync across',
        'sync inventory between', 'bulk upload listings',
        'copy listing to', 'duplicate listing across',
        'import listings from', 'export listings to',
        'manage listings across', 'etsy to ebay', 'poshmark to mercari',
        'mercari to depop', 'ebay to etsy', 'depop to poshmark',
        'listing description generator', 'multi-platform inventory',
        'overselling problem', 'sold on one platform',
        'keep inventory in sync', 'how to cross list',
        'best crosslisting tool', 'tired of listing manually',
        'listing one by one', 'takes forever to list',
        'automate my listings', 'share my closet',
        'closet sharing tool', 'auto relist', 'bulk edit listings',
        'facebook marketplace listing', 'amazon handmade listing',
        'which platforms should i sell on', 'starting an etsy shop',
        'starting an ebay store', 'how to sell on etsy',
        'how to sell on ebay', 'how to sell on poshmark',
        'how to sell on mercari', 'how to sell on depop'
      ]
    },

    govtoolspro: {
      subreddits: [
        'govcontracting', 'governmentcontracts', 'federalcontracting',
        'government', 'federalemployees', 'procurement',
        'defenseindustry', 'securityclearance'
      ],
      high: [
        'sam.gov', 'sam registration', 'cage code', 'cage number',
        'naics code', 'naics codes', 'sic code', 'duns number',
        'uei number', 'uei', 'unique entity identifier',
        'government contract', 'government contracting', 'govt contract',
        'gov contract', 'federal contract', 'federal contracting',
        'federal procurement', 'gsa schedule', 'gsa contract', 'gsa mas',
        '8(a) certification', '8a certification', '8(a) program',
        'hubzone', 'hubzone certification', 'wosb', 'sdvosb', 'vosb',
        'small disadvantaged business', 'sdb certification',
        'far regulation', 'dfars', 'rfp', 'rfq', 'rfi',
        'capability statement', 'past performance', 'cpars',
        'set-aside', 'small business set-aside', 'sole source',
        'idiq', 'bpa', 'blanket purchase agreement', 'task order',
        'gwac', 'contract vehicle', 'sbir', 'sttr', 'govwin',
        'fedbizopps', 'fpds', 'usaspending', 'subcontracting plan',
        'mentor-protege', 'dcaa', 'dcaa audit', 'cmmc', 'fedramp',
        'sam entity', 'federal supply schedule'
      ],
      medium: [
        'procurement', 'bid', 'bidding', 'proposal', 'solicitation',
        'compliance', 'certification', 'registration',
        'entity registration', 'small business certification',
        'contractor', 'subcontractor', 'prime contractor',
        'teaming agreement', 'joint venture', 'cost-plus',
        'fixed-price', 'time and materials', 'contracting officer',
        'technical evaluation', 'price evaluation', 'best value',
        'lpta', 'incumbent', 're-compete', 'protest', 'gao protest',
        'security clearance', 'public sector', 'federal agency'
      ],
      phrases: [
        'register on sam', 'sam.gov registration',
        'how to get a cage code', 'apply for cage code',
        'find my naics code', 'what naics code', 'which naics code',
        'naics code for', 'get uei number', 'replace duns number',
        'government contract bid', 'bid on federal contract',
        'find government contracts', 'search government contracts',
        'government contracting for beginners',
        'new to government contracting', 'start government contracting',
        'get into government contracting', 'how to sell to the government',
        'sell to federal government', 'gsa schedule application',
        'apply for gsa schedule', 'gsa mas contract',
        '8(a) application', 'apply for 8a',
        'hubzone certified', 'hubzone eligibility',
        'wosb certification', 'sdvosb certification',
        'veteran owned small business', 'woman owned small business',
        'service disabled veteran', 'capability statement template',
        'write a capability statement', 'past performance reference',
        'cpars rating', 'small business set aside', 'sba certification',
        'federal opportunity', 'government rfp', 'respond to rfp',
        'proposal for government', 'win government contract',
        'far compliance', 'dfars requirements',
        'dcaa compliant accounting', 'cmmc compliance',
        'cmmc certification', 'subcontracting opportunity',
        'mentor protege program', 'federal acquisition regulation'
      ]
    },

    patentsearch: {
      subreddits: [
        'patents', 'patentlaw', 'intellectualproperty',
        'patentexaminer', 'inventions', 'inventor'
      ],
      high: [
        'patent search', 'patent application', 'patent filing',
        'patent pending', 'patent granted', 'patent claim',
        'patent claims', 'prior art', 'prior art search',
        'prior art analysis', 'patent classification', 'cpc code',
        'cpc classification', 'ipc code', 'ipc classification',
        'uspto', 'us patent office', 'united states patent',
        'google patents', 'patent examiner', 'patent prosecution',
        'office action', 'patent attorney', 'patent agent',
        'patent lawyer', 'patent bar', 'invention disclosure',
        'provisional patent', 'provisional application',
        'non-provisional', 'utility patent', 'design patent',
        'plant patent', 'patent infringement', 'freedom to operate',
        'fto search', 'fto analysis', 'invalidity search',
        'validity search', 'patentability', 'patentability search',
        'novelty search', 'novelty requirement', 'non-obviousness',
        '35 usc 101', '35 usc 102', '35 usc 103', '35 usc 112',
        'section 101', 'section 102', 'section 103',
        'claim chart', 'claim construction', 'claim limitation',
        'patent landscape', 'patent map', 'patent portfolio',
        'patent family', 'continuation patent', 'continuation-in-part',
        'divisional application', 'pct application', 'pct filing',
        'wipo', 'epo', 'patent cooperation treaty',
        'international patent', 'patent citation',
        'patent specification', 'patent drawing', 'patent figure',
        'patent abstract'
      ],
      medium: [
        'intellectual property', 'ip protection', 'ip portfolio',
        'ip strategy', 'trade secret', 'licensing',
        'patent licensing', 'royalty', 'royalties', 'infringement',
        'cease and desist', 'disclosure', 'enablement',
        'written description', 'abstract idea', 'inventive step',
        'patent troll', 'npe', 'standard-essential patent',
        'cross-license', 'defensive patent', 'claim drafting',
        'prior art reference', 'state of the art'
      ],
      phrases: [
        'search for patents', 'patent search tool',
        'how to search patents', 'search uspto', 'search google patents',
        'find prior art', 'prior art for my invention',
        'is my idea patented', 'is my invention patentable',
        'has this been patented', 'already been patented',
        'someone already patented', 'patent my idea',
        'patent my invention', 'patent an idea', 'file a patent',
        'filing a patent', 'apply for a patent', 'how to patent',
        'cost to patent', 'patent cost', 'provisional patent application',
        'file a provisional', 'convert provisional to non-provisional',
        'patent search report', 'freedom to operate search',
        'freedom to operate analysis', 'fto opinion',
        'patent landscape analysis', 'cpc classification search',
        'ipc classification code', 'patent claim language',
        'write patent claims', 'draft patent claims',
        'respond to office action', 'patent office action',
        'alice rejection', '101 rejection', 'abstract idea rejection',
        'patent prosecution history', 'continuation application',
        'pct international search', 'international search report',
        'invention disclosure form', 'disclose my invention',
        'patent classification search', 'find similar patents',
        'patent number lookup', 'us patent number',
        'patent family search', 'patent citation analysis',
        'patent infringement analysis', 'design around a patent',
        'invalidity opinion', 'patent eligibility',
        'subject matter eligibility', 'patent search strategy'
      ]
    }
  }
};
