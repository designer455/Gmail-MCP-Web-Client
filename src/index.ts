import { createApp } from './app.js';
import { getEnv } from './config/env.js';
import { logger } from './utils/logger.js';

const env = getEnv();
const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`====================================================`);
  logger.info(`Gmail MCP Server running on http://localhost:${env.PORT}`);
  logger.info(`Environment: ${env.NODE_ENV}`);
  logger.info(`OAuth Redirect URI: ${env.GOOGLE_REDIRECT_URI}`);
  logger.info(`TokenStore: development-memory (NON-PRODUCTION TOKEN STORAGE)`);
  logger.info(`MCP SSE Endpoint: http://localhost:${env.PORT}/sse`);
  logger.info(`====================================================`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    logger.info('Server terminated.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  server.close(() => {
    logger.info('Server terminated.');
    process.exit(0);
  });
});
