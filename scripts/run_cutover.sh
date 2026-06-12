#!/bin/bash
#
# scripts/run_cutover.sh
# OpenSquad -> OpenHiveOS Cutover Execution Script
#
# This script executes the 009_opensquad_cutover.sql migration.
# It ensures the required environment variables are set for the psql session.
#
# Usage:
#   ./scripts/run_cutover.sh
#

set -e

# Get the directory of the script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Load environment variables from .env file at the project root
if [ -f "$PROJECT_ROOT/.env" ]; then
  export $(grep -v '^#' "$PROJECT_ROOT/.env" | xargs)
fi

# --- Pre-flight checks ---

# Check if psql is installed
if ! command -v psql &> /dev/null
then
    echo "psql could not be found. Please install PostgreSQL client tools."
    exit 1
fi

# Check for required environment variables
if [ -z "$DATABASE_URL" ]; then
    echo "Error: DATABASE_URL is not set. Please define it in your .env file."
    echo "Example: DATABASE_URL=\"postgresql://openhiveos:your_password@localhost:5432/openhiveos\""
    exit 1
fi

if [ -z "$OS_MIGRATION_SOURCE_DB_URL" ]; then
    echo "Error: OS_MIGRATION_SOURCE_DB_URL is not set. Please define it in your .env file."
    echo "Example: OS_MIGRATION_SOURCE_DB_URL=\"postgresql://opensquad:source_password@localhost:5433/opensquad\""
    exit 1
fi

echo "▶️  Starting OpenSquad -> OpenHiveOS data cutover..."
echo "----------------------------------------------------"
echo "TARGET DB: $DATABASE_URL"
echo "SOURCE DB: $OS_MIGRATION_SOURCE_DB_URL"
echo "----------------------------------------------------"

# Run the migration script
# We pass the source DB URL as a session variable for dblink
psql -v ON_ERROR_STOP=1 \
    -v "source_db_url=$OS_MIGRATION_SOURCE_DB_URL" \
     -f "$PROJECT_ROOT/migrations/009_opensquad_cutover.sql" \
     "$DATABASE_URL"

echo "✅ Cutover script executed successfully."
echo "----------------------------------------------------"
echo "RECOMMENDATION: Run the validation queries at the end of the SQL script manually to verify row counts."
echo "psql \"$DATABASE_URL\" -c \"...validation query...\""
echo "----------------------------------------------------"
