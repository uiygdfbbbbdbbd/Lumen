import { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { Config } from './config/index.js';
import { createDb, type Database, type DbHandle } from './db/client.js';
import { SecretBox } from './lib/crypto.js';
import { createLogger } from './lib/logger.js';
import { hibpChecker, PasswordHasher, type BreachChecker } from './lib/password.js';
import { MemoryRateLimiter, RedisRateLimiter, type RateLimiter } from './lib/rate-limit.js';
import { TokenHasher } from './lib/tokens.js';
import type { AuthContext } from './http/types.js';
import { AuditService } from './services/audit/audit.service.js';
import { AuthService } from './services/auth/auth.service.js';
import { noCaptcha, remoteCaptcha, type CaptchaVerifier } from './services/auth/captcha.js';
import { EmailTokenService } from './services/auth/email-token.service.js';
import { SessionService } from './services/auth/session.service.js';
import { TotpService } from './services/auth/totp.service.js';
import { EmailService } from './services/email/email.service.js';
import { LogTransport, MemoryTransport, SmtpTransport, type EmailTransport } from './services/email/transports.js';
import { EntitlementService } from './services/entitlements/entitlements.service.js';
import { SettingsService } from './services/settings/settings.service.js';
import { FsStorage, S3Storage, type StorageDriver } from './services/storage/storage.js';
import { UserService } from './services/users/user.service.js';
import { ProviderService } from './services/providers/provider.service.js';
import { ModelCatalogService } from './services/models/catalog.service.js';
import { MemoryStreamHub, RedisStreamHub, type StreamHub } from './lib/realtime/stream-hub.js';
import { MemoryEventBus, RedisEventBus, type EventBus } from './lib/realtime/event-bus.js';
import { MemoryConcurrencyLimiter, RedisConcurrencyLimiter, type ConcurrencyLimiter } from './lib/realtime/concurrency.js';
import { ConversationService } from './services/chat/conversation.service.js';
import { GenerationRunner } from './services/chat/generation.js';
import { ChatService } from './services/chat/chat.service.js';
import { StyleService } from './services/chat/styles.service.js';
import { ToolRegistry } from './services/tools/registry.js';
import { calculatorTool, datetimeTool } from './services/tools/calculator.js';
import { fileSearchTool } from './services/tools/file-search.js';
import { BullJobQueue, MemoryJobQueue, type JobQueue } from './lib/jobs.js';
import { ClamdScanner, noScanner, type VirusScanner } from './lib/clamav.js';
import { EmbeddingService } from './services/files/embedding.service.js';
import { RetrievalService } from './services/files/retrieval.service.js';
import { FileContextBuilder } from './services/files/context.js';
import { FileService } from './services/files/file.service.js';
import { ProjectService } from './services/projects/project.service.js';
import { registerExporters } from './services/users/exporters.js';
import type { SsrfOptions } from './lib/ssrf.js';

export interface ApiKeyAuthenticator {
  authenticate(token: string, ip: string): Promise<AuthContext>;
}

export interface ContainerOverrides {
  db?: DbHandle;
  redis?: Redis | null;
  emailTransport?: EmailTransport;
  storage?: StorageDriver;
  rateLimiter?: RateLimiter;
  hasher?: PasswordHasher;
  captcha?: CaptchaVerifier;
  breachChecker?: BreachChecker | null;
  logger?: Logger;
  now?: () => Date;
  hub?: StreamHub;
  bus?: EventBus;
  jobs?: JobQueue;
  scanner?: VirusScanner;
  /** Test hook: SSRF options for knowledge-base URL fetching. */
  urlFetch?: SsrfOptions;
}

export interface Container {
  config: Config;
  log: Logger;
  dbHandle: DbHandle;
  db: Database;
  redis: Redis | null;
  box: SecretBox;
  tokenHasher: TokenHasher;
  hasher: PasswordHasher;
  rateLimiter: RateLimiter;
  storage: StorageDriver;
  emailTransport: EmailTransport;
  settings: SettingsService;
  audit: AuditService;
  email: EmailService;
  entitlements: EntitlementService;
  sessions: SessionService;
  emailTokens: EmailTokenService;
  totp: TotpService;
  auth: AuthService;
  users: UserService;
  providers: ProviderService;
  catalog: ModelCatalogService;
  hub: StreamHub;
  bus: EventBus;
  concurrency: ConcurrencyLimiter;
  tools: ToolRegistry;
  conversations: ConversationService;
  runner: GenerationRunner;
  chat: ChatService;
  styles: StyleService;
  jobs: JobQueue;
  embeddings: EmbeddingService;
  retrieval: RetrievalService;
  fileContext: FileContextBuilder;
  files: FileService;
  projects: ProjectService;
  apiKeyAuth: ApiKeyAuthenticator | null;
  now: () => Date;
  close(): Promise<void>;
}

export function createContainer(config: Config, o: ContainerOverrides = {}): Container {
  const log = o.logger ?? createLogger(config.LOG_LEVEL, !config.isProd && !config.isTest);
  const now = o.now ?? (() => new Date());
  const dbHandle = o.db ?? createDb(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX });
  const db = dbHandle.db;
  const redis =
    o.redis !== undefined ? o.redis : config.REDIS_URL ? new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: false }) : null;
  const box = new SecretBox(config.encryptionKeys);
  const tokenHasher = new TokenHasher(config.SESSION_SECRET);
  const hasher = o.hasher ?? new PasswordHasher();
  const rateLimiter = o.rateLimiter ?? (redis ? new RedisRateLimiter(redis) : new MemoryRateLimiter());
  const storage =
    o.storage ??
    (config.STORAGE_DRIVER === 's3'
      ? S3Storage.fromConfig({
          endpoint: config.S3_ENDPOINT,
          region: config.S3_REGION,
          bucket: config.S3_BUCKET,
          accessKeyId: config.S3_ACCESS_KEY_ID,
          secretAccessKey: config.S3_SECRET_ACCESS_KEY,
          forcePathStyle: config.S3_FORCE_PATH_STYLE,
        })
      : new FsStorage(config.STORAGE_FS_ROOT));
  const emailTransport =
    o.emailTransport ??
    (config.EMAIL_TRANSPORT === 'smtp'
      ? new SmtpTransport({ host: config.SMTP_HOST!, port: config.SMTP_PORT, secure: config.SMTP_SECURE, user: config.SMTP_USER, password: config.SMTP_PASSWORD })
      : config.EMAIL_TRANSPORT === 'memory'
        ? new MemoryTransport()
        : new LogTransport(log));

  const settings = new SettingsService(db, config.isTest ? 0 : 5_000);
  const audit = new AuditService(db);
  const email = new EmailService(db, emailTransport, settings, { from: config.EMAIL_FROM, publicUrl: config.PUBLIC_URL }, log);
  const entitlements = new EntitlementService(db, settings, now);
  const sessions = new SessionService(db, tokenHasher, {
    ttlMs: config.SESSION_TTL_DAYS * 86400_000,
    rotateAfterMs: config.SESSION_ROTATE_HOURS * 3600_000,
    graceMs: 60_000,
    now,
  });
  const emailTokens = new EmailTokenService(db, tokenHasher, now);
  const totp = new TotpService(db, box, tokenHasher, async () => (await settings.get('branding')).productName, () => now().getTime());
  const captcha =
    o.captcha ?? (config.CAPTCHA_PROVIDER !== 'none' && config.CAPTCHA_SECRET ? remoteCaptcha(config.CAPTCHA_PROVIDER, config.CAPTCHA_SECRET) : noCaptcha);
  const auth = new AuthService({
    db,
    hasher,
    sessions,
    tokens: emailTokens,
    totp,
    email,
    settings,
    audit,
    rateLimiter,
    captcha,
    breachChecker: o.breachChecker !== undefined ? o.breachChecker : config.HIBP_CHECK ? hibpChecker() : null,
    publicUrl: config.PUBLIC_URL,
    log,
    now,
    rateLimitMultiplier: config.RATE_LIMIT_MULTIPLIER,
  });
  const users = new UserService(db, storage, audit, settings, hasher, config.API_URL, now);
  const providers = new ProviderService(db, box, storage, audit, email, config, log, now);
  const catalog = new ModelCatalogService(db, audit, config.API_URL);
  const hub = o.hub ?? (redis && config.REDIS_URL ? new RedisStreamHub(redis, () => new Redis(config.REDIS_URL!)) : new MemoryStreamHub());
  const bus = o.bus ?? (redis && config.REDIS_URL ? new RedisEventBus(redis, new Redis(config.REDIS_URL)) : new MemoryEventBus());
  const concurrency = redis ? new RedisConcurrencyLimiter(redis) : new MemoryConcurrencyLimiter();
  const jobs = o.jobs ?? (redis && config.REDIS_URL ? new BullJobQueue({ url: config.REDIS_URL }, config.RUN_WORKERS, log) : new MemoryJobQueue(log));
  const scanner = o.scanner ?? (config.CLAMAV_HOST ? new ClamdScanner(config.CLAMAV_HOST, config.CLAMAV_PORT) : noScanner);
  const embeddings = new EmbeddingService(db, settings, catalog, providers);
  const retrieval = new RetrievalService(db, embeddings);
  const fileContext = new FileContextBuilder(db, storage, settings, retrieval);
  const projects = new ProjectService(db, storage, audit, now);
  const filesSvc = new FileService(db, storage, settings, jobs, embeddings, scanner, () => projects, log, now, o.urlFetch);
  registerExporters(users, db, storage);
  const tools = new ToolRegistry().register(calculatorTool).register(datetimeTool).register(fileSearchTool(retrieval));
  const conversationsSvc = new ConversationService(db, bus, now);
  const runner = new GenerationRunner({ db, hub, bus, providers, catalog, entitlements, tools, rateLimiter, log, now });
  const chat = new ChatService({ db, conversations: conversationsSvc, catalog, providers, entitlements, settings, runner, concurrency, rateLimiter, bus, log, now, files: filesSvc, fileContext, projects });
  const stylesSvc = new StyleService(db, catalog, providers);

  return {
    config,
    log,
    dbHandle,
    db,
    redis,
    box,
    tokenHasher,
    hasher,
    rateLimiter,
    storage,
    emailTransport,
    settings,
    audit,
    email,
    entitlements,
    sessions,
    emailTokens,
    totp,
    auth,
    users,
    providers,
    catalog,
    hub,
    bus,
    concurrency,
    tools,
    conversations: conversationsSvc,
    runner,
    chat,
    styles: stylesSvc,
    jobs,
    embeddings,
    retrieval,
    fileContext,
    files: filesSvc,
    projects,
    apiKeyAuth: null,
    now,
    async close() {
      await jobs.close();
      await bus.close();
      await dbHandle.close();
      if (redis && o.redis === undefined) redis.disconnect();
    },
  };
}
