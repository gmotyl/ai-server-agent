import { execSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { parseArgs } from 'node:util'
import { evaluateAssertion } from './assertions.js'
import { createEvalEnvironment, buildPrompt, appendContext } from './context.js'
import { reportCase, reportSummary } from './reporter.js'
import type { EvalCase, CaseResult, TurnResult, EvalRunResult } from './types.js'

const REPO_ROOT = join(import.meta.dirname, '..', '..')

// --- CLI args ---
const { values: rawArgs } = parseArgs({
  options: {
    case: { type: 'string' },
    provider: { type: 'string' },
    verbose: { type: 'boolean', default: false },
  },
  strict: false,
})

const args = {
  case: rawArgs.case as string | undefined,
  provider: rawArgs.provider as string | undefined,
  verbose: (rawArgs.verbose as boolean | undefined) ?? false,
}

// --- Load cases ---
async function loadCases(): Promise<EvalCase[]> {
  const casesDir = join(import.meta.dirname, '..', 'cases')
  const files = readdirSync(casesDir).filter((f) => f.endsWith('.ts'))
  const cases: EvalCase[] = []

  for (const file of files) {
    const name = basename(file, '.ts')
    if (args.case && !matchGlob(name, args.case)) continue
    const mod = await import(join(casesDir, file))
    cases.push(mod.default)
  }

  return cases
}

function matchGlob(name: string, pattern: string): boolean {
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
  return regex.test(name)
}

// --- Run provider ---
function runProvider(
  prompt: string,
  provider: string,
  workdir: string,
): string {
  // Shell out to the real provider via provider.sh's run_provider
  const script = `
    source lib/utils.sh
    source lib/provider.sh
    load_config
    run_provider ${shellEscape(provider)} ${shellEscape(prompt)} ${shellEscape(workdir)}
  `
  const result = execSync(`bash -c ${shellEscape(script)}`, {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    timeout: 300_000,  // 5 min per turn
    maxBuffer: 10 * 1024 * 1024,
  })
  return result
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

// --- Run a single case ---
async function runCase(evalCase: EvalCase): Promise<CaseResult> {
  const provider = args.provider ?? evalCase.provider ?? 'claude'
  const startTime = Date.now()
  const env = createEvalEnvironment(evalCase.name)
  const workdir = evalCase.workdir ?? env.workdir
  const turnResults: TurnResult[] = []

  try {
    if (evalCase.setup) await evalCase.setup(workdir)

    for (let i = 0; i < evalCase.turns.length; i++) {
      const turn = evalCase.turns[i]

      // Build prompt through the real bash pipeline
      const fullPrompt = buildPrompt(env.topicId, turn.user)

      // Run the real provider
      const response = runProvider(fullPrompt, provider, workdir)

      // Accumulate context (just like heartbeat.sh does)
      appendContext(env.topicId, turn.user, response, provider)

      // Evaluate assertions
      const assertions = (turn.assert ?? []).map((a) =>
        evaluateAssertion(a, response, workdir),
      )

      turnResults.push({
        turnIndex: i,
        userMessage: turn.user,
        agentResponse: response,
        assertions,
      })
    }

    if (evalCase.teardown) await evalCase.teardown(workdir)
  } finally {
    env.cleanup()
  }

  const allPassed = turnResults.every((t) =>
    t.assertions.every((a) => a.passed),
  )

  return {
    caseName: evalCase.name,
    turns: turnResults,
    passed: allPassed,
    durationMs: Date.now() - startTime,
  }
}

// --- Main ---
async function main() {
  const cases = await loadCases()

  if (cases.length === 0) {
    console.log('No eval cases found.')
    process.exit(0)
  }

  console.log(`Running ${cases.length} eval case(s)...\n`)

  const caseResults: CaseResult[] = []
  const startTime = Date.now()

  for (const evalCase of cases) {
    const result = await runCase(evalCase)
    reportCase(result, args.verbose)
    caseResults.push(result)
  }

  const allAssertions = caseResults.flatMap((c) =>
    c.turns.flatMap((t) => t.assertions),
  )

  const summary: EvalRunResult = {
    cases: caseResults,
    totalAssertions: allAssertions.length,
    passedAssertions: allAssertions.filter((a) => a.passed).length,
    failedAssertions: allAssertions.filter((a) => !a.passed).length,
    durationMs: Date.now() - startTime,
  }

  reportSummary(summary)
  process.exit(summary.failedAssertions > 0 ? 1 : 0)
}

main()
