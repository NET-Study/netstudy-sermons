// Curated preacher filter.
//
// The SermonIndex API has no denomination, tradition or affiliation field
// anywhere in its schema, so this cannot be inferred from the data. Instead
// this is a hand-checked list of preachers from three traditions the app is
// configured to leave out. Every sermon whose speakerSlug appears here is
// dropped from every list in the app: home, scripture, themes, preachers,
// search, the play queue and recently played.
//
// To change the filter, edit the groups below. To turn it off entirely,
// return an empty array from `allExclusions()`.
//
// Deliberately kept out of the Anglican list: J.C. Ryle, George Whitefield and
// J.I. Packer, who are Reformed in doctrine and were added back by request.

export type Tradition = "Wesleyan-Arminian" | "Pentecostal / Charismatic" | "Anglican";

export interface Exclusion {
  slug: string;
  name: string;
  tradition: Tradition;
  /** Shown on the Filtered preachers page so the reason is never a mystery. */
  note: string;
}

type Row = [slug: string, name: string, note: string];

interface Group {
  tradition: Tradition;
  blurb: string;
  rows: Row[];
}

const GROUPS: Group[] = [
  {
    tradition: "Wesleyan-Arminian",
    blurb: "Methodist, Wesleyan, Nazarene, Holiness and Salvation Army preachers, plus the classic Arminian revivalists.",
    rows: [
      ["john-wesley", "John Wesley", "Founder of Methodism"],
      ["charles-wesley", "Charles Wesley", "Methodist hymn writer"],
      ["em-bounds", "E.M. Bounds", "Methodist Episcopal minister"],
      ["samuel-chadwick", "Samuel Chadwick", "Methodist minister and holiness teacher"],
      ["phoebe-palmer", "Phoebe Palmer", "Methodist holiness leader"],
      ["daniel-steele", "Daniel Steele", "Methodist theologian"],
      ["samuel-logan-brengle", "Samuel Logan Brengle", "Salvation Army commissioner"],
      ["catherine-booth", "Catherine Booth", "Salvation Army co-founder"],
      ["william-booth", "William Booth", "Salvation Army founder, Methodist background"],
      ["martin-knapp", "Martin Knapp", "Methodist holiness evangelist"],
      ["nathan-bangs", "Nathan Bangs", "Methodist Episcopal leader"],
      ["olin-alfred-curtis", "Olin Alfred Curtis", "Methodist theologian"],
      ["randolph-s-foster", "Randolph S. Foster", "Methodist Episcopal bishop"],
      ["harris-franklin-rall", "Harris Franklin Rall", "Methodist theologian"],
      ["james-blaine-chapman", "James Blaine Chapman", "Nazarene theologian"],
      ["aaron-hills", "Aaron Hills", "Nazarene holiness teacher"],
      ["russell-delong", "Russell DeLong", "Nazarene evangelist"],
      ["dennis-kinlaw", "Dennis Kinlaw", "Wesleyan holiness scholar"],
      ["ds-warner", "D.S. Warner", "Church of God (Anderson) founder"],
      ["george-kulp", "George Kulp", "Holiness evangelist"],
      ["seth-rees", "Seth Rees", "Holiness evangelist"],
      ["dougan-clark", "Dougan Clark", "Quaker holiness teacher"],
      ["gd-watson", "G.D. Watson", "Holiness evangelist"],
      ["charles-finney", "Charles Finney", "Arminian revivalist theologian"],
      ["james-arminius", "James Arminius", "Namesake of the tradition"],
      ["adam-clarke", "Adam Clarke", "Methodist commentator"],
      ["john-fletcher", "John Fletcher", "Wesley's chief theologian"],
      ["charles-e-cowman", "Charles E. Cowman", "Methodist, co-founder of OMS"],
      ["john-sung", "John Sung", "Methodist revival evangelist"],
      ["leonard-ravenhill", "Leonard Ravenhill", "Wesleyan holiness revival preacher"],
    ],
  },
  {
    tradition: "Pentecostal / Charismatic",
    blurb: "Pentecostal denominations, the Latter Rain and healing revivals, and independent charismatic teachers.",
    rows: [
      ["david-wilkerson", "David Wilkerson", "Assemblies of God minister"],
      ["carter-conlon", "Carter Conlon", "Times Square Church pastor"],
      ["teresa-conlon", "Teresa Conlon", "Times Square Church pastor"],
      ["gary-wilkerson", "Gary Wilkerson", "World Challenge, Times Square Church stream"],
      ["don-wilkerson", "Don Wilkerson", "Teen Challenge, Assemblies of God"],
      ["david-ravenhill", "David Ravenhill", "Charismatic revival teacher"],
      ["smith-wigglesworth", "Smith Wigglesworth", "Pentecostal evangelist"],
      ["kathryn-kuhlman", "Kathryn Kuhlman", "Pentecostal healing evangelist"],
      ["william-seymour", "William Seymour", "Azusa Street revival leader"],
      ["aa-allen", "A.A. Allen", "Pentecostal healing evangelist"],
      ["derek-prince", "Derek Prince", "Pentecostal and charismatic teacher"],
      ["jack-hayford", "Jack Hayford", "Foursquare Church pastor"],
      ["ea-adeboye", "E.A. Adeboye", "Redeemed Christian Church of God"],
      ["reinhard-bonnke", "Reinhard Bonnke", "Pentecostal evangelist"],
      ["john-g-lake", "John G. Lake", "Pentecostal healing evangelist"],
      ["aimee-semple-mcpherson", "Aimee Semple McPherson", "Foursquare founder"],
      ["heidi-baker", "Heidi Baker", "Charismatic missionary"],
      ["hans-r-waldvogel", "Hans R. Waldvogel", "Pentecostal pastor"],
      ["gw-north", "G.W. North", "British Pentecostal teacher"],
      ["keith-malcomson", "Keith Malcomson", "Pentecostal revival preacher"],
      ["john-follette", "John Follette", "Assemblies of God Bible teacher"],
      ["walter-beuttler", "Walter Beuttler", "Assemblies of God Bible teacher"],
      ["glenn-meldrum", "Glenn Meldrum", "Assemblies of God evangelist"],
      ["george-warnock", "George Warnock", "Latter Rain teacher"],
      ["charles-s-price", "Charles S. Price", "Pentecostal healing evangelist"],
      ["john-hames", "John Hames", "Pentecostal holiness evangelist"],
      ["michael-l-brown", "Michael L. Brown", "Charismatic revival scholar"],
      ["michael-koulianos", "Michael Koulianos", "Charismatic evangelist"],
      ["bh-clendennen", "B.H. Clendennen", "Pentecostal evangelist"],
      ["ken-baird", "Ken Baird", "Foursquare minister"],
      ["andrew-strom", "Andrew Strom", "Charismatic revival teacher"],
      ["winkie-pratney", "Winkie Pratney", "Charismatic youth evangelist"],
      ["manley-beasley", "Manley Beasley", "Charismatic revival evangelist"],
      ["greg-locke", "Greg Locke", "Charismatic revival pastor"],
      ["brian-guerin", "Brian Guerin", "Charismatic prophetic teacher"],
    ],
  },
  {
    tradition: "Anglican",
    blurb: "Bishops, clergy and lay writers of the Church of England, the Episcopal Church and the Anglican Communion.",
    rows: [
      ["john-newton", "John Newton", "Anglican clergyman"],
      ["jh-newman", "J.H. Newman", "Anglican priest and Tractarian"],
      ["wh-griffith-thomas", "W.H. Griffith Thomas", "Anglican clergyman and scholar"],
      ["wr-inge", "W.R. Inge", "Dean of St Paul's"],
      ["stewart-ruch", "Stewart Ruch", "Anglican (ACNA) priest"],
      ["henry-law", "Henry Law", "Dean of Gloucester"],
      ["thomas-reade", "Thomas Reade", "Anglican clergyman"],
      ["favell-lee-mortimer", "Favell Lee Mortimer", "Anglican evangelical author"],
      ["cs-lewis", "C.S. Lewis", "Anglican layman"],
      ["john-stott", "John Stott", "Anglican priest"],
      ["thaddeus-barnum", "Thaddeus Barnum", "Anglican (ACNA) bishop"],
      ["jackie-pullinger", "Jackie Pullinger", "Anglican missionary"],
      ["mary-wilder-tileston", "Mary Wilder Tileston", "Episcopal devotional writer"],
    ],
  },
];

export const FILTER_GROUPS = GROUPS;

function allExclusions(): Exclusion[] {
  return GROUPS.flatMap((group) =>
    group.rows.map(([slug, name, note]) => ({ slug, name, tradition: group.tradition, note })),
  );
}

const BY_SLUG = new Map(allExclusions().map((entry) => [entry.slug, entry]));

export const FILTERED_PREACHER_COUNT = BY_SLUG.size;

export function exclusionFor(slug?: string | null): Exclusion | undefined {
  return slug ? BY_SLUG.get(slug) : undefined;
}

export function isFiltered(slug?: string | null): boolean {
  return !!exclusionFor(slug);
}

/** Drops every sermon from a filtered preacher. */
export function keepSermons<T extends { speakerSlug?: string }>(list: T[] | undefined | null): T[] {
  return (list ?? []).filter((sermon) => !isFiltered(sermon.speakerSlug));
}

/** Drops every filtered preacher from a speaker index or search result. */
export function keepPreachers<T extends { slug: string }>(list: T[] | undefined | null): T[] {
  return (list ?? []).filter((preacher) => !isFiltered(preacher.slug));
}

/** Total sermons the filter hides, for the sidebar note. */
export const FILTERED_TRADITIONS = GROUPS.map((g) => g.tradition);
