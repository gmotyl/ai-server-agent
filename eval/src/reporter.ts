import type { CaseResult, EvalRunResult, TurnResult } from './types.js'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

function pass(msg: string): string {
  return `  ${GREEN}✓${RESET} ${msg}`
}

function fail(msg: string): string {
  return `  ${RED}✗${RESET} ${msg}`
}

export function reportTurn(turn: TurnResult, verbose: boolean): void {
  console.log(`\n${DIM}Turn ${turn.turnIndex}: "${turn.userMessage.slice(0, 60)}..."${RESET}`)
  if (verbose) {
    console.log(`${DIM}Response: ${turn.agentResponse.slice(0, 200)}...${RESET}`)
  }
  for (const a of turn.assertions) {
    console.log(a.passed ? pass(a.message) : fail(a.message))
  }
}

export function reportCase(result: CaseResult, verbose: boolean): void {
  const allPassed = result.passed
  const icon = allPassed ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`
  const duration = `${(result.durationMs / 1000).toFixed(1)}s`
  console.log(`\n${BOLD}${icon} ${result.caseName}${RESET} ${DIM}(${duration})${RESET}`)

  for (const turn of result.turns) {
    reportTurn(turn, verbose)
  }
}

export function reportSummary(result: EvalRunResult): void {
  const duration = `${(result.durationMs / 1000).toFixed(1)}s`
  const color = result.failedAssertions === 0 ? GREEN : RED
  console.log(`\n${BOLD}━━━ Eval Summary ━━━${RESET}`)
  console.log(`${color}${result.passedAssertions}/${result.totalAssertions} assertions passed${RESET} in ${duration}`)

  if (result.failedAssertions > 0) {
    console.log(`\n${RED}Failed:${RESET}`)
    for (const c of result.cases) {
      for (const t of c.turns) {
        for (const a of t.assertions) {
          if (!a.passed) {
            console.log(`  ${RED}✗${RESET} ${c.caseName} > turn ${t.turnIndex}: ${a.message}`)
          }
        }
      }
    }
  }
}
