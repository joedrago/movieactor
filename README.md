# MovieActor

A toolkit for exploring and playing games with movie/actor data from IMDB, enriched with TMDB cast data.

## Setup

```bash
# Install dependencies
npm install

# Build IMDB database (downloads ~1.8GB, creates ~12-15GB database)
npm run imdb

# Optionally enrich with TMDB cast data (requires Kaggle CLI)
npm run tmdb
```

### IMDB Setup

Downloads directly from datasets.imdbws.com - no authentication required.

```bash
npm run imdb
```

### TMDB Enrichment (Optional)

Enriches the IMDB database with additional cast data from TMDB. This adds ~2.5M actor-movie links beyond IMDB's principal cast.

Requires Kaggle CLI and API credentials:

```bash
# Install Kaggle CLI
pip install kaggle

# Set up API credentials
# 1. Go to https://www.kaggle.com/settings
# 2. Click "Create New Token" under API
# 3. Save kaggle.json to ~/.kaggle/kaggle.json
# 4. chmod 600 ~/.kaggle/kaggle.json

# Enrich database (safe to re-run, idempotent)
npm run tmdb
```

## Playing the Game

The Movie/Actor game is a two-player word association game where you take turns naming movies and actors:

- If shown an **actor**, name a movie they were in
- If shown a **movie**, name an actor from it
- No repeats within a round
- Say "challenge" if you think there's no valid answer
- First to win 5 rounds wins

```bash
npm run play
```

### Difficulty Levels

Difficulty controls what the computer "knows" - your answers are always validated against the full database.

| Difficulty | Movies | Actors | Description |
|------------|--------|--------|-------------|
| **Easy** | Post-1980, 100k+ votes | Top 3 billed | Modern blockbusters, leading stars only |
| **Medium** | Post-1960, 10k+ votes | Top 10 billed | Classic films, main cast |
| **Hard** | All years, 1k+ votes | Entire cast | Deep cuts, character actors |

On Easy, the computer only knows movies like *The Dark Knight* or *Inception* and stars like Leonardo DiCaprio or Tom Hanks. On Hard, it knows obscure 1940s films and actors with single-scene appearances.

## Data Pipeline

The database uses IMDB as the primary source, optionally enriched with TMDB:

1. **`npm run imdb`** - Downloads IMDB datasets and builds `data/imdb.db`
   - ~12M titles (movies, TV, shorts, etc.)
   - ~11M people (actors, directors, etc.)
   - ~97M principal cast/crew links (~10 per title)

2. **`npm run tmdb`** - Enriches `imdb.db` with TMDB cast data
   - Downloads TMDB dataset (1M+ movies with cast names)
   - Matches TMDB movies to IMDB by IMDB ID
   - Looks up cast names in IMDB's actor database
   - Adds ~2.5M new actor-movie links
   - Idempotent: safe to run multiple times

### Data Sources

- **IMDB:** [IMDB Non-Commercial Datasets](https://datasets.imdbws.com/) - updated daily
- **TMDB:** [Kaggle TMDB Dataset](https://www.kaggle.com/datasets/alanvourch/tmdb-movies-daily-updates) - updated daily

## Scripts

| Command | Description |
|---------|-------------|
| `npm run imdb` | Download IMDB data and build `data/imdb.db` |
| `npm run tmdb` | Enrich `imdb.db` with TMDB cast data (idempotent) |
| `npm run play` | Play the Movie/Actor game |
| `npm run format` | Format code with Prettier |
| `npm run lint` | Lint code with ESLint |

## Documentation

See [IMDB.md](IMDB.md) for complete database documentation including:
- Dataset file descriptions
- Database schema
- All available tables and indexes
- FTS5 fuzzy search usage
- Query examples

## Usage Examples

```sql
-- Fuzzy search for movies
SELECT t.* FROM title_basics_fts fts
JOIN title_basics t ON fts.tconst = t.tconst
WHERE fts.primary_title MATCH 'incep';

-- Find actor's movies
SELECT t.primary_title, t.start_year, p.characters
FROM name_basics n
JOIN title_principals p ON n.nconst = p.nconst
JOIN title_basics t ON p.tconst = t.tconst
WHERE n.primary_name = 'Leonardo DiCaprio'
  AND t.title_type = 'movie';

-- Find movie's cast (includes TMDB-enriched cast)
SELECT n.primary_name, p.category, p.characters
FROM title_basics t
JOIN title_principals p ON t.tconst = p.tconst
JOIN name_basics n ON p.nconst = n.nconst
WHERE t.primary_title = 'Inception'
  AND t.title_type = 'movie';
```
