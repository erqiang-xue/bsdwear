import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));

export const defaultEnvPath = path.resolve(here, '../../.env');

export function loadEnvFile(envPath = defaultEnvPath, processEnv = process.env) {
  dotenv.config({ path: envPath, processEnv, quiet: true });
  return envPath;
}
