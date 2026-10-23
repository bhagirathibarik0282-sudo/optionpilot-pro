/** Static PostgreSQL expression equivalent to projectCanonicalPcrRows' market
 * projection. Keep array order, duplicate evidence, malformed values, absent
 * keys and explicit nulls so compact reads cannot upgrade source provenance.
 * Only used by the explicitly lossy dashboard projection; research stays raw.
 */
export function canonicalPcrProjectionSql(source: 'payload' | 'raw_market' = 'payload'): string {
 const keep=(value:string,keys:string[])=>`(SELECT COALESCE(jsonb_object_agg(p.key,p.value),'{}'::jsonb) FROM jsonb_each(${value}) AS p WHERE p.key IN (${keys.map(k=>"'"+k+"'").join(',')}))`;
 const quoteKeys=['strike','optionType','expiryDate','lastPrice','quoteTimestamp','pdc'];
 const side=(key:string)=>`CASE WHEN jsonb_typeof(e.value->'${key}')='array' THEN jsonb_build_object('${key}',
  (SELECT COALESCE(jsonb_agg(CASE jsonb_typeof(q.value) WHEN 'object' THEN ${keep('q.value',quoteKeys)} WHEN 'array' THEN '{}'::jsonb ELSE q.value END ORDER BY q.ord),'[]'::jsonb)
   FROM jsonb_array_elements(e.value->'${key}') WITH ORDINALITY AS q(value,ord))) ELSE '{}'::jsonb END`;
 const market=source==='raw_market'?'raw_market':"(payload->'market')";
 return `CASE WHEN jsonb_typeof(${market})='object' THEN
  ${keep(market,['symbol'])} || jsonb_build_object('gapScore',CASE WHEN jsonb_typeof(${market}->'gapScore')='object' THEN ${keep(market+"->'gapScore'",['fullChainPcr'])} ELSE '{}'::jsonb END)
  || CASE WHEN ${market} ? 'expiries' THEN jsonb_build_object('expiries',CASE WHEN jsonb_typeof(${market}->'expiries')='array' THEN
   (SELECT COALESCE(jsonb_agg(CASE jsonb_typeof(e.value) WHEN 'object' THEN ${keep('e.value',['expiry','expiryDate'])} || ${side('ceStrikes')} || ${side('peStrikes')} WHEN 'array' THEN '{}'::jsonb ELSE e.value END ORDER BY e.ord),'[]'::jsonb)
    FROM jsonb_array_elements(${market}->'expiries') WITH ORDINALITY AS e(value,ord))
   ELSE ${market}->'expiries' END) ELSE '{}'::jsonb END
  ELSE ${market} END`;
}
