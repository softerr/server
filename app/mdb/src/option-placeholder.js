export function optionPlaceholder(className, createRow, text = 'Add option', isDisabled = () => false) {
  const placeholder = document.createElement('div')
  placeholder.className = className
  const input = document.createElement('input')
  input.type = 'text'
  input.placeholder = text
  input.setAttribute('aria-label', text)
  input.addEventListener('focus', () => {
    if (isDisabled()) { input.blur(); return }
    createRow().focus()
  })
  placeholder.addEventListener('click', (event) => {
    if (event.target === placeholder) input.focus()
  })
  placeholder.append(input)
  return placeholder
}
