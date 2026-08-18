export const CLIENT_CODES = {
  REGISTRY_RESPONSE_STALE: 'REGISTRY_RESPONSE_STALE',
}

export function newTraceId() {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint8Array(6)
    crypto.getRandomValues(buf)
    let hex = ''
    for (let i = 0; i < buf.length; i++) hex += buf[i].toString(16).padStart(2, '0')
    return 'tr_' + hex
  }
  return 'tr_' + Math.random().toString(16).slice(2, 10) + Date.now().toString(16).slice(-4)
}

export function formatObserveFail(data, fallback) {
  const msg = (data && (data.error || data.message)) || fallback || 'failed'
  const code = data && data.code
  const tr = data && data.traceId
  if (code && tr) return msg + '（' + code + ' · ' + tr + '）'
  if (code) return msg + '（' + code + '）'
  return String(msg)
}
