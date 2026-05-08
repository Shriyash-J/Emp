import { useState, useEffect } from 'react';
import { getActivityLogs } from '../services/api';

export default function ActivityLogs() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [filterModule, setFilterModule] = useState('');
  const [page, setPage] = useState(0);

  useEffect(() => {
    getActivityLogs({ module: filterModule || undefined, limit: 20, offset: page * 20 })
      .then(({ data }) => { setLogs(data.logs); setTotal(data.total); })
      .catch(() => {});
  }, [filterModule, page]);

  return (
    <div>
      <div className="filter-bar">
        <select value={filterModule} onChange={(e) => { setFilterModule(e.target.value); setPage(0); }}>
          <option value="">All Modules</option>
          <option value="admin">Admin</option>
          <option value="hr">HR</option>
          <option value="employee">Employee</option>
          <option value="system">System</option>
        </select>
        <span style={{ fontSize: 13, color: 'var(--text-light)' }}>Total: {total} activities</span>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr><th>User</th><th>Action</th><th>Description</th><th>Module</th><th>Timestamp</th></tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td><strong>{log.user_name || 'System'}</strong><br /><small style={{ color: 'var(--text-light)' }}>{log.user_role}</small></td>
                <td><span className="badge active">{log.action}</span></td>
                <td>{log.description}</td>
                <td><span className={`badge ${log.module}`}>{log.module}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>{new Date(log.timestamp).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {logs.length === 0 && <div className="empty-state"><h3>No activity logs found</h3></div>}
      </div>

      {total > 20 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 16 }}>
          <button className="btn btn-outline btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button>
          <span style={{ fontSize: 14, padding: '5px 10px' }}>Page {page + 1} of {Math.ceil(total / 20)}</span>
          <button className="btn btn-outline btn-sm" disabled={(page + 1) * 20 >= total} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
