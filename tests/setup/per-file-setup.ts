// Runs in each test worker before the test file imports the app (and thus src/config/env.ts).
import { applyTestEnv } from './test-env.js';

applyTestEnv();
