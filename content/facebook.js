/**
 * Marketeer — Facebook Groups Content Script
 * Detects group discussions, scrapes post content, generates AI comments in multiple tones.
 * Simplified version of reddit.js (no search mode, no post generation mode).
 */

(function () {
  'use strict';

  // Prevent double-injection
  if (window.__marketeerFBLoaded) return;
  window.__marketeerFBLoaded = true;

  console.log('[Marketeer FB] Content script loaded on', location.href);

  // --- Global State ---
  let panelEl = null;
  let backdropEl = null;
  let fabEl = null;
  let toastEl = null;
  let currentPostData = null;
  let selectedProjectId = 'none';
  let productsCache = [];
  let isGenerating = false;
  let activeTab = 'friendly';
  let currentResponses = {};
  let isPanelOpen = false;
  let authChecked = false;
  let isAuthenticated = false;
  let selectedArticleEl = null;
  let feedObserver = null;
  let processedArticles = new WeakSet();
  let pageClickHandlers = new Map();
  let pendingAutoInsert = false;

  // Product color palette — assigned by index in productsCache
  const PRODUCT_COLORS = [
    '#4a90d9', // blue
    '#46d160', // green
    '#e0a030', // amber
    '#d94a8a', // pink
    '#9b59b6', // purple
    '#1abc9c', // teal
    '#e67e22', // orange
    '#3498db', // light blue
  ];

  // --- Facebook DOM Selectors ---
  // Facebook obfuscates CSS classes; we rely on semantic attributes.
  const FB = {
    feed: 'div[role="feed"]',
    post: 'div[role="article"]',              // Group feed items
    searchPost: 'div[aria-posinset]',          // Search result items
    postText: 'div[dir="auto"][style]',
    commentInput: 'div[contenteditable="true"][role="textbox"]',
    comments: 'ul[role="list"] > li div[role="article"]'
  };

  // --- Initialization ---

  function init() {
    loadProducts();
    loadSelectedProject();
    listenForStorageChanges();
    startUrlObserver();
    handleNavigation();
  }

  function loadProducts() {
    chrome.storage.local.get(['marketeer_products'], (result) => {
      productsCache = result.marketeer_products || [];
    });
  }

  function loadSelectedProject() {
    chrome.storage.local.get(['ro_project'], (result) => {
      selectedProjectId = result.ro_project || 'none';
    });
  }

  function listenForStorageChanges() {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.marketeer_products) {
        productsCache = changes.marketeer_products.newValue || [];
        if (panelEl) updateProductDropdown();
      }
    });
  }

  // --- SPA Navigation Detection ---

  let lastUrl = location.href;
  function startUrlObserver() {
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        console.log('[Marketeer FB] URL changed to', lastUrl);
        handleNavigation();
      }
    }, 1000);
  }

  function handleNavigation() {
    const isGroupPage = /facebook\.com\/groups\//.test(location.href);
    const isSearch = isSearchPage();
    if (isGroupPage || isSearch) {
      // Wait a moment for DOM to settle after SPA navigation
      setTimeout(() => {
        showFab();
      }, 1500);
    } else {
      removeFab();
      closePanel();
    }
  }

  // --- Message Listener (for popup "Open Panel" button) ---

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'OPEN_PANEL') {
      if (isPanelOpen) {
        sendResponse({ success: false, error: 'already_open' });
        return;
      }
      openPanel();
      sendResponse({ success: true });
      return;
    }
  });

  // --- FAB (Floating Action Button) ---

  function showFab() {
    if (fabEl) return;

    fabEl = document.createElement('button');
    fabEl.className = 'ro-fb-fab';
    fabEl.title = 'Marketeer — Generate AI Comment';
    fabEl.setAttribute('aria-label', 'Open Marketeer panel');

    const iconUrl = chrome.runtime.getURL('icons/fab-icon.png');
    const img = document.createElement('img');
    img.src = iconUrl;
    img.alt = 'Marketeer';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
    fabEl.appendChild(img);

    fabEl.addEventListener('click', () => {
      if (isPanelOpen) {
        closePanel();
      } else {
        openPanel();
      }
    });

    document.body.appendChild(fabEl);
    console.log('[Marketeer FB] FAB shown');
  }

  function removeFab() {
    if (fabEl) {
      fabEl.remove();
      fabEl = null;
    }
  }

  // --- Page Type Detection ---

  function isPermalinkPage() {
    return /\/groups\/[^/]+\/(posts|permalink)\//.test(location.href);
  }

  function isSearchPage() {
    return /facebook\.com\/search\//.test(location.href);
  }

  /** Returns the right CSS selector for post items based on current page type. */
  function getPostSelector() {
    return isSearchPage() ? FB.searchPost : FB.post;
  }

  // --- Post Detection ---

  function detectPostFromArticle(article) {
    if (!article) return null;

    const groupName = extractGroupName();
    const postAuthor = extractPostAuthor(article);
    const postText = extractPostText(article);

    if (!postText || postText.length < 5) {
      console.log('[Marketeer FB] Post text too short or empty');
      return null;
    }

    // Extract comments scoped to this article (or page-level for permalink)
    const comments = extractComments(article);

    return {
      groupName: groupName || (isSearchPage() ? 'Facebook Search' : 'Facebook Group'),
      postAuthor: postAuthor || 'Unknown',
      postText,
      comments,
      permalink: location.href
    };
  }

  function detectCurrentPost() {
    const articles = document.querySelectorAll(FB.post);
    if (!articles.length) {
      console.log('[Marketeer FB] No articles found');
      return null;
    }
    return detectPostFromArticle(articles[0]);
  }

  function extractGroupName() {
    // Try document title first: "Group Name | Facebook"
    const title = document.title || '';
    const parts = title.split('|');
    if (parts.length >= 2) {
      return parts[0].trim();
    }
    // Fallback: try to find group name in header
    const h1 = document.querySelector('h1');
    if (h1) return h1.textContent.trim();
    return '';
  }

  function extractPostAuthor(article) {
    if (!article) return '';

    // Search results: author in data-ad-rendering-role="profile_name"
    const profileNameEl = article.querySelector('[data-ad-rendering-role="profile_name"]');
    if (profileNameEl) {
      // Name is typically in the first link or heading within profile_name
      const link = profileNameEl.querySelector('a');
      if (link) {
        const text = link.textContent.trim();
        if (text && text.length > 1) return text;
      }
      const heading = profileNameEl.querySelector('h3, h4, strong, span');
      if (heading) {
        const text = heading.textContent.trim();
        if (text && text.length > 1) return text;
      }
    }

    // Group feed: look for user links within the article header area
    const authorLink = article.querySelector('a[href*="/user/"], a[href*="/profile.php"]');
    if (authorLink) {
      const strong = authorLink.querySelector('strong');
      if (strong) return strong.textContent.trim();
      const span = authorLink.querySelector('span');
      if (span) return span.textContent.trim();
      return authorLink.textContent.trim();
    }
    // Fallback: first strong tag in article
    const strong = article.querySelector('strong');
    if (strong) return strong.textContent.trim();
    return '';
  }

  function extractPostText(article) {
    if (!article) return '';

    // Search results: scope to story_message if available (avoids blockquote noise)
    const storyEl = article.querySelector('[data-ad-rendering-role="story_message"]');
    const scope = storyEl || article;

    // Collect text from dir="auto" divs within scope
    const textDivs = scope.querySelectorAll('div[dir="auto"], span[dir="auto"]');
    const texts = [];
    const seen = new Set();

    for (const div of textDivs) {
      const text = div.textContent.trim();
      // Skip very short text (likely UI elements), duplicates, and navigation items
      if (text.length < 3) continue;
      if (seen.has(text)) continue;
      // Skip if this is inside a comment list or is a UI element
      if (div.closest('ul[role="list"]')) continue;
      if (div.closest('[role="navigation"]')) continue;
      if (div.closest('[role="banner"]')) continue;
      // Skip blockquote elements (search page "related searches")
      if (div.closest('blockquote')) continue;
      // Skip common UI labels
      if (/^(Like|Comment|Share|Reply|See more|Write a comment|Most relevant|Facebook)$/i.test(text)) continue;
      seen.add(text);
      texts.push(text);
    }

    return texts.join('\n\n');
  }

  function extractComments(scopeEl) {
    const root = scopeEl || document;
    const commentEls = root.querySelectorAll('ul[role="list"] div[role="article"]');
    if (!commentEls.length) return '';

    const comments = [];
    const seen = new Set();

    for (const commentEl of commentEls) {
      if (comments.length >= 10) break; // Cap at 10 comments

      const author = extractPostAuthor(commentEl);
      const textDivs = commentEl.querySelectorAll('div[dir="auto"]');
      let commentText = '';
      for (const div of textDivs) {
        const t = div.textContent.trim();
        if (t.length >= 3 && !/^(Like|Reply|See more|\d+\s*(h|m|d|w|y|hr|min))$/i.test(t)) {
          commentText += (commentText ? ' ' : '') + t;
        }
      }

      if (commentText && !seen.has(commentText)) {
        seen.add(commentText);
        comments.push(`${author}: ${commentText}`);
      }
    }

    return comments.join('\n');
  }

  // --- Product Auto-Detection ---

  function autoDetectProduct(postText) {
    if (!productsCache.length || !postText) return null;

    let bestProduct = null;
    let bestScore = 0;

    for (const product of productsCache) {
      let score = 0;

      // Keyword matching: +10 per keyword found in post text
      const keywords = product.keywords || [];
      const lowerText = postText.toLowerCase();
      for (const kw of keywords) {
        if (lowerText.includes(kw.toLowerCase())) {
          score += 10;
        }
      }

      // Feature-based matching: check if post mentions key terms from features
      if (product.features) {
        const featureWords = product.features.toLowerCase().split(/\s+/).filter(w => w.length > 5);
        for (const word of featureWords) {
          if (lowerText.includes(word)) {
            score += 2;
          }
        }
      }

      if (score > bestScore && score >= CONFIG.DETECT_THRESHOLD) {
        bestScore = score;
        bestProduct = product;
      }
    }

    return bestProduct;
  }

  // --- Product Color Helper ---

  function getProductColor(product) {
    const idx = productsCache.findIndex(p => p.id === product.id);
    return PRODUCT_COLORS[idx % PRODUCT_COLORS.length];
  }

  // --- Post Scoring Against All Products ---

  function scorePostAgainstAllProducts(postText) {
    if (!productsCache.length || !postText) return [];
    const lowerText = postText.toLowerCase();
    const matches = [];

    for (const product of productsCache) {
      let score = 0;
      const keywords = product.keywords || [];
      for (const kw of keywords) {
        if (lowerText.includes(kw.toLowerCase())) score += 10;
      }
      if (product.features) {
        const featureWords = product.features.toLowerCase().split(/\s+/).filter(w => w.length > 5);
        for (const word of featureWords) {
          if (lowerText.includes(word)) score += 2;
        }
      }
      if (score >= CONFIG.DETECT_THRESHOLD) {
        matches.push({ product, score });
      }
    }

    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, 2);
  }

  // --- Feed Post Scanning ---

  function scanFeedPosts() {
    const selector = getPostSelector();
    const articles = document.querySelectorAll(selector);
    const matched = [];

    for (const article of articles) {
      if (processedArticles.has(article)) continue;
      processedArticles.add(article);

      const postText = extractPostText(article);
      if (!postText || postText.length < 5) continue;

      const products = scorePostAgainstAllProducts(postText);
      if (!products.length) continue;

      matched.push({
        articleEl: article,
        author: extractPostAuthor(article),
        textPreview: postText.length > 120 ? postText.slice(0, 120) + '...' : postText,
        fullText: postText,
        products
      });
    }

    return matched;
  }

  // --- Post List Rendering ---

  function buildPostList(matchedPosts) {
    const container = panelEl ? panelEl.querySelector('#fb-post-list-container') : null;
    if (!container) return;

    container.innerHTML = '';

    // Always show instruction
    const instruction = document.createElement('div');
    instruction.className = 'ro-fb-instruction';
    instruction.innerHTML = '<strong>Click any post</strong> on the page to auto-generate and insert a comment.';
    container.appendChild(instruction);

    // Show matched posts if any
    if (matchedPosts.length) {
      for (const post of matchedPosts) {
        container.appendChild(createPostCard(post));
      }
    } else if (productsCache.length) {
      const hint = document.createElement('div');
      hint.className = 'ro-fb-empty-state';
      hint.textContent = 'Scroll to load more posts — product matches will appear here.';
      container.appendChild(hint);
    }
  }

  function createPostCard(matchedPost) {
    const card = document.createElement('div');
    card.className = 'ro-fb-post-card';

    // Left border color: single product = solid, two products = gradient
    if (matchedPost.products.length === 1) {
      card.style.borderLeftColor = getProductColor(matchedPost.products[0].product);
    } else if (matchedPost.products.length >= 2) {
      const c1 = getProductColor(matchedPost.products[0].product);
      const c2 = getProductColor(matchedPost.products[1].product);
      card.style.borderImage = `linear-gradient(to bottom, ${c1} 50%, ${c2} 50%) 1`;
      card.style.borderImageSlice = '1';
      card.style.borderLeftWidth = '3px';
    }

    // Author
    const authorEl = document.createElement('div');
    authorEl.className = 'ro-fb-post-card-author';
    authorEl.textContent = matchedPost.author || 'Unknown';

    // Preview text
    const previewEl = document.createElement('div');
    previewEl.className = 'ro-fb-post-card-preview';
    previewEl.textContent = matchedPost.textPreview;

    // Product badges
    const badgesEl = document.createElement('div');
    badgesEl.className = 'ro-fb-post-card-badges';
    for (const { product } of matchedPost.products) {
      const badge = document.createElement('span');
      badge.className = 'ro-fb-product-badge';
      badge.textContent = product.name;
      badge.style.backgroundColor = getProductColor(product);
      badgesEl.appendChild(badge);
    }

    card.appendChild(authorEl);
    card.appendChild(previewEl);
    card.appendChild(badgesEl);

    card.addEventListener('click', () => onPostCardClick(matchedPost));
    return card;
  }

  function onPostCardClick(matchedPost) {
    const postData = detectPostFromArticle(matchedPost.articleEl);
    if (!postData) {
      showToast('Could not extract text from this post', 'error');
      return;
    }

    currentPostData = postData;

    // Highlight article on the page
    if (selectedArticleEl) {
      selectedArticleEl.classList.remove('ro-fb-selected');
    }
    matchedPost.articleEl.classList.add('ro-fb-selected');
    selectedArticleEl = matchedPost.articleEl;

    // Auto-select product only if none manually selected
    if (selectedProjectId === 'none' && matchedPost.products.length) {
      selectedProjectId = matchedPost.products[0].product.id;
      updateProductDropdown();
    }

    // Show ready state and auto-generate with auto-insert if authenticated
    showReadyState();
    if (isAuthenticated) {
      pendingAutoInsert = true;
      handleGenerate();
    }
  }

  // --- MutationObserver for Feed ---

  function startFeedObserver() {
    const feedEl = document.querySelector(FB.feed);
    if (!feedEl) return;

    const selector = getPostSelector();
    feedObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          const articles = [];
          if (node.matches && node.matches(selector)) {
            articles.push(node);
          } else if (node.querySelectorAll) {
            articles.push(...node.querySelectorAll(selector));
          }

          for (const article of articles) {
            // Make every new post interactive (hover/click) regardless of match
            makePostInteractive(article);

            if (processedArticles.has(article)) continue;
            processedArticles.add(article);

            const postText = extractPostText(article);
            if (!postText || postText.length < 5) continue;

            const products = scorePostAgainstAllProducts(postText);
            if (!products.length) continue;

            const matchedPost = {
              articleEl: article,
              author: extractPostAuthor(article),
              textPreview: postText.length > 120 ? postText.slice(0, 120) + '...' : postText,
              fullText: postText,
              products
            };

            const container = panelEl ? panelEl.querySelector('#fb-post-list-container') : null;
            if (container) {
              // Remove empty state if present
              const emptyState = container.querySelector('.ro-fb-empty-state');
              if (emptyState) emptyState.remove();
              container.appendChild(createPostCard(matchedPost));
            }
          }
        }
      }
    });
    feedObserver.observe(feedEl, { childList: true, subtree: true });
  }

  function stopFeedObserver() {
    if (feedObserver) {
      feedObserver.disconnect();
      feedObserver = null;
    }
  }

  // --- Page-Level Post Interaction (hover / click) ---

  function enablePageInteraction() {
    const selector = getPostSelector();
    const articles = document.querySelectorAll(selector);
    articles.forEach(makePostInteractive);
  }

  function disablePageInteraction() {
    for (const [article, handler] of pageClickHandlers) {
      article.removeEventListener('click', handler, true);
      article.classList.remove('ro-fb-interactive');
    }
    pageClickHandlers.clear();
  }

  function makePostInteractive(article) {
    if (pageClickHandlers.has(article)) return;
    article.classList.add('ro-fb-interactive');

    const handler = (e) => {
      // Don't intercept clicks on interactive elements
      const interactive = e.target.closest('a, button, [role="button"], video, input, textarea, select, [contenteditable="true"]');
      if (interactive) return;

      e.preventDefault();
      e.stopPropagation();
      onPagePostClick(article);
    };

    pageClickHandlers.set(article, handler);
    article.addEventListener('click', handler, true);
  }

  function onPagePostClick(article) {
    const postData = detectPostFromArticle(article);
    if (!postData) {
      showToast('Could not extract text from this post', 'error');
      return;
    }

    currentPostData = postData;

    // Highlight article on the page
    if (selectedArticleEl) {
      selectedArticleEl.classList.remove('ro-fb-selected');
    }
    article.classList.add('ro-fb-selected');
    selectedArticleEl = article;

    // Auto-detect product only if none manually selected
    if (selectedProjectId === 'none') {
      const detected = autoDetectProduct(postData.postText);
      if (detected) {
        selectedProjectId = detected.id;
        updateProductDropdown();
      }
    }

    // Show ready state and auto-generate if authenticated
    showReadyState();
    if (isAuthenticated) {
      pendingAutoInsert = true;
      handleGenerate();
    }
  }

  // --- Auto-Insert into Comment Box ---

  function autoClickCommentAndInsert(article, text) {
    if (!article || !text) return;

    // Find the "Leave a comment" button within the article
    const commentBtn = article.querySelector('[aria-label="Leave a comment"], [aria-label="Comment"], [data-ad-rendering-role="comment_button"]');
    if (!commentBtn) {
      // Fallback: find button parent with comment_button role
      const commentRole = article.querySelector('[data-ad-rendering-role="comment_button"]');
      const btn = commentRole ? commentRole.closest('[role="button"]') : null;
      if (btn) {
        btn.click();
      } else {
        navigator.clipboard.writeText(text).then(() => {
          showToast('Comment button not found — copied to clipboard');
        });
        return;
      }
    } else {
      // Click the button (or its closest role="button" parent)
      const btn = commentBtn.closest('[role="button"]') || commentBtn;
      btn.click();
    }

    // Poll for the comment textbox to appear
    let attempts = 0;
    const poll = setInterval(() => {
      attempts++;

      // Look within the article first
      let target = findVisibleTextbox(article);

      // After a few attempts, also search page-wide (FB may render input outside article)
      if (!target && attempts > 5) {
        target = findVisibleTextbox(document);
      }

      if (target) {
        clearInterval(poll);
        target.focus();
        // Small delay to let Facebook's editor initialize
        setTimeout(() => {
          injectTextBulk(target, text);
          showToast('Draft inserted — review and submit when ready');
        }, 300);
        return;
      }

      if (attempts > 30) {
        clearInterval(poll);
        navigator.clipboard.writeText(text).then(() => {
          showToast('Comment box not found — copied to clipboard');
        });
      }
    }, 200);
  }

  function findVisibleTextbox(scope) {
    const inputs = scope.querySelectorAll('div[contenteditable="true"][role="textbox"], div[contenteditable="true"]');
    for (const input of inputs) {
      const rect = input.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return input;
    }
    return null;
  }

  function injectTextBulk(editable, text) {
    editable.focus();

    // Select all existing content and delete it
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editable);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('delete', false, null);

    // Insert text
    document.execCommand('insertText', false, text);

    // Dispatch input event so Facebook's editor picks up the change
    editable.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
  }

  // --- Panel State Helpers ---

  function showReadyState() {
    if (!panelEl) return;

    // Update header with post preview
    const titleEl = panelEl.querySelector('#fb-panel-title');
    if (titleEl && currentPostData) {
      const preview = currentPostData.postText.length > 80
        ? currentPostData.postText.slice(0, 80) + '...'
        : currentPostData.postText;
      titleEl.textContent = preview;
    }

    // Show "Back to list" button on feed pages
    const backBtn = panelEl.querySelector('#fb-back-to-list');
    if (backBtn && !isPermalinkPage()) {
      backBtn.style.display = '';
    }

    // Hide post list
    const postList = panelEl.querySelector('#fb-post-list-container');
    if (postList) postList.style.display = 'none';

    // Auth section will control visibility of project row and generate section
    // If already authenticated, show them now
    if (isAuthenticated) {
      const projectRow = panelEl.querySelector('#fb-project-row');
      const genSection = panelEl.querySelector('#fb-generate-section');
      if (projectRow) projectRow.style.display = '';
      if (genSection) genSection.style.display = '';
    }
  }

  function showListState() {
    if (!panelEl) return;

    // Reset header to group name
    const titleEl = panelEl.querySelector('#fb-panel-title');
    if (titleEl) titleEl.textContent = 'Matching Posts';

    // Hide "Back to list" button
    const backBtn = panelEl.querySelector('#fb-back-to-list');
    if (backBtn) backBtn.style.display = 'none';

    // Show post list
    const postList = panelEl.querySelector('#fb-post-list-container');
    if (postList) postList.style.display = '';

    // Hide generate controls and results
    const projectRow = panelEl.querySelector('#fb-project-row');
    const genSection = panelEl.querySelector('#fb-generate-section');
    const results = panelEl.querySelector('#fb-results');
    const footer = panelEl.querySelector('#fb-panel-footer');
    if (projectRow) projectRow.style.display = 'none';
    if (genSection) genSection.style.display = 'none';
    if (results) results.style.display = 'none';
    if (footer) footer.style.display = 'none';

    // Remove article highlight
    if (selectedArticleEl) {
      selectedArticleEl.classList.remove('ro-fb-selected');
      selectedArticleEl = null;
    }

    // Reset post data
    currentPostData = null;
    currentResponses = {};
    pendingAutoInsert = false;
  }

  // --- Panel ---

  function openPanel() {
    if (isPanelOpen) return;
    isPanelOpen = true;

    const isPermalink = isPermalinkPage();

    if (isPermalink) {
      // Permalink page: auto-detect the single main post
      currentPostData = detectCurrentPost();
      if (currentPostData) {
        const detected = autoDetectProduct(currentPostData.postText);
        if (detected) selectedProjectId = detected.id;
      }
      createPanel(isPermalink);
      createBackdrop();
    } else {
      // Feed page: show post list, no backdrop so user can scroll
      currentPostData = null;
      createPanel(false);
      // No backdrop on feed — user needs to scroll to load more posts
    }

    // Animate in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (panelEl) panelEl.classList.add('ro-visible');
        if (backdropEl) backdropEl.classList.add('ro-visible');
      });
    });

    checkAuth();

    // On feed/search pages, enable page interaction and scan posts
    if (!isPermalink) {
      enablePageInteraction();
      const matched = scanFeedPosts();
      buildPostList(matched);
      startFeedObserver();
    }
  }

  function closePanel() {
    if (!isPanelOpen) return;
    isPanelOpen = false;

    // Disconnect feed observer and page interaction
    stopFeedObserver();
    disablePageInteraction();
    processedArticles = new WeakSet();
    pendingAutoInsert = false;

    // Remove article highlight
    if (selectedArticleEl) {
      selectedArticleEl.classList.remove('ro-fb-selected');
      selectedArticleEl = null;
    }

    if (panelEl) {
      panelEl.classList.remove('ro-visible');
      setTimeout(() => {
        if (panelEl) { panelEl.remove(); panelEl = null; }
      }, 300);
    }
    if (backdropEl) {
      backdropEl.classList.remove('ro-visible');
      setTimeout(() => {
        if (backdropEl) { backdropEl.remove(); backdropEl = null; }
      }, 300);
    }

    isGenerating = false;
    currentResponses = {};
  }

  function createBackdrop() {
    backdropEl = document.createElement('div');
    backdropEl.className = 'ro-backdrop';
    backdropEl.addEventListener('click', closePanel);
    document.body.appendChild(backdropEl);
  }

  function createPanel(isPermalink) {
    panelEl = document.createElement('div');
    panelEl.className = 'ro-panel';

    const groupLabel = currentPostData ? currentPostData.groupName : extractGroupName() || 'Facebook Group';
    const showReady = isPermalink && currentPostData;

    const postPreview = currentPostData
      ? (currentPostData.postText.length > 80
        ? currentPostData.postText.slice(0, 80) + '...'
        : currentPostData.postText)
      : '';

    const headerTitle = showReady
      ? escapeHtml(postPreview)
      : 'Matching Posts';

    panelEl.innerHTML = `
      <div class="ro-panel-header">
        <div class="ro-panel-header-text">
          <div class="ro-panel-subreddit">${escapeHtml(groupLabel)}</div>
          <div class="ro-panel-title" id="fb-panel-title">${headerTitle}</div>
          <button class="ro-fb-back-to-list" id="fb-back-to-list" style="display:none">Back to list</button>
        </div>
        <div class="ro-credits-badge" id="fb-credits-badge" style="display:none">
          <span class="ro-credits-icon">&bull;</span>
          <span id="fb-credits-count">—</span>
        </div>
        <button class="ro-close-btn" id="fb-close-btn" aria-label="Close panel">&times;</button>
      </div>
      <div class="ro-panel-body" id="fb-panel-body">
        <div id="fb-post-list-container" class="ro-fb-post-list" style="display:${showReady ? 'none' : ''}">
          <!-- Post cards rendered here by buildPostList() -->
        </div>
        <div id="fb-auth-section"></div>
        <div class="ro-project-row" id="fb-project-row" style="display:none">
          <span>Product:</span>
          <select class="ro-project-select" id="fb-project-select"></select>
          <button class="ro-add-product-btn" id="fb-add-product-btn" title="Quick-add product">+</button>
        </div>
        <div id="fb-quick-add-container"></div>
        <div id="fb-generate-section" style="display:none">
          <button class="ro-btn ro-btn-primary" id="fb-generate-btn" style="width:100%">
            Generate Comments
          </button>
        </div>
        <div id="fb-loading" class="ro-loading-state" style="display:none">
          <div class="ro-spinner"></div>
          <div>Generating 5 tones...</div>
        </div>
        <div id="fb-results" style="display:none">
          <div class="ro-tone-tabs" id="fb-tone-tabs"></div>
          <textarea class="ro-textarea" id="fb-textarea" rows="6"></textarea>
          <div class="ro-char-count"><span id="fb-char-count">0</span> chars</div>
        </div>
      </div>
      <div class="ro-panel-footer" id="fb-panel-footer" style="display:none">
        <button class="ro-btn ro-btn-secondary" id="fb-copy-btn">Copy</button>
        <button class="ro-btn ro-btn-primary" id="fb-insert-btn">Insert Comment</button>
      </div>
    `;

    document.body.appendChild(panelEl);
    bindPanelEvents();
    updateProductDropdown();

    // If permalink page with post ready, show generate controls immediately
    if (showReady) {
      showReadyState();
    }
  }

  function bindPanelEvents() {
    // Close button
    panelEl.querySelector('#fb-close-btn').addEventListener('click', closePanel);

    // Generate button
    panelEl.querySelector('#fb-generate-btn').addEventListener('click', handleGenerate);

    // Copy button
    panelEl.querySelector('#fb-copy-btn').addEventListener('click', () => {
      const textarea = panelEl.querySelector('#fb-textarea');
      navigator.clipboard.writeText(textarea.value).then(() => {
        showToast('Copied to clipboard');
      }).catch(() => {
        showToast('Failed to copy', 'error');
      });
    });

    // Insert button
    panelEl.querySelector('#fb-insert-btn').addEventListener('click', () => {
      const textarea = panelEl.querySelector('#fb-textarea');
      insertComment(textarea.value);
    });

    // Back to list button (return to post list from ready state)
    panelEl.querySelector('#fb-back-to-list').addEventListener('click', () => {
      showListState();
    });

    // Product dropdown change
    panelEl.querySelector('#fb-project-select').addEventListener('change', (e) => {
      selectedProjectId = e.target.value;
      chrome.storage.local.set({ ro_project: selectedProjectId });
    });

    // Quick-add product button
    panelEl.querySelector('#fb-add-product-btn').addEventListener('click', toggleQuickAddForm);

    // Textarea char count
    panelEl.querySelector('#fb-textarea').addEventListener('input', (e) => {
      panelEl.querySelector('#fb-char-count').textContent = e.target.value.length;
    });
  }

  // --- Auth Check ---

  function checkAuth() {
    chrome.runtime.sendMessage({ type: 'CHECK_AUTH' }, (response) => {
      if (chrome.runtime.lastError) {
        showAuthSection(false);
        return;
      }
      authChecked = true;
      isAuthenticated = !!(response && response.authenticated);
      showAuthSection(isAuthenticated, response);

      if (isAuthenticated && response.credits) {
        updateCreditsDisplay(response.credits.available);
      }
    });
  }

  function showAuthSection(authenticated, response) {
    const authEl = panelEl.querySelector('#fb-auth-section');
    const projectRow = panelEl.querySelector('#fb-project-row');
    const generateSection = panelEl.querySelector('#fb-generate-section');

    if (authenticated) {
      authEl.innerHTML = '';
      // Only show generate controls if we have a post selected (or on permalink pages)
      if (currentPostData) {
        projectRow.style.display = '';
        generateSection.style.display = '';
      }
    } else {
      authEl.innerHTML = `
        <div style="text-align:center;padding:20px 0">
          <div style="font-size:14px;font-weight:600;margin-bottom:8px">Sign in to generate comments</div>
          <button class="ro-btn ro-btn-primary" id="fb-sign-in-btn" style="width:100%">Sign in with Google</button>
        </div>
      `;
      projectRow.style.display = 'none';
      generateSection.style.display = 'none';

      authEl.querySelector('#fb-sign-in-btn').addEventListener('click', () => {
        const btn = authEl.querySelector('#fb-sign-in-btn');
        btn.disabled = true;
        btn.textContent = 'Signing in...';
        chrome.runtime.sendMessage({ type: 'SIGN_IN' }, (result) => {
          if (result && result.success) {
            isAuthenticated = true;
            showAuthSection(true, result);
            if (result.credits) updateCreditsDisplay(result.credits.available);
          } else {
            btn.textContent = 'Sign in failed — retry';
            btn.disabled = false;
          }
        });
      });
    }
  }

  function updateCreditsDisplay(available) {
    const badge = panelEl.querySelector('#fb-credits-badge');
    const count = panelEl.querySelector('#fb-credits-count');
    if (!badge || !count) return;
    badge.style.display = '';
    count.textContent = available;

    badge.classList.remove('ro-credits-low', 'ro-credits-zero');
    if (available <= 0) badge.classList.add('ro-credits-zero');
    else if (available <= 5) badge.classList.add('ro-credits-low');
  }

  // --- Product Dropdown ---

  function updateProductDropdown() {
    const select = panelEl ? panelEl.querySelector('#fb-project-select') : null;
    if (!select) return;

    select.innerHTML = '<option value="none">No Product</option>';
    for (const p of productsCache) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === selectedProjectId) opt.selected = true;
      select.appendChild(opt);
    }
  }

  // --- Quick-Add Product Form ---

  function toggleQuickAddForm() {
    const container = panelEl.querySelector('#fb-quick-add-container');
    if (container.querySelector('.ro-quick-add-form')) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <div class="ro-quick-add-form">
        <div class="ro-quick-add-title">Quick-Add Product</div>
        <div class="ro-quick-add-field">
          <label>Name <span class="ro-required">*</span></label>
          <input type="text" id="fb-qa-name" placeholder="Product name" maxlength="100" />
        </div>
        <div class="ro-quick-add-field">
          <label>Link</label>
          <input type="text" id="fb-qa-link" placeholder="https://..." maxlength="500" />
        </div>
        <div class="ro-quick-add-field">
          <label>Features <span class="ro-required">*</span></label>
          <textarea id="fb-qa-features" placeholder="What does it do?" maxlength="2000" rows="3"></textarea>
        </div>
        <div class="ro-quick-add-actions">
          <button class="ro-btn ro-btn-secondary" id="fb-qa-cancel">Cancel</button>
          <button class="ro-btn ro-btn-primary" id="fb-qa-save" disabled>Save (1 credit)</button>
        </div>
        <div class="ro-quick-add-error" id="fb-qa-error"></div>
      </div>
    `;

    const nameInput = container.querySelector('#fb-qa-name');
    const featuresInput = container.querySelector('#fb-qa-features');
    const saveBtn = container.querySelector('#fb-qa-save');
    const cancelBtn = container.querySelector('#fb-qa-cancel');
    const errorEl = container.querySelector('#fb-qa-error');

    function updateSaveState() {
      saveBtn.disabled = !(nameInput.value.trim() && featuresInput.value.trim().length >= 10);
    }
    nameInput.addEventListener('input', updateSaveState);
    featuresInput.addEventListener('input', updateSaveState);

    cancelBtn.addEventListener('click', () => { container.innerHTML = ''; });

    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      errorEl.textContent = '';

      try {
        const creditResult = await chrome.runtime.sendMessage({ type: 'USE_PRODUCT_CREDIT' });
        if (!creditResult.success) {
          errorEl.textContent = creditResult.error === 'insufficient_credits'
            ? 'Not enough credits'
            : 'Failed to verify credits';
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save (1 credit)';
          return;
        }

        const newProduct = {
          id: 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
          name: nameInput.value.trim().slice(0, 100),
          link: container.querySelector('#fb-qa-link').value.trim().slice(0, 500),
          features: featuresInput.value.trim().slice(0, 2000),
          benefits: '',
          scenarios: '',
          subreddits: [],
          keywords: []
        };

        productsCache.push(newProduct);
        await chrome.storage.local.set({ marketeer_products: productsCache });

        selectedProjectId = newProduct.id;
        chrome.storage.local.set({ ro_project: selectedProjectId });
        updateProductDropdown();
        updateCreditsDisplay(creditResult.creditsRemaining);

        container.innerHTML = '';
        showToast('Product added');
      } catch (err) {
        errorEl.textContent = 'Failed to save product';
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save (1 credit)';
      }
    });
  }

  // --- Generation Flow ---

  async function handleGenerate() {
    if (isGenerating) return;

    if (!currentPostData) {
      currentPostData = detectCurrentPost();
    }
    if (!currentPostData) {
      showToast('Could not detect post content on this page', 'error');
      return;
    }

    // Get selected product
    const product = productsCache.find(p => p.id === selectedProjectId) || null;

    isGenerating = true;
    showLoading(true);
    showResults(false);

    const genBtn = panelEl ? panelEl.querySelector('#fb-generate-btn') : null;
    if (genBtn) {
      genBtn.disabled = true;
      genBtn.textContent = 'Generating...';
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GENERATE_ALL_FACEBOOK',
        postData: currentPostData,
        projectId: selectedProjectId,
        product: product
      });

      if (response.error) {
        throw new Error(response.error);
      }

      currentResponses = response.responses;
      activeTab = 'friendly';
      showResults(true);
      buildToneTabs();
      displayTone(activeTab);

      // Refresh credits
      chrome.runtime.sendMessage({ type: 'CHECK_CREDITS' }, (resp) => {
        if (resp && resp.success && resp.credits) {
          updateCreditsDisplay(resp.credits.available);
        }
      });

      // Auto-insert into the comment box if triggered from page click
      if (pendingAutoInsert && selectedArticleEl) {
        pendingAutoInsert = false;
        const text = currentResponses['friendly'] || currentResponses[Object.keys(currentResponses)[0]] || '';
        if (text) {
          autoClickCommentAndInsert(selectedArticleEl, text);
        }
      }
    } catch (err) {
      pendingAutoInsert = false;
      showToast(err.message || 'Generation failed', 'error');
    } finally {
      isGenerating = false;
      showLoading(false);
      if (genBtn) {
        genBtn.disabled = false;
        genBtn.textContent = 'Generate Comments';
      }
    }
  }

  function showLoading(show) {
    const el = panelEl.querySelector('#fb-loading');
    if (el) el.style.display = show ? '' : 'none';
  }

  function showResults(show) {
    const results = panelEl.querySelector('#fb-results');
    const footer = panelEl.querySelector('#fb-panel-footer');
    if (results) results.style.display = show ? '' : 'none';
    if (footer) footer.style.display = show ? '' : 'none';
  }

  function buildToneTabs() {
    const tabsEl = panelEl.querySelector('#fb-tone-tabs');
    tabsEl.innerHTML = '';

    for (const tone of CONFIG.TONES) {
      const tab = document.createElement('button');
      tab.className = 'ro-tone-tab' + (tone === activeTab ? ' ro-active' : '');
      tab.textContent = CONFIG.TONE_LABELS[tone] || tone;
      tab.addEventListener('click', () => {
        activeTab = tone;
        tabsEl.querySelectorAll('.ro-tone-tab').forEach(t => t.classList.remove('ro-active'));
        tab.classList.add('ro-active');
        displayTone(tone);
      });
      tabsEl.appendChild(tab);
    }
  }

  function displayTone(tone) {
    const textarea = panelEl.querySelector('#fb-textarea');
    const text = currentResponses[tone] || '';
    textarea.value = text;
    panelEl.querySelector('#fb-char-count').textContent = text.length;

    // Auto-resize textarea
    textarea.style.height = 'auto';
    textarea.style.height = Math.max(120, textarea.scrollHeight) + 'px';
  }

  // --- Comment Insertion ---

  function insertComment(text) {
    if (!text) {
      showToast('No text to insert', 'error');
      return;
    }

    // Find all visible comment inputs on the page
    const inputs = document.querySelectorAll(
      'div[contenteditable="true"][role="textbox"]'
    );

    // Find the one that looks like a comment box (visible, non-zero dimensions)
    let target = null;
    for (const input of inputs) {
      const rect = input.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        // Prefer inputs that have data-lexical-editor (Lexical-based)
        if (input.hasAttribute('data-lexical-editor')) {
          target = input;
          break;
        }
        if (!target) target = input;
      }
    }

    if (!target) {
      // Try clicking a "Write a comment" or comment button to open the input
      const commentBtn = document.querySelector(
        '[aria-label*="comment" i], [aria-label*="Comment" i], [aria-label*="Write a comment" i]'
      );
      if (commentBtn) {
        commentBtn.click();
        // Poll for the input to appear
        let attempts = 0;
        const poll = setInterval(() => {
          attempts++;
          const newInputs = document.querySelectorAll('div[contenteditable="true"][role="textbox"]');
          for (const input of newInputs) {
            const rect = input.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              clearInterval(poll);
              closePanel();
              typeTextIntoEditor(input, text);
              return;
            }
          }
          if (attempts > 20) {
            clearInterval(poll);
            // Fallback: copy to clipboard
            navigator.clipboard.writeText(text).then(() => {
              showToast('Comment box not found — copied to clipboard');
            });
          }
        }, 200);
        return;
      }

      // No comment button found either — copy to clipboard
      navigator.clipboard.writeText(text).then(() => {
        showToast('Comment box not found — copied to clipboard');
      });
      return;
    }

    closePanel();
    typeTextIntoEditor(target, text);
  }

  async function typeTextIntoEditor(element, text) {
    element.click();
    element.focus();

    // Clear existing content
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('delete', false, null);

    // Type character by character (human-like simulation)
    for (let i = 0; i < text.length; i++) {
      if (document.hidden) {
        // Tab lost focus — insert remaining text in bulk
        document.execCommand('insertText', false, text.slice(i));
        showToast('Draft inserted — review and submit when ready');
        return;
      }

      const char = text[i];
      if (char === '\n') {
        document.execCommand('insertParagraph', false, null);
      } else {
        document.execCommand('insertText', false, char);
      }

      // Randomized delay
      let delay = 10 + Math.random() * 20;
      if (char === ' ') delay += 5 + Math.random() * 15;
      if ('.!?'.includes(char)) delay += 30 + Math.random() * 50;
      if (char === '\n') delay += 40 + Math.random() * 60;

      await new Promise(r => setTimeout(r, delay));
    }

    // Verify insertion worked
    if (element.textContent.trim().length === 0) {
      // Typing failed — try bulk insertion fallback
      insertTextBulk(element, text);
    }

    showToast('Draft inserted — review and submit when ready');
  }

  function insertTextBulk(editable, text) {
    editable.click();
    editable.focus();

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editable);
    selection.removeAllRanges();
    selection.addRange(range);

    // Try paste simulation
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true, cancelable: true, composed: true,
        clipboardData: dt
      });
      editable.dispatchEvent(pasteEvent);
      if (editable.textContent.trim().length > 0) return;
    } catch (e) {}

    // Try beforeinput
    try {
      const dt2 = new DataTransfer();
      dt2.setData('text/plain', text);
      const inputEvent = new InputEvent('beforeinput', {
        inputType: 'insertFromPaste', data: text, dataTransfer: dt2,
        bubbles: true, cancelable: true, composed: true
      });
      editable.dispatchEvent(inputEvent);
      if (editable.textContent.trim().length > 0) return;
    } catch (e) {}

    // Last resort: execCommand selectAll + insertText
    editable.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, text);
  }

  // --- Toast Notifications ---

  function showToast(message, type) {
    if (toastEl) toastEl.remove();

    toastEl = document.createElement('div');
    toastEl.className = 'ro-toast' + (type === 'error' ? ' ro-error' : ' ro-success');
    toastEl.textContent = message;
    document.body.appendChild(toastEl);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        toastEl.classList.add('ro-visible');
      });
    });

    setTimeout(() => {
      if (toastEl) {
        toastEl.classList.remove('ro-visible');
        setTimeout(() => {
          if (toastEl) { toastEl.remove(); toastEl = null; }
        }, 300);
      }
    }, 3000);
  }

  // --- Utility ---

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // --- Start ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
