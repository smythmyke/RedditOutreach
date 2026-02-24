(function () {
  const isOldReddit = location.hostname === 'old.reddit.com';

  // --- Detect Stripe purchase redirect ---
  const urlParams = new URLSearchParams(location.search);
  if (urlParams.get('ro_purchase') === 'success') {
    // Clean the URL so param doesn't persist
    const cleanUrl = location.origin + location.pathname;
    history.replaceState(null, '', cleanUrl);
  }

  // --- Utilities ---
  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  // --- URL & Page Detection ---
  function isPostPage() {
    return /\/r\/[^/]+\/comments\//.test(location.pathname);
  }

  function isSubmitPage() {
    const result = /\/r\/[^/]+\/submit\/?/.test(location.pathname);
    if (result) console.log('[Marketeer] isSubmitPage: true', location.pathname);
    return result;
  }

  function isCompressedView() {
    const link = document.querySelector('a[href*="/comments/"]');
    if (link && link.textContent.trim().toLowerCase().includes('see full discussion')) return true;
    return false;
  }

  // --- Post ID Extraction ---
  function getPostId() {
    const match = location.pathname.match(/\/comments\/([a-z0-9]+)/);
    return match ? match[1] : null;
  }

  function getPostIdFromUrl(url) {
    const match = url.match(/\/comments\/([a-z0-9]+)/);
    return match ? match[1] : null;
  }

  // --- Products Cache ---
  let productsCache = [];

  function loadProducts(callback) {
    chrome.storage.local.get(['marketeer_products'], (result) => {
      productsCache = result.marketeer_products || [];
      if (callback) callback();
    });
  }

  // Listen for product changes from options page
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.marketeer_products) {
      productsCache = changes.marketeer_products.newValue || [];
      // Update dropdown if panel exists
      if (panel) rebuildProjectDropdown();
    }
  });

  // --- Comment History Storage ---
  let historyCache = {};

  function loadHistory(callback) {
    chrome.storage.local.get(['ro_history'], (result) => {
      historyCache = result.ro_history || {};
      pruneHistory();
      if (callback) callback();
    });
  }

  function pruneHistory() {
    const MAX_ENTRIES = 500;
    const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
    const now = Date.now();
    const keys = Object.keys(historyCache);
    let changed = false;

    // Remove entries older than 90 days
    for (let i = 0; i < keys.length; i++) {
      const entry = historyCache[keys[i]];
      if (entry && entry.timestamp && (now - entry.timestamp) > MAX_AGE_MS) {
        delete historyCache[keys[i]];
        changed = true;
      }
    }

    // If still over max, remove oldest entries
    const remaining = Object.keys(historyCache);
    if (remaining.length > MAX_ENTRIES) {
      remaining.sort((a, b) => (historyCache[a].timestamp || 0) - (historyCache[b].timestamp || 0));
      const toRemove = remaining.length - MAX_ENTRIES;
      for (let i = 0; i < toRemove; i++) {
        delete historyCache[remaining[i]];
      }
      changed = true;
    }

    if (changed) {
      chrome.storage.local.set({ ro_history: historyCache });
    }
  }

  function saveToHistory(entry) {
    const postId = getPostId();
    if (!postId) return;

    historyCache[postId] = {
      postTitle: entry.postTitle || '',
      subreddit: entry.subreddit || '',
      projectId: entry.projectId || 'none',
      tone: entry.tone || '',
      timestamp: Date.now(),
      commentId: entry.commentId || null,
      replyAuthor: entry.replyAuthor || null
    };

    chrome.storage.local.set({ ro_history: historyCache });
  }

  function isPostCommented(postId) {
    return !!historyCache[postId];
  }

  // --- Activity Tracker (anti-bot warning, per-project) ---
  // Storage: { "2026-02-19": { "projectId": { count, timestamps }, ... } }
  function getTodayKey() {
    return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  }

  function getSelectedProjectId() {
    if (!panel) return 'none';
    return panel.querySelector('.ro-project-select').value || 'none';
  }

  function getActivityToday(callback, projectId) {
    chrome.storage.local.get(['marketeer_activity'], (result) => {
      const activity = result.marketeer_activity || {};
      const today = getTodayKey();
      const dayData = activity[today] || {};

      // Backward compat: old format had { count, timestamps } directly
      if (dayData.count !== undefined && dayData.timestamps !== undefined) {
        // Migrate old format — treat as "none" project
        callback({ count: dayData.count, timestamps: dayData.timestamps });
        return;
      }

      const pid = projectId || getSelectedProjectId();
      callback(dayData[pid] || { count: 0, timestamps: [] });
    });
  }

  function recordActivity() {
    const pid = getSelectedProjectId();
    chrome.storage.local.get(['marketeer_activity'], (result) => {
      const activity = result.marketeer_activity || {};
      const today = getTodayKey();

      // Migrate old format if needed
      if (activity[today] && activity[today].count !== undefined && activity[today].timestamps !== undefined) {
        const old = activity[today];
        activity[today] = { none: { count: old.count, timestamps: old.timestamps } };
      }

      if (!activity[today]) activity[today] = {};
      if (!activity[today][pid]) activity[today][pid] = { count: 0, timestamps: [] };
      activity[today][pid].count++;
      activity[today][pid].timestamps.push(Date.now());

      // Prune old days (keep last 7)
      const keys = Object.keys(activity).sort();
      while (keys.length > 7) {
        delete activity[keys.shift()];
      }

      chrome.storage.local.set({ marketeer_activity: activity });
      updateActivityDisplay();
    });
  }

  function updateActivityDisplay() {
    if (!panel) return;
    const badge = panel.querySelector('.ro-activity-badge');
    if (!badge) return;

    getActivityToday((today) => {
      const count = today.count;
      badge.textContent = count + ' today';
      badge.classList.remove('ro-activity-green', 'ro-activity-yellow', 'ro-activity-red');
      if (count >= 8) {
        badge.classList.add('ro-activity-red');
        badge.title = 'High activity for this product — slow down to avoid bot detection';
      } else if (count >= 5) {
        badge.classList.add('ro-activity-yellow');
        badge.title = 'Moderate activity for this product — consider spacing out';
      } else {
        badge.classList.add('ro-activity-green');
        badge.title = 'Activity for this product today';
      }
    });
  }

  // --- SPA Navigation Detection ---
  let lastUrl = location.href;
  let fab = null;
  let subredditRules = '';

  if (!isOldReddit) {
    window.addEventListener('popstate', onUrlChange);
    setInterval(() => {
      if (location.href !== lastUrl) onUrlChange();
    }, 500);
  }

  function onUrlChange() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;

    if (isPostPage()) {
      if (!fab) fab = createFAB();
      fab.style.display = '';
      setTimeout(scrapeSubredditRules, 1000);
      setTimeout(applyPostPageIndicators, 500);
      setTimeout(attachCommentListeners, 500);
    } else if (isSubmitPage()) {
      console.log('[Marketeer] onUrlChange: submit page detected');
      if (!fab) fab = createFAB();
      fab.style.display = '';
      setTimeout(scrapeSubredditRules, 1000);
    } else {
      if (fab) fab.style.display = 'none';
      closePanel();
      setTimeout(scanFeedForBadges, 500);
    }
  }

  // --- Subreddit Rules Scraping ---
  function scrapeSubredditRules() {
    subredditRules = '';
    const ruleEls = document.querySelectorAll(
      '[id*="widget-rules"] li, ' +
      'community-rules-flow li, ' +
      '.sidebar-rule, ' +
      'shreddit-subreddit-sidebar-card-community-rules li, ' +
      '[data-testid="community-rule"] .font-semibold, ' +
      '.nd\\:visible [class*="rule"]'
    );

    if (ruleEls.length > 0) {
      const rules = [];
      ruleEls.forEach(el => {
        const text = el.innerText.trim();
        if (text && text.length > 3) rules.push(text);
      });
      subredditRules = rules.join('\n');
    }

    if (!subredditRules) {
      const sidebar = document.querySelector(
        'shreddit-subreddit-header__description, ' +
        '[id*="widget-sidebar"], ' +
        '.sidebar-content'
      );
      if (sidebar) {
        const text = sidebar.innerText || '';
        const lines = text.split('\n').filter(l =>
          CONFIG.PROMO_BLOCK_KEYWORDS.some(kw => l.toLowerCase().includes(kw))
        );
        if (lines.length > 0) subredditRules = lines.join('\n');
      }
    }

    if (isOldReddit && !subredditRules) {
      const ruleBox = document.querySelector('.side .md, .side .rules');
      if (ruleBox) subredditRules = ruleBox.innerText.trim();
    }

    updateFABState();
  }

  function isPromotionBlocked() {
    if (!subredditRules) return false;
    const lower = subredditRules.toLowerCase();
    return CONFIG.PROMO_BLOCK_KEYWORDS.some(kw => lower.includes(kw));
  }

  function updateFABState() {
    if (!fab) return;
    const blocked = isPromotionBlocked();
    fab.classList.toggle('ro-blocked', blocked);
    fab.title = blocked
      ? 'Marketeer — Promotion restricted in this subreddit (use "No Product" mode)'
      : 'Marketeer — Generate Response';
  }

  // --- Always-Active Comment Selection ---
  // Comments are always hoverable/clickable on post pages. No target mode needed.
  let replyTarget = null; // { author, text, commentEl }
  let submitCooldown = false; // Prevents re-trigger after auto-submit

  function attachCommentListeners() {
    const selector = isOldReddit ? '.comment:not(.ro-clickable)' : 'shreddit-comment:not(.ro-clickable)';
    document.querySelectorAll(selector).forEach(el => {
      el.classList.add('ro-clickable', 'ro-hoverable');
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', 'Click to reply to this comment');
      el.addEventListener('mouseenter', onCommentHover);
      el.addEventListener('mouseleave', onCommentUnhover);
      el.addEventListener('click', onCommentClick);
      el.addEventListener('keydown', onCommentKeydown);
    });
  }

  function onCommentKeydown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onCommentClick(e);
    }
  }

  function onCommentHover(e) {
    // Don't highlight if panel is already open
    if (panel && panel.classList.contains('ro-visible')) return;
    e.currentTarget.classList.add('ro-highlight');
  }

  function onCommentUnhover(e) {
    e.currentTarget.classList.remove('ro-highlight');
  }

  function onCommentClick(e) {
    // Don't intercept if panel is open, recently submitted, or user clicked a link/button
    if (submitCooldown) return;
    if (panel && panel.classList.contains('ro-visible')) return;
    const clickedTag = e.target.tagName.toLowerCase();
    if (clickedTag === 'a' || clickedTag === 'button' || e.target.closest('a, button, [role="button"]')) return;

    e.preventDefault();
    e.stopPropagation();

    const commentEl = e.currentTarget;
    commentEl.classList.remove('ro-highlight');

    const data = extractCommentData(commentEl);
    if (!data || !data.text) {
      showToast('Could not extract comment text', 'error');
      return;
    }

    replyTarget = { author: data.author, text: data.text, commentEl };

    const postData = extractPostData();
    if (!postData.title) {
      showToast('Could not extract post data', 'error');
      return;
    }
    openPanel(postData);
  }

  function extractCommentData(commentEl) {
    if (isOldReddit) {
      const authorEl = commentEl.querySelector('.author');
      const bodyEl = commentEl.querySelector('> .entry .usertext-body .md');
      return {
        author: authorEl ? authorEl.textContent.trim() : 'unknown',
        text: bodyEl ? bodyEl.innerText.trim() : ''
      };
    }

    const author = commentEl.getAttribute('author') || 'unknown';
    const contentEl = commentEl.querySelector('[slot="comment"]') ||
      commentEl.querySelector('.md') ||
      commentEl.querySelector('[id*="comment-rtjson-content"]');
    const text = contentEl ? contentEl.innerText.trim() : '';
    return { author, text };
  }

  // --- Post Data Extraction ---
  function extractPostData() {
    const subreddit = location.pathname.split('/')[2] || '';
    if (isOldReddit) return extractOldReddit(subreddit);
    return extractNewReddit(subreddit);
  }

  function extractNewReddit(subreddit) {
    let title = '';
    let body = '';

    const shredditPost = document.querySelector('shreddit-post');
    if (shredditPost) {
      title = shredditPost.getAttribute('post-title') || '';
      const bodyEl = shredditPost.querySelector('[slot="text-body"]') ||
        shredditPost.querySelector('[id*="post-rtjson-content"]') ||
        shredditPost.querySelector('.md');
      if (bodyEl) body = bodyEl.innerText.trim();
    }

    if (!title) {
      const h1 = document.querySelector('h1[id*="post-title"]') ||
        document.querySelector('h1');
      if (h1) title = h1.innerText.trim();
    }

    const comments = [];
    const commentEls = document.querySelectorAll('shreddit-comment');
    for (let i = 0; i < Math.min(commentEls.length, 8); i++) {
      const el = commentEls[i];
      const depth = parseInt(el.getAttribute('depth') || '0', 10);
      if (depth > 1) continue;
      const contentEl = el.querySelector('[slot="comment"]') ||
        el.querySelector('.md') ||
        el.querySelector('[id*="comment-rtjson-content"]');
      if (contentEl) {
        const text = contentEl.innerText.trim();
        if (text && text.length > 10) comments.push(text);
      }
      if (comments.length >= 5) break;
    }

    return { subreddit, title, body, comments: comments.join('\n---\n') };
  }

  function extractOldReddit(subreddit) {
    const titleEl = document.querySelector('.top-matter .title a.title');
    const title = titleEl ? titleEl.innerText.trim() : '';

    const bodyEl = document.querySelector('.expando .usertext-body .md');
    const body = bodyEl ? bodyEl.innerText.trim() : '';

    const comments = [];
    const commentEls = document.querySelectorAll('.comment .entry .usertext-body .md');
    for (let i = 0; i < Math.min(commentEls.length, 5); i++) {
      const text = commentEls[i].innerText.trim();
      if (text && text.length > 10) comments.push(text);
    }

    return { subreddit, title, body, comments: comments.join('\n---\n') };
  }

  // --- FAB ---
  function createFAB() {
    const existing = document.querySelector('.ro-fab');
    if (existing) return existing;

    const btn = document.createElement('button');
    btn.className = 'ro-fab';
    btn.title = 'Marketeer — Reply to main post';
    btn.setAttribute('aria-label', 'Generate Reddit response');

    const img = document.createElement('img');
    img.src = chrome.runtime.getURL('icons/fab-icon.png');
    img.alt = 'M';
    img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover;pointer-events:none;';
    btn.appendChild(img);

    btn.addEventListener('click', onFABClick);
    document.body.appendChild(btn);
    return btn;
  }

  // --- Toast ---
  function showToast(message, type = 'success') {
    let toast = document.querySelector('.ro-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'ro-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = 'ro-toast ' + (type === 'error' ? 'ro-error' : 'ro-success');
    requestAnimationFrame(() => toast.classList.add('ro-visible'));
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('ro-visible'), 3000);
  }

  // --- Panel State ---
  let panel = null;
  let backdrop = null;
  let textarea = null;
  let charCount = null;
  let currentPostData = null;
  let responses = {};
  let activeTone = null;
  let panelMode = 'comment'; // 'comment' or 'post'
  let panelTab = 'generate'; // 'generate' or 'search'
  let postResponses = {}; // { tone: { title, body } }
  let activePostStyle = 'question';
  let activePostType = 'text';

  function buildProjectOptionsHtml() {
    let html = '<option value="none">No Product</option>';
    productsCache.forEach(p => {
      html += `<option value="${p.id}">${escapeHtml(p.name)}</option>`;
    });
    return html;
  }

  function rebuildProjectDropdown() {
    if (!panel) return;
    const select = panel.querySelector('.ro-project-select');
    const current = select.value;
    select.innerHTML = buildProjectOptionsHtml();
    // Restore selection if still valid
    if (select.querySelector(`option[value="${current}"]`)) {
      select.value = current;
    } else {
      select.value = 'none';
    }
  }

  function getSelectedProduct() {
    if (!panel) return null;
    const selectedId = panel.querySelector('.ro-project-select').value;
    if (selectedId === 'none') return null;
    const product = productsCache.find(p => p.id === selectedId);
    if (!product) return null;
    return {
      name: product.name,
      link: product.link || '',
      features: product.features || '',
      benefits: product.benefits || '',
      scenarios: product.scenarios || ''
    };
  }

  function createPanel() {
    if (panel) return;

    backdrop = document.createElement('div');
    backdrop.className = 'ro-backdrop';
    backdrop.addEventListener('click', closePanel);
    document.body.appendChild(backdrop);

    const projectOptionsHtml = buildProjectOptionsHtml();

    const toneTabsHtml = CONFIG.TONES.map(tone =>
      `<button class="ro-tone-tab" data-tone="${tone}" role="tab" aria-selected="false">${CONFIG.TONE_LABELS[tone]}</button>`
    ).join('');

    panel = document.createElement('div');
    panel.className = 'ro-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Marketeer Response Panel');
    panel.innerHTML = `
      <div class="ro-panel-header">
        <div class="ro-panel-header-text">
          <div class="ro-panel-subreddit"></div>
          <div class="ro-panel-title"></div>
        </div>
        <span class="ro-activity-badge ro-activity-green" title="Comments submitted today">0 today</span>
        <div class="ro-credits-badge" title="Credits remaining">
          <span class="ro-credits-icon">&#9679;</span>
          <span class="ro-credits-count">--</span>
        </div>
        <button class="ro-close-btn" aria-label="Close panel">&times;</button>
      </div>
      <div class="ro-panel-body">
        <div class="ro-mode-tabs">
          <button class="ro-mode-tab ro-active" data-mode="generate" aria-label="Generate mode">Generate</button>
          <button class="ro-mode-tab" data-mode="search" aria-label="Search mode">Search</button>
        </div>
        <div class="ro-generate-content">
          <div class="ro-reply-context" style="display:none"></div>
          <div class="ro-project-row">
            <label>Project:</label>
            <select class="ro-project-select">${projectOptionsHtml}</select>
            <button class="ro-edit-product-btn" title="View/edit selected product" aria-label="Edit product" style="display:none">&#9998;</button>
            <button class="ro-add-product-btn" title="Add a product" aria-label="Add product">+</button>
          </div>
          <div class="ro-quick-add-form" style="display:none">
            <div class="ro-quick-add-title">Add Product</div>
            <input type="hidden" class="ro-quick-edit-id" value="">
            <div class="ro-quick-add-field">
              <label>Name <span class="ro-required">*</span></label>
              <input type="text" class="ro-quick-add-name" maxlength="100" placeholder="Product name">
            </div>
            <div class="ro-quick-add-field">
              <label>Link</label>
              <input type="text" class="ro-quick-add-link" maxlength="500" placeholder="https://...">
            </div>
            <div class="ro-quick-add-field">
              <label>Features <span class="ro-required">*</span></label>
              <textarea class="ro-quick-add-features" maxlength="2000" rows="3" placeholder="Key features, what it does..."></textarea>
            </div>
            <button class="ro-btn-ai ro-quick-generate-btn">Generate with AI</button>
            <div class="ro-ai-fields">
              <div class="ro-quick-add-field">
                <label>Benefits</label>
                <textarea class="ro-quick-add-benefits" maxlength="1000" rows="2" placeholder="What problems does it solve?"></textarea>
              </div>
              <div class="ro-quick-add-field">
                <label>Scenarios</label>
                <textarea class="ro-quick-add-scenarios" maxlength="1000" rows="2" placeholder="When should the AI mention this?"></textarea>
              </div>
              <div class="ro-quick-add-field">
                <label>Subreddits</label>
                <p class="ro-field-hint">Comma-separated</p>
                <input type="text" class="ro-quick-add-subreddits" placeholder="e.g. etsy, etsysellers">
              </div>
              <div class="ro-quick-add-field">
                <label>Keywords</label>
                <p class="ro-field-hint">Comma-separated</p>
                <input type="text" class="ro-quick-add-keywords" placeholder="e.g. bulk listing, SEO">
              </div>
              <div class="ro-quick-add-field">
                <label>Search Concepts</label>
                <p class="ro-field-hint">Comma-separated phrases for Search mode</p>
                <input type="text" class="ro-quick-add-concepts" placeholder="e.g. need bulk tool, listing help">
              </div>
            </div>
            <div class="ro-quick-add-actions">
              <button class="ro-btn ro-btn-primary ro-quick-save-btn">Save</button>
              <button class="ro-btn ro-btn-secondary ro-quick-cancel-btn">Cancel</button>
            </div>
            <div class="ro-quick-add-error" style="display:none"></div>
          </div>
          <div class="ro-rules-warning" style="display:none"></div>
          <div class="ro-credits-warning" style="display:none"></div>
          <div class="ro-loading-state" style="display:none">
            <div class="ro-spinner"></div>
            <span>Generating responses...</span>
          </div>
          <div class="ro-tone-tabs" role="tablist" aria-label="Tone selection" style="display:none">${toneTabsHtml}</div>
          <textarea class="ro-textarea" style="display:none" aria-label="Response draft" placeholder="AI-generated draft will appear here..."></textarea>
          <div class="ro-char-count" style="display:none"></div>
          <div class="ro-post-controls" style="display:none">
            <div class="ro-post-style-row">
              <label>Style:</label>
              <div class="ro-post-style-group">
                ${CONFIG.POST_STYLES.map(s => `<button class="ro-post-style-btn${s === 'question' ? ' ro-active' : ''}" data-style="${s}">${CONFIG.POST_STYLE_LABELS[s]}</button>`).join('')}
              </div>
            </div>
            <div class="ro-post-type-row">
              <label>Type:</label>
              <div class="ro-post-type-group">
                ${CONFIG.POST_TYPES.map(t => `<button class="ro-post-type-btn${t === 'text' ? ' ro-active' : ''}" data-type="${t}">${CONFIG.POST_TYPE_LABELS[t]}</button>`).join('')}
              </div>
            </div>
            <button class="ro-btn ro-btn-primary ro-post-generate-btn">Generate Post</button>
          </div>
          <div class="ro-post-results" style="display:none">
            <div class="ro-post-tone-tabs" role="tablist" aria-label="Tone selection"></div>
            <label class="ro-post-field-label">Title</label>
            <textarea class="ro-post-title-display" rows="2" aria-label="Post title"></textarea>
            <label class="ro-post-field-label">Body</label>
            <textarea class="ro-post-body-display" rows="8" aria-label="Post body"></textarea>
          </div>
        </div>
        <div class="ro-search-content" style="display:none">
          <div class="ro-search-config">
            <div class="ro-search-products" aria-label="Select products to search for"></div>
            <div class="ro-concepts-section"></div>
            <div class="ro-search-settings">
              <label>Time:</label>
              <select class="ro-search-time">
                <option value="day">Past 24h</option>
                <option value="week" selected>Past Week</option>
                <option value="month">Past Month</option>
                <option value="year">Past Year</option>
              </select>
              <label>Sort:</label>
              <select class="ro-search-sort">
                <option value="new" selected>New</option>
                <option value="relevance">Relevant</option>
                <option value="hot">Hot</option>
                <option value="top">Top</option>
              </select>
              <label>Max:</label>
              <select class="ro-search-max">
                <option value="10">10</option>
                <option value="20" selected>20</option>
                <option value="30">30</option>
                <option value="50">50</option>
              </select>
            </div>
            <div class="ro-auto-search-row">
              <button class="ro-toggle ro-auto-search-toggle" aria-label="Toggle auto-search"></button>
              <span>Auto-search every</span>
              <select class="ro-auto-search-freq">
                <option value="60">1 hour</option>
                <option value="120">2 hours</option>
                <option value="360">6 hours</option>
                <option value="720">12 hours</option>
              </select>
            </div>
            <button class="ro-btn ro-btn-primary ro-search-go-btn">Find Opportunities</button>
          </div>
          <div class="ro-search-loading" style="display:none">
            <div class="ro-spinner"></div>
            <span>Searching Reddit...</span>
            <span class="ro-search-progress"></span>
          </div>
          <div class="ro-search-results" style="display:none">
            <div class="ro-search-filters"></div>
            <div class="ro-search-cards"></div>
            <div class="ro-search-results-footer">
              <button class="ro-btn ro-btn-secondary ro-search-settings-btn">Settings</button>
              <button class="ro-btn ro-btn-primary ro-search-refresh-btn">Refresh</button>
            </div>
          </div>
          <div class="ro-search-empty" style="display:none">
            <div class="ro-search-empty-title">No results found</div>
            <div>Try adding more search concepts to your products, or broaden your time range.</div>
          </div>
        </div>
      </div>
      <div class="ro-panel-footer">
        <button class="ro-btn ro-btn-secondary ro-regen-btn" disabled>Regenerate</button>
        <button class="ro-btn ro-btn-secondary ro-copy-btn" disabled>Copy</button>
        <button class="ro-btn ro-btn-primary ro-submit-btn" disabled>Submit</button>
      </div>
      <div class="ro-post-footer" style="display:none">
        <button class="ro-btn ro-btn-secondary ro-post-regen-btn" disabled>Regenerate</button>
        <button class="ro-btn ro-btn-primary ro-post-fill-btn" disabled>Fill Form</button>
      </div>
    `;
    document.body.appendChild(panel);

    panel.querySelector('.ro-close-btn').addEventListener('click', closePanel);
    textarea = panel.querySelector('.ro-textarea');
    charCount = panel.querySelector('.ro-char-count');

    // --- Mode tab switching ---
    panel.querySelectorAll('.ro-mode-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const mode = tab.dataset.mode;
        panelTab = mode;
        panel.querySelectorAll('.ro-mode-tab').forEach(t => t.classList.toggle('ro-active', t === tab));
        panel.querySelector('.ro-generate-content').style.display = mode === 'generate' ? '' : 'none';
        panel.querySelector('.ro-search-content').style.display = mode === 'search' ? '' : 'none';
        // Hide generate footers in search mode
        panel.querySelector('.ro-panel-footer').style.display = mode === 'generate' && panelMode === 'comment' ? 'flex' : 'none';
        panel.querySelector('.ro-post-footer').style.display = mode === 'generate' && panelMode === 'post' ? 'flex' : 'none';
        if (mode === 'search') {
          buildSearchConfig();
        }
      });
    });

    // Note: saved project selection is restored in openPanel() to avoid race conditions

    textarea.addEventListener('input', () => {
      charCount.textContent = textarea.value.length + ' chars';
      if (activeTone) responses[activeTone] = textarea.value;
      autoResizeTextarea();
    });

    panel.querySelector('.ro-tone-tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.ro-tone-tab');
      if (!tab) return;
      switchTone(tab.dataset.tone);
    });

    panel.querySelector('.ro-project-select').addEventListener('change', (e) => {
      chrome.storage.local.set({ ro_project: e.target.value });
      updateRulesWarning();
      updateEditBtnVisibility();
      updatePostLinkBtnState();
      updateActivityDisplay();
      // Re-generate with the newly selected product (comment mode only)
      if (panelMode === 'comment' && currentPostData) {
        generateAllResponses(currentPostData);
      }
    });

    // Initial visibility check after restoring selection
    setTimeout(updateEditBtnVisibility, 100);

    // Helper to reset the product form
    function resetProductForm(titleText) {
      const form = panel.querySelector('.ro-quick-add-form');
      form.querySelector('.ro-quick-add-title').textContent = titleText;
      form.querySelector('.ro-quick-edit-id').value = '';
      form.querySelector('.ro-quick-add-name').value = '';
      form.querySelector('.ro-quick-add-link').value = '';
      form.querySelector('.ro-quick-add-features').value = '';
      form.querySelector('.ro-quick-add-benefits').value = '';
      form.querySelector('.ro-quick-add-scenarios').value = '';
      form.querySelector('.ro-quick-add-subreddits').value = '';
      form.querySelector('.ro-quick-add-keywords').value = '';
      form.querySelector('.ro-quick-add-concepts').value = '';
      form.querySelector('.ro-quick-add-error').style.display = 'none';
      form.querySelector('.ro-ai-fields').classList.remove('show');
      form.querySelector('.ro-quick-generate-btn').style.display = '';
      form.querySelector('.ro-quick-generate-btn').textContent = 'Generate with AI';
    }

    // Add product
    panel.querySelector('.ro-add-product-btn').addEventListener('click', () => {
      const form = panel.querySelector('.ro-quick-add-form');
      if (form.style.display === 'none') {
        resetProductForm('Add Product');
        form.style.display = 'block';
        form.querySelector('.ro-quick-add-name').focus();
      } else {
        form.style.display = 'none';
      }
    });

    // Edit product
    panel.querySelector('.ro-edit-product-btn').addEventListener('click', () => {
      const selectedId = panel.querySelector('.ro-project-select').value;
      if (!selectedId || selectedId === 'none') return;
      const product = productsCache.find(p => p.id === selectedId);
      if (!product) return;

      const form = panel.querySelector('.ro-quick-add-form');
      form.querySelector('.ro-quick-add-title').textContent = 'Edit Product';
      form.querySelector('.ro-quick-edit-id').value = product.id;
      form.querySelector('.ro-quick-add-name').value = product.name || '';
      form.querySelector('.ro-quick-add-link').value = product.link || '';
      form.querySelector('.ro-quick-add-features').value = product.features || '';
      form.querySelector('.ro-quick-add-benefits').value = product.benefits || '';
      form.querySelector('.ro-quick-add-scenarios').value = product.scenarios || '';
      form.querySelector('.ro-quick-add-subreddits').value = (product.subreddits || []).join(', ');
      form.querySelector('.ro-quick-add-keywords').value = (product.keywords || []).join(', ');
      form.querySelector('.ro-quick-add-concepts').value = (product.concepts || []).join(', ');
      form.querySelector('.ro-quick-add-error').style.display = 'none';
      // In edit mode: show AI fields and keep Generate button visible for regeneration
      form.querySelector('.ro-ai-fields').classList.add('show');
      form.querySelector('.ro-quick-generate-btn').style.display = '';
      form.querySelector('.ro-quick-generate-btn').textContent = 'Regenerate with AI';
      form.style.display = 'block';
      form.querySelector('.ro-quick-add-name').focus();
    });

    // Generate with AI in panel form
    panel.querySelector('.ro-quick-generate-btn').addEventListener('click', async () => {
      const form = panel.querySelector('.ro-quick-add-form');
      const genBtn = form.querySelector('.ro-quick-generate-btn');
      const originalLabel = genBtn.textContent;
      const errorEl = form.querySelector('.ro-quick-add-error');
      const name = form.querySelector('.ro-quick-add-name').value.trim();
      const features = form.querySelector('.ro-quick-add-features').value.trim();

      if (!name) { errorEl.textContent = 'Name is required'; errorEl.style.display = 'block'; return; }
      if (!features || features.length < 10) { errorEl.textContent = 'Features must be at least 10 characters'; errorEl.style.display = 'block'; return; }
      errorEl.style.display = 'none';

      genBtn.disabled = true;
      genBtn.textContent = 'Generating...';
      try {
        const result = await chrome.runtime.sendMessage({
          type: 'GENERATE_PRODUCT_META',
          name,
          link: form.querySelector('.ro-quick-add-link').value.trim(),
          features
        });
        if (result.error) {
          errorEl.textContent = result.error;
          errorEl.style.display = 'block';
          form.querySelector('.ro-ai-fields').classList.add('show');
          return;
        }
        form.querySelector('.ro-quick-add-benefits').value = result.benefits || '';
        form.querySelector('.ro-quick-add-scenarios').value = result.scenarios || '';
        form.querySelector('.ro-quick-add-subreddits').value = (result.subreddits || []).join(', ');
        form.querySelector('.ro-quick-add-keywords').value = (result.keywords || []).join(', ');
        form.querySelector('.ro-ai-fields').classList.add('show');
      } catch (err) {
        errorEl.textContent = 'Generation failed — fill in manually';
        errorEl.style.display = 'block';
        form.querySelector('.ro-ai-fields').classList.add('show');
      } finally {
        genBtn.disabled = false;
        genBtn.textContent = originalLabel;
      }
    });

    panel.querySelector('.ro-quick-cancel-btn').addEventListener('click', () => {
      panel.querySelector('.ro-quick-add-form').style.display = 'none';
    });

    // Save product (add or edit) — 1 credit for new products
    panel.querySelector('.ro-quick-save-btn').addEventListener('click', async () => {
      const form = panel.querySelector('.ro-quick-add-form');
      const nameInput = form.querySelector('.ro-quick-add-name');
      const featuresInput = form.querySelector('.ro-quick-add-features');
      const errorEl = form.querySelector('.ro-quick-add-error');
      const saveBtn = form.querySelector('.ro-quick-save-btn');
      const editId = form.querySelector('.ro-quick-edit-id').value;
      const name = nameInput.value.trim();
      const features = featuresInput.value.trim();

      if (!name) {
        errorEl.textContent = 'Name is required';
        errorEl.style.display = 'block';
        nameInput.focus();
        return;
      }
      if (!features) {
        errorEl.textContent = 'Features are required';
        errorEl.style.display = 'block';
        featuresInput.focus();
        return;
      }

      function parseCommaSep(str) {
        return str.split(',').map(s => s.trim().toLowerCase().replace(/^r\//, '')).filter(s => s.length > 0);
      }

      var product = {
        id: editId || ('p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7)),
        name: name.slice(0, 100),
        link: form.querySelector('.ro-quick-add-link').value.trim().slice(0, 500),
        features: features.slice(0, 2000),
        benefits: form.querySelector('.ro-quick-add-benefits').value.trim().slice(0, 1000),
        scenarios: form.querySelector('.ro-quick-add-scenarios').value.trim().slice(0, 1000),
        subreddits: parseCommaSep(form.querySelector('.ro-quick-add-subreddits').value),
        keywords: parseCommaSep(form.querySelector('.ro-quick-add-keywords').value),
        concepts: parseCommaSep(form.querySelector('.ro-quick-add-concepts').value).slice(0, 20)
      };

      const isNew = !editId;

      if (isNew) {
        // Deduct 1 credit for new product
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        try {
          const creditResult = await chrome.runtime.sendMessage({ type: 'USE_PRODUCT_CREDIT' });
          if (!creditResult.success) {
            errorEl.textContent = creditResult.error === 'insufficient_credits'
              ? 'Not enough credits (' + (creditResult.creditsRemaining || 0) + ' remaining)'
              : 'Failed to verify credits';
            errorEl.style.display = 'block';
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
            return;
          }
          // Update credits display in panel
          const creditsEl = panel.querySelector('.ro-credits-count');
          if (creditsEl) creditsEl.textContent = creditResult.creditsRemaining;
        } catch (err) {
          errorEl.textContent = 'Failed to deduct credit';
          errorEl.style.display = 'block';
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save';
          return;
        }
        productsCache.push(product);
      } else {
        var idx = productsCache.findIndex(p => p.id === editId);
        if (idx !== -1) productsCache[idx] = product;
      }

      chrome.storage.local.set({ marketeer_products: productsCache }, () => {
        form.style.display = 'none';
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
        rebuildProjectDropdown();
        var select = panel.querySelector('.ro-project-select');
        select.value = product.id;
        chrome.storage.local.set({ ro_project: product.id });
        updateRulesWarning();
        updateEditBtnVisibility();
      });
    });

    panel.querySelector('.ro-regen-btn').addEventListener('click', debounce(() => {
      generateAllResponses(currentPostData);
    }, 3000));

    panel.querySelector('.ro-copy-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(textarea.value).then(() => {
        showToast('Copied to clipboard');
      }).catch(() => {
        showToast('Could not copy to clipboard', 'error');
      });
    });

    panel.querySelector('.ro-submit-btn').addEventListener('click', () => {
      const projectId = panel.querySelector('.ro-project-select').value;
      const replyCtx = panel.querySelector('.ro-reply-context');
      const isReply = replyCtx && replyCtx.style.display !== 'none';

      saveToHistory({
        postTitle: currentPostData ? currentPostData.title : '',
        subreddit: currentPostData ? currentPostData.subreddit : '',
        projectId: projectId,
        tone: activeTone || '',
        replyAuthor: isReply && panel._replyCommentEl
          ? (panel._replyCommentEl.getAttribute('author') || null)
          : null
      });
      recordActivity();

      // Cooldown prevents rapid re-triggering
      submitCooldown = true;
      setTimeout(() => { submitCooldown = false; }, 3000);

      setTimeout(applyPostPageIndicators, 100);
      fillCommentBox(textarea.value);
    });

    // --- Post mode event listeners ---
    panel.querySelector('.ro-post-controls').addEventListener('click', (e) => {
      const styleBtn = e.target.closest('.ro-post-style-btn');
      if (styleBtn) {
        activePostStyle = styleBtn.dataset.style;
        panel.querySelectorAll('.ro-post-style-btn').forEach(b => b.classList.toggle('ro-active', b === styleBtn));
      }
      const typeBtn = e.target.closest('.ro-post-type-btn');
      if (typeBtn && !typeBtn.disabled) {
        activePostType = typeBtn.dataset.type;
        panel.querySelectorAll('.ro-post-type-btn').forEach(b => b.classList.toggle('ro-active', b === typeBtn));
      }
    });

    panel.querySelector('.ro-post-generate-btn').addEventListener('click', debounce(() => {
      generatePost();
    }, 1000));

    panel.querySelector('.ro-post-regen-btn').addEventListener('click', debounce(() => {
      generatePost();
    }, 3000));

    panel.querySelector('.ro-post-fill-btn').addEventListener('click', () => {
      fillSubmitForm();
    });

    document.addEventListener('keydown', (e) => {
      if (!panel || !panel.classList.contains('ro-visible')) return;
      if (e.key === 'Escape') {
        closePanel();
        return;
      }
      // Focus trap
      if (e.key === 'Tab') {
        const focusable = panel.querySelectorAll('button:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first || !panel.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || !panel.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    });
  }

  function updateEditBtnVisibility() {
    if (!panel) return;
    const editBtn = panel.querySelector('.ro-edit-product-btn');
    const selectedVal = panel.querySelector('.ro-project-select').value;
    editBtn.style.display = (selectedVal && selectedVal !== 'none') ? '' : 'none';
  }

  function updateRulesWarning() {
    if (!panel) return;
    const warningEl = panel.querySelector('.ro-rules-warning');
    const projectId = panel.querySelector('.ro-project-select').value;
    const blocked = isPromotionBlocked();

    if (blocked && projectId !== 'none') {
      warningEl.textContent = 'This subreddit may restrict promotion. Consider using "No Product" mode or the AI will adapt to the rules.';
      warningEl.style.display = 'block';
    } else {
      warningEl.style.display = 'none';
    }
  }

  function updatePanelCredits() {
    if (!panel) return;
    chrome.runtime.sendMessage({ type: 'CHECK_CREDITS' }, (resp) => {
      if (chrome.runtime.lastError) return;
      const badge = panel.querySelector('.ro-credits-count');
      const warning = panel.querySelector('.ro-credits-warning');
      if (resp && resp.success && resp.credits) {
        const avail = resp.credits.available;
        badge.textContent = avail;
        badge.parentElement.title = avail + ' credits remaining';
        if (avail <= 0) {
          badge.parentElement.classList.add('ro-credits-zero');
          warning.textContent = 'No credits remaining. Purchase more from the toolbar popup to continue generating.';
          warning.style.display = 'block';
        } else if (avail <= 5) {
          badge.parentElement.classList.add('ro-credits-low');
          badge.parentElement.classList.remove('ro-credits-zero');
          warning.textContent = 'Low credits (' + avail + ' remaining). Purchase more from the toolbar popup.';
          warning.style.display = 'block';
        } else {
          badge.parentElement.classList.remove('ro-credits-low', 'ro-credits-zero');
          warning.style.display = 'none';
        }
      }
    });
  }

  function autoResizeTextarea() {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.max(textarea.scrollHeight, 120) + 'px';
  }

  function switchTone(tone) {
    activeTone = tone;
    textarea.value = responses[tone] || '';
    charCount.textContent = textarea.value.length + ' chars';
    autoResizeTextarea();

    panel.querySelectorAll('.ro-tone-tab').forEach(tab => {
      const isActive = tab.dataset.tone === tone;
      tab.classList.toggle('ro-active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  // --- Project Auto-Detection ---
  // Multi-signal scoring: subreddit, keywords, name, scenarios, benefits, features

  // Extract meaningful phrases (3+ words) and individual terms from freetext fields
  function extractPhrases(text) {
    if (!text) return [];
    var phrases = [];
    // Split on sentence boundaries and commas
    var chunks = text.split(/[.,;!\n]+/).map(function(c) { return c.trim().toLowerCase(); }).filter(function(c) { return c.length >= 8; });
    for (var i = 0; i < chunks.length; i++) {
      // Keep chunks that are 2-5 words as meaningful phrases
      var words = chunks[i].split(/\s+/).filter(function(w) { return w.length > 2; });
      if (words.length >= 2 && words.length <= 6) {
        phrases.push(chunks[i]);
      }
    }
    return phrases;
  }

  function detectProject(postData) {
    var subreddit = (postData.subreddit || '').toLowerCase().replace(/^r\//, '');
    var text = ((postData.title || '') + ' ' + (postData.body || '')).toLowerCase();
    if (replyTarget && replyTarget.text) {
      text += ' ' + replyTarget.text.toLowerCase();
    }

    var best = null;
    var bestScore = 0;

    for (var i = 0; i < productsCache.length; i++) {
      var product = productsCache[i];
      var score = 0;

      // Subreddit match (100 points)
      var subs = product.subreddits || [];
      for (var s = 0; s < subs.length; s++) {
        if (subreddit === subs[s]) {
          score += 100;
          break;
        }
      }

      // Keyword match (10 points each)
      var kws = product.keywords || [];
      for (var k = 0; k < kws.length; k++) {
        if (text.indexOf(kws[k]) !== -1) {
          score += 10;
        }
      }

      // Product name match (50 points)
      if (product.name && text.indexOf(product.name.toLowerCase()) !== -1) {
        score += 50;
      }

      // Scenarios phrase match (5 points each, max 30)
      var scenarioPhrases = extractPhrases(product.scenarios);
      var scenarioHits = 0;
      for (var sp = 0; sp < scenarioPhrases.length; sp++) {
        if (text.indexOf(scenarioPhrases[sp]) !== -1) {
          scenarioHits++;
          if (scenarioHits >= 6) break;
        }
      }
      score += scenarioHits * 5;

      // Benefits phrase match (5 points each, max 25)
      var benefitPhrases = extractPhrases(product.benefits);
      var benefitHits = 0;
      for (var bp = 0; bp < benefitPhrases.length; bp++) {
        if (text.indexOf(benefitPhrases[bp]) !== -1) {
          benefitHits++;
          if (benefitHits >= 5) break;
        }
      }
      score += benefitHits * 5;

      // Features phrase match (3 points each, max 15)
      var featurePhrases = extractPhrases(product.features);
      var featureHits = 0;
      for (var fp = 0; fp < featurePhrases.length; fp++) {
        if (text.indexOf(featurePhrases[fp]) !== -1) {
          featureHits++;
          if (featureHits >= 5) break;
        }
      }
      score += featureHits * 3;

      if (score > bestScore) {
        bestScore = score;
        best = product.id;
      }
    }

    if (bestScore >= CONFIG.DETECT_THRESHOLD) return best;
    return null;
  }

  function openPanel(postData) {
    panelMode = 'comment';
    panelTab = 'generate';
    createPanel();
    currentPostData = postData;
    responses = {};
    activeTone = null;

    panel.querySelector('.ro-panel-subreddit').textContent = 'r/' + postData.subreddit;
    panel.querySelector('.ro-panel-title').textContent = postData.title;

    // Ensure generate tab is active
    panel.querySelectorAll('.ro-mode-tab').forEach(t => t.classList.toggle('ro-active', t.dataset.mode === 'generate'));
    panel.querySelector('.ro-generate-content').style.display = '';
    panel.querySelector('.ro-search-content').style.display = 'none';

    // Show comment mode UI, hide post mode UI
    panel.querySelector('.ro-panel-footer').style.display = 'flex';
    panel.querySelector('.ro-post-controls').style.display = 'none';
    panel.querySelector('.ro-post-results').style.display = 'none';
    panel.querySelector('.ro-post-footer').style.display = 'none';

    // Show/hide reply context
    const replyCtx = panel.querySelector('.ro-reply-context');
    if (replyTarget) {
      const truncated = replyTarget.text.length > 200
        ? replyTarget.text.slice(0, 200) + '...'
        : replyTarget.text;
      replyCtx.innerHTML = `
        <div class="ro-reply-author">Replying to u/${escapeHtml(replyTarget.author)}</div>
        <div class="ro-reply-text">${escapeHtml(truncated)}</div>
      `;
      replyCtx.style.display = 'block';
      panel._replyCommentEl = replyTarget.commentEl;
    } else {
      replyCtx.style.display = 'none';
      panel._replyCommentEl = null;
    }

    // Auto-detect best product for this page, fall back to saved selection
    var projectSelect = panel.querySelector('.ro-project-select');
    chrome.storage.local.get(['ro_project'], (result) => {
      var savedProject = result.ro_project || 'none';

      // Always run auto-detect for this page's context
      var detected = detectProject(postData);
      if (detected) {
        projectSelect.value = detected;
      } else {
        projectSelect.value = savedProject;
      }

      updateRulesWarning();
      updateEditBtnVisibility();
      updatePanelCredits();
      updateActivityDisplay();

      backdrop.classList.add('ro-visible');
      requestAnimationFrame(() => {
        panel.classList.add('ro-visible');
        const closeBtn = panel.querySelector('.ro-close-btn');
        if (closeBtn) closeBtn.focus();
      });

      generateAllResponses(postData);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function closePanel() {
    if (panel) panel.classList.remove('ro-visible');
    if (backdrop) backdrop.classList.remove('ro-visible');
    replyTarget = null;
  }

  function setLoading(loading) {
    const loadingEl = panel.querySelector('.ro-loading-state');
    const toneTabs = panel.querySelector('.ro-tone-tabs');
    const btns = panel.querySelectorAll('.ro-regen-btn, .ro-copy-btn, .ro-submit-btn');

    if (loading) {
      loadingEl.style.display = 'flex';
      toneTabs.style.display = 'none';
      textarea.style.display = 'none';
      charCount.style.display = 'none';
      btns.forEach(b => b.disabled = true);
      if (fab) fab.classList.add('ro-loading');
    } else {
      loadingEl.style.display = 'none';
      toneTabs.style.display = 'flex';
      textarea.style.display = 'block';
      charCount.style.display = 'block';
      btns.forEach(b => b.disabled = false);
      if (fab) fab.classList.remove('ro-loading');
      autoResizeTextarea();
    }
  }

  let generateCooldown = false;

  function generateAllResponses(postData) {
    if (generateCooldown) {
      showToast('Please wait before regenerating', 'error');
      return;
    }
    setLoading(true);

    const projectId = panel.querySelector('.ro-project-select').value;
    const product = getSelectedProduct();

    // Include reply context if replying to a comment (anonymize author)
    const replyTo = replyTarget
      ? { author: 'User', text: replyTarget.text }
      : null;

    try {
      chrome.runtime.sendMessage(
        { type: 'GENERATE_ALL', postData, projectId, product, subredditRules, replyTo },
        (response) => {
          setLoading(false);
          if (chrome.runtime.lastError) {
            showToast('Extension was reloaded — please refresh this page', 'error');
            return;
          }
          if (response.error) {
            showToast(response.error, 'error');
            return;
          }

          responses = response.responses;
          // Use saved default tone if available, otherwise first tone
          chrome.storage.local.get(['ro_default_tone'], (r) => {
            const defaultTone = r.ro_default_tone;
            const tone = (defaultTone && CONFIG.TONES.includes(defaultTone)) ? defaultTone : CONFIG.TONES[0];
            switchTone(tone);
          });
          updatePanelCredits();
          // 5s cooldown before allowing regeneration
          generateCooldown = true;
          setTimeout(() => { generateCooldown = false; }, 5000);
        }
      );
    } catch (e) {
      setLoading(false);
      showToast('Extension was reloaded — please refresh this page', 'error');
    }
  }

  // --- Fill Comment Box ---
  function fillCommentBox(text) {
    const replyEl = panel && panel.querySelector('.ro-reply-context').style.display !== 'none'
      ? panel._replyCommentEl
      : null;

    if (isOldReddit) {
      fillOldReddit(text, replyEl);
      return;
    }
    fillNewReddit(text, replyEl);
  }

  function fillOldReddit(text, replyCommentEl) {
    if (replyCommentEl) {
      const replyLink = replyCommentEl.querySelector('a[data-event-action="comment"]') ||
        replyCommentEl.querySelector('.buttons a.reply-button') ||
        replyCommentEl.querySelector('.flat-list .reply-button a');
      if (replyLink) replyLink.click();

      setTimeout(() => {
        const replyArea = replyCommentEl.querySelector('.usertext.cloneable textarea');
        if (replyArea) {
          closePanel();
          typeTextHumanLike(replyArea, text, false).then(() => {
            showToast('Reply draft inserted — review and submit when ready');
          });
          return;
        }
        navigator.clipboard.writeText(text).then(() => {
          showToast('Could not open reply box — copied to clipboard', 'error');
        }).catch(() => {
          showToast('Could not open reply box or copy to clipboard', 'error');
        });
      }, 500);
      return;
    }

    const commentArea = document.querySelector('.usertext.cloneable textarea');
    if (commentArea) {
      closePanel();
      typeTextHumanLike(commentArea, text, false).then(() => {
        showToast('Draft inserted — review and submit when ready');
      });
    } else {
      navigator.clipboard.writeText(text).then(() => {
        showToast('Could not find comment box — copied to clipboard', 'error');
      }).catch(() => {
        showToast('Could not find comment box or copy to clipboard', 'error');
      });
    }
  }

  // Deep query: recursively searches through shadow DOMs (up to 4 levels deep)
  function deepQuery(selector, root, depth) {
    if (root === undefined) root = document;
    if (depth === undefined) depth = 0;
    if (depth > 4) return null;

    var el = root.querySelector(selector);
    if (el) return el;

    // Search shadow roots of custom elements (tag names with hyphens)
    var nodes = root.querySelectorAll('*');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].shadowRoot) {
        el = deepQuery(selector, nodes[i].shadowRoot, depth + 1);
        if (el) return el;
      }
    }
    return null;
  }

  function simulateClick(el) {
    // Try .click() first (works more often with web components)
    el.click();
    // Also dispatch full pointer/mouse sequence as backup
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  }

  function clickComposerTrigger() {
    // Strategy 1: Click the comments-action-button (deep search through shadow DOM)
    const commentsBtn = deepQuery('button[name="comments-action-button"]') ||
      deepQuery('button[data-post-click-location="comments-button"]');
    if (commentsBtn) simulateClick(commentsBtn);

    // Strategy 2: Click the "Join the conversation" placeholder input
    const trigger = deepQuery('faceplate-textarea-input[placeholder="Join the conversation"]') ||
      deepQuery('shreddit-async-loader[bundlename="comment_composer"] faceplate-textarea-input') ||
      deepQuery('comment-body-header faceplate-textarea-input');
    if (trigger) simulateClick(trigger);

    // Strategy 3: Click the faceplate-tracker wrapper
    const tracker = deepQuery('faceplate-tracker[noun="add_comment_placeholder"]');
    if (tracker) simulateClick(tracker);

    // Strategy 4: Reach into shadow DOM of the trigger itself
    if (trigger && trigger.shadowRoot) {
      const inner = trigger.shadowRoot.querySelector('textarea, input, [role="textbox"], div[contenteditable]');
      if (inner) inner.click();
    }
  }

  function fillNewReddit(text, replyCommentEl) {
    if (replyCommentEl) {
      fillNewRedditReply(text, replyCommentEl);
      return;
    }

    clickComposerTrigger();

    let attempts = 0;
    const maxAttempts = 15;

    const pollForComposer = setInterval(() => {
      attempts++;

      const editable = document.querySelector('shreddit-composer div[data-lexical-editor="true"]') ||
        document.querySelector('shreddit-composer div[contenteditable="true"]') ||
        deepQuery('div[data-lexical-editor="true"]') ||
        deepQuery('div[contenteditable="true"][role="textbox"]') ||
        deepQuery('div[aria-placeholder="Join the conversation"]');
      // getBoundingClientRect works across shadow DOM boundaries (offsetParent doesn't for slotted elements)
      const rect = editable ? editable.getBoundingClientRect() : null;
      const visible = editable && rect && rect.width > 0 && rect.height > 0;

      if (visible) {
        clearInterval(pollForComposer);
        closePanel();
        typeTextHumanLike(editable, text, true).then(success => {
          if (!success) {
            // Typing failed — fall back to bulk insertion
            insertTextBulk(editable, text);
          }
          showToast('Draft inserted — review and submit when ready');
        });
        return;
      }

      if (attempts <= 3) clickComposerTrigger();
      // After 5 attempts, try textarea fallback

      if (attempts >= 5) {
        const mdTextarea = document.querySelector('shreddit-composer textarea') ||
          document.querySelector('.comment-composer textarea') ||
          deepQuery('shreddit-composer textarea');
        const mdRect = mdTextarea ? mdTextarea.getBoundingClientRect() : null;
        if (mdTextarea && mdRect && mdRect.width > 0 && mdRect.height > 0) {
          clearInterval(pollForComposer);
          closePanel();
          typeTextHumanLike(mdTextarea, text, false).then(() => {
            showToast('Draft inserted — review and submit when ready');
          });
          return;
        }
      }

      if (attempts >= maxAttempts) {
        clearInterval(pollForComposer);
        navigator.clipboard.writeText(text).then(() => {
          showToast('Could not open comment box — copied to clipboard instead', 'error');
        }).catch(() => {
          showToast('Could not open comment box or copy to clipboard', 'error');
        });
      }
    }, 200);
  }

  // --- Human-like typing simulation ---
  // Types text character-by-character with randomized delays to avoid bot detection
  // If the user switches tabs, remaining text is inserted in bulk as a fallback

  async function typeTextHumanLike(element, text, isContentEditable) {
    element.click();
    element.focus();

    // Clear any existing content
    if (isContentEditable) {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('delete', false, null);
    } else {
      element.value = '';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }

    for (let i = 0; i < text.length; i++) {
      // If tab lost focus, insert remaining text in bulk and stop
      if (document.hidden) {
        const remaining = text.slice(i);
        if (isContentEditable) {
          document.execCommand('insertText', false, remaining);
        } else {
          element.value += remaining;
          element.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return true;
      }

      const char = text[i];

      if (isContentEditable) {
        if (char === '\n') {
          document.execCommand('insertParagraph', false, null);
        } else {
          document.execCommand('insertText', false, char);
        }
      } else {
        element.value += char;
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Randomized delay to simulate human typing
      let delay = 10 + Math.random() * 20; // 10-30ms base
      if (char === ' ') delay += 5 + Math.random() * 15;
      if ('.!?'.includes(char)) delay += 30 + Math.random() * 50;
      if (char === '\n') delay += 40 + Math.random() * 60;

      await new Promise(r => setTimeout(r, delay));
    }

    // Verify insertion worked for contenteditable
    if (isContentEditable && element.textContent.trim().length === 0) {
      return false;
    }
    return true;
  }

  // Bulk insertion fallback (used only when typing simulation fails)
  function insertTextBulk(editable, text) {
    editable.click();
    editable.focus();

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editable);
    selection.removeAllRanges();
    selection.addRange(range);

    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true, cancelable: true, composed: true,
        clipboardData: dt
      });
      editable.dispatchEvent(pasteEvent);
      if (editable.textContent.trim().length > 0) return true;
    } catch (e) {}

    try {
      const dt2 = new DataTransfer();
      dt2.setData('text/plain', text);
      const inputEvent = new InputEvent('beforeinput', {
        inputType: 'insertFromPaste', data: text, dataTransfer: dt2,
        bubbles: true, cancelable: true, composed: true
      });
      editable.dispatchEvent(inputEvent);
      if (editable.textContent.trim().length > 0) return true;
    } catch (e) {}

    editable.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, text);
    return editable.textContent.trim().length > 0;
  }

  function fillNewRedditReply(text, commentEl) {
    clickCommentReplyButton(commentEl);

    let attempts = 0;
    const maxAttempts = 20;

    const pollForReply = setInterval(() => {
      attempts++;

      const editable = findReplyEditor(commentEl);

      const replyRect = editable ? editable.getBoundingClientRect() : null;
      if (editable && replyRect && replyRect.width > 0 && replyRect.height > 0) {
        clearInterval(pollForReply);
        closePanel();
        typeTextHumanLike(editable, text, true).then(success => {
          if (!success) {
            insertTextBulk(editable, text);
          }
          showToast('Reply draft inserted — review and submit when ready');
        });
        return;
      }

      if (attempts <= 3) clickCommentReplyButton(commentEl);

      if (attempts >= maxAttempts) {
        clearInterval(pollForReply);
        navigator.clipboard.writeText(text).then(() => {
          showToast('Could not open reply box — copied to clipboard instead', 'error');
        }).catch(() => {
          showToast('Could not open reply box or copy to clipboard', 'error');
        });
      }
    }, 200);
  }

  function clickCommentReplyButton(commentEl) {
    const replyBtn = commentEl.querySelector('button[aria-label="Reply"]') ||
      commentEl.querySelector('button[data-testid="comment-reply-button"]') ||
      commentEl.querySelector('shreddit-comment-action-row button[slot="reply"]');

    if (replyBtn) {
      replyBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
      replyBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
      replyBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      return;
    }

    const actionRow = commentEl.querySelector('shreddit-comment-action-row');
    if (actionRow) {
      const root = actionRow.shadowRoot;
      if (root) {
        const innerReply = root.querySelector('button[slot="reply"], [aria-label="Reply"]');
        if (innerReply) {
          innerReply.click();
          return;
        }
      }
      const slotted = actionRow.querySelector('[slot="reply-button"]') ||
        actionRow.querySelector('button:last-child');
      if (slotted) slotted.click();
    }
  }

  function findReplyEditor(commentEl) {
    let editable = commentEl.querySelector('shreddit-composer div[data-lexical-editor="true"]') ||
      commentEl.querySelector('shreddit-composer div[contenteditable="true"]');
    if (editable) return editable;

    let sibling = commentEl.nextElementSibling;
    for (let i = 0; i < 3 && sibling; i++) {
      editable = sibling.querySelector('shreddit-composer div[data-lexical-editor="true"]') ||
        sibling.querySelector('shreddit-composer div[contenteditable="true"]');
      if (editable) return editable;
      sibling = sibling.nextElementSibling;
    }

    const parent = commentEl.parentElement;
    if (parent) {
      const allEditors = parent.querySelectorAll('shreddit-composer div[data-lexical-editor="true"]');
      for (const ed of allEditors) {
        const edRect = ed.getBoundingClientRect();
        if (edRect && edRect.width > 0 && edRect.height > 0) return ed;
      }
    }

    return null;
  }

  // --- FAB Click --- (opens panel for main post or post creation)
  function onFABClick() {
    if (panel && panel.classList.contains('ro-visible')) {
      closePanel();
      return;
    }

    if (isSubmitPage()) {
      const subreddit = location.pathname.split('/')[2] || '';
      console.log('[Marketeer] FAB click: submit page, subreddit:', subreddit);
      openPostPanel(subreddit);
      return;
    }

    if (isCompressedView()) {
      showToast('Navigate to the full discussion to comment', 'error');
      return;
    }

    // FAB = reply to main post (no comment target)
    replyTarget = null;

    const postData = extractPostData();
    if (!postData.title) {
      showToast('Could not extract post data', 'error');
      return;
    }
    openPanel(postData);
  }

  // --- Post Mode (Submit Page) ---

  function openPostPanel(subreddit) {
    console.log('[Marketeer] openPostPanel:', subreddit);
    panelMode = 'post';
    panelTab = 'generate';
    createPanel();
    currentPostData = { subreddit, title: '', body: '' };
    responses = {};
    postResponses = {};
    activeTone = null;

    panel.querySelector('.ro-panel-subreddit').textContent = 'r/' + subreddit;
    panel.querySelector('.ro-panel-title').textContent = 'Generate Post';

    // Ensure generate tab is active
    panel.querySelectorAll('.ro-mode-tab').forEach(t => t.classList.toggle('ro-active', t.dataset.mode === 'generate'));
    panel.querySelector('.ro-generate-content').style.display = '';
    panel.querySelector('.ro-search-content').style.display = 'none';

    // Hide comment-specific UI, show post-specific UI
    panel.querySelector('.ro-reply-context').style.display = 'none';
    panel._replyCommentEl = null;

    const commentFooter = panel.querySelector('.ro-panel-footer');
    commentFooter.style.display = 'none';

    const postControls = panel.querySelector('.ro-post-controls');
    if (postControls) postControls.style.display = 'block';

    const postFooter = panel.querySelector('.ro-post-footer');
    if (postFooter) postFooter.style.display = 'flex';

    const postResults = panel.querySelector('.ro-post-results');
    if (postResults) postResults.style.display = 'none';

    // Hide comment-specific elements
    textarea.style.display = 'none';
    charCount.style.display = 'none';
    panel.querySelector('.ro-tone-tabs').style.display = 'none';
    panel.querySelector('.ro-loading-state').style.display = 'none';

    // Auto-detect best product for this page, fall back to saved selection
    const projectSelect = panel.querySelector('.ro-project-select');
    chrome.storage.local.get(['ro_project'], (result) => {
      const savedProject = result.ro_project || 'none';

      // Always run auto-detect for this page's context
      const detected = detectProject({ subreddit, title: '', body: '' });
      if (detected) {
        projectSelect.value = detected;
      } else {
        projectSelect.value = savedProject;
      }

      updateRulesWarning();
      updateEditBtnVisibility();
      updatePanelCredits();
      updateActivityDisplay();
      updatePostLinkBtnState();

      backdrop.classList.add('ro-visible');
      requestAnimationFrame(() => {
        panel.classList.add('ro-visible');
        const closeBtn = panel.querySelector('.ro-close-btn');
        if (closeBtn) closeBtn.focus();
      });
    });
  }

  function updatePostLinkBtnState() {
    if (!panel) return;
    const linkBtn = panel.querySelector('.ro-post-type-btn[data-type="link"]');
    if (!linkBtn) return;
    const product = getSelectedProduct();
    const hasLink = product && product.link;
    linkBtn.disabled = !hasLink;
    linkBtn.title = hasLink ? 'Link post' : 'Select a product with a link first';
    if (!hasLink && activePostType === 'link') {
      activePostType = 'text';
      panel.querySelectorAll('.ro-post-type-btn').forEach(b => {
        b.classList.toggle('ro-active', b.dataset.type === 'text');
      });
    }
  }

  function generatePost() {
    if (generateCooldown) {
      showToast('Please wait before regenerating', 'error');
      return;
    }

    const loadingEl = panel.querySelector('.ro-loading-state');
    const postResults = panel.querySelector('.ro-post-results');
    const genBtn = panel.querySelector('.ro-post-generate-btn');
    const fillBtn = panel.querySelector('.ro-post-fill-btn');
    const regenBtn = panel.querySelector('.ro-post-regen-btn');

    loadingEl.style.display = 'flex';
    if (postResults) postResults.style.display = 'none';
    genBtn.disabled = true;
    fillBtn.disabled = true;
    regenBtn.disabled = true;
    if (fab) fab.classList.add('ro-loading');

    const subreddit = currentPostData.subreddit;
    const projectId = panel.querySelector('.ro-project-select').value;
    const product = getSelectedProduct();

    console.log('[Marketeer] generatePost:', { subreddit, projectId, postStyle: activePostStyle, postType: activePostType, hasProduct: !!product });

    try {
      chrome.runtime.sendMessage(
        {
          type: 'GENERATE_POST',
          subreddit,
          projectId,
          product,
          postStyle: activePostStyle,
          postType: activePostType,
          subredditRules
        },
        (response) => {
          loadingEl.style.display = 'none';
          genBtn.disabled = false;
          regenBtn.disabled = false;
          if (fab) fab.classList.remove('ro-loading');

          if (chrome.runtime.lastError) {
            console.error('[Marketeer] generatePost runtime error:', chrome.runtime.lastError);
            showToast('Extension was reloaded — please refresh this page', 'error');
            return;
          }
          if (response.error) {
            console.error('[Marketeer] generatePost API error:', response.error);
            showToast(response.error, 'error');
            return;
          }

          console.log('[Marketeer] generatePost success, tones:', Object.keys(response.responses));
          postResponses = response.responses;
          showPostResults();
          updatePanelCredits();
          recordActivity();

          generateCooldown = true;
          setTimeout(() => { generateCooldown = false; }, 5000);
        }
      );
    } catch (e) {
      loadingEl.style.display = 'none';
      genBtn.disabled = false;
      if (fab) fab.classList.remove('ro-loading');
      showToast('Extension was reloaded — please refresh this page', 'error');
    }
  }

  function showPostResults() {
    const postResults = panel.querySelector('.ro-post-results');
    if (!postResults) return;
    postResults.style.display = 'block';

    const tabsContainer = postResults.querySelector('.ro-post-tone-tabs');
    const titleDisplay = postResults.querySelector('.ro-post-title-display');
    const bodyDisplay = postResults.querySelector('.ro-post-body-display');
    const fillBtn = panel.querySelector('.ro-post-fill-btn');

    // Build tone tabs
    tabsContainer.innerHTML = CONFIG.TONES.map(tone =>
      `<button class="ro-tone-tab ro-post-tone-tab" data-tone="${tone}" role="tab" aria-selected="false">${CONFIG.TONE_LABELS[tone]}</button>`
    ).join('');

    tabsContainer.addEventListener('click', (e) => {
      const tab = e.target.closest('.ro-post-tone-tab');
      if (!tab) return;
      switchPostTone(tab.dataset.tone);
    });

    // Select first tone
    chrome.storage.local.get(['ro_default_tone'], (r) => {
      const defaultTone = r.ro_default_tone;
      const tone = (defaultTone && CONFIG.TONES.includes(defaultTone)) ? defaultTone : CONFIG.TONES[0];
      switchPostTone(tone);
    });

    fillBtn.disabled = false;
  }

  function switchPostTone(tone) {
    activeTone = tone;
    const postResults = panel.querySelector('.ro-post-results');
    if (!postResults) return;

    const titleDisplay = postResults.querySelector('.ro-post-title-display');
    const bodyDisplay = postResults.querySelector('.ro-post-body-display');
    const data = postResponses[tone] || {};

    titleDisplay.value = data.title || '';
    bodyDisplay.value = data.body || '';

    postResults.querySelectorAll('.ro-post-tone-tab').forEach(tab => {
      const isActive = tab.dataset.tone === tone;
      tab.classList.toggle('ro-active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  function fillSubmitForm() {
    console.log('[Marketeer] fillSubmitForm called, postType:', activePostType);
    const postResults = panel.querySelector('.ro-post-results');
    if (!postResults) return;

    const title = postResults.querySelector('.ro-post-title-display').value;
    const body = postResults.querySelector('.ro-post-body-display').value;
    console.log('[Marketeer] fillSubmitForm title length:', title.length, 'body length:', body.length);

    if (!title) {
      showToast('No title to fill', 'error');
      return;
    }

    // Fill title field
    const titleInput = document.querySelector('faceplate-textarea-input[name="title"]');
    console.log('[Marketeer] fillSubmitForm titleInput found:', !!titleInput);
    if (titleInput) {
      setFaceplateValue(titleInput, title);
    } else {
      showToast('Could not find title field', 'error');
      return;
    }

    // Switch post type if needed
    if (activePostType === 'link') {
      const typeSelect = document.querySelector('r-post-type-select[name="type"]');
      if (typeSelect) {
        // Click the link option
        const linkOption = typeSelect.querySelector('[value="link"]') ||
          typeSelect.querySelector('button:nth-child(2)');
        if (linkOption) linkOption.click();
      }

      // Fill link field
      setTimeout(() => {
        const linkInput = document.querySelector('faceplate-textarea-input[name="link"]');
        if (linkInput) {
          const product = getSelectedProduct();
          const linkUrl = product ? product.link : '';
          if (linkUrl) setFaceplateValue(linkInput, linkUrl);
        }
      }, 300);
    }

    // Fill body field (Lexical editor)
    const bodyEditor = document.querySelector('shreddit-composer[name="body"] div[data-lexical-editor="true"]') ||
      document.querySelector('shreddit-composer div[data-lexical-editor="true"]') ||
      deepQuery('div[data-lexical-editor="true"]');

    closePanel();
    if (bodyEditor) {
      typeTextHumanLike(bodyEditor, body, true).then(success => {
        if (!success) insertTextBulk(bodyEditor, body);
        showToast('Post form filled — review and submit');
      });
    } else {
      // Try textarea fallback
      const bodyTextarea = document.querySelector('shreddit-composer textarea') ||
        deepQuery('textarea[name="body"]');
      if (bodyTextarea) {
        typeTextHumanLike(bodyTextarea, body, false).then(() => {
          showToast('Post form filled — review and submit');
        });
      } else {
        showToast('Post form filled — review and submit');
      }
    }
  }

  function setFaceplateValue(faceplateInput, value) {
    // faceplate-textarea-input uses shadow DOM; dispatch events to set value
    faceplateInput.setAttribute('value', value);
    const inner = faceplateInput.shadowRoot
      ? faceplateInput.shadowRoot.querySelector('textarea, input')
      : null;
    if (inner) {
      inner.value = value;
      inner.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      inner.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }
    // Also dispatch on the outer element
    faceplateInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    faceplateInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    // Try direct property assignment
    try {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
        .set.call(inner || faceplateInput, value);
      (inner || faceplateInput).dispatchEvent(new Event('input', { bubbles: true }));
    } catch (e) {}
  }

  // --- History Indicators ---

  function scanFeedForBadges() {
    if (isOldReddit) {
      document.querySelectorAll('.thing.link:not(.ro-scanned)').forEach(thing => {
        thing.classList.add('ro-scanned');
        const permalink = thing.querySelector('a.comments, a.bylink');
        if (!permalink) return;
        const postId = getPostIdFromUrl(permalink.href);
        if (postId && isPostCommented(postId)) {
          thing.classList.add('ro-has-badge');
          const badge = document.createElement('div');
          badge.className = 'ro-feed-badge';
          badge.textContent = '\u2713';
          badge.title = 'You commented on this post';
          thing.prepend(badge);
        }
      });
      return;
    }

    document.querySelectorAll('shreddit-post:not(.ro-scanned)').forEach(post => {
      post.classList.add('ro-scanned');
      const permalink = post.getAttribute('permalink') || '';
      const postId = getPostIdFromUrl(permalink);
      if (postId && isPostCommented(postId)) {
        post.classList.add('ro-has-badge');
        const badge = document.createElement('div');
        badge.className = 'ro-feed-badge';
        badge.textContent = '\u2713';
        const entry = historyCache[postId];
        const date = entry ? new Date(entry.timestamp).toLocaleDateString() : '';
        const productName = entry && entry.projectId !== 'none'
          ? (productsCache.find(p => p.id === entry.projectId) || {}).name || entry.projectId
          : '';
        badge.title = `Commented${productName ? ' (' + productName + ')' : ''} — ${date}`;
        post.prepend(badge);
      }
    });
  }

  // Watch for new content (infinite scroll, dynamically loaded comments)
  let contentObserverPending = false;
  function startContentObserver() {
    const observer = new MutationObserver(() => {
      if (contentObserverPending) return;
      contentObserverPending = true;
      setTimeout(() => {
        contentObserverPending = false;
        if (isPostPage()) {
          attachCommentListeners(); // Catch newly loaded comments
        } else {
          scanFeedForBadges();
        }
      }, 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function applyPostPageIndicators() {
    const postId = getPostId();
    if (!postId || !fab) return;

    if (isPostCommented(postId)) {
      fab.classList.add('ro-commented');
      const entry = historyCache[postId];
      const date = entry ? new Date(entry.timestamp).toLocaleDateString() : '';
      const productName = entry && entry.projectId !== 'none'
        ? (productsCache.find(p => p.id === entry.projectId) || {}).name || entry.projectId
        : '';
      fab.title = `Already commented${productName ? ' (' + productName + ')' : ''} — ${date}. Click to comment again.`;
    } else {
      fab.classList.remove('ro-commented');
    }

    applyCommentReplyHighlights(postId);
  }

  function applyCommentReplyHighlights(postId) {
    if (!postId) return;
    const entry = historyCache[postId];
    if (!entry || !entry.replyAuthor) return;

    if (isOldReddit) {
      document.querySelectorAll('.comment').forEach(el => {
        const authorEl = el.querySelector('.author');
        if (authorEl && authorEl.textContent.trim() === entry.replyAuthor) {
          el.classList.add('ro-replied');
        }
      });
    } else {
      document.querySelectorAll('shreddit-comment').forEach(el => {
        if (el.getAttribute('author') === entry.replyAuthor) {
          el.classList.add('ro-replied');
        }
      });
    }
  }

  // --- Search Mode Functions ---

  let searchSelectedProducts = new Set();
  let searchResults = [];
  let searchDismissed = new Set();
  let searchSaved = new Set();
  let searchActiveFilter = 'all';

  function loadSearchState() {
    chrome.storage.local.get(['marketeer_search_dismissed', 'marketeer_search_saved', 'marketeer_search_results', 'marketeer_search_settings'], (result) => {
      searchDismissed = new Set(result.marketeer_search_dismissed || []);
      searchSaved = new Set(result.marketeer_search_saved || []);
      // Load cached results if recent (< 1 hour)
      const cached = result.marketeer_search_results;
      if (cached && cached.results && (Date.now() - cached.timestamp) < 3600000) {
        searchResults = cached.results;
      }
      // Load settings into dropdowns
      const settings = result.marketeer_search_settings || {};
      if (panel) {
        if (settings.timeRange) {
          const el = panel.querySelector('.ro-search-time');
          if (el) el.value = settings.timeRange;
        }
        if (settings.sortBy) {
          const el = panel.querySelector('.ro-search-sort');
          if (el) el.value = settings.sortBy;
        }
        if (settings.maxResults) {
          const el = panel.querySelector('.ro-search-max');
          if (el) el.value = settings.maxResults;
        }
        if (settings.autoSearch) {
          const toggle = panel.querySelector('.ro-auto-search-toggle');
          if (toggle) toggle.classList.add('ro-on');
        }
        if (settings.autoFreq) {
          const el = panel.querySelector('.ro-auto-search-freq');
          if (el) el.value = settings.autoFreq;
        }
      }
    });
  }

  function buildSearchConfig() {
    if (!panel) return;

    // Build product chips
    const chipsContainer = panel.querySelector('.ro-search-products');
    if (!chipsContainer) return;

    if (productsCache.length === 0) {
      chipsContainer.innerHTML = '<span style="font-size:12px;color:#6a6a6a;">No products defined. Add one in the Products tab.</span>';
      return;
    }

    // Select all by default if nothing selected
    if (searchSelectedProducts.size === 0) {
      productsCache.forEach(p => searchSelectedProducts.add(p.id));
    }

    chipsContainer.innerHTML = productsCache.map(p =>
      `<button class="ro-search-product-chip${searchSelectedProducts.has(p.id) ? ' ro-selected' : ''}" data-id="${p.id}" aria-pressed="${searchSelectedProducts.has(p.id)}">${escapeHtml(p.name)}</button>`
    ).join('');

    chipsContainer.querySelectorAll('.ro-search-product-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const id = chip.dataset.id;
        if (searchSelectedProducts.has(id)) {
          searchSelectedProducts.delete(id);
          chip.classList.remove('ro-selected');
          chip.setAttribute('aria-pressed', 'false');
        } else {
          searchSelectedProducts.add(id);
          chip.classList.add('ro-selected');
          chip.setAttribute('aria-pressed', 'true');
        }
        buildConceptsSection();
      });
    });

    buildConceptsSection();
    loadSearchState();

    // Wire up search button
    const goBtn = panel.querySelector('.ro-search-go-btn');
    if (goBtn && !goBtn._wired) {
      goBtn._wired = true;
      goBtn.addEventListener('click', executeSearch);
    }

    // Wire up settings/refresh buttons
    const settingsBtn = panel.querySelector('.ro-search-settings-btn');
    if (settingsBtn && !settingsBtn._wired) {
      settingsBtn._wired = true;
      settingsBtn.addEventListener('click', () => {
        showSearchState('config');
      });
    }
    const refreshBtn = panel.querySelector('.ro-search-refresh-btn');
    if (refreshBtn && !refreshBtn._wired) {
      refreshBtn._wired = true;
      refreshBtn.addEventListener('click', executeSearch);
    }

    // Wire auto-search toggle
    const autoToggle = panel.querySelector('.ro-auto-search-toggle');
    if (autoToggle && !autoToggle._wired) {
      autoToggle._wired = true;
      autoToggle.addEventListener('click', () => {
        autoToggle.classList.toggle('ro-on');
        const enabled = autoToggle.classList.contains('ro-on');
        const freq = parseInt(panel.querySelector('.ro-auto-search-freq').value) || 60;
        chrome.runtime.sendMessage({ type: 'SET_AUTO_SEARCH', enabled, intervalMinutes: freq });
        saveSearchSettings();
      });
    }

    const autoFreq = panel.querySelector('.ro-auto-search-freq');
    if (autoFreq && !autoFreq._wired) {
      autoFreq._wired = true;
      autoFreq.addEventListener('change', () => {
        const enabled = panel.querySelector('.ro-auto-search-toggle').classList.contains('ro-on');
        if (enabled) {
          chrome.runtime.sendMessage({ type: 'SET_AUTO_SEARCH', enabled: true, intervalMinutes: parseInt(autoFreq.value) || 60 });
        }
        saveSearchSettings();
      });
    }

    // Show cached results if available
    if (searchResults.length > 0) {
      showSearchState('results');
      renderSearchResults();
    } else {
      showSearchState('config');
    }
  }

  function buildConceptsSection() {
    if (!panel) return;
    const section = panel.querySelector('.ro-concepts-section');
    if (!section) return;

    const selected = productsCache.filter(p => searchSelectedProducts.has(p.id));
    if (selected.length === 0) {
      section.innerHTML = '';
      return;
    }

    section.innerHTML = selected.map(p => {
      const concepts = p.concepts || [];
      return `
        <div class="ro-concepts-product ro-expanded" data-product-id="${p.id}">
          <div class="ro-concepts-header">
            <span>${escapeHtml(p.name)} (${concepts.length} concepts)</span>
            <span class="ro-concepts-toggle">&#9654;</span>
          </div>
          <div class="ro-concepts-body">
            <div class="ro-concepts-tags">
              ${concepts.map(c => `<span class="ro-concept-tag">${escapeHtml(c)}<button class="ro-concept-remove" data-concept="${escapeHtml(c)}" aria-label="Remove concept">&times;</button></span>`).join('')}
            </div>
            <div class="ro-concepts-input-row">
              <input type="text" class="ro-concepts-input" placeholder="Add concept..." maxlength="100">
              <button class="ro-concepts-add-btn">Add</button>
              <button class="ro-concepts-suggest-btn">Suggest</button>
            </div>
            <div class="ro-concepts-suggestions"></div>
          </div>
        </div>
      `;
    }).join('');

    // Wire up accordion toggles
    section.querySelectorAll('.ro-concepts-header').forEach(header => {
      header.addEventListener('click', () => {
        header.parentElement.classList.toggle('ro-expanded');
      });
    });

    // Wire up remove buttons
    section.querySelectorAll('.ro-concept-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const productEl = btn.closest('.ro-concepts-product');
        const productId = productEl.dataset.productId;
        const concept = btn.dataset.concept;
        removeConcept(productId, concept);
      });
    });

    // Wire up add buttons
    section.querySelectorAll('.ro-concepts-add-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const productEl = btn.closest('.ro-concepts-product');
        const productId = productEl.dataset.productId;
        const input = productEl.querySelector('.ro-concepts-input');
        const concept = input.value.trim().toLowerCase();
        if (concept) {
          addConcept(productId, concept);
          input.value = '';
        }
      });
    });

    // Enter key on input
    section.querySelectorAll('.ro-concepts-input').forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const productEl = input.closest('.ro-concepts-product');
          const productId = productEl.dataset.productId;
          const concept = input.value.trim().toLowerCase();
          if (concept) {
            addConcept(productId, concept);
            input.value = '';
          }
        }
      });
    });

    // Wire up suggest buttons
    section.querySelectorAll('.ro-concepts-suggest-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const productEl = btn.closest('.ro-concepts-product');
        const productId = productEl.dataset.productId;
        const product = productsCache.find(p => p.id === productId);
        if (!product) return;

        btn.disabled = true;
        btn.textContent = '...';

        try {
          const result = await chrome.runtime.sendMessage({
            type: 'SUGGEST_CONCEPTS',
            name: product.name,
            features: product.features,
            keywords: product.keywords
          });

          if (result.error) {
            showToast(result.error, 'error');
            return;
          }

          const suggestionsEl = productEl.querySelector('.ro-concepts-suggestions');
          const existing = new Set(product.concepts || []);
          const suggestions = (result.concepts || []).filter(c => !existing.has(c));

          suggestionsEl.innerHTML = suggestions.map(c =>
            `<button class="ro-concept-suggestion" data-concept="${escapeHtml(c)}">+ ${escapeHtml(c)}</button>`
          ).join('');

          suggestionsEl.querySelectorAll('.ro-concept-suggestion').forEach(tag => {
            tag.addEventListener('click', () => {
              addConcept(productId, tag.dataset.concept);
              tag.remove();
            });
          });
        } catch (err) {
          showToast('Failed to get suggestions', 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Suggest';
        }
      });
    });
  }

  function addConcept(productId, concept) {
    const product = productsCache.find(p => p.id === productId);
    if (!product) return;
    if (!product.concepts) product.concepts = [];
    if (product.concepts.includes(concept)) return;
    if (product.concepts.length >= (CONFIG.MAX_CONCEPTS || 20)) {
      showToast('Max ' + (CONFIG.MAX_CONCEPTS || 20) + ' concepts per product', 'error');
      return;
    }
    product.concepts.push(concept);
    chrome.storage.local.set({ marketeer_products: productsCache });
    buildConceptsSection();
  }

  function removeConcept(productId, concept) {
    const product = productsCache.find(p => p.id === productId);
    if (!product || !product.concepts) return;
    product.concepts = product.concepts.filter(c => c !== concept);
    chrome.storage.local.set({ marketeer_products: productsCache });
    buildConceptsSection();
  }

  function saveSearchSettings() {
    if (!panel) return;
    const settings = {
      timeRange: panel.querySelector('.ro-search-time').value,
      sortBy: panel.querySelector('.ro-search-sort').value,
      maxResults: panel.querySelector('.ro-search-max').value,
      autoSearch: panel.querySelector('.ro-auto-search-toggle').classList.contains('ro-on'),
      autoFreq: panel.querySelector('.ro-auto-search-freq').value
    };
    chrome.storage.local.set({ marketeer_search_settings: settings });
  }

  function showSearchState(state) {
    if (!panel) return;
    const config = panel.querySelector('.ro-search-config');
    const loading = panel.querySelector('.ro-search-loading');
    const results = panel.querySelector('.ro-search-results');
    const empty = panel.querySelector('.ro-search-empty');

    if (config) config.style.display = state === 'config' ? '' : 'none';
    if (loading) loading.style.display = state === 'loading' ? '' : 'none';
    if (results) results.style.display = state === 'results' ? '' : 'none';
    if (empty) empty.style.display = state === 'empty' ? '' : 'none';
  }

  // Client-side relevance scoring
  function scoreSearchResult(result, product) {
    let score = 0;
    const text = ((result.title || '') + ' ' + (result.selftext || '')).toLowerCase();

    // Keyword match: +10 each
    if (product.keywords) {
      for (const kw of product.keywords) {
        if (text.includes(kw.toLowerCase())) score += 10;
      }
    }

    // Concept match: +15 each
    if (product.concepts) {
      for (const c of product.concepts) {
        if (text.includes(c.toLowerCase())) score += 15;
      }
    }

    // Subreddit match: +25
    if (product.subreddits) {
      const sub = (result.subreddit || '').toLowerCase();
      if (product.subreddits.some(s => s.toLowerCase() === sub)) score += 25;
    }

    // Recency bonus
    const ageMs = Date.now() - (result.createdUtc * 1000);
    const ageHours = ageMs / (1000 * 60 * 60);
    if (ageHours < 24) score += 10;
    else if (ageHours < 72) score += 5;

    // Comment count sweet spot (5-50)
    if (result.numComments >= 5 && result.numComments <= 50) score += 5;

    return score;
  }

  async function executeSearch() {
    if (!panel) return;

    const selected = productsCache.filter(p => searchSelectedProducts.has(p.id));
    if (selected.length === 0) {
      showToast('Select at least one product', 'error');
      return;
    }

    saveSearchSettings();
    showSearchState('loading');

    const progress = panel.querySelector('.ro-search-progress');
    if (progress) progress.textContent = 'Generating search queries...';

    try {
      // Step 1: Generate queries
      const queryResult = await chrome.runtime.sendMessage({
        type: 'GENERATE_SEARCH_QUERIES',
        products: selected.map(p => ({
          id: p.id,
          name: p.name,
          features: p.features,
          keywords: p.keywords,
          concepts: p.concepts,
          subreddits: p.subreddits
        }))
      });

      if (queryResult.error) {
        showToast(queryResult.error, 'error');
        showSearchState('config');
        return;
      }

      if (!queryResult.queries || !queryResult.queries.length) {
        showSearchState('empty');
        return;
      }

      if (progress) progress.textContent = 'Searching ' + queryResult.queries.length + ' queries...';

      // Step 2: Execute search
      const settings = {
        timeRange: panel.querySelector('.ro-search-time').value,
        sortBy: panel.querySelector('.ro-search-sort').value,
        maxResults: parseInt(panel.querySelector('.ro-search-max').value) || 20
      };

      const searchResult = await chrome.runtime.sendMessage({
        type: 'EXECUTE_SEARCH',
        queries: queryResult.queries,
        settings
      });

      if (searchResult.error) {
        showToast(searchResult.error, 'error');
        showSearchState('config');
        return;
      }

      if (!searchResult.results || !searchResult.results.length) {
        searchResults = [];
        showSearchState('empty');
        return;
      }

      // Step 3: Score and sort
      const scored = searchResult.results.map(r => {
        const product = productsCache.find(p => p.id === r.productId);
        const score = product ? scoreSearchResult(r, product) : 0;
        return { ...r, relevanceScore: score };
      });

      // Filter out dismissed and already-commented posts
      searchResults = scored
        .filter(r => !searchDismissed.has(r.id) && !isPostCommented(r.id))
        .sort((a, b) => b.relevanceScore - a.relevanceScore);

      // Cache results
      chrome.storage.local.set({
        marketeer_search_results: {
          results: searchResults,
          timestamp: Date.now()
        }
      });

      if (searchResults.length === 0) {
        showSearchState('empty');
      } else {
        showSearchState('results');
        renderSearchResults();
      }
    } catch (err) {
      showToast('Search failed: ' + (err.message || 'Unknown error'), 'error');
      showSearchState('config');
    }
  }

  function renderSearchResults() {
    if (!panel) return;
    const cardsContainer = panel.querySelector('.ro-search-cards');
    const filtersContainer = panel.querySelector('.ro-search-filters');
    if (!cardsContainer || !filtersContainer) return;

    // Build filter chips
    const productCounts = {};
    searchResults.forEach(r => {
      const pid = r.productId || 'unknown';
      productCounts[pid] = (productCounts[pid] || 0) + 1;
    });

    let filterHtml = `<button class="ro-search-filter-chip${searchActiveFilter === 'all' ? ' ro-active' : ''}" data-filter="all">All (${searchResults.length})</button>`;
    for (const pid of Object.keys(productCounts)) {
      const product = productsCache.find(p => p.id === pid);
      const name = product ? product.name : pid;
      filterHtml += `<button class="ro-search-filter-chip${searchActiveFilter === pid ? ' ro-active' : ''}" data-filter="${pid}">${escapeHtml(name)} (${productCounts[pid]})</button>`;
    }
    filtersContainer.innerHTML = filterHtml;

    filtersContainer.querySelectorAll('.ro-search-filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        searchActiveFilter = chip.dataset.filter;
        filtersContainer.querySelectorAll('.ro-search-filter-chip').forEach(c => c.classList.toggle('ro-active', c === chip));
        renderSearchCards(cardsContainer);
      });
    });

    renderSearchCards(cardsContainer);
  }

  function renderSearchCards(container) {
    const filtered = searchActiveFilter === 'all'
      ? searchResults
      : searchResults.filter(r => r.productId === searchActiveFilter);

    if (filtered.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:20px;color:#6a6a6a;font-size:12px;">No results for this filter.</div>';
      return;
    }

    container.innerHTML = filtered.map(r => {
      const product = productsCache.find(p => p.id === r.productId);
      const productName = product ? product.name : '';
      const score = r.relevanceScore || 0;
      const relevanceClass = score >= 30 ? 'ro-relevance-high' : score >= 15 ? 'ro-relevance-medium' : 'ro-relevance-low';
      const relevanceLabel = score >= 30 ? 'High' : score >= 15 ? 'Medium' : 'Low';
      const age = formatAge(r.createdUtc);
      const isSaved = searchSaved.has(r.id);
      const isSkipped = searchDismissed.has(r.id);

      return `
        <div class="ro-search-card${isSkipped ? ' ro-skipped' : ''}" data-post-id="${r.id}">
          <div class="ro-search-card-header">
            <span class="ro-search-card-sub">r/${escapeHtml(r.subreddit)}</span>
            <span class="ro-search-card-age">${age}</span>
            <span class="ro-relevance ${relevanceClass}">${relevanceLabel}</span>
            ${productName ? `<span class="ro-search-card-product">${escapeHtml(productName)}</span>` : ''}
          </div>
          <div class="ro-search-card-title">${escapeHtml(r.title)}</div>
          ${r.selftext ? `<div class="ro-search-card-preview">${escapeHtml(r.selftext.slice(0, 150))}</div>` : ''}
          <div class="ro-search-card-stats">
            <span>${r.score} pts</span>
            <span>${r.numComments} comments</span>
            <span>by u/${escapeHtml(r.author)}</span>
          </div>
          <div class="ro-search-card-actions">
            <button class="ro-btn-open" data-permalink="${escapeHtml(r.permalink)}">Open</button>
            <button class="ro-btn-save${isSaved ? ' ro-saved' : ''}" data-post-id="${r.id}">${isSaved ? 'Saved' : 'Save'}</button>
            <button class="ro-btn-skip" data-post-id="${r.id}">Skip</button>
          </div>
        </div>
      `;
    }).join('');

    // Wire up card actions
    container.querySelectorAll('.ro-btn-open').forEach(btn => {
      btn.addEventListener('click', () => {
        const permalink = btn.dataset.permalink;
        if (permalink) {
          window.open('https://www.reddit.com' + permalink, '_blank');
        }
      });
    });

    container.querySelectorAll('.ro-btn-save').forEach(btn => {
      btn.addEventListener('click', () => {
        const postId = btn.dataset.postId;
        if (searchSaved.has(postId)) {
          searchSaved.delete(postId);
          btn.textContent = 'Save';
          btn.classList.remove('ro-saved');
        } else {
          searchSaved.add(postId);
          btn.textContent = 'Saved';
          btn.classList.add('ro-saved');
        }
        pruneAndSaveSet('marketeer_search_saved', searchSaved);
      });
    });

    container.querySelectorAll('.ro-btn-skip').forEach(btn => {
      btn.addEventListener('click', () => {
        const postId = btn.dataset.postId;
        searchDismissed.add(postId);
        pruneAndSaveSet('marketeer_search_dismissed', searchDismissed);
        const card = btn.closest('.ro-search-card');
        if (card) card.classList.add('ro-skipped');
      });
    });
  }

  function formatAge(utcTimestamp) {
    const now = Date.now() / 1000;
    const diff = now - utcTimestamp;
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return Math.floor(diff / 604800) + 'w ago';
  }

  function pruneAndSaveSet(key, set) {
    // Cap at 500 entries
    const arr = Array.from(set);
    if (arr.length > 500) {
      const pruned = arr.slice(arr.length - 500);
      set.clear();
      pruned.forEach(id => set.add(id));
    }
    chrome.storage.local.set({ [key]: Array.from(set) });
  }

  // Open search panel on any Reddit page
  function openSearchPanel() {
    panelMode = 'comment';
    panelTab = 'search';
    createPanel();
    currentPostData = null;
    responses = {};
    activeTone = null;

    const subreddit = location.pathname.split('/')[2] || '';
    panel.querySelector('.ro-panel-subreddit').textContent = subreddit ? 'r/' + subreddit : 'Reddit';
    panel.querySelector('.ro-panel-title').textContent = 'Search for Opportunities';

    // Switch to search tab
    panel.querySelectorAll('.ro-mode-tab').forEach(t => t.classList.toggle('ro-active', t.dataset.mode === 'search'));
    panel.querySelector('.ro-generate-content').style.display = 'none';
    panel.querySelector('.ro-search-content').style.display = '';
    panel.querySelector('.ro-panel-footer').style.display = 'none';
    panel.querySelector('.ro-post-controls').style.display = 'none';
    panel.querySelector('.ro-post-results').style.display = 'none';
    panel.querySelector('.ro-post-footer').style.display = 'none';

    updatePanelCredits();
    buildSearchConfig();

    backdrop.classList.add('ro-visible');
    requestAnimationFrame(() => {
      panel.classList.add('ro-visible');
      const closeBtn = panel.querySelector('.ro-close-btn');
      if (closeBtn) closeBtn.focus();
    });
  }

  // --- Message listener (open panel from popup) ---
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'OPEN_PANEL') {
      if (panel && panel.classList.contains('ro-visible')) {
        sendResponse({ success: false, error: 'already_open' });
        return;
      }
      if (isSubmitPage()) {
        const subreddit = location.pathname.split('/')[2] || '';
        openPostPanel(subreddit);
        sendResponse({ success: true });
        return;
      }
      if (!isPostPage()) {
        sendResponse({ success: false, error: 'not_post_page' });
        return;
      }
      replyTarget = null;
      const postData = extractPostData();
      if (!postData.title) {
        sendResponse({ success: false, error: 'no_post_data' });
        return;
      }
      openPanel(postData);
      sendResponse({ success: true });
    }

    if (message.type === 'OPEN_PANEL_SEARCH') {
      if (panel && panel.classList.contains('ro-visible')) {
        // Switch to search tab if already open
        panelTab = 'search';
        panel.querySelectorAll('.ro-mode-tab').forEach(t => t.classList.toggle('ro-active', t.dataset.mode === 'search'));
        panel.querySelector('.ro-generate-content').style.display = 'none';
        panel.querySelector('.ro-search-content').style.display = '';
        panel.querySelector('.ro-panel-footer').style.display = 'none';
        panel.querySelector('.ro-post-footer').style.display = 'none';
        buildSearchConfig();
        sendResponse({ success: true });
        return;
      }
      openSearchPanel();
      sendResponse({ success: true });
    }
  });

  // --- Init ---
  console.log('[Marketeer] Init starting, pathname:', location.pathname);
  loadProducts(() => {
    loadHistory(() => {
      if (isPostPage()) {
        console.log('[Marketeer] Init: post page detected');
        fab = createFAB();
        setTimeout(scrapeSubredditRules, 1500);
        setTimeout(applyPostPageIndicators, 500);
        setTimeout(attachCommentListeners, 500);
      } else if (isSubmitPage()) {
        console.log('[Marketeer] Init: submit page detected, creating FAB');
        fab = createFAB();
        setTimeout(scrapeSubredditRules, 1500);
      } else {
        console.log('[Marketeer] Init: feed/other page');
        setTimeout(scanFeedForBadges, 500);
      }
      startContentObserver();
    });
  });
})();
