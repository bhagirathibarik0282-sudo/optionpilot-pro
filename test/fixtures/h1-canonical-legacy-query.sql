SELECT
          (payload->>'minuteBucket')::timestamptz AS minute_bucket,
          payload->>'symbol' AS symbol,
          payload->>'snapshotId' AS snapshot_id,
          payload->>'truthVerdict' AS truth_verdict,
          payload->>'sourceTimestamp' AS source_timestamp,
          payload->>'calculationVersion' AS calculation_version,
          payload->'market' AS market
        FROM app_state_log
        WHERE kind = 'H1_CANONICAL_MARKET_ARCHIVE'
          AND payload->>'symbol' = $1
          AND payload->>'minuteBucket' IS NOT NULL
          AND (((payload->>'minuteBucket')::timestamptz AT TIME ZONE 'Asia/Kolkata')::date = $2::date)
          AND (((payload->>'minuteBucket')::timestamptz AT TIME ZONE 'Asia/Kolkata')::time >= $3::time)
          AND (((payload->>'minuteBucket')::timestamptz AT TIME ZONE 'Asia/Kolkata')::time <= $4::time)
        ORDER BY (payload->>'minuteBucket')::timestamptz ASC
