import { useState } from 'react';
import type { Story } from '../types';

export function StoryPhotos({ stories, completed }: { stories: Story[]; completed: number }) {
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const revealed = stories.slice(0, Math.max(0, completed)).filter(
    (story) => story.photo && !failed.has(story.photo.url),
  );
  if (!revealed.length) return null;
  return (
    <section className="story-photos" aria-label="Photos from stories you have typed">
      {revealed.map((story) => {
        const photo = story.photo!;
        const publisher = new URL(photo.sourceUrl).hostname.replace(/^www\./, '');
        return (
          <figure className="story-photos__card" key={story.rank}>
            <a href={photo.sourceUrl} target="_blank" rel="noopener noreferrer"
              title={photo.sourceTitle} aria-label={`Source photo for story ${story.rank}: ${photo.sourceTitle}`}>
              <img src={photo.url} alt={photo.alt} width="160" height="100"
                loading="lazy" decoding="async" referrerPolicy="no-referrer"
                onError={() => setFailed((previous) => new Set(previous).add(photo.url))} />
            </a>
            <figcaption>{story.rank} &middot; {publisher}</figcaption>
          </figure>
        );
      })}
    </section>
  );
}
