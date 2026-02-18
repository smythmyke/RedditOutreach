(function () {
  const isOldReddit = location.hostname === 'old.reddit.com';

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
      // Attach comment listeners for the new page
      setTimeout(attachCommentListeners, 500);
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
    btn.textContent = 'M';
    btn.title = 'Marketeer — Reply to main post';
    btn.setAttribute('aria-label', 'Generate Reddit response');
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

  function createPanel() {
    if (panel) return;

    backdrop = document.createElement('div');
    backdrop.className = 'ro-backdrop';
    backdrop.addEventListener('click', closePanel);
    document.body.appendChild(backdrop);

    const projectOptionsHtml = CONFIG.PROJECTS.map(p =>
      `<option value="${p.id}">${p.name}</option>`
    ).join('');

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
        <div class="ro-credits-badge" title="Credits remaining">
          <span class="ro-credits-icon">&#9679;</span>
          <span class="ro-credits-count">--</span>
        </div>
        <button class="ro-close-btn" aria-label="Close panel">&times;</button>
      </div>
      <div class="ro-panel-body">
        <div class="ro-reply-context" style="display:none"></div>
        <div class="ro-project-row">
          <label>Project:</label>
          <select class="ro-project-select">${projectOptionsHtml}</select>
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
      </div>
      <div class="ro-panel-footer">
        <button class="ro-btn ro-btn-secondary ro-regen-btn" disabled>Regenerate</button>
        <button class="ro-btn ro-btn-secondary ro-copy-btn" disabled>Copy</button>
        <button class="ro-btn ro-btn-primary ro-submit-btn" disabled>Submit</button>
      </div>
    `;
    document.body.appendChild(panel);

    panel.querySelector('.ro-close-btn').addEventListener('click', closePanel);
    textarea = panel.querySelector('.ro-textarea');
    charCount = panel.querySelector('.ro-char-count');

    // Restore saved project selection
    chrome.storage.local.get(['ro_project'], (result) => {
      const projectSelect = panel.querySelector('.ro-project-select');
      if (result.ro_project) projectSelect.value = result.ro_project;
    });

    textarea.addEventListener('input', () => {
      charCount.textContent = textarea.value.length + ' chars';
      if (activeTone) responses[activeTone] = textarea.value;
    });

    panel.querySelector('.ro-tone-tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.ro-tone-tab');
      if (!tab) return;
      switchTone(tab.dataset.tone);
    });

    panel.querySelector('.ro-project-select').addEventListener('change', (e) => {
      chrome.storage.local.set({ ro_project: e.target.value });
      updateRulesWarning();
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

      // Cooldown prevents the auto-submit click from re-triggering onCommentClick
      submitCooldown = true;
      setTimeout(() => { submitCooldown = false; }, 3000);

      setTimeout(applyPostPageIndicators, 100);
      fillCommentBox(textarea.value);
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

  function switchTone(tone) {
    activeTone = tone;
    textarea.value = responses[tone] || '';
    charCount.textContent = textarea.value.length + ' chars';

    panel.querySelectorAll('.ro-tone-tab').forEach(tab => {
      const isActive = tab.dataset.tone === tone;
      tab.classList.toggle('ro-active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  // --- Project Auto-Detection ---
  function detectProject(postData) {
    var subreddit = (postData.subreddit || '').toLowerCase().replace(/^r\//, '');
    var text = ((postData.title || '') + ' ' + (postData.body || '')).toLowerCase();
    // Include reply target text if present
    if (replyTarget && replyTarget.text) {
      text += ' ' + replyTarget.text.toLowerCase();
    }

    var weights = CONFIG.DETECT_WEIGHTS;
    var best = null;
    var bestScore = 0;

    var projectIds = Object.keys(CONFIG.PROJECT_KEYWORDS);
    for (var p = 0; p < projectIds.length; p++) {
      var pid = projectIds[p];
      var kw = CONFIG.PROJECT_KEYWORDS[pid];
      var score = 0;

      // Subreddit match (highest weight)
      for (var i = 0; i < kw.subreddits.length; i++) {
        if (subreddit === kw.subreddits[i]) {
          score += weights.subreddit;
          break;
        }
      }

      // Phrase matches (check before single keywords — very specific)
      for (var i = 0; i < kw.phrases.length; i++) {
        if (text.indexOf(kw.phrases[i]) !== -1) {
          score += weights.phrase;
        }
      }

      // High-confidence keywords
      for (var i = 0; i < kw.high.length; i++) {
        if (text.indexOf(kw.high[i]) !== -1) {
          score += weights.high;
        }
      }

      // Medium-confidence keywords
      for (var i = 0; i < kw.medium.length; i++) {
        if (text.indexOf(kw.medium[i]) !== -1) {
          score += weights.medium;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        best = pid;
      }
    }

    if (bestScore >= CONFIG.DETECT_THRESHOLD) return best;
    return null; // No confident match
  }

  function openPanel(postData) {
    createPanel();
    currentPostData = postData;
    responses = {};
    activeTone = null;

    panel.querySelector('.ro-panel-subreddit').textContent = 'r/' + postData.subreddit;
    panel.querySelector('.ro-panel-title').textContent = postData.title;

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

    // Auto-detect project based on subreddit + post content
    var detected = detectProject(postData);
    var projectSelect = panel.querySelector('.ro-project-select');
    if (detected) {
      projectSelect.value = detected;
      chrome.storage.local.set({ ro_project: detected });
    }

    updateRulesWarning();
    updatePanelCredits();

    backdrop.classList.add('ro-visible');
    requestAnimationFrame(() => {
      panel.classList.add('ro-visible');
      // Focus the close button for keyboard users
      const closeBtn = panel.querySelector('.ro-close-btn');
      if (closeBtn) closeBtn.focus();
    });

    generateAllResponses(postData);
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

    // Include reply context if replying to a comment (anonymize author)
    const replyTo = replyTarget
      ? { author: 'User', text: replyTarget.text }
      : null;

    try {
      chrome.runtime.sendMessage(
        { type: 'GENERATE_ALL', postData, projectId, subredditRules, replyTo },
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
          replyArea.focus();
          replyArea.value = text;
          replyArea.dispatchEvent(new Event('input', { bubbles: true }));
          closePanel();
          showToast('Reply draft inserted — review and submit when ready');
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
      commentArea.focus();
      commentArea.value = text;
      commentArea.dispatchEvent(new Event('input', { bubbles: true }));
      closePanel();
      showToast('Draft inserted — review and submit when ready');
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
      // Check visible: offsetParent works for light DOM; for shadow DOM check offsetWidth
      const visible = editable && (editable.offsetParent !== null || editable.offsetWidth > 0);

      if (visible) {
        clearInterval(pollForComposer);
        insertTextIntoEditor(editable, text);
        closePanel();
        showToast('Draft inserted — review and submit when ready');
        return;
      }

      if (attempts <= 3) clickComposerTrigger();
      // After 5 attempts, try textarea fallback

      if (attempts >= 5) {
        const mdTextarea = document.querySelector('shreddit-composer textarea') ||
          document.querySelector('.comment-composer textarea') ||
          deepQuery('shreddit-composer textarea');
        if (mdTextarea && mdTextarea.offsetParent !== null) {
          clearInterval(pollForComposer);
          mdTextarea.focus();
          mdTextarea.value = text;
          mdTextarea.dispatchEvent(new Event('input', { bubbles: true }));
          closePanel();
          showToast('Draft inserted — review and submit when ready');
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

  function insertTextIntoEditor(editable, text) {
    editable.focus();
    const selection = window.getSelection();
    selection.selectAllChildren(editable);
    selection.deleteFromDocument();

    // Modern approach: InputEvent with dataTransfer (Lexical editors listen for this)
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      const inputEvent = new InputEvent('beforeinput', {
        inputType: 'insertFromPaste',
        data: text,
        dataTransfer: dt,
        bubbles: true,
        cancelable: true,
        composed: true
      });
      const handled = !editable.dispatchEvent(inputEvent);
      if (handled || editable.textContent.trim().length > 0) return;
    } catch (e) {
      // InputEvent constructor not supported or event not handled
    }

    // Fallback: execCommand (deprecated but widely supported)
    document.execCommand('insertText', false, text);
  }

  function fillNewRedditReply(text, commentEl) {
    clickCommentReplyButton(commentEl);

    let attempts = 0;
    const maxAttempts = 20;

    const pollForReply = setInterval(() => {
      attempts++;

      const editable = findReplyEditor(commentEl);

      if (editable && editable.offsetParent !== null) {
        clearInterval(pollForReply);
        insertTextIntoEditor(editable, text);
        closePanel();
        showToast('Reply draft inserted — review and submit when ready');
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
        if (ed.offsetParent !== null) return ed;
      }
    }

    return null;
  }

  // --- FAB Click --- (always opens panel for main post)
  function onFABClick() {
    if (panel && panel.classList.contains('ro-visible')) {
      closePanel();
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
        badge.title = `Commented${entry && entry.projectId !== 'none' ? ' (' + entry.projectId + ')' : ''} — ${date}`;
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
      fab.title = `Already commented${entry && entry.projectId !== 'none' ? ' (' + entry.projectId + ')' : ''} — ${date}. Click to comment again.`;
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

  // --- Init ---
  loadHistory(() => {
    if (isPostPage()) {
      fab = createFAB();
      setTimeout(scrapeSubredditRules, 1500);
      setTimeout(applyPostPageIndicators, 500);
      setTimeout(attachCommentListeners, 500);
    } else {
      setTimeout(scanFeedForBadges, 500);
    }
    startContentObserver();
  });
})();
