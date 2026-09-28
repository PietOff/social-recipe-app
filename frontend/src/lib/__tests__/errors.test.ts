import { describe, expect, it } from 'vitest';
import { localizeError } from '../errors';

describe('localizeError', () => {
  it('translates known backend messages to Dutch', () => {
    expect(localizeError('The recipe AI is unavailable right now. Please try again in a moment.', 'nl'))
      .toBe('De recept-AI is nu niet beschikbaar. Probeer het zo opnieuw.');
    expect(localizeError('Unsupported URL. Only TikTok, Instagram and YouTube links are accepted.', 'nl'))
      .toContain('YouTube');
    expect(localizeError('Request failed (502)', 'nl')).toBe('Verzoek mislukt (502).');
  });

  it('leaves English and unknown messages alone', () => {
    const msg = 'The recipe AI is unavailable right now. Please try again in a moment.';
    expect(localizeError(msg, 'en')).toBe(msg);
    expect(localizeError('Something new went wrong', 'nl')).toBe('Something new went wrong');
    expect(localizeError(null, 'nl')).toBe('');
  });
});
