export function createPageNotice(container) {
  const notice = document.createElement('div')
  notice.className = 'page-notice'
  notice.hidden = true
  notice.setAttribute('role', 'status')
  const message = document.createElement('span')
  message.className = 'page-notice-message'
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'page-notice-close'
  close.setAttribute('aria-label', 'Dismiss message')
  close.textContent = '×'
  notice.append(message, close)
  container.prepend(notice)

  let timeoutId = null
  function clear() {
    if (timeoutId !== null) window.clearTimeout(timeoutId)
    timeoutId = null
    notice.hidden = true
    message.textContent = ''
  }
  function show(text, kind = 'success') {
    if (!container.isConnected) return
    clear()
    notice.dataset.kind = kind
    notice.setAttribute('role', kind === 'error' ? 'alert' : 'status')
    message.textContent = text
    notice.hidden = false
    if (kind === 'success') timeoutId = window.setTimeout(clear, 8000)
  }
  close.addEventListener('click', clear)
  return { show, clear }
}
