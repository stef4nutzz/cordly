import 'dotenv/config';

import { parseEnv } from './env-schema';

export { parseEnv };
export type { AppEnv } from './env-schema';
export const env = parseEnv(process.env);
