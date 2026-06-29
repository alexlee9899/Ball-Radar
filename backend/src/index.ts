import 'dotenv/config'; // load backend/.env before anything reads process.env
import app from './app.js';
import { initDb, initGeo } from './db.js';
import { syncAdmins } from './auth.js';

const PORT = process.env.PORT || 4000;

// Ensure schema exists (+ PostGIS, + admin promotion) before accepting traffic.
initDb()
  .then(() => initGeo())
  .then(() => syncAdmins())
  .catch((err) => console.error('Database init failed:', err))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`🏀 Ball Radar API running at http://localhost:${PORT}`);
      console.log(`   Email mode: ${process.env.EMAIL_MODE === 'smtp' ? 'SMTP (real send)' : 'DEV (code printed in this log)'}`);
    });
  });
