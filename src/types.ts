export interface Control {
  id: string;
  label: string;
  role: 'link' | 'button';
  region: string;
  in_overlay?: boolean;
  href?: string;
  /** Set for controls inside a child frame; used to route the click. */
  frame_url?: string;
}

export interface Overlay {
  id: string;
  text: string;
  area_pct: number;
}

export interface Group {
  id: string;
  item_count: number;
  region: string;
  heading: string;
  items_with_link_pct: number;
  distinct_links: number;
  items_with_image_pct: number;
  samples: string[];
  /** Absolute link per item (null when the item has none). Not sent to Jev. */
  item_links: (string | null)[];
  in_overlay?: boolean;
}

export interface Snapshot {
  url: string;
  title: string;
  lang: string;
  headings: string[];
  text: string;
  overlays: Overlay[];
  controls: Control[];
  groups: Group[];
  /** Content-bearing child frames (text only; their controls and groups are merged above). */
  frames?: { id: string; url: string; text: string }[];
  fingerprint: string;
}
