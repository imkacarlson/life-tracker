function AiDailyPicker({ pickerRef, date, onPrevDay, onNextDay, onDateChange }) {
  return (
    <div className="ai-daily-picker" ref={pickerRef}>
      <div className="ai-daily-date-nav">
        <button type="button" onClick={onPrevDay}>&#8249;</button>
        <span className="ai-daily-date-label">
          {date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </span>
        <button type="button" onClick={onNextDay}>&#8250;</button>
      </div>
      <input
        type="date"
        value={date.toLocaleDateString('en-CA')}
        onChange={(e) => onDateChange(e.target.value)}
        className="ai-daily-date-input"
      />
    </div>
  )
}

export default AiDailyPicker
