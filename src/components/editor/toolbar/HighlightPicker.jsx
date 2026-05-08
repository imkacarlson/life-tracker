function HighlightPicker({ pickerRef, colors, onPick }) {
  return (
    <div className="highlight-picker" ref={pickerRef}>
      <div className="highlight-grid">
        {colors.flatMap((row) =>
          row.map((swatch) => (
            <button
              key={swatch.label}
              type="button"
              className="highlight-swatch"
              style={{ backgroundColor: swatch.value }}
              onClick={() => onPick(swatch.value)}
              aria-label={swatch.label}
            />
          )),
        )}
      </div>
      <button type="button" className="highlight-none" onClick={() => onPick(null)}>
        No Color
      </button>
    </div>
  )
}

export default HighlightPicker
