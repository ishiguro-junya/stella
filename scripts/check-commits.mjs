import { checkCommitHistory } from './cog-validation.mjs';

const result = await checkCommitHistory();
process.exitCode = result.status ?? 1;
