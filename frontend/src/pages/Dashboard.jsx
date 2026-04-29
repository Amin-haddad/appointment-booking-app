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
    fetchBookings({ ...filters, page: 1 });
  }, [api]);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/notifications', { params: { status: 'unread', limit: 5 } });
        setNotifications(data.notifications || []);
      } catch {
        setNotifications([]);
      }
    })();
  }, [api]);

  async function markNotificationRead(id) {
    try {
      await api.patch(`/notifications/${id}/read`);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    } catch {}
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
      <div className="dashboard-header">
        <h1>My Dashboard</h1>
        <p>Welcome back, {user?.full_name}. Manage your appointments below.</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">Total Bookings</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.confirmed}</div>
          <div className="stat-label">Confirmed</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.cancelled}</div>
          <div className="stat-label">Cancelled</div>
        </div>
      </div>

      <form onSubmit={applyFilters} style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
        <div className="form-group">
          <label>Status</label>
          <select name="status" className="form-input" value={filters.status} onChange={handleFilterChange}>
            <option value="">All</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        <DateRangePicker
          startDate={filters.start_date}
          endDate={filters.end_date}
          onChange={handleFilterChange}
        />

        <button className="btn btn-primary" type="submit">Apply</button>
      </form>

      {notifications.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          {notifications.map((note) => (
            <div key={note.id} className="alert alert-warning" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <strong>{note.title}</strong>
                <div>{note.message}</div>
              </div>
              <button className="btn btn-secondary" onClick={() => markNotificationRead(note.id)}>Dismiss</button>
            </div>
          ))}
        </div>
      )}

      {loading && <div style={{ textAlign: 'center', padding: '2rem' }}>Loading...</div>}

      {error && <div className="alert alert-error">{error}</div>}

      {!loading && !error && bookings.length === 0 && (
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <h2>No Bookings Yet</h2>
          <p>Browse available slots to make your first appointment.</p>
          <a href="/slots" className="btn btn-primary">Browse Slots</a>
        </div>
      )}

      {!loading && !error && bookings.length > 0 && (
        <div>
          {bookings.map((booking) => (
            <div key={booking.id} className="stat-card" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{booking.slot_title || `Booking #${booking.id}`}</div>
                <div style={{ color: '#666' }}>
                  {new Date(booking.slot_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })} • {booking.start_time} – {booking.end_time}
                </div>
              </div>
              <div>
                <span style={{
                  padding: '4px 12px',
                  borderRadius: '20px',
                  background: booking.status === 'confirmed' ? '#e8f5e9' : '#ffebee',
                  color: booking.status === 'confirmed' ? '#2e7d32' : '#c62828',
                }}>
                  {booking.status}
                </span>
                {booking.status === 'confirmed' && (
                  <button className="btn btn-danger" style={{ marginLeft: '1rem' }} onClick={() => cancelBooking(booking.id)}>
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && pagination.total_pages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '2rem' }}>
          <button onClick={() => changePage(pagination.page - 1)} disabled={pagination.page <= 1}>Previous</button>
          <span>Page {pagination.page} of {pagination.total_pages}</span>
          <button onClick={() => changePage(pagination.page + 1)} disabled={pagination.page >= pagination.total_pages}>Next</button>
        </div>
      )}
    </div>
  );
}