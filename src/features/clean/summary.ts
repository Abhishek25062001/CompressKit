import type { HiddenInfo, HiddenKind } from '../../types/clean';

const ORDER: HiddenKind[] = ['location', 'device', 'date', 'person', 'software', 'other'];

export const KIND_LABEL: Record<HiddenKind, string> = {
  location: 'Location',
  device: 'Camera',
  date: 'Date',
  person: 'Names',
  software: 'Software',
  other: 'Other',
};

/** The kinds of detail present, most sensitive first, e.g. ['location', 'device', 'date']. */
export function kindsOf(found: HiddenInfo[]): HiddenKind[] {
  return ORDER.filter((kind) => found.some((f) => f.kind === kind));
}

/** "Location, Camera and Date" */
export function describeKinds(found: HiddenInfo[]): string {
  const labels = kindsOf(found).map((k) => KIND_LABEL[k]);
  return labels.length <= 1 ? (labels[0] ?? '') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

export function hasLocation(found: HiddenInfo[] | undefined): boolean {
  return !!found?.some((f) => f.kind === 'location');
}
