import { resolveSource, type SourceRef } from '../scripts/enrichSources';
import { isUsableTitle } from '../scripts/sourceTitles';
import type { Storage } from './index';

// Each source has a separate invocation budget. Fetching 40+ publishers in one
// generation invocation would exceed the Workers Free subrequest allowance.
export class SourceMetadata {
  constructor(private state: { storage: Storage }) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    const source = await request.json() as SourceRef;
    try {
      const url = new URL(source.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || typeof source.title !== 'string') throw new Error();
    } catch { return new Response(null, { status: 400 }); }
    const cached = await this.state.storage.get<{ value: SourceRef; until: number }>('metadata');
    if (cached && cached.until > Date.now() && isUsableTitle(cached.value.title)) return Response.json({ ...source, ...cached.value });
    const resolved = await resolveSource(source);
    await this.state.storage.put('metadata', {
      value: resolved, until: Date.now() + (isUsableTitle(resolved.title) ? 6 * 3_600_000 : 60_000),
    });
    return Response.json(resolved);
  }
}
