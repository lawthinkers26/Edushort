import { Router } from 'express';
import {
  getConfig,
  getReel,
  getStats,
  getUploadStatus,
  listReels,
  patchReel,
  postReel,
  postUpload,
  putConfig,
  removeReel,
} from '../controllers/adminController';
import { authenticate } from '../middleware/authenticate';
import { requireAdmin } from '../middleware/requireAdmin';

export const adminRouter = Router();

adminRouter.use(authenticate({ checkRevoked: true }), requireAdmin);

adminRouter.get('/config', getConfig);
adminRouter.put('/config', putConfig);
adminRouter.get('/stats', getStats);

adminRouter.post('/uploads', postUpload);
adminRouter.get('/uploads/:videoId', getUploadStatus);

adminRouter.get('/reels', listReels);
adminRouter.post('/reels', postReel);
adminRouter.get('/reels/:id', getReel);
adminRouter.patch('/reels/:id', patchReel);
adminRouter.delete('/reels/:id', removeReel);
