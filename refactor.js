import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const file = path.join(__dirname, 'server.js');

let code = fs.readFileSync(file, 'utf8');

// 1. Remove the global variable declaration
code = code.replace(/let\s+activePatientId\s*=\s*'patient-1';\r?\n?/g, '');
code = code.replace(/const\s+sessions\s*=\s*\{\};\s*\/\/\s*token\s*->\s*userId\r?\n?/g, '');

// 2. Add sessions table to initDatabase
const createSessionsTable = `
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      userId TEXT,
      activePatientId TEXT,
      createdAt TEXT
    );`;

code = code.replace(/CREATE TABLE IF NOT EXISTS users/g, createSessionsTable + '\n\n    CREATE TABLE IF NOT EXISTS users');

// 3. Update optionalAuth to use SQLite sessions
const newOptionalAuth = `// Optional auth middleware (non-blocking for demo — will use if token present)
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      const session = await db.get(\`SELECT * FROM sessions WHERE token = ?\`, [token]);
      if (session) {
        req.userId = session.userId;
        req.user = await db.get(\`SELECT * FROM users WHERE id = ?\`, [req.userId]);
        req.activePatientId = session.activePatientId;
      }
    }
    if (!req.activePatientId) {
      req.activePatientId = 'patient-1';
    }
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    next();
  }
};`;

code = code.replace(/\/\/ Optional auth middleware[\s\S]*?};\n/m, newOptionalAuth + '\n');

// 4. Implement requireCaregiverRole
const requireCaregiverRole = `
// Middleware to enforce RBAC
const requireCaregiverRole = (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Not authenticated.' });
  if (req.user.role === 'family_member') {
    return res.status(403).json({ success: false, message: 'Forbidden. Family members cannot modify clinical data.' });
  }
  next();
};
`;
code = code.replace(/app\.use\(optionalAuth\);/g, 'app.use(optionalAuth);\n' + requireCaregiverRole);

// 5. Replace activePatientId with req.activePatientId inside routes
code = code.replace(/\bactivePatientId\b/g, 'req.activePatientId');

// 6. Update POST /api/auth/register
code = code.replace(
  /const token = `tok_\$\{uid\(\)\}\$\{uid\(\)\}`;[\s\S]*?sessions\[token\] = userId;/g,
  `const token = crypto.randomUUID();
    await db.run(
      \`INSERT INTO sessions (token, userId, activePatientId, createdAt) VALUES (?, ?, ?, ?)\`,
      [token, userId, 'patient-1', now().toISOString()]
    );`
);

// 7. Update POST /api/auth/login
code = code.replace(
  /const token = `tok_\$\{uid\(\)\}\$\{uid\(\)\}`;[\s\S]*?sessions\[token\] = user\.id;/g,
  `const token = crypto.randomUUID();
    await db.run(
      \`INSERT INTO sessions (token, userId, activePatientId, createdAt) VALUES (?, ?, ?, ?)\`,
      [token, user.id, 'patient-1', now().toISOString()]
    );`
);

// 8. Update POST /api/auth/logout
code = code.replace(
  /if \(token\) delete sessions\[token\];/g,
  `if (token) await db.run(\`DELETE FROM sessions WHERE token = ?\`, [token]);`
);

// 9. Update POST /api/patients/:id/activate
code = code.replace(
  /req\.activePatientId = id;/g,
  `const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      await db.run(\`UPDATE sessions SET activePatientId = ? WHERE token = ?\`, [id, token]);
    }
    req.activePatientId = id;`
);

// 10. Add requireCaregiverRole to mutating routes
code = code.replace(/app\.post\('\/api\/meds\/add',/g, "app.post('/api/meds/add', requireCaregiverRole,");
code = code.replace(/app\.post\('\/api\/meds\/:id\/toggle',/g, "app.post('/api/meds/:id/toggle', requireCaregiverRole,");
code = code.replace(/app\.post\('\/api\/care-plans',/g, "app.post('/api/care-plans', requireCaregiverRole,");
code = code.replace(/app\.patch\('\/api\/care-plans\/:id\/status',/g, "app.patch('/api/care-plans/:id/status', requireCaregiverRole,");
code = code.replace(/app\.post\('\/api\/alerts\/:id\/resolve',/g, "app.post('/api/alerts/:id/resolve', requireCaregiverRole,");
code = code.replace(/app\.post\('\/api\/nutrition',/g, "app.post('/api/nutrition', requireCaregiverRole,");
code = code.replace(/app\.patch\('\/api\/patient',/g, "app.patch('/api/patient', requireCaregiverRole,");

fs.writeFileSync(file, code);
console.log('Refactoring complete.');
