# News posts

One markdown file per post, named `YEAR_MONTH_title.md` (e.g. `2025_12_foresttrace-at-agu-2025.md`).
Files are picked up automatically at build time — no list to update. The part of the
file name after `YEAR_MONTH_` becomes the post's link id, so keep it unique.

```markdown
---
tag: Presentation
title: ForestTrace at AGU 2025
date: 2025-12
summary: One or two sentences shown on the landing page and the news list.
---

Full content, shown when the post is opened. Regular **markdown**: paragraphs,
lists, links, images, headings.
```

- `date` is `YYYY-MM` (or `YYYY-MM-DD`); posts are sorted newest first and shown as "December 2025".
- The landing page shows the four most recent posts; the News page shows all of them.
- This README is ignored (only `YYYY_MM_*.md` files are loaded).
