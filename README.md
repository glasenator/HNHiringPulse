# HN Hiring Pulse

A dashboard for tracking monthly hiring activity from Hacker News "Ask HN: Who is Hiring?" and "Who wants to be hired?" threads.

## Overview

This project now serves the dashboard through a small Express API and keeps a shared daily cache on the server. The UI reads from `/api/dashboard-data`, which refreshes once per day per data version and falls back to the local JSON files when the server cache is unavailable.

## Features
- Reads and serves employer and seeker data from local JSON files
- Refreshes the shared cache from the HN Firebase and Algolia APIs
- Tracks monthly counts for both hiring posts and job-seeker posts
- Displays latest, peak, low, and month-over-month stats
- Uses a range filter for 12 months, 24 months, or all data
- Shows both a chart and a sortable table with thread links
- Runs as a lightweight static app with an Express backend

## Local development

```bash
npm install
npm start
```

Then open the app in a browser at:

- `http://localhost:8080`

To refresh the local JSON data files immediately:

```bash
node server.js --refresh-data
```

## API

### GET /api/dashboard-data

Returns the current cached dashboard payload.

Example response:

```json
{
  "employerData": [
    {
      "id": 123456,
      "label": "January 2024",
      "month": 0,
      "year": 2024,
      "ts": 1704067200000,
      "count": 42
    }
  ],
  "seekerData": [
    {
      "id": 234567,
      "label": "January 2024",
      "month": 0,
      "year": 2024,
      "ts": 1704067200000,
      "count": 31
    }
  ],
  "lastRefreshDateKey": "2026-08-12",
  "lastRefreshDataVersion": "official-hn-whoishiring-v3-direct-parent-top-level-comments",
  "lastAttemptDateKey": "2026-08-12",
  "lastAttemptDataVersion": "official-hn-whoishiring-v3-direct-parent-top-level-comments",
  "refreshedOnRequest": false,
  "attemptedOnRequest": false,
  "refreshError": null
}
```

### Response fields
- `employerData`: monthly counts for "Who is Hiring?" posts
- `seekerData`: monthly counts for "Who wants to be hired?" posts
- `lastRefreshDateKey`: most recent successful refresh date in `YYYY-MM-DD`
- `lastRefreshDataVersion`: refresh version string used by the server
- `lastAttemptDateKey`: most recent attempted refresh date
- `lastAttemptDataVersion`: most recent refresh version attempted
- `refreshedOnRequest`: whether this request triggered a refresh
- `attemptedOnRequest`: whether the refresh logic ran on this request
- `refreshError`: any refresh error message, if one occurred

### Refresh behavior

The server attempts a daily refresh once per unique date/version combination. It does not keep retrying the same refresh repeatedly in the same day. If a refresh fails, the app still serves the last known shared cache and surfaces the error in the API payload.

## Data sources

- [Hacker News Firebase API](https://hacker-news.firebaseio.com/v0)
- [HN Algolia API](https://hn.algolia.com/api)
- Counts are based on top-level comment activity associated with the relevant monthly hiring thread

## Files

- `server.js`: Express API, shared cache refresh logic, and data persistence
- `script.js`: frontend data loading and dashboard rendering
- `styles.css`: layout and chart styling
- `employerData.json`: monthly employer hiring counts
- `seekerData.json`: monthly job-seeker counts

## License
MIT
