export default function DateRangePicker({
  startDate,
  endDate,
  onChange,
  startId = 'date-range-start',
  endId = 'date-range-end',
  compact = false,
}) {
  const wrapperStyle = compact
    ? { display: 'contents' }
    : { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' };

  return (
    <div style={wrapperStyle} aria-label="Date range picker">
      <div className="form-group" style={{ marginBottom: 0, flex: '0 1 170px' }}>
        <label htmlFor={startId}>From</label>
        <input
          id={startId}
          className="form-input"
          type="date"
          name="start_date"
          value={startDate}
          onChange={onChange}
          aria-label="Start date"
        />
      </div>
      <div className="form-group" style={{ marginBottom: 0, flex: '0 1 170px' }}>
        <label htmlFor={endId}>To</label>
        <input
          id={endId}
          className="form-input"
          type="date"
          name="end_date"
          value={endDate}
          onChange={onChange}
          aria-label="End date"
        />
      </div>
    </div>
  );
}

