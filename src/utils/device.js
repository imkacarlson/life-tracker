export const isTouchOnlyDevice = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }

  const hasCoarsePointer = window.matchMedia('(any-pointer: coarse)').matches
  const hasFinePointer = window.matchMedia('(any-pointer: fine)').matches
  const hasHover =
    window.matchMedia('(any-hover: hover)').matches || window.matchMedia('(hover: hover)').matches

  return hasCoarsePointer && !hasFinePointer && !hasHover
}
