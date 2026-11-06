export function versionHeader(version, kind = 'v') {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('Reload this item before changing it.')
  return { 'If-Match': `"${kind}${version}"` }
}

export async function loadJson(requestJson, method, path, data, responseError, headers = {}) {
  const [response, payload] = await requestJson(method, path, data, headers)
  if (!response.ok) throw new Error(responseError(response, payload))
  return payload
}
