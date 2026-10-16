---
name: brag
description: Write a brag list — a plain-language summary of what was shipped — from this repo's git history. Use when the user types /brag, or asks for a brag doc, a recap of recent work, "what did we ship", or highlights for a standup, review or status post. Optional args name the window (e.g. "last week", "since 2026-10-01", "since round24-tag") and/or an author.
---

# /brag — what got shipped

Turn git history into a short, honest list of wins a person can paste into a
standup, a review or a Slack post.

## 1. Pick the window

- Args give a window ("last week", "since 2026-10-01", a tag or commit) → use it.
- No args → the last 30 days.
- An author in the args → add `--author=<name>`; otherwise include everyone.

## 2. Read the history

```bash
git log --since=<date> --pretty='%ad %h %s' --date=short   # or <ref>..HEAD
git rev-parse --is-shallow-repository                     # true = history is cut off
git log --pretty='%ad' --date=short | tail -1             # earliest commit actually present
```

- If the clone is shallow and starts after the requested window, say so up
  front and report the range you actually covered. Do not imply the rest.
- Skim `feat`, `fix`, `perf` and merge subjects. Skip `chore`, pure `test`
  and `docs` commits unless they are the story (a new gate, a shipped record).
- For a big item, read its record doc (the repo's `FLY_*.md` files, named in
  `CLAUDE.md`) or `git show --stat <sha>` before you describe it. Never
  guess from a subject line alone.

## 3. Write it

- Open with one line: the project, the date range and the commit count.
- Group by theme (a feature area or workstream), 3–6 groups, with a bold
  heading per group and 2–6 bullets under it.
- Each bullet is an outcome a player or the owner would notice, in plain
  words. Expand internal names the first time (a flag like `LOUNGE_WALK`
  gets "the lounge walk, now on").
- Name what shipped ON separately from what landed behind an OFF flag.
- End with a short **Bugs squashed** group, then one line on anything still
  unverified. In this repo every fps and look verdict belongs to the owner's
  machines, not the cloud container.
- No line-count or "insertions" stats: generated assets swamp them.
- Use exact numbers that come from the record (39 liveries, 10th aircraft).
  Never invent one.

## 4. Offer, don't push

After the list, offer in one line to (a) publish it as a shareable page, or
(b) trim it to a 3-line standup or Slack version. Do neither unasked.
