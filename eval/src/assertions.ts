import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Assertion, AssertionPattern, AssertionResult } from './types.js'

function matchesPattern(text: string, pattern: AssertionPattern): boolean {
  if (typeof pattern === 'string') {
    return text.includes(pattern)
  }
  return pattern.test(text)
}

function patternToString(pattern: AssertionPattern): string {
  return typeof pattern === 'string' ? `"${pattern}"` : pattern.toString()
}

export function evaluateAssertion(
  assertion: Assertion,
  response: string,
  workdir: string,
): AssertionResult {
  switch (assertion.type) {
    case 'contains': {
      const passed = matchesPattern(response, assertion.pattern)
      return {
        assertion,
        passed,
        message: passed
          ? `Response contains ${patternToString(assertion.pattern)}`
          : `Response does NOT contain ${patternToString(assertion.pattern)}`,
      }
    }

    case 'not_contains': {
      const passed = !matchesPattern(response, assertion.pattern)
      return {
        assertion,
        passed,
        message: passed
          ? `Response correctly omits ${patternToString(assertion.pattern)}`
          : `Response unexpectedly contains ${patternToString(assertion.pattern)}`,
      }
    }

    case 'references_turn': {
      const passed = response.includes(assertion.info)
      return {
        assertion,
        passed,
        message: passed
          ? `Response references "${assertion.info}" from turn ${assertion.turn}`
          : `Response does NOT reference "${assertion.info}" from turn ${assertion.turn}`,
      }
    }

    case 'file_exists': {
      const fullPath = join(workdir, assertion.path)
      const passed = existsSync(fullPath)
      return {
        assertion,
        passed,
        message: passed
          ? `File exists: ${assertion.path}`
          : `File NOT found: ${assertion.path}`,
      }
    }

    case 'file_contains': {
      const fullPath = join(workdir, assertion.path)
      if (!existsSync(fullPath)) {
        return {
          assertion,
          passed: false,
          message: `File NOT found: ${assertion.path} (cannot check contents)`,
        }
      }
      const content = readFileSync(fullPath, 'utf-8')
      const passed = matchesPattern(content, assertion.pattern)
      return {
        assertion,
        passed,
        message: passed
          ? `File ${assertion.path} contains ${patternToString(assertion.pattern)}`
          : `File ${assertion.path} does NOT contain ${patternToString(assertion.pattern)}`,
      }
    }
  }
}
