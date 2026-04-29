// File: frontend/src/pages/AdminSlots.jsx
// SRS References: FR-03 (Pages 5-6) — Slot Creation
// FR-09 (Page 7) — Slot Deletion with booking safeguard
// FR-08 (Page 7) — Admin slot overview

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

export default function AdminSlots() {
  const { api } = useAuth();

  const [slots, setSlots]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [showCreate, setShowCreate] = useState(false);

  // ── Create form state ─────────────────────────────────────────────────────
  const [form, setForm] = useState({
    title: '', date: '', start_time: '', end_time: '', capacity: 1,
  });
  const [creating, setCreating]       = useState(false);
  const [createError, setCreateError] = useState('');
  const [createSuccess, setCreateSuccess] = useState('');

  // ── Fetch all slots ───────────────────────────────────────────────────────
  const fetchSlots = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/schedule');
      setSlots(data.slots || []);
    } catch {
      setError('Failed to load slots.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { fetchSlots(); }, [fetchSlots]);

  // ── Create slot — FR-03 ───────────────────────────────────────────────────
  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    setCreateError('');
    setCreateSuccess('');

    try {
      const { data } = await api.post('/admin/slots', form);
      setCreateSuccess(`Slot "${data.slot?.title}" created.`);
      setForm({ title: '', date: '', start_time: '', end_time: '', capacity: 1 });
      fetchSlots();
    } catch (err) {
      const d = err.response?.data;
      if (err.response?.status === 409) {
        setCreateError(
          `Conflicts with existing slot: "${d?.conflicting_slot?.title}" ` +
          `(${d?.conflicting_slot?.start_time} – ${d?.conflicting_slot?.end_time})`
        );
      } else {
        setCreateError(d?.error || 'Failed to create slot.');
      }
    } finally {
      setCreating(false);
    }
  };

  // ── Delete slot — FR-09 ───────────────────────────────────────────────────
  const handleDelete = async (slotId) => {
    try {
      await api.delete(`/admin/slots/${slotId}`, {
        data: {},
      });
      fetchSlots();
    } catch (err) {
      const d = err.response?.data;
      if (err.response?.status === 409 && d?.code === 'HAS_ACTIVE_BOOKINGS') {
        setError(`Cannot delete slot: ${d.active_booking_count} active booking(s) exist. Cancel those bookings first.`);
      } else {
        setError(d?.error || 'Delete failed.');
      }
    }
  };

  return (
    <div className="main-content">
      <div className="dashboard-header">
        <h1>Slot Management</h1>
        <p>Create, view, and manage appointment slots.</p>
      </div>

      {/* Toggle create form */}
      <button className="btn btn-primary" style={{ width: 'auto', padding: '12px 28px', marginBottom: 'var(--space-xl)' }}
              onClick={() => setShowCreate(!showCreate)} id="toggle-create-slot">
        {showCreate ? '✕ Close' : '+ Create Slot'}
      </button>

      {/* ── Create Slot Form — FR-03 ─────────────────────────────────────── */}
      {showCreate && (
        <div className="auth-card" style={{ maxWidth: 600, marginBottom: 'var(--space-xl)' }}>
          <h2 style={{ fontSize: 'var(--fs-lg)', marginBottom: 'var(--space-lg)' }}>New Slot</h2>

          {createError && <div className="alert alert-error">{createError}</div>}
          {createSuccess && <div className="alert alert-success">{createSuccess}</div>}

          <form onSubmit={handleCreate}>
            <div className="form-group">
              <label htmlFor="slot-title">Title</label>
              <input id="slot-title" className="form-input" value={form.title}
                     onChange={(e) => setForm(p => ({ ...p, title: e.target.value }))}
                     placeholder="e.g. Morning Consultation" required />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-md)' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="slot-date">Date</label>
                <input id="slot-date" className="form-input" type="date" value={form.date}
                       onChange={(e) => setForm(p => ({ ...p, date: e.target.value }))} required />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="slot-start">Start Time</label>
                <input id="slot-start" className="form-input" type="time" value={form.start_time}
                       onChange={(e) => setForm(p => ({ ...p, start_time: e.target.value }))} required />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="slot-end">End Time</label>
                <input id="slot-end" className="form-input" type="time" value={form.end_time}
                       onChange={(e) => setForm(p => ({ ...p, end_time: e.target.value }))} required />
              </div>
            </div>
            <div className="form-group" style={{ marginTop: 'var(--space-md)' }}>
              <label htmlFor="slot-capacity">Capacity</label>
              <input id="slot-capacity" className="form-input" type="number" min="1" max="1000"
                     value={form.capacity}
                     onChange={(e) => setForm(p => ({ ...p, capacity: parseInt(e.target.value, 10) || 1 }))} />
            </div>
            <button type="submit" className="btn btn-primary" disabled={creating} id="submit-create-slot">
              {creating ? <><span className="spinner" /> Creating…</> : 'Create Slot'}
            </button>
          </form>
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      {/* ── Slot Table ────────────────────────────────────────────────────── */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <div className="spinner" style={{ margin: '0 auto 16px' }} />
        </div>
      ) : slots.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--clr-text-secondary)' }}>
          No slots created yet.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{
            width: '100%', borderCollapse: 'separate', borderSpacing: 0,
            background: 'var(--clr-bg-glass)', borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--clr-border)', overflow: 'hidden',
          }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--clr-border)' }}>
                {['Title', 'Date', 'Time', 'Capacity', 'Fill', 'Status', 'Actions'].map((h) => (
                  <th key={h} style={{
                    padding: '12px 16px', textAlign: 'left', fontSize: 'var(--fs-xs)',
                    fontWeight: 600, color: 'var(--clr-text-secondary)',
                    textTransform: 'uppercase', letterSpacing: '0.5px',
                    borderBottom: '1px solid var(--clr-border)',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slots.map((slot) => (
                <tr key={slot.id} style={{ borderBottom: '1px solid var(--clr-border)' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 500 }}>{slot.title}</td>
                  <td style={{ padding: '12px 16px', fontSize: 'var(--fs-sm)' }}>{new Date(slot.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                  <td style={{ padding: '12px 16px', fontSize: 'var(--fs-sm)' }}>
                    {slot.start_time} – {slot.end_time}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 'var(--fs-sm)' }}>{slot.capacity}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{
                      padding: '2px 10px', borderRadius: 'var(--radius-full)',
                      fontSize: 'var(--fs-xs)', fontWeight: 600,
                      background: slot.fill_status === 'full' ? 'var(--clr-error-bg)' :
                                  slot.fill_status === 'partial' ? 'var(--clr-warning-bg)' : 'var(--clr-success-bg)',
                      color: slot.fill_status === 'full' ? 'var(--clr-error)' :
                             slot.fill_status === 'partial' ? 'var(--clr-warning)' : 'var(--clr-success)',
                    }}>
                      {slot.booking_count}/{slot.capacity} — {slot.fill_status}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 'var(--fs-sm)' }}>{new Date(slot.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <button className="btn btn-danger" style={{ padding: '6px 14px', fontSize: 'var(--fs-xs)' }}
                            onClick={() => handleDelete(slot.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
