import { useState, useEffect } from 'react';
import { getSystemSettings, createSetting, updateSetting, deleteSetting } from '../services/api';

const CATEGORIES = ['general', 'payroll', 'attendance', 'security'];
const CAT_COLORS = { general: '#2196f3', payroll: '#4caf50', attendance: '#ff9800', security: '#f44336' };

export default function SettingsPage() {
  const [settings, setSettings] = useState([]);
  const [filterCat, setFilterCat] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editKey, setEditKey] = useState(null);
  const [msg, setMsg] = useState({ text: '', type: '' });
  const [form, setForm] = useState({ key: '', value: '', description: '', category: 'general' });

  useEffect(() => { fetchAll(); }, [filterCat]);

  async function fetchAll() {
    try {
      const res = await getSystemSettings(filterCat ? { category: filterCat } : {});
      setSettings(res.data);
    } catch { setMsg({ text: 'Failed to load.', type: 'error' }); }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      if (editKey) {
        await updateSetting(editKey, form);
        setMsg({ text: 'Setting updated.', type: 'success' });
      } else {
        await createSetting(form);
        setMsg({ text: 'Setting created.', type: 'success' });
      }
      resetForm(); fetchAll();
    } catch (err) { setMsg({ text: err.response?.data?.error || 'Failed.', type: 'error' }); }
  }

  async function handleDelete(key) {
    if (!window.confirm(`Delete setting "${key}"?`)) return;
    try { await deleteSetting(key); fetchAll(); }
    catch (err) { setMsg({ text: err.response?.data?.error || 'Failed.', type: 'error' }); }
  }

  function startEdit(s) {
    setForm({ key: s.key, value: s.value, description: s.description, category: s.category });
    setEditKey(s.key); setShowForm(true);
  }

  function resetForm() { setForm({ key: '', value: '', description: '', category: 'general' }); setEditKey(null); setShowForm(false); }

  const sty = {
    label: { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary, #555)' },
    input: { width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 14, border: '1px solid var(--border, #ddd)', background: 'var(--input-bg, #fff)', color: 'var(--text, #333)', boxSizing: 'border-box' },
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>System Settings</h2>
          <p style={{ margin: '4px 0 0', color: '#666', fontSize: 14 }}>Manage company policies and system configuration</p>
        </div>
        <button onClick={() => { resetForm(); setShowForm(!showForm); }} className="btn btn-primary">
          {showForm ? 'Cancel' : '+ New Setting'}
        </button>
      </div>

      {msg.text && <div className={`att-msg ${msg.type}`}>{msg.text}<button className="att-msg-close" onClick={() => setMsg({text:'',type:''})}>x</button></div>}

      {/* Category Filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {['', ...CATEGORIES].map(cat => (
          <button key={cat} onClick={() => setFilterCat(cat)} style={{
            padding: '8px 16px', borderRadius: 20, fontSize: 13, fontWeight: 500, cursor: 'pointer',
            border: filterCat === cat ? `2px solid ${CAT_COLORS[cat] || '#1a237e'}` : '1px solid var(--border, #ddd)',
            background: filterCat === cat ? (CAT_COLORS[cat] || '#1a237e') : 'transparent',
            color: filterCat === cat ? '#fff' : 'var(--text, #333)',
          }}>
            {cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : 'All'}
          </button>
        ))}
      </div>

      {showForm && (
        <div style={{ background: 'var(--card-bg, #fff)', borderRadius: 12, padding: 24, marginBottom: 24, border: '1px solid var(--border, #e0e0e0)' }}>
          <h3 style={{ marginTop: 0 }}>{editKey ? `Edit: ${editKey}` : 'New Setting'}</h3>
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
              <div><label style={sty.label}>Key *</label><input value={form.key} onChange={e => setForm({...form, key: e.target.value})} style={sty.input} required disabled={!!editKey} /></div>
              <div><label style={sty.label}>Value *</label><input value={form.value} onChange={e => setForm({...form, value: e.target.value})} style={sty.input} required /></div>
              <div><label style={sty.label}>Category</label>
                <select value={form.category} onChange={e => setForm({...form, category: e.target.value})} style={sty.input}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div style={{ marginTop: 10 }}><label style={sty.label}>Description</label><input value={form.description} onChange={e => setForm({...form, description: e.target.value})} style={sty.input} /></div>
            <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
              <button type="submit" className="btn btn-primary">{editKey ? 'Update' : 'Create'}</button>
              <button type="button" className="btn btn-outline" onClick={resetForm}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div style={{ display: 'grid', gap: 8 }}>
        {settings.map(s => (
          <div key={s.key} style={{ background: 'var(--card-bg, #fff)', borderRadius: 10, padding: '14px 20px', border: '1px solid var(--border, #e0e0e0)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <code style={{ fontWeight: 700, fontSize: 14, color: 'var(--text, #333)' }}>{s.key}</code>
                <span style={{ padding: '2px 8px', borderRadius: 8, fontSize: 10, fontWeight: 600, background: (CAT_COLORS[s.category] || '#888') + '20', color: CAT_COLORS[s.category] || '#888' }}>{s.category}</span>
              </div>
              <div style={{ fontSize: 13, marginTop: 4 }}>
                <span style={{ color: '#1a237e', fontWeight: 600 }}>{s.value}</span>
                {s.description && <span style={{ color: '#888', marginLeft: 8 }}>— {s.description}</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => startEdit(s)} className="btn btn-outline btn-sm">Edit</button>
              <button onClick={() => handleDelete(s.key)} className="btn btn-outline btn-sm" style={{ color: '#f44336', borderColor: '#f44336' }}>Del</button>
            </div>
          </div>
        ))}
        {settings.length === 0 && <div className="empty-state"><h3>No settings configured</h3></div>}
      </div>
    </div>
  );
}
