# NET Study Sermons — website

A single, quiet landing page for [NET Study Sermons](https://github.com/NET-Study/netstudy-sermons).

Three files, no build step, no dependencies:

```
index.html    one page: hero, one screenshot, three facts, footer
styles.css    plum and gold, drawn from the app icon
assets/       icon, favicon, app screenshot
```

## Design

- **Palette:** `#100e14` / `#0a0910` backgrounds, `#c9a227` gold, `#e6be49` bright gold, warm parchment text `#ece6dd`.
- **Type:** a system serif for display (New York / Iowan / Palatino), SF for body, a monospace only for search examples.
- **Idea:** a dark room with one warm, lit window. The app screenshot glows against the page and fades at its lower edge.
- Dark only, deliberately. No theme toggle, no nav menus, no scripts.

## Preview

Open `index.html` in a browser, or:

```
python3 -m http.server 8080
```

## Deploy

Drop the folder at the root of a GitHub Pages repo (e.g. `NET-Study/netstudy-sermons.github.io`) or serve it from any static host. Only relative paths are used, so it works from a subpath too.

The screenshot comes from the real app, rendered with the Tauri bridge shimmed against live SermonIndex data (`scripts/shot.mjs` in the app repo).
