// Curated preacher allowlist.
//
// The SermonIndex API has no denomination, tradition or affiliation field, so
// this cannot be inferred from the data. Instead the app keeps a short,
// hand-picked list of preachers and hides everything else: every sermon whose
// speakerSlug is not listed here is dropped from every list in the app,
// including home, scripture, themes, preachers, search, the play queue and
// recently played.
//
// To change the list, edit KEPT below. To show the whole archive again, return
// true from `isFiltered`.

export interface KeptPreacher {
  slug: string;
  name: string;
  /** Shown on the Preachers kept page so the choice is never a mystery. */
  note: string;
}

export const KEPT: KeptPreacher[] = [
  { slug: "george-whitefield", name: "George Whitefield", note: "Anglican evangelist, Reformed" },
  { slug: "jc-ryle", name: "J.C. Ryle", note: "Anglican bishop of Liverpool" },
  { slug: "ji-packer", name: "J.I. Packer", note: "Anglican theologian" },
  { slug: "j-vernon-mcgee", name: "J. Vernon McGee", note: "Presbyterian Bible teacher" },
  { slug: "john-nelson-darby", name: "John Nelson Darby", note: "Plymouth Brethren" },
  { slug: "martyn-lloyd-jones", name: "Martyn Lloyd-Jones", note: "Westminster Chapel" },
  { slug: "alistair-begg", name: "Alistair Begg", note: "Baptist pastor, Parkside Church" },
  { slug: "paul-washer", name: "Paul Washer", note: "Reformed Baptist evangelist" },
  { slug: "john-piper", name: "John Piper", note: "Reformed Baptist, Desiring God" },
  { slug: "john-macarthur", name: "John MacArthur", note: "Grace Community Church" },
  { slug: "ch-spurgeon", name: "C.H. Spurgeon", note: "Particular Baptist, Metropolitan Tabernacle" },
  { slug: "george-mueller", name: "George Mueller", note: "Bristol orphan houses, Brethren" },
];

const BY_SLUG = new Map(KEPT.map((entry) => [entry.slug, entry]));

export const KEPT_PREACHER_COUNT = BY_SLUG.size;

export function keptFor(slug?: string | null): KeptPreacher | undefined {
  return slug ? BY_SLUG.get(slug) : undefined;
}

export function isFiltered(slug?: string | null): boolean {
  return !keptFor(slug);
}

/** Drops every sermon from a preacher who is not on the list. */
export function keepSermons<T extends { speakerSlug?: string }>(list: T[] | undefined | null): T[] {
  return (list ?? []).filter((sermon) => !isFiltered(sermon.speakerSlug));
}

/** Drops every preacher who is not on the list from an index or search result. */
export function keepPreachers<T extends { slug: string }>(list: T[] | undefined | null): T[] {
  return (list ?? []).filter((preacher) => !isFiltered(preacher.slug));
}
