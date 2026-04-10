let tokenRef = ''

export function setApiToken(t: string) {
  tokenRef = t
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${tokenRef}`,
      'Content-Type': 'application/json',
    },
  }
  if (body) opts.body = JSON.stringify(body)

  const res = await fetch(`/api${path}`, opts)

  if (res.status === 401) {
    localStorage.removeItem('admin_token')
    window.location.reload()
    throw new Error('Unauthorized')
  }

  const data = await res.json()
  if (!res.ok && res.status !== 202) throw new Error(data.error || 'Request failed')
  return data as T
}
