// File: frontend/src/pages/Slots.jsx
// SRS References: FR-04 (Page 6) — Browse Available Slots
// FR-05 (Pages 6-7) — Book an Appointment
// NFR Usability (Page 8) — "Booking flow completable in 3 or fewer clicks"
// Click 1: "Book" on SlotCard  →  Click 2: "Confirm" in modal  →  Done

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

export default function Slots() {
  const { api, isAuthenticated, user } = useAuth();

  // ── State ─────────────────────────────────────────────────────────────────
  const [slots, setSlots]           = useState([]);
  const [pagination, setPagination] = useState({ page: 1, total_pages: 1, total: 0 });
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [filters, setFilters]       = useState({ start_date: '', end_date: '' });

  // Booking modal state — for the 3-click flow
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [booking, setBooking]           = useState(false);
  const [bookResult, setBookResult]     = useState(null);
  const [bookError, setBookError]       = useState('');

  // ── Fetch slots ───────────────────────────────────────────────────────────
  const fetchSlots = useCallback(async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      const params = { page, limit: 12 };
      if (filters.start_date) params.start_date = filters.start_date;
      if (filters.end_date)   params.end_date   = filters.end_date;

      const { data } = await api.get('/slots', { params });
      setSlots(data.slots || []);
      setPagination(data.pagination || { page: 1, total_pages: 1, total: 0 });
    } catch {
      setError('Unable to load slots. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [api, filters]);

  useEffect(() => { fetchSlots(1); }, [fetchSlots]);

  // ── Book a slot (Click 2 — confirm) ───────────────────────────────────────
  // FR-05: POST /api/bookings
  const handleBookSlot = async () => {
    if (!selectedSlot) return;
    setBooking(true);
    setBookError('');
    setBookResult(null);

    try {
      const { data } = await api.post('/bookings', { slot_id: selectedSlot.id });
      setBookResult(data);
      // Refresh slot list to show updated capacity
      fetchSlots(pagination.page);
    } catch (err) {
      const msg = err.response?.data?.error || 'Booking failed. Please try again.';
      setBookError(msg);
    } finally {
      setBooking(false);
    }
  };

  // ── Filter handler ────────────────────────────────────────────────────────
  const handleFilterChange = (e) => {
    setFilters((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const applyFilters = (e) => {
    e.preventDefault();
    fetchSlots(1);
  };

  const clearFilters = () => {
    setFilters({ start_date: '', end_date: '' });
    setTimeout(() => fetchSlots(1), 0);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="main-content">
      <div className="dashboard-header">
        <h1>Available Slots</h1>
        <p>Browse and book your appointment in just a few clicks.</p>
      </div>

      {/* FR-04: Date-range filter */}
      <form onSubmit={applyFilters} style={{
        display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap',
        alignItems: 'flex-end', marginBottom: 'var(--space-xl)',
      }}>
        <div className="form-group" style={{ marginBottom: 0, flex: '1 1 180px' }}>
          <label htmlFor="filter-start">From Date</label>
          <input id="filter-start" className="form-input" type="date" name="start_date"
                 value={filters.start_date} onChange={handleFilterChange} />
        </div>
        <div className="form-group" style={{ marginBottom: 0, flex: '1 1 180px' }}>
          <label htmlFor="filter-end">To Date</label>
          <input id="filter-end" className="form-input" type="date" name="end_date"
                 value={filters.end_date} onChange={handleFilterChange} />
        </div>
        <button type="submit" className="btn btn-primary" style={{ width: 'auto', padding: '12px 24px' }}
                id="filter-apply">Filter</button>
        <button type="button" className="btn btn-secondary" style={{ padding: '12px 24px' }}
                onClick={clearFilters} id="filter-clear">Clear</button>
      </form>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <div className="spinner" style={{ margin: '0 auto 16px' }} />
          <p style={{ color: 'var(--clr-text-secondary)' }}>Loading slots…</p>
        </div>
      ) : slots.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: 'var(--space-3xl)',
          background: 'var(--clr-bg-glass)', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--clr-border)',
        }}>
          <div style={{ fontSize: '3rem', marginBottom: 'var(--space-md)' }}>📅</div>
          <h2 style={{ fontSize: 'var(--fs-lg)', marginBottom: 'var(--space-sm)' }}>No Slots Available</h2>
          <p style={{ color: 'var(--clr-text-secondary)' }}>Check back later or adjust your filters.</p>
        </div>
      ) : (
        /* Slot cards grid */
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: 'var(--space-lg)',
        }}>
          {slots.map((slot) => {
            const isFull = slot.remaining_capacity <= 0;
            return (
              <div key={slot.id} className="stat-card" style={{
                opacity: isFull ? 0.5 : 1,
                position: 'relative',
                overflow: 'hidden',
              }}>
                {/* FR-04: "display fully booked slots as unavailable" */}
                {isFull && (
                  <div style={{
                    position: 'absolute', top: 12, right: -30,
                    background: 'var(--clr-error)', color: '#fff',
                    fontSize: 'var(--fs-xs)', fontWeight: 700,
                    padding: '4px 40px', transform: 'rotate(35deg)',
                    textTransform: 'uppercase',
                  }}>Full</div>
                )}

                <div style={{ fontWeight: 700, fontSize: 'var(--fs-md)', marginBottom: 4 }}>{slot.title}</div>
                <div style={{ color: 'var(--clr-text-secondary)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--space-md)' }}>
                  📅 {new Date(slot.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}  •  🕐 {slot.start_time} – {slot.end_time}
                </div>

                {/* FR-04: "indicate remaining capacity" */}
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  marginBottom: 'var(--space-md)',
                }}>
                  <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--clr-text-secondary)' }}>
                    Capacity:
                  </span>
                  <span style={{
                    fontSize: 'var(--fs-sm)', fontWeight: 600,
                    color: isFull ? 'var(--clr-error)' : slot.remaining_capacity <= 2 ? 'var(--clr-warning)' : 'var(--clr-success)',
                  }}>
                    {slot.remaining_capacity} / {slot.capacity} remaining
                  </span>
                </div>

                {/* Capacity bar */}
                <div style={{
                  height: 4, borderRadius: 2, background: 'var(--clr-bg-input)',
                  marginBottom: 'var(--space-md)', overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%', borderRadius: 2,
                    width: `${(slot.booking_count / slot.capacity) * 100}%`,
                    background: isFull ? 'var(--clr-error)' : 'linear-gradient(90deg, var(--clr-gradient-start), var(--clr-gradient-end))',
                    transition: 'width 0.3s ease',
                  }} />
                </div>

                {/* NFR Usability: Click 1 — "Book This Slot" button */}
                {isAuthenticated && !isFull && (
                  <button
                    className="btn btn-primary"
                    style={{ padding: '10px 20px' }}
                    onClick={() => { setSelectedSlot(slot); setBookResult(null); setBookError(''); }}
                    id={`book-slot-${slot.id}`}
                  >
                    Book This Slot
                  </button>
                )}

                {!isAuthenticated && !isFull && (
                  <a href="/login" className="btn btn-secondary" style={{ width: '100%', textAlign: 'center' }}>
                    Sign in to Book
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {pagination.total_pages > 1 && (
        <div style={{
          display: 'flex', justifyContent: 'center', gap: 'var(--space-sm)',
          marginTop: 'var(--space-xl)',
        }}>
          <button className="btn btn-secondary" style={{ padding: '8px 16px' }}
                  disabled={pagination.page <= 1}
                  onClick={() => fetchSlots(pagination.page - 1)}>← Previous</button>
          <span style={{
            display: 'flex', alignItems: 'center',
            color: 'var(--clr-text-secondary)', fontSize: 'var(--fs-sm)',
          }}>
            Page {pagination.page} of {pagination.total_pages} ({pagination.total} slots)
          </span>
          <button className="btn btn-secondary" style={{ padding: '8px 16px' }}
                  disabled={pagination.page >= pagination.total_pages}
                  onClick={() => fetchSlots(pagination.page + 1)}>Next →</button>
        </div>
      )}

      {/* ── Booking Confirmation Modal — Click 2 ───────────────────────────── */}
      {/* NFR Usability: "Booking flow completable in 3 or fewer clicks" */}
      {selectedSlot && !bookResult && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: 'var(--space-md)',
        }} onClick={() => setSelectedSlot(null)}>
          <div className="auth-card" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: 'var(--fs-xl)', marginBottom: 'var(--space-md)', textAlign: 'center' }}>
              Confirm Booking
            </h2>

            <div style={{
              background: 'var(--clr-bg-card)', borderRadius: 'var(--radius-md)',
              padding: 'var(--space-lg)', marginBottom: 'var(--space-lg)',
            }}>
              <div style={{ marginBottom: 8 }}>
                <span style={{ color: 'var(--clr-text-secondary)', fontSize: 'var(--fs-sm)' }}>Service: </span>
                <strong>{selectedSlot.title}</strong>
              </div>
              <div style={{ marginBottom: 8 }}>
                <span style={{ color: 'var(--clr-text-secondary)', fontSize: 'var(--fs-sm)' }}>Date: </span>
                <strong>{new Date(selectedSlot.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--clr-text-secondary)', fontSize: 'var(--fs-sm)' }}>Time: </span>
                <strong>{selectedSlot.start_time} – {selectedSlot.end_time}</strong>
              </div>
            </div>

            {bookError && (
              <div className="alert alert-error" style={{ marginBottom: 'var(--space-md)' }}>{bookError}</div>
            )}

            <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }}
                      onClick={() => setSelectedSlot(null)} disabled={booking}>
                Cancel
              </button>
              {/* Click 2: Confirm */}
              <button className="btn btn-primary" style={{ flex: 1 }}
                      onClick={handleBookSlot} disabled={booking} id="confirm-booking">
                {booking ? <><span className="spinner" /> Booking…</> : 'Confirm Booking'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Booking Success ────────────────────────────────────────────────── */}
      {bookResult && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: 'var(--space-md)',
        }}>
          <div className="auth-card verify-card" style={{ maxWidth: 440 }}>
            <div className="verify-icon">✅</div>
            <h2 style={{ fontSize: 'var(--fs-xl)', marginBottom: 'var(--space-sm)' }}>Booking Confirmed!</h2>
            <p style={{ color: 'var(--clr-text-secondary)', marginBottom: 'var(--space-md)', fontSize: 'var(--fs-sm)' }}>
              Booking #{bookResult.booking?.id} — A confirmation email has been sent to {user?.email}.
            </p>
            <div style={{
              background: 'var(--clr-bg-card)', borderRadius: 'var(--radius-md)',
              padding: 'var(--space-lg)', marginBottom: 'var(--space-lg)', textAlign: 'left',
            }}>
              <div style={{ marginBottom: 6 }}><strong>{bookResult.booking?.slot_title}</strong></div>
              <div style={{ color: 'var(--clr-text-secondary)', fontSize: 'var(--fs-sm)' }}>
                {new Date(bookResult.booking?.slot_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })} • {bookResult.booking?.start_time} – {bookResult.booking?.end_time}
              </div>
            </div>
            <button className="btn btn-primary" onClick={() => { setSelectedSlot(null); setBookResult(null); }}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
