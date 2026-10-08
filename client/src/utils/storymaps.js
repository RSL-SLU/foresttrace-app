/** Story maps API (see api/storymaps.js). */

function headers(token, json = false) {
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request(path, token, options = {}) {
  const res = await fetch(path, { ...options, headers: headers(token, Boolean(options.body)) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status})`);
  return data;
}

export const listStoryMaps = (token) =>
  request('/api/storymaps?action=list', token).then((d) => d.stories || []);

export const generateStoryMap = (token, { context, angle, audience }) =>
  request('/api/storymaps?action=generate', token, {
    method: 'POST', body: JSON.stringify({ context, angle, audience }),
  }).then((d) => d.story);

export const setStoryMapPublic = (token, id, isPublic) =>
  request('/api/storymaps?action=update', token, {
    method: 'POST', body: JSON.stringify({ id, isPublic }),
  }).then((d) => d.story);

export const deleteStoryMap = (token, id) =>
  request('/api/storymaps?action=delete', token, { method: 'POST', body: JSON.stringify({ id }) });

// /stories/<username>/<title-slug> (the API returns the path)
export const publicStoryUrl = (story) => `${window.location.origin}${story.path}`;

/**
 * Opens a story in a new tab. Private stories need the session token, which a
 * plain link can't carry, so the page is fetched and shown from a blob URL.
 * The tab is opened synchronously, inside the click, so popup blockers allow
 * it; it's pointed at the page once the HTML arrives.
 */
export function openStoryMap(token, id) {
  const tab = window.open('', '_blank');
  if (tab) tab.document.title = 'Opening story map…';
  return fetch(`/api/storymaps?action=html&id=${encodeURIComponent(id)}`, { headers: headers(token) })
    .then(async (res) => {
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/html' }));
      if (tab) tab.location.href = url;
      else window.location.href = url;
    })
    .catch((err) => {
      tab?.close();
      throw err;
    });
}
