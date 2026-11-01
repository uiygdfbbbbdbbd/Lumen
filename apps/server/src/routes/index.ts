import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';
import { authRoutes } from './auth.routes.js';
import { meRoutes } from './me.routes.js';
import { publicRoutes } from './public.routes.js';

export async function registerRoutes(app: FastifyInstance, c: Container) {
  publicRoutes(app, c);
  authRoutes(app, c);
  meRoutes(app, c);
}
