# Suggested feedback to GSA / Regulations.gov

Paste one of these into the Regulations.gov feedback/support form
(<https://www.regulations.gov/support>) to ask for the feature natively. The
more people send it, the stronger the demand signal.

---

## Short version (one line)

```
Please show each commenter's name/organization on the comment list (overview)
page — today it only appears after clicking into each comment.
```

---

## Full version

```
Subject: Show commenter name/organization on the comment list view

On a document's comment list (e.g. /document/.../comment), each comment shows
only "Public Submission", a generic title, the agency, the posted date, and an
ID. To find out WHO submitted a comment — the organization or individual — you
have to open each comment one at a time, even though that information is already
available in the comment detail API (organization / firstName / lastName).

Two improvements would make the comment list far more usable, especially for
high-volume dockets:

1. Display the submitter's name/organization on each comment card in the list.
2. Add a filter for submitter type (organization vs. individual) and for whether
   the submission includes an attachment.

For context on the demand: enough people want this that a community browser
extension already adds it by calling the public API once per comment. You can
see that client in your api.data.gov request logs via the header
"X-Regs-Names-Client: regs-names-extension". Surfacing this data natively would
remove the need for those extra per-comment API calls and help everyone
reviewing dockets.

Thank you for considering it.
```

---

## Why the header reference matters

The extension sends an `X-Regs-Names-Client` header on every API request. If a
GSA engineer searches their logs for it after receiving this feedback, the
passive footprint and the explicit request line up — turning "some traffic" into
"a named, understood use case."
