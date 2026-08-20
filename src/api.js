async function j(res) { const d = await res.json(); if (!res.ok) throw new Error(d.error || res.status); return d }

export const fetchLocations = () => fetch('/api/photos/locations').then(j).then((d) => d.locations)
export const fetchPhotos = (filter = {}) => {
  const q = new URLSearchParams()
  for (const k of ['province', 'city', 'county', 'orderBy']) if (filter[k]) q.set(k, filter[k])
  return fetch(`/api/photos?${q}`).then(j).then((d) => d.photos)
}
export const uploadPhotos = (files) => {
  const fd = new FormData()
  for (const f of files) fd.append('photos', f)
  return fetch('/api/photos', { method: 'POST', body: fd }).then(j).then((d) => d.photos)
}
export const setPhotoLocation = (id, loc) =>
  fetch(`/api/photos/${id}/location`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(loc) }).then(j).then((d) => d.photo)
