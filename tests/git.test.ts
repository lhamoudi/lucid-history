import { describe, it, expect } from 'vitest';
import { classifyMergeError } from '../src/git.js';

function octokitError(status: number, message: string) {
  return { status, response: { data: { message } } };
}

describe('classifyMergeError', () => {
  it('classifies a stale-base 405 as retryable-as-is', () => {
    expect(classifyMergeError(octokitError(405, 'Base branch was modified. Review and try the merge again.')))
      .toBe('stale-base');
  });

  it('classifies a real merge-conflict 405 separately from a stale base', () => {
    expect(classifyMergeError(octokitError(405, 'Pull Request has merge conflicts')))
      .toBe('real-conflict');
  });

  it('is case-insensitive on the message', () => {
    expect(classifyMergeError(octokitError(405, 'PULL REQUEST HAS MERGE CONFLICTS')))
      .toBe('real-conflict');
  });

  it('falls back to "other" for non-405 errors', () => {
    expect(classifyMergeError(octokitError(500, 'Internal Server Error'))).toBe('other');
  });

  it('falls back to "other" for an unrecognized 405 message', () => {
    expect(classifyMergeError(octokitError(405, 'Required status check "ci" is expected.')))
      .toBe('other');
  });

  it('handles errors without a response body', () => {
    expect(classifyMergeError(new Error('network error'))).toBe('other');
  });
});
