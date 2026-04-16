#!/bin/bash
# TransactionWonder Deploy Script
# Deploys TransactionWonder as standalone CEO agent

set -e

echo "🔐 TransactionWonder Deploy"
echo "===================="
echo ""

# Configuration
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRANSACTIONWONDER_WORKSPACE="$HOME/ceo"

# Source .env file
if [ -f "$REPO_DIR/.env" ]; then
    echo "📝 Loading environment variables..."
    export $(grep -v '^#' "$REPO_DIR/.env" | xargs)
else
    echo "⚠️  No .env file found. Using .env.example defaults."
fi

# Step 1: Create TransactionWonder workspace
echo "📁 Creating TransactionWonder workspace..."
mkdir -p "$TRANSACTIONWONDER_WORKSPACE"
mkdir -p "$TRANSACTIONWONDER_WORKSPACE/agents"
mkdir -p "$TRANSACTIONWONDER_WORKSPACE/skills"
mkdir -p "$TRANSACTIONWONDER_WORKSPACE/memory"

# Step 2: Copy config to Clawdbot directory
echo "⚙️  Copying TransactionWonder config..."
mkdir -p "$HOME/.clawdbot/agents/ceo/agent"
cp "$REPO_DIR/config/clawdbot.json5" "$HOME/.clawdbot/config.json5" 2>/dev/null || true
cp "$REPO_DIR/agents/ceo/AGENT.md" "$HOME/.clawdbot/agents/ceo/agent/AGENT.md"
cp "$REPO_DIR/CLAUDE.md" "$HOME/.clawdbot/agents/ceo/agent/CLAUDE.md" 2>/dev/null || true
cp "$REPO_DIR/SKILLS.md" "$HOME/.clawdbot/agents/ceo/agent/SKILLS.md" 2>/dev/null || true
cp "$REPO_DIR/STEERING.md" "$HOME/.clawdbot/agents/ceo/agent/STEERING.md" 2>/dev/null || true
cp "$REPO_DIR/AGENTS.md" "$HOME/.clawdbot/agents/ceo/agent/AGENTS.md" 2>/dev/null || true

# Step 3: Copy agents to TransactionWonder workspace
echo "🤖 Syncing agent definitions..."
cp -r "$REPO_DIR/agents/"* "$TRANSACTIONWONDER_WORKSPACE/agents/"

# Step 4: Copy skills
echo "🛠️  Syncing skills..."
if [ -d "$REPO_DIR/skills" ]; then
    cp -r "$REPO_DIR/skills/"* "$TRANSACTIONWONDER_WORKSPACE/skills/" 2>/dev/null || true
fi

# Step 5: Copy memory files
echo "🧠 Syncing memory..."
if [ -d "$REPO_DIR/memory" ]; then
    cp -r "$REPO_DIR/memory/"* "$TRANSACTIONWONDER_WORKSPACE/memory/" 2>/dev/null || true
fi

# Step 6: Install dependencies
echo "📦 Installing dependencies..."
cd "$REPO_DIR"
bun install

# Step 7: Setup database (if not already done)
if [ -n "$DATABASE_URL" ]; then
    echo "🗄️  Setting up database..."
    # Check if tables exist
    if ! psql "$DATABASE_URL" -c "SELECT 1 FROM tenants LIMIT 1;" &>/dev/null; then
        echo "Running migrations..."
        bun run db:setup
    else
        echo "Database already initialized."
    fi
fi

echo ""
echo "✅ TransactionWonder Deploy Complete!"
echo ""
echo "Next steps:"
echo "  1. Start TransactionWonder API: bun run dev"
echo "  2. Start Dashboard: bun run dashboard:dev"
echo "  3. Access dashboard at http://localhost:5174"
echo ""
