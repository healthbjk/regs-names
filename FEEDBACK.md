# Suggested feedback to GSA / Regulations.gov

Send one of the messages below to ask GSA to build this into Regulations.gov.
The more people send it, the stronger the demand signal.

## Where to send it (verified)

In rough order of ease:

1. **Help Desk email — `regulationshelpdesk@gsa.gov`** (easiest; no form/CAPTCHA).
   Paste the full version below.
2. **Help Desk form — <https://www.regulations.gov/support>** ("Contact the Help
   Desk"). It states it's *"used only to submit questions regarding the
   Regulations.gov website"* — i.e. the right place for site feedback. Requires
   name/email and a reCAPTCHA.
3. **"Give Feedback" tab** — the blue tab on the right edge of any
   Regulations.gov page (quick site-feedback widget).
4. Help Desk phone: **1-866-498-2945** (Mon–Fri, 9am–5pm ET).

For a deeper/programmatic conversation, the eRulemaking Program Management Office
(`eRulemaking@gsa.gov`) owns the platform, but the Help Desk is the right first
stop for a feature request.

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
