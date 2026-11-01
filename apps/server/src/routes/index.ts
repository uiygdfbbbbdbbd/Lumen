import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';
import { authRoutes } from './auth.routes.js';
import { meRoutes } from './me.routes.js';
import { publicRoutes } from './public.routes.js';
import { modelRoutes } from './models.routes.js';
import { adminProviderRoutes } from './admin/providers.routes.js';
import { chatRoutes } from './chat.routes.js';
import { realtimeRoutes } from './realtime.routes.js';
import { fileRoutes } from './files.routes.js';
import { projectRoutes } from './projects.routes.js';
import { adminSettingsRoutes } from './admin/settings.routes.js';
import { artifactRoutes } from './artifacts.routes.js';
import { memoryRoutes } from './memory.routes.js';
import { researchRoutes } from './research.routes.js';

export async function registerRoutes(app: FastifyInstance, c: Container) {
  publicRoutes(app, c);
  authRoutes(app, c);
  meRoutes(app, c);
  modelRoutes(app, c);
  adminProviderRoutes(app, c);
  chatRoutes(app, c);
  realtimeRoutes(app, c);
  fileRoutes(app, c);
  projectRoutes(app, c);
  adminSettingsRoutes(app, c);
  artifactRoutes(app, c);
  memoryRoutes(app, c);
  researchRoutes(app, c);
}
