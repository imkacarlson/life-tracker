function ShadingPicker({
  pickerRef,
  themeRows,
  standardColors,
  shadingColor,
  customInputRef,
  onPick,
  onOpenCustom,
  onCustomChange,
}) {
  const isActive = (color) =>
    shadingColor?.toLowerCase() === color.toLowerCase()

  return (
    <div className="shading-picker" ref={pickerRef}>
      <div className="shading-section">
        <p className="shading-header">Theme Colors</p>
        <div className="shading-grid">
          {themeRows.map((row, rowIndex) =>
            row.map((color, colIndex) => (
              <button
                key={`theme-${rowIndex}-${colIndex}`}
                type="button"
                className={`shading-swatch ${isActive(color) ? 'active' : ''}`}
                style={{ backgroundColor: color }}
                onClick={() => onPick(color)}
                aria-label={`Theme color ${rowIndex + 1}-${colIndex + 1}`}
              />
            )),
          )}
        </div>
      </div>
      <div className="shading-section">
        <p className="shading-header">Standard Colors</p>
        <div className="shading-grid shading-grid-standard">
          {standardColors.map((color, index) => (
            <button
              key={`standard-${color}`}
              type="button"
              className={`shading-swatch ${isActive(color) ? 'active' : ''}`}
              style={{ backgroundColor: color }}
              onClick={() => onPick(color)}
              aria-label={`Standard color ${index + 1}`}
            />
          ))}
        </div>
      </div>
      <div className="shading-actions">
        <button type="button" className="shading-action" onClick={() => onPick(null)}>
          <span className="shading-icon" aria-hidden="true" />
          No Color
        </button>
        <button type="button" className="shading-action" onClick={onOpenCustom}>
          <span className="shading-icon palette" aria-hidden="true" />
          More Colors...
        </button>
        <input
          ref={customInputRef}
          type="color"
          className="shading-input"
          onChange={onCustomChange}
          aria-label="Custom shading color"
        />
      </div>
    </div>
  )
}

export default ShadingPicker
