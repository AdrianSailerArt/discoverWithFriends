# Tripboard

Reiseideen gemeinsam auf einer Karte sammeln, bewerten und (bald) zu einer Tour mit Übernachtungsvorschlägen machen.

**Stack:** Nuxt 4 (Vue 3, TypeScript) · Bun · MapLibre GL · Supabase (Postgres + PostGIS, Auth, Realtime)

## Loslegen

```bash
bun install
bun --bun nuxt dev
```

Ohne Keys läuft die App im **Demo-Modus**: Alles liegt im `localStorage` des Browsers, und über das
„Demo“-Menü oben rechts kann man zwischen Personen wechseln, um Abstimmungen zu testen.

## Supabase einrichten

1. Projekt auf [supabase.com](https://supabase.com) anlegen.
2. **Authentication → Sign In / Providers → „Allow anonymous sign-ins“** aktivieren.
3. Inhalt von `supabase/migrations/0001_init.sql` im **SQL Editor** ausführen.
4. `.env.example` nach `.env` kopieren und eintragen:
   - `NUXT_PUBLIC_SUPABASE_URL`, `NUXT_PUBLIC_SUPABASE_ANON_KEY` (Project Settings → API)
   - optional `NUXT_PUBLIC_MAPTILER_KEY` (schönere Outdoor-Karte + bessere Ortssuche; sonst OSM/Nominatim)
5. Dev-Server neu starten.

## Datenmodell

| Tabelle | Inhalt |
|---|---|
| `trips` | Reise mit Region, Kartenmittelpunkt, Tagen, `invite_code` |
| `trip_members` | Wer ist dabei, Anzeigename, Farbe, Rolle (owner/member) |
| `ideas` | Pins: Titel, Kategorie, Notiz, Link, Dauer, `lng/lat` + PostGIS-`location` |
| `votes` | 👎 −1 · 👍 1 · ❤️ 2 (Must-do) pro Person und Idee |

Zugriff ist per Row Level Security auf Mitglieder einer Reise beschränkt. Anlegen und Beitreten laufen über
die RPCs `create_trip`, `trip_preview` und `join_trip`.

## Struktur

```
app/
  pages/            index (Reisen), join/[code] (Einladung), trip/[id] (Karte)
  components/       TripMap, IdeaForm, VoteBar, PlaceSearch
  composables/      useBackend (Supabase oder Demo), useTripData (laden + live)
  lib/              Typen, Konstanten, Backends, Geocoding/Kartenstil
supabase/migrations SQL-Schema
```

## Roadmap

- [x] v1: Reise, Einladungslink, Pins mit Kategorien, Votes, Filter, Live-Sync
- [ ] v2: Tour-Generator (OpenRouteService: Reihenfolge, Tagesetappen, Fahrzeiten) + Unterkünfte aus OSM/Overpass mit Buchungslinks
- [ ] Gemischter Verkehr: Etappen-Verkehrsmittel, Fähren (CalMac), Links zu ScotRail/Traveline
- [ ] Wanderungen als Linien / GPX-Upload
- [ ] Richtige Accounts (anonyme Nutzer per E-Mail verknüpfen), Datenschutz, Englisch
