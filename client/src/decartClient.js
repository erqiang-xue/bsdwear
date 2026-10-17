import { createDecartClient, models } from '@decartai/sdk';
import { createTryOnDecartClient } from './tryOn.js';

export const vtonModel = models.realtime('lucy-vton-latest');

export function createBrowserTryOnClient(fetchImpl = globalThis.fetch.bind(globalThis)) {
  return createTryOnDecartClient(createDecartClient, fetchImpl);
}
