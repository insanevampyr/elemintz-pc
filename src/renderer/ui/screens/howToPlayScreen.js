function renderSection(title, bodyHtml) {
  return `
    <section class="panel how-to-play-section stack-sm">
      <h3 class="section-title">${title}</h3>
      <div class="how-to-play-copy stack-sm">
        ${bodyHtml}
      </div>
    </section>
  `;
}

export const howToPlayScreen = {
  render(context) {
    return `
      <section class="screen screen-how-to-play">
        <div class="panel stack-md">
          <div class="screen-topbar">
            <h2 class="view-title">How to Play EleMintz</h2>
            <button id="how-to-play-back-btn" class="btn screen-back-btn">Back</button>
          </div>
          <div class="how-to-play-guide stack-md">
            ${renderSection(
              "Basic Goal",
              `
                <p>EleMintz is an elemental card battle game.</p>
                <p>Each match is played with Fire, Water, Earth, and Wind cards. Choose a card each round, battle your opponent, win cards, and try to finish the match with more captured cards than your opponent.</p>
                <p>You win by making smart element choices, surviving WAR rounds, and capturing more cards before the match ends.</p>
              `
            )}
            ${renderSection(
              "Element Rules",
              `
                <p>Each element beats one other element:</p>
                <div class="how-to-play-rule-grid">
                  <p><strong>Fire</strong> beats Earth</p>
                  <p><strong>Earth</strong> beats Wind</p>
                  <p><strong>Wind</strong> beats Water</p>
                  <p><strong>Water</strong> beats Fire</p>
                </div>
                <p>If your card beats your opponent's card, you win the round.</p>
                <p>If your opponent's card beats yours, they win the round.</p>
                <p>Some element matchups do not beat each other. When that happens, it is a No Effect round.</p>
              `
            )}
            ${renderSection(
              "Round Results",
              `
                <p><strong>Win Round:</strong> If your element beats your opponent's element:</p>
                <ul class="how-to-play-list">
                  <li>you keep your played card</li>
                  <li>you capture your opponent's card</li>
                  <li>your captured card count goes up</li>
                </ul>
                <p><strong>Lose Round:</strong> If your opponent's element beats yours:</p>
                <ul class="how-to-play-list">
                  <li>your opponent keeps their card</li>
                  <li>your opponent captures your card</li>
                </ul>
                <p><strong>No Effect Round:</strong> If neither card beats the other:</p>
                <ul class="how-to-play-list">
                  <li>both players get their own cards back</li>
                  <li>no cards are captured</li>
                  <li>the match continues</li>
                </ul>
                <p><strong>Example:</strong> Fire vs Wind has no effect.</p>
              `
            )}
            ${renderSection(
              "WAR",
              `
                <p>If both players choose the same element, WAR begins.</p>
                <p>During WAR, tied cards are placed into a WAR pile. Players keep battling until someone wins the WAR.</p>
                <p>The WAR winner captures the cards in the WAR pile.</p>
                <p>WAR can grow quickly, so one WAR can swing the whole match.</p>
              `
            )}
            ${renderSection(
              "Winning the Match",
              `
                <p>The match ends when the game reaches its end condition.</p>
                <p>The winner is the player with more captured cards.</p>
                <p>If both players have the same captured card count, the match can end in a tie.</p>
              `
            )}
            ${renderSection(
              "XP, Tokens, and Chests",
              `
                <p>Playing matches can earn progress rewards.</p>
                <p>XP helps you level up.</p>
                <p>Tokens can be used in the Store to buy cosmetics.</p>
                <p>Chests can unlock cosmetic rewards.</p>
                <p>Some rewards come from leveling, achievements, daily progress, or special events.</p>
              `
            )}
            ${renderSection(
              "Cosmetics",
              `
                <p>Cosmetics let you customize your EleMintz profile and game style.</p>
                <p>Cosmetic types include:</p>
                <ul class="how-to-play-list">
                  <li>Avatars</li>
                  <li>Titles</li>
                  <li>Badges</li>
                  <li>Card Backs</li>
                  <li>Backgrounds</li>
                  <li>Element Card Variants</li>
                </ul>
                <p>Cosmetics do not change battle rules. They are for style, collection, and profile identity.</p>
              `
            )}
            ${renderSection(
              "Store and Featured Rotation",
              `
                <p>The Store contains cosmetics you can buy with tokens.</p>
                <p>Some cosmetics belong to Collections, such as Void Collection, Flame King Collection, Cutesy Collection, and Lucky Collection.</p>
                <p>The Featured Rotation highlights special cosmetics for a limited time.</p>
                <p>Some limited cosmetics may only appear while they are featured.</p>
                <p>If you already own a limited cosmetic, it stays yours and remains usable even when it leaves the Store rotation.</p>
              `
            )}
            ${renderSection(
              "Quick Tips",
              `
                <ul class="how-to-play-list">
                  <li>Learn the element rules first.</li>
                  <li>Watch for WAR rounds because they can change the match fast.</li>
                  <li>Use the Store and Cosmetics screens to customize your look.</li>
                  <li>Check the Featured Rotation for limited or highlighted cosmetics.</li>
                  <li>Play matches to build XP, tokens, chests, and achievements.</li>
                </ul>
              `
            )}
          </div>
        </div>
      </section>
    `;
  },
  bind(context) {
    document.getElementById("how-to-play-back-btn").addEventListener("click", context.actions.back);
  }
};
