import { verifyCommitFile } from './cog-validation.mts';

const file = process.argv[2];
if (!file) throw new Error('commit message file is required');

const result = await verifyCommitFile(file);
process.exitCode = result.status ?? 1;
