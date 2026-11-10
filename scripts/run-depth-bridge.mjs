import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const isWindows = process.platform === 'win32'
const command = isWindows ? 'powershell.exe' : 'sh'
const args = isWindows
  ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve(scriptsDir, 'run-depth-bridge.ps1')]
  : [resolve(scriptsDir, 'run-depth-bridge.sh')]

const bridge = spawn(command, args, { stdio: 'inherit' })
bridge.on('error', (error) => {
  console.error(`Could not start depth bridge: ${error.message}`)
  process.exitCode = 1
})
bridge.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
