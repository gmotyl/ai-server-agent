import type { EvalCase } from '../src/types.js'

export default {
  name: 'coding-retains-context',
  description: 'Agent remembers file context across turns in a coding task',
  turns: [
    {
      user: 'Create a file called hello.ts in the current directory that exports a function called greet which returns the string "Hello, World!"',
      assert: [
        { type: 'file_exists', path: 'hello.ts' },
        { type: 'file_contains', path: 'hello.ts', pattern: /export/ },
        { type: 'file_contains', path: 'hello.ts', pattern: /greet/ },
      ],
    },
    {
      user: 'Now modify the greet function to accept a name parameter of type string and return "Hello, {name}!" instead',
      assert: [
        { type: 'file_contains', path: 'hello.ts', pattern: /name/ },
        { type: 'file_contains', path: 'hello.ts', pattern: /string/ },
        { type: 'references_turn', turn: 0, info: 'hello.ts' },
      ],
    },
    {
      user: 'What does the greet function currently do? Explain without reading the file.',
      assert: [
        { type: 'contains', pattern: /name/ },
        { type: 'not_contains', pattern: /I don.t have (access|context|information)/ },
      ],
    },
  ],
} satisfies EvalCase
