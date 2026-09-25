import { Router } from 'express';
import {
  getComments,
  getFeed,
  getReel,
  getSavedReels,
  likeReel,
  postComment,
  postView,
  saveReel,
  unlikeReel,
  unsaveReel,
} from '../controllers/reelController';
import { authenticate } from '../middleware/authenticate';
import { subscriptionGuard } from '../middleware/subscriptionGuard';

export const reelRouter = Router();

reelRouter.use(authenticate());

// The video feed is the metered resource.
reelRouter.get('/feed', subscriptionGuard, getFeed);
reelRouter.get('/saved', getSavedReels);
reelRouter.get('/:id', getReel);

reelRouter.post('/:id/view', postView);

reelRouter.post('/:id/like', likeReel);
reelRouter.delete('/:id/like', unlikeReel);
reelRouter.post('/:id/save', saveReel);
reelRouter.delete('/:id/save', unsaveReel);

reelRouter.get('/:id/comments', getComments);
reelRouter.post('/:id/comments', postComment);
