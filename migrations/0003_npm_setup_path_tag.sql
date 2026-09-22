-- Rebuild only the derived tag and its index; retain every original log field.
-- Applying this migration also tags historical requests for the npm script.
DROP INDEX access_logs_tag;
ALTER TABLE access_logs DROP COLUMN path_tag;
ALTER TABLE access_logs ADD COLUMN path_tag TEXT GENERATED ALWAYS AS (
  CASE
    WHEN path IN ('/', '/npm.sh') THEN '初始化脚本'
    WHEN path = '/admin' OR substr(path, 1, 7) = '/admin/' THEN '管理后台'
    WHEN lower(path) = '/registry.npmjs.org' OR lower(path) LIKE '/registry.npmjs.org/%'
      OR lower(path) GLOB '/registry.npmjs.org:[0-9]*' THEN 'npm'
    WHEN lower(path) IN ('/archive.ubuntu.com', '/security.ubuntu.com')
      OR lower(path) LIKE '/archive.ubuntu.com/%' OR lower(path) LIKE '/security.ubuntu.com/%'
      OR lower(path) GLOB '/archive.ubuntu.com:[0-9]*' OR lower(path) GLOB '/security.ubuntu.com:[0-9]*' THEN 'Ubuntu'
    ELSE '其他路径'
  END
) VIRTUAL;
CREATE INDEX access_logs_tag ON access_logs(path_tag, id DESC);
