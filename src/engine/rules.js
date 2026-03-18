export const ELEMENTS = Object.freeze(["fire", "water", "earth", "wind"]);

export const BEATS_MAP = Object.freeze({
  fire: "earth",
  earth: "wind",
  wind: "water",
  water: "fire"
});

export function isValidElement(value) {
  return ELEMENTS.includes(value);
}

export function compareElements(playerOneCard, playerTwoCard) {
  if (!isValidElement(playerOneCard) || !isValidElement(playerTwoCard)) {
    throw new Error("Invalid element card provided to compareElements.");
  }

  if (playerOneCard === playerTwoCard) {
    return "tie";
  }

  if (BEATS_MAP[playerOneCard] === playerTwoCard) {
    return "p1";
  }

  if (BEATS_MAP[playerTwoCard] === playerOneCard) {
    return "p2";
  }

  return "none";
}

export function elementThatBeats(element) {
  if (!isValidElement(element)) {
    throw new Error("Invalid element provided to elementThatBeats.");
  }

  return ELEMENTS.find((candidate) => BEATS_MAP[candidate] === element);
}
