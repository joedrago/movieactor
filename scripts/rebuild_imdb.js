#!/usr/bin/env node

/**
 * IMDB Database Rebuild Script
 *
 * Downloads IMDB dataset files and populates a SQLite database.
 * The database is optimized for searching by movie name or actor name.
 *
 * Usage: node scripts/rebuild_imdb.js [--force]
 *
 * Options:
 *   --force  Force re-download of dataset files even if they already exist
 *   --help, -h  Show this help message
 */

import { createWriteStream, createReadStream, existsSync, mkdirSync, statSync, unlinkSync } from "fs"
import { createGunzip } from "zlib"
import { pipeline } from "stream/promises"
import { createInterface } from "readline"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import Database from "better-sqlite3"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = join(__dirname, "..")
const DATA_DIR = join(PROJECT_ROOT, "data")
const DB_PATH = join(DATA_DIR, "imdb.db")

const IMDB_BASE_URL = "https://datasets.imdbws.com"
const DATASET_FILES = [
    "name.basics.tsv.gz",
    "title.basics.tsv.gz",
    "title.akas.tsv.gz",
    "title.crew.tsv.gz",
    "title.episode.tsv.gz",
    "title.principals.tsv.gz",
    "title.ratings.tsv.gz"
]

// Print help and exit
function printHelp() {
    console.log(`IMDB Database Rebuild Script

Downloads IMDB dataset files and populates a SQLite database.
The database is optimized for searching by movie name or actor name.

Usage: node scripts/rebuild_imdb.js [options]

Options:
  --force     Force re-download of dataset files even if they already exist
  --help, -h  Show this help message

By default, the script will only download files that are missing from the
data/ directory. Use --force to re-download all files.

Output:
  data/*.tsv.gz  Downloaded compressed dataset files
  data/*.tsv     Decompressed dataset files
  data/imdb.db   SQLite database with all imported data
`)
    process.exit(0)
}

// Parse command line arguments
if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp()
}

const forceDownload = process.argv.includes("--force")

/**
 * Download a file from URL to local path with progress indicator
 */
async function downloadFile(url, destPath) {
    const response = await fetch(url)
    if (!response.ok) {
        throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
    }

    const contentLength = parseInt(response.headers.get("content-length") || "0", 10)
    const fileStream = createWriteStream(destPath)

    let downloaded = 0
    const reader = response.body.getReader()

    while (true) {
        const { done, value } = await reader.read()
        if (done) break

        fileStream.write(value)
        downloaded += value.length

        if (contentLength > 0) {
            const percent = ((downloaded / contentLength) * 100).toFixed(1)
            process.stdout.write(`\r  Downloading: ${percent}% (${(downloaded / 1024 / 1024).toFixed(1)} MB)`)
        }
    }

    fileStream.end()
    console.log()
}

/**
 * Decompress a .gz file
 */
async function decompressFile(gzPath, destPath) {
    const gunzip = createGunzip()
    const source = createReadStream(gzPath)
    const dest = createWriteStream(destPath)

    await pipeline(source, gunzip, dest)
}

/**
 * Process a TSV file line by line using streams
 */
async function* readTsv(filePath) {
    const fileStream = createReadStream(filePath)
    const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity
    })

    let headers = null

    for await (const line of rl) {
        if (!headers) {
            headers = line.split("\t")
            continue
        }

        const values = line.split("\t")
        const row = {}

        for (let i = 0; i < headers.length; i++) {
            // Convert \N to null
            row[headers[i]] = values[i] === "\\N" ? null : values[i]
        }

        yield { row }
    }
}

/**
 * Create the database schema
 * Note: Foreign key constraints are intentionally omitted because IMDB data
 * contains references to entries that may not exist or were filtered out.
 */
function createSchema(db) {
    console.log("Creating database schema...")

    // Drop existing tables (order matters for FTS tables)
    db.exec(`
    DROP TABLE IF EXISTS name_basics_fts;
    DROP TABLE IF EXISTS title_basics_fts;
    DROP TABLE IF EXISTS name_basics;
    DROP TABLE IF EXISTS title_basics;
    DROP TABLE IF EXISTS title_akas;
    DROP TABLE IF EXISTS title_crew;
    DROP TABLE IF EXISTS title_episode;
    DROP TABLE IF EXISTS title_principals;
    DROP TABLE IF EXISTS title_ratings;
  `)

    // name_basics - People (actors, directors, etc.)
    db.exec(`
    CREATE TABLE name_basics (
      nconst TEXT PRIMARY KEY,
      primary_name TEXT NOT NULL,
      birth_year INTEGER,
      death_year INTEGER,
      primary_profession TEXT,
      known_for_titles TEXT
    );
  `)

    // title_basics - Movies, TV shows, etc.
    db.exec(`
    CREATE TABLE title_basics (
      tconst TEXT PRIMARY KEY,
      title_type TEXT,
      primary_title TEXT NOT NULL,
      original_title TEXT,
      is_adult INTEGER,
      start_year INTEGER,
      end_year INTEGER,
      runtime_minutes INTEGER,
      genres TEXT
    );
  `)

    // title_akas - Alternative/localized titles
    db.exec(`
    CREATE TABLE title_akas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title_id TEXT NOT NULL,
      ordering INTEGER,
      title TEXT NOT NULL,
      region TEXT,
      language TEXT,
      types TEXT,
      attributes TEXT,
      is_original_title INTEGER
    );
  `)

    // title_crew - Directors and writers
    db.exec(`
    CREATE TABLE title_crew (
      tconst TEXT PRIMARY KEY,
      directors TEXT,
      writers TEXT
    );
  `)

    // title_episode - TV episode info
    db.exec(`
    CREATE TABLE title_episode (
      tconst TEXT PRIMARY KEY,
      parent_tconst TEXT,
      season_number INTEGER,
      episode_number INTEGER
    );
  `)

    // title_principals - Principal cast/crew
    db.exec(`
    CREATE TABLE title_principals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tconst TEXT NOT NULL,
      ordering INTEGER,
      nconst TEXT NOT NULL,
      category TEXT,
      job TEXT,
      characters TEXT
    );
  `)

    // title_ratings - User ratings
    db.exec(`
    CREATE TABLE title_ratings (
      tconst TEXT PRIMARY KEY,
      average_rating REAL,
      num_votes INTEGER
    );
  `)
}

/**
 * Create indexes for fast searching
 */
function createIndexes(db) {
    console.log("Creating indexes for fast searching...")

    // Indexes for exact/LIKE searching by name
    db.exec(`
    CREATE INDEX IF NOT EXISTS idx_name_basics_primary_name ON name_basics(primary_name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_title_basics_primary_title ON title_basics(primary_title COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_title_basics_title_type ON title_basics(title_type);
    CREATE INDEX IF NOT EXISTS idx_title_basics_start_year ON title_basics(start_year);
    CREATE INDEX IF NOT EXISTS idx_title_akas_title ON title_akas(title COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_title_akas_title_id ON title_akas(title_id);
  `)

    // Indexes for joining tables (critical for actor<->movie lookups)
    db.exec(`
    CREATE INDEX IF NOT EXISTS idx_title_principals_tconst ON title_principals(tconst);
    CREATE INDEX IF NOT EXISTS idx_title_principals_nconst ON title_principals(nconst);
    CREATE INDEX IF NOT EXISTS idx_title_principals_category ON title_principals(category);
    CREATE INDEX IF NOT EXISTS idx_title_episode_parent ON title_episode(parent_tconst);
  `)

    // Index for ratings lookup (to sort by popularity)
    db.exec(`
    CREATE INDEX IF NOT EXISTS idx_title_ratings_votes ON title_ratings(num_votes DESC);
  `)

    console.log("Indexes created successfully!")
}

/**
 * Create FTS5 full-text search tables for fuzzy searching
 */
function createFtsTables(db) {
    console.log("Creating full-text search tables for fuzzy matching...")

    // FTS5 table for searching actor/person names
    // tokenize='trigram' enables substring matching (e.g., "Caprio" matches "DiCaprio")
    db.exec(`
    CREATE VIRTUAL TABLE name_basics_fts USING fts5(
      nconst UNINDEXED,
      primary_name,
      tokenize='trigram'
    );
  `)

    // Populate from name_basics
    console.log("  Populating name_basics_fts...")
    db.exec(`
    INSERT INTO name_basics_fts (nconst, primary_name)
    SELECT nconst, primary_name FROM name_basics;
  `)

    // FTS5 table for searching movie/title names
    db.exec(`
    CREATE VIRTUAL TABLE title_basics_fts USING fts5(
      tconst UNINDEXED,
      primary_title,
      tokenize='trigram'
    );
  `)

    // Populate from title_basics (only movies and TV series, not episodes)
    console.log("  Populating title_basics_fts...")
    db.exec(`
    INSERT INTO title_basics_fts (tconst, primary_title)
    SELECT tconst, primary_title FROM title_basics
    WHERE title_type IN ('movie', 'tvSeries', 'tvMiniSeries', 'tvMovie', 'video');
  `)

    console.log("Full-text search tables created successfully!")
}

/**
 * Optimize database for read-only queries
 */
function optimizeForReadOnly(db) {
    console.log("Optimizing database for read-only queries...")

    // Run ANALYZE to help query planner make better decisions
    db.exec("ANALYZE")

    // Optimize FTS tables
    db.exec("INSERT INTO name_basics_fts(name_basics_fts) VALUES('optimize')")
    db.exec("INSERT INTO title_basics_fts(title_basics_fts) VALUES('optimize')")

    console.log("Optimization complete!")
}

/**
 * Import a TSV file into the database
 */
async function importTsv(db, tsvPath, tableName, insertSql, mapRow, batchSize = 10000) {
    const fileName = tsvPath.split("/").pop()
    console.log(`Importing ${fileName}...`)

    const insert = db.prepare(insertSql)
    const insertMany = db.transaction((rows) => {
        for (const row of rows) {
            insert.run(row)
        }
    })

    let batch = []
    let totalRows = 0

    for await (const { row } of readTsv(tsvPath)) {
        const mappedRow = mapRow(row)
        if (mappedRow) {
            batch.push(mappedRow)
        }

        if (batch.length >= batchSize) {
            insertMany(batch)
            totalRows += batch.length
            process.stdout.write(`\r  Imported ${totalRows.toLocaleString()} rows...`)
            batch = []
        }
    }

    // Insert remaining rows
    if (batch.length > 0) {
        insertMany(batch)
        totalRows += batch.length
    }

    console.log(`\r  Imported ${totalRows.toLocaleString()} rows into ${tableName}`)
}

/**
 * Main function
 */
async function main() {
    console.log("IMDB Database Rebuild Script")
    console.log("============================\n")

    // Create data directory if it doesn't exist
    if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true })
    }

    // Download and decompress files
    console.log("Step 1: Checking/downloading IMDB dataset files...\n")

    for (const file of DATASET_FILES) {
        const gzPath = join(DATA_DIR, file)
        const url = `${IMDB_BASE_URL}/${file}`

        // Download if file doesn't exist or if --force is set
        if (!existsSync(gzPath) || forceDownload) {
            console.log(`  Downloading ${file}...`)
            await downloadFile(url, gzPath)
        } else {
            console.log(`  ${file} exists, skipping download`)
        }
    }

    console.log("\nStep 2: Decompressing files...\n")

    for (const file of DATASET_FILES) {
        const gzPath = join(DATA_DIR, file)
        const tsvPath = gzPath.replace(".gz", "")

        // Decompress if TSV doesn't exist, or if gz is newer, or if --force is set
        if (!existsSync(tsvPath) || forceDownload) {
            console.log(`  Decompressing ${file}...`)
            await decompressFile(gzPath, tsvPath)
        } else {
            const gzStats = statSync(gzPath)
            const tsvStats = statSync(tsvPath)
            if (gzStats.mtimeMs > tsvStats.mtimeMs) {
                console.log(`  Decompressing ${file}...`)
                await decompressFile(gzPath, tsvPath)
            } else {
                console.log(`  ${file.replace(".gz", "")} already decompressed, skipping`)
            }
        }
    }

    // Create/recreate database
    console.log("\nStep 3: Creating SQLite database...\n")

    if (existsSync(DB_PATH)) {
        console.log(`  Removing existing database at ${DB_PATH}`)
        unlinkSync(DB_PATH)
    }

    const db = new Database(DB_PATH)

    // Enable WAL mode for better performance
    db.pragma("journal_mode = WAL")
    db.pragma("synchronous = NORMAL")
    db.pragma("cache_size = -64000") // 64MB cache

    createSchema(db)

    // Import data
    console.log("\nStep 4: Importing data...\n")

    // Import name_basics (people)
    await importTsv(
        db,
        join(DATA_DIR, "name.basics.tsv"),
        "name_basics",
        `INSERT INTO name_basics (nconst, primary_name, birth_year, death_year, primary_profession, known_for_titles)
     VALUES (@nconst, @primary_name, @birth_year, @death_year, @primary_profession, @known_for_titles)`,
        (row) => {
            // Skip rows with missing required fields
            if (!row.nconst || !row.primaryName) return null
            return {
                nconst: row.nconst,
                primary_name: row.primaryName,
                birth_year: row.birthYear ? parseInt(row.birthYear, 10) : null,
                death_year: row.deathYear ? parseInt(row.deathYear, 10) : null,
                primary_profession: row.primaryProfession,
                known_for_titles: row.knownForTitles
            }
        }
    )

    // Import title_basics (titles)
    await importTsv(
        db,
        join(DATA_DIR, "title.basics.tsv"),
        "title_basics",
        `INSERT INTO title_basics (tconst, title_type, primary_title, original_title, is_adult, start_year, end_year, runtime_minutes, genres)
     VALUES (@tconst, @title_type, @primary_title, @original_title, @is_adult, @start_year, @end_year, @runtime_minutes, @genres)`,
        (row) => {
            // Skip rows with missing required fields
            if (!row.tconst || !row.primaryTitle) return null
            return {
                tconst: row.tconst,
                title_type: row.titleType,
                primary_title: row.primaryTitle,
                original_title: row.originalTitle,
                is_adult: row.isAdult ? parseInt(row.isAdult, 10) : 0,
                start_year: row.startYear ? parseInt(row.startYear, 10) : null,
                end_year: row.endYear ? parseInt(row.endYear, 10) : null,
                runtime_minutes: row.runtimeMinutes ? parseInt(row.runtimeMinutes, 10) : null,
                genres: row.genres
            }
        }
    )

    // Import title_akas (alternative titles)
    await importTsv(
        db,
        join(DATA_DIR, "title.akas.tsv"),
        "title_akas",
        `INSERT INTO title_akas (title_id, ordering, title, region, language, types, attributes, is_original_title)
     VALUES (@title_id, @ordering, @title, @region, @language, @types, @attributes, @is_original_title)`,
        (row) => {
            // Skip rows with missing required fields
            if (!row.titleId || !row.title) return null
            return {
                title_id: row.titleId,
                ordering: row.ordering ? parseInt(row.ordering, 10) : null,
                title: row.title,
                region: row.region,
                language: row.language,
                types: row.types,
                attributes: row.attributes,
                is_original_title: row.isOriginalTitle ? parseInt(row.isOriginalTitle, 10) : 0
            }
        }
    )

    // Import title_crew
    await importTsv(
        db,
        join(DATA_DIR, "title.crew.tsv"),
        "title_crew",
        `INSERT INTO title_crew (tconst, directors, writers)
     VALUES (@tconst, @directors, @writers)`,
        (row) => ({
            tconst: row.tconst,
            directors: row.directors,
            writers: row.writers
        })
    )

    // Import title_episode
    await importTsv(
        db,
        join(DATA_DIR, "title.episode.tsv"),
        "title_episode",
        `INSERT INTO title_episode (tconst, parent_tconst, season_number, episode_number)
     VALUES (@tconst, @parent_tconst, @season_number, @episode_number)`,
        (row) => ({
            tconst: row.tconst,
            parent_tconst: row.parentTconst,
            season_number: row.seasonNumber ? parseInt(row.seasonNumber, 10) : null,
            episode_number: row.episodeNumber ? parseInt(row.episodeNumber, 10) : null
        })
    )

    // Import title_principals (cast/crew)
    await importTsv(
        db,
        join(DATA_DIR, "title.principals.tsv"),
        "title_principals",
        `INSERT INTO title_principals (tconst, ordering, nconst, category, job, characters)
     VALUES (@tconst, @ordering, @nconst, @category, @job, @characters)`,
        (row) => {
            // Skip rows with missing required fields
            if (!row.tconst || !row.nconst) return null
            return {
                tconst: row.tconst,
                ordering: row.ordering ? parseInt(row.ordering, 10) : null,
                nconst: row.nconst,
                category: row.category,
                job: row.job,
                characters: row.characters
            }
        }
    )

    // Import title_ratings
    await importTsv(
        db,
        join(DATA_DIR, "title.ratings.tsv"),
        "title_ratings",
        `INSERT INTO title_ratings (tconst, average_rating, num_votes)
     VALUES (@tconst, @average_rating, @num_votes)`,
        (row) => ({
            tconst: row.tconst,
            average_rating: row.averageRating ? parseFloat(row.averageRating) : null,
            num_votes: row.numVotes ? parseInt(row.numVotes, 10) : null
        })
    )

    // Create indexes
    console.log("\nStep 5: Creating indexes...\n")
    createIndexes(db)

    // Create FTS tables for fuzzy searching
    console.log("\nStep 6: Creating full-text search tables...\n")
    createFtsTables(db)

    // Optimize for read-only use
    console.log("\nStep 7: Optimizing for read-only queries...\n")
    optimizeForReadOnly(db)

    // Vacuum to compact
    console.log("\nStep 8: Compacting database...\n")
    db.exec("VACUUM")

    // Close database
    db.close()

    console.log("\n============================")
    console.log(`Database created successfully at: ${DB_PATH}`)

    // Print file size
    const dbStats = statSync(DB_PATH)
    console.log(`Database size: ${(dbStats.size / 1024 / 1024 / 1024).toFixed(2)} GB`)

    console.log("\nExample queries:")
    console.log("  Fuzzy search for actors:")
    console.log("    SELECT * FROM name_basics_fts WHERE primary_name MATCH 'dicaprio'")
    console.log("  Fuzzy search for movies:")
    console.log("    SELECT * FROM title_basics_fts WHERE primary_title MATCH 'incep'")
    console.log("  Find actor's movies: See IMDB.md for full query examples")
}

main().catch((err) => {
    console.error("Error:", err)
    process.exit(1)
})
