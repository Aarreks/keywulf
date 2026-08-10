import type { Challenge } from '../types';

// Sources are exposed only AFTER a run, never inside the typed text. We show the
// per-story sources when present; otherwise the labeled pool used to build the
// briefing (grounding attribution can be imprecise, so we never fake mapping).

export function Sources({ challenge }: { challenge: Challenge }) {
  const anyPerStory = challenge.stories.some((s) => s.sources.length > 0);

  return (
    <div className="panel enter" style={{ display: 'grid', gap: 16 }}>
      <div className="result__label">Sources</div>
      {anyPerStory ? (
        <div style={{ display: 'grid', gap: 18 }}>
          {challenge.stories.map((s) => (
            <div key={s.rank} style={{ display: 'grid', gap: 8 }}>
              <div style={{ fontWeight: 800 }}>
                {s.rank}. {s.headline}
              </div>
              <div className="sources">
                {s.sources.length > 0 ? (
                  s.sources.map((src, i) => (
                    <a key={i} href={src.url} target="_blank" rel="noopener noreferrer">
                      {src.title}
                    </a>
                  ))
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
              challenge.sourcePool.map((src, i) => (
                <a key={i} href={src.url} target="_blank" rel="noopener noreferrer">
                  {src.title}
                </a>
              ))
            ) : (
              <span className="start__hint">No sources were retained for this briefing.</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
