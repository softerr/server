import { noImageIcon } from './icons.js'
import { showMissingImageWhenUnavailable as attachMissingImage } from '@softerr/shared/missing-image.js'

export function showMissingImageWhenUnavailable(image) {
  attachMissingImage(image, { className: 'missing-image', icon: noImageIcon })
}
