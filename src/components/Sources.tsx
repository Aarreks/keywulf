import type { Challenge, ChallengeSource } from '../types';

// Sources are exposed only AFTER a run, never inside the typed text. We show the
// per-story sources when present; otherwise the labeled pool used to build the
// briefing (grounding attribution can be imprecise, so we never fake mapping).
//
// The daily job resolves grounding redirects to real article titles where it
// can; older briefings may only carry domains, so render both shapes cleanly.

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** A title like "theguardian.com" is a domain fallback, not an article title. */
function looksLikeDomain(title: string): boolean {
  return /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(title.trim());
}

function SourceLink({ src }: { src: ChallengeSource }) {
  const urlDomain = domainOf(src.url);
  // Grounding redirect URLs live on Google's host; never show that as the
  // publisher. Prefer a real publisher domain from the resolved URL.
  const isRedirect = urlDomain.endsWith('vertexaisearch.cloud.google.com');
  const bare = src.title.trim() === '' || looksLikeDomain(src.title);
  if (bare) {
    // Domain-only source (un-enriched briefing): the title IS the best label.
    const label = src.title.trim() ? src.title.replace(/^www\./, '') : urlDomain;
    return (
      <a href={src.url} target="_blank" rel="noopener noreferrer" className="source-item">
        <span className="source-item__title">{label}</span>
      </a>
    );
  }
  return (
    <a href={src.url} target="_blank" rel="noopener noreferrer" className="source-item">
      <span className="source-item__title">{src.title}</span>
      {!isRedirect && urlDomain && <span className="source-item__domain">{urlDomain}</span>}
    </a>
  );
}

export function Sources({ challenge }: { challenge: Challenge }) {
  const anyPerStory = challenge.stories.some((s) => s.sources.length > 0);

  return (
    <div className="panel enter" style={{ display: 'grid', gap: 16 }}>
      <div className="result__label">Sources</div>
      {anyPerStory ? (
        <div style={{ display: 'grid', gap: 18 }}>
          {challenge.stories.map((s) => (
            <div key={s.rank} style={{ display: 'grid', gap: 8 }}>
              <div style={{ fontWeight: 700 }}>
                {s.rank}. {s.headline}
              </div>
              <div className="sources">
                {s.sources.length > 0 ? (
                  s.sources.map((src, i) => <SourceLink key={i} src={src} />)
                ) : (
                  <span className="start__hint">No specific source retained.</span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <p className="start__hint">
            Sources used to build today's briefing. Search grounding does not always map cleanly to a
            single story, so these are shown as a labeled collection rather than per-story.
          </p>
          <div className="sources">
            {challenge.sourcePool.length > 0 ? (
              challenge.sourcePool.map((src, i) => <SourceLink key={i} src={src} />)
            ) : (
              <span className="start__hint">No sources were retained for this briefing.</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
