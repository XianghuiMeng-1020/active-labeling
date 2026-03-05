#!/bin/bash
set -e

if [ -z "$1" ]; then
  echo "Usage: bash scripts/diagnose_prod.sh <BASE_URL>"
  echo ""
  echo "Examples:"
  echo "  bash scripts/diagnose_prod.sh https://your-worker.workers.dev"
  echo "  bash scripts/diagnose_prod.sh https://your-project.pages.dev"
  echo ""
  exit 1
fi

API_BASE="$1"
API_BASE="${API_BASE%/}"  # Remove trailing slash

echo "=== Production Environment Diagnostics ==="
echo ""
echo "🔍 Checking: $API_BASE"
echo ""

# Check health
echo "1️⃣  Checking /api/health..."
HEALTH_RESPONSE=$(curl -s -f "$API_BASE/api/health" 2>/dev/null || echo '{"error":"connection_failed"}')

if echo "$HEALTH_RESPONSE" | grep -q "error"; then
  echo "❌ Failed to connect to /api/health"
  echo "$HEALTH_RESPONSE"
  echo ""
  echo "📋 Troubleshooting:"
  echo "  - Verify the URL is correct"
  echo "  - Check if Worker is deployed: wrangler deployments list"
  echo "  - Check Cloudflare Dashboard > Workers > your-worker"
  exit 1
fi

echo "$HEALTH_RESPONSE" | python3 -m json.tool
echo ""

ENV=$(echo "$HEALTH_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('env', 'unknown'))")
HKU_PRESENT=$(echo "$HEALTH_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('hku', {}).get('key_present', False))")
QWEN_PRESENT=$(echo "$HEALTH_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('qwen', {}).get('key_present', False))")

# Check ping
echo "2️⃣  Checking /api/llm/ping..."
PING_RESPONSE=$(curl -s -X POST "$API_BASE/api/llm/ping" || echo '{"error":"connection_failed"}')
echo "$PING_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$PING_RESPONSE"
echo ""

PROVIDER=$(echo "$PING_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('provider', 'unknown'))" 2>/dev/null || echo "unknown")
STATUS=$(echo "$PING_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('status', 'unknown'))" 2>/dev/null || echo "unknown")
FALLBACK_USED=$(echo "$PING_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('fallback_used', False))" 2>/dev/null || echo "false")

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Diagnostic Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Environment:    $ENV"
echo "HKU Key:        $([ "$HKU_PRESENT" = "True" ] && echo "✅ Present" || echo "❌ Missing")"
echo "Qwen Key:       $([ "$QWEN_PRESENT" = "True" ] && echo "✅ Present" || echo "⚠️  Missing")"
echo "LLM Provider:   $PROVIDER"
echo "LLM Status:     $STATUS"
echo "Fallback Used:  $FALLBACK_USED"
echo ""

# Verdict
if [ "$ENV" = "preview" ]; then
  echo "⚠️  PREVIEW ENVIRONMENT"
  echo ""
  echo "Preview environments typically don't have secrets configured."
  echo "This is expected behavior to avoid consuming quota in test branches."
  echo ""
  echo "📋 Recommendations:"
  echo "  1. Use production URL for real labeling work"
  echo "  2. Or configure preview secrets: wrangler secret put HKU_API_KEY --env preview"
  echo ""
elif [ "$PROVIDER" = "hku" ] && [ "$STATUS" = "200" ]; then
  echo "🎉 SUCCESS: Production environment ready"
  echo ""
  echo "✅ This environment can be used on new devices"
  echo "✅ HKU LLM calls working correctly"
  echo ""
  echo "Pages URL to share with users:"
  echo "  $API_BASE/user/start"
  echo ""
elif [ "$PROVIDER" = "none" ] && [[ "$STATUS" == *"auth"* ]]; then
  echo "❌ CRITICAL: HKU authentication failed"
  echo ""
  echo "📋 Action Required:"
  echo "  1. Set HKU_API_KEY secret:"
  echo "     wrangler secret put HKU_API_KEY"
  echo ""
  echo "  2. Verify deployment_id is correct:"
  echo "     wrangler secret put HKU_DEPLOYMENT_ID"
  echo ""
  echo "  3. Check HKU dashboard for key status"
  echo ""
  echo "  4. Verify deployment:"
  echo "     wrangler deploy --config wrangler.toml"
  echo ""
elif [ "$PROVIDER" = "qwen" ]; then
  echo "⚠️  Using Qwen fallback"
  echo ""
  echo "HKU is unavailable, system fell back to Qwen."
  echo "This works but indicates HKU availability issue."
  echo ""
  echo "Fallback reason: $(echo "$PING_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('fallback_reason', 'unknown'))" 2>/dev/null)"
  echo ""
  echo "📋 Recommendations:"
  echo "  - Check HKU service status"
  echo "  - Monitor Worker logs for HKU errors"
  echo "  - Consider alerting on high fallback rate"
else
  echo "❌ ISSUE: LLM not available"
  echo ""
  echo "Check error details above and refer to:"
  echo "  - TROUBLESHOOTING.md"
  echo "  - Cloudflare Dashboard > Workers > Logs"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
