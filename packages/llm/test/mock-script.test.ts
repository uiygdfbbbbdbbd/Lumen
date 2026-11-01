import { describe, expect, it } from 'vitest';
import { balancedObject, plan } from '../src/mock/script.js';

const turn = (lastUserText: string) => ({ lastUserText, toolResult: null, totalChars: lastUserText.length });

describe('mock script tool markers', () => {
  it('parses tool arguments containing nested arrays, "}]" and escaped quotes', () => {
    const args = { type: 'chart', content: JSON.stringify({ data: [{ a: 1 }], note: 'say "hi" }]' }) };
    const p = plan(turn(`make one [tool:create_artifact ${JSON.stringify(args)}] please`));
    expect(p.toolCall).toEqual({ name: 'create_artifact', arguments: args });
  });
  it('allows tools without arguments and tolerates broken JSON', () => {
    expect(plan(turn('[tool:list_files]')).toolCall).toEqual({ name: 'list_files', arguments: {} });
    expect(plan(turn('[tool:x {"a": }]')).toolCall).toEqual({ name: 'x', arguments: {} });
    expect(balancedObject('{"a":{"b":1}', 0)).toBeNull();
  });
});
