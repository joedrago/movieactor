#!/usr/bin/env node

/**
 * TMDB Cast Enrichment Script
 *
 * Downloads the TMDB dataset and uses it to supplement the IMDB database
 * with additional cast members. For each movie in TMDB:
 *   1. Find the matching movie in imdb.db by IMDB ID
 *   2. Parse the comma-separated cast names
 *   3. Look up each actor in IMDB's name_basics table
 *   4. If found and not already linked, add them to title_principals
 *
 * This expands cast coverage beyond IMDB's ~10 principal cast per movie
 * while maintaining IMDB ID integrity.
 *
 * Prerequisites:
 *   - Run `npm run imdb` first to create data/imdb.db
 *   - Kaggle CLI installed: pip install kaggle
 *   - Kaggle API credentials in ~/.kaggle/kaggle.json
 *
 * Usage: node scripts/rebuild_tmdb.js [--force]
 */

import { createReadStream, existsSync, mkdirSync, readdirSync } from "fs"
import { createInterface } from "readline"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { execSync } from "child_process"
import Database from "better-sqlite3"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = join(__dirname, "..")
const DATA_DIR = join(PROJECT_ROOT, "data")
const IMDB_DB_PATH = join(DATA_DIR, "imdb.db")

// The Ultimate 1Million Movies Dataset - daily updated with IMDB IDs
const KAGGLE_DATASET = "alanvourch/tmdb-movies-daily-updates"

// Print help and exit
function printHelp() {
    console.log(`TMDB Cast Enrichment Script

Downloads TMDB dataset and enriches the IMDB database with additional cast members.
For each TMDB movie, parses cast names and links them to existing IMDB actors.

Usage: node scripts/rebuild_tmdb.js [options]

Options:
  --force     Force re-download of dataset files even if they already exist
  --help, -h  Show this help message

Prerequisites:
  1. Run 'npm run imdb' first to create data/imdb.db
  2. Install Kaggle CLI: pip install kaggle
  3. Get API credentials from https://www.kaggle.com/settings -> API -> Create New Token
  4. Save kaggle.json to ~/.kaggle/kaggle.json

How it works:
  1. Downloads TMDB dataset with 1M+ movies (includes IMDB IDs and cast names)
  2. For each movie with an IMDB ID, finds the matching movie in imdb.db
  3. Parses comma-separated cast names from TMDB
  4. Looks up each actor name in IMDB's name_basics table
  5. If found and not already linked, adds them to title_principals

This expands cast coverage beyond IMDB's ~10 principal cast per movie.
`)
    process.exit(0)
}

// Parse command line arguments
if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp()
}

const forceDownload = process.argv.includes("--force")

/**
 * Check if Kaggle CLI is available
 */
function checkKaggleCli() {
    try {
        execSync("kaggle --version", { stdio: "pipe" })
        return true
    } catch {
        return false
    }
}

/**
 * Download dataset from Kaggle
 */
function downloadFromKaggle() {
    console.log(`  Downloading from Kaggle: ${KAGGLE_DATASET}`)
    console.log("  This may take a few minutes...\n")

    try {
        execSync(`kaggle datasets download -d ${KAGGLE_DATASET} --unzip -p "${DATA_DIR}"`, {
            stdio: "inherit"
        })
        return true
    } catch {
        console.error("\n  Failed to download from Kaggle.")
        console.error("  Make sure you have:")
        console.error("    1. Installed kaggle CLI: pip install kaggle")
        console.error("    2. Created ~/.kaggle/kaggle.json with your API credentials")
        console.error("       (Get from https://www.kaggle.com/settings -> API -> Create New Token)\n")
        return false
    }
}

/**
 * Find TMDB CSV file in data directory
 */
function findTmdbFile() {
    if (!existsSync(DATA_DIR)) return null

    const files = readdirSync(DATA_DIR)
    // Look for the main movies file from alanvourch dataset
    const tmdbFile = files.find(
        (f) => f.toLowerCase().includes("tmdb") && f.toLowerCase().includes("movie") && f.endsWith(".csv")
    )

    if (tmdbFile) {
        console.log("  Found TMDB file:", tmdbFile)
        return join(DATA_DIR, tmdbFile)
    }

    return null
}

/**
 * Process a CSV file line by line using streams
 * Handles quoted fields with commas and newlines
 */
async function* readCsv(filePath) {
    const fileStream = createReadStream(filePath)
    const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity
    })

    let headers = null
    let buffer = ""
    let inQuotes = false

    for await (const line of rl) {
        // Handle multi-line quoted fields
        buffer += (buffer ? "\n" : "") + line

        // Count quotes to determine if we're in a quoted field
        const quoteCount = (buffer.match(/"/g) || []).length
        inQuotes = quoteCount % 2 !== 0

        if (inQuotes) {
            continue // Keep buffering until we close the quotes
        }

        const row = parseCSVLine(buffer)
        buffer = ""

        if (!headers) {
            headers = row
            continue
        }

        const obj = {}
        for (let i = 0; i < headers.length; i++) {
            obj[headers[i]] = row[i] || null
        }

        yield { row: obj, headers }
    }
}

/**
 * Parse a single CSV line, handling quoted fields
 */
function parseCSVLine(line) {
    const result = []
    let current = ""
    let inQuotes = false

    for (let i = 0; i < line.length; i++) {
        const char = line[i]
        const nextChar = line[i + 1]

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                // Escaped quote
                current += '"'
                i++
            } else {
                // Toggle quote state
                inQuotes = !inQuotes
            }
        } else if (char === "," && !inQuotes) {
            result.push(current)
            current = ""
        } else {
            current += char
        }
    }

    result.push(current)
    return result
}

/**
 * Parse and clean cast names from comma-separated string
 */
function parseCastNames(castString) {
    if (!castString || castString.trim() === "") return []

    return castString
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name.length > 0 && name.length < 100) // Filter out empty or absurdly long names
}

/**
 * Normalize a name for matching (lowercase, remove extra spaces)
 */
function normalizeName(name) {
    return name.toLowerCase().replace(/\s+/g, " ").trim()
}

/**
 * Main enrichment function
 */
async function enrichImdbWithTmdb(db, tmdbFile) {
    console.log(`\nProcessing: ${tmdbFile}`)

    // Prepare statements for lookups and inserts
    const findMovieByImdbId = db.prepare(`
        SELECT tconst FROM title_basics WHERE tconst = ?
    `)

    const checkExistingLink = db.prepare(`
        SELECT 1 FROM title_principals
        WHERE tconst = ? AND nconst = ?
        LIMIT 1
    `)

    const getMaxOrdering = db.prepare(`
        SELECT COALESCE(MAX(ordering), 0) as max_order
        FROM title_principals
        WHERE tconst = ?
    `)

    const insertPrincipal = db.prepare(`
        INSERT INTO title_principals (tconst, ordering, nconst, category)
        VALUES (?, ?, ?, 'actor')
    `)

    // Stats
    let totalRows = 0
    let moviesMatched = 0
    let actorsAdded = 0
    let actorsAlreadyLinked = 0
    let actorsNotFound = 0

    // Batch processing
    const batchSize = 1000
    let pendingInserts = []

    const flushInserts = db.transaction(() => {
        for (const insert of pendingInserts) {
            insertPrincipal.run(insert.tconst, insert.ordering, insert.nconst)
        }
    })

    // Build a cache of name -> nconst for faster lookups
    console.log("  Building actor name cache...")
    const nameCache = new Map()
    const allNames = db.prepare("SELECT nconst, primary_name FROM name_basics").all()
    for (const row of allNames) {
        const normalized = normalizeName(row.primary_name)
        if (!nameCache.has(normalized)) {
            nameCache.set(normalized, row.nconst)
        }
    }
    console.log(`  Cached ${nameCache.size.toLocaleString()} unique actor names`)

    // Track which movie-actor pairs we've already processed this run
    const processedPairs = new Set()

    console.log("  Processing TMDB movies...")

    for await (const { row } of readCsv(tmdbFile)) {
        totalRows++

        // Need both imdb_id and cast
        const imdbId = row.imdb_id
        const castString = row.cast

        if (!imdbId || !imdbId.startsWith("tt") || !castString) {
            continue
        }

        // Check if movie exists in IMDB
        const movie = findMovieByImdbId.get(imdbId)
        if (!movie) continue

        moviesMatched++

        // Parse cast names
        const castNames = parseCastNames(castString)

        // Get current max ordering for this movie
        let currentOrdering = getMaxOrdering.get(imdbId).max_order

        for (const actorName of castNames) {
            const normalized = normalizeName(actorName)

            // Look up in cache
            const nconst = nameCache.get(normalized)
            if (!nconst) {
                actorsNotFound++
                continue
            }

            // Create a unique key for this movie-actor pair
            const pairKey = `${imdbId}:${nconst}`
            if (processedPairs.has(pairKey)) {
                continue
            }
            processedPairs.add(pairKey)

            // Check if already linked in database
            const existing = checkExistingLink.get(imdbId, nconst)
            if (existing) {
                actorsAlreadyLinked++
                continue
            }

            // Add to pending inserts
            currentOrdering++
            pendingInserts.push({
                tconst: imdbId,
                ordering: currentOrdering,
                nconst: nconst
            })
            actorsAdded++

            // Flush if batch is full
            if (pendingInserts.length >= batchSize) {
                flushInserts()
                pendingInserts = []
            }
        }

        // Progress update
        if (totalRows % 50000 === 0) {
            process.stdout.write(
                `\r  Processed ${totalRows.toLocaleString()} rows, ${moviesMatched.toLocaleString()} matched, ${actorsAdded.toLocaleString()} actors added...`
            )
        }
    }

    // Flush remaining inserts
    if (pendingInserts.length > 0) {
        flushInserts()
    }

    console.log(
        `\r  Processed ${totalRows.toLocaleString()} rows, ${moviesMatched.toLocaleString()} matched, ${actorsAdded.toLocaleString()} actors added`
    )

    return {
        totalRows,
        moviesMatched,
        actorsAdded,
        actorsAlreadyLinked,
        actorsNotFound
    }
}

/**
 * Main function
 */
async function main() {
    console.log("TMDB Cast Enrichment Script")
    console.log("===========================")
    console.log("Enriches IMDB database with additional cast from TMDB\n")

    // Check that IMDB database exists
    if (!existsSync(IMDB_DB_PATH)) {
        console.error(`Error: IMDB database not found at ${IMDB_DB_PATH}`)
        console.error("Please run 'npm run imdb' first to create the database.")
        process.exit(1)
    }

    // Create data directory if it doesn't exist
    if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true })
    }

    // Check for existing TMDB file
    console.log("Step 1: Checking for TMDB dataset...\n")

    let tmdbFile = findTmdbFile()

    if (!tmdbFile || forceDownload) {
        if (forceDownload && tmdbFile) {
            console.log("  --force specified, re-downloading...\n")
        } else {
            console.log("  TMDB file not found, downloading from Kaggle...\n")
        }

        if (!checkKaggleCli()) {
            console.error("Error: Kaggle CLI not found.")
            console.error("\nTo install:")
            console.error("  pip install kaggle")
            console.error("\nThen set up your API credentials:")
            console.error("  1. Go to https://www.kaggle.com/settings")
            console.error("  2. Click 'Create New Token' under API")
            console.error("  3. Save kaggle.json to ~/.kaggle/kaggle.json")
            console.error("  4. Run: chmod 600 ~/.kaggle/kaggle.json")
            process.exit(1)
        }

        if (!downloadFromKaggle()) {
            process.exit(1)
        }

        tmdbFile = findTmdbFile()
    } else {
        console.log("  TMDB file found, skipping download")
    }

    if (!tmdbFile) {
        console.error("Error: Could not find TMDB CSV file in data directory")
        process.exit(1)
    }

    // Open IMDB database
    console.log("\nStep 2: Opening IMDB database...\n")
    console.log(`  Database: ${IMDB_DB_PATH}`)

    const db = new Database(IMDB_DB_PATH)

    // Enable performance optimizations
    db.pragma("journal_mode = WAL")
    db.pragma("synchronous = NORMAL")
    db.pragma("cache_size = -64000") // 64MB cache

    // Get initial stats
    const initialPrincipals = db.prepare("SELECT COUNT(*) as count FROM title_principals").get().count
    console.log(`  Current title_principals entries: ${initialPrincipals.toLocaleString()}`)

    // Enrich with TMDB data
    console.log("\nStep 3: Enriching with TMDB cast data...")
    const stats = await enrichImdbWithTmdb(db, tmdbFile)

    // Get final stats
    const finalPrincipals = db.prepare("SELECT COUNT(*) as count FROM title_principals").get().count

    // Close database
    db.close()

    // Print summary
    console.log("\n===========================")
    console.log("Enrichment complete!\n")
    console.log("Statistics:")
    console.log(`  TMDB rows processed: ${stats.totalRows.toLocaleString()}`)
    console.log(`  Movies matched to IMDB: ${stats.moviesMatched.toLocaleString()}`)
    console.log(`  New actor links added: ${stats.actorsAdded.toLocaleString()}`)
    console.log(`  Actors already linked: ${stats.actorsAlreadyLinked.toLocaleString()}`)
    console.log(`  Actor names not found in IMDB: ${stats.actorsNotFound.toLocaleString()}`)
    console.log(`\nTitle principals: ${initialPrincipals.toLocaleString()} -> ${finalPrincipals.toLocaleString()}`)
}

main().catch((err) => {
    console.error("Error:", err)
    process.exit(1)
})
