# Tripboard

Reiseideen gemeinsam auf einer Karte sammeln, bewerten und (bald) zu einer Tour mit Übernachtungsvorschlägen machen.

**Stack:** Nuxt 4 (Vue 3, TypeScript) · Bun · MapLibre GL · Supabase (Postgres + PostGIS, Auth, Realtime)

## Loslegen

```bash
bun install
bun --bun nuxt dev
```

Mit Supabase registrieren sich alle per E-Mail und Passwort. Einladungslinks führen nach der
Registrierung bzw. Anmeldung direkt in die Reise.

Ohne Keys läuft die App im **Demo-Modus** (ohne Login): Alles liegt im `localStorage` des Browsers, und über das
„Demo“-Menü oben rechts kann man zwischen Personen wechseln, um Abstimmungen zu testen.

## Supabase einrichten

1. Projekt auf [supabase.com](https://supabase.com) anlegen.
2. **Authentication → Sign In / Providers:** „Email“ aktiv lassen, „Allow anonymous sign-ins“ **aus**.
   Unter **Authentication → URL Configuration** die Site URL (lokal `http://localhost:3000`) setzen und
   `http://localhost:3000/**` als Redirect URL eintragen, damit Bestätigungslinks zurück in die App (z. B. in eine Einladung) führen.
3. Die Dateien in `supabase/migrations/` der Reihe nach im **SQL Editor** ausführen (`0001_init.sql`, `0002_grants.sql`, `0003_routes.sql`).
4. `.env.example` nach `.env` kopieren und eintragen:
   - `NUXT_PUBLIC_SUPABASE_URL`, `NUXT_PUBLIC_SUPABASE_ANON_KEY` (Project Settings → API)
   - optional `NUXT_PUBLIC_MAPTILER_KEY` (schönere Outdoor-Karte + bessere Ortssuche; sonst OSM/Nominatim)
5. Dev-Server neu starten.

### Login mit Google

Die Buttons auf `/login` steuert `NUXT_PUBLIC_AUTH_PROVIDERS` (Standard: `google`; möglich: `google,github`).
Jeder Anbieter muss in Supabase unter **Authentication → Sign In / Providers** aktiviert werden.
Callback-URL: `https://<projekt>.supabase.co/auth/v1/callback`

- **Google** (kostenlos): Google Cloud Console → Google Auth Platform → Clients → Web-Client,
  Callback-URL als „Authorized redirect URI“ eintragen. Client-ID + Secret in Supabase eintragen.

### Routenplaner (OpenRouteService)

Für echte Fahrzeiten und Straßenverläufe einen kostenlosen Key auf
[openrouteservice.org](https://openrouteservice.org/dev/#/signup) holen und als `NUXT_ORS_API_KEY` in `.env`
eintragen (bleibt auf dem Server). Ohne Key schätzt der Planer Zeiten aus der Luftlinie.
Unterkünfte kommen aus OpenStreetMap (Overpass API), dazu Such-Links zu Booking.com und Airbnb.

## Online stellen (Vercel)

1. Auf [vercel.com](https://vercel.com) mit GitHub anmelden → **Add New → Project** → Repo
   `discoverWithFriends` importieren. Framework „Nuxt“ wird erkannt, Build-Einstellungen bleiben Standard.
2. Unter **Environment Variables** eintragen (Werte wie in `.env`):
   `NUXT_PUBLIC_SUPABASE_URL`, `NUXT_PUBLIC_SUPABASE_ANON_KEY`, `NUXT_PUBLIC_MAPTILER_KEY`,
   optional `NUXT_ORS_API_KEY`.
3. **Deploy**. Jeder Push auf `main` deployt danach automatisch.
4. Die neue Adresse (z. B. `https://discover-with-friends.vercel.app`) eintragen:
   - Supabase → Authentication → URL Configuration: als **Site URL** und `https://…vercel.app/**` als Redirect URL
     (`http://localhost:3000/**` für die Entwicklung drinlassen)
   - Google Cloud → Clients → Web-Client: unter **Authorized JavaScript origins**
   - MapTiler → API-Key: Domain unter „Allowed HTTP origins“ (optional, schützt das Kontingent)

## Datenmodell

| Tabelle | Inhalt |
|---|---|
| `trips` | Reise mit Region, Kartenmittelpunkt, Tagen, `invite_code` |
| `trip_members` | Wer ist dabei, Anzeigename, Farbe, Rolle (owner/member) |
| `ideas` | Pins: Titel, Kategorie, Notiz, Link, Dauer, `lng/lat` + PostGIS-`location` |
| `votes` | 👎 −1 · 👍 1 · ❤️ 2 (Must-do) pro Person und Idee |
| `trip_routes` | Zuletzt berechnete Route pro Reise (Parameter + Ergebnis als JSON) |

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
- [x] Dashboard mit eigenen und geteilten Reisen, Login mit E-Mail oder Google
- [x] v2: Routenplaner (Reihenfolge, Tagesetappen, Fahrzeiten via OpenRouteService) + Unterkünfte aus OSM mit Buchungslinks
- [x] Route von Hand anpassen (Stopps verschieben, Ruhetage), Übernachtungsort mit den meisten Unterkünften in der Nähe
- [ ] Gemischter Verkehr: Etappen-Verkehrsmittel, Links zu ScotRail/Traveline (Fähren deckt OpenRouteService mit Key ab)
- [ ] Wanderungen als Linien / GPX-Upload
- [ ] Richtige Accounts (anonyme Nutzer per E-Mail verknüpfen), Datenschutz, Englisch
