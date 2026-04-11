-- Storage Settings: reserved keys in system_settings for directory paths
-- No new table needed. These are stored in the existing system_settings key/value table.
-- Keys:
--   storage_aio_dir  - directory for AIO downloads
--   storage_hsl_dir  - directory for HSL downloads
--   storage_mro_dir  - directory for MRO downloads
--   storage_pdf_dir  - directory for PDF exports
INSERT INTO system_settings (key, value)
  VALUES ('storage_aio_dir', ''),
         ('storage_hsl_dir', ''),
         ('storage_mro_dir', ''),
         ('storage_pdf_dir', '')
  ON CONFLICT (key) DO NOTHING;
