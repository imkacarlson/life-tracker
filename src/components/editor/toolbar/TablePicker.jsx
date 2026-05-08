import { useMemo } from 'react'

function TablePicker({
  pickerRef,
  size,
  setSize,
  onInsert,
  onClose,
  gridSize = 5,
}) {
  const grid = useMemo(
    () =>
      Array.from({ length: gridSize }, (_, rowIndex) =>
        Array.from({ length: gridSize }, (_, colIndex) => ({
          row: rowIndex + 1,
          col: colIndex + 1,
        })),
      ),
    [gridSize],
  )

  return (
    <>
      <div className="table-picker-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="table-picker" ref={pickerRef}>
        <div className="table-picker-grid">
          {grid.map((row) =>
            row.map((cell) => {
              const isActive = cell.row <= size.rows && cell.col <= size.cols
              return (
                <div
                  key={`${cell.row}-${cell.col}`}
                  className={`table-picker-cell ${isActive ? 'active' : ''}`}
                  onMouseEnter={() => setSize({ rows: cell.row, cols: cell.col })}
                  onClick={() => onInsert(cell.row, cell.col)}
                />
              )
            }),
          )}
        </div>
        <div className="table-picker-label">
          {size.rows} × {size.cols}
        </div>
      </div>
    </>
  )
}

export default TablePicker
