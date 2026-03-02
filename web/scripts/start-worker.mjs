// Spawns the Python worker with the correct working directory.
// Used by npm run start:all / start:hybrid to avoid shell-specific path issues on Windows.
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'worker')
const python = join(workerDir, '.venv', 'Scripts', 'python.exe')
const args = process.argv.slice(2)

const child = spawn(python, ['worker.py', ...args], {
  cwd: workerDir,
  stdio: 'inherit',
})

child.on('exit', (code) => process.exit(code ?? 0))
