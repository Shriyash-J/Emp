import { useState, useEffect } from 'react';
import { getDepartments, createDepartment, updateDepartment, deleteDepartment, getEmployees } from '../services/api';

export default function DepartmentsPage() {
  const [depts, setDepts] = useState([]);
  const [managers, setManagers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [msg, setMsg] = useState({ text: '', type: '' });
  const [form, setForm] = useState({ name: '', description: '', manager_id: '', budget: '' });

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    try {
      const [dRes, eRes] = await Promise.all([getDepartments(), getEmployees({ role: 'manager' })]);
      setDepts(dRes.data);
      // Include admins and managers as potential dept heads
      const allEmp = (await getEmployees()).data;
      setManagers(allEmp.filter(e => ['admin', 'manager'].includes(e.role)));
    } catch { setMsg({ text: 'Failed to load.', type: 'error' }); }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      if (editId) {
        await updateDepartment(editId, form);
        setMsg({ text: 'Department updated.', type: 'success' });
      } else {
        await createDepartment(form);
        setMsg({ text: 'Department created.', type: 'success' });
      }
      resetForm(); fetchAll();
    } catch (err) { setMsg({ text: err.response?.data?.error || 'Failed.', type: 'error' }); }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this department?')) return;
    try { await deleteDepartment(id); setMsg({ text: 'Deleted.', type: 'success' }); fetchAll(); }
    catch (err) { setMsg({ text: err.response?.data?.error || 'Failed.', type: 'error' }); }
  }

  function startEdit(d) {
    setForm({ name: d.name, description: d.description, manager_id: d.manager_id || '', budget: d.budget || '' });
    setEditId(d.id); setShowForm(true);
  }

  function resetForm() { setForm({ name: '', description: '', manager_id: '', budget: '' }); setEditId(null); setShowForm(false); }

  const sty = {
    label: { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary, #555)' },
    input: { width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 14, border: '1px solid var(--border, #ddd)', background: 'var(--input-bg, #fff)', color: 'var(--text, #333)', boxSizing: 'border-box' },
  };

  const totalBudget = depts.reduce((sum, d) => sum + (d.budget || 0), 0);
  const totalHeadcount = depts.reduce((sum, d) => sum + (d.head_count || 0), 0);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Organization Management</h2>
          <p style={{ margin: '4px 0 0', color: '#666', fontSize: 14 }}>Manage departments, assign heads, and set budgets</p>
        </div>
        <button onClick={() => { resetForm(); setShowForm(!showForm); }} className="btn btn-primary">
          {showForm ? 'Cancel' : '+ New Department'}
        </button>
      </div>

      {msg.text && <div className={`att-msg ${msg.type}`}>{msg.text}<button className="att-msg-close" onClick={() => setMsg({text:'',type:''})}>x</button></div>}

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
        <div className="stat-card"><div className="stat-info"><h3>{depts.length}</h3><p>Departments</p></div></div>
        <div className="stat-card"><div className="stat-info"><h3>{totalHeadcount}</h3><p>Total Headcount</p></div></div>
        <div className="stat-card"><div className="stat-info"><h3>INR {(totalBudget / 100000).toFixed(1)}L</h3><p>Total Budget</p></div></div>
      </div>

      {showForm && (
        <div style={{ background: 'var(--card-bg, #fff)', borderRadius: 12, padding: 24, marginBottom: 24, border: '1px solid var(--border, #e0e0e0)' }}>
          <h3 style={{ marginTop: 0 }}>{editId ? 'Edit Department' : 'Create Department'}</h3>
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
              <div><label style={sty.label}>Name *</label><input value={form.name} onChange={e => setForm({...form, name: e.target.value})} style={sty.input} required /></div>
              <div><label style={sty.label}>Department Head</label>
                <select value={form.manager_id} onChange={e => setForm({...form, manager_id: e.target.value})} style={sty.input}>
                  <option value="">None</option>
                  {managers.map(m => <option key={m.id} value={m.id}>{m.name} — {m.position}</option>)}
                </select>
              </div>
              <div><label style={sty.label}>Budget (Annual)</label><input type="number" value={form.budget} onChange={e => setForm({...form, budget: e.target.value})} style={sty.input} /></div>
            </div>
            <div style={{ marginTop: 10 }}><label style={sty.label}>Description</label><input value={form.description} onChange={e => setForm({...form, description: e.target.value})} style={sty.input} /></div>
            <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
              <button type="submit" className="btn btn-primary">{editId ? 'Update' : 'Create'}</button>
              <button type="button" className="btn btn-outline" onClick={resetForm}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {depts.map(d => (
          <div key={d.id} style={{ background: 'var(--card-bg, #fff)', borderRadius: 12, padding: 20, border: '1px solid var(--border, #e0e0e0)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <span style={{ fontWeight: 700, fontSize: 16 }}>{d.name}</span>
              <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 8, fontSize: 11, background: d.status === 'active' ? '#e8f5e9' : '#ffebee', color: d.status === 'active' ? '#2e7d32' : '#c62828' }}>{d.status}</span>
              <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>
                {d.description && <span>{d.description} | </span>}
                <strong>Head:</strong> {d.manager_name || 'Not assigned'} |
                <strong> Headcount:</strong> {d.head_count} |
                <strong> Budget:</strong> INR {(d.budget || 0).toLocaleString()}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => startEdit(d)} className="btn btn-outline btn-sm">Edit</button>
              <button onClick={() => handleDelete(d.id)} className="btn btn-outline btn-sm" style={{ color: '#f44336', borderColor: '#f44336' }}>Del</button>
            </div>
          </div>
        ))}
        {depts.length === 0 && <div className="empty-state"><h3>No departments yet</h3></div>}
      </div>
    </div>
  );
}
