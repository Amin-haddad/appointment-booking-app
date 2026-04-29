// File: frontend/src/pages/AdminBookings.jsx
// SRS References: FR-07 Admin (Page 7), FR-06 (Page 7)
// FR-07: "Administrators shall see all bookings across all clients,
//         with the ability to filter by client name, date range, and status"
// FR-06: "Administrators may also cancel bookings on behalf of clients"

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import DateRangePicker from '../components/DateRangePicker.jsx';

export default function AdminBookings() {
  const { api } = useAuth();

  const [bookings, setBookings]     = useState([]);
  const [pagination, setPagination] = useState({ page: 1, total_pages: 1, total: 0 });
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [filters, setFilters]       = useState({
    client_query: '', start_date: '', end_date: '', status: '', limit: 20,
  });

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchBookings = useCallback(async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      const params = { page, limit: 20 };
      params.limit = filters.limit;
      if (filters.client_query) params.client_query = filters.client_query;
      if (filters.start_date)  params.start_date  = filters.start_date;
      if (filters.end_date)    params.end_date    = filters.end_date;
      if (filters.status)      params.status      = filters.status;

      const { data } = await api.get('/admin/bookings', { params });
      setBookings(data.bookings || []);
      setPagination(data.pagination || { page: 1, total_pages: 1, total: 0 });
    } catch {
      setError('Failed to load bookings.');
    } finally {
      setLoading(false);
    }
  }, [api, filters]);

  useEffect(() => { fetchBookings(1); }, [fetchBookings]);

  // ── Cancel booking — FR-06 Admin ──────────────────────────────────────────
  const handleCancel = async (bookingId) => {
    if (!window.confirm('Cancel this booking? The client will be notified.')) return;
    try {
      await api.delete(`/bookings/${bookingId}`, {
        data: { cancellation_reason: 'Cancelled by administrator' },
      });
      fetchBookings(pagination.page);
    } catch (err) {
      setError(err.response?.data?.error || 'Cancellation failed.');
    }
  };

  const handleFilterChange = (e) => {
    setFilters((p) => ({ ...p, [e.target.name]: e.target.value }));
  };

  return (
    <div className="main-content">
      <div className="dashboard-header">
        <h1>All Bookings</h1>
        <p>View and manage bookings across all clients.</p>
      </div>

      {/* FR-07: "filter by client name, date range, and status" */}
      <form onSubmit={(e) => { e.preventDefault(); fetchBookings(1); }}
            style={{
              display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap',
              alignItems: 'flex-end', marginBottom: 'var(--space-xl)',
            }}>
        <div className="form-group" style={{ marginBottom: 0, flex: '1 1 180px' }}>
          <label htmlFor="f-client">Client Name / Email</label>
          <input id="f-client" className="form-input" name="client_query"
                 value={filters.client_query} onChange={handleFilterChange}
                 placeholder="Search by name or email…"
                 aria-label="Search bookings by client name or email" />
        </div>
        <div className="form-group" style={{ marginBottom: 0, flex: '0 1 160px' }}>
          <label htmlFor="f-status">Status</label>
          <select id="f-status" className="form-input" name="status"
                  value={filters.status} onChange={handleFilterChange}
                  aria-label="Filter bookings by status">
            <option value="">All</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <DateRangePicker
          startDate={filters.start_date}
          endDate={filters.end_date}
          onChange={handleFilterChange}
          startId="f-start"
          endId="f-end"
          compact
        />
        <div className="form-group" style={{ marginBottom: 0, flex: '0 1 120px' }}>
          <label htmlFor="f-limit">Page size</label>
          <select
            id="f-limit"
            className="form-input"
            name="limit"
            value={filters.limit}
            onChange={(e) => setFilters((p) => ({ ...p, limit: Number(e.target.value) }))}
            aria-label="Bookings page size selector"
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
        </div>
        <button type="submit" className="btn btn-primary"
                style={{ width: 'auto', padding: '12px 20px' }} aria-label="Apply admin booking filters">Filter</button>
      </form>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
        </div>
      ) : bookings.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--clr-text-secondary)' }}>
          No bookings found.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{
            width: '100%', borderCollapse: 'separate', borderSpacing: 0,
            background: 'var(--clr-bg-glass)', borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--clr-border)', overflow: 'hidden',
          }}>
            <thead>
              <tr>
                {['#', 'Client', 'Slot', 'Date', 'Time', 'Status', 'Booked At', 'Actions'].map((h) => (
                  <th key={h} style={{
                    padding: '12px 14px', textAlign: 'left', fontSize: 'var(--fs-xs)',
                    fontWeight: 600, color: 'var(--clr-text-secondary)',
                    textTransform: 'uppercase', borderBottom: '1px solid var(--clr-border)',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id} style={{ borderBottom: '1px solid var(--clr-border)' }}>
                  <td style={{ padding: '10px 14px', fontSize: 'var(--fs-sm)' }}>{b.id}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ fontWeight: 500, fontSize: 'var(--fs-sm)' }}>{b.client_name}</div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--clr-text-secondary)' }}>{b.client_email}</div>
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 'var(--fs-sm)' }}>{b.slot_title}</td>
                  <td style={{ padding: '10px 14px', fontSize: 'var(--fs-sm)' }}>{new Date(b.slot_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                  <td style={{ padding: '10px 14px', fontSize: 'var(--fs-sm)' }}>
                    {b.start_time} – {b.end_time}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{
                      padding: '3px 10px', borderRadius: 'var(--radius-full)',
                      fontSize: 'var(--fs-xs)', fontWeight: 600,
                      background: b.status === 'confirmed' ? 'var(--clr-success-bg)' : 'var(--clr-error-bg)',
                      color: b.status === 'confirmed' ? 'var(--clr-success)' : 'var(--clr-error)',
                    }}>
                      {b.status}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 'var(--fs-xs)', color: 'var(--clr-text-secondary)' }}>
                    {new Date(b.booked_at).toLocaleString()}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    {b.status === 'confirmed' && (
                      <button className="btn btn-danger" style={{ padding: '4px 12px', fontSize: 'var(--fs-xs)' }}
                              onClick={() => handleCancel(b.id)}
                              aria-label={`Cancel booking ${b.id}`}>
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pagination.total_pages > 1 && (
        <div style={{
          display: 'flex', justifyContent: 'center', gap: 'var(--space-sm)', marginTop: 'var(--space-xl)',
        }}>
          <button className="btn btn-secondary" style={{ padding: '8px 16px' }}
                  disabled={pagination.page <= 1}
                  onClick={() => fetchBookings(pagination.page - 1)}
                  aria-label="Previous bookings page">← Previous</button>
          <span style={{ display: 'flex', alignItems: 'center', color: 'var(--clr-text-secondary)', fontSize: 'var(--fs-sm)' }}>
            Page {pagination.page} of {pagination.total_pages} ({pagination.total} total)
          </span>
          <button className="btn btn-secondary" style={{ padding: '8px 16px' }}
                  disabled={pagination.page >= pagination.total_pages}
                  onClick={() => fetchBookings(pagination.page + 1)}
                  aria-label="Next bookings page">Next →</button>
        </div>
      )}
    </div>
  );
}
