export function AboutView() {
  return (
    <div className="enter">
      <h1 className="start__title" style={{ fontSize: 'clamp(30px, 5vw, 52px)', marginBottom: 20 }}>
        About Keywulf
      </h1>
      <div className="prose">
        <p>
          Keywulf is a once-per-day typing game built from the world's most important news. Everyone
          on Earth gets the same briefing, in the same order, on the same UTC day. You have two
          minutes; you type as much of the world as you can.
        </p>

        <h2>How the daily briefing is made</h2>
        <ul>
          <li>Once per day, an automated job researches the most recent major news - the last 24 hours or newer - using current web search.</li>
          <li>AI merges different articles that cover the same event, so 20 write-ups of one story count as one story.</li>
          <li>Stories are ordered by broad global significance - people affected, geopolitical and economic consequence, safety, elections, disasters, health, science, and climate - not by social-media attention or US media volume.</li>
          <li>The result is a terse briefing of roughly 12-16 headlines, each with a single sentence: wire-service compression, with the occasional dry aside.</li>
          <li>The clock stops at 2:00, or earlier if you clear the whole briefing.</li>
          <li>The sources used are exposed after you finish, never inside the text you type.</li>
        </ul>

        <h2>Why the text is always easy to type</h2>
        <p>
          Every character you type is normalized in code to simple ASCII. Smart quotes, em dashes,
          accented letters, and other awkward characters are converted or removed before a challenge
          can ship, and a challenge that cannot be made safe is rejected rather than published.
        </p>

        <h2>Honesty</h2>
        <p>
          AI ranking and synthesis can make mistakes. Keywulf does not claim perfect objectivity or
          complete coverage of world news. Treat it as one useful, imperfect daily snapshot.
        </p>

        <h2>Your data</h2>
        <p>
          There is no account and no server tracking. Your streak, history, and settings live only in
          this browser's local storage. A different browser or device will have its own separate
          history, and clearing site data will erase local progress. Keywulf does not use device
          fingerprinting or third-party analytics.
        </p>
      </div>
    </div>
  );
}
