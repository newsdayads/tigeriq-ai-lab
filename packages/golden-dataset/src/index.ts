export interface GoldenCase<TInput = unknown, TExpected = unknown> {
  id: string;
  input: TInput;
  expected: TExpected;
  acceptableVariance?: Record<string, number>;
  businessRuleVersion: string;
  sourceEvidence: string[];
}

export function freezeExpected<T>(value: T): Readonly<T> {
  return Object.freeze(value);
}
