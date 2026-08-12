import { checkCommitHistory } from './cog-validation.mts';

const result = await checkCommitHistory();
process.exitCode = result.status ?? 1;
