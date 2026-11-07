/** Details about a place from OpenStreetMap, Wikipedia and Wikidata (all free, no key). */
export interface PlaceInfo {
  found: boolean
  /** short Wikipedia/Wikidata description, e.g. "Gebirgsstock in den Sextner Dolomiten" */
  description?: string
  /** first paragraph of the Wikipedia article */
  extract?: string
  image?: { url: string; page: string }
  /** raw OSM opening_hours value */
  openingHours?: string
  website?: string
  phone?: string
  /** OSM fee=yes/no/… */
  fee?: string
  /** OSM wheelchair=yes/limited/no */
  wheelchair?: string
  wikipediaUrl?: string
  osmUrl?: string
}
