# Performance Optimization Guide

## Database Optimization

### Indexes Added
- `idx_trades_account_date` - Filter trades by account & date range
- `idx_trades_user` - Filter trades by user (for aggregations)
- `idx_accounts_user` - Fetch user accounts quickly
- `idx_accounts_created` - Timeline-based queries
- `idx_alerts_read` - Filter read/unread alerts

### Query Optimization Tips
1. **Always use indexes** - Filter by `account_id`, `user_id`, `created_at`
2. **Avoid COUNT(*)** - Use pagination instead (LIMIT/OFFSET)
3. **Selective fields** - SELECT specific columns, not *
4. **Date aggregations** - Use `DATE()` function in WHERE clause for better indexing

### Example Optimized Queries
```sql
-- Good: Uses index
SELECT * FROM trades WHERE account_id = $1 AND DATE(entry_time) = $2 LIMIT 50

-- Bad: Full table scan
SELECT * FROM trades WHERE pnl > 100

-- Good: Aggregation with index
SELECT COUNT(*) FROM trades WHERE account_id = $1 AND created_at > NOW() - INTERVAL '30 days'

-- Bad: Complex calculation
SELECT * FROM trades WHERE EXTRACT(MONTH FROM created_at) = 5
```

## API Optimization

### Response Pagination
- Default limit: 50 items
- Max limit: 500 items
- Use `LIMIT` + `OFFSET` instead of fetching all data

### Selective Field Selection
Use query parameters to return only needed fields:
```typescript
// Instead of: SELECT * FROM users
// Use: SELECT id, email, created_at FROM users
```

### Rate Limiting
- **100 requests per minute** per user
- Prevents abuse and database overload
- Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

## Caching Strategy

### Cache Layer (cacheService.ts)
- **TTL**: 300 seconds (5 minutes) default
- **Keys**: Format = `prefix:arg1:arg2`
- **Usage**:

```typescript
import cacheService from './services/cacheService';

// Get from cache
let data = cacheService.get(cacheService.key('leaderboard', 'top100'));

// If not cached, fetch and cache
if (!data) {
  data = await db.query(...);
  cacheService.set(cacheService.key('leaderboard', 'top100'), data, 600); // 10 min TTL
}
```

### Cache Keys by Feature
| Feature | Key | TTL |
|---------|-----|-----|
| Leaderboard top 100 | `leaderboard:top100` | 600s |
| User profile | `user:${id}` | 300s |
| Account stats | `account:${id}:stats` | 300s |
| Daily summary | `daily:${account_id}:${date}` | 86400s |
| Broker distribution | `stats:brokers` | 3600s |

## Frontend Optimization

### Code Splitting
- Load components on-demand with React.lazy()
- Separate bundle for each route

### Image Optimization
- Use WebP format where supported
- Compress PNGs/JPGs
- Lazy load images below fold

### Bundle Size
- Current: ~150KB gzipped (acceptable)
- Target: <200KB gzipped

## Deployment Optimization

### Railway (Backend)
- Use PostgreSQL connection pooling (default: 10 connections)
- Monitor memory usage (should be <200MB)
- Set `max_connections = 100` in PostgreSQL config

### Vercel (Frontend)
- Automatic CDN distribution (global)
- Caching headers set on static assets
- Builds are cached when dependencies unchanged

## Monitoring

### Key Metrics to Track
1. **Database**
   - Query time (target: <100ms)
   - Connection pool utilization
   - Slow query log

2. **API**
   - Response time (target: <500ms)
   - Error rate (target: <0.1%)
   - Request volume

3. **Frontend**
   - Time to First Contentful Paint (target: <2s)
   - Largest Contentful Paint (target: <2.5s)
   - Cumulative Layout Shift (target: <0.1)

## Future Optimizations

### Phase 2
- [ ] Redis for distributed caching
- [ ] GraphQL for flexible field selection
- [ ] Database read replicas for analytics queries
- [ ] Elasticsearch for trade search

### Phase 3
- [ ] Machine learning model caching
- [ ] Trade history compression (archive old trades)
- [ ] Historical data partitioning by year

## Performance Checklist

Before deployment:
- [ ] All indexes created
- [ ] Pagination implemented on list endpoints
- [ ] Rate limiting active (100 req/min)
- [ ] Cache service integrated
- [ ] Response times <500ms (tested locally)
- [ ] Database queries optimized
- [ ] Frontend bundle <200KB gzipped
- [ ] All 19 tables populated with test data

Production monitoring:
- [ ] CloudWatch / Datadog alerts set
- [ ] Slow query logging enabled
- [ ] APM (New Relic / Datadog) configured
- [ ] Uptime monitoring active
