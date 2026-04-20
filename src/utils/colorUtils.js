export const hexToRgb = (hex) => {
  const normalized = hex.replace('#', '')
  const value =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => char + char)
          .join('')
      : normalized
  const intValue = parseInt(value, 16)
  return {
    r: (intValue >> 16) & 255,
    g: (intValue >> 8) & 255,
    b: intValue & 255,
  }
}

export const toHex = (value) => value.toString(16).padStart(2, '0')

export const mixColors = (base, mixWith, amount) => {
  const a = hexToRgb(base)
  const b = hexToRgb(mixWith)
  const mix = (start, end) => Math.round(start * (1 - amount) + end * amount)
  return `#${toHex(mix(a.r, b.r))}${toHex(mix(a.g, b.g))}${toHex(mix(a.b, b.b))}`
}
