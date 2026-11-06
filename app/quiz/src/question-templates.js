export const questionTypes = {
  multiple_choice: 'Multiple choice',
  one_choice: 'One choice',
  number: 'Number',
  short_answer: 'Short answer',
  open: 'Open',
  true_false: 'True/false',
  yes_no: 'Yes/no',
  show_answer: 'Show answer',
  no_answer: 'No answer',
  match: 'Match',
  ordering: 'Ordering',
  fill_blanks: 'Fill in the blanks',
  categorize: 'Categorize',
}

export const templateHints = {
  multiple_choice: 'Select several answers',
  one_choice: 'Select one answer',
  number: 'Enter a number',
  short_answer: 'Enter a short answer',
  open: 'Write a free response',
  true_false: 'Choose true or false',
  yes_no: 'Choose yes or no',
  show_answer: 'Reveal the answer',
  no_answer: 'Question only',
  match: 'Match terms and definitions',
  ordering: 'Put items in sequence',
  fill_blanks: 'Complete missing words',
  categorize: 'Sort items into groups',
}

function templateIcon(content) {
  return `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`
}

export const templateIcons = {
  multiple_choice: templateIcon('<rect x="9" y="12" width="10" height="10" rx="1"/><path d="m11 17 3 3 6-7M27 17h27"/><rect x="9" y="27" width="10" height="10" rx="1"/><path d="M27 32h27"/><rect x="9" y="42" width="10" height="10" rx="1"/><path d="m11 47 3 3 6-7M27 47h27"/>'),
  one_choice: templateIcon('<circle cx="14" cy="17" r="5"/><path d="M27 17h27"/><circle cx="14" cy="32" r="5"/><circle cx="14" cy="32" r="2" fill="currentColor" stroke="none"/><path d="M27 32h27"/><circle cx="14" cy="47" r="5"/><path d="M27 47h27"/>'),
  number: templateIcon('<path d="M22 11 15 53M43 11l-7 42M10 26h46M7 39h46"/>'),
  short_answer: templateIcon('<path d="M9 48h46M10 34h25M37 43l14-14 4 4-14 14-6 2 2-6Z"/>'),
  open: templateIcon('<path d="M10 16h43M10 27h38M10 38h30M37 50l12-12 4 4-12 12-6 2 2-6Z"/>'),
  true_false: templateIcon('<rect x="8" y="15" width="48" height="34" rx="5"/><path d="M32 15v34"/><text x="20" y="38" fill="currentColor" stroke="none" font-size="17" font-weight="700" text-anchor="middle">T</text><text x="44" y="38" fill="currentColor" stroke="none" font-size="17" font-weight="700" text-anchor="middle">F</text>'),
  yes_no: templateIcon('<rect x="8" y="15" width="48" height="34" rx="5"/><path d="M32 15v34"/><text x="20" y="38" fill="currentColor" stroke="none" font-size="17" font-weight="700" text-anchor="middle">Y</text><text x="44" y="38" fill="currentColor" stroke="none" font-size="17" font-weight="700" text-anchor="middle">N</text>'),
  show_answer: templateIcon('<path d="M7 32s9-13 25-13 25 13 25 13-9 13-25 13S7 32 7 32Z"/><circle cx="32" cy="32" r="6"/>'),
  no_answer: templateIcon('<path d="M25 24a8 8 0 1 1 12 7c-4 2-5 4-5 8"/><circle cx="32" cy="49" r="2" fill="currentColor" stroke="none"/>'),
  match: templateIcon('<rect x="7" y="12" width="14" height="14" rx="2"/><rect x="43" y="12" width="14" height="14" rx="2"/><rect x="7" y="38" width="14" height="14" rx="2"/><rect x="43" y="38" width="14" height="14" rx="2"/><path d="M21 19h22M21 45h22"/>'),
  ordering: templateIcon('<path d="M15 15h38M15 31h38M15 47h38M8 11v8M8 27v8M8 43v8"/>'),
  fill_blanks: templateIcon('<path d="M8 17h16M40 17h16M25 21h14M8 43h12M44 43h12M21 47h22"/>'),
  categorize: templateIcon('<rect x="7" y="9" width="21" height="46" rx="2"/><rect x="36" y="9" width="21" height="46" rx="2"/><path d="M12 20h11M12 29h11M41 20h11M41 29h11M41 38h11"/>'),
}

