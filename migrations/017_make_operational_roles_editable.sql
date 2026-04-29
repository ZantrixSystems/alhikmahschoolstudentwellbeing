UPDATE roles
SET is_editable = TRUE,
    updated_at = NOW()
WHERE role_key IN ('caseworker', 'concern_logger')
  AND deleted_at IS NULL;
