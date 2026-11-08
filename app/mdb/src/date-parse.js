function isoDate(year, month, day) {
  if (!Number.isInteger(year) || year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return null
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (day > days[month - 1]) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function monthFirst(locale) {
  const parts = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(new Date(Date.UTC(2026, 10, 7)))
  const order = parts.map((part) => part.type)
  return order.indexOf('month') < order.indexOf('day') && order.indexOf('year') > order.indexOf('day')
}

function monthNames(locale) {
  const names = new Map()
  for (const language of ['en', locale]) {
    for (const style of ['long', 'short']) {
      const standalone = new Intl.DateTimeFormat(language, { month: style })
      const inDate = new Intl.DateTimeFormat(language, { day: 'numeric', month: style, year: 'numeric' })
      for (let month = 1; month <= 12; month++) {
        const date = new Date(Date.UTC(2026, month - 1, 1))
        for (const name of [standalone.format(date), inDate.formatToParts(date).find((part) => part.type === 'month')?.value]) {
          if (name) names.set(name.toLowerCase().replace(/\.$/, ''), month)
        }
      }
    }
  }
  return names
}

function expandedYear(value) {
  const year = Number(value)
  return value.length === 2 ? (year < 50 ? 2000 + year : 1900 + year) : year
}

export function parsePastedDate(value, locale = 'en-US') {
  if (typeof value !== 'string') return null
  const text = value.trim().replace(/\u00a0/g, ' ')
  if (!text) return null

  const yearFirst = text.match(/^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i)
  if (yearFirst) return isoDate(Number(yearFirst[1]), Number(yearFirst[3]), Number(yearFirst[4]))
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (compact) return isoDate(Number(compact[1]), Number(compact[2]), Number(compact[3]))

  const yearLast = text.match(/^(\d{1,2})([-/.])(\d{1,2})\2(\d{2}|\d{4})$/)
  if (yearLast) {
    const first = Number(yearLast[1])
    const second = Number(yearLast[3])
    const useMonthFirst = first > 12 ? false : second > 12 ? true : monthFirst(locale)
    return isoDate(expandedYear(yearLast[4]), useMonthFirst ? first : second,
      useMonthFirst ? second : first)
  }

  const named = text.replace(/,/g, ' ').replace(/\s+/g, ' ').match(/^([\p{L}\p{M}.]+|\d{1,2}) ([\p{L}\p{M}.]+|\d{1,2}) (\d{2}|\d{4})$/u)
  if (named) {
    const names = monthNames(locale)
    const firstMonth = names.get(named[1].toLowerCase().replace(/\.$/, ''))
    const secondMonth = names.get(named[2].toLowerCase().replace(/\.$/, ''))
    if (firstMonth && /^\d{1,2}$/.test(named[2])) {
      return isoDate(expandedYear(named[3]), firstMonth, Number(named[2]))
    }
    if (secondMonth && /^\d{1,2}$/.test(named[1])) {
      return isoDate(expandedYear(named[3]), secondMonth, Number(named[1]))
    }
  }
  return null
}
