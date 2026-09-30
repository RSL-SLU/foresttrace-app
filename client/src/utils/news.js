import { useEffect, useState } from 'react';
import { marked } from 'marked';

/**
 * News posts, one markdown file each in src/content/news/ named
 * YEAR_MONTH_title.md (see the README there for the format).
 *
 * require.context finds the files at build time, so adding a post is adding a
 * file. CRA emits .md files as static assets, so each resolves to a URL and is
 * fetched once, then cached for the session.
 */
const context = require.context('../content/news', false, /^\.\/\d{4}_\d{2}_.+\.md$/);

let newsPromise = null;

// `key: value` lines between --- fences, then the markdown body.
function parsePost(raw, file) {
  const text = raw.replace(/\r\n/g, '\n');
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta = {};
  if (match) {
    match[1].split('\n').forEach((line) => {
      const i = line.indexOf(':');
      if (i === -1) return;
      const key = line.slice(0, i).trim();
      const value = line.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
      if (key) meta[key] = value;
    });
  }
  const body = (match ? match[2] : text).trim();

  // From the file name: YEAR_MONTH_slug.md
  const [, year, month, slug] = file.match(/(\d{4})_(\d{2})_(.+)\.md$/);
  const [y, m] = (meta.date || `${year}-${month}`).split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, 1);

  return {
    slug,
    tag: meta.tag || '',
    title: meta.title || slug,
    summary: meta.summary || '',
    date,
    dateLabel: date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    html: marked.parse(body),
  };
}

/** All posts, newest first. */
export function loadNews() {
  if (!newsPromise) {
    newsPromise = Promise.all(context.keys().map(async (file) => {
      const res = await fetch(context(file));
      if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
      return parsePost(await res.text(), file);
    }))
      .then((posts) => posts.sort((a, b) => b.date - a.date))
      .catch((err) => {
        newsPromise = null;   // let a later mount retry
        throw err;
      });
  }
  return newsPromise;
}

/** Posts for a component: [] until loaded (or if loading fails). */
export function useNews() {
  const [posts, setPosts] = useState([]);
  useEffect(() => {
    let cancelled = false;
    loadNews()
      .then((loaded) => { if (!cancelled) setPosts(loaded); })
      .catch((err) => console.warn('[news] failed to load posts:', err));
    return () => { cancelled = true; };
  }, []);
  return posts;
}
