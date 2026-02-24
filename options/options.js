const BASE_PRODUCT_LIMIT = 20;
let productLimit = BASE_PRODUCT_LIMIT;
let products = [];
let currentCreditsAvailable = 0;

// --- DOM refs ---
const toneSelect = document.getElementById('tone');
const defaultProductSelect = document.getElementById('defaultProduct');
const saveSettingsBtn = document.getElementById('saveSettings');
const settingsStatus = document.getElementById('settingsStatus');
const creditsDisplay = document.getElementById('creditsDisplay');

const productList = document.getElementById('productList');
const productCount = document.getElementById('productCount');
const addProductBtn = document.getElementById('addProductBtn');
const expandLimitBtn = document.getElementById('expandLimitBtn');
const productsStatusEl = document.getElementById('productsStatus');

const productForm = document.getElementById('productForm');
const formTitle = document.getElementById('formTitle');
const editProductId = document.getElementById('editProductId');
const saveProductBtn = document.getElementById('saveProductBtn');
const cancelProductBtn = document.getElementById('cancelProductBtn');
const productFormStatus = document.getElementById('productFormStatus');
const aiFieldsSection = document.getElementById('aiFieldsSection');
const aiGenerateRow = document.getElementById('aiGenerateRow');
const generateMetaBtn = document.getElementById('generateMetaBtn');
const regenerateMetaBtn = document.getElementById('regenerateMetaBtn');
let isEditMode = false;

// Form fields
const fields = {
  name: document.getElementById('pName'),
  link: document.getElementById('pLink'),
  features: document.getElementById('pFeatures'),
  benefits: document.getElementById('pBenefits'),
  scenarios: document.getElementById('pScenarios'),
  subreddits: document.getElementById('pSubreddits'),
  keywords: document.getElementById('pKeywords'),
  concepts: document.getElementById('pConcepts')
};

// Character counters
const counters = {
  name: { el: document.getElementById('pNameCount'), max: 100 },
  link: { el: document.getElementById('pLinkCount'), max: 500 },
  features: { el: document.getElementById('pFeaturesCount'), max: 2000 },
  benefits: { el: document.getElementById('pBenefitsCount'), max: 1000 },
  scenarios: { el: document.getElementById('pScenariosCount'), max: 1000 }
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

// --- Credits display ---
function updateCreditsDisplay(available) {
  currentCreditsAvailable = available;
  if (creditsDisplay) {
    creditsDisplay.textContent = 'Credits: ' + available;
    creditsDisplay.classList.remove('hidden');
  }
}

// Fetch credits on load
chrome.runtime.sendMessage({ type: 'CHECK_CREDITS' }).then(resp => {
  if (resp && resp.success && resp.credits) {
    updateCreditsDisplay(resp.credits.available);
  }
}).catch(() => {});

// --- Load saved data ---
chrome.storage.local.get(['ro_default_tone', 'ro_project', STORAGE_KEYS.PRODUCTS, 'marketeer_product_limit'], (result) => {
  if (result.ro_default_tone) toneSelect.value = result.ro_default_tone;
  products = result[STORAGE_KEYS.PRODUCTS] || [];
  productLimit = result.marketeer_product_limit || BASE_PRODUCT_LIMIT;
  renderProductList();
  populateDefaultProductDropdown();
  if (result.ro_project) defaultProductSelect.value = result.ro_project;
});

// --- Settings save ---
saveSettingsBtn.addEventListener('click', () => {
  chrome.storage.local.set({
    ro_default_tone: toneSelect.value,
    ro_project: defaultProductSelect.value
  }, () => {
    showStatus(settingsStatus, 'Settings saved');
  });
});

// --- Product list rendering ---
function renderProductList() {
  const atLimit = products.length >= productLimit;

  if (products.length === 0) {
    productList.innerHTML = '<div class="empty-state">No products defined. Add one to get started.</div>';
    productCount.textContent = '';
    addProductBtn.disabled = false;
    if (expandLimitBtn) expandLimitBtn.classList.add('hidden');
    return;
  }

  productCount.textContent = products.length + '/' + productLimit + ' products';
  addProductBtn.disabled = atLimit;

  if (expandLimitBtn) {
    if (atLimit) {
      expandLimitBtn.classList.remove('hidden');
    } else {
      expandLimitBtn.classList.add('hidden');
    }
  }

  productList.innerHTML = products.map(p => {
    const meta = [];
    if (p.link) meta.push('has link');
    if (p.subreddits && p.subreddits.length) meta.push(p.subreddits.length + ' subreddit' + (p.subreddits.length > 1 ? 's' : ''));
    if (p.keywords && p.keywords.length) meta.push(p.keywords.length + ' keyword' + (p.keywords.length > 1 ? 's' : ''));
    return `
      <div class="product-card" data-id="${p.id}">
        <div class="product-card-info">
          <div class="product-card-name">${escapeHtml(p.name)}</div>
          <div class="product-card-meta">${meta.join(' · ') || 'No metadata'}</div>
        </div>
        <div class="product-card-actions">
          <button class="btn-small btn-secondary edit-product-btn" data-id="${p.id}">Edit</button>
          <button class="btn-small btn-danger delete-product-btn" data-id="${p.id}">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  // Attach edit/delete handlers
  productList.querySelectorAll('.edit-product-btn').forEach(btn => {
    btn.addEventListener('click', () => openEditForm(btn.dataset.id));
  });
  productList.querySelectorAll('.delete-product-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteProduct(btn.dataset.id));
  });
}

function populateDefaultProductDropdown() {
  const current = defaultProductSelect.value;
  defaultProductSelect.innerHTML = '<option value="none">No Product</option>';
  products.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    defaultProductSelect.appendChild(opt);
  });
  defaultProductSelect.value = current || 'none';
}

// --- Add / Edit product form ---
addProductBtn.addEventListener('click', () => {
  if (products.length >= productLimit) {
    showProductsStatus('Product limit reached. Expand your limit below.', true);
    return;
  }
  if (currentCreditsAvailable < 1) {
    showProductsStatus('Need at least 1 credit to add a product.', true);
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

cancelProductBtn.addEventListener('click', () => {
  productForm.classList.remove('show');
  clearForm();
});

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

function clearForm() {
  Object.values(fields).forEach(f => { f.value = ''; });
  Object.keys(counters).forEach(key => {
    counters[key].el.textContent = '0';
    counters[key].el.parentElement.classList.remove('over');
  });
  editProductId.value = '';
  productFormStatus.classList.remove('show');
  aiFieldsSection.classList.remove('show');
  aiGenerateRow.classList.remove('hidden');
  generateMetaBtn.textContent = 'Generate with AI';
  saveProductBtn.disabled = true;
  isEditMode = false;
}

// --- Save product (1 credit for new, free for edits) ---
saveProductBtn.addEventListener('click', async () => {
  const name = fields.name.value.trim();
  const features = fields.features.value.trim();

  if (!name) {
    showStatus(productFormStatus, 'Product name is required', true);
    return;
  }
  if (!features) {
    showStatus(productFormStatus, 'Features / description is required', true);
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
      showStatus(productFormStatus, 'Product limit reached. Expand your limit.', true);
      return;
    }

    // Deduct 1 credit for new product
    saveProductBtn.disabled = true;
    saveProductBtn.textContent = 'Saving...';
    try {
      const creditResult = await chrome.runtime.sendMessage({ type: 'USE_PRODUCT_CREDIT' });
      if (!creditResult.success) {
        if (creditResult.error === 'insufficient_credits') {
          showStatus(productFormStatus, 'Not enough credits (' + (creditResult.creditsRemaining || 0) + ' remaining).', true);
        } else {
          showStatus(productFormStatus, 'Failed to verify credits. Please try again.', true);
        }
        saveProductBtn.disabled = false;
        saveProductBtn.textContent = 'Save Product';
        return;
      }
      updateCreditsDisplay(creditResult.creditsRemaining);
    } catch (err) {
      showStatus(productFormStatus, 'Failed to deduct credit. Try again.', true);
      saveProductBtn.disabled = false;
      saveProductBtn.textContent = 'Save Product';
      return;
    }

    products.push(product);
  } else {
    // Edit existing — free
    const idx = products.findIndex(p => p.id === editProductId.value);
    if (idx !== -1) products[idx] = product;
  }

  saveProducts(() => {
    productForm.classList.remove('show');
    clearForm();
    renderProductList();
    populateDefaultProductDropdown();
  });
});

// --- Delete product ---
function deleteProduct(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  if (!confirm('Delete "' + p.name + '"?')) return;

  products = products.filter(x => x.id !== id);
  saveProducts(() => {
    renderProductList();
    populateDefaultProductDropdown();
    // If the deleted product was the default, reset to 'none'
    if (defaultProductSelect.value === id) {
      defaultProductSelect.value = 'none';
      chrome.storage.local.set({ ro_project: 'none' });
    }
  });
}

// --- Expand product limit ---
if (expandLimitBtn) {
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
      updateCreditsDisplay(result.creditsRemaining);
      renderProductList();
      showProductsStatus('Limit expanded to ' + productLimit + ' products!', false);
    } catch (err) {
      showProductsStatus('Failed to expand limit. Try again.', true);
    } finally {
      expandLimitBtn.disabled = false;
      expandLimitBtn.textContent = 'Expand Limit +20 (5 credits)';
    }
  });
}

// --- Persistence ---
function saveProducts(callback) {
  chrome.storage.local.set({ [STORAGE_KEYS.PRODUCTS]: products }, callback);
}

// --- Helpers ---
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

function showStatus(el, msg, isError) {
  el.textContent = msg;
  el.className = 'status show' + (isError ? ' error' : '');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 2500);
}

function showProductsStatus(msg, isError) {
  if (!productsStatusEl) return;
  productsStatusEl.textContent = msg;
  productsStatusEl.className = 'status show' + (isError ? ' error' : '');
  clearTimeout(productsStatusEl._timer);
  productsStatusEl._timer = setTimeout(() => productsStatusEl.classList.remove('show'), 3000);
}

// --- AI generation ---
async function generateProductMeta() {
  const name = fields.name.value.trim();
  const features = fields.features.value.trim();

  if (!name) {
    showStatus(productFormStatus, 'Product name is required', true);
    return;
  }
  if (!features || features.length < 10) {
    showStatus(productFormStatus, 'Features must be at least 10 characters', true);
    return;
  }

  generateMetaBtn.disabled = true;
  regenerateMetaBtn.disabled = true;
  const originalText = generateMetaBtn.textContent;
  generateMetaBtn.textContent = 'Generating...';

  try {
    console.log('[Marketeer Options] Sending GENERATE_PRODUCT_META:', { name, features: features.slice(0, 50) + '...' });
    const result = await chrome.runtime.sendMessage({
      type: 'GENERATE_PRODUCT_META',
      name,
      link: fields.link.value.trim(),
      features
    });
    console.log('[Marketeer Options] GENERATE_PRODUCT_META response:', result);

    if (result.error) {
      console.error('[Marketeer Options] Error from service worker:', result.error);
      showStatus(productFormStatus, result.error, true);
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
    console.error('[Marketeer Options] generateProductMeta exception:', err);
    showStatus(productFormStatus, 'Generation failed — fill in fields manually', true);
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
