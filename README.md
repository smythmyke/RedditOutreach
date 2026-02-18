# RedditOutreach

AI-powered Reddit response drafting Chrome extension. Reads Reddit posts, generates helpful comment drafts via Gemini, and fills the comment box for user review.

## How It Works

1. User browses Reddit and lands on a post page
2. Clicks the orange **R** floating button (bottom-right)
3. Extension reads the post title, body, subreddit, and top comments
4. Sends to backend → Gemini generates a helpful draft in 5 tones
5. Draft appears in a slide-in panel with tone tabs for editing
6. User clicks **Submit** → fills Reddit's comment box

## Features

- **Multi-tone generation** — Friendly, Casual, Professional, Comical, Short (generated in parallel)
- **Multi-product support** — BulkListingPro, GovToolsPro, Patent Search Generator, or no product
- **Subreddit rules compliance** — Scrapes sidebar rules, AI respects them. Blocks promotion in strict subs.
- **Comment replies** — Click any comment to generate a contextual reply
- **Feed badges** — Green checkmarks on posts you've already commented on
- **Old Reddit support** — Works on both new and old.reddit.com

## File Structure

```
├── manifest.json              # MV3, content script on reddit.com
├── config.js                  # API URL, product info, tone options
├── content/
│   ├── reddit.js              # Post reader, FAB, slide-in panel, comment filler
│   └── styles.css             # Dark theme UI (matches Reddit)
├── background/
│   └── service-worker.js      # Calls backend API
├── options/
│   ├── options.html           # Settings page
│   └── options.js
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Reddit DOM Selectors

The content script supports both new Reddit and old.reddit.com.

### New Reddit (www.reddit.com)

| Element | Selector |
|---------|----------|
| Post container | `shreddit-post` |
| Post title | `shreddit-post[post-title]` attribute |
| Post body | `[slot="text-body"]`, `[id*="post-rtjson-content"]` |
| Comments | `shreddit-comment` elements |
| Comment text | `[slot="comment"]`, `.md` |
| Comment input (rich) | `div[data-lexical-editor="true"]` |
| Comment input (markdown) | `shreddit-composer textarea` |

### Old Reddit (old.reddit.com)

| Element | Selector |
|---------|----------|
| Post title | `.top-matter .title a.title` |
| Post body | `.expando .usertext-body .md` |
| Comments | `.comment .entry .usertext-body .md` |
| Comment input | `.usertext.cloneable textarea` |

## Known Limitations

- Reddit frequently updates their DOM structure, especially `shreddit-*` web components
- `document.execCommand('insertText')` is deprecated — fallback planned
- If comment box detection fails, extension copies text to clipboard instead
