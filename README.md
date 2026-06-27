# Regulations.gov Commenter Names

A Chrome (MV3) extension that shows **who submitted each comment** — the
organization or person's name — directly on regulations.gov comment list /
overview pages.

By default those list pages only show "Public Submission · Comment on
CMS-…-0001 · Agency · Posted · ID", with no submitter name. This extension
fetches the name from the regulations.gov public API and injects it under each
comment's title.

## Why an API key is needed

regulations.gov is a client-side (Ember) app and the list pages genuinely don't
contain the submitter name — it only exists in the comment **detail** record,
which is served from the regulations.gov API v4 (`/v4/comments/{id}`). That API
requires a free key. Getting one takes about a minute and the extension makes
it nearly hands-free:

1. Click the extension's toolbar icon, then **Get a free key** — it opens the
   official signup page.
2. Enter your name & email and submit. The key (a global api.data.gov key that
   works for regulations.gov) appears instantly.
3. **The extension detects the new key on that page and saves it for you**
   automatically — a banner confirms "You're all set!". No copy/paste.

You can always paste a key manually into the popup instead; it's validated
against the live API and saved on success. On comment pages, the "Set an API
key" prompt is clickable and opens this setup.

The free key allows ~1,000 requests/hour, which is 40 list pages/hour. Results
are cached locally for 30 days so revisiting pages costs nothing.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Click the extension's icon and follow the one-minute key setup above.
5. Visit any comment list page, e.g.
   `https://www.regulations.gov/document/CMS-2026-1255-0001/comment`.

Each comment card will gain a line like `🏢 Acme Health Systems` or
`👤 Jane Doe`. Comments with no name show `— no name provided —`.

Below the name, each card also shows the substance of the submission:

- **If the comment is an uploaded document**, a link to the attachment, e.g.
  `📎 Acme comment letter (PDF)` (opens the file in a new tab). Multiple
  attachments are listed, separated by `·`.
- **Otherwise**, the inline comment text (truncated, with the full text on
  hover).

### Filter the whole docket

The site's own **Refine Results** panel (left sidebar) gains a **Commenter**
section with two filters:

- **Submitter type** — organizations / individuals / anonymous
- **Submission format** — has a document / inline text only

Click **Show matching comments →** to load every comment in the docket once and
open a results drawer listing the matches (each links to the comment and its
document). After loading, changing either filter updates the count and the
drawer instantly — no further fetching.

The filters live in Refine Results (rather than a separate panel) so there's a
single, obvious place to filter. Loading is opt-in/click-triggered because the
site paginates 25/page server-side and the API has no organization/attachment
facet, so the drawer must fetch every comment's detail once (uses API quota;
results are cached 30 days, so subsequent opens are fast). The status line shows
`<matches> match · <loaded>/<total> loaded`, with a **Retry failed** button if
any requests were rate-limited. Dockets over 5,000 comments are capped at the
first 5,000 (API limit).

## How it works

- `content.js` finds `a[href*="/comment/"]` cards, extracts the comment ID, and
  asks the background worker for the name. A `MutationObserver` re-scans on
  pagination / SPA navigation.
- `background.js` calls `/v4/comments/{id}?include=attachments` (from the
  service worker, using `host_permissions` to avoid CORS), derives a display
  name from `organization` / `firstName` / `lastName`, plus the inline comment
  text and any attachment file URLs, caches it, and throttles to 4 concurrent
  requests.
- `options.html/js` is the popup: a "Get a free key" button, live key
  validation, and storage in `chrome.storage.sync`.
- `keycapture.js` runs on the signup pages (`open.gsa.gov/api/regulationsgov`,
  `api.data.gov/signup`), detects the newly issued 40-char key, validates it via
  the background worker, and saves it — automatically if no key is set, or with
  a confirm if replacing an existing one.

## Design decisions

### Whole-docket filtering is opt-in, not automatic

Filtering by submitter type or attachment can't be done server-side (no API
facet) and the list only renders 25 cards at a time, so a full-docket filter
requires fetching every comment's detail. That's gated behind an explicit
button rather than run on page load, to avoid silently spending API quota.

### Considered and rejected: per-organization comment counts

An obvious-seeming extension would be a "how many comments came from each org"
tally. We deliberately left it out.

- The org name isn't in the list payload or in any API facet, so a *complete*
  count would require fetching every comment's detail record (N calls per
  docket) — there's no server-side "group by organization".
- More importantly, the feature isn't worth it even for free: organizations
  almost never submit the same docket twice, so a per-org count collapses to
  "1 each" — i.e. the comment list you already have, with extra steps and extra
  API quota spent.

If a use case ever needs it (e.g. de-duping near-identical form-letter
campaigns from individuals, where repetition *is* the signal), the right
approach is to piggyback counts onto the name fetches the badge already makes
and show a "breakdown of comments loaded so far" — never a dedicated full scan.

## Notes / limits

- Mass / form-letter campaigns and truly anonymous submissions often have no
  name on the record — those show "no name provided".
- If you see `⏳ API rate limit hit`, you've exceeded the hourly quota; it
  recovers on its own.
