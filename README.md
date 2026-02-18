# RedditOutreach

AI-powered Reddit response drafting Chrome extension. Reads Reddit posts, generates helpful comment drafts via Gemini, and fills the comment box for user review before posting.

**Status:** Built, not yet tested. Backend endpoint needs deployment.

## How It Works

1. User browses Reddit and lands on a post page
2. Clicks the orange **R** floating button (bottom-right)
3. Extension reads the post title, body, subreddit, and top comments
4. Sends to backend → Gemini generates a helpful draft
5. Draft appears in a slide-in panel for editing
6. User clicks **Submit** → fills Reddit's comment box (does NOT auto-post)
7. User reviews in Reddit's native UI and clicks Reddit's own submit button

## Architecture

```
Content Script (reddit.js)
  → reads post DOM, shows FAB + panel
  → sends message to service worker

Service Worker (service-worker.js)
  → POST to Cloud Run backend

Backend (GovToolsPro api-server.js)
  → POST /api/v1/reddit-generate
  → uses existing Gemini API key from Secret Manager
  → returns generated text

Content Script
  → displays draft in panel
  → on Submit, fills Reddit's comment box
```

## File Structure

```
C:\Projects\RedditOutreach\
├── manifest.json              # MV3, content script on reddit.com post pages
├── config.js                  # API URL, product info, tone options
├── content/
│   ├── reddit.js              # Post reader, FAB, slide-in panel, comment filler
│   └── styles.css             # Dark theme UI (matches Reddit)
├── background/
│   └── service-worker.js      # Calls backend API
├── options/
│   ├── options.html           # Settings (tone preference only)
│   └── options.js
├── icons/
│   ├── icon16.png             # Orange circle with "R"
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## Backend Endpoint

**Location:** `C:\Users\smyth\OneDrive\Desktop\Projects\GovToolsPro\api\api-server.js`

**Endpoint added:** `POST /api/v1/reddit-generate`

**Inserted at:** Just before the `// Health check` block (search for "RedditOutreach" in the file)

**Request:**
```json
{
  "subreddit": "EtsySellers",
  "title": "Best way to bulk upload listings?",
  "body": "I have 200 digital downloads...",
  "comments": "Comment 1 text\n---\nComment 2 text",
  "tone": "friendly"
}
```

**Response:**
```json
{
  "text": "Generated comment draft..."
}
```

**No auth required** — personal use tool. No credits deducted.

**Gemini config:** Uses existing `genAI` instance (`gemini-2.0-flash`) from `process.env.GEMINI_API_KEY` (Secret Manager key `GEMINI_API_KEY` in GCP project `sam-extension`).

### Deploying the Endpoint

The backend runs on Cloud Run. Deploy from the GovToolsPro project:

```bash
cd "C:\Users\smyth\OneDrive\Desktop\Projects\GovToolsPro\api"

# Option 1: Use existing deploy script
bash deploy-api.sh

# Option 2: Direct gcloud deploy
gcloud run deploy business-search-api \
  --source . \
  --project sam-extension \
  --region us-central1 \
  --allow-unauthenticated
```

After deploy, verify:
```bash
curl -X POST https://business-search-api-815700675676.us-central1.run.app/api/v1/reddit-generate \
  -H "Content-Type: application/json" \
  -d '{"subreddit":"test","title":"Test post","tone":"friendly"}'
```

## Reddit DOM Selectors

The content script supports both new Reddit and old.reddit.com.

### New Reddit (www.reddit.com)

| Element | Selector | Notes |
|---------|----------|-------|
| Post container | `shreddit-post` | Web component, attributes hold metadata |
| Post title | `shreddit-post[post-title]` attribute, fallback `h1` | |
| Post body | `[slot="text-body"]`, `[id*="post-rtjson-content"]`, `.md` | Inside shreddit-post |
| Comments | `shreddit-comment` elements | `depth` attribute for nesting level |
| Comment text | `[slot="comment"]`, `.md`, `[id*="comment-rtjson-content"]` | Inside each shreddit-comment |
| Comment input (rich) | `shreddit-composer div[contenteditable="true"]`, `div[data-lexical-editor="true"]` | Lexical editor |
| Comment input (markdown) | `shreddit-composer textarea` | Markdown mode fallback |
| Expand comment box | Button containing "Add a comment" text | May need click to reveal composer |

### Old Reddit (old.reddit.com)

| Element | Selector | Notes |
|---------|----------|-------|
| Post title | `.top-matter .title a.title` | |
| Post body | `.expando .usertext-body .md` | |
| Comments | `.comment .entry .usertext-body .md` | |
| Comment input | `.usertext.cloneable textarea` | Standard textarea |

### Known Issues / Risks

- Reddit frequently updates their DOM structure, especially `shreddit-*` web components
- Shadow DOM may block access to some elements in future Reddit updates
- The `contenteditable` div uses Lexical editor — `document.execCommand('insertText')` works now but is deprecated
- If comment box detection fails, extension falls back to copying text to clipboard

## Prompt Engineering

The prompt lives server-side in the backend endpoint. Key design:

- Emphasizes genuine helpfulness over product promotion
- BulkListingPro is only mentioned when naturally relevant
- Tone is configurable (friendly/casual/professional)
- Post context includes subreddit, title, body, and top comments
- Temperature set to 0.9 for natural-sounding variation

## TODO

### Before First Use
- [ ] Deploy backend with the new endpoint (see "Deploying the Endpoint" above)
- [ ] Load extension unpacked at `chrome://extensions/`
- [ ] Test on a Reddit post page

### Testing Checklist
- [ ] FAB appears on `reddit.com/r/*/comments/*` pages
- [ ] FAB does NOT appear on Reddit home/feed pages
- [ ] Clicking FAB extracts post title correctly
- [ ] Panel slides in with loading state
- [ ] Backend returns a draft (check DevTools Network tab)
- [ ] Draft appears in textarea, is editable
- [ ] Tone selector works (regenerates with new tone)
- [ ] "Regenerate" button fetches a new draft
- [ ] "Copy" button copies to clipboard
- [ ] "Submit" fills Reddit's comment box without auto-posting
- [ ] Escape / backdrop click closes panel
- [ ] Works on old.reddit.com

### Future Improvements
- [ ] Add auth + credits if productizing (use BulkListingPro's auth pattern)
- [ ] Custom prompt template editing (was in options, removed when switching to backend)
- [ ] Rate limiting on the endpoint (currently wide open)
- [ ] Track usage (subreddit, timestamp) for analytics
- [ ] Support Reddit's fancy pants editor (rich text mode)
- [ ] Handle Reddit's login-required comment prompt
- [ ] Keyboard shortcut to trigger FAB (e.g., Alt+R)
