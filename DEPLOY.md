# RedditOutreach Deployment Guide

## Architecture

The extension itself is loaded locally (unpacked Chrome extension). The **backend API** runs on Google Cloud Run as part of the GovToolsPro project.

## Backend Deployment

The reddit-generate endpoint lives inside GovToolsPro's api-server.js, NOT in this repo. This is a shared API server.

### Source Location
```
C:\Users\smyth\OneDrive\Desktop\Projects\GovToolsPro\api\api-server.js
```

### Endpoint
```
POST /api/v1/reddit-generate
```

### Deploy Command
```bash
gcloud run deploy business-search-api \
  --source "C:\Users\smyth\OneDrive\Desktop\Projects\GovToolsPro\api" \
  --project sam-extension \
  --region us-central1 \
  --allow-unauthenticated
```

### Service Details
- **Service name:** business-search-api
- **GCP Project:** sam-extension
- **Region:** us-central1
- **Service URL:** https://business-search-api-815700675676.us-central1.run.app
- **Auth:** Unauthenticated (public)
- **Gemini key:** `GEMINI_API_KEY` from Secret Manager in `sam-extension` project

### Verify After Deploy
```bash
curl -X POST https://business-search-api-815700675676.us-central1.run.app/api/v1/reddit-generate \
  -H "Content-Type: application/json" \
  -d '{"subreddit":"test","title":"Test post","tones":["friendly","short"]}'
```

Should return `{ "responses": { "friendly": "...", "short": "..." } }`.

## Extension Updates

No deployment needed — just reload the unpacked extension at `chrome://extensions/`.

1. Go to `chrome://extensions/`
2. Find RedditOutreach
3. Click the reload icon
4. Refresh the Reddit tab

## Important Notes

- The API server is shared with GovToolsPro (Etsy tools). The reddit-generate endpoint is one of many endpoints in api-server.js.
- Deploying re-deploys the ENTIRE api-server.js, not just the reddit endpoint.
- There is no deploy-api.sh script — use the gcloud command directly.
- Build uses the Dockerfile in the api/ directory.
- Typical deploy takes 3-5 minutes (container build + revision rollout).
