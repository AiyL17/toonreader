# ToonReader

Personal manga/manhwa reader that proxies content from mangadistrict.com.

## Setup

```bash
npm install
```

## Running Locally

```bash
npm start
```

Then open **http://localhost:3000** in your browser.

For development with auto-restart:
```bash
npm run dev
```

Github Hosted URL:
https://aiyl17.github.io/toonreader/

## Running with Public URL (Cloudflare Tunnel)

Use this to access ToonReader on your phone from anywhere.
Requires [cloudflared](https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.msi) to be installed.

```bash
start node server.js & cloudflared tunnel --url http://localhost:3000
```

After running, look for the public URL in the output:
```
https://xxxx-xxxx-xxxx.trycloudflare.com
```
Open that URL on your phone. Keep the CMD window open while using the app.

## Features

- **Home** — Latest updates from mangadistrict.com
- **Browse** — Filter by genre and sort order
- **Search** — Full-text search across all titles
- **Manga Detail** — Cover, summary, chapter list with read tracking
- **Reader** — Vertical scroll reader with adjustable image width
- **Favorites** — Bookmark manga from any card or detail page
- **History** — Tracks recently read manga with continue-reading support

## Keyboard Shortcuts (in reader)

| Key | Action |
|-----|--------|
| `←` / `A` | Previous chapter |
| `→` / `D` | Next chapter |
| `Esc` | Back to manga detail |

## Notes

- Images are proxied through the local server to bypass hotlink protection
- Responses are cached to reduce load on the source site
- Favorites, history, and settings are saved in browser localStorage
