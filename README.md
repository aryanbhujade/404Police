# 404 Police

A Node.js status dashboard that collects public status-page data for popular AI, messaging, streaming, developer, cloud, and online services.

**Live dashboard:** [aryanbhujade.github.io/404Police](https://aryanbhujade.github.io/404Police/)

## Requirements

- Node.js 18 or newer
- npm

## Installation

```bash
git clone https://github.com/aryanbhujade/404Police.git
cd 404Police
npm ci
```

## Run locally

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000) in a browser.

To use another port:

```bash
PORT=8080 npm start
```

No API keys are required. The server reads public status endpoints defined in `server.js` and serves the frontend from `source/`.

## Project structure

- `server.js` - Express server and status API proxy
- `source/index.html` - dashboard markup
- `source/script.js` - status rendering and interactions
- `source/style.css` - dashboard styling
- `api_doc.html` - local API reference
