import { noImageIcon } from './icons.js'

export function showMissingImageWhenUnavailable(image) {
  image.addEventListener('error', () => {
    const missing = document.createElement('span')
    missing.className = 'missing-image'
    missing.setAttribute('role', 'img')
    missing.setAttribute('aria-label', 'Missing image')
    missing.title = 'This image was deleted'
    missing.innerHTML = noImageIcon
    image.replaceWith(missing)
  }, { once: true })
}
