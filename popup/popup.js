/**
 * Marketeer Popup Script
 * Account tab + Products tab with full CRUD
 */

document.addEventListener('DOMContentLoaded', async () => {
  // --- Tab switching ---
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      tabBtns.forEach(b => b.classList.toggle('active', b === btn));
      tabContents.forEach(tc => tc.classList.toggle('active', tc.id === 'tab-' + tab));
    });
  });

  // --- Account Tab ---
  const loggedInEl = document.getElementById('logged-in');
  const loggedOutEl = document.getElementById('logged-out');
  const creditCount = document.getElementById('credit-count');
  const userName = document.getElementById('user-name');
  const userEmail = document.getElementById('user-email');
  const userAvatar = document.getElementById('user-avatar');
  const signInBtn = document.getElementById('sign-in');
  const signOutBtn = document.getElementById('sign-out');
  const buyCreditsBtn = document.getElementById('buy-credits');
  const creditsWarning = document.getElementById('credits-warning');
  const versionEl = document.getElementById('version');

  // Show version
  const manifest = chrome.runtime.getManifest();
  versionEl.textContent = 'v' + manifest.version;

  // Debug icon loading
  const headerIcon = document.querySelector('.header-icon');
  if (headerIcon) {
    console.log('[Marketeer Popup] Icon src:', headerIcon.src);
    headerIcon.addEventListener('load', () => console.log('[Marketeer Popup] Icon loaded OK'));
    headerIcon.addEventListener('error', () => console.error('[Marketeer Popup] Icon FAILED to load:', headerIcon.src));
  }

  // --- Header credits display ---
  const headerCredits = document.getElementById('header-credits');
  const headerCreditCount = document.getElementById('header-credit-count');
  let currentCreditsAvailable = 0;

  function updateHeaderCredits(available) {
    currentCreditsAvailable = available;
    headerCreditCount.textContent = available;
    headerCredits.classList.remove('hidden');
  }

  // Check auth status via background
  let authStatus;
  try {
    console.log('[Marketeer Popup] Sending CHECK_AUTH...');
    authStatus = await chrome.runtime.sendMessage({ type: 'CHECK_AUTH' });
    console.log('[Marketeer Popup] CHECK_AUTH result:', JSON.stringify(authStatus));
  } catch (error) {
    console.warn('[Marketeer Popup] CHECK_AUTH failed, falling back to storage:', error.message);
    const stored = await chrome.storage.local.get(['marketeer_user', 'marketeer_token', 'marketeer_credits']);
    authStatus = {
      authenticated: !!(stored.marketeer_user && stored.marketeer_token),
      user: stored.marketeer_user,
      credits: stored.marketeer_credits
    };
  }

  const productsLoginRequired = document.getElementById('products-login-required');
  const productsContent = document.getElementById('products-content');
  const productsSignInBtn = document.getElementById('products-sign-in');

  if (authStatus && authStatus.authenticated) {
    console.log('[Marketeer Popup] User authenticated:', authStatus.user?.email);
    showLoggedIn(authStatus.user, authStatus.credits);
  } else {
    console.log('[Marketeer Popup] User NOT authenticated, showing sign-in');
    showLoggedOut();
  }

  function updateProductsAccess(authenticated) {
    if (authenticated) {
      productsLoginRequired.classList.add('hidden');
      productsContent.classList.remove('hidden');
    } else {
      productsLoginRequired.classList.remove('hidden');
      productsContent.classList.add('hidden');
    }
  }

  function showLoggedIn(user, credits) {
    loggedInEl.classList.remove('hidden');
    loggedOutEl.classList.add('hidden');
    updateProductsAccess(true);

    if (user) {
      userName.textContent = user.name || '';
      userEmail.textContent = user.email || '';
      if (user.picture) {
        userAvatar.src = user.picture;
      }
    }

    if (credits && credits.available !== undefined) {
      creditCount.textContent = credits.available;
      updateCreditsWarning(credits.available);
      updateHeaderCredits(credits.available);
    }

    // Fetch fresh credits
    chrome.runtime.sendMessage({ type: 'CHECK_CREDITS' }).then(resp => {
      if (resp && resp.success && resp.credits) {
        creditCount.textContent = resp.credits.available;
        updateCreditsWarning(resp.credits.available);
        updateHeaderCredits(resp.credits.available);
      }
    }).catch(() => {});
  }

  function updateCreditsWarning(available) {
    if (available <= 0) {
      creditsWarning.textContent = 'No credits remaining. Purchase more to generate comments.';
      creditsWarning.classList.remove('hidden');
    } else if (available <= 5) {
      creditsWarning.textContent = 'Low credits (' + available + ' remaining).';
      creditsWarning.classList.remove('hidden');
    } else {
      creditsWarning.classList.add('hidden');
    }
  }

  function showLoggedOut() {
    loggedInEl.classList.add('hidden');
    loggedOutEl.classList.remove('hidden');
    updateProductsAccess(false);
    headerCredits.classList.add('hidden');
  }

  // Sign in
  signInBtn.addEventListener('click', async () => {
    console.log('[Marketeer Popup] Sign-in button clicked');
    signInBtn.disabled = true;
    signInBtn.textContent = 'Signing in...';
    try {
      console.log('[Marketeer Popup] Sending SIGN_IN to service worker...');
      const result = await chrome.runtime.sendMessage({ type: 'SIGN_IN' });
      console.log('[Marketeer Popup] SIGN_IN result:', JSON.stringify(result));
      if (result && result.success) {
        showLoggedIn(result.user, result.credits);
      } else {
        console.error('[Marketeer Popup] Sign-in failed:', result?.error || 'unknown');
        signInBtn.textContent = 'Sign in failed — retry';
        signInBtn.disabled = false;
      }
    } catch (err) {
      console.error('[Marketeer Popup] Sign-in exception:', err.message || err);
      signInBtn.textContent = 'Sign in failed — retry';
      signInBtn.disabled = false;
    }
  });

  // Sign in from Products tab
  productsSignInBtn.addEventListener('click', async () => {
    productsSignInBtn.disabled = true;
    productsSignInBtn.textContent = 'Signing in...';
    try {
      const result = await chrome.runtime.sendMessage({ type: 'SIGN_IN' });
      if (result && result.success) {
        showLoggedIn(result.user, result.credits);
      } else {
        productsSignInBtn.textContent = 'Sign in failed — retry';
        productsSignInBtn.disabled = false;
      }
    } catch (err) {
      productsSignInBtn.textContent = 'Sign in failed — retry';
      productsSignInBtn.disabled = false;
    }
  });

  // Sign out
  signOutBtn.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'SIGN_OUT' });
    showLoggedOut();
  });

  // Buy credits
  buyCreditsBtn.addEventListener('click', async () => {
    const result = await chrome.runtime.sendMessage({ type: 'BUY_CREDITS' });
    if (result && result.checkoutUrl) {
      chrome.tabs.create({ url: result.checkoutUrl });
      window.close();
    }
  });

  // Open panel on current Reddit page
  const openPanelBtn = document.getElementById('open-panel-btn');
  console.log('[Marketeer Popup] openPanelBtn element:', openPanelBtn);
  openPanelBtn.addEventListener('click', async () => {
    console.log('[Marketeer Popup] Open Panel button clicked');
    openPanelBtn.disabled = true;
    openPanelBtn.textContent = 'Opening...';
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      console.log('[Marketeer Popup] Active tab:', tab?.id, tab?.url?.slice(0, 80));
      const isReddit = tab && tab.url && (tab.url.match(/reddit\.com\/r\/\w+\/(comments|submit)\//) || tab.url.match(/reddit\.com\/submit/));
      const isFacebookGroup = tab && tab.url && tab.url.match(/facebook\.com\/groups\//);
      if (!isReddit && !isFacebookGroup) {
        console.log('[Marketeer Popup] Not a supported page');
        openPanelBtn.textContent = 'Navigate to a Reddit post or Facebook Group';
        setTimeout(() => {
          openPanelBtn.textContent = 'Open Panel on This Page';
          openPanelBtn.disabled = false;
        }, 2000);
        return;
      }
      console.log('[Marketeer Popup] Sending OPEN_PANEL to tab', tab.id);
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_PANEL' });
      console.log('[Marketeer Popup] OPEN_PANEL response:', response);
      if (response && response.success) {
        window.close();
      } else {
        const msg = response?.error === 'already_open' ? 'Panel is already open'
          : response?.error === 'not_post_page' ? 'Navigate to a Reddit post or submit page'
          : 'Could not open panel';
        openPanelBtn.textContent = msg;
        setTimeout(() => {
          openPanelBtn.textContent = 'Open Panel on This Page';
          openPanelBtn.disabled = false;
        }, 2000);
      }
    } catch (err) {
      console.error('[Marketeer Popup] Open Panel error:', err.message || err);
      openPanelBtn.textContent = 'Not on a supported page';
      setTimeout(() => {
        openPanelBtn.textContent = 'Open Panel on This Page';
        openPanelBtn.disabled = false;
      }, 2000);
    }
  });

  // Search for Opportunities button
  const searchBtn = document.getElementById('search-btn');
  searchBtn.addEventListener('click', async () => {
    searchBtn.disabled = true;
    searchBtn.textContent = 'Opening...';
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url || !tab.url.includes('reddit.com')) {
        // Not on Reddit — open Reddit first
        chrome.tabs.create({ url: 'https://www.reddit.com/' }, (newTab) => {
          // Wait for page to load then send message
          chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
            if (tabId === newTab.id && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              setTimeout(() => {
                chrome.tabs.sendMessage(newTab.id, { type: 'OPEN_PANEL_SEARCH' }).catch(() => {});
              }, 1000);
            }
          });
        });
        window.close();
        return;
      }
      // Already on Reddit — send message to content script
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_PANEL_SEARCH' });
      if (response && response.success) {
        window.close();
      } else {
        searchBtn.textContent = 'Could not open search panel';
        setTimeout(() => {
          searchBtn.textContent = 'Search for Opportunities';
          searchBtn.disabled = false;
        }, 2000);
      }
    } catch (err) {
      // Content script may not be loaded — open Reddit
      chrome.tabs.create({ url: 'https://www.reddit.com/' });
      window.close();
    }
  });

  // Footer links
  document.getElementById('privacy-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('docs/privacy-policy.html') });
    window.close();
  });

  document.getElementById('terms-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('docs/terms-of-service.html') });
    window.close();
  });

  // --- Products Tab ---
  const BASE_PRODUCT_LIMIT = 20;
  let productLimit = BASE_PRODUCT_LIMIT;
  let products = [];
  const expandLimitBtn = document.getElementById('expand-limit-btn');

  const productList = document.getElementById('product-list');
  const productCountEl = document.getElementById('product-count');
  const addProductBtn = document.getElementById('add-product-btn');
  const productForm = document.getElementById('product-form');
  const formTitle = document.getElementById('form-title');
  const editProductId = document.getElementById('edit-product-id');
  const saveProductBtn = document.getElementById('save-product-btn');
  const cancelProductBtn = document.getElementById('cancel-product-btn');
  const formStatus = document.getElementById('form-status');

  const productsStatus = document.getElementById('products-status');
  const aiFieldsSection = document.getElementById('ai-fields-section');
  const aiGenerateRow = document.getElementById('ai-generate-row');
  const generateMetaBtn = document.getElementById('generate-meta-btn');
  const regenerateMetaBtn = document.getElementById('regenerate-meta-btn');
  let isEditMode = false;

  const fields = {
    name: document.getElementById('p-name'),
    link: document.getElementById('p-link'),
    features: document.getElementById('p-features'),
    benefits: document.getElementById('p-benefits'),
    scenarios: document.getElementById('p-scenarios'),
    subreddits: document.getElementById('p-subreddits'),
    keywords: document.getElementById('p-keywords'),
    concepts: document.getElementById('p-concepts')
  };

  const counters = {
    name: { el: document.getElementById('p-name-count'), max: 100 },
    link: { el: document.getElementById('p-link-count'), max: 500 },
    features: { el: document.getElementById('p-features-count'), max: 2000 },
    benefits: { el: document.getElementById('p-benefits-count'), max: 1000 },
    scenarios: { el: document.getElementById('p-scenarios-count'), max: 1000 }
  };

  // Wire up char counters
  Object.keys(counters).forEach(key => {
    fields[key].addEventListener('input', () => {
      const len = fields[key].value.length;
      const c = counters[key];
      c.el.textContent = len;
      c.el.parentElement.classList.toggle('over', len > c.max);
    });
  });

  // Enable save when required fields are filled
  function updateSaveBtnState() {
    const hasName = fields.name.value.trim().length > 0;
    const hasFeatures = fields.features.value.trim().length >= 10;
    saveProductBtn.disabled = !(hasName && hasFeatures);
  }
  fields.name.addEventListener('input', updateSaveBtnState);
  fields.features.addEventListener('input', updateSaveBtnState);

  // Load products and product limit
  chrome.storage.local.get(['marketeer_products', 'marketeer_product_limit'], (result) => {
    products = result.marketeer_products || [];
    productLimit = result.marketeer_product_limit || BASE_PRODUCT_LIMIT;
    renderProductList();
  });

  // Sync if changed elsewhere (options page, other popup instance)
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      if (changes.marketeer_products) {
        products = changes.marketeer_products.newValue || [];
        renderProductList();
      }
      if (changes.marketeer_product_limit) {
        productLimit = changes.marketeer_product_limit.newValue || BASE_PRODUCT_LIMIT;
        renderProductList();
      }
    }
  });

  function renderProductList() {
    const atLimit = products.length >= productLimit;

    if (products.length === 0) {
      productList.innerHTML = '<div class="empty-state">No products yet. Add one to get started.</div>';
      productCountEl.textContent = '';
      addProductBtn.disabled = false;
      expandLimitBtn.classList.add('hidden');
      return;
    }

    productCountEl.textContent = products.length + '/' + productLimit + ' products';
    addProductBtn.disabled = atLimit;

    // Show expand button when at or near limit
    if (atLimit) {
      expandLimitBtn.classList.remove('hidden');
    } else {
      expandLimitBtn.classList.add('hidden');
    }

    productList.innerHTML = products.map(p => {
      const meta = [];
      if (p.link) meta.push('has link');
      if (p.subreddits && p.subreddits.length) meta.push(p.subreddits.length + ' sub' + (p.subreddits.length > 1 ? 's' : ''));
      if (p.keywords && p.keywords.length) meta.push(p.keywords.length + ' kw' + (p.keywords.length > 1 ? 's' : ''));
      return `
        <div class="product-card" data-id="${p.id}">
          <div class="product-card-info">
            <div class="product-card-name">${escapeHtml(p.name)}</div>
            <div class="product-card-meta">${meta.join(' · ') || 'No metadata'}</div>
          </div>
          <div class="product-card-actions">
            <button class="btn-small btn-edit edit-btn" data-id="${p.id}">Edit</button>
            <button class="btn-small btn-danger delete-btn" data-id="${p.id}">Del</button>
          </div>
        </div>
      `;
    }).join('');

    productList.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', () => openEditForm(btn.dataset.id));
    });
    productList.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteProduct(btn.dataset.id));
    });
  }

  // Add product (with credit check)
  addProductBtn.addEventListener('click', () => {
    if (products.length >= productLimit) {
      showProductsStatus('Product limit reached. Expand your limit below.', true);
      return;
    }
    if (currentCreditsAvailable < 1) {
      showProductsStatus('Need at least 1 credit to add a product. Buy credits first.', true);
      return;
    }
    clearForm();
    isEditMode = false;
    formTitle.textContent = 'Add Product (1 credit)';
    editProductId.value = '';
    aiFieldsSection.classList.remove('show');
    aiGenerateRow.classList.remove('hidden');
    saveProductBtn.disabled = true;
    productForm.classList.add('show');
    fields.name.focus();
  });

  // Cancel
  cancelProductBtn.addEventListener('click', () => {
    productForm.classList.remove('show');
    clearForm();
  });

  // Edit
  function openEditForm(id) {
    const p = products.find(x => x.id === id);
    if (!p) return;

    isEditMode = true;
    formTitle.textContent = 'Edit Product';
    editProductId.value = id;
    fields.name.value = p.name || '';
    fields.link.value = p.link || '';
    fields.features.value = p.features || '';
    fields.benefits.value = p.benefits || '';
    fields.scenarios.value = p.scenarios || '';
    fields.subreddits.value = (p.subreddits || []).join(', ');
    fields.keywords.value = (p.keywords || []).join(', ');
    fields.concepts.value = (p.concepts || []).join(', ');

    // Update counters
    Object.keys(counters).forEach(key => {
      counters[key].el.textContent = fields[key].value.length;
    });

    // Edit mode: show all fields, enable save, show Generate as Regenerate
    aiFieldsSection.classList.add('show');
    aiGenerateRow.classList.remove('hidden');
    generateMetaBtn.textContent = 'Regenerate with AI';
    saveProductBtn.disabled = false;

    productForm.classList.add('show');
    fields.name.focus();
  }

  // Save (deduct 1 credit for new products, free for edits)
  saveProductBtn.addEventListener('click', async () => {
    const name = fields.name.value.trim();
    const features = fields.features.value.trim();

    if (!name) {
      showFormStatus('Product name is required', true);
      return;
    }
    if (!features) {
      showFormStatus('Features / description is required', true);
      return;
    }

    const product = {
      id: editProductId.value || generateId(),
      name: name.slice(0, 100),
      link: fields.link.value.trim().slice(0, 500),
      features: features.slice(0, 2000),
      benefits: fields.benefits.value.trim().slice(0, 1000),
      scenarios: fields.scenarios.value.trim().slice(0, 1000),
      subreddits: parseCommaSep(fields.subreddits.value),
      keywords: parseCommaSep(fields.keywords.value),
      concepts: parseCommaSep(fields.concepts.value).slice(0, 20)
    };

    const isNew = !editProductId.value;

    if (isNew) {
      if (products.length >= productLimit) {
        showFormStatus('Product limit reached. Expand your limit.', true);
        return;
      }

      // Deduct 1 credit for new product
      saveProductBtn.disabled = true;
      saveProductBtn.textContent = 'Saving...';
      try {
        const creditResult = await chrome.runtime.sendMessage({
          type: 'USE_PRODUCT_CREDIT'
        });
        if (!creditResult.success) {
          if (creditResult.error === 'insufficient_credits') {
            showFormStatus('Not enough credits (' + (creditResult.creditsRemaining || 0) + ' remaining). Buy more credits.', true);
          } else {
            showFormStatus('Failed to verify credits. Please try again.', true);
          }
          saveProductBtn.disabled = false;
          saveProductBtn.textContent = 'Save';
          return;
        }
        // Update local credit display
        updateHeaderCredits(creditResult.creditsRemaining);
        creditCount.textContent = creditResult.creditsRemaining;
        updateCreditsWarning(creditResult.creditsRemaining);
      } catch (err) {
        showFormStatus('Failed to deduct credit. Try again.', true);
        saveProductBtn.disabled = false;
        saveProductBtn.textContent = 'Save';
        return;
      }

      products.push(product);
    } else {
      // Edit existing — free
      const idx = products.findIndex(p => p.id === editProductId.value);
      if (idx !== -1) products[idx] = product;
    }

    chrome.storage.local.set({ marketeer_products: products }, () => {
      productForm.classList.remove('show');
      clearForm();
      renderProductList();
    });
  });

  // Delete
  function deleteProduct(id) {
    const p = products.find(x => x.id === id);
    if (!p) return;
    if (!confirm('Delete "' + p.name + '"?')) return;

    products = products.filter(x => x.id !== id);
    chrome.storage.local.set({ marketeer_products: products }, () => {
      renderProductList();
    });
  }

  function clearForm() {
    Object.values(fields).forEach(f => { f.value = ''; });
    Object.keys(counters).forEach(key => {
      counters[key].el.textContent = '0';
      counters[key].el.parentElement.classList.remove('over');
    });
    editProductId.value = '';
    formStatus.classList.remove('show');
    aiFieldsSection.classList.remove('show');
    aiGenerateRow.classList.remove('hidden');
    generateMetaBtn.textContent = 'Generate with AI';
    saveProductBtn.disabled = true;
    isEditMode = false;
  }

  // AI generation
  async function generateProductMeta() {
    const name = fields.name.value.trim();
    const features = fields.features.value.trim();

    if (!name) {
      showFormStatus('Product name is required', true);
      return;
    }
    if (!features || features.length < 10) {
      showFormStatus('Features must be at least 10 characters', true);
      return;
    }

    generateMetaBtn.disabled = true;
    regenerateMetaBtn.disabled = true;
    const originalText = generateMetaBtn.textContent;
    generateMetaBtn.textContent = 'Generating...';

    try {
      console.log('[Marketeer Popup] Sending GENERATE_PRODUCT_META:', { name, features: features.slice(0, 50) + '...' });
      const result = await chrome.runtime.sendMessage({
        type: 'GENERATE_PRODUCT_META',
        name,
        link: fields.link.value.trim(),
        features
      });
      console.log('[Marketeer Popup] GENERATE_PRODUCT_META response:', result);

      if (result.error) {
        console.error('[Marketeer Popup] Error from service worker:', result.error);
        showFormStatus(result.error, true);
        // Reveal empty AI fields for manual entry
        aiFieldsSection.classList.add('show');
        saveProductBtn.disabled = false;
        return;
      }

      // Populate fields
      fields.benefits.value = result.benefits || '';
      fields.scenarios.value = result.scenarios || '';
      fields.subreddits.value = (result.subreddits || []).join(', ');
      fields.keywords.value = (result.keywords || []).join(', ');

      // Update counters
      ['benefits', 'scenarios'].forEach(key => {
        if (counters[key]) {
          counters[key].el.textContent = fields[key].value.length;
        }
      });

      // Show AI fields and enable save
      aiFieldsSection.classList.add('show');
      saveProductBtn.disabled = false;
    } catch (err) {
      console.error('[Marketeer Popup] generateProductMeta exception:', err);
      showFormStatus('Generation failed — fill in fields manually', true);
      aiFieldsSection.classList.add('show');
      saveProductBtn.disabled = false;
    } finally {
      generateMetaBtn.disabled = false;
      regenerateMetaBtn.disabled = false;
      generateMetaBtn.textContent = originalText;
    }
  }

  generateMetaBtn.addEventListener('click', generateProductMeta);
  regenerateMetaBtn.addEventListener('click', generateProductMeta);

  // Expand product limit (+20 for 5 credits)
  expandLimitBtn.addEventListener('click', async () => {
    if (currentCreditsAvailable < 5) {
      showProductsStatus('Need 5 credits to expand limit. You have ' + currentCreditsAvailable + '.', true);
      return;
    }
    if (!confirm('Spend 5 credits to add 20 more product slots?')) return;

    expandLimitBtn.disabled = true;
    expandLimitBtn.textContent = 'Expanding...';
    try {
      const result = await chrome.runtime.sendMessage({ type: 'EXPAND_PRODUCT_LIMIT' });
      if (!result.success) {
        showProductsStatus(result.error || 'Failed to expand limit', true);
        return;
      }
      productLimit = result.newLimit;
      updateHeaderCredits(result.creditsRemaining);
      creditCount.textContent = result.creditsRemaining;
      updateCreditsWarning(result.creditsRemaining);
      renderProductList();
      showProductsStatus('Limit expanded to ' + productLimit + ' products!', false);
    } catch (err) {
      showProductsStatus('Failed to expand limit. Try again.', true);
    } finally {
      expandLimitBtn.disabled = false;
      expandLimitBtn.textContent = 'Expand Limit +20 (5 credits)';
    }
  });

  function showFormStatus(msg, isError) {
    formStatus.textContent = msg;
    formStatus.className = 'form-status show' + (isError ? ' error' : '');
    clearTimeout(formStatus._timer);
    formStatus._timer = setTimeout(() => formStatus.classList.remove('show'), 2500);
  }

  function showProductsStatus(msg, isError) {
    productsStatus.textContent = msg;
    productsStatus.className = 'form-status show' + (isError ? ' error' : '');
    clearTimeout(productsStatus._timer);
    productsStatus._timer = setTimeout(() => productsStatus.classList.remove('show'), 3000);
  }

  function generateId() {
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function parseCommaSep(str) {
    return str.split(',')
      .map(s => s.trim().toLowerCase().replace(/^r\//, ''))
      .filter(s => s.length > 0);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
});
