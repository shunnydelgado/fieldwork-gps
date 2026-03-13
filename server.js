const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Almacenamiento en memoria (simple, sin base de datos)
const locations = {}; // { employeeId: { lat, lng, name, timestamp, jobId, status } }
const history = {};   // { employeeId: [{lat, lng, timestamp}] }

// ── EMPLEADO: enviar ubicación desde celular ──────────────────────
app.post('/location', (req, res) => {
  const { employeeId, name, lat, lng, jobId, status } = req.body;

  if (!employeeId || !lat || !lng) {
    return res.status(400).json({ error: 'Faltan datos: employeeId, lat, lng' });
  }

  const entry = {
    employeeId,
    name: name || 'Empleado',
    lat: parseFloat(lat),
    lng: parseFloat(lng),
    jobId: jobId || null,
    status: status || 'active',
    timestamp: new Date().toISOString()
  };

  locations[employeeId] = entry;

  // Guardar historial (máximo 100 puntos por empleado)
  if (!history[employeeId]) history[employeeId] = [];
  history[employeeId].push({ lat: entry.lat, lng: entry.lng, timestamp: entry.timestamp });
  if (history[employeeId].length > 100) history[employeeId].shift();

  res.json({ ok: true, received: entry });
});

// ── DASHBOARD: obtener todas las ubicaciones ──────────────────────
app.get('/locations', (req, res) => {
  res.json(Object.values(locations));
});

// ── DASHBOARD: historial de un empleado ──────────────────────────
app.get('/history/:employeeId', (req, res) => {
  const { employeeId } = req.params;
  res.json(history[employeeId] || []);
});

// ── EMPLEADO: marcar que salió (offline) ─────────────────────────
app.post('/offline', (req, res) => {
  const { employeeId } = req.body;
  if (locations[employeeId]) {
    locations[employeeId].status = 'offline';
    locations[employeeId].timestamp = new Date().toISOString();
  }
  res.json({ ok: true });
});

// ── HEALTH CHECK (Render lo necesita) ────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'GPS Server corriendo ✅',
    empleados_activos: Object.values(locations).filter(l => l.status === 'active').length,
    total_empleados: Object.keys(locations).length
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 GPS Server corriendo en puerto ${PORT}`);
});
