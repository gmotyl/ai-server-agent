import type { EvalCase } from '../src/types.js'

export default {
  name: 'research-retains-context',
  description: 'Agent retains research context across a multi-turn Q&A',
  turns: [
    {
      user: 'Explain what the CAP theorem is in distributed systems. Keep it to 2-3 sentences.',
      assert: [
        { type: 'contains', pattern: /consistency/i },
        { type: 'contains', pattern: /availability/i },
        { type: 'contains', pattern: /partition/i },
      ],
    },
    {
      user: 'Given what you just explained, which of the three guarantees does a typical PostgreSQL single-node setup sacrifice?',
      assert: [
        { type: 'contains', pattern: /partition/i },
        { type: 'not_contains', pattern: /I don.t have (context|information)/ },
      ],
    },
    {
      user: 'Now compare that to how DynamoDB handles the same trade-off. Reference your earlier CAP explanation.',
      assert: [
        { type: 'contains', pattern: /availability/i },
        { type: 'references_turn', turn: 0, info: 'CAP' },
        { type: 'not_contains', pattern: /what is CAP|remind me|could you clarify/i },
      ],
    },
  ],
} satisfies EvalCase
