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
requires a free key.

1. Go to <https://open.gsa.gov/api/regulationsgov/> and click "Request an API
   key" (it's an api.data.gov signup — instant, emailed to you).
2. Load the extension (below), click its toolbar icon, paste the key, Save.

The free key allows ~1,000 requests/hour, which is 40 list pages/hour. Results
are cached locally for 30 days so revisiting pages costs nothing.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Click the extension's icon and enter your API key.
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

## How it works

- `content.js` finds `a[href*="/comment/"]` cards, extracts the comment ID, and
  asks the background worker for the name. A `MutationObserver` re-scans on
  pagination / SPA navigation.
- `background.js` calls `/v4/comments/{id}?include=attachments` (from the
  service worker, using `host_permissions` to avoid CORS), derives a display
  name from `organization` / `firstName` / `lastName`, plus the inline comment
  text and any attachment file URLs, caches it, and throttles to 4 concurrent
  requests.
- `options.html/js` stores the API key in `chrome.storage.sync`.

## Design decisions

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
