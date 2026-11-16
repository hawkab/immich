export interface NamedSearchPerson {
  personGroupId: string;
  name: string;
}

/** Separate explicit catalogue names from the scene without guessing identities. */
export function resolveNamedSearch(query: string, people: NamedSearchPerson[]) {
  const text = query.normalize('NFC');
  const candidates = people.flatMap((person) => {
    const name = person.name.normalize('NFC').trim();
    if (!name) {
      return [];
    }
    const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`).replaceAll(/[её]/giu, '[её]');
    const pattern = new RegExp(String.raw`(?<![\p{L}\p{N}_])${escaped}(?![\p{L}\p{N}_])`, 'giu');
    return text
      .matchAll(pattern)
      .map((match) => ({
        start: match.index,
        end: match.index + match[0].length,
        id: person.personGroupId,
      }))
      .toArray();
  });
  candidates.sort((a, b) => b.end - b.start - (a.end - a.start));
  const selected: typeof candidates = [];
  for (const candidate of candidates) {
    const overlap = selected.find((item) => candidate.start < item.end && candidate.end > item.start);
    if (overlap) {
      if (overlap.start === candidate.start && overlap.end === candidate.end && overlap.id !== candidate.id) {
        return;
      }
      continue;
    }
    selected.push(candidate);
  }
  if (selected.length === 0) {
    return;
  }
  const personIds = [...new Set([...selected].sort((a, b) => a.start - b.start).map((item) => item.id))];
  if (personIds.length > 1 && /(?:^|\s)(?:или|or)(?:\s|$)/iu.test(text)) {
    return;
  }
  let scene = text;
  for (const match of selected.sort((a, b) => b.start - a.start)) {
    scene = scene.slice(0, match.start) + ' ' + scene.slice(match.end);
  }
  scene = scene.replaceAll(/^[\s,;:"'«»]+|[\s,;:"'«»]+$/gu, '').replaceAll(/\s+/gu, ' ');
  scene = scene.replace(/^(?:и|and)(?:\s+|$)/iu, '').trim();
  return { query: scene, personIds };
}
