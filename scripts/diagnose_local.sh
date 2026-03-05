#!/bin/bash
set -e

echo "=== Local Environment Diagnostics ==="
echo ""

# Auto-detect Worker port
WORKER_PORT=""
if [ -d ".wrangler/tmp" ]; then
  # Try to find port from wrangler process
  WORKER_PORT=$(lsof -ti:8787 2>/dev/null | head -1 || echo "")
  if [ -n "$WORKER_PORT" ]; then
    WORKER_PORT="8787"
  else
    # Check common ports
    for PORT in 8787 51049 52000 53313 65080; do
      if lsof -ti:$PORT &>/dev/null; then
        WORKER_PORT=$PORT
        break
      fi
    done
  fi
fi

if [ -z "$WORKER_PORT" ]; then
  echo "❌ Worker not running (no port detected)"
  echo ""
  echo "📋 Action Required:"
  echo "   cd workers/api && npm run dev"
  echo ""
  exit 1
fi

API_BASE="http://127.0.0.1:$WORKER_PORT"
echo "🔍 Detected Worker at: $API_BASE"
echo ""

# Check health
echo "1️⃣  Checking /api/health..."
HEALTH_RESPONSE=$(curl -s "$API_BASE/api/health" || echo '{"error":"connection_failed"}')
echo "$HEALTH_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$HEALTH_RESPONSE"
echo ""

ENV=$(echo "$HEALTH_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('env', 'unknown'))" 2>/dev/null || echo "unknown")
HKU_PRESENT=$(echo "$HEALTH_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('hku', {}).get('key_present', False))" 2>/dev/null || echo "false")
QWEN_PRESENT=$(echo "$HEALTH_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('qwen', {}).get('key_present', False))" 2>/dev/null || echo "false")

if [ "$ENV" = "preview" ]; then
  echo "⚠️  WARNING: Environment is 'preview'"
  echo "   Preview may not have LLM secrets configured"
  echo ""
fi

if [ "$HKU_PRESENT" = "False" ] || [ "$HKU_PRESENT" = "false" ]; then
  echo "⚠️  HKU key not present"
  echo "   Edit .dev.vars: HKU_API_KEY=your_real_key"
  echo ""
fi

if [ "$QWEN_PRESENT" = "False" ] || [ "$QWEN_PRESENT" = "false" ]; then
  echo "⚠️  Qwen key not present (fallback won't work)"
  echo ""
fi

# Check LLM ping
echo "2️⃣  Checking /api/llm/ping..."
PING_RESPONSE=$(curl -s -X POST "$API_BASE/api/llm/ping" || echo '{"error":"connection_failed"}')
echo "$PING_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$PING_RESPONSE"
echo ""

PROVIDER=$(echo "$PING_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('provider', 'unknown'))" 2>/dev/null || echo "unknown")
STATUS=$(echo "$PING_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('status', 'unknown'))" 2>/dev/null || echo "unknown")
FALLBACK_USED=$(echo "$PING_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('fallback_used', False))" 2>/dev/null || echo "false")

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Environment:    $ENV"
echo "HKU Key:        $([ "$HKU_PRESENT" = "True" ] || [ "$HKU_PRESENT" = "true" ] && echo "✅ Present" || echo "❌ Missing")"
echo "Qwen Key:       $([ "$QWEN_PRESENT" = "True" ] || [ "$QWEN_PRESENT" = "true" ] && echo "✅ Present" || echo "⚠️  Missing")"
echo "LLM Provider:   $PROVIDER"
echo "LLM Status:     $STATUS"
echo "Fallback Used:  $FALLBACK_USED"
echo ""

if [ "$PROVIDER" = "hku" ] && [ "$STATUS" = "200" ]; then
  echo "🎉 SUCCESS: Local environment ready for LLM calls"
  echo ""
  echo "Next steps:"
  echo "  1. Open http://localhost:5173/user/start"
  echo "  2. Create a session and test U1 → U2 → U3"
  echo "  3. Run: bash scripts/e2e_smoke.sh (automated test)"
elif [ "$PROVIDER" = "none" ] && [[ "$STATUS" == *"auth"* ]]; then
  echo "❌ ISSUE: HKU authentication failed"
  echo ""
  echo "📋 Action Required:"
  echo "  1. Verify HKU_API_KEY in .dev.vars is correct"
  echo "  2. Verify HKU_DEPLOYMENT_ID matches your deployment"
  echo "  3. Check HKU dashboard for key validity"
  echo "  4. Restart wrangler dev after fixing .dev.vars"
elif [ "$PROVIDER" = "qwen" ]; then
  echo "⚠️  Using Qwen fallback (HKU unavailable)"
  echo ""
  echo "Reason: $(echo "$PING_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('fallback_reason', 'unknown'))" 2>/dev/null)"
  echo ""
  echo "This is OK for testing, but check HKU status for production use"
else
  echo "❌ ISSUE: LLM not available"
  echo ""
  echo "Check the error details above and refer to TROUBLESHOOTING.md"
fi

echo ""
echo "For detailed logs, run: wrangler tail --config ../../wrangler.toml"
