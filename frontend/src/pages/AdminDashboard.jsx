// File: frontend/src/pages/AdminDashboard.jsx
// SRS References: FR-08 (Page 7) — Admin Schedule Overview
// SRS Section 2 (Page 5) — Administrator actor
// NFR Usability (Page 8) — responsive layout

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function AdminDashboard() {
  const { user, api } = useAuth();
  const [stats, setStats]     = useState({ totalSlots: 0, totalBookings: 0, fillRate: '0%' });
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [settings, setSettings] = useState({ reminders_enabled: false, reminder_hours: 24 });
  const [savingSettings, setSavingSettings] = useState(false);

  // FR-08: "consolidated view of all slots and booking status"
  useEffect(() => {
    let cancelled = false;

    const loadScheduleStats = async () => {
      try {
        const { data } = await api.get('/admin/schedule');
        if (!cancelled) {
          setStats({
            totalSlots:    data.stats?.total_slots || 0,
            totalBookings: data.stats?.total_bookings || 0,
            fillRate:      data.stats?.fill_rate || '0%',
          });
        }
      } catch (err) {
        if (!cancelled) {
          // Admin schedule endpoint is a Week 4 deliverable — handle gracefully
          if (err.response?.status === 404) {
            setStats({ totalSlots: 0, totalBookings: 0, fillRate: '0%' });
          } else {
            setError('Unable to load schedule data.');
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadScheduleStats();
    const timer = setInterval(loadScheduleStats, 30000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/admin/reminder-settings');
        if (!cancelled && data?.settings) {
          setSettings({
            reminders_enabled: !!data.settings.reminders_enabled,
            reminder_hours: Number(data.settings.reminder_hours || 24),
          });
        }
      } catch {
        // Keep defaults on load failure
      }
    })();
    return () => { cancelled = true; };
  }, [api]);

  async function saveReminderSettings(e) {
    e.preventDefault();
    setSavingSettings(true);
    setError('');
    try {
      await api.put('/admin/reminder-settings', settings);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to save reminder settings.');
    } finally {
      setSavingSettings(false);
    }
  }

  return (
    <div className="main-content">
      {/* Header */}
      <div className="dashboard-header">
        <h1>Admin Dashboard</h1>
        <p>
          Welcome, {user?.full_name}.{' '}
          <span style={{ color: 'var(--clr-accent)', fontWeight: 600 }}>Administrator</span>
        </p>
      </div>

      {/* FR-08: Summary statistics — "total slots, total bookings, average fill rate" */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{loading ? '—' : stats.totalSlots}</div>
          <div className="stat-label">Total Slots</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ background: 'linear-gradient(135deg, #11998e, #38ef7d)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            {loading ? '—' : stats.totalBookings}
          </div>
          <div className="stat-label">Total Bookings</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ background: 'linear-gradient(135deg, #f5af19, #f12711)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            {loading ? '—' : stats.fillRate}
          </div>
          <div className="stat-label">Average Fill Rate</div>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">{error}</div>
      )}

      {/* FR-10 Optional: Reminder Settings */}
      <div className="auth-card" style={{ maxWidth: 760, marginBottom: 'var(--space-2xl)' }}>
        <h2 style={{ fontSize: 'var(--fs-lg)', marginBottom: 'var(--space-md)' }}>Reminder Email Settings</h2>
        <p style={{ color: 'var(--clr-text-secondary)', marginBottom: 'var(--space-lg)' }}>
          Configure automatic appointment reminder emails for confirmed bookings.
        </p>
        <form onSubmit={saveReminderSettings}>
          <div className="form-group" style={{ marginBottom: 'var(--space-md)' }}>
            <label htmlFor="reminders-enabled" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer' }}>
              <input
                id="reminders-enabled"
                type="checkbox"
                checked={settings.reminders_enabled}
                onChange={(e) => setSettings((prev) => ({ ...prev, reminders_enabled: e.target.checked }))}
                aria-label="Enable reminder emails"
              />
              Enable reminder emails
            </label>
          </div>

          <div className="form-group" style={{ maxWidth: 260 }}>
            <label htmlFor="reminder-hours">Reminder timing</label>
            <select
              id="reminder-hours"
              className="form-input"
              value={settings.reminder_hours}
              onChange={(e) => setSettings((prev) => ({ ...prev, reminder_hours: Number(e.target.value) }))}
              disabled={!settings.reminders_enabled}
              aria-label="Reminder timing selector"
            >
              <option value={24}>24 hours before</option>
              <option value={48}>48 hours before</option>
              <option value={168}>1 week before</option>
            </select>
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={savingSettings}>
            {savingSettings ? 'Saving…' : 'Save Settings'}
          </button>
        </form>
      </div>

      {/* Admin action cards — FR-03 Slot Management + FR-07 Booking Oversight */}
      <div className="stats-grid">
        <Link to="/admin/slots" className="stat-card" style={{ display: 'block' }} aria-label="Open slot management">
          <div style={{ fontSize: '2rem', marginBottom: 'var(--space-sm)' }}>📋</div>
          <div style={{ fontWeight: 600, fontSize: 'var(--fs-md)', marginBottom: 4 }}>
            Manage Slots
          </div>
          <div style={{ color: 'var(--clr-text-secondary)', fontSize: 'var(--fs-sm)' }}>
            Create, edit, or delete appointment slots
          </div>
        </Link>
        <Link to="/admin/bookings" className="stat-card" style={{ display: 'block' }} aria-label="Open all bookings">
          <div style={{ fontSize: '2rem', marginBottom: 'var(--space-sm)' }}>📊</div>
          <div style={{ fontWeight: 600, fontSize: 'var(--fs-md)', marginBottom: 4 }}>
            All Bookings
          </div>
          <div style={{ color: 'var(--clr-text-secondary)', fontSize: 'var(--fs-sm)' }}>
            View and manage bookings across all clients
          </div>
        </Link>
        <Link to="/admin/slots" className="stat-card" style={{ display: 'block' }} aria-label="Go to slots management">
          <div style={{ fontSize: '2rem', marginBottom: 'var(--space-sm)' }}>📅</div>
          <div style={{ fontWeight: 600, fontSize: 'var(--fs-md)', marginBottom: 4 }}>
            Schedule Overview
          </div>
          <div style={{ color: 'var(--clr-text-secondary)', fontSize: 'var(--fs-sm)' }}>
            View utilisation and capacity across date ranges
          </div>
        </Link>
      </div>
    </div>
  );
}
