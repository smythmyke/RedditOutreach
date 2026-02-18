# Marketeer — Production Readiness Tasks

**Last updated:** 2026-02-18
**Goal:** Secure, monetize, and deploy to public via Chrome Web Store

---

## Manual Tasks (Human Action Required)

These cannot be automated and must be done by the developer:

| # | Task | Context | Status |
|---|------|---------|--------|
| M1 | Set `ADMIN_EMAILS` env var on Cloud Run: `gcloud run services update business-search-api --set-env-vars "ADMIN_EMAILS=smythmyke@gmail.com" --project sam-extension --region us-central1` | Backend admin email was moved from hardcoded to env var (Tier 1, Task 12) | Pending |
| M2 | Set `GOOGLE_MAPS_STATIC_KEY` env var on Cloud Run (if Maps features are needed) | Hardcoded Maps API key was removed (Tier 1, Task 5). The SVG placeholder fallback handles the no-key case. | Pending |
| M3 | Create a dedicated OAuth client ID for Marketeer in Google Cloud Console (`sam-extension` project → APIs & Services → Credentials → Create OAuth 2.0 Client ID for Chrome extension) | Currently using BLP's client_id. Works for dev but needs its own for Chrome Web Store. | Pending |
| M4 | Redeploy backend to Cloud Run after all backend security fixes are complete | Backend changes (demo key removal, Maps key removal, admin email env var) are saved locally but not yet deployed. | Pending |
| M5 | Register for Chrome Web Store Developer account ($5 one-time fee) if not already done | Required for store publication. | Pending |
| M6 | Host privacy policy and terms of service at a public URL (e.g., GitHub Pages) | Chrome Web Store requires a publicly accessible privacy policy URL. Currently bundled in extension at `docs/`. | Pending |
| M7 | Choose a new extension name (no "Reddit" trademark) | Task 35. Renamed to "Marketeer". | Done |
| M8 | Install `helmet` in backend: `cd "C:\Users\smyth\OneDrive\Desktop\Projects\GovToolsPro\api" && npm install helmet` | Helmet was added to api-server.js but not yet installed in package.json. | Pending |
| M9 | Set `SCHEDULER_SECRET` env var on Cloud Run: `gcloud run services update business-search-api --set-env-vars "SCHEDULER_SECRET=<random-secret>" --project sam-extension --region us-central1` | Internal endpoints now require this secret header (Task 39). Update any Cloud Scheduler jobs to include `X-Scheduler-Secret` header. | Pending |

---

## Legend

- **Source**: Where reusable code exists (BLP = BulkListingPro, GTP = GovToolsPro, NEW = build from scratch)
- **Effort**: Quick (< 30 min), Low (< 2 hrs), Medium (2-6 hrs), High (6+ hrs)
- Organized by: leverageable low-hanging fruit first, then increasing effort

---

## Tier 1: Quick Wins (No External Code Needed)

| # | Task | Effort | Status |
|---|------|--------|--------|
| 1 | Delete `html.txt` (932KB, contains Reddit session tokens/CSRF) | Quick | Done |
| 2 | Remove 7 `console.log` debug statements from `reddit.js` (lines 511, 739, 744, 751, 756, 763, 804) | Quick | Done |
| 3 | Fix manifest protocols: change `*://` to `https://` in host_permissions and content_script matches | Quick | Done |
| 4 | Remove hardcoded demo API key (`demo-key-12345`) from backend `api-server.js:160` | Quick | Done |
| 5 | Remove hardcoded Google Maps API key fallback from backend `api-server.js:4460` | Quick | Done |
| 6 | Init git repo + create `.gitignore` (exclude `html.txt`, `node_modules/`, `dist/`, `*.zip`) | Quick | Done |
| 7 | Sanitize README.md — remove local paths, deploy commands, GCP details | Quick | Done |
| 8 | Remove/sanitize DEPLOY.md (or move to `.gitignore`) | Quick | Done |
| 9 | Add `.catch()` to all 4 `navigator.clipboard.writeText()` calls (`reddit.js:398, 683, 703, 829`) | Quick | Done |
| 10 | Fix error messages — return generic errors to client, not `error.message` in `service-worker.js:42` | Quick | Done |
| 11 | Add sender validation to service worker: check `sender.id === chrome.runtime.id` | Quick | Done |
| 12 | Remove hardcoded admin email from backend — move to env var (`api-server.js:2309`) | Quick | Done |

---

## Tier 2: Low Effort — Direct Copy/Adapt from Sister Projects

| # | Task | Source | Effort | Status |
|---|------|--------|--------|--------|
| 13 | Add auth service (`services/auth.js`) — copy BLP singleton + Google OAuth 3-step flow | BLP `services/auth.js` | Low | Done |
| 14 | Add `identity` permission + `oauth2` config to manifest.json | BLP `manifest.json:36-41` | Low | Done |
| 15 | Add `getApiHeaders()` with Bearer token to service worker | BLP `services/credits.js:14-34` | Low | Done |
| 16 | Add storage service with named key constants (`services/storage.js`) | BLP `services/storage.js` | Low | Done |
| 17 | Add toolbar popup (`popup/popup.html`, `popup/popup.js`) — auth status + credits display | BLP `popup/popup.html`, GTP `popup/popup.html` | Low | Done |
| 18 | Add `action` config to manifest.json for toolbar icon | BLP `manifest.json:45-52` | Low | Done |
| 19 | Create privacy policy HTML (adapt BLP template) | BLP `docs/privacy-policy.html` | Low | Done |
| 20 | Create terms of service HTML (adapt BLP template) | BLP `docs/terms-of-service.html` | Low | Done |
| 21 | Add `debounce()` utility + apply to Regenerate button | BLP `editor/editor.js:488` | Low | Done |
| 22 | Add build-for-store script (adapt BLP PowerShell script) | BLP `build-for-store.ps1` | Low | Done |
| 23 | Improve API error handling — add 401/402/503 status code pattern | BLP `editor/components/ai-generator.js:29-43` | Low | Done |

---

## Tier 3: Medium Effort — Adapt from Sister Projects

| # | Task | Source | Effort | Status |
|---|------|--------|--------|--------|
| 24 | Add credits service (`services/credits.js`) — balance check, Stripe checkout, credit deduction | BLP `services/credits.js` | Medium | Done |
| 25 | Add credits display to popup + panel (balance badge, low-credits warning) | BLP `popup/popup.js`, GTP credit components | Medium | Done |
| 26 | Add welcome/onboarding flow on `chrome.runtime.onInstalled` | BLP `sidepanel/sidepanel.js:459-540`, `services/tourService.js` | Medium | Done |
| 27 | Add API fetch wrapper with auto 401 retry + silent token refresh | GTP `services/api.js` fetch method | Medium | Done |
| 28 | Deduct credits per generation (hook into `handleGenerateAll`) | BLP `services/credits.js:useCredits()` | Medium | Done |

---

## Tier 4: Medium Effort — New Code Required

| # | Task | Source | Effort | Status |
|---|------|--------|--------|--------|
| 29 | Fix auto-submit: remove auto-click of Reddit submit button, OR add confirmation dialog | NEW | Medium | Done |
| 30 | Add fetch timeout with `AbortController` (30s timeout on API calls) | NEW | Low | Done |
| 31 | Add input validation + length truncation on message payload fields in service worker | NEW | Low | Done |
| 32 | Add history pruning — max 500 entries or 90-day TTL, auto-cleanup on load | NEW | Low | Done |
| 33 | Fix or remove options page (currently non-functional — saved tone never used, only 3/5 tones) | NEW | Low | Done |
| 34 | Add client-side rate limit / cooldown on Regenerate (5s cooldown after response) | NEW | Low | Done |
| 35 | Rename extension — remove "Reddit" from name (trademark risk) | NEW | Quick | Done |
| 36 | Add license file (MIT or proprietary) | NEW | Quick | Done |
| 37 | Anonymize third-party data — replace `replyTo.author` with "User" before sending to backend | NEW | Quick | Done |

---

## Tier 5: Backend Security (Critical Priority)

| # | Task | Source | Effort | Status |
|---|------|--------|--------|--------|
| 38 | Fix Google OAuth — verify `googleToken` server-side before trusting email (`api-server.js:2319`) | NEW | Medium | Done |
| 39 | Secure `/api/v1/internal/*` endpoints — add scheduler secret validation (`api-server.js:186`) | NEW | Low | Done |
| 40 | Remove Firebase service account JSON from Docker image — use default SA on Cloud Run | NEW | Low | Pending |
| 41 | Fix CORS — remove permissive `else callback(null, true)` on `api-server.js:137` | NEW | Quick | Done |
| 42 | Add SSRF protection to `/api/scrapeEmails` — block private IPs, metadata endpoints | NEW | Medium | Pending |
| 43 | Add input length validation (`.isLength({ max: N })`) to all AI prompt fields | NEW | Low | Done |
| 44 | Stop returning `error.message` to clients in 40+ backend routes | NEW | Medium | Done |
| 45 | Validate `X-Extension-Id` against whitelist of known extension IDs | NEW | Low | Pending |
| 46 | Add Helmet middleware for security headers | NEW | Quick | Done |
| 47 | Add request logging (Morgan or Cloud Logging) | NEW | Low | Pending |
| 48 | Reduce Express body-parser limit from 10MB to 1MB for non-upload routes | NEW | Quick | Done |
| 49 | Remove rate limiter skip for `searchBusinesses`, `scrapeEmails`, `maps-key` endpoints | NEW | Quick | Done |

---

## Tier 6: Polish & Accessibility

| # | Task | Source | Effort | Status |
|---|------|--------|--------|--------|
| 50 | Add ARIA labels to FAB, close button, tone tabs | NEW | Low | Done |
| 51 | Add `role="dialog"` + `aria-modal` + focus trap to panel | NEW | Medium | Done |
| 52 | Add `aria-live="polite"` to toast container | NEW | Quick | Done |
| 53 | Fix color contrast (`#818384` on `#1a1a1b` → WCAG AA 4.5:1) | NEW | Quick | Done |
| 54 | Add `prefers-reduced-motion` media query | NEW | Quick | Done |
| 55 | Make comment click targets keyboard-accessible (`tabindex`, `role="button"`) | NEW | Low | Done |
| 56 | Add responsive panel width for narrow viewports | NEW | Low | Done |
| 57 | Modularize `reddit.js` (1084 lines) into separate modules | NEW | High | Deferred |
| 58 | Replace `document.execCommand('insertText')` with modern alternative + fallback | NEW | Medium | Done |
| 59 | Deduplicate `scoreProject`/`detectProject` logic | NEW | Quick | Done |

---

## Tier 7: Legal & Compliance Review

| # | Task | Source | Effort | Status |
|---|------|--------|--------|--------|
| 60 | Review Reddit ToS — assess risk of DOM scraping + automated UI interaction | NEW | Low | Pending |
| 61 | Review Google Gemini ToS — verify generated-content-for-social-media is permitted | NEW | Low | Pending |
| 62 | Review Chrome Web Store policies — ensure extension won't be classified as spam tool | NEW | Low | Pending |

---

## Recommended Execution Order

**Sprint 1 — Security + Quick Wins (do first):**
Tasks 1-12 (Tier 1) + Tasks 38-49 (Tier 5 backend security)

**Sprint 2 — Auth + Payments (leveraged from sister projects):**
Tasks 13-18 (auth + popup) → Tasks 24-28 (credits + Stripe)

**Sprint 3 — UX + Compliance:**
Tasks 19-23 (privacy, build, error handling) + Tasks 29-37 (auto-submit fix, options, rename)

**Sprint 4 — Polish:**
Tasks 50-59 (accessibility, modularization)

**Sprint 5 — Legal Review:**
Tasks 60-62

---

## Reusable Code Map

| Component | Copy From | Adapt For |
|-----------|-----------|-----------|
| `services/auth.js` | BLP `services/auth.js` | Change prefix `bulklistingpro_` → `marketeer_`, extension name header |
| `services/credits.js` | BLP `services/credits.js` | Change prefix, adapt checkout success/cancel URLs |
| `services/storage.js` | BLP `services/storage.js` | Change STORAGE_KEYS to RO-specific keys |
| `popup/popup.html` | BLP `popup/popup.html` | Adapt branding, show Reddit-specific status |
| `popup/popup.js` | BLP `popup/popup.js` + GTP `popup/popup.js` | Merge auth check + credits display patterns |
| `getApiHeaders()` | BLP `services/credits.js:14-34` | Drop into service worker for all API calls |
| `debounce()` | BLP `editor/editor.js:488` | Apply to Regenerate button click handler |
| `privacy-policy.html` | BLP `docs/privacy-policy.html` | Update data collection details for Reddit context |
| `terms-of-service.html` | BLP `docs/terms-of-service.html` | Update product name and features |
| `build-for-store.ps1` | BLP `build-for-store.ps1` | Change directory list to RO structure |
| OAuth manifest config | BLP `manifest.json:36-41` | Same `client_id` (shared backend) or new one |
| Error handling pattern | BLP `editor/components/ai-generator.js:29-43` | Apply to service worker API response handling |
| API fetch wrapper | GTP `services/api.js` | Adapt for RO's single endpoint |

---

## Architecture Notes (Preserved)

### Multi-Project Design
- `REDDIT_PRODUCTS` object in backend with 3 product profiles (bulklistingpro, govtoolspro, patentsearch)
- Extension sends `projectId` + `subredditRules` with each request
- Panel has a project dropdown for switching on the fly
- "None" option generates pure helpful comments with no product mention

### Subreddit Rules Strategy
- Scrape rules from sidebar DOM on page load
- Send rules text to backend → AI uses them to decide product mention
- Hard block: rules say "no promotion" → disabled FAB (R with slash)
- Soft mode: ambiguous rules → AI adjusts (may name-drop without link, or skip)
- "None" project always allowed regardless of rules
