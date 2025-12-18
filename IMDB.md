# IMDB Dataset Documentation

## Data Source

The IMDB datasets are provided by IMDb for non-commercial use. They are available for download at:

**https://datasets.imdbws.com/**

The datasets are updated daily and provided as tab-separated values (TSV) files compressed with gzip.

## Dataset Files

There are 7 dataset files available:

| File | Description | Rows (approx) | Size (uncompressed) |
|------|-------------|---------------|---------------------|
| `name.basics.tsv.gz` | People (actors, directors, etc.) | ~15M | ~880 MB |
| `title.basics.tsv.gz` | Titles (movies, TV shows, etc.) | ~12M | ~1 GB |
| `title.akas.tsv.gz` | Alternative/localized titles | ~54M | ~2.6 GB |
| `title.crew.tsv.gz` | Directors and writers per title | ~12M | ~380 MB |
| `title.episode.tsv.gz` | TV episode information | ~9M | ~235 MB |
| `title.principals.tsv.gz` | Principal cast/crew per title | ~97M | ~4.1 GB |
| `title.ratings.tsv.gz` | User ratings for titles | ~1.6M | ~27 MB |

## File Schemas

### name.basics.tsv - People

Contains information about people in the entertainment industry.

| Column | Type | Description |
|--------|------|-------------|
| `nconst` | string | Unique identifier for a person (e.g., `nm0000001`) |
| `primaryName` | string | Name the person is most often credited as |
| `birthYear` | integer | Birth year (YYYY format) or `\N` if unknown |
| `deathYear` | integer | Death year (YYYY format) or `\N` if still living/unknown |
| `primaryProfession` | string | Top 3 professions, comma-separated |
| `knownForTitles` | string | Title IDs the person is known for, comma-separated |

### title.basics.tsv - Titles

Contains basic information about titles (movies, TV shows, shorts, etc.).

| Column | Type | Description |
|--------|------|-------------|
| `tconst` | string | Unique identifier for a title (e.g., `tt0000001`) |
| `titleType` | string | Type: movie, short, tvSeries, tvEpisode, tvMovie, etc. |
| `primaryTitle` | string | Popular/promotional title |
| `originalTitle` | string | Original title in the original language |
| `isAdult` | boolean | 0 = non-adult, 1 = adult title |
| `startYear` | integer | Release year or series start year |
| `endYear` | integer | Series end year (or `\N` for movies/ongoing) |
| `runtimeMinutes` | integer | Runtime in minutes |
| `genres` | string | Up to 3 genres, comma-separated |

### title.akas.tsv - Alternative Titles

Contains localized/alternative titles for each title.

| Column | Type | Description |
|--------|------|-------------|
| `titleId` | string | Title identifier (references `tconst`) |
| `ordering` | integer | Uniquely identifies each row for a titleId |
| `title` | string | Localized/alternative title |
| `region` | string | Region code (e.g., US, DE, FR) or `\N` |
| `language` | string | Language code or `\N` |
| `types` | string | Type attributes: alternative, dvd, festival, tv, etc. |
| `attributes` | string | Additional attributes (e.g., "literal title") |
| `isOriginalTitle` | boolean | 1 = original title, 0 = not |

### title.crew.tsv - Crew

Contains director and writer information for titles.

| Column | Type | Description |
|--------|------|-------------|
| `tconst` | string | Title identifier |
| `directors` | string | Comma-separated `nconst` values of directors |
| `writers` | string | Comma-separated `nconst` values of writers |

### title.episode.tsv - TV Episodes

Contains information about TV series episodes.

| Column | Type | Description |
|--------|------|-------------|
| `tconst` | string | Episode title identifier |
| `parentTconst` | string | Parent TV series identifier |
| `seasonNumber` | integer | Season number or `\N` |
| `episodeNumber` | integer | Episode number within season or `\N` |

### title.principals.tsv - Principal Cast/Crew

Contains principal cast and crew for each title.

| Column | Type | Description |
|--------|------|-------------|
| `tconst` | string | Title identifier |
| `ordering` | integer | Order of credit (1 = most prominent) |
| `nconst` | string | Person identifier |
| `category` | string | Role category: actor, actress, director, writer, producer, etc. |
| `job` | string | Specific job title (for crew) or `\N` |
| `characters` | string | JSON array of character names played or `\N` |

### title.ratings.tsv - User Ratings

Contains aggregate user ratings for titles.

| Column | Type | Description |
|--------|------|-------------|
| `tconst` | string | Title identifier |
| `averageRating` | decimal | Weighted average rating (0-10) |
| `numVotes` | integer | Number of votes the rating is based on |

## Entity Relationships

```
                              ┌─────────────────┐
                              │  name.basics    │
                              │    (people)     │
                              │    nconst PK    │
                              └────────┬────────┘
                                       │
           ┌───────────────────────────┼───────────────────────────┐
           │                           │                           │
           │ knownForTitles            │ nconst                    │ directors/writers
           │ (comma-sep)               │                           │ (comma-sep)
           │                           │                           │
           ▼                           ▼                           ▼
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│  title.basics   │◄────────│ title.principals │────────►│   title.crew    │
│   (titles)      │ tconst  │  (cast & crew)  │         │ (directors/     │
│   tconst PK     │         │                 │         │    writers)     │
└────────┬────────┘         └─────────────────┘         └─────────────────┘
         │
         │ tconst
         │
         ├──────────────────┬─────────────────┬─────────────────┐
         │                  │                 │                 │
         ▼                  ▼                 ▼                 ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  title.akas     │ │ title.episode   │ │ title.ratings   │ │ (self-ref)      │
│  (alt titles)   │ │ (TV episodes)   │ │                 │ │ parentTconst    │
│                 │ │                 │ │                 │ │ for episodes    │
└─────────────────┘ └─────────────────┘ └─────────────────┘ └─────────────────┘
```

### Key Relationships

1. **nconst** - Unique identifier for people
   - Primary key in `name.basics`
   - Referenced in `title.principals.nconst`
   - Referenced in `title.crew.directors` and `title.crew.writers` (comma-separated lists)
   - Referenced in `name.basics.knownForTitles` (comma-separated list)

2. **tconst** - Unique identifier for titles
   - Primary key in `title.basics`
   - Referenced in `title.akas.titleId`
   - Referenced in `title.crew.tconst`
   - Referenced in `title.episode.tconst` and `title.episode.parentTconst`
   - Referenced in `title.principals.tconst`
   - Referenced in `title.ratings.tconst`

## Common Query Patterns

### Find movies by title
```sql
SELECT * FROM title_basics
WHERE primaryTitle LIKE '%Inception%' AND titleType = 'movie';
```

### Find actor by name and their movies
```sql
SELECT n.primaryName, t.primaryTitle, t.startYear, p.category, p.characters
FROM name_basics n
JOIN title_principals p ON n.nconst = p.nconst
JOIN title_basics t ON p.tconst = t.tconst
WHERE n.primaryName LIKE '%DiCaprio%'
  AND t.titleType = 'movie'
ORDER BY t.startYear DESC;
```

### Find cast of a specific movie
```sql
SELECT n.primaryName, p.category, p.characters
FROM title_basics t
JOIN title_principals p ON t.tconst = p.tconst
JOIN name_basics n ON p.nconst = n.nconst
WHERE t.primaryTitle = 'Inception' AND t.titleType = 'movie'
ORDER BY p.ordering;
```

## Notes

- `\N` represents NULL/missing values in the TSV files
- Comma-separated values in columns like `genres`, `knownForTitles`, `directors`, and `writers` need to be split when querying
- The `characters` column in `title.principals` contains a JSON array string
- Not all titles have ratings (only ~1.6M of ~12M have entries in `title.ratings`)
- Title types include: movie, short, tvSeries, tvMiniSeries, tvEpisode, tvMovie, tvSpecial, tvShort, video, videoGame, podcastSeries, podcastEpisode

---

## SQLite Database Schema

The `scripts/rebuild_imdb.js` script downloads the IMDB dataset files and imports them into a SQLite database (`data/imdb.db`) optimized for searching by movie name or actor name.

### Running the Script

```bash
# Install dependencies
npm install

# Run the rebuild script (downloads ~1.8GB, creates ~10GB database)
npm run gendb

# Force re-download of all files even if they exist
node scripts/rebuild_imdb.js --force

# Show help
node scripts/rebuild_imdb.js --help
```

### Database Tables

The SQLite schema closely mirrors the IMDB TSV structure with some normalization for SQL compatibility:

| SQLite Table | Source File | Primary Key | Description |
|--------------|-------------|-------------|-------------|
| `name_basics` | name.basics.tsv | `nconst` | People (actors, directors, etc.) |
| `title_basics` | title.basics.tsv | `tconst` | Titles (movies, TV shows, etc.) |
| `title_akas` | title.akas.tsv | `id` (auto) | Alternative/localized titles |
| `title_crew` | title.crew.tsv | `tconst` | Directors and writers |
| `title_episode` | title.episode.tsv | `tconst` | TV episode information |
| `title_principals` | title.principals.tsv | `id` (auto) | Principal cast/crew per title |
| `title_ratings` | title.ratings.tsv | `tconst` | User ratings |

### Column Name Mapping

Column names are converted from camelCase to snake_case:

| TSV Column | SQLite Column |
|------------|---------------|
| `primaryName` | `primary_name` |
| `birthYear` | `birth_year` |
| `titleType` | `title_type` |
| `primaryTitle` | `primary_title` |
| `startYear` | `start_year` |
| `runtimeMinutes` | `runtime_minutes` |
| `averageRating` | `average_rating` |
| `numVotes` | `num_votes` |
| etc. | etc. |

### Indexes for Fast Searching

The following indexes are created to enable fast searches:

**Name/title search indexes:**
- `idx_name_basics_primary_name` - Case-insensitive search on person names
- `idx_title_basics_primary_title` - Case-insensitive search on movie titles
- `idx_title_basics_title_type` - Filter by title type (movie, tvSeries, etc.)
- `idx_title_basics_start_year` - Filter by release year
- `idx_title_akas_title` - Search alternative/localized titles
- `idx_title_akas_title_id` - Join alternative titles to main title

**Relationship indexes:**
- `idx_title_principals_tconst` - Find cast/crew for a title
- `idx_title_principals_nconst` - Find titles for a person
- `idx_title_principals_category` - Filter by role (actor, director, etc.)
- `idx_title_episode_parent` - Find episodes for a TV series

**Ratings index:**
- `idx_title_ratings_votes` - Sort by popularity (vote count)

### Full-Text Search (FTS5) Tables

For fuzzy/loose searching, the database includes FTS5 virtual tables with trigram tokenization. This enables substring matching (e.g., searching "caprio" will match "Leonardo DiCaprio").

| FTS Table | Source | Description |
|-----------|--------|-------------|
| `name_basics_fts` | `name_basics` | Fuzzy search on actor/person names |
| `title_basics_fts` | `title_basics` | Fuzzy search on movie/show titles (excludes episodes) |

**FTS columns:**
- `nconst` / `tconst` - ID to join back to main table (UNINDEXED, not searchable)
- `primary_name` / `primary_title` - Searchable text field

### Example SQLite Queries

#### Fuzzy Search (FTS5)

**Fuzzy search for actors by partial name:**
```sql
-- Find actors matching partial name (substring match)
SELECT n.*
FROM name_basics_fts fts
JOIN name_basics n ON fts.nconst = n.nconst
WHERE fts.primary_name MATCH 'dicaprio'
LIMIT 20;
```

**Fuzzy search for movies by partial title:**
```sql
-- Find movies matching partial title
SELECT t.*, r.average_rating, r.num_votes
FROM title_basics_fts fts
JOIN title_basics t ON fts.tconst = t.tconst
LEFT JOIN title_ratings r ON t.tconst = r.tconst
WHERE fts.primary_title MATCH 'dark knight'
ORDER BY r.num_votes DESC
LIMIT 20;
```

#### Exact/LIKE Search

**Search for movies by title:**
```sql
SELECT t.*, r.average_rating, r.num_votes
FROM title_basics t
LEFT JOIN title_ratings r ON t.tconst = r.tconst
WHERE t.primary_title LIKE '%Inception%'
  AND t.title_type = 'movie'
ORDER BY r.num_votes DESC;
```

**Search for an actor and their movies:**
```sql
SELECT n.primary_name, t.primary_title, t.start_year,
       p.category, p.characters, r.average_rating
FROM name_basics n
JOIN title_principals p ON n.nconst = p.nconst
JOIN title_basics t ON p.tconst = t.tconst
LEFT JOIN title_ratings r ON t.tconst = r.tconst
WHERE n.primary_name LIKE '%Leonardo DiCaprio%'
  AND t.title_type = 'movie'
  AND p.category IN ('actor', 'actress')
ORDER BY t.start_year DESC;
```

**Find cast of a specific movie:**
```sql
SELECT n.primary_name, p.category, p.characters, p.ordering
FROM title_basics t
JOIN title_principals p ON t.tconst = p.tconst
JOIN name_basics n ON p.nconst = n.nconst
WHERE t.primary_title = 'Inception'
  AND t.title_type = 'movie'
  AND t.start_year = 2010
ORDER BY p.ordering;
```

**Search by alternative/localized title:**
```sql
SELECT t.primary_title, t.original_title, a.title AS localized_title,
       a.region, t.start_year
FROM title_akas a
JOIN title_basics t ON a.title_id = t.tconst
WHERE a.title LIKE '%El origen%'
  AND t.title_type = 'movie';
```

**Top rated movies with minimum vote threshold:**
```sql
SELECT t.primary_title, t.start_year, t.genres,
       r.average_rating, r.num_votes
FROM title_basics t
JOIN title_ratings r ON t.tconst = r.tconst
WHERE t.title_type = 'movie'
  AND r.num_votes >= 100000
ORDER BY r.average_rating DESC
LIMIT 100;
```

### Database Size

The resulting SQLite database is approximately **12-15 GB** depending on the current IMDB data (includes FTS indexes). The script uses:

- WAL (Write-Ahead Logging) mode during import for better write performance
- 64MB cache for faster imports
- Batch inserts (10,000 rows per transaction) for efficiency
- FTS5 with trigram tokenization for fuzzy substring matching
- ANALYZE for query planner optimization
- VACUUM at the end to compact storage

### Read-Only Optimizations

The database is optimized for read-only queries:
- All foreign key constraints removed (IMDB data has inconsistencies)
- Comprehensive indexes on all join columns
- FTS5 tables pre-optimized after population
- ANALYZE statistics gathered for query planning
