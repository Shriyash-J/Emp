import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  getTeams, createTeam, updateTeam, deleteTeam,
  addTeamMember, removeTeamMember,
  getTeamTasks, createTeamTask, updateTeamTaskProgress,
  predictTeamTask, getTeamStats, getEmployees, getMyTeamTasks
} from '../services/api';

const PRIORITY_COLORS = { low: '#607d8b', medium: '#2196f3', high: '#ff9800', urgent: '#f44336' };
const STATUS_COLORS = { pending: '#9e9e9e', in_progress: '#2196f3', completed: '#4caf50', cancelled: '#f44336' };
const PRED_COLORS = { 'On Time': '#4caf50', 'At Risk': '#ff9800', 'Delayed': '#f44336', 'Completed': '#2196f3' };

export default function TeamsPage() {
  const { user } = useAuth();
  const isManager = ['admin', 'manager'].includes(user?.role);
  const isEmployee = user?.role === 'employee';

  const [teams, setTeams] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState({ text: '', type: '' });

  // Team form
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [teamForm, setTeamForm] = useState({ name: '', description: '', department: '' });

  // Expanded team view
  const [expandedTeam, setExpandedTeam] = useState(null);
  const [teamTasks, setTeamTasks] = useState([]);
  const [myTasks, setMyTasks] = useState([]);

  // Add member
  const [addMemberTeamId, setAddMemberTeamId] = useState(null);
  const [newMemberId, setNewMemberId] = useState('');

  // Task form
  const [showTaskForm, setShowTaskForm] = useState(null); // team_id
  const [taskForm, setTaskForm] = useState({ title: '', description: '', priority: 'medium', start_date: '', deadline: '' });

  // Prediction
  const [prediction, setPrediction] = useState(null);
  const [predTaskId, setPredTaskId] = useState(null);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    try {
      const [teamsRes] = await Promise.all([getTeams()]);
      setTeams(teamsRes.data);
      if (isManager) {
        const [empRes, statsRes] = await Promise.all([getEmployees(), getTeamStats()]);
        setEmployees(empRes.data);
        setStats(statsRes.data);
      }
      if (isEmployee) {
        const myRes = await getMyTeamTasks();
        setMyTasks(myRes.data);
      }
    } catch { setMsg({ text: 'Failed to load.', type: 'error' }); }
    setLoading(false);
  }

  async function handleCreateTeam(e) {
    e.preventDefault();
    try {
      await createTeam(teamForm);
      setMsg({ text: 'Team created.', type: 'success' });
      setShowTeamForm(false);
      setTeamForm({ name: '', description: '', department: '' });
      fetchAll();
    } catch (err) { setMsg({ text: err.response?.data?.error || 'Failed.', type: 'error' }); }
  }

  async function handleDeleteTeam(id) {
    if (!window.confirm('Delete this team and all its tasks?')) return;
    try { await deleteTeam(id); fetchAll(); setExpandedTeam(null); }
    catch (err) { setMsg({ text: err.response?.data?.error || 'Failed.', type: 'error' }); }
  }

  async function handleExpandTeam(teamId) {
    if (expandedTeam === teamId) { setExpandedTeam(null); return; }
    setExpandedTeam(teamId);
    try { const res = await getTeamTasks(teamId); setTeamTasks(res.data); }
    catch { setTeamTasks([]); }
  }

  async function handleAddMember(teamId) {
    if (!newMemberId) return;
    try {
      await addTeamMember(teamId, { user_id: newMemberId });
      setMsg({ text: 'Member added.', type: 'success' });
      setAddMemberTeamId(null); setNewMemberId('');
      fetchAll();
    } catch (err) { setMsg({ text: err.response?.data?.error || 'Failed.', type: 'error' }); }
  }

  async function handleRemoveMember(teamId, userId) {
    try { await removeTeamMember(teamId, userId); fetchAll(); }
    catch (err) { setMsg({ text: err.response?.data?.error || 'Failed.', type: 'error' }); }
  }

  async function handleCreateTask(teamId, e) {
    e.preventDefault();
    try {
      await createTeamTask(teamId, taskForm);
      setMsg({ text: 'Task assigned.', type: 'success' });
      setShowTaskForm(null);
      setTaskForm({ title: '', description: '', priority: 'medium', start_date: '', deadline: '' });
      handleExpandTeam(teamId); fetchAll();
    } catch (err) { setMsg({ text: err.response?.data?.error || 'Failed.', type: 'error' }); }
  }

  async function handleUpdateProgress(taskId, progress, notes) {
    try {
      await updateTeamTaskProgress(taskId, { progress, notes });
      if (expandedTeam) handleExpandTeam(expandedTeam);
      if (isEmployee) { const res = await getMyTeamTasks(); setMyTasks(res.data); }
    } catch (err) { setMsg({ text: err.response?.data?.error || 'Failed.', type: 'error' }); }
  }

  async function handlePredict(taskId) {
    setPredTaskId(taskId);
    try {
      const res = await predictTeamTask(taskId);
      setPrediction(res.data);
    } catch (err) { setMsg({ text: err.response?.data?.error || 'Prediction failed.', type: 'error' }); }
  }

  const sty = {
    label: { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary, #555)' },
    input: { width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 14, border: '1px solid var(--border, #ddd)', background: 'var(--input-bg, #fff)', color: 'var(--text, #333)', boxSizing: 'border-box' },
  };

  // ─── Employee view: My Team Tasks ─────────────────────────
  if (isEmployee) {
    return (
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>My Team Tasks</h2>
        <p style={{ color: 'var(--text-secondary, #666)', fontSize: 14, marginBottom: 20 }}>Update your progress on tasks assigned to your team</p>
        {myTasks.length === 0 ? <div className="empty-state"><h3>No team tasks assigned</h3></div> : (
          <div style={{ display: 'grid', gap: 14 }}>
            {myTasks.map(t => {
              const myEntry = t.member_progress?.find(p => p.user_id === user?.id);
              return (
                <div key={t.id} style={{ background: 'var(--card-bg, #fff)', borderRadius: 12, padding: 20, border: '1px solid var(--border, #e0e0e0)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{t.title}</span>
                      <span style={{ marginLeft: 8, padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: STATUS_COLORS[t.status] + '20', color: STATUS_COLORS[t.status] }}>{t.status.replace('_', ' ')}</span>
                      <span style={{ marginLeft: 6, padding: '2px 8px', borderRadius: 8, fontSize: 11, background: PRIORITY_COLORS[t.priority] + '20', color: PRIORITY_COLORS[t.priority] }}>{t.priority}</span>
                    </div>
                    <span style={{ fontSize: 13, color: '#666' }}>Team: {t.team_name} | Deadline: {t.deadline}</span>
                  </div>
                  {t.description && <p style={{ fontSize: 13, color: '#888', marginBottom: 10 }}>{t.description}</p>}
                  {/* Progress bar */}
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                      <span>Team Progress: {t.overall_progress}%</span>
                      <span>My Progress: {myEntry?.progress || 0}%</span>
                    </div>
                    <div style={{ height: 8, background: '#e0e0e0', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${t.overall_progress}%`, background: '#4caf50', borderRadius: 4, transition: 'width 0.3s' }} />
                    </div>
                  </div>
                  {/* Update progress */}
                  {t.status !== 'completed' && myEntry && (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 }}>
                      <input type="range" min="0" max="100" step="5" value={myEntry.progress}
                        onChange={e => handleUpdateProgress(t.id, Number(e.target.value), '')}
                        style={{ flex: 1 }} />
                      <span style={{ fontWeight: 700, minWidth: 40 }}>{myEntry.progress}%</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ─── Manager / Admin view ──────────────────────────────────
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Team Management</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary, #666)', fontSize: 14 }}>Create teams, assign tasks, and track progress with AI predictions</p>
        </div>
        <button onClick={() => setShowTeamForm(!showTeamForm)} className="btn btn-primary">
          {showTeamForm ? 'Cancel' : '+ Create Team'}
        </button>
      </div>

      {msg.text && <div className={`att-msg ${msg.type}`}>{msg.text}<button className="att-msg-close" onClick={() => setMsg({text:'',type:''})}>x</button></div>}

      {/* Stats */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
          <div className="stat-card"><div className="stat-info"><h3>{stats.total_teams}</h3><p>Teams</p></div></div>
          <div className="stat-card"><div className="stat-info"><h3>{stats.total_members}</h3><p>Members</p></div></div>
          <div className="stat-card"><div className="stat-info"><h3>{stats.tasks_in_progress}</h3><p>In Progress</p></div></div>
          <div className="stat-card"><div className="stat-info"><h3>{stats.completion_rate}%</h3><p>Completion</p></div></div>
        </div>
      )}

      {/* Create Team Form */}
      {showTeamForm && (
        <div style={{ background: 'var(--card-bg, #fff)', borderRadius: 12, padding: 24, marginBottom: 24, border: '1px solid var(--border, #e0e0e0)' }}>
          <h3 style={{ marginTop: 0 }}>Create Team</h3>
          <form onSubmit={handleCreateTeam}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
              <div><label style={sty.label}>Team Name *</label><input value={teamForm.name} onChange={e => setTeamForm({...teamForm, name: e.target.value})} style={sty.input} required /></div>
              <div><label style={sty.label}>Department</label><input value={teamForm.department} onChange={e => setTeamForm({...teamForm, department: e.target.value})} style={sty.input} /></div>
              <div><label style={sty.label}>Description</label><input value={teamForm.description} onChange={e => setTeamForm({...teamForm, description: e.target.value})} style={sty.input} /></div>
            </div>
            <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
              <button type="submit" className="btn btn-primary">Create</button>
              <button type="button" className="btn btn-outline" onClick={() => setShowTeamForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Teams List */}
      {loading ? <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>Loading...</div> :
        teams.length === 0 ? <div className="empty-state"><h3>No teams yet. Create your first team!</h3></div> : (
        <div style={{ display: 'grid', gap: 14 }}>
          {teams.map(team => (
            <div key={team.id} style={{ background: 'var(--card-bg, #fff)', borderRadius: 12, border: '1px solid var(--border, #e0e0e0)' }}>
              {/* Team Header */}
              <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => handleExpandTeam(team.id)}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 16 }}>{team.name}</span>
                  <span style={{ marginLeft: 8, fontSize: 12, color: '#888' }}>{team.department} | {team.member_count} members</span>
                  {team.description && <p style={{ margin: '4px 0 0', fontSize: 13, color: '#888' }}>{team.description}</p>}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 18 }}>{expandedTeam === team.id ? '▲' : '▼'}</span>
                  <button onClick={e => { e.stopPropagation(); handleDeleteTeam(team.id); }} className="btn btn-outline btn-sm" style={{ color: '#f44336', borderColor: '#f44336' }}>Del</button>
                </div>
              </div>

              {/* Expanded: Members + Tasks */}
              {expandedTeam === team.id && (
                <div style={{ padding: '0 20px 20px', borderTop: '1px solid var(--border, #eee)' }}>
                  {/* Members */}
                  <div style={{ marginTop: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <h4 style={{ margin: 0 }}>Members ({team.member_count})</h4>
                      <button onClick={() => setAddMemberTeamId(addMemberTeamId === team.id ? null : team.id)} className="btn btn-outline btn-sm">+ Add</button>
                    </div>
                    {addMemberTeamId === team.id && (
                      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                        <select value={newMemberId} onChange={e => setNewMemberId(e.target.value)} style={{...sty.input, flex: 1}}>
                          <option value="">Select employee...</option>
                          {employees.filter(e => e.status === 'active' && !team.members.some(m => m.user_id === e.id)).map(e =>
                            <option key={e.id} value={e.id}>{e.name} — {e.position}</option>
                          )}
                        </select>
                        <button onClick={() => handleAddMember(team.id)} className="btn btn-primary btn-sm">Add</button>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {team.members.map(m => (
                        <div key={m.id} style={{ padding: '6px 12px', borderRadius: 20, background: 'var(--bg-secondary, #f0f0f0)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>{m.employee_name}</span>
                          {m.role_in_team === 'lead' && <span style={{ fontSize: 10, color: '#1a237e', fontWeight: 700 }}>LEAD</span>}
                          <button onClick={() => handleRemoveMember(team.id, m.user_id)} style={{ border: 'none', background: 'none', color: '#f44336', cursor: 'pointer', fontWeight: 700, fontSize: 14, padding: 0 }}>x</button>
                        </div>
                      ))}
                      {team.members.length === 0 && <span style={{ color: '#888', fontSize: 13 }}>No members yet</span>}
                    </div>
                  </div>

                  {/* Team Tasks */}
                  <div style={{ marginTop: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <h4 style={{ margin: 0 }}>Team Tasks</h4>
                      <button onClick={() => setShowTaskForm(showTaskForm === team.id ? null : team.id)} className="btn btn-outline btn-sm">+ Assign Task</button>
                    </div>

                    {/* New Task Form */}
                    {showTaskForm === team.id && (
                      <form onSubmit={e => handleCreateTask(team.id, e)} style={{ background: '#f8f9fa', borderRadius: 8, padding: 16, marginBottom: 14 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                          <div><label style={sty.label}>Title *</label><input value={taskForm.title} onChange={e => setTaskForm({...taskForm, title: e.target.value})} style={sty.input} required /></div>
                          <div><label style={sty.label}>Priority</label>
                            <select value={taskForm.priority} onChange={e => setTaskForm({...taskForm, priority: e.target.value})} style={sty.input}>
                              {['low','medium','high','urgent'].map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                          </div>
                          <div><label style={sty.label}>Start Date *</label><input type="date" value={taskForm.start_date} onChange={e => setTaskForm({...taskForm, start_date: e.target.value})} style={sty.input} required /></div>
                          <div><label style={sty.label}>Deadline *</label><input type="date" value={taskForm.deadline} onChange={e => setTaskForm({...taskForm, deadline: e.target.value})} style={sty.input} required /></div>
                        </div>
                        <div style={{ marginTop: 10 }}><label style={sty.label}>Description</label><textarea rows="2" value={taskForm.description} onChange={e => setTaskForm({...taskForm, description: e.target.value})} style={{...sty.input, resize:'vertical'}} /></div>
                        <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                          <button type="submit" className="btn btn-primary btn-sm">Assign</button>
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowTaskForm(null)}>Cancel</button>
                        </div>
                      </form>
                    )}

                    {/* Task List */}
                    {teamTasks.length === 0 ? <span style={{ color: '#888', fontSize: 13 }}>No tasks assigned</span> : (
                      <div style={{ display: 'grid', gap: 10 }}>
                        {teamTasks.map(t => (
                          <div key={t.id} style={{ padding: 14, borderRadius: 8, border: '1px solid var(--border, #eee)', background: 'var(--bg-secondary, #fafafa)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                              <div>
                                <span style={{ fontWeight: 600 }}>{t.title}</span>
                                <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600, background: STATUS_COLORS[t.status] + '20', color: STATUS_COLORS[t.status] }}>{t.status.replace('_',' ')}</span>
                                <span style={{ marginLeft: 4, padding: '2px 8px', borderRadius: 8, fontSize: 11, background: PRIORITY_COLORS[t.priority] + '20', color: PRIORITY_COLORS[t.priority] }}>{t.priority}</span>
                              </div>
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                <span style={{ fontSize: 12, color: '#888' }}>{t.start_date} — {t.deadline}</span>
                                <button onClick={() => handlePredict(t.id)} className="btn btn-outline btn-sm" style={{ fontSize: 11 }}>
                                  Predict
                                </button>
                              </div>
                            </div>
                            {/* Progress bar */}
                            <div style={{ marginTop: 8 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                                <span>Overall: {t.overall_progress}%</span>
                              </div>
                              <div style={{ height: 6, background: '#e0e0e0', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${t.overall_progress}%`, background: t.overall_progress === 100 ? '#4caf50' : '#2196f3', transition: 'width 0.3s' }} />
                              </div>
                            </div>
                            {/* Member progress */}
                            {t.member_progress?.length > 0 && (
                              <div style={{ marginTop: 8, display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, color: '#666' }}>
                                {t.member_progress.map(p => (
                                  <span key={p.id}>{p.employee_name}: {p.progress}%{p.notes ? ` (${p.notes})` : ''}</span>
                                ))}
                              </div>
                            )}
                            {/* Prediction result */}
                            {predTaskId === t.id && prediction && (
                              <div style={{ marginTop: 10, padding: 12, borderRadius: 8, background: PRED_COLORS[prediction.prediction] + '15', border: `1px solid ${PRED_COLORS[prediction.prediction] || '#ccc'}` }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                                  <span style={{ fontSize: 20 }}>{prediction.prediction === 'On Time' ? '✅' : prediction.prediction === 'At Risk' ? '⚠️' : prediction.prediction === 'Delayed' ? '🔴' : '✅'}</span>
                                  <span style={{ fontWeight: 700, fontSize: 16, color: PRED_COLORS[prediction.prediction] }}>{prediction.prediction}</span>
                                  <span style={{ fontSize: 12, color: '#888' }}>({(prediction.confidence * 100).toFixed(0)}% confidence | {prediction.method})</span>
                                </div>
                                <p style={{ fontSize: 13, color: '#555', margin: 0 }}>{prediction.detail}</p>
                                {prediction.days_remaining !== undefined && (
                                  <p style={{ fontSize: 12, color: '#888', margin: '4px 0 0' }}>
                                    {prediction.days_remaining} days remaining | {prediction.time_elapsed_pct}% time elapsed
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
