#!/bin/bash
set -e

echo "=== Dev Environment Setup Check ==="
echo ""

# Check .dev.vars
if [ ! -f ".dev.vars" ]; then
  echo "❌ .dev.vars not found"
  echo ""
  echo "📋 Action Required:"
  echo "   cp workers/api/.dev.vars.example .dev.vars"
  echo "   # Then edit .dev.vars with your real keys"
  echo ""
  exit 1
fi

echo "✅ .dev.vars exists"

# Check required variables (existence only)
REQUIRED_VARS=(
  "HKU_API_KEY"
  "HKU_DEPLOYMENT_ID"
  "QWEN_BASE_URL"
  "QWEN_API_KEY"
  "ADMIN_TOKEN"
)

MISSING=""
for VAR in "${REQUIRED_VARS[@]}"; do
  if ! grep -q "^${VAR}=" .dev.vars; then
    MISSING="${MISSING}${VAR} "
  fi
done

if [ -n "$MISSING" ]; then
  echo "❌ Missing variables in .dev.vars: $MISSING"
  echo ""
  echo "📋 Action Required:"
  echo "   Edit .dev.vars and add:"
  for VAR in $MISSING; do
    echo "   $VAR=your_value_here"
  done
  echo ""
  exit 1
fi

echo "✅ All required variables present in .dev.vars"

# Check wrangler
if command -v wrangler &> /dev/null; then
  WRANGLER_VERSION=$(wrangler --version 2>/dev/null || echo "unknown")
  echo "✅ wrangler installed globally: $WRANGLER_VERSION"
elif [ -f "workers/api/node_modules/.bin/wrangler" ]; then
  WRANGLER_VERSION=$(cd workers/api && npx wrangler --version 2>/dev/null || echo "unknown")
  echo "✅ wrangler installed locally: $WRANGLER_VERSION"
else
  echo "❌ wrangler not found"
  echo ""
  echo "📋 Action Required:"
  echo "   cd workers/api && npm install"
  echo ""
  exit 1
fi

# Check if migrations applied
if [ ! -d ".wrangler/state/v3/d1" ]; then
  echo "⚠️  D1 local database not initialized"
  echo ""
  echo "📋 Action Required:"
  echo "   cd workers/api && npm run d1:migrate:local"
  echo ""
  exit 1
fi

echo "✅ D1 local database initialized"

# Check if units imported
UNIT_COUNT=$(sqlite3 .wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite "SELECT COUNT(*) FROM units" 2>/dev/null || echo "0")
if [ "$UNIT_COUNT" -eq "0" ]; then
  echo "⚠️  No units found in database"
  echo ""
  echo "📋 Action Recommended:"
  echo "   node scripts/seed-units.mjs data/seed_units.jsonl http://127.0.0.1:8787 dev-admin-token"
  echo "   (Run after starting wrangler dev)"
  echo ""
else
  echo "✅ Database has $UNIT_COUNT units"
fi

echo ""
echo "🎉 Environment ready!"
echo ""
echo "Next steps:"
echo "  1. cd workers/api && npm run dev"
echo "  2. cd apps/web && npm run dev"
echo "  3. Run: bash scripts/diagnose_local.sh"
