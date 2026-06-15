const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── PERSISTENCIA EN ARCHIVO ───────────────────────────────────────
const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch(e) { console.log('Error cargando datos:', e.message); }
  return { jobs: [], employees: [], clients: [], company: {}, taskUpdates: {}, employeeCredentials: {} };
}

function saveData() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }
  catch(e) { console.log('Error guardando:', e.message); }
}

// ── BASE DE DATOS ─────────────────────────────────────────────────
const db = loadData();
if (!db.jobs) db.jobs = [];
if (!db.employees) db.employees = [];
if (!db.clients) db.clients = [];
if (!db.company) db.company = {};
if (!db.taskUpdates) db.taskUpdates = {};
if (!db.employeeCredentials) db.employeeCredentials = {};

const locations = {};
const history = {};

console.log(`📦 Datos cargados: ${db.jobs.length} trabajos, ${db.employees.length} empleados, ${db.clients.length} clientes`);

// ── ADMIN: guardar todos los datos ────────────────────────────────
app.post('/save-all', (req, res) => {
  const { jobs, employees, clients, company } = req.body;
  if (jobs !== undefined) db.jobs = jobs;
  if (employees !== undefined) db.employees = employees;
  if (clients !== undefined) db.clients = clients;
  if (company !== undefined) db.company = company;

  // Rebuild employee credentials
  db.employeeCredentials = {};
  db.employees.forEach(e => {
    if (e.empId) db.employeeCredentials[e.empId] = { name: e.name, password: e.password || '', adminId: e.id };
  });

  saveData();
  console.log(`💾 Guardado: ${db.jobs.length} trabajos, ${db.employees.length} empleados, ${db.clients.length} clientes`);
  res.json({ ok: true, jobs: db.jobs.length, employees: db.employees.length, clients: db.clients.length });
});

// ── ADMIN: cargar todos los datos ─────────────────────────────────
app.get('/load-all', (req, res) => {
  res.json({ jobs: db.jobs, employees: db.employees, clients: db.clients, company: db.company });
});

// ── ADMIN: sync jobs (mantener compatibilidad) ────────────────────
app.post('/sync-jobs', (req, res) => {
  const { jobsData } = req.body;
  if (!Array.isArray(jobsData)) return res.status(400).json({ error: 'jobsData debe ser array' });
  db.jobs = jobsData;
  saveData();
  res.json({ ok: true, total: db.jobs.length });
});

// ── ADMIN: sync employees ─────────────────────────────────────────
app.post('/sync-employees', (req, res) => {
  const { employees } = req.body;
  if (!Array.isArray(employees)) return res.status(400).json({ error: 'employees debe ser array' });
  db.employees = employees;
  db.employeeCredentials = {};
  employees.forEach(e => {
    if (e.empId) db.employeeCredentials[e.empId] = { name: e.name, password: e.password || '', adminId: e.id };
  });
  saveData();
  res.json({ ok: true });
});

// ── ADMIN: debug ver todos los trabajos ──────────────────────────
app.get('/all-jobs', (req, res) => res.json(db.jobs.map(j => ({
  id: j.id, employeeId: j.employeeId, empId: j.empId, date: j.date, client: j.clientName
}))));

// ── EMPLEADO: login ───────────────────────────────────────────────
app.post('/login', (req, res) => {
  const { empId, password } = req.body;
  const cred = db.employeeCredentials[empId];
  if (!cred) return res.status(401).json({ error: 'ID de empleado no encontrado' });
  if (cred.password && cred.password !== password) return res.status(401).json({ error: 'Contraseña incorrecta' });
  res.json({ ok: true, name: cred.name, adminId: cred.adminId });
});

// ── EMPLEADO: obtener sus trabajos del mes ────────────────────────
app.get('/my-jobs/:employeeId', (req, res) => {
  const { employeeId } = req.params;
  const today = new Date().toISOString().split('T')[0];
  const monthPrefix = today.slice(0, 7);
  const myJobs = db.jobs
    .filter(j => {
      const matchById = String(j.employeeId) === String(employeeId);
      const matchByEmpId = j.empId && String(j.empId) === String(employeeId);
      const matchByMonth = j.date && j.date.startsWith(monthPrefix);
      return (matchById || matchByEmpId) && matchByMonth;
    })
    .map(job => {
      const updates = db.taskUpdates[job.id] || {};
      const tasks = (job.tasks || []).map(task => ({
        ...task, done: updates[task.id] !== undefined ? updates[task.id] : task.done
      }));
      return { ...job, tasks };
    });
  res.json(myJobs);
});

// ── EMPLEADO: GPS ─────────────────────────────────────────────────
app.post('/location', (req, res) => {
  const { employeeId, name, lat, lng, jobId, status } = req.body;
  if (!employeeId || !lat || !lng) return res.status(400).json({ error: 'Faltan datos' });
  const entry = { employeeId, name: name||'Empleado', lat: parseFloat(lat), lng: parseFloat(lng), jobId: jobId||null, status: status||'active', timestamp: new Date().toISOString() };
  locations[employeeId] = entry;
  if (!history[employeeId]) history[employeeId] = [];
  history[employeeId].push({ lat: entry.lat, lng: entry.lng, timestamp: entry.timestamp });
  if (history[employeeId].length > 100) history[employeeId].shift();
  res.json({ ok: true });
});

app.get('/locations', (req, res) => res.json(Object.values(locations)));
app.get('/history/:employeeId', (req, res) => res.json(history[req.params.employeeId] || []));

app.post('/offline', (req, res) => {
  const { employeeId } = req.body;
  if (locations[employeeId]) { locations[employeeId].status = 'offline'; locations[employeeId].timestamp = new Date().toISOString(); }
  res.json({ ok: true });
});

// ── EMPLEADO: tareas y status ─────────────────────────────────────
app.post('/update-task', (req, res) => {
  const { jobId, taskId, done, employeeId } = req.body;
  if (!jobId || !taskId) return res.status(400).json({ error: 'Faltan jobId y taskId' });
  if (!db.taskUpdates[jobId]) db.taskUpdates[jobId] = {};
  db.taskUpdates[jobId][taskId] = done;
  saveData();
  res.json({ ok: true });
});

app.get('/task-updates', (req, res) => res.json(db.taskUpdates));

app.post('/update-job-status', (req, res) => {
  const { jobId, status, employeeId } = req.body;
  const job = db.jobs.find(j => j.id === jobId);
  if (job) { job.status = status; saveData(); }
  res.json({ ok: true });
});

// ── HEALTH CHECK ──────────────────────────────────────────────────
app.get('/', (req, res) => res.json({
  status: 'FieldWork GPS Server ✅',
  empleados_activos: Object.values(locations).filter(l => l.status === 'active').length,
  total_empleados: Object.keys(locations).length,
  trabajos_sincronizados: db.jobs.length,
  empleados_guardados: db.employees.length,
  clientes_guardados: db.clients.length
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 FieldWork Server corriendo en puerto ${PORT}`));
