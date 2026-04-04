import { execSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

// Resolve repo root (eval/ is inside the repo)
const REPO_ROOT = join(import.meta.dirname, '..', '..')

export function createEvalEnvironment(caseName: string): {
  topicId: string
  workdir: string
  cleanup: () => void
} {
  const timestamp = Date.now()
  const topicId = `eval-${caseName}-${timestamp}`
  const workdir = `/tmp/eval-${caseName}-${timestamp}`

  mkdirSync(workdir, { recursive: true })

  return {
    topicId,
    workdir,
    cleanup: () => {
      rmSync(workdir, { recursive: true, force: true })
      // Clean up topic memory dir
      const topicDir = join(REPO_ROOT, 'memory', 'topics', topicId)
      rmSync(topicDir, { recursive: true, force: true })
    },
  }
}

export function buildPrompt(topicId: string, message: string): string {
  const result = execSync(
    `bash bin/build-prompt.sh ${shellEscape(topicId)} ${shellEscape(message)}`,
    { cwd: REPO_ROOT, encoding: 'utf-8', timeout: 10_000 },
  )
  return result
}

export function appendContext(
  topicId: string,
  userMsg: string,
  response: string,
  provider: string,
): void {
  execSync(
    `bash bin/append-context.sh ${shellEscape(topicId)} ${shellEscape(userMsg)} ${shellEscape(response)} ${shellEscape(provider)}`,
    { cwd: REPO_ROOT, encoding: 'utf-8', timeout: 10_000 },
  )
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}
