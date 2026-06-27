# Privacy Policy — Comment Names for Regulations.gov (Unofficial)

_Last updated: 2026-06-27_

This browser extension is **unofficial** and is not affiliated with, or endorsed
by, Regulations.gov, the U.S. General Services Administration, or any government
agency.

## Short version

The extension does **not** collect, transmit, sell, or share your personal data
with the developer or any third party. It has no analytics, no tracking, and no
developer-operated servers. The only network requests it makes are to the
official Regulations.gov API (`https://api.regulations.gov`).

## What data the extension handles

**Your Regulations.gov API key.**
- You obtain a free key from api.data.gov and paste it into the extension's
  popup.
- It is stored locally in your browser via `chrome.storage.sync` (which, if you
  have Chrome Sync enabled, Google syncs across your own signed-in devices —
  this is the same mechanism your bookmarks use).
- The key is sent **only** to `https://api.regulations.gov` as the `api_key`
  query parameter required to authenticate API requests. It is never sent to the
  developer or anyone else.
- You can remove it at any time by clearing the field in the popup, or by
  removing the extension.

**Client identifier (no personal data).**
- Each API request includes a static `X-Regs-Names-Client` header identifying
  the extension and its version (e.g. `regs-names-extension/1.1.0`). This
  identifies the *software*, not you — it contains no personal or device data —
  and exists so the operator of the API (GSA) can see this client's usage in
  their own logs. It is sent only to `https://api.regulations.gov`.

**Public comment data.**
- When you view a Regulations.gov comment page, the extension requests comment
  details (submitter name/organization, comment text, attachment links) from the
  official API and displays them on the page you are already viewing.
- This is public record data served by the government API. It is processed in
  your browser to render the on-page enhancements and is cached locally (in
  `chrome.storage.local`) for up to 30 days to reduce API calls. It is not
  transmitted anywhere.

## What the extension does NOT do

- No analytics or telemetry.
- No advertising or tracking identifiers.
- No selling or sharing of any data.
- No collection of browsing history, form inputs, passwords, or any data from
  sites other than the Regulations.gov pages it enhances.
- No remote code: all logic ships inside the extension package.

## Permissions

- `storage` — to save your API key and cache public comment data locally.
- Host access to `https://api.regulations.gov/*` — to make the authenticated API
  requests that power the features.
- Content script on `https://www.regulations.gov/*` — to add names, comment
  text/attachment links, and the filter controls to comment pages.

## Contact

Questions or issues: https://github.com/healthbjk/regs-names/issues
