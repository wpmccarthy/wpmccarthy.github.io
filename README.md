# wpmccarthy.github.io

Personal site of Will McCarthy, a static site built with [Eleventy](https://www.11ty.dev/).

## Layout

```
notes/               Markdown notes (pinned/ and ideating/ subfolders)
_data/site.js        site name, tagline, author, allowed note types
_data/tagDefinitions.js  one-line definition per tag (see below)
_includes/           page layouts (base, post, page) and the post-meta macro
index.njk            home page: the linen canvas, one paint stain per note
paint/               the paint system (renderer, presets, layout, build + dev hooks);
                     design notes and open threads in paint/NOTES.md
studio/              paint studio and homepage arrange mode (local dev server only)
notes.njk            /notes/ — every note, grouped by folder
tags.njk             /tags/<slug>/ — one page per tag
about.md, ai.md      placeholder pages
css/style.css        all the styling
eleventy.config.js   collections, filters, RSS feed, note validation
deploy/              droplet setup, deploy script, Caddy and cron config
```

## Adding a note

Notes are living documents, not a dated feed. Create `notes/<url-slug>.md`; the filename becomes the URL (`notes/theory.md` → `/notes/theory/`). Subfolders don't change the URL.

- `notes/pinned/` — shown first on the home page and `/notes/`.
- `notes/ideating/` — notes still being written; listed under "Ideating" on `/notes/` only.
- `notes/` itself — everything else, listed under "Notes".

```markdown
---
title: Theory
tags:
  - About
---
Write the note here, in plain Markdown.
```

- `title` is required.
- `draft: true` hides a note everywhere (no page, no listings, no feed). Remove it to publish.
- `type` is optional; if set it must be `sketch`, `essay` or `experiment`.
- `date` is optional and only shown if set.
- `order` is optional; notes sort by `order`, then title.
- `tags` are free text. Each one gets a URL slug automatically ("AI in the studio" → `/tags/ai-in-the-studio/`). Two spellings that produce the same slug fail the build, so pick one.

A note that breaks these rules fails the build with a message naming the file.

### Paint

On the home page each note is a soft rectangle of oil paint staining the linen; the
same stain is the ground the note's text sits on when it's opened. Stains are
rendered when the site is built (cached in `.cache/paint/`), from a seed, so everyone
sees the same thing. Longer notes get taller shapes.

Run `npm start` and open **http://localhost:8080/studio/** to work on them:

- pick a note, apply a preset, click through seed variations;
- tune each pigment (colour, how much, how far it travels past the edge, tideline,
  mottling, wicking along the threads…). Pigments are listed bottom to top and mix
  like real glazes, so one that spreads further than the one above it shows as a
  separate band at the edge;
- **Save to note** writes a `paint:` block into the note's front matter. If the look is
  exactly a preset, it only stores `preset:` and `seed:`, so later edits to that preset
  reach the note. **Use defaults** removes the block again.

**Presets and defaults** live in `paint/settings.json`. In the studio, **Save as preset…**
stores the current look; tick **default** on any presets you want new notes to pick from
(one per note, chosen by filename, so ticking several gives a range); **Make default for
all…** saves the look and makes it the only default. Notes without a `paint:` block, or
whose preset was deleted, follow the defaults — handy while experimenting, since
changing the defaults restyles all of them at once.

The `paint:` block and `settings.json` are both fine to edit by hand; field meanings
are at the top of `paint/params.js`.

To arrange the home page, open http://localhost:8080/ while `npm start` is running,
click **Arrange** (bottom right), drag tiles by their text to move them and by the
round handle to resize (up/down changes the shape; double-click it to go back to a
shape from the note's length), click a small corner dot to put the title in that
corner, then **Save layout**. This writes `place: { x, y, w, text }` into each note
(in % of the canvas width: left, top, tile width; `text` is the title corner), and
`tall` into its `paint:` block if you changed the shape. Notes without `place` are
fitted into free space automatically. On phones the tiles stack in top-to-bottom
order, keeping their relative sizes and sideways positions.

The studio and the save endpoints only exist on the local dev server; `npm run build`
never includes them.

### Tag definitions

Add a line to `_data/tagDefinitions.js` for each tag:

```js
"AI in the studio": "Experiments using AI in my art practice.",
```

The definition appears under the heading on that tag's page (`/tags/ai-in-the-studio/`) and as a tooltip when you hover over the tag anywhere on the site. Tags without a definition still work; they just show no description.

## Preview locally

Requires Node 20 or newer.

```sh
npm install
npm start          # http://localhost:8080, reloads as you edit
npm run build      # writes the site to _site/
```

## Deploy

The site is served from a DigitalOcean droplet by [Caddy](https://caddyserver.com/), which gets and renews the HTTPS certificate for keepsharpening.com automatically.

### One-time setup

1. Create an Ubuntu 24.04 droplet.
2. Point DNS at it: `A` records (and `AAAA` if you use IPv6) for `keepsharpening.com` and `www.keepsharpening.com`.
3. Push this repo somewhere the droplet can clone from. If the repo is private, add a [deploy key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys) for the `keepsharpening` user and use the SSH clone URL.
4. SSH in as root and run the setup script:

   ```sh
   git clone <repo-url> /opt/keepsharpening
   bash /opt/keepsharpening/deploy/setup-droplet.sh <repo-url>
   ```

   This installs Node 20, Caddy, git and rsync, creates a `keepsharpening` user, builds the site into `/var/www/keepsharpening`, and installs the Caddy config, the daily cron job and log rotation. It's safe to run again.

Once DNS has propagated, Caddy fetches the certificate on the first request. `http://` and `www.` redirect to `https://keepsharpening.com`.

### Publishing changes

Push to `main`, then:

```sh
ssh root@keepsharpening.com 'sudo -u keepsharpening /opt/keepsharpening/deploy/deploy.sh'
```

`deploy.sh` pulls `main`, runs `npm ci` only if `package-lock.json` changed, builds from scratch, and rsyncs `_site/` to the web root. If the build fails, the live site is left as it was.

### Daily rebuild

The "last 30 days" cutoff on the home page is computed when the site is built. So `/etc/cron.d/keepsharpening` runs `deploy.sh` every day at 04:15 server time (UTC by default). That run also picks up anything pushed to `main` since the last deploy. Logs are in `/var/log/keepsharpening/deploy.log`.

If you change `deploy/Caddyfile`, copy it into place and reload Caddy:

```sh
cp /opt/keepsharpening/deploy/Caddyfile /etc/caddy/Caddyfile && systemctl reload caddy
```

## Adding the logo later

The header link in `_includes/base.njk` is marked as the logo slot. Replace the text with an inline `<svg>` that has an `aria-label` or `<title>`. `.site-logo svg` in `css/style.css` sets its height.
