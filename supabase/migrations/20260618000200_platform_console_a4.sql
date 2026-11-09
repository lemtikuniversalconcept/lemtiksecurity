-- Platform console A4: database health snapshot for lemtik_admin

CREATE OR REPLACE FUNCTION public.get_platform_db_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  active_connections integer := 0;
  idle_connections integer := 0;
  max_connections integer := 0;
  long_running_queries integer := 0;
  database_size_bytes bigint := 0;
  utilisation_pct numeric := 0;
  status text := 'offline';
BEGIN
  SELECT count(*) INTO active_connections
  FROM pg_stat_activity
  WHERE datname = current_database()
    AND state = 'active';

  SELECT count(*) INTO idle_connections
  FROM pg_stat_activity
  WHERE datname = current_database()
    AND state = 'idle';

  SELECT setting::integer INTO max_connections
  FROM pg_settings
  WHERE name = 'max_connections';

  SELECT count(*) INTO long_running_queries
  FROM pg_stat_activity
  WHERE datname = current_database()
    AND state = 'active'
    AND now() - query_start > interval '2 minutes';

  SELECT pg_database_size(current_database()) INTO database_size_bytes;

  IF max_connections > 0 THEN
    utilisation_pct := round(((active_connections::numeric / max_connections::numeric) * 100), 1);
  END IF;

  IF utilisation_pct >= 90 OR long_running_queries >= 5 THEN
    status := 'degraded';
  ELSIF utilisation_pct >= 70 OR long_running_queries > 0 THEN
    status := 'warning';
  ELSE
    status := 'online';
  END IF;

  RETURN jsonb_build_object(
    'status', status,
    'active_connections', active_connections,
    'idle_connections', idle_connections,
    'max_connections', max_connections,
    'utilisation_pct', utilisation_pct,
    'long_running_queries', long_running_queries,
    'database_size_bytes', database_size_bytes,
    'database_size_mb', round(database_size_bytes / 1024.0 / 1024.0, 1),
    'checked_at', now()
  );
END;
$$;

