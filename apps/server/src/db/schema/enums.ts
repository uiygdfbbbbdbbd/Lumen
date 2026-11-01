import { pgEnum } from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['user', 'moderator', 'admin', 'super_admin']);
export const userStatusEnum = pgEnum('user_status', ['active', 'suspended', 'banned', 'pending_deletion']);
export const emailTokenPurposeEnum = pgEnum('email_token_purpose', [
  'verify_email',
  'reset_password',
  'magic_link',
  'change_email',
]);
