import { APICallError, NoContentGeneratedError } from 'ai';

/** Turns provider/SDK errors into a short message suitable for end users. */
export function describeAiError(err: unknown): string {
  if (APICallError.isInstance(err)) {
    switch (err.statusCode) {
      case 401:
      case 403:
        return 'The provider rejected the API key. Check it in Settings → AI providers.';
      case 404:
        return 'Model not found. Pick another model for this provider.';
      case 402:
        return 'The provider says the account has no credit left.';
      case 429:
        return 'The provider is rate-limiting requests (or the free quota is used up). Try again later.';
      default:
        if (err.statusCode && err.statusCode >= 500) {
          return `The provider had an internal error (HTTP ${err.statusCode}). Try again.`;
        }
        return `Provider error${err.statusCode ? ` (HTTP ${err.statusCode})` : ''}: ${err.message}`;
    }
  }
  if (NoContentGeneratedError.isInstance(err)) return 'The model returned an empty answer.';
  if (err instanceof Error) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      return 'The model took too long to answer. Try fewer words or a faster model.';
    }
    return err.message;
  }
  return String(err);
}
