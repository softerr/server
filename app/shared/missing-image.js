export function showMissingImageWhenUnavailable(image, { className, icon, title = 'This image was deleted' }) {
  image.addEventListener('error', () => {
    const missing = document.createElement('span')
    missing.className = className
    missing.setAttribute('role', 'img')
    missing.setAttribute('aria-label', 'Missing image')
    missing.title = title
    missing.innerHTML = icon
    image.replaceWith(missing)
  }, { once: true })
}
