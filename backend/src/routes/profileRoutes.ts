import { Router } from 'express';
import { getMe, patchMe } from '../controllers/profileController';
import { authenticate } from '../middleware/authenticate';

export const profileRouter = Router();

profileRouter.use(authenticate());
profileRouter.get('/', getMe);
profileRouter.patch('/', patchMe);
