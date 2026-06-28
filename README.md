# Comment Names for Regulations.gov (Unofficial)

A Chrome (MV3) extension that shows **who submitted each comment** — the
organization or person's name — directly on regulations.gov comment list /
overview pages.

> **Unofficial.** Not affiliated with or endorsed by Regulations.gov, the GSA,
> or any government agency. See [PRIVACY.md](PRIVACY.md).

By default those list pages only show "Public Submission · Comment on
CMS-…-0001 · Agency · Posted · ID", with no submitter name. This extension
fetches the name from the regulations.gov public API and injects it under each
comment's title.

## Why an API key is needed

regulations.gov is a client-side (Ember) app and the list pages genuinely don't
contain the submitter name — it only exists in the comment **detail** record,
which is served from the regulations.gov API v4 (`/v4/comments/{id}`). That API
requires a free key. Getting one takes about a minute:

1. Click the extension's toolbar icon, then **Get a free key** — it opens the
   official api.data.gov signup page.
2. Enter your name & email and submit. The key (a global api.data.gov key that
   works for regulations.gov) is shown instantly and emailed to you.
3. Copy it and paste it into the extension popup. It's validated against the
   live API and saved on success. On comment pages, the "Set an API key" prompt
   is clickable and opens this setup.

The key is stored locally (`chrome.storage.sync`) and is only ever sent to the
official regulations.gov API. The Regulations.gov **commenting API allows 50
requests/minute and 500/hour**, so results are cached locally for 30 days and
requests are throttled with backoff to stay within those limits.

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
- **Sort by** — posted order (default), or submitter name A–Z / Z–A

Choosing a filter, or any sort other than "Posted", **takes over the main comment
list in place**:
the native (25-per-page) list and pager are hidden, the whole docket is loaded
once, and the matching comments render as cards in the same column — each titled
with the commenter's name and linking to the comment and its document. A summary
bar shows `<matches> match · <loaded>/<total> loaded` with **Clear filters** and,
if any loads were rate-limited, **Retry failed**. Set both filters back to "All"
to restore the native list.

This all happens client-side because the site paginates 25/page server-side and
the API has no organization/attachment facet — and the native "Sort by" is a
server-side control that can't sort by submitter name (not an API sort field).
So the extension fetches every comment's detail once (uses API quota; cached 30
days, so later filtering/sorting is instant), then filters and sorts the full set
in the browser. Dockets over 5,000 comments are capped at the first 5,000 (API
limit).

### See an organization's other comments

Every organization submission shows a **↪ More comments from this organization**
link (on the comment cards and in the filtered view). Clicking it searches *all*
of Regulations.gov for that org's other submissions and lists them in place —
each linking to the comment and the rule it was filed on.

Because the API has **no organization field to query**, this works by full-text
searching the org's name (one cheap request) and then **verifying candidates
against each comment's `organization` field in batches of 20**, so mere mentions
are filtered out and the API rate limits stay comfortable. Verified submissions
render as you go, with a **Check next 20** button to pull more on demand.

One honest limit, noted in the results: **attachment-only submissions can be
missed** — if an org uploads a PDF with body text like "See attached", the name
isn't in the searchable text, so the search won't find it.

## How it works

- `content.js` finds `a[href*="/comment/"]` cards, extracts the comment ID, and
  asks the background worker for the name. A `MutationObserver` re-scans on
  pagination / SPA navigation.
- `background.js` calls `/v4/comments/{id}?include=attachments` (from the
  service worker, using `host_permissions` to avoid CORS), derives a display
  name from `organization` / `firstName` / `lastName`, plus the inline comment
  text and any attachment file URLs, caches it, and throttles to 4 concurrent
  requests.
- `options.html/js` is the popup: a "Get a free key" button (opens the official
  signup page), live key validation, and storage in `chrome.storage.sync`.
- `icons/` holds the toolbar/store icons, generated by `scripts/make-icons.js`.

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
