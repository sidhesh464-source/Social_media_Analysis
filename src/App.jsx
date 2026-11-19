import React, { useEffect, useState } from 'react';
import { 
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, 
  Tooltip, XAxis, YAxis, PieChart, Pie, Cell 
} from 'recharts';
import { 
  Activity, Database, HardDrive, Workflow, Upload, Sun, Moon, RefreshCw, 
  FileText, MessageSquare, Play, LayoutDashboard, Search, CheckCircle2, 
  AlertTriangle, LogOut, Flame, Shield, User, Lock, Mail, ArrowRight, Zap
} from 'lucide-react';
import { 
  onAuthChange, loginWithEmail, registerWithEmail, loginWithGoogle, 
  logoutUser, saveDatasetToRTDB, subscribeToDatasets, savePostsToRTDB, 
  subscribeToPosts, saveJobToRTDB, subscribeToJobs, isFirebaseConfigured, 
  firebaseConfig, formatAuthError 
} from './firebase';

const API = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api').replace(/\/$/, '');

async function request(path, options = {}) {
  const r = await fetch(API + path, options);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error?.details || data.error || `Request failed: ${r.status}`);
  return data;
}

const colors = { positive: '#22c55e', negative: '#ef4444', neutral: '#38bdf8' };

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [theme, setTheme] = useState(localStorage.getItem('sx-theme') || 'dark');
  const [page, setPage] = useState('Dashboard');
  const [summary, setSummary] = useState({ total_posts: 0, positive: 0, negative: 0, neutral: 0, datasets: 0, mapreduce_jobs: 0 });
  const [trends, setTrends] = useState([]);
  const [datasets, setDatasets] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [posts, setPosts] = useState([]);
  const [hdfs, setHdfs] = useState({ connected: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');

  // 1. Production Authentication State Listener
  useEffect(() => {
    const unsubscribe = onAuthChange((firebaseUser) => {
      setUser(firebaseUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Theme synchronization
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('sx-theme', theme);
  }, [theme]);

  // 2. Real-Time Firebase Database Listeners (Active when user is logged in)
  useEffect(() => {
    if (!user) return;

    // Live subscription to Datasets in Firebase Realtime Database
    const unsubDatasets = subscribeToDatasets((rtdbDatasets) => {
      setDatasets(rtdbDatasets);
      if (rtdbDatasets.length && !selected) {
        setSelected(String(rtdbDatasets[0].id));
      }
    });

    // Live subscription to MapReduce Jobs in Firebase Realtime Database
    const unsubJobs = subscribeToJobs((rtdbJobs) => {
      setJobs(rtdbJobs);
    });

    // Live subscription to Posts in Firebase Realtime Database
    const unsubPosts = subscribeToPosts(null, (rtdbPosts) => {
      setPosts(rtdbPosts);
      
      // Calculate real-time summary directly from live Realtime Database records
      const pos = rtdbPosts.filter(p => p.sentiment === 'positive').length;
      const neg = rtdbPosts.filter(p => p.sentiment === 'negative').length;
      const neu = rtdbPosts.filter(p => p.sentiment === 'neutral').length;
      
      setSummary(prev => ({
        ...prev,
        total_posts: rtdbPosts.length,
        positive: pos,
        negative: neg,
        neutral: neu
      }));

      // Generate trend distribution
      const dailyMap = {};
      rtdbPosts.forEach(p => {
        const d = (p.processed_at || p.created_at || new Date().toISOString()).toString().slice(0, 10);
        if (!dailyMap[d]) dailyMap[d] = { date: d, positive: 0, negative: 0, neutral: 0 };
        if (p.sentiment in dailyMap[d]) dailyMap[d][p.sentiment]++;
      });
      const trendList = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));
      if (trendList.length) setTrends(trendList);
    });

    // Optional cluster status check
    request('/hdfs/status')
      .then(res => setHdfs(res))
      .catch(e => setHdfs({ connected: false, error: e.message }));

    return () => {
      unsubDatasets();
      unsubJobs();
      unsubPosts();
    };
  }, [user]);

  // Fallback API poll for cluster details
  const refresh = async () => {
    try {
      const apiSummary = await request('/dashboard/summary').catch(() => ({}));
      const apiHdfs = await request('/hdfs/status').catch((e) => ({ connected: false, error: e.message }));
      setHdfs(apiHdfs);
      if (apiSummary.total_posts) {
        setSummary(prev => ({
          ...prev,
          hadoop_enabled: apiSummary.hadoop_enabled
        }));
      }
      setError('');
    } catch (e) {
      setError(e.message);
    }
  };

  const act = async (fn) => {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const m = await fn();
      setMessage(typeof m === 'string' ? m : JSON.stringify(m));
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Upload Dataset: Parses on backend & records into Firebase Realtime Database
  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    await act(async () => {
      const d = await request('/datasets/upload', { method: 'POST', body: fd });
      
      // Store in Firebase Realtime Database
      const dsId = await saveDatasetToRTDB({
        id: d.id,
        name: d.name,
        source: 'upload',
        status: d.status,
        row_count: d.row_count
      }, user);

      if (d.posts && d.posts.length) {
        await savePostsToRTDB(dsId, d.posts, user);
      }

      return `Dataset uploaded & synchronized with Firebase Realtime Database: ${d.name} (${d.row_count} rows).`;
    });
    e.target.value = '';
  };

  // Submit MapReduce job: Processes Mapper/Reducer & saves to Firebase Realtime Database
  const runJob = () => act(async () => {
    if (!selected) throw new Error('Please select an uploaded dataset first.');
    
    // Find current dataset posts to process
    const currentDataset = datasets.find(d => String(d.id) === String(selected));
    const targetPosts = posts.filter(p => String(p.dataset_id) === String(selected));

    const result = await request('/mapreduce/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        dataset_id: selected,
        posts: targetPosts.length ? targetPosts : undefined 
      })
    });

    // Record job completion in Firebase Realtime Database
    await saveJobToRTDB({
      id: result.job_id,
      dataset_id: selected,
      dataset_name: currentDataset?.name || `Dataset #${selected}`,
      status: result.status,
      positive: result.positive,
      negative: result.negative,
      neutral: result.neutral,
      log: result.log
    }, user);

    // Update classified posts in Firebase Realtime Database
    if (result.classified_posts && result.classified_posts.length) {
      await savePostsToRTDB(selected, result.classified_posts, user);
    }

    return `MapReduce finished! Positive: ${result.positive}, Negative: ${result.negative}, Neutral: ${result.neutral}`;
  });

  // Social Data Collection: Calls API & stores in Firebase Realtime Database
  const collect = (platform) => act(async () => {
    const queryStr = prompt(`Enter a search keyword for ${platform}:`);
    if (!queryStr) return 'Collection cancelled.';
    
    const res = await request(`/collection/${platform}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: queryStr, limit: 25 })
    });

    // Persist in Firebase Realtime Database
    const dsId = await saveDatasetToRTDB({
      id: res.dataset_id,
      name: `${platform}-${queryStr}`,
      source: platform,
      status: 'collected',
      row_count: res.collected || 25
    }, user);

    if (res.posts && res.posts.length) {
      await savePostsToRTDB(dsId, res.posts, user);
    }

    return `Collected ${res.collected || 25} posts from ${platform} and saved to Firebase Realtime Database.`;
  });

  // Auth Loading Screen
  if (authLoading) {
    return (
      <div className="auth-wrapper">
        <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
          <div className="brand-icon" style={{ margin: '0 auto 16px' }}>S</div>
          <p>Connecting to Firebase Authentication...</p>
        </div>
      </div>
    );
  }

  // Real World Authentication Screen (No Guest / Demo Mode)
  if (!user) {
    return <AuthScreen onLoginSuccess={() => refresh()} />;
  }

  const nav = [
    ['Dashboard', LayoutDashboard],
    ['Data Collection', MessageSquare],
    ['Datasets', Database],
    ['HDFS Storage', HardDrive],
    ['MapReduce Jobs', Workflow],
    ['Sentiment Results', Activity],
    ['Reports', FileText]
  ];

  const total = summary.total_posts || posts.length || 0;
  const dist = [
    { name: 'Positive', value: summary.positive || 0 },
    { name: 'Negative', value: summary.negative || 0 },
    { name: 'Neutral', value: summary.neutral || 0 }
  ];

  const userDisplayName = user.displayName || user.email?.split('@')[0] || 'User';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">S</div>
          <div>
            <b>SentimentX</b>
            <small>REALTIME BIG DATA</small>
          </div>
        </div>
        <div className="workspace">
          WORKSPACE <span>● FIREBASE REALTIME</span>
        </div>
        <nav>
          {nav.map(([n, Icon]) => (
            <button key={n} className={page === n ? 'nav active' : 'nav'} onClick={() => setPage(n)}>
              <Icon size={17} />
              {n}
            </button>
          ))}
        </nav>
        <div className="side-bottom">
          <div className="cluster" style={{ borderColor: '#f59e0b44', marginBottom: 10 }}>
            <Flame size={18} color="#f59e0b" />
            <div>
              <b>Realtime Database</b>
              <small style={{ color: isFirebaseConfigured ? '#22c55e' : '#f59e0b' }}>
                {isFirebaseConfigured ? 'WebSocket Live' : 'Awaiting Config'}
              </small>
            </div>
          </div>
          <div className="cluster">
            <span className={hdfs.connected ? 'dot green' : 'dot red'} />
            <div>
              <b>Hadoop Cluster</b>
              <small>{hdfs.connected ? 'Cluster Connected' : 'Standalone / Local'}</small>
            </div>
          </div>
          <small>SentimentX · Enterprise Cloud Edition</small>
        </div>
      </aside>

      <main className="main">
        <header>
          <div>
            <div className="eyebrow">FIREBASE REALTIME DATABASE / HADOOP</div>
            <h1>{page}</h1>
          </div>
          <div className="header-actions">
            <span className="firebase-pill" title={firebaseConfig.databaseURL || 'Realtime Database'}>
              <Flame size={14} color="#f59e0b" /> {firebaseConfig.projectId || 'Realtime DB'}
            </span>
            <button className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Toggle theme">
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button className="icon-btn" onClick={refresh} title="Refresh Data">
              <RefreshCw size={18} />
            </button>
            
            {/* User Profile & Logout */}
            <div className="user-badge">
              <div className="avatar" style={{ background: '#2563eb' }}>
                {(user.displayName || user.email || 'U')[0].toUpperCase()}
              </div>
              <div className="user-info">
                <span className="user-email">{user.email || userDisplayName}</span>
                <span className="user-role">Authenticated User</span>
              </div>
              <button className="logout-btn" onClick={() => logoutUser()} title="Sign out">
                <LogOut size={15} />
              </button>
            </div>
          </div>
        </header>

        {error && <div className="alert error"><AlertTriangle size={17} />{error}</div>}
        {message && <div className="alert success"><CheckCircle2 size={17} />{message}</div>}

        {page === 'Dashboard' && (
          <>
            <div className="welcome">
              <div>
                <span className="tag">REALTIME DATABASE + MAPREDUCE</span>
                <h2>Welcome back, {userDisplayName}!</h2>
                <p>Real-time social sentiment stream synchronized across clients using Firebase Realtime Database.</p>
              </div>
              <button className="primary" onClick={() => setPage('Data Collection')}>
                Collect Data <Upload size={16} />
              </button>
            </div>

            <div className="metrics">
              {[
                ['Total Posts', total, MessageSquare, '#38bdf8'],
                ['Realtime Datasets', datasets.length, Database, '#a78bfa'],
                ['MapReduce Jobs', jobs.length, Workflow, '#f59e0b'],
                ['Realtime Database', isFirebaseConfigured ? 'Connected (Live)' : 'Pending Config', Flame, '#22c55e']
              ].map(([l, v, Icon, c]) => (
                <div className="metric card" key={l}>
                  <div className="metric-top">
                    <span>{l}</span>
                    <Icon size={18} color={c} />
                  </div>
                  <strong>{v}</strong>
                  <small>{l === 'Realtime Database' ? 'Firebase RTDB NoSQL' : 'Live analytics count'}</small>
                </div>
              ))}
            </div>

            <div className="chart-grid">
              <section className="card chart-card">
                <div className="section-head">
                  <div>
                    <h3>Sentiment Trend</h3>
                    <p>Processed posts over time</p>
                  </div>
                  <span className="subtle-chip">LIVE STREAM</span>
                </div>
                <div className="chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trends}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                      <XAxis dataKey="date" stroke="var(--muted)" />
                      <YAxis stroke="var(--muted)" />
                      <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12 }} />
                      <Legend />
                      <Area type="monotone" dataKey="positive" stroke={colors.positive} fill={colors.positive} fillOpacity={0.15} />
                      <Area type="monotone" dataKey="negative" stroke={colors.negative} fill={colors.negative} fillOpacity={0.12} />
                      <Area type="monotone" dataKey="neutral" stroke={colors.neutral} fill={colors.neutral} fillOpacity={0.12} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="card chart-card">
                <div className="section-head">
                  <div>
                    <h3>Sentiment Distribution</h3>
                    <p>Real-time classification breakdown</p>
                  </div>
                </div>
                <div className="donut">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={dist} dataKey="value" nameKey="name" innerRadius={65} outerRadius={94} paddingAngle={4}>
                        {dist.map((d, i) => (
                          <Cell key={d.name} fill={[colors.positive, colors.negative, colors.neutral][i]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="donut-center">
                    <b>{total}</b>
                    <small>POSTS</small>
                  </div>
                </div>
                <div className="legend-list">
                  {dist.map((d, i) => (
                    <div key={d.name}>
                      <span>
                        <i style={{ background: [colors.positive, colors.negative, colors.neutral][i] }} />
                        {d.name}
                      </span>
                      <b>{d.value}</b>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <section className="card table-card">
              <div className="section-head">
                <div>
                  <h3>Recent MapReduce Jobs</h3>
                  <p>Real-time Hadoop execution logs from Firebase Realtime Database</p>
                </div>
                <button className="text-btn" onClick={() => setPage('MapReduce Jobs')}>
                  View all →
                </button>
              </div>
              <JobTable jobs={jobs.slice(0, 5)} />
            </section>
          </>
        )}

        {page === 'Data Collection' && (
          <section className="card content-card">
            <h2>Social Media Data Collection</h2>
            <p className="muted">Import datasets directly. Records are written live to Firebase Realtime Database.</p>
            <div className="collect-grid">
              <div className="source-box">
                <MessageSquare />
                <h3>Reddit API</h3>
                <p>Fetch public submissions using keywords and ingest into Realtime Database.</p>
                <button className="primary" disabled={busy} onClick={() => collect('reddit')}>
                  Fetch Reddit Posts
                </button>
              </div>
              <div className="source-box">
                <Activity />
                <h3>YouTube API</h3>
                <p>Query YouTube comments and titles to analyze public perception.</p>
                <button className="primary" disabled={busy} onClick={() => collect('youtube')}>
                  Fetch YouTube Data
                </button>
              </div>
              <div className="source-box">
                <Upload />
                <h3>CSV / JSON Ingestion</h3>
                <p>Upload files from your machine directly into Firebase Realtime Database.</p>
                <label className="primary upload-btn">
                  Choose File
                  <input type="file" accept=".csv,.json" onChange={upload} />
                </label>
              </div>
            </div>
            <div className="notice">
              All records are stored directly as JSON trees in Firebase Realtime Database with zero SQL overhead.
            </div>
          </section>
        )}

        {page === 'Datasets' && (
          <section className="card content-card">
            <div className="section-head">
              <div>
                <h2>Datasets</h2>
                <p className="muted">Live datasets synced via Firebase Realtime Database</p>
              </div>
              <label className="primary upload-btn">
                <Upload size={16} /> Upload New Dataset
                <input type="file" accept=".csv,.json" onChange={upload} />
              </label>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Source</th>
                  <th>Rows</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {datasets.map((d) => (
                  <tr key={d.id}>
                    <td><b>{d.name}</b></td>
                    <td><span className="subtle-chip">{d.source}</span></td>
                    <td>{d.row_count}</td>
                    <td>
                      <span className="job-status">{d.status}</span>
                    </td>
                    <td>
                      <button className="text-btn" onClick={() => act(() => request(`/preprocessing/${d.id}`, { method: 'POST' }))}>
                        Preprocess
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!datasets.length && <p className="empty">No datasets found in Realtime Database. Upload a CSV or JSON file to begin.</p>}
          </section>
        )}

        {page === 'HDFS Storage' && (
          <section className="card content-card">
            <h2>HDFS & Realtime Storage Explorer</h2>
            <div className="hdfs-status">
              <span className={hdfs.connected ? 'dot green' : 'dot red'} />
              <b>{hdfs.connected ? 'Hadoop Cluster Active' : 'Standalone Execution Mode'}</b>
              <span className="muted">{hdfs.version || hdfs.error || 'Running in standalone high-performance mode.'}</span>
            </div>
            <button className="secondary" onClick={() => act(() => request('/hdfs/status'))}>
              Check Connection
            </button>
          </section>
        )}

        {page === 'MapReduce Jobs' && (
          <section className="card content-card">
            <h2>Hadoop MapReduce Execution</h2>
            <p className="muted">Run distributed Map &rarr; Shuffle/Sort &rarr; Reduce jobs on uploaded datasets.</p>
            <div className="run-row">
              <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                <option value="">Select a Dataset</option>
                {datasets.map((d) => (
                  <option value={d.id} key={d.id}>
                    {d.name} ({d.row_count} rows)
                  </option>
                ))}
              </select>
              <button className="primary" disabled={busy || !selected} onClick={runJob}>
                <Play size={16} /> Run MapReduce Job
              </button>
            </div>
            <JobTable jobs={jobs} />
          </section>
        )}

        {page === 'Sentiment Results' && (
          <section className="card content-card">
            <div className="section-head">
              <div>
                <h2>Sentiment Classifications</h2>
                <p className="muted">Real-time post classifications from Firebase Realtime Database</p>
              </div>
            </div>
            <Results posts={posts} />
          </section>
        )}

        {page === 'Reports' && (
          <section className="card content-card">
            <h2>Export & Analytics Reports</h2>
            <p className="muted">Download classified sentiment data for reporting and machine learning evaluation.</p>
            <a className="primary link-btn" href={API + '/reports/export.csv'}>
              Download CSV Report <FileText size={16} />
            </a>
          </section>
        )}

        <footer>
          SentimentX <span>Big Data Analytics · Firebase Realtime Database (NoSQL)</span>
          <span>{firebaseConfig.databaseURL ? `Database: ${firebaseConfig.databaseURL}` : 'Awaiting Database Config'}</span>
        </footer>
      </main>
    </div>
  );
}

function JobTable({ jobs }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Job ID</th>
            <th>Dataset</th>
            <th>Status</th>
            <th>Positive</th>
            <th>Negative</th>
            <th>Neutral</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td><code>#{j.id}</code></td>
              <td>{j.dataset_name || `Dataset #${j.dataset_id}`}</td>
              <td><span className={'job-status ' + (j.status || 'running')}>{j.status}</span></td>
              <td style={{ color: colors.positive, fontWeight: 600 }}>{j.positive || 0}</td>
              <td style={{ color: colors.negative, fontWeight: 600 }}>{j.negative || 0}</td>
              <td style={{ color: colors.neutral, fontWeight: 600 }}>{j.neutral || 0}</td>
              <td><b>{j.total || (j.positive || 0) + (j.negative || 0) + (j.neutral || 0)}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
      {!jobs.length && <p className="empty">No MapReduce jobs executed yet.</p>}
    </div>
  );
}

function Results({ posts }) {
  const [search, setSearch] = useState('');
  const filtered = posts.filter((p) => (p.text || '').toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <input
        className="search"
        placeholder="Filter post text in real-time..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Platform</th>
              <th>Post Content</th>
              <th>Sentiment</th>
              <th>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 100).map((p, idx) => (
              <tr key={p.id || idx}>
                <td><span className="subtle-chip">{p.platform || 'upload'}</span></td>
                <td className="post-text">{p.text}</td>
                <td>
                  <span className={'sentiment ' + (p.sentiment || 'neutral')}>{p.sentiment || 'pending'}</span>
                </td>
                <td>{p.score !== undefined && p.score !== null ? Number(p.score).toFixed(2) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && <p className="empty">No matching records found.</p>}
      </div>
    </>
  );
}

// Strictly Real-World Production Authentication Screen (No Guest / Demo Mode)
function AuthScreen({ onLoginSuccess }) {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    setLoading(true);
    try {
      if (isRegister) {
        await registerWithEmail(email, password);
      } else {
        await loginWithEmail(email, password);
      }
      onLoginSuccess();
    } catch (err) {
      setAuthError(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setAuthError('');
    setLoading(true);
    try {
      await loginWithGoogle();
      onLoginSuccess();
    } catch (err) {
      setAuthError(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-box">
        <div className="auth-header">
          <div className="brand-icon">S</div>
          <h2>SentimentX</h2>
          <p>Real-Time Big Data Analytics · Firebase Realtime Database (NoSQL)</p>
        </div>

        {!isFirebaseConfigured && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 8,
            padding: '12px 14px',
            marginBottom: 16,
            color: '#ef4444',
            fontSize: 13,
            lineHeight: 1.4,
            textAlign: 'center'
          }}>
            <AlertTriangle size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            <b>Firebase Realtime Database Setup Required</b>
            <div style={{ fontSize: 12, opacity: 0.9, marginTop: 4 }}>
              Set <code>VITE_FIREBASE_API_KEY</code> and <code>VITE_FIREBASE_DATABASE_URL</code> in your environment variables.
            </div>
          </div>
        )}

        {authError && (
          <div className="alert error" style={{ marginBottom: 16 }}>
            <AlertTriangle size={16} />
            <span>{authError}</span>
          </div>
        )}

        <div className="auth-tabs">
          <button
            className={`auth-tab ${!isRegister ? 'active' : ''}`}
            onClick={() => { setIsRegister(false); setAuthError(''); }}
          >
            Sign In
          </button>
          <button
            className={`auth-tab ${isRegister ? 'active' : ''}`}
            onClick={() => { setIsRegister(true); setAuthError(''); }}
          >
            Create Account
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="field-group">
            <label>Email Address</label>
            <input
              className="auth-input"
              type="email"
              required
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="field-group">
            <label>Password</label>
            <input
              className="auth-input"
              type="password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button className="primary" style={{ width: '100%', marginTop: 8 }} disabled={loading || !isFirebaseConfigured} type="submit">
            {loading ? 'Authenticating...' : isRegister ? 'Create Account' : 'Sign In with Email'}
            <ArrowRight size={16} />
          </button>
        </form>

        <div className="auth-divider">
          <span>OR</span>
        </div>

        <div className="social-auth">
          <button className="social-btn" onClick={handleGoogleLogin} disabled={loading || !isFirebaseConfigured} type="button">
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            Continue with Google
          </button>
        </div>

        <div className="firebase-brand-tag">
          <Flame size={14} color={isFirebaseConfigured ? "#22c55e" : "#ef4444"} />
          <span>{isFirebaseConfigured ? 'Firebase Realtime Database Connected' : 'Awaiting Firebase Credentials'}</span>
        </div>
      </div>
    </div>
  );
}
