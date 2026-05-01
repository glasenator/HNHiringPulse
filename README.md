# HN Hiring Pulse

A static dashboard for visualizing monthly job post counts from Hacker News "Ask HN: Who is Hiring?" threads.

## Features
- Loads historical data from a local `data.json` file
- Fetches and appends new months' data from the HN Algolia API
- Interactive range selection (12, 24, or all months)
- Stats for latest, peak, lowest, and month-over-month change
- Responsive chart and sortable data table
- All data and UI work offline after initial fetch

## Usage
1. Open `index.html` in your browser.
2. The dashboard loads data from `data.json`.
3. Click **Fetch Data** to add new months (if available).
4. Use the range buttons to filter the chart and table.

## Development
- All code is in plain HTML, CSS, and JS (no frameworks)
- Styles are in `styles.css`, logic in `script.js`
- Data is persisted in `data.json` (downloaded after fetch)

## Data Source
- [HN Algolia API](https://hn.algolia.com/api)
- Only top-level comments on "Ask HN: Who is Hiring?" threads are counted

## License
MIT
