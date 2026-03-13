const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// ── ALMACENAMIENTO EN MEMORIA ─────────────────────────────────────
const locations = {};  // { employeeId: { lat, lng, name, timestamp, jobId, status } }
const history = {};    // { employeeId: [{lat, lng, timestamp}] }
let jobs = [];         // Lista de trabajos sincronizada desde el admin
let taskUpdates = {};  // { jobId: { taskId: done } } — actualizaciones de empleados

// ── EMPLEADO: enviar ubicación ────────────────────────────────────
app.post('/location', (req, res) => {
  const { employeeId, name, lat, lng, jobId, status } = req.body;
  if (!employeeId || !lat || !lng)
    return res.status(400).json({ error: 'Faltan datos: employeeId, lat, lng' });

  const entry = {
    employeeId, name: name || 'Empleado',
    lat: parseFloat(lat), lng: parseFloat(lng),
    jobId: jobId || null, status: status || 'active',
    timestamp: new Date().toISOString()
  };
  locations[employeeId] = entry;

  if (!history[employeeId]) history[employeeId] = [];
  history[employeeId].push({ lat: entry.lat, lng: entry.lng, timestamp: entry.timestamp });
  if (history[employeeId].length > 100) history[employeeId].shift();

  res.json({ ok: true, received: entry });
});

// ── DASHBOARD: obtener todas las ubicaciones ──────────────────────
app.get('/locations', (req, res) => res.json(Object.values(locations)));

// ── DASHBOARD: historial de un empleado ──────────────────────────
app.get('/history/:employeeId', (req, res) =>
  res.json(history[req.params.employeeId] || []));

// ── EMPLEADO: marcar offline ──────────────────────────────────────
app.post('/offline', (req, res) => {
  const { employeeId } = req.body;
  if (locations[employeeId]) {
    locations[employeeId].status = 'offline';
    locations[employeeId].timestamp = new Date().toISOString();
  }
  res.json({ ok: true });
});

let employeeCredentials = {}; // { empId: { name, password, adminId } }

// ── ADMIN: sync employee credentials ─────────────────────────────
app.post('/sync-employees', (req, res) => {
  const { employees } = req.body;
  if (!Array.isArray(employees)) return res.status(400).json({ error: 'employees debe ser array' });
  employeeCredentials = {};
  employees.forEach(e => {
    if (e.empId) employeeCredentials[e.empId] = { name: e.name, password: e.password || '', adminId: e.id };
  });
  console.log(`👥 Sincronizados ${employees.length} empleados`);
  res.json({ ok: true });
});

// ── EMPLEADO: validar login con contraseña ────────────────────────
app.post('/login', (req, res) => {
  const { empId, password } = req.body;
  const cred = employeeCredentials[empId];
  if (!cred) return res.status(401).json({ error: 'ID de empleado no encontrado' });
  if (cred.password && cred.password !== password)
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  res.json({ ok: true, name: cred.name, adminId: cred.adminId });
});
app.post('/sync-jobs', (req, res) => {
  const { jobsData } = req.body;
  if (!Array.isArray(jobsData))
    return res.status(400).json({ error: 'jobsData debe ser un array' });
  jobs = jobsData;
  console.log(`📋 Sincronizados ${jobs.length} trabajos`);
  res.json({ ok: true, total: jobs.length });
});

// ── EMPLEADO: obtener sus trabajos del día ────────────────────────
app.get('/my-jobs/:employeeId', (req, res) => {
  const { employeeId } = req.params;
  const today = new Date().toISOString().split('T')[0];
  const monthPrefix = today.slice(0, 7); // "2026-03"

  const myJobs = jobs
    .filter(j => String(j.employeeId) === String(employeeId) && j.date && j.date.startsWith(monthPrefix))
    .map(job => {
      // Aplicar actualizaciones de tareas del empleado
      const updates = taskUpdates[job.id] || {};
      const tasks = (job.tasks || []).map(task => ({
        ...task,
        done: updates[task.id] !== undefined ? updates[task.id] : task.done
      }));
      return { ...job, tasks };
    });

  res.json(myJobs);
});

// ── EMPLEADO: marcar/desmarcar una tarea ─────────────────────────
app.post('/update-task', (req, res) => {
  const { jobId, taskId, done, employeeId } = req.body;
  if (!jobId || !taskId)
    return res.status(400).json({ error: 'Faltan jobId y taskId' });

  if (!taskUpdates[jobId]) taskUpdates[jobId] = {};
  taskUpdates[jobId][taskId] = done;

  console.log(`✅ Empleado ${employeeId} marcó tarea ${taskId} del trabajo ${jobId}: ${done}`);
  res.json({ ok: true });
});

// ── ADMIN: obtener actualizaciones de tareas ──────────────────────
app.get('/task-updates', (req, res) => res.json(taskUpdates));

// ── EMPLEADO: actualizar estado de un trabajo ─────────────────────
app.post('/update-job-status', (req, res) => {
  const { jobId, status, employeeId } = req.body;
  const job = jobs.find(j => j.id === jobId);
  if (job) {
    job.status = status;
    console.log(`🔄 Trabajo ${jobId} actualizado a: ${status} por empleado ${employeeId}`);
  }
  res.json({ ok: true });
});

// ── HEALTH CHECK ──────────────────────────────────────────────────
app.get('/', (req, res) => res.json({
  status: 'FieldWork GPS Server ✅',
  empleados_activos: Object.values(locations).filter(l => l.status === 'active').length,
  total_empleados: Object.keys(locations).length,
  trabajos_sincronizados: jobs.length
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 FieldWork Server corriendo en puerto ${PORT}`));
