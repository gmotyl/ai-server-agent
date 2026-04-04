export type AssertionPattern = string | RegExp

export type Assertion =
  | { type: 'contains'; pattern: AssertionPattern }
  | { type: 'not_contains'; pattern: AssertionPattern }
  | { type: 'references_turn'; turn: number; info: string }
  | { type: 'file_exists'; path: string }
  | { type: 'file_contains'; path: string; pattern: AssertionPattern }

export interface Turn {
  user: string
  assert?: Assertion[]
}

export interface EvalCase {
  name: string
  description: string
  provider?: string
  workdir?: string
  setup?: (workdir: string) => Promise<void>
  teardown?: (workdir: string) => Promise<void>
  turns: Turn[]
}

export interface AssertionResult {
  assertion: Assertion
  passed: boolean
  message: string
}

export interface TurnResult {
  turnIndex: number
  userMessage: string
  agentResponse: string
  assertions: AssertionResult[]
}

export interface CaseResult {
  caseName: string
  turns: TurnResult[]
  passed: boolean
  durationMs: number
}

export interface EvalRunResult {
  cases: CaseResult[]
  totalAssertions: number
  passedAssertions: number
  failedAssertions: number
  durationMs: number
}
