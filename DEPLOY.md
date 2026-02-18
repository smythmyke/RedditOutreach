# RedditOutreach Deployment Guide

## Architecture

The extension is loaded as an unpacked Chrome extension. The backend API runs on Google Cloud Run as a shared API server.

## Backend Deployment

The reddit-generate endpoint lives in the shared API server, not in this repo.

### Endpoint
```
POST /api/v1/reddit-generate
```

### Deploy
See the backend project's deployment instructions. The deploy re-deploys the entire shared API server.

### Verify After Deploy
Test the endpoint returns `{ "responses": { "friendly": "...", "short": "..." } }` for a valid request.

## Extension Updates

No deployment needed — just reload the unpacked extension:

1. Go to `chrome://extensions/`
2. Find RedditOutreach
3. Click the reload icon
4. Refresh the Reddit tab

## Notes

- The API server is shared across multiple projects. Deploying updates all endpoints.
- Typical deploy takes 3-5 minutes (container build + revision rollout).
