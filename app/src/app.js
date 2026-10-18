import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authRoutes } from './routes/auth.js';
import { deviceRoutes } from './routes/device.js';
import { studentsRoutes } from './routes/students.js';
import { groupsRoutes } from './routes/groups.js';
import { rulesRoutes } from './routes/rules.js';
import { pointsRoutes } from './routes/points.js';
import { recordsRoutes } from './routes/records.js';
import { announcementsRoutes } from './routes/announcements.js';
import { systemAnnouncementsRoutes } from './routes/system-announcements.js';
import { frontMessagesRoutes } from './routes/front-messages.js';
import { rankingsRoutes } from './routes/rankings.js';
import { uploadRoutes } from './routes/upload.js';
import { backupRoutes } from './routes/backup.js';
import { configRoutes } from './routes/config.js';
import { superRoutes } from './routes/super.js';
import { syncRoutes } from './routes/sync.js';
import { snapshotRoutes } from './routes/snapshot.js';
import { feedbackRoutes } from './routes/feedback.js';
import { publicRoutes } from './routes/public.js';

export function createApp({ db, storage, origin = 'node', syncSecret = '', peerUrl = '' }) {
  const app = new Hono();
  app.use('/api/*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Device-Token', 'X-Sync-Key'],
  }));

  app.use('/api/*', async (c, next) => {
    c.set('db', db);
    c.set('storage', storage);
    c.set('origin', origin);
    c.set('syncSecret', syncSecret);
    c.set('peerUrl', peerUrl);
    await next();
  });

  app.route('/api', authRoutes());
  app.route('/api', deviceRoutes());
  app.route('/api', studentsRoutes());
  app.route('/api', groupsRoutes());
  app.route('/api', rulesRoutes());
  app.route('/api', pointsRoutes());
  app.route('/api', recordsRoutes());
  app.route('/api', announcementsRoutes());
  app.route('/api', systemAnnouncementsRoutes());
  app.route('/api', frontMessagesRoutes());
  app.route('/api', rankingsRoutes());
  app.route('/api', uploadRoutes());
  app.route('/api', backupRoutes());
  app.route('/api', configRoutes());
  app.route('/api', superRoutes());
  app.route('/api', syncRoutes());
  app.route('/api', snapshotRoutes());
  app.route('/api', feedbackRoutes());
  app.route('/api', publicRoutes());

  app.onError((err, c) => {
    console.error('[app error]', err);
    return c.json({ ok: false, error: err.message || 'server error' }, 500);
  });

  return app;
}
