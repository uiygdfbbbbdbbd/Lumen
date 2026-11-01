import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as common from '@zxcvbn-ts/language-common';
import * as en from '@zxcvbn-ts/language-en';

let factory: ZxcvbnFactory | null = null;
function get(): ZxcvbnFactory {
  factory ??= new ZxcvbnFactory({
    graphs: common.adjacencyGraphs,
    dictionary: { ...common.dictionary, ...en.dictionary },
    translations: en.translations,
  });
  return factory;
}

export interface StrengthResult {
  score: 0 | 1 | 2 | 3 | 4;
  warning: string | null;
  suggestions: string[];
}

/** Score 0-4. The server requires >= 2; user inputs (email, name) are penalized. */
export function passwordStrength(password: string, userInputs: string[] = []): StrengthResult {
  const r = get().check(password.slice(0, 128), userInputs);
  return { score: r.score as StrengthResult['score'], warning: r.feedback.warning || null, suggestions: r.feedback.suggestions };
}

export const MIN_PASSWORD_SCORE = 2;
