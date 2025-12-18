# MovieActor

A toolkit for exploring and playing games with the IMDB dataset. Downloads IMDB's public data files and imports them into a local SQLite database optimized for searching movies and actors.

## Setup

```bash
# Install dependencies
npm install

# Build the database (downloads ~1.8GB, creates ~12-15GB database)
npm run gendb
```

The first run downloads all IMDB dataset files and imports them into `data/imdb.db`. Subsequent runs skip downloading unless files are missing (use `--force` to re-download).

## Usage

Once the database is built, you can query it with any SQLite client:

```bash
sqlite3 data/imdb.db
```

### Search for movies

```sql
-- Exact search
SELECT * FROM title_basics
WHERE primary_title LIKE '%Inception%' AND title_type = 'movie';

-- Fuzzy search (substring matching)
SELECT t.* FROM title_basics_fts fts
JOIN title_basics t ON fts.tconst = t.tconst
WHERE fts.primary_title MATCH 'incep';
```

### Search for actors

```sql
-- Exact search
SELECT * FROM name_basics WHERE primary_name LIKE '%DiCaprio%';

-- Fuzzy search
SELECT n.* FROM name_basics_fts fts
JOIN name_basics n ON fts.nconst = n.nconst
WHERE fts.primary_name MATCH 'dicaprio';
```

### Find an actor's movies

```sql
SELECT t.primary_title, t.start_year, p.characters, r.average_rating
FROM name_basics n
JOIN title_principals p ON n.nconst = p.nconst
JOIN title_basics t ON p.tconst = t.tconst
LEFT JOIN title_ratings r ON t.tconst = r.tconst
WHERE n.primary_name = 'Leonardo DiCaprio'
  AND t.title_type = 'movie'
  AND p.category IN ('actor', 'actress')
ORDER BY t.start_year DESC;
```

### Find a movie's cast

```sql
SELECT n.primary_name, p.characters, p.ordering
FROM title_basics t
JOIN title_principals p ON t.tconst = p.tconst
JOIN name_basics n ON p.nconst = n.nconst
WHERE t.primary_title = 'Inception'
  AND t.title_type = 'movie'
  AND t.start_year = 2010
ORDER BY p.ordering;
```

## Documentation

See [IMDB.md](IMDB.md) for complete documentation including:
- Dataset file descriptions
- Database schema
- All available tables and indexes
- FTS5 fuzzy search usage
- More query examples

## Scripts

| Command | Description |
|---------|-------------|
| `npm run gendb` | Download IMDB data and build the database |
| `npm run format` | Format code with Prettier |
| `npm run lint` | Lint code with ESLint |

## Data Source

Data is sourced from [IMDB Non-Commercial Datasets](https://datasets.imdbws.com/), provided by IMDb for non-commercial use.
