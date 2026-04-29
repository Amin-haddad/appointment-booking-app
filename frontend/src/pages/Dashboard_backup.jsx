// File: frontend/src/pages/Dashboard.jsx
// SRS References: FR-07 (Page 7) — View Booking History (client)
// FR-04 (Page 6) — Browse Available Slots (preview)
// NFR Usability (Page 8) — responsive layout

import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import DateRangePicker from '../components/DateRangePicker.jsx';

export default function Dashboard() {
  const { user, api } = useAuth();
  const [bookings, setBookings]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [stats, setStats]         = useState({ total: 0, confirmed: 0, cancelled: 0 });
  const [notifications, setNotifications] = useState([]);
  const [filters, setFilters] = useState({
    status: '',
    start_date: '',
    end_date: '',
    page: 1,
    limit: 10,
  });
  function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}
  const [pagination, setPagination] = useState({ page: 1, total_pages: 1, total: 0, limit: 10 });

  async function fetchBookings(nextFilters = filters) {
    setLoading(true);
    setError('');
    try {
      const params = {
        page: nextFilters.page,
        limit: nextFilters.limit,
      };
      if (nextFilters.status) params.status = nextFilters.status;
      if (nextFilters.start_date) params.start_date = nextFilters.start_date;
      if (nextFilters.end_date) params.end_date = nextFilters.end_date;

      const { data } = await api.get('/bookings', { params });
      const list = data.bookings || [];
      setBookings(list);
      setPagination(data.pagination || { page: 1, total_pages: 1, total: 0, limit: nextFilters.limit });
      setStats({
        total: list.length,
        confirmed: list.filter((b) => b.status === 'confirmed').length,
        cancelled: list.filter((b) => b.status === 'cancelled').length,
      });
    } catch (err) {
      if (err.response?.status === 404) {
        setBookings([]);
      } else {
        setError('Unable to load bookings. Please try again later.');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await fetchBookings({ ...filters, page: 1 });
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.error || 'Unable to load bookings.');
        }
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/notifications', { params: { status: 'unread', limit: 5 } });
        if (!cancelled) {
          setNotifications(data.notifications || []);
        }
      } catch {
        if (!cancelled) {
          setNotifications([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [api]);

  async function markNotificationRead(id) {
    try {
      await api.patch(`/notifications/${id}/read`);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    } catch {
      // No-op
    }
  }

  async function cancelBooking(bookingId) {
    try {
      await api.delete(`/bookings/${bookingId}`, {
        data: { cancellation_reason: 'Cancelled by client' },
      });

      await fetchBookings(filters);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to cancel booking.');
    }
  }

  function handleFilterChange(e) {
    const { name, value } = e.target;
    setFilters((prev) => ({ ...prev, [name]: value }));
  }

  async function applyFilters(e) {
    e.preventDefault();
    const next = { ...filters, page: 1 };
    setFilters(next);
    await fetchBookings(next);
  }

  async function changePage(page) {
    const next = { ...filters, page };
    setFilters(next);
    await fetchBookings(next);
  }

  async function changePageSize(limit) {
    const next = { ...filters, limit, page: 1 };
    setFilters(next);
    await fetchBookings(next);
  }

  return (
    <div className="main-content">
      {/* Header */}
      <div className="dashboard-header">
        <h1>My Dashboard</h1>
        <p>Welcome back, {user?.full_name}. Manage your appointments below.</p>
      </div>

      {/* Stats Grid — FR-07 overview */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">Total Bookings</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ background: 'linear-gradient(135deg, #11998e, #38ef7d)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            {stats.confirmed}
          </div>
          <div className="stat-label">Confirmed</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ background: 'linear-gradient(135deg, #f5576c, #ff6b6b)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            {stats.cancelled}
          </div>
          <div className="stat-label">Cancelled</div>
        </div>
      </div>

      <form
        onSubmit={applyFilters}
        style={{ display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 'var(--space-xl)' }}
        aria-label="Booking history filters"
      >
        <div className="form-group" style={{ marginBottom: 0, flex: '0 1 160px' }}>
          <label htmlFor="dashboard-status-filter">Status</label>
          <select
            id="dashboard-status-filter"
            name="status"
            className="form-input"
            value={filters.status}
            onChange={handleFilterChange}
            aria-label="Filter by booking status"
          >
            <option value="">All</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        <DateRangePicker
          startDate={filters.start_date}
          endDate={filters.end_date}
          onChange={handleFilterChange}
          startId="dashboard-start-date"
          endId="dashboard-end-date"
          compact
        />

        <button className="btn btn-primary" style={{ width: 'auto', padding: '12px 20px' }} type="submit" aria-label="Apply booking filters">
          Apply
        </button>
      </form>

      {notifications.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', marginBottom: 'var(--space-xl)' }}>
          {notifications.map((note) => (
            <div key={note.id} className="alert alert-warning" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-md)' }}>
              <div>
                <strong>{note.title}</strong>
                <div style={{ fontSize: 'var(--fs-sm)' }}>{note.message}</div>
              </div>
              <button className="btn btn-secondary" style={{ width: 'auto', padding: '8px 12px' }} onClick={() => markNotificationRead(note.id)} aria-label={`Dismiss notification ${note.id}`}>
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Booking List */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <div className="spinner" style={{ margin: '0 auto 16px' }} />
          <p style={{ color: 'var(--clr-text-secondary)' }}>Loading your bookings…</p>
        </div>
      )}

      {error && (
        <div className="alert alert-error" role="alert">{error}</div>
      )}

      {!loading && !error && bookings.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: 'var(--space-3xl)',
          background: 'var(--clr-bg-glass)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--clr-border)',
        }}>
          <div style={{ fontSize: '3rem', marginBottom: 'var(--space-md)' }}>📅</div>
          <h2 style={{ fontSize: 'var(--fs-lg)', marginBottom: 'var(--space-sm)' }}>
            No Bookings Yet
          </h2>
          <p style={{ color: 'var(--clr-text-secondary)', marginBottom: 'var(--space-lg)' }}>
            Browse available slots to make your first appointment.
          </p>
          <a href="/" className="btn btn-primary" style={{ width: 'auto', padding: '12px 28px' }} id="dashboard-browse">
            Browse Slots
          </a>
        </div>
      )}

      {!loading && !error && bookings.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          {bookings.map((booking) => (
            <div
              key={booking.id}
              className="stat-card"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 'var(--space-md)',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 'var(--fs-md)', marginBottom: 4 }}>
                  {booking.slot_title || `Booking #${booking.id}`}
                </div>
                <div style={{ color: 'var(--clr-text-secondary)', fontSize: 'var(--fs-sm)' }}>
                  {new Date(booking.slot_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })} • {booking.start_time} – {booking.end_time}
                </div>
              </div>
              <div>
                <span style={{
                  display: 'inline-block',
                  padding: '4px 12px',
                  borderRadius: 'var(--radius-full)',
                  fontSize: 'var(--fs-xs)',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  background: booking.status === 'confirmed' ? 'var(--clr-success-bg)' : 'var(--clr-error-bg)',
                  color: booking.status === 'confirmed' ? 'var(--clr-success)' : 'var(--clr-error)',
                  border: `1px solid ${booking.status === 'confirmed' ? 'rgba(56,239,125,0.2)' : 'rgba(245,87,108,0.2)'}`,
                }}>
                  {booking.status}
                </span>
                {booking.status === 'confirmed' && (
                  <button
                    className="btn btn-danger"
                    style={{ marginLeft: 'var(--space-sm)', padding: '6px 10px', fontSize: 'var(--fs-xs)' }}
                    onClick={() => cancelBooking(booking.id)}
                    aria-label={`Cancel booking ${booking.id}`}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && pagination.total_pages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-md)', marginTop: 'var(--space-xl)', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="dashboard-page-size">Rows per page</label>
            <select
              id="dashboard-page-size"
              className="form-input"
              value={filters.limit}
              onChange={(e) => changePageSize(Number(e.target.value))}
              aria-label="Select bookings per page"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
            <button
              className="btn btn-secondary"
              style={{ width: 'auto', padding: '8px 16px' }}
              onClick={() => changePage(Math.max(1, pagination.page - 1))}
              disabled={pagination.page <= 1}
              aria-label="Previous bookings page"
            >
              ← Previous
            </button>
            <span style={{ color: 'var(--clr-text-secondary)', fontSize: 'var(--fs-sm)' }}>
              Page {pagination.page} of {pagination.total_pages} ({pagination.total} total)
            </span>
            <button
              className="btn btn-secondary"
              style={{ width: 'auto', padding: '8px 16px' }}
              onClick={() => changePage(Math.min(pagination.total_pages, pagination.page + 1))}
              disabled={pagination.page >= pagination.total_pages}
              aria-label="Next bookings page"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
