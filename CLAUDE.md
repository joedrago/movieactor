# Claude Instructions

This repository contains tools for exploring and playing games with movie/actor data from IMDB, enriched with TMDB cast data.

## Overview

The database uses IMDB as the primary data source, optionally enriched with additional cast data from TMDB:

- **IMDB** (`data/imdb.db`) - Comprehensive coverage (~12M titles) with principal cast (~10 per movie)
- **TMDB enrichment** - Adds ~2.5M additional actor-movie links by matching TMDB cast names to existing IMDB actors

## Data Pipeline

1. `npm run imdb` - Downloads IMDB datasets and builds `data/imdb.db`
2. `npm run tmdb` - Downloads TMDB dataset and enriches `imdb.db` with additional cast (idempotent, safe to re-run)

## Before Writing Scripts or Tools

**Read `IMDB.md` first** for IMDB database documentation:
- Database schema and table definitions
- Column name mappings (TSV to SQLite)
- Index documentation
- FTS5 fuzzy search table documentation
- Example queries for common operations

## Key Files

- `data/imdb.db` - SQLite database with IMDB data, optionally enriched with TMDB cast
- `IMDB.md` - Complete documentation of the IMDB database schema
- `scripts/rebuild_imdb.js` - Script to download and rebuild IMDB database
- `scripts/rebuild_tmdb.js` - Script to enrich IMDB database with TMDB cast data
- `js/MovieActor.js` - Core game class (no I/O, used by UIs)
- `js/cli.js` - CLI interface for playing the game

## Database Schema

### Tables
- `name_basics` / `name_basics_fts` - People (actors, directors) with ~11M entries
- `title_basics` / `title_basics_fts` - Movies, TV shows with ~12M entries
- `title_principals` - Cast/crew links (~97M base + ~2.5M from TMDB enrichment)
- `title_ratings` - IMDB ratings

### How TMDB Enrichment Works

The `npm run tmdb` script:
1. Downloads the TMDB dataset (1M+ movies with comma-separated cast names)
2. For each TMDB movie with an IMDB ID, finds the matching movie in `imdb.db`
3. Parses the cast names and looks them up in `name_basics`
4. If an actor is found and not already linked, adds them to `title_principals`

This expands cast coverage beyond IMDB's ~10 principal cast per movie while maintaining IMDB ID integrity. The script is idempotent - running it multiple times won't create duplicates.

## Common Operations

**Search for actors:** Use `name_basics` table or `name_basics_fts` for fuzzy search
**Search for movies:** Use `title_basics` table or `title_basics_fts` for fuzzy search
**Find actor's movies:** Join `name_basics` → `title_principals` → `title_basics`
**Find movie's cast:** Join `title_basics` → `title_principals` → `name_basics`

## npm Scripts

- `npm run imdb` - Download IMDB data and build `data/imdb.db`
- `npm run tmdb` - Enrich `imdb.db` with TMDB cast data (requires Kaggle CLI, idempotent)
- `npm run play` - Play the Movie/Actor game
- `npm run format` - Format JS files with Prettier
- `npm run lint` - Lint JS files with ESLint

## Code Style

Always run `npm run format` and `npm run lint` after modifying JS files.
