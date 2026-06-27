# Chrome Web Store listing

Copy/paste content for the Web Store developer dashboard, plus the answers for
the Privacy practices tab. Everything here reflects the shipped extension —
nothing claims a feature it doesn't have.

---

## Product name

```
Comment Names for Regulations.gov (Unofficial)
```

## Summary (short description — max 132 chars)

```
See who submitted each comment on Regulations.gov, and filter the comment list by submitter type or attachment. Unofficial.
```

## Category

Productivity

## Language

English (United States)

---

## Detailed description

```
Comment Names for Regulations.gov shows you WHO submitted each public comment —
the organization or person's name — right on the comment list, where
Regulations.gov normally shows only a generic "Comment on …" title and an ID.

This is an unofficial, independent tool. It is not affiliated with, or endorsed
by, Regulations.gov, the U.S. General Services Administration, or any government
agency.

WHAT IT DOES

• Adds the submitter's name (organization or individual) under each comment on
  any Regulations.gov comment list / overview page.
• Shows the substance of each comment inline: the comment text, or a link to the
  attached document (PDF, etc.) when the submission is an upload.
• Adds a "Commenter" section to the site's own Refine Results panel that lets you
  filter the ENTIRE docket — not just the current page — by:
    – Submitter type: organizations, individuals, or anonymous
    – Submission format: has a document, or inline text only
  Matching comments are rendered right in the main list, each titled with the
  commenter's name and linking to the comment and its document.

WHY AN API KEY IS NEEDED

Regulations.gov serves the submitter name only in its detail API, not on the
list page. So the extension uses the official Regulations.gov API, which needs a
free key:

  1. Click the extension icon, then "Get a free key" to open the official
     api.data.gov signup page.
  2. Enter your name and email; the key is shown instantly and emailed to you.
  3. Paste it into the extension popup. It's validated against the live API and
     saved locally.

One free key works across all Regulations.gov pages. Results are cached locally
for 30 days, and requests are throttled to respect the API's rate limits.

PRIVACY

No analytics. No tracking. No data sent to the developer or any third party.
Your API key is stored locally in your browser and is only ever sent to the
official Regulations.gov API. Full policy:
https://github.com/healthbjk/regs-names/blob/main/PRIVACY.md

OPEN SOURCE

Source code: https://github.com/healthbjk/regs-names
```

---

## URLs

- **Homepage / Support:** https://github.com/healthbjk/regs-names
- **Privacy policy:** https://github.com/healthbjk/regs-names/blob/main/PRIVACY.md

---

## Single purpose (dashboard field)

```
This extension has a single purpose: to enhance Regulations.gov public-comment
pages by showing the submitter's name and letting the user filter the comment
list by submitter type or attachment.
```

## Permission justifications (dashboard fields)

**storage**
```
Stores the user's Regulations.gov API key, and caches public comment data
fetched from the official API for 30 days to reduce repeat requests. Stored
locally; nothing is sent to the developer.
```

**Host permission — https://api.regulations.gov/***
```
The extension calls the official Regulations.gov API over this host to retrieve
the submitter name, comment text, and attachment links that the site does not
include on its comment list pages. The API key is sent only to this host.
```

**Content script — https://www.regulations.gov/***
```
Injects the submitter name, comment text/attachment links, and the filter
controls into Regulations.gov comment pages. This is the only site the extension
modifies.
```

**Remote code:** No. All logic is contained in the extension package.

---

## Privacy practices tab

**What user data do you collect?**
- The extension stores the user's API key locally and sends it only to the
  official Regulations.gov API for authentication. It is not collected by, or
  transmitted to, the developer or any third party.
- If the dashboard requires selecting a category for this, choose
  **"Authentication information"**, and note in the justification that it is used
  solely to authenticate requests to the first-party Regulations.gov API and is
  never sent to the developer.

**Justification text for Authentication information:**
```
The user provides their own Regulations.gov API key. It is stored locally
(chrome.storage.sync) and attached only to requests to the official
https://api.regulations.gov API. It is never transmitted to the developer or any
third party, and is used solely to enable the extension's stated functionality.
```

**Required certifications (check all three):**
- ✅ I do not sell or transfer user data to third parties, outside of the
  approved use cases.
- ✅ I do not use or transfer user data for purposes that are unrelated to my
  item's single purpose.
- ✅ I do not use or transfer user data to determine creditworthiness or for
  lending purposes.

---

## Graphic assets checklist

- [x] Store icon — 128×128 (`icons/icon128.png`)
- [ ] Screenshots — 1280×800 (or 640×400), 1–5 images (see `store-assets/`)
- [ ] Small promo tile — 440×280 (optional, recommended)
- [ ] Marquee promo — 1400×560 (optional)

Suggested screenshot captions:
1. "See who submitted each comment — name, organization, and the comment itself."
2. "Filter the whole docket by submitter type or attachment, right in the list."
3. "One-time setup with a free official API key."
